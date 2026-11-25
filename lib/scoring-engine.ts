"use server";

import { ahpSessionGateError } from '@/lib/ahp-save-rules';
import { requirePermission } from '@/lib/rbac';
import { computePaBreakdown } from '@/lib/pa-topsis';
import { displayedScoreBreakdown, recordedHavQuadrant } from '@/lib/run-score-breakdown';

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq, and, asc, desc, inArray, gte, lte, or, ilike, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ensureLocalUser } from "@/lib/pulse-data";
import { getCurrentTenantId, listAllTenants, liveTenantIdSet, tenantNameMap } from "@/lib/tenant";
import type { ReadinessLevel, PositionCandidate } from "@/lib/talent-data";
import {
  getProgramTemplate,
  syncTemplateCriteriaToPosition,
  applyProgramFilters,
  traceProgramFilters,
  loadFilterableCandidates,
  loadFilterableCandidatesByIds,
  type FailedRule,
} from "@/lib/programs";
import { writePoolTrace } from "@/lib/run-trace/store";
import { RUN_TRACE_VERSION, type PoolTrace } from "../scoring-service/src/run-trace-types";
import {
  RERUN_MODES,
  type AhpRerunSpec,
  type CreatableRerunMode,
} from "@/lib/rerun-modes";
import {
  childFinalistTarget,
  classifyRerunCandidates,
  deriveChildSnapshot,
  nothingLeftToAddMessage,
  resolveFrozenBasis,
  validateRerunRequest,
  type ClassifiedCandidate,
  type RerunCandidateVerdict,
  type RuleVerdict,
  type SkippedCandidate,
} from "@/lib/rerun-freeze";
import { normalizeFilterTree } from "@/lib/filter-rules";
import { readinessLabelForRow } from "@/lib/readiness-label";
import { RERUN_IDEMPOTENCY_WINDOW_SECONDS, rerunRequestKey } from "@/lib/rerun-request-key";
import { inheritExclusionsStatement } from "@/lib/rerun-exclusions";
import { logAudit } from "@/lib/audit";
import { buildDerivedRunLabel, clampRunLabel } from "@/lib/run-label";
import { formatHavQuadrant } from "@/lib/hav-quadrant";
import { isDemoMode } from "@/lib/app-mode";
import { forCurrentMode, loadDemoOnIds, visibleCandidateIds } from "@/lib/demo/store";
import { runsOfCurrentMode, sessionsOfCurrentMode } from "@/lib/demo/run-mode";
import { liveCandidate } from "@/lib/candidate-visibility";
import { primeCompetencyNames } from "@/lib/kamus-name-match-actions";
import { formatDate } from '@/lib/datetime';
import { demoInitialsById, demoScrub } from "@/lib/demo/names";
import { disciplineLabel as sharedDisciplineLabel } from '@/lib/candidate-labels';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A candidate who passed the pool gate (not a sitting incumbent, grade in
 * range). The session stores ids only — scoring-service loads everything it
 * scores itself — so nothing more is carried here.
 */
type PoolCandidate = { id: string; name: string };

export type ScoringRunFilterSummary = {
  templateId: string | null;
  totalEvaluated: number;
  qualifiedCount: number;
  disqualifiedCount: number;
  disqualified: { candidateId: string; name: string; reasons: string[] }[];
  /** Grade range ("rentang level") the candidate pool was filtered with */
  minGradeId?: string | null;
  maxGradeId?: string | null;
  /**
   * Business units whose candidates formed the pool. Recorded so a later
   * full-pool re-run can rebuild the SAME pool (absent on runs created before
   * this field existed — those fall back to the tenants of the run's results).
   */
  includedTenantIds?: string[];
  /**
   * Candidates that entered the pool by explicit choice rather than by clearing
   * the rules — the base run's own finalists and the people a user picked in
   * "Tambah Kandidat". The force-include used to just delete their row from
   * `disqualified`, which left a run where a hard filter had been overridden
   * looking exactly like one where it had been passed. A succession decision
   * that bypassed "Disiplin: sanksi aktif" has to be able to say so.
   *
   * `reasons` is empty and `outsideEvaluatedPool` true when the rebuilt pool
   * never even considered them (outside the grade range or the run's business
   * units), so there is no filter verdict to quote.
   */
  forceIncluded?: {
    candidateId: string;
    name: string;
    source: 'added' | 'base_finalist';
    reasons: string[];
    outsideEvaluatedPool: boolean;
  }[];
  /**
   * Candidates that failed an ADVISORY rule. These are in the pool and scored
   * normally — the flag is something the ranking reports, not something it
   * acted on — which is exactly why it has to be recorded: nothing else in the
   * run would show that MCU (or any other advisory rule) had anything to say
   * about this person.
   *
   * Structured rather than the flat `${label}: ${message}` strings
   * `disqualified` uses, because a reader has to be able to tell the MCU flag
   * apart from the others (by `field`), and
   * `dataMissing` distinguishes "this person fails the rule" from "nobody has
   * filled this column in yet".
   *
   * Absent on runs made before advisory rules existed. Empty array means
   * "evaluated, nothing flagged"; absent means "not evaluated" — do not
   * collapse the two.
   */
  flagged?: {
    candidateId: string;
    name: string;
    rules: { field?: string; label: string; message: string; dataMissing?: boolean }[];
  }[];
};

/**
 * The advisory failures out of a filter pass, in `ScoringRunFilterSummary`
 * shape. Candidates with nothing flagged are dropped so the array holds only
 * rows that say something.
 */
function summarizeFlags(
  decisions: { candidateId: string; name: string; flaggedRules: FailedRule[] }[],
): NonNullable<ScoringRunFilterSummary["flagged"]> {
  return decisions
    .filter((d) => d.flaggedRules.length > 0)
    .map((d) => ({
      candidateId: d.candidateId,
      name: d.name,
      rules: d.flaggedRules.map((r) => ({
        field: r.field,
        label: r.label,
        message: r.message,
        ...(r.dataMissing ? { dataMissing: true } : {}),
      })),
    }));
}

export type ScoringRunSummary = {
  id: string;
  positionId: string;
  method: string;
  program: string | null;
  programTemplateId?: string | null;
  label: string | null;
  status: string;
  candidateCount: number;
  createdAt: Date;
  completedAt: Date | null;
  filterSummary: ScoringRunFilterSummary | null;
  /**
   * Why the run did not finish (FR-RR-12). `status` cannot hold "failed" (its
   * check constraint), so a failed run keeps `in_progress` and the scoring
   * service records the failure in `run_info.failure` — readers show THIS,
   * or a failed run reads "berjalan" forever.
   */
  failure: { kind: "error" | "cancelled"; message: string } | null;
};

/** A new root AHP+TOPSIS run — the only scoring method there is. */
export type StartTournamentInput = {
  positionId: string;
  programTemplateId: string | null;
  label: string | null;
  excludedCandidateIds?: string[];
  minGradeId?: string | null;
  maxGradeId?: string | null;
  /**
   * Business units (tenant IDs) whose candidates form the pool. The current
   * tenant is always included. Defaults to just the current tenant.
   */
  includedTenantIds?: string[];
};

/**
 * Whether the standalone scoring service actually picked the session up.
 *
 * Starting a session and dispatching it are two separate facts, and the UI used
 * to be told only the first: `notifyScoringService` swallowed every failure, so
 * a dead scoring service produced the same "penilaian dimulai" as a healthy one
 * and the wizard then polled a session nothing was working on. The row IS safe —
 * it stays `running` and the service's orphan sweeper claims it on its next
 * start — so this is genuinely "queued", not "failed". It just has to say so.
 */
export type ScoringDispatch = {
  /**
   * `dispatched` — a worker accepted the session and is scoring now.
   * `queued` — nothing is working on it yet; it starts when the service returns.
   */
  status: "dispatched" | "queued";
  /**
   * WHY it queued. Kept separate from `status` so the UI branches on one thing
   * while the wording stays accurate: a reachable service that answers with an
   * HTTP error is not an outage, and telling the operator to "just wait" would
   * be wrong. Null when dispatched.
   */
  reason: "unconfigured" | "unreachable" | "rejected" | null;
  /** User-facing (Indonesian) explanation. Null when dispatched. */
  message: string | null;
  /** Technical cause, for diagnostics — not for a toast. Null when dispatched. */
  detail: string | null;
};

export type StartTournamentResult = {
  sessionId: string;
  runId: string;
  positionId: string;
  programTemplateId: string | null;
  targetFinalists: number;
  totalCandidates: number;
  /** Did the scoring service take it, or is it waiting in the queue? */
  dispatch: ScoringDispatch;
};

export type FinalizeTournamentResult = {
  runId: string;
  candidateCount: number;
};

// ─── Utilities ─────────────────────────────────────────────────────────────

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

/**
 * Parse a gradeId value to a numeric grade. Strips trailing letters
 * (e.g. "5a" → 5, "5b" → 5) and returns null if no digits are found.
 */
function parseGradeNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return Number.isFinite(num) ? num : null;
}

/**
 * Return the highest numeric grade across the given list of gradeId strings.
 * Returns null if the list is empty or no value parses.
 */
function getHighestGradeNumeric(
  gradeIds: (string | null | undefined)[],
): number | null {
  let best: number | null = null;
  for (const id of gradeIds) {
    const num = parseGradeNumeric(id);
    if (num === null) continue;
    if (best === null || num > best) best = num;
  }
  return best;
}

function log(label: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (data)
    console.log(`[Scoring ${ts}] ${label}`, JSON.stringify(data, null, 2));
  else console.log(`[Scoring ${ts}] ${label}`);
}

function determineReadiness(score: number): ReadinessLevel {
  return getReadinessLevel(score) as ReadinessLevel;
}

function getReadinessLevel(score: number): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'lib', 'readiness-config.json'), 'utf-8');
    const config = JSON.parse(raw) as { thresholds: { minScore: number; level: string }[]; defaultLevel: string };
    for (const t of config.thresholds) {
      if (score >= t.minScore) return t.level;
    }
    return config.defaultLevel;
  } catch {
    if (score >= 80) return 'Short';
    if (score >= 65) return 'Medium';
    if (score >= 50) return 'Long';
    return 'Not Ready';
  }
}

// The shared label (lib/candidate-labels.ts). The private copy that stood here
// knew only the old lower-case clear/warning/sanction forms, so every synced
// status — 'CLEAR', 'ST', 'SP3' … — rendered as "-" on a run's result rows.
const disciplineLabel = sharedDisciplineLabel;

function mcuLabel(value: string | null) {
  const map: Record<string, string> = {
    fit: "Fit",
    fit_with_note: "Fit with note",
    unfit: "Unfit",
    expired: "Expired",
  };
  return map[value ?? ""] ?? "-";
}

/**
 * PA computed from a candidate's CURRENT grade — the same rule both scoring
 * engines apply (`computePaBreakdown` in lib/pa-topsis.ts is what
 * scoring-service/src/pa-score.ts runs).
 *
 * Only a fallback now, for a ranked row whose stored details record no PA score
 * (in practice: rows from the old demo seeder). It used to OVERWRITE every row's
 * `scoreBreakdown.performance`, which was wrong twice over. First it had its own
 * letter map, so the chip contradicted the stored value (fixed by delegating to
 * the engines' rule). Then, with the rule shared, it still read TODAY's grade:
 * once a sync brought a new PA, a finished run's chip, Excel export and print
 * showed a PA score the ranking never used, while the criterion panel beside it
 * showed the stored one. A finished run is a record (I-1), so its rows show
 * what the run stored — `displayedScoreBreakdown` (lib/run-score-breakdown.ts).
 */
function computeLivePaScore(grade: string | null | undefined): number {
  return computePaBreakdown(grade).score;
}

function normalizeTechnicalScore(
  value: number | null | undefined,
): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (value <= 0) return 0;
  if (value <= 4) return Math.min(100, Math.round(value * 25));
  if (value <= 5) return Math.min(100, Math.round(value * 20));
  if (value <= 10) return Math.min(100, Math.round(value * 10));
  return Math.min(100, Math.round(value));
}

function getTechnicalScoreFromRows(
  rows: Array<{ currentScore: number | null; score: number | null }>,
): number {
  if (!rows.length) return 50;
  const normalized = rows
    .map((r) => normalizeTechnicalScore(r.currentScore ?? r.score))
    .filter((v): v is number => v !== null);
  if (!normalized.length) return 50;
  return Math.round(
    normalized.reduce((sum, v) => sum + v, 0) / normalized.length,
  );
}

function normalizeEmployeeId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) && trimmed.length < 5
    ? trimmed.padStart(5, "0")
    : trimmed;
}

