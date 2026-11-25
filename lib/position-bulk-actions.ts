'use server';

/**
 * Bulk registration of managed positions by INCUMBENT grade.
 *
 * Why incumbent grade and not the position's own grade: `sync_positions.grade_id`
 * is empty for practically every row in this deployment, while
 * `sync_employees.grade_id` is populated. The person sitting in the seat is
 * therefore the only reliable statement of the seat's level, and it is also the
 * definition an HR user means by "positions grade 7 and up" — grade 7 is where
 * MANAGER starts (5–6 SUPERVISOR, 1–4 STAFF, per sync_grade_levels).
 *
 * The whole point of this path is coverage: registering ~50 seats one dialog at
 * a time is what stops succession planning from ever starting. It still writes
 * through the same invariants as the single-position form — one program per
 * position, every active incumbent recorded and excluded, duplicate guard — and
 * it reports per position what it could not fill in rather than inventing it.
 */

import { ahpSessionGateError } from '@/lib/ahp-save-rules';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import { isDemoMode } from '@/lib/app-mode';
import { refuseInDemoMode } from '@/lib/demo/write';
import { isDemoSql, picksOfCurrentMode, runsOfCurrentMode, sessionsOfCurrentMode } from '@/lib/demo/run-mode';
import * as schema from '@/lib/db/schema';
import { logAudit } from '@/lib/audit';
import { suggestJobProfileForSelectionAction } from '@/lib/job-profile-actions';
import { parseJobProfileTechnicalCompetencies } from '@/lib/job-profile-utils';
import { isPositionProgram } from '@/lib/programs';
import { ensureLocalUser, getGradeLevelsForTenant } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { startTournamentSessionAction } from '@/lib/scoring-engine';
import { getCurrentTenantId } from '@/lib/tenant';

import { formatDate } from '@/lib/datetime';
import { RUN_LABEL_SEPARATOR } from '@/lib/run-label';
import { demoScrub } from '@/lib/demo/names';
export type BulkPositionHolder = { name: string; employeeId: string; gradeId: string | null };

export type BulkPositionPreviewRow = {
  masterPositionId: string;
  positionCode: string;
  title: string;
  department: string | null;
  division: string | null;
  /** Highest incumbent grade on this seat — what the threshold is applied to. */
  topGrade: number;
  /** Level name that grade belongs to ("MANAGER") — what people call the seat;
   *  the grade code itself is an internal payroll id, not a job level. */
  topLevelName: string | null;
  holders: BulkPositionHolder[];
  /** Already registered under the chosen program → will be skipped. */
  alreadyRegistered: boolean;
  /** Job profile this seat resolves to, or null when nothing matches it. */
  jobProfileId: number | null;
  jobProfileName: string | null;
  /** Successor level range this seat would get under the selected program. */
  successorRange: SuccessorRange | null;
};

export type BulkPositionPreview = {
  minGrade: number;
  rows: BulkPositionPreviewRow[];
  eligible: number;
  alreadyRegistered: number;
  /** Of the eligible rows, how many have NO job profile — scoring them means
   *  falling back to the incumbents' competencies, so the operator is told
   *  before the batch runs, not after. */
  withoutJobProfile: number;
};

/** Leading digits of a grade code ("7B" → 7). */
const GRADE_NUM = sql`NULLIF(substring(se.grade_id from '[0-9]+'), '')::int`;

type RawRow = {
  master_position_id: string;
  position_code: string;
  title: string | null;
  department: string | null;
  division: string | null;
  employee_id: string;
  employee_name: string | null;
  candidate_name: string | null;
  candidate_employee_id: string | null;
  grade_id: string | null;
  grade_num: number | null;
};

/**
 * Every active seat in the current tenant whose incumbent is at or above
 * `minGrade`, with all of its incumbents attached.
 */
