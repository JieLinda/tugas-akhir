import { read as xlsxRead, utils } from 'xlsx';
import { copyFile, readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../db/postgres.js';
import { config } from '../config.js';
import { ensureNetworkShareAccess, assertPathAccessible } from './network-share.js';
import { discardSummary, discardUploaded, uploadedWorkbook } from './upload-store.js';
import {
  applyHavUploadChanges,
  detectHavUploadChanges,
  type HavUploadApplyResult,
} from './hav-supersede.js';
import type { SyncResult } from '../types.js';
import { npkKey, npkKeySql } from './npk.js';
import { unknownNpkWarning } from './npk-check.js';

interface HavRow {
  NPK?: string;
  NAMA?: string;
  Quadrant?: unknown;
}

/**
 * Normalize a HAV quadrant value to the canonical raw number string format.
 * Accepts raw Excel values which may be a number (1), string ("1"),
 * or description ("Kuadran 3", "kuadran 7", "Kuadran #4", etc.).
 */
function normalizeQuadrant(raw: unknown): string | null {
  if (raw == null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  // Try to extract a number from the string
  const match = str.match(/(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num < 1 || num > 16) return null;
  return String(num);
}

async function readFileWithRetry(filePath: string, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const buf = await fsReadFile(filePath);
      return xlsxRead(buf, { type: 'buffer' });
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[HAV] File read attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

export async function syncHav(
  options: { uploadsOnly?: boolean } = {},
): Promise<SyncResult> {
  const { localHavFolder } = config;

  // A file uploaded through the UI wins over the shared folder: it is local,
  // always reachable, and was placed deliberately. Falling back to the share
  // keeps the original behaviour when nothing has been uploaded — EXCEPT under
  // uploadsOnly (triggered straight after an upload from the Sinkronisasi
  // page), where silently importing a stale shared workbook instead of the file
  // the user just picked would be the wrong answer entirely.
  const uploadsOnly = options.uploadsOnly === true;
  const uploaded = uploadedWorkbook('hav');
  const shareFile = uploadsOnly || !localHavFolder ? '' : join(localHavFolder, 'HAV.xlsx');
  const filePath = uploaded ?? shareFile;
  const fromUpload = Boolean(uploaded);

  if (!filePath) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message: uploadsOnly
        ? 'Tidak ada berkas HAV yang diunggah.'
        : 'Tidak ada sumber HAV: LOCAL_HAV_FOLDER belum diatur dan belum ada file yang diunggah.',
    };
  }

  console.log(`[SYNC] Starting HAV sync from ${filePath} (${fromUpload ? 'upload' : 'share'})`);

  let disconnectShare: (() => Promise<void>) | null = null;

  try {
    // Share auth/assertion only applies to the shared-folder path; an uploaded
    // file is local, so requiring share access would defeat the fallback.
    if (!fromUpload) {
      disconnectShare = await ensureNetworkShareAccess(filePath);
      assertPathAccessible(filePath, 'LOCAL_HAV_FOLDER');
    }

    // Copy the Excel file from network to temp location
    console.log(`[HAV] Copying file from network to temp location...`);

    // Read the Excel file from the network location
    const workbook = await readFileWithRetry(filePath);
    
    if (!workbook) {
      return { success: false, synced: 0, total: 0, message: 'Failed to read HAV.xlsx' };
    }

    const sheetName = 'ALL';
    
    if (!sheetName) {
      return { success: false, synced: 0, total: 0, message: 'No sheets found in HAV.xlsx' };
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = utils.sheet_to_json<HavRow>(sheet);

    if (rows.length === 0) {
      return { success: true, synced: 0, total: 0, message: 'No rows in HAV sheet' };
    }

    console.log(`[HAV] Fetched ${rows.length} rows from sheet: ${sheetName}`);

    // Normalize rows and extract quadrant
    const byNpk = new Map<string, { npk: string; nama: string; quadrant: string | null }>();
    for (const row of rows) {
      // Stored and matched in ONE spelling (npk.ts): "5123" and "05123" are one
      // person, as they are everywhere else that joins on LPAD(…, 5, '0').
      const npk = npkKey((row.NPK || '').toString());
      const nama = (row.NAMA || '').toString().trim();
      const quadrant = normalizeQuadrant(row.Quadrant);
      if (!npk || !quadrant) continue; // Only include rows with valid NPK
      // One row per person: two spellings of one NPK in a workbook would hit the
      // same key twice in one INSERT, which Postgres refuses. Last row wins, as
      // it did for an exact duplicate before.
      byNpk.set(npk, { npk, nama, quadrant });
    }
    const normalized = Array.from(byNpk.values());

      console.log("[HAV] NormalizedRow", normalized);
      

    // A changed quadrant is written onto candidates right away — on whatever
    // day the file arrives, not only on the Monday cron — timestamped, and
    // supersedes any OLDER Talent Mapping placement, inside the same
    // transaction (hav-supersede.ts).
    const BATCH = 500;
    let synced = 0;
    let added = 0;
    let updated = 0;
    let preserved = 0;
    let changed = 0;
    let applied: HavUploadApplyResult = { candidatesUpdated: 0, stamped: 0, placementsSuperseded: 0 };
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Which rows actually CHANGE a quadrant — read before the upsert overwrites
      // the evidence. Re-importing an identical workbook changes nothing.
      // An upload made in the app considers every row: a value equal to the old
      // sheet still counts when it differs from the candidate's HAV in force
      // (a placement, or a formula pinned by a PA/BA change — hav-order.ts).
      // The shared HAV.xlsx is re-read unchanged every week, so only its changes.
      const changes = await detectHavUploadChanges(client, normalized, { includeUnchanged: fromUpload });
      changed = changes.filter((c) => c.previous !== c.next).length;

      // UPDATE-ONLY, never replace: rows already in sync_hav are upserted by NPK
      // and nothing is ever deleted, so an employee missing from this workbook
      // keeps the quadrant a previous upload gave them. Counted before/after so
      // the run can SAY how many were carried over instead of leaving the user
      // to trust it.
      const beforeRow = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM sync_hav');
      const before = Number(beforeRow.rows[0]?.n ?? 0);

      // A row stored under ANOTHER spelling of an NPK in this workbook ("5123"
      // before normalisation) is the same person; replace it rather than keep
      // two rows for one employee. Counted before this, so the summary still
      // reads that person as updated, not added. Nobody absent from the
      // workbook is touched.
      await client.query(
        `DELETE FROM sync_hav
          WHERE ${npkKeySql('npk')} = ANY($1::text[])
            AND npk <> ALL($1::text[])`,
        [normalized.map((r) => r.npk)],
      );

      for (let i = 0; i < normalized.length; i += BATCH) {
        const batch = normalized.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;

        for (const r of batch) {
          placeholders.push(`($${idx++},$${idx++},$${idx++},NOW())`);
          values.push(r.npk, r.nama, r.quadrant);
        }

        await client.query(
          `INSERT INTO sync_hav (npk, nama, quadrant, synced_at)
           VALUES ${placeholders.join(',')}
           ON CONFLICT (npk) DO UPDATE SET
            nama = EXCLUDED.nama,
            quadrant = EXCLUDED.quadrant,
            synced_at = EXCLUDED.synced_at`,
          values
        );

        synced += batch.length;
      }

      const afterRow = await client.query<{ n: string }>('SELECT count(*)::int AS n FROM sync_hav');
      const after = Number(afterRow.rows[0]?.n ?? 0);
      added = after - before;
      updated = synced - added;
      preserved = before - updated;

      applied = await applyHavUploadChanges(client, changes, fromUpload ? 'hav_upload' : 'hav_folder');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    console.log(
      `[HAV] Sync complete – ${synced} upserted (${added} baru, ${updated} diperbarui, ` +
        `${preserved} record lama dipertahankan); ${changed} kuadran berubah → ` +
        `${applied.candidatesUpdated} kandidat diperbarui, ${applied.stamped} perubahan HAV otomatis dicatat, ` +
        `${applied.placementsSuperseded} penempatan manual yang lebih lama digantikan`,
    );
    // The uploaded workbook has been read into Postgres — consume it so the
    // next run doesn't silently re-import a stale copy that the user believes
    // they already replaced.
    const discarded = fromUpload ? discardUploaded([filePath]) : { removed: 0, failed: [] };
    const unknown = await unknownNpkWarning(normalized.map((r) => r.npk), 'HAV');

    return {
      success: true,
      ...(unknown ? { warnings: [unknown] } : {}),
      synced,
      total: normalized.length,
      message:
        `${synced} record HAV diproses (${added} baru, ${updated} diperbarui` +
        (preserved > 0 ? `, ${preserved} record lama dipertahankan` : '') +
        `). ${changed} kuadran berubah: ${applied.candidatesUpdated} kandidat langsung diperbarui` +
        (applied.stamped > 0 ? `, HAV ${applied.stamped} kandidat kini mengikuti upload` : '') +
        (applied.placementsSuperseded > 0
          ? `, ${applied.placementsSuperseded} penempatan manual Talent Mapping yang lebih lama digantikan (tercatat di riwayat)`
          : '') +
        discardSummary(discarded) +
        (unknown ? ` Peringatan: ${unknown}` : ''),
    };
  } catch (err) {
    console.error('[HAV] Sync failed:', err);
    return {
      success: false,
      synced: 0,
      total: 0,
      message: `HAV sync error: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    // Clean up temp file
    // try {
    //   await rm(tempFilePath, { force: true });
    // } catch (err) {
    //   console.warn('[HAV] Failed to clean up temp file:', err);
    // }

    if (disconnectShare) {
      try {
        await disconnectShare();
      } catch (err) {
        console.warn('[HAV] Failed to disconnect share:', err);
      }
    }
  }
}
