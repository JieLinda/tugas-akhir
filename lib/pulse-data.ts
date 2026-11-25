import 'server-only';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { readinessLabelForRow } from '@/lib/readiness-label';
import { candidateAge } from '@/lib/age';
import { getCurrentUser } from '@/lib/auth';
import {
  isRetiringSoon,
  readRetirementConfig,
  retirementMinAgeFor,
} from '@/lib/retirement-config';
import { listAuditLog } from '@/lib/audit';
import { disciplineLabel, mcuLabel } from '@/lib/candidate-labels';
import { liveCandidate } from '@/lib/candidate-visibility';
import {
  type CandidateLookupItem,
  type CandidateProfile,
  type PositionCandidate,
  type MasterPosition,
  type PositionHolderInfo,
  type ProgramCode,
  type PositionSummary,
  type ReadinessLevel,
} from '@/lib/talent-data';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { listProgramTemplates } from '@/lib/programs';
import { getTalentPoolData } from '@/lib/talent-pool-data';
import { getCurrentTenant, getCurrentTenantId, tenantNameMap } from '@/lib/tenant';
import type { HavSource } from '@/lib/hav-effective';
import { withEffectiveHav } from '@/lib/hav-placements';
import { isDemoMode } from '@/lib/app-mode';
import { forCurrentMode, loadDemoCopies, loadDemoOnIds } from '@/lib/demo/store';
import { picksOfCurrentMode, runsOfCurrentMode } from '@/lib/demo/run-mode';
import { presentCandidateRowForDemo, type DemoTechnicalCompetency } from '@/lib/demo/fields';
import { maskProfileForDemo } from '@/lib/demo/mask';
import { MASKED_CODE, MASKED_NPK } from '@/lib/app-mode-shared';
import {
  QUADRANTS_BY_TALENT_BOX,
  TALENT_BOXES,
  type TalentBox,
} from '@/lib/hav-quadrant-derive';
import { demoInitialsById } from '@/lib/demo/names';

function normalizeStatus(status: string | null): PositionSummary['status'] {
  if (status === 'review' || status === 'draft') return status;
  return 'active';
}

function readinessFromScore(score: number): ReadinessLevel {
  try {
    const raw = readFileSync(join(process.cwd(), 'lib', 'readiness-config.json'), 'utf-8');
    const config = JSON.parse(raw) as { thresholds: { minScore: number; level: string }[]; defaultLevel: string };
    for (const t of config.thresholds) {
      if (score >= t.minScore) return t.level as ReadinessLevel;
    }
    return config.defaultLevel as ReadinessLevel;
  } catch {
    if (score >= 80) return 'Short';
    if (score >= 65) return 'Medium';
    if (score >= 50) return 'Long';
    return 'Not Ready';
  }
}

/**
 * A FINISHED row's readiness label (FR-SN-04): the label stored with the row,
 * else the run's own frozen thresholds applied to its score, else today's —
 * see lib/readiness-label.ts. Never today's thresholds for a run that recorded
 * its own: editing a threshold must not re-label past assessments.
 */
function rowReadiness(
  details: string | null,
  finalScore: unknown,
  snapshotReadiness: unknown,
): ReadinessLevel {
  let parsed: { weightedScore?: number; readiness?: string } | null = null;
  try {
    parsed = details ? (JSON.parse(details) as { weightedScore?: number; readiness?: string }) : null;
  } catch {
    parsed = null;
  }
  const scorePct =
    typeof parsed?.weightedScore === 'number'
      ? parsed.weightedScore
      : Math.round(Number(finalScore) * 100);
  return readinessLabelForRow({
    stored: parsed?.readiness,
    scorePct,
    snapshot: snapshotReadiness,
    live: readinessFromScore,
  }).level as ReadinessLevel;
}

/** `config_snapshot.readiness` of each run, for the rows a reader is about to label. */
async function loadRunReadinessSnapshots(runIds: string[]): Promise<Map<string, unknown>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.scoringRuns.id,
      readiness: sql<unknown>`${schema.scoringRuns.configSnapshot}->'readiness'`,
    })
    .from(schema.scoringRuns)
    .where(inArray(schema.scoringRuns.id, runIds));
  return new Map(rows.map((r) => [r.id, r.readiness]));
}

// disciplineLabel / mcuLabel moved to lib/candidate-labels.ts so the pages that
// render these same columns (Talent Pool, and anything added later) format them
// identically instead of each re-deriving a map. Behaviour here is unchanged —
// the uppercase switch already covered the lowercase cases it listed twice.

function normalizeProgramCode(code: string): ProgramCode | null {
  if (code === 'talent' || code === 'successor' || code === 'emergency') {
    return code;
  }
  return null;
}

function parseCandidateDetails(details: string | null): PositionCandidate | null {
  if (!details) return null;
  try {
    return JSON.parse(details) as PositionCandidate;
  } catch {
    return null;
  }
}

function normalizeEmployeeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.padStart(5, '0');
}

/**
 * Normalize a grade code to a comparison key so "05", "5", and "5A" all map to
 * the same grade level. Falls back to the trimmed raw value when there is no
 * numeric portion.
 */
function normalizeGradeKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  if (match) return String(parseInt(match[0], 10));
  const trimmed = String(value).trim();
  return trimmed || null;
}

/**
 * Build a `gradeKey → levelName` map (e.g. "5" → "Supervisor") for a tenant,
 * resolved through the company→tenant mapping and `sync_grade_levels`.
 */
async function getGradeLevelMap(tenantId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const companyRows = await db
    .select({ companyId: schema.syncCompanyTenantMap.companyId })
    .from(schema.syncCompanyTenantMap)
    .where(
      and(
        eq(schema.syncCompanyTenantMap.tenantId, tenantId),
        eq(schema.syncCompanyTenantMap.isActive, true),
      ),
    );
  const companyIds = companyRows.map((r) => r.companyId);
  if (companyIds.length === 0) return map;

  const rows = await db
    .select({
      gradeId: schema.syncGradeLevels.gradeId,
      levelName: schema.syncGradeLevels.levelName,
    })
    .from(schema.syncGradeLevels)
    .where(inArray(schema.syncGradeLevels.companyId, companyIds));

  for (const r of rows) {
    const key = normalizeGradeKey(r.gradeId);
    if (!key || !r.levelName) continue;
    if (!map.has(key)) map.set(key, r.levelName);
  }
  return map;
}

function buildTopCandidatePreview(
  details: string | null,
  fallbackId: string,
  rank: number,
  fallbackName: string | null = null,
) {
  const parsed = parseCandidateDetails(details);
  // Older runs can carry a snapshot with a null name. Fall back to the live
  // candidates row so the top-candidate list on /positions never shows an
  // anonymous blank.
  const name = parsed?.name || fallbackName;
  if (!parsed && !name) return null;

  return {
    id: parsed?.id || fallbackId,
    name: name || 'Kandidat',
    weightedScore: parsed?.weightedScore ?? 0,
    readiness: parsed?.readiness ?? 'Not Ready',
    rank,
  };
}

/** Candidate names keyed by candidate id, for snapshot-name fallback. */
async function getCandidateNameMap(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({ id: schema.candidates.id, name: schema.candidates.name })
    .from(schema.candidates)
    .where(and(inArray(schema.candidates.id, ids), isNull(schema.candidates.deletedAt)));
  for (const r of rows) {
    if (r.name) map.set(r.id, r.name);
  }
  return map;
}

type CandidateRow = typeof schema.candidates.$inferSelect;

type CandidateTechnicalCompetencyRow = {
  candidateId: string;
  technicalId: string;
  technicalName: string | null;
  proficiencyName: string | null;
  score: number | null;
  currentProficiencyName: string | null;
  currentScore: number | null;
  gap: number | null;
  isManual?: boolean | null;
  sourceKey?: string | null;
};

function mapCandidateRowToProfile(
  /**
   * Route the row through `withEffectiveHav` first: `havQuadrant` must be the
   * HAV IN FORCE (manual > upload > formula) — the value the eligibility rules
   * and both scoring engines read — not the raw Excel column. The profile shows
   * it with its source; `raw.havQuadrant` keeps the Excel value.
   */
  candidate: CandidateRow & { havSource?: HavSource; uploadedHavQuadrant?: string },
  technicalCompetencies: CandidateTechnicalCompetencyRow[] = [],
  positionHistoryRows: Array<{
    positionId: string;
    internalTitle: string | null;
    externalTitle: string | null;
    gradeId: string | null;
    primaryPosition: boolean;
    validFrom: Date | null;
    validTo: Date | null;
  }> = [],
  gradeLevelMap?: Map<string, string>
): CandidateProfile {
  const employeeId = candidate.employeeId || candidate.id.slice(0, 8).toUpperCase();
  const rawPA = candidate.performanceGrade || ",,,,,";
  const paParts = rawPA.split(',');
  const cy = new Date().getFullYear();
  const assessmentHistory = [
    { period: `${cy - 1} S2`, technical: '-', behavior: '-', performance: paParts[0] || '', readiness: 'Medium' as ReadinessLevel },
    { period: `${cy - 1} S1`, technical: '-', behavior: '-', performance: paParts[1] || '', readiness: 'Medium' as ReadinessLevel },
    { period: `${cy - 2} S2`, technical: '-', behavior: '-', performance: paParts[2] || '', readiness: 'Medium' as ReadinessLevel },
    { period: `${cy - 2} S1`, technical: '-', behavior: '-', performance: paParts[3] || '', readiness: 'Medium' as ReadinessLevel },
    { period: `${cy - 3} S2`, technical: '-', behavior: '-', performance: paParts[4] || '', readiness: 'Medium' as ReadinessLevel },
    { period: `${cy - 3} S1`, technical: '-', behavior: '-', performance: paParts[5] || '', readiness: 'Medium' as ReadinessLevel },
  ];

  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email ?? undefined,
    employeeId,
    department: candidate.department ?? '-',
    division: candidate.division ?? '-',
    currentPosition: candidate.currentPosition ?? '-',
    yearsOfService: Number(candidate.yearsExperience ?? 0),
    birthDate: candidate.birthDate ?? null,
    age: candidateAge(candidate.birthDate),
    education: candidate.education ?? '-',
    major: candidate.major ?? '-',
    jobFamily: candidate.department ?? '-',
    grade: candidate.grade ?? null,
    gradeLevel: gradeLevelMap?.get(normalizeGradeKey(candidate.grade) ?? '') ?? null,
    havQuadrant: candidate.havQuadrant ?? null,
    havSource: candidate.havSource,
    uploadedHavQuadrant: candidate.uploadedHavQuadrant ?? null,
    photoUrl: candidate.photoUrl ?? null,
    disciplinaryStatus: disciplineLabel(candidate.disciplineStatus),
    mcuStatus: mcuLabel(candidate.mcuStatus),
    behaviorRecommendation: candidate.behaviorRecommendation,
    behaviorNotes: candidate.behaviorNotes,
    readiness: 'Medium', // placeholder; the wizard's scoring run overrides this
    programs: [],
    assessmentHistory,
    technicalCompetencies: technicalCompetencies.map((item) => ({
      technicalId: item.technicalId,
      technicalName: item.technicalName ?? item.technicalId,
      proficiencyName: item.proficiencyName,
      score: item.score,
      currentProficiencyName: item.currentProficiencyName,
      currentScore: item.currentScore,
      gap: item.gap,
      isManual: item.isManual,
      sourceKey: item.sourceKey,
    })),
    positionHistory: positionHistoryRows.map((row) => ({
      positionId: row.positionId,
      internalTitle: row.internalTitle,
      externalTitle: row.externalTitle,
      gradeId: row.gradeId,
      primaryPosition: row.primaryPosition,
      validFrom: row.validFrom ? row.validFrom.toISOString() : null,
      validTo: row.validTo ? row.validTo.toISOString() : null,
    })),
    raw: {
      employeeId: candidate.employeeId,
      disciplineStatus: candidate.disciplineStatus,
      mcuStatus: candidate.mcuStatus,
      mcuNote: candidate.mcuNote,
      mcuNoteManual: candidate.mcuNoteManual,
      performanceGrade: candidate.performanceGrade,
      // The stored Excel value, not the one in force: `raw` is what the row holds.
      havQuadrant: candidate.uploadedHavQuadrant ?? candidate.havQuadrant,
      behaviorRecommendation: candidate.behaviorRecommendation,
      behaviorNotes: candidate.behaviorNotes,
      photoUrl: candidate.photoUrl,
      education: candidate.education,
      major: candidate.major,
    },
  };
}

// Throttle: the competency sync is a tenant-wide delete+insert. Running it on
// EVERY candidates/dashboard SSR made pages slow (and risked proxy resets), so
// it runs at most once per TTL per tenant per server process. Fresh data still
// lands on the first request after a cold start or TTL expiry.
const SYNC_COMPETENCIES_TTL_MS = 5 * 60 * 1000;
const lastCompetencySyncByTenant = new Map<string, number>();

