'use server';

// Client-invoked loaders for the heavy parts of the position detail page.
// These used to run inside the server component's render, which — for large
// runs / large tenants — produced a slow, multi-MB SSR response that nginx
// could reset (ERR_CONNECTION_RESET). Fetching them client-side keeps the
// initial document tiny (the shell always loads) and shows a loading state
// instead of a hard failure.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getScoringRunResults, getRunExclusionsAction } from '@/lib/scoring-engine';
import type { RunExclusionEntry } from '@/lib/scoring-engine';
import { getCandidateBusinessUnits, getCandidateProfiles } from '@/lib/pulse-data';
import type { CandidateProfile, PositionCandidate } from '@/lib/talent-data';
import { requirePermission } from '@/lib/rbac';
import { AHP_CRITERIA_ORDER, type RunConfigSnapshot } from '@/lib/db/schema';
import { computeAhpWeights, isValidPairwise } from '@/lib/ahp';
import type { ScoringAspectKey } from '@/lib/scoring-criteria';
import {
  defaultCriterionOrder,
  orderCriteriaByWeight,
  toWeightPercentages,
  UNKNOWN_CRITERION_ORDER,
  type RunCriterionOrder,
} from '@/lib/criterion-weight-order';
import { demoScrub } from '@/lib/demo/names';

export type PositionRunViewData = {
  candidates: PositionCandidate[];
  candidateBusinessUnits: Record<string, string>;
  initialTieOverrides: Record<string, string[]>;
  qualifiedCount: number;
  /**
   * Candidates marked "tidak dipertimbangkan" on THIS run. Their rows are still
   * present above with their original rank and score — a completed run is a
   * record of an assessment, so an exclusion annotates it instead of rewriting
   * it. The table strikes them through and the derived counts skip them.
   */
  exclusions: RunExclusionEntry[];
  /**
   * Which breakdown chip goes first — the criterion that carried the most
   * weight in THIS run, from what the run itself recorded. See
   * lib/criterion-weight-order.ts.
   */
  criterionOrder: RunCriterionOrder;
};

// ── Historical criterion weights for one run ───────────────────────

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Shape of `run_info.ahp` we care about here — see RunInfo in progress-running-actions. */
type StoredAhp = {
  weights?: Record<string, number>;
  effectiveWeights?: Record<string, number>;
};

function pickAspectWeights(
  raw: Record<string, number> | null | undefined,
): Partial<Record<ScoringAspectKey, number>> | null {
  if (!raw) return null;
  const out: Partial<Record<ScoringAspectKey, number>> = {};
  for (const key of AHP_CRITERIA_ORDER) {
    const v = Number(raw[key]);
    if (Number.isFinite(v)) out[key] = v;
  }
  return toWeightPercentages(out);
}

/**
 * The weights that actually shaped this run, resolved from the run's OWN record
 * only:
 *
 *  1. `scoring_runs.run_info.ahp` — what the engine applied. `effectiveWeights`
 *     wins over `weights` because a criterion nobody could be scored on is
 *     dropped from the TOPSIS matrix with its share redistributed, so its real
 *     contribution to this ranking was zero and it belongs last.
 *  2. The session's copy of the same blob — runs finished before drizzle/0065
 *     only have that one.
 *  3. The pairwise matrix frozen into `config_snapshot` at run creation.
 *  4. DEFAULT_ASPECT_WEIGHTS when the run recorded a config but no matrix:
 *     those are the weights in force for a matrix-less program, which is the
 *     shipped state. A run with no snapshot at all stays `unknown` — it predates
 *     the column and nothing about its weighting is recoverable.
 *
 * It deliberately STOPS one tier short of `resolveAhpConfig` in
 * lib/progress-running-actions.ts, which also reconstructs from the program
 * template as it stands today. That is fine for a panel that labels the value
 * `template` and explains it; it is not fine here, because it would silently
 * re-order a finished run's badges the next time somebody edits the matrix in
 * governance — the thing `config_snapshot` exists to prevent.
 */
