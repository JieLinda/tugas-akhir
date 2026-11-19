import { query as pgQuery, pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import { summarizeParts } from "./sync-summary.js";

export async function syncOrgStructure(companyIds: string[] | null = null): Promise<
  SyncResult & {
    divisions: SyncResult;
    departments: SyncResult;
  }
> {
  const divisions = await syncDivisions(companyIds);
  const departments = await syncDepartments(companyIds);
  // Envelope first, parts second: callers that check `success` and callers that
  // destructure `divisions`/`departments` both keep working.
  const parts = { divisions, departments };
  return { ...summarizeParts(parts), ...parts };
}

export async function syncDivisions(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("company_id", companyIds, { dialect: "pg" });
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Deriving divisions from sync_employees${filterDesc}`);

  const rows = await pgQuery<{ iddivision: string; division: string; company_id: string | null }>(
    `SELECT DISTINCT iddivision, division, company_id
     FROM sync_employees
     WHERE iddivision IS NOT NULL AND division IS NOT NULL${companyFilter.sql}
     ORDER BY division`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No divisions found (run employee sync first)${filterDesc}`, synced: 0, total: 0 };
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of rows) {
    placeholders.push(`($${idx++},$${idx++},$${idx++},NOW())`);
    values.push(r.iddivision, r.division, r.company_id);
  }

  await pool.query(
    `INSERT INTO sync_divisions (iddivision, division_name, company_id, synced_at)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (iddivision) DO UPDATE SET
       division_name = EXCLUDED.division_name,
       company_id    = EXCLUDED.company_id,
       synced_at     = EXCLUDED.synced_at`,
    values
  );

  console.log(`[SYNC] Divisions sync complete – ${rows.length} upserted`);
  return { success: true, synced: rows.length, total: rows.length, message: `Synced ${rows.length} divisions${filterDesc}` };
}

export async function syncDepartments(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("company_id", companyIds, { dialect: "pg" });
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Deriving departments from sync_employees${filterDesc}`);

  const rows = await pgQuery<{
    iddepartment: string;
    department: string;
    iddivision: string | null;
    company_id: string | null;
  }>(
    `SELECT DISTINCT iddepartment, department, iddivision, company_id
     FROM sync_employees
     WHERE iddepartment IS NOT NULL AND department IS NOT NULL${companyFilter.sql}
     ORDER BY department`,
    companyFilter.params,
  );

  if (rows.length === 0) {
    return { success: true, message: `No departments found (run employee sync first)${filterDesc}`, synced: 0, total: 0 };
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of rows) {
    placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},NOW())`);
    values.push(r.iddepartment, r.department, r.iddivision, r.company_id);
  }

  await pool.query(
    `INSERT INTO sync_departments (iddepartment, department_name, iddivision, company_id, synced_at)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (iddepartment) DO UPDATE SET
       department_name = EXCLUDED.department_name,
       iddivision      = EXCLUDED.iddivision,
       company_id      = EXCLUDED.company_id,
       synced_at       = EXCLUDED.synced_at`,
    values
  );

  console.log(`[SYNC] Departments sync complete – ${rows.length} upserted`);
  return { success: true, synced: rows.length, total: rows.length, message: `Synced ${rows.length} departments${filterDesc}` };
}