async function loadEligiblePositions(
  tenantId: string,
  minGrade: number,
): Promise<Map<string, BulkPositionPreviewRow>> {
  const res = await db.execute(sql`
    SELECT
      p.id::text                                      AS master_position_id,
      p.position_id                                   AS position_code,
      COALESCE(p.internal_title, p.external_title)    AS title,
      p.department                                    AS department,
      p.division                                      AS division,
      sep.employee_id                                 AS employee_id,
      COALESCE(se.display_name, se.internal_title)    AS employee_name,
      c.name                                          AS candidate_name,
      c.employee_id                                   AS candidate_employee_id,
      se.grade_id                                     AS grade_id,
      ${GRADE_NUM}                                    AS grade_num
    FROM positions p
    JOIN sync_positions sp ON sp.id = p.sync_position_id AND sp.valid_to > CURRENT_DATE
    JOIN sync_employee_positions sep
      ON sep.company_id = sp.company_id AND sep.position_id = sp.position_id
     AND sep.valid_to > CURRENT_DATE
    JOIN sync_employees se
      ON se.company_id = sep.company_id AND LPAD(se.employee_id, 5, '0') = sep.employee_id
    -- A tombstoned candidate is still an employee holding the seat, so they stay
    -- an incumbent; the join only supplies their candidate name.
    LEFT JOIN candidates c
      ON LPAD(c.employee_id, 5, '0') = sep.employee_id
     AND c.tenant_id = ${tenantId}
     AND c.deleted_at IS NULL
    WHERE p.tenant_id = ${tenantId}
      AND COALESCE(p.internal_title, p.external_title) IS NOT NULL
    ORDER BY p.id, sep.primary_position DESC NULLS LAST, sep.employee_id
  `);

  const byPosition = new Map<string, BulkPositionPreviewRow>();
  const seenHolder = new Set<string>();

  for (const raw of res.rows as unknown as RawRow[]) {
    const gradeNum = raw.grade_num == null ? null : Number(raw.grade_num);
    const id = raw.master_position_id;
    const row =
      byPosition.get(id) ??
      ({
        masterPositionId: id,
        positionCode: raw.position_code,
        title: (raw.title ?? '').trim(),
        department: raw.department,
        division: raw.division,
        topGrade: 0,
        topLevelName: null,
        holders: [],
        alreadyRegistered: false,
        jobProfileId: null,
        jobProfileName: null,
        successorRange: null,
      } satisfies BulkPositionPreviewRow);

    // sync_employee_positions ids are zero-padded to 5; candidates/sync_employees
    // use the unpadded form.
    const employeeId = raw.candidate_employee_id ?? raw.employee_id.replace(/^0/, '');
    const holderKey = `${id}:${employeeId}`;
    if (!seenHolder.has(holderKey)) {
      seenHolder.add(holderKey);
      row.holders.push({
        name: raw.candidate_name || raw.employee_name || '',
        employeeId,
        gradeId: raw.grade_id,
      });
    }
    if (gradeNum != null && gradeNum > row.topGrade) row.topGrade = gradeNum;
    byPosition.set(id, row);
  }

  // The threshold is on the seat, judged by its most senior sitting incumbent —
  // a Department Head seat that also carries a grade-4 assistant is still a
  // grade-9 seat.
  for (const [id, row] of byPosition) {
    if (row.topGrade < minGrade || row.holders.length === 0 || !row.title) byPosition.delete(id);
  }
  return byPosition;
}

/** Positions already registered under this program, by master position id AND
 *  by normalized title — the older rows were added before position_id was ever
 *  written, so title is the only link they have. */
async function loadRegisteredKeys(
  tenantId: string,
  programCode: string,
): Promise<{ byMasterId: Set<string>; byTitle: Set<string> }> {
  const rows = await db
    .select({
      positionId: schema.criticalPositions.positionId,
      title: schema.criticalPositions.title,
    })
    .from(schema.criticalPositions)
    .where(
      and(
        eq(schema.criticalPositions.tenantId, tenantId),
        eq(schema.criticalPositions.programCode, programCode),
      ),
    );
  return {
    byMasterId: new Set(rows.map((r) => r.positionId).filter((id): id is string => Boolean(id))),
    byTitle: new Set(rows.map((r) => r.title.trim().toLowerCase())),
  };
}

async function resolveProgram(tenantId: string, programTemplateId: string) {
  const [template] = await db
    .select({
      id: schema.programTemplates.id,
      code: schema.programTemplates.code,
      name: schema.programTemplates.name,
      ahpConfig: schema.programTemplates.ahpConfig,
    })
    .from(schema.programTemplates)
    .where(
      and(
        eq(schema.programTemplates.id, programTemplateId),
        eq(schema.programTemplates.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!template) throw new Error('Program suksesi tidak ditemukan untuk business unit ini.');
  if (!isPositionProgram(template.code)) {
    throw new Error(`Program "${template.name}" tidak dapat dipakai untuk posisi.`);
  }
  return template;
}

/**
 * Resolve the job profile of many seats, a few at a time.
 *
 * The resolver reads the whole completed-profile list on its title-fallback
 * path, so firing 50 of them at once is wasteful; a small pool keeps the
 * preview responsive without hammering the database.
 */
async function resolveProfilesFor(
  rows: Array<{ key: string; masterPositionId: string | null; title: string }>,
  concurrency = 6,
): Promise<Map<string, { jobProfileId: number | null; positionName: string | null }>> {
  const out = new Map<string, { jobProfileId: number | null; positionName: string | null }>();
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++]!;
      try {
        const suggestion = await suggestJobProfileForSelectionAction({
          masterPositionId: row.masterPositionId,
          titleFallback: row.title,
        });
        out.set(row.key, {
          jobProfileId: suggestion.jobProfileId ?? null,
          positionName: suggestion.positionName ?? null,
        });
      } catch {
        // Unreadable is not the same as unmatched, but for the operator's
        // decision both mean "scoring will have no JD to work from".
        out.set(row.key, { jobProfileId: null, positionName: null });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, rows.length) }, worker),
  );
  return out;
}

// Demo mode: holder names leave the server as initials (bulk add is refused in demo mode).
export async function previewBulkPositionsAction(
  ...args: Parameters<typeof previewBulkPositionsActionImpl>
): ReturnType<typeof previewBulkPositionsActionImpl> {
  return demoScrub(await previewBulkPositionsActionImpl(...args));
}

