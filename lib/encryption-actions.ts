'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { requirePermission } from '@/lib/rbac';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { formatDate } from '@/lib/datetime';
import {
  generateDataKey,
  generateMasterKey,
  parseMasterKey,
  unwrapDataKey,
  wrapDataKey,
} from '@/lib/crypto/envelope';
import {
  activeKeyRow,
  ensureUnlocked,
  exportDataKeyB64,
  isUnlocked,
  keyStatus,
  lock,
  requireDataKey,
  unlockWithMasterKey,
} from '@/lib/crypto/key-store';
import {
  backupMasterKeyFile,
  describeMasterKeyCustody,
  isManagedByUi,
  latestMasterKeyBackup,
  masterKeyFileExists,
  readMasterKey,
  readMasterKeyBackup,
  restoreMasterKeyFromBackup,
  writeMasterKeyFile,
} from '@/lib/crypto/master-key-file';

/**
 * Key management for the user-held encryption key.
 *
 * The master key is generated once, shown once, and never stored. Everything
 * here is guarded by `governance.manage` — the same permission that gates
 * scoring prompts and readiness thresholds — because holding this key is an
 * administrative capability, not a data-entry one.
 */

export type EncryptionStatus = {
  initialized: boolean;
  unlocked: boolean;
  unlockedAt: string | null;
  /** True when the operator pressed Kunci; auto-unlock is suppressed until they unlock. */
  manuallyLocked: boolean;
  /** Where the master key is read from: the key file, an env var, or nowhere yet. */
  keySource: 'file' | 'env' | null;
  /** Absolute path the key file is expected at. */
  keyFilePath: string;
  /** False when the key comes from PULSE_MASTER_KEY — the UI cannot rewrite an env var. */
  managedByUi: boolean;
  /** A rotation backup exists the key can be rolled back to (path, or null). */
  latestBackup: string | null;
  /** Sibling services that report holding the key. */
  services: { name: string; unlocked: boolean; reachable: boolean }[];
};

async function serviceStatus(): Promise<EncryptionStatus['services']> {
  const targets = [
    { name: 'sync-service', base: process.env.SYNC_SERVICE_URL },
  ].filter((t): t is { name: string; base: string } => Boolean(t.base));

  return Promise.all(
    targets.map(async ({ name, base }) => {
      try {
        const res = await fetch(`${base.replace(/\/$/, '')}/api/sync/_encryption-status`, {
          signal: AbortSignal.timeout(4000),
          cache: 'no-store',
        });
        if (!res.ok) return { name, unlocked: false, reachable: false };
        const body = (await res.json()) as { unlocked?: boolean };
        return { name, unlocked: body.unlocked === true, reachable: true };
      } catch {
        return { name, unlocked: false, reachable: false };
      }
    }),
  );
}

export async function getEncryptionStatusAction(): Promise<EncryptionStatus> {
  await requirePermission('governance.manage');
  const row = await activeKeyRow();
  // Attempt an auto-unlock before reporting, so opening the page on a freshly
  // restarted server shows the real state rather than a scary "terkunci" that
  // would have resolved itself on the next write anyway.
  await ensureUnlocked();
  const status = keyStatus();
  const custody = describeMasterKeyCustody();
  return {
    initialized: row !== null,
    unlocked: status.unlocked,
    unlockedAt: status.unlockedAt,
    manuallyLocked: status.manuallyLocked,
    keySource: custody.source,
    keyFilePath: custody.path,
    managedByUi: custody.managedByUi,
    latestBackup: await latestMasterKeyBackup(),
    services: await serviceStatus(),
  };
}

/**
 * Hand the unwrapped data key to the sibling services.
 *
 * They cannot derive it themselves — the master key only ever exists in the
 * browser and in this process's memory — so unlocking here has to propagate.
 *
 * There is no shared secret on this call and it does not need one: the receiver
 * verifies the key against the `verifier` column before accepting it, so the
 * worst an unauthenticated caller can do is submit a wrong key and be rejected.
 * A GET can never read the key back.
 *
 * Best-effort: the web app is usable while a sibling is down, and the sibling
 * re-requests nothing — it simply stays locked and falls back to its env vars.
 */
