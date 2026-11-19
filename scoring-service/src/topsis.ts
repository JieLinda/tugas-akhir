// TOPSIS (Technique for Order Preference by Similarity to Ideal Solution).
// Two flavors live here:
//  1. topsisRank        — classic TOPSIS over a decision matrix (ideal
//                         solutions derived from the candidate set) used for
//                         the final AHP-weighted ranking.
//  2. absoluteAnchorTopsis — the Performance-Appraisal aspect scorer: the
//                         ideal positive/negative are ABSOLUTE anchors instead
//                         of set-derived, so the score is comparable across runs.
//                         The PA caller anchors on all-A / all-D (see
//                         PA_IDEAL_NEGATIVE), not all-E, and passes recency-
//                         decayed period weights (see PA_RECENCY_DECAY).

export type TopsisResult = {
  /** Closeness coefficient per alternative, ∈ [0, 1] (1 = ideal). */
  closeness: number[];
  dPlus: number[];
  dMinus: number[];
};

/** `TopsisResult` plus every intermediate quantity (see `topsisDetailed`). */
export type TopsisDetail = TopsisResult & {
  /** sqrt(Σx²) per criterion — the normalisation divisor. */
  colNorms: number[];
  /** r_ij = x_ij / divisor_j (display only). */
  normalized: number[][];
  /** v_ij = w_j · x_ij / divisor_j. */
  weighted: number[][];
  /** Weighted ideal positive / negative per criterion. */
  idealPos: number[];
  idealNeg: number[];
  /** (v_ij − ideal⁺_j)² and (v_ij − ideal⁻_j)²: criterion j's share of D⁺ / D⁻ before the root. */
  contribPlus: number[][];
  contribMinus: number[][];
};

/**
 * Classic TOPSIS with every intermediate quantity exposed — the ONE
 * implementation (I-7). The engine ranks with it through `topsisRank`; the web
 * app's run comparison and reproducibility check read its intermediates
 * (divisors, ideals, per-criterion contributions to D⁺/D⁻) instead of keeping a
 * copy of the formula. Shared with the web build; keep it dependency-free.
 *
 * `matrix` is alternatives × criteria; `weights` must sum to 1 and match the
 * criteria count; `types` marks each criterion as benefit (higher is better) or
 * cost (lower is better).
 */
export function topsisDetailed(
  matrix: number[][],
  weights: number[],
  types: ("benefit" | "cost")[]
): TopsisDetail {
  const m = matrix.length;
  const n = weights.length;
  if (m === 0) {
    return {
      closeness: [],
      dPlus: [],
      dMinus: [],
      colNorms: [],
      normalized: [],
      weighted: [],
      idealPos: [],
      idealNeg: [],
      contribPlus: [],
      contribMinus: [],
    };
  }

  // 1. Vector normalization: r_ij = x_ij / sqrt(Σ_i x_ij²)
  const colNorms = Array.from({ length: n }, (_, j) => {
    let sumSq = 0;
    for (let i = 0; i < m; i++) sumSq += (matrix[i]![j] ?? 0) ** 2;
    return Math.sqrt(sumSq) || 1e-9;
  });

  // 2. Weighted normalized matrix: v_ij = w_j · r_ij, computed as (w·x)/norm —
  //    that operation order is what every stored closeness was produced with.
  const v = matrix.map((row) =>
    row.map((x, j) => (weights[j]! * x) / colNorms[j]!)
  );
  // r_ij itself, for display only (never fed back into v).
  const normalized = matrix.map((row) => row.map((x, j) => x / colNorms[j]!));

  // 3. Ideal positive / negative per criterion
  const idealPos: number[] = [];
  const idealNeg: number[] = [];
  for (let j = 0; j < n; j++) {
    const col = v.map((row) => row[j]!);
    if (types[j] === "cost") {
      idealPos.push(Math.min(...col));
      idealNeg.push(Math.max(...col));
    } else {
      idealPos.push(Math.max(...col));
      idealNeg.push(Math.min(...col));
    }
  }

  // 4. Euclidean distances + closeness coefficient. The per-criterion squared
  //    differences are kept: they are each criterion's share of D⁺ and D⁻.
  const dPlus: number[] = [];
  const dMinus: number[] = [];
  const closeness: number[] = [];
  const contribPlus: number[][] = [];
  const contribMinus: number[][] = [];
  for (let i = 0; i < m; i++) {
    let dp = 0;
    let dn = 0;
    const cp: number[] = [];
    const cn: number[] = [];
    for (let j = 0; j < n; j++) {
      const p = (v[i]![j]! - idealPos[j]!) ** 2;
      const q = (v[i]![j]! - idealNeg[j]!) ** 2;
      cp.push(p);
      cn.push(q);
      dp += p;
      dn += q;
    }
    const dpv = Math.sqrt(dp);
    const dnv = Math.sqrt(dn);
    dPlus.push(dpv);
    dMinus.push(dnv);
    closeness.push(dpv + dnv > 0 ? dnv / (dpv + dnv) : 0.5);
    contribPlus.push(cp);
    contribMinus.push(cn);
  }

  return {
    closeness,
    dPlus,
    dMinus,
    colNorms,
    normalized,
    weighted: v,
    idealPos,
    idealNeg,
    contribPlus,
    contribMinus,
  };
}