export async function syncCandidateTechnicalCompetenciesForTenant(tenantId: string) {
  const last = lastCompetencySyncByTenant.get(tenantId) ?? 0;
  if (Date.now() - last < SYNC_COMPETENCIES_TTL_MS) return;
  lastCompetencySyncByTenant.set(tenantId, Date.now());

  // Live candidates only: this is the working set for a delete+insert refresh of
  // candidate_technical_competencies, and tombstones must neither be re-synced
  // nor have their existing (already-scored) competency rows rewritten.
  const candidateRows = await db
    .select({
      id: schema.candidates.id,
      employeeId: schema.candidates.employeeId,
    })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.tenantId, tenantId), liveCandidate()));

  const validCandidates = candidateRows
    .map((row) => ({
      id: row.id,
      employeeId: normalizeEmployeeId(row.employeeId),
    }))
    .filter((row): row is { id: string; employeeId: string } => Boolean(row.employeeId));
  if (validCandidates.length === 0) return;

  const employeeIds = validCandidates.map((row) => row.employeeId);
  const candidateIds = validCandidates.map((row) => row.id);
  const candidateByEmployeeId = new Map(validCandidates.map((row) => [row.employeeId, row.id]));

  const mappingRows = await db
    .select({ companyId: schema.syncCompanyTenantMap.companyId })
    .from(schema.syncCompanyTenantMap)
    .where(
      and(
        eq(schema.syncCompanyTenantMap.tenantId, tenantId),
        eq(schema.syncCompanyTenantMap.isActive, true)
      )
    );

  const companyIds = mappingRows.map((row) => row.companyId);

  const technicalRows = companyIds.length > 0
    ? await db
        .select()
        .from(schema.syncTechnicalCompetencies)
        .where(
          and(
            inArray(schema.syncTechnicalCompetencies.employeeId, employeeIds),
            inArray(schema.syncTechnicalCompetencies.companyId, companyIds),
            eq(schema.syncTechnicalCompetencies.isActive, true)
          )
        )
    : await db
        .select()
        .from(schema.syncTechnicalCompetencies)
        .where(
          and(
            inArray(schema.syncTechnicalCompetencies.employeeId, employeeIds),
            eq(schema.syncTechnicalCompetencies.isActive, true)
          )
        );

  await db
    .delete(schema.candidateTechnicalCompetencies)
    .where(
      and(
        inArray(schema.candidateTechnicalCompetencies.candidateId, candidateIds),
        eq(schema.candidateTechnicalCompetencies.isManual, false)
      )
    );

  if (technicalRows.length === 0) return;

  const values = technicalRows
    .map((row) => {
      const candidateId = candidateByEmployeeId.get(normalizeEmployeeId(row.employeeId) ?? row.employeeId);
      if (!candidateId) return null;
      return {
        candidateId,
        syncTechnicalCompetencyId: row.id,
        technicalId: row.technicalId,
        technicalName: row.technicalName,
        proficiencyId: row.proficiencyId,
        proficiencyName: row.proficiencyName,
        score: row.score,
        currentProficiencyId: row.currentProficiencyId,
        currentProficiencyName: row.currentProficiencyName,
        currentScore: row.currentScore,
        gap: row.gap,
        sourceKey: row.sourceKey,
        syncedAt: row.syncedAt,
      };
    })
    .filter((row): row is NonNullable<typeof row> => !!row);

  if (values.length === 0) return;

  // Collapse per-position duplicates: `sync_technical_competencies` has one row
  // per (employee, position, competency), so a skill required by several of the
  // employee's positions yields several rows that differ only by position. At
  // candidate level the position is irrelevant — keep one row per
  // (candidate, technicalId), preferring the strongest record (highest
  // demonstrated currentScore, then highest target score).
  const strongest = (a: (typeof values)[number], b: (typeof values)[number]) => {
    const cs = (x: (typeof values)[number]) => x.currentScore ?? -1;
    const sc = (x: (typeof values)[number]) => x.score ?? -1;
    if (cs(a) !== cs(b)) return cs(a) > cs(b) ? a : b;
    return sc(a) >= sc(b) ? a : b;
  };
  const dedupeMap = new Map<string, (typeof values)[number]>();
  for (const v of values) {
    const key = `${v.candidateId}::${v.technicalId}`;
    const existing = dedupeMap.get(key);
    dedupeMap.set(key, existing ? strongest(v, existing) : v);
  }
  const uniqueValues = Array.from(dedupeMap.values());

  // Defensive: between the SELECT above and the INSERT below, the
  // candidate row may have been removed (e.g. by a concurrent sync, a
  // position change, or a failed re-populate). Re-validate that every
  // candidate_id still exists to avoid the
  //   insert or update on table "candidate_technical_competencies"
  //   violates foreign key constraint
  // error which would otherwise abort the whole sync for one stale row.
  // Deliberately NOT filtered by deleted_at: this asks "does the row still
  // physically exist", and a tombstone still satisfies the foreign key.
  const requestedCandidateIds = Array.from(new Set(uniqueValues.map((v) => v.candidateId)));
  const existingCandidateRows = await db
    .select({ id: schema.candidates.id })
    .from(schema.candidates)
    .where(inArray(schema.candidates.id, requestedCandidateIds));
  const existingCandidateIds = new Set(existingCandidateRows.map((r) => r.id));
  const safeValues = uniqueValues.filter((v) => existingCandidateIds.has(v.candidateId));
  if (safeValues.length === 0) return;

  await db
    .insert(schema.candidateTechnicalCompetencies)
    .values(safeValues)
    .onConflictDoUpdate({
      target: [
        schema.candidateTechnicalCompetencies.candidateId,
        schema.candidateTechnicalCompetencies.sourceKey,
      ],
      set: {
        syncTechnicalCompetencyId: undefined,
        technicalId: undefined,
        technicalName: undefined,
        proficiencyId: undefined,
        proficiencyName: undefined,
        score: undefined,
        currentProficiencyId: undefined,
        currentProficiencyName: undefined,
        currentScore: undefined,
        gap: undefined,
        syncedAt: undefined,
        updatedAt: new Date(),
      },
    });
}

function mapCandidateRowToPositionCandidate(candidate: CandidateRow): PositionCandidate {
  let pgLatest = 'C';
  if (candidate.performanceGrade) {
    if (candidate.performanceGrade.includes(',')) {
      const parts = candidate.performanceGrade.split(',');
      for (const p of parts) {
        if (p && p.trim() !== '') {
          pgLatest = p;
          break;
        }
      }
    } else if (candidate.performanceGrade.trim() !== '') {
      pgLatest = candidate.performanceGrade;
    }
  }

  return {
    id: candidate.id,
    name: candidate.name,
    photoUrl: candidate.photoUrl ?? null,
    currentPosition: candidate.currentPosition ?? '-',
    yearsOfService: candidate.yearsExperience != null ? Number(candidate.yearsExperience) : 0,
    havQuadrant: candidate.havQuadrant ?? null,
    jobMatch: 0,
    discipline: disciplineLabel(candidate.disciplineStatus),
    mcu: mcuLabel(candidate.mcuStatus),
    performance: pgLatest ?? '-',
    behaviorRecommendation: candidate.behaviorRecommendation,
    behaviorNotes: candidate.behaviorNotes,
    primaryFilter: {
      discipline: (candidate.disciplineStatus ?? '').toUpperCase() === 'CLEAR' ? 'qualified' : 'reject',
      mcu: candidate.mcuStatus === 'fit' || candidate.mcuStatus === 'fit_with_note' ? 'qualified' : 'reject',
      performance:
        pgLatest && ['A', 'B'].includes(pgLatest) ? 'qualified' : 'reject',
      hav: candidate.havQuadrant ? 'qualified' : 'reject',
      behavior: candidate.behaviorRecommendation && /READY/i.test(candidate.behaviorRecommendation) ? 'qualified' : 'reject',
    },
    scoreBreakdown: {
      technical: 0,
      behavior: 0,
      hav: 0,
      performance: 0,
      education: 0,
    },
    weightedScore: 0,
    readiness: 'Medium',
    constraint: '-',
  };
}

/**
 * Deliberately NOT filtered by deleted_at (liveOnly: false). Its only consumer
 * is loadCandidateProfilesForAnalysisAction() in lib/position-detail-actions.ts,
 * which feeds the `profileMap` that enriches a FINISHED run's ranked rows and
 * its position_picks in components/position-detail-tabs.tsx. Dropping a
 * tombstoned finalist here does not remove them from the ranking — it only
 * strips their NPK, photo, technical competencies, work history and education
 * out of the dossier, leaving the run rendered with holes.
 */
export async function getCandidateProfiles(): Promise<CandidateProfile[]> {
  const tenantId = await getCurrentTenantId();
  await syncCandidateTechnicalCompetenciesForTenant(tenantId);
  const { candidates } = await buildCandidateProfiles(tenantId, false);
  return candidates;
}

/**
 * Skinny candidate list for pickers — id/name/employeeId/position only.
 * Unlike getCandidateProfiles() this does NOT join competencies/history or
 * trigger the competency sync, so it is safe to load during SSR.
 */
export async function getCandidateLookup(): Promise<CandidateLookupItem[]> {
  const tenantId = await getCurrentTenantId();
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      employeeId: schema.candidates.employeeId,
      currentPosition: schema.candidates.currentPosition,
      department: schema.candidates.department,
      division: schema.candidates.division,
    })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.tenantId, tenantId), liveCandidate()));
  const demo = await isDemoMode();
  const sorted = (await forCurrentMode(rows, (r) => r.id, { onlyOn: false })).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );
  return sorted.map((r) => ({
    id: r.id,
    name: r.name,
    employeeId: demo ? MASKED_NPK : r.employeeId ?? '',
    currentPosition: r.currentPosition ?? '',
    department: r.department,
    division: r.division,
  }));
}

/**
 * Resolve each candidate id to its owning business unit (tenant) name, across
 * all tenants. Used to show where a candidate came from in a cross-tenant run.
 *
 * Deliberately NOT filtered by deleted_at: the ids come from a finished run's
 * analysis results, so dropping tombstones would blank the business-unit column
 * for rows the ranking still displays.
 */
export async function getCandidateBusinessUnits(
  candidateIds: string[],
): Promise<Record<string, string>> {
  if (candidateIds.length === 0) return {};
  const rows = await db
    .select({ id: schema.candidates.id, tenantId: schema.candidates.tenantId })
    .from(schema.candidates)
    .where(inArray(schema.candidates.id, candidateIds));
  const map: Record<string, string> = {};
  const tenantNames = await tenantNameMap();
  for (const r of rows) {
    const name = tenantNames.get(r.tenantId);
    if (name) map[r.id] = name;
  }
  return map;
}

/**
 * One seat a candidate has been chosen for, from `position_picks` — the same
 * rows Position Management reads for its "Suksesor terpilih" button, so the two
 * pages cannot disagree about who was picked.
 *
 * Grouped by POSITION, with the picks inside. A seat can legitimately carry two
 * picks for one person: `position_picks` is unique on (position, program,
 * candidate), and rows written before a position belonged to exactly one
 * program (drizzle/0056) can hold the same person under two program codes —
 * one candidate in this database does. Listing picks flat would name that seat
 * twice and read as two positions.
 */
export type CandidateSuccessorSeat = {
  positionId: string;
  positionTitle: string;
  department: string | null;
  /**
   * The seat's business unit when it is NOT the one being viewed, else null.
   * Pools span business units, so a Mulia candidate can be picked for an MSO
   * seat. Such picks are shown rather than dropped: the tag answers "has this
   * person been chosen", and hiding a real decision because another unit made
   * it would make the tag lie. The tenant is a cookie any user can switch, so
   * this is not a boundary being crossed — it is a label saying which unit's
   * list the seat lives in, since the link would otherwise land on a position
   * the current tenant's pages do not show.
   */
  otherTenantName: string | null;
  picks: {
    programCode: string;
    /** The template's name in the SEAT's tenant, or the code when none exists. */
    programName: string;
    /** 1-based successor order within that program (`position_picks.rank` is 0-based). */
    order: number;
    readiness: string | null;
  }[];
};

export type CandidateSuccessorFilter = 'chosen' | 'not_chosen';

export function parseCandidateSuccessorFilter(raw: unknown): CandidateSuccessorFilter | null {
  return raw === 'chosen' || raw === 'not_chosen' ? raw : null;
}

/**
 * Every successor pick held by a candidate of this tenant, grouped per seat.
 *
 * Resolved over the whole tenant, not the page, and BEFORE pagination: it is
 * also the filter's predicate, and a filter that selects from a set it counted
 * on twenty rows is the mistake Position Management's flag counts were fixed
 * for. One query — picks are human decisions and stay few (5 rows here), so
 * loading them all is cheaper than threading candidate ids through a second
 * pass.
 */
async function getSuccessorSeatsByCandidate(
  tenantId: string,
): Promise<Map<string, CandidateSuccessorSeat[]>> {
  const rows = await db
    .select({
      candidateId: schema.positionPicks.candidateId,
      positionId: schema.positionPicks.positionId,
      programCode: schema.positionPicks.programCode,
      rank: schema.positionPicks.rank,
      readiness: schema.positionPicks.readiness,
      positionTitle: schema.criticalPositions.title,
      department: schema.criticalPositions.department,
      positionTenantId: schema.criticalPositions.tenantId,
      // Unique on (tenant_id, code), so this join cannot fan a pick out.
      programName: schema.programTemplates.name,
    })
    .from(schema.positionPicks)
    .innerJoin(schema.criticalPositions, eq(schema.positionPicks.positionId, schema.criticalPositions.id))
    .innerJoin(schema.candidates, eq(schema.positionPicks.candidateId, schema.candidates.id))
    .leftJoin(
      schema.programTemplates,
      and(
        eq(schema.programTemplates.tenantId, schema.criticalPositions.tenantId),
        eq(schema.programTemplates.code, schema.positionPicks.programCode),
      ),
    )
    // Demo-mode picks count only in demo mode, real ones only in real mode.
    .where(and(eq(schema.candidates.tenantId, tenantId), await picksOfCurrentMode()))
    .orderBy(
      asc(schema.criticalPositions.title),
      asc(schema.positionPicks.programCode),
      asc(schema.positionPicks.rank),
    );

  const tenantName = await tenantNameMap();
  const byCandidate = new Map<string, Map<string, CandidateSuccessorSeat>>();
  for (const row of rows) {
    const seats = byCandidate.get(row.candidateId) ?? new Map<string, CandidateSuccessorSeat>();
    let seat = seats.get(row.positionId);
    if (!seat) {
      seat = {
        positionId: row.positionId,
        positionTitle: row.positionTitle,
        department: row.department ?? null,
        otherTenantName:
          row.positionTenantId === tenantId ? null : (tenantName.get(row.positionTenantId) ?? 'unit lain'),
        picks: [],
      };
      seats.set(row.positionId, seat);
    }
    seat.picks.push({
      programCode: row.programCode,
      programName: row.programName ?? row.programCode,
      order: row.rank + 1,
      readiness: row.readiness ?? null,
    });
    byCandidate.set(row.candidateId, seats);
  }

  return new Map(Array.from(byCandidate, ([id, seats]) => [id, Array.from(seats.values())]));
}

