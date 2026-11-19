// The Saaty scale and the ONE check of whether a pairwise matrix is a valid
// expert input (docs/ahp-input-sync.md §3).
//
// Shared by both deployables on purpose: the web app imports this file
// directly (whitelisted in the web .dockerignore, like topsis.ts), so the
// governance editor's CR badge, both save actions, the new-session gate, the
// engine's run flag, the run-configuration panel and the audit script all call
// the same code. A second copy of "is this value allowed" is exactly the kind
// of drift that let the editor show 1 while the matrix held 1.25.
//
// Dependency-free and extensionless (also compiled by the web bundler). The
// AHP formula itself lives in ./ahp and is NOT changed by anything here.

import { computeAhpWeights } from "./ahp";

/** The 17 Saaty values, ascending: 1/9 … 1/2, 1, 2 … 9. */
export const SAATY_SCALE: readonly number[] = Object.freeze([
  1 / 9, 1 / 8, 1 / 7, 1 / 6, 1 / 5, 1 / 4, 1 / 3, 1 / 2,
  1, 2, 3, 4, 5, 6, 7, 8, 9,
]);

/** Default tolerance for "is on the scale", in log space. */
export const SAATY_LOG_TOLERANCE = 1e-6;
/** Tolerance for the reciprocal and diagonal checks. */
export const PAIRWISE_RECIPROCAL_TOLERANCE = 1e-9;
/** Saaty's acceptance threshold — the same 0.1 every save has always used. */
export const AHP_CR_MAX = 0.1;

const TIE_EPS = 1e-12;

/** Index into SAATY_SCALE of the member nearest `x` in log space; ties go to the one nearer 1. */
function nearestIndex(x: number): number {
  const lx = Math.log(x);
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < SAATY_SCALE.length; k++) {
    const ls = Math.log(SAATY_SCALE[k]!);
    const d = Math.abs(lx - ls);
    if (d < bestDist - TIE_EPS) {
      best = k;
      bestDist = d;
    } else if (Math.abs(d - bestDist) <= TIE_EPS && Math.abs(ls) < Math.abs(Math.log(SAATY_SCALE[best]!))) {
      best = k;
      bestDist = d;
    }
  }
  return best;
}

/**
 * The Saaty value nearest `x` in log space: argmin |ln x − ln s|. On an exact
 * tie (e.g. √2, halfway between 1 and 2) the value nearer 1 wins. Values past
 * the ends clamp to 9 or 1/9. Note this is not Math.round: 1.25 → 1 and
 * 1.5 → 2, but also 2.45 → 3, because the boundary between 2 and 3 is √6.
 */
export function snapToSaaty(x: number): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) {
    throw new Error(`snapToSaaty: ${x} is not a positive ratio`);
  }
  return SAATY_SCALE[nearestIndex(x)]!;
}

/** True when |ln x − ln s| ≤ tol for some s on the scale. */
export function isSaatyValue(x: unknown, tol = SAATY_LOG_TOLERANCE): boolean {
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return false;
  const s = SAATY_SCALE[nearestIndex(x)]!;
  return Math.abs(Math.log(x) - Math.log(s)) <= tol;
}

/** The exact reciprocal of a scale member, taken from the table (1/(1/3) is 3, not 3.0000000000000004). */
export function reciprocalSaaty(s: number): number {
  const k = nearestIndex(s);
  return SAATY_SCALE[SAATY_SCALE.length - 1 - k]!;
}

/**
 * How a judgment reads: "3", "1", "1/3" for scale members; a decimal with a
 * comma ("1,25") for anything off the scale, so an off-scale value is never
 * rounded into a judgment it is not.
 */
export function saatyLabel(x: number, tol = SAATY_LOG_TOLERANCE): string {
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return "—";
  if (isSaatyValue(x, tol)) {
    const s = SAATY_SCALE[nearestIndex(x)]!;
    return s >= 1 ? String(Math.round(s)) : `1/${Math.round(1 / s)}`;
  }
  const digits = x >= 10 ? 1 : x >= 1 ? 3 : 4;
  return String(Number(x.toFixed(digits))).replace(".", ",");
}

export type AhpIssue =
  | { code: "shape"; n: number }
  | { code: "not_positive"; row: number; col: number; value: unknown }
  | { code: "diagonal"; row: number; value: number }
  | { code: "not_reciprocal"; row: number; col: number; product: number }
  | { code: "off_scale"; row: number; col: number; value: number; nearest: number }
  | { code: "inconsistent"; cr: number };

export type AhpValidation = {
  ok: boolean;
  issues: AhpIssue[];
  /** computeAhpWeights of the matrix; null when the structure is unusable. */
  result: { weights: number[]; lambdaMax: number; ci: number; cr: number } | null;
};

/**
 * Whether `matrix` is a valid expert pairwise input: n×n, finite and > 0,
 * diagonal 1, reciprocal (|aᵢⱼ·aⱼᵢ − 1| ≤ 1e-9), every off-diagonal cell on
 * the Saaty scale (in log space), and CR ≤ 0.1. Every issue is collected, not
 * just the first. CR is computed whenever the structure allows it — the badge
 * needs a number even for a matrix with an off-scale cell — and it is THE CR:
 * whatever displays it and whatever rejects on it call this function.
 */
