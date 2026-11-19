import { config } from "../config.js";
import { query as pgQuery, pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { buildCompanyIdFilter } from "./sync-helpers.js";
import { getApiToken, apiHeaders } from "./token.js";

type DisciplinaryRecord = {
  _companyId: string;
  _employeeId: string;
  _displayName: string | null;
  DisciplinaryNo: number;
  IncidentDate: string | null;
  Violation: string | null;
  ViolationDegree: number | null;
  ViolationType: number | null;
  WarningLevel: number | null;
  EffectViolation: string | null;
  AdviceGiven: string | null;
  SanctionGiven: string | null;
  LetterNo: string | null;
  DateIssue: string | null;
  ExpiryDate: string | null;
  DisciplinaryNote: string | null;
};

async function fetchDisciplinary(
  token: string,
  companyId: string,
  employeeId: string
): Promise<DisciplinaryRecord[]> {
  const records: DisciplinaryRecord[] = [];
  let page = 1;
  const size = 50;

  while (true) {
    const url = new URL(`${config.api.baseUrl}/employeeV6/edp/EmployeeDisciplinary`);
    url.searchParams.set("companyid", companyId);
    url.searchParams.set("employeeid", employeeId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("size", String(size));

    const resp = await fetch(url, { headers: apiHeaders(token) });
    if (!resp.ok) break;

    const body = (await resp.json()) as { Status: number; Data?: Array<{
      DisplayName?: string;
      Disciplinary?: Record<string, unknown>[];
    }> };

    if (body.Status !== 1 || !body.Data?.length) break;

    let itemCount = 0;
    for (const emp of body.Data) {
      for (const d of emp.Disciplinary ?? []) {
        records.push({
          _companyId: companyId,
          _employeeId: employeeId,
          _displayName: emp.DisplayName ?? null,
          ...(d as Omit<DisciplinaryRecord, "_companyId" | "_employeeId" | "_displayName">),
        });
        itemCount++;
      }
    }
    if (itemCount < size) break;
    page++;
  }

  return records;
}

export async function syncDisciplinaryForEmployee(
  companyId: string,
  employeeId: string
): Promise<SyncResult> {
  const token = await getApiToken();
  const records = await fetchDisciplinary(token, companyId, employeeId);

  if (records.length === 0) {
    return { success: true, message: `No disciplinary records for ${employeeId}`, synced: 0, total: 0 };
  }

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const r of records) {
    placeholders.push(
      `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},NOW())`
    );
    values.push(
      r._companyId, r._employeeId, r._displayName,
      r.DisciplinaryNo, r.IncidentDate, r.Violation,
      r.ViolationDegree, r.ViolationType, r.WarningLevel,
      r.EffectViolation, r.AdviceGiven, r.SanctionGiven,
      r.LetterNo, r.DateIssue, r.ExpiryDate, r.DisciplinaryNote
    );
  }

  await pool.query(
    `INSERT INTO sync_disciplinary
      (company_id, employee_id, display_name,
       disciplinary_no, incident_date, violation,
       violation_degree, violation_type, warning_level,
       effect_violation, advice_given, sanction_given,
       letter_no, date_issue, expiry_date, disciplinary_note, synced_at)
     VALUES ${placeholders.join(",")}
     ON CONFLICT (company_id, employee_id, disciplinary_no) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      incident_date = EXCLUDED.incident_date,
      violation = EXCLUDED.violation,
      violation_degree = EXCLUDED.violation_degree,
      violation_type = EXCLUDED.violation_type,
      warning_level = EXCLUDED.warning_level,
      effect_violation = EXCLUDED.effect_violation,
      advice_given = EXCLUDED.advice_given,
      sanction_given = EXCLUDED.sanction_given,
      letter_no = EXCLUDED.letter_no,
      date_issue = EXCLUDED.date_issue,
      expiry_date = EXCLUDED.expiry_date,
      disciplinary_note = EXCLUDED.disciplinary_note,
      synced_at = EXCLUDED.synced_at`,
    values
  );

  return {
    success: true, synced: records.length, total: records.length,
    message: `Synced ${records.length} disciplinary records for ${employeeId}`,
  };
}

export async function syncAllDisciplinary(companyIds: string[] | null = null): Promise<SyncResult> {
  const companyFilter = buildCompanyIdFilter("company_id", companyIds, { dialect: "pg" });
  const filterDesc = companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  const employees = await pgQuery<{ company_id: string; employee_id: string }>(
    `SELECT company_id, employee_id FROM sync_employees WHERE 1=1${companyFilter.sql}`,
    companyFilter.params,
  );

  if (employees.length === 0) {
    return { success: true, message: `No employees to process – run employee sync first${filterDesc}`, synced: 0, total: 0 };
  }

  console.log(`[SYNC] Syncing disciplinary for ${employees.length} employees${filterDesc}`);
  let totalSynced = 0;
  let errors = 0;

  for (const { company_id, employee_id } of employees) {
    try {
      const res = await syncDisciplinaryForEmployee(company_id, employee_id);
      totalSynced += res.synced;
    } catch (err) {
      console.error(`[SYNC] Disciplinary failed for ${employee_id}:`, err);
      errors++;
    }
  }

  let msg = `Synced ${totalSynced} disciplinary records across ${employees.length} employees${filterDesc}`;
  if (errors) msg += ` (${errors} failures)`;

  return { success: errors === 0, synced: totalSynced, total: employees.length, message: msg };
}