function buildEmployeeIdKeys(value: string | null | undefined): Set<string> {
  const keys = new Set<string>();
  const normalized = normalizeEmployeeId(value);
  if (!normalized) return keys;
  const upper = normalized.toUpperCase();
  keys.add(upper);
  const digitsOnly = upper.replace(/\D/g, "");
  if (digitsOnly) {
    keys.add(digitsOnly);
    keys.add(digitsOnly.replace(/^0+/, "") || "0");
    if (digitsOnly.length < 5) keys.add(digitsOnly.padStart(5, "0"));
  }
  return keys;
}

function normalizeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length ? normalized : null;
}

function parseRunSummary(row: {
  id: string;
  positionId: string;
  method: string;
  program: string | null;
  label: string | null;
  status: string;
  candidateCount: number;
  createdAt: Date;
  completedAt: Date | null;
  filterSummary: unknown;
  runFailure?: unknown;
}): ScoringRunSummary {
  const { runFailure, ...rest } = row;
  const f = (typeof runFailure === "string" ? safeJson(runFailure) : runFailure) as
    | { kind?: unknown; message?: unknown }
    | null
    | undefined;
  return {
    ...rest,
    filterSummary:
      (row.filterSummary as ScoringRunFilterSummary | null) ?? null,
    failure:
      row.status !== "completed" && f && typeof f.message === "string"
        ? { kind: f.kind === "cancelled" ? "cancelled" : "error", message: f.message }
        : null,
  };
}

function safeJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// ─── Run configuration snapshot ─────────────────────────────────────────────
// A finished run is the record of an assessment on a date, but the program
// template and the readiness thresholds it was run with stay editable forever.
// Freeze both at creation so the run can be explained later with the rules that
// actually applied to it instead of whatever governance says today. Written
// once, never updated — see RunConfigSnapshot in lib/db/schema.ts.

/** Readiness thresholds as configured right now, or null if unreadable. */
function readReadinessConfigFile(): schema.RunConfigSnapshot['readiness'] {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'lib', 'readiness-config.json'),
      'utf-8',
    );
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.thresholds)) return null;
    return {
      thresholds: parsed.thresholds,
      defaultLevel: String(parsed.defaultLevel ?? 'Not Ready'),
    };
  } catch {
    return null;
  }
}

function buildRunConfigSnapshot(
  template: Awaited<ReturnType<typeof getProgramTemplate>>,
): schema.RunConfigSnapshot {
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    templateSource: 'live',
    template: template
      ? {
          id: template.id,
          code: template.code,
          name: template.name,
          description: template.description,
          targetFinalists: template.targetFinalists,
          defaultMethod: template.defaultMethod,
          enforceFilterRules: template.enforceFilterRules,
          isSystem: template.isSystem,
          filterTree: template.filterTree,
          ruleCount: template.filterRules.length,
          defaultCriteria: template.defaultCriteria,
          ahpConfig: template.ahpConfig,
          updatedAt: template.updatedAt.toISOString(),
        }
      : null,
    readiness: readReadinessConfigFile(),
  };
}

// ─── Candidate pool builder ─────────────────────────────────────────────────

async function buildPoolFromCandidateIds(
  tenantId: string | string[],
  positionRow: any,
  candidateIds: string[],
  gradeOverride?: {
    minGradeId?: string | null;
    maxGradeId?: string | null;
  } | null,
  /**
   * Run trace (drizzle/0092): filled with every candidate's gate outcome — the
   * grade it was judged on, incumbent or not — by the same predicate that keeps
   * or drops it. Absent → nothing is recorded and nothing changes.
   */
  gateTrace?: PoolTrace['gate'],
): Promise<PoolCandidate[]> {
  if (candidateIds.length === 0) return [];

  // One tenant or several (cross-tenant scoring pool).
  const tenantIds = Array.isArray(tenantId) ? tenantId : [tenantId];
  const candidateRows = await db
    .select()
    .from(schema.candidates)
    .where(
      and(
        inArray(schema.candidates.tenantId, tenantIds),
        inArray(schema.candidates.id, candidateIds),
        // Every pool a run scores is built here — a soft-deleted candidate
        // must not be scored again.
        liveCandidate(),
      ),
    );

  // Resolve the min/max gradeId (numeric) once — prefer override, fallback to positionRow
  const minGradeNumeric = parseGradeNumeric(
    gradeOverride?.minGradeId ?? positionRow.minGradeId,
  );
  const maxGradeNumeric = parseGradeNumeric(
    gradeOverride?.maxGradeId ?? positionRow.maxGradeId,
  );

  // EVERY sitting incumbent, not just the primary one on the row: a position
  // held by several people (drizzle/0058) would otherwise rank its own holders
  // as their successors.
  const incumbentRecords: Array<{ employeeId: string | null; name: string | null }> = [
    { employeeId: positionRow.holderEmployeeId, name: positionRow.holderName },
    ...((positionRow.holders ?? []) as Array<{ employeeId: string | null; name: string | null }>),
  ];
  const incumbentEmployeeIdKeys = new Set<string>();
  const incumbentNameKeys = new Set<string>();
  for (const record of incumbentRecords) {
    for (const key of buildEmployeeIdKeys(record.employeeId)) {
      incumbentEmployeeIdKeys.add(key);
    }
    const nameKey = normalizeName(record.name);
    if (nameKey) incumbentNameKeys.add(nameKey);
  }

  const isIncumbent = (candidate: { employeeId: string | null; name: string | null }) => {
    for (const key of buildEmployeeIdKeys(candidate.employeeId)) {
      if (incumbentEmployeeIdKeys.has(key)) return true;
    }
    const nameKey = normalizeName(candidate.name);
    return Boolean(nameKey && incumbentNameKeys.has(nameKey));
  };
  // Grade gate: only include candidates whose grade (trailing letters
  // stripped, e.g. "5a" → 5) is within the position's minGradeId–maxGradeId
  // range.
  const gradeInRange = (grade: number | null) => {
    if (minGradeNumeric === null && maxGradeNumeric === null) return true;
    if (grade === null) return false;
    if (minGradeNumeric !== null && grade < minGradeNumeric) return false;
    if (maxGradeNumeric !== null && grade > maxGradeNumeric) return false;
    return true;
  };

  // Demo mode: OFF candidates dropped and ON ones read as their demo copy.
  const visibleRows = await forCurrentMode(candidateRows, (c) => c.id, { onlyOn: true });
  return visibleRows.filter((candidate) => {
    // Exclude the current incumbents from the candidate pool, then the grade gate.
    const incumbent = isIncumbent(candidate);
    const gradeNumeric = parseGradeNumeric(candidate.grade);
    const gradeOk = gradeInRange(gradeNumeric);
    gateTrace?.push({
      candidateId: candidate.id,
      grade: candidate.grade ?? null,
      gradeNumeric,
      incumbent,
      gradeOk,
      passed: !incumbent && gradeOk,
    });
    return !incumbent && gradeOk;
  });
}

async function loadPositionRow(positionId: string) {
  const [row] = await db
    .select()
    .from(schema.criticalPositions)
    .where(eq(schema.criticalPositions.id, positionId))
    .limit(1);
  if (!row) throw new Error("Posisi sasaran tidak ditemukan.");

  // A non-unique role has several sitting incumbents (drizzle/0058), and every
  // one of them must be kept out of their own successor pool — the row's
  // holder_* columns only name the primary. Loaded here so all four pool-building
  // paths get the same exclusion without each remembering to ask.
  const holders = await db
    .select({
      employeeId: schema.criticalPositionHolders.employeeId,
      name: schema.criticalPositionHolders.name,
    })
    .from(schema.criticalPositionHolders)
    .where(eq(schema.criticalPositionHolders.positionId, positionId));

  return { ...row, holders };
}

// ─── Server actions ─────────────────────────────────────────────────────────

