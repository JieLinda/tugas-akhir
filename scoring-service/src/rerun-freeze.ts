/**
 * "Tambah Kandidat Pembanding": the contract between the web app and this
 * service for a derived run, and the pure decisions the engine makes from it.
 *
 * A derived run is its parent, frozen, plus the people somebody asked about. The
 * web app resolves what the child inherits (lib/rerun-freeze.ts →
 * `resolveFrozenBasis`) and writes it into `tournament_sessions.final_ranked
 * .ahpRerun`; this module reads that spec and decides — without a database, so
 * the rules can be tested directly — who is scored, who is carried, and which
 * weights / criteria / anchors / reference date the ranking uses.
 *
 * The types are a MIRROR of `FrozenRunBasis` / `AhpRerunSpec` in the web app's
 * lib/rerun-modes.ts. Separate deployables, no shared package — the same reason
 * `ahp.ts` exists twice. Change both together.
 *
 * See "Re-run scoring — aturan desain" in CLAUDE.md.
 */

import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from "./ahp-weights.js";
import type { PositionBasis } from "./position-basis.js";
import { leftTopNCauseOf, type LeftTopNCause, type RecordedTopsis } from "./topsis-ranking.js";

/**
 * Which models a run used. Recorded on every AHP run (`run_info.models`) and
 * inherited into a child's basis so the child can SAY when a model moved
 * between them — a model provider cannot be pinned to a version it may no
 * longer serve, so a difference is reported rather than enforced.
 */
export type RunModels = {
  embedding: { model: string; documentModel: string | null };
  education: { provider: "gemini"; model: string | null; configured: boolean };
  narrative: { enabled: boolean; model: string | null };
};

export type FrozenRunBasis = {
  version: 1;
  rootRunId: string;
  parentRunId: string;
  referenceDate: string;
  referenceDateSource: "parent_frozen" | "parent_completed_at";
  ahp: {
    weights: Record<AhpCriterionKey, number> | null;
    pairwise: number[][] | null;
    activeCriteria: AhpCriterionKey[] | null;
    droppedCriteria: { key: AhpCriterionKey; reason: string }[] | null;
    weightSource: string | null;
    source: "parent" | "live_fallback";
    /**
     * The parent's own consistency diagnostics at full precision. Recomputing
     * them from the stored matrix is wrong for an old parent, whose matrix was
     * stored rounded to 4 decimals. Absent on bases resolved before this.
     */
    consistency?: { cr: number; lambdaMax: number; ci: number } | null;
  };
  anchors: {
    technical: { simFloor: number; simCeil: number; source: string } | null;
    career: { simFloor: number; simCeil: number; source: string } | null;
    depth: { targetYears: number; targetRows: number } | null;
    source: "parent" | "live_fallback";
  };
  /** What the target seat demanded (FR-RR-07). Absent/null: the parent recorded none. */
  positionBasis?: PositionBasis | null;
  /** The models the parent used, for the child to compare against. */
  models?: RunModels | null;
  /** Milliseconds the web app spent validating and classifying the request. */
  validationMs?: number | null;
};

export type AhpRerunSpec = {
  mode: "incremental_add";
  baseRunId: string;
  newCandidateIds: string[];
  existingPoolCandidateIds: string[];
  frozen: FrozenRunBasis;
};

/**
 * Read the rerun spec off a session's `final_ranked`.
 *
 *  - `null`: not a derived run (a root).
 *  - `{ error }`: a derived run this service no longer runs — a session queued
 *    by the old web app under a retired mode or a retired key. It FAILS, with
 *    the reason, instead of being scored under rules that no longer exist.
 *  - `{ spec }`: a "Tambah Kandidat Pembanding" child.
 */
