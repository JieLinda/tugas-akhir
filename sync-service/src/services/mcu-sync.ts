import { read as xlsxRead, utils } from 'xlsx';
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../db/postgres.js';
import { config } from '../config.js';
import { ensureNetworkShareAccess, assertPathAccessible } from './network-share.js';
import { discardSummary, discardUploaded, uploadedWorkbook } from './upload-store.js';
import type { SyncResult } from '../types.js';

interface McuRow {
  NPK?: string;
  Nama?: string;
  Kesimpulan?: string;
  /**
   * Optional dedicated column for a note longer than fits in Kesimpulan. Both
   * spellings accepted because the template header says "Keterangan" but
   * operators type what they like.
   */
  Keterangan?: string;
  KETERANGAN?: string;
}

/** Trim a cell to a string, or null when it carries nothing. */
function cellText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Normalize MCU status to standard values
 *
 * NOTE this is LOSSY on purpose — it answers "fit or not" — which is why the
 * caller now keeps the original string in `kesimpulan_raw`. The medical reason
 * behind an `unfit` lived only in that prose and was being discarded here.
 */
function normalizeMcuStatus(status: string | undefined): string | null {
  if (!status) return null;
  const normalized = status.toString().toLowerCase().trim();

  if (normalized.includes('unfit')) return 'unfit';

  if (normalized.includes('fit')) {
    if (normalized.includes('note')) return 'fit_with_note';
    return 'fit';
  }

  return null;
}

async function readWorkbookWithRetry(filePath: string, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buf = await fsReadFile(filePath);
      return xlsxRead(buf, { type: 'buffer' });
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[MCU] File read attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

export async function syncMcu(
  options: { uploadsOnly?: boolean } = {},
): Promise<SyncResult> {
  const { localMcuFolder } = config;

  // Uploaded copy wins over the shared folder - see hav-sync for the rationale,
  // including why uploadsOnly refuses to fall back to the share.
  const uploadsOnly = options.uploadsOnly === true;
  const uploaded = uploadedWorkbook('mcu');
  const shareFile = uploadsOnly || !localMcuFolder ? '' : join(localMcuFolder, 'MCU.xlsx');
  const filePath = uploaded ?? shareFile;
  const fromUpload = Boolean(uploaded);

  if (!filePath) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message: uploadsOnly
        ? 'Tidak ada berkas MCU yang diunggah.'
        : 'Tidak ada sumber MCU: LOCAL_MCU_FOLDER belum diatur dan belum ada file yang diunggah.',
    };
  }

  console.log(`[SYNC] Starting MCU sync from ${filePath} (${fromUpload ? 'upload' : 'share'})`);

  let disconnectShare: (() => Promise<void>) | null = null;

  try {
    // Share auth only applies to the shared-folder path; an uploaded file is local.
    if (!fromUpload) {
      disconnectShare = await ensureNetworkShareAccess(filePath);
      assertPathAccessible(filePath, 'LOCAL_MCU_FOLDER');
    }

    // Read the Excel file from the network path (buffer -> workbook)
    const workbook = await readWorkbookWithRetry(filePath);

     if (!workbook) {
      return { success: false, synced: 0, total: 0, message: 'Failed to read MCU.xlsx' };
    }

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return { success: false, synced: 0, total: 0, message: 'No sheets found in MCU.xlsx' };
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json<McuRow>(sheet);

    if (rows.length === 0) {
      return { success: true, synced: 0, total: 0, message: 'No rows in MCU sheet' };
    }

    console.log(`[MCU] Fetched ${rows.length} rows from sheet: ${sheetName}`);
    
    // Normalize rows and extract MCU status
    const normalized = rows
      .map((row) => {
        const npk = (row.NPK || '').toString().trim();
        const nama = (row.Nama || '').toString().trim();
        const kesimpulan = row.Kesimpulan;
        const status = normalizeMcuStatus(String(kesimpulan));
        // Kept verbatim. normalizeMcuStatus() only answers "fit or not"; the
        // medical detail an operator wrote alongside it ("FIT (dengan note
        // tekanan darah)") is exactly what the confidence layer has to read.
        const kesimpulanRaw = cellText(kesimpulan);
        const keterangan = cellText(row.Keterangan ?? row.KETERANGAN);

        return { npk, nama, status, kesimpulanRaw, keterangan };
      })
      .filter((r) => r.npk && r.status); // Only include rows with valid NPK and status

    const BATCH = 500;
    let synced = 0;
    let added = 0;
    let updated = 0;
    let preserved = 0;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // UPDATE-ONLY, never replace: rows already in sync_mcu are upserted by NPK
      // and nothing is ever deleted, so an employee missing from this workbook
      // keeps the status a previous upload gave them ("fit" stays "fit").
      // Counted before/after so the run can SAY how many were carried over.
      const beforeRow = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM sync_mcu');
      const before = Number(beforeRow.rows[0]?.n ?? 0);

      for (let i = 0; i < normalized.length; i += BATCH) {
        const batch = normalized.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const r of batch) {
          placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`);
          values.push(r.npk, r.nama, r.status, r.kesimpulanRaw, r.keterangan);
        }

        await client.query(
          `INSERT INTO sync_mcu (npk, nama, status, kesimpulan_raw, keterangan, synced_at)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (npk) DO UPDATE SET
            nama = EXCLUDED.nama,
            status = EXCLUDED.status,
            -- COALESCE, not a plain overwrite: this job runs unattended on the
            -- Monday cron, and a workbook that omits the note column must not
            -- erase notes a previous upload carried. Same rule the candidate
            -- birth_date upsert follows.
            kesimpulan_raw = COALESCE(EXCLUDED.kesimpulan_raw, sync_mcu.kesimpulan_raw),
            keterangan = COALESCE(EXCLUDED.keterangan, sync_mcu.keterangan),
            synced_at = EXCLUDED.synced_at`,
          values
        );

        synced += batch.length;
      }

      const afterRow = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM sync_mcu');
      const after = Number(afterRow.rows[0]?.n ?? 0);
      added = after - before;
      updated = synced - added;
      preserved = before - updated;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(`[MCU] Sync complete – ${synced} upserted`);
    // The uploaded workbook has been read into Postgres — consume it so the
    // next run doesn't silently re-import a stale copy that the user believes
    // they already replaced.
    const discarded = fromUpload ? discardUploaded([filePath]) : { removed: 0, failed: [] };

    return {
      success: true,
      synced,
      total: normalized.length,
      message:
        `${synced} record MCU diproses (${added} baru, ${updated} diperbarui` +
        (preserved > 0 ? `, ${preserved} record lama dipertahankan` : '') +
        `)` +
        discardSummary(discarded),
    };
  } catch (err) {
    console.error('[MCU] Sync failed:', err);
    return {
      success: false,
      synced: 0,
      total: 0,
      message: `MCU sync error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    if (disconnectShare) {
      try {
        await disconnectShare();
      } catch (err) {
        console.warn('[MCU] Failed to disconnect share:', err);
      }
    }
  }
}
