// The final AHP+TOPSIS ranking step, shared by the scoring engine and the web
// app's run comparison / reproducibility check (I-7: one implementation of the
// formula). Dependency-free on purpose: the web build includes this file and
// topsis.ts / ahp-criteria.ts directly (see .dockerignore), so nothing here may
// reach a database, a model or Node-only APIs.

// Extensionless on purpose (unlike the rest of this service): this file is
// also compiled by the web app's bundler, and both tsx and the bundler resolve
// an extensionless specifier to the .ts file.
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from "./ahp-criteria";
import { topsisDetailed, type TopsisAnchors, type TopsisDetail } from "./topsis";

/**
 * A frozen TOPSIS yardstick keyed by criterion — divisor and weighted ideals —
 * so it survives a change of column order. See `topsisDetailed`'s anchored mode.
 */
export type TopsisAnchorsByKey = {
  colNorms: Partial<Record<AhpCriterionKey, number>>;
  idealPos: Partial<Record<AhpCriterionKey, number>>;
  idealNeg: Partial<Record<AhpCriterionKey, number>>;
};

/**
 * What a run records about its TOPSIS step (`run_info.frozen.topsis`), so that a
 * "Tambah Kandidat Pembanding" child of it can rank against the same yardstick
 * and a grandchild ends up on the ROOT's yardstick, not an approximation of it.
 *
 *  - `mode`: `classic` — divisors and ideals derived from the run's own pool (a
 *    root); `anchored` — taken from the parent (a child).
 *  - `source`: `own` (measured from this run's pool), `parent` (recorded by the
 *    parent), `parent_pool` (the parent recorded none, so it was re-derived
 *    from the parent's stored pool with the parent's weights — the same numbers
 *    a classic parent was ranked with).
 *  - `weightVector`: the renormalised weights the anchors were measured with;
 *    anchors measured with different weights describe a different scale and
 *    must not be reused (`readTopsisAnchors`).
 */
export type RecordedTopsis = TopsisAnchorsByKey & {
  version: 1;
  mode: "classic" | "anchored";
  source: "own" | "parent" | "parent_pool";
  activeCriteria: AhpCriterionKey[];
  weightVector: Partial<Record<AhpCriterionKey, number>>;
};

/**
 * Why a finalist of a parent is no longer in a child's top N:
 *
 *  - `overtaken_by_comparison` — every candidate now ranked above them that was
 *    not above them in the parent is somebody the parent never ranked (an added
 *    comparison candidate). The carried order is intact; they were overtaken.
 *  - `pool_shift` — at least one candidate the PARENT ranked below them is now
 *    above them although nobody's aspects changed: the scale moved because the
 *    pool changed (classic TOPSIS rank reversal). A child ranked on its parent's
 *    yardstick cannot produce this; children from before that rule can.
 *
 * Here (not in rerun-freeze.ts) because the web app's comparison uses it and
 * only this file is shared with the web build.
 */
export type LeftTopNCause = "overtaken_by_comparison" | "pool_shift";

export function leftTopNCauseOf(
  candidateId: string,
  rankedAbove: string[],
  parentRankById: Map<string, number>
): LeftTopNCause {
  const own = parentRankById.get(candidateId);
  if (own == null) return "overtaken_by_comparison";
  for (const id of rankedAbove) {
    const r = parentRankById.get(id);
    if (r != null && r > own) return "pool_shift";
  }
  return "overtaken_by_comparison";
}

/** The anchors a ranking was computed with, keyed by criterion. */
export function anchorsFromDetail(
  detail: Pick<TopsisDetail, "colNorms" | "idealPos" | "idealNeg">,
  activeCriteria: AhpCriterionKey[]
): TopsisAnchorsByKey {
  const pick = (arr: number[]) =>
    Object.fromEntries(activeCriteria.map((k, j) => [k, arr[j]!])) as Partial<Record<AhpCriterionKey, number>>;
  return { colNorms: pick(detail.colNorms), idealPos: pick(detail.idealPos), idealNeg: pick(detail.idealNeg) };
}

/**
 * Read recorded anchors back, or null when they cannot be used for a ranking
 * over `activeCriteria` with `weightVector`: a criterion missing or not finite,
 * or measured with a different weight vector (|Δ| > 1e-12 on any criterion).
 */
export function readTopsisAnchors(
  raw: unknown,
  activeCriteria: AhpCriterionKey[],
  weightVector?: Partial<Record<AhpCriterionKey, number>> | null
): TopsisAnchorsByKey | null {
  const r = raw as Partial<RecordedTopsis> | null | undefined;
  if (!r || typeof r !== "object") return null;
  const ok = (m: unknown, k: AhpCriterionKey) =>
    !!m && typeof m === "object" && Number.isFinite((m as Record<string, unknown>)[k] as number);
  for (const k of activeCriteria) {
    if (!ok(r.colNorms, k) || !ok(r.idealPos, k) || !ok(r.idealNeg, k)) return null;
    if (weightVector) {
      const recorded = (r.weightVector as Record<string, number> | undefined)?.[k];
      const wanted = weightVector[k];
      if (!Number.isFinite(recorded) || !Number.isFinite(wanted)) return null;
      if (Math.abs((recorded as number) - (wanted as number)) > 1e-12) return null;
    }
  }
  const take = (m: unknown) =>
    Object.fromEntries(activeCriteria.map((k) => [k, Number((m as Record<string, unknown>)[k])])) as Partial<
      Record<AhpCriterionKey, number>
    >;
  return { colNorms: take(r.colNorms), idealPos: take(r.idealPos), idealNeg: take(r.idealNeg) };
}

