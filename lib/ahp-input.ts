// The four AHP weight-input modes as PROJECTIONS of one canonical matrix
// (docs/ahp-input-sync.md §4–5). Pure and client-safe, so every rule here is
// testable without a browser.
//
// The canonical matrix: 15 upper-triangle judgments on the Saaty scale, the
// lower triangle their exact reciprocal (from the scale table), diagonal 1.
// Every WRITE goes through here and leaves all 30 off-diagonal cells on the
// scale; every READ (slider positions, order, the pairwise views, the CR
// badge) is derived from the matrix with computeAhpWeights. Switching modes
// never writes, so it can never round anything.

import {
  computeAhpWeights,
  isSaatyValue,
  reciprocalSaaty,
  saatyLabel,
  snapToSaaty,
} from '@/lib/ahp';
import { DEFAULT_ASPECT_WEIGHTS } from '@/lib/scoring-criteria';

export const AHP_N = 6;

/** Criterion keys in AHP_CRITERIA_ORDER (rows/cols of every stored matrix). */
export const AHP_INPUT_KEYS = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'] as const;

/** Short Indonesian names used in rounding notices and validation messages. */
export const AHP_SHORT_LABELS = ['Teknis', 'Karier', 'Behavior', 'PA', 'HAV', 'Pendidikan'] as const;

/** The weights a slider can reach on the Saaty scale for n = 6 (all-1/9 row … all-9 row). */
export const SLIDER_MIN_PCT = 2;
export const SLIDER_MAX_PCT = 65;
/** Step the dead-zone search advances by, in weight fraction (0.1 percentage point). */
const SLIDER_SEARCH_STEP = 0.001;

/** One judgment that changed: canonical row < col, values as stored in a[row][col]. */
export type JudgmentChange = { row: number; col: number; before: number; after: number };

/** "Karier vs HAV: 1 → 2" (or "1,25 → 1" for an off-scale value being snapped). */
export function describeChange(c: JudgmentChange, labels: readonly string[] = AHP_SHORT_LABELS): string {
  return `${labels[c.row]} vs ${labels[c.col]}: ${saatyLabel(c.before)} → ${saatyLabel(c.after)}`;
}

/** Build the full matrix from an upper-triangle getter (values must be on the scale). */
export function pairwiseFromUpper(upper: (i: number, j: number) => number, n = AHP_N): number[][] {
  const m = Array.from({ length: n }, () => Array.from({ length: n }, () => 1));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = upper(i, j);
      m[i]![j] = v;
      m[j]![i] = reciprocalSaaty(v);
    }
  }
  return m;
}

/** The 15 upper-triangle values, row-major (0,1)…(4,5). */
export function upperValues(m: number[][]): number[] {
  const out: number[] = [];
  for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) out.push(m[i]![j]!);
  return out;
}

/** True when every off-diagonal cell is on the scale and the lower triangle is the table reciprocal. */
export function isCanonical(m: number[][] | null | undefined): boolean {
  if (!Array.isArray(m) || m.length !== AHP_N) return false;
  for (let i = 0; i < AHP_N; i++) {
    if (!Array.isArray(m[i]) || m[i]!.length !== AHP_N || m[i]![i] !== 1) return false;
    for (let j = i + 1; j < AHP_N; j++) {
      const v = m[i]![j]!;
      if (!isSaatyValue(v) || snapToSaaty(v) !== v || m[j]![i] !== reciprocalSaaty(v)) return false;
    }
  }
  return true;
}

/** Upper-triangle pairs whose stored value differs between two matrices. */
export function diffJudgments(before: number[][], after: number[][]): JudgmentChange[] {
  const out: JudgmentChange[] = [];
  for (let i = 0; i < AHP_N; i++) {
    for (let j = i + 1; j < AHP_N; j++) {
      const b = before[i]?.[j];
      const a = after[i]![j]!;
      if (b !== a) out.push({ row: i, col: j, before: typeof b === 'number' ? b : NaN, after: a });
    }
  }
  return out;
}

/**
 * Snap every upper cell to the scale and rebuild the lower triangle from it.
 * A cell that is not a positive number (a broken stored matrix) becomes 1.
 * Returns the cells that changed, so the caller can say so.
 */