export async function getCandidateProfilesPage(
  page: number,
  pageSize: number,
  query: string,
  sortBy: 'name' | 'department',
  department?: string,
  division?: string,
  level?: string,
  successor?: CandidateSuccessorFilter | null,
  /** Demo mode only: ON / OFF candidates. */
  demoState?: 'on' | 'off' | null,
): Promise<{
  candidates: CandidateProfile[];
  total: number;
  /** Seats per candidate ON THIS PAGE; a candidate with no entry was never picked. */
  successorSeats: Record<string, CandidateSuccessorSeat[]>;
}> {
  const tenantId = await getCurrentTenantId();
  await syncCandidateTechnicalCompetenciesForTenant(tenantId);
  const seatsByCandidate = await getSuccessorSeatsByCandidate(tenantId);
  // The Kandidat table — a list, so tombstones must not appear (liveOnly: true).
  const { candidates, total } = await buildCandidateProfiles(
    tenantId,
    true,
    page,
    pageSize,
    query,
    sortBy,
    department,
    division,
    level,
    successor ? { mode: successor, chosenIds: new Set(seatsByCandidate.keys()) } : undefined,
    demoState,
    // Demo mode: the list searches and sorts on the initials it shows, so typing
    // a real name finds nobody rather than revealing whose initials those are.
    await demoInitialsById(),
  );
  const successorSeats: Record<string, CandidateSuccessorSeat[]> = {};
  for (const candidate of candidates) {
    const seats = seatsByCandidate.get(candidate.id);
    if (seats) successorSeats[candidate.id] = seats;
  }
  return { candidates, total, successorSeats };
}

export async function getCandidateById(id: string): Promise<CandidateProfile | null> {
  const tenantId = await getCurrentTenantId();
  await syncCandidateTechnicalCompetenciesForTenant(tenantId);

  const [row] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, id), eq(schema.candidates.tenantId, tenantId), liveCandidate()))
    .limit(1);
  if (!row) return null;

  // Demo mode: the candidate as its demo copy, without a photo (lib/demo/).
  const demo = await isDemoMode();
  const demoCopy = demo ? (await loadDemoCopies([row.id])).get(row.id) ?? null : null;
  const demoOn = demo ? (await loadDemoOnIds([row.id])).has(row.id) : false;
  const shown = demo ? presentCandidateRowForDemo(row, demoCopy) : row;

  const [technicalRows, historyRows, gradeLevelMap] = await Promise.all([
    db
      .select({
        candidateId: schema.candidateTechnicalCompetencies.candidateId,
        technicalId: schema.candidateTechnicalCompetencies.technicalId,
        technicalName: schema.candidateTechnicalCompetencies.technicalName,
        proficiencyName: schema.candidateTechnicalCompetencies.proficiencyName,
        score: schema.candidateTechnicalCompetencies.score,
        currentProficiencyName: schema.candidateTechnicalCompetencies.currentProficiencyName,
        currentScore: schema.candidateTechnicalCompetencies.currentScore,
        gap: schema.candidateTechnicalCompetencies.gap,
        isManual: schema.candidateTechnicalCompetencies.isManual,
        sourceKey: schema.candidateTechnicalCompetencies.sourceKey,
      })
      .from(schema.candidateTechnicalCompetencies)
      .where(eq(schema.candidateTechnicalCompetencies.candidateId, row.id)),
    db
      .select({
        candidateId: schema.candidatePositionHistory.candidateId,
        positionId: schema.candidatePositionHistory.positionId,
        internalTitle: schema.candidatePositionHistory.internalTitle,
        externalTitle: schema.candidatePositionHistory.externalTitle,
        gradeId: schema.candidatePositionHistory.gradeId,
        primaryPosition: schema.candidatePositionHistory.primaryPosition,
        validFrom: schema.candidatePositionHistory.validFrom,
        validTo: schema.candidatePositionHistory.validTo,
      })
      .from(schema.candidatePositionHistory)
      .where(eq(schema.candidatePositionHistory.candidateId, row.id))
      .orderBy(asc(schema.candidatePositionHistory.validFrom)),
    getGradeLevelMap(tenantId),
  ]);

  const [withHav] = await withEffectiveHav([shown]);
  const profile = mapCandidateRowToProfile(
    withHav!,
    demoCopy?.technicalCompetencies ? demoCompetencyRows(row.id, demoCopy.technicalCompetencies) : technicalRows,
    historyRows,
    gradeLevelMap,
  );
  return demo ? maskProfileForDemo({ ...profile, demo: { on: demoOn, edited: Boolean(demoCopy) } }) : profile;
}

/**
 * Candidate ids of everyone sitting in this seat now — resolved HERE from the
 * real NPKs, so the client never has to compare NPKs (demo mode masks every NPK
 * it receives, which would make every masked value "equal"). NPK identity as
 * the position tabs used: numeric ids padded to 5, others as written — not
 * LPAD, which truncates a longer non-numeric id.
 */
export async function getIncumbentCandidateIds(positionId: string): Promise<string[]> {
  const tenantId = await getCurrentTenantId();
  const res = await db.execute(sql`
    WITH holders AS (
      SELECT h.employee_id AS npk
        FROM critical_position_holders h
        JOIN critical_positions cp ON cp.id = h.position_id AND cp.tenant_id = ${tenantId}
       WHERE h.position_id = ${positionId}
      UNION
      SELECT cp.holder_employee_id
        FROM critical_positions cp
       WHERE cp.id = ${positionId} AND cp.tenant_id = ${tenantId} AND cp.holder_employee_id IS NOT NULL
    ),
    keys AS (
      SELECT CASE WHEN btrim(npk) ~ '^[0-9]+$' THEN lpad(btrim(npk), 5, '0') ELSE btrim(npk) END AS k
        FROM holders WHERE npk IS NOT NULL AND btrim(npk) <> ''
    )
    SELECT DISTINCT c.id::text AS id
      FROM candidates c
      JOIN keys ON keys.k = CASE WHEN btrim(c.employee_id) ~ '^[0-9]+$'
                                 THEN lpad(btrim(c.employee_id), 5, '0')
                                 ELSE btrim(c.employee_id) END
  `);
  return (res.rows as { id: string }[]).map((r) => r.id);
}

export type IncumbentInfo = {
  name: string;
  employeeId: string;
  /** Full profile when the incumbent exists as a candidate row; null otherwise. */
  profile: CandidateProfile | null;
};

/**
 * The position's current holder (incumbent) as a benchmark reference. Loads
 * their full profile (technical competencies, HAV, etc.) from the candidates
 * table by employee id when available; falls back to name/id only.
 */
export async function getPositionIncumbentProfile(positionId: string): Promise<IncumbentInfo | null> {
  const info = await loadPositionIncumbentProfile(positionId);
  if (!info || !(await isDemoMode())) return info;
  // Demo mode: the incumbent as their demo copy, no NPK (the name falls back
  // to the NPK when the record has none), no photo.
  const masked = info.name && info.name === info.employeeId ? 'Pemegang jabatan' : info.name;
  return { name: masked, employeeId: MASKED_NPK, profile: info.profile ? maskProfileForDemo(info.profile) : null };
}

async function loadPositionIncumbentProfile(positionId: string): Promise<IncumbentInfo | null> {
  const tenantId = await getCurrentTenantId();
  const [pos] = await db
    .select({
      holderName: schema.criticalPositions.holderName,
      holderEmployeeId: schema.criticalPositions.holderEmployeeId,
    })
    .from(schema.criticalPositions)
    .where(and(eq(schema.criticalPositions.id, positionId), eq(schema.criticalPositions.tenantId, tenantId)))
    .limit(1);

  if (!pos || (!pos.holderName && !pos.holderEmployeeId)) return null;

  const rawEid = pos.holderEmployeeId?.trim() ?? '';
  const name = pos.holderName ?? rawEid ?? 'Incumbent';
  if (!rawEid) return { name, employeeId: '-', profile: null };

  const eidVariants = Array.from(new Set([rawEid, rawEid.padStart(5, '0')]));
  // Identity resolution, so tombstones are excluded — a soft-deleted row must
  // not win this LIMIT 1 and hand the incumbent a stale benchmark profile.
  // The remaining tie must resolve to the spelling actually recorded in
  // critical_positions.holder_employee_id: the padded and unpadded NPKs can be
  // two distinct candidate rows with different technical-competency and
  // position-history children, and ordering by employee_id alone would always
  // pick the zero-padded one ('00682' < '0682') regardless of what the position
  // holds. Exact match first, padded variant only as a fallback, then id so the
  // result stays deterministic.
  const [row] = await db
    .select()
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.tenantId, tenantId),
        inArray(schema.candidates.employeeId, eidVariants),
        liveCandidate(),
      ),
    )
    .orderBy(
      sql`CASE WHEN ${schema.candidates.employeeId} = ${rawEid} THEN 0 ELSE 1 END`,
      asc(schema.candidates.id),
    )
    .limit(1);

  if (!row) return { name, employeeId: rawEid, profile: null };


  const [technicalRows, historyRows, gradeLevelMap] = await Promise.all([
    db
      .select({
        candidateId: schema.candidateTechnicalCompetencies.candidateId,
        technicalId: schema.candidateTechnicalCompetencies.technicalId,
        technicalName: schema.candidateTechnicalCompetencies.technicalName,
        proficiencyName: schema.candidateTechnicalCompetencies.proficiencyName,
        score: schema.candidateTechnicalCompetencies.score,
        currentProficiencyName: schema.candidateTechnicalCompetencies.currentProficiencyName,
        currentScore: schema.candidateTechnicalCompetencies.currentScore,
        gap: schema.candidateTechnicalCompetencies.gap,
        isManual: schema.candidateTechnicalCompetencies.isManual,
        sourceKey: schema.candidateTechnicalCompetencies.sourceKey,
      })
      .from(schema.candidateTechnicalCompetencies)
      .where(eq(schema.candidateTechnicalCompetencies.candidateId, row.id)),
    db
      .select({
        candidateId: schema.candidatePositionHistory.candidateId,
        positionId: schema.candidatePositionHistory.positionId,
        internalTitle: schema.candidatePositionHistory.internalTitle,
        externalTitle: schema.candidatePositionHistory.externalTitle,
        gradeId: schema.candidatePositionHistory.gradeId,
        primaryPosition: schema.candidatePositionHistory.primaryPosition,
        validFrom: schema.candidatePositionHistory.validFrom,
        validTo: schema.candidatePositionHistory.validTo,
      })
      .from(schema.candidatePositionHistory)
      .where(eq(schema.candidatePositionHistory.candidateId, row.id))
      .orderBy(asc(schema.candidatePositionHistory.validFrom)),
    getGradeLevelMap(tenantId),
  ]);

  const [shown] = await forCurrentMode([row], (c) => c.id, { onlyOn: false });
  const [withHav] = await withEffectiveHav([shown!]);
  const profile = mapCandidateRowToProfile(withHav!, technicalRows, historyRows, gradeLevelMap);
  return { name: shown!.name, employeeId: row.employeeId ?? rawEid, profile };
}

export type CandidateRunHistoryEntry = {
  runId: string;
  positionId: string;
  positionTitle: string;
  department: string | null;
  program: string | null;
  method: string;
  label: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  rank: number;
  finalScore: number;
  readiness: ReadinessLevel;
  totalRanked: number;
};

/**
 * Scoring-run history for a single candidate: every run (in the current tenant)
 * that ranked this candidate, with their rank / score / readiness in each.
 * Newest run first.
 */
export async function getCandidateRunHistory(
  candidateId: string,
  /**
   * Narrow to one position. The candidate detail page loads only the newest run
   * per position up front and asks for a position's full history when the
   * reader expands it — a candidate here has 32 runs across 9 positions, and
   * shipping all of them to answer "where does this person stand" was most of
   * that section's weight.
   */
  positionId?: string,
): Promise<CandidateRunHistoryEntry[]> {
  const tenantId = await getCurrentTenantId();

  const rows = await db
    .select({
      runId: schema.analysisResults.runId,
      rank: schema.analysisResults.rank,
      manualRank: schema.analysisResults.manualRank,
      finalScore: schema.analysisResults.finalScore,
      details: schema.analysisResults.details,
      method: schema.scoringRuns.method,
      program: schema.scoringRuns.program,
      label: schema.scoringRuns.label,
      status: schema.scoringRuns.status,
      createdAt: schema.scoringRuns.createdAt,
      completedAt: schema.scoringRuns.completedAt,
      positionId: schema.scoringRuns.positionId,
      positionTitle: schema.criticalPositions.title,
      department: schema.criticalPositions.department,
      snapshotReadiness: sql<unknown>`${schema.scoringRuns.configSnapshot}->'readiness'`,
    })
    .from(schema.analysisResults)
    .innerJoin(schema.scoringRuns, eq(schema.analysisResults.runId, schema.scoringRuns.id))
    .innerJoin(schema.criticalPositions, eq(schema.scoringRuns.positionId, schema.criticalPositions.id))
    .where(
      and(
        eq(schema.analysisResults.candidateId, candidateId),
        eq(schema.scoringRuns.tenantId, tenantId),
        await runsOfCurrentMode(),
        ...(positionId ? [eq(schema.scoringRuns.positionId, positionId)] : []),
      ),
    )
    .orderBy(desc(schema.scoringRuns.createdAt));

  if (rows.length === 0) return [];

  // Finalist count per run for "rank X of N".
  const runIds = Array.from(new Set(rows.map((r) => r.runId).filter((x): x is string => Boolean(x))));
  const counts = runIds.length
    ? await db
        .select({ runId: schema.analysisResults.runId, count: sql<number>`count(*)` })
        .from(schema.analysisResults)
        .where(inArray(schema.analysisResults.runId, runIds))
        .groupBy(schema.analysisResults.runId)
    : [];
  const countByRun = new Map(counts.map((c) => [c.runId, Number(c.count)]));

  return rows.map((r) => {
    // final_score is stored as a 0-1 fraction (weightedScore/100). The 0-100
    // percentage lives in details.weightedScore — prefer it, and fall back to
    // scaling the fraction so old rows without details still read correctly.
    let scorePct: number;
    let readiness: ReadinessLevel;
    try {
      const parsed = r.details
        ? (JSON.parse(r.details) as { weightedScore?: number; readiness?: ReadinessLevel })
        : null;
      scorePct =
        typeof parsed?.weightedScore === 'number'
          ? parsed.weightedScore
          : Math.round(Number(r.finalScore) * 100);
    } catch {
      scorePct = Math.round(Number(r.finalScore) * 100);
    }
    readiness = rowReadiness(r.details, r.finalScore, r.snapshotReadiness);
    return {
      runId: r.runId!,
      positionId: r.positionId,
      positionTitle: r.positionTitle,
      department: r.department,
      program: r.program,
      method: r.method,
      label: r.label,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      rank: r.manualRank ?? r.rank,
      finalScore: scorePct,
      readiness,
      totalRanked: countByRun.get(r.runId) ?? 0,
    };
  });
}

