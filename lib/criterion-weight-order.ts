/**
 * The order the six breakdown chips are rendered in on a run's Kandidat tab —
 * heaviest-weighted criterion of THAT RUN first.
 *
 * WHY THIS EXISTS: the chips used to be six hardcoded JSX blocks in a fixed
 * order (technical, behavior, HAV, performance, education, career), which says
 * nothing about the ranking the reader is looking at. Two runs of different
 * programs are weighted differently — and the same program's matrix is editable
 * in governance — so a fixed order silently presents a 5%-weight criterion in
 * the same position as the one carrying 35% of the score.
 *
 * WHY IT MUST BE HISTORICAL: a completed ranking is the record of an assessment
 * on a date. Reading governance live to order the chips would re-order a
 * finished run's badges the moment somebody edits the pairwise matrix, which is
 * the same mistake `config_snapshot` exists to prevent — so the resolver
 * (`resolveRunCriterionOrder` in lib/position-detail-actions.ts) reads only what
 * the run itself recorded and deliberately stops short of the live template
 * tier that `resolveAhpConfig` has.
 *
 * This module is the CLIENT-SAFE half: types plus the pure ordering rule. It
 * must not import `@/lib/db` (the chips are rendered in a client component).
 */

import {
  DEFAULT_ASPECT_WEIGHTS,
  type ScoringAspectKey,
} from '@/lib/scoring-criteria';

/**
 * Where the weights that decided the order came from.
 *
 *  • `run`               — `scoring_runs.run_info.ahp` (or the session's copy):
 *                          what the engine actually applied. Authoritative.
 *  • `snapshot-matrix`   — the pairwise matrix frozen into `config_snapshot` at
 *                          run creation. Still this run's own configuration.
 *  • `defaults`          — the run recorded nothing; DEFAULT_ASPECT_WEIGHTS are
 *                          the weights in force for a matrix-less program, so
 *                          they are the honest guess rather than equal shares.
 *  • `unknown`           — no weight evidence at all; the canonical order stands
 *                          and the UI must not claim it means anything.
 */
export type CriterionWeightSource =
  | 'run'
  | 'snapshot-matrix'
  | 'defaults'
  | 'unknown';

export type RunCriterionOrder = {
  /** The six aspect keys, heaviest first. Always all six, always deterministic. */
  order: ScoringAspectKey[];
  /** Aspect → share of the ranking, in percent (0..100). Empty when unknown. */
  weights: Partial<Record<ScoringAspectKey, number>>;
  source: CriterionWeightSource;
  /** One sentence naming what the order is based on, for the chip tooltip. */
  note: string;
};

/**
 * The order the chips have always been rendered in. Used as the tie-break (so
 * two equally-weighted criteria can never swap between two page loads) and as
 * the whole answer when a run recorded no weights — which keeps such a run
 * looking exactly as it did before this existed.
 */
export const CANONICAL_CRITERION_ORDER: ScoringAspectKey[] = [
  'technical',
  'behavior',
  'hav',
  'performance',
  'education',
  'career',
];

export const UNKNOWN_CRITERION_ORDER: RunCriterionOrder = {
  order: CANONICAL_CRITERION_ORDER,
  weights: {},
  source: 'unknown',
  note: 'Run ini tidak merekam bobot kriteria, sehingga urutan badge memakai urutan baku.',
};

/**
 * Sort the six aspects by weight, descending.
 *
 * Ties break on CANONICAL_CRITERION_ORDER rather than being left to the sort's
 * input order — equal weights are common (the default matrix has career and
 * education both at 5) and an order that reshuffles between renders would
 * report a difference the weights never produced.
 */
export function orderCriteriaByWeight(
  weights: Partial<Record<ScoringAspectKey, number>>,
): ScoringAspectKey[] {
  return [...CANONICAL_CRITERION_ORDER].sort((a, b) => {
    const diff = (weights[b] ?? 0) - (weights[a] ?? 0);
    if (Math.abs(diff) > 1e-9) return diff;
    return CANONICAL_CRITERION_ORDER.indexOf(a) - CANONICAL_CRITERION_ORDER.indexOf(b);
  });
}

/**
 * Turn a raw weight map into percentages that sum to 100.
 *
 * Sources disagree about scale on purpose: the engine stores priorities as
 * 0..1, DEFAULT_ASPECT_WEIGHTS are points out of 100, and a governance criteria
 * list is whatever the operator typed. Normalising by the actual sum is what
 * the engines themselves do (`weight / divisor`), so it reproduces the share
 * each criterion really carried instead of assuming a scale.
 *
 * Returns null when nothing positive is present — an all-zero map is an absence
 * of weights, not a flat ranking.
 */
export function toWeightPercentages(
  raw: Partial<Record<ScoringAspectKey, number>> | null | undefined,
): Partial<Record<ScoringAspectKey, number>> | null {
  if (!raw) return null;
  let total = 0;
  for (const key of CANONICAL_CRITERION_ORDER) {
    const v = Number(raw[key]);
    if (Number.isFinite(v) && v > 0) total += v;
  }
  if (total <= 0) return null;

  const out: Partial<Record<ScoringAspectKey, number>> = {};
  for (const key of CANONICAL_CRITERION_ORDER) {
    const v = Number(raw[key]);
    out[key] = Number.isFinite(v) && v > 0 ? Number(((v / total) * 100).toFixed(1)) : 0;
  }
  return out;
}

/** DEFAULT_ASPECT_WEIGHTS as the resolved order — the matrix-less standing config. */
export function defaultCriterionOrder(): RunCriterionOrder {
  const weights = toWeightPercentages(DEFAULT_ASPECT_WEIGHTS) ?? {};
  return {
    order: orderCriteriaByWeight(weights),
    weights,
    source: 'defaults',
    note: 'Run ini tidak merekam bobotnya sendiri; urutan memakai bobot sistem default (yang juga dipakai program tanpa matriks AHP).',
  };
}

/** Human label for the tooltip on one chip. */
export function criterionWeightHint(
  resolved: RunCriterionOrder,
  key: ScoringAspectKey,
): string | undefined {
  const pct = resolved.weights[key];
  if (pct == null) return undefined;
  return `Bobot pada run ini: ${pct}%`;
}