export function validateAhpPairwise(
  matrix: unknown,
  opts: { n?: number; scaleTolerance?: number; crMax?: number } = {},
): AhpValidation {
  const n = opts.n ?? 6;
  const tol = opts.scaleTolerance ?? SAATY_LOG_TOLERANCE;
  const crMax = opts.crMax ?? AHP_CR_MAX;
  const issues: AhpIssue[] = [];

  if (
    !Array.isArray(matrix) ||
    matrix.length !== n ||
    matrix.some((row) => !Array.isArray(row) || row.length !== n)
  ) {
    return { ok: false, issues: [{ code: "shape", n }], result: null };
  }
  const m = matrix as unknown[][];
  let structural = true;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = m[i]![j];
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
        issues.push({ code: "not_positive", row: i, col: j, value: v });
        structural = false;
      }
    }
  }
  if (!structural) return { ok: false, issues, result: null };
  const a = m as number[][];

  for (let i = 0; i < n; i++) {
    if (Math.abs(a[i]![i]! - 1) > PAIRWISE_RECIPROCAL_TOLERANCE) {
      issues.push({ code: "diagonal", row: i, value: a[i]![i]! });
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const product = a[i]![j]! * a[j]![i]!;
      if (Math.abs(product - 1) > PAIRWISE_RECIPROCAL_TOLERANCE) {
        issues.push({ code: "not_reciprocal", row: i, col: j, product });
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const v = a[i]![j]!;
      if (!isSaatyValue(v, tol)) {
        issues.push({ code: "off_scale", row: i, col: j, value: v, nearest: snapToSaaty(v) });
      }
    }
  }
  const result = computeAhpWeights(a);
  if (result.cr > crMax) issues.push({ code: "inconsistent", cr: result.cr });
  return { ok: issues.length === 0, issues, result };
}

/** Off-scale cells above the diagonal only (each judgment once), as row/col pairs. */
export function offScaleUpperCells(v: AhpValidation): Extract<AhpIssue, { code: "off_scale" }>[] {
  return v.issues.filter(
    (i): i is Extract<AhpIssue, { code: "off_scale" }> => i.code === "off_scale" && i.row < i.col,
  );
}

/** One Indonesian sentence per issue, with the caller's criterion labels. */
export function describeAhpIssue(issue: AhpIssue, labels: readonly string[]): string {
  const L = (k: number) => labels[k] ?? `kriteria ${k + 1}`;
  switch (issue.code) {
    case "shape":
      return `Matriks perbandingan AHP harus berukuran ${issue.n}×${issue.n}.`;
    case "not_positive":
      return `Nilai ${L(issue.row)} vs ${L(issue.col)} harus berupa angka lebih dari 0.`;
    case "diagonal":
      return `Diagonal matriks AHP harus 1 (baris ${L(issue.row)} berisi ${issue.value}).`;
    case "not_reciprocal":
      return `Matriks AHP tidak resiprokal: ${L(issue.row)} vs ${L(issue.col)} dikali kebalikannya = ${issue.product.toFixed(4)}, seharusnya 1.`;
    case "off_scale":
      return `Nilai ${L(issue.row)} vs ${L(issue.col)} = ${saatyLabel(issue.value)} bukan anggota skala Saaty (terdekat: ${saatyLabel(issue.nearest)}).`;
    case "inconsistent":
      return `Rasio konsistensi (CR) matriks AHP = ${issue.cr.toFixed(3)} melebihi 0.1 — perbaiki perbandingan berpasangan hingga konsisten sebelum menyimpan.`;
  }
}

/** All issues as one message, each judgment named once (the lower-triangle twin of an off-scale cell is dropped). */
export function describeAhpValidation(v: AhpValidation, labels: readonly string[]): string {
  return v.issues
    .filter((i) => !(i.code === "off_scale" && i.row > i.col))
    .map((i) => describeAhpIssue(i, labels))
    .join(" ");
}

/** Deep equality of two matrices (stored vs submitted) — exact, cell by cell. */
export function samePairwise(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];
    if (!Array.isArray(ra) || !Array.isArray(rb) || ra.length !== rb.length) return false;
    for (let j = 0; j < ra.length; j++) if (ra[j] !== rb[j]) return false;
  }
  return true;
}

/** The run-level flag (docs/ahp-input-sync.md §8.1). */
export type AhpInputCheck = {
  ok: boolean;
  matrixSource: "ahp-matrix" | "default" | "inherited";
  offScale: { row: string; col: string; value: number; nearest: number }[];
  reciprocal: boolean;
  crExceeded: boolean;
  cr: number | null;
  /** True only for the system defaults: built from a weight vector, off-scale by construction. */
  expected: boolean;
  /** Log-space tolerance the scale check used (1e-3 for a 4-decimal stored copy). */
  scaleTolerance: number;
};

export function ahpInputCheck(
  matrix: unknown,
  matrixSource: AhpInputCheck["matrixSource"],
  criteria: readonly string[],
  scaleTolerance = SAATY_LOG_TOLERANCE,
): AhpInputCheck {
  const v = validateAhpPairwise(matrix, { n: criteria.length, scaleTolerance });
  return {
    ok: v.ok,
    matrixSource,
    offScale: offScaleUpperCells(v).map((i) => ({
      row: criteria[i.row]!,
      col: criteria[i.col]!,
      value: i.value,
      nearest: i.nearest,
    })),
    reciprocal: !v.issues.some((i) => i.code === "not_reciprocal" || i.code === "diagonal" || i.code === "shape"),
    crExceeded: v.issues.some((i) => i.code === "inconsistent"),
    cr: v.result?.cr ?? null,
    expected: matrixSource === "default",
    scaleTolerance,
  };
}