export function canonicalize(m: number[][] | null | undefined): { matrix: number[][]; changes: JudgmentChange[] } {
  const src = Array.isArray(m) ? m : [];
  const matrix = pairwiseFromUpper((i, j) => {
    const v = src[i]?.[j];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? snapToSaaty(v) : 1;
  });
  const changes = diffJudgments(src as number[][], matrix);
  // A non-reciprocal lower cell is also a change, even when its upper twin was on the scale.
  for (let i = 0; i < AHP_N; i++) {
    for (let j = i + 1; j < AHP_N; j++) {
      if (src[j]?.[i] !== matrix[j]![i] && !changes.some((c) => c.row === i && c.col === j)) {
        changes.push({ row: i, col: j, before: src[i]?.[j] as number, after: matrix[i]![j]! });
      }
    }
  }
  return { matrix, changes };
}

export function matrixWeights(m: number[][]): number[] {
  return computeAhpWeights(m).weights;
}

/** aᵢⱼ = snap(wᵢ/wⱼ) for every pair — the full rewrite Urutan and activate() use. */
export function matrixFromWeights(w: readonly number[]): number[][] {
  return pairwiseFromUpper((i, j) => snapToSaaty(w[i]! / w[j]!));
}

/** "Atur Bobot AHP": the system defaults snapped to the scale (§4.5 — not exactly 35/25/20/10/5/5). */
export function activationMatrix(): number[][] {
  return matrixFromWeights(AHP_INPUT_KEYS.map((k) => DEFAULT_ASPECT_WEIGHTS[k]));
}

export type WriteResult = {
  matrix: number[][];
  /** Off-scale stored cells that were snapped before the edit (legacy data). */
  canonicalized: JudgmentChange[];
  /** Judgments the edit itself changed. */
  changes: JudgmentChange[];
};

/** Daftar / Matriks: `hi` is `v` times as important as `lo` (v = 1 is "sama penting"). */
export function setJudgment(m: number[][] | null, hi: number, lo: number, v: number): WriteResult {
  const intensity = Math.min(9, Math.max(1, Math.round(v)));
  const { matrix: base, changes: canonicalized } = canonicalize(m ?? pairwiseFromUpper(() => 1));
  const matrix = base.map((r) => [...r]);
  matrix[hi]![lo] = intensity;
  matrix[lo]![hi] = reciprocalSaaty(intensity);
  return { matrix, canonicalized, changes: diffJudgments(base, matrix) };
}

// ── Slider ──────────────────────────────────────────────────────────

/** Slider positions in percent: the weights of the matrix. */
export function sliderPositions(m: number[][]): number[] {
  return matrixWeights(m).map((w) => w * 100);
}

/** Row/column `i` rewritten for target weight t (others rescaled proportionally). */
function sliderProposal(base: number[][], w: number[], i: number, t: number): number[][] {
  const scale = (1 - t) / (1 - w[i]!);
  const out = base.map((r) => [...r]);
  for (let j = 0; j < AHP_N; j++) {
    if (j === i) continue;
    const v = snapToSaaty(t / (w[j]! * scale));
    out[i]![j] = v;
    out[j]![i] = reciprocalSaaty(v);
  }
  return out;
}

export type SliderResult = WriteResult & {
  requestedPct: number;
  /** The weight that was actually applied (differs when the dead zone was crossed). */
  appliedPct: number;
  /** Weight of criterion i after snapping — where the slider jumps to. */
  resultPct: number;
  /** True when the requested point changed nothing and the slider advanced to the next point that does. */
  advanced: boolean;
};

/**
 * Slider → canonical (§4.3, approved): criterion i gets the target weight,
 * the others are rescaled so Σ = 1, and ONLY the 5 judgments in row/col i are
 * rewritten as snap(wᵢ/wⱼ) — the rest of the expert's judgments are untouched.
 * If that changes no judgment (the dead zone between two Saaty steps), advance
 * in the direction of the move to the nearest weight that changes at least one.
 */