export function parseRerunSpec(
  finalRanked: unknown
): { spec: AhpRerunSpec } | { error: string } | null {
  const fr = (finalRanked ?? {}) as Record<string, unknown>;
  const retired = ["ahpAugment", "ahpExclude", "ahpAlwaysInclude"].filter((k) => fr[k] != null);
  const raw = fr.ahpRerun as Partial<AhpRerunSpec> & { mode?: unknown } | undefined;
  if (!raw && retired.length === 0) return null;
  const legacyMessage =
    "Sesi re-run ini dibuat oleh versi lama dengan mode yang tidak lagi dijalankan. Buat ulang lewat \"Tambah Kandidat Pembanding\" pada run induknya, atau buat run baru dari wizard scoring.";
  if (retired.length > 0) return { error: `${legacyMessage} (kunci lama: ${retired.join(", ")})` };
  if (raw!.mode !== "incremental_add") return { error: `${legacyMessage} (mode: ${String(raw!.mode)})` };
  if (!raw!.frozen || raw!.frozen.version !== 1 || !raw!.baseRunId) {
    return { error: `${legacyMessage} (tanpa basis beku)` };
  }
  return {
    spec: {
      mode: "incremental_add",
      baseRunId: String(raw!.baseRunId),
      newCandidateIds: Array.isArray(raw!.newCandidateIds) ? raw!.newCandidateIds.map(String) : [],
      existingPoolCandidateIds: Array.isArray(raw!.existingPoolCandidateIds)
        ? raw!.existingPoolCandidateIds.map(String)
        : [],
      frozen: raw!.frozen as FrozenRunBasis,
    },
  };
}

/**
 * Who is scored and who is carried.
 *
 * Every candidate in the pool that is NOT new is carried with the parent's
 * aspects, the `existing_pool` people included — they are already in the
 * parent's alternative set, so re-scoring them would change the ranking for a
 * reason that is neither the addition nor anything the forum asked about. A
 * carried candidate with no stored aspects is a broken parent, and the run fails
 * rather than silently scoring that person today.
 */
export function planFrozenRerun<A>(input: {
  candidateIds: string[];
  newCandidateIds: string[];
  existingPoolCandidateIds: string[];
  cached: Map<string, A>;
}): {
  reused: Map<string, A>;
  toScore: Set<string>;
  /** New + existing-pool: always given a result row, at their whole-pool rank. */
  alwaysInclude: Set<string>;
  missingCarried: string[];
} {
  const fresh = new Set(input.newCandidateIds);
  const reused = new Map<string, A>();
  const toScore = new Set<string>();
  const missingCarried: string[] = [];
  for (const id of input.candidateIds) {
    if (fresh.has(id)) {
      toScore.add(id);
      continue;
    }
    const hit = input.cached.get(id);
    if (hit) reused.set(id, hit);
    else missingCarried.push(id);
  }
  return {
    reused,
    toScore,
    alwaysInclude: new Set([...input.newCandidateIds, ...input.existingPoolCandidateIds]),
    missingCarried,
  };
}

/**
 * Which ranked candidates a run LISTS (writes an `analysis_results` row for),
 * and the markers each listed row carries (FR-RR-09).
 *
 * A root lists its top N. A "Tambah Kandidat Pembanding" child lists the union
 * of (1) its own top N — N is the PARENT's finalist count, handed in as
 * `topN` — (2) every parent finalist, wherever it lands now, and (3) every
 * comparison candidate, wherever it lands; nobody else. The forum asked "how
 * does X compare?", so X must be visible even at 37th of 60; a finalist pushed
 * out must not vanish from view; and a candidate nobody asked about must not
 * appear just because a quota grew. Order is the new ranking.
 */
