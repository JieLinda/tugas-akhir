import { queryDbMPMDS, queryDbMPMHRGA } from "../db/mssql.js";
import { pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";

type EmployeeRow = {
  COMPANY_ID: string | null;
  EMPLOYEE_ID: string;
  DISPLAY_NAME: string | null;
  GRADE_ID: string | null;
  INTERNAL_TITLE: string | null;
  COMPANY_OFFICE: string | null;
  iddivision: string | null;
  division: string | null;
  iddepartment: string | null;
  department: string | null;
  ISBRANCHHEAD: number;
  ISAFC: number;
  ISHOMSO: number;
  ENTRY_DATE: Date | null;
};

export async function syncEmployees(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("COMPANY_ID", companyIds);
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting employee sync from MPMDS + DVP sources${filterDesc}`);

  // Fetch primary authoritative DVP_PERSON_CURRENT rows (5-digit employee ids)
  let dvpRows: EmployeeRow[] = [];
  try {
    dvpRows = await queryDbMPMHRGA<EmployeeRow>(
      `SELECT
        COMPANY_ID, EMPLOYEE_ID, ENTRY_DATE
      FROM DVP_PERSON_CURRENT
      WHERE EMPLOYEE_ID IS NOT NULL AND IS_ACTIVE = 1${companyFilter.sql}
      ORDER BY EMPLOYEE_ID`,
      companyFilter.params,
    );
    // throw new Error("Simulated DVP failure"); // TESTING ONLY – remove this line to enable DVP fetching
  } catch (err) {
    // DVP source may not be available on some environments; fall back to MPMDS only
    console.warn(
      "[SYNC] DVP_PERSON_CURRENT not available, falling back to MPMDS only",
    );
    dvpRows = [];
  }

  // Fetch fallback MPMDS_ORANGE_DATA rows (may contain 4-digit employee ids)
  const mpmRows = await queryDbMPMDS<EmployeeRow>(
    `SELECT
      COMPANY_ID, EMPLOYEE_ID, DISPLAY_NAME, GRADE_ID, INTERNAL_TITLE, COMPANY_OFFICE,
      iddivision, division, iddepartment, department,
      ISBRANCHHEAD, ISAFC, ISHOMSO, NULL as ENTRY_DATE
    FROM dbo.MPMDS_ORANGE_DATA
    WHERE EMPLOYEE_ID IS NOT NULL${companyFilter.sql}
    ORDER BY EMPLOYEE_ID`,
    companyFilter.params,
  );

  // Normalize and merge: prefer DVP entries when present, otherwise use MPMDS
  const seen = new Map<string, EmployeeRow>();

  // Helper to normalize employee id to 5 chars with leading zeros
  const normalizeId = (id: unknown) => {
    const str = String(id ?? "");
    return /^\d{5}$/.test(str) && str.startsWith("0") ? str.slice(1) : str;
  };

  for (const r of mpmRows) {
    const key = normalizeId(r.EMPLOYEE_ID);

    seen.set(key, {
      ...r,
      EMPLOYEE_ID: key,
    });
  }

  for (const r of dvpRows) {
    const key = normalizeId(r.EMPLOYEE_ID);
    const existing = seen.get(key);

    if (existing) {
      seen.set(key, {
        ...existing,
        ENTRY_DATE: r.ENTRY_DATE,
      });
    }
  }

  const unique = Array.from(seen.values());
  console.log(
    `[SYNC] Fetched ${mpmRows.length + dvpRows.length} rows, ${unique.length} unique employees`,
  );
  if (unique.length === 0) {
    return {
      success: true,
      message: "No employees found in sources",
      synced: 0,
      total: 0,
    };
  }

  const BATCH = 500;
  let synced = 0;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (let i = 0; i < unique.length; i += BATCH) {
      const batch = unique.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;

      for (const r of batch) {
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`,
        );
        values.push(
          r.COMPANY_ID,
          String(r.EMPLOYEE_ID),
          r.DISPLAY_NAME,
          r.GRADE_ID,
          r.INTERNAL_TITLE,
          r.COMPANY_OFFICE,
          r.iddivision,
          r.division,
          r.iddepartment,
          r.department,
          Boolean(r.ISBRANCHHEAD),
          Boolean(r.ISAFC),
          Boolean(r.ISHOMSO),
          r.ENTRY_DATE
            ? new Date(r.ENTRY_DATE).toISOString().split("T")[0]
            : null,
        );
      }

      await client.query(
        `INSERT INTO sync_employees
          (company_id, employee_id, display_name, grade_id, internal_title, company_office,
           iddivision, division, iddepartment, department,
           is_branch_head, is_afc, is_homso, entry_date, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (employee_id) DO UPDATE SET
          company_id     = EXCLUDED.company_id,
          display_name   = EXCLUDED.display_name,
          grade_id       = EXCLUDED.grade_id,
          internal_title = EXCLUDED.internal_title,
          company_office = EXCLUDED.company_office,
          iddivision     = EXCLUDED.iddivision,
          division       = EXCLUDED.division,
          iddepartment   = EXCLUDED.iddepartment,
          department     = EXCLUDED.department,
          is_branch_head = EXCLUDED.is_branch_head,
          is_afc         = EXCLUDED.is_afc,
          is_homso       = EXCLUDED.is_homso,
          entry_date     = EXCLUDED.entry_date,
          synced_at      = EXCLUDED.synced_at`,
        values,
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

  console.log(`[SYNC] Employee sync complete – ${synced} upserted`);
  return {
    success: true,
    synced,
    total: unique.length,
    message: `Synced ${synced} employees${filterDesc}`,
  };
}
