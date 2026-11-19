import { chmod, copyFile, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/**
 * Custody of the master key as a file on disk, managed from the UI.
 *
 * WHY A FILE RATHER THAN MEMORY
 * A memory-only key means the app is LOCKED after every restart until a human
 * pastes it back. That is survivable for the web UI and fatal for everything
 * else: the Monday 01:00 sync writes candidate, MCU, HAV and disciplinary rows
 * with nobody awake, so any column it touches could never be encrypted. A file
 * that both the web app and sync-service can read lets those writes be
 * protected at all.
 *
 * WHAT IT DOES AND DOES NOT PROTECT AGAINST
 * It protects against someone with DATABASE access — a psql session, a
 * Drizzle Studio window, a stolen dump. That is the actual exposure here: the
 * key is not in the database, so the database alone is not enough to read the
 * protected columns.
 * It does NOT protect against someone with FILESYSTEM access to the container,
 * who can read the key file directly. Keep the file's permissions tight and its
 * mount minimal; it is deliberately a separate trust boundary from the DB.
 */

const DEFAULT_RELATIVE_PATH = 'secrets/master.key';

/** Absolute path of the key file, from PULSE_MASTER_KEY_FILE or the default. */
export function masterKeyFilePath(): string {
  const configured = process.env.PULSE_MASTER_KEY_FILE?.trim() || DEFAULT_RELATIVE_PATH;
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

/**
 * Inline key from PULSE_MASTER_KEY.
 *
 * Supported because Kubernetes and some CI setups inject secrets as environment
 * variables rather than files. It takes LOWER precedence than the file, and the
 * UI cannot generate or rotate into it — an env var is set by whoever deploys
 * the process, not by a web request. Callers must say so rather than failing
 * with a confusing write error.
 */
export function masterKeyFromEnv(): string | null {
  const raw = process.env.PULSE_MASTER_KEY?.trim();
  return raw ? raw : null;
}

export type MasterKeySource = 'file' | 'env' | null;

export function masterKeyFileExists(): boolean {
  try {
    return existsSync(masterKeyFilePath());
  } catch {
    return false;
  }
}

/** Where the key would be read from right now. File wins over env. */
export function masterKeySource(): MasterKeySource {
  if (masterKeyFileExists()) return 'file';
  if (masterKeyFromEnv()) return 'env';
  return null;
}

/** True when the UI is allowed to generate/rotate — i.e. we are not on an env key. */
export function isManagedByUi(): boolean {
  return masterKeySource() !== 'env';
}

/** The master key, or null when neither source is configured. */
export async function readMasterKey(): Promise<string | null> {
  const path = masterKeyFilePath();
  if (existsSync(path)) {
    try {
      // Trimmed because a key file edited by hand almost always acquires a
      // trailing newline, and a 33-byte "32-byte key" is a baffling error.
      const raw = (await readFile(path, 'utf-8')).trim();
      return raw || null;
    } catch (err) {
      throw new Error(
        `Kunci enkripsi tidak dapat dibaca dari ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return masterKeyFromEnv();
}

/**
 * Copy the current key file aside before it is replaced.
 *
 * Rotation writes a new key over the only copy of the old one. If the database
 * half of the rotation has already committed and the file write then fails, the
 * old key is the only way back — so it is preserved before anything is touched.
 * Returns the backup path, or null when there was nothing to back up.
 */
export async function backupMasterKeyFile(): Promise<string | null> {
  const path = masterKeyFilePath();
  if (!existsSync(path)) return null;
  // Second-resolution is enough: two rotations inside one second would be a
  // double-click, and overwriting that backup loses nothing the first did not.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backup = `${path}.${stamp}.bak`;
  await copyFile(path, backup);
  return backup;
}

/**
 * Rotation backups next to the key file, newest first.
 *
 * Each rotation writes `master.key.<ISO timestamp>.bak` before replacing the
 * key, so a successful rotation leaves the previous master key recoverable.
 * These are what make rollback after a rotation possible — and what testing a
 * rotation can fall back on.
 */
export async function listMasterKeyBackups(): Promise<string[]> {
  const path = masterKeyFilePath();
  const dir = dirname(path);
  const base = basename(path);
  try {
    const entries = await readdir(dir);
    return entries
      .filter((entry) => entry.startsWith(`${base}.`) && entry.endsWith('.bak'))
      .map((entry) => resolve(dir, entry))
      // ISO timestamps sort lexicographically; newest first.
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/** The most recent rotation backup, or null when there is nothing to roll back to. */
export async function latestMasterKeyBackup(): Promise<string | null> {
  const backups = await listMasterKeyBackups();
  return backups[0] ?? null;
}

/** Read a rotation backup's master key (trimmed), or null when unreadable/empty. */
export async function readMasterKeyBackup(backupPath: string): Promise<string | null> {
  try {
    const raw = (await readFile(backupPath, 'utf-8')).trim();
    return raw || null;
  } catch {
    return null;
  }
}

/**
 * Restore a rotation backup over the live key file.
 *
 * Mirrors writeMasterKeyFile's atomicity: temp file + rename, and the current
 * (post-rotation) key is itself backed up first so a mistaken rollback is not
 * another dead end. Callers must have already proven the backup actually
 * matches the row being restored — the file is inert on its own.
 */
export async function restoreMasterKeyFromBackup(backupPath: string): Promise<string> {
  const path = masterKeyFilePath();
  if (!existsSync(backupPath)) {
    throw new Error(`Cadangan kunci tidak ditemukan: ${backupPath}`);
  }
  await backupMasterKeyFile();

  const key = (await readFile(backupPath, 'utf-8')).trim();
  if (!key) throw new Error(`Cadangan kunci kosong: ${backupPath}`);

  const tmp = `${path}.restoring`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(tmp, `${key}\n`, { encoding: 'utf-8', mode: 0o600 });
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, path);
    await chmod(path, 0o600).catch(() => {});
    return path;
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw new Error(
      `Kunci lama gagal ditulis ke ${path}: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }
}

/**
 * Write the key file atomically.
 *
 * Temp file + rename, so a crash mid-write can never leave a truncated key —
 * which would lock the app out of its own data with no error until the next
 * read. Same reason the upload route does it.
 */
export async function writeMasterKeyFile(masterKeyB64: string): Promise<string> {
  const path = masterKeyFilePath();
  const tmp = `${path}.writing`;

  await mkdir(dirname(path), { recursive: true });
  try {
    // Trailing newline so `cat` and hand-editing behave; readMasterKey trims it.
    await writeFile(tmp, `${masterKeyB64}\n`, { encoding: 'utf-8', mode: 0o600 });
    // Best-effort: chmod is a near no-op on Windows and must not fail the write
    // there. On Linux (where this actually deploys) it is what keeps the key
    // from being world-readable inside the container.
    await chmod(tmp, 0o600).catch(() => {});
    await rename(tmp, path);
    await chmod(path, 0o600).catch(() => {});
    return path;
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw new Error(
      `Kunci enkripsi gagal ditulis ke ${path}: ${err instanceof Error ? err.message : String(err)}. ` +
        `Pastikan direktori dapat ditulis oleh proses aplikasi (di Docker: mount ./secrets).`,
    );
  }
}

/** Human-readable custody description for the settings UI. */
export function describeMasterKeyCustody(): {
  source: MasterKeySource;
  path: string;
  managedByUi: boolean;
} {
  return {
    source: masterKeySource(),
    path: masterKeyFilePath(),
    managedByUi: isManagedByUi(),
  };
}
