import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { query as pgQuery } from "../db/postgres.js";
import { config } from "../config.js";

/**
 * Decryption half of the envelope scheme in lib/crypto/envelope.ts.
 *
 * A copy rather than an import: sync-service is a separate deployable with no
 * path alias to the web app's lib/, and the two are built independently. The
 * wire format ("v1:<iv>:<tag>:<ciphertext>", all base64, AES-256-GCM) is the
 * contract between them — change it in one place and you must change it here.
 *
 * Only decryption lives here. This service reads secrets; it never mints them,
 * so there is no reason for it to be able to produce ciphertext or key material.
 *
 * THE KEY IS NEVER PERSISTED. The web app pushes it to POST /api/sync/_unlock
 * after an operator unlocks there, and it lives in this process's memory until
 * the process restarts. A restart therefore leaves the service locked, which is
 * why every consumer must have an env-var fallback rather than failing.
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
 * lib/crypto/envelope.ts seal() — the wire format is the contract between the
 * two deployables, so a candidate written by sync-service must be readable by
 * the web app (and vice versa).
 */
export function seal(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES) throw new Error("Panjang kunci tidak valid.");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V1, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/**
 * Encrypt a value for storage, mirroring the web app's encryptIfEnabled()
 * three-state rule — never write plaintext into a column the deployment believes
 * is encrypted:
 *   • encryption never initialised → plaintext (install that never opted in).
 *   • initialised and unlocked     → ciphertext.
 *   • initialised but LOCKED       → throw. A silently plaintext row written by
 *     the 01:00 cron while locked would be exactly the one nobody knows about.
 *
 * The decision is computed once per sync run (resolveWriteMode) rather than per
 * value: a candidate write touches ~15 encrypted fields per row, and every
 * is-active lookup costs a query. ensureUnlocked() caches the DEK, so after the
 * first call the "encrypt" path is pure local work.
 */
export type WriteMode = "plaintext" | "encrypt" | "locked";

export async function resolveWriteMode(): Promise<WriteMode> {
  // Auto-unlock from the master key file first (mount ro), so a restarted
  // process encrypts rather than throwing on its first write.
  if (await ensureUnlocked()) return "encrypt";
  const rows = await pgQuery<{ id: string }>(
    `SELECT id FROM app_encryption_keys WHERE is_active = true LIMIT 1`,
  );
  if (rows.length === 0) return "plaintext";
  return "locked";
}

export function sealValue(mode: WriteMode, value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (mode === "plaintext") return String(value);
  if (mode !== "encrypt") {
    throw new Error(
      "Enkripsi aktif tetapi kunci tidak tersedia; menolak menulis data kandidat sebagai teks biasa.",
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

/**
 * Accept a data key pushed by the web app, but only after checking it against
 * the `verifier` column.
 *
 * This check is what makes the unlock endpoint safe to expose without a shared
 * secret. sync-service has no authentication of any kind; without verification,
 * anyone who could reach it could install a wrong key and every later decrypt
 * would produce garbage or throw. With it, the worst an unauthenticated caller
 * can do is be rejected.
 */
export async function acceptDataKey(dataKeyB64: string): Promise<void> {
  const candidate = Buffer.from(dataKeyB64.trim(), "base64");
  if (candidate.length !== KEY_BYTES) {
    throw new Error("Panjang kunci data tidak valid.");
  }

  const rows = await pgQuery<{ verifier: string }>(
    `SELECT verifier FROM app_encryption_keys WHERE is_active = true LIMIT 1`,
  );
  const verifier = rows[0]?.verifier;
  if (!verifier) throw new Error("Enkripsi belum diinisialisasi di database.");

  let decoded: string;
  try {
    decoded = open(candidate, verifier);
  } catch {
    throw new Error("Kunci data ditolak: verifier gagal didekripsi.");
  }

  const expected = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
  const actual = Buffer.from(decoded, "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Kunci data ditolak: verifier tidak cocok.");
  }

  dataKey = candidate;
  unlockedAt = new Date();
  console.log("[CRYPTO] Data key accepted; encrypted settings are now readable.");
}

export function lock(): void {
  dataKey?.fill(0);
  dataKey = null;
  unlockedAt = null;
  console.log("[CRYPTO] Data key dropped; encrypted settings are no longer readable.");
}

/** Absolute path of the master key file this service reads. */
export function masterKeyFilePath(): string {
  const configured = config.masterKeyFile || "secrets/master.key";
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/**
 * Unwrap the data key from the master key on disk.
 *
 * This is what makes encryption compatible with an unattended service. Before
 * the key file existed, this process could only hold a key that the web app
 * pushed to it after a human unlocked there — so any restart left it locked,
 * and the 01:00 cron would have had to either fail or write plaintext. Reading
 * the same file the web app writes removes the human from the loop entirely.
 *
 * Returns false rather than throwing: every caller has an environment-variable
 * fallback, and a sync must not die because a secret is unreadable.
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
    // Table absent (migration 0046 not applied) — encryption simply isn't on yet.
    return false;
  }
  const row = rows[0];
  if (!row) return false;

  try {
    const candidate = Buffer.from(open(master, row.wrapped_dek), "base64");
    if (candidate.length !== KEY_BYTES) throw new Error("unwrapped key has the wrong length");
    // Same verifier check as acceptDataKey: proves the key is right before it is
    // used, rather than discovering it through unreadable data later.
    const decoded = open(candidate, row.verifier);
    const expected = Buffer.from(VERIFIER_PLAINTEXT, "utf8");
    const actual = Buffer.from(decoded, "utf8");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("verifier mismatch");
    }
    dataKey = candidate;
    unlockedAt = new Date();
    console.log(`[CRYPTO] Unlocked from ${path}; encrypted settings are readable.`);
    return true;
  } catch (err) {
    // Loud, because the cause is always a real misconfiguration: a key file that
    // belongs to a different database, or a rotation that only half-applied.
    console.error(
      `[CRYPTO] Master key at ${path} does not match the active app_encryption_keys row: ${String(err)}`,
    );
    return false;
  }
}

/**
 * Decrypt a stored secret, or null when it cannot be read.
 *
 * Returns null instead of throwing so callers degrade to their environment-
 * variable fallback. Call ensureUnlocked() first — this stays synchronous
 * because it is used inside row-mapping loops.
 */
export function tryOpen(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (!isSealed(value)) return value;
  if (!dataKey) return null;
  try {
    return open(dataKey, value);
  } catch (err) {
    console.warn("[CRYPTO] Failed to decrypt a stored secret:", String(err));
    return null;
  }
}