async function previewBulkPositionsActionImpl(input: {
  minGrade: number;
  programTemplateId: string;
}): Promise<BulkPositionPreview> {
  await requirePermission('positions.manage');
  const tenantId = await getCurrentTenantId();
  const minGrade = Math.max(1, Math.floor(Number(input.minGrade) || 7));
  const program = await resolveProgram(tenantId, input.programTemplateId);

  const [eligible, registered, gradeLevels] = await Promise.all([
    loadEligiblePositions(tenantId, minGrade),
    loadRegisteredKeys(tenantId, program.code),
    getGradeLevelsForTenant(tenantId),
  ]);
  const bands = buildLevelBands(gradeLevels);

  const base = Array.from(eligible.values()).map((row) => ({
    ...row,
    alreadyRegistered:
      registered.byMasterId.has(row.masterPositionId) ||
      registered.byTitle.has(row.title.trim().toLowerCase()),
  }));

  // Only the rows that would actually be created — resolving a profile for a
  // seat that is going to be skipped anyway is pure cost.
  const profiles = await resolveProfilesFor(
    base.filter((r) => !r.alreadyRegistered).map((r) => ({
      key: r.masterPositionId,
      masterPositionId: r.masterPositionId,
      title: r.title,
    })),
  );

  const rows = base
    .map((row) => {
      const hit = profiles.get(row.masterPositionId);
      return {
        ...row,
        jobProfileId: hit?.jobProfileId ?? null,
        jobProfileName: hit?.positionName ?? null,
        successorRange: successorRangeForProgram(program.code, row.topGrade, bands),
        topLevelName: bands.length > 0 ? bands[bandIndexFor(bands, row.topGrade)]!.name : null,
      };
    })
    .sort((a, b) => b.topGrade - a.topGrade || a.title.localeCompare(b.title));

  const eligibleRows = rows.filter((r) => !r.alreadyRegistered);
  return {
    minGrade,
    rows,
    eligible: eligibleRows.length,
    alreadyRegistered: rows.length - eligibleRows.length,
    withoutJobProfile: eligibleRows.filter((r) => r.jobProfileId == null).length,
  };
}

export type BulkAddOutcome = {
  title: string;
  positionId: string | null;
  /** Empty when everything resolved; otherwise what could not be filled in. */
  warnings: string[];
  /** False when no job profile could be matched to this seat. */
  hasJobProfile: boolean;
  /**
   * 'no-profile' = created, but deliberately left unscored by the operator.
   * 'queued' = the session exists and is committed, but the scoring service did
   * not accept it — distinct from 'failed' (nothing was created) and from
   * 'started' (a worker is on it), because the operator's next move differs:
   * wait, versus fix the position.
   */
  scoring: 'started' | 'queued' | 'skipped' | 'failed' | 'off' | 'no-profile';
  scoringError?: string;
};

export type BulkAddResult = {
  created: number;
  skipped: number;
  scoringStarted: number;
  /** Sessions created but not picked up: the scoring service was unreachable. */
  scoringQueued: number;
  /** Set when at least one session queued — the reason, shown once. */
  scoringQueuedMessage?: string;
  /** Created positions left unscored because they have no job profile. */
  scoringSkippedNoProfile: number;
  outcomes: BulkAddOutcome[];
};

/**
 * One rung of the career ladder — a LEVEL, with the grades it spans.
 *
 * "One level" in this product means one level NAME (STAFF → SUPERVISOR →
 * MANAGER → GENERAL MANAGER → DIRECTOR), not one grade number: the
 * single-position form's "Rentang Level Suksesor" picks level names and
 * converts them to grade bounds, and a level usually spans two grades (MANAGER
 * is 7–8). Deriving the bulk range from grade numbers instead would silently
 * offer a narrower pool than the same choice made by hand.
 */
export type LevelBand = { name: string; min: number; max: number };

function buildLevelBands(gradeLevels: { gradeId: string; levelName: string | null }[]): LevelBand[] {
  const byName = new Map<string, LevelBand>();
  for (const level of gradeLevels) {
    const grade = parseInt(String(level.gradeId).replace(/[^0-9]/g, ''), 10);
    if (!Number.isFinite(grade)) continue;
    const name = level.levelName?.trim() || `Grade ${grade}`;
    const band = byName.get(name) ?? { name, min: grade, max: grade };
    band.min = Math.min(band.min, grade);
    band.max = Math.max(band.max, grade);
    byName.set(name, band);
  }
  return Array.from(byName.values()).sort((a, b) => a.min - b.min);
}

/** The band a grade sits in; falls back to the highest band at or below it. */
function bandIndexFor(bands: LevelBand[], grade: number): number {
  const exact = bands.findIndex((b) => grade >= b.min && grade <= b.max);
  if (exact !== -1) return exact;
  // sync_grade_levels has gaps (there is no grade 11), so a grade between two
  // bands belongs to the lower one rather than to nothing.
  let fallback = -1;
  for (let i = 0; i < bands.length; i++) if (bands[i]!.min <= grade) fallback = i;
  return fallback === -1 ? 0 : fallback;
}

export type SuccessorRange = {
  minGradeId: string;
  maxGradeId: string;
  /** Human label for the preview, e.g. "SUPERVISOR (grade 5–6)". */
  label: string;
  /** Level names only, e.g. "SUPERVISOR" or "MANAGER–GENERAL MANAGER". */
  levels: string;
};

/**
 * The successor level range a bulk-added position gets, which depends on what
 * the program is FOR:
 *
 *  • **Successor** — grooming the next generation, so the pool is the level
 *    BELOW the incumbent.
 *  • **Emergency Position** — somebody who could take the seat over now, so the
 *    pool is the incumbent's OWN level plus the one above it.
 *  • anything else — the conservative span the single-position form suggests,
 *    one level below up to the incumbent's own level.
 *
 * Falls back to the incumbent's own band when the ladder has no rung in the
 * asked-for direction (nobody is below a STAFF seat, nobody above a PRESIDENT
 * DIRECTOR one).
 */