async function pushKeyToServices(dataKeyB64: string): Promise<string[]> {
  const failures: string[] = [];
  const base = process.env.SYNC_SERVICE_URL;
  if (!base) return failures;

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/api/sync/_unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dataKey: dataKeyB64 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) failures.push(`sync-service menolak kunci (HTTP ${res.status})`);
  } catch {
    failures.push('sync-service tidak dapat dihubungi');
  }
  return failures;
}

/**
 * First-time setup: mint a master key and a data key, store the data key
 * wrapped, and return the master key ONCE.
 *
 * Refuses to run when a key already exists. Overwriting the active row would
 * orphan every value already encrypted under the old data key — unrecoverably,
 * since the old master key cannot be re-derived.
 */
export async function initializeEncryptionAction(): Promise<{
  success: boolean;
  masterKey?: string;
  message: string;
}> {
  try {
    await requirePermission('governance.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    if (await activeKeyRow()) {
      return {
        success: false,
        message:
          'Enkripsi sudah diinisialisasi. Gunakan rotasi kunci bila ingin mengganti kunci master.',
      };
    }

    if (!isManagedByUi()) {
      return {
        success: false,
        message:
          'Kunci master berasal dari environment variable PULSE_MASTER_KEY, yang tidak dapat ditulis dari UI. ' +
          'Hapus variabel itu dan gunakan berkas kunci, atau buat kunci di luar aplikasi.',
      };
    }

    // An orphan key file with no active DB row is the leftover of a failed
    // setup, not something to silently overwrite — keep a copy either way.
    const orphanBackup = masterKeyFileExists() ? await backupMasterKeyFile() : null;

    const masterKey = generateMasterKey();
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(parseMasterKey(masterKey), dataKey);

    // Write the file BEFORE the row. A file with no row is inert and simply
    // gets replaced by the next attempt; a row with no file would mean the app
    // believes encryption is on while nothing on disk can unlock it, and the
    // wrapped DEK would be unrecoverable.
    const keyPath = await writeMasterKeyFile(masterKey);

    await db.insert(schema.appEncryptionKeys).values({
      label: 'default',
      wrappedDek: wrapped.wrapped,
      verifier: wrapped.verifier,
      isActive: true,
      createdBy: actorId,
    });

    // Unlock immediately so the operator is not locked out of the app by the
    // very act of turning encryption on.
    await unlockWithMasterKey(masterKey);
    await pushKeyToServices(exportDataKeyB64());

    await logAudit({
      tenantId,
      actorId,
      entityType: 'encryption',
      entityId: 'master-key',
      action: 'create',
      // The key itself must never reach the audit log — that log is readable in
      // the app and dumped by scripts/db-dump.cjs.
      summary: 'Kunci enkripsi dibuat dan diaktifkan.',
    });

    revalidatePath('/governance');
    revalidatePath('/settings/security');
    return {
      success: true,
      masterKey,
      message:
        `Kunci enkripsi dibuat dan disimpan di ${keyPath}. ` +
        'Simpan juga salinannya sekarang — kunci ini tidak dapat ditampilkan lagi, dan tanpa berkas ' +
        'maupun salinan itu data terenkripsi tidak dapat dipulihkan.' +
        (orphanBackup ? ` Berkas kunci lama yang tidak terpakai dicadangkan ke ${orphanBackup}.` : ''),
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal menginisialisasi enkripsi.',
    };
  }
}