export async function startTournamentSessionAction(
  input: StartTournamentInput,
): Promise<StartTournamentResult> {
  await requirePermission('scoring.run');
  const positionId = String(input.positionId ?? "").trim();
  if (!isUuid(positionId)) {
    throw new Error(
      "Posisi ini masih memakai ID mock lama. Buka posisi dari daftar terbaru sebelum menjalankan scoring.",
    );
  }
  const programTemplateId =
    input.programTemplateId && isUuid(input.programTemplateId)
      ? input.programTemplateId
      : null;
  const label = input.label?.trim() || null;
  const excludedCandidateIds = Array.isArray(input.excludedCandidateIds)
    ? input.excludedCandidateIds.filter(
        (id): id is string => typeof id === "string",
      )
    : [];

  const [userId, tenantId] = await Promise.all([
    ensureLocalUser(),
    getCurrentTenantId(),
  ]);

  // Business units contributing candidates to this run. The current tenant is
  // always included; extra units must be valid, known tenants. Order-stable and
  // de-duplicated, current tenant first.
  const validTenantIds = await liveTenantIdSet();
  const includedTenantIds = Array.from(
    new Set([
      tenantId,
      ...(Array.isArray(input.includedTenantIds) ? input.includedTenantIds : []).filter(
        (id) => validTenantIds.has(id),
      ),
    ]),
  );

  const positionRow = await loadPositionRow(positionId);

  // A position is registered under exactly one program (drizzle/0056), so a run
  // may only use that program. Scoring the same seat under another one is done
  // by adding the position again — which keeps each program's bench, filters and
  // ranking history separate instead of stacking them on one row.
  const requestedTemplate = programTemplateId
    ? await getProgramTemplate(programTemplateId)
    : null;
  if (requestedTemplate && requestedTemplate.code !== positionRow.programCode) {
    throw new Error(
      `Posisi "${positionRow.title}" terdaftar pada program lain. Tambahkan posisi ini pada program "${requestedTemplate.name}" lebih dulu di Manajemen Posisi.`,
    );
  }

  // New-session gate (docs/ahp-input-sync.md §7): a session may not START from
  // a program whose stored AHP matrix fails validateAhpPairwise (off the Saaty
  // scale, not reciprocal, or CR > 0.1). The engine itself is unchanged and
  // would score it; this only stops a NEW run from being built on input the
  // save path would reject today. Finished runs are not touched.
  const ahpGate = ahpSessionGateError(requestedTemplate?.ahpConfig, requestedTemplate?.name ?? '');
  if (ahpGate) throw new Error(ahpGate);

  if (programTemplateId)
    await syncTemplateCriteriaToPosition(positionId, programTemplateId);

  const allCandidates = await db
    .select()
    .from(schema.candidates)
    // Source of the run's pool: soft-deleted candidates are excluded.
    .where(
      and(
        inArray(schema.candidates.tenantId, includedTenantIds),
        liveCandidate(),
      ),
    );

  const excludedSet = new Set(excludedCandidateIds);
  // Demo mode: an OFF candidate is not in the population at all (lib/demo/).
  const demo = await isDemoMode();
  const populationIds = await visibleCandidateIds(allCandidates.map((c) => c.id));
  const candidateIds = populationIds.filter((id) => !excludedSet.has(id));
  // Run trace (drizzle/0092): every gate outcome, by the predicate that decides it.
  const gateTrace: PoolTrace['gate'] = [];
  const pool = await buildPoolFromCandidateIds(
    includedTenantIds,
    positionRow,
    candidateIds,
    {
      minGradeId: input.minGradeId,
      maxGradeId: input.maxGradeId,
    },
    gateTrace,
  );

  if (pool.length === 0)
    throw new Error("Tidak ada kandidat aktif untuk Company ini.");

  const template = requestedTemplate;

  // ── Hard eligibility filter (opt-in per program template) ────────────
  // When enabled, candidates that fail the program's filter rules are
  // excluded from the run entirely (never scored) and recorded as
  // "Tidak Lolos" with the rule they broke.
  let workingPool = pool;
  let disqualified: ScoringRunFilterSummary["disqualified"] = [];
  let flagged: ScoringRunFilterSummary["flagged"];
  let filterTrace: PoolTrace["filter"] = null;
  // The rules are EVALUATED whenever the program has any, even with
  // `enforceFilterRules` off. Advisory rules never remove anybody, so there is
  // nothing to gate: skipping the pass would only throw away the flags, and
  // those are the whole point of a rule that reports instead of rejecting.
  // Only the DISQUALIFICATION below is conditional.
  if (template && template.filterRules.length > 0) {
    const filterable = await loadFilterableCandidates(includedTenantIds);
    const byId = new Map(filterable.map((c) => [c.id, c]));
    const poolForFilter = pool
      .map((c) => byId.get(c.id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));
    const decisions = applyProgramFilters(template, poolForFilter);
    flagged = summarizeFlags(decisions);
    try {
      const traced = traceProgramFilters(template, poolForFilter);
      filterTrace = { enforce: template.enforceFilterRules, ...traced };
    } catch (err) {
      // The trace explains the pool; it must never stop one being built.
      log("startTournamentSession.filterTraceFailed", { error: String(err) });
    }

    if (template.enforceFilterRules) {
      const failedIds = new Set(
        decisions.filter((d) => !d.qualified).map((d) => d.candidateId),
      );
      disqualified = decisions
        .filter((d) => !d.qualified)
        .map((d) => ({
          candidateId: d.candidateId,
          name: d.name,
          reasons: d.failedRules.map((r) => `${r.label}: ${r.message}`),
        }));
      workingPool = pool.filter((c) => !failedIds.has(c.id));
      log("startTournamentSession.filterEnforced", {
        before: pool.length,
        after: workingPool.length,
        disqualified: disqualified.length,
        flagged: flagged.length,
      });
      if (workingPool.length === 0) {
        throw new Error(
          `Semua kandidat gagal aturan filter program "${template.name}". Longgarkan aturan filter atau nonaktifkan penerapan hard-filter.`,
        );
      }
    }
  }

  const targetFinalists = Math.min(
    template?.targetFinalists ?? 10,
    workingPool.length,
  );

  // The whole pool is scored in one deterministic AHP+TOPSIS computation, so
  // all of it goes into currentPool. Sorted by id so the stored pool is stable
  // for the same set of candidates.
  workingPool.sort((a, b) => a.id.localeCompare(b.id));
  const poolIds = workingPool.map((c) => c.id);

  const [session] = await db
    .insert(schema.tournamentSessions)
    .values({
      tenantId,
      positionId,
      programTemplateId,
      label,
      targetFinalists,
      currentPool: poolIds,
      pendingPool: [],
      scoringMethod: "ahp_topsis",
      status: "running",
      // Demo session: scoring-service scores the demo copies (drizzle/0093).
      isDemo: demo,
      createdBy: userId,
    })
    .returning({ id: schema.tournamentSessions.id });

  // Record the grade range actually applied to the pool (mirrors
  // buildPoolFromCandidateIds's override-then-position fallback) so run
  // history shows which settings produced this run.
  const runFilterSummary: ScoringRunFilterSummary = {
    templateId: programTemplateId,
    totalEvaluated: pool.length,
    qualifiedCount: workingPool.length,
    disqualifiedCount: disqualified.length,
    disqualified,
    minGradeId: input.minGradeId ?? positionRow.minGradeId ?? null,
    maxGradeId: input.maxGradeId ?? positionRow.maxGradeId ?? null,
    includedTenantIds,
    flagged,
  };

  // Create a placeholder scoring run so it's visible on the position page
  const [placeholderRun] = await db
    .insert(schema.scoringRuns)
    .values({
      positionId,
      tenantId,
      programTemplateId,
      method: "AHP_TOPSIS",
      program: template?.code ?? null,
      label:
        clampRunLabel(label) ||
        clampRunLabel(`${template?.name ?? "Penilaian"} — ${formatDate(new Date())}`),
      status: "in_progress",
      // A baseline run: no parent, and the mode says so rather than leaving the
      // column null for readers to guess at.
      rerunMode: "baseline",
      candidateCount: workingPool.length,
      filterSummary: runFilterSummary,
      // Freeze the program rules this pool was actually filtered with.
      configSnapshot: buildRunConfigSnapshot(template),
      // Listed only in demo mode (and real runs only in real mode).
      isDemo: demo,
      createdBy: userId,
    })
    .returning({ id: schema.scoringRuns.id });

  // Link the run to the session
  await db
    .update(schema.tournamentSessions)
    .set({ runId: placeholderRun!.id, updatedAt: new Date() })
    .where(eq(schema.tournamentSessions.id, session!.id));

  // The pool stage of the run's calculation trace — before dispatch, while the
  // run is in progress (a completed run's trace is immutable, I-1). Best-effort.
  await writePoolTrace({
    runId: placeholderRun!.id,
    tenantId,
    trace: {
      version: RUN_TRACE_VERSION,
      stage: "pool",
      generatedAt: new Date().toISOString(),
      population: populationIds.length,
      excludedByUser: allCandidates.filter((c) => excludedSet.has(c.id)).map((c) => c.id),
      grade: {
        minGradeId: input.minGradeId ?? positionRow.minGradeId ?? null,
        maxGradeId: input.maxGradeId ?? positionRow.maxGradeId ?? null,
        min: parseGradeNumeric(input.minGradeId ?? positionRow.minGradeId),
        max: parseGradeNumeric(input.maxGradeId ?? positionRow.maxGradeId),
      },
      gate: gateTrace,
      filter: filterTrace,
    },
  }).catch((err) => log("startTournamentSession.poolTraceFailed", { error: String(err) }));

  log("startTournamentSession", {
    sessionId: session!.id,
    runId: placeholderRun!.id,
    poolSize: workingPool.length,
    targetFinalists,
  });

  // Kick off background processing in the standalone scoring service, which
  // runs in its own Node process so a long run cannot hit a server-action
  // timeout. It updates `tournament_sessions` and `scoring_runs` rows as it
  // goes, and the wizard polls for progress.
  // Never throws: the session is created and visible either way, and the
  // service's orphan sweeper claims a `running` session with no worker on its
  // next start. The status is returned so the caller can tell the user which of
  // "sedang dinilai" and "masuk antrean" actually happened.
  const dispatch = await notifyScoringService(session!.id);

  return {
    sessionId: session!.id,
    runId: placeholderRun!.id,
    positionId,
    programTemplateId,
    targetFinalists,
    totalCandidates: workingPool.length,
    dispatch,
  };
}

/**
 * Notify the standalone scoring service that a new session is ready to
 * process. Best-effort: if the service is down, the session is still
 * created and visible; the service can resume it on its next start.
 *
 * Never throws — every caller has already committed the session and the run, and
 * a failure here is a *queue*, not a lost request. It returns WHICH of the two
 * happened so the caller can say so; previously each of the five call sites
 * `.catch()`-and-logged, which made the outcome invisible above this line.
 */
