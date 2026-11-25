import { config } from "../config.js";
import { query as pgQuery, execute, pool } from "../db/postgres.js";
import {
  canonicalHavQuadrant,
  loadPriorHavInputs,
  recordAutomaticHavChanges,
  type AutomaticHavChange,
  type HavAutoChangeOrigin,
} from "./hav-supersede.js";
import { candidateSyncHavEvent } from "./hav-order.js";
import { npkKeySql } from "./npk.js";
import { DISCIPLINE_STATUS_SQL } from "./discipline-status.js";
import type { SyncResult } from "../types.js";

// "Sync-service … mengonsolidasikan data menjadi objek kandidat 

// SQL to derive candidate data for a specific company
// tabel sync_* → 1 
/** Stored text form of a derived value: empty or missing → NULL. */
function textOrNull(value: string | number | null | undefined): string | null {
  return value == null || value === "" ? null : String(value);
}


const DERIVE_SQL = `
  WITH
  latest_perf AS (
    SELECT
      employee_id,
      CONCAT(
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 THEN s2 END), ''), ',',
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 THEN s1 END), ''), ',',
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 2 THEN s2 END), ''), ',',
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 2 THEN s1 END), ''), ',',
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 3 THEN s2 END), ''), ',',
        COALESCE(MAX(CASE WHEN tahun = EXTRACT(YEAR FROM CURRENT_DATE)::int - 3 THEN s1 END), '')
      ) AS performance_grade
    FROM sync_performance_appraisals
    WHERE company_id = $1
    GROUP BY employee_id
  ),
  -- Disciplinary, education and personal data are keyed by the NORMALISED NPK
  -- (npk.ts), like HAV and MCU below. These tables store the spelling Data
  -- Karyawan holds, but a row uploaded BEFORE the employee existed keeps the
  -- spelling it was typed with ("370" vs "0370"), and an exact join would never
  -- connect it. Grouping by the key also folds two spellings of one person.
  disc_status AS (
      SELECT
          ${npkKeySql("employee_id")} AS npk_key,
          ${DISCIPLINE_STATUS_SQL} AS discipline_status
      FROM sync_disciplinary
      WHERE company_id = $1
      GROUP BY ${npkKeySql("employee_id")}
  ),
  top_edu AS (
    SELECT DISTINCT ON (${npkKeySql("employee_id")})
      ${npkKeySql("employee_id")} AS npk_key, education_level, education_field
    FROM sync_education
    WHERE education_level_rank IS NOT NULL AND company_id = $1
    ORDER BY ${npkKeySql("employee_id")}, education_level_rank DESC
  ),
  personal_by_npk AS (
    SELECT DISTINCT ON (${npkKeySql("employee_id")}) ${npkKeySql("employee_id")} AS npk_key, birth_date
    FROM sync_employee_personal
    WHERE company_id = $1
    ORDER BY ${npkKeySql("employee_id")}, synced_at DESC NULLS LAST, id DESC
  ),
  -- HAV keyed by the normalised NPK (npk.ts), so "5123" and "05123" are one
  -- person — the same identity applyHavUploadChanges matches on. Newest row
  -- wins if both spellings were ever stored.
  hav_by_npk AS (
    SELECT DISTINCT ON (${npkKeySql("npk")}) ${npkKeySql("npk")} AS npk_key, quadrant
    FROM sync_hav
    ORDER BY ${npkKeySql("npk")}, synced_at DESC NULLS LAST, id DESC
  ),
  -- MCU keyed the same way as HAV above; newest row wins if both spellings exist.
  mcu_by_npk AS (
    SELECT DISTINCT ON (${npkKeySql("npk")}) ${npkKeySql("npk")} AS npk_key, status, kesimpulan_raw, keterangan
    FROM sync_mcu
    ORDER BY ${npkKeySql("npk")}, synced_at DESC NULLS LAST, id DESC
  ),
  derived AS (
    SELECT DISTINCT ON (e.employee_id)
      e.employee_id,
      COALESCE(e.display_name, 'Unknown') AS name,
      COALESCE(ds.discipline_status, 'CLEAR') AS discipline_status,
      lp.performance_grade,
      te.education_level AS education,
      te.education_field AS major,
      COALESCE(p.internal_title, p.external_title, p.position_id) AS current_position,
      e.department,
      e.division,
      e.grade_id AS grade,
      CASE
        WHEN e.entry_date IS NOT NULL THEN FLOOR(EXTRACT(DAY FROM (NOW() - e.entry_date)) / 365.25)::int
        ELSE NULL
      END AS years_of_service,
      -- Canonicalize HAV to its quadrant number: sync_hav may hold legacy
      -- descriptive forms ("Kuadran #6") as well as plain numbers ("6"); extract
      -- the first digit run so candidates always store "1".."16".
      NULLIF(substring(h.quadrant FROM '[0-9]+'), '') AS hav_quadrant,
      COALESCE(m.status, 'fit') AS mcu_status,
      -- The medical prose behind that one-word status. Kesimpulan first (it is
      -- the required column and where operators already write the detail), the
      -- dedicated Keterangan column as the longer-form alternative; joined when
      -- both carry something, since they are two different sentences about the
      -- same finding rather than duplicates.
      NULLIF(
        concat_ws(' — ', NULLIF(btrim(m.kesimpulan_raw), ''), NULLIF(btrim(m.keterangan), '')),
        ''
      ) AS mcu_note,
      bc.rekomendasi_name AS behavior_recommendation,
      bc.keterangan AS behavior_notes,
      -- Birth date, not age: age is derived at render time so it never goes
      -- stale between syncs. Formatted here because the candidate column is
      -- text, not a date.
      to_char(pi.birth_date, 'YYYY-MM-DD') AS birth_date,
      CONCAT('https://hr.mpm-motor.com/MPM/uploaded/EmployeePersonalInfo/', e.employee_id, '.jpg') AS photo_url
    FROM sync_employees e
    INNER JOIN sync_employee_positions sep ON sep.employee_id = LPAD(e.employee_id::text, 5, '0') AND sep.company_id = e.company_id
    INNER JOIN sync_positions p ON p.position_id = sep.position_id AND p.company_id = sep.company_id
    LEFT JOIN disc_status   ds ON ds.npk_key = ${npkKeySql("e.employee_id")}
    -- latest_perf is already restricted to company $1 (as e is), so NPK alone joins it.
    LEFT JOIN latest_perf   lp ON lp.employee_id = LPAD(e.employee_id::text, 5, '0')
    LEFT JOIN top_edu       te ON te.npk_key = ${npkKeySql("e.employee_id")}
    LEFT JOIN hav_by_npk    h ON h.npk_key = ${npkKeySql("e.employee_id")}
    LEFT JOIN mcu_by_npk    m ON m.npk_key = ${npkKeySql("e.employee_id")}
    LEFT JOIN sync_behavior_competencies bc ON bc.company_id = e.company_id AND bc.employee_id = LPAD(e.employee_id::text, 5, '0')
    LEFT JOIN personal_by_npk pi ON pi.npk_key = ${npkKeySql("e.employee_id")}
    WHERE e.company_id = $1
      AND sep.primary_position = true
      AND (sep.valid_from <= NOW() OR sep.valid_from IS NULL) AND (sep.valid_to IS NULL OR sep.valid_to >= NOW())
      AND (p.valid_from <= NOW() OR p.valid_from IS NULL) AND (p.valid_to IS NULL OR p.valid_to >= NOW())
    ORDER BY e.employee_id, sep.valid_from DESC
  )
  SELECT
    d.employee_id, d.name, d.grade,
    d.discipline_status, d.performance_grade, d.education, d.major,
    d.mcu_status, d.behavior_recommendation, d.behavior_notes,
    d.photo_url,
    d.current_position, d.department, d.division,
    d.years_of_service, d.hav_quadrant, d.birth_date
  FROM derived d
`;

