import { config } from "../config.js";
import { pool } from "../db/postgres.js";
import type { SyncResult } from "../types.js";
import { getApiToken, apiHeaders } from "./token.js";

/**
 * Employee personal information → candidate age.
 *
 * Same gateway and token as the disciplinary/education jobs, but a different
 * shape: `/employeeV1/employee/Information` LISTS employees page by page and
 * takes an optional `companyid`, so this pages through the source once instead
 * of issuing one request per employee.
 *
 * Only the birth date is kept. The endpoint also returns national ID, NPWP,
 * BPJS, phone and email; storing those would put identity documents into a
 * database that is joined, exported and fed to an LLM elsewhere in this app,
 * and nothing here would ever read them.
 */

type InformationRow = {
  CompanyId?: string | null;
  EmployeeId?: string | null;
  DisplayName?: string | null;
  BirthDate?: string | null;
};

type PersonalRecord = {
  companyId: string;
  employeeId: string;
  displayName: string | null;
  birthDate: string | null;
};

const PAGE_SIZE = 200;
/** Backstop against an endpoint that keeps answering with a full page. */
const MAX_PAGES = 2000;

/** "1990-12-06T00:00:00" → "1990-12-06"; anything unparseable → null. */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  // The upstream uses 9999-01-01 as "no end date" on other fields; a birth year
  // outside a plausible human range is data, not a birthday.
  const y = Number(year);
  if (y < 1900 || y > new Date().getUTCFullYear()) return null;
  return `${year}-${month}-${day}`;
}

/**
 * sync_employees stores ids unpadded ("7631"), while several sync tables use the
 * 5-char zero-padded form. Match sync_employees so candidate derivation can join
 * without padding gymnastics.
 */
function normalizeEmployeeId(raw: string): string {
  const str = String(raw ?? "").trim();
  return /^\d{5}$/.test(str) && str.startsWith("0") ? str.slice(1) : str;
}

async function fetchPersonalPage(
  token: string,
  companyId: string | null,
  page: number,
): Promise<InformationRow[]> {
  const url = new URL(`${config.api.baseUrl}/employeeV1/employee/Information`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(PAGE_SIZE));
  if (companyId) url.searchParams.set("companyid", companyId);

  const resp = await fetch(url, { headers: apiHeaders(token) });
  if (!resp.ok) {
    throw new Error(`Information request failed: ${resp.status} ${resp.statusText}`);
  }

  const body = (await resp.json()) as { Status?: number; Data?: InformationRow[] };
  if (body.Status !== 1 || !Array.isArray(body.Data)) return [];
  return body.Data;
}