/**
 * The final ranking step: drop the criteria nobody could be scored on,
 * renormalise the remaining AHP weights, run classic TOPSIS, and order by
 * closeness with a deterministic tiebreak.
 *
 * `anchors` (a "Tambah Kandidat Pembanding" child) ranks against a frozen
 * yardstick instead — see `topsisDetailed`. Every carried candidate then keeps
 * its parent's closeness exactly and the added ones are placed between them.
 *
 * Pure — no database, no logging — so the step that decides every rank can be
 * exercised directly (scoring-service/test/). Called by `runAhpTopsisSession`
 * to rank, and by the web app's lib/run-compare.ts to REPLAY a stored ranking
 * (reproducibility, comparison, attribution) — never by a second copy.
 */
export function rankCandidatesByTopsis<C extends { id: string }>(
  candidates: C[],
  aspectScoresById: Map<string, Record<AhpCriterionKey, number>>,
  weights: Record<AhpCriterionKey, number>,
  droppedKeys: Set<AhpCriterionKey>,
  anchors?: TopsisAnchorsByKey | null
): {
  activeCriteria: AhpCriterionKey[];
  effectiveWeights: Record<AhpCriterionKey, number>;
  rankedAll: { candidate: C; closeness: number; dPlus: number; dMinus: number }[];
  /**
   * The TOPSIS intermediates, rows in the INPUT order of `candidates` (the
   * engine's matrix order) and columns in `activeCriteria` order, plus the
   * renormalised weight vector actually applied.
   */
  detail: TopsisDetail & { rowIds: string[]; weightVector: number[] };
} {
  // Degenerate guard: never drop everything — with no criteria left there is
  // nothing to rank, so fall back to the full set.
  const activeCriteria: AhpCriterionKey[] =
    droppedKeys.size >= AHP_CRITERIA_ORDER.length
      ? [...AHP_CRITERIA_ORDER]
      : AHP_CRITERIA_ORDER.filter((k) => !droppedKeys.has(k));

  const rawActiveWeights = activeCriteria.map((k) => weights[k]);
  const activeWeightSum = rawActiveWeights.reduce((a, b) => a + b, 0);
  const weightVector =
    activeWeightSum > 0
      ? rawActiveWeights.map((w) => w / activeWeightSum)
      : rawActiveWeights.map(() => 1 / activeCriteria.length);
  /** Renormalized weight per ACTIVE criterion (0 for dropped ones). */
  const effectiveWeights = Object.fromEntries(
    AHP_CRITERIA_ORDER.map((k) => {
      const idx = activeCriteria.indexOf(k);
      return [k, idx >= 0 ? Number(weightVector[idx]!.toFixed(6)) : 0];
    })
  ) as Record<AhpCriterionKey, number>;

  const matrix = candidates.map((c) => {
    const s = aspectScoresById.get(c.id)!;
    return activeCriteria.map((k) => s[k]);
  });
  let anchorArrays: TopsisAnchors | null = null;
  if (anchors) {
    const col = (m: Partial<Record<AhpCriterionKey, number>>) =>
      activeCriteria.map((k) => {
        const x = m[k];
        if (!Number.isFinite(x)) throw new Error(`Jangkar TOPSIS tidak lengkap untuk kriteria ${k}.`);
        return x as number;
      });
    anchorArrays = { colNorms: col(anchors.colNorms), idealPos: col(anchors.idealPos), idealNeg: col(anchors.idealNeg) };
  }
  const detail = topsisDetailed(
    matrix,
    weightVector,
    activeCriteria.map(() => "benefit"),
    anchorArrays
  );
  const { closeness, dPlus, dMinus } = detail;

  const rankedAll = candidates
    .map((c, i) => ({
      candidate: c,
      closeness: closeness[i]!,
      dPlus: dPlus[i]!,
      dMinus: dMinus[i]!,
    }))
    // Closeness first, then candidate id: a stable sort over an unordered query
    // is not determinism, it only inherits whatever order the database chose.
    // Exact ties DO happen — two candidates with the same six aspect scores get
    // bit-identical closeness — and a succession ranking that reshuffles between
    // two runs of the same inputs is indefensible even when the tie is real.
    // The tiebreak is arbitrary on purpose: inventing a seventh criterion here
    // would hide a decision the run never made. Humans break real ties with the
    // manual tie-order control on the position page, which is recorded.
    .sort(
      (a, b) =>
        b.closeness - a.closeness || a.candidate.id.localeCompare(b.candidate.id)
    );

  return {
    activeCriteria,
    effectiveWeights,
    rankedAll,
    detail: { ...detail, rowIds: candidates.map((c) => c.id), weightVector },
  };
}