type DerivedCandidate = {
  employee_id: string;
  name: string;
  grade: string | null;
  discipline_status: string;
  performance_grade: string | null;
  education: string | null;
  major: string | null;
  mcu_status: string;
  mcu_note: string | null;
  behavior_recommendation: string | null;
  behavior_notes: string | null;
  photo_url: string | null;
  current_position: string;
  department: string | null;
  division: string | null;
  years_of_service: number | null;
  hav_quadrant: string | null;
  birth_date: string | null;
};

// Insert columns (order matters — must match the value order in
// populateCandidates). `id` is gen_random_uuid() per row: on conflict the
// existing uuid is preserved, so resyncs never mint a new identity for an NPK.
const CANDIDATE_INSERT_COLUMNS = `
  (id, tenant_id, employee_id, name, grade,
   discipline_status, performance_grade, education, major,
   mcu_status, mcu_note, behavior_recommendation, behavior_notes,
   photo_url, current_position, department, division,
   years_experience, hav_quadrant, birth_date,
   created_by, created_at, updated_at)
`;

/** Bound parameters per candidate row — every column above except the
 *  gen_random_uuid() id. Keep in step with the values pushed below. */
const CANDIDATE_VALUES_PER_ROW = 22;

const CANDIDATE_ON_CONFLICT = `
  ON CONFLICT (tenant_id, employee_id) DO UPDATE SET
    name              = EXCLUDED.name,
    discipline_status = EXCLUDED.discipline_status,
    performance_grade = EXCLUDED.performance_grade,
    education         = EXCLUDED.education,
    major             = EXCLUDED.major,
    grade             = EXCLUDED.grade,
    photo_url         = EXCLUDED.photo_url,
    current_position  = EXCLUDED.current_position,
    department        = EXCLUDED.department,
    division          = EXCLUDED.division,
    years_experience  = EXCLUDED.years_experience,
    -- COALESCE: sync_hav is update-only, so "no row for this NPK" means no HAV
    -- statement, not "the HAV was withdrawn" — the same reading as birth_date
    -- below. Without it a clean sync (which empties sync_hav and does not
    -- re-run the HAV job) blanked every candidate's HAV until the next HAV
    -- upload, and HR's rule is that somebody a sync does not update keeps what
    -- they had. hav-supersede.ts computes "what changed" under this same rule.
    hav_quadrant      = COALESCE(EXCLUDED.hav_quadrant, candidates.hav_quadrant),
    -- Keep a known birth date when the source has none, so a candidate's age
    -- does not disappear because the personal-info job had a bad run.
    birth_date        = COALESCE(EXCLUDED.birth_date, candidates.birth_date),
    mcu_status        = EXCLUDED.mcu_status,
    -- COALESCE for the same reason as birth_date above: this runs unattended,
    -- and a workbook without the note column must not wipe every note.
    -- mcu_note_manual is deliberately ABSENT from this statement: it is the
    -- human-entered value and the sync never touches it.
    mcu_note          = COALESCE(EXCLUDED.mcu_note, candidates.mcu_note),
    behavior_recommendation = EXCLUDED.behavior_recommendation,
    behavior_notes          = EXCLUDED.behavior_notes,
    updated_at        = EXCLUDED.updated_at,
    -- Resurrect rows that were cleared in bulk, leave individually-deleted ones
    -- alone.
    --
    -- The whole point of the bulk clear on the Sinkronisasi page is "empty the
    -- pool, fix the source data, re-import" — so this sync is what brings those
    -- people back, and because the row was never physically deleted they return
    -- with the SAME uuid. Every analysis_results / position_picks row and
    -- every candidate id sitting in a tournament_sessions jsonb pool
    -- therefore stays valid.
    --
    -- A 'manual' delete is a decision about one person ("they don't belong in
    -- this pool"). Clearing it here would mean the Monday 01:00 cron silently
    -- overturns that decision every week.
    deleted_at   = CASE WHEN candidates.deleted_mode = 'manual' THEN candidates.deleted_at ELSE NULL END,
    deleted_by   = CASE WHEN candidates.deleted_mode = 'manual' THEN candidates.deleted_by ELSE NULL END,
    deleted_mode = CASE WHEN candidates.deleted_mode = 'manual' THEN candidates.deleted_mode ELSE NULL END
`;

