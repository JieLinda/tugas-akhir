import { queryDbMPMHRGA } from "../db/mssql.js";
import { pool } from "../db/postgres.js";
import {
  BEHAVIOR_HISTORY_DEPTH,
  buildBehaviorHistory,
  type BehaviorHistorySourceRow,
} from "./behavior-history.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import type { SyncResult } from "../types.js";

type BehaviorRow = {
  COMPANY_ID: string;
  EMPLOYEE_ID: string;
  REKOMENDASI_NAME: string | null;
  KETERANGAN: string | null;
  TGL_PELAKSANAAN: Date | null;
};

/**
 * Sync the latest behavior competency assessment per employee.
 *
 * Source (MSSQL):
 *   DVP_ASSESSMENT_CENTER_HDR   - assessment header per employee
 *   DVP_ASSESSMENT_CENTER_DTL   - assessment detail with TGL_PELAKSANAAN
 *   DVP_MASTER_REKOMENDASI      - master recommendation lookup
 *
 * We rank the detail rows by TGL_PELAKSANAAN DESC and pick the latest
 * per employee before joining the master recommendation. This mirrors
 * the source SQL provided by the user.
 */
export async function syncBehaviorCompetencies(companyIds: string[] | null = null): Promise<SyncResult> {
  try {
    const companyFilter = buildCompanyIdFilter("A.COMPANY_ID", companyIds);

    const rows = await queryDbMPMHRGA<BehaviorRow>(
      `WITH RankedDetail AS (
         SELECT *,
                ROW_NUMBER() OVER (
                  PARTITION BY COMPANY_ID, EMPLOYEE_ID
                  ORDER BY TGL_PELAKSANAAN DESC
                ) AS rn
         FROM DVP_ASSESSMENT_CENTER_DTL
       )
       SELECT DISTINCT A.COMPANY_ID,
              A.EMPLOYEE_ID,
              C.REKOMENDASI_NAME,
              B.KETERANGAN,
              B.TGL_PELAKSANAAN
         FROM DVP_ASSESSMENT_CENTER_HDR A
         LEFT JOIN RankedDetail B ON A.COMPANY_ID = B.COMPANY_ID AND A.EMPLOYEE_ID = B.EMPLOYEE_ID AND B.rn = 1
         LEFT JOIN DVP_MASTER_REKOMENDASI C ON B.REKOMENDASI_ID = C.REKOMENDASIID
         WHERE 1=1${companyFilter.sql}
         ORDER BY A.COMPANY_ID, A.EMPLOYEE_ID`,
      companyFilter.params,
    );

    if (rows.length === 0) {
      return { success: true, message: "Tidak ada data behavior competency ditemukan.", synced: 0, total: 0 };
    }

    // Deduplicate by (company_id, employee_id) — keep the first occurrence
    // in case the source query returns multiple rows for the same key.
    const seen = new Set<string>();
    const dedupedRows = rows.filter((r) => {
      const key = `${r.COMPANY_ID}|${r.EMPLOYEE_ID}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const BATCH = 500;
    let synced = 0;

    for (let i = 0; i < dedupedRows.length; i += BATCH) {
      const batch = dedupedRows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
        values.push(
          r.COMPANY_ID,
          r.EMPLOYEE_ID,
          r.REKOMENDASI_NAME ?? null,
          r.KETERANGAN ?? null,
          r.TGL_PELAKSANAAN ?? null,
          new Date(),
        );
      }

      const result = await pool.query(
        `INSERT INTO sync_behavior_competencies
           (company_id, employee_id, rekomendasi_name, keterangan, tgl_pelaksanaan, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (company_id, employee_id) DO UPDATE SET
           rekomendasi_name = EXCLUDED.rekomendasi_name,
           keterangan        = EXCLUDED.keterangan,
           tgl_pelaksanaan   = EXCLUDED.tgl_pelaksanaan,
           synced_at         = EXCLUDED.synced_at`,
        values,
      );
      synced += result.rowCount ?? 0;
    }

    // The history is a second, independent copy: its failure must never cost
    // the latest BA above, which is what the HAV formula and every filter read.
    const history = await syncBehaviorHistory(companyIds);

    return {
      success: true,
      synced,
      total: dedupedRows.length,
      message:
        `Sinkron ${synced} behavior competency berhasil.` +
        (history.error
          ? ` Riwayat BA tidak diperbarui: ${history.error}`
          : ` Riwayat BA: ${history.rows} asesmen untuk ${history.employees} karyawan (maks ${BEHAVIOR_HISTORY_DEPTH} terbaru per orang).`),
    };
  } catch (err) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message: `Gagal sinkron behavior competency: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * The newest BEHAVIOR_HISTORY_DEPTH assessment DATES per employee, from the same
 * MSSQL tables as the latest-BA query above, into sync_behavior_competency_history
 * (drizzle/0081) — the trajectory a reviewer reads in the Talent Mapping work
 * queue before placing somebody the HAV formula cannot place.
 *
 * DENSE_RANK over the date, not ROW_NUMBER: the detail table may hold more than
 * one row for one assessment, and ranking rows would let one event fill all
 * three slots. buildBehaviorHistory dedupes by date again in case it does.
 *
 * Per employee the stored rows are REPLACED (delete + insert in one
 * transaction), so a correction at the source does not leave a stale fourth
 * entry behind; employees the source no longer returns keep what they had.
 * Never throws: a missing table (drizzle/0081 not applied) or a source error is
 * reported in the sync message and the latest-BA sync stands.
 */
async function syncBehaviorHistory(
  companyIds: string[] | null,
): Promise<{ rows: number; employees: number; error: string | null }> {
  try {
    const companyFilter = buildCompanyIdFilter("A.COMPANY_ID", companyIds);
    const source = await queryDbMPMHRGA<BehaviorHistorySourceRow>(
      `WITH RankedDetail AS (
         SELECT COMPANY_ID, EMPLOYEE_ID, REKOMENDASI_ID, KETERANGAN, TGL_PELAKSANAAN,
                DENSE_RANK() OVER (
                  PARTITION BY COMPANY_ID, EMPLOYEE_ID
                  ORDER BY TGL_PELAKSANAAN DESC
                ) AS dr
           FROM DVP_ASSESSMENT_CENTER_DTL
          WHERE TGL_PELAKSANAAN IS NOT NULL
       )
       SELECT DISTINCT B.COMPANY_ID,
              B.EMPLOYEE_ID,
              C.REKOMENDASI_NAME,
              B.KETERANGAN,
              B.TGL_PELAKSANAAN
         FROM DVP_ASSESSMENT_CENTER_HDR A
         JOIN RankedDetail B ON A.COMPANY_ID = B.COMPANY_ID AND A.EMPLOYEE_ID = B.EMPLOYEE_ID
                            AND B.dr <= ${BEHAVIOR_HISTORY_DEPTH}
         LEFT JOIN DVP_MASTER_REKOMENDASI C ON B.REKOMENDASI_ID = C.REKOMENDASIID
         WHERE 1=1${companyFilter.sql}
         ORDER BY B.COMPANY_ID, B.EMPLOYEE_ID, B.TGL_PELAKSANAAN DESC`,
      companyFilter.params,
    );

    const history = buildBehaviorHistory(source);
    if (history.length === 0) return { rows: 0, employees: 0, error: null };

    const employees = new Map<string, { companyId: string; employeeId: string }>();
    for (const h of history) employees.set(`${h.companyId}|${h.employeeId}`, { companyId: h.companyId, employeeId: h.employeeId });
    const keys = Array.from(employees.values());

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM sync_behavior_competency_history h
          USING UNNEST($1::text[], $2::text[]) AS k(company_id, employee_id)
          WHERE h.company_id = k.company_id AND h.employee_id = k.employee_id`,
        [keys.map((k) => k.companyId), keys.map((k) => k.employeeId)],
      );
      const BATCH = 1000;
      for (let i = 0; i < history.length; i += BATCH) {
        const batch = history.slice(i, i + BATCH);
        await client.query(
          `INSERT INTO sync_behavior_competency_history
             (company_id, employee_id, rank, tgl_pelaksanaan, rekomendasi_name, keterangan, synced_at)
           SELECT v.company_id, v.employee_id, v.rank, v.tgl, v.label, v.note, now()
             FROM UNNEST($1::text[], $2::text[], $3::smallint[], $4::timestamptz[], $5::text[], $6::text[])
               AS v(company_id, employee_id, rank, tgl, label, note)
           ON CONFLICT (company_id, employee_id, tgl_pelaksanaan) DO UPDATE SET
             rank = EXCLUDED.rank,
             rekomendasi_name = EXCLUDED.rekomendasi_name,
             keterangan = EXCLUDED.keterangan,
             synced_at = EXCLUDED.synced_at`,
          [
            batch.map((h) => h.companyId),
            batch.map((h) => h.employeeId),
            batch.map((h) => h.rank),
            batch.map((h) => h.tglPelaksanaan),
            batch.map((h) => h.rekomendasiName),
            batch.map((h) => h.keterangan),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return { rows: history.length, employees: keys.length, error: null };
  } catch (err) {
    console.warn("[BEHAVIOR] history sync failed (the latest-BA sync is unaffected):", err);
    return { rows: 0, employees: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