async function notifyScoringService(sessionId: string): Promise<ScoringDispatch> {
  // Resolve competency names onto kamus codes BEFORE the service picks the
  // session up. This is the single chokepoint every session-start path goes
  // through (wizard, bulk add, program re-score), and it has to happen here
  // rather than inside the service: the last resolution tier needs an LLM, and
  // scoring must stay runnable with no model reachable — the orphan sweeper
  // restarts sessions with nobody watching. The service only reads the cache.
  //
  // Best-effort and capped, so a slow or dead model delays nothing: unresolved
  // names simply behave as they did before the resolver existed.
  await primeCompetencyNames();

  const url = process.env.SCORING_SERVICE_URL;
  if (!url) {
    log("scoringService.disabled", { sessionId, reason: "no SCORING_SERVICE_URL" });
    return {
      status: "queued",
      reason: "unconfigured",
      message:
        "Layanan scoring belum dikonfigurasi (SCORING_SERVICE_URL), jadi sesi ini baru masuk antrean. Penilaian mulai otomatis begitu layanan tersedia.",
      detail: "SCORING_SERVICE_URL is not set",
    };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/scoring/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: controller.signal,
    });
    // A reply — even an error one — means the service is ALIVE. Reporting that
    // as "tidak merespons" would send the operator to check a healthy process,
    // so an HTTP error keeps its status code and gets its own wording. It is
    // still "queued" rather than a thrown failure, because the session and run
    // rows are already committed and the orphan sweeper does claim them.
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 600);
      log("scoringService.rejected", { sessionId, status: res.status, body: text });
      // A 404 has two very different causes, and neither is "wait": the generic
      // advice below would leave the session queued forever.
      if (res.status === 404) {
        const misroute = describeStart404(text);
        if (misroute) return misroute;
      }
      return {
        status: "queued",
        reason: "rejected",
        message:
          `Layanan scoring menolak permintaan (HTTP ${res.status}), jadi sesi ini belum diproses. ` +
          "Datanya sudah tersimpan. Layanannya sendiri hidup, jadi laporkan kode ini ke admin " +
          "kalau sesi tetap tidak berjalan.",
        detail: `HTTP ${res.status}: ${text}`,
      };
    }
    log("scoringService.notified", { sessionId, status: res.status });
    return { status: "dispatched", reason: null, message: null, detail: null };
  } catch (err) {
    // The 5s AbortController timeout, DNS failure, connection refused: nothing
    // answered at all. This is the outage case, and the only one where "wait"
    // is the whole of the advice.
    const detail = err instanceof Error ? err.message : String(err);
    log("scoringService.notifyFailed", { sessionId, error: detail });
    return {
      status: "queued",
      reason: "unreachable",
      message:
        "Layanan scoring tidak merespons, jadi sesi ini masuk antrean. Datanya sudah tersimpan dan penilaian mulai otomatis begitu layanan hidup kembali — tidak perlu memulai ulang.",
      detail,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** host:port/database of a connection string, never its credentials. */
function databaseTargetLabel(raw: string | undefined): string {
  if (!raw) return "(tidak diset)";
  try {
    const u = new URL(raw);
    return `${u.hostname}:${u.port || "5432"}/${decodeURIComponent(u.pathname.replace(/^\//, ""))}`;
  } catch {
    return "(tidak terbaca)";
  }
}

/**
 * Explain a 404 from `POST /api/scoring/start`. This is called only after the
 * session row is committed, so the service can only miss it for one of two
 * reasons, each a configuration fault that waiting will never fix:
 *
 * - JSON `{ error: "Session not found" }`: the service is alive but reads a
 *   DIFFERENT database. Its orphan sweeper sweeps that database too, so this
 *   session is never picked up. Its own target (no credentials) is in the reply.
 * - anything else (Express's "Cannot POST …" page, a proxy's 404): the URL does
 *   not reach the scoring service at all.
 */
function describeStart404(body: string): ScoringDispatch | null {
  let parsed: { error?: unknown; database?: Record<string, unknown> } | null = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = null;
  }
  const webDb = databaseTargetLabel(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  if (parsed && parsed.error === "Session not found") {
    const d = parsed.database;
    const serviceDb = d
      ? `${d.host ?? "?"}:${d.port ?? "?"}/${d.database ?? "?"} (dari ${d.source ?? "?"})`
      : "(versi layanan lama tidak melaporkannya)";
    return {
      status: "queued",
      reason: "rejected",
      message:
        "Layanan scoring tidak menemukan sesi yang baru saja disimpan (HTTP 404), artinya layanan itu " +
        "terhubung ke database yang berbeda dari aplikasi web. Sesi ini tidak akan berjalan dengan sendirinya — " +
        "minta admin menyamakan DATABASE_URL layanan scoring dengan aplikasi web lalu me-restart layanan; " +
        "setelah itu sesi ini dinilai otomatis.",
      detail: `HTTP 404 Session not found · database web: ${webDb} · database layanan scoring: ${serviceDb}`,
    };
  }
  const url = process.env.SCORING_SERVICE_URL ?? "";
  return {
    status: "queued",
    reason: "rejected",
    message:
      "Alamat layanan scoring tidak dikenali (HTTP 404): SCORING_SERVICE_URL kemungkinan menunjuk ke layanan " +
      "lain atau port yang salah. Sesi ini sudah tersimpan dan dinilai otomatis oleh layanan scoring yang benar — " +
      "minta admin memeriksa SCORING_SERVICE_URL.",
    detail: `HTTP 404 dari ${url.replace(/\/+$/, "")}/api/scoring/start: ${body.slice(0, 200)}`,
  };
}

/**
 * Fallback for the wizard when its polling gave up before the session reached a
 * terminal state: asks scoring-service to finish the session (`/finalize`) and
 * waits for it. A session that already completed just returns its run.
 */
export async function finalizeTournamentAction(
  sessionId: string,
): Promise<FinalizeTournamentResult> {
  await requirePermission('scoring.run');
  if (!isUuid(sessionId)) throw new Error("ID sesi penilaian tidak valid.");

  const [session] = await db
    .select()
    .from(schema.tournamentSessions)
    .where(and(eq(schema.tournamentSessions.id, sessionId), await sessionsOfCurrentMode()))
    .limit(1);
  if (!session) throw new Error("Sesi penilaian tidak ditemukan.");

  if (session.status === "completed" && session.runId) {
    return { runId: session.runId, candidateCount: session.currentPool.length };
  }

  const url = process.env.SCORING_SERVICE_URL;
  if (!url) {
    throw new Error("SCORING_SERVICE_URL tidak dikonfigurasi.");
  }

  const baseUrl = url.replace(/\/$/, "");

  // Call the scoring service to trigger finalization
  const finalizeRes = await fetch(`${baseUrl}/api/scoring/${sessionId}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!finalizeRes.ok) {
    const text = await finalizeRes.text();
    throw new Error(
      `Scoring service finalize failed: HTTP ${finalizeRes.status}: ${text}`,
    );
  }

  // Poll for completion (up to 4 minutes, 2-second intervals)
  let statusData: { status: string; currentPoolSize?: number } | null = null;
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const statusRes = await fetch(`${baseUrl}/api/scoring/${sessionId}/status`);
    if (!statusRes.ok) continue;
    statusData = await statusRes.json();
    if (
      statusData?.status === "completed" ||
      statusData?.status === "failed"
    ) {
      break;
    }
  }

  if (!statusData || statusData.status !== "completed") {
    throw new Error(
      "Scoring service finalization did not complete in time.",
    );
  }

  revalidatePath(`/positions/${session.positionId}`);
  revalidatePath("/positions");

  return {
    runId: session.runId!,
    candidateCount: statusData.currentPoolSize ?? session.currentPool.length,
  };
}

/** A row of the comparison-candidate search ("Tambah Kandidat Pembanding"). */
export type AddableCandidateResult = {
  id: string;
  name: string;
  currentPosition: string | null;
  department: string | null;
  yearsExperience: number | null;
  tenantId: string;
  businessUnit: string | null;
};

/**
 * Server-side, limited search for candidates addable to a run. Lazily invoked
 * by the "Tambah Kandidat" dialog so the position page never eagerly loads the
 * full cross-tenant candidate list. Searches by name/position/department across
 * all business units (optionally scoped to one), excludes ids already in the
 * run and the incumbent, and caps the result set.
 */
export async function searchAddableCandidatesAction(input: {
  query?: string;
  tenantId?: string | null;
  excludeIds?: string[];
  /** NPKs of the position's sitting incumbents — a holder must never be
   *  addable to their own successor list. Plural because a non-unique role has
   *  several of them (drizzle/0058). */
  excludeEmployeeIds?: string[];
  limit?: number;
}): Promise<AddableCandidateResult[]> {
  // Accepts a caller-supplied tenantId, so without this guard it reads candidate
  // records across every business unit.
  await requirePermission('candidates.view');
  const q = (input.query ?? "").trim();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const tenantFilter =
    input.tenantId && (await liveTenantIdSet()).has(input.tenantId)
      ? input.tenantId
      : null;

  const conditions = [];
  // Picker feeding a scoring pool: never offer a soft-deleted candidate.
  conditions.push(liveCandidate());
  if (tenantFilter) conditions.push(eq(schema.candidates.tenantId, tenantFilter));
  const excludeIds = (input.excludeIds ?? []).filter(Boolean);
  if (excludeIds.length > 0)
    conditions.push(notInArray(schema.candidates.id, excludeIds));

  // Search, sort and paginate in the application layer over the live set.
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      employeeId: schema.candidates.employeeId,
      currentPosition: schema.candidates.currentPosition,
      department: schema.candidates.department,
      yearsExperience: schema.candidates.yearsExperience,
      tenantId: schema.candidates.tenantId,
    })
    .from(schema.candidates)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const excludeEids = new Set(
    (input.excludeEmployeeIds ?? [])
      .map((id) => id?.trim().toUpperCase())
      .filter((id): id is string => Boolean(id)),
  );
  const tenantName = await tenantNameMap();
  return rows
    .filter((r) => {
      const eid = r.employeeId?.trim().toUpperCase();
      return !(eid && excludeEids.has(eid));
    })
    .filter((r) => {
      if (!q) return true;
      const ql = q.toLowerCase();
      return [r.name, r.currentPosition, r.department].some(
        (v) => v != null && v.toLowerCase().includes(ql),
      );
    })
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      name: r.name,
      currentPosition: r.currentPosition,
      department: r.department,
      yearsExperience:
        r.yearsExperience == null ? null : Number(r.yearsExperience),
      tenantId: r.tenantId,
      businessUnit: tenantName.get(r.tenantId) ?? null,
    }));
}

// ─── Exclusion of candidates from a finished run ───────────────────────────
//
// Mark "tidak dipertimbangkan" with a reason (`setRunExclusionAction`). The
// run's numbers are NOT touched: a completed ranking is the record of an
// assessment on a date, and rewriting it to erase someone destroys the audit
// trail. The results table strikes the row through and finalisation/export
// skip it. Zero recompute, zero rank movement.
//
// There is deliberately no re-rank behind this any more. Re-ranking without
// somebody was a derived run whose only change was a NARROWER alternative set,
// and re-running is now exactly one operation — adding comparison candidates to
// a frozen parent ("Re-run scoring — aturan desain", CLAUDE.md). Runs that were
// re-ranked this way keep `rerun_mode = 'exclude'` and still render.

export type RunExclusionReason = schema.ScoringRunExclusionReason;

export type RunExclusionEntry = {
  candidateId: string;
  reason: RunExclusionReason;
  note: string | null;
  excludedAt: Date;
  excludedByName: string | null;
  /**
   * Set when the mark was inherited from an ancestor run as this
   * "Tambah Kandidat Pembanding" child was created — the run where the forum
   * made it (drizzle/0102). Null: marked on this run.
   */
  inheritedFromRunId: string | null;
  /** That run's label, for "diwarisi dari …". */
  inheritedFromRunLabel: string | null;
};

const EXCLUSION_REASON_LABELS: Record<RunExclusionReason, string> = {
  retired: "Pensiun",
  resigned: "Resign",
  promoted: "Sudah dipromosikan",
  conflict_of_interest: "Konflik kepentingan",
  other: "Lainnya",
};

function parseExclusionReason(value: unknown): RunExclusionReason {
  const v = String(value ?? "other");
  return v in EXCLUSION_REASON_LABELS ? (v as RunExclusionReason) : "other";
}

/** Exclusions of a run, for the results table + the re-rank dialog. */
export async function getRunExclusionsAction(
  runId: string,
): Promise<RunExclusionEntry[]> {
  await requirePermission("positions.view");
  const tenantId = await getCurrentTenantId();

  const rows = await db
    .select({
      candidateId: schema.scoringRunExclusions.candidateId,
      reason: schema.scoringRunExclusions.reason,
      note: schema.scoringRunExclusions.note,
      excludedAt: schema.scoringRunExclusions.excludedAt,
      excludedByName: schema.users.name,
      inheritedFromRunId: schema.scoringRunExclusions.inheritedFromRunId,
      inheritedFromRunLabel: schema.scoringRuns.label,
    })
    .from(schema.scoringRunExclusions)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.scoringRunExclusions.excludedBy),
    )
    .leftJoin(
      schema.scoringRuns,
      eq(schema.scoringRuns.id, schema.scoringRunExclusions.inheritedFromRunId),
    )
    .where(
      and(
        eq(schema.scoringRunExclusions.runId, runId),
        eq(schema.scoringRunExclusions.tenantId, tenantId),
      ),
    )
    .orderBy(asc(schema.scoringRunExclusions.excludedAt));

  return rows.map((r) => ({
    candidateId: r.candidateId,
    reason: parseExclusionReason(r.reason),
    note: r.note,
    excludedAt: r.excludedAt,
    excludedByName: r.excludedByName ?? null,
    inheritedFromRunId: r.inheritedFromRunId ?? null,
    inheritedFromRunLabel: r.inheritedFromRunLabel ?? null,
  }));
}

export type SetRunExclusionResult = { ok: true };

/**
 * Soft-exclude a candidate from a finished run, or undo it (`excluded=false`).
 *
 * Only the mark: the run's ranking is never recomputed and no derived run is
 * produced (see the section comment above).
 */
export async function setRunExclusionAction(
  formData: FormData,
): Promise<SetRunExclusionResult> {
  await requirePermission("scoring.run");
  const runId = (formData.get("runId") as string) || null;
  const candidateId = (formData.get("candidateId") as string) || null;
  const excluded = String(formData.get("excluded") ?? "true") === "true";
  const reason = parseExclusionReason(formData.get("reason"));
  const note = ((formData.get("note") as string) || "").trim() || null;

  if (!runId || !candidateId)
    throw new Error("runId dan candidateId diperlukan.");
  if (excluded && reason === "other" && !note)
    throw new Error("Alasan 'Lainnya' wajib disertai keterangan.");
  // FR-MRK-01: undoing a mark is recorded like the mark itself — who, when, why.
  if (!excluded && !note)
    throw new Error("Alasan pembatalan tanda wajib diisi.");

  const [userId, tenantId] = await Promise.all([
    ensureLocalUser(),
    getCurrentTenantId(),
  ]);

  const [run] = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
    })
    .from(schema.scoringRuns)
    .where(
      and(eq(schema.scoringRuns.id, runId), eq(schema.scoringRuns.tenantId, tenantId), await runsOfCurrentMode()),
    )
    .limit(1);
  if (!run) throw new Error("Run tidak ditemukan.");

  const [candidate] = await db
    .select({ name: schema.candidates.name })
    .from(schema.candidates)
    .where(eq(schema.candidates.id, candidateId))
    .limit(1);
  if (!candidate) throw new Error("Kandidat tidak ditemukan.");

  // The mark is about a person IN this run. A candidate the run never ranked
  // (a forged request, a stale tab after switching runs) would otherwise get a
  // mark — and an audit line naming them — on a ranking they are not part of.
  // Membership is the run's own pool snapshot, or its result rows for runs from
  // before the snapshot existed. Undoing needs only the mark itself to exist.
  if (excluded) {
    const member = await db.execute(sql`
      SELECT 1 FROM scoring_run_pool_aspects WHERE run_id = ${runId} AND candidate_id = ${candidateId}
      UNION ALL
      SELECT 1 FROM analysis_results WHERE run_id = ${runId} AND candidate_id = ${candidateId}
      LIMIT 1
    `);
    if ((member.rows as unknown[]).length === 0)
      throw new Error("Kandidat ini tidak ada di run ini, sehingga tidak bisa ditandai dikecualikan.");
  } else {
    const [mark] = await db
      .select({ id: schema.scoringRunExclusions.id })
      .from(schema.scoringRunExclusions)
      .where(
        and(
          eq(schema.scoringRunExclusions.runId, runId),
          eq(schema.scoringRunExclusions.candidateId, candidateId),
          eq(schema.scoringRunExclusions.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!mark) throw new Error("Kandidat ini tidak bertanda dikecualikan di run ini.");
  }

  if (excluded) {
    await db
      .insert(schema.scoringRunExclusions)
      .values({ tenantId, runId, candidateId, reason, note, excludedBy: userId })
      .onConflictDoUpdate({
        target: [
          schema.scoringRunExclusions.runId,
          schema.scoringRunExclusions.candidateId,
        ],
        // Re-marking makes it this run's own decision, no longer an inherited one.
        set: { reason, note, excludedBy: userId, excludedAt: new Date(), inheritedFromRunId: null },
      });
  } else {
    await db
      .delete(schema.scoringRunExclusions)
      .where(
        and(
          eq(schema.scoringRunExclusions.runId, runId),
          eq(schema.scoringRunExclusions.candidateId, candidateId),
        ),
      );
  }

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId: userId,
    entityType: "scoring_run",
    entityId: runId,
    action: "run_scoring",
    summary: excluded
      ? `${candidate.name} ditandai dikecualikan (${EXCLUSION_REASON_LABELS[reason]}${note ? `: ${note}` : ""}). Tidak memengaruhi angka: skor dan peringkat run tidak diubah.`
      : `Tanda dikecualikan pada ${candidate.name} dibatalkan (alasan: ${note}).`,
    diff: null,
  });

  revalidatePath(`/positions/${run.positionId}`);
  return { ok: true };
}

/**
 * Resolve a program code (e.g. 'talent', 'successor') to the active
 * program template UUID for the current tenant.
 */
export async function getProgramTemplateByCode(
  code: string,
): Promise<string | null> {
  if (!code) return null;
  const [tenantId] = await Promise.all([getCurrentTenantId()]);
  const [row] = await db
    .select({ id: schema.programTemplates.id })
    .from(schema.programTemplates)
    .where(
      and(
        eq(schema.programTemplates.tenantId, tenantId),
        eq(schema.programTemplates.code, code),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

// ─── Read actions ────────────────────────────────────────────────────────────

export async function getScoringRunsForPosition(
  positionId: string,
  filters?: { program?: string | null; dateFrom?: string | null; dateTo?: string | null },
) {
  // A 'use server' export is callable from any client with any id, so the
  // permission and the tenant are checked here, not trusted from the page.
  await requirePermission('positions.view');
  if (!isUuid(positionId)) return [];
  const tenantId = await getCurrentTenantId();

  const conditions: any[] = [
    eq(schema.scoringRuns.positionId, positionId),
    eq(schema.scoringRuns.tenantId, tenantId),
    // Demo runs only in demo mode, real runs only in real mode (drizzle/0093).
    await runsOfCurrentMode(),
  ];

  if (filters?.program) {
    conditions.push(eq(schema.scoringRuns.program, filters.program));
  }
  if (filters?.dateFrom) {
    conditions.push(gte(schema.scoringRuns.createdAt, new Date(filters.dateFrom)));
  }
  if (filters?.dateTo) {
    const endDate = new Date(filters.dateTo);
    endDate.setHours(23, 59, 59, 999);
    conditions.push(lte(schema.scoringRuns.createdAt, endDate));
  }

  const rows = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
      method: schema.scoringRuns.method,
      program: schema.scoringRuns.program,
      label: schema.scoringRuns.label,
      status: schema.scoringRuns.status,
      candidateCount: schema.scoringRuns.candidateCount,
      createdAt: schema.scoringRuns.createdAt,
      completedAt: schema.scoringRuns.completedAt,
      filterSummary: schema.scoringRuns.filterSummary,
      runFailure: sql<unknown>`${schema.scoringRuns.runInfo} -> 'failure'`,
    })
    .from(schema.scoringRuns)
    .where(and(...conditions))
    .orderBy(desc(schema.scoringRuns.createdAt));
  return rows.map(parseRunSummary);
}

export async function getScoringRun(runId: string): Promise<ScoringRunSummary | null> {
  await requirePermission('positions.view');
  if (!isUuid(runId)) return null;
  const tenantId = await getCurrentTenantId();
  const rows = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
      method: schema.scoringRuns.method,
      program: schema.scoringRuns.program,
      label: schema.scoringRuns.label,
      status: schema.scoringRuns.status,
      candidateCount: schema.scoringRuns.candidateCount,
      createdAt: schema.scoringRuns.createdAt,
      completedAt: schema.scoringRuns.completedAt,
      filterSummary: schema.scoringRuns.filterSummary,
      runFailure: sql<unknown>`${schema.scoringRuns.runInfo} -> 'failure'`,
    })
    .from(schema.scoringRuns)
    .where(and(eq(schema.scoringRuns.id, runId), eq(schema.scoringRuns.tenantId, tenantId), await runsOfCurrentMode()))
    .limit(1);
  return rows[0] ? parseRunSummary(rows[0]) : null;
}

export async function deleteScoringRunAction(formData: FormData) {
  await requirePermission('scoring.run');
  const runId = String(formData.get("id") ?? "").trim();
  if (!isUuid(runId)) throw new Error("ID scoring run tidak valid.");

  const [tenantId, actorId] = await Promise.all([
    getCurrentTenantId(),
    ensureLocalUser(),
  ]);

  const [existing] = await db
    .select({
      id: schema.scoringRuns.id,
      tenantId: schema.scoringRuns.tenantId,
      positionId: schema.scoringRuns.positionId,
      label: schema.scoringRuns.label,
      method: schema.scoringRuns.method,
    })
    .from(schema.scoringRuns)
    .where(and(eq(schema.scoringRuns.id, runId), await runsOfCurrentMode()))
    .limit(1);

  if (!existing) throw new Error("Scoring run tidak ditemukan.");
  if (existing.tenantId !== tenantId)
    throw new Error("Tidak diizinkan menghapus scoring run Company lain.");

  // Cancel and delete the run's scoring sessions
  const sessionsToDelete = await db
    .select({ id: schema.tournamentSessions.id, status: schema.tournamentSessions.status })
    .from(schema.tournamentSessions)
    .where(eq(schema.tournamentSessions.runId, runId));

  for (const session of sessionsToDelete) {
    if (session.status === 'running' || session.status === 'finalizing') {
      try {
        const url = process.env.SCORING_SERVICE_URL;
        if (url) {
          await fetch(`${url.replace(/\/+$/, '')}/api/scoring/${session.id}/cancel`, { method: 'POST' });
        }
      } catch {
        // scoring service unreachable — mark as failed in DB anyway
      }
    }
  }

  if (sessionsToDelete.length > 0) {
    await db.delete(schema.tournamentSessions).where(eq(schema.tournamentSessions.runId, runId));
  }

  await db.delete(schema.scoringRuns).where(eq(schema.scoringRuns.id, runId));

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: "scoring_run",
    entityId: runId,
    action: "delete",
    summary: `Scoring run "${existing.label ?? existing.method}" dihapus${sessionsToDelete.length > 0 ? ` beserta ${sessionsToDelete.length} sesi penilaian` : ''}.`,
  });

  revalidatePath("/positions");
  revalidatePath(`/positions/${existing.positionId}`);
}

/**
 * A ranked row's stored candidate snapshot. Older snapshots can hold
 * `yearsOfService` as text; it is read back as a number.
 */
function parseResultSnapshot(details: string): PositionCandidate {
  const parsed = JSON.parse(details) as PositionCandidate;
  const years = (parsed as { yearsOfService?: unknown }).yearsOfService;
  if (typeof years === "string") {
    const num = Number(years);
    if (!Number.isNaN(num)) parsed.yearsOfService = num;
  }
  return parsed;
}

export async function getScoringRunResults(runId: string) {
  if (!isUuid(runId)) return [];
  // A server action is callable with any id: scope to the reader's tenant
  // (NFR-RR-07), and read the run's own readiness thresholds while at it.
  await requirePermission("positions.view");
  const tenantId = await getCurrentTenantId();
  const [run] = await db
    .select({
      id: schema.scoringRuns.id,
      readiness: sql<unknown>`${schema.scoringRuns.configSnapshot}->'readiness'`,
    })
    .from(schema.scoringRuns)
    .where(and(eq(schema.scoringRuns.id, runId), eq(schema.scoringRuns.tenantId, tenantId), await runsOfCurrentMode()))
    .limit(1);
  if (!run) return [];

  const rows = await db
    .select({
      candidateId: schema.analysisResults.candidateId,
      method: schema.analysisResults.method,
      finalScore: schema.analysisResults.finalScore,
      rank: schema.analysisResults.rank,
      manualRank: schema.analysisResults.manualRank,
      details: schema.analysisResults.details,
      calculatedAt: schema.analysisResults.calculatedAt,
    })
    .from(schema.analysisResults)
    .where(eq(schema.analysisResults.runId, runId));

  rows.sort((a, b) => (a.manualRank ?? a.rank) - (b.manualRank ?? b.rank));

  const candidateIds = rows.map((r) => r.candidateId);
  if (candidateIds.length === 0) return [];

  const [candidateRows, technicalRows] = await Promise.all([
    // Deliberately NOT filtered by liveCandidate(): this only labels rows that
    // `analysis_results` already contains. Filtering would leave a finished
    // ranking with unenriched holes instead of removing anyone from it.
    db
      .select({
        id: schema.candidates.id,
        name: schema.candidates.name,
        currentPosition: schema.candidates.currentPosition,
        yearsExperience: schema.candidates.yearsExperience,
        havQuadrant: schema.candidates.havQuadrant,
        disciplineStatus: schema.candidates.disciplineStatus,
        mcuStatus: schema.candidates.mcuStatus,
        performanceGrade: schema.candidates.performanceGrade,
        behaviorRecommendation: schema.candidates.behaviorRecommendation,
        behaviorNotes: schema.candidates.behaviorNotes,
      })
      .from(schema.candidates)
      .where(inArray(schema.candidates.id, candidateIds)),
    db
      .select({
        candidateId: schema.candidateTechnicalCompetencies.candidateId,
        score: schema.candidateTechnicalCompetencies.score,
        currentScore: schema.candidateTechnicalCompetencies.currentScore,
      })
      .from(schema.candidateTechnicalCompetencies)
      .where(
        inArray(schema.candidateTechnicalCompetencies.candidateId, candidateIds),
      ),
  ]);

  // No HAV-in-force resolution here any more: a ranked row shows the quadrant
  // the RUN scored (recordedHavQuadrant), so today's HAV is never laid over it.
  const candidatesById = new Map(
    // Demo mode: the live values laid over a ranked row are the demo copy's.
    (await forCurrentMode(candidateRows, (c) => c.id, { onlyOn: false })).map((c) => [c.id, c]),
  );
  const technicalByCandidateId = new Map<string, typeof technicalRows>();
  for (const row of technicalRows) {
    const bucket = technicalByCandidateId.get(row.candidateId) ?? [];
    bucket.push(row);
    technicalByCandidateId.set(row.candidateId, bucket);
  }

  return rows.map((row) => ({
    ...row,
    finalScore: Number(row.finalScore),
    details: (() => {
      const parsed = row.details ? parseResultSnapshot(row.details) : null;
      // The quadrant the RUN scored — never the candidate's HAV today
      // (`recordedHavQuadrant` in lib/run-score-breakdown.ts says why).
      const hav = recordedHavQuadrant(parsed as Record<string, unknown> | null);
      const candidate = candidatesById.get(row.candidateId);
      if (!candidate) {
        return parsed
          ? { ...parsed, havQuadrant: hav.quadrant, havQuadrantSource: hav.source }
          : parsed;
      }

      const technicalScore = getTechnicalScoreFromRows(
        technicalByCandidateId.get(row.candidateId) ?? [],
      );

      let pgLatest = "C";
      if (candidate.performanceGrade) {
        const parts = candidate.performanceGrade.split(",");
        for (const p of parts) {
          if (p?.trim()) {
            pgLatest = p.trim();
            break;
          }
        }
      }

      const enrichedBase: PositionCandidate = (parsed as PositionCandidate) ?? {
        id: row.candidateId,
        name: candidate.name ?? "Kandidat",
        currentPosition: candidate.currentPosition ?? "-",
        yearsOfService: candidate.yearsExperience != null ? Number(candidate.yearsExperience) : 0,
        havQuadrant: candidate.havQuadrant ?? null,
        jobMatch: Math.min(95, Math.max(30, Number(row.finalScore) * 100 - 5)),
        discipline: disciplineLabel(candidate.disciplineStatus),
        mcu: mcuLabel(candidate.mcuStatus),
        performance: pgLatest,
        behaviorRecommendation: candidate.behaviorRecommendation,
        behaviorNotes: candidate.behaviorNotes,
        primaryFilter: {
          discipline: "qualified",
          mcu: "qualified",
          performance: "qualified",
          hav: "qualified",
          behavior: "qualified",
        },
        scoreBreakdown: {
          technical: technicalScore,
          behavior: 0,
          hav: 0,
          performance: 0,
          education: 0,
        },
        weightedScore: Number(row.finalScore) * 100,
        // A row with no stored details: the RUN's own thresholds (FR-SN-04),
        // today's only for a run that recorded none.
        readiness: readinessLabelForRow({
          stored: null,
          scorePct: Number(row.finalScore) * 100,
          snapshot: run.readiness,
          live: determineReadiness,
        }).level as ReadinessLevel,
        constraint: "Siap dikembangkan.",
      };

      return {
        ...enrichedBase,
        // Live data wins for identity — an older snapshot may carry null here.
        // The snapshot name remains the fallback for candidates that no longer
        // exist in the candidates table.
        name: candidate.name ?? enrichedBase.name,
        currentPosition: candidate.currentPosition ?? enrichedBase.currentPosition,
        yearsOfService: candidate.yearsExperience != null ? Number(candidate.yearsExperience) : enrichedBase.yearsOfService,
        havQuadrant: hav.quadrant,
        havQuadrantSource: hav.source,
        discipline: disciplineLabel(candidate.disciplineStatus),
        mcu: mcuLabel(candidate.mcuStatus),
        performance: pgLatest,
        behaviorRecommendation: candidate.behaviorRecommendation,
        behaviorNotes: candidate.behaviorNotes,
        // The RUN's aspect scores, verbatim — never a recomputation from today's
        // candidate row (lib/run-score-breakdown.ts says why; PA used to be
        // recomputed from the current grade here on every row).
        scoreBreakdown: displayedScoreBreakdown(
          enrichedBase.scoreBreakdown,
          parsed?.scoreBreakdown,
          {
            technical: technicalScore,
            performance: () => computeLivePaScore(candidate.performanceGrade),
          },
        ),
      };
    })(),
  }));
}

// ─── Re-running a finished run: "Tambah Kandidat Pembanding" ───────────────
//
// Exactly one kind of child run can be created: the parent, frozen, plus the
// people a forum asked about. Every rule it is created under is decided by the
// pure helpers in lib/rerun-freeze.ts; this section does the reads, hands the
// decisions the facts, and writes what they decided. Why each value is frozen:
// "Re-run scoring — aturan desain" in CLAUDE.md. What the code did before:
// docs/rerun-modes-inventory.md. What each requirement maps to:
// docs/rerun-requirements-audit.md.

/** An accepted candidate, with what the parent's rules made of them. */
export type RerunAddedRef = ClassifiedCandidate;

export type StartRerunResult = {
  runId: string;
  mode: CreatableRerunMode;
  /** Alternatives that will be ranked: the parent's whole pool plus the new ones. */
  candidateCount: number;
  /** The parent's scored pool size, for the "27 → 28" sentence. */
  basePoolSize: number;
  /** The child's "N besar" — the parent's finalist count (FR-RR-09). */
  targetFinalists: number;
  added: RerunAddedRef[];
  /** Named by the request, refused by the server — never dropped silently. */
  skipped: SkippedCandidate[];
  ahpSource: 'parent' | 'live_fallback';
  anchorsSource: 'parent' | 'live_fallback';
  /** `parent` = the new candidates are scored against the parent's position basis. */
  positionBasisSource: 'parent' | 'live_fallback';
  referenceDate: string;
  /** True when an identical request moments earlier already created this run (FR-RR-13). */
  reused: boolean;
  /** Exclusion marks copied from the parent onto the child (drizzle/0102). */
  inheritedExclusions: number;
  /** Did the scoring service take it, or is it waiting in the queue? */
  dispatch: ScoringDispatch;
};

type ParentPoolRow = { candidateId: string; isFinalist: boolean; poolRank: number };

/** The parent's whole scored pool, in its own rank order. */
async function loadParentPool(runId: string): Promise<ParentPoolRow[]> {
  const rows = await db
    .select({
      candidateId: schema.scoringRunPoolAspects.candidateId,
      isFinalist: schema.scoringRunPoolAspects.isFinalist,
      poolRank: schema.scoringRunPoolAspects.poolRank,
    })
    .from(schema.scoringRunPoolAspects)
    .where(eq(schema.scoringRunPoolAspects.runId, runId))
    .orderBy(asc(schema.scoringRunPoolAspects.poolRank));
  return rows.map((r) => ({
    candidateId: r.candidateId,
    isFinalist: Boolean(r.isFinalist),
    poolRank: Number(r.poolRank),
  }));
}

/** Same incumbent test `buildPoolFromCandidateIds` applies, as a predicate. */
function incumbentMatcher(
  positionRow: Awaited<ReturnType<typeof loadPositionRow>>,
): (c: { employeeId: string | null; name: string | null }) => boolean {
  const records = [
    { employeeId: positionRow.holderEmployeeId, name: positionRow.holderName },
    ...positionRow.holders,
  ];
  const idKeys = new Set<string>();
  const nameKeys = new Set<string>();
  for (const r of records) {
    for (const k of buildEmployeeIdKeys(r.employeeId)) idKeys.add(k);
    const nk = normalizeName(r.name);
    if (nk) nameKeys.add(nk);
  }
  return (c) => {
    for (const k of buildEmployeeIdKeys(c.employeeId)) if (idKeys.has(k)) return true;
    const nk = normalizeName(c.name);
    return Boolean(nk && nameKeys.has(nk));
  };
}

/**
 * The parent run, by NAMED columns. Every column named here predates
 * drizzle/0086: a whole-row `select()` would also select `rerun_reason`, and on
 * a database without that migration the preview then failed with nothing but
 * "Status run tidak dapat diperiksa." — the column is never needed to decide
 * whether, or how, a run can take comparison candidates.
 */
async function loadRerunParent(baseRunId: string, tenantId: string) {
  const [row] = await db
    .select({
      id: schema.scoringRuns.id,
      positionId: schema.scoringRuns.positionId,
      tenantId: schema.scoringRuns.tenantId,
      programTemplateId: schema.scoringRuns.programTemplateId,
      program: schema.scoringRuns.program,
      label: schema.scoringRuns.label,
      status: schema.scoringRuns.status,
      isDemo: schema.scoringRuns.isDemo,
      method: schema.scoringRuns.method,
      filterSummary: schema.scoringRuns.filterSummary,
      configSnapshot: schema.scoringRuns.configSnapshot,
      runInfo: schema.scoringRuns.runInfo,
      parentRunId: schema.scoringRuns.parentRunId,
      createdAt: schema.scoringRuns.createdAt,
      completedAt: schema.scoringRuns.completedAt,
    })
    .from(schema.scoringRuns)
    // A parent of the other mode does not exist from here: demo children only
    // grow from demo runs, real children only from real ones (drizzle/0093).
    .where(
      and(
        eq(schema.scoringRuns.id, baseRunId),
        eq(schema.scoringRuns.tenantId, tenantId),
        eq(schema.scoringRuns.isDemo, await isDemoMode()),
      ),
    )
    .limit(1);
  return row ?? null;
}
type RerunParent = NonNullable<Awaited<ReturnType<typeof loadRerunParent>>>;

/**
 * The business units a comparison candidate may come from: the ones the
 * PARENT run covered (its `includedTenantIds`), else the parent's own. A child
 * is its parent except for the candidate set, and the unit scope is one of the
 * parent's rules (NFR-RR-07).
 */
async function rerunScopeTenantIds(parent: RerunParent): Promise<string[]> {
  const fs = (parent.filterSummary as ScoringRunFilterSummary | null) ?? null;
  // Every company ever known, removed ones included: the scope is a rule of the
  // PARENT run, and a later removal must not change what its child may draw from.
  const known = new Set((await listAllTenants()).map((t) => t.id));
  const units = (fs?.includedTenantIds ?? []).filter((id) => known.has(id));
  return units.length > 0 ? units : [parent.tenantId];
}

/**
 * Judge NEW people against the rules the PARENT was built under — its business
 * units, its level range and its frozen filter tree — split by the categories
 * of Tabel 2.4 (FR-RR-05; see `RuleVerdict`). Rules come from the parent's
 * `config_snapshot`; the parent's own program is read live only when the parent
 * predates that column (`rulesSource` says so).
 */
async function evaluateAgainstParentRules(
  ids: string[],
  parent: RerunParent,
  rows: Map<string, { grade: string | null; tenantId: string }>,
): Promise<{
  byId: Map<string, RuleVerdict>;
  flagged: NonNullable<ScoringRunFilterSummary["flagged"]>;
  rulesSource: "parent_snapshot" | "parent_template_live" | "none";
}> {
  const byId = new Map<string, RuleVerdict>(
    ids.map((id) => [id, { rejected: [], excluded: [], outOfScope: [], advisory: [], dataMissing: false }]),
  );
  if (ids.length === 0) return { byId, flagged: [], rulesSource: "none" };
  const fs = (parent.filterSummary as ScoringRunFilterSummary | null) ?? null;

  const units = await rerunScopeTenantIds(parent);
  const minGrade = parseGradeNumeric(fs?.minGradeId ?? null);
  const maxGrade = parseGradeNumeric(fs?.maxGradeId ?? null);
  const tenantName = await tenantNameMap();
  for (const id of ids) {
    const row = rows.get(id);
    const entry = byId.get(id)!;
    if (!row) continue;
    if (!units.includes(row.tenantId)) {
      entry.outOfScope.push(
        `Business unit: ${tenantName.get(row.tenantId) ?? "lain"} di luar business unit run induk`,
      );
    }
    if (minGrade !== null || maxGrade !== null) {
      const g = parseGradeNumeric(row.grade);
      if (g === null) {
        entry.excluded.push("Rentang grade: grade tidak tercatat, jadi tidak dapat dipastikan berada di rentang run induk");
      } else if ((minGrade !== null && g < minGrade) || (maxGrade !== null && g > maxGrade)) {
        entry.excluded.push(
          `Rentang grade: grade ${g} di luar rentang ${minGrade ?? "…"}–${maxGrade ?? "…"} run induk`,
        );
      }
    }
  }

  const snapshotTemplate = (parent.configSnapshot as schema.RunConfigSnapshot | null)?.template;
  const liveTemplate =
    !snapshotTemplate && parent.programTemplateId
      ? await getProgramTemplate(parent.programTemplateId).catch(() => null)
      : null;
  // `enforceFilterRules` off means the rules were narrative context on the
  // parent, not knockouts — rejecting on them would invent a verdict.
  const enforced = snapshotTemplate?.enforceFilterRules ?? liveTemplate?.enforceFilterRules ?? true;
  const rawTree = snapshotTemplate?.filterTree ?? liveTemplate?.filterTree ?? null;
  if (!rawTree) return { byId, flagged: [], rulesSource: "none" };
  const filterRows = await loadFilterableCandidatesByIds(ids).catch(() => []);
  // The stored tree has three historical shapes; normalize rather than trust it.
  const decisions = applyProgramFilters({ filterTree: normalizeFilterTree(rawTree) }, filterRows);
  for (const d of decisions) {
    const entry = byId.get(d.candidateId);
    if (!entry) continue;
    for (const r of d.flaggedRules) entry.advisory.push(`${r.label}: ${r.message}`);
    if (!enforced || d.qualified) continue;
    for (const r of d.failedRules) {
      entry.rejected.push(`${r.label}: ${r.dataMissing ? "data belum tercatat" : r.message}`);
      if (r.dataMissing) entry.dataMissing = true;
    }
  }
  return {
    byId,
    flagged: summarizeFlags(decisions),
    rulesSource: snapshotTemplate?.filterTree ? "parent_snapshot" : "parent_template_live",
  };
}

/** The top of the parent's lineage. A child records it; older runs are walked. */
async function resolveRootRunId(parent: {
  id: string;
  parentRunId: string | null;
  configSnapshot: unknown;
}): Promise<string> {
  const recorded = (parent.configSnapshot as schema.RunConfigSnapshot | null)?.rerun?.rootRunId;
  if (recorded) return recorded;
  if (!parent.parentRunId) return parent.id;
  // Bounded walk: the FK cannot form a cycle, but a manual UPDATE could.
  const res = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_run_id, 0 AS depth FROM scoring_runs WHERE id = ${parent.id}
      UNION ALL
      SELECT p.id, p.parent_run_id, c.depth + 1
        FROM scoring_runs p JOIN chain c ON p.id = c.parent_run_id
       WHERE c.depth < 200
    )
    SELECT id::text AS id FROM chain ORDER BY depth DESC LIMIT 1
  `);
  return ((res.rows as { id: string }[])[0]?.id ?? parent.id) as string;
}

/** Candidate rows needed to classify a request, live or tombstoned. */
async function loadCandidateFacts(ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      employeeId: schema.candidates.employeeId,
      grade: schema.candidates.grade,
      tenantId: schema.candidates.tenantId,
      deletedAt: schema.candidates.deletedAt,
    })
    .from(schema.candidates)
    .where(inArray(schema.candidates.id, ids));
  if (!(await isDemoMode())) return rows;
  // Demo mode: an OFF candidate is as if deleted — the classifier then skips
  // them with the deleted reason — and the ON ones read as their demo copy.
  const on = await loadDemoOnIds(ids);
  const shown = await forCurrentMode(rows, (r) => r.id, { onlyOn: false });
  return shown.map((r) => (on.has(r.id) ? r : { ...r, deletedAt: r.deletedAt ?? new Date(0) }));
}

