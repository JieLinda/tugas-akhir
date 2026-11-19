import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import {
  CryptoError,
  open,
  parseMasterKey,
  seal,
  unwrapDataKey,
} from '@/lib/crypto/envelope';
import { masterKeyFilePath, readMasterKey } from '@/lib/crypto/master-key-file';

/**
 * In-memory cache of the data key, unlocked from the master key on disk.
 *
 * The master key lives in a file (lib/crypto/master-key-file.ts) that the UI
 * generates and rotates. This process reads it on demand, unwraps the DEK, and
 * keeps the DEK here — so a restart re-unlocks itself and no human has to be
 * awake for the Monday 01:00 sync to write an encrypted column.
 *
 * Consequences worth stating plainly rather than discovering later:
 *   • Encrypted values are unreadable when no master key can be found. Reads
 *     degrade to a marker (see decryptOrNull); they do not throw and do not take
 *     pages down.
 *   • Writes to encrypted columns fail in that state, loudly. Silently storing
 *     plaintext into a column the rest of the system believes is encrypted
 *     would be far worse than an error.
 *   • lock() is now a deliberate operator action ("stop being able to read this
 *     until I say so"), not the default post-restart state. It drops the cached
 *     DEK; the next operation re-reads the file unless the file is gone too.
 *
 * Stored on globalThis so Next.js dev HMR does not silently re-lock the app on
 * every edit — the same reason lib/db does it.
 */

type KeyState = {
  dataKey: Buffer | null;
  unlockedAt: Date | null;
  keyId: string | null;
  /**
   * Set by an explicit lock(). Suppresses auto-unlock until someone unlocks
   * again, so "Kunci" in the UI means something — without it the very next
   * request would silently re-read the file and undo the operator's action.
   * Deliberately NOT persisted: a restart clears it, which is the safe default
   * for an unattended cron.
   */
  manuallyLocked: boolean;
};

const globalForKeys = globalThis as unknown as { __pulseKeyState?: KeyState };

const state: KeyState =
  globalForKeys.__pulseKeyState ??
  (globalForKeys.__pulseKeyState = {
    dataKey: null,
    unlockedAt: null,
    keyId: null,
    manuallyLocked: false,
  });

/** Thrown when an operation needs the data key and the app is locked. */
export class LockedError extends Error {
  constructor() {
    super('Enkripsi terkunci. Masukkan kunci enkripsi di Pengaturan untuk membuka.');
    this.name = 'LockedError';
  }
}

export function isUnlocked(): boolean {
  return state.dataKey !== null;
}

export function keyStatus(): {
  unlocked: boolean;
  unlockedAt: string | null;
  keyId: string | null;
  manuallyLocked: boolean;
} {
  return {
    unlocked: isUnlocked(),
    unlockedAt: state.unlockedAt?.toISOString() ?? null,
    keyId: state.keyId,
    manuallyLocked: state.manuallyLocked,
  };
}

/**
 * Make sure the DEK is available, unlocking from the key file if needed.
 *
 * Every read and write path calls this first. It is what turns the key file
 * into working auto-unlock: a fresh process, or one whose cache was dropped,
 * silently recovers on the next operation instead of requiring a human.
 *
 * Returns false rather than throwing when there is no key to be had — the
 * caller decides whether that means "store plaintext" (encryption was never
 * set up) or "refuse" (it was).
 */