export function composeChildResultList(input: {
  /** Every ranked candidate id, best first (the whole pool). */
  rankedIds: string[];
  topN: number;
  /** Empty on a root. */
  parentFinalistIds: Set<string>;
  /** Empty on a root. */
  comparisonIds: Set<string>;
  /**
   * The parent's whole-pool rank per candidate, to say WHY a parent finalist
   * left the top N. Omitted: the cause is not decided (null).
   */
  parentRankById?: Map<string, number>;
}): {
  listed: {
    candidateId: string;
    poolRank: number;
    belowCut: boolean;
    comparison: boolean;
    enteredTopN: boolean;
    leftTopN: boolean;
    leftTopNCause: LeftTopNCause | null;
  }[];
} {
  const isChild = input.parentFinalistIds.size > 0 || input.comparisonIds.size > 0;
  const listed = input.rankedIds
    .map((candidateId, i) => ({ candidateId, poolRank: i + 1 }))
    .filter(
      ({ candidateId, poolRank }) =>
        poolRank <= input.topN ||
        input.parentFinalistIds.has(candidateId) ||
        input.comparisonIds.has(candidateId)
    )
    .map(({ candidateId, poolRank }) => {
      const belowCut = poolRank > input.topN;
      const leftTopN = isChild && belowCut && input.parentFinalistIds.has(candidateId);
      return {
        candidateId,
        poolRank,
        belowCut,
        comparison: input.comparisonIds.has(candidateId),
        enteredTopN: isChild && !belowCut && !input.parentFinalistIds.has(candidateId),
        leftTopN,
        leftTopNCause:
          leftTopN && input.parentRankById
            ? leftTopNCauseOf(candidateId, input.rankedIds.slice(0, poolRank - 1), input.parentRankById)
            : null,
      };
    });
  return { listed };
}

export { leftTopNCauseOf, type LeftTopNCause };

/**
 * The criteria a child ranks on: the PARENT's, never re-evaluated.
 *
 * A child's live evaluation can disagree — the canonical case is a parent that
 * dropped education because none of its candidates could be assessed, and an
 * added candidate who can. Re-activating it would pull weight from every other
 * criterion and move every carried-over candidate for a reason that is not the
 * addition. So the parent's set stands, and the disagreement is REPORTED in
 * `liveDisagrees` instead of applied.
 */
export function frozenDroppedCriteria(
  frozen: FrozenRunBasis | null,
  liveDropped: { key: AhpCriterionKey; reason: string }[]
): {
  dropped: { key: AhpCriterionKey; reason: string }[];
  source: "parent" | "live";
  liveDisagrees: { key: AhpCriterionKey; parent: "dropped" | "active"; live: "dropped" | "active" }[];
} {
  const parentDropped = frozen?.ahp.droppedCriteria ?? null;
  if (!parentDropped) return { dropped: liveDropped, source: "live", liveDisagrees: [] };
  const p = new Set(parentDropped.map((d) => d.key));
  const l = new Set(liveDropped.map((d) => d.key));
  const liveDisagrees = AHP_CRITERIA_ORDER.filter((k) => p.has(k) !== l.has(k)).map((key) => ({
    key,
    parent: p.has(key) ? ("dropped" as const) : ("active" as const),
    live: l.has(key) ? ("dropped" as const) : ("active" as const),
  }));
  return {
    dropped: parentDropped.map((d) => ({
      key: d.key,
      reason: `${d.reason} (dibekukan dari run induk)`,
    })),
    source: "parent",
    liveDisagrees,
  };
}

/**
 * The priority vector a child ranks with: the parent's own, at full precision.
 *
 * NOT re-derived from the parent's stored matrix — that matrix is rounded to 4
 * decimals in `run_info.ahp.pairwise`, and the eigenvector of the rounded
 * matrix differs from the original by ~1e-5, which moves every closeness
 * coefficient. Null means the parent recorded no weights; the caller then
 * resolves live and records it as a fallback.
 */
export function frozenWeights(
  frozen: FrozenRunBasis | null
): Record<AhpCriterionKey, number> | null {
  const w = frozen?.ahp.weights;
  if (!w) return null;
  for (const k of AHP_CRITERIA_ORDER) if (!Number.isFinite(w[k])) return null;
  return { ...w };
}

