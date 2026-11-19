import { createHash } from "node:crypto";
import { config } from "../config.js";
import { query as pgQuery, pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import { getApiToken, apiHeaders } from "./token.js";

type EducationRecord = {
  _companyId: string;
  _employeeId: string;
  _displayName: string | null;
  EducationLevel: string | null;
  EducationLevelRank: number | null;
  EducationField: string | null;
  InstitutionName: string | null;
  InstitutionLocation: string | null;
  StartYear: number | null;
  EndYear: number | null;
  GPA: number | null;
  Achievement: string | null;
  EducationNote: string | null;
};

/**
 * Deterministic key for one education entry. MUST stay byte-identical to the
 * backfill in drizzle/0043_sync_education_source_key.sql: parts joined with ':',
 * nulls as empty string, numbers as text, then md5.
 */
function educationSourceKey(r: EducationRecord): string {
  const parts = [
    r._companyId ?? "",
    r._employeeId ?? "",
    r.EducationLevel ?? "",
    r.EducationField ?? "",
    r.InstitutionName ?? "",
    r.StartYear == null ? "" : String(r.StartYear),
    r.EndYear == null ? "" : String(r.EndYear),
  ];
  return createHash("md5").update(parts.join(":")).digest("hex");
}

async function fetchEducation(
  token: string,
  companyId: string,
  employeeId: string
): Promise<EducationRecord[]> {
  const records: EducationRecord[] = [];
  let page = 1;
  const size = 50;

  while (true) {
    const url = new URL(`${config.api.baseUrl}/employeeV6/edp/EmployeeEducation`);
    url.searchParams.set("companyid", companyId);
    url.searchParams.set("employeeid", employeeId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(size));

    const resp = await fetch(url, { headers: apiHeaders(token) });
    if (!resp.ok) break;

    const body = (await resp.json()) as { Status: number; Data?: Array<{
      DisplayName?: string;
      Education?: Record<string, unknown>[];
    }> };

    if (body.Status !== 1 || !body.Data?.length) break;

    let itemCount = 0;
    for (const emp of body.Data) {
      for (const ed of emp.Education ?? []) {
        records.push({
          _companyId: companyId,
          _employeeId: employeeId,
          _displayName: emp.DisplayName ?? null,
          ...(ed as Omit<EducationRecord, "_companyId" | "_employeeId" | "_displayName">),
        });
        itemCount++;
      }
    }
    if (itemCount < size) break;
    page++;
  }

  return records;
}

export async function syncEducationForEmployee(
  companyId: string,
  employeeId: string
): Promise<SyncResult> {
  const token = await getApiToken();
  const records = await fetchEducation(token, companyId, employeeId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (records.length > 0) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      const keys: string[] = [];
      let idx = 1;

      // De-dupe within the payload first: two identical education entries would
      // otherwise collide on source_key inside a single INSERT ("ON CONFLICT DO
      // UPDATE command cannot affect row a second time").
      const seen = new Set<string>();
      for (const r of records) {
        const sourceKey = educationSourceKey(r);
        if (seen.has(sourceKey)) continue;
        seen.add(sourceKey);
        keys.push(sourceKey);

        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
        );
        values.push(
          r._companyId, r._employeeId, r._displayName,
          r.EducationLevel, r.EducationLevelRank, r.EducationField,
          r.InstitutionName, r.InstitutionLocation,
          r.StartYear, r.EndYear, r.GPA, r.Achievement, r.EducationNote,
          sourceKey
        );
      }

      await client.query(
        `INSERT INTO sync_education
          (company_id, employee_id, display_name,
           education_level, education_level_rank, education_field,
           institution_name, institution_location,
           start_year, end_year, gpa, achievement, education_note, source_key, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (source_key) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          education_level_rank = EXCLUDED.education_level_rank,
          institution_location = EXCLUDED.institution_location,
          gpa = EXCLUDED.gpa,
          achievement = EXCLUDED.achievement,
          education_note = EXCLUDED.education_note,
          synced_at = EXCLUDED.synced_at`,
        values
      );

      // Reconcile: drop rows this employee no longer has upstream. Scoped to the
      // employee and only when the payload is non-empty — see below.
      await client.query(
        `DELETE FROM sync_education
          WHERE company_id = $1 AND employee_id = $2
            AND (source_key IS NULL OR source_key <> ALL($3::text[]))`,
        [companyId, employeeId, keys]
      );
    } else {
      // Deliberately NO delete here. The old code removed all of an employee's
      // education whenever the API returned nothing, so one upstream hiccup
      // permanently destroyed data that feeds the education aspect score.
      // Keeping the existing rows is the safe failure mode.
      console.warn(
        `[EDUCATION] ${companyId}/${employeeId}: API returned 0 records — keeping existing rows`
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return {
    success: true, synced: records.length, total: records.length,
    message: `Synced ${records.length} education records for ${employeeId}`,
  };
}

export async function syncAllEducation(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("company_id", companyIds, { dialect: "pg" });
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  const employees = await pgQuery<{ company_id: string; employee_id: string }>(
    `SELECT company_id, employee_id FROM sync_employees WHERE 1=1${companyFilter.sql}`,
    companyFilter.params,
  );

  if (employees.length === 0) {
    return { success: true, message: `No employees to process – run employee sync first${filterDesc}`, synced: 0, total: 0 };
  }

  console.log(`[SYNC] Syncing education for ${employees.length} employees${filterDesc}`);
  let totalSynced = 0;
  let errors = 0;

  for (const { company_id, employee_id } of employees) {
    try {
      const res = await syncEducationForEmployee(company_id, employee_id);
      totalSynced += res.synced;
    } catch (err) {
      console.error(`[SYNC] Education failed for ${employee_id}:`, err);
      errors++;
    }
  }

  let msg = `Synced ${totalSynced} education records across ${employees.length} employees${filterDesc}`;
  if (errors) msg += ` (${errors} failures)`;

  return { success: errors === 0, synced: totalSynced, total: employees.length, message: msg };
}