export async function ensureUnlocked(): Promise<boolean> {
  if (state.dataKey) return true;
  // An explicit lock() must stick, or the button does nothing.
  if (state.manuallyLocked) return false;

  const masterKey = await readMasterKey();
  if (!masterKey) return false;

  const row = await activeKeyRow();
  if (!row) return false;

  try {
    state.dataKey = unwrapDataKey(parseMasterKey(masterKey), {
      wrapped: row.wrappedDek,
      verifier: row.verifier,
    });
    state.unlockedAt = new Date();
    state.keyId = row.id;
    return true;
  } catch (err) {
    // A key file that does not match the active row is a real misconfiguration
    // (restored DB against an old key file, half-finished rotation). Log it
    // once per attempt — silently behaving as "locked" would send someone
    // hunting through the UI for a problem that is on disk.
    console.error(
      `[crypto] Master key at ${masterKeyFilePath()} does not match the active ` +
        `app_encryption_keys row: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** The active key row, or null when encryption has never been initialised. */
export async function activeKeyRow() {
  const [row] = await db
    .select()
    .from(schema.appEncryptionKeys)
    .where(eq(schema.appEncryptionKeys.isActive, true))
    .limit(1);
  return row ?? null;
}

export async function isInitialized(): Promise<boolean> {
  return (await activeKeyRow()) !== null;
}

/**
 * True when encryption is active but the process holds no usable key.
 *
 * This is the state the app must not be usable in: ciphertext cannot be read
 * and plaintext must never be written. Auto-unlock from the key file first (a
 * no-op once the DEK is held), then fall back to checking the database.
 */
export async function isLocked(): Promise<boolean> {
  if (await ensureUnlocked()) return false;
  return (await activeKeyRow()) !== null;
}

/**
 * Verify a master key against the stored wrapped DEK and hold the result.
 *
 * Throws rather than returning false on a wrong key so the caller cannot
 * accidentally treat a failed unlock as success — this is the one place where a
 * silent mistake produces data written under a key nobody has.
 */
export async function unlockWithMasterKey(masterKeyB64: string): Promise<void> {
  const row = await activeKeyRow();
  if (!row) throw new CryptoError('Enkripsi belum diinisialisasi.');

  const masterKey = parseMasterKey(masterKeyB64);
  const dataKey = unwrapDataKey(masterKey, { wrapped: row.wrappedDek, verifier: row.verifier });

  state.dataKey = dataKey;
  state.unlockedAt = new Date();
  state.keyId = row.id;
  // An explicit unlock clears an explicit lock, otherwise the app would appear
  // to accept the key and stay locked.
  state.manuallyLocked = false;
}

/**
 * Drop the data key from memory and stop auto-unlocking until told otherwise.
 *
 * The sticky flag is the whole point now that a key file exists: without it the
 * next request would re-read the file and quietly undo the lock, making the
 * button a no-op. It is process-local and not persisted, so a restart returns
 * to auto-unlock — which is what an unattended cron needs.
 */
export function lock(): void {
  // Zero the buffer before dropping the reference: a freed Buffer's bytes can
  // linger in the heap until they happen to be overwritten, and a heap dump is
  // exactly the artefact a user-held key is meant to defeat.
  state.dataKey?.fill(0);
  state.dataKey = null;
  state.unlockedAt = null;
  state.keyId = null;
  state.manuallyLocked = true;
}

/** The data key, or LockedError. */
export function requireDataKey(): Buffer {
  if (!state.dataKey) throw new LockedError();
  return state.dataKey;
}

/** Data key as base64, for handing to a sibling service over the internal network. */
export function exportDataKeyB64(): string {
  return requireDataKey().toString('base64');
}

// ── Column helpers ─────────────────────────────────────────────

/** Encrypt a value for storage. Throws while locked — never stores plaintext. */
export function encryptValue(plaintext: string | null): string | null {
  if (plaintext == null || plaintext === '') return null;
  return seal(requireDataKey(), plaintext);
}

/**
 * The write primitive every encrypted column should use.
 *
 * Three states, and the middle one is the reason this exists rather than a bare
 * encryptValue():
 *   • encryption never initialised → store PLAINTEXT. A deployment that has not
 *     opted in must keep working exactly as before; requiring a key nobody
 *     created would break chat, feedback and settings on every existing install.
 *   • initialised and unlocked      → encrypt.
 *   • initialised but LOCKED        → throw. Falling back to plaintext here
 *     would be the worst option available: the column would silently hold a mix
 *     the operator believes is uniformly protected, and the rows written while
 *     locked would be exactly the ones nobody knows about.
 *
 * Costs one small indexed SELECT per write. That is affordable next to the
 * INSERT it accompanies, and it is what lets the feature be adopted gradually.
 */
export async function encryptIfEnabled(plaintext: string | null): Promise<string | null> {
  if (plaintext == null || plaintext === '') return plaintext;
  // Auto-unlock from the key file first, so a restarted process encrypts rather
  // than throwing on its first write.
  if (await ensureUnlocked()) return seal(requireDataKey(), plaintext);
  if (!(await isInitialized())) return plaintext;
  throw new LockedError();
}

/**
 * Decrypt for display, degrading instead of throwing.
 *
 * Returns `{ locked: true }` when the app has no key, so a page can render
 * "🔒 terkunci" in one field rather than failing the whole request. Values that
 * were written before encryption was enabled are not in the v1 format and pass
 * straight through — that is what lets a column be switched on without a
 * backfill.
 */
export function decryptOrNull(
  value: string | null,
): { value: string | null; locked: boolean; error: string | null } {
  if (value == null) return { value: null, locked: false, error: null };
  if (!isUnlocked()) {
    // Plaintext legacy values are still readable while locked; only real
    // ciphertext needs the key.
    if (!value.startsWith('v1:')) return { value, locked: false, error: null };
    return { value: null, locked: true, error: null };
  }
  try {
    return { value: open(requireDataKey(), value), locked: false, error: null };
  } catch (err) {
    return {
      value: null,
      locked: false,
      error: err instanceof Error ? err.message : 'Gagal mendekripsi.',
    };
  }
}
