// The Performance-Appraisal scorer — ONE implementation.
//
// It was its own module so both scoring engines could share it: the LLM "AI
// Tournament" (removed since) and AHP + TOPSIS. It imports only leaves
// (`topsis`, `ahp`), so it can never participate in an import cycle.
//
// WHAT IT REPLACED, and why that was a bug. The LLM path had its own PA scorer:
//
//     const PA_SCORE_MAP = { A: 100, B: 80, C: 60, D: 20, E: 0 };
//     computeHardcodedPAScore(grade) {
//       if (!grade || grade === "-") return PA_SCORE_MAP.C;      // -> 60
//       const parts = grade.split(",").filter(Boolean);
//       if (parts.length === 0) return PA_SCORE_MAP.C;           // -> 60
//       return PA_SCORE_MAP[parts[0]] ?? PA_SCORE_MAP.C;         // parts[0] ONLY
//     }
//
// Two defects, both measurable on this deployment:
//
//  1. It read ONLY the newest semester and threw the other five away, so a
//     six-period criterion was decided by one period. `A,C,C,C,C,C` scored 100
//     and `C,C,C,C,C,A` scored 60, when the AHP engine — following the documented
//     method — gives 51 and 41.
//  2. A missing or all-empty record returned the C value, 60. That is a PASSING
//     score invented from no evidence, and 796 of 821 candidates have exactly
//     that record (665 NULL, 131 all-empty), so the criterion returned 60 for
//     essentially everyone while carrying real AHP weight.
//
// The documented method is what runs: absolute-anchor TOPSIS over the six
// semester slots, recency-weighted. A missing record yields 33, the documented
// no-data value, instead of a passing 60.

import { absoluteAnchorTopsisDetailed } from "./topsis.js";
import { computeAhpWeights, pairwiseFromWeights } from "./ahp.js";
import type { PerformanceTrace } from "./run-trace-types.js";

export const PA_GRADE_VALUES: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, E: 0 };

/** Methodology doc: ideal positive = (A,A,A,A,A,A), ideal negative = (D,D,D,D,D,D). */
export const PA_IDEAL_POSITIVE = PA_GRADE_VALUES.A!;
export const PA_IDEAL_NEGATIVE = PA_GRADE_VALUES.D!;
export const PA_MAX_PERIODS = 6;

/**
 * Recency preference across the six periods, as a decay factor: slot k gets
 * preference `decay^k` (slot 0 = newest). 0.8 makes the newest semester weigh
 * ~3x the oldest.
 *
 * The decay is deliberate policy: a semester three years old is weaker evidence
 * of present capability than the most recent one, so PA deliberately degrades
 * older periods rather than averaging them flat. Its cost is that the ORDER of
 * the grades matters — `A,C,C,C,C,C` scores 51 while `C,C,C,C,C,A` scores 41 —
 * and that is the intended reading, not an artefact: the first candidate improved
 * recently, the second declined.
 *
 * Scope of the effect, measured over this deployment: of 156 candidates with PA on
 * record, 147 (94%) hold the SAME grade in every period, and there the weighting
 * is mathematically irrelevant — with any constant-sum vector both distances scale
 * by sqrt(Σw) = 1, so the closeness is weight-independent. The decay therefore
 * only discriminates among the 9 candidates (5.8%) whose record actually varies,
 * which is exactly where it is meant to.
 *
 * Set PA_RECENCY_DECAY=1 for equal weights (absolute TOPSIS with no recency
 * term). The AHP derivation below yields a perfectly consistent matrix (CR = 0)
 * for any decay, so it is one constant and nothing else.
 */
export const PA_RECENCY_DECAY = (() => {
  const raw = parseFloat(process.env.PA_RECENCY_DECAY || "0.8");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.8;
})();

/**
 * Per-period weights, derived with AHP from the recency preference: the
 * preference vector becomes a perfectly consistent pairwise matrix whose priority
 * eigenvector is taken as the weights (CR = 0 by construction). At the default
 * decay of 0.8 this yields 0.271056 · 0.216844 · 0.173476 · 0.138780 · 0.111024 ·
 * 0.088819, newest first.
 */
export const PA_PERIOD_WEIGHTS: number[] = (() => {
  const preference = Array.from({ length: PA_MAX_PERIODS }, (_, k) =>
    Math.pow(PA_RECENCY_DECAY, k)
  );
  return computeAhpWeights(pairwiseFromWeights(preference)).weights;
})();

/**
 * Score one candidate's PA record, 0-100.
 *
 * `grade` is the six-slot CSV, newest semester first. Blank or unrecognised slots
 * read as C — NOT as "ignored": dropping them would shrink the divisor, while
 * reading them as C puts the period into the calculation at the middle value.
 * A candidate with no PA record at all therefore scores 33, not 0 and not 50.
 */
export function scorePerformanceAspect(grade: string | null | undefined): number {
  return tracePerformanceAspect(grade).score;
}

/**
 * `scorePerformanceAspect` with every intermediate: the CSV parts as read, each
 * slot's value, the slot weights before and after renormalisation, D⁺, D⁻ and
 * the closeness. The score above IS this function's `.score` — one computation.
 */
export function tracePerformanceAspect(grade: string | null | undefined): PerformanceTrace {
  const parts = (grade ?? "").split(",").map((p) => p.trim().toUpperCase());
  const values = parts.map((p) => PA_GRADE_VALUES[p] ?? PA_GRADE_VALUES.C!);
  const vector = values.length > 0 ? values : [PA_GRADE_VALUES.C!];
  const d = absoluteAnchorTopsisDetailed(vector, PA_IDEAL_POSITIVE, PA_IDEAL_NEGATIVE, PA_PERIOD_WEIGHTS);
  return {
    raw: grade ?? null,
    parts,
    values: vector,
    rawWeights: d.rawWeights,
    weights: d.weights,
    dPlus: d.dPlus,
    dMinus: d.dMinus,
    closeness: d.closeness,
    score: Math.round(d.closeness * 100),
  };
}