export async function unlockEncryptionAction(
  masterKey: string,
  opts?: { bypassPermission?: boolean },
): Promise<{ success: boolean; message: string; warnings: string[] }> {
  try {
    // Normally this is an admin capability (governance.manage). The lock screen
    // that replaces the whole app while locked bypasses it on purpose: the
    // master key itself is the credential — the verifier check rejects anything
    // wrong — and a non-admin who has no other way into the app must still be
    // able to unlock it with the key they were given.
    if (!opts?.bypassPermission) await requirePermission('governance.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    await unlockWithMasterKey(masterKey);
    const warnings = await pushKeyToServices(exportDataKeyB64());

    // Adopt a correct key into the key file when there isn't one. This turns
    // manual unlock into the repair path for a lost or unmounted key file:
    // paste the key you saved at setup, and the app goes back to unlocking
    // itself on restart. Only ever written after the key has been proven to
    // unwrap the active row, so this cannot install a wrong key.
    let adopted: string | null = null;
    if (isManagedByUi() && !masterKeyFileExists()) {
      try {
        adopted = await writeMasterKeyFile(masterKey.trim());
      } catch (err) {
        warnings.push(
          `Kunci benar, tetapi berkas kunci gagal ditulis: ${err instanceof Error ? err.message : String(err)}. ` +
            'Aplikasi akan terkunci lagi setelah restart.',
        );
      }
    }

    await logAudit({
      tenantId,
      actorId,
      entityType: 'encryption',
      entityId: 'master-key',
      action: 'update',
      summary: adopted ? 'Enkripsi dibuka dan berkas kunci dipulihkan.' : 'Enkripsi dibuka.',
    });

    revalidatePath('/governance');
    revalidatePath('/settings/security');
    revalidatePath('/settings/sync');
    return {
      success: true,
      message: adopted
        ? `Enkripsi terbuka, dan kunci disimpan ke ${adopted} sehingga aplikasi membuka sendiri setelah restart.`
        : 'Enkripsi terbuka.',
      warnings,
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Kunci enkripsi salah.',
      warnings: [],
    };
  }
}

export async function lockEncryptionAction(): Promise<{ success: boolean; message: string }> {
  try {
    await requirePermission('governance.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    lock();

    // Sibling services are told to drop it too, otherwise "locked" would be a
    // half-truth: the web app would refuse to decrypt while sync-service
    // happily kept doing so.
    const base = process.env.SYNC_SERVICE_URL;
    if (base) {
      await fetch(`${base.replace(/\/$/, '')}/api/sync/_lock`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    await logAudit({
      tenantId,
      actorId,
      entityType: 'encryption',
      entityId: 'master-key',
      action: 'update',
      summary: 'Enkripsi dikunci.',
    });

    revalidatePath('/governance');
    return { success: true, message: 'Enkripsi dikunci. Nilai terenkripsi tidak dapat dibaca.' };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengunci enkripsi.',
    };
  }
}

/**
 * Replace the master key without touching a single encrypted value.
 *
 * This is the entire reason for the master-key/data-key split: rotation
 * re-wraps 32 bytes. Re-encrypting every protected column across three services
 * would be a migration nobody would ever run, so the key would never rotate.
 *
 * The old row is deactivated rather than deleted, so a rotation that is
 * interrupted between "insert new" and "deactivate old" can be diagnosed
 * instead of leaving no way back.
 */
export async function rotateMasterKeyAction(
  /**
   * Optional. Normally omitted — the current key is read from the key file, so
   * rotation is one click. Supply it only to recover when the file is missing or
   * out of step with the database.
   */
  currentMasterKey?: string,
): Promise<{ success: boolean; masterKey?: string; message: string }> {
  try {
    await requirePermission('governance.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const row = await activeKeyRow();
    if (!row) return { success: false, message: 'Enkripsi belum diinisialisasi.' };

    if (!isManagedByUi()) {
      return {
        success: false,
        message:
          'Kunci master berasal dari environment variable PULSE_MASTER_KEY dan tidak dapat dirotasi dari UI.',
      };
    }

    const current = currentMasterKey?.trim() || (await readMasterKey());
    if (!current) {
      return {
        success: false,
        message:
          'Kunci master saat ini tidak ditemukan di berkas kunci. Masukkan kunci lama secara manual untuk merotasi.',
      };
    }

    // Prove the current key really unwraps the active row BEFORE minting a
    // replacement. Without this a stale key file would be "rotated" into a new
    // one that unwraps nothing, and every encrypted value would be lost.
    const dataKey = unwrapDataKey(parseMasterKey(current), {
      wrapped: row.wrappedDek,
      verifier: row.verifier,
    });

    const newMasterKey = generateMasterKey();
    const rewrapped = wrapDataKey(parseMasterKey(newMasterKey), dataKey);

    // Copy the old key aside first: it is the only way back if anything below
    // fails halfway.
    const backup = await backupMasterKeyFile();

    const [inserted] = await db.transaction(async (tx) => {
      // Deactivate first: the partial unique index allows only one active row,
      // so inserting first would violate it.
      await tx
        .update(schema.appEncryptionKeys)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.appEncryptionKeys.id, row.id));

      return tx
        .insert(schema.appEncryptionKeys)
        .values({
          label: `rotated-${formatDate(new Date())}`,
          wrappedDek: rewrapped.wrapped,
          verifier: rewrapped.verifier,
          isActive: true,
          createdBy: actorId,
        })
        .returning({ id: schema.appEncryptionKeys.id });
    });

    // Database first, file second, with an explicit rollback. The file write is
    // the likelier failure (read-only mount, permissions), and undoing a
    // committed row is reliable — whereas leaving a new key on disk that the
    // database cannot match would lock the app out of its own data.
    try {
      await writeMasterKeyFile(newMasterKey);
    } catch (writeErr) {
      await db.transaction(async (tx) => {
        if (inserted) {
          await tx
            .delete(schema.appEncryptionKeys)
            .where(eq(schema.appEncryptionKeys.id, inserted.id));
        }
        await tx
          .update(schema.appEncryptionKeys)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.appEncryptionKeys.id, row.id));
      });
      return {
        success: false,
        message:
          `Rotasi dibatalkan — kunci baru gagal ditulis: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}. ` +
          'Kunci lama tetap berlaku dan tidak ada data yang terpengaruh.',
      };
    }

    // The data key is unchanged, so processes already holding it stay valid —
    // no service needs to be re-unlocked after a rotation.
    await unlockWithMasterKey(newMasterKey);

    await logAudit({
      tenantId,
      actorId,
      entityType: 'encryption',
      entityId: 'master-key',
      action: 'update',
      summary: 'Kunci master dirotasi. Data tidak dienkripsi ulang (kunci data tetap sama).',
    });

    revalidatePath('/governance');
    revalidatePath('/settings/security');
    return {
      success: true,
      masterKey: newMasterKey,
      message:
        'Kunci master baru dibuat dan ditulis ke berkas kunci. Kunci lama tidak berlaku lagi.' +
        (backup ? ` Kunci lama dicadangkan ke ${backup} — hapus setelah Anda yakin.` : ''),
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal merotasi kunci.',
    };
  }
}