/** Classic TOPSIS — the closeness and distances only. See `topsisDetailed`. */
export function topsisRank(
  matrix: number[][],
  weights: number[],
  types: ("benefit" | "cost")[]
): TopsisResult {
  const { closeness, dPlus, dMinus } = topsisDetailed(matrix, weights, types);
  return { closeness, dPlus, dMinus };
}

/**
 * Absolute-anchor TOPSIS for a single alternative's value vector (e.g. one
 * candidate's semester PA grades, newest first).
 *
 * ABSOLUTE is the load-bearing property: the ideal positive/negative are fixed
 * anchors (`idealPos` / `idealNeg`, e.g. grade A=4 / D=1 for every slot) rather
 * than derived from the other candidates, so the score means the same thing in
 * every run — unlike the final closeness coefficient, which is set-relative.
 *
 * Per-slot weighting is a PARAMETER, not part of the method — which is why this
 * is named for the anchors rather than for the weighting. Pass an explicit weight
 * vector, or a plain number to be treated as an exponential decay factor. The PA
 * caller passes AHP-derived recency weights (`PA_RECENCY_DECAY` = 0.8), so older
 * semesters count for less. Weights are (re)normalized over the slots actually
 * present, so shorter vectors work.
 *
 * With a constant weight vector the closeness is weight-INDEPENDENT whenever all
 * values are equal: both distances scale by sqrt(Σw) = 1. That is why 94% of this
 * deployment's candidates score identically under either weighting.
 *
 * Returns the closeness coefficient ∈ [0, 1].
 */
export function absoluteAnchorTopsis(
  values: number[],
  idealPos: number,
  idealNeg: number,
  weightsOrDecay: number[] | number = 0.8
): number {
  return absoluteAnchorTopsisDetailed(values, idealPos, idealNeg, weightsOrDecay).closeness;
}

/**
 * `absoluteAnchorTopsis` with its intermediates — the per-slot weights before
 * and after renormalisation and both distances. The ONE computation: the score
 * reads `.closeness` from here, so a recorded breakdown can never disagree with
 * the number it explains (the run trace, drizzle/0092).
 */
export function absoluteAnchorTopsisDetailed(
  values: number[],
  idealPos: number,
  idealNeg: number,
  weightsOrDecay: number[] | number = 0.8
): { closeness: number; dPlus: number; dMinus: number; rawWeights: number[]; weights: number[] } {
  if (values.length === 0) return { closeness: 0.5, dPlus: 0, dMinus: 0, rawWeights: [], weights: [] };

  const rawWeights = Array.isArray(weightsOrDecay)
    ? values.map((_, k) => weightsOrDecay[k] ?? weightsOrDecay[weightsOrDecay.length - 1] ?? 1)
    : values.map((_, k) => Math.pow(weightsOrDecay, k));
  const wSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  const w = rawWeights.map((x) => x / wSum);

  let dp = 0;
  let dn = 0;
  for (let k = 0; k < values.length; k++) {
    dp += w[k]! * (values[k]! - idealPos) ** 2;
    dn += w[k]! * (values[k]! - idealNeg) ** 2;
  }
  const dpv = Math.sqrt(dp);
  const dnv = Math.sqrt(dn);
  return {
    closeness: dpv + dnv > 0 ? dnv / (dpv + dnv) : 0.5,
    dPlus: dpv,
    dMinus: dnv,
    rawWeights,
    weights: w,
  };
}