async function resolveRunCriterionOrder(runId: string): Promise<RunCriterionOrder> {
  if (!isUuid(runId)) return UNKNOWN_CRITERION_ORDER;

  let row:
    | {
        runInfoOwn: { ahp?: StoredAhp } | null;
        finalRanked: { runInfo?: { ahp?: StoredAhp } } | null;
        configSnapshot: RunConfigSnapshot | null;
      }
    | undefined;
  try {
    // One run can own several sessions (a cancelled one plus its replacement),
    // so the pick is ordered rather than left to whatever the join returns —
    // two page loads must not disagree about the badge order.
    const res = await db.execute(sql`
      SELECT sr.run_info        AS "runInfoOwn",
             sr.config_snapshot AS "configSnapshot",
             ts.final_ranked    AS "finalRanked"
      FROM scoring_runs sr
      LEFT JOIN tournament_sessions ts ON ts.run_id = sr.id
      WHERE sr.id = ${runId}
      ORDER BY (ts.final_ranked IS NOT NULL) DESC, ts.created_at DESC NULLS LAST
      LIMIT 1
    `);
    row = (res.rows as any[])[0];
  } catch (err) {
    // The chips still render in the canonical order — an unreadable run must
    // not take the tab down over a presentation detail.
    console.error('resolveRunCriterionOrder failed', err);
    return UNKNOWN_CRITERION_ORDER;
  }
  if (!row) return UNKNOWN_CRITERION_ORDER;

  const storedAhp = row.runInfoOwn?.ahp ?? row.finalRanked?.runInfo?.ahp ?? null;
  const fromRun =
    pickAspectWeights(storedAhp?.effectiveWeights) ?? pickAspectWeights(storedAhp?.weights);
  if (fromRun) {
    return {
      order: orderCriteriaByWeight(fromRun),
      weights: fromRun,
      source: 'run',
      note: 'Urutan mengikuti bobot AHP yang benar-benar dipakai run ini (tersimpan pada run, bukan dibaca ulang dari tata kelola).',
    };
  }

  const template = row.configSnapshot?.template ?? null;
  if (!template) return UNKNOWN_CRITERION_ORDER;

  const snapshotPairwise = template.ahpConfig?.pairwise ?? null;
  if (isValidPairwise(snapshotPairwise, AHP_CRITERIA_ORDER.length)) {
    const { weights } = computeAhpWeights(snapshotPairwise);
    const pct = toWeightPercentages(
      Object.fromEntries(
        AHP_CRITERIA_ORDER.map((k, i) => [k, weights[i] ?? 0]),
      ) as Partial<Record<ScoringAspectKey, number>>,
    );
    if (pct) {
      return {
        order: orderCriteriaByWeight(pct),
        weights: pct,
        source: 'snapshot-matrix',
        note: 'Urutan mengikuti matriks AHP yang dibekukan ke run ini saat dibuat.',
      };
    }
  }

  return defaultCriterionOrder();
}

/**
 * Load everything the run table + analysis tabs need for a single run:
 * the ranked candidate dossiers plus the values derived from them.
 */
// Demo mode: names — in the rows, their narratives and the exclusion notes — leave the server as initials.
export async function loadPositionRunViewDataAction(
  ...args: Parameters<typeof loadPositionRunViewDataActionImpl>
): ReturnType<typeof loadPositionRunViewDataActionImpl> {
  return demoScrub(await loadPositionRunViewDataActionImpl(...args));
}

async function loadPositionRunViewDataActionImpl(
  runId: string,
  positionDepartment: string | null,
): Promise<PositionRunViewData> {
  await requirePermission('positions.view');
  const runResults = await getScoringRunResults(runId);

  // Rebuild the manual tie-break overrides from stored manualRank values.
  const initialTieOverrides: Record<string, string[]> = {};
  const byScore = new Map<string, { id: string; manualRank: number | null; rank: number }[]>();
  for (const r of runResults) {
    if (r.manualRank == null) continue;
    const score = String(Number(r.finalScore));
    const arr = byScore.get(score) ?? [];
    arr.push({ id: r.candidateId, manualRank: r.manualRank, rank: r.rank });
    byScore.set(score, arr);
  }
  for (const [score, arr] of byScore) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => (a.manualRank ?? a.rank) - (b.manualRank ?? b.rank));
    initialTieOverrides[score] = arr.map((c) => c.id);
  }

  const candidates = runResults
    .map((result) => result.details)
    .filter((candidate): candidate is NonNullable<(typeof runResults)[number]['details']> =>
      Boolean(candidate),
    ) as PositionCandidate[];

  const [candidateBusinessUnits, exclusions, criterionOrder] = await Promise.all([
    getCandidateBusinessUnits(candidates.map((c) => c.id)),
    getRunExclusionsAction(runId),
    resolveRunCriterionOrder(runId),
  ]);
  const excludedIds = new Set(exclusions.map((e) => e.candidateId));
  // An excluded candidate is out of the succession pipeline, so they must not
  // keep counting toward "siap" coverage — that number drives the readiness
  // gauge on the position page.
  const qualifiedCount = candidates.filter(
    (c) => c.readiness !== 'Not Ready' && !excludedIds.has(c.id),
  ).length;

  return {
    candidates,
    candidateBusinessUnits,
    initialTieOverrides,
    qualifiedCount,
    exclusions,
    criterionOrder,
  };
}

/**
 * Tenant-wide candidate profiles used by the comparison/dossier tabs.
 * History enrichment, not a pool: this intentionally includes soft-deleted
 * candidates so a finished run's ranked rows and picks keep their dossier
 * data. Do not add a deleted_at filter here (lib/candidate-visibility.ts).
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function loadCandidateProfilesForAnalysisAction(
  ...args: Parameters<typeof loadCandidateProfilesForAnalysisActionImpl>
): ReturnType<typeof loadCandidateProfilesForAnalysisActionImpl> {
  return demoScrub(await loadCandidateProfilesForAnalysisActionImpl(...args));
}

async function loadCandidateProfilesForAnalysisActionImpl(): Promise<CandidateProfile[]> {
  await requirePermission('candidates.view');
  return getCandidateProfiles();
}