function successorRangeForProgram(
  programCode: string,
  incumbentGrade: number,
  bands: LevelBand[],
): SuccessorRange {
  if (bands.length === 0) {
    const below = Math.max(1, incumbentGrade - 1);
    return {
      minGradeId: String(below),
      maxGradeId: String(incumbentGrade),
      label: `Grade ${below}–${incumbentGrade}`,
      levels: `Grade ${below}–${incumbentGrade}`,
    };
  }

  const index = bandIndexFor(bands, incumbentGrade);
  const own = bands[index]!;
  const below = index > 0 ? bands[index - 1]! : null;
  const above = index < bands.length - 1 ? bands[index + 1]! : null;

  const code = programCode.toLowerCase();
  let from: LevelBand;
  let to: LevelBand;
  if (code === 'emergency') {
    from = own;
    to = above ?? own;
  } else if (code === 'successor') {
    from = below ?? own;
    to = below ?? own;
  } else {
    from = below ?? own;
    to = own;
  }

  const names = from.name === to.name ? from.name : `${from.name}–${to.name}`;
  const grades = from.min === to.max ? `grade ${from.min}` : `grade ${from.min}–${to.max}`;
  return {
    minGradeId: String(from.min),
    maxGradeId: String(to.max),
    label: `${names} (${grades})`,
    levels: names,
  };
}

