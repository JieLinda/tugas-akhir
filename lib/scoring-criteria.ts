/**
 * The six scoring aspects, their default weights, and the canonical criterion
 * NAMES that map onto them.
 *
 * A program's criteria list ("Kriteria") is DESCRIPTIVE: no engine reads it.
 * AHP+TOPSIS — the only scoring method — scores all six aspects and takes each
 * one's share from the program's pairwise matrix, or from DEFAULT_ASPECT_WEIGHTS
 * below when no matrix is set.
 *
 * The name → aspect table survives for two readers:
 *  • runs scored by the removed AI Tournament before drizzle/0074 froze their
 *    criteria WITH weights into `config_snapshot`; that engine matched them by
 *    exact name, so reading those weights back must match the same way
 *    (lib/position-detail-actions.ts);
 *  • `syncTemplateCriteriaToPosition` (lib/programs.ts) copies only criteria
 *    whose name maps to an aspect.
 */

import { computeAhpWeights, isValidPairwise } from '@/lib/ahp';

export type ScoringAspectKey =
  | 'technical'
  | 'career'
  | 'behavior'
  | 'performance'
  | 'hav'
  | 'education';

export type CanonicalCriterion = {
  /** Exact canonical name (whitespace-normalised match, see below). */
  name: string;
  aspect: ScoringAspectKey;
  /** One-line Indonesian description of the aspect. */
  hint: string;
};

export const CANONICAL_CRITERIA: CanonicalCriterion[] = [
  {
    name: 'Technical Competency Mapping',
    aspect: 'technical',
    hint: 'Kompetensi teknis vs tuntutan jabatan',
  },
  {
    name: 'Behavior Competency Assessment',
    aspect: 'behavior',
    hint: 'Hasil asesmen perilaku',
  },
  {
    name: 'Performance Appraisal',
    aspect: 'performance',
    hint: 'Riwayat nilai PA',
  },
  {
    name: 'HAV Mapping',
    aspect: 'hav',
    hint: 'Kuadran HAV',
  },
  {
    name: 'Employee Profile - Pendidikan',
    aspect: 'education',
    hint: 'Kesesuaian pendidikan & jurusan',
  },
];

// 'Career Relevance' is deliberately absent: the removed AI Tournament never
// scored a career aspect, so no stored criteria weight names it. Career's share
// is set in the AHP pairwise matrix like every other aspect's.


/**
 * The share of the ranking each aspect carries in EVERY run whose program has no
 * pairwise matrix of its own — which is the shipped state, so in practice this
 * is the standing configuration rather than a fallback.
 *
 * Mirrored as `DEFAULT_WEIGHTS` in `scoring-service/src/ahp-weights.ts`
 * (separate deployable, no shared lib/ — keep the two in step), and used as the
 * starting point of the governance pairwise editor so switching a program to a
 * custom matrix begins from the weights it was already scoring with instead of
 * flattening every aspect to equal.
 *
 * It is NOT seeded from a program's criteria list: that list names the aspects a
 * program assesses and carries no weight at all.
 */
export const DEFAULT_ASPECT_WEIGHTS: Record<ScoringAspectKey, number> = {
  behavior: 35,
  technical: 25,
  hav: 20,
  performance: 10,
  career: 5,
  education: 5,
};

/**
 * DEFAULT_ASPECT_WEIGHTS as a vector in AHP_CRITERIA_ORDER — literally the
 * weight vector a run uses when its program has no pairwise matrix, so anything
 * that reports "the weights in force" for such a program should read this rather
 * than assume equal shares.
 *
 * The order is written out instead of imported from `lib/db/schema.ts` to keep
 * this module client-safe (that module pulls Drizzle in). Same reason the AHP
 * editor keeps its own copy of the order.
 */
export const DEFAULT_AHP_WEIGHT_VECTOR: number[] = [
  DEFAULT_ASPECT_WEIGHTS.technical,
  DEFAULT_ASPECT_WEIGHTS.career,
  DEFAULT_ASPECT_WEIGHTS.behavior,
  DEFAULT_ASPECT_WEIGHTS.performance,
  DEFAULT_ASPECT_WEIGHTS.hav,
  DEFAULT_ASPECT_WEIGHTS.education,
];

/**
 * Row/column order of every stored pairwise matrix.
 *
 * Written out rather than imported from `lib/db/schema.ts` to keep this module
 * client-safe (that one pulls Drizzle in) — the same reason the AHP editor keeps
 * its own copy. It must stay identical to AHP_CRITERIA_ORDER there.
 */
export const AHP_ASPECT_ORDER: ScoringAspectKey[] = [
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
];

/**
 * The weights a program actually scores with, as percentages summing to 100:
 * its own pairwise matrix when one is set, else DEFAULT_ASPECT_WEIGHTS.
 *
 * This is the WHOLE weighting rule of this product — mirrored in
 * scoring-service/src/ahp-weights.ts, which resolves the same two tiers
 * against the database at scoring time. Anything in the web app that needs to
 * state "the weights in force" should call this rather than assume equal shares
 * or read a criteria list.
 */
export function ahpWeightPercentages(
  pairwise: number[][] | null | undefined,
): Record<ScoringAspectKey, number> {
  if (isValidPairwise(pairwise, AHP_ASPECT_ORDER.length)) {
    const { weights } = computeAhpWeights(pairwise);
    return Object.fromEntries(
      AHP_ASPECT_ORDER.map((k, i) => [k, Number((((weights[i] ?? 0) * 100)).toFixed(4))]),
    ) as Record<ScoringAspectKey, number>;
  }
  return { ...DEFAULT_ASPECT_WEIGHTS };
}

/**
 * Normalization applied before matching: trim and collapse whitespace, nothing
 * more. Deliberately NOT case-folding — the AI Tournament matched exactly this
 * way, so a legacy run's stored weights must be read back by the same rule or a
 * case-variant name would start counting for a run it never counted for.
 */
export function normalizeCriterionName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

const BY_NAME = new Map(CANONICAL_CRITERIA.map((c) => [c.name, c]));

/** The canonical criterion this name resolves to, or null when it matches none. */
export function matchCanonicalCriterion(name: string): CanonicalCriterion | null {
  return BY_NAME.get(normalizeCriterionName(name)) ?? null;
}

/** True when this name maps to one of the scoring aspects. */
export function criterionCarriesWeight(name: string): boolean {
  return matchCanonicalCriterion(name) != null;
}
