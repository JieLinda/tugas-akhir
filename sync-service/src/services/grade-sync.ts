import { queryDbMPMHRGA } from "../db/mssql.js";
import { pool } from "../db/postgres.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import type { SyncResult } from "../types.js";

type GradeRow = {
  COMPANY_ID: string;
  LEVEL_ID: string;
  LEVEL_NAME: string | null;
  GRADE_ID: string;
};

/**
 * Sync grade levels from MPMHRGA behaviour competency master tables.
 *
 * Source:
 *   DVP_MASTER_BEHAVIOUR_COMPETENCY_HDR  (level header)
 *   DVP_MASTER_BEHAVIOUR_COMPETENCY_GRD_DTL (grade detail per level)
 */
export async function syncGradeLevels(companyIds: string[] | null = null): Promise<SyncResult> {
  try {
    const companyFilter = buildCompanyIdFilter("A.COMPANY_ID", companyIds);

    const rows = await queryDbMPMHRGA<GradeRow>(
      `SELECT DISTINCT A.COMPANY_ID, A.LEVEL_ID, A.LEVEL_NAME, B.GRADE_ID
       FROM DVP_MASTER_BEHAVIOUR_COMPETENCY_HDR A
       LEFT JOIN DVP_MASTER_BEHAVIOUR_COMPETENCY_GRD_DTL B
         ON A.LEVEL_ID = B.LEVEL_ID
        AND A.COMPANY_ID = B.COMPANY_ID
       WHERE B.GRADE_ID IS NOT NULL${companyFilter.sql}
       ORDER BY A.COMPANY_ID, A.LEVEL_ID, B.GRADE_ID`,
      companyFilter.params,
    );

    if (rows.length === 0) {
      return { success: true, message: "Tidak ada data grade level ditemukan.", synced: 0, total: 0 };
    }

    const BATCH = 500;
    let synced = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
        values.push(r.COMPANY_ID, r.LEVEL_ID, r.LEVEL_NAME ?? null, r.GRADE_ID, new Date());
      }

      const result = await pool.query(
        `INSERT INTO sync_grade_levels (company_id, level_id, level_name, grade_id, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (company_id, level_id, grade_id) DO UPDATE SET
           level_name = EXCLUDED.level_name,
           synced_at = EXCLUDED.synced_at`,
        values,
      );
      synced += result.rowCount ?? 0;
    }

    return {
      success: true,
      synced,
      total: rows.length,
      message: `Sinkron ${synced} grade level berhasil.`,
    };
  } catch (err) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message: `Gagal sinkron grade level: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