export async function bulkAddPositionsAction(input: {
  minGrade: number;
  programTemplateId: string;
  /** Start an AHP+TOPSIS run for each created position. */
  autoScore: boolean;
  /**
   * Score positions that have NO job profile too (default true).
   *
   * Such a run still works — technical and career fall back to the incumbents'
   * competencies — but it means something different from a JD-backed score, so
   * the choice is the operator's and is made before the batch runs.
   */
  scoreWithoutJobProfile?: boolean;
  /** Only these master position ids (defaults to every eligible one). */
  masterPositionIds?: string[];
}): Promise<BulkAddResult> {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  await requirePermission('positions.manage');
  if (input.autoScore) await requirePermission('scoring.run');

  const [createdBy, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
  const minGrade = Math.max(1, Math.floor(Number(input.minGrade) || 7));
  const program = await resolveProgram(tenantId, input.programTemplateId);

  const [eligible, registered, gradeLevels] = await Promise.all([
    loadEligiblePositions(tenantId, minGrade),
    loadRegisteredKeys(tenantId, program.code),
    getGradeLevelsForTenant(tenantId),
  ]);
  const bands = buildLevelBands(gradeLevels);

  const wanted = input.masterPositionIds?.length
    ? Array.from(eligible.values()).filter((r) => input.masterPositionIds!.includes(r.masterPositionId))
    : Array.from(eligible.values());

  const outcomes: BulkAddOutcome[] = [];
  const createdIds: { id: string; title: string }[] = [];
  let skipped = 0;

  for (const row of wanted) {
    if (
      registered.byMasterId.has(row.masterPositionId) ||
      registered.byTitle.has(row.title.trim().toLowerCase())
    ) {
      skipped++;
      continue;
    }

    const warnings: string[] = [];

    // Qualifications from the matched job profile — the same suggestion path the
    // single-position form uses, so a bulk-added position is not a lesser row.
    let education = '';
    let experience = '';
    let jobFamily = '';
    let competencies: { technicalId: string; technicalName: string; targetProficiency?: string }[] = [];
    let hasJobProfile = false;
    try {
      const suggestion = await suggestJobProfileForSelectionAction({
        masterPositionId: row.masterPositionId,
        titleFallback: row.title,
      });
      if (suggestion.jobProfileId && suggestion.extractedData) {
        const data =
          typeof suggestion.extractedData === 'string'
            ? (JSON.parse(suggestion.extractedData) as Record<string, unknown>)
            : (suggestion.extractedData as Record<string, unknown>);
        const spec = (data.jobSpecification ?? {}) as Record<string, unknown>;
        const identity = (data.jobIdentity ?? {}) as Record<string, unknown>;
        if (typeof spec.education === 'string') education = spec.education.trim();
        if (typeof spec.experience === 'string') experience = spec.experience.trim();
        if (typeof identity.divisionDepartment === 'string') jobFamily = identity.divisionDepartment.trim();
        hasJobProfile = true;
        // The stored shape carries technicalId as well; the parser returns
        // name+level, so mirror the single-position form and key the id by name.
        competencies = parseJobProfileTechnicalCompetencies(
          (data as { technicalCompetencies?: unknown }).technicalCompetencies as never,
        ).map((c) => ({
          technicalId: c.technicalName,
          technicalName: c.technicalName,
          ...(c.targetProficiency ? { targetProficiency: c.targetProficiency } : {}),
        }));
      } else {
        warnings.push('tanpa job profile — kualifikasi & kompetensi kosong');
      }
    } catch {
      warnings.push('gagal membaca job profile');
    }
    if (!jobFamily) jobFamily = row.division ?? '';

    const range = successorRangeForProgram(program.code, row.topGrade, bands);
    const primary = row.holders[0]!;

    let positionId: string | null = null;
    try {
      const [inserted] = await db
        .insert(schema.criticalPositions)
        .values({
          tenantId,
          // Unlike the single-position form, the master link IS stored here:
          // the whole selection came from it, so keeping it makes a re-run of
          // this action recognise its own rows instead of duplicating them.
          positionId: row.masterPositionId,
          title: row.title,
          department: row.department,
          division: row.division,
          status: 'active',
          programTemplateId: program.id,
          programCode: program.code,
          holderName: primary.name,
          holderEmployeeId: primary.employeeId,
          education: education || null,
          experience: experience || null,
          jobFamily: jobFamily || null,
          minGradeId: range.minGradeId,
          maxGradeId: range.maxGradeId,
          requiredCompetencies: competencies as unknown as object,
          createdBy,
        })
        .returning({ id: schema.criticalPositions.id });
      positionId = inserted!.id;

      for (const [index, holder] of row.holders.entries()) {
        if (!holder.employeeId) continue;
        await db.execute(sql`
          INSERT INTO critical_position_holders (position_id, employee_id, name, is_primary)
          VALUES (${positionId}, ${holder.employeeId}, ${holder.name || null}, ${index === 0})
          ON CONFLICT (position_id, employee_id) DO UPDATE SET
            name = EXCLUDED.name, is_primary = EXCLUDED.is_primary
        `);
      }

      createdIds.push({ id: positionId, title: row.title });
      registered.byMasterId.add(row.masterPositionId);
      registered.byTitle.add(row.title.trim().toLowerCase());
    } catch (err) {
      outcomes.push({
        title: row.title,
        positionId: null,
        warnings: [...warnings, err instanceof Error ? err.message : 'gagal menyimpan posisi'],
        hasJobProfile,
        scoring: 'failed',
      });
      continue;
    }

    outcomes.push({
      title: row.title,
      positionId,
      warnings,
      hasJobProfile,
      // A seat with no JD is only scored when the operator said so on the
      // dialog's notice; otherwise it is created and left for a human to pair
      // with a job profile first.
      scoring: !input.autoScore
        ? 'off'
        : !hasJobProfile && input.scoreWithoutJobProfile === false
          ? 'no-profile'
          : 'skipped',
    });
  }

  await logAudit({
    tenantId,
    actorId: createdBy,
    entityType: 'position',
    entityId: tenantId,
    action: 'create',
    summary:
      `Tambah massal: ${createdIds.length} posisi grade ${minGrade}+ didaftarkan pada program ${program.name}` +
      (skipped > 0 ? ` (${skipped} sudah terdaftar, dilewati).` : '.'),
  });

  // ── Auto scoring ────────────────────────────────────────────────
  // One session per position. Each start only queues work — scoring-service
  // processes at most SCORING_MAX_CONCURRENT at a time and its orphan sweeper
  // drains the rest — so this loop stays fast and the machine does not get
  // hit by fifty AHP runs at once.
  let scoringStarted = 0;
  let scoringQueued = 0;
  let scoringQueuedMessage: string | undefined;
  // One answer for the whole batch: the AHP gate is a property of the
  // program, so fifty positions must not each report the same failure.
  const ahpGate = input.autoScore ? ahpSessionGateError(program.ahpConfig, program.name) : null;
  if (ahpGate) scoringQueuedMessage = ahpGate;
  if (input.autoScore && !ahpGate) {
    // formatDate, not toISOString().slice: the latter reads UTC calendar
    // fields, so between 00:00 and 07:00 WIB a batch stamped YESTERDAY onto
    // every run label it created.
    const stamp = formatDate(new Date());
    for (const created of createdIds) {
      const outcome = outcomes.find((o) => o.positionId === created.id);
      if (outcome?.scoring === 'no-profile') continue;
      try {
        const started = await startTournamentSessionAction({
          positionId: created.id,
          programTemplateId: program.id,
          label: `Auto AHP${RUN_LABEL_SEPARATOR}${stamp}`,
          includedTenantIds: [tenantId],
        });
        // A dead scoring service is not a per-position problem, so it must not
        // be reported as fifty separate failures — count it and carry the reason
        // once. The sessions themselves are safe and the sweeper drains them.
        if (started.dispatch.status === 'queued') {
          scoringQueued++;
          scoringQueuedMessage ??= started.dispatch.message ?? undefined;
          if (outcome) outcome.scoring = 'queued';
        } else {
          scoringStarted++;
          if (outcome) outcome.scoring = 'started';
        }
      } catch (err) {
        // A position whose pool comes out empty (grade range too narrow, every
        // candidate filtered) must not abort the batch — the position is
        // already registered and can be scored by hand later.
        if (outcome) {
          outcome.scoring = 'failed';
          outcome.scoringError = err instanceof Error ? err.message : 'gagal memulai scoring';
        }
      }
    }
  }

  revalidatePath('/positions');
  revalidatePath('/');

  return {
    created: createdIds.length,
    skipped,
    scoringStarted,
    scoringQueued,
    scoringQueuedMessage,
    scoringSkippedNoProfile: outcomes.filter((o) => o.scoring === 'no-profile').length,
    outcomes,
  };
}

// ── Re-score every position in a program ──────────────────────────
//
// The counterpart of the bulk add: the positions already exist, what is stale is
// their ranking. Candidate data moves under a finished run — a new PA period, an
// MCU result, a promotion, a re-synced job profile — and a run is a snapshot of
// the day it was made, so refreshing a whole program means running each position
// again rather than editing anything in place.
//
// Nothing is deleted or overwritten: every position gets a NEW run and the old
// ones stay readable in its history. Same rule the exclusion re-rank follows,
// for the same reason — a completed ranking is the record of an assessment on a
// date.

export type ProgramRescoreRow = {
  positionId: string;
  title: string;
  department: string | null;
  /** Runs recorded so far — 0 means this position has never been scored. */
  runCount: number;
  lastRunAt: string | null;
  lastRunMethod: string | null;
  /** A run is already going; re-dispatching would stack a second one. */
  inProgress: boolean;
  jobProfileId: number | null;
  jobProfileName: string | null;
};

export type ProgramRescorePreview = {
  programName: string;
  programCode: string;
  rows: ProgramRescoreRow[];
  /** Rows that would actually be dispatched (not already running). */
  eligible: number;
  inProgress: number;
  neverScored: number;
  withoutJobProfile: number;
};

type RescoreRawRow = {
  position_id: string;
  title: string;
  department: string | null;
  master_position_id: string | null;
  run_count: number;
  last_run_at: Date | null;
  last_run_method: string | null;
  in_progress: boolean;
};

async function loadProgramPositions(
  tenantId: string,
  programCode: string,
): Promise<RescoreRawRow[]> {
  const res = await db.execute(sql`
    SELECT
      cp.id::text                                        AS position_id,
      cp.title                                           AS title,
      cp.department                                      AS department,
      cp.position_id::text                               AS master_position_id,
      COUNT(sr.id)::int                                  AS run_count,
      MAX(sr.created_at)                                 AS last_run_at,
      (ARRAY_AGG(sr.method ORDER BY sr.created_at DESC)
         FILTER (WHERE sr.method IS NOT NULL))[1]        AS last_run_method,
      BOOL_OR(sr.status = 'in_progress')                 AS in_progress
    FROM critical_positions cp
    LEFT JOIN scoring_runs sr ON sr.position_id = cp.id AND ${await isDemoSql('sr')}
    WHERE cp.tenant_id = ${tenantId} AND cp.program_code = ${programCode}
    GROUP BY cp.id, cp.title, cp.department, cp.position_id
    ORDER BY cp.title
  `);
  return res.rows as unknown as RescoreRawRow[];
}

export async function previewProgramRescoreAction(input: {
  programTemplateId: string;
}): Promise<ProgramRescorePreview> {
  await requirePermission('scoring.run');
  const tenantId = await getCurrentTenantId();
  const program = await resolveProgram(tenantId, input.programTemplateId);

  const raw = await loadProgramPositions(tenantId, program.code);
  const profiles = await resolveProfilesFor(
    raw.map((r) => ({
      key: r.position_id,
      masterPositionId: r.master_position_id,
      title: r.title,
    })),
  );

  const rows: ProgramRescoreRow[] = raw.map((r) => {
    const hit = profiles.get(r.position_id);
    return {
      positionId: r.position_id,
      title: r.title,
      department: r.department,
      runCount: Number(r.run_count ?? 0),
      lastRunAt: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
      lastRunMethod: r.last_run_method,
      inProgress: r.in_progress === true,
      jobProfileId: hit?.jobProfileId ?? null,
      jobProfileName: hit?.positionName ?? null,
    };
  });

  const dispatchable = rows.filter((r) => !r.inProgress);
  return {
    programName: program.name,
    programCode: program.code,
    rows,
    eligible: dispatchable.length,
    inProgress: rows.length - dispatchable.length,
    neverScored: rows.filter((r) => r.runCount === 0).length,
    withoutJobProfile: dispatchable.filter((r) => r.jobProfileId == null).length,
  };
}

export type ProgramRescoreOutcome = {
  positionId: string;
  title: string;
  /** 'queued' = session committed, scoring service did not accept it (yet). */
  status: 'started' | 'queued' | 'in-progress' | 'no-profile' | 'failed';
  error?: string;
};

export type ProgramRescoreResult = {
  started: number;
  /** Sessions created but not picked up: the scoring service was unreachable. */
  queued: number;
  /** Set when at least one session queued — the reason, reported once. */
  queuedMessage?: string;
  skippedInProgress: number;
  skippedNoProfile: number;
  failed: number;
  outcomes: ProgramRescoreOutcome[];
};

export async function rescoreProgramPositionsAction(input: {
  programTemplateId: string;
  /** Re-score positions with no job profile too (default true). */
  scoreWithoutJobProfile?: boolean;
  /** Only these positions (defaults to every one in the program). */
  positionIds?: string[];
}): Promise<ProgramRescoreResult> {
  await requirePermission('scoring.run');
  const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
  const program = await resolveProgram(tenantId, input.programTemplateId);

  // Refuse the whole re-score up front rather than once per position: the
  // gate is a property of the program's AHP matrix (docs/ahp-input-sync.md §7).
  const ahpGate = ahpSessionGateError(program.ahpConfig, program.name);
  if (ahpGate) throw new Error(ahpGate);

  const raw = await loadProgramPositions(tenantId, program.code);
  const wanted = input.positionIds?.length
    ? raw.filter((r) => input.positionIds!.includes(r.position_id))
    : raw;

  // Only resolve job profiles when the answer can change what happens.
  const profiles =
    input.scoreWithoutJobProfile === false
      ? await resolveProfilesFor(
          wanted.map((r) => ({
            key: r.position_id,
            masterPositionId: r.master_position_id,
            title: r.title,
          })),
        )
      : new Map<string, { jobProfileId: number | null; positionName: string | null }>();

  const outcomes: ProgramRescoreOutcome[] = [];
  // See the note on the bulk-add stamp: UTC slicing dated these a day early
  // for the first seven hours of every WIB day.
  const stamp = formatDate(new Date());
  let started = 0;
  let queued = 0;
  let queuedMessage: string | undefined;

  for (const row of wanted) {
    // Never stack a second run on a position that is mid-scoring: both would
    // write into the same position's history and the loser would look failed.
    if (row.in_progress === true) {
      outcomes.push({ positionId: row.position_id, title: row.title, status: 'in-progress' });
      continue;
    }
    if (
      input.scoreWithoutJobProfile === false &&
      profiles.get(row.position_id)?.jobProfileId == null
    ) {
      outcomes.push({ positionId: row.position_id, title: row.title, status: 'no-profile' });
      continue;
    }

    try {
      const begun = await startTournamentSessionAction({
        positionId: row.position_id,
        programTemplateId: program.id,
        label: `Rescore ${program.name}${RUN_LABEL_SEPARATOR}${stamp}`,
        includedTenantIds: [tenantId],
      });
      if (begun.dispatch.status === 'queued') {
        queued++;
        queuedMessage ??= begun.dispatch.message ?? undefined;
        outcomes.push({ positionId: row.position_id, title: row.title, status: 'queued' });
      } else {
        started++;
        outcomes.push({ positionId: row.position_id, title: row.title, status: 'started' });
      }
    } catch (err) {
      // An empty pool (grade range too narrow, everyone filtered out) is a
      // property of that one position — the rest of the program still refreshes.
      outcomes.push({
        positionId: row.position_id,
        title: row.title,
        status: 'failed',
        error: err instanceof Error ? err.message : 'gagal memulai scoring',
      });
    }
  }

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position',
    entityId: tenantId,
    action: 'update',
    summary:
      `Scoring ulang program ${program.name}: ${started} posisi diantrikan` +
      ` dari ${wanted.length} posisi terdaftar.` +
      (queued > 0
        ? ` ${queued} sesi menunggu karena layanan scoring tidak merespons.`
        : ''),
  });

  revalidatePath('/positions');
  revalidatePath('/');

  return {
    started,
    queued,
    queuedMessage,
    skippedInProgress: outcomes.filter((o) => o.status === 'in-progress').length,
    skippedNoProfile: outcomes.filter((o) => o.status === 'no-profile').length,
    failed: outcomes.filter((o) => o.status === 'failed').length,
    outcomes,
  };
}