/**
 * Classify picked people against a parent — the ONE path both the dialog's
 * preview and `startRerunAction` take (FR-RR-03). The decision itself is the
 * pure `classifyRerunCandidates`; this gathers the facts it is decided on.
 */
async function classifyAgainstParent(
  parent: RerunParent,
  parentPool: ParentPoolRow[],
  pickedIds: string[],
  confirmedOutOfRange: Set<string>,
) {
  const positionRow = await loadPositionRow(parent.positionId);
  const isIncumbent = incumbentMatcher(positionRow);
  const requestedIds = pickedIds.filter(isUuid);
  const facts = await loadCandidateFacts(requestedIds);
  const poolIds = new Set(parentPool.map((r) => r.candidateId));
  const outsidePool = facts.filter((f) => !poolIds.has(f.id)).map((f) => f.id);
  const evaluation = await evaluateAgainstParentRules(
    outsidePool,
    parent,
    new Map(facts.map((f) => [f.id, { grade: f.grade ?? null, tenantId: f.tenantId }])),
  );
  const classification = classifyRerunCandidates({
    pickedIds,
    parentPool,
    candidates: new Map(
      facts.map((f) => [
        f.id,
        {
          name: f.name ?? null,
          deleted: f.deletedAt != null,
          isIncumbent: isIncumbent({ employeeId: f.employeeId, name: f.name }),
        },
      ]),
    ),
    verdicts: evaluation.byId,
    confirmedOutOfRange,
  });
  return { ...classification, facts, evaluation, positionRow };
}


