// AHP (Analytic Hierarchy Process) math — the ONE implementation. The web app
// re-exports it from lib/ahp.ts (this file is dependency-free and whitelisted
// in the web .dockerignore), so the governance editor, the save validation and
// the engine compute weights and CR with the same code.

export type AhpResult = {
  /** Normalized priority weights (sum = 1), same order as the matrix rows. */
  weights: number[];
  lambdaMax: number;
  ci: number;
  /** Consistency Ratio — acceptable when ≤ 0.1 */
  cr: number;
};

/** Saaty's Random Consistency Index by matrix size (1-indexed by n). */
export const RANDOM_INDEX = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];

/** Saaty's RI for an n×n matrix — the denominator of CR = CI / RI. */
export function randomConsistencyIndex(n: number): number {
  return RANDOM_INDEX[n] ?? 1.49;
}

/**
 * Compute AHP priority weights from a pairwise comparison matrix using the
 * geometric-mean method, plus λmax / CI / CR consistency diagnostics.
 */
export function computeAhpWeights(pairwise: number[][]): AhpResult {
  const n = pairwise.length;
  if (n === 0) return { weights: [], lambdaMax: 0, ci: 0, cr: 0 };

  const geoMeans = pairwise.map((row) => {
    const product = row.reduce((acc, v) => acc * (v > 0 ? v : 1e-9), 1);
    return Math.pow(product, 1 / n);
  });
  const sum = geoMeans.reduce((a, b) => a + b, 0);
  const weights = geoMeans.map((g) => g / sum);

  let lambdaMax = 0;
  for (let i = 0; i < n; i++) {
    let rowDot = 0;
    for (let j = 0; j < n; j++) rowDot += pairwise[i]![j]! * weights[j]!;
    lambdaMax += rowDot / (weights[i]! || 1e-9);
  }
  lambdaMax /= n;

  const ci = n > 1 ? (lambdaMax - n) / (n - 1) : 0;
  const ri = RANDOM_INDEX[n] ?? 1.49;
  const cr = ri > 0 ? ci / ri : 0;

  return { weights, lambdaMax, ci, cr };
}

/**
 * Build a perfectly consistent pairwise matrix (CR = 0) from a plain weight
 * vector: a_ij = w_i / w_j. Fallback when the template has no AHP config.
 */
export function pairwiseFromWeights(weights: number[]): number[][] {
  const safe = weights.map((w) => (w > 0 ? w : 1e-6));
  return safe.map((wi) => safe.map((wj) => wi / wj));
}

/**
 * STRUCTURAL check only: square, the expected size, every cell a finite number
 * > 0. It does NOT check reciprocity or the Saaty scale, on purpose — this is
 * the engine's gate for whether a stored matrix is usable at all, and making it
 * stricter would silently fall back to the default weights for an older stored
 * configuration. Validating an expert's INPUT is validateAhpPairwise
 * (./ahp-saaty), which every save path and the new-session gate call.
 */
export function isValidPairwise(matrix: unknown, n: number): matrix is number[][] {
  if (!Array.isArray(matrix) || matrix.length !== n) return false;
  for (let i = 0; i < n; i++) {
    const row = matrix[i];
    if (!Array.isArray(row) || row.length !== n) return false;
    for (let j = 0; j < n; j++) {
      const v = row[j];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
    }
  }
  return true;
}