// ── Reset every scoring result in a program ───────────────────────
//
// The destructive counterpart of the re-score: instead of adding today's answer
// it ERASES the history. Meant for the state every deployment goes through once
// — trial runs made while the filters, weights or job-profile pairings were
// still being set up, which are now noise nobody should read as an assessment.
//
// Three things this deliberately does NOT touch:
//
//  • **The positions themselves.** Resetting scoring is not un-registering a
//    seat; the bench, grade range and incumbents stay exactly as they are.
//  • **`candidate_aspect_scores`.** It is a cache keyed by an input hash, not a
//    result: a later run reuses an entry only when the candidate's inputs are
//    byte-identical, so keeping it makes the next run cheaper without it ever
//    serving a stale answer.
//  • **Chosen successors**, unless asked. A pick is a human decision made FROM
//    a ranking, not part of it — so it survives by default and merely loses its
//    run link (`position_picks.run_id` is ON DELETE SET NULL).

export type ProgramScoringResetPreview = {
  programName: string;
  programCode: string;
  positions: number;
  /** Positions that actually carry something to delete. */
  positionsWithRuns: number;
  runs: number;
  sessions: number;
  analysisResults: number;
  picks: number;
  /** Runs still processing — cancelled first, since a live worker writing into
   *  rows being deleted fails in confusing ways. */
  inProgress: number;
};