/** Whether the process currently holds the data key (cheap, no DB round-trip). */
export async function isEncryptionUnlockedAction(): Promise<boolean> {
  return isUnlocked();
}

/**
 * Roll back the most recent rotation: restore the previous master key.
 *
 * Rotation leaves a way back ON PURPOSE — `master.key.<stamp>.bak` holds the key
 * that was in force before, and the row it matches is still in the table,
 * deactivated not deleted. That makes "try rotation, then revert it" a safe
 * testing loop: nothing about the data key changes in either direction, so no
 * encrypted value is touched.
 *
 * The rollback is written as its own mirror-image rotation rather than
 * resurrecting the old row directly:
 *   • The old row may have been created by `initialize` ("default"), whose
 *     label/wrapped DEK predate rotation entirely — a direct reactivation would
 *     smuggle a row that was never meant to be current back in.
 *   • Deactivation is not a write-once thing; a second rotation produces a
 *     second deactivated row, and "the old row" is ambiguous. The backup file is
 *     the authoritative "previous key", so we rebuild a fresh active row that
 *     wraps the SAME data key under that backup key. Same crypto, same DEK, but
 *     a clean row lifecycle.
 *
 * Same failure ordering as rotation: database first, file second, roll the DB
 * back if the file write fails.
 */
export async function rollbackMasterKeyRotationAction(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    await requirePermission('governance.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const active = await activeKeyRow();
    if (!active) return { success: false, message: 'Enkripsi belum diinisialisasi.' };

    if (!isManagedByUi()) {
      return {
        success: false,
        message:
          'Kunci master berasal dari environment variable PULSE_MASTER_KEY dan tidak memiliki cadangan rotasi.',
      };
    }

    const backup = await latestMasterKeyBackup();
    if (!backup) {
      return {
        success: false,
        message: 'Tidak ada cadangan kunci yang dapat dipulihkan.',
      };
    }

    // The backup file is the previous master key. The active row's wrapped DEK
    // is sealed under the CURRENT key, so the backup must NOT unwrap it — that
    // would mean the backup is stale and rolling back would install a key that
    // unwraps nothing. We prove the backup is usable instead by re-wrapping the
    // same DEK under it and restoring the file, both of which fail loudly if the
    // key is wrong.
    const previousKey = await readMasterKeyBackup(backup);
    if (!previousKey) {
      return { success: false, message: `Cadangan kunci kosong atau tidak terbaca: ${backup}` };
    }

    // We need the DEK out of the active row to re-wrap it. Auto-unlock from the
    // key file first; rollback must not turn a locked app into one that silently
    // writes plaintext, and without a key there is nothing to re-wrap anyway.
    if (!(await ensureUnlocked())) {
      return {
        success: false,
        message:
          'Enkripsi terkunci dan kunci data tidak dapat dipulihkan. Buka kunci enkripsi lebih dulu, lalu ulangi.',
      };
    }
    const dataKey = requireDataKey();

    const rewrapped = wrapDataKey(parseMasterKey(previousKey), dataKey);

    // Database first: deactivate the current row, insert the rolled-back one.
    const [inserted] = await db.transaction(async (tx) => {
      await tx
        .update(schema.appEncryptionKeys)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.appEncryptionKeys.id, active.id));

      return tx
        .insert(schema.appEncryptionKeys)
        .values({
          label: `rollback-${formatDate(new Date())}`,
          wrappedDek: rewrapped.wrapped,
          verifier: rewrapped.verifier,
          isActive: true,
          createdBy: actorId,
        })
        .returning({ id: schema.appEncryptionKeys.id });
    });

    // File second: restore the previous key. Roll the DB back if this fails.
    try {
      await restoreMasterKeyFromBackup(backup);
    } catch (writeErr) {
      await db.transaction(async (tx) => {
        if (inserted) {
          await tx.delete(schema.appEncryptionKeys).where(eq(schema.appEncryptionKeys.id, inserted.id));
        }
        await tx
          .update(schema.appEncryptionKeys)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.appEncryptionKeys.id, active.id));
      });
      return {
        success: false,
        message:
          `Rollback dibatalkan — kunci lama gagal ditulis: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}. ` +
          'Kunci saat ini tetap berlaku dan tidak ada data yang terpengaruh.',
      };
    }

    // Same DEK, so the in-memory key is still valid — re-verify it against the
    // new active row so keyId stays honest.
    await unlockWithMasterKey(previousKey);
    const warnings = await pushKeyToServices(exportDataKeyB64());

    await logAudit({
      tenantId,
      actorId,
      entityType: 'encryption',
      entityId: 'master-key',
      action: 'update',
      summary: 'Kunci master dikembalikan dari cadangan rotasi. Data tidak dienkripsi ulang.',
    });

    revalidatePath('/governance');
    revalidatePath('/settings/security');
    return {
      success: true,
      message:
        'Kunci master sebelumnya dipulihkan dari cadangan. Data tidak dienkripsi ulang (kunci data tetap sama).' +
        (warnings.length > 0 ? ` ${warnings.length} layanan pendamping tidak menerima kunci.` : ''),
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : 'Gagal mengembalikan kunci master.',
    };
  }
}