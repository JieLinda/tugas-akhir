import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * AES-256-GCM envelope encryption.
 *
 * Two keys, on purpose:
 *   • the MASTER KEY (the "key the user holds") never touches a column. It only
 *     wraps the data key.
 *   • the DATA KEY (DEK) encrypts every value. It is stored wrapped, in
 *     `app_encryption_keys`.
 *
 * The indirection is what makes rotation possible at all. Rotating the master
 * key re-wraps 32 bytes; without the DEK it would mean decrypting and
 * re-encrypting every protected column across three services in one
 * transaction, which nobody would ever actually do — so the key would never be
 * rotated.
 *
 * GCM rather than CBC because these values are read back and displayed: GCM
 * detects tampering and a truncated/garbled ciphertext fails loudly instead of
 * yielding plausible-looking garbage.
 *
 * This module is deliberately pure — no database, no environment, no I/O — so
 * it can be copied verbatim into sync-service (which has no path alias to
 * lib/) and stay byte-compatible. See sync-service/src/services/crypto.ts.
 */

/** Wire format version. Prefixing lets a reader tell ciphertext from plaintext. */
const V1 = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM's standard nonce length
const KEY_BYTES = 32;

export class CryptoError extends Error {}

/** Parse a base64 master key, rejecting anything that is not exactly 32 bytes. */
export function parseMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) throw new CryptoError('Kunci enkripsi kosong.');
  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, 'base64');
  } catch {
    throw new CryptoError('Kunci enkripsi bukan base64 yang valid.');
  }
  if (buf.length !== KEY_BYTES) {
    throw new CryptoError(
      `Kunci enkripsi harus ${KEY_BYTES} byte (${Math.ceil((KEY_BYTES * 4) / 3)} karakter base64), diterima ${buf.length} byte.`,
    );
  }
  return buf;
}

/** A fresh 32-byte key, base64-encoded for a human to copy and store. */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

export function generateDataKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Encrypt with `key`. Output is `v1:<iv>:<tag>:<ciphertext>`, all base64.
 *
 * Self-describing rather than a bare blob so that a column can hold a mix of
 * encrypted and not-yet-encrypted values during a rollout, and so a human
 * staring at a database row can tell immediately which it is.
 */
export function seal(key: Buffer, plaintext: string): string {
  if (key.length !== KEY_BYTES) throw new CryptoError('Panjang kunci tidak valid.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [V1, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/** True when `value` looks like something seal() produced. */
export function isSealed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${V1}:`);
}

/**
 * Decrypt a value produced by seal().
 *
 * A value that is NOT in the v1 format is returned unchanged. That is what lets
 * encryption be switched on for a column that already holds plaintext without a
 * backfill step and without a flag day: old rows read straight through, and any
 * row that gets written re-saves as ciphertext.
 */
export function open(key: Buffer, value: string): string {
  if (!isSealed(value)) return value;
  const parts = value.split(':');
  if (parts.length !== 4) throw new CryptoError('Format ciphertext tidak dikenali.');
  const [, ivB64, tagB64, ctB64] = parts;
  try {
    const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64!, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64!, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64!, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // GCM authentication failure. Almost always the wrong master key; could be
    // a corrupted row. Never surface the underlying error — it can leak whether
    // the tag or the padding failed.
    throw new CryptoError(
      'Gagal mendekripsi: kunci enkripsi salah atau data rusak.',
    );
  }
}

// ── Master key ⇄ data key ──────────────────────────────────────

export type WrappedKey = {
  /** The DEK sealed under the master key. */
  wrapped: string;
  /** A known plaintext sealed under the DEK, used to prove the key is right. */
  verifier: string;
};

const VERIFIER_PLAINTEXT = 'pulse-encryption-verifier-v1';

export function wrapDataKey(masterKey: Buffer, dataKey: Buffer): WrappedKey {
  return {
    wrapped: seal(masterKey, dataKey.toString('base64')),
    verifier: seal(dataKey, VERIFIER_PLAINTEXT),
  };
}

/**
 * Unwrap the DEK and PROVE the master key was correct before returning it.
 *
 * The verifier is not ceremony. Without it, a wrong master key that happens to
 * survive GCM authentication on the wrapped blob (or a swapped
 * `app_encryption_keys` row) would hand back a plausible 32-byte value, and the
 * first symptom would be silently unreadable data written under a key nobody
 * has. Failing here, at unlock, is the only cheap place to catch that.
 */
export function unwrapDataKey(masterKey: Buffer, stored: WrappedKey): Buffer {
  const raw = open(masterKey, stored.wrapped);
  const dataKey = Buffer.from(raw, 'base64');
  if (dataKey.length !== KEY_BYTES) {
    throw new CryptoError('Kunci data tersimpan tidak valid.');
  }

  const check = open(dataKey, stored.verifier);
  const expected = Buffer.from(VERIFIER_PLAINTEXT, 'utf8');
  const actual = Buffer.from(check, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new CryptoError('Kunci enkripsi salah.');
  }

  return dataKey;
}