export async function previewProgramScoringResetAction(input: {
  programTemplateId: string;
}): Promise<ProgramScoringResetPreview> {
  await requirePermission('scoring.run');
  await requirePermission('positions.manage');
  const tenantId = await getCurrentTenantId();
  const program = await resolveProgram(tenantId, input.programTemplateId);

  // Only the current mode's runs, sessions, results and picks (drizzle/0093).
  const demo = await isDemoMode();
  const res = await db.execute(sql`
    WITH pos AS (
      SELECT id FROM critical_positions
       WHERE tenant_id = ${tenantId} AND program_code = ${program.code}
    )
    SELECT
      (SELECT COUNT(*)::int FROM pos)                                              AS positions,
      (SELECT COUNT(DISTINCT sr.position_id)::int FROM scoring_runs sr
         WHERE sr.position_id IN (SELECT id FROM pos) AND sr.is_demo = ${demo})    AS positions_with_runs,
      (SELECT COUNT(*)::int FROM scoring_runs sr
         WHERE sr.position_id IN (SELECT id FROM pos) AND sr.is_demo = ${demo})    AS runs,
      (SELECT COUNT(*)::int FROM scoring_runs sr
         WHERE sr.position_id IN (SELECT id FROM pos) AND sr.status = 'in_progress' AND sr.is_demo = ${demo}) AS in_progress,
      (SELECT COUNT(*)::int FROM tournament_sessions ts
         WHERE ts.position_id IN (SELECT id FROM pos) AND ts.is_demo = ${demo})    AS sessions,
      (SELECT COUNT(*)::int FROM analysis_results ar JOIN scoring_runs sr ON sr.id = ar.run_id
         WHERE ar.position_id IN (SELECT id FROM pos) AND sr.is_demo = ${demo})    AS analysis_results,
      (SELECT COUNT(*)::int FROM position_picks pp
         WHERE pp.position_id IN (SELECT id FROM pos) AND pp.program_code = ${program.code} AND pp.is_demo = ${demo}) AS picks
  `);

  const row = (res.rows as unknown as Array<Record<string, number>>)[0] ?? {};
  return {
    programName: program.name,
    programCode: program.code,
    positions: Number(row.positions ?? 0),
    positionsWithRuns: Number(row.positions_with_runs ?? 0),
    runs: Number(row.runs ?? 0),
    sessions: Number(row.sessions ?? 0),
    analysisResults: Number(row.analysis_results ?? 0),
    picks: Number(row.picks ?? 0),
    inProgress: Number(row.in_progress ?? 0),
  };
}

