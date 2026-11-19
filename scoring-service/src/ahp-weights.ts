/**
 * AHP is the ONE place a scoring weight is configured in this product.
 *
 * Two tiers: the program's own pairwise matrix (`program_templates.ahp_config`),
 * else the system defaults below. A program's criteria list carries no weight.
 * (The removed AI Tournament once took its weights from that list instead — a
 * second weighting UI that disagreed with the matrix for the same program; that
 * engine is gone, so this is the only resolution there is.)
 */

import { queryOne } from "./db/postgres.js";
import { computeAhpWeights, isValidPairwise, pairwiseFromWeights } from "./ahp.js";

// ─── Criteria ────────────────────────────────────────────────────
// Defined in the dependency-free ahp-criteria.ts (shared with the web app's run
// comparison); re-exported here so every existing import keeps working.

import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from "./ahp-criteria.js";
export { AHP_CRITERIA_ORDER, type AhpCriterionKey };

/**
 * The weights EVERY run uses unless its program has an explicit pairwise matrix
 * in governance. Not a fallback for exotic cases — with no matrix set (the
 * shipped state) this is the actual configuration, so two runs of different
 * programs are comparable by construction.
 *
 * MIRROR of DEFAULT_ASPECT_WEIGHTS in the web app's lib/scoring-criteria.ts,
 * which is what the governance pairwise editor opens at and what the UI quotes.
 * Separate deployables with no shared lib/, so this is a copy — keep the two in
 * step, or the editor promises weights the engine does not apply.
 */
export const DEFAULT_WEIGHTS: Record<AhpCriterionKey, number> = {
  technical: 25,
  career: 5,
  behavior: 35,
  performance: 10,
  hav: 20,
  education: 5,
};

export type ResolvedAhpWeights = {
  weights: Record<AhpCriterionKey, number>;
  cr: number;
  /** Consistency diagnostics of the pairwise matrix. */
  lambdaMax: number;
  ci: number;
  /**
   * The pairwise (Saaty-scale) comparison matrix actually used this run —
   * either the governance-edited matrix ("ahp-matrix") or a perfectly consistent
   * one built from DEFAULT_WEIGHTS ("default"). Row/col order follows
   * AHP_CRITERIA_ORDER.
   */
  pairwise: number[][];
  /**
   * TWO tiers only. A third once existed — "criteria-weights", deriving the
   * matrix from the program's "Kriteria & Bobot" list — and it is deliberately
   * gone: it let an edit meant for the (since removed) LLM engine silently re-weight every
   * AHP + TOPSIS run of the same program. Runs finished before the removal keep
   * "criteria-weights" in their own stored runInfo; nothing produces it now.
   */
  source: "ahp-matrix" | "default" | "inherited";
};

/**
 * The AHP priority weights for a run: the program's own pairwise matrix when one
 * is set, otherwise DEFAULT_WEIGHTS — identical for every program and every run.
 */
export async function resolveAhpWeights(
  programTemplateId: string | null,
  /**
   * The base run's own matrix, on a derived run (incremental / exclusion
   * re-rank). It WINS over the live template, because a derived run exists to
   * isolate exactly one change — an added candidate, an excluded one — and the
   * weights are not it.
   *
   * Without this the engine re-read `program_templates.ahp_config` at scoring
   * time while the run inherited the base run's frozen `config_snapshot`: edit
   * the matrix in governance between the two runs and every rank moves for a
   * reason the derived run then MISREPORTS, since its snapshot still shows the
   * old matrix. Somebody wanting the new weights applied is asking for a fresh
   * assessment, which is a full run.
   */
  pinnedPairwise?: number[][] | null
): Promise<ResolvedAhpWeights> {
  const n = AHP_CRITERIA_ORDER.length;

  const finalize = (
    pairwise: number[][],
    source: ResolvedAhpWeights["source"]
  ): ResolvedAhpWeights => {
    const { weights, cr, lambdaMax, ci } = computeAhpWeights(pairwise);
    return {
      weights: Object.fromEntries(
        AHP_CRITERIA_ORDER.map((k, i) => [k, weights[i]!])
      ) as Record<AhpCriterionKey, number>,
      cr,
      lambdaMax,
      ci,
      pairwise,
      source,
    };
  };

  if (pinnedPairwise && isValidPairwise(pinnedPairwise, n)) {
    return finalize(pinnedPairwise, "inherited");
  }

  if (programTemplateId) {
    const row = await queryOne<{ ahpConfig: any }>(
      `SELECT ahp_config as "ahpConfig" FROM program_templates WHERE id = $1 LIMIT 1`,
      [programTemplateId]
    );

    // The ONLY thing that overrides the defaults: a pairwise matrix somebody
    // deliberately set in governance.
    if (row?.ahpConfig?.pairwise && isValidPairwise(row.ahpConfig.pairwise, n)) {
      return finalize(row.ahpConfig.pairwise as number[][], "ahp-matrix");
    }
  }

  const vector = AHP_CRITERIA_ORDER.map((k) => DEFAULT_WEIGHTS[k]);
  return finalize(pairwiseFromWeights(vector), "default");
}
