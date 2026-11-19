/**
 * The Performance-Appraisal computation, reproduced for display.
 *
 * WHY A MIRROR. `PerformanceDetail` stores only `{ grade, score }` — the CSV and
 * the final number, nothing between. That is actually enough: the whole
 * calculation is a pure function of that CSV plus fixed constants, so the entire
 * derivation can be rebuilt here rather than adding columns. And because it is
 * rebuilt rather than read, **every run gets a full explanation, including runs
 * finished long before this existed** — the same trick `lib/education-tier.ts`
 * uses for the education tier.
 *
 * MIRRORS `scorePerformanceAspect` + `absoluteAnchorTopsis` in
 * `scoring-service/src/{ahp-topsis-engine,topsis}.ts` (separate deployables, no
 * shared lib). If the grade values, the anchors, or the period weights change
 * there, change them here — a drift would make this page explain a number the
 * engine did not produce.
 *
 * ONE CAVEAT the UI must state: the period weights are read from the CURRENT
 * configuration, while a stored score was produced by whatever weighting was in
 * force when the run executed. `recomputedMatchesStored` reports whether the
 * rebuild lands on the stored number, so a mismatch is disclosed instead of
 * silently presenting today's arithmetic as that run's. (Runs scored during the
 * brief equal-weights period are exactly the case this catches.)
 */

/** Grade → value. E = 0 sits BELOW the negative anchor D = 1; see `anomaly`. */
export const PA_GRADE_VALUES: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, E: 0 };

/** Absolute anchors: all-A is ideal, all-D is anti-ideal. Never set-derived. */
export const PA_IDEAL_POSITIVE = 4;
export const PA_IDEAL_NEGATIVE = 1;
export const PA_MAX_PERIODS = 6;

/**
 * AHP-derived recency weights, newest first — mirrors `PA_RECENCY_DECAY = 0.8` in
 * the engine (preference `0.8^k` → perfectly consistent pairwise matrix → priority
 * eigenvector, CR = 0). Older semesters deliberately count for less.
 *
 * Hardcoded rather than recomputed because the AHP machinery lives in the engine;
 * if `PA_RECENCY_DECAY` changes there, these six numbers must change here too or
 * this page will explain a score the engine did not produce.
 */
export const PA_PERIOD_WEIGHTS: number[] = [
  0.271056, 0.216844, 0.173476, 0.13878, 0.111024, 0.088819,
];

/** Which calendar slot each CSV position refers to, newest first. */
export const PA_SLOT_LABELS = [
  'tahun−1 Semester 2',
  'tahun−1 Semester 1',
  'tahun−2 Semester 2',
  'tahun−2 Semester 1',
  'tahun−3 Semester 2',
  'tahun−3 Semester 1',
];

export type PaPeriod = {
  index: number;
  label: string;
  /** Raw CSV cell, trimmed and upper-cased. Empty string when the slot is blank. */
  raw: string;
  /** Numeric value used. */
  value: number;
  /** True when the slot was blank or unrecognised and read as C. */
  substituted: boolean;
  weight: number;
  /** w × (x − 4)² — this period's contribution to D⁺. */
  contribPlus: number;
  /** w × (x − 1)² — this period's contribution to D⁻. */
  contribMinus: number;
};

export type PaBreakdown = {
  periods: PaPeriod[];
  /** Slots read as C because they were blank/unrecognised. */
  substitutedCount: number;
  /** Every period holds the same grade → the recency weighting cannot affect the score. */
  uniform: boolean;
  dPlus: number;
  dMinus: number;
  closeness: number;
  score: number;
  /** The stored score, when one was given. */
  storedScore: number | null;
  /** False when the rebuild disagrees with the stored score — disclosed, not hidden. */
  recomputedMatchesStored: boolean;
  /**
   * Set when the record contains a grade whose value falls BELOW the negative
   * anchor, which breaks monotonicity: all-E scores 20 while all-D scores 0.
   */
  anomaly: 'below_negative_anchor' | null;
};

/**
 * Rebuild the PA calculation from the stored CSV.
 *
 * `grade` is the six-slot CSV, newest semester first. Blank or unrecognised slots
 * read as C — the engine's convention, and NOT the same as "ignored": a candidate
 * with no PA data at all therefore scores 33, not 0 and not 50.
 */
export function computePaBreakdown(
  grade: string | null | undefined,
  storedScore: number | null = null,
): PaBreakdown {
  const cells = (grade ?? '').split(',').map((p) => p.trim().toUpperCase());
  const raw = cells.length > 0 && grade != null ? cells : [''];

  const values: number[] = [];
  const substituted: boolean[] = [];
  for (const cell of raw) {
    const v = PA_GRADE_VALUES[cell];
    if (v === undefined) {
      values.push(PA_GRADE_VALUES.C!);
      substituted.push(true);
    } else {
      values.push(v);
      substituted.push(false);
    }
  }

  // Weights are renormalized over the slots actually present, so a short CSV is
  // handled without silently treating the missing tail as zero-weight noise.
  const rawWeights = values.map(
    (_, k) => PA_PERIOD_WEIGHTS[k] ?? PA_PERIOD_WEIGHTS[PA_PERIOD_WEIGHTS.length - 1] ?? 1,
  );
  const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const weights = rawWeights.map((x) => x / wSum);

  const periods: PaPeriod[] = values.map((value, i) => ({
    index: i,
    label: PA_SLOT_LABELS[i] ?? `slot ${i + 1}`,
    raw: raw[i] ?? '',
    value,
    substituted: substituted[i] ?? false,
    weight: weights[i]!,
    contribPlus: weights[i]! * (value - PA_IDEAL_POSITIVE) ** 2,
    contribMinus: weights[i]! * (value - PA_IDEAL_NEGATIVE) ** 2,
  }));

  const dPlus = Math.sqrt(periods.reduce((a, p) => a + p.contribPlus, 0));
  const dMinus = Math.sqrt(periods.reduce((a, p) => a + p.contribMinus, 0));
  const closeness = dPlus + dMinus > 0 ? dMinus / (dPlus + dMinus) : 0.5;
  const score = Math.round(closeness * 100);

  return {
    periods,
    substitutedCount: substituted.filter(Boolean).length,
    uniform: new Set(values).size <= 1,
    dPlus,
    dMinus,
    closeness,
    score,
    storedScore,
    recomputedMatchesStored: storedScore == null || storedScore === score,
    anomaly: values.some((v) => v < PA_IDEAL_NEGATIVE) ? 'below_negative_anchor' : null,
  };
}