type MappingRow = { company_id: string; tenant_id: string };

/**
 * For every candidate belonging to the given tenant, upsert one row into
 * `candidate_position_history` per `sync_employee_positions ⋈ sync_positions`
 * record. `source_key` from `sync_employee_positions` is reused as the
 * stable dedup key (composed with `candidate_id`).
 */
async function populateCandidatePositionHistory(tenant_id: string, now: Date): Promise<number> {
  type HistoryRow = {
    company_id: string;
    employee_id: string;
    sync_employee_position_id: number;
    position_id: string;
    internal_title: string | null;
    external_title: string | null;
    summary: string | null;
    grade_id: string | null;
    primary_position: boolean | null;
    valid_from: Date | null;
    valid_to: Date | null;
    source_key: string;
  };

  // Soft-deleted candidates are skipped: rewriting the position history of a
  // tombstoned person every week costs work and produces rows nothing reads.
  // A bulk-cleared candidate is resurrected by the upsert ABOVE, which runs
  // first, so they are live again by the time this query runs — only
  // deliberately-deleted people are excluded here.
  const candidateRows = await pgQuery<{ id: string; employee_id: string }>(
    `SELECT id, employee_id FROM candidates WHERE tenant_id = $1 AND deleted_at IS NULL`,
    [tenant_id],
  );
  if (candidateRows.length === 0) return 0;

  const employeeIds = candidateRows
    .map((c) => c.employee_id)
    .filter((id): id is string => !!id)
    .map((id) => id.padStart(5, "0")); // sync_employee_positions.employee_id is zero-padded to 5 chars
  if (employeeIds.length === 0) return 0;

  const employeeIdToCandidateId = new Map<string, string>();
  for (const c of candidateRows) {
    if (c.employee_id) employeeIdToCandidateId.set(c.employee_id.padStart(5, "0"), c.id);
  }

  const mappingRows = await pgQuery<{ company_id: string }>(
    `SELECT company_id FROM sync_company_tenant_map WHERE tenant_id = $1 AND is_active = true`,
    [tenant_id],
  );
  const companyIds = Array.from(new Set(mappingRows.map((r) => r.company_id)));
  if (companyIds.length === 0) return 0;

  const placeholders = employeeIds.map((_, i) => `$${i + 1}`).join(",");
  const companyPlaceholders = companyIds.map((_, i) => `$${employeeIds.length + i + 1}`).join(",");

  const historyRows = await pgQuery<HistoryRow>(
    `SELECT DISTINCT ON (sep.id)
       sep.company_id,
       sep.employee_id,
       sep.id AS sync_employee_position_id,
       sep.position_id,
       sp.internal_title,
       sp.external_title,
       sp.summary,
       sp.grade_id,
       sep.primary_position,
       sep.valid_from,
       sep.valid_to,
       sep.source_key
     FROM sync_employee_positions sep
     LEFT JOIN sync_positions sp
       ON sp.company_id = sep.company_id
      AND sp.position_id = sep.position_id
      AND (sp.valid_from <= sep.valid_from OR sp.valid_from IS NULL)
      AND (sp.valid_to IS NULL OR sp.valid_to >= sep.valid_from)
     WHERE sep.employee_id IN (${placeholders})
       AND sep.company_id IN (${companyPlaceholders})
       AND sep.position_id IS NOT NULL
     ORDER BY sep.id, sp.valid_from DESC NULLS LAST`,
    [...employeeIds, ...companyIds],
  );
  if (historyRows.length === 0) return 0;

  const BATCH = 500;
  let synced = 0;

  for (let i = 0; i < historyRows.length; i += BATCH) {
    const batch = historyRows.slice(i, i + BATCH);
    const values: unknown[] = [];
    const placeholdersSql: string[] = [];
    let idx = 1;
    for (const r of batch) {
      const candidateId = employeeIdToCandidateId.get(r.employee_id);
      if (!candidateId) continue;
      placeholdersSql.push(
        `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`
      );
      values.push(
        candidateId,
        r.sync_employee_position_id,
        r.company_id,
        r.position_id,
        r.internal_title,
        r.external_title,
        r.summary,
        r.grade_id,
        r.primary_position ?? false,
        r.valid_from,
        r.valid_to,
        r.source_key,
        now,
        now,
        now,
      );
    }
    if (placeholdersSql.length === 0) continue;

    const res = await pool.query(
      `INSERT INTO candidate_position_history
        (candidate_id, sync_employee_position_id, company_id, position_id,
         internal_title, external_title, summary, grade_id, primary_position,
         valid_from, valid_to, source_key, synced_at, created_at, updated_at)
       VALUES ${placeholdersSql.join(",")}
       ON CONFLICT (candidate_id, source_key) DO UPDATE SET
         sync_employee_position_id = EXCLUDED.sync_employee_position_id,
         company_id = EXCLUDED.company_id,
         position_id = EXCLUDED.position_id,
         internal_title = EXCLUDED.internal_title,
         external_title = EXCLUDED.external_title,
         summary = EXCLUDED.summary,
         grade_id = EXCLUDED.grade_id,
         primary_position = EXCLUDED.primary_position,
         valid_from = EXCLUDED.valid_from,
         valid_to = EXCLUDED.valid_to,
         synced_at = EXCLUDED.synced_at,
         updated_at = EXCLUDED.updated_at`,
      values,
    );
    synced += res.rowCount ?? 0;
  }

  return synced;
}

