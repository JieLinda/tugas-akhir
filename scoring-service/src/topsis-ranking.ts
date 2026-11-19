// The final AHP+TOPSIS ranking step, shared by the scoring engine and the web
// app's run comparison / reproducibility check (I-7: one implementation of the
// formula). Dependency-free on purpose: the web build includes this file and
// topsis.ts / ahp-criteria.ts directly (see .dockerignore), so nothing here may
// reach a database, a model or Node-only APIs.

// Extensionless on purpose (unlike the rest of this service): this file is
// also compiled by the web app's bundler, and both tsx and the bundler resolve
// an extensionless specifier to the .ts file.
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from "./ahp-criteria";
import { topsisDetailed, type TopsisDetail } from "./topsis";

/**
 * The final ranking step: drop the criteria nobody could be scored on,
 * renormalise the remaining AHP weights, run classic TOPSIS, and order by
 * closeness with a deterministic tiebreak.
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
  droppedKeys: Set<AhpCriterionKey>
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
  const detail = topsisDetailed(
    matrix,
    weightVector,
    activeCriteria.map(() => "benefit")
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