/**
 * @param liveOnly Exclude soft-deleted candidates. This builder is dual-purpose:
 *   the Kandidat table (a list — category 1, must filter) and the dossier /
 *   comparison tabs (history enrichment — category 2, must NOT filter, or a
 *   finished ranking renders with holes). See lib/candidate-visibility.ts.
 *   Defaults to false so that, as everywhere else in this repo, hiding
 *   tombstones is something a call site explicitly says rather than something
 *   a shared helper does silently — the failure mode of a filter nobody asked
 *   for (missing rows in a completed run) is invisible, while the opposite is
 *   visible in the list itself.
 */
async function buildCandidateProfiles(
  tenantId: string,
  liveOnly: boolean = false,
  page?: number,
  pageSize?: number,
  query?: string,
  sortBy: 'name' | 'department' = 'name',
  department?: string,
  division?: string,
  level?: string,
  /**
   * Keeps only candidates who have (or have not) been picked as a successor.
   * The caller supplies the id set rather than this builder querying picks, so
   * the loaders that do not need it — `getCandidateProfiles` and its readers —
   * pay nothing for it.
   */
  successorFilter?: { mode: CandidateSuccessorFilter; chosenIds: Set<string> },
  /** Demo mode only: keep only ON or only OFF candidates. Ignored in real mode. */
  demoState?: 'on' | 'off' | null,
  /**
   * Demo mode only (the Kandidat list): candidate id → initials, which REPLACE
   * the name before search, sort and display — so nothing in the list answers
   * to, or orders by, a real name. See lib/demo/names.ts.
   */
  demoInitials?: ReadonlyMap<string, string> | null,
): Promise<{ candidates: CandidateProfile[]; total: number }> {
  const gradeLevelMap = await getGradeLevelMap(tenantId);

  // Fetch the tenant's rows, then apply search / filter / sort / pagination in
  // the application layer (demo copies must be applied before any of it).
  // Candidate counts per tenant are small enough (hundreds) that loading the
  // live set is not a problem.
  const whereConditions = [eq(schema.candidates.tenantId, tenantId)];
  if (liveOnly) {
    whereConditions.push(liveCandidate());
  }

  const rows = await db
    .select()
    .from(schema.candidates)
    .where(and(...whereConditions));

  let filtered = rows;

  // Demo mode: every candidate as its demo copy (lib/demo/), photos removed —
  // BEFORE search/filter/sort, so the list searches what it shows. OFF
  // candidates stay in THIS list (it is where they are switched back on) and
  // carry their state for the badge and the actions.
  const demo = await isDemoMode();
  const demoCopies = demo ? await loadDemoCopies(filtered.map((r) => r.id)) : null;
  const demoOn = demo ? await loadDemoOnIds(filtered.map((r) => r.id)) : null;
  if (demo) filtered = filtered.map((r) => presentCandidateRowForDemo(r, demoCopies!.get(r.id)));
  if (demo && demoInitials) filtered = filtered.map((r) => ({ ...r, name: demoInitials.get(r.id) ?? r.name }));
  if (demo && demoState) filtered = filtered.filter((r) => demoOn!.has(r.id) === (demoState === 'on'));

  if (query) {
    const q = query.toLowerCase();
    filtered = filtered.filter((r) =>
      // Demo mode masks the NPK everywhere, so it must not be searchable either:
      // a search that finds someone by NPK would unmask them.
      [r.name, demo ? null : r.employeeId, r.currentPosition, r.department].some(
        (v) => v != null && v.toLowerCase().includes(q),
      ),
    );
  }

  if (department) {
    filtered = filtered.filter((r) => r.department === department);
  }

  if (division) {
    filtered = filtered.filter((r) => r.division === division);
  }

  if (level) {
    const grades = await getGradesForLevel(tenantId, level, gradeLevelMap);
    if (grades.length === 0) return { candidates: [], total: 0 };
    const gradeSet = new Set(grades);
    filtered = filtered.filter((r) => r.grade != null && gradeSet.has(r.grade));
  }

  if (successorFilter) {
    const { mode, chosenIds } = successorFilter;
    filtered = filtered.filter((r) => chosenIds.has(r.id) === (mode === 'chosen'));
  }

  const total = filtered.length;

  const sorted = [...filtered].sort((a, b) => {
    const left = (sortBy === 'department' ? a.department : a.name) ?? '';
    const right = (sortBy === 'department' ? b.department : b.name) ?? '';
    return left.localeCompare(right);
  });

  const hasPagination = page != null && pageSize != null;
  const paged = hasPagination
    ? sorted.slice((page! - 1) * pageSize!, page! * pageSize!)
    : sorted;

  if (paged.length === 0) return { candidates: [], total };

  const candidateIds = paged.map((row) => row.id);
  const [technicalRows, historyRows] = await Promise.all([
    candidateIds.length > 0
      ? db
          .select({
            candidateId: schema.candidateTechnicalCompetencies.candidateId,
            technicalId: schema.candidateTechnicalCompetencies.technicalId,
            technicalName: schema.candidateTechnicalCompetencies.technicalName,
            proficiencyName: schema.candidateTechnicalCompetencies.proficiencyName,
            score: schema.candidateTechnicalCompetencies.score,
            currentProficiencyName: schema.candidateTechnicalCompetencies.currentProficiencyName,
            currentScore: schema.candidateTechnicalCompetencies.currentScore,
            gap: schema.candidateTechnicalCompetencies.gap,
            isManual: schema.candidateTechnicalCompetencies.isManual,
            sourceKey: schema.candidateTechnicalCompetencies.sourceKey,
          })
          .from(schema.candidateTechnicalCompetencies)
          .where(inArray(schema.candidateTechnicalCompetencies.candidateId, candidateIds))
      : [],
    candidateIds.length > 0
      ? db
          .select({
            candidateId: schema.candidatePositionHistory.candidateId,
            positionId: schema.candidatePositionHistory.positionId,
            internalTitle: schema.candidatePositionHistory.internalTitle,
            externalTitle: schema.candidatePositionHistory.externalTitle,
            gradeId: schema.candidatePositionHistory.gradeId,
            primaryPosition: schema.candidatePositionHistory.primaryPosition,
            validFrom: schema.candidatePositionHistory.validFrom,
            validTo: schema.candidatePositionHistory.validTo,
          })
          .from(schema.candidatePositionHistory)
          .where(inArray(schema.candidatePositionHistory.candidateId, candidateIds))
          .orderBy(
            asc(schema.candidatePositionHistory.candidateId),
            asc(schema.candidatePositionHistory.validFrom),
          )
      : [],
  ]);

  const technicalByCandidateId = new Map<string, (typeof technicalRows)[number][]>();
  for (const row of technicalRows) {
    const bucket = technicalByCandidateId.get(row.candidateId) ?? [];
    bucket.push(row);
    technicalByCandidateId.set(row.candidateId, bucket);
  }

  type HistoryRow = (typeof historyRows)[number];
  const historyByCandidateId = new Map<string, HistoryRow[]>();
  for (const row of historyRows) {
    const bucket = historyByCandidateId.get(row.candidateId) ?? [];
    bucket.push(row);
    historyByCandidateId.set(row.candidateId, bucket);
  }

  // Only the page being rendered pays for the placement lookup.
  const candidates = (await withEffectiveHav(paged)).map((row) => {
    const copy = demoCopies?.get(row.id) ?? null;
    const profile = mapCandidateRowToProfile(
      row,
      copy?.technicalCompetencies ? demoCompetencyRows(row.id, copy.technicalCompetencies) : technicalByCandidateId.get(row.id) ?? [],
      historyByCandidateId.get(row.id) ?? [],
      gradeLevelMap,
    );
    return demo ? maskProfileForDemo({ ...profile, demo: { on: demoOn!.has(row.id), edited: Boolean(copy) } }) : profile;
  });

  return { candidates, total };
}

/** A demo copy's competency list in the shape the profile builder takes from the database. */
function demoCompetencyRows(candidateId: string, list: DemoTechnicalCompetency[]): CandidateTechnicalCompetencyRow[] {
  return list.map((c) => ({
    candidateId,
    technicalId: c.technicalId,
    technicalName: c.technicalName,
    proficiencyName: c.proficiencyName,
    score: c.score,
    currentProficiencyName: c.currentProficiencyName,
    currentScore: c.currentScore,
    gap: c.gap,
    isManual: c.isManual ?? true,
    sourceKey: c.sourceKey ?? `manual_${c.technicalId}`,
  }));
}

export async function getLookupDepartments(): Promise<string[]> {
  const rows = await db
    .select({ name: schema.syncDepartments.departmentName })
    .from(schema.syncDepartments)
    .orderBy(asc(schema.syncDepartments.departmentName));
  return Array.from(new Set(rows.map((r) => r.name).filter(Boolean))) as string[];
}

export async function getLookupDivisions(): Promise<string[]> {
  const rows = await db
    .select({ name: schema.syncDivisions.divisionName })
    .from(schema.syncDivisions)
    .orderBy(asc(schema.syncDivisions.divisionName));
  return Array.from(new Set(rows.map((r) => r.name).filter(Boolean))) as string[];
}

export async function getLookupPositions(): Promise<string[]> {
  const tenantId = await getCurrentTenantId();
  const rows = await db
    .select({
      internal: schema.positions.internalTitle,
      external: schema.positions.externalTitle,
    })
    .from(schema.positions)
    .where(eq(schema.positions.tenantId, tenantId))
    .orderBy(asc(schema.positions.internalTitle));
  const titles = rows.map((r) => r.internal ?? r.external).filter(Boolean) as string[];
  return Array.from(new Set(titles)).sort();
}

export async function getLookupTechnicalCompetencies(): Promise<{ technicalId: string; technicalName: string }[]> {
  const rows = await db
    .select({
      id: schema.syncTechnicalCompetencies.technicalId,
      name: schema.syncTechnicalCompetencies.technicalName,
    })
    .from(schema.syncTechnicalCompetencies)
    .orderBy(asc(schema.syncTechnicalCompetencies.technicalName));

  const seen = new Set<string>();
  const results: { technicalId: string; technicalName: string }[] = [];
  for (const r of rows) {
    if (r.id && r.name && !seen.has(r.id)) {
      seen.add(r.id);
      results.push({ technicalId: r.id, technicalName: r.name });
    }
  }
  return results;
}

/**
 * Master positions for the "Jabatan Master" picker, each already carrying its
 * active incumbent — resolved the same way `resolveHolderForPositionAction`
 * does (sync_employee_positions → sync_employees/candidates), so the picker
 * label and the value the dialog fills in can never disagree.
 *
 * `positions` is upserted by sync-service and never pruned, so it accumulates
 * rows for position ids that expired years ago. Those look identical to the
 * live row in a title-only picker but have no active holder, which is how users
 * ended up selecting a position whose "pejabat" field then stayed empty. Dead
 * rows are dropped here — but only when they *also* have no active holder,
 * because some employees still sit on an expired position id.
 */