async function loadCompanyTenantMap(tenantIds: string[] | null = null): Promise<MappingRow[]> {
  if (tenantIds && tenantIds.length > 0) {
    const placeholders = tenantIds.map((_, i) => `$${i + 1}`).join(",");
    return pgQuery<MappingRow>(
      `SELECT company_id, tenant_id FROM sync_company_tenant_map
        WHERE is_active = true AND tenant_id IN (${placeholders})
        ORDER BY company_id`,
      tenantIds,
    );
  }
  return pgQuery<MappingRow>(
    "SELECT company_id, tenant_id FROM sync_company_tenant_map WHERE is_active = true ORDER BY company_id",
  );
}

export type CandidatePopulateMode = "upsert" | "rebuild";

/**
 * "rebuild" clears the DERIVED child rows for a tenant so they are rebuilt from
 * the sync tables from scratch, dropping anything stale that an additive upsert
 * would leave behind.
 *
 * It deliberately does NOT delete `candidates` rows. Those cascade to
 * analysis_results and position_picks, so recreating
 * them would silently destroy finalized scoring results and chosen successors —
 * and tournament_sessions holds candidate ids in JSON with no FK, so they would
 * dangle too. Candidate ids are preserved; only re-derivable data is replaced.
 */
async function clearDerivedRows(tenantId: string): Promise<Record<string, number>> {
  const cleared: Record<string, number> = {};

  const history = await pool.query(
    `DELETE FROM candidate_position_history
      WHERE candidate_id IN (SELECT id FROM candidates WHERE tenant_id = $1)`,
    [tenantId],
  );
  cleared.candidate_position_history = history.rowCount ?? 0;

  // Only sync-derived competencies: is_manual rows were entered by a human in
  // the UI and are not reproducible from the sync tables.
  try {
    const tech = await pool.query(
      `DELETE FROM candidate_technical_competencies
        WHERE is_manual IS NOT TRUE
          AND candidate_id IN (SELECT id FROM candidates WHERE tenant_id = $1)`,
      [tenantId],
    );
    cleared.candidate_technical_competencies = tech.rowCount ?? 0;
  } catch {
    cleared.candidate_technical_competencies = 0;
  }

  return cleared;
}