/** Postgres "column does not exist" — a migration that has not been applied. */
function isMissingColumn(err: unknown, column: string): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return code === "42703" && msg.includes(column);
}

// Demo mode: the added / skipped lists leave the server as initials (the run itself is created with the data in force).
export async function startRerunAction(
  ...args: Parameters<typeof startRerunActionImpl>
): ReturnType<typeof startRerunActionImpl> {
  return demoScrub(await startRerunActionImpl(...args));
}

async function startRerunActionImpl(input: {
  baseRunId: string;
  mode: string;
  addedCandidateIds: string[];
  /** Out-of-range ("Excluded") candidates the user confirmed one by one (FR-RR-05). */
  confirmedOutOfRangeIds?: string[];
  /** "Alasan / permintaan forum" — stored in `scoring_runs.rerun_reason`. */
  reason: string;
  label?: string;
}): Promise<StartRerunResult> {
  await requirePermission("scoring.run");
  const validationStart = Date.now();
  if (!isUuid(String(input.baseRunId ?? ""))) throw new Error("Run induk tidak valid.");

  // Validation that needs no database first (mode, reason, a non-empty pick),
  // so a request that is wrong on its face is refused before anything is read.
  // The parent facts here are placeholders; the real ones are checked below.
  const early = validateRerunRequest({
    mode: input.mode,
    reason: input.reason,
    addedCandidateIds: input.addedCandidateIds,
    parent: { tenantMatches: true, status: "completed", method: "AHP_TOPSIS", poolSnapshotRows: 1 },
  });
  if (early) throw new Error(early);

  const [userId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
  const reason = input.reason.trim();
  // Every picked id is classified — one that is not even a uuid comes back as
  // "not found" rather than vanishing — but only well-formed ones reach SQL.
  const pickedIds = Array.from(
    new Set(input.addedCandidateIds.map((id) => String(id).trim()).filter(Boolean)),
  );
  const confirmedIds = Array.from(
    new Set((input.confirmedOutOfRangeIds ?? []).map((id) => String(id).trim()).filter(Boolean)),
  );

  const parentRow = await loadRerunParent(input.baseRunId, tenantId);
  const parentPool = parentRow ? await loadParentPool(parentRow.id) : [];
  const refusal = validateRerunRequest({
    mode: input.mode,
    reason,
    addedCandidateIds: pickedIds,
    parent: parentRow
      ? {
          tenantMatches: true,
          status: parentRow.status,
          method: parentRow.method,
          poolSnapshotRows: parentPool.length,
        }
      : null,
  });
  if (refusal) throw new Error(refusal);
  const parent = parentRow!;

  // ── Who is each picked person to the parent? ──────────────────────────
  const { accepted, skipped, facts, evaluation } = await classifyAgainstParent(
    parent,
    parentPool,
    pickedIds,
    new Set(confirmedIds),
  );
  // The message names every skipped person; in demo mode it is built from
  // their initials.
  if (accepted.length === 0) throw new Error(nothingLeftToAddMessage(await demoScrub(skipped)));

  const newIds = accepted.filter((a) => a.classification === "new").map((a) => a.candidateId);
  const existingIds = accepted
    .filter((a) => a.classification === "existing_pool")
    .map((a) => a.candidateId);

  // ── What the child inherits ───────────────────────────────────────────
  const rootRunId = await resolveRootRunId(parent);
  const frozen = {
    ...resolveFrozenBasis({
      parent: {
        id: parent.id,
        completedAt: parent.completedAt,
        createdAt: parent.createdAt,
        runInfo: parent.runInfo,
      },
      rootRunId,
    }),
    validationMs: Date.now() - validationStart,
  };

  // The parent's pool AS IT WAS — not re-filtered for tombstones or for who
  // holds the seat today, because removing anybody from the alternative set is a
  // change the child would then misattribute to the people it adds.
  const poolIds = [...parentPool.map((r) => r.candidateId), ...newIds].sort((a, b) =>
    a.localeCompare(b),
  );
  const parentFinalistCount = parentPool.filter((r) => r.isFinalist).length;
  const targetFinalists = childFinalistTarget(parentFinalistCount, poolIds.length);

  const spec = RERUN_MODES.incremental_add;
  const finalLabel =
    clampRunLabel(input.label) ||
    buildDerivedRunLabel(spec.delta({ added: accepted.length, excluded: 0 }), parent.label, spec.chip);

  const ahpRerun: AhpRerunSpec = {
    mode: "incremental_add",
    baseRunId: parent.id,
    newCandidateIds: newIds,
    existingPoolCandidateIds: existingIds,
    frozen,
  };

  const parentFs = (parent.filterSummary as ScoringRunFilterSummary | null) ?? null;
  const nameOf = (id: string) => facts.find((f) => f.id === id)?.name ?? "";
  const outOfRange = accepted.filter((a) => a.outOfRange);
  const rerunFilterSummary: ScoringRunFilterSummary = {
    templateId: parent.programTemplateId,
    totalEvaluated: poolIds.length,
    qualifiedCount: poolIds.length,
    disqualifiedCount: 0,
    disqualified: [],
    minGradeId: parentFs?.minGradeId ?? null,
    maxGradeId: parentFs?.maxGradeId ?? null,
    includedTenantIds: parentFs?.includedTenantIds,
    // The parent's overrides still stand in this pool. The only NEW override a
    // comparison run can make is an out-of-range ("Excluded") candidate the
    // user confirmed one by one, recorded with the range rule it breaks.
    // Rejected candidates are never here: they are refused (`skipped`).
    forceIncluded: [
      ...(parentFs?.forceIncluded ?? []),
      ...outOfRange.map((a) => ({
        candidateId: a.candidateId,
        name: nameOf(a.candidateId),
        source: "added" as const,
        reasons: a.excludedRules,
        outsideEvaluatedPool: false,
      })),
    ],
    flagged: [
      ...(parentFs?.flagged ?? []),
      ...evaluation.flagged.filter((f) => newIds.includes(f.candidateId)),
    ],
  };

  const requestKey = rerunRequestKey({ parentId: parent.id, pickedIds, confirmedIds, reason });
  const dataPulledAt = new Date().toISOString();
  const rerunSnapshot: schema.RunRerunSnapshot = {
    mode: "incremental_add",
    parentRunId: parent.id,
    rootRunId,
    reason,
    dataPulledAt,
    anchorsSource: frozen.anchors.source,
    added: accepted.map((a) => ({
      candidateId: a.candidateId,
      name: a.name,
      classification: a.classification,
      failedRules: a.excludedRules,
      outOfRange: a.outOfRange,
      advisory: a.advisory,
    })),
    skipped: skipped.map((s) => ({ ...s })),
    frozen,
    requestKey,
  };
  const parentTemplateFallback =
    !(parent.configSnapshot as schema.RunConfigSnapshot | null)?.template && parent.programTemplateId
      ? await getProgramTemplate(parent.programTemplateId)
      : null;
  const configSnapshot = deriveChildSnapshot(
    parent.configSnapshot as schema.RunConfigSnapshot | null,
    parent.id,
    () => buildRunConfigSnapshot(parentTemplateFallback),
    rerunSnapshot,
  );

  // ── Create, once (FR-RR-13) ───────────────────────────────────────────
  // A double click, or a resubmission of the same request, must not create a
  // second child. The advisory lock serialises two concurrent submissions of
  // the same key; the second one then finds the first one's run.
  let created: { runId: string; sessionId: string; reused: boolean; inheritedExclusions: number };
  try {
    created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestKey}, 0))`);
      const prior = await tx.execute(sql`
        SELECT sr.id::text AS "runId",
               (SELECT ts.id::text FROM tournament_sessions ts
                 WHERE ts.run_id = sr.id ORDER BY ts.created_at DESC LIMIT 1) AS "sessionId"
          FROM scoring_runs sr
         WHERE sr.parent_run_id = ${parent.id}
           AND sr.tenant_id = ${tenantId}
           AND sr.config_snapshot #>> '{rerun,requestKey}' = ${requestKey}
           AND sr.created_at > NOW() - make_interval(secs => ${RERUN_IDEMPOTENCY_WINDOW_SECONDS})
         ORDER BY sr.created_at DESC
         LIMIT 1
      `);
      const hit = (prior.rows as { runId: string; sessionId: string | null }[])[0];
      if (hit) return { runId: hit.runId, sessionId: hit.sessionId ?? "", reused: true, inheritedExclusions: 0 };

      const [session] = await tx
        .insert(schema.tournamentSessions)
        .values({
          tenantId,
          positionId: parent.positionId,
          programTemplateId: parent.programTemplateId,
          label: finalLabel,
          targetFinalists,
          currentPool: poolIds,
          pendingPool: [],
          scoringMethod: "ahp_topsis",
          status: "running",
          finalRanked: { ahpRerun },
          // A child is in its parent's mode (loadRerunParent only finds that mode).
          isDemo: parent.isDemo,
          createdBy: userId,
        })
        .returning({ id: schema.tournamentSessions.id });

      const [run] = await tx
        .insert(schema.scoringRuns)
        .values({
          positionId: parent.positionId,
          tenantId,
          // The parent's program, always. Assessing under another program is a
          // new root, never a child — there is no parameter that could change this.
          programTemplateId: parent.programTemplateId,
          method: "AHP_TOPSIS",
          program: parent.program,
          label: finalLabel,
          status: "in_progress",
          candidateCount: poolIds.length,
          filterSummary: rerunFilterSummary,
          // Lineage written at CREATION, so a run that fails still knows its parent.
          parentRunId: parent.id,
          rerunMode: "incremental_add",
          rerunReason: reason,
          configSnapshot,
          isDemo: parent.isDemo,
          createdBy: userId,
        })
        .returning({ id: schema.scoringRuns.id });

      await tx
        .update(schema.tournamentSessions)
        .set({ runId: run!.id, updatedAt: new Date() })
        .where(eq(schema.tournamentSessions.id, session!.id));

      // The parent's exclusion marks come with it (drizzle/0102) — see
      // lib/rerun-exclusions.ts for why and how.
      const inherited = await tx.execute(inheritExclusionsStatement(run!.id, parent.id, tenantId));
      return {
        runId: run!.id,
        sessionId: session!.id,
        reused: false,
        inheritedExclusions: (inherited.rows as unknown[]).length,
      };
    });
  } catch (err) {
    if (isMissingColumn(err, "rerun_reason")) {
      throw new Error(
        "Database belum diperbarui: kolom scoring_runs.rerun_reason belum ada. Terapkan migrasi drizzle/0086_scoring_run_rerun_reason.sql, lalu coba lagi.",
      );
    }
    if (isMissingColumn(err, "inherited_from_run_id")) {
      throw new Error(
        "Database belum diperbarui: kolom scoring_run_exclusions.inherited_from_run_id belum ada. Terapkan migrasi drizzle/0102_inherited_run_exclusions.sql, lalu coba lagi.",
      );
    }
    throw err;
  }

  // A reused run was dispatched by the submission that created it; re-sending
  // is the orphan sweeper's job if that dispatch did not take.
  const dispatch: ScoringDispatch = created.reused
    ? { status: "dispatched", reason: null, message: null, detail: null }
    : await notifyScoringService(created.sessionId);

  log("startRerunAction", {
    baseRunId: parent.id,
    rootRunId,
    runId: created.runId,
    reused: created.reused,
    pool: poolIds.length,
    added: newIds.length,
    existingPool: existingIds.length,
    outOfRangeConfirmed: outOfRange.length,
    skipped: skipped.length,
    targetFinalists,
    ahpSource: frozen.ahp.source,
    anchorsSource: frozen.anchors.source,
    positionBasis: frozen.positionBasis ? "parent" : "live_fallback",
    rulesSource: evaluation.rulesSource,
  });

  if (!created.reused) {
    await logAudit({
      demoScoped: true,
      tenantId,
      actorId: userId,
      entityType: "scoring_run",
      entityId: created.runId,
      action: "run_scoring",
      summary:
        `${spec.label} atas run ${parent.label ?? parent.id}: ${newIds.length} kandidat baru dinilai` +
        (existingIds.length > 0 ? `, ${existingIds.length} dari pool induk ditampilkan tanpa dinilai ulang` : "") +
        (skipped.length > 0 ? `, ${skipped.length} ditolak` : "") +
        `. Alasan: ${reason}. ${spec.expectation}` +
        (outOfRange.length > 0
          ? ` ${outOfRange.length} kandidat di luar rentang grade ditambahkan dengan konfirmasi.`
          : "") +
        (created.inheritedExclusions > 0
          ? ` ${created.inheritedExclusions} tanda pengecualian dari run induk ikut diwariskan.`
          : ""),
      diff: null,
    });
  }

  revalidatePath(`/positions/${parent.positionId}`);
  revalidatePath("/positions");

  return {
    runId: created.runId,
    mode: "incremental_add",
    candidateCount: poolIds.length,
    basePoolSize: parentPool.length,
    targetFinalists,
    added: accepted,
    skipped,
    ahpSource: frozen.ahp.source,
    anchorsSource: frozen.anchors.source,
    positionBasisSource: frozen.positionBasis ? "parent" : "live_fallback",
    referenceDate: frozen.referenceDate,
    reused: created.reused,
    inheritedExclusions: created.inheritedExclusions,
    dispatch,
  };
}

// ── What each searchable person is to a parent run (for the dialog) ──────

/** One picked person's verdict, exactly as the server would decide it. */
export type RerunCandidateStatus = RerunCandidateVerdict;

/**
 * Each candidate's standing against `baseRunId`, computed by the SAME function
 * `startRerunAction` applies (`classifyAgainstParent` → `classifyRerunCandidates`),
 * so what the dialog promises is what the server does (FR-RR-03).
 */
// Demo mode: each verdict's name leaves the server as initials.
export async function getRerunCandidateStatusesAction(
  ...args: Parameters<typeof getRerunCandidateStatusesActionImpl>
): ReturnType<typeof getRerunCandidateStatusesActionImpl> {
  return demoScrub(await getRerunCandidateStatusesActionImpl(...args));
}

async function getRerunCandidateStatusesActionImpl(input: {
  baseRunId: string;
  candidateIds: string[];
  confirmedOutOfRangeIds?: string[];
}): Promise<Record<string, RerunCandidateStatus>> {
  await requirePermission("scoring.run");
  if (!isUuid(String(input.baseRunId ?? ""))) return {};
  const tenantId = await getCurrentTenantId();
  const ids = Array.from(new Set((input.candidateIds ?? []).filter(isUuid))).slice(0, 200);
  if (ids.length === 0) return {};
  const parent = await loadRerunParent(input.baseRunId, tenantId);
  if (!parent) return {};
  const pool = await loadParentPool(parent.id);
  const { verdicts } = await classifyAgainstParent(
    parent,
    pool,
    ids,
    new Set((input.confirmedOutOfRangeIds ?? []).filter(isUuid)),
  );
  return Object.fromEntries(verdicts.map((v) => [v.candidateId, v]));
}

/** One search hit in the "Tambah Kandidat Pembanding" dialog (FR-RR-02). */
export type RerunSearchHit = {
  id: string;
  name: string;
  employeeId: string | null;
  businessUnit: string | null;
  currentPosition: string | null;
  department: string | null;
  grade: string | null;
  /** Job family (rumpun jabatan) of the person's job profile, when one is mapped. */
  jobFamily: string | null;
  /** What the server would do with this person, before any confirmation. */
  status: RerunCandidateStatus | null;
};

/** The job family each candidate's matched job profile sits in, latest map run. */
async function loadCandidateJobFamilies(ids: string[], tenantId: string): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  try {
    const res = await db.execute(sql`
      SELECT jfm.candidate_id::text AS "candidateId",
             COALESCE(NULLIF(t.general_title, ''), t.label) AS family
        FROM job_family_matches jfm
        JOIN LATERAL (
          SELECT r.id FROM job_family_topic_runs r
           WHERE r.status = 'completed'
             AND (r.tenant_id IS NULL OR r.tenant_id = ${tenantId})
           ORDER BY r.created_at DESC
           LIMIT 1
        ) lr ON true
        JOIN job_family_topic_assignments a
          ON a.run_id = lr.id AND a.job_profile_id = jfm.job_profile_id
        LEFT JOIN job_family_topics t
          ON t.run_id = lr.id AND t.topic_id = a.topic_id
       WHERE jfm.candidate_id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
         AND a.topic_id >= 0
    `);
    const out = new Map<string, string>();
    for (const r of res.rows as { candidateId: string; family: string | null }[]) {
      if (r.family) out.set(r.candidateId, r.family);
    }
    return out;
  } catch {
    // Best-effort context: a deployment without a job-family map shows "—".
    return new Map();
  }
}

/**
 * Search people to add as comparison candidates (FR-RR-02): by name, NPK,
 * position or department, across every division — but only within the
 * business units the PARENT run covered (NFR-RR-07). Each hit carries its
 * unit, position, grade and job family, plus the verdict the server would give.
 */
// Demo mode: hits leave the server as initials.
export async function searchRerunCandidatesAction(
  ...args: Parameters<typeof searchRerunCandidatesActionImpl>
): ReturnType<typeof searchRerunCandidatesActionImpl> {
  return demoScrub(await searchRerunCandidatesActionImpl(...args));
}

async function searchRerunCandidatesActionImpl(input: {
  baseRunId: string;
  query?: string;
  limit?: number;
}): Promise<{ hits: RerunSearchHit[]; scopeTenantIds: string[] }> {
  await requirePermission("scoring.run");
  if (!isUuid(String(input.baseRunId ?? ""))) return { hits: [], scopeTenantIds: [] };
  const tenantId = await getCurrentTenantId();
  const parent = await loadRerunParent(input.baseRunId, tenantId);
  if (!parent) return { hits: [], scopeTenantIds: [] };
  const scope = await rerunScopeTenantIds(parent);
  const q = (input.query ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);

  // Matching happens in the application layer, over the live candidates of the
  // parent's units only.
  const rows = await db
    .select({
      id: schema.candidates.id,
      name: schema.candidates.name,
      employeeId: schema.candidates.employeeId,
      currentPosition: schema.candidates.currentPosition,
      department: schema.candidates.department,
      grade: schema.candidates.grade,
      tenantId: schema.candidates.tenantId,
    })
    .from(schema.candidates)
    .where(and(liveCandidate(), inArray(schema.candidates.tenantId, scope)));
  const tenantName = await tenantNameMap();
  // Demo mode: only ON candidates can be added, read as their demo copy, and
  // the NPK is neither searchable nor returned (it is masked everywhere).
  const demo = await isDemoMode();
  // …and searched / sorted on the initials it is shown as, so a real name typed
  // into the box finds nobody instead of revealing whose initials those are.
  const demoInitials = await demoInitialsById();
  const matched = (await forCurrentMode(rows, (r) => r.id, { onlyOn: true }))
    .map((r) => (demoInitials ? { ...r, name: demoInitials.get(r.id) ?? r.name } : r))
    .filter((r) => {
      if (!q) return true;
      return [r.name, demo ? null : r.employeeId, r.currentPosition, r.department].some(
        (v) => v != null && String(v).toLowerCase().includes(q),
      );
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
    .slice(0, limit);

  const pool = await loadParentPool(parent.id);
  const ids = matched.map((r) => r.id);
  const [{ verdicts }, families] = await Promise.all([
    classifyAgainstParent(parent, pool, ids, new Set()),
    loadCandidateJobFamilies(ids, tenantId),
  ]);
  const verdictById = new Map(verdicts.map((v) => [v.candidateId, v]));
  return {
    scopeTenantIds: scope,
    hits: matched.map((r) => ({
      id: r.id,
      name: r.name ?? "",
      employeeId: demo ? null : r.employeeId ?? null,
      businessUnit: tenantName.get(r.tenantId) ?? null,
      currentPosition: r.currentPosition ?? null,
      department: r.department ?? null,
      grade: r.grade ?? null,
      jobFamily: families.get(r.id) ?? null,
      status: verdictById.get(r.id) ?? null,
    })),
  };
}

// ── Can this run take comparison candidates, and what would be frozen? ──

export type RerunPreview =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      parentLabel: string | null;
      poolSize: number;
      finalistCount: number;
      programName: string | null;
      ruleCount: number;
      rulesFrom: "snapshot" | "live";
      minGradeId: string | null;
      maxGradeId: string | null;
      referenceDate: string;
      referenceDateSource: "parent_frozen" | "parent_completed_at";
      ahpSource: "parent" | "live_fallback";
      anchorsSource: "parent" | "live_fallback";
      /** `parent` = new candidates are scored against the parent's position basis. */
      positionBasisSource: "parent" | "live_fallback";
      /** The job profile in that basis, for the "Yang dipakai dari run induk" paragraph. */
      positionBasisJobProfile: string | null;
      /** Business units comparison candidates may come from. */
      scopeTenantIds: string[];
      /** Effective weights in percent over the active criteria. */
      effectiveWeights: { key: string; percent: number }[];
      droppedCriteria: { key: string; reason: string }[];
      /** Exclusion marks on the parent; the child inherits them (drizzle/0102). */
      parentExclusionCount: number;
    };

/**
 * What the "Tambah Kandidat Pembanding" action may say before anything is
 * submitted: whether the run qualifies (the SAME validator the server applies on
 * submit, fed the parent's facts) and exactly what the child would inherit.
 *
 * Never throws for a reason it can name: a database that has not applied a
 * migration, or any other failure, comes back as `eligible: false` with the
 * cause, instead of the client's generic "Status run tidak dapat diperiksa."
 */
export async function getRerunPreviewAction(baseRunId: string): Promise<RerunPreview> {
  await requirePermission("positions.view");
  if (!isUuid(String(baseRunId ?? ""))) return { eligible: false, reason: "Run tidak valid." };
  try {
    const tenantId = await getCurrentTenantId();
    const parent = await loadRerunParent(baseRunId, tenantId);
    const pool = parent ? await loadParentPool(parent.id) : [];
    const refusal = validateRerunRequest({
      mode: "incremental_add",
      reason: "-",
      addedCandidateIds: ["-"],
      parent: parent
        ? { tenantMatches: true, status: parent.status, method: parent.method, poolSnapshotRows: pool.length }
        : null,
    });
    if (refusal) return { eligible: false, reason: refusal };
    const p = parent!;
    const frozen = resolveFrozenBasis({
      parent: { id: p.id, completedAt: p.completedAt, createdAt: p.createdAt, runInfo: p.runInfo },
      rootRunId: p.id,
    });
    const snapshot = (p.configSnapshot as schema.RunConfigSnapshot | null) ?? null;
    const fs = (p.filterSummary as ScoringRunFilterSummary | null) ?? null;
    const active = frozen.ahp.activeCriteria ?? [];
    const sum = active.reduce((a, k) => a + (frozen.ahp.weights?.[k] ?? 0), 0);
    return {
      eligible: true,
      parentLabel: p.label,
      poolSize: pool.length,
      finalistCount: pool.filter((r) => r.isFinalist).length,
      programName: snapshot?.template?.name ?? null,
      ruleCount: snapshot?.template?.ruleCount ?? 0,
      rulesFrom: snapshot?.template ? "snapshot" : "live",
      minGradeId: fs?.minGradeId ?? null,
      maxGradeId: fs?.maxGradeId ?? null,
      referenceDate: frozen.referenceDate,
      referenceDateSource: frozen.referenceDateSource,
      ahpSource: frozen.ahp.source,
      anchorsSource: frozen.anchors.source,
      positionBasisSource: frozen.positionBasis ? "parent" : "live_fallback",
      positionBasisJobProfile: frozen.positionBasis?.jobProfile?.positionName ?? null,
      scopeTenantIds: await rerunScopeTenantIds(p),
      effectiveWeights:
        sum > 0
          ? active.map((k) => ({ key: k, percent: ((frozen.ahp.weights?.[k] ?? 0) / sum) * 100 }))
          : [],
      droppedCriteria: frozen.ahp.droppedCriteria ?? [],
      parentExclusionCount: (
        await db
          .select({ id: schema.scoringRunExclusions.id })
          .from(schema.scoringRunExclusions)
          .where(
            and(
              eq(schema.scoringRunExclusions.runId, p.id),
              eq(schema.scoringRunExclusions.tenantId, tenantId),
            ),
          )
      ).length,
    };
  } catch (err) {
    log("getRerunPreviewAction.failed", { baseRunId, error: String(err) });
    if (isMissingColumn(err, "rerun_reason")) {
      return {
        eligible: false,
        reason:
          "Database belum diperbarui: kolom scoring_runs.rerun_reason belum ada. Terapkan migrasi drizzle/0086_scoring_run_rerun_reason.sql.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { eligible: false, reason: `Status run tidak dapat diperiksa: ${msg}` };
  }
}
