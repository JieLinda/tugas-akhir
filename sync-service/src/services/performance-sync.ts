import { queryDbMPMHRGA } from "../db/mssql.js";
import { pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";

type PerfRow = {
  COMPANY_ID: string;
  EMPLOYEE_ID: string;
  COMPANY_OFFICE: string | null;
  COST_CENTER: string | null;
  ORG_ID: string | null;
  POSITION_ID: string | null;
  GRADE_ID: string | null;
  SEQ: number | null;
  TAHUN: number | null;
  S1: string | null;
  S2: string | null;
  PROMOSI: string | null;
  IS_PRINT_REPORT: number | null;
  CREATE_BY: string | null;
  CREATE_DATE: Date | null;
  MODI_BY: string | null;
  MODI_DATE: Date | null;
};

export async function syncPerformance(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting performance appraisal sync from DB MPMHRGA${filterDesc}`);

  const rows = await queryDbMPMHRGA<PerfRow>(
    `SELECT
      COMPANY_ID, EMPLOYEE_ID, COMPANY_OFFICE, COST_CENTER, ORG_ID,
      POSITION_ID, GRADE_ID, SEQ, TAHUN, S1, S2, PROMOSI,
      IS_PRINT_REPORT, CREATE_BY, CREATE_DATE, MODI_BY, MODI_DATE
    FROM dbo.DVP_PA_HISTORY_DTL
    WHERE EMPLOYEE_ID IS NOT NULL${companyFilter.sql}
    ORDER BY EMPLOYEE_ID, TAHUN`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No performance records in DB MPMHRGA${filterDesc}`, synced: 0, total: 0 };
  }

  console.log(`[SYNC] Fetched ${rows.length} performance appraisal rows`);

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r.COMPANY_ID, String(r.EMPLOYEE_ID), r.COMPANY_OFFICE, r.COST_CENTER,
          r.ORG_ID, r.POSITION_ID, r.GRADE_ID, r.SEQ, r.TAHUN,
          r.S1, r.S2, r.PROMOSI, Boolean(r.IS_PRINT_REPORT),
          r.CREATE_BY, r.CREATE_DATE, r.MODI_BY, r.MODI_DATE
        );
      }

      await client.query(
        `INSERT INTO sync_performance_appraisals
          (company_id, employee_id, company_office, cost_center, org_id,
           position_id, grade_id, seq, tahun, s1, s2, promosi,
           is_print_report, create_by, create_date, modi_by, modi_date, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (company_id, employee_id, tahun, seq) DO UPDATE SET
          company_office = EXCLUDED.company_office,
          cost_center = EXCLUDED.cost_center,
          org_id = EXCLUDED.org_id,
          position_id = EXCLUDED.position_id,
          grade_id = EXCLUDED.grade_id,
          s1 = EXCLUDED.s1,
          s2 = EXCLUDED.s2,
          promosi = EXCLUDED.promosi,
          is_print_report = EXCLUDED.is_print_report,
          create_by = EXCLUDED.create_by,
          create_date = EXCLUDED.create_date,
          modi_by = EXCLUDED.modi_by,
          modi_date = EXCLUDED.modi_date,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      synced += batch.length;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`[SYNC] Performance sync complete – ${synced} upserted`);
  return { success: true, synced, total: rows.length, message: `Synced ${synced} performance appraisals${filterDesc}` };
}