export type ProgramScoringResetResult = {
  deletedRuns: number;
  deletedSessions: number;
  deletedPicks: number;
  cancelledSessions: number;
};

/**
 * Delete every scoring run, session and result belonging to one program.
 *
 * `confirmName` must equal the program's name. It is checked HERE, not only in
 * the dialog: this is the one action in Position Management with no undo, and a
 * guard that lives in the component is a guard that a second caller does not
 * have.
 */
export async function resetProgramScoringAction(input: {
  programTemplateId: string;
  /** Must match the program name exactly. */
  confirmName: string;
  /** Also delete the chosen successors recorded under this program. */
  deletePicks?: boolean;
}): Promise<ProgramScoringResetResult> {
  await requirePermission('scoring.run');
  await requirePermission('positions.manage');
  const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
  const program = await resolveProgram(tenantId, input.programTemplateId);

  if (input.confirmName?.trim() !== program.name) {
    throw new Error(
      `Ketik nama program "${program.name}" persis untuk mengonfirmasi penghapusan.`,
    );
  }

  const positionRows = await db
    .select({ id: schema.criticalPositions.id })
    .from(schema.criticalPositions)
    .where(
      and(
        eq(schema.criticalPositions.tenantId, tenantId),
        eq(schema.criticalPositions.programCode, program.code),
      ),
    );
  const positionIds = positionRows.map((r) => r.id);
  if (positionIds.length === 0) {
    return { deletedRuns: 0, deletedSessions: 0, deletedPicks: 0, cancelledSessions: 0 };
  }

  // 1. Stop anything still processing. The scoring service is a separate
  //    process: deleting rows under a live worker leaves it writing into
  //    nothing (or violating a foreign key) instead of finishing cleanly.
  const liveSessions = await db
    .select({ id: schema.tournamentSessions.id })
    .from(schema.tournamentSessions)
    .where(
      and(
        inArray(schema.tournamentSessions.positionId, positionIds),
        inArray(schema.tournamentSessions.status, ['running', 'finalizing']),
        await sessionsOfCurrentMode(),
      ),
    );
  let cancelledSessions = 0;
  const serviceUrl = process.env.SCORING_SERVICE_URL?.replace(/\/+$/, '');
  for (const session of liveSessions) {
    if (!serviceUrl) break;
    try {
      await fetch(`${serviceUrl}/api/scoring/${session.id}/cancel`, { method: 'POST' });
      cancelledSessions++;
    } catch {
      // Unreachable service: the session row is deleted below anyway, and the
      // worker's writes will fail against rows that no longer exist.
    }
  }

  // 2. Sessions BEFORE runs. A leftover 'running' session is exactly what the
  //    service's orphan sweeper re-dispatches, so deleting runs first would
  //    invite it to score again into the gap we just made.
  const sessionResult = await db
    .delete(schema.tournamentSessions)
    .where(and(inArray(schema.tournamentSessions.positionId, positionIds), await sessionsOfCurrentMode()))
    .returning({ id: schema.tournamentSessions.id });

  // 3. Runs. Cascades take analysis_results, scoring_run_exclusions,
  //    scoring_run_pool_aspects and the run's chat messages;
  //    position_picks.run_id is set to null rather than deleted.
  const runResult = await db
    .delete(schema.scoringRuns)
    .where(and(inArray(schema.scoringRuns.positionId, positionIds), await runsOfCurrentMode()))
    .returning({ id: schema.scoringRuns.id });

  let deletedPicks = 0;
  if (input.deletePicks) {
    const pickResult = await db
      .delete(schema.positionPicks)
      .where(
        and(
          inArray(schema.positionPicks.positionId, positionIds),
          eq(schema.positionPicks.programCode, program.code),
          await picksOfCurrentMode(),
        ),
      )
      .returning({ id: schema.positionPicks.id });
    deletedPicks = pickResult.length;
  }

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position',
    entityId: tenantId,
    action: 'delete',
    summary:
      `Reset scoring program ${program.name}: ${runResult.length} run dan ${sessionResult.length} sesi dihapus ` +
      `dari ${positionIds.length} posisi` +
      (deletedPicks > 0 ? `, ${deletedPicks} suksesor terpilih ikut dihapus.` : '.'),
  });

  revalidatePath('/positions');
  revalidatePath('/');

  return {
    deletedRuns: runResult.length,
    deletedSessions: sessionResult.length,
    deletedPicks,
    cancelledSessions,
  };
}