/** The reference instant for stint ages, or null when there is none to freeze. */
export function frozenReferenceDate(frozen: FrozenRunBasis | null): Date | null {
  if (!frozen?.referenceDate) return null;
  const d = new Date(frozen.referenceDate);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Which models moved between a parent and its child. Empty when the parent
 * recorded none (a run from before this was recorded) or nothing moved.
 */
export function modelDifferences(
  parent: RunModels | null,
  current: RunModels
): { key: "embedding" | "education" | "narrative"; parent: string | null; current: string | null }[] {
  if (!parent) return [];
  const pick = (m: RunModels) => ({
    embedding: m.embedding.documentModel ?? m.embedding.model,
    education: m.education.model,
    narrative: m.narrative.enabled ? m.narrative.model : null,
  });
  const a = pick(parent);
  const b = pick(current);
  return (["embedding", "education", "narrative"] as const)
    .filter((k) => (a[k] ?? null) !== (b[k] ?? null))
    .map((key) => ({ key, parent: a[key] ?? null, current: b[key] ?? null }));
}

/**
 * What a run ranked WITH, at full precision — written to `run_info.frozen` on
 * every AHP run, root or child. A child of this run inherits these exact values
 * (the web app's `resolveFrozenBasis` reads this first), so a grandchild ends up
 * with the ROOT's numbers rather than an approximation of them.
 *
 * `source` is `own` on a root, `parent` when a child inherited the part whole,
 * and `live_fallback` when the parent had nothing to inherit and this run had to
 * resolve it live.
 */
export function buildFrozenRecord(input: {
  frozen: FrozenRunBasis | null;
  runId: string;
  referenceDate: Date;
  weights: Record<AhpCriterionKey, number>;
  pairwise: number[][];
  weightSource: string;
  weightsInherited: boolean;
  activeCriteria: AhpCriterionKey[];
  liveDroppedCriteria: { key: AhpCriterionKey; reason: string }[];
  criteriaSource: "parent" | "live";
  technical: { simFloor: number; simCeil: number; source: string };
  career: { simFloor: number; simCeil: number; source: string };
  anchorsInherited: boolean;
  depth: { targetYears: number; targetRows: number } | null;
  /** This run's own CR / λmax / CI (a child passes the parent's). */
  consistency?: { cr: number; lambdaMax: number; ci: number } | null;
  /** The position basis this run scored against (FR-RR-07). */
  positionBasis?: PositionBasis | null;
  /** The models this run used. */
  models?: RunModels | null;
  /** The TOPSIS yardstick this run ranked with (a child: its parent's). */
  topsis?: RecordedTopsis | null;
}) {
  const f = input.frozen;
  return {
    version: 1 as const,
    rootRunId: f?.rootRunId ?? input.runId,
    parentRunId: f?.parentRunId ?? null,
    referenceDate: input.referenceDate.toISOString(),
    referenceDateSource: f ? f.referenceDateSource : ("run_start" as const),
    ahp: {
      weights: { ...input.weights },
      pairwise: input.pairwise,
      activeCriteria: [...input.activeCriteria],
      // The parent's own reasons, undecorated, so a chain does not grow them.
      droppedCriteria: f?.ahp.droppedCriteria ?? input.liveDroppedCriteria,
      weightSource: input.weightSource,
      source: f
        ? input.weightsInherited && input.criteriaSource === "parent"
          ? ("parent" as const)
          : ("live_fallback" as const)
        : ("own" as const),
      consistency: input.consistency ?? null,
    },
    anchors: {
      technical: {
        simFloor: input.technical.simFloor,
        simCeil: input.technical.simCeil,
        source: input.technical.source,
      },
      career: {
        simFloor: input.career.simFloor,
        simCeil: input.career.simCeil,
        source: input.career.source,
      },
      depth: input.depth,
      source: f
        ? input.anchorsInherited
          ? ("parent" as const)
          : ("live_fallback" as const)
        : ("own" as const),
    },
    positionBasis: input.positionBasis ?? null,
    models: input.models ?? null,
    topsis: input.topsis ?? null,
  };
}
