import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { query as pgQuery } from "../db/postgres.js";
import { config } from "../config.js";

/**
 * Decryption half of the envelope scheme in lib/crypto/envelope.ts (web app).
 *
 * A copy rather than an import: scoring-service is a separate deployable with
 * no path alias to the web app's lib/, and the two are built independently. The
 * wire format ("v1:<iv>:<tag>:<ciphertext>", all base64, AES-256-GCM) is the
 * contract between them — change it in one place and you must change it here.
 *
 * Only decryption lives here, on purpose: this service consumes candidate data
 * that the web app / sync-service sealed at rest, so it needs the DEK to read
 * them but never needs to mint ciphertext or key material.
 *
 * THE KEY IS NEVER PERSISTED. It is unwrapped on demand from the master key
 * file (PULSE_MASTER_KEY_FILE, default secrets/master.key, mounted ro) and kept
 * in this process's memory until the process restarts.
 */

const V1 = "v1";
const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const VERIFIER_PLAINTEXT = "pulse-encryption-verifier-v1";

let dataKey: Buffer | null = null;
let unlockedAt: Date | null = null;

export function isUnlocked(): boolean {
  return dataKey !== null;
}

export function encryptionStatus(): { unlocked: boolean; unlockedAt: string | null } {
  return { unlocked: dataKey !== null, unlockedAt: unlockedAt?.toISOString() ?? null };
}