export async function getMasterPositions(): Promise<MasterPosition[]> {
  const demo = await isDemoMode(); // demo mode: no NPK leaves the server
  const tenantId = await getCurrentTenantId();

  const res = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (p.id)
        p.id::text AS "id",
        COALESCE(p.internal_title, p.external_title) AS "title",
        p.department AS "department",
        p.division AS "division",
        p.summary AS "description",
        COALESCE(c.name, se.display_name, se.internal_title) AS "holderName",
        -- sync_employee_positions ids are 5-digit zero-padded ("00682"); drop the
        -- leading 0 to match the 4-digit form used by candidates/sync_employees.
        COALESCE(c.employee_id, regexp_replace(sep.employee_id, '^0', '')) AS "holderEmployeeId",
        sep.valid_from::date::text AS "holderSince",
        (SELECT count(*) FROM sync_employee_positions s2
          WHERE s2.company_id = sp.company_id AND s2.position_id = sp.position_id
            AND s2.valid_to > CURRENT_DATE)::int AS "activeHolderCount"
      FROM positions p
      LEFT JOIN sync_positions sp ON sp.id = p.sync_position_id
      LEFT JOIN sync_employee_positions sep
        ON sep.company_id = sp.company_id AND sep.position_id = sp.position_id
       AND sep.valid_to > CURRENT_DATE
      LEFT JOIN sync_employees se
        ON se.company_id = sep.company_id AND LPAD(se.employee_id, 5, '0') = sep.employee_id
      -- Soft-deleted candidates do not resolve here: a tombstone must not lend
      -- its name/NPK to a live position. The join stays a LEFT JOIN, so the
      -- holder simply falls back to sync_employees instead of disappearing.
      LEFT JOIN candidates c
        ON LPAD(c.employee_id, 5, '0') = sep.employee_id AND c.tenant_id = ${tenantId}
       AND c.deleted_at IS NULL
      WHERE p.tenant_id = ${tenantId}
        AND (sp.id IS NULL OR sp.valid_to > CURRENT_DATE OR sep.id IS NOT NULL)
      -- Final key must stay in lockstep with resolveHolderForPositionAction: a
      -- position can have several equally-ranked active holders, and without a
      -- deterministic tiebreak the name shown in the picker and the name the
      -- dialog fills in can come out different. The c.deleted_at IS NULL join
      -- condition is part of that contract -- it decides (c.id IS NOT NULL).
      ORDER BY p.id, (c.id IS NOT NULL) DESC, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST, sep.employee_id ASC
    ) x
    ORDER BY x.title ASC
  `);

  const rows = res.rows as Array<{
    id: string;
    title: string | null;
    department: string | null;
    division: string | null;
    description: string | null;
    holderName: string | null;
    holderEmployeeId: string | null;
    holderSince: string | null;
    activeHolderCount: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? 'Unknown Position',
    department: row.department,
    division: row.division,
    level: null, // Master positions might not have level in `positions` table, need to check
    description: row.description,
    currentHolder: row.holderName
      ? {
          name: row.holderName ?? '',
          employeeId: demo ? MASKED_NPK : row.holderEmployeeId ?? '',
          since: row.holderSince,
        }
      : undefined,
    activeHolderCount: row.activeHolderCount ?? 0,
  }));
}

/** Coverage buckets behind the dashboard "Readiness Bands" card, in percent.
 *  Kept in sync with the band thresholds in `getDashboardOverview`. */
export const READINESS_BANDS = {
  strong: { label: 'Strong bench', min: 80, maxExclusive: 101 },
  watchlist: { label: 'Watchlist', min: 50, maxExclusive: 80 },
  critical: { label: 'Critical gap', min: 0, maxExclusive: 50 },
} as const;

export type ReadinessBandKey = keyof typeof READINESS_BANDS;

export function parseReadinessBand(value: unknown): ReadinessBandKey | null {
  return value === 'strong' || value === 'watchlist' || value === 'critical' ? value : null;
}

/**
 * How a position's bench actually stands, as three mutually exclusive states
 * that add up to the position count.
 *
 * This replaced the "Coverage readiness" percentage on Position Management,
 * which was unreadable in three separate ways. It **shared its name with the
 * dashboard figure while measuring something else**: there, ready candidates ÷
 * scored candidates; here, positions holding any ready candidate ÷ positions —
 * so one phrase produced two different numbers on two screens. It was
 * **counted client-side over the twenty rows on the page**, the exact mistake
 * the flag counts beside it were fixed for, so it moved when you paged. And a
 * single percentage **folds "nobody is ready yet" together with "nobody has
 * been assessed yet"**, which are not the same finding and do not have the
 * same fix — one needs development, the other needs a scoring run.
 */
export type PositionBenchKey = 'ready' | 'not_ready' | 'unscored';

const POSITION_BENCH_KEYS: PositionBenchKey[] = ['ready', 'not_ready', 'unscored'];

export function parsePositionBench(raw: unknown): PositionBenchKey | null {
  // `?readiness=ready` is the dashboard's own link and predates this; it keeps
  // working rather than becoming a URL that silently shows everything.
  if (raw === 'ready') return 'ready';
  const value = typeof raw === 'string' ? raw : '';
  return (POSITION_BENCH_KEYS as string[]).includes(value) ? (value as PositionBenchKey) : null;
}

export type PositionBenchCounts = Record<PositionBenchKey, number>;

/**
 * The single place a readiness stat becomes a bench state, so the count, the
 * filter and the bar can never disagree about which bucket a position is in.
 */
export function benchStateFor(stat: { total: number; ready: number }): PositionBenchKey {
  if (stat.total === 0) return 'unscored';
  return stat.ready > 0 ? 'ready' : 'not_ready';
}

type PositionReadinessStat = { total: number; ready: number; coverage: number };
const EMPTY_READINESS_STAT: PositionReadinessStat = { total: 0, ready: 0, coverage: 0 };

/**
 * Ready/total/coverage per position, derived from each position's latest
 * completed run. `readinessCoverage` is not a stored column, so the dashboard
 * drill-downs (`?readiness=ready`, `?band=…`) have to resolve it here — before
 * pagination — rather than in the SQL WHERE clause.
 */
async function getReadinessStatsByPosition(
  positionIds: string[],
  program?: string,
): Promise<Map<string, PositionReadinessStat>> {
  const stats = new Map<string, PositionReadinessStat>();
  if (positionIds.length === 0) return stats;

  const runRows = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
      program: schema.scoringRuns.program,
      status: schema.scoringRuns.status,
    })
    .from(schema.scoringRuns)
    .where(and(await runsOfCurrentMode(), inArray(schema.scoringRuns.positionId, positionIds)))
    .orderBy(asc(schema.scoringRuns.positionId), asc(schema.scoringRuns.createdAt));

  // Ordered by createdAt ASC, so the last write per position wins — same
  // "latest completed run" rule the paginated loader below uses.
  const latestRunByPosition = new Map<string, string>();
  for (const run of runRows) {
    if (program && run.program !== program) continue;
    if (run.status === 'in_progress' || run.status === 'draft') continue;
    latestRunByPosition.set(run.positionId, run.id);
  }

  const runIds = Array.from(new Set(latestRunByPosition.values()));
  if (runIds.length === 0) return stats;

  const [resultRows, snapshots] = await Promise.all([
    db
      .select({
        runId: schema.analysisResults.runId,
        positionId: schema.analysisResults.positionId,
        finalScore: schema.analysisResults.finalScore,
        details: schema.analysisResults.details,
      })
      .from(schema.analysisResults)
      .where(inArray(schema.analysisResults.runId, runIds)),
    loadRunReadinessSnapshots(runIds),
  ]);

  for (const row of resultRows) {
    const readiness = rowReadiness(row.details, row.finalScore, snapshots.get(row.runId ?? ''));
    const current = stats.get(row.positionId) ?? { total: 0, ready: 0, coverage: 0 };
    current.total += 1;
    if (readiness === 'Short' || readiness === 'Medium') current.ready += 1;
    stats.set(row.positionId, current);
  }

  for (const stat of stats.values()) {
    stat.coverage = stat.total ? Math.round((stat.ready / stat.total) * 100) : 0;
  }

  return stats;
}

/**
 * Active incumbents per position, primary first.
 *
 * A non-unique role has several holders at once (drizzle/0058). The row's own
 * holder_* columns carry the primary one; this reads the full set for display.
 */
async function getHoldersByPosition(
  positionIds: string[],
  tenantId: string,
): Promise<Map<string, PositionHolderInfo[]>> {
  const demo = await isDemoMode(); // demo mode: no NPK leaves the server
  const out = new Map<string, PositionHolderInfo[]>();
  if (positionIds.length === 0) return out;

  const rows = await db
    .select({
      positionId: schema.criticalPositionHolders.positionId,
      employeeId: schema.criticalPositionHolders.employeeId,
      name: schema.criticalPositionHolders.name,
      isPrimary: schema.criticalPositionHolders.isPrimary,
    })
    .from(schema.criticalPositionHolders)
    .where(inArray(schema.criticalPositionHolders.positionId, positionIds))
    .orderBy(desc(schema.criticalPositionHolders.isPrimary), asc(schema.criticalPositionHolders.employeeId));

  // Age + level for the retirement flag. Both live on the candidate row, and
  // the level name comes from the tenant's grade ladder.
  const employeeIds = Array.from(new Set(rows.map((r) => r.employeeId).filter(Boolean)));
  const holderFacts = new Map<string, { age: number | null; levelName: string | null }>();
  if (employeeIds.length > 0) {
    const [candidateRows, gradeLevels] = await Promise.all([
      db
        .select({
          employeeId: schema.candidates.employeeId,
          grade: schema.candidates.grade,
          birthDate: schema.candidates.birthDate,
        })
        .from(schema.candidates)
        .where(
          and(
            eq(schema.candidates.tenantId, tenantId),
            sql`LPAD(${schema.candidates.employeeId}, 5, '0') IN (${sql.join(
              employeeIds.map((id) => sql`LPAD(${id}, 5, '0')`),
              sql`, `,
            )})`,
          ),
        ),
      getGradeLevelsForTenant(tenantId),
    ]);

    const levelByGrade = new Map<number, string>();
    for (const level of gradeLevels) {
      const n = parseInt(String(level.gradeId).replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n) && level.levelName) levelByGrade.set(n, level.levelName);
    }

    for (const row of candidateRows) {
      const key = String(row.employeeId ?? '').replace(/^0+/, '');
      if (!key) continue;
      const grade = row.grade;
      const gradeNumber = parseInt(String(grade ?? '').replace(/[^0-9]/g, ''), 10);
      holderFacts.set(key, {
        age: candidateAge(row.birthDate || null),
        levelName: Number.isFinite(gradeNumber) ? levelByGrade.get(gradeNumber) ?? null : null,
      });
    }
  }

  const retirementConfig = readRetirementConfig();

  for (const row of rows) {
    const facts = holderFacts.get(String(row.employeeId).replace(/^0+/, ''));
    const age = facts?.age ?? null;
    const levelName = facts?.levelName ?? null;
    const bucket = out.get(row.positionId) ?? [];
    bucket.push({
      name: row.name ?? '',
      employeeId: demo ? MASKED_NPK : row.employeeId,
      age,
      levelName,
      retirementMinAge: retirementMinAgeFor(levelName, retirementConfig),
      retiringSoon: isRetiringSoon(age, levelName, retirementConfig),
    });
    out.set(row.positionId, bucket);
  }
  return out;
}

/**
 * Which job profile each managed position resolves to — in bulk.
 *
 * Same precedence as `resolveJobProfileIdentifier` (the single-position path):
 * the incumbent's saved pairing, then the master position's code, then the
 * title. Done as three set-based queries instead of one call per row, because
 * this feeds a list page: the per-row resolver re-reads the whole completed
 * profile list on its title tier, which is fine once and wasteful twenty times.
 *
 * A position with no answer here is one whose AHP+TOPSIS run would score
 * technical competency and career relevance from the incumbents' competencies
 * rather than from the job's stated demands — the list says so rather than
 * leaving it to be discovered in the numbers.
 */
async function getJobProfileByPosition(
  positions: { id: string; title: string; positionId: string | null; holderEmployeeId: string | null }[],
): Promise<Map<string, { id: number; name: string | null }>> {
  const out = new Map<string, { id: number; name: string | null }>();
  if (positions.length === 0) return out;

  const ids = positions.map((p) => p.id);
  const masterIds = positions.map((p) => p.positionId).filter((v): v is string => Boolean(v));
  const employeeIds = positions
    .map((p) => p.holderEmployeeId?.trim())
    .filter((v): v is string => Boolean(v));

  // Tier 1 — the incumbent's own pairing (job_family_matches.candidate_id).
  const byEmployee = new Map<string, { id: number; name: string | null }>();
  if (employeeIds.length > 0) {
    const res = await db.execute<{ employee_id: string; job_profile_id: number; job_profile_name: string | null }>(sql`
      SELECT DISTINCT ON (c.employee_id)
        c.employee_id                AS employee_id,
        jfm.job_profile_id           AS job_profile_id,
        jfm.job_profile_name         AS job_profile_name
      FROM job_family_matches jfm
      JOIN candidates c ON c.id = jfm.candidate_id
      WHERE LPAD(c.employee_id, 5, '0') IN (${sql.join(
        employeeIds.map((e) => sql`LPAD(${e}, 5, '0')`),
        sql`, `,
      )})
      ORDER BY c.employee_id, jfm.updated_at DESC NULLS LAST
    `);
    for (const row of res.rows as any[]) {
      byEmployee.set(String(row.employee_id).replace(/^0+/, ''), {
        id: Number(row.job_profile_id),
        name: row.job_profile_name ?? null,
      });
    }
  }

  // Tier 2 — the master position's code (job_family_matches.position_id).
  const byMaster = new Map<string, { id: number; name: string | null }>();
  if (masterIds.length > 0) {
    const res = await db.execute<{ master_id: string; job_profile_id: number; job_profile_name: string | null }>(sql`
      SELECT DISTINCT ON (p.id)
        p.id::text                   AS master_id,
        jfm.job_profile_id           AS job_profile_id,
        jfm.job_profile_name         AS job_profile_name
      FROM positions p
      JOIN job_family_matches jfm ON jfm.position_id = p.position_id
      WHERE p.id IN (${sql.join(masterIds.map((m) => sql`${m}::uuid`), sql`, `)})
      ORDER BY p.id, jfm.updated_at DESC NULLS LAST
    `);
    for (const row of res.rows as any[]) {
      byMaster.set(String(row.master_id), {
        id: Number(row.job_profile_id),
        name: row.job_profile_name ?? null,
      });
    }
  }

  // Tier 3 — title against the extracted profiles. One read, matched in app
  // code so the comparison is the same normalization the matcher uses.
  const needTitle = positions.filter(
    (p) =>
      !(p.holderEmployeeId && byEmployee.has(p.holderEmployeeId.trim().replace(/^0+/, ''))) &&
      !(p.positionId && byMaster.has(p.positionId)),
  );
  let byTitle = new Map<string, { id: number; name: string | null }>();
  if (needTitle.length > 0) {
    const profileRows = await db
      .select({ id: schema.syncJobProfiles.id, positionName: schema.syncJobProfiles.positionName })
      .from(schema.syncJobProfiles)
      .where(and(eq(schema.syncJobProfiles.status, 'completed'), isNotNull(schema.syncJobProfiles.positionName)));
    byTitle = new Map(
      profileRows
        .filter((r) => r.positionName)
        .map((r) => [
          r.positionName!.toLowerCase().replace(/\s+/g, ' ').trim(),
          { id: r.id, name: r.positionName },
        ]),
    );
  }

  for (const position of positions) {
    const employeeKey = position.holderEmployeeId?.trim().replace(/^0+/, '') ?? '';
    const hit =
      (employeeKey ? byEmployee.get(employeeKey) : undefined) ??
      (position.positionId ? byMaster.get(position.positionId) : undefined) ??
      byTitle.get(position.title.toLowerCase().replace(/\s+/g, ' ').trim());
    if (hit) out.set(position.id, hit);
  }
  void ids;
  return out;
}

/** Holder list for one position row, falling back to its own holder columns. */
function holdersForRow(
  position: { id: string; holderName: string | null; holderEmployeeId: string | null },
  holdersByPosition: Map<string, PositionHolderInfo[]>,
  demo = false,
): PositionHolderInfo[] {
  const stored = holdersByPosition.get(position.id);
  if (stored && stored.length > 0) return stored;
  // A holder recorded with no NPK has no row in the child table — the position
  // still has an incumbent, so say so rather than rendering none. Nothing is
  // known about their age either, so they are never flagged as retiring.
  return position.holderName
    ? [
        {
          name: position.holderName,
          employeeId: demo ? MASKED_NPK : position.holderEmployeeId ?? '',
          age: null,
          levelName: null,
          retirementMinAge: null,
          retiringSoon: false,
        },
      ]
    : [];
}

/**
 * The three "worth surfacing" states the position list counts above the table.
 *
 * None of them lives on `critical_positions`, so each is derived: a job profile
 * is resolved through three fallback tiers, a retiring holder needs the holder's
 * birth date against their level's threshold, and "scored but nobody picked"
 * is the absence of a `position_picks` row for a position that has results.
 */
export type PositionFlagKey = 'no_jd' | 'retiring' | 'awaiting_pick';

const POSITION_FLAG_KEYS: PositionFlagKey[] = ['no_jd', 'retiring', 'awaiting_pick'];

export function parsePositionFlag(raw: unknown): PositionFlagKey | null {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return (POSITION_FLAG_KEYS as string[]).includes(value) ? (value as PositionFlagKey) : null;
}

export type PositionFlagCounts = Record<PositionFlagKey, number>;

/**
 * Membership of each flag across EVERY position matching the current
 * text/department/division/program filters — deliberately not just the page.
 *
 * These numbers used to be counted client-side over the twenty rows on screen
 * and labelled "di halaman ini". That was defensible while they were only a
 * hint, but it cannot survive being clickable: a reader who clicks "4 posisi
 * belum punya job profile" and lands on twelve rows has been misinformed, and
 * the fix is the count, not the filter. So the sets are computed here and the
 * filter selects from the same sets it counted.
 */
async function getPositionFlagSets(
  rows: { id: string; title: string; positionId: string | null; holderEmployeeId: string | null }[],
  tenantId: string,
): Promise<{
  flags: Record<PositionFlagKey, Set<string>>;
  /** Handed back so the page enrichment does not resolve these a second time. */
  profileByPosition: Map<string, { id: number; name: string | null }>;
  holdersByPosition: Map<string, PositionHolderInfo[]>;
}> {
  const flags = {
    no_jd: new Set<string>(),
    retiring: new Set<string>(),
    awaiting_pick: new Set<string>(),
  };
  if (rows.length === 0) {
    return { flags, profileByPosition: new Map(), holdersByPosition: new Map() };
  }

  const ids = rows.map((row) => row.id);
  const [profileByPosition, holdersByPosition, scoredRows, pickedRows] = await Promise.all([
    getJobProfileByPosition(rows),
    getHoldersByPosition(ids, tenantId),
    // A position counts as scored once it has a ranking to read, which is what
    // the row's own "Sudah scoring" badge reflects — not merely a run row, since
    // a failed or empty run leaves nothing to pick from.
    db
      .selectDistinct({ positionId: schema.analysisResults.positionId })
      .from(schema.analysisResults)
      .innerJoin(schema.scoringRuns, eq(schema.analysisResults.runId, schema.scoringRuns.id))
      .where(and(inArray(schema.analysisResults.positionId, ids), await runsOfCurrentMode())),
    db
      .selectDistinct({ positionId: schema.positionPicks.positionId })
      .from(schema.positionPicks)
      .where(and(inArray(schema.positionPicks.positionId, ids), await picksOfCurrentMode())),
  ]);

  const picked = new Set(pickedRows.map((row) => row.positionId));
  for (const row of rows) {
    if (!profileByPosition.has(row.id)) flags.no_jd.add(row.id);
    if ((holdersByPosition.get(row.id) ?? []).some((holder) => holder.retiringSoon)) {
      flags.retiring.add(row.id);
    }
  }
  for (const row of scoredRows) {
    if (!picked.has(row.positionId)) flags.awaiting_pick.add(row.positionId);
  }
  return { flags, profileByPosition, holdersByPosition };
}

export async function getPositionManagementPage(
  page: number,
  pageSize: number,
  query: string,
  department?: string,
  division?: string,
  program?: string,
  /** Bench-overview drill-down: keep only positions in one bench state. */
  bench?: PositionBenchKey | null,
  /** Dashboard "Readiness Bands" drill-down: keep only positions inside one coverage bucket. */
  band?: ReadinessBandKey | null,
  /** Summary-line drill-down: keep only positions carrying one derived flag. */
  flag?: PositionFlagKey | null,
): Promise<{
  positions: PositionSummary[];
  total: number;
  flagCounts: PositionFlagCounts;
  benchCounts: PositionBenchCounts;
}> {
  const demo = await isDemoMode(); // demo mode: no NPK leaves the server
  const tenantId = await getCurrentTenantId();

  const whereConditions = [eq(schema.criticalPositions.tenantId, tenantId)];

  if (query) {
    const q = `%${query}%`;
    whereConditions.push(
      sql`(${schema.criticalPositions.title} ILIKE ${q} OR COALESCE(${schema.criticalPositions.department},'') ILIKE ${q} OR COALESCE(${schema.criticalPositions.division},'') ILIKE ${q} OR COALESCE(${schema.criticalPositions.holderName},'') ILIKE ${q})`,
    );
  }

  if (department) {
    whereConditions.push(eq(schema.criticalPositions.department, department));
  }

  if (division) {
    whereConditions.push(eq(schema.criticalPositions.division, division));
  }

  // Since drizzle/0056 the program is a column on the position itself, so the
  // program filter narrows the LIST — not just which runs are summarised.
  if (program) {
    whereConditions.push(eq(schema.criticalPositions.programCode, program));
  }

  const bandRange = band ? READINESS_BANDS[band] : null;

  // Every position matching the filters above, cheap columns only. Needed
  // unconditionally now: the flag counts reported to the client describe the
  // whole filtered set, and a count you can click has to be measured over the
  // same set the click will select from. It also replaces the separate
  // `count(*)`, since this list IS the total.
  const matchRows = await db
    .select({
      id: schema.criticalPositions.id,
      title: schema.criticalPositions.title,
      positionId: schema.criticalPositions.positionId,
      holderEmployeeId: schema.criticalPositions.holderEmployeeId,
    })
    .from(schema.criticalPositions)
    .where(and(...whereConditions));

  const { flags: flagSets, profileByPosition, holdersByPosition } = await getPositionFlagSets(
    matchRows,
    tenantId,
  );
  const flagCounts: PositionFlagCounts = {
    no_jd: flagSets.no_jd.size,
    retiring: flagSets.retiring.size,
    awaiting_pick: flagSets.awaiting_pick.size,
  };

  // Bench state over the WHOLE filtered set, not the page. Same rule as the
  // flag counts above and for the same reason: these numbers are clickable, so
  // they have to be measured over the set the click will select from. Resolved
  // unconditionally now — it used to run only when a readiness drill-down was
  // active, which is why the overview that needed it was computed in the
  // browser off twenty rows instead.
  const readinessStats = await getReadinessStatsByPosition(
    matchRows.map((row) => row.id),
    program,
  );
  const benchCounts: PositionBenchCounts = { ready: 0, not_ready: 0, unscored: 0 };
  for (const row of matchRows) {
    benchCounts[benchStateFor(readinessStats.get(row.id) ?? EMPTY_READINESS_STAT)] += 1;
  }

  const derivedFilterActive = Boolean(bench || bandRange || flag);

  let total: number;
  let paginatedRows: (typeof schema.criticalPositions.$inferSelect)[];

  if (derivedFilterActive) {
    // Readiness, band and the three flags all live outside the row, so page over
    // an id allow-list computed up front instead of a SQL LIMIT/OFFSET.
    const flagged = flag ? flagSets[flag] : null;
    const matched = matchRows.filter((row) => {
      if (flagged && !flagged.has(row.id)) return false;
      const stat = readinessStats.get(row.id) ?? EMPTY_READINESS_STAT;
      if (bench && benchStateFor(stat) !== bench) return false;
      if (bandRange && (stat.coverage < bandRange.min || stat.coverage >= bandRange.maxExclusive)) return false;
      return true;
    });

    // Lead with whatever the clicked metric was about: deepest benches first
    // for the ready drill-down, thinnest coverage first for everything that was
    // clicked because it looked like a problem.
    const worstFirst = band === 'critical' || bench === 'not_ready' || bench === 'unscored';
    matched.sort((left, right) => {
      const a = readinessStats.get(left.id) ?? EMPTY_READINESS_STAT;
      const b = readinessStats.get(right.id) ?? EMPTY_READINESS_STAT;
      if (bench === 'ready' && b.ready !== a.ready) return b.ready - a.ready;
      if (a.coverage !== b.coverage) return worstFirst ? a.coverage - b.coverage : b.coverage - a.coverage;
      return left.title.localeCompare(right.title);
    });

    total = matched.length;
    const pageIds = matched.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id);
    if (pageIds.length === 0) return { positions: [], total, flagCounts, benchCounts };

    const rows = await db
      .select()
      .from(schema.criticalPositions)
      .where(inArray(schema.criticalPositions.id, pageIds));
    const rank = new Map(pageIds.map((id, index) => [id, index]));
    paginatedRows = rows.sort((left, right) => (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0));
  } else {
    total = matchRows.length;

    paginatedRows = await db
      .select()
      .from(schema.criticalPositions)
      .where(and(...whereConditions))
      .orderBy(asc(schema.criticalPositions.title))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  }

  if (paginatedRows.length === 0) return { positions: [], total, flagCounts, benchCounts };

  const [templates, scoringRunRows] = await Promise.all([
    listProgramTemplates(tenantId),
    db
      .select({
        id: schema.scoringRuns.id,
        positionId: schema.scoringRuns.positionId,
        program: schema.scoringRuns.program,
        method: schema.scoringRuns.method,
        label: schema.scoringRuns.label,
        createdAt: schema.scoringRuns.createdAt,
        status: schema.scoringRuns.status,
      })
      .from(schema.scoringRuns)
      .where(and(await runsOfCurrentMode(), inArray(schema.scoringRuns.positionId, paginatedRows.map((row) => row.id))))
      .orderBy(asc(schema.scoringRuns.positionId), asc(schema.scoringRuns.createdAt)),
  ]);

  // Program code → template, so each row can name the program it is managed
  // under even when that program is a tenant-defined custom one.
  const templateByCode = new Map(templates.map((template) => [template.code, template]));

  // When program filter is active, only use runs with that program
  const filteredRuns = program
    ? scoringRunRows.filter((r) => r.program === program)
    : scoringRunRows;

  type LatestRunMeta = {
    id: string;
    program: string | null;
    method: string;
    label: string | null;
    createdAt: Date;
  };
  const latestRunByPosition = new Map<string, LatestRunMeta>();
  const activeScoringPositions = new Set<string>();
  // Every run ever recorded against the position, regardless of the program
  // filter — this is what decides whether its program is still editable.
  const runCountByPosition = new Map<string, number>();
  for (const run of scoringRunRows) {
    runCountByPosition.set(run.positionId, (runCountByPosition.get(run.positionId) ?? 0) + 1);
  }
  // Runs are ordered by createdAt ASC, so the last completed run per position
  // overwrites earlier ones — i.e. latestRunByPosition ends up holding the
  // most recent completed run.
  for (const run of filteredRuns) {
    if (run.status === 'in_progress') activeScoringPositions.add(run.positionId);
    if (run.status !== 'in_progress' && run.status !== 'draft') {
      latestRunByPosition.set(run.positionId, {
        id: run.id,
        program: run.program,
        method: run.method,
        label: run.label,
        createdAt: run.createdAt,
      });
    }
  }

  const latestRunIds = Array.from(
    new Set(Array.from(latestRunByPosition.values()).map((m) => m.id)),
  );

  // Chosen successors (position_picks) for the paginated positions. The
  // candidates join is deliberately NOT filtered by deleted_at: a pick records a
  // decision that was already made, and hiding the name would render it as an
  // anonymous "Kandidat" row rather than removing the pick.
  const pickRows = await db
    .select({
      pickId: schema.positionPicks.id,
      positionId: schema.positionPicks.positionId,
      candidateId: schema.positionPicks.candidateId,
      programCode: schema.positionPicks.programCode,
      score: schema.positionPicks.score,
      readiness: schema.positionPicks.readiness,
      rank: schema.positionPicks.rank,
      name: schema.candidates.name,
    })
    .from(schema.positionPicks)
    .leftJoin(schema.candidates, eq(schema.positionPicks.candidateId, schema.candidates.id))
    .where(and(inArray(schema.positionPicks.positionId, paginatedRows.map((row) => row.id)), await picksOfCurrentMode()))
    .orderBy(asc(schema.positionPicks.programCode), asc(schema.positionPicks.rank));

  // holdersByPosition / profileByPosition already cover every paginated row —
  // the flag pass above resolved them across the whole matched set, and
  // paginated ⊆ matched.

  const chosenByPosition = new Map<
    string,
    NonNullable<PositionSummary['chosenCandidates']>
  >();
  for (const pick of pickRows) {
    const bucket = chosenByPosition.get(pick.positionId) ?? [];
    bucket.push({
      pickId: pick.pickId,
      candidateId: pick.candidateId,
      name: pick.name || 'Kandidat',
      programCode: pick.programCode,
      score: pick.score,
      readiness: pick.readiness,
      rank: pick.rank,
    });
    chosenByPosition.set(pick.positionId, bucket);
  }

  const resultRows =
    latestRunIds.length === 0
      ? []
      : await db
          .select({
            runId: schema.analysisResults.runId,
            positionId: schema.analysisResults.positionId,
            candidateId: schema.analysisResults.candidateId,
            finalScore: schema.analysisResults.finalScore,
            rank: schema.analysisResults.rank,
            details: schema.analysisResults.details,
          })
          .from(schema.analysisResults)
          .where(inArray(schema.analysisResults.runId, latestRunIds))
          .orderBy(asc(schema.analysisResults.positionId), asc(schema.analysisResults.rank));

  const statsByPosition = new Map<string, { total: number; ready: number }>();
  const topCandidatesByPosition = new Map<string, { id: string; name: string; weightedScore: number; readiness: ReadinessLevel; rank: number }[]>();
  const [candidateNames, readinessSnapshots] = await Promise.all([
    getCandidateNameMap(resultRows.map((row) => row.candidateId)),
    loadRunReadinessSnapshots(latestRunIds),
  ]);
  for (const row of resultRows) {
    const score = Number(row.finalScore) * 100;
    const readiness = rowReadiness(row.details, row.finalScore, readinessSnapshots.get(row.runId ?? ''));
    const current = statsByPosition.get(row.positionId) ?? { total: 0, ready: 0 };
    current.total += 1;
    if (readiness === 'Short' || readiness === 'Medium') current.ready += 1;
    statsByPosition.set(row.positionId, current);

    const preview = buildTopCandidatePreview(
      row.details,
      row.candidateId,
      row.rank,
      candidateNames.get(row.candidateId) ?? null,
    );
    if (preview) {
      const currentTop = topCandidatesByPosition.get(row.positionId) ?? [];
      if (currentTop.length < 10) {
        currentTop.push(preview);
        topCandidatesByPosition.set(row.positionId, currentTop);
      }
    }
  }

  let positions = paginatedRows.map((position) => {
    const stats = statsByPosition.get(position.id) ?? { total: 0, ready: 0 };
    const normalizedProgram = normalizeProgramCode(position.programCode);
    return {
      id: position.id,
      title: position.title,
      department: position.department ?? '-',
      division: position.division ?? '-',
      minGradeId: position.minGradeId ?? null,
      maxGradeId: position.maxGradeId ?? null,
      status: normalizeStatus(position.status),
      programs: normalizedProgram ? [normalizedProgram] : [],
      programCode: position.programCode,
      programTemplateId: position.programTemplateId ?? null,
      programName: templateByCode.get(position.programCode)?.name ?? position.programCode,
      runCount: runCountByPosition.get(position.id) ?? 0,
      candidates: stats.total,
      readyNow: stats.ready,
      readinessCoverage: stats.total ? Math.round((stats.ready / stats.total) * 100) : 0,
      qualifications: {
        education: position.education ?? '-',
        // critical_positions has no `major` column (never had): this field is
        // structurally fake and always rendered '-', which it still does.
        major: '-',
        experience: position.experience ?? '-',
        jobFamily: position.jobFamily ?? position.department ?? '-',
      },
      requiredCompetencies: (position.requiredCompetencies ?? []) as { technicalId: string; technicalName: string; targetProficiency?: string }[],
      topCandidates: topCandidatesByPosition.get(position.id) ?? [],
      scoringInProgress: activeScoringPositions.has(position.id),
      latestRun: (() => {
        const meta = latestRunByPosition.get(position.id);
        return meta
          ? {
              id: meta.id,
              program: meta.program,
              method: meta.method,
              label: meta.label,
              createdAt: meta.createdAt.toISOString(),
            }
          : null;
      })(),
      chosenCandidates: chosenByPosition.get(position.id) ?? [],
      currentHolder: position.holderName
        ? { name: position.holderName, employeeId: demo ? MASKED_NPK : position.holderEmployeeId ?? '-' }
        : undefined,
      holders: holdersForRow(position, holdersByPosition, demo),
      jobProfileId: profileByPosition.get(position.id)?.id ?? null,
      jobProfileName: profileByPosition.get(position.id)?.name ?? null,
    };
  });

  return { positions, total, flagCounts, benchCounts };
}

/** First managed position id (alphabetical) — a one-row query for redirect
 *  pages; avoids building every position summary just to pick the first. */
export async function getFirstPositionManagementId(): Promise<string | null> {
  const tenantId = await getCurrentTenantId();
  const [row] = await db
    .select({ id: schema.criticalPositions.id })
    .from(schema.criticalPositions)
    .where(eq(schema.criticalPositions.tenantId, tenantId))
    .orderBy(asc(schema.criticalPositions.title))
    .limit(1);
  return row?.id ?? null;
}

export async function getPositionManagementList(): Promise<PositionSummary[]> {
  const demo = await isDemoMode(); // demo mode: no NPK leaves the server
  const tenantId = await getCurrentTenantId();

  const [rows, templates] = await Promise.all([
    db
      .select()
      .from(schema.criticalPositions)
      .where(eq(schema.criticalPositions.tenantId, tenantId))
      .orderBy(asc(schema.criticalPositions.title)),
    listProgramTemplates(tenantId),
  ]);

  if (rows.length === 0) return [];

  const templateByCode = new Map(templates.map((template) => [template.code, template]));

  const scoringRunRows = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
      createdAt: schema.scoringRuns.createdAt,
      status: schema.scoringRuns.status,
    })
    .from(schema.scoringRuns)
    .where(and(await runsOfCurrentMode(), inArray(schema.scoringRuns.positionId, rows.map((row) => row.id))))
    .orderBy(asc(schema.scoringRuns.positionId), asc(schema.scoringRuns.createdAt));

  const latestRunByPosition = new Map<string, string>();
  const activeScoringPositions = new Set<string>();
  const runCountByPosition = new Map<string, number>();
  for (const run of scoringRunRows) {
    runCountByPosition.set(run.positionId, (runCountByPosition.get(run.positionId) ?? 0) + 1);
    if (run.status === 'in_progress') activeScoringPositions.add(run.positionId);
    if (run.status !== 'in_progress' && run.status !== 'draft') {
      latestRunByPosition.set(run.positionId, run.id);
    }
  }

  const latestRunIds = Array.from(new Set(latestRunByPosition.values()));

  const resultRows =
    latestRunIds.length === 0
      ? []
      : await db
          .select({
            runId: schema.analysisResults.runId,
            positionId: schema.analysisResults.positionId,
            candidateId: schema.analysisResults.candidateId,
            finalScore: schema.analysisResults.finalScore,
            rank: schema.analysisResults.rank,
            details: schema.analysisResults.details,
          })
          .from(schema.analysisResults)
          .where(inArray(schema.analysisResults.runId, latestRunIds))
          .orderBy(asc(schema.analysisResults.positionId), asc(schema.analysisResults.rank));

  const candidateIds = Array.from(new Set(resultRows.map((row) => row.candidateId)));
  const [candidateNames, holdersByPosition, profileByPosition, readinessSnapshots] = await Promise.all([
    getCandidateNameMap(candidateIds),
    getHoldersByPosition(rows.map((row) => row.id), tenantId),
    getJobProfileByPosition(rows),
    loadRunReadinessSnapshots(latestRunIds),
  ]);

  const statsByPosition = new Map<string, { total: number; ready: number }>();
  const topCandidatesByPosition = new Map<
    string,
    { id: string; name: string; weightedScore: number; readiness: ReadinessLevel; rank: number }[]
  >();
  for (const row of resultRows) {
    const score = Number(row.finalScore) * 100;
    const readiness = rowReadiness(row.details, row.finalScore, readinessSnapshots.get(row.runId ?? ''));
    const current = statsByPosition.get(row.positionId) ?? { total: 0, ready: 0 };
    current.total += 1;
    if (readiness === 'Short' || readiness === 'Medium') current.ready += 1;
    statsByPosition.set(row.positionId, current);

    const preview = buildTopCandidatePreview(
      row.details,
      row.candidateId,
      row.rank,
      candidateNames.get(row.candidateId) ?? null,
    );
    if (preview) {
      const currentTop = topCandidatesByPosition.get(row.positionId) ?? [];
      if (currentTop.length < 10) {
        currentTop.push(preview);
        topCandidatesByPosition.set(row.positionId, currentTop);
      }
    }
  }

  return rows.map((position) => {
    const stats = statsByPosition.get(position.id) ?? { total: 0, ready: 0 };
    const normalizedProgram = normalizeProgramCode(position.programCode);
    return {
      id: position.id,
      title: position.title,
      department: position.department ?? '-',
      division: position.division ?? '-',
      minGradeId: position.minGradeId ?? null,
      maxGradeId: position.maxGradeId ?? null,
      status: normalizeStatus(position.status),
      programs: normalizedProgram ? [normalizedProgram] : [],
      programCode: position.programCode,
      programTemplateId: position.programTemplateId ?? null,
      programName: templateByCode.get(position.programCode)?.name ?? position.programCode,
      runCount: runCountByPosition.get(position.id) ?? 0,
      candidates: stats.total,
      readyNow: stats.ready,
      readinessCoverage: stats.total ? Math.round((stats.ready / stats.total) * 100) : 0,
      qualifications: {
        education: position.education ?? '-',
        // critical_positions has no `major` column (never had): this field is
        // structurally fake and always rendered '-', which it still does.
        major: '-',
        experience: position.experience ?? '-',
        jobFamily: position.jobFamily ?? position.department ?? '-',
      },
      requiredCompetencies: (position.requiredCompetencies ?? []) as { technicalId: string; technicalName: string; targetProficiency?: string }[],
      topCandidates: topCandidatesByPosition.get(position.id) ?? [],
      scoringInProgress: activeScoringPositions.has(position.id),
      currentHolder: position.holderName
        ? {
            name: position.holderName,
            employeeId: demo ? MASKED_NPK : position.holderEmployeeId ?? '-',
          }
        : undefined,
      holders: holdersForRow(position, holdersByPosition, demo),
      jobProfileId: profileByPosition.get(position.id)?.id ?? null,
      jobProfileName: profileByPosition.get(position.id)?.name ?? null,
    };
  });
}

export async function getPositionDetail(positionId: string): Promise<{
  position: PositionSummary;
  candidates: PositionCandidate[];
} | null> {
  const positions = await getPositionManagementList();
  const position = positions.find((item) => item.id === positionId);
  if (!position) return null;

  // Prefer latest scoring-run analysis results if any
  const resultRows = await db
    .select({ rank: schema.analysisResults.rank, details: schema.analysisResults.details })
    .from(schema.analysisResults)
    .innerJoin(schema.scoringRuns, eq(schema.analysisResults.runId, schema.scoringRuns.id))
    .where(and(eq(schema.analysisResults.positionId, positionId), await runsOfCurrentMode()))
    .orderBy(asc(schema.analysisResults.rank));

  const cached = resultRows
    .map((row) => parseCandidateDetails(row.details))
    .filter((row): row is PositionCandidate => Boolean(row));

  if (cached.length > 0) {
    return { position, candidates: cached };
  }

  return { position, candidates: [] };
}

export type DashboardOverviewType = {
  tenant: {
    id: string;
    slug: string;
    name: string;
  };
  totals: {
    positions: number;
    candidates: number;
    /**
     * Candidates who actually PASS the Talent Pool program's filter rules —
     * the same number the /talent-pool page shows. `candidates` above is the
     * whole live population, which is a different question: one is "how many
     * people do we have", the other "how many clear the bar".
     */
    talentPoolQualified: number;
    /** Live candidates the Talent Pool rules were evaluated against. */
    talentPoolEvaluated: number;
    readyNow: number;
    scoredPositions: number;
    readinessCoverage: number;
    holderCoverage: number;
    /**
     * Positions whose incumbent (or one of them) has reached the retirement
     * threshold for their level — seats that need a replacement decided, not
     * eventually but on a clock. See lib/retirement-config.ts.
     */
    positionsNeedingChange: number;
  };
  readinessBands: {
    label: string;
    count: number;
    percentage: number;
  }[];
  /**
   * Candidates per HAV quadrant IN FORCE (lib/hav-effective.ts): a Talent
   * Mapping placement, else the uploaded quadrant, else one DERIVED from PA ×
   * behavioral competency. The counts stay separate per cell so the grid can
   * say which of its numbers a person placed, which came from a spreadsheet and
   * which the rules worked out — a heat grid that blends them reads as fully
   * calibrated data when it is partly inference.
   */
  havDistribution: {
    quadrant: number;
    employees: number;
    /** Placed by hand on Talent Mapping. */
    manual: number;
    stored: number;
    derived: number;
  }[];
  /** Where the grid's quadrants came from, and who still has none. */
  havCoverage: {
    manual: number;
    stored: number;
    derived: number;
    /** Live candidates with no placement, no upload and no derivable quadrant. */
    unknown: number;
    total: number;
    /** Why the unknowns are unknown — a gap that names its own cause. */
    gaps: {
      performanceMissing: number;
      competencyMissing: number;
      competencyUnrecognized: number;
    };
  };
  /**
   * The 16 quadrants rolled up into the 5-Box vocabulary of the Talent Matrix,
   * via each quadrant's own `category` (HAV_QUADRANTS) — the grid read as boxes.
   */
  havBoxRollup: {
    box: TalentBox;
    employees: number;
    percentage: number;
    quadrants: number[];
  }[];
  departmentBreakdown: {
    department: string;
    candidates: number;
  }[];
  programs: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    runCount: number;
    positionCount: number;
    candidateCount: number;
    lastRunAt: Date | null;
  }[];
  topPositions: PositionSummary[];
  recentRuns: {
    id: string;
    positionId: string;
    positionTitle: string;
    programLabel: string;
    candidateCount: number;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  }[];
  recentAudit: {
    id: string;
    action: string;
    actor: string;
    summary: string;
    createdAt: Date;
  }[];
};

function normalizeAuditAction(action: string): string {
  switch (action) {
    case 'create':
      return 'Data baru ditambahkan';
    case 'update':
      return 'Perubahan data';
    case 'delete':
      return 'Data dihapus';
    case 'run_scoring':
      return 'Scoring dijalankan';
    case 'filter_override':
      return 'Override filter';
    case 'seed':
      return 'Seed data';
    case 'evaluate':
      return 'Evaluasi kandidat';
    case 'export':
      return 'Data diekspor';
    default:
      return action;
  }
}

export async function getDashboardOverview(): Promise<DashboardOverviewType> {
  const tenant = await getCurrentTenant();
  const tenantId = tenant.id;

  // Candidates are only aggregated here (count, HAV distribution, department
  // breakdown) — select just those columns instead of building full profiles
  // (which joins competencies/history and runs the competency sync).
  // `performanceGrade` / `behaviorRecommendation` are the two axes the HAV
  // quadrant is derived from when none was uploaded — see the havDistribution
  // block below.
  const [positions, candidatesRaw, templates, recentAudit, scoringRuns, talentPool] = await Promise.all([
    getPositionManagementList(),
    db
      .select({
        // id: the Talent Mapping placements are keyed by candidate.
        id: schema.candidates.id,
        havQuadrant: schema.candidates.havQuadrant,
        performanceGrade: schema.candidates.performanceGrade,
        behaviorRecommendation: schema.candidates.behaviorRecommendation,
        department: schema.candidates.department,
      })
      .from(schema.candidates)
      .where(and(eq(schema.candidates.tenantId, tenantId), liveCandidate())),
    listProgramTemplates(tenantId),
    listAuditLog(tenantId, { limit: 4 }),
    db
      .select({
        id: schema.scoringRuns.id,
        positionId: schema.scoringRuns.positionId,
        programTemplateId: schema.scoringRuns.programTemplateId,
        program: schema.scoringRuns.program,
        candidateCount: schema.scoringRuns.candidateCount,
        status: schema.scoringRuns.status,
        createdAt: schema.scoringRuns.createdAt,
        completedAt: schema.scoringRuns.completedAt,
        positionTitle: schema.criticalPositions.title,
        programName: schema.programTemplates.name,
      })
      .from(schema.scoringRuns)
      .leftJoin(schema.criticalPositions, eq(schema.scoringRuns.positionId, schema.criticalPositions.id))
      .leftJoin(schema.programTemplates, eq(schema.scoringRuns.programTemplateId, schema.programTemplates.id))
      .where(and(eq(schema.scoringRuns.tenantId, tenantId), await runsOfCurrentMode()))
      .orderBy(desc(schema.scoringRuns.createdAt)),
    // The real Talent Pool figure comes from the same evaluator the Talent Pool
    // page uses, so the dashboard cannot disagree with the list it links to.
    // A failure here must not take the dashboard down: it degrades to 0.
    getTalentPoolData().catch(() => null),
  ]);
  // The HAV is the one in force (manual > upload > formula, lib/hav-effective.ts).
  // Demo mode: only ON candidates, as their demo copy (lib/demo/).
  const candidates = await withEffectiveHav(await forCurrentMode(candidatesRaw, (c) => c.id, { onlyOn: true }));

  const readinessBands = [
    {
      label: 'Strong bench',
      count: positions.filter((position) => position.readinessCoverage >= 80).length,
    },
    {
      label: 'Watchlist',
      count: positions.filter((position) => position.readinessCoverage >= 50 && position.readinessCoverage < 80).length,
    },
    {
      label: 'Critical gap',
      count: positions.filter((position) => position.readinessCoverage < 50).length,
    },
  ].map((band) => ({
    ...band,
    percentage: positions.length ? Math.round((band.count / positions.length) * 100) : 0,
  }));

  // ── HAV 16-quadrant grid: the HAV in force, split by where it came from ─────
  //
  // The grid used to count only `candidates.hav_quadrant`, which is filled by
  // the HAV Excel upload — so it charted how complete one spreadsheet is, not
  // the workforce. It now counts the HAV in force (lib/hav-effective.ts): a
  // Talent Mapping placement, else the upload, else the formula from PA ×
  // behavioural competency — the same value scoring reads, so the dashboard
  // cannot show somebody in a square the ranking does not use.
  //
  // The three sources are counted separately rather than only summed, because
  // "43 candidates in Q9" means something different when 40 of them are
  // inferred and something different again when 3 were moved by hand.
  const havManual = new Map<number, number>();
  const havStored = new Map<number, number>();
  const havDerived = new Map<number, number>();
  const havGaps = { performanceMissing: 0, competencyMissing: 0, competencyUnrecognized: 0 };
  let havUnknown = 0;

  const bump = (map: Map<number, number>, quadrant: number) => map.set(quadrant, (map.get(quadrant) ?? 0) + 1);
  for (const candidate of candidates) {
    const hav = candidate.effectiveHav;
    if (hav.quadrant != null) {
      bump(hav.source === 'manual' ? havManual : hav.source === 'upload' ? havStored : havDerived, hav.quadrant);
      continue;
    }
    havUnknown += 1;
    // One candidate can be missing both axes; every gap is counted so the
    // reader learns which sync to chase, not just that something is absent.
    const gaps = hav.formula.ok ? [] : hav.formula.gaps;
    if (gaps.includes('performance-missing')) havGaps.performanceMissing += 1;
    if (gaps.includes('competency-missing')) havGaps.competencyMissing += 1;
    if (gaps.includes('competency-unrecognized')) havGaps.competencyUnrecognized += 1;
  }

  const havDistribution = Array.from({ length: 16 }, (_, index) => {
    const quadrant = index + 1;
    const manual = havManual.get(quadrant) ?? 0;
    const stored = havStored.get(quadrant) ?? 0;
    const derivedCount = havDerived.get(quadrant) ?? 0;
    return { quadrant, employees: manual + stored + derivedCount, manual, stored, derived: derivedCount };
  });

  const havPlaced = havDistribution.reduce((sum, cell) => sum + cell.employees, 0);
  const havCoverage = {
    manual: havDistribution.reduce((sum, cell) => sum + cell.manual, 0),
    stored: havDistribution.reduce((sum, cell) => sum + cell.stored, 0),
    derived: havDistribution.reduce((sum, cell) => sum + cell.derived, 0),
    unknown: havUnknown,
    total: candidates.length,
    gaps: havGaps,
  };

  // The same grid expressed in the Talent Matrix's 5-Box vocabulary. The
  // rollup is each quadrant's own `category` — the 16 → 5 translation is a
  // column of HAV_QUADRANTS, not a second rule set.
  const havBoxRollup = TALENT_BOXES.map((box) => {
    const quadrants = QUADRANTS_BY_TALENT_BOX[box];
    const employees = quadrants.reduce(
      (sum, quadrant) => sum + (havDistribution[quadrant - 1]?.employees ?? 0),
      0,
    );
    return {
      box,
      employees,
      percentage: havPlaced ? Math.round((employees / havPlaced) * 100) : 0,
      quadrants,
    };
  });

  const departmentCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const department = candidate.department || 'Belum diisi';
    departmentCounts.set(department, (departmentCounts.get(department) ?? 0) + 1);
  }

  const departmentBreakdown = Array.from(departmentCounts.entries())
    .map(([department, count]) => ({ department, candidates: count }))
    .sort((left, right) => right.candidates - left.candidates)
    .slice(0, 5);

  const programs = templates.map((template) => {
    const matchingRuns = scoringRuns.filter(
      (run) => run.programTemplateId === template.id || run.program === template.code
    );

    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      runCount: matchingRuns.length,
      positionCount: new Set(matchingRuns.map((run) => run.positionId)).size,
      candidateCount: matchingRuns.reduce((total, run) => total + (run.candidateCount ?? 0), 0),
      lastRunAt: matchingRuns[0]?.createdAt ?? null,
    };
  });

  const scoredPositions = positions.filter((position) => (position.topCandidates?.length ?? 0) > 0).length;
  const readyNow = positions.reduce((total, position) => total + position.readyNow, 0);
  const totalCandidates = positions.reduce((total, position) => total + position.candidates, 0);
  const holderCoverage = positions.length
    ? Math.round((positions.filter((position) => Boolean(position.currentHolder?.name)).length / positions.length) * 100)
    : 0;

  return {
    tenant,
    totals: {
      positions: positions.length,
      candidates: candidates.length,
      talentPoolQualified: talentPool?.qualified.length ?? 0,
      talentPoolEvaluated: talentPool?.totalEvaluated ?? candidates.length,
      readyNow,
      scoredPositions,
      readinessCoverage: totalCandidates ? Math.round((readyNow / totalCandidates) * 100) : 0,
      holderCoverage,
      positionsNeedingChange: positions.filter((position) =>
        (position.holders ?? []).some((holder) => holder.retiringSoon),
      ).length,
    },
    readinessBands,
    havDistribution,
    havCoverage,
    havBoxRollup,
    departmentBreakdown,
    programs,
    topPositions: [...positions]
      .sort((left, right) => left.readinessCoverage - right.readinessCoverage || left.readyNow - right.readyNow)
      .slice(0, 5),
    recentRuns: scoringRuns.slice(0, 4).map((run) => ({
      id: run.id,
      positionId: run.positionId,
      positionTitle: run.positionTitle ?? 'Posisi tidak ditemukan',
      programLabel: run.programName ?? run.program ?? 'Ad-hoc scoring',
      candidateCount: run.candidateCount ?? 0,
      status: run.status,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    })),
    recentAudit: recentAudit.map((entry) => ({
      id: entry.id,
      action: normalizeAuditAction(entry.action),
      actor: entry.actorName ?? 'System',
      summary: entry.summary ?? 'Aktivitas tercatat tanpa ringkasan tambahan.',
      createdAt: entry.createdAt,
    })),
  };
}

/**
 * The `users.id` every write should record as its actor: the LOGGED-IN user
 * when there is one, the system user only as the fallback.
 *
 * This is the single funnel — all 74 call sites (audit `actorId`, `createdBy`
 * on programs/runs/picks, `deletedBy` on candidates) resolve their actor here,
 * which is why the audit trail used to attribute every action to "PULSE System
 * User" even with Keycloak configured: this function never looked at the
 * session. It now does. The upsert-by-email mirrors `recordUserLogin` in
 * lib/rbac.ts (which normally creates the row at sign-in); repeating it here
 * covers rows that predate that bookkeeping without a second convention —
 * `users.email` is unique, so both paths converge on one row.
 *
 * Falls back to the system user when Keycloak is not configured
 * (`getCurrentUser()` returns the hardcoded system identity) or when there is
 * no session at all — a write that already passed the permission layer must
 * not fail over attribution.
 */
export async function ensureLocalUser(): Promise<string> {
  const sessionUser = await getCurrentUser().catch(() => null);
  const email = sessionUser?.email?.trim().toLowerCase();

  if (email && email !== 'system@pulse.local') {
    const [row] = await db
      .insert(schema.users)
      .values({ email, name: sessionUser?.name ?? null, lastLoginAt: new Date() })
      .onConflictDoUpdate({
        target: schema.users.email,
        // Refresh the display name only when the IdP supplies one — never
        // stomp a stored name with null. roleId/tenantId are deliberately
        // untouched: role assignment is in-app, not a side effect of acting.
        set: {
          ...(sessionUser?.name ? { name: sessionUser.name } : {}),
          updatedAt: new Date(),
        },
      })
      .returning({ id: schema.users.id });
    if (row) return row.id;
  }

  return ensureSystemUser();
}

/**
 * Ensure the system/demo user row exists and return its id. Keyed by email
 * ('system@pulse.local'), so the function is safe to call concurrently.
 */
async function ensureSystemUser(): Promise<string> {
  const tenantId = await getCurrentTenantId();

  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, 'system@pulse.local'))
    .limit(1);

  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(schema.users)
    .values({
      email: 'system@pulse.local',
      name: 'PULSE System User',
      tenantId,
    })
    .onConflictDoNothing({ target: schema.users.email })
    .returning({ id: schema.users.id });

  if (inserted[0]) return inserted[0].id;

  // Conflict won the race — re-fetch
  const refetch = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, 'system@pulse.local'))
    .limit(1);

  if (!refetch[0]) {
    throw new Error('Failed to ensure system user');
  }
  return refetch[0].id;
}

// ── Grade Levels (per-tenant lookup) ─────────────────────────────────

export type GradeLevelOption = {
  gradeId: string;
  levelId: string;
  levelName: string | null;
};

export type CandidateLevelOption = {
  /** Grade level name, used directly as the filter value (e.g. "Supervisor"). */
  level: string;
};

/**
 * Distinct grade levels (Staff, Supervisor, Manager, …) present among the
 * current tenant's candidates, sorted by their grade order. Powers the level
 * filter in the candidates page.
 */
export async function getCandidateLevelOptions(): Promise<CandidateLevelOption[]> {
  const tenantId = await getCurrentTenantId();
  const [rows, gradeLevelMap] = await Promise.all([
    db
      .selectDistinct({ grade: schema.candidates.grade })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.tenantId, tenantId),
          isNotNull(schema.candidates.grade),
          liveCandidate(),
        ),
      ),
    getGradeLevelMap(tenantId),
  ]);

  const seenGrades = new Set<string>();
  const distinctGrades: string[] = [];
  for (const r of rows) {
    const grade = r.grade;
    if (grade == null || grade === '') continue;
    if (seenGrades.has(grade)) continue;
    seenGrades.add(grade);
    distinctGrades.push(grade);
  }

  // Track the lowest numeric grade per level so we can order levels sensibly.
  const levelMinGrade = new Map<string, number>();
  for (const grade of distinctGrades) {
    const key = normalizeGradeKey(grade);
    if (!key) continue;
    const level = gradeLevelMap.get(key);
    if (!level) continue;
    const num = parseInt(key, 10);
    const rank = Number.isNaN(num) ? Number.POSITIVE_INFINITY : num;
    const current = levelMinGrade.get(level);
    if (current === undefined || rank < current) levelMinGrade.set(level, rank);
  }

  return Array.from(levelMinGrade.keys())
    .sort((a, b) => (levelMinGrade.get(a)! - levelMinGrade.get(b)!) || a.localeCompare(b))
    .map((level) => ({ level }));
}

/**
 * Resolve the raw candidate grade values whose level matches `level`, for the
 * given tenant. Used to translate a level filter into a grade `IN (...)` clause.
 */
async function getGradesForLevel(
  tenantId: string,
  level: string,
  gradeLevelMap: Map<string, string>,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ grade: schema.candidates.grade })
    .from(schema.candidates)
    .where(
      and(
        eq(schema.candidates.tenantId, tenantId),
        isNotNull(schema.candidates.grade),
        liveCandidate(),
      ),
    );
  const grades: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const grade = r.grade?.trim();
    if (!grade || seen.has(grade)) continue;
    seen.add(grade);
    if (gradeLevelMap.get(normalizeGradeKey(grade) ?? '') === level) grades.push(grade);
  }
  return grades;
}

/**
 * Fetch grade levels for the given tenant, resolved via the
 * company→tenant mapping. Only active mappings are considered.
 *
 * Returns deduplicated `(gradeId, levelId, levelName)` tuples, sorted by
 * gradeId ascending (e.g. "1", "2", … "5", "6", … "10", …).
 */
export async function getGradeLevelsForTenant(tenantId: string): Promise<GradeLevelOption[]> {
  const companyRows = await db
    .select({ companyId: schema.syncCompanyTenantMap.companyId })
    .from(schema.syncCompanyTenantMap)
    .where(
      and(
        eq(schema.syncCompanyTenantMap.tenantId, tenantId),
        eq(schema.syncCompanyTenantMap.isActive, true),
      ),
    );
  const companyIds = companyRows.map((r) => r.companyId);
  if (companyIds.length === 0) return [];

  const rows = await db
    .select({
      gradeId: schema.syncGradeLevels.gradeId,
      levelId: schema.syncGradeLevels.levelId,
      levelName: schema.syncGradeLevels.levelName,
    })
    .from(schema.syncGradeLevels)
    .where(inArray(schema.syncGradeLevels.companyId, companyIds));

  const seen = new Set<string>();
  const result: GradeLevelOption[] = [];
  for (const r of rows) {
    const key = `${r.gradeId}|${r.levelId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(r);
  }
  result.sort((a, b) => {
    const na = parseInt(a.gradeId, 10);
    const nb = parseInt(b.gradeId, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a.gradeId.localeCompare(b.gradeId);
  });
  return result;
}