/** Candidates present in the DB but no longer produced by the sync source. */
async function countStaleCandidates(companyId: string, tenantId: string): Promise<number> {
  try {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM candidates c
        WHERE c.tenant_id = $2
          AND c.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM sync_employees e
             WHERE e.company_id = $1 AND e.employee_id = c.employee_id
          )`,
      [companyId, tenantId],
    );
    return r.rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

export async function populateCandidates(
  tenantIds: string[] | null = null,
  options: {
    mode?: CandidatePopulateMode;
    /**
     * Who the HAV events this run records are attributed to: the Monday/on-demand
     * candidate sync (default), or the run chained right after a PA or BA
     * workbook upload (`pa_ba_upload`, routes/sync.ts).
     */
    havOrigin?: Extract<HavAutoChangeOrigin, "candidate_sync" | "pa_ba_upload">;
    /**
     * Only these Company IDs (case/space-insensitive). The run chained after an
     * upload passes the companies the workbook wrote, so uploading company B's
     * data never re-derives company A — which would put A back to its sync_*
     * values and record any PA/BA difference as a "pa_ba_upload" HAV event B's
     * upload never caused. Absent = every mapped company, as before.
     */
    companyIds?: string[];
  } = {},
): Promise<SyncResult> {
  const mode: CandidatePopulateMode = options.mode === "rebuild" ? "rebuild" : "upsert";
  const havOrigin = options.havOrigin ?? "candidate_sync";
  const allMappings = await loadCompanyTenantMap(tenantIds);
  const wanted = options.companyIds
    ? new Set(options.companyIds.map((c) => c.trim().toUpperCase()))
    : null;
  const mappings = wanted
    ? allMappings.filter((m) => wanted.has(String(m.company_id).trim().toUpperCase()))
    : allMappings;
  const filterDesc =
    (tenantIds && tenantIds.length > 0 ? ` [tenantIds=${tenantIds.join(",")}]` : "") +
    (wanted ? ` [companyIds=${[...wanted].join(",")}]` : "") +
    ` [mode=${mode}]`;

  // A scoped run whose companies have no mapping changed nothing a company can
  // see: say so, rather than the "add a mapping first" failure below.
  if (wanted && mappings.length === 0 && allMappings.length > 0) {
    return {
      success: true,
      synced: 0,
      total: 0,
      message:
        wanted.size === 0
          ? "Tidak ada baris yang berubah; kandidat tidak disinkron ulang."
          : `Company ID ${[...wanted].join(", ")} belum dipetakan ke Company; kandidat tidak disinkron ulang.`,
    };
  }

  if (mappings.length === 0) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message:
        tenantIds && tenantIds.length > 0
          ? `No active company→tenant mapping found for tenantId(s): ${tenantIds.join(", ")}`
          : "No active company→tenant mappings found. Add them via the UI first.",
    };
  }

  if (!config.syncSystemUserId) {
    return {
      success: false,
      synced: 0,
      total: 0,
      message:
        "SYNC_SYSTEM_USER_ID must be configured before populating candidates",
    };
  }

  const now = new Date();
  let totalSynced = 0;
  let totalHistorySynced = 0;
  let totalCleared = 0;
  let totalStale = 0;
  let totalHavStamped = 0;
  let totalHavSuperseded = 0;
  let totalHavRecopied = 0;
  const errors: string[] = [];

  for (const { company_id, tenant_id } of mappings) {
    console.log(`[CANDIDATES] Populating ${company_id} → ${tenant_id}${filterDesc}`);
    try {
      if (mode === "rebuild") {
        const cleared = await clearDerivedRows(tenant_id);
        const n = Object.values(cleared).reduce((a, b) => a + b, 0);
        totalCleared += n;
        console.log(
          `[CANDIDATES] ${company_id} → cleared ${n} derived row(s) ` +
            `(${Object.entries(cleared).map(([k, v]) => `${k}=${v}`).join(", ")}); ` +
            `candidate ids preserved`,
        );
      }

      const derived = await pgQuery<DerivedCandidate>(DERIVE_SQL, [company_id]);
      if (derived.length === 0) {
        console.log(`[CANDIDATES] ${company_id} → 0 candidate rows derived`);
        continue;
      }

      const BATCH = 500;
      let batchSynced = 0;
      for (let i = 0; i < derived.length; i += BATCH) {
        const batch = derived.slice(i, i + BATCH);
        const values: unknown[] = [];
        const placeholdersSql: string[] = [];
        let idx = 1;
        for (const r of batch) {
          placeholdersSql.push(
            `(gen_random_uuid(), ${Array.from(
              { length: CANDIDATE_VALUES_PER_ROW },
              () => `$${idx++}`,
            ).join(", ")})`,
          );
          values.push(
            tenant_id,
            r.employee_id,
            textOrNull(r.name),
            textOrNull(r.grade),
            textOrNull(r.discipline_status),
            textOrNull(r.performance_grade),
            textOrNull(r.education),
            textOrNull(r.major),
            textOrNull(r.mcu_status),
            textOrNull(r.mcu_note),
            textOrNull(r.behavior_recommendation),
            textOrNull(r.behavior_notes),
            textOrNull(r.photo_url),
            textOrNull(r.current_position),
            textOrNull(r.department),
            textOrNull(r.division),
            textOrNull(r.years_of_service),
            textOrNull(r.hav_quadrant),
            textOrNull(r.birth_date),
            config.syncSystemUserId,
            now,
            now,
          );
        }
        // One transaction per batch, as the failure granularity has always
        // been: the upsert, and the HAV-order bookkeeping it causes, commit or
        // roll back together. The prior values are read (and locked) INSIDE
        // it, because they are the only evidence of what this write changed.
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const prior = await loadPriorHavInputs(
            client,
            tenant_id,
            batch.map((r) => r.employee_id),
          );
          const res = await client.query(
            `INSERT INTO candidates ${CANDIDATE_INSERT_COLUMNS} VALUES ${placeholdersSql.join(", ")} ${CANDIDATE_ON_CONFLICT}`,
            values,
          );
          batchSynced += res.rowCount ?? 0;

          // PA and BA come from the MSSQL syncs or a PA/BA workbook upload, and
          // a CHANGED PA or BA puts the formula in force (drizzle/0098): over an
          // older placement AND an older HAV upload, until the next placement or
          // differing HAV upload. Re-copying an older upload value is not an
          // event (hav-order.ts says why). A row that did not exist before has
          // no placement to supersede and nothing to pin against.
          const havChanges: AutomaticHavChange[] = [];
          for (const r of batch) {
            const was = prior.get(r.employee_id);
            if (!was) continue;
            const delta = candidateSyncHavEvent(was.inputs, {
              // Mirrors the COALESCE in CANDIDATE_ON_CONFLICT.
              upload: canonicalHavQuadrant(r.hav_quadrant) ?? was.inputs.upload,
              tier: was.inputs.tier,
              performanceGrade: r.performance_grade,
              behaviorRecommendation: r.behavior_recommendation,
            });
            if (delta.uploadRecopied) totalHavRecopied += 1;
            if (!delta.changed) continue;
            havChanges.push({
              candidateId: was.candidateId,
              tenantId: tenant_id,
              employeeId: r.employee_id,
              cause: delta.cause,
              before: delta.before,
              after: delta.after,
              tier: delta.tier,
            });
          }
          const recorded = await recordAutomaticHavChanges(client, havChanges, havOrigin);
          totalHavStamped += recorded.stamped;
          totalHavSuperseded += recorded.superseded;

          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
      totalSynced += batchSynced;
      console.log(`[CANDIDATES] ${company_id} → ${batchSynced} candidate rows upserted`);

      const historySynced = await populateCandidatePositionHistory(tenant_id, now);
      totalHistorySynced += historySynced;
      console.log(`[CANDIDATES] ${company_id} → ${historySynced} position-history rows upserted`);

      // Reported, never deleted: removing them would cascade into scoring
      // history. Surfacing the count lets an operator prune deliberately.
      const stale = await countStaleCandidates(company_id, tenant_id);
      totalStale += stale;
      if (stale > 0) {
        console.warn(
          `[CANDIDATES] ${company_id} → ${stale} candidate(s) no longer in sync_employees ` +
            `(kept, ids preserved to protect scoring history)`,
        );
      }
    } catch (err) {
      console.error(`[CANDIDATES] Failed for ${company_id}:`, err);
      errors.push(company_id);
    }
  }

  if (errors.length) {
    return {
      success: false,
      synced: totalSynced,
      total: totalSynced,
      message: `Populated ${totalSynced} candidates and ${totalHistorySynced} position-history rows (${mappings.length - errors.length}/${mappings.length} OK). Failed: ${errors.join(", ")}${filterDesc}`,
    };
  }

  const extra =
    (mode === "rebuild" ? `, ${totalCleared} derived row(s) dibangun ulang` : "") +
    (totalStale > 0 ? `, ${totalStale} kandidat tidak lagi ada di sumber sync (dipertahankan)` : "") +
    (totalHavStamped > 0
      ? `, PA/BA ${totalHavStamped} kandidat berubah sehingga HAV-nya kini mengikuti rumus PA × BA (waktu perubahan dicatat)` +
        (totalHavSuperseded > 0
          ? ` dan ${totalHavSuperseded} penempatan manual Talent Mapping yang lebih lama digantikan`
          : "")
      : "") +
    (totalHavRecopied > 0
      ? `, ${totalHavRecopied} kandidat: nilai upload HAV disalin ulang dari sync_hav (data lama, bukan peristiwa baru — penempatan manual tidak disentuh)`
      : "");

  return {
    success: true,
    synced: totalSynced,
    total: totalSynced,
    message: `Populated ${totalSynced} candidates and ${totalHistorySynced} position-history rows across ${mappings.length} company mapping(s)${extra}${filterDesc}`,
  };
}