export function applySlider(m: number[][] | null, i: number, targetPct: number): SliderResult {
  const { matrix: base, changes: canonicalized } = canonicalize(m ?? activationMatrix());
  const w = matrixWeights(base);
  const current = w[i]!;
  const clamp = (t: number) => Math.min(SLIDER_MAX_PCT / 100, Math.max(SLIDER_MIN_PCT / 100, t));
  let t = clamp(targetPct / 100);
  // Within 1e-9 counts as "not moved": percent ↔ fraction round trips by an ulp.
  const direction = Math.abs(t - current) <= 1e-9 ? 0 : Math.sign(t - current);
  if (direction === 0) {
    // Released where it already was: nothing was asked for, so nothing is
    // rewritten — on an inconsistent matrix snap(wᵢ/wⱼ) ≠ aᵢⱼ, and writing it
    // would change the expert's judgments for a click.
    const pct = current * 100;
    return { matrix: base, canonicalized, changes: [], requestedPct: targetPct, appliedPct: pct, resultPct: pct, advanced: false };
  }
  let next = sliderProposal(base, w, i, t);
  let advanced = false;
  if (direction !== 0 && diffJudgments(base, next).length === 0) {
    for (let probe = t + direction * SLIDER_SEARCH_STEP; ; probe += direction * SLIDER_SEARCH_STEP) {
      const p = clamp(probe);
      const candidate = sliderProposal(base, w, i, p);
      if (diffJudgments(base, candidate).length > 0) {
        next = candidate;
        t = p;
        advanced = true;
        break;
      }
      if (p !== probe) break; // hit the end of the range: nothing further changes
    }
  }
  return {
    matrix: next,
    canonicalized,
    changes: diffJudgments(base, next),
    requestedPct: targetPct,
    appliedPct: t * 100,
    resultPct: matrixWeights(next)[i]! * 100,
    advanced,
  };
}

/** What the slider would land on if released at `targetPct` (the live preview). */
export function previewSlider(m: number[][] | null, i: number, targetPct: number): number {
  return applySlider(m, i, targetPct).resultPct;
}

// ── Urutan ──────────────────────────────────────────────────────────

const WEIGHT_TIE = 1e-12;

/**
 * Criteria ordered by weight, heaviest first, with ties sharing a rank.
 * `tieOrder` (e.g. the last dragged order) breaks display order inside a tie,
 * then the canonical index, so the list cannot reshuffle between renders.
 */
export function rankGroups(m: number[][], tieOrder?: readonly number[]): { criterion: number; rank: number; tied: boolean }[] {
  const w = matrixWeights(m);
  const pos = (k: number) => {
    const p = tieOrder?.indexOf(k) ?? -1;
    return p >= 0 ? p : AHP_N + k;
  };
  const order = Array.from({ length: AHP_N }, (_, k) => k).sort((a, b) =>
    Math.abs(w[a]! - w[b]!) <= WEIGHT_TIE ? pos(a) - pos(b) : w[b]! - w[a]!,
  );
  const out: { criterion: number; rank: number; tied: boolean }[] = [];
  order.forEach((k, idx) => {
    const prev = idx > 0 ? order[idx - 1]! : null;
    const sameAsPrev = prev != null && Math.abs(w[prev]! - w[k]!) <= WEIGHT_TIE;
    const rank = sameAsPrev ? out[idx - 1]!.rank : idx + 1;
    out.push({ criterion: k, rank, tied: false });
  });
  for (const r of out) r.tied = out.filter((o) => o.rank === r.rank).length > 1;
  return out;
}

/**
 * Urutan → canonical (§4.4): the existing weight VALUES, heaviest first, are
 * permuted onto the dragged order, then all 15 judgments are rewritten as
 * snap(wᵢ/wⱼ). The snapped weights never invert the dragged order (snap is
 * monotone), but adjacent criteria may tie.
 */
export function applyOrder(m: number[][] | null, order: readonly number[]): WriteResult {
  const { matrix: base, changes: canonicalized } = canonicalize(m ?? activationMatrix());
  const sorted = [...matrixWeights(base)].sort((a, b) => b - a);
  const w = new Array<number>(AHP_N);
  order.forEach((criterion, position) => {
    w[criterion] = sorted[position]!;
  });
  const matrix = matrixFromWeights(w);
  return { matrix, canonicalized, changes: diffJudgments(base, matrix) };
}

/** The sentence a write shows (§5.3); null when nothing was rounded or changed worth saying. */
export function describeWrite(r: WriteResult, extra?: string): string | null {
  const parts: string[] = [];
  if (r.canonicalized.length) {
    parts.push(
      `${r.canonicalized.length} nilai lama dibulatkan ke skala Saaty: ${r.canonicalized.map((c) => describeChange(c)).join('; ')}.`,
    );
  }
  if (extra) parts.push(extra);
  if (r.changes.length) {
    parts.push(`${r.changes.length} penilaian berubah: ${r.changes.map((c) => describeChange(c)).join('; ')}.`);
  }
  return parts.length ? parts.join(' ') : null;
}