async function fetchPersonal(companyId: string | null): Promise<PersonalRecord[]> {
  const token = await getApiToken();
  const out: PersonalRecord[] = [];
  // The endpoint has no total count, so the last page is recognised by being
  // short. Ids are de-duplicated because a paged source can repeat a row when
  // the underlying set shifts mid-scan.
  const seen = new Set<string>();

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await fetchPersonalPage(token, companyId, page);
    for (const row of rows) {
      const employeeId = normalizeEmployeeId(String(row.EmployeeId ?? ""));
      const rowCompanyId = String(row.CompanyId ?? companyId ?? "").trim();
      if (!employeeId || !rowCompanyId) continue;
      const key = `${rowCompanyId}:${employeeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        companyId: rowCompanyId,
        employeeId,
        displayName: row.DisplayName?.trim() || null,
        birthDate: toIsoDate(row.BirthDate),
      });
    }
    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) {
      console.warn(`[PERSONAL] Stopped at the ${MAX_PAGES}-page cap — source may have more rows`);
    }
  }

  return out;
}

async function upsertPersonal(records: PersonalRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const client = await pool.connect();
  let written = 0;
  try {
    await client.query("BEGIN");
    const BATCH = 500;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let idx = 1;
      for (const r of batch) {
        placeholders.push(`($${idx++},$${idx++},$${idx++},$${idx++},NOW())`);
        values.push(r.companyId, r.employeeId, r.displayName, r.birthDate);
      }
      const res = await client.query(
        `INSERT INTO sync_employee_personal
           (company_id, employee_id, display_name, birth_date, synced_at)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (company_id, employee_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           -- Never overwrite a known birth date with NULL: an upstream row that
           -- temporarily comes back blank would otherwise erase the age of
           -- everyone it touched, and this job is what the weekly cron runs.
           birth_date = COALESCE(EXCLUDED.birth_date, sync_employee_personal.birth_date),
           synced_at = EXCLUDED.synced_at`,
        values,
      );
      written += res.rowCount ?? 0;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return written;
}

/**
 * Sync personal information for the given companies, or for every company the
 * endpoint returns when `companyIds` is null.
 */
export async function syncAllEmployeePersonal(
  companyIds: string[] | null = null,
): Promise<SyncResult> {
  const filterDesc =
    companyIds && companyIds.length > 0 ? ` [companyIds=${companyIds.join(",")}]` : "";
  console.log(`[SYNC] Starting employee personal-information sync${filterDesc}`);

  const targets: (string | null)[] =
    companyIds && companyIds.length > 0 ? companyIds : [null];

  const records: PersonalRecord[] = [];
  const errors: string[] = [];
  for (const companyId of targets) {
    try {
      const rows = await fetchPersonal(companyId);
      records.push(...rows);
      console.log(`[PERSONAL] ${companyId ?? "(all companies)"} → ${rows.length} row(s)`);
    } catch (err) {
      console.error(`[PERSONAL] Fetch failed for ${companyId ?? "(all companies)"}:`, err);
      errors.push(companyId ?? "all");
    }
  }

  if (records.length === 0) {
    // Deliberately no delete: an upstream hiccup must not wipe the birth dates
    // that candidate ages are derived from.
    const message =
      errors.length > 0
        ? `Employee personal-information sync failed for ${errors.join(", ")} — existing rows kept${filterDesc}`
        : `API returned 0 personal-information records — existing rows kept${filterDesc}`;
    console.warn(`[PERSONAL] ${message}`);
    return { success: errors.length === 0, synced: 0, total: 0, message };
  }

  const written = await upsertPersonal(records);
  const withBirthDate = records.filter((r) => r.birthDate).length;

  let message =
    `Synced ${written} personal-information rows ` +
    `(${withBirthDate} with a birth date)${filterDesc}`;
  if (errors.length) message += ` — failed for ${errors.join(", ")}`;

  return {
    success: errors.length === 0,
    synced: written,
    total: records.length,
    message,
  };
}

/** Single-employee refresh, mirroring the other API-backed jobs' per-employee route. */
export async function syncEmployeePersonalForEmployee(
  companyId: string,
  employeeId: string,
): Promise<SyncResult> {
  const token = await getApiToken();
  const url = new URL(`${config.api.baseUrl}/employeeV1/employee/Information`);
  url.searchParams.set("page", "1");
  url.searchParams.set("size", "20");
  url.searchParams.set("employeeid", employeeId);
  if (companyId) url.searchParams.set("companyid", companyId);

  const resp = await fetch(url, { headers: apiHeaders(token) });
  if (!resp.ok) {
    throw new Error(`Information request failed: ${resp.status} ${resp.statusText}`);
  }
  const body = (await resp.json()) as { Status?: number; Data?: InformationRow[] };
  const rows = body.Status === 1 && Array.isArray(body.Data) ? body.Data : [];

  const records: PersonalRecord[] = rows
    .map((row) => ({
      companyId: String(row.CompanyId ?? companyId ?? "").trim(),
      employeeId: normalizeEmployeeId(String(row.EmployeeId ?? employeeId)),
      displayName: row.DisplayName?.trim() || null,
      birthDate: toIsoDate(row.BirthDate),
    }))
    .filter((r) => r.companyId && r.employeeId);

  if (records.length === 0) {
    return {
      success: true,
      synced: 0,
      total: 0,
      message: `No personal information for ${employeeId} — existing row kept`,
    };
  }

  const written = await upsertPersonal(records);
  return {
    success: true,
    synced: written,
    total: records.length,
    message: `Synced personal information for ${employeeId}`,
  };
}