export function isSealed(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${V1}:`);
}

/**
 * Encrypt a plaintext into the shared v1 envelope. Mirror of the web app's
 * lib/crypto/envelope.ts seal() and sync-service's copy — the wire format is the
 * contract between the three deployables.
 *
 * Used for the values this service writes that must not land in the database in
 * the clear: the run calculation trace and an incumbent's education requirement
 * in the frozen position basis.
 */
export function seal(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES) throw new Error("Panjang kunci tidak valid.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V1, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export type WriteMode = "plaintext" | "encrypt" | "locked";

/**
 * The web app's encryptIfEnabled() three-state rule, resolved once per use:
 *   • encryption never initialised -> plaintext (installs that never opted in).
 *   • initialised and unlocked     -> ciphertext.
 *   • initialised but LOCKED       -> refuse.
 *
 * Falling back to plaintext in that last state is the one option that must never
 * be taken: the column would silently hold a mix the operator believes is
 * uniformly protected.
 */
export async function resolveWriteMode(): Promise<WriteMode> {
  if (await ensureUnlocked()) return "encrypt";
  const rows = await pgQuery<{ id: string }>(
    `SELECT id FROM app_encryption_keys WHERE is_active = true LIMIT 1`,
  );
  if (rows.length === 0) return "plaintext";
  return "locked";
}

export function sealValue(
  mode: WriteMode,
  value: string | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (mode === "plaintext") return String(value);
  if (mode !== "encrypt") {
    throw new Error(
      "Enkripsi aktif tetapi kunci tidak tersedia; menolak menulis keterangan medis sebagai teks biasa.",
    );
  }
  return seal(dataKey!, String(value));
}

/** Decrypt a v1 value; anything not in that format is returned unchanged. */
export function open(key: Buffer, value: string): string {
  if (!isSealed(value)) return value;
  const parts = value.split(":");
  if (parts.length !== 4) throw new Error("Format ciphertext tidak dikenali.");
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64!, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64!, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Absolute path of the master key file this service reads. */
/**
 * Absolute path of the master key file this service reads.
 *
 * A relative `PULSE_MASTER_KEY_FILE` (and the default `secrets/master.key`) is
 * resolved against the SAME candidate layouts `resolveSharedConfigPath()` walks
 * for the other files the web app owns — because it is the same problem, and it
 * had the same failure:
 *
 *   • docker image — WORKDIR /app with ./secrets mounted at /app/secrets, so
 *     cwd-relative is already correct.
 *   • repo checkout — `pnpm dev` runs from `scoring-service/`, where
 *     cwd-relative points at `scoring-service/secrets/master.key`, which does
 *     not exist. The repo's key lives one level up.
 *
 * That second case made `resolveWriteMode()` return "locked" on every developer
 * machine, so every sealed write was correctly REFUSED rather than stored as
 * plaintext — the encryption rule working exactly as designed, on a file path
 * that was simply wrong. The first existing candidate
 * wins; when none exists the cwd-relative path is still returned, so the
 * warning names the location an operator would expect.
 */
export function masterKeyFilePath(): string {
  const configured = config.masterKeyFile || "secrets/master.key";
  if (isAbsolute(configured)) return configured;

  const candidates = [
    resolve(process.cwd(), configured),
    // scoring-service/src/services → repo root.
    resolve(__dirnameCompat(), "..", "..", "..", configured),
    // Docker: /app/dist/services → /app.
    resolve(__dirnameCompat(), "..", "..", configured),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return candidates[0]!;
}

/** `__dirname` for an ESM module, resolved once. */
function __dirnameCompat(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Unwrap the data key from the master key on disk.
 *
 * Same contract as the web app's auto-unlock: a fresh process silently recovers
 * from the key file on its first read, so a scoring run that reads candidates
 * does not need a human to unlock first. Returns false rather than throwing when
 * there is no key to be had — candidate reads degrade to null fields then.
 */
export async function ensureUnlocked(): Promise<boolean> {
  if (dataKey) return true;

  const path = masterKeyFilePath();
  let masterKeyB64: string | null = null;
  try {
    if (existsSync(path)) masterKeyB64 = readFileSync(path, "utf-8").trim() || null;
  } catch (err) {
    console.warn(`[CRYPTO] Master key file ${path} could not be read: ${String(err)}`);
  }
  if (!masterKeyB64) masterKeyB64 = config.masterKeyInline.trim() || null;
  if (!masterKeyB64) return false;

  const master = Buffer.from(masterKeyB64, "base64");
  if (master.length !== KEY_BYTES) {
    console.warn(`[CRYPTO] Master key at ${path} is not ${KEY_BYTES} bytes; ignoring.`);
    return false;
  }

  let rows: { wrapped_dek: string; verifier: string }[];
  try {
    rows = await pgQuery<{ wrapped_dek: string; verifier: string }>(
      `SELECT wrapped_dek, verifier FROM app_encryption_keys WHERE is_active = true LIMIT 1`,
    );
  } catch {
    // Table absent (encryption migrations not applied) — nothing is sealed.
    return false;
  }
  const row = rows[0];
  if (!row) return false;

  try {
    const candidate = Buffer.from(open(master, row.wrapped_dek), "base64");
    if (candidate.length !== KEY_BYTES) throw new Error("unwrapped key has the wrong length");
    // Same verifier check as the web app: proves the key is right before it is
    // used, rather than discovering it through unreadable data later.
    const decoded = open(candidate, row.verifier);
    const expected = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
    const actual = Buffer.from(decoded, "utf8");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("verifier mismatch");
    }
    dataKey = candidate;
    unlockedAt = new Date();
    console.log(`[CRYPTO] Unlocked from ${path}; encrypted candidate data is readable.`);
    return true;
  } catch (err) {
    console.error(
      `[CRYPTO] Master key at ${path} does not match the active app_encryption_keys row: ${String(err)}`,
    );
    return false;
  }
}

/**
 * Decrypt one stored candidate field for use in scoring.
 *
 * Plaintext (pre-encryption rows, or a deployment that never opted in) passes
 * straight through. Sealed values need the DEK: when the service is locked or
 * the key is wrong, the field degrades to null rather than throwing — a scoring
 * run must survive a locked key, and the field it loses is one piece of
 * context, not the run. Call ensureUnlocked() first; this stays synchronous
 * because it is used inside row-mapping loops.
 */
export function decryptField(value: string | number | null | undefined): string | number | null {
  if (value == null || value === "") return null;
  if (!isSealed(String(value))) return value;
  if (!dataKey) return null;
  try {
    return open(dataKey, String(value));
  } catch (err) {
    console.warn("[CRYPTO] Failed to decrypt a candidate field:", String(err));
    return null;
  }
}
