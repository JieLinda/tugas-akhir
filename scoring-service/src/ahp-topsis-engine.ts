// AHP + TOPSIS scoring engine — the only scoring method (the LLM "AI
// Tournament" was removed). Each of the six aspects produces a numeric 0-100
// value with its own logic, criteria weights come from an AHP pairwise matrix
// (per program template, falling back to the system defaults), and the final
// ranking is a classic TOPSIS over the 6-criteria decision matrix.
//
// Aspects (canonical order — must match AHP_CRITERIA_ORDER in the web app):
//  1. technical    — BERT + mean pooling: semantic coverage of the position's
//                    required competencies by the candidate's competencies.
//  2. career       — relevance of current position + position history against
//                    the job profile (jobPurpose + responsibilities).
//  3. behavior     — ordinal ranking rule over assessment categories.
//  4. performance  — Absolute-Solution Dynamic TOPSIS over semester PA grades.
//  5. hav          — existing HAV quadrant group rule.
//  6. education    — deterministic exact-match of the candidate's education
//                    level + major against the job profile's stated education
//                    requirement (→ fixed 100 on a hit); otherwise a grounded
//                    Gemini call (temperature 0, topP 0, Google-Search grounding,
//                    fixed rubric, validated JSON with retry) scoring education
//                    level + major relevance against the position's
//                    responsibilities + success indicators. Grounding disables
//                    Gemini's JSON mode, so a prose answer is possible; after the
//                    retries a structured-output repair pass (grounding off,
//                    responseSchema on) runs before giving up. No BERT fallback —
//                    if every attempt fails, education is "tidak dinilai" (0) with
//                    the actual error quoted.
//
// TENANT SCOPE — DELIBERATELY NONE HERE.
// The web app scopes job profile DOCUMENTS per business unit (job_profile_tenants,
// see lib/job-profile-tenant-scope.ts), but that scope stops at display. Every
// corpus read below — sync_job_profiles, job_profile_embed, job_family_matches,
// sync_technical_competencies, kamus_kompetensi_level_embed — is intentionally
// unfiltered, because a scoring run may pull candidates from other tenants
// (cross-tenant talent search) and they must be scored on the same basis as the
// home tenant's.
//
// Applying the display scope here would not merely narrow the evidence: a
// candidate with no visible job-profile history scores nothing on career /
// technical, and this engine responds by DROPPING the criterion and
// redistributing its AHP weight. The ranking would silently change meaning
// depending on who happened to be logged in. If you ever do need a scoped read
// here, pass the scope in explicitly and record it in
// tournament_sessions.final_ranked.runInfo like every other degradation.

import { createHash } from "node:crypto";
import { query, queryOne, execute, vectorQuery } from "./db/postgres.js";
import {
  basisCaveats,
  parsePositionBasis,
  type BasisCaveat,
  type FrozenCareerTarget,
  type FrozenJobProfile,
  type PositionBasis,
} from "./position-basis.js";
import {
  runAhpNarrativeAgent,
  type AhpNarrativeEntry,
  type AhpNarrativeInput,
} from "./ahp-narrative.js";
import { log } from "./llm.js";
import {
  callGeminiGrounded,
  parseEducationJson,
  geminiConfigured,
  EDUCATION_RESPONSE_SCHEMA,
  type GroundingSource,
} from "./gemini.js";
import { getPrompt } from "./prompts.js";
import { config } from "./config.js";
import {
  buildEducationUserPrompt,
  educationInputKey,
  loadEducationReuseSource,
  reusableAnswerFor,
  type EducationModelSettings,
  type EducationPromptInput,
  type EducationReuseProvenance,
  type EducationReuseSource,
} from "./education-reuse.js";

/** What the education scorer did with the reusable answers, for `runInfo`. */
type EducationReuseTally = {
  source: EducationReuseSource | null;
  /** Candidates that took the model path (no exact match, some education data). */
  eligible: number;
  /** Of those, how many reused the last run's answer instead of calling. */
  reused: number;
  /** Candidates for whom the model was actually called this run. */
  modelCalls: number;
};
import type { EffectiveHav, HavSource } from "./hav-effective.js";
import { HAV_QUADRANT_MATRIX, competencyBand, performanceBand } from "./hav-effective.js";
import { countHavSources, withEffectiveHav } from "./hav-placements.js";
import { RUN_TRACE_VERSION } from "./run-trace-types.js";
import type {
  BehaviorTrace,
  CandidateTrace,
  CareerCandidateTrace,
  CareerFallbackTrace,
  CareerStintTrace,
  CensusRef,
  CompetencyMatchTrace,
  EducationTrace,
  EngineTrace,
  HavTrace,
  TechnicalCandidateTrace,
  TraceParameters,
} from "./run-trace-types.js";
import { loadEngineTrace, persistEngineTrace } from "./run-trace.js";
import { havEditedIds, havFormulaPinnedIds, loadDemoCopies, loadDemoOnIds, overlayDemoCopy, type DemoCopy } from "./demo-overlay.js";
import {
  PA_GRADE_VALUES,
  PA_IDEAL_NEGATIVE,
  PA_IDEAL_POSITIVE,
  PA_MAX_PERIODS,
  PA_PERIOD_WEIGHTS,
  PA_RECENCY_DECAY,
  tracePerformanceAspect,
} from "./pa-score.js";
import { LEVEL_FACTOR_CEILING, LEVEL_GAP_SPAN, OVER_QUALIFICATION_SURPLUS } from "./competency-level.js";
import { TECHNICAL_ANCHOR_PARAMS } from "./technical-anchors.js";
import { CAREER_ANCHOR_PARAMS } from "./career-anchors.js";
import { CAREER_DEPTH_CENSUS_PARAMS } from "./career-depth-anchors.js";
import { COMPETENCY_IDF_PARAMS } from "./competency-idf.js";
import { RANDOM_INDEX } from "./ahp.js";
import { computeAhpWeights, pairwiseFromWeights, isValidPairwise } from "./ahp.js";
import { ahpInputCheck, saatyLabel } from "./ahp-saaty.js";
import {
  rankCandidatesByTopsis,
  anchorsFromDetail,
  readTopsisAnchors,
  type RecordedTopsis,
  type TopsisAnchorsByKey,
} from "./topsis-ranking.js";
export { rankCandidatesByTopsis };
import { scorePerformanceAspect } from "./pa-score.js";
export { scorePerformanceAspect } from "./pa-score.js";
import { embedTexts, cosineSimilarity, storedVectorKind } from "./embeddings.js";
import { hungarianMaxAssignment } from "./hungarian.js";
import { competencyLevelFactor, rescaleTechnicalSimilarity } from "./competency-level.js";
import { loadKamusNameToCode } from "./kamus-codes.js";
import {
  kamusCorpusFingerprint,
  resolveTechnicalAnchors,
  type TechnicalAnchors,
} from "./technical-anchors.js";
import { resolveCareerAnchors, type CareerAnchors } from "./career-anchors.js";
import { resolveCompetencyIdfCached } from "./competency-idf.js";
import {
  resolveCareerDepthCensusCached,
  targetYearsForLevel,
  levelFromTitle,
  levelLabel,
  type CareerDepthCensus,
  type PositionLevel,
} from "./career-depth-anchors.js";
import {
  loadSession,
  loadPositionRow,
  determineReadiness,
  computeHavScore,
  traceHavScore,
  HAV_GROUP_SCORES,
  findMatchedJobProfileId,
  type PositionRow,
} from "./scoring-engine.js";

// ─── Criteria ────────────────────────────────────────────────────
//
// The order, the default weights and the matrix resolution live in
// ahp-weights.ts. Re-exported because importers outside this file, and every
// doc comment in it, refer to them by this path.
import {
  AHP_CRITERIA_ORDER,
  DEFAULT_WEIGHTS,
  resolveAhpWeights,
  type AhpCriterionKey,
  type ResolvedAhpWeights,
} from "./ahp-weights.js";
import {
  buildFrozenRecord,
  frozenDroppedCriteria,
  frozenReferenceDate,
  frozenWeights,
  composeChildResultList,
  modelDifferences,
  parseRerunSpec,
  planFrozenRerun,
  type AhpRerunSpec,
  type FrozenRunBasis,
  type RunModels,
} from "./rerun-freeze.js";
export {
  AHP_CRITERIA_ORDER,
  DEFAULT_WEIGHTS,
  resolveAhpWeights,
  type AhpCriterionKey,
  type ResolvedAhpWeights,
};

const CRITERIA_LABELS: Record<AhpCriterionKey, string> = {
  technical: "Technical Competency Mapping",
  career: "Career Relevance",
  behavior: "Behavior Competency Assessment",
  performance: "Performance Appraisal",
  hav: "HAV Mapping",
  education: "Employee Profile - Pendidikan",
};

// NOTE: this engine does not read a program's criteria list at all. The weight
// of every criterion comes from the program's pairwise matrix or from
// DEFAULT_WEIGHTS.

// ─── Types ───────────────────────────────────────────────────────

type AhpCandidate = {
  id: string;
  name: string;
  employeeId: string | null;
  currentPosition: string | null;
  yearsExperience: number | null;
  education: string | null;
  major: string | null;
  disciplineStatus: string | null;
  mcuStatus: string | null;
  performanceGrade: string | null;
  behaviorRecommendation: string | null;
  behaviorNotes: string | null;
  /** The HAV quadrant IN FORCE (manual > upload > formula), not the raw Excel column. */
  havQuadrant: string | null;
  /** Where `havQuadrant` came from — recorded per candidate in rawInputs. */
  havSource: HavSource;
  /** The three HAV tiers behind `havQuadrant` (manual / upload / formula) — run trace only. */
  havEffective?: EffectiveHav | null;
  competencies: { name: string; proficiency: string | null }[];
  history: {
    title: string;
    positionId: string | null;
    companyId: string | null;
    gradeId: string | null;
    validFrom: Date | null;
    validTo: Date | null;
  }[];
};

type RequiredCompetency = { name: string; level: number };

type ResponsibilityDetail = {
  responsibility: string;
  /** The measurable success indicator paired with this responsibility (if any). */
  successIndicator: string | null;
};

type JobProfileMatch = {
  /** `sync_job_profiles.id` — null when rebuilt from a frozen basis that had none. */
  id: number | null;
  /** Which tier of `findJobProfileForPosition` matched it. */
  matchTier: "jfm" | "exact" | "substring" | "embedding" | null;
  /** sha256 of the extracted data the values below were read from. */
  contentHash: string | null;
  positionName: string | null;
  jobPurpose: string | null;
  responsibilities: string[];
  /**
   * Responsibilities WITH their paired success indicators — the basis the
   * grounded education scorer uses to judge whether the candidate's education
   * fits the actual work (not merely the stated minimum-education requirement).
   */
  responsibilityDetails: ResponsibilityDetail[];
  /** Required technical competencies WITH target level (from the job profile). */
  requiredCompetencies: RequiredCompetency[];
  /**
   * The job profile's stated education requirement, verbatim from the extracted
   * `jobSpecification.education` (e.g. "S1 / D3 Semua Jurusan"). Basis for the
   * deterministic exact-match short-circuit before any LLM scoring.
   */
  educationRequirement: string | null;
  /**
   * The job's stated challenges (`problemSolving.challenges`). Not used by any
   * scoring aspect; recorded as part of the frozen position basis
   * (position-basis.ts) so a run keeps the job profile it was scored against.
   */
  challenges: string[];
};

export type EducationEvaluation = {
  /** Final 0-100 education aspect score fed to TOPSIS. */
  score: number;
  /**
   * `llm-structured` = the grounded call kept answering with prose, so the score
   * came from the structured-output repair pass (same rubric, no citations).
   */
  source: "exact-match" | "llm-grounded" | "llm-structured" | "bert-fallback" | "none";
  /**
   * RAW answers from the grounded LLM (0-100 each). Null on the exact-match /
   * fallback paths.
   *
   * These are INPUTS now, not axes. Both are accumulated into `groundedMajorAxis`
   * below, because the level axis is decided by rule and never by the model — see
   * `compareEducationLevel`. `educationLevel` is kept because the model's reading
   * of whether the level suits the responsibilities is still worth showing, it
   * just no longer scores the level dimension.
   */
  educationLevel: number | null;
  majorRelevance: number | null;
  /**
   * LLM PATH ONLY: the single axis the two grounded answers accumulate into —
   * mean(educationLevel, majorRelevance). Named for the major because that is the
   * dimension grounding is actually competent to judge; it carries the model's
   * level opinion as supporting evidence rather than as its own axis.
   */
  groundedMajorAxis: number | null;
  /**
   * The level axis, by rule, on BOTH paths (100 higher / 80 equal / 50 lower).
   * Null only when neither side states a recognisable level, in which case the
   * axis is dropped rather than guessed.
   */
  levelScore: number | null;
  /** The comparison `levelScore` came from. Present on both paths. */
  levelComparison: 'higher' | 'equal' | 'lower' | null;
  /**
   * EXACT-MATCH PATH ONLY: how the candidate's level compares to the requirement,
   * which is what picks the tier — higher 100 / equal 80 / lower 50.
   *
   * Persisted rather than left inferable from the score because that inference is
   * exactly where explanations went wrong: an exact match at `equal` scores 80 BY
   * RULE, and readers (including the AI assistant) instead reconstructed it as a
   * weighted blend of educationLevel/majorRelevance — two fields that are null on
   * this path. Null on the LLM and no-data paths, where no comparison was made.
   */
  exactComparison: "higher" | "equal" | "lower" | null;
  /** Human-readable justification (LLM reasoning or exact-match explanation). */
  reason: string | null;
  /** Tokens that matched the requirement on the exact-match path. */
  matchedTokens: string[];
  /** Grounding: Google Search queries + web sources cited by the model. */
  searchQueries: string[];
  sources: GroundingSource[];
  /** Legacy per-responsibility items (kept for backward compatibility). */
  items: { idResponsibility: number; score: number; analysis: string }[];
  /**
   * LLM PATH ONLY: fingerprint of everything the model was asked for this
   * candidate, minus the name (`educationInputKey`, education-reuse.ts). A later
   * run of the same position reuses this answer when its own key is equal. Null
   * on the exact-match / no-data paths and on runs from before it was recorded.
   */
  inputKey: string | null;
  /**
   * Set when the model was NOT called for this candidate in this run: its answer
   * (educationLevel, majorRelevance, reason, sources) was reused from the last run
   * of the position because the inputs were identical. The score is still
   * recomposed with this run's level rule.
   */
  reusedFrom: EducationReuseProvenance | null;
};

// ─── Derived runs ("Tambah Kandidat Pembanding") ──────────────────
//
// A derived run is its parent, frozen, plus the people somebody asked about:
// the six aspects of every carried-over candidate come from the parent (they are
// per-candidate and pool-independent), and so do the weights, the active
// criteria, the anchors and the reference date — see rerun-freeze.ts for the
// contract and the decisions. Only TOPSIS is recomputed over the union, because
// it is set-relative at the column norms and at the ideal / anti-ideal.
//
// The web app writes the spec into the NEW session's `final_ranked.ahpRerun` at
// creation; it survives a service restart because progress updates merge into
// `final_ranked` instead of replacing it. The four other modes this engine used
// to run (and the `ahpAugment` / `ahpExclude` / `ahpAlwaysInclude` keys) are
// retired: `parseRerunSpec` fails such a session with a message.

/** A base run's per-candidate rank/closeness, for before-after diagnostics. */
type BasePoolEntry = { poolRank: number; closeness: number; isFinalist: boolean };

/** Per-candidate aspect snapshot recovered from a base run's analysis_results. */
export type CachedAspects = {
  technical: number;
  career: number;
  technicalMatching: TechnicalDetail | null;
  careerMatching: CareerDetail | null;
  educationEval: EducationEvaluation;
  /**
   * The parent's behavior / performance / HAV. A derived run RANKS with these —
   * all six aspects are frozen, not three — and also compares them against
   * today's values for the drift report (`runInfo.freshness`), which says how
   * much the parent's data has moved without letting that movement into the
   * ranking.
   */
  baseBehavior: number | null;
  basePerformance: number | null;
  baseHav: number | null;
  /**
   * The RAW strings those three scores were computed from, in the base run.
   *
   * Needed because a frozen score without its input is a row that contradicts
   * itself: the ranking would use last month's performance score while the
   * detail panel printed this month's PA grade beside it, and the next derived
   * run would read that mismatched pair back. Null on base runs written before
   * these were persisted — the caller then displays today's strings and records
   * that it did.
   */
  baseRaw: {
    behaviorRecommendation: string | null;
    behaviorNotes: string | null;
    performanceGrade: string | null;
    havQuadrant: string | null;
  } | null;
  /**
   * The parent recorded these numbers as PROVISIONAL ("skor sementara"): its
   * sealed candidate columns could not be read, so four aspects were constants
   * rather than measurements. Carried as-is — the child's numbers are the
   * parent's, so they are exactly as provisional.
   */
  provisional: boolean;
};

/** Diagnostics-only read: absent means "the base run recorded none", not zero. */
function numberOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Load the reusable aspect scores of a completed AHP+TOPSIS run, keyed by
 * candidate id.
 *
 * Two sources, in priority order:
 *  1. `analysis_results` — the finalists, with their full details blob.
 *  2. `scoring_run_pool_aspects` — every candidate the run scored, finalist or
 *     not. This is what lets an exclusion re-rank backfill the freed slot from
 *     rank N+1; runs written before that table exists contribute nothing here
 *     and the caller reports the missing backfill instead of hiding it.
 *
 * Rows that predate the `ahpTopsis` details block (or are malformed) are
 * skipped, so those candidates simply get recomputed.
 */
async function loadCachedAspects(
  baseRunId: string
): Promise<Map<string, CachedAspects>> {
  const [finalistRows, poolRows] = await Promise.all([
    query<{ candidateId: string; details: string | null }>(
      `SELECT candidate_id as "candidateId", details
       FROM analysis_results
       WHERE run_id = $1 AND method = 'AHP_TOPSIS'`,
      [baseRunId]
    ).catch(() => [] as { candidateId: string; details: string | null }[]),
    query<{ candidateId: string; aspects: any; details: any }>(
      `SELECT candidate_id as "candidateId", aspects, details
       FROM scoring_run_pool_aspects
       WHERE run_id = $1`,
      [baseRunId]
    ).catch(() => [] as { candidateId: string; aspects: any; details: any }[]),
  ]);
  return cachedAspectsFromRows(finalistRows, poolRows);
}

/**
 * The parsing half of `loadCachedAspects`, pure so the freeze round trip —
 * persisted pool row → carried aspects → persisted again in a child — can be
 * tested without a database (test/rerun-freeze.test.ts).
 */
export function cachedAspectsFromRows(
  rows: { candidateId: string; details: string | null }[],
  poolRows: { candidateId: string; aspects: any; details: any }[]
): Map<string, CachedAspects> {
  const out = new Map<string, CachedAspects>();
  for (const row of rows) {
    let parsed: any = null;
    try {
      parsed =
        typeof row.details === "string" ? JSON.parse(row.details) : row.details;
    } catch {
      parsed = null;
    }
    const breakdown = parsed?.scoreBreakdown;
    const ahp = parsed?.ahpTopsis;
    if (!breakdown || !ahp) continue;

    const edu = ahp.educationDetail ?? {};
    out.set(row.candidateId, {
      technical: finiteOr(breakdown.technical, 0),
      career: finiteOr(breakdown.career, 0),
      baseBehavior: numberOrNull(breakdown.behavior),
      basePerformance: numberOrNull(breakdown.performance),
      baseHav: numberOrNull(breakdown.hav),
      baseRaw:
        ahp.behaviorDetail || ahp.performanceDetail || ahp.havDetail
          ? {
              behaviorRecommendation: ahp.behaviorDetail?.recommendation ?? null,
              behaviorNotes: ahp.behaviorDetail?.notes ?? null,
              performanceGrade: ahp.performanceDetail?.grade ?? null,
              havQuadrant: ahp.havDetail?.quadrant ?? null,
            }
          : null,
      technicalMatching: (ahp.technicalMatching as TechnicalDetail) ?? null,
      careerMatching: (ahp.careerMatching as CareerDetail) ?? null,
      provisional: ahp.provisional === true,
      educationEval: makeEduEval({
        score: finiteOr(edu.score ?? breakdown.education, 0),
        source: (edu.source ?? ahp.educationSource ?? "none") as EducationEvaluation["source"],
        educationLevel: typeof edu.educationLevel === "number" ? edu.educationLevel : null,
        majorRelevance: typeof edu.majorRelevance === "number" ? edu.majorRelevance : null,
        groundedMajorAxis: typeof edu.groundedMajorAxis === "number" ? edu.groundedMajorAxis : null,
        levelScore: typeof edu.levelScore === "number" ? edu.levelScore : null,
        levelComparison: edu.levelComparison ?? null,
        exactComparison: edu.exactComparison ?? null,
        reason: edu.reason ?? null,
        matchedTokens: Array.isArray(edu.matchedTokens) ? edu.matchedTokens : [],
        searchQueries: Array.isArray(edu.searchQueries) ? edu.searchQueries : [],
        sources: Array.isArray(edu.sources) ? edu.sources : [],
        items: Array.isArray(edu.items)
          ? edu.items
          : Array.isArray(ahp.educationAnalysis)
            ? ahp.educationAnalysis
            : [],
        inputKey: typeof edu.inputKey === "string" ? edu.inputKey : null,
        reusedFrom: parseReuseProvenance(edu.reusedFrom),
      }),
    });
  }

  // Non-finalists: same aspect values, stored flat instead of inside a rendered
  // details blob. Finalists already handled above keep their richer row.
  for (const row of poolRows) {
    if (out.has(row.candidateId)) continue;
    const aspects = parseJsonColumn(row.aspects) ?? {};
    const detail = parseJsonColumn(row.details) ?? {};
    const edu = detail.educationEval ?? {};
    out.set(row.candidateId, {
      technical: finiteOr(aspects.technical, 0),
      career: finiteOr(aspects.career, 0),
      baseBehavior: numberOrNull(aspects.behavior),
      basePerformance: numberOrNull(aspects.performance),
      baseHav: numberOrNull(aspects.hav),
      baseRaw: detail.rawInputs
        ? {
            behaviorRecommendation: detail.rawInputs.behaviorRecommendation ?? null,
            behaviorNotes: detail.rawInputs.behaviorNotes ?? null,
            performanceGrade: detail.rawInputs.performanceGrade ?? null,
            havQuadrant: detail.rawInputs.havQuadrant ?? null,
          }
        : null,
      technicalMatching: (detail.technicalMatching as TechnicalDetail) ?? null,
      careerMatching: (detail.careerMatching as CareerDetail) ?? null,
      provisional: detail.provisional === true,
      educationEval: makeEduEval({
        score: finiteOr(edu.score ?? aspects.education, 0),
        source: (edu.source ?? "none") as EducationEvaluation["source"],
        educationLevel: typeof edu.educationLevel === "number" ? edu.educationLevel : null,
        majorRelevance: typeof edu.majorRelevance === "number" ? edu.majorRelevance : null,
        groundedMajorAxis: typeof edu.groundedMajorAxis === "number" ? edu.groundedMajorAxis : null,
        levelScore: typeof edu.levelScore === "number" ? edu.levelScore : null,
        levelComparison: edu.levelComparison ?? null,
        exactComparison: edu.exactComparison ?? null,
        reason: edu.reason ?? null,
        matchedTokens: Array.isArray(edu.matchedTokens) ? edu.matchedTokens : [],
        searchQueries: Array.isArray(edu.searchQueries) ? edu.searchQueries : [],
        sources: Array.isArray(edu.sources) ? edu.sources : [],
        items: Array.isArray(edu.items) ? edu.items : [],
        inputKey: typeof edu.inputKey === "string" ? edu.inputKey : null,
        reusedFrom: parseReuseProvenance(edu.reusedFrom),
      }),
    });
  }
  return out;
}

/** jsonb columns arrive parsed from `pg`, but survive a stringified row too. */
function parseJsonColumn(value: unknown): any {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * A base run's per-candidate rank + closeness over the FULL scored pool, used to
 * show what an exclusion re-rank actually moved. Empty for runs that predate
 * `scoring_run_pool_aspects`.
 */
async function loadBasePoolEntries(
  baseRunId: string
): Promise<Map<string, BasePoolEntry>> {
  const rows = await query<{
    candidateId: string;
    poolRank: number;
    closeness: string | number;
    isFinalist: boolean;
  }>(
    `SELECT candidate_id as "candidateId", pool_rank as "poolRank",
            closeness, is_finalist as "isFinalist"
     FROM scoring_run_pool_aspects
     WHERE run_id = $1`,
    [baseRunId]
  ).catch(
    () =>
      [] as {
        candidateId: string;
        poolRank: number;
        closeness: string | number;
        isFinalist: boolean;
      }[]
  );

  const out = new Map<string, BasePoolEntry>();
  for (const r of rows) {
    out.set(r.candidateId, {
      poolRank: Number(r.poolRank),
      closeness: finiteOr(r.closeness, 0),
      isFinalist: Boolean(r.isFinalist),
    });
  }
  return out;
}

/**
 * The base run's display diagnostics (`runInfo`). On an exclusion re-rank nothing
 * is re-scored, so the career/technical sections this run would compute describe
 * an empty scoring pass — the base run's are the ones that actually describe the
 * numbers being ranked.
 */
async function loadBaseRunInfo(baseRunId: string): Promise<any | null> {
  // The run's own copy first (drizzle/0065), the session's second. The session
  // copy is all that older runs have, and a session can be deleted while its run
  // survives — which is exactly how this inheritance used to come back empty.
  const own = await queryOne<{ runInfo: any }>(
    `SELECT run_info AS "runInfo" FROM scoring_runs WHERE id = $1 AND run_info IS NOT NULL`,
    [baseRunId]
  ).catch(() => null);
  const fromRun = parseJsonColumn(own?.runInfo);
  if (fromRun) return fromRun;

  const row = await queryOne<{ runInfo: any }>(
    `SELECT final_ranked->'runInfo' AS "runInfo"
     FROM tournament_sessions
     WHERE run_id = $1 AND final_ranked ? 'runInfo'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [baseRunId]
  ).catch(() => null);
  return parseJsonColumn(row?.runInfo) ?? null;
}

/** Build an EducationEvaluation with the shared fields defaulted. */
function makeEduEval(
  partial: Partial<EducationEvaluation> & Pick<EducationEvaluation, "score" | "source">
): EducationEvaluation {
  return {
    educationLevel: null,
    majorRelevance: null,
    groundedMajorAxis: null,
    levelScore: null,
    levelComparison: null,
    exactComparison: null,
    reason: null,
    matchedTokens: [],
    searchQueries: [],
    sources: [],
    items: [],
    inputKey: null,
    reusedFrom: null,
    ...partial,
  };
}

/** A stored `reusedFrom`, or null when absent or malformed. */
function parseReuseProvenance(v: any): EducationReuseProvenance | null {
  return v && typeof v.runId === "string" && typeof v.answeredInRunId === "string"
    ? { runId: v.runId, answeredInRunId: v.answeredInRunId, answeredAt: typeof v.answeredAt === "string" ? v.answeredAt : null }
    : null;
}

// ─── Candidate loading (structured, not pre-formatted) ──────────

async function loadAhpCandidates(
  // Kept for call-site stability. The pool is the authoritative, already
  // tenant-validated id set and may span business units (cross-tenant
  // scoring), so candidates are loaded by id alone.
  _tenantId: string,
  candidateIds: string[],
  /**
   * Candidates CARRIED from a parent run. Loaded even when soft-deleted since:
   * their numbers are the parent's, not today's, and dropping one would shrink
   * the alternative set — a change the child would then misattribute to the
   * people it adds. Everyone else is still dropped at hydration as before.
   */
  carriedIds: string[] = [],
  /**
   * Demo session or demo run (drizzle/0093): score each candidate's demo copy
   * (candidates_dupp, demo-overlay.ts) instead of the real record.
   */
  demo = false
): Promise<AhpCandidate[]> {
  if (candidateIds.length === 0) return [];

  const loadedRows = (
    await query<Omit<AhpCandidate, "competencies" | "history" | "havSource">>(
      `SELECT id, name, employee_id as "employeeId", current_position as "currentPosition",
              years_experience as "yearsExperience", education, major,
              discipline_status as "disciplineStatus", mcu_status as "mcuStatus",
              performance_grade as "performanceGrade",
              behavior_recommendation as "behaviorRecommendation",
              behavior_notes as "behaviorNotes", hav_quadrant as "havQuadrant"
       FROM candidates
       -- Soft-deleted candidates never get scored: a pool persisted before the
       -- delete still holds their id, so drop them at hydration time.
       WHERE id = ANY($1::uuid[]) AND (deleted_at IS NULL OR id = ANY($2::uuid[]))
       -- Deterministic: Postgres is free to return an unordered scan in any
       -- order, and this list feeds the decision matrix whose row order decides
       -- exact ties. Two identical runs must not disagree.
       ORDER BY id`,
      [candidateIds, carriedIds]
    )
  ).map((c) => ({
    ...c,
    // years_experience is a text column; parse it the same way as before.
    yearsExperience:
      (() => {
        const v = c.yearsExperience as unknown;
        return v == null || v === "" ? null : Number(v);
      })(),
  }));
  // The HAV aspect scores the quadrant IN FORCE — manual > upload > formula
  // (hav-effective.ts) — the value the web app's eligibility rules judged this
  // pool on. `havSource` rides along into rawInputs and runInfo.hav, so a run
  // can say which of its HAVs a person placed, an Excel supplied, or the formula
  // computed from two aspects it also scores.
  // The tiers are kept beside the row (not in it) for the run trace: the scorers
  // read only `havQuadrant`, exactly as before.
  // Demo: only candidates switched ON now are scored (OFF = as if deleted,
  // dropped like a tombstone) — except those CARRIED from a parent run, whose
  // numbers are the parent's and must stay in the alternative set (see
  // `carriedIds`). Each is its demo copy merged with the live record.
  const carried = new Set(carriedIds);
  const demoOn = demo ? await loadDemoOnIds(candidateIds) : null;
  const demoCopies = demo ? await loadDemoCopies(candidateIds) : new Map<string, DemoCopy>();
  const presented = demo
    ? loadedRows
        .filter((r) => demoOn!.has(r.id) || carried.has(r.id))
        .map((r) => overlayDemoCopy(r, demoCopies.get(r.id)))
    : loadedRows;
  const rows = (await withEffectiveHav(presented, { ignorePlacementsFor: havEditedIds(demoCopies), formulaPinnedFor: havFormulaPinnedIds(demoCopies) })).map(({ effectiveHav, ...row }) => ({
    ...row,
    havEffective: effectiveHav,
  }));

  const techRows = await query<{
    candidateId: string;
    technicalName: string | null;
    proficiencyName: string | null;
    currentProficiencyName: string | null;
  }>(
    `SELECT candidate_id as "candidateId", technical_name as "technicalName",
            proficiency_name as "proficiencyName",
            current_proficiency_name as "currentProficiencyName"
     FROM candidate_technical_competencies
     WHERE candidate_id = ANY($1::uuid[])`,
    [candidateIds]
  );

  // Position history — enriched from sync_employee_positions (authoritative
  // stint dates via the sync_employee_position_id link) so career-relevance
  // durations reflect the real assignment period even when the derived
  // candidate_position_history row is missing dates.
  const historyRows = await query<{
    candidateId: string;
    internalTitle: string | null;
    externalTitle: string | null;
    positionId: string | null;
    companyId: string | null;
    gradeId: string | null;
    validFrom: Date | null;
    validTo: Date | null;
  }>(
    `SELECT cph.candidate_id as "candidateId", cph.internal_title as "internalTitle",
            cph.external_title as "externalTitle", cph.position_id as "positionId",
            cph.company_id as "companyId", cph.grade_id as "gradeId",
            COALESCE(cph.valid_from, sep.valid_from) as "validFrom",
            COALESCE(cph.valid_to, sep.valid_to) as "validTo"
     FROM candidate_position_history cph
     LEFT JOIN sync_employee_positions sep ON sep.id = cph.sync_employee_position_id
     WHERE cph.candidate_id = ANY($1::uuid[])
     ORDER BY cph.candidate_id ASC, COALESCE(cph.valid_from, sep.valid_from) ASC`,
    [candidateIds]
  );

  const techById = new Map<string, AhpCandidate["competencies"]>();
  for (const r of techRows) {
    if (!r.technicalName) continue;
    const bucket = techById.get(r.candidateId) ?? [];
    bucket.push({
      name: r.technicalName,
      proficiency: r.currentProficiencyName ?? r.proficiencyName,
    });
    techById.set(r.candidateId, bucket);
  }

  const historyById = new Map<string, AhpCandidate["history"]>();
  for (const r of historyRows) {
    const title = r.internalTitle ?? r.externalTitle ?? r.positionId;
    if (!title) continue;
    const bucket = historyById.get(r.candidateId) ?? [];
    bucket.push({
      title,
      positionId: r.positionId,
      companyId: r.companyId,
      gradeId: r.gradeId,
      validFrom: r.validFrom,
      validTo: r.validTo,
    });
    historyById.set(r.candidateId, bucket);
  }

  return rows.map((c) => {
    // A demo copy that lists competencies replaces the real ones; one that
    // does not keeps them (the copy then only edited other fields).
    const demoComps = demoCopies.get(c.id)?.technicalCompetencies ?? null;
    return {
      ...c,
      competencies: demoComps
        ? demoComps
            .filter((t) => t.technicalName)
            .map((t) => ({ name: t.technicalName, proficiency: t.currentProficiencyName || t.proficiencyName || null }))
        : techById.get(c.id) ?? [],
      history: historyById.get(c.id) ?? [],
    };
  });
}

// ─── Job profile matching ────────────────────────────────────────

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

async function findJobProfileForPosition(
  positionTitle: string,
  targetPositionId?: string
): Promise<JobProfileMatch | null> {
  const profiles = await query<{
    id: number;
    positionName: string | null;
    jobPurpose: string | null;
    extractedData: any;
  }>(
    `SELECT id, position_name as "positionName", job_purpose as "jobPurpose",
            extracted_data as "extractedData"
     FROM sync_job_profiles
     WHERE status = 'completed' AND position_name IS NOT NULL`
  );
  if (profiles.length === 0) return null;

  const target = normalizeTitle(positionTitle);

  const toMatch = (
    p: (typeof profiles)[number],
    matchTier: NonNullable<JobProfileMatch["matchTier"]>
  ): JobProfileMatch => {
    const raw = p.extractedData?.responsibilities;
    // Keep each responsibility WITH its paired success indicator (extracted as
    // `{ responsibility, successIndicator }` by the sync LLM). The flat string
    // list is derived from it for the technical/BERT paths that don't need the
    // indicator.
    const responsibilityDetails: ResponsibilityDetail[] = Array.isArray(raw)
      ? raw
          .map((r: any) => {
            if (typeof r === "string") {
              return { responsibility: r.trim(), successIndicator: null };
            }
            const responsibility = String(r?.responsibility ?? "").trim();
            const siRaw = r?.successIndicator ?? r?.success_indicator;
            const successIndicator =
              typeof siRaw === "string" && siRaw.trim().length > 0 ? siRaw.trim() : null;
            return { responsibility, successIndicator };
          })
          .filter((r: ResponsibilityDetail) => r.responsibility.length > 0)
      : [];
    const responsibilities = responsibilityDetails.map((r) => r.responsibility);
    // Education requirement lives in the extracted jobSpecification.education
    // ("Minimal pendidikan …"). Used verbatim for the exact-match short-circuit.
    const eduReqRaw = p.extractedData?.jobSpecification?.education;
    const educationRequirement =
      typeof eduReqRaw === "string" && eduReqRaw.trim().length > 0
        ? eduReqRaw.trim()
        : null;
    const rawChallenges = p.extractedData?.problemSolving?.challenges;
    const challenges: string[] = Array.isArray(rawChallenges)
      ? rawChallenges
          .map((c: any) => (typeof c === "string" ? c : String(c?.challenge ?? "")).trim())
          .filter((c: string) => c.length > 0)
      : [];
    return {
      id: p.id,
      matchTier,
      contentHash: createHash("sha256")
        .update(JSON.stringify(p.extractedData ?? null))
        .digest("hex"),
      positionName: p.positionName,
      jobPurpose: p.jobPurpose,
      responsibilities,
      responsibilityDetails,
      requiredCompetencies: parseRequiredCompetencies(p.extractedData),
      educationRequirement,
      challenges,
    };
  };

  // 0. Job Family sync pairing (position-incumbent → 1 profile). Preferred.
  if (targetPositionId) {
    const jpId = await findMatchedJobProfileId(targetPositionId);
    if (jpId != null) {
      const paired = profiles.find((p) => p.id === jpId);
      if (paired) {
        log("ahpTopsis.jobProfileFamilyMatch", { targetPositionId, jobProfileId: jpId });
        return toMatch(paired, "jfm");
      }
    }
  }

  // 1. Exact title match
  const exact = profiles.find(
    (p) => normalizeTitle(p.positionName!) === target
  );
  if (exact) return toMatch(exact, "exact");

  // 2. Substring match (either direction), longest profile name first
  const substring = profiles
    .filter((p) => {
      const name = normalizeTitle(p.positionName!);
      return name.includes(target) || target.includes(name);
    })
    .sort((a, b) => b.positionName!.length - a.positionName!.length)[0];
  if (substring) return toMatch(substring, "substring");

  // 3. Embedding similarity — best profile above a safety threshold
  try {
    const names = profiles.map((p) => p.positionName!);
    const vectors = await embedTexts([positionTitle, ...names]);
    const targetVec = vectors[0]!;
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < names.length; i++) {
      const sim = cosineSimilarity(targetVec, vectors[i + 1]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    // E5-family models produce systematically higher cosine similarities than
    // MiniLM-style models (unrelated texts often land ~0.75), so the "safe
    // match" threshold must be higher for them.
    const matchThreshold = /e5/i.test(config.embedding.model) ? 0.98 : 0.8;
    if (bestIdx >= 0 && bestSim >= matchThreshold) {
      log("ahpTopsis.jobProfileFuzzyMatch", {
        positionTitle,
        matched: names[bestIdx],
        similarity: Number(bestSim.toFixed(3)),
      });
      return toMatch(profiles[bestIdx]!, "embedding");
    }
  } catch (err) {
    log("ahpTopsis.jobProfileEmbedMatchFailed", { error: String(err) });
  }

  return null;
}

// ─── Aspect 1: Technical (BERT + mean pooling) ───────────────────

// The Hungarian max-assignment solver lives in ./hungarian.js. Re-exported here
// to keep this module's public surface unchanged.
export { hungarianMaxAssignment };

// ── Proficiency / competency-name normalization ─────────────────

/**
 * Map a free-text proficiency label to a 1..4 level (1=Basic … 4=Mastery).
 * Source data is messy — "BASIC KNOWLEDGE"/"Novice", "INTERMEDIATE",
 * "ADVANCE"/"Advanced", "MASTERY"/"Expert" — and "#N/A"/"Not Assessed"/null
 * map to null (unknown). Callers default unknown to level 1 (conservative).
 */
export function proficiencyToLevel(value: string | null | undefined): number | null {
  if (value == null) return null;
  const v = String(value).toUpperCase().trim();
  if (!v || v === "#N/A" || v === "NOT ASSESSED" || v === "-") return null;
  if (v.includes("MASTERY") || v.includes("EXPERT")) return 4;
  if (v.includes("ADVANCE")) return 3; // ADVANCE / ADVANCED
  if (v.includes("INTERMEDIATE")) return 2;
  if (v.includes("BASIC") || v.includes("NOVICE")) return 1;
  const num = v.match(/[1-4]/);
  return num ? parseInt(num[0], 10) : null;
}

/** Coerce a required-competency level (numeric 1..4 or a label) to 1..4; default 2. */
export function normalizeRequiredLevel(value: unknown): number {
  if (typeof value === "number" && value >= 1 && value <= 4) return Math.round(value);
  const s = String(value ?? "").trim();
  const num = s.match(/[1-4]/);
  if (num) return parseInt(num[0], 10);
  return proficiencyToLevel(s) ?? 2;
}

/** Canonical competency name for matching (case/&/punctuation-insensitive). */
function normalizeCompName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Required technical competencies (with target level) from a job profile's
 * extracted_data.technicalCompetencies — shape [{ level: 1..4, competency }]
 * (also tolerates a bare string or {name}/{technicalName}).
 */
export function parseRequiredCompetencies(extractedData: any): RequiredCompetency[] {
  const raw = extractedData?.technicalCompetencies;
  if (!Array.isArray(raw)) return [];
  const out: RequiredCompetency[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) out.push({ name, level: 2 });
    } else if (item && typeof item === "object") {
      const name = String(item.competency ?? item.name ?? item.technicalName ?? "").trim();
      if (!name) continue;
      out.push({ name, level: normalizeRequiredLevel(item.level ?? item.targetProficiency) });
    }
  }
  return out;
}

// ── Per-level embedding lookups (precomputed in Postgres) ───────

function parseVector(s: string): number[] | null {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a.map(Number) : null;
  } catch {
    return null;
  }
}

/**
 * Bulk-load the cumulative per-(code, level) embeddings for a set of
 * "code:level" keys from kamus_kompetensi_level_embed. Degrades to an empty map
 * when the table isn't present (→ exact-match-only scoring still works).
 */
async function loadLevelVectors(keys: Set<string>): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (keys.size === 0) return out;
  const codes = Array.from(new Set(Array.from(keys).map((k) => k.split(":")[0]!)));
  const rows = await vectorQuery<{ code: string; level: number; embedding: string | null }>(
    `SELECT code, level, embedding::text AS embedding
     FROM kamus_kompetensi_level_embed
     WHERE code = ANY($1::text[])`,
    [codes]
  ).catch(() => [] as { code: string; level: number; embedding: string | null }[]);
  for (const r of rows) {
    if (r.embedding == null) continue;
    const vec = parseVector(r.embedding);
    if (vec) out.set(`${r.code}:${r.level}`, vec);
  }
  return out;
}

/**
 * Run-scoped cache of cumulative level embeddings. The technical aspect and the
 * career competency fallback both need them, for overlapping but different
 * competency sets discovered at different points in the run, so codes are
 * fetched once and reused instead of one bulk load per aspect.
 */
/**
 * Everything about the embedding corpus one run measures against: the level
 * vectors themselves, and the similarity anchors derived from that same corpus.
 * They travel together because they must agree — anchors describe the very
 * distribution these vectors form — and because a run has to score against ONE
 * fixed pair of anchors from start to finish even while another run executes
 * concurrently in the same process.
 */
type LevelVectorStore = {
  /** Fetch any level vectors these refs need that aren't cached yet. */
  ensure: (refs: CompetencyRef[]) => Promise<void>;
  get: (key: string) => number[] | undefined;
  anchors: TechnicalAnchors;
};

function createLevelVectorStore(anchors: TechnicalAnchors): LevelVectorStore {
  const map = new Map<string, number[]>();
  // loadLevelVectors fetches ALL levels of a code in one go, so a code that has
  // already been fetched never needs another round trip — even for a level that
  // simply has no row.
  const fetchedCodes = new Set<string>();
  return {
    anchors,
    async ensure(refs) {
      const missing = new Set<string>();
      for (const r of refs) {
        if (r.code && !fetchedCodes.has(r.code)) missing.add(`${r.code}:${r.level}`);
      }
      if (missing.size === 0) return;
      const loaded = await loadLevelVectors(missing);
      for (const [k, v] of loaded) map.set(k, v);
      for (const k of missing) fetchedCodes.add(k.split(":")[0]!);
    },
    get: (key) => map.get(key),
  };
}

// ── Technical-competency matching (per the methodology spec) ─────

/** One required-competency column's outcome after Hungarian assignment. */
export type TechnicalPair = {
  required: { name: string; level: number; code: string | null };
  candidate: { name: string; level: number; code: string | null } | null;
  /**
   * exact  = identity, same literal name.
   * code   = identity, different spellings resolved to one kamus code.
   * semantic  = paired by embedding similarity in the Hungarian stage.
   * unmatched = measured, genuinely nothing covers it.
   * unmeasurable = the column could never be scored (no kamus code AND no
   *   candidate shares its identity key), so it is EXCLUDED from the divisor
   *   rather than counted as a zero every candidate shares.
   */
  matchType: "exact" | "code" | "semantic" | "unmatched" | "unmeasurable";
  /** Cell value used in the sum: sim′ × levelFactor (see competencyCell). */
  value: number;
  /**
   * The RESCALED similarity this pair was credited with (0..1): 1 for an exact
   * name match, else the cosine stretched onto 0..1 by the technical anchors.
   */
  similarity: number | null;
  /** Pre-rescale cosine, so the drill-down can show what it came from. */
  similarityRaw: number | null;
  /** The level term applied (0..1.75). 1 when the candidate's level is unknown. */
  levelFactor: number;
  /**
   * TRUE when the candidate's proficiency could not be read (NULL / "#N/A" /
   * "NOT ASSESSED"), so no level gap could be computed and levelFactor was left
   * neutral. Reported rather than scored as a shortfall — an unknown is not a
   * finding, and ~17% of candidate_technical_competencies rows are unreadable.
   */
  levelUnknown: boolean;
};

export type TechnicalDetail = {
  /** 0..100. Saturated — see matchCompetencySets's return site. */
  score: number;
  /** `score` / 100, i.e. the saturated mean. The TOPSIS input. */
  normalized: number;
  /**
   * The mean BEFORE saturation (0..1.75). Equals `normalized` for everyone who
   * did not overshoot the requirements; above 1 it says by how much, which is
   * the only place that surplus survives as a number.
   */
  normalizedRaw: number;
  requiredCount: number; // M
  /** M minus unmeasurable columns — the divisor `normalized` actually used. */
  effectiveRequiredCount: number;
  candidateCount: number; // N
  /** Pairs whose levelFactor was left neutral because the level was unreadable. */
  levelUnknownPairs: number;
  /** Required competencies nothing could ever score (excluded from the divisor). */
  unmeasurableCount: number;
  /** Pairs settled by identity (exact + code) before the similarity stage. */
  identityPairs: number;
  /** Anchors this run stretched semantic cosines with (for the drill-down). */
  simFloor: number;
  simCeil: number;
  /** One entry per required competency (length M). */
  pairs: TechnicalPair[];
  /**
   * Candidate competencies Hungarian left UNPAIRED when N>M (only min(N,M) can
   * pair). They contribute 0 to the score but are surfaced for full visibility
   * of the candidate's competency inventory vs the required set.
   */
  surplusCandidates: { name: string; level: number; code: string | null }[];
  /** Which tier produced the reference set — see resolveTargetRequiredSet. */
  requiredSource: RequiredSource;
  /** Human-readable provenance of the reference set (shown in run diagnostics). */
  requiredSourceDetail: string | null;
};

// ── Shared competency matcher ───────────────────────────────────
//
// The SAME matcher serves two callers, so the fallback paths are not an
// approximation of the technical aspect — they are literally it:
//   • Aspect 1 (technical)   — candidate competencies × target required set.
//   • Career fallback        — the INCUMBENT competencies of a history position
//                              that has no job profile × the same target
//                              required set (position vs position).

/** A competency prepared for matching: display name, level 1..4, kamus code. */
export type CompetencyRef = {
  name: string;
  level: number;
  code: string | null;
  norm: string;
  /**
   * FALSE only when `level` is a stand-in for a proficiency that could not be
   * read. Absent/true means the level is a real statement. Tracked on the
   * CANDIDATE side only: a required level always comes from a job profile or
   * `targetLevelOf`, both of which yield a real number, whereas a candidate's
   * `current_proficiency_name` is frequently NULL / "#N/A" / "NOT ASSESSED".
   */
  levelKnown?: boolean;
};

/** A blank matcher trace for `matchCompetencySets` to fill. */
function emptyMatchTrace(): CompetencyMatchTrace {
  return {
    identity: [],
    openReq: [],
    openHeld: [],
    cellRaw: [],
    assignment: [],
    measurable: [],
    weights: [],
    weightedSum: 0,
    weightTotal: 0,
    normalizedRaw: 0,
    normalized: 0,
  };
}

function toCompetencyRefs(
  items: RequiredCompetency[],
  resolveCode: (name: string) => string | null
): CompetencyRef[] {
  return items.map((r) => ({
    name: r.name,
    level: r.level,
    code: resolveCode(r.name),
    norm: normalizeCompName(r.name),
  }));
}

/** One cell of the N×M matrix, with the parts kept for the drill-down. */
export type CompetencyCell = {
  value: number;
  /** Rescaled similarity credited (0..1); 1 for an exact name match. */
  similarity: number;
  /** Raw cosine before rescaling; null for an exact match (no cosine involved). */
  similarityRaw: number | null;
  levelFactor: number;
  levelUnknown: boolean;
};

/**
 * One cell of the N×M matrix: `sim′ × levelFactor`, one formula for both
 * branches, where an exact name match simply means sim′ = 1.
 *
 * For a SEMANTIC pair, sim′ is the cosine of the two competencies' cumulative
 * level embeddings stretched onto a true 0..1 by the technical anchors
 * (config.ahpTopsis.technical). The raw cosine is not a percentage: measured
 * over this dictionary's full census, every competency has some OTHER competency
 * sitting at ~0.72–0.86, so the raw value scored a wholly wrong pairing at 72–86
 * points. See config.ts for how the anchors were derived.
 *
 * The level term is applied to semantic pairs too, which is the whole point of
 * this function's shape: the cumulative level embeddings barely encode level at
 * all. Measured on this corpus, the same competency at level 1 vs level 4 sits
 * at cosine 0.958 and Advance vs Mastery at 0.997, while moving to a DIFFERENT
 * competency drops it to ~0.571. Identity outweighs level by roughly 10×, so
 * cosine alone cannot see a proficiency gap — and being symmetric it could not
 * tell the direction of one even if it could.
 */
function competencyCell(
  cand: CompetencyRef,
  req: CompetencyRef,
  vectors: LevelVectorStore,
  isIdentity: boolean
): CompetencyCell {
  const levelKnown = cand.levelKnown !== false;

  if (isIdentity) {
    // Identity needs no embedding at all: the two ARE the same competency, so
    // the only open question is the level gap. sim′ = 1 by construction.
    const levelFactor = competencyLevelFactor(cand.level, req.level, true, levelKnown);
    return {
      value: levelFactor,
      similarity: 1,
      similarityRaw: null,
      levelFactor,
      levelUnknown: !levelKnown,
    };
  }

  const cv = cand.code ? vectors.get(`${cand.code}:${cand.level}`) : undefined;
  const rv = req.code ? vectors.get(`${req.code}:${req.level}`) : undefined;
  if (!cv || !rv) {
    return {
      value: 0,
      similarity: 0,
      similarityRaw: null,
      levelFactor: 0,
      levelUnknown: !levelKnown,
    };
  }

  const raw = Math.max(0, cosineSimilarity(cv, rv));
  const similarity = rescaleTechnicalSimilarity(raw, vectors.anchors);
  const levelFactor = competencyLevelFactor(cand.level, req.level, false, levelKnown);
  return {
    value: similarity * levelFactor,
    similarity,
    similarityRaw: raw,
    levelFactor,
    levelUnknown: !levelKnown,
  };
}

export type CompetencySetMatch = {
  /**
   * Σ pair.value / M, SATURATED at 1 — a true 0..1, which is what every caller
   * treats it as. See the return site for why the bound lives there.
   */
  normalized: number;
  /**
   * The same mean before saturation, 0..LEVEL_FACTOR_CEILING (1.75). Above 1
   * means the candidate is past the bar on enough identity pairs to overshoot
   * it; that is a real finding and worth reporting, but it is not a higher
   * score. Diagnostics only — never a TOPSIS input.
   */
  normalizedRaw: number;
  requiredCount: number; // M
  /** M minus the unmeasurable columns — the divisor actually used. */
  effectiveRequiredCount: number;
  candidateCount: number; // N
  pairs: TechnicalPair[];
  surplusCandidates: { name: string; level: number; code: string | null }[];
  /** Assigned pairs whose level term was left neutral (level unreadable). */
  levelUnknownPairs: number;
  /** Required competencies nothing could ever score (dropped from the divisor). */
  unmeasurableCount: number;
  /** Pairs settled by identity (exact + code) before Hungarian ran. */
  identityPairs: number;
  /**
   * TRUE when `normalized` is an IDF-WEIGHTED mean rather than a plain one — i.e.
   * the caller passed `weightFor`. Only the career fallback does; see
   * competency-idf.ts for why the technical aspect deliberately does not.
   */
  idfWeighted: boolean;
};

/**
 * Hungarian one-to-one max-total assignment between two competency sets.
 * Each required competency pairs with exactly one held competency; N>M leaves
 * surplus held competencies unpaired (contributing 0, surfaced separately),
 * N<M leaves required columns unmatched (contributing 0).
 *
 * The solver in ./hungarian.js is a true Kuhn–Munkres optimum (verified against
 * exhaustive brute force over every shape up to 6×6, including ties, zeros and
 * the 0..1.75 surplus range) — this is a global maximum, not a greedy pass.
 */
export function matchCompetencySets(
  held: CompetencyRef[],
  required: CompetencyRef[],
  vectors: LevelVectorStore,
  /**
   * OPTIONAL per-requirement weight for the final mean — the IDF term. Absent
   * means every requirement weighs 1, which is the historical behaviour and the
   * one the TECHNICAL aspect keeps: there, a common competency being common does
   * not make missing it forgivable. The CAREER fallback passes it, because there
   * the question is "is this the same kind of job", and a competency 93% of job
   * profiles list cannot answer that. See competency-idf.ts.
   *
   * Note it weights the MEAN only — never the Hungarian matrix. Weighting the
   * cells would change WHICH competency pairs with which, letting a rare
   * requirement steal the held competency that genuinely belonged to a common
   * one, and the drill-down would then show a pairing nobody can defend.
   */
  weightFor?: (required: CompetencyRef) => number,
  /**
   * OPTIONAL out-parameter for the run trace (drizzle/0092): filled with the
   * identity pairs, the open sets, the raw cosine of EVERY Hungarian cell (not
   * only the chosen ones — verifying an assignment needs the alternatives), the
   * assignment, the measurable flags and the weights. Filling it reads values
   * this function computes anyway; it changes no number.
   */
  trace?: CompetencyMatchTrace
): CompetencySetMatch {
  const M = required.length;
  const N = held.length;

  // ── Stage 1: IDENTITY. Not optimised — discovered. ──────────────
  //
  // Two competencies that resolve to the same kamus code ARE the same
  // competency; there is nothing for an optimiser to decide. Leaving that to
  // Hungarian was actively wrong, because Hungarian maximises the SUM and will
  // trade a correct identity pair away whenever the total improves:
  //
  //   sel(A_cand→A_req) 0.00   sel(A_cand→B_req) 0.60
  //   sel(Z→A_req)      0.20   sel(Z→B_req)      0.30
  //   A→A,Z→B = 0.30   but   A→B,Z→A = 0.80  ← wins
  //
  // and the candidate's own "A" ends up reported as covering "B". Under-levelled
  // identity pairs were the usual trigger, since a low-value cell has no pull.
  //
  // Identity key: the kamus code when there is one, else the normalized name.
  // Namespaced so a competency literally named like a code cannot collide. The
  // name fallback is what keeps a pair like "SHE Management" — absent from the
  // kamus, spelled identically on both sides — matching as it always did.
  const identityKey = (r: CompetencyRef) => (r.code ? `C:${r.code}` : `N:${r.norm}`);

  // Best held competency per key. Duplicates are a data artefact (one candidate
  // row and five job profiles in this deployment); highest level wins, mirroring
  // `unionMaxLevel`, which already resolves the same clash for incumbent sets.
  const heldByKey = new Map<string, number>();
  held.forEach((cand, i) => {
    const key = identityKey(cand);
    const prev = heldByKey.get(key);
    if (prev === undefined || cand.level > held[prev]!.level) heldByKey.set(key, i);
  });

  const pairedReqToHeld = new Map<number, number>();
  const takenHeld = new Set<number>();
  required.forEach((req, rj) => {
    const ci = heldByKey.get(identityKey(req));
    // A held competency serves exactly one required column. When a profile lists
    // the same competency twice, the second occurrence finds nothing left and
    // falls through to stage 2 — honest, since there is no second competency to
    // cover it.
    if (ci === undefined || takenHeld.has(ci)) return;
    pairedReqToHeld.set(rj, ci);
    takenHeld.add(ci);
  });

  // ── Stage 2: SIMILARITY. Hungarian over what identity did not settle. ──
  const openReq = required.map((_, rj) => rj).filter((rj) => !pairedReqToHeld.has(rj));
  const openHeld = held.map((_, ci) => ci).filter((ci) => !takenHeld.has(ci));

  const subCells: CompetencyCell[][] = openHeld.map((ci) =>
    openReq.map((rj) => competencyCell(held[ci]!, required[rj]!, vectors, false))
  );
  const subMatrix = subCells.map((row) => row.map((c) => c.value));
  const subAssignment =
    openHeld.length > 0 && openReq.length > 0 ? hungarianMaxAssignment(subMatrix) : [];

  // subAssignment indexes into the SUB matrix; map back to the original indices.
  const simCellByReq = new Map<number, CompetencyCell>();
  for (const [subCi, subRj] of subAssignment) {
    const rj = openReq[subRj]!;
    const ci = openHeld[subCi]!;
    pairedReqToHeld.set(rj, ci);
    takenHeld.add(ci);
    simCellByReq.set(rj, subCells[subCi]![subRj]!);
  }

  // ── Assemble ────────────────────────────────────────────────────
  const pairs: TechnicalPair[] = required.map((req, rj) => {
    const ci = pairedReqToHeld.get(rj);
    if (ci === undefined) {
      return {
        required: { name: req.name, level: req.level, code: req.code },
        candidate: null,
        matchType: "unmatched",
        value: 0,
        similarity: null,
        similarityRaw: null,
        levelFactor: 0,
        levelUnknown: false,
      };
    }
    const cand = held[ci]!;
    const simCell = simCellByReq.get(rj);
    const cell = simCell ?? competencyCell(cand, req, vectors, true);
    return {
      required: { name: req.name, level: req.level, code: req.code },
      candidate: { name: cand.name, level: cand.level, code: cand.code },
      // "exact" = the two names are literally the same. "code" = different
      // spellings the resolver established as one kamus entry. Both are
      // identity; the distinction is only so the drill-down can show WHY.
      matchType: simCell ? "semantic" : cand.norm === req.norm ? "exact" : "code",
      value: cell.value,
      similarity: cell.similarity,
      similarityRaw: cell.similarityRaw,
      levelFactor: cell.levelFactor,
      levelUnknown: cell.levelUnknown,
    };
  });

  const surplusCandidates = held
    .map((cand, i) => ({ cand, i }))
    .filter(({ i }) => !takenHeld.has(i))
    .map(({ cand }) => ({ name: cand.name, level: cand.level, code: cand.code }));

  // A required competency is UNMEASURABLE when nothing could have scored it: no
  // kamus code (so no level vector, so every similarity cell in its column is 0)
  // AND no held competency shares its identity key. That is the job profile
  // asking for something the dictionary does not define — "Leadership",
  // "Communication", "Problem Solving" are behavioural, not technical entries.
  //
  // Such a column is guaranteed 0 for EVERY candidate, so leaving it in the
  // divisor depresses everyone's Σ/M by the dictionary's incompleteness rather
  // than by anything about the candidates. It is excluded from M — the same rule
  // the engine already applies to a criterion nobody can be scored on — while
  // the pair is still returned, so the drill-down shows that the position
  // demands something unmeasurable instead of hiding the finding.
  const heldKeys = new Set(held.map(identityKey));
  const measurable = required.map(
    (req) => Boolean(req.code) || heldKeys.has(identityKey(req))
  );
  for (let rj = 0; rj < pairs.length; rj++) {
    if (!measurable[rj]) pairs[rj]!.matchType = "unmeasurable";
  }

  const effectiveM = measurable.filter(Boolean).length;

  // Weighted mean over the MEASURABLE columns. Unweighted is the same expression
  // with every w = 1, so there is one code path and no chance of the two drifting.
  // The weight is read from the REQUIRED side — it is a property of the
  // requirement's rarity, not of who happens to cover it.
  let weightedSum = 0;
  let weightTotal = 0;
  for (let rj = 0; rj < pairs.length; rj++) {
    if (!measurable[rj]) continue;
    const w = weightFor ? Math.max(0, weightFor(required[rj]!)) : 1;
    weightedSum += w * pairs[rj]!.value;
    weightTotal += w;
  }

  if (trace) {
    trace.identity = required
      .map((_, rj) => rj)
      .filter((rj) => pairedReqToHeld.has(rj) && !simCellByReq.has(rj))
      .map((rj) => [rj, pairedReqToHeld.get(rj)!] as [number, number]);
    trace.openReq = openReq;
    trace.openHeld = openHeld;
    trace.cellRaw = subCells.map((row) => row.map((c) => c.similarityRaw));
    trace.assignment = subAssignment.map(([subCi, subRj]) => [openHeld[subCi]!, openReq[subRj]!] as [number, number]);
    trace.measurable = measurable;
    trace.weights = required.map((req) => (weightFor ? Math.max(0, weightFor(req)) : 1));
    trace.weightedSum = weightedSum;
    trace.weightTotal = weightTotal;
  }

  // SATURATED at 1, so the aggregate is a true 0..1 no matter what the cells
  // did. A cell may reach LEVEL_FACTOR_CEILING (1.75) when an identity pair sits
  // above the level the job asked for, and the divisor is the requirement count
  // — so the mean could exceed 1 and the technical aspect could report 113 on a
  // scale documented as 0..100. (Measured: 6 of 4198 scored rows, all at 113.)
  //
  // The bound belongs HERE rather than at the aspect, because the surplus is
  // COMPENSATORY, not additive: over-qualification on one competency offsets a
  // shortfall on another, which is exactly what a weighted mean should let it
  // do, but it cannot make a candidate more than fully qualified. This
  // criterion asks "can this person do what the JD demands", and that question
  // saturates at "yes, all of it" — the surplus above that is a different
  // finding, and it is still reported per pair in `pairs[].levelFactor` and
  // `pairs[].value`, which the drill-down renders. Nothing is hidden; only the
  // aggregate is bounded.
  //
  // This is also the rule the OTHER consumer of this number already applied
  // locally: `applyCalibration` (career fallback) truncates the same surplus at
  // 1 so full coverage maps to the top of its band "and no further". Technical
  // was the one caller that did not, so the two disagreed about what full
  // coverage means. One rule at the source, not one per consumer.
  const normalized = weightTotal > 0 ? weightedSum / weightTotal : 0;
  if (trace) {
    trace.normalizedRaw = normalized;
    trace.normalized = Math.min(1, normalized);
  }

  return {
    normalized: Math.min(1, normalized),
    /**
     * The same mean BEFORE saturation, so a reader can tell "exactly meets every
     * requirement" (1.0) from "well past it" (up to 1.75) — the distinction the
     * over-qualification surplus exists to make, which the bounded number alone
     * cannot express.
     */
    normalizedRaw: normalized,
    requiredCount: M,
    effectiveRequiredCount: effectiveM,
    candidateCount: N,
    pairs,
    surplusCandidates,
    levelUnknownPairs: pairs.filter((p) => p.levelUnknown).length,
    unmeasurableCount: M - effectiveM,
    identityPairs: pairs.filter((p) => p.matchType === "exact" || p.matchType === "code").length,
    idfWeighted: Boolean(weightFor),
  };
}

// ── Incumbent-derived competency sets (fallback reference data) ──
//
// When a position has no job profile, the people who hold (or last held) it are
// the only remaining evidence of what it demands. sync_technical_competencies is
// that evidence: one row per (employee, competency) carrying BOTH the level the
// job demands and the level the person actually reached.

/** Full sync_technical_competencies row — every column the fallbacks can use. */
type SyncCompetencyRow = {
  employeeId: string;
  technicalName: string | null;
  proficiencyName: string | null;
  score: number | null;
  currentProficiencyName: string | null;
  currentScore: number | null;
  gap: number | null;
  positionId: string | null;
  gradeId: string | null;
  createDate: Date | null;
  modiDate: Date | null;
  isActive: boolean;
};

/** A raw competency score, when it sits on the 1..4 scale. */
function scoreToLevel(score: number | null): number | null {
  if (score == null || !Number.isFinite(Number(score))) return null;
  const n = Math.round(Number(score));
  return n >= 1 && n <= 4 ? n : null;
}

/**
 * The level the POSITION demands — not the level its holder reached.
 * `proficiency_name` / `score` are the job's target; `current_proficiency_name` /
 * `current_score` are the incumbent's attainment. A reference set built from the
 * attained columns would measure candidates against a person, and the bar would
 * drift with whoever happens to sit in the chair; this measures them against the
 * job. The attained columns are a last resort only when the target ones are empty.
 */
export function targetLevelOf(r: SyncCompetencyRow): number {
  return (
    proficiencyToLevel(r.proficiencyName) ??
    scoreToLevel(r.score) ??
    proficiencyToLevel(r.currentProficiencyName) ??
    scoreToLevel(r.currentScore) ??
    2
  );
}

/** Merge competency lists, keeping the highest level seen per competency name. */
export function unionMaxLevel(lists: { name: string; level: number }[][]): RequiredCompetency[] {
  const best = new Map<string, RequiredCompetency>();
  for (const list of lists) {
    for (const item of list) {
      const name = item.name.trim();
      const key = normalizeCompName(name);
      if (!name || !key) continue;
      const prev = best.get(key);
      if (!prev) best.set(key, { name, level: item.level });
      else if (item.level > prev.level) best.set(key, { name: prev.name, level: item.level });
    }
  }
  return Array.from(best.values());
}

/** Bulk-load every competency row for a set of employees (active AND historical). */
async function loadCompetencyRowsByEmployee(
  employeeIds: string[]
): Promise<Map<string, SyncCompetencyRow[]>> {
  const out = new Map<string, SyncCompetencyRow[]>();
  const ids = Array.from(new Set(employeeIds.map((e) => (e ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return out;
  // Historical rows (is_active = false) are deliberately INCLUDED: a stint held
  // years ago is described by the assessment that was current back then, which
  // the create_date window in selectCompetencyRows selects.
  const rows = await query<SyncCompetencyRow>(
    `SELECT employee_id as "employeeId", technical_name as "technicalName",
            proficiency_name as "proficiencyName", score,
            current_proficiency_name as "currentProficiencyName",
            current_score as "currentScore", gap,
            position_id as "positionId", grade_id as "gradeId",
            create_date as "createDate", modi_date as "modiDate",
            is_active as "isActive"
     FROM sync_technical_competencies
     WHERE TRIM(employee_id) = ANY($1::text[])`,
    [ids]
  ).catch(() => [] as SyncCompetencyRow[]);
  for (const r of rows) {
    if (!r.technicalName?.trim()) continue;
    const key = (r.employeeId ?? "").trim();
    const bucket = out.get(key) ?? [];
    bucket.push(r);
    out.set(key, bucket);
  }
  return out;
}

/** Which temporal tier produced a holder's competency list. */
export type CompetencyBasis = "position_column" | "create_date_window" | "active_all";

/**
 * Pick the rows describing what a holder was assessed on WHILE holding a given
 * position — most specific evidence first:
 *   1. position_column    — the row itself records that position_id (the
 *                           assessment was filed against the job). Unambiguous.
 *   2. create_date_window — the assessment was created during the holder's
 *                           tenure in the position.
 *   3. active_all         — no temporal evidence at all; use the currently
 *                           active assessment. Exact for a sitting incumbent,
 *                           an approximation for a past one (recorded as such).
 */
function selectCompetencyRows(
  rows: SyncCompetencyRow[],
  positionCode: string,
  window: { from: Date | null; to: Date | null },
  /**
   * Where an ONGOING window ends: the run's reference date, not the wall clock,
   * so a child run reads a stint's assessments as of the date its parent did
   * (FR-RR-07 e). Defaults to now, which is a root's reference date anyway.
   */
  asOf: Date = new Date()
): { comps: { name: string; level: number }[]; basis: CompetencyBasis; rows: SyncCompetencyRow[] } {
  const toComps = (list: SyncCompetencyRow[]) =>
    list
      .map((r) => ({ name: (r.technicalName ?? "").trim(), level: targetLevelOf(r) }))
      .filter((c) => c.name.length > 0);

  if (positionCode) {
    const byPosition = rows.filter((r) => normalizeCode(r.positionId) === positionCode);
    if (byPosition.length > 0) return { comps: toComps(byPosition), basis: "position_column", rows: byPosition };
  }

  if (window.from) {
    const from = new Date(window.from).getTime();
    const to = (
      window.to && !isOngoingTo(window.to) ? new Date(window.to) : asOf
    ).getTime();
    const inWindow = rows.filter((r) => {
      if (!r.createDate) return false;
      const t = new Date(r.createDate).getTime();
      return t >= from && t <= to;
    });
    if (inWindow.length > 0) {
      return { comps: toComps(inWindow), basis: "create_date_window", rows: inWindow };
    }
  }

  const active = rows.filter((r) => r.isActive);
  const chosen = active.length > 0 ? active : rows;
  return { comps: toComps(chosen), basis: "active_all", rows: chosen };
}

export type PositionHolder = {
  employeeId: string;
  companyId: string | null;
  positionCode: string;
  validFrom: Date | null;
  validTo: Date | null;
  isPrimary: boolean;
  active: boolean;
};

/**
 * Bulk-load every recorded holder of a set of position codes (one round trip).
 * The normalized comparison can't use the position_id index, so this is a scan —
 * acceptable because it runs ONCE per scoring run over the whole code set, not
 * per candidate or per stint.
 */
async function loadPositionHolders(
  positionCodes: string[],
  /**
   * The instant "active" is judged at. A child run passes its frozen reference
   * date (G-7): who held a stint's position is part of how that stint was
   * measured, and today's holders are not the parent's.
   */
  asOf: Date = new Date()
): Promise<Map<string, PositionHolder[]>> {
  const out = new Map<string, PositionHolder[]>();
  const codes = Array.from(new Set(positionCodes.map(normalizeCode).filter(Boolean)));
  if (codes.length === 0) return out;
  const rows = await query<{
    employeeId: string;
    companyId: string | null;
    positionId: string;
    isPrimary: boolean;
    validFrom: Date | null;
    validTo: Date | null;
  }>(
    `SELECT employee_id as "employeeId", company_id as "companyId",
            position_id as "positionId", primary_position as "isPrimary",
            valid_from as "validFrom", valid_to as "validTo"
     FROM sync_employee_positions
     WHERE UPPER(REGEXP_REPLACE(position_id, '[[:space:]]', '', 'g')) = ANY($1::text[])`,
    [codes]
  ).catch(
    () =>
      [] as {
        employeeId: string;
        companyId: string | null;
        positionId: string;
        isPrimary: boolean;
        validFrom: Date | null;
        validTo: Date | null;
      }[]
  );
  const now = asOf.getTime();
  for (const r of rows) {
    const code = normalizeCode(r.positionId);
    if (!code || !r.employeeId?.trim()) continue;
    const bucket = out.get(code) ?? [];
    bucket.push({
      employeeId: r.employeeId.trim(),
      companyId: r.companyId,
      positionCode: code,
      validFrom: r.validFrom,
      validTo: r.validTo,
      isPrimary: Boolean(r.isPrimary),
      active: isOngoingTo(r.validTo) || new Date(r.validTo as Date).getTime() >= now,
    });
    out.set(code, bucket);
  }
  return out;
}

/**
 * Which holders represent a position: the union of every ACTIVE holder (their
 * competency lists later merged at max level); if the position is vacant, the
 * single most recent past holder.
 *
 * `excludeEmployeeIds` drops the candidate being evaluated — without it, a stint
 * they still occupy would be matched against their own assessment and hand out a
 * free ~1.0 for a position we actually know nothing about.
 */
function pickHolders(
  all: PositionHolder[],
  companyId: string | null,
  excludeEmployeeIds: Set<string>
): PositionHolder[] {
  const company = normalizeCode(companyId);
  const scoped = company ? all.filter((h) => normalizeCode(h.companyId) === company) : all;
  // A stint whose own company has no record of the code falls back to any
  // company — pools can span business units and the code names the same job.
  const pool = scoped.length > 0 ? scoped : all;
  const usable = pool.filter((h) => !excludeEmployeeIds.has(h.employeeId.trim()));
  const active = usable.filter((h) => h.active);
  if (active.length > 0) return active;
  const past = usable
    .filter((h) => h.validTo != null)
    .sort((a, b) => new Date(b.validTo!).getTime() - new Date(a.validTo!).getTime());
  return past.length > 0 ? [past[0]!] : usable.slice(0, 1);
}

// ── Target reference (required-competency) set ──────────────────

/** Which tier produced the target's reference competency set. */
export type RequiredSource =
  | "profile"
  | "critical_position"
  | "incumbent"
  | "position_aggregate"
  | "none";

export type TargetRequiredSet = {
  required: RequiredCompetency[];
  source: RequiredSource;
  /** Human-readable provenance, surfaced in the run diagnostics. */
  detail: string | null;
  /** Employees whose assessments formed the set (incumbent tiers only). */
  employeeIds: string[];
};

/**
 * Resolve the reference competency set for the TARGET position, most
 * authoritative tier first:
 *   1. profile            — the job profile's technicalCompetencies (with level).
 *   2. critical_position  — the tenant-curated required list (level unknown → 2).
 *   3. incumbent          — the sitting incumbent's assessment, at the level the
 *                           JOB demands (proficiency_name / score).
 *   4. position_aggregate — every holder of the same position code, merged at
 *                           max level. Covers a brand-new incumbent whose own
 *                           assessment is still thin.
 * This one set is the reference for BOTH the technical aspect and the career
 * competency fallback, which is what makes the fallback the same measurement
 * rather than a lookalike.
 */
async function resolveTargetRequiredSet(
  position: PositionRow,
  jobProfile: JobProfileMatch | null,
  targetPositionCode: string | null,
  /** The run's reference date — when "active holder" is judged (tier 4). */
  asOf: Date = new Date(),
  /** Demo run (drizzle/0093): the provenance text names no NPK and no position code. */
  demo = false
): Promise<TargetRequiredSet> {
  const fromProfile = jobProfile?.requiredCompetencies ?? [];
  if (fromProfile.length > 0) {
    return {
      required: fromProfile,
      source: "profile",
      detail: `Job profile "${jobProfile?.positionName ?? "-"}" (${fromProfile.length} kompetensi).`,
      employeeIds: [],
    };
  }

  if (Array.isArray(position.requiredCompetencies)) {
    const fromPosition = position.requiredCompetencies
      .map((r: any) => ({ name: String(r?.technicalName ?? r?.name ?? "").trim(), level: 2 }))
      .filter((r: RequiredCompetency) => r.name.length > 0);
    if (fromPosition.length > 0) {
      return {
        required: fromPosition,
        source: "critical_position",
        detail: `Daftar kompetensi wajib pada posisi (${fromPosition.length} kompetensi, level target tidak tercatat → diasumsikan Intermediate).`,
        employeeIds: [],
      };
    }
  }

  const code = normalizeCode(targetPositionCode);

  // Tier 3 — the sitting incumbent.
  const holderId = (position.holderEmployeeId ?? "").trim();
  if (holderId) {
    const rows = (await loadCompetencyRowsByEmployee([holderId])).get(holderId) ?? [];
    const picked = selectCompetencyRows(rows, code, { from: null, to: null });
    const required = unionMaxLevel([picked.comps]);
    if (required.length > 0) {
      return {
        required,
        source: "incumbent",
        detail: `Kompetensi incumbent ${
          demo ? (position.holderName && position.holderName !== holderId ? position.holderName : "pemegang jabatan") : position.holderName ?? holderId
        } (${required.length} kompetensi, level target jabatan dari proficiency_name/score, basis ${picked.basis}).`,
        employeeIds: [holderId],
      };
    }
  }

  // Tier 4 — every holder of the position code.
  if (code) {
    const holders = pickHolders(
      (await loadPositionHolders([code], asOf)).get(code) ?? [],
      null,
      new Set()
    );
    if (holders.length > 0) {
      const rowsById = await loadCompetencyRowsByEmployee(holders.map((h) => h.employeeId));
      const required = unionMaxLevel(
        holders.map(
          (h) =>
            selectCompetencyRows(
              rowsById.get(h.employeeId) ?? [],
              code,
              { from: h.validFrom, to: h.validTo },
              asOf
            ).comps
        )
      );
      if (required.length > 0) {
        return {
          required,
          source: "position_aggregate",
          detail: `Gabungan kompetensi ${holders.length} pemegang posisi ${demo ? "ini" : code} (level maksimum antar-pemegang, ${required.length} kompetensi).`,
          employeeIds: holders.map((h) => h.employeeId),
        };
      }
    }
  }

  return {
    required: [],
    source: "none",
    detail:
      "Tidak ada acuan kompetensi: job profile, daftar kompetensi posisi, incumbent, dan pemegang posisi semuanya kosong.",
    employeeIds: [],
  };
}

/**
 * Technical-competency aspect per the methodology spec:
 *  1. Candidate competencies (N) × the target's reference competencies (M).
 *  2. Build the N×M matrix. ONE formula for both branches — `sim′ × levelFactor`,
 *     where an exact name match simply means sim′ = 1:
 *       • sim′  — exact: 1. Semantic: the cosine of the two competencies'
 *                 cumulative level embeddings (kamus_kompetensi_level_embed)
 *                 STRETCHED onto a true 0..1 by fixed anchors
 *                 (config.ahpTopsis.technical). A raw cosine is not a
 *                 percentage: on this dictionary's full census every competency
 *                 has some other competency at ~0.72–0.86, so the raw value
 *                 scored a wholly wrong pairing at 72–86 points.
 *       • levelFactor — c ≥ r: 1, plus a bounded over-qualification surplus
 *                 (ceiling 1.75) for an IDENTITY match only. c < r:
 *                 1 − (r−c)/TECHNICAL_LEVEL_GAP_SPAN (span 4), an ordinal
 *                 reading — NOT a ratio, which would assert Mastery is "twice"
 *                 Intermediate. Unreadable candidate level → 1 (neutral) and the
 *                 pair is flagged, never scored as a shortfall.
 *                 See competency-level.ts; this comment previously described a
 *                 `min(c/r, …)` term that the shared helper does not compute.
 *     The level term applies to SEMANTIC pairs too, and that is the point: the
 *     cumulative embeddings barely encode level (same competency at level 1 vs 4
 *     = cosine 0.958; Advance vs Mastery = 0.997; a different competency = 0.571),
 *     so cosine alone can neither see a proficiency gap nor tell its direction.
 *     Because Hungarian maximises over these cells, a level-blind cell also
 *     mis-ASSIGNED — pairing a level-1 holding to a level-4 requirement costs
 *     nothing when only identity moves the number.
 *  3. Hungarian one-to-one assignment maximizing total value; each required
 *     competency pairs with exactly one candidate. N>M → surplus candidates
 *     unpaired (surfaced via surplusCandidates, contribute 0); N<M → unmatched
 *     required columns contribute 0.
 *  4. Score = min(Σ(M column values) / M, 1) × 100 — a true 0..100.
 *     The saturation is load-bearing, not cosmetic. A cell may reach 1.75 when
 *     an identity pair sits above the level the job asked for, while the divisor
 *     is the requirement count, so the unbounded mean could exceed 1 and this
 *     aspect reported 113 on a scale documented as 0..100 — the value that then
 *     fed TOPSIS, `analysis_results`, and the drill-down alike. The surplus is
 *     COMPENSATORY: it lets over-qualification on one competency offset a
 *     shortfall on another, which is what a mean should do, but it cannot make
 *     somebody more than fully qualified, because the question here is "can this
 *     person do what the JD demands" and that saturates at "yes, all of it".
 *     The overshoot is still reported — `normalizedRaw` on the detail, and
 *     `levelFactor`/`value` per pair — so nothing is hidden; see
 *     `matchCompetencySets`, and note the career fallback's `applyCalibration`
 *     already truncated the identical surplus at 1 for the identical reason.
 * Returns both the TOPSIS input scores and a per-candidate matching detail
 * (persisted for the Progress Running visualization).
 */
async function scoreTechnicalAspect(
  candidates: AhpCandidate[],
  position: PositionRow,
  target: TargetRequiredSet,
  targetRefs: CompetencyRef[],
  resolveCode: (name: string) => string | null,
  vectors: LevelVectorStore,
  onProgress?: (done: number, total: number) => Promise<void>,
  /** Run trace (drizzle/0092): per-candidate held set + matcher internals. */
  traceOut?: Map<string, TechnicalCandidateTrace>
): Promise<{ scores: Map<string, number>; details: Map<string, TechnicalDetail> }> {
  const scores = new Map<string, number>();
  const details = new Map<string, TechnicalDetail>();

  if (targetRefs.length === 0) {
    // Nothing to score against — everyone gets 0, and the criterion is dropped
    // from the TOPSIS matrix by the caller (documented, not silent).
    for (const c of candidates) {
      scores.set(c.id, 0);
      details.set(c.id, {
        score: 0,
        normalized: 0,
        normalizedRaw: 0,
        requiredCount: 0,
        effectiveRequiredCount: 0,
        candidateCount: c.competencies.length,
        levelUnknownPairs: 0,
        unmeasurableCount: 0,
        identityPairs: 0,
        // The anchors THIS run stretched with — the run's resolved pair, not
        // the config fallback this used to record (which only applies when the
        // kamus census is unavailable), so a stored row describes its own scale.
        simFloor: vectors.anchors.simFloor,
        simCeil: vectors.anchors.simCeil,
        pairs: [],
        surplusCandidates: [],
        requiredSource: target.source,
        requiredSourceDetail: target.detail,
      });
    }
    if (onProgress) await onProgress(candidates.length, candidates.length);
    log("ahpTopsis.technicalNoRequirements", { position: position.title });
    return { scores, details };
  }

  // Candidate side uses the ATTAINED level (current_proficiency_name, resolved in
  // loadAhpCandidates) — what the person actually has, against what the job wants.
  const candRefs = new Map<string, CompetencyRef[]>();
  for (const c of candidates) {
    candRefs.set(
      c.id,
      c.competencies.map((k) => {
        // An unreadable proficiency (NULL / "#N/A" / "NOT ASSESSED") still needs
        // SOME level to look a vector up with, but it must not be scored as a
        // shortfall — `levelKnown: false` keeps the level term neutral and marks
        // the pair so the drill-down says "belum diasesmen" rather than showing
        // a gap the data never claimed.
        const resolved = proficiencyToLevel(k.proficiency);
        return {
          name: k.name,
          level: resolved ?? 1,
          code: resolveCode(k.name),
          norm: normalizeCompName(k.name),
          levelKnown: resolved != null,
        };
      })
    );
  }

  await vectors.ensure([...targetRefs, ...Array.from(candRefs.values()).flat()]);

  let done = 0;
  for (const c of candidates) {
    const held = candRefs.get(c.id)!;
    const matchTrace = traceOut ? emptyMatchTrace() : undefined;
    const m = matchCompetencySets(held, targetRefs, vectors, undefined, matchTrace);
    // `m.normalized` is saturated at 1 by matchCompetencySets, so this is a
    // true 0..100. Kept as a rounded int because that is what feeds TOPSIS,
    // `analysis_results.score` and the readiness bands.
    const score = Math.round(m.normalized * 100);
    if (traceOut && matchTrace) {
      traceOut.set(c.id, {
        required: targetRefs.map((r) => ({ name: r.name, code: r.code, norm: r.norm, level: r.level })),
        held: held.map((h, i) => ({
          name: h.name,
          code: h.code,
          norm: h.norm,
          level: h.level,
          levelKnown: h.levelKnown !== false,
          proficiencyRaw: c.competencies[i]?.proficiency ?? null,
        })),
        match: matchTrace,
        score,
      });
    }

    scores.set(c.id, score);
    details.set(c.id, {
      score,
      normalized: m.normalized,
      normalizedRaw: m.normalizedRaw,
      requiredCount: m.requiredCount,
      effectiveRequiredCount: m.effectiveRequiredCount,
      candidateCount: m.candidateCount,
      levelUnknownPairs: m.levelUnknownPairs,
      unmeasurableCount: m.unmeasurableCount,
      identityPairs: m.identityPairs,
      // The run's resolved anchors — see the no-requirements branch above.
      simFloor: vectors.anchors.simFloor,
      simCeil: vectors.anchors.simCeil,
      pairs: m.pairs,
      surplusCandidates: m.surplusCandidates,
      requiredSource: target.source,
      requiredSourceDetail: target.detail,
    });

    done += 1;
    if (onProgress && (done % 5 === 0 || done === candidates.length)) {
      await onProgress(done, candidates.length);
    }
  }

  return { scores, details };
}

// ─── Aspect 2: Career relevance ──────────────────────────────────
//
// Methodology (job-profile document embeddings, per the spec):
//   1. Take the candidate's full position history + current position
//      (candidate_position_history, enriched from sync_employee_positions).
//   2. Normalize each stint's duration to YEARS — whole calendar months / 12
//      (days short of a full month are floored away).
//   3. Pair every history position with a job profile using the SAME matcher as
//      the Job Family Sync report, tried in order (mirrors getJobFamilyMatchReport):
//        a. filename  — position_id == leading code of a job-profile file_name.
//        b. jfm       — job_family_matches pairing (position_id → job_profile_id).
//        c. exact     — normalized title == a job-profile position_name.
//        d. embedding — title ↔ position_name cosine similarity > 0.98 (E5).
//      The matched profile's DOCUMENT embedding is then read from job_profile_embed.
//   4. Resolve the TARGET position's job profile the same way (findMatchedJobProfileId
//      first — incumbent/position pairing — then the filename/exact/embedding tiers).
//   5/6. Build the 1×M position-similarity row (M = history stints) as the cosine
//      similarity between the target DOCUMENT embedding and each stint's embedding.
//   7. Fallback (positions WITHOUT a job profile): a stint that resolves to no
//      profile — or every stint, when the TARGET has no profile document — is
//      scored by matching the INCUMBENT competencies of that position against
//      the target's reference competency set, with the very same Hungarian
//      matcher the technical aspect uses. Position vs position, so it measures
//      the same thing the document path does rather than duplicating the
//      technical aspect. Two things make it honest about being weaker evidence
//      than a real document, and both were added because it was neither:
//        • Coverage is IDF-WEIGHTED (competency-idf.ts). Unweighted, the mean was
//          dominated by competencies nearly every profile lists — SOFTWARE
//          APPLICATION OPERATION appears on 92.7% of 275 JDs — so any manager
//          covered ~45% of any position's requirements for being a manager.
//        • The band is CAPPED at careerFallback.cap (0.5) of the measured scale,
//          not the run's own p5..p95. That old range made coverage 1.0 land on the
//          best document cosine in the run, i.e. exactly the claim "this IS the
//          job", which is the opposite of what its comment promised.
//      PINNED to the base run's band on an incremental run, for the same reason
//      the depth yardstick is: the mapping from coverage to similarity must not
//      differ between the candidates carried over and the ones just added.
//   8. Whatever still cannot be resolved is reported, never silently dropped:
//      per-stint status + a run-level coverage breakdown (CareerDetail /
//      CareerRunInfo). A stint can fail the fallback for three distinct reasons
//      and each names different data to fix, so they are counted separately
//      (CareerUnscoredReason) rather than reported as one cause. Career is only
//      zeroed — and the criterion dropped from TOPSIS — when neither a target
//      document NOR a reference competency set exists.
//   9. RESCALE. A raw cosine is not a percentage: unrelated job-profile documents
//      already sit near config.ahpTopsis.career.simFloor and even near-identical
//      ones rarely clear simCeil, so the raw value used the top ~40 points of the
//      scale and nothing below. Every stint similarity — document AND calibrated
//      fallback, so both stay commensurate — is stretched onto a true 0..1:
//          sim' = clamp((sim − simFloor) / (simCeil − simFloor), 0, 1)
//      The anchors are FIXED within and across runs, never per-run percentiles,
//      so a career score means the same thing across runs and across positions —
//      but they are MEASURED, by three independent estimators whose median wins
//      (career-anchors.ts). See there for why "p25 of arbitrary pairs" alone put
//      the zero point where 90% of pairs are unrelated.
//  10. ACCUMULATE, don't average. The old value was Σ(sim×yr)/Σ(yr over scored
//      stints) — a duration-WEIGHTED AVERAGE, in which duration cancels out. One
//      six-month stint at sim' 0.5 scored exactly the same as a twenty-year,
//      five-stint career at sim' 0.5, and a thin history was in fact advantaged
//      because it had no weaker stints to dilute it. Relevant experience is now
//      accumulated on two axes, each saturating at its own target, and each stint
//      decayed by how long ago it ended:
//          rec_i    = exp(−δ × years since stint i ended)     (1 while ongoing)
//          effYears = Σ(sim'_i × years_i × rec_i)
//          effRows  = Σ(sim'_i × rec_i)
//          depthYears = sat(effYears / T_years)
//          depthRows  = sat(effRows  / T_rows)
//          normalized = depthYears × (1 − w + w × depthRows)  ×100 = the score
//      Unscored stints contribute 0 to both sums, so poor coverage costs real
//      points instead of being quietly excluded from a denominator.
//
//      δ is a human-capital DEPRECIATION rate (~4.3%/yr in the literature), not
//      a tuned knob. Nothing decayed before: a stint that ended in 2006 counted
//      exactly as much as the one the candidate holds today, and `isCurrent` was
//      recorded without ever reaching the score.
//
//      DEPTH CARRIES, BREADTH MODULATES (w = career.breadthWeight, 0.25). This
//      replaced `min(depthYears, depthRows)`, whose second half was a bug wearing
//      a rationale: "one long stint is capped by depthRows" throws away the
//      strongest evidence the criterion can receive. Measured on a real run, a
//      candidate with 10.6 years as an IT Application Development Analyst scored
//      47 while support-only candidates scored 100. Of five shapes measured, this
//      one separated genuine from spurious relevance by +22 points; min() managed
//      +2.
//
//      `sat` is `min(1, x)` unless career.concavity > 1, which applies x^(1/γ) —
//      the concave shape human-capital theory implies (the Mincer earnings
//      function fits experience quadratically for exactly that reason). It is
//      DEFAULT OFF because it was measured and made this objective worse:
//      diminishing returns lift the middle of the scale, and the middle is where
//      long-but-irrelevant careers sit. Right for modelling what experience
//      EARNS, wrong for deciding whether experience is RELEVANT.
//  11. T IS ABSOLUTE. It used to be median-of-pool × 2, which made career the
//      ONLY pool-relative quantity among the six aspects — and gave it a fatal
//      corollary: the yardstick shrinks exactly when the bench is weakest, so a
//      hopeless pool scores flatteringly. Measured, on runs in the database now:
//      a Learning & Development pool whose average relevance was 0.168 produced
//      T = 2.06 years / 1.0 stints (the second pinned at its clamp floor, so ONE
//      stint saturated that axis) and averaged 33.1; against a fixed 8/2 the same
//      people score 11.3. The inflation ran 1.4x on a normal pool and 3x on a bad
//      one, always toward making a weak bench look viable.
//      Now: the target JD's own stated requirement × 2 when that exceeds the
//      house default (a stated minimum is a bar to clear, not the point deserving
//      100), else the fixed default, else PINNED to the base run on an incremental
//      run. The pool medians are still measured and reported as DIAGNOSTICS —
//      "this bench's median relevant experience is 0.37 effective stints" is the
//      most useful sentence about a bench that scored badly — they just no longer
//      set the scale. Which source applied is always in CareerRunInfo.depth.
//      Every quantity in this aspect is now absolute, which is what makes two
//      runs of the same program comparable at all.

type CareerMatchStatus = "ok" | "no_match" | "no_embedding";

/**
 * HOW a position resolved to a comparable representation:
 *   filename              — position_id == leading code of a job-profile file_name
 *   jfm                   — job_family_matches pairing (position_id / incumbent)
 *   exact                 — normalized title == a job-profile position_name
 *   embedding             — title ↔ position_name cosine similarity > 0.98
 *   incumbent_competency  — FALLBACK: no profile, scored from the competencies of
 *                           the position's incumbent(s) vs the target reference set
 *   incumbent_position    — TARGET ONLY: profile found via the incumbent's own
 *                           position code rather than the target position's
 *   pseudo_profile        — TARGET ONLY: no profile at all, so a job-profile-shaped
 *                           document was synthesized from position data + incumbent
 *                           competencies and embedded with the model that produced
 *                           job_profile_embed
 * null when the position matched nothing (status "no_match").
 */
export type CareerMatchType =
  | "filename"
  | "jfm"
  | "exact"
  | "embedding"
  | "incumbent_competency"
  | "incumbent_position"
  | "pseudo_profile";

/** How a stint's similarity was obtained. */
export type CareerScoreBasis = "document" | "incumbent_competency" | "unscored";

/**
 * WHY a stint ended up contributing 0. Three genuinely different failures used to
 * be reported as one ("the position has no recorded holder"), which is wrong for
 * two of them and points the operator at the wrong data to fix:
 *   no_target_reference    — the TARGET has no reference competency set at all,
 *                            so the fallback could not run for ANY stint. Nothing
 *                            about this stint is at fault.
 *   no_position_code       — the stint is recorded by title only. Incumbents are
 *                            looked up by position code, so there is no key to
 *                            look one up with. Fix is in the history data.
 *   no_incumbent_competency— the code IS known, but no usable holder was found
 *                            (vacant, or only the candidate themselves) or the
 *                            holders carry no competency rows.
 */
export type CareerUnscoredReason =
  | "no_target_reference"
  | "no_position_code"
  | "no_incumbent_competency";

export type CareerPair = {
  positionId: string | null;
  companyId: string | null;
  title: string;
  /** Stint duration in years (whole calendar months / 12). */
  years: number;
  isCurrent: boolean;
  status: CareerMatchStatus;
  /** How this stint resolved; null when unmatched. */
  matchType: CareerMatchType | null;
  jobProfileId: number | null;
  jobProfileName: string | null;
  /**
   * RESCALED similarity (0..1) actually accumulated — (raw − simFloor)/(simCeil −
   * simFloor). This is the value that drives the score; `similarityRaw` is the
   * unstretched number it came from.
   */
  similarity: number | null;
  /** Pre-rescale similarity on the raw cosine scale (fallback: post-calibration). */
  similarityRaw: number | null;
  /**
   * Human-capital depreciation factor applied to this stint: exp(−δ × years since
   * it ended), 1.0 while ongoing. Recorded per stint because it is the one term a
   * reader cannot recompute from the row — it depends on when the stint ended and
   * on when the run happened, and both are needed to explain why a long, relevant,
   * OLD assignment contributed less than its years suggest.
   */
  recencyFactor: number;
  /** Effective relevant years this stint contributed: similarity × years × recency. */
  effectiveYears: number;
  /** Which path produced `similarity`. */
  basis: CareerScoreBasis;
  /** Why it contributed 0; null unless `basis === "unscored"`. */
  unscoredReason: CareerUnscoredReason | null;
  /** ── Competency-fallback provenance (basis === "incumbent_competency") ── */
  /** Raw Σ/M coverage before calibration (0..1.75). */
  fallbackRaw: number | null;
  /** Incumbent employee ids whose competencies represented the position. */
  fallbackEmployeeIds: string[];
  /** Which temporal tier selected those incumbents' assessments. */
  fallbackBasis: CompetencyBasis | null;
  /** Per-required-competency Hungarian pairing, for the drill-down. */
  fallbackPairs: TechnicalPair[];
};

/** How the fallback 0..1 coverage was mapped onto the document-similarity scale. */
export type CareerCalibration = {
  lo: number;
  hi: number;
  /**
   * "capped"    = the run's measured scale, with the top of the band held at
   *               `cap` of it so a competency argument cannot assert "same job".
   * "pinned"    = operator-pinned anchors (CAREER_FALLBACK_ANCHOR_LO/_HI).
   * "inherited" = pinned to a base run's calibration on an incremental run
   *               (see `pinnedCalibration` in scoreCareerAspect).
   * "empirical" = the retired per-run p5/p95 rule. Never produced any more; kept
   *               in the union because completed runs stored it and the run-config
   *               panel still has to label those honestly.
   */
  source: "capped" | "pinned" | "inherited" | "empirical" | "fixed";
  /** Fraction of the measured band full coverage may reach (0..1). */
  cap: number;
  /** Document-matched stints in the run — reported, no longer an input. */
  sampleCount: number;
  /** TRUE when coverage was IDF-weighted (competency-idf.ts). */
  idfWeighted: boolean;
  reason: string;
};

/**
 * The anchors every stint similarity was stretched onto 0..1 with. Fixed within a
 * run and across runs — never per-run percentiles — but MEASURED from the
 * job-profile embedding corpus rather than hardcoded, and recomputed when that
 * corpus changes (see career-anchors.ts). `source` distinguishes the three, which
 * matters because "measured" and "fallback" can differ by a lot: on this
 * deployment the old constants were 0.45/0.85 against a measured 0.52/1.00.
 */
export type CareerScale = {
  simFloor: number;
  simCeil: number;
  /** env = pinned by operator · measured = median of the estimators · fallback = defaults. */
  source: CareerAnchors["source"];
  /** Cross-pairs the corpus estimator was taken over (0 when not measured). */
  sampleCount: number;
  docCount: number;
  /**
   * Every estimator that contributed, not just the resolved median — so the panel
   * can show that three different questions were asked (an arbitrary-pair census,
   * a same-family precision curve, and the cosines of internal moves that
   * actually happened) and where their answers agreed. Empty when the anchors
   * were pinned or fell back.
   */
  estimates: CareerAnchors["estimates"];
  reason: string;
};

/**
 * The experience yardstick this run measured depth against. `source` says where T
 * came from and is never inferred from silence — a reader has to be able to tell
 * an absolute yardstick from one that followed the pool, because only the first
 * makes two runs comparable.
 */
export type CareerDepthTargets = {
  targetYears: number;
  targetRows: number;
  /**
   * jd       — the target job profile's own stated experience requirement ×
   *            statedExperienceMultiplier (only when it exceeds the default)
   * fixed    — config defaults; absolute, identical in every run
   * inherited— pinned to the base run's targets (incremental run)
   * pool     — RETIRED: median × multiplier over the run's own candidates. Never
   *            produced any more, kept in the union so completed runs that stored
   *            it still render, and still labelled as pool-relative because those
   *            scores are not comparable with the ones after it.
   */
  source: "jd" | "measured" | "fixed" | "inherited" | "pool";
  /** The JD's stated minimum in years, when one was parsed (null otherwise). */
  statedExperienceYears: number | null;
  /**
   * The multiplier applied to that stated minimum on THIS run.
   *
   * Recorded per run because it is configurable and it changed: runs scored
   * before it moved used 2, and a reader who sees "syarat 5 tahun → T 10" needs
   * the rule, not today's setting. Absent on runs finished before this field
   * existed, which were all scored at 2.
   */
  statedExperienceMultiplier: number;
  /** Verbatim requirement text the number was read from, for the drill-down. */
  statedExperienceText: string | null;
  /**
   * WHY the stated minimum was not used, when one was parsed but did not become
   * the target. Never inferred from silence: "the JD says nothing" and "the JD
   * says 1 year and something else won" are different findings, and conflating
   * them is what made an operator read a correctly-detected requirement as
   * undetected.
   */
  statedIgnoredReason: "mode-ignore" | "below-floor" | null;
  /** How the stated minimum was turned into a target (see config.statedMode). */
  statedMode: "scaled" | "direct" | "ignore";
  statedMultiplier: number;
  /** Seniority band read from the target's title, for the measured anchor. */
  level: PositionLevel | null;
  levelLabel: string | null;
  /** The appointment census behind a `measured` target. */
  measured: {
    years: number;
    /**
     * level     — this seniority band's own median.
     * monotonic — raised to a more junior band's median, because seniority is
     *             ordered and a thin senior band must not end up EASIER than a
     *             junior one.
     * overall   — median across every band; only when no band qualified.
     */
    basis: "level" | "overall" | "monotonic";
    sampleCount: number;
    reason: string;
  } | null;
  /**
   * Pool medians — measured and reported for DIAGNOSIS only, never used as the
   * yardstick. Kept because "the pool's median relevant experience is 0.37
   * stints" is the single most useful sentence about a bench that scored badly,
   * and deleting the measurement along with its former role would lose it.
   */
  medianEffectiveYears: number;
  medianEffectiveRows: number;
  /** Candidates the medians were taken over. */
  poolSize: number;
  /** How the two axes combine: score = depthYears × (1−w + w×depthRows). */
  breadthWeight: number;
  /** x^(1/γ) saturation exponent; 1 = linear (the default — see config). */
  concavity: number;
  /** Per-year decay applied to a stint's contribution after it ended; 0 = off. */
  recencyDecayPerYear: number;
  reason: string;
};

export type CareerRunInfo = {
  targetStatus: CareerMatchStatus;
  targetJobProfileId: number | null;
  targetJobProfileName: string | null;
  /** How the target was resolved (including the two target-only fallbacks). */
  targetMatchType: CareerMatchType | null;
  /** Human-readable diagnostic when the target couldn't be resolved/embedded. */
  message: string | null;
  /** Null when no stint needed the competency fallback. */
  calibration: CareerCalibration | null;
  /** Fixed anchors the raw cosines were stretched onto 0..1 with. */
  scale: CareerScale;
  /** The experience yardstick depth was measured against, and where it came from. */
  depth: CareerDepthTargets;
  /** Reference competency set backing the fallback (mirrors the technical aspect). */
  fallbackRequiredCount: number;
  fallbackRequiredSource: RequiredSource;
  /**
   * The IDF census behind the fallback's coverage mean, when one ran. Null when no
   * stint needed the fallback, or when weighting is switched off — never inferred
   * from silence, because "unweighted" and "weighted" are different numbers under
   * the same label.
   */
  idf: {
    docCount: number;
    keyCount: number;
    /** The competencies nearly every job profile lists — why weighting is needed. */
    mostCommon: { name: string; documentFrequency: number; weight: number }[];
    reason: string;
  } | null;
  /** Run-wide coverage: stints scored by each path, and what stayed unscored. */
  coverage: {
    documentStints: number;
    fallbackStints: number;
    unscoredStints: number;
    documentYears: number;
    fallbackYears: number;
    unscoredYears: number;
    /** Unscored stints split by cause — see CareerUnscoredReason. */
    unscoredByReason: Record<CareerUnscoredReason, number>;
  };
};

export type CareerDetail = {
  score: number; // 0..100
  /** depthYears × (1−w + w×depthRows) — the 0..1 that became `score`. */
  normalized: number;
  /** ── Accumulated relevant experience (rescaled similarities × recency) ── */
  /** Σ(sim'×years×recency) over scored stints — "effective relevant years". */
  effectiveYears: number;
  /** Σ(sim'×recency) over scored stints — "effective relevant stints". */
  effectiveRows: number;
  /** saturate(effectiveYears / targetYears) — carries the score. */
  depthYears: number;
  /** saturate(effectiveRows / targetRows) — modulates it by `breadthWeight`. */
  depthRows: number;
  /**
   * Which axis costs this candidate more points. Compares actual loss (1−depthYears
   * against w×(1−depthRows)), not the two attainments — under the multiplicative
   * shape breadth can only ever cost `breadthWeight` of the score, so the raw
   * numbers are no longer comparable the way they were under min().
   */
  binding: "years" | "rows";
  /** The run's yardstick, echoed per candidate so a stored row is self-contained. */
  targetYears: number;
  targetRows: number;
  /**
   * Where that yardstick came from. Carried per candidate because "pool" means
   * the score is relative to who else was scored — a caveat that must travel
   * with the number, not sit only in a run-level block.
   */
  targetSource: CareerDepthTargets["source"];
  /**
   * The three shape parameters, echoed per candidate for the same reason
   * `targetYears` is: a stored row has to be self-explanatory. Without them a
   * reader cannot tell which of three formulas produced `normalized`, and the
   * field name is identical in all three.
   */
  breadthWeight: number;
  concavity: number;
  recencyDecayPerYear: number;
  /** The JD's stated requirement, when the yardstick came from it. */
  statedExperienceYears: number | null;
  statedExperienceText: string | null;
  /** Why a parsed stated minimum did not become the target (null when it did). */
  statedIgnoredReason: CareerDepthTargets["statedIgnoredReason"];
  statedMode: CareerDepthTargets["statedMode"];
  statedMultiplier: number;
  /** Seniority band of the target, and the appointment census behind a `measured` T. */
  levelLabel: string | null;
  measured: CareerDepthTargets["measured"];
  /**
   * Duration-weighted mean of sim' over SCORED stints — i.e. the old formula.
   * Diagnostic only; it no longer drives the score, but it separates "matched
   * badly" from "matched well but far too little" in the UI.
   */
  meanSimilarity: number;
  matchedYears: number;
  totalYears: number;
  targetStatus: CareerMatchStatus;
  targetJobProfileId: number | null;
  targetJobProfileName: string | null;
  matchedCount: number;
  unmatchedCount: number;
  /** One entry per history stint (length M). */
  pairs: CareerPair[];
  /** ── Per-candidate coverage (always shown, never inferred from silence) ── */
  documentCount: number;
  documentYears: number;
  fallbackCount: number;
  fallbackYears: number;
  unscoredCount: number;
  unscoredYears: number;
  /** Share of total tenure that produced a score, 0..1. */
  coverage: number;
  /**
   * The fallback calibration in force for THIS candidate's run (null when no
   * stint needed it). Carried per candidate — not just in CareerRunInfo — so an
   * incremental run can recover it from a reused candidate and pin it, the same
   * way `targetYears`/`targetRows` pin the depth yardstick.
   */
  calibration: CareerCalibration | null;
};

/** Whole calendar months between two dates (partial-month days floored away). */
function wholeMonthsBetween(from: Date, to: Date): number {
  let months =
    (to.getFullYear() - from.getFullYear()) * 12 +
    (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1; // last month not yet complete
  return Math.max(0, months);
}

/**
 * An open/ongoing stint: no end date, or a far-future "Sekarang" sentinel
 * (year >= 9999 — the app's convention for a still-active assignment, e.g.
 * valid_to = 9999-01-01). Such stints must count up to today, not to 9999.
 */
function isOngoingTo(to: Date | null): boolean {
  return to == null || new Date(to).getUTCFullYear() >= 9999;
}

/**
 * How much of a finished stint's relevance survives to today:
 * `exp(−δ × years since it ended)`, 1.0 for an ongoing one.
 *
 * The rate is a human-capital DEPRECIATION rate, not a tuned knob. Setting it to
 * 0 restores the old behaviour, where a stint from twenty years ago counted
 * exactly as much as the one the candidate is in now.
 *
 * SOURCE. Dinerstein, Megalokonomou & Yannelis, "Human Capital Depreciation and
 * Returns to Experience", American Economic Review 112(11), 2022 (NBER w27925)
 * — estimated skill depreciation of 4.3%/year. Corroborated from a different
 * direction by de Grip & van Loo (2002), who measure almost a third of tertiary
 * skills obsolete after 7 years; fitted to the same exponential that is
 * ~5.1%/year. Two literatures bracket 4–5%/year.
 *
 * LIMIT OF APPLICABILITY, which matters and must not be dropped: neither study
 * measured our case. The first measures depreciation from time OUT of formal
 * employment (teachers in Greece); the second is self-assessment by Dutch
 * graduates. We apply it to "skills decay while working in a DIFFERENT field".
 * So 4.3% is a defensible order-of-magnitude anchor, not a replication — and
 * `CAREER_RECENCY_DECAY` exists so a deployment with better evidence can say so.
 * Full citation list with links: the Career section of the Run Configuration tab.

 *
 * A stint with no end date is ONGOING (the `9999` sentinel included, which
 * `isOngoingTo` already understands) and therefore undecayed. A stint whose end
 * date is in the future is likewise treated as current rather than as a negative
 * age, which would otherwise hand it a factor above 1.
 */
export function recencyFactor(to: Date | null, asOf: Date = new Date()): number {
  return recencyDetail(to, asOf).factor;
}

/**
 * `recencyFactor` with the age it decayed by — the one term of a stint a reader
 * cannot recompute from the row alone (it depends on the stint's end AND the
 * run's reference instant). `yearsSince` is null when no decay applied.
 */
export function recencyDetail(to: Date | null, asOf: Date = new Date()): { factor: number; yearsSince: number | null } {
  const delta = config.ahpTopsis.career.recencyDecayPerYear;
  if (!(delta > 0)) return { factor: 1, yearsSince: null };
  if (isOngoingTo(to)) return { factor: 1, yearsSince: null };
  const end = new Date(to as Date).getTime();
  // The run's reference instant (Pers. 2.5), not the wall clock: a derived run
  // measures its added candidates' stint ages to its ROOT's date, so they decay
  // exactly as far as the carried-over candidates did.
  const now = asOf.getTime();
  if (!Number.isFinite(end) || end >= now) return { factor: 1, yearsSince: null };
  const yearsSince = (now - end) / (365.25 * 24 * 3600 * 1000);
  return { factor: Math.exp(-delta * yearsSince), yearsSince };
}

/**
 * Stint duration in years = wholeMonths/12. Undated stints default to 1 year.
 * An ongoing stint counts up to `asOf` — the run's reference instant.
 */
export function stintYears(from: Date | null, to: Date | null, asOf: Date = new Date()): number {
  return stintTenure(from, to, asOf).years;
}

/**
 * `stintYears` with its intermediates: the end of tenure actually used, whether
 * it was clamped to the reference instant, and the whole months counted. The
 * duration above reads `.years` from here — one computation.
 */
export function stintTenure(
  from: Date | null,
  to: Date | null,
  asOf: Date = new Date()
): { years: number; wholeMonths: number | null; end: Date | null; clamped: boolean } {
  if (!from) return { years: 1, wholeMonths: null, end: null, clamped: false };
  const start = new Date(from);
  const now = new Date(asOf.getTime());
  // Ongoing (null / 9999 sentinel) → count up to today. Tenure can't accrue into
  // the future, so any end date beyond now is clamped to now as well.
  let end = isOngoingTo(to) ? now : new Date(to as Date);
  let clamped = isOngoingTo(to);
  if (end.getTime() > now.getTime()) {
    end = now;
    clamped = true;
  }
  if (!(end.getTime() > start.getTime())) return { years: 0, wholeMonths: 0, end, clamped };
  const months = wholeMonthsBetween(start, end);
  return { years: months / 12, wholeMonths: months, end, clamped };
}

/** The calendar date the month arithmetic above reads (process-local fields). */
function localDateString(d: Date | null): string | null {
  if (!d || !Number.isFinite(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isoOrNull = (d: Date | null | undefined): string | null =>
  d && Number.isFinite(new Date(d).getTime()) ? new Date(d).toISOString() : null;

/** Bulk-load job_profile_embed document vectors for a set of job_profile ids. */
async function loadJobProfileEmbeddings(
  ids: Set<number>
): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (ids.size === 0) return out;
  const rows = await vectorQuery<{ jobProfileId: number; embedding: string | null }>(
    `SELECT job_profile_id as "jobProfileId", embedding::text AS embedding
     FROM job_profile_embed
     WHERE job_profile_id = ANY($1::int[])`,
    [Array.from(ids)]
  ).catch(() => [] as { jobProfileId: number; embedding: string | null }[]);
  for (const r of rows) {
    if (r.embedding == null) continue;
    const v = parseVector(r.embedding);
    if (v) out.set(r.jobProfileId, v);
  }
  return out;
}

// Minimum title↔position_name cosine similarity to accept an EMBEDDING pairing —
// mirrors the Job Family Sync matcher (EMBED_MATCH_MIN_SIM = 0.98).
const CAREER_EMBED_MIN_SIM = 0.98;

/** Normalize a position/JD code for equality: uppercase, strip all whitespace. */
function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/\s+/g, "").trim();
}

/** Leading position code parsed from a job-profile file_name (first token). */
function parseLeadingCode(fileName: string | null | undefined): string | null {
  const base = (fileName ?? "").replace(/\.[^./\\]+$/, "").trim(); // drop extension
  if (!base) return null;
  const first = base.split(/\s+/)[0];
  return first && first.length > 0 ? first : null;
}

type CareerProfileLite = { id: number; positionName: string };
type CareerResolution = {
  jobProfileId: number;
  jobProfileName: string | null;
  matchType: CareerMatchType;
};

/**
 * Best-above-threshold embedding pairing for a set of query titles against the
 * job-profile position names (PRIMARY E5 model). Returns title → {profile, sim}
 * for titles that cleared the threshold — the same title ↔ position_name tier the
 * Job Family Sync report uses. Embedding is a one-shot batch; on failure returns
 * an empty map (those positions simply fall through to "no_match").
 */
async function matchTitlesByEmbedding(
  queryTitles: string[],
  profiles: CareerProfileLite[],
  threshold: number
): Promise<Map<string, { profile: CareerProfileLite; similarity: number }>> {
  const out = new Map<string, { profile: CareerProfileLite; similarity: number }>();
  if (queryTitles.length === 0 || profiles.length === 0) return out;
  const names = profiles.map((p) => p.positionName);
  let vectors: number[][];
  try {
    vectors = await embedTexts([...names, ...queryTitles]);
  } catch (err) {
    log("ahpTopsis.careerEmbedMatchFailed", { error: String(err) });
    return out;
  }
  const profVecs = vectors.slice(0, names.length);
  for (let q = 0; q < queryTitles.length; q++) {
    const qv = vectors[names.length + q]!;
    let bestIdx = -1;
    let bestSim = 0;
    for (let i = 0; i < profVecs.length; i++) {
      const sim = cosineSimilarity(qv, profVecs[i]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestSim > threshold) {
      out.set(queryTitles[q]!, { profile: profiles[bestIdx]!, similarity: bestSim });
    }
  }
  return out;
}

// ── Fallback calibration + synthetic target document ─────────────

/**
 * Map the competency fallback's 0..1 coverage onto the similarity scale the
 * document path produces, over a band CAPPED below a real document match.
 *
 * WHAT THIS REPLACED, and why the old version could not do what its own comment
 * promised. The band used to be p5..p95 of THIS RUN's document-matched
 * similarities. The stated intent was that a fallback measurement — the
 * competencies of whoever happens to hold a position, standing in for a JD nobody
 * wrote — must not out-score a real document match. But p95 of the few dozen
 * stints a run matches IS very nearly the maximum of them, so the intent
 * inverted: on the IT Application Development Department Head run the band came
 * out [0.563, 0.949], and 0.949 is exactly the cosine of that target against its
 * own "IT Application Development Analyst" JD. Full competency coverage bought
 * the claim "this IS the job".
 *
 * That mattered because coverage is a much weaker signal than the cosine — AUC
 * 0.743 against 0.874 at telling job families apart, and 5% of UNRELATED job
 * pairs share at least 75% of their competencies, because the competency
 * vocabulary is dominated by entries nearly every profile lists. Measured over
 * 660 scored candidates: document-only candidates averaged 35.1, fallback-only
 * candidates 66.7.
 *
 * Now the band is `[floor, floor + cap × (ceil − floor)]` on the run's MEASURED
 * scale. Three properties follow, and all three are the point:
 *   • coverage 0 → sim' 0 and coverage 1 → sim' = cap, so the ceiling of a
 *     competency argument is a fixed, stated fraction of full relevance;
 *   • it is identical in every run, so a fallback-scored stint means the same
 *     thing everywhere instead of following its run's own sample;
 *   • it needs no minimum sample count, because it no longer measures the run.
 *     `documentSimilarities` is now only reported.
 */
export function calibrateFallback(
  documentSimilarities: number[],
  /**
   * The run's resolved scale. Its floor is the fallback's zero — both describe
   * the same document-cosine distribution, so coverage 0 must land exactly where
   * an unrelated document lands. CAREER_FALLBACK_ANCHOR_LO/_HI still override,
   * since an operator who pins them means it.
   */
  anchors: CareerAnchors,
  idfWeighted: boolean
): CareerCalibration {
  const cfg = config.ahpTopsis.careerFallback;
  const pinned = cfg.anchorLoPinned != null || cfg.anchorHiPinned != null;
  const lo = cfg.anchorLoPinned ?? anchors.simFloor;
  const hiFull = cfg.anchorHiPinned ?? anchors.simCeil;
  const cap = pinned ? 1 : cfg.cap;
  const hi = lo + cap * (hiFull - lo);

  const idfNote = idfWeighted
    ? "Cakupan kompetensi dihitung dengan bobot kekhasan: kompetensi yang diminta hampir semua jabatan hampir tidak menambah nilai."
    : "Cakupan kompetensi dihitung tanpa bobot kekhasan (semua kompetensi dianggap sama pentingnya).";

  if (pinned) {
    return {
      lo,
      hi,
      source: "pinned",
      cap: 1,
      sampleCount: documentSimilarities.length,
      idfWeighted,
      reason: `Rentang penyetaraan ditetapkan manual lewat konfigurasi (${lo.toFixed(3)}–${hi.toFixed(3)}). ${idfNote}`,
    };
  }

  return {
    lo,
    hi,
    source: "capped",
    cap,
    sampleCount: documentSimilarities.length,
    idfWeighted,
    reason:
      `Riwayat tanpa job profile dinilai dari kompetensi pejabat yang menduduki posisi itu, lalu disetarakan ke rentang ${lo.toFixed(3)}–${hi.toFixed(3)} ` +
      `— yaitu ${(cap * 100).toFixed(0)}% dari rentang penuh (${lo.toFixed(3)}–${hiFull.toFixed(3)}). ` +
      `Batas ini disengaja: bukti dari kompetensi pejabat lebih lemah daripada dokumen job profile yang benar-benar ada, jadi cakupan kompetensi 100% pun ` +
      `tidak boleh berarti "ini persis pekerjaan yang sama". ${idfNote} ` +
      `Run ini punya ${documentSimilarities.length} stint yang terpasangkan lewat dokumen — angka itu hanya dilaporkan, tidak lagi menentukan rentang.`,
  };
}

/**
 * Coverage 0..1 → a similarity on the calibrated document scale.
 *
 * The clamp below is now belt-and-braces: `matchCompetencySets.normalized` is
 * saturated at 1 at its source, so `raw` already arrives bounded. It used to be
 * the ONLY place the over-qualification surplus was truncated, which is exactly
 * how the technical aspect came to report 113 — this consumer defended itself
 * and that one did not. Kept because a clamp on a value this function's own
 * contract calls 0..1 costs nothing and documents the requirement locally.
 *
 * Full coverage maps to `hi` and no further, and `hi` is `cap` of the way up the
 * real scale, so the truncation and the cap together are what keep a competency
 * argument from claiming a document match's score.
 */
export function applyCalibration(raw: number, cal: CareerCalibration): number {
  const f = Math.max(0, Math.min(1, raw));
  return Math.max(0, Math.min(1, cal.lo + f * (cal.hi - cal.lo)));
}

// ── Similarity rescale + experience-depth yardstick ──────────────

/**
 * Stretch a raw cosine onto a true 0..1 using the run's resolved anchors.
 *
 * Cosines between job-profile documents are compressed into a narrow, high band
 * — measured on this corpus, an ARBITRARY pair already scores 0.56 — so using the
 * raw value as a 0..100 criterion made "56% similar" worth 56 points when it
 * actually means "no relationship at all". Below simFloor is 0 relevance; at or
 * above simCeil is full relevance. Degenerate anchors (ceil <= floor) fall back
 * to the identity so a misconfiguration can't blank out the criterion.
 *
 * The anchors are passed in, never read from config here: they are measured from
 * `job_profile_embed` per run (career-anchors.ts) and a function that reached for
 * a constant instead would silently ignore the census.
 */
export function rescaleSim(raw: number, anchors: CareerAnchors): number {
  const { simFloor, simCeil } = anchors;
  if (!(simCeil > simFloor)) return Math.max(0, Math.min(1, raw));
  return Math.max(0, Math.min(1, (raw - simFloor) / (simCeil - simFloor)));
}

/** Median of an unsorted numeric array (0 when empty). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Years of experience a job profile states it requires, e.g.
 * "Min 5 tahun sebagai Application Developer" → 5.
 *
 * Deliberately conservative. It reads the FIRST number that a year-word is
 * attached to, in either order ("5 tahun", "min. 3 thn", "3 years"), and returns
 * null for anything else. "Fresh graduate" (75 of 275 profiles) returns null
 * rather than 0, because 0 would say "any relevant experience is a full score" —
 * a stated requirement of none is not a statement that none is enough to be the
 * strongest candidate, and the caller must fall back to the default instead.
 *
 * A bare number with no unit ("Min. 2 sebagai Auditor Internal") is also null:
 * it is *probably* years, and "probably" is not good enough for something that
 * scales every candidate's score on the position.
 */
export function parseStatedExperienceYears(text: string | null | undefined): number | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const m =
    raw.match(/(\d+(?:[.,]\d+)?)\s*(?:tahun|thn|th\b|years?|yrs?)/i) ??
    raw.match(/(?:tahun|thn|years?)\s*(\d+(?:[.,]\d+)?)/i);
  if (!m) return null;
  const n = parseFloat(m[1]!.replace(",", "."));
  // 40 as an upper bound: past that the JD is describing something other than a
  // requirement (a department's total experience, a typo, a year number).
  return Number.isFinite(n) && n > 0 && n <= 40 ? n : null;
}

/**
 * Derive the saturation targets depth is measured against — ABSOLUTE, not
 * pool-relative.
 *
 * WHAT THIS REPLACED. T used to be `median-of-pool × 2`, justified as "enough
 * relevant experience only means something relative to the people actually
 * competing". That reasoning has a fatal corollary: the yardstick shrinks exactly
 * when the bench is weakest, so a hopeless pool produces flattering scores.
 * Measured, on runs that are in the database now:
 *
 *   LEARNING & DEVELOPMENT DEPARTMENT HEAD — 27 candidates, average relevance
 *   0.168, i.e. essentially nobody had relevant experience. The pool median
 *   collapsed, T came out 2.06 years / 1.0 stints (the latter pinned at the clamp
 *   floor, so a SINGLE stint saturated that axis), and the average career score
 *   was 33.1. Against a fixed 8 years / 3 stints the same people score 11.3.
 *
 *   IT APPLICATION DEVELOPMENT DEPARTMENT HEAD — T 6.71/1.80, average 50.2;
 *   against the same fixed target, 35.9.
 *
 * So the inflation ran 1.4x on a normal pool and 3x on a bad one, always toward
 * making a weak bench look viable. Career was the only pool-relative quantity
 * among the six aspects, and the only one whose two runs of the same program were
 * not comparable.
 *
 * The pool medians are still MEASURED and still reported — "the pool's median
 * relevant experience is 0.37 effective stints" is the most useful single
 * sentence about a bench that scored badly. They just no longer set the scale.
 *
 * Precedence: `pinned` (incremental run) → the target JD's own stated
 * requirement → config defaults. `pinned` always wins, because the carried-over
 * candidates were scored against the base run's yardstick and measuring the added
 * ones against a different one would make the two halves incomparable.
 */
export function deriveDepthTargets(
  effYears: number[],
  effRows: number[],
  pinned: { targetYears: number; targetRows: number } | null,
  /** The target job profile's `jobSpecification.experience`, verbatim. */
  statedExperience?: string | null,
  /** The target position's own title — the only reliable level statement. */
  targetTitle?: string | null,
  /** Appointment census; null when it could not be measured. */
  census?: CareerDepthCensus | null,
  /**
   * OPTIONAL out-parameter for the run trace: every intermediate of the
   * T_years decision (the stated minimum as parsed, after its mode, the default
   * it competed with, the measured anchor), so the XLSX can restate the IF chain
   * that chose the yardstick.
   */
  derivation?: DepthDerivation
): CareerDepthTargets {
  const cfg = config.ahpTopsis.career;
  const medY = median(effYears);
  const medR = median(effRows);
  if (derivation) {
    derivation.pinned = pinned ? { ...pinned } : null;
    derivation.statedExperience = statedExperience ?? null;
  }

  const shape = {
    breadthWeight: cfg.breadthWeight,
    concavity: cfg.concavity,
    recencyDecayPerYear: cfg.recencyDecayPerYear,
  };
  const poolDiag = {
    medianEffectiveYears: Number(medY.toFixed(3)),
    medianEffectiveRows: Number(medR.toFixed(3)),
    poolSize: effYears.length,
  };
  const shapeNote =
    `Skor = kedalaman tahun × (${(1 - cfg.breadthWeight).toFixed(2)} + ${cfg.breadthWeight.toFixed(2)} × keragaman penugasan)` +
    (cfg.concavity > 1 ? `, dengan pelandaian γ=${cfg.concavity}` : "") +
    (cfg.recencyDecayPerYear > 0
      ? `. Pengalaman lama menyusut ${(cfg.recencyDecayPerYear * 100).toFixed(1)}% per tahun sejak penugasan berakhir.`
      : ". Tidak ada penyusutan karena usia pengalaman.");

  if (pinned) {
    return {
      targetYears: pinned.targetYears,
      targetRows: pinned.targetRows,
      source: "inherited",
      statedExperienceYears: null,
      statedExperienceText: null,
      statedIgnoredReason: null,
      statedMode: cfg.statedMode,
      statedMultiplier: cfg.statedExperienceMultiplier,
      level: null,
      levelLabel: null,
      measured: null,
      statedExperienceMultiplier: cfg.statedExperienceMultiplier,
      ...poolDiag,
      ...shape,
      reason:
        `Run inkremental — memakai tolok ukur run dasar (${pinned.targetYears.toFixed(2)} tahun / ${pinned.targetRows.toFixed(2)} stint efektif) ` +
        `agar kandidat baru dinilai dengan penggaris yang sama seperti kandidat yang dibawa dari run sebelumnya. ${shapeNote}`,
    };
  }

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const targetRows = clamp(cfg.fixedTargetRows, cfg.minTargetRows, cfg.maxTargetRows);

  // ── The seat's own seniority band ──────────────────────────
  // Reported on every run, not only the ones the census decides, because it is
  // what makes a measured target checkable by a reader.
  const level = levelFromTitle(targetTitle ?? null);
  const levelName = levelLabel(level);

  // ── Default target: the appointment census, else the configured constant ──
  // Revealed preference — how many years of service the people actually appointed
  // to a seat at this level had behind them — rather than a number chosen because
  // it behaved well in a simulation. Null when the record produced nothing usable,
  // and then the constant applies and says so.
  const measuredAnchor =
    cfg.defaultSource === "measured" && census ? targetYearsForLevel(census, level) : null;
  const defaultYears = measuredAnchor ? measuredAnchor.years : cfg.fixedTargetYears;

  // ── The JD's stated minimum, if any and if the mode reads it ──────
  const readsStated = cfg.useStatedExperience && cfg.statedMode !== "ignore";
  const stated = readsStated ? parseStatedExperienceYears(statedExperience) : null;
  const statedText = stated != null ? (statedExperience ?? null) : null;

  // `scaled` translates the JD's CALENDAR years into the effective-years unit the
  // score is measured in — every year here is already discounted by relevance and
  // by how long ago it ended, so the two numbers are not the same quantity.
  // `direct` takes the requirement as written, faithful to the number rather than
  // to the requirement.
  const fromStated =
    stated == null
      ? null
      : cfg.statedMode === "direct"
        ? stated
        : stated * cfg.statedExperienceMultiplier;

  // "A JD may only RAISE the bar" is its OWN flag now. Welded to the multiplier it
  // did two unrelated jobs at once: at multiplier 1 the condition
  // `stated × mult > fixed` discarded 177 of the 179 parseable requirements on
  // this corpus while the run still reported source `jd`.
  const useStated =
    fromStated != null &&
    (!cfg.statedExperienceOnlyAboveFixed || fromStated > defaultYears);

  // Never inferred from silence: "the JD says nothing" and "the JD says 1 year and
  // something else won" are different findings.
  const statedIgnoredReason: CareerDepthTargets["statedIgnoredReason"] =
    !readsStated && (statedExperience ?? "").trim().length > 0
      ? "mode-ignore"
      : fromStated != null && !useStated
        ? "below-floor"
        : null;

  const targetYears = clamp(
    useStated ? fromStated! : defaultYears,
    cfg.minTargetYears,
    cfg.maxTargetYears
  );
  if (derivation) {
    derivation.readsStated = readsStated;
    derivation.statedParsedYears = stated;
    derivation.fromStated = fromStated;
    derivation.useStated = useStated;
    derivation.defaultYears = defaultYears;
    derivation.level = level;
    derivation.levelLabel = levelName;
    derivation.measured = measuredAnchor
      ? { years: measuredAnchor.years, basis: measuredAnchor.basis, sampleCount: measuredAnchor.sampleCount }
      : null;
    derivation.census = census?.census ?? null;
  }

  const source: CareerDepthTargets["source"] = useStated
    ? "jd"
    : measuredAnchor
      ? "measured"
      : "fixed";

  const poolNote =
    effYears.length > 0
      ? ` Sebagai pembanding (tidak dipakai menghitung): median pengalaman relevan pool ini ${medY.toFixed(2)} tahun / ${medR.toFixed(2)} stint efektif dari ${effYears.length} kandidat.`
      : "";

  const statedNote =
    statedIgnoredReason === "mode-ignore"
      ? ` Job profile menyebut syarat pengalaman ("${(statedExperience ?? "").trim()}") tetapi tidak dibaca karena setelan CAREER_DEPTH_STATED_MODE=ignore.`
      : statedIgnoredReason === "below-floor"
        ? ` Job profile menyebut ${stated} tahun (→ ${fromStated!.toFixed(2)} setelah mode "${cfg.statedMode}"), masih di bawah ${defaultYears.toFixed(2)} tahun, dan setelan "syarat tertulis hanya boleh menaikkan" sedang aktif, jadi tolok ukur bawaan yang dipakai.`
        : readsStated && stated == null
          ? " Job profile jabatan sasaran tidak menyebut syarat pengalaman dalam tahun yang bisa dibaca."
          : "";

  const basisNote =
    measuredAnchor == null
      ? ""
      : measuredAnchor.basis === "level"
        ? `median jenjang ${levelName} sendiri, dari ${measuredAnchor.sampleCount} pengangkatan`
        : measuredAnchor.basis === "monotonic"
          ? `dinaikkan ke median jenjang di bawahnya, karena jenjang ${levelName} hanya punya ${measuredAnchor.sampleCount} pengangkatan dan tangga senioritas tidak boleh terbalik`
          : `median seluruh jenjang (${measuredAnchor.sampleCount} pengangkatan), karena tidak satu pun jenjang punya cukup data`;

  return {
    targetYears: Number(targetYears.toFixed(3)),
    targetRows: Number(targetRows.toFixed(3)),
    source,
    statedExperienceYears: stated,
    statedExperienceText: statedText,
    statedExperienceMultiplier: cfg.statedExperienceMultiplier,
    statedIgnoredReason,
    statedMode: cfg.statedMode,
    statedMultiplier: cfg.statedExperienceMultiplier,
    level,
    levelLabel: levelName,
    measured:
      source === "measured" && measuredAnchor
        ? {
            years: Number(measuredAnchor.years.toFixed(3)),
            basis: measuredAnchor.basis,
            sampleCount: measuredAnchor.sampleCount,
            reason: census?.reason ?? "",
          }
        : null,
    ...poolDiag,
    ...shape,
    reason:
      (source === "jd"
        ? `Tolok ukur diambil dari syarat pengalaman yang tertulis di job profile jabatan sasaran ("${statedText}" → ${stated} tahun)` +
          (cfg.statedMode === "direct"
            ? ` dan dipakai apa adanya = ${targetYears.toFixed(2)} tahun.`
            : ` × ${cfg.statedExperienceMultiplier} = ${targetYears.toFixed(2)} tahun, karena syarat tertulis dihitung dalam tahun kalender sedangkan skor ini memakai tahun EFEKTIF (sudah didiskon relevansi dan usia pengalaman).`) +
          ` Keragaman penugasan: ${targetRows.toFixed(2)} stint efektif.`
        : source === "measured"
          ? `Tolok ukur DIUKUR dari rekam jejak pengangkatan: ${targetYears.toFixed(2)} tahun untuk jenjang ${levelName} — ${basisNote}. ` +
            `Angka ini adalah preferensi yang terungkap (berapa lama masa kerja orang yang benar-benar diangkat ke jabatan setingkat ini), bukan konstanta yang dipilih karena terasa pas. ` +
            `Keragaman penugasan: ${targetRows.toFixed(2)} stint efektif.`
          : `Tolok ukur TETAP ${targetYears.toFixed(2)} tahun / ${targetRows.toFixed(2)} stint efektif, sama untuk setiap run dan setiap jabatan` +
            (cfg.defaultSource === "measured"
              ? " (rekam jejak pengangkatan tidak menghasilkan angka yang bisa dipakai, jadi konstanta bawaan yang berlaku)."
              : ".")) +
      statedNote +
      ` Tolok ukur tidak lagi mengikuti isi pool: dulu ia diturunkan dari median pool, sehingga pool yang lemah justru menghasilkan skor yang lebih tinggi.` +
      poolNote +
      ` ${shapeNote}`,
  };
}

/**
 * A job-profile-shaped document for a position that has none, in the SAME label
 * shape lib/job-family/restructure.ts writes into job_profile_embed (a local copy
 * — scoring-service cannot import from the web app). Empty fields drop their
 * whole line, exactly as the template does, so a missing value never contributes
 * a dangling label the real documents don't have.
 */
function buildPseudoProfileDocument(input: {
  positionName: string;
  divisionDepartment: string | null;
  jobPurpose: string | null;
  education: string | null;
  experience: string | null;
  competencies: RequiredCompetency[];
}): string {
  const lines: string[] = [];
  const push = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) lines.push(`${label}: ${v}`);
  };
  push("Jabatan", input.positionName);
  push("Divisi/Departemen", input.divisionDepartment);
  push("Tujuan Jabatan", input.jobPurpose);
  push("Kualifikasi Pendidikan", input.education);
  push("Pengalaman", input.experience);
  push(
    "Kompetensi Teknis",
    input.competencies.map((c) => `${c.name} (level ${c.level})`).join(", ")
  );
  return lines.join("\n").trim();
}

/** The model that produced most of job_profile_embed — the one a synthetic
 *  document must be embedded with to be comparable to those vectors. */
async function loadStoredJobProfileEmbeddingModel(): Promise<string | null> {
  const rows = await vectorQuery<{ embeddingModel: string | null }>(
    `SELECT embedding_model AS "embeddingModel"
     FROM job_profile_embed
     WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL
     GROUP BY embedding_model
     ORDER BY COUNT(*) DESC
     LIMIT 1`
  ).catch(() => [] as { embeddingModel: string | null }[]);
  return rows[0]?.embeddingModel ?? null;
}

async function embedPseudoProfile(
  document: string,
  storedModel: string | null,
  expectedDims: number | null
): Promise<{ vector: number[] | null; error: string | null }> {
  if (!document.trim()) {
    return { vector: null, error: "dokumen sintetis kosong (tidak ada data posisi yang bisa dirangkai)" };
  }
  if (!storedModel) {
    return {
      vector: null,
      error:
        "job_profile_embed tidak mencatat embedding_model, sehingga model pembanding tidak dapat direproduksi",
    };
  }
  try {
    // storedVectorKind reproduces the instruction-prefix convention the web app
    // used when it wrote those rows; mismatching it skews every cosine.
    const [vector] = await embedTexts([document], {
      model: storedModel,
      kind: storedVectorKind(storedModel),
    });
    if (!vector) return { vector: null, error: "layanan embedding tidak mengembalikan vektor" };
    if (expectedDims != null && vector.length !== expectedDims) {
      return {
        vector: null,
        error: `dimensi vektor sintetis (${vector.length}) berbeda dari job_profile_embed (${expectedDims})`,
      };
    }
    return { vector, error: null };
  } catch (err) {
    return { vector: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** The T_years decision, step by step — `deriveDepthTargets`'s trace out-parameter. */
export type DepthDerivation = {
  pinned: { targetYears: number; targetRows: number } | null;
  statedExperience: string | null;
  readsStated: boolean;
  statedParsedYears: number | null;
  fromStated: number | null;
  useStated: boolean;
  defaultYears: number | null;
  level: string | null;
  levelLabel: string | null;
  measured: { years: number; basis: string; sampleCount: number } | null;
  census: CensusRef | null;
};

export function emptyDepthDerivation(): DepthDerivation {
  return {
    pinned: null,
    statedExperience: null,
    readsStated: false,
    statedParsedYears: null,
    fromStated: null,
    useStated: false,
    defaultYears: null,
    level: null,
    levelLabel: null,
    measured: null,
    census: null,
  };
}

/** What the career pass recorded for the run trace (drizzle/0092). */
type CareerTraceSink = {
  candidates: Map<string, CareerCandidateTrace>;
  fallbacks: Map<string, CareerFallbackTrace>;
  calibration: EngineTrace["career"]["calibration"];
  depth: DepthDerivation;
  idf: EngineTrace["career"]["idf"];
  target: EngineTrace["career"]["target"] | null;
};

export function emptyCareerTraceSink(): CareerTraceSink {
  return {
    candidates: new Map(),
    fallbacks: new Map(),
    calibration: null,
    depth: emptyDepthDerivation(),
    idf: null,
    target: null,
  };
}

/** One stint's competency-fallback outcome. */
type FallbackResult = {
  /** Raw Σ/M coverage, before calibration. */
  raw: number;
  pairs: TechnicalPair[];
  employeeIds: string[];
  basis: CompetencyBasis;
};

async function scoreCareerAspect(
  candidates: AhpCandidate[],
  position: PositionRow,
  target: TargetRequiredSet,
  targetRefs: CompetencyRef[],
  targetPositionCode: string | null,
  resolveCode: (name: string) => string | null,
  vectors: LevelVectorStore,
  /**
   * The 0..1 scale, measured from the job-profile corpus once per run
   * (career-anchors.ts). Passed in rather than resolved here so the run records
   * one set of anchors and every stint — document and fallback alike — is
   * stretched by exactly that set.
   */
  anchors: CareerAnchors,
  onProgress?: (done: number, total: number) => Promise<void>,
  /**
   * Incremental run: the depth yardstick recovered from the base run. Pinning it
   * keeps the added candidates on the same scale as the ones carried over —
   * without it, `candidates` here is only the ADDED subset and a pool-derived
   * median over two people would silently re-scale half the ranking.
   */
  pinnedDepth?: { targetYears: number; targetRows: number } | null,
  /**
   * Incremental run: the fallback calibration (lo/hi) recovered from the base
   * run. Without this, the added candidates' fallback-scored stints get
   * calibrated against only THEIR OWN document-matched sample — often too small
   * to pass `minSamples`, and even when it isn't, a different p5/p95 than the
   * one the carried-over candidates were measured with. That breaks the exact
   * invariant `pinnedDepth` exists to protect: a raw fallback coverage must map
   * to the same similarity, and thus the same score, regardless of which half
   * of the run computed it.
   */
  pinnedCalibration?: CareerCalibration | null,
  /**
   * The run's reference instant: stint ages (recency decay, Pers. 2.5) and the
   * tenure of an ongoing stint are measured to it. A root takes the moment it
   * started; a derived run takes its root's, so added and carried-over
   * candidates are aged to the same date.
   */
  asOf: Date = new Date(),
  /**
   * A "Tambah Kandidat Pembanding" child: the target document its parent
   * compared every stint against (FR-RR-07). When given, the target is NOT
   * re-resolved — not the jfm pairing, not the title tiers, not a freshly
   * synthesized document — so the new candidates' stints are measured against
   * the very vector the carried-over candidates were.
   */
  pinnedTarget: FrozenCareerTarget | null = null,
  /** Run trace (drizzle/0092): filled with every per-stint intermediate. */
  traceOut: CareerTraceSink | null = null
): Promise<{
  scores: Map<string, number>;
  details: Map<string, CareerDetail>;
  runInfo: CareerRunInfo;
  /** The target this pass compared against — recorded in the run's position basis. */
  target: FrozenCareerTarget;
}> {
  const scores = new Map<string, number>();
  const details = new Map<string, CareerDetail>();

  // ── Job profile catalog (filename-code + exact/embedding title tiers) ──
  const jpRows = await query<{
    id: number;
    positionName: string | null;
    fileName: string | null;
  }>(
    `SELECT id, position_name AS "positionName", file_name AS "fileName"
     FROM sync_job_profiles
     WHERE status = 'completed' AND position_name IS NOT NULL`
  ).catch(
    () => [] as { id: number; positionName: string | null; fileName: string | null }[]
  );

  const profiles: CareerProfileLite[] = jpRows
    .filter((p) => p.positionName && p.positionName.trim().length > 0)
    .map((p) => ({ id: p.id, positionName: p.positionName! }));

  const nameByJpId = new Map<number, string | null>();
  for (const p of profiles) nameByJpId.set(p.id, p.positionName);

  // Filename-code index: leading file_name code → every same-code profile
  // (multiple JDs can share a position code; disambiguated by title at match time).
  const codeToProfiles = new Map<string, CareerProfileLite[]>();
  for (const r of jpRows) {
    if (!r.positionName?.trim()) continue;
    const key = normalizeCode(parseLeadingCode(r.fileName));
    if (!key) continue;
    const prof: CareerProfileLite = { id: r.id, positionName: r.positionName };
    const arr = codeToProfiles.get(key);
    if (arr) arr.push(prof);
    else codeToProfiles.set(key, [prof]);
  }
  // Exact normalized-title index (first-wins).
  const exactIndex = new Map<string, CareerProfileLite>();
  for (const p of profiles) {
    const k = normalizeTitle(p.positionName);
    if (k && !exactIndex.has(k)) exactIndex.set(k, p);
  }
  // Among same-code profiles, pick the one whose name best matches the title:
  // exact > longest substring > first (mirrors the Sync report's pickCodeHit).
  const pickCodeHit = (
    hits: CareerProfileLite[],
    title: string | null
  ): CareerProfileLite => {
    if (hits.length === 1 || !title) return hits[0]!;
    const t = normalizeTitle(title);
    const exact = hits.find((h) => normalizeTitle(h.positionName) === t);
    if (exact) return exact;
    const sub = hits
      .filter((h) => {
        const n = normalizeTitle(h.positionName);
        return n.includes(t) || t.includes(n);
      })
      .sort((a, b) => b.positionName.length - a.positionName.length)[0];
    return sub ?? hits[0]!;
  };

  // ── Job Family match maps (position_id → profile, candidate_id → profile) ──
  // `candidateLive` carries the soft-delete state because posToProfile below is
  // keyed by POSITION CODE, not by candidate id, so a tombstoned person's row
  // competes for a key that every candidate in the pool then reads.
  type JfmRow = {
    candidateId: string;
    positionId: string | null;
    jobProfileId: number;
    jobProfileName: string | null;
    updatedAt: Date | null;
    candidateLive: boolean;
  };
  const jfmRows = await query<JfmRow>(
    `SELECT jfm.candidate_id as "candidateId", jfm.position_id as "positionId",
            jfm.job_profile_id as "jobProfileId", jfm.job_profile_name as "jobProfileName",
            jfm.updated_at as "updatedAt",
            (c.deleted_at IS NULL) as "candidateLive"
     FROM job_family_matches jfm
     -- LEFT JOIN: a jfm row whose candidate row is gone still describes a
     -- position, and counts as live.
     LEFT JOIN candidates c ON c.id = jfm.candidate_id`
  ).catch((err) => {
    // Both maps go empty here, costing every candidate its 'jfm' career match,
    // so name the likely cause rather than degrading mutely — an unmigrated
    // database (candidates.deleted_at, drizzle/0045) now fails this query too.
    log("ahpTopsis.jfmRows.failed", {
      error: err instanceof Error ? err.message : String(err),
      hint: "job_family_matches missing, or candidates.deleted_at missing (drizzle/0045 not applied) — career falls back to title/embedding matching",
    });
    return [] as JfmRow[];
  });

  type ProfileRef = { jobProfileId: number; jobProfileName: string | null };
  // Keyed by NORMALIZED position code so history position_ids resolve regardless
  // of case/whitespace.
  const posToProfile = new Map<string, ProfileRef & { updatedAt: number; live: boolean }>();
  const candToProfile = new Map<string, ProfileRef & { positionId: string | null }>();
  for (const r of jfmRows) {
    if (!nameByJpId.has(r.jobProfileId)) nameByJpId.set(r.jobProfileId, r.jobProfileName);
    // candToProfile is only ever read as candToProfile.get(c.id) for c in the
    // already-live pool, so a tombstoned entry here is unreachable — left as is.
    candToProfile.set(r.candidateId, {
      jobProfileId: r.jobProfileId,
      jobProfileName: r.jobProfileName,
      positionId: r.positionId,
    });
    if (r.positionId) {
      const key = normalizeCode(r.positionId);
      if (!key) continue;
      const ts = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
      const live = r.candidateLive !== false;
      const prev = posToProfile.get(key);
      // A tombstoned person's row may still DEFINE a position's profile — often
      // it is the only row bearing the target position's code, since the
      // incumbent is exactly who gets removed from the Kandidat page. Dropping
      // it would change career relevance for the whole pool. So liveness only
      // outranks recency: a live row always wins the key, a tombstone holds it
      // when nothing live claims it.
      const better = !prev || (live && !prev.live) || (live === prev.live && ts >= prev.updatedAt);
      if (better) {
        posToProfile.set(key, {
          jobProfileId: r.jobProfileId,
          jobProfileName: r.jobProfileName,
          updatedAt: ts,
          live,
        });
      }
    }
  }

  // ── Collect every distinct position to resolve (all stints + target) ──
  // Per candidate: history rows, plus their current match if not already a
  // history position_id. Built here so the embedding tier runs once for the run.
  const stintsByCand = new Map<string, AhpCandidate["history"]>();
  const descKey = (code: string | null, title: string | null) =>
    `${normalizeCode(code)}##${normalizeTitle(title ?? "")}`;
  const descriptors = new Map<string, { code: string | null; title: string | null }>();
  const addDesc = (code: string | null, title: string | null): string => {
    const key = descKey(code, title);
    if (!descriptors.has(key)) descriptors.set(key, { code: code ?? null, title: title ?? null });
    return key;
  };

  // Stints the engine appended itself (the current job_family match, when no
  // history row carries it) — recorded so the trace can say the row is not data.
  const syntheticStint = new WeakSet<object>();
  for (const c of candidates) {
    const stints = [...c.history];
    const cur = candToProfile.get(c.id);
    const currentPosId = cur?.positionId ?? null;
    const hasCurrentStint =
      currentPosId != null && stints.some((h) => h.positionId === currentPosId);
    if (!hasCurrentStint && (currentPosId != null || stints.length === 0)) {
      const appended = {
        title: c.currentPosition ?? currentPosId ?? "(posisi saat ini)",
        positionId: currentPosId,
        companyId: null,
        gradeId: null,
        validFrom: null,
        validTo: null,
      };
      syntheticStint.add(appended);
      stints.push(appended);
    }
    stintsByCand.set(c.id, stints);
    for (const h of stints) addDesc(h.positionId, h.title);
  }

  // The target's sync position code (for the filename-code tier) + its descriptor.
  // A pinned target is not resolved at all, so it adds no descriptor.
  const targetDescKey = pinnedTarget ? null : addDesc(targetPositionCode, position.title);

  // ── Resolve every descriptor: filename → jfm → exact → embedding ──
  const resolution = new Map<string, CareerResolution | null>();
  const pendingByKey = new Map<string, string>(); // key → title needing embedding
  for (const [key, d] of descriptors) {
    if (d.code) {
      const code = normalizeCode(d.code);
      const hits = code ? codeToProfiles.get(code) : undefined;
      if (hits && hits.length > 0) {
        const hit = pickCodeHit(hits, d.title);
        resolution.set(key, {
          jobProfileId: hit.id,
          jobProfileName: hit.positionName,
          matchType: "filename",
        });
        continue;
      }
      const jfm = code ? posToProfile.get(code) : undefined;
      if (jfm) {
        resolution.set(key, {
          jobProfileId: jfm.jobProfileId,
          jobProfileName: jfm.jobProfileName,
          matchType: "jfm",
        });
        continue;
      }
    }
    if (d.title) {
      const ex = exactIndex.get(normalizeTitle(d.title));
      if (ex) {
        resolution.set(key, {
          jobProfileId: ex.id,
          jobProfileName: ex.positionName,
          matchType: "exact",
        });
        continue;
      }
      pendingByKey.set(key, d.title);
      continue;
    }
    resolution.set(key, null);
  }

  // Embedding tier (title ↔ position_name > 0.98) for the still-unmatched titles.
  if (pendingByKey.size > 0) {
    const titles = Array.from(new Set(pendingByKey.values()));
    const embMap = await matchTitlesByEmbedding(titles, profiles, CAREER_EMBED_MIN_SIM);
    for (const [key, title] of pendingByKey) {
      const hit = embMap.get(title);
      resolution.set(
        key,
        hit
          ? {
              jobProfileId: hit.profile.id,
              jobProfileName: hit.profile.positionName,
              matchType: "embedding",
            }
          : null
      );
    }
  }

  // ── Target job profile: authoritative jfm/incumbent pairing first, then the
  //    filename/exact/embedding resolution of the target descriptor. ──
  // A pinned target (a child run, FR-RR-07) skips every tier below: the parent
  // already resolved it, and resolving again today could pick another document.
  const jfmTargetJpId = pinnedTarget ? null : await findMatchedJobProfileId(position.id);
  let targetResolved: CareerResolution | null = pinnedTarget
    ? pinnedTarget.jobProfileId != null
      ? {
          jobProfileId: pinnedTarget.jobProfileId,
          jobProfileName: pinnedTarget.jobProfileName,
          matchType: (pinnedTarget.matchType ?? "jfm") as CareerMatchType,
        }
      : null
    : jfmTargetJpId != null
      ? {
          jobProfileId: jfmTargetJpId,
          jobProfileName: nameByJpId.get(jfmTargetJpId) ?? null,
          matchType: "jfm",
        }
      : resolution.get(targetDescKey!) ?? null;

  // Fallback tier — the INCUMBENT's own position code. A target position may
  // not be linked to a `positions` row (or its code may carry no profile) while
  // the person sitting in it is recorded against a code that does.
  if (!pinnedTarget && !targetResolved && position.holderEmployeeId?.trim()) {
    const incumbentCodes = await query<{ positionId: string | null }>(
      `SELECT position_id as "positionId"
       FROM sync_employee_positions
       WHERE TRIM(employee_id) = $1
       ORDER BY primary_position DESC, valid_from DESC NULLS LAST
       LIMIT 5`,
      [position.holderEmployeeId.trim()]
    ).catch(() => [] as { positionId: string | null }[]);
    for (const row of incumbentCodes) {
      const code = normalizeCode(row.positionId);
      if (!code) continue;
      const hits = codeToProfiles.get(code);
      if (hits && hits.length > 0) {
        const hit = pickCodeHit(hits, position.title);
        targetResolved = {
          jobProfileId: hit.id,
          jobProfileName: hit.positionName,
          matchType: "incumbent_position",
        };
        break;
      }
      const jfm = posToProfile.get(code);
      if (jfm) {
        targetResolved = {
          jobProfileId: jfm.jobProfileId,
          jobProfileName: jfm.jobProfileName,
          matchType: "incumbent_position",
        };
        break;
      }
    }
  }

  const targetJpId = targetResolved?.jobProfileId ?? null;

  // The target JD's own stated experience requirement, for the depth yardstick.
  // Read here rather than inside deriveDepthTargets so that function stays pure
  // and testable, and so a DB hiccup degrades to the fixed target instead of
  // failing the run.
  const targetStatedExperience = pinnedTarget
    ? pinnedTarget.statedExperience
    : targetJpId != null
      ? (
          await query<{ experience: string | null }>(
            `SELECT (extracted_data::jsonb)->'jobSpecification'->>'experience' AS experience
               FROM sync_job_profiles WHERE id = $1`,
            [targetJpId]
          ).catch(() => [] as { experience: string | null }[])
        )[0]?.experience ?? null
      : null;

  // Collect every job_profile_id we need a DOCUMENT embedding for, then bulk-load.
  const neededJpIds = new Set<number>();
  if (targetJpId != null && !pinnedTarget) neededJpIds.add(targetJpId);
  for (const r of resolution.values()) if (r) neededJpIds.add(r.jobProfileId);
  for (const v of candToProfile.values()) neededJpIds.add(v.jobProfileId);
  const embById = await loadJobProfileEmbeddings(neededJpIds);

  let targetVec = pinnedTarget
    ? pinnedTarget.vector
    : targetJpId != null
      ? embById.get(targetJpId) ?? null
      : null;
  let targetMatchType: CareerMatchType | null = pinnedTarget
    ? ((pinnedTarget.matchType as CareerMatchType | null) ?? null)
    : targetResolved?.matchType ?? null;
  let pseudoNote: string | null = pinnedTarget ? pinnedTarget.pseudoNote : null;

  // Last target tier — synthesize a job-profile-shaped document from the
  // position's own data plus the reference competency set (which is itself
  // incumbent-derived when no profile exists) and embed it with the model that
  // produced job_profile_embed, so it lands in the same vector space.
  //
  // Skipped when no stint has a document vector either: there would be nothing
  // to compare the synthetic document against, and every stint routes through
  // the competency fallback regardless. Saves a needless embedding call.
  if (!pinnedTarget && !targetVec && embById.size > 0) {
    const dimsSample = embById.values().next().value as number[] | undefined;
    const meta = targetPositionCode
      ? await queryOne<{ summary: string | null }>(
          `SELECT summary
           FROM sync_positions
           WHERE UPPER(REGEXP_REPLACE(position_id, '[[:space:]]', '', 'g')) = $1
           ORDER BY valid_from DESC NULLS LAST
           LIMIT 1`,
          [targetPositionCode]
        ).catch(() => null)
      : null;

    const document = buildPseudoProfileDocument({
      positionName: position.title,
      divisionDepartment:
        [position.division, position.department].filter(Boolean).join(" / ") || null,
      jobPurpose: meta?.summary ?? position.jobPurpose ?? null,
      education: position.education,
      experience: position.experience,
      competencies: target.required,
    });

    const storedModel = await loadStoredJobProfileEmbeddingModel();
    const { vector, error } = await embedPseudoProfile(
      document,
      storedModel,
      dimsSample?.length ?? null
    );
    if (vector) {
      targetVec = vector;
      targetMatchType = "pseudo_profile";
      pseudoNote = `Posisi target tidak punya job profile, sehingga dokumen sintetis dirangkai dari data posisi + acuan kompetensi (${target.source}) dan di-embed dengan model "${storedModel}" — model yang sama yang mengisi job_profile_embed.`;
      log("ahpTopsis.careerPseudoProfile", {
        position: position.title,
        model: storedModel,
        documentChars: document.length,
      });
    } else {
      pseudoNote = `Dokumen sintetis untuk posisi target tidak dapat di-embed (${error}), sehingga seluruh stint dinilai lewat pencocokan kompetensi incumbent.`;
      log("ahpTopsis.careerPseudoProfileFailed", { position: position.title, error });
    }
  }

  const targetJobProfileName = pinnedTarget
    ? pinnedTarget.jobProfileName
    : targetResolved?.jobProfileName ??
      (targetJpId != null ? nameByJpId.get(targetJpId) ?? null : null);
  const targetStatus: CareerMatchStatus = targetVec
    ? "ok"
    : targetJpId == null
      ? "no_match"
      : "no_embedding";

  if (targetStatus !== "ok") {
    log("ahpTopsis.careerTargetUnmatched", {
      position: position.title,
      targetJpId,
      targetStatus,
      fallbackRequired: targetRefs.length,
    });
  }

  // ── Pass 1: resolve every stint; collect the document-similarity sample ──
  // `status` describes how the stint resolved to a JOB PROFILE; `basis` (added in
  // pass 2) describes how its number was actually obtained. They differ when the
  // target has no document: a stint can be perfectly resolved yet still be scored
  // through the competency fallback.
  type StintRecord = {
    stint: AhpCandidate["history"][number];
    years: number;
    tenure: ReturnType<typeof stintTenure>;
    isCurrent: boolean;
    status: CareerMatchStatus;
    matchType: CareerMatchType | null;
    jobProfileId: number | null;
    jobProfileName: string | null;
    documentSimilarity: number | null;
  };

  const recordsByCand = new Map<string, StintRecord[]>();
  const documentSims: number[] = [];

  for (const c of candidates) {
    const stints = stintsByCand.get(c.id) ?? [];
    const cur = candToProfile.get(c.id);
    const currentPosId = cur?.positionId ?? null;
    const records: StintRecord[] = [];

    for (const h of stints) {
      // One computation for the duration and its trace (stintYears reads the
      // same function), so a recorded month count cannot disagree with `years`.
      const tenure = stintTenure(h.validFrom, h.validTo, asOf);
      const years = tenure.years;
      const isCurrent =
        isOngoingTo(h.validTo) || (currentPosId != null && h.positionId === currentPosId);

      // Resolved pairing for this position (filename → jfm → exact → embedding);
      // fall back to the candidate's own current job_family match for the current
      // stint when nothing else matched.
      let ref: CareerResolution | null =
        resolution.get(descKey(h.positionId, h.title)) ?? null;
      if (!ref && isCurrent && cur) {
        ref = {
          jobProfileId: cur.jobProfileId,
          jobProfileName: cur.jobProfileName,
          matchType: "jfm",
        };
      }

      let status: CareerMatchStatus = "no_match";
      let similarity: number | null = null;
      let jobProfileId: number | null = null;
      let jobProfileName: string | null = null;
      let matchType: CareerMatchType | null = null;

      if (ref) {
        jobProfileId = ref.jobProfileId;
        jobProfileName = ref.jobProfileName;
        matchType = ref.matchType;
        const vec = embById.get(ref.jobProfileId);
        if (!vec) {
          status = "no_embedding";
        } else {
          status = "ok";
          if (targetVec) {
            similarity = Math.max(0, cosineSimilarity(targetVec, vec));
            documentSims.push(similarity);
          }
        }
      }

      records.push({
        stint: h,
        years,
        tenure,
        isCurrent,
        status,
        matchType,
        jobProfileId,
        jobProfileName,
        documentSimilarity: similarity,
      });
    }

    recordsByCand.set(c.id, records);
  }

  // ── Fallback preparation: one batch of DB work for the whole run ──
  const fallbackEnabled = targetRefs.length > 0;

  // IDF weights for the fallback's coverage mean. Resolved once per run, and only
  // when the fallback can actually run — a position with a real JD for every stint
  // never needs them. A census failure degrades to unweighted (every weight 1),
  // which is the previous behaviour, rather than failing the run.
  const idf =
    fallbackEnabled && config.ahpTopsis.careerFallback.useIdf
      ? await resolveCompetencyIdfCached(resolveCode, normalizeCompName).catch(() => null)
      : null;
  /**
   * Weight for one required competency, keyed exactly the way
   * `matchCompetencySets` keys identity — kamus code when the name resolved to
   * one, else the normalized name. Two spellings of one competency must not count
   * as two different rare ones, which is why df was measured after code
   * resolution rather than over raw strings.
   */
  const idfWeightFor = idf
    ? (req: CompetencyRef): number =>
        idf.weightByKey.get(req.code ? `C:${req.code}` : `N:${req.norm}`) ??
        idf.unseenWeight
    : undefined;
  const fallbackCodes = new Set<string>();
  if (fallbackEnabled) {
    for (const records of recordsByCand.values()) {
      for (const r of records) {
        if (r.documentSimilarity != null) continue;
        const code = normalizeCode(r.stint.positionId);
        if (code) fallbackCodes.add(code);
      }
    }
  }

  const holdersByCode =
    fallbackCodes.size > 0
      ? await loadPositionHolders(Array.from(fallbackCodes), asOf)
      : new Map<string, PositionHolder[]>();

  const holderIds = new Set<string>();
  for (const list of holdersByCode.values()) for (const h of list) holderIds.add(h.employeeId);
  const holderRows =
    holderIds.size > 0
      ? await loadCompetencyRowsByEmployee(Array.from(holderIds))
      : new Map<string, SyncCompetencyRow[]>();

  // Pre-fetch every level vector the fallback matcher can reference. ensure()
  // fetches all levels of a code in one round trip, so a single pass over the
  // rows covers every subset the temporal tiers might later select.
  if (holderRows.size > 0) {
    const refs: CompetencyRef[] = [];
    for (const rows of holderRows.values()) {
      for (const r of rows) {
        const name = (r.technicalName ?? "").trim();
        if (!name) continue;
        refs.push({
          name,
          level: targetLevelOf(r),
          code: resolveCode(name),
          norm: normalizeCompName(name),
        });
      }
    }
    await vectors.ensure(refs);
  }

  // Position → competency-fallback value. Position vs position, so the result
  // does NOT depend on which candidate is being evaluated — except through
  // self-exclusion, which is part of the cache key.
  const fallbackCache = new Map<string, FallbackResult | null>();
  const computeFallback = (
    positionId: string | null,
    companyId: string | null,
    exclude: Set<string>
  ): FallbackResult | null => {
    if (!fallbackEnabled) return null;
    const code = normalizeCode(positionId);
    if (!code) return null;
    const key = `${code}##${normalizeCode(companyId)}##${Array.from(exclude).sort().join("|")}`;
    const cached = fallbackCache.get(key);
    if (cached !== undefined) return cached;

    let result: FallbackResult | null = null;
    const holders = pickHolders(holdersByCode.get(code) ?? [], companyId, exclude);
    const trace: CareerFallbackTrace | null = traceOut
      ? {
          key,
          code,
          companyId,
          excluded: Array.from(exclude).sort(),
          holders: [],
          union: [],
          required: targetRefs.map((r) => ({ name: r.name, code: r.code, norm: r.norm, level: r.level })),
          match: null,
          normalized: null,
          basis: null,
        }
      : null;
    if (holders.length > 0) {
      const selections = holders.map((h) =>
        selectCompetencyRows(
          holderRows.get(h.employeeId) ?? [],
          code,
          { from: h.validFrom, to: h.validTo },
          asOf
        )
      );
      if (trace) {
        trace.holders = holders.map((h, i) => ({
          employeeId: h.employeeId,
          companyId: h.companyId,
          validFrom: isoOrNull(h.validFrom),
          validTo: isoOrNull(h.validTo),
          active: h.active,
          isPrimary: h.isPrimary,
          basis: selections[i]!.basis,
          rows: selections[i]!.rows
            .filter((r) => (r.technicalName ?? "").trim().length > 0)
            .map((r) => ({
              name: (r.technicalName ?? "").trim(),
              norm: normalizeCompName((r.technicalName ?? "").trim()),
              proficiencyName: r.proficiencyName,
              score: r.score == null ? null : Number(r.score),
              currentProficiencyName: r.currentProficiencyName,
              currentScore: r.currentScore == null ? null : Number(r.currentScore),
              level: targetLevelOf(r),
            })),
        }));
      }
      const comps = unionMaxLevel(selections.map((s) => s.comps));
      if (comps.length > 0) {
        // IDF-weighted here and NOT in the technical aspect's call. There the
        // question is "can this person do what the JD demands", where a common
        // requirement being common does not excuse missing it. Here the question
        // is "is this the same kind of job", which a competency 93% of profiles
        // list cannot answer. See competency-idf.ts.
        const heldRefs = toCompetencyRefs(comps, resolveCode);
        const matchTrace = trace ? emptyMatchTrace() : undefined;
        const m = matchCompetencySets(heldRefs, targetRefs, vectors, idfWeightFor, matchTrace);
        result = {
          raw: m.normalized,
          pairs: m.pairs,
          employeeIds: holders.map((h) => h.employeeId),
          // Report the strongest evidence tier any picked holder contributed.
          basis: selections.some((s) => s.basis === "position_column")
            ? "position_column"
            : selections.some((s) => s.basis === "create_date_window")
              ? "create_date_window"
              : "active_all",
        };
        if (trace) {
          trace.union = heldRefs.map((r) => ({ name: r.name, code: r.code, norm: r.norm, level: r.level }));
          trace.match = matchTrace ?? null;
          trace.normalized = m.normalized;
          trace.basis = result.basis;
        }
      }
    }
    if (trace) traceOut!.fallbacks.set(key, trace);
    fallbackCache.set(key, result);
    return result;
  };
  /** The cache key `computeFallback` files a stint under — the trace's join key. */
  const fallbackKeyFor = (positionId: string | null, companyId: string | null, exclude: Set<string>) => {
    const code = normalizeCode(positionId);
    return code ? `${code}##${normalizeCode(companyId)}##${Array.from(exclude).sort().join("|")}` : null;
  };

  /** A candidate can't stand in for a position they occupy themselves — that
   *  would match their own assessment and hand out a free ~1.0. Employee ids are
   *  inconsistently zero-padded across sync tables, so exclude every variant. */
  const excludeFor = (c: AhpCandidate): Set<string> => {
    const out = new Set<string>();
    const raw = (c.employeeId ?? "").trim();
    if (!raw) return out;
    out.add(raw);
    out.add(raw.padStart(5, "0").slice(0, 5));
    out.add(raw.replace(/^0+/, ""));
    return out;
  };

  // Resolve every fallback BEFORE calibrating, so the anchors are chosen knowing
  // how much of the run actually depends on them.
  const fallbackByCand = new Map<string, (FallbackResult | null)[]>();
  for (const c of candidates) {
    const exclude = excludeFor(c);
    fallbackByCand.set(
      c.id,
      (recordsByCand.get(c.id) ?? []).map((r) =>
        r.documentSimilarity != null
          ? null
          : computeFallback(r.stint.positionId, r.stint.companyId, exclude)
      )
    );
  }

  const needsCalibration = Array.from(fallbackByCand.values()).some((list) =>
    list.some(Boolean)
  );
  // Pinned wins over a freshly derived range — an incremental run must keep the
  // SAME raw-coverage → similarity mapping the carried-over candidates were
  // scored with, not one derived from only the added subset's (often too small)
  // document-matched sample.
  const calibration = needsCalibration
    ? pinnedCalibration
      ? {
          lo: pinnedCalibration.lo,
          hi: pinnedCalibration.hi,
          source: "inherited" as const,
          cap: pinnedCalibration.cap ?? 1,
          sampleCount: pinnedCalibration.sampleCount,
          idfWeighted: pinnedCalibration.idfWeighted ?? false,
          reason: `Run inkremental — memakai kalibrasi fallback run dasar (lo=${pinnedCalibration.lo.toFixed(3)}, hi=${pinnedCalibration.hi.toFixed(3)}) agar kandidat baru sebanding dengan kandidat yang dibawa dari run sebelumnya.`,
        }
      : calibrateFallback(documentSims, anchors, Boolean(idfWeightFor))
    : null;
  if (traceOut) {
    const fbCfg = config.ahpTopsis.careerFallback;
    traceOut.calibration = calibration
      ? {
          lo: calibration.lo,
          hi: calibration.hi,
          // The full band `hi` is a `cap` of; unknown on an inherited band, whose
          // parent recorded only lo/hi.
          hiFull: calibration.source === "inherited" ? null : (fbCfg.anchorHiPinned ?? anchors.simCeil),
          cap: calibration.cap,
          source: calibration.source,
          pinnedLo: fbCfg.anchorLoPinned,
          pinnedHi: fbCfg.anchorHiPinned,
        }
      : null;
    traceOut.idf = idf
      ? { census: idf.census ?? null, docCount: idf.docCount, unseenWeight: idf.unseenWeight }
      : null;
  }

  // ── Pass 2a: assemble pairs, accumulate effective relevant experience ──
  //
  // Scoring still cannot happen here, even though the depth targets no longer
  // depend on the pool: the pool medians are reported as diagnostics and are only
  // known once every candidate has been accumulated. So this pass measures and
  // pass 2b turns the measurements into scores.
  const coverage = {
    documentStints: 0,
    fallbackStints: 0,
    unscoredStints: 0,
    documentYears: 0,
    fallbackYears: 0,
    unscoredYears: 0,
    unscoredByReason: {
      no_target_reference: 0,
      no_position_code: 0,
      no_incumbent_competency: 0,
    } as Record<CareerUnscoredReason, number>,
  };

  type Accumulated = {
    pairs: CareerPair[];
    /** Σ(sim'×years) — effective relevant years. */
    effectiveYears: number;
    /** Σ(sim') — effective relevant stints. */
    effectiveRows: number;
    matchedYears: number;
    totalYears: number;
    matchedCount: number;
    unmatchedCount: number;
    documentCount: number;
    documentYears: number;
    fallbackCount: number;
    fallbackYears: number;
    unscoredCount: number;
    unscoredYears: number;
  };

  const accumulated = new Map<string, Accumulated>();
  /** Per-stint trace rows, filled beside the accumulation from the SAME values. */
  const stintTraceByCand = new Map<string, CareerStintTrace[]>();

  for (const c of candidates) {
    const records = recordsByCand.get(c.id) ?? [];
    const fallbacks = fallbackByCand.get(c.id) ?? [];
    const stintTraces: CareerStintTrace[] = [];
    const excludeIds = traceOut ? excludeFor(c) : null;

    const pairs: CareerPair[] = [];
    let effectiveYears = 0;
    let effectiveRows = 0;
    let matchedYears = 0;
    let totalYears = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;
    let documentCount = 0;
    let documentYears = 0;
    let fallbackCount = 0;
    let fallbackYears = 0;
    let unscoredCount = 0;
    let unscoredYears = 0;

    for (let i = 0; i < records.length; i++) {
      const r = records[i]!;
      const fb = fallbacks[i] ?? null;

      let similarityRaw = r.documentSimilarity;
      let basis: CareerScoreBasis = similarityRaw != null ? "document" : "unscored";
      let matchType = r.matchType;

      if (similarityRaw == null && fb && calibration) {
        similarityRaw = applyCalibration(fb.raw, calibration);
        basis = "incumbent_competency";
        matchType = "incumbent_competency";
      }

      // One rescale for BOTH paths, applied after the fallback has been
      // calibrated onto the document scale — so document and competency stints
      // stay commensurate while the criterion gains a meaningful 0..1.
      const similarity = similarityRaw != null ? rescaleSim(similarityRaw, anchors) : null;
      // Human-capital depreciation: relevance decays once the work stops. Nothing
      // decayed before, so a stint that ended in 2006 counted exactly as much as
      // the one the candidate holds today — `isCurrent` was recorded and never
      // reached the score. Applied to BOTH axes: an assignment long finished is
      // less of a qualifying assignment too, not only fewer relevant years.
      const recencyD = recencyDetail(r.stint.validTo, asOf);
      const recency = recencyD.factor;
      const stintEffectiveYears = similarity != null ? similarity * r.years * recency : 0;
      if (traceOut) {
        const from = r.stint.validFrom ? new Date(r.stint.validFrom) : null;
        stintTraces.push({
          index: i,
          title: r.stint.title,
          positionId: r.stint.positionId,
          companyId: r.stint.companyId,
          synthetic: syntheticStint.has(r.stint),
          validFrom: isoOrNull(r.stint.validFrom),
          validTo: isoOrNull(r.stint.validTo),
          validFromLocal: localDateString(from),
          ongoing: isOngoingTo(r.stint.validTo),
          tenureEnd: isoOrNull(r.tenure.end),
          tenureEndLocal: localDateString(r.tenure.end),
          clampedToReference: r.tenure.clamped,
          wholeMonths: r.tenure.wholeMonths,
          years: r.years,
          isCurrent: r.isCurrent,
          status: r.status,
          matchType: matchType,
          jobProfileId: r.jobProfileId,
          jobProfileName: r.jobProfileName,
          documentSimilarity: r.documentSimilarity,
          fallbackKey:
            r.documentSimilarity == null && fallbackEnabled
              ? fallbackKeyFor(r.stint.positionId, r.stint.companyId, excludeIds!)
              : null,
          fallbackRaw: fb ? fb.raw : null,
          calibrated: basis === "incumbent_competency" ? similarityRaw : null,
          similarityRaw,
          similarity,
          yearsSinceEnd: recencyD.yearsSince,
          recency,
          effectiveYears: stintEffectiveYears,
          effectiveRows: similarity != null ? similarity * recency : 0,
          basis,
          unscoredReason: null,
        });
      }

      totalYears += r.years;
      if (similarity != null) {
        effectiveYears += stintEffectiveYears;
        effectiveRows += similarity * recency;
        matchedYears += r.years;
        matchedCount += 1;
      } else {
        unmatchedCount += 1;
      }

      // Which of the three fallback failures this was — decided from the same
      // inputs computeFallback gates on, so the reported cause is the actual one.
      let unscoredReason: CareerUnscoredReason | null = null;
      if (basis === "unscored") {
        unscoredReason = !fallbackEnabled
          ? "no_target_reference"
          : !normalizeCode(r.stint.positionId)
            ? "no_position_code"
            : "no_incumbent_competency";
      }
      if (traceOut) stintTraces[stintTraces.length - 1]!.unscoredReason = unscoredReason;

      if (basis === "document") {
        documentCount += 1;
        documentYears += r.years;
      } else if (basis === "incumbent_competency") {
        fallbackCount += 1;
        fallbackYears += r.years;
      } else {
        unscoredCount += 1;
        unscoredYears += r.years;
        coverage.unscoredByReason[unscoredReason!] += 1;
      }

      pairs.push({
        positionId: r.stint.positionId,
        companyId: r.stint.companyId,
        title: r.stint.title,
        years: r.years,
        isCurrent: r.isCurrent,
        status: r.status,
        matchType,
        jobProfileId: r.jobProfileId,
        jobProfileName: r.jobProfileName,
        similarity,
        similarityRaw: similarityRaw != null ? Number(similarityRaw.toFixed(4)) : null,
        recencyFactor: Number(recency.toFixed(4)),
        effectiveYears: Number(stintEffectiveYears.toFixed(4)),
        basis,
        unscoredReason,
        fallbackRaw: fb ? Number(fb.raw.toFixed(4)) : null,
        fallbackEmployeeIds: fb ? fb.employeeIds : [],
        fallbackBasis: fb ? fb.basis : null,
        fallbackPairs: basis === "incumbent_competency" && fb ? fb.pairs : [],
      });
    }

    if (traceOut) stintTraceByCand.set(c.id, stintTraces);
    coverage.documentStints += documentCount;
    coverage.fallbackStints += fallbackCount;
    coverage.unscoredStints += unscoredCount;
    coverage.documentYears += documentYears;
    coverage.fallbackYears += fallbackYears;
    coverage.unscoredYears += unscoredYears;

    accumulated.set(c.id, {
      pairs,
      effectiveYears,
      effectiveRows,
      matchedYears,
      totalYears,
      matchedCount,
      unmatchedCount,
      documentCount,
      documentYears,
      fallbackCount,
      fallbackYears,
      unscoredCount,
      unscoredYears,
    });
  }

  // ── Derive the yardstick from the pool, then pass 2b: score ──
  const scale: CareerScale = {
    simFloor: Number(anchors.simFloor.toFixed(4)),
    simCeil: Number(anchors.simCeil.toFixed(4)),
    source: anchors.source,
    sampleCount: anchors.sampleCount,
    docCount: anchors.docCount,
    estimates: anchors.estimates,
    reason: `Kemiripan mentah direntangkan ke 0..1 dengan batas ${anchors.simFloor.toFixed(3)}–${anchors.simCeil.toFixed(3)} (model dokumen: ${config.embedding.documentEmbeddingModel}). Di bawah batas bawah dianggap tidak relevan sama sekali. ${anchors.reason} Batas ini tetap di dalam maupun antar-run — bukan persentil per-run — agar skor sebanding antar-run dan antar-jabatan, tetapi ia DIUKUR, sehingga ikut berubah bila dokumen job profile di-embed ulang.`,
  };

  // The appointment census, for when the JD states no usable minimum. Resolved
  // here rather than inside deriveDepthTargets so that function stays pure and
  // testable, and so a DB failure degrades to the configured constant instead of
  // failing the run.
  const depthCensus =
    config.ahpTopsis.career.defaultSource === "measured"
      ? await resolveCareerDepthCensusCached().catch(() => null)
      : null;

  const depth = deriveDepthTargets(
    candidates.map((c) => accumulated.get(c.id)?.effectiveYears ?? 0),
    candidates.map((c) => accumulated.get(c.id)?.effectiveRows ?? 0),
    pinnedDepth ?? null,
    targetStatedExperience,
    position.title,
    depthCensus,
    traceOut?.depth
  );

  /**
   * Saturating attainment on one axis. γ = 1 is `min(1, x)` exactly, so the
   * default path is unchanged; γ > 1 gives the concave Mincer-style curve, which
   * measured WORSE for this objective and is therefore off by default (see
   * config: career.concavity).
   */
  const saturate = (x: number): number => {
    const c = Math.max(0, Math.min(1, x));
    return depth.concavity > 1 ? Math.pow(c, 1 / depth.concavity) : c;
  };

  let done = 0;
  for (const c of candidates) {
    const a = accumulated.get(c.id)!;

    // Depth of relevant experience carries the score; breadth of assignments only
    // MODULATES it. This replaced min(depthYears, depthRows), which threw away the
    // strongest evidence this criterion can receive — a decade in the exact target
    // job, held as one assignment, was capped by its own single-stint count and
    // scored 47 while support-only candidates scored 100.
    const depthYears =
      depth.targetYears > 0 ? saturate(a.effectiveYears / depth.targetYears) : 0;
    const depthRows =
      depth.targetRows > 0 ? saturate(a.effectiveRows / depth.targetRows) : 0;
    const w = depth.breadthWeight;
    const normalized = Math.max(0, Math.min(1, depthYears * (1 - w + w * depthRows)));
    const score = Math.round(normalized * 100);
    if (traceOut) {
      traceOut.candidates.set(c.id, {
        excludeEmployeeIds: Array.from(excludeFor(c)).sort(),
        stints: stintTraceByCand.get(c.id) ?? [],
        effectiveYears: a.effectiveYears,
        effectiveRows: a.effectiveRows,
        depthYears,
        depthRows,
        normalized,
        score,
        binding: 1 - depthYears >= w * (1 - depthRows) ? "years" : "rows",
      });
    }

    scores.set(c.id, score);
    details.set(c.id, {
      score,
      normalized,
      effectiveYears: Number(a.effectiveYears.toFixed(3)),
      effectiveRows: Number(a.effectiveRows.toFixed(3)),
      depthYears: Number(depthYears.toFixed(4)),
      depthRows: Number(depthRows.toFixed(4)),
      // Which axis costs this candidate more. Under the multiplicative shape the
      // losses are not symmetric — depth can cost the whole score, breadth at
      // most `breadthWeight` of it — so this compares the actual points lost
      // rather than the two attainments, which under the old min() were directly
      // comparable and no longer are.
      binding: 1 - depthYears >= w * (1 - depthRows) ? "years" : "rows",
      targetYears: depth.targetYears,
      targetRows: depth.targetRows,
      targetSource: depth.source,
      breadthWeight: depth.breadthWeight,
      concavity: depth.concavity,
      recencyDecayPerYear: depth.recencyDecayPerYear,
      statedExperienceYears: depth.statedExperienceYears,
      statedExperienceText: depth.statedExperienceText,
      statedIgnoredReason: depth.statedIgnoredReason,
      statedMode: depth.statedMode,
      statedMultiplier: depth.statedMultiplier,
      levelLabel: depth.levelLabel,
      measured: depth.measured,
      meanSimilarity:
        a.matchedYears > 0 ? Number((a.effectiveYears / a.matchedYears).toFixed(4)) : 0,
      matchedYears: a.matchedYears,
      totalYears: a.totalYears,
      targetStatus,
      targetJobProfileId: targetJpId,
      targetJobProfileName,
      matchedCount: a.matchedCount,
      unmatchedCount: a.unmatchedCount,
      pairs: a.pairs,
      documentCount: a.documentCount,
      documentYears: Number(a.documentYears.toFixed(2)),
      fallbackCount: a.fallbackCount,
      fallbackYears: Number(a.fallbackYears.toFixed(2)),
      unscoredCount: a.unscoredCount,
      unscoredYears: Number(a.unscoredYears.toFixed(2)),
      coverage:
        a.totalYears > 0 ? Number((a.matchedYears / a.totalYears).toFixed(4)) : 0,
      calibration,
    });

    done += 1;
    if (onProgress && (done % 5 === 0 || done === candidates.length)) {
      await onProgress(done, candidates.length);
    }
  }

  // ── Run-level diagnostics: every degradation is stated, never implied ──
  const messages: string[] = [];
  if (targetStatus === "no_match") {
    messages.push(
      `Posisi target "${position.title}" tidak dapat dipasangkan ke job profile mana pun (dicoba: kode file_name, job_family_matches, judul sama, kemiripan embedding > 98%, lalu kode posisi incumbent).`
    );
  } else if (targetStatus === "no_embedding") {
    messages.push(
      `Posisi target "${position.title}" dipasangkan ke job profile "${targetJobProfileName ?? targetJpId}" namun embedding dokumennya belum tersedia (job_profile_embed) — jalankan "Bangun Ulang Embedding" di Configuration.`
    );
  }
  if (pseudoNote) messages.push(pseudoNote);
  if (calibration) {
    messages.push(
      `${coverage.fallbackStints} stint dinilai lewat pencocokan kompetensi incumbent terhadap ${targetRefs.length} kompetensi acuan (sumber: ${target.source}). ${calibration.reason}`
    );
  }
  if (coverage.unscoredStints > 0) {
    // Name the actual cause per group. Reporting all of them as "the position has
    // no recorded holder" was wrong for two of the three and sent the operator to
    // sync_employee_positions when the gap was in the target's competency
    // reference or in the history rows' own position codes.
    const by = coverage.unscoredByReason;
    const causes: string[] = [];
    if (by.no_target_reference > 0) {
      causes.push(
        `${by.no_target_reference} karena posisi target tidak punya acuan kompetensi sama sekali (job profile, daftar kompetensi posisi, incumbent, dan pemegang posisi semuanya kosong), sehingga fallback tidak dapat dijalankan untuk stint mana pun`
      );
    }
    if (by.no_position_code > 0) {
      causes.push(
        `${by.no_position_code} karena stint hanya tercatat sebagai judul tanpa kode posisi, sehingga pemegang posisinya tidak dapat dicari`
      );
    }
    if (by.no_incumbent_competency > 0) {
      causes.push(
        `${by.no_incumbent_competency} karena kode posisinya diketahui namun tidak ada pemegang yang dapat dipakai (posisi kosong, atau hanya kandidat itu sendiri) atau pemegangnya tidak punya baris kompetensi di sync_technical_competencies`
      );
    }
    messages.push(
      `${coverage.unscoredStints} stint (${coverage.unscoredYears.toFixed(1)} tahun) tidak dapat dinilai sama sekali: ${causes.join("; ")}. Stint ini bernilai 0 dalam akumulasi pengalaman relevan.`
    );
  } else if (!fallbackEnabled && targetStatus !== "ok") {
    // No stint to attribute it to (an empty history), but the run is still
    // degraded and the criterion is about to be dropped downstream.
    messages.push(
      "Fallback kompetensi tidak dapat dijalankan karena posisi target tidak punya acuan kompetensi sama sekali."
    );
  }
  // The scale and the yardstick both change what the number MEANS, so neither is
  // ever left implicit — same rule the fallback calibration follows.
  messages.push(
    `Similarity direntangkan ke 0..1 dengan anchor tetap ${scale.simFloor}–${scale.simCeil} (cosine mentah bukan persentase). Skor = min(kedalaman tahun, kedalaman stint) × 100. ${depth.reason}`
  );

  const runInfo: CareerRunInfo = {
    targetStatus,
    targetJobProfileId: targetJpId,
    targetJobProfileName,
    targetMatchType,
    message: messages.length > 0 ? messages.join(" ") : null,
    calibration,
    scale,
    depth,
    fallbackRequiredCount: targetRefs.length,
    fallbackRequiredSource: target.source,
    idf:
      idf && calibration
        ? {
            docCount: idf.docCount,
            keyCount: idf.keyCount,
            mostCommon: idf.mostCommon,
            reason: idf.reason,
          }
        : null,
    coverage: {
      documentStints: coverage.documentStints,
      fallbackStints: coverage.fallbackStints,
      unscoredStints: coverage.unscoredStints,
      documentYears: Number(coverage.documentYears.toFixed(2)),
      fallbackYears: Number(coverage.fallbackYears.toFixed(2)),
      unscoredYears: Number(coverage.unscoredYears.toFixed(2)),
      unscoredByReason: { ...coverage.unscoredByReason },
    },
  };

  if (traceOut) {
    traceOut.target = {
      jobProfileId: targetJpId,
      jobProfileName: targetJobProfileName,
      matchType: targetMatchType,
      status: targetStatus,
      statedExperience: targetStatedExperience,
      pinned: Boolean(pinnedTarget),
    };
  }

  return {
    scores,
    details,
    runInfo,
    target: {
      jobProfileId: targetJpId,
      jobProfileName: targetJobProfileName,
      matchType: targetMatchType,
      status: targetStatus,
      vector: targetVec,
      pseudoNote,
      statedExperience: targetStatedExperience,
    },
  };
}

// ─── Aspect 3: Behavior (ordinal ranking rule) ───────────────────

// Ordered best → worst, used for fuzzy string matching. Categories are scored
// in PAIRS per the methodology document (both members of a pair share one
// ordinal value, 6 = best … 0 = worst) — see BEHAVIOR_VALUES below.
const BEHAVIOR_RANKING = [
  "VERY HIGH", // ── 6
  "STRENGTH",
  "HIGH", // ── 5
  "READY",
  "MIDDLE HIGH", // ── 4
  "PENGEMBANGAN JANGKA PENDEK",
  "READY WITH DEVELOPMENT", // ── 3
  "POTENSI",
  "NEED DEVELOPMENT (9 MONTHS - 2 YEARS)", // ── 2
  "MIDDLE LOW",
  "FOCUS ON OPTIMIZATION IN CURRENT POSITION", // ── 1
  "LOW",
  "BELUM ADA POTENSI", // ── 0
  "VERY LOW",
  "NOT READY", // ── 0 (also a hard-filter reject per the doc)
] as const;

// Doc's categorical value per ranking index: paired categories share a value.
const BEHAVIOR_VALUES: number[] = [6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 0];
const BEHAVIOR_VALUE_MAX = 6;

function normalizeBehavior(value: string): string {
  return value
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns the ranking index (0 = best) or null when unrecognized. */
export function behaviorRankIndex(value: string | null | undefined): number | null {
  return behaviorRankMatch(value).index;
}

/** `behaviorRankIndex` plus HOW the label was matched, for the run trace. */
function behaviorRankMatch(value: string | null | undefined): {
  normalized: string | null;
  index: number | null;
  method: "exact" | "contains" | "contained" | "none";
} {
  if (!value) return { normalized: null, index: null, method: "none" };
  const v = normalizeBehavior(value);
  if (!v || v === "-") return { normalized: v || null, index: null, method: "none" };

  const exact = BEHAVIOR_RANKING.findIndex((c) => c === v);
  if (exact !== -1) return { normalized: v, index: exact, method: "exact" };

  // Value carries extra decoration → longest category contained in it wins.
  let byContains: number | null = null;
  let byContainsLen = -1;
  // Value is a truncation → shortest category containing it wins.
  let byContained: number | null = null;
  let byContainedLen = Infinity;
  for (let i = 0; i < BEHAVIOR_RANKING.length; i++) {
    const cat = BEHAVIOR_RANKING[i]!;
    if (v.includes(cat) && cat.length > byContainsLen) {
      byContains = i;
      byContainsLen = cat.length;
    }
    if (cat.includes(v) && cat.length < byContainedLen) {
      byContained = i;
      byContainedLen = cat.length;
    }
  }
  if (byContains != null) return { normalized: v, index: byContains, method: "contains" };
  if (byContained != null) return { normalized: v, index: byContained, method: "contained" };
  return { normalized: v, index: null, method: "none" };
}

export function scoreBehaviorAspect(value: string | null | undefined): number {
  return traceBehaviorAspect(value).score;
}

/** `scoreBehaviorAspect` with the matched category, its index and ordinal value. */
export function traceBehaviorAspect(value: string | null | undefined): BehaviorTrace {
  const m = behaviorRankMatch(value);
  // Missing/unknown assessments score 0 — no positive evidence to rank.
  if (m.index === null) {
    return { raw: value ?? null, normalized: m.normalized, method: m.method, index: null, category: null, value: null, score: 0 };
  }
  // Doc scale: paired categories share an ordinal value 6..0 → scale to 0-100.
  const v = BEHAVIOR_VALUES[m.index] ?? 0;
  return {
    raw: value ?? null,
    normalized: m.normalized,
    method: m.method,
    index: m.index,
    category: BEHAVIOR_RANKING[m.index] ?? null,
    value: v,
    score: Math.round((v * 100) / BEHAVIOR_VALUE_MAX),
  };
}

// ─── Aspect 4: Performance Appraisal ───
//
// Lives in ./pa-score.ts. See the header there.

// ─── Aspect 6: Education (exact-match → grounded Gemini) ────────────
//
// Problem this solves: a pure LLM education score is prone to run-to-run
// variance. Two guards remove it:
//   1. A DETERMINISTIC exact-match against the job profile's stated education
//      requirement short-circuits to a fixed 100 with zero model involvement.
//   2. When no exact match, a GROUNDED Gemini call (temperature 0, topP 0,
//      Google-Search grounding, fixed rubric, JSON-only + validate/retry)
//      judges whether the candidate's education level + major fits the
//      position's responsibilities + success indicators, and cites its sources.
// There is intentionally NO BERT similarity fallback: it over-scored irrelevant
// majors, so a non-exact match is judged ONLY by grounded Gemini. If Gemini is
// unconfigured or never validates, education is reported as "tidak dinilai" (0).

const EDUCATION_PROMPT_KEY = "ahp_education_grounded";
const EDUCATION_PROMPT_DEFAULT = `Anda adalah AI Decision Support System untuk HR. Tugas Anda: menilai apakah LATAR BELAKANG PENDIDIKAN kandidat (jenjang + jurusan) SESUAI untuk MENGERJAKAN tanggung jawab (responsibilities) dan MENCAPAI indikator keberhasilan (success indicators) sebuah posisi target.

DASAR PENILAIAN adalah daftar TANGGUNG JAWAB + INDIKATOR KEBERHASILAN posisi — BUKAN sekadar syarat minimal pendidikan yang tertulis. Syarat minimal pendidikan hanyalah konteks tambahan.

Anda WAJIB menggunakan Grounding with Google Search untuk memverifikasi, berdasarkan sumber nyata, apakah jenjang & bidang studi kandidat memang memadai/relevan untuk menjalankan tanggung jawab tersebut dan mencapai indikator keberhasilannya. Rumuskan kueri seperti: "apakah lulusan <jenjang> <jurusan> mampu/relevan untuk <tanggung jawab / indikator keberhasilan>?". WAJIB MENGUTIP sumber temuan di dalam "reason".

Aturan penilaian (RUBRIK TETAP — gunakan sebagai anchor, nilai 0-100):
- 100 = sangat sesuai/relevan
- 80  = relevan
- 60  = cukup
- 40  = kurang
- 20  = tidak relevan

Definisi:
- education_level: seberapa memadai JENJANG pendidikan kandidat untuk mengerjakan tanggung jawab & mencapai indikator keberhasilan posisi (pertimbangkan kompleksitas dan tingkat tanggung jawabnya), diverifikasi via grounding. Jika jenjang jelas di bawah tuntutan pekerjaan, beri nilai rendah.
- major_relevance: seberapa relevan BIDANG STUDI (jurusan) kandidat terhadap tanggung jawab & indikator keberhasilan posisi, diverifikasi via grounding.
- reason: penjelasan singkat 1-3 kalimat yang MENGUTIP temuan grounding (sertakan nama sumber bila ada). Wajib untuk keperluan gap analysis.

WAJIB: Kembalikan HANYA satu objek JSON, tanpa teks lain, tanpa markdown, dengan struktur PERSIS:
{"education_level": <angka 0-100>, "major_relevance": <angka 0-100>, "reason": "<teks>"}`;

/**
 * The education system prompt in force: the stored one (Tata Kelola → Prompt
 * Scoring) or the shipped default. Exported so a test keys exactly what the
 * scorer sends.
 */
export function educationSystemPrompt(): string {
  return getPrompt(EDUCATION_PROMPT_KEY, EDUCATION_PROMPT_DEFAULT);
}

// ── Education normalization + deterministic exact-match ──

// Canonical education-level ranks (higher = more advanced). Synonyms folded in.
//
// D4 shares S1's rank on purpose: both sit at KKNI level 6, so "D4" against an
// "S1" requirement is an EQUAL match, not a shortfall. Leaving it at 7 sent every
// D4 holder down the LLM path against the ~60 job profiles that ask for S1.
// Rank 7 is now unused; the numbers are ordinal comparators, so a gap costs
// nothing and records that the promotion was deliberate.
//
// English labels are here because that is what this deployment's HR source
// actually stores — `SENIOR HIGH SCHOOL`, `JUNIOR HIGH SCHOOL`,
// `ELEMENTARY SCHOOL`. Without them those candidates rank 0, which fails the
// level test and pushes every one of them to the LLM scorer.
//
// `sederajat` is deliberately NOT here. It is a modifier ("SMA/SMK sederajat"),
// already a stopword, and giving it rank 3 was a trap: "Minimal S1 atau
// sederajat" yielded ranks [8,3], and the minimum branch takes the LOWEST — so an
// SMA holder would satisfy an S1 requirement. Dropping it is safe because the
// levels it accompanies are always spelled out beside it.
const EDU_LEVEL_RANK: Record<string, number> = {
  sd: 1, elementary: 1,
  smp: 2, sltp: 2, mts: 2,
  sma: 3, smk: 3, slta: 3, stm: 3, man: 3, smea: 3, aliyah: 3,
  d1: 4,
  d2: 5,
  d3: 6, diploma: 6, ahlimadya: 6,
  // d4 == s1 (KKNI level 6). Rank 7 intentionally left unused.
  d4: 8,
  s1: 8, sarjana: 8, bachelor: 8, strata1: 8,
  s2: 9, magister: 9, master: 9, pascasarjana: 9,
  s3: 10, doktor: 10, doctoral: 10, phd: 10,
};

const EDU_STOPWORDS = new Set([
  "minimal", "min", "pendidikan", "jenjang", "atau", "dan", "and", "or",
  "semua", "jurusan", "all", "any", "sederajat", "diutamakan", "preferably",
  "dari", "bidang", "yang", "relevan", "terkait", "sesuai", "dengan",
]);

/**
 * Field-of-study words folded to one spelling before the major is compared.
 *
 * The HR source stores majors in ENGLISH while job profiles are written in
 * INDONESIAN, so the two sides frequently name the same field in different
 * languages and share no token at all: `ACCOUNTING` (61 candidates) against
 * "S1 Akuntansi", `MANAGEMENT` (57) against "S1 Manajemen", `ECONOMIC` (28)
 * against "S1 Ekonomi", plus LAW/Hukum, PSYCHOLOGY/Psikologi and
 * COMMUNICATIONS/Komunikasi.
 *
 * That gap predates the all-tokens rule — the old any-token rule missed these
 * too — but the stricter rule makes it bite harder, so it is closed here rather
 * than left to burn a grounded Gemini call on a major the candidate demonstrably
 * holds.
 *
 * Only word-for-word translations and observed misspellings are folded. Fields
 * that merely sound similar are deliberately NOT folded: `informatika`
 * (Informatics) and `sistem informasi` (Information Systems) stay distinct, which
 * is exactly the discrimination the all-tokens rule exists to preserve.
 */
const MAJOR_SYNONYM: Record<string, string> = {
  // English → Indonesian
  management: "manajemen",
  accounting: "akuntansi", akunting: "akuntansi",
  economic: "ekonomi", economics: "ekonomi", economy: "ekonomi",
  law: "hukum",
  psychology: "psikologi",
  communication: "komunikasi", communications: "komunikasi",
  engineering: "teknik",
  informatics: "informatika",
  finance: "keuangan",
  marketing: "pemasaran",
  industrial: "industri",
  mechanical: "mesin",
  electrical: "elektro", electronics: "elektronika",
  civil: "sipil",
  business: "bisnis",
  information: "informasi",
  system: "sistem", systems: "sistem",
  mathematics: "matematika", math: "matematika",
  agriculture: "pertanian",
  automotive: "otomotif",
  architecture: "arsitektur",
  taxation: "perpajakan",
  // Indonesian spelling variants seen in this data
  statistika: "statistik",
  // Observed misspelling — "TEKNIK INDRUSTRI" is recorded for 5 candidates.
  indrustri: "industri",
};

const foldMajorToken = (t: string): string => MAJOR_SYNONYM[t] ?? t;

/**
 * Split into lowercase alphanumeric tokens.
 *
 * Multi-word and punctuated forms are collapsed FIRST, because the next step
 * flattens punctuation to spaces and a phrase would then never key into
 * EDU_LEVEL_RANK. Each rule below is a form this deployment's data actually
 * contains:
 *   "S-1" / "S 1" / "S.1"  — 5 of 113 job profiles write it this way, and they
 *                            could not produce an exact match for ANY candidate.
 *   "AHLI MADYA"           — the `ahlimadya` key was unreachable without this.
 *   "SARJANA TERAPAN"      — the formal name of D4.
 *   English school names   — what the HR source stores for the school levels.
 */
function eduTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/strata\s*([123])/g, "strata$1")
    // \b on BOTH sides is load-bearing. Without the leading boundary any word
    // ending in s or d followed by a digit loses its last letter: "Kelas 3"
    // would become "Kela" + "s3" and inject a doctorate-level rank.
    .replace(/\b([sd])\s*[-.]?\s*([1234])\b/g, "$1$2")
    .replace(/ahli\s*madya/g, "ahlimadya")
    .replace(/sarjana\s*terapan/g, "d4")
    .replace(/senior\s*high\s*school/g, "sma")
    .replace(/junior\s*high\s*school/g, "smp")
    .replace(/vocational\s*(?:high\s*)?school/g, "smk")
    .replace(/elementary\s*school/g, "sd")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Canonical rank of a candidate's education-level string (0 = unknown). */
function candidateLevelRank(education: string | null): number {
  let best = 0;
  for (const tok of eduTokens(education ?? "")) {
    const r = EDU_LEVEL_RANK[tok];
    if (r && r > best) best = r;
  }
  return best;
}

type ExactMatch = {
  matched: boolean;
  matchedTokens: string[];
  reason: string;
  comparison: 'higher' | 'equal' | 'lower' | null;
  /** Major-axis internals, for the run trace. Absent on the early no-data return. */
  anyMajor?: boolean;
  alternatives?: string[][];
  candidateMajorTokens?: string[];
  hit?: string[] | null;
};

/** The level axis, scored by rule. `lower` is reachable only via the LLM path. */
const EDU_LEVEL_TIER_SCORE: Record<'higher' | 'equal' | 'lower', number> = {
  higher: 100,
  equal: 80,
  lower: 50,
};

export type EducationLevelVerdict = {
  comparison: 'higher' | 'equal' | 'lower' | null;
  /** EDU_LEVEL_TIER_SCORE of the comparison; null when it cannot be determined. */
  score: number | null;
  candidateRank: number;
  /** The rank actually compared against (the minimum, when phrased as one). */
  requiredRank: number | null;
  isMinimum: boolean;
  /** Every level rank the requirement names, in order (for the run trace). */
  requiredRanks?: number[];
};

/**
 * Compare a candidate's education LEVEL against the requirement — by rule, and
 * for BOTH scoring paths.
 *
 * This used to live inside `exactEducationMatch`, which meant the rule only
 * applied when the MAJOR also matched exactly. Anything routed to grounded Gemini
 * had its level judged by the model instead, so the principle the rule exists to
 * enforce — a level ABOVE the stated minimum is worth more than one merely equal
 * to it — silently stopped applying to most candidates. Worse, whether the rule
 * applied at all depended on something unrelated: the major.
 *
 * The level is a ladder comparison over data the app already normalises. There is
 * nothing here for a language model to judge, and letting it try produced a
 * second, invisible standard. So the comparison is computed here, always, and the
 * LLM's opinion about level is folded into the MAJOR axis instead (see
 * `scoreEducationAspect`).
 *
 * `lower` becomes meaningful for the first time: the exact-match path rejects a
 * below-requirement candidate outright, so that tier was unreachable. On the
 * grounding path it is exactly the candidate who needs it.
 */
export function compareEducationLevel(
  education: string | null,
  requirement: string | null
): EducationLevelVerdict {
  const none: EducationLevelVerdict = {
    comparison: null,
    score: null,
    candidateRank: 0,
    requiredRank: null,
    isMinimum: false,
  };
  if (!requirement) return none;

  const reqLower = requirement.toLowerCase();
  const isMinimum = /\b(minimal|min|setidaknya|paling\s*rendah)\b/.test(reqLower);
  const reqRanks = eduTokens(requirement)
    .map((t) => EDU_LEVEL_RANK[t])
    .filter((r): r is number => Boolean(r));
  const candRank = candidateLevelRank(education);

  // Neither side states a recognisable level → no comparison exists. Reported as
  // undeterminable rather than guessed, and the caller drops the axis.
  if (reqRanks.length === 0 || candRank === 0) {
    return { ...none, candidateRank: candRank, isMinimum, requiredRanks: reqRanks };
  }

  // Phrased as a minimum → compare against the lowest level named. Otherwise the
  // requirement names exact acceptable levels, and anything else is a miss in one
  // direction or the other.
  const requiredRank = isMinimum ? Math.min(...reqRanks) : Math.min(...reqRanks);
  let comparison: 'higher' | 'equal' | 'lower';
  if (isMinimum) {
    comparison = candRank > requiredRank ? "higher" : candRank === requiredRank ? "equal" : "lower";
  } else if (reqRanks.includes(candRank)) {
    comparison = "equal";
  } else {
    comparison = candRank > Math.max(...reqRanks) ? "higher" : "lower";
  }

  return {
    comparison,
    score: EDU_LEVEL_TIER_SCORE[comparison],
    candidateRank: candRank,
    requiredRank,
    isMinimum,
    requiredRanks: reqRanks,
  };
}

/**
 * Deterministic token exact-match of a candidate's education level + major
 * against the job profile's stated education requirement. Level is satisfied
 * when the candidate's rank meets/exceeds the requirement (or equals it exactly
 * when the requirement is not phrased as a minimum); major is satisfied when the
 * requirement is "semua/any jurusan" or the candidate's major tokens intersect
 * the requirement's major tokens. Both satisfied → exact match (→ tiered score:
 * higher=100, equal=80, lower=50).
 */
export function exactEducationMatch(
  education: string | null,
  major: string | null,
  requirement: string | null
): ExactMatch {
  if (!requirement || (!education && !major)) {
    return { matched: false, matchedTokens: [], reason: "", comparison: null };
  }

  const reqLower = requirement.toLowerCase();
  const anyMajor = /\b(semua|any|all)\b/.test(reqLower); // "semua jurusan"

  const lvl = compareEducationLevel(education, requirement);
  const levelOk = lvl.comparison === "higher" || lvl.comparison === "equal";
  const comparison = levelOk ? lvl.comparison : null;
  const matchedTokens: string[] = [];
  if (levelOk) {
    for (const tok of eduTokens(education ?? "")) {
      if (EDU_LEVEL_RANK[tok]) matchedTokens.push(tok);
    }
  }

  // ── Major: ALL tokens of ONE acceptable major, or fall through to grounding ──
  //
  // This used to accept a single overlapping token, which made different majors
  // read as identical: requirement "Manajemen Informatika" vs candidate "Teknik
  // Informatika" share `informatika`, so it scored a full exact-match tier when
  // the two are plainly different fields and should have been judged by grounded
  // search. The rule is now "every required token present", which sends that pair
  // to Gemini — where "Sistem Informasi" vs "Manajemen Informatika" already lands
  // correctly despite sharing NO token.
  //
  // But "every token of the requirement" cannot be applied to the requirement as
  // a whole, because most of them list ALTERNATIVES: "S1 Ekonomi / Manajemen /
  // Akuntansi" means any one of three, not all three at once. So the requirement
  // is split into alternatives first and each is matched whole.
  //
  // Direction is deliberate: every token of the alternative must be present in
  // the CANDIDATE's major, not the reverse. So requirement "Informatika" is
  // satisfied by "Manajemen Informatika" (the candidate covers what was asked),
  // while requirement "Manajemen Informatika" is NOT satisfied by "Informatika"
  // alone. Set equality would reject the first, which is over-strict.
  const majorTokensOf = (text: string) =>
    eduTokens(text)
      .filter((t) => !EDU_LEVEL_RANK[t] && !EDU_STOPWORDS.has(t))
      .map(foldMajorToken);

  // Parenthesised clauses are preferences, never requirements — every one in this
  // corpus reads "(diutamakan X)" / "(utamakan X)". Leaving them in would make the
  // preference mandatory under the all-tokens rule.
  const reqForMajor = requirement.replace(/\([^)]*\)/g, " ");
  const alternatives = reqForMajor
    .split(/[/,;]|\batau\b|\bor\b/i)
    .map(majorTokensOf)
    .filter((toks) => toks.length > 0);

  const candMajorTokens = new Set(
    eduTokens(major ?? "")
      .filter((t) => !EDU_STOPWORDS.has(t))
      .map(foldMajorToken)
  );

  let majorOk = false;
  let hitAlternative: string[] | null = null;
  if (anyMajor || alternatives.length === 0) {
    majorOk = true; // "Semua Jurusan", or the requirement names only a level
  } else {
    const hit = alternatives.find((toks) => toks.every((t) => candMajorTokens.has(t)));
    if (hit) {
      majorOk = true;
      hitAlternative = hit;
      matchedTokens.push(...hit);
    }
  }

  const matched = levelOk && majorOk;
  const cmpLabel = matched && comparison ? { higher: 'lebih tinggi', equal: 'setara', lower: 'lebih rendah' }[comparison] : null;
  const reason = matched
    ? `Exact match: jenjang & bidang studi kandidat (${education ?? "-"} / ${major ?? "-"}) memenuhi persyaratan "${requirement}"${
        anyMajor ? " (semua jurusan)" : ""
      }${cmpLabel ? ` (${cmpLabel})` : ""}. Token cocok: ${Array.from(new Set(matchedTokens)).join(", ") || "-"}.`
    : "";

  return {
    matched,
    matchedTokens: Array.from(new Set(matchedTokens)),
    reason,
    comparison: matched ? comparison : null,
    anyMajor,
    alternatives,
    candidateMajorTokens: Array.from(candMajorTokens),
    hit: hitAlternative,
  };
}

/**
 * Combine the grounded model's two answers with the rule-derived level axis.
 *
 * TWO AXES, and only one of them is the model's to decide:
 *   level axis — by rule (compareEducationLevel). Never the model's.
 *   major axis — the accumulation of BOTH grounded answers, mean(level, major).
 *
 * The model is still ASKED about level and major separately, because those are
 * genuinely different searches and its reading of whether a level suits the
 * responsibilities is useful evidence. But that reading lands in the MAJOR axis,
 * not in its own — otherwise the ladder rule ("above the stated minimum is worth
 * more than merely equal") would hold on the exact-match path and be quietly
 * overridden by a model opinion everywhere else, which is the inconsistency this
 * fixes.
 *
 * Equal weight between the two axes, matching the exact-match path's shape:
 *   higher level + perfect major = (100 + 100)/2 = 100
 *   equal  level + perfect major = ( 80 + 100)/2 =  90
 *   higher level + weak major 40 = (100 +  40)/2 =  70
 *   equal  level + weak major 40 = ( 80 +  40)/2 =  60
 * So a higher level always outscores an equal one at identical major relevance,
 * on both paths.
 *
 * When the level cannot be determined (neither side names a recognisable level),
 * the axis is DROPPED rather than filled with a guess, and the score is the major
 * axis alone — the same "drop, don't zero" rule the engine applies to any
 * criterion nobody can be scored on.
 */
export function composeEducationScore(
  parsed: { education_level: number; major_relevance: number },
  levelVerdict: EducationLevelVerdict
): Pick<
  EducationEvaluation,
  "score" | "educationLevel" | "majorRelevance" | "groundedMajorAxis" | "levelScore" | "levelComparison"
> {
  const groundedMajorAxis = Math.round(
    (parsed.education_level + parsed.major_relevance) / 2
  );
  const score =
    levelVerdict.score != null
      ? Math.round((levelVerdict.score + groundedMajorAxis) / 2)
      : groundedMajorAxis;
  return {
    score,
    educationLevel: parsed.education_level,
    majorRelevance: parsed.major_relevance,
    groundedMajorAxis,
    levelScore: levelVerdict.score,
    levelComparison: levelVerdict.comparison,
  };
}

// ── Grounded Gemini scorer (deterministic, cited, JSON-validated + retry) ──

async function evaluateEducationWithGemini(
  candidate: AhpCandidate,
  /**
   * Resolved ONCE by the caller and handed in, together with the key computed
   * from the same text, so the question asked and the question fingerprinted for
   * reuse cannot differ (education-reuse.ts).
   */
  systemPrompt: string,
  input: EducationPromptInput,
  inputKey: string,
  /**
   * The level axis, already decided by rule. Passed in rather than derived here so
   * this function cannot accidentally become a second source of truth for it.
   */
  levelVerdict: EducationLevelVerdict
): Promise<EducationEvaluation> {
  // Byte-identical to the prompt this function used to build inline; the only
  // part not covered by `inputKey` is the candidate's name.
  const userPrompt = buildEducationUserPrompt(candidate.name, input);

  // Grounded attempts first. Grounding forbids Gemini's native JSON mode, so
  // the shape is only prompt-enforced and the model DOES sometimes answer with
  // a prose analysis instead — hence the retries and the repair pass below.
  const maxAttempts = 1 + config.ahpTopsis.educationMaxRetries;
  let lastError = "tidak diketahui";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { text, searchQueries, sources } = await callGeminiGrounded(
        systemPrompt,
        userPrompt
      );
      const parsed = parseEducationJson(text); // throws → retry
      const composed = composeEducationScore(parsed, levelVerdict);
      return makeEduEval({
        ...composed,
        source: "llm-grounded",
        reason: parsed.reason,
        searchQueries,
        sources,
        inputKey,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log("ahpTopsis.educationGeminiRetry", {
        candidate: candidate.name,
        attempt,
        maxAttempts,
        error: lastError,
      });
      // fall through to next attempt; then to the structured repair pass
    }
  }

  // Repair pass: same rubric, grounding OFF + native structured output
  // (responseMimeType/responseSchema), which the API cannot answer with prose.
  // A rubric score without citations beats "tidak dinilai" (0), which would
  // otherwise drag the candidate's TOPSIS position down for a formatting fault.
  try {
    const { text } = await callGeminiGrounded(systemPrompt, userPrompt, {
      grounding: false,
      responseSchema: EDUCATION_RESPONSE_SCHEMA,
    });
    const parsed = parseEducationJson(text);
    const composed = composeEducationScore(parsed, levelVerdict);
    log("ahpTopsis.educationStructuredFallback", {
      candidate: candidate.name,
      score: composed.score,
      afterError: lastError,
    });
    return makeEduEval({
      ...composed,
      source: "llm-structured",
      reason: parsed.reason,
      inputKey,
    });
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    log("ahpTopsis.educationStructuredFailed", {
      candidate: candidate.name,
      error: lastError,
    });
  }

  // Signal the precise failure so the caller can report it verbatim instead of
  // always blaming invalid JSON.
  throw new Error(lastError);
}

export async function scoreEducationAspect(
  candidates: AhpCandidate[],
  position: PositionRow,
  jobProfile: JobProfileMatch | null,
  /** Incumbent's own education + major — the benchmark when the position states none. */
  incumbentRequirement: string | null,
  onProgress: (done: number, total: number) => Promise<void>,
  signal?: AbortSignal,
  /**
   * The requirement as already RESOLVED by the run (its position basis). A root
   * resolves it from the same three tiers below and passes the result; a child
   * passes its parent's (FR-RR-07), so a requirement edited since the parent
   * cannot reach the new candidates. Undefined keeps the in-function resolution.
   */
  requirementOverride?: { requirement: string | null },
  /** Run trace (drizzle/0092): ranks, tokens and the path each candidate took. */
  traceOut?: { map: Map<string, EducationTrace>; requirementSource: string },
  /**
   * Model answers that may be reused (education-reuse.ts): the last completed
   * run of this position, or null. Filled in with what this call did, for
   * `runInfo.education.reuse`.
   */
  reuse?: EducationReuseTally
): Promise<Map<string, EducationEvaluation>> {
  const results = new Map<string, EducationEvaluation>();
  const responsibilityDetails = jobProfile?.responsibilityDetails ?? [];
  const jobPurpose = jobProfile?.jobPurpose ?? null;
  // The system prompt and model settings, resolved ONCE for the whole pool: they
  // are part of what a reused answer must have been asked under, and resolving
  // them per candidate would let a prompt edit mid-run split the pool.
  const systemPrompt = educationSystemPrompt();
  const modelSettings: EducationModelSettings = {
    model: config.gemini.model,
    grounding: config.gemini.enableGrounding,
    groundingTool: config.gemini.groundingTool,
    temperature: config.gemini.temperature,
    topP: config.gemini.topP,
  };
  // Prefer the job profile's extracted education requirement, then the critical
  // position's stated education column, then the INCUMBENT's own education —
  // when nothing states the requirement, the person doing the job is the
  // benchmark. Without this last tier a profile-less position scores every
  // candidate against `null`, which no exact match can ever hit.
  const requirement = requirementOverride
    ? requirementOverride.requirement
    : (jobProfile?.educationRequirement ?? position.education ?? incumbentRequirement ?? null);
  if (!requirementOverride && !jobProfile?.educationRequirement && !position.education && incumbentRequirement) {
    log("ahpTopsis.educationRequirementFromIncumbent", {
      position: position.title,
      requirement: incumbentRequirement,
    });
  }
  // Grounding on/off is handled inside the Gemini client; here we only need a key.
  const geminiReady = geminiConfigured();
  if (!geminiReady) {
    // Grounded Gemini is the ONLY scorer for non-exact matches (BERT similarity
    // was removed — it over-scored irrelevant majors, e.g. "Ekonomi Studi
    // Pembangunan" vs "S1 Manajemen Informatika"). Without a key those
    // candidates come back "tidak dinilai" (0). Make the misconfig loud.
    log("ahpTopsis.educationGeminiNotConfigured", {
      position: position.title,
      note: "GEMINI_API_KEY tidak diset — skor edukasi non-exact-match TIDAK dapat dinilai (grounded Gemini wajib; fallback BERT sudah dihapus).",
    });
  }

  const EXACT_TIER_SCORES: Record<string, number> = { higher: 100, equal: 80, lower: 50 };

  // Per-candidate scorer: exact-match (per token) → grounded Gemini. NO BERT
  // fallback — a non-exact match is judged ONLY by grounded Gemini; if that
  // can't run (no key) or fails validation after retries, education is reported
  // as "tidak dinilai" (0) rather than an inaccurate similarity number.
  const scoreOne = async (c: AhpCandidate): Promise<EducationEvaluation> => {
    // The level axis is decided by RULE, once, and used by BOTH paths below. It
    // used to be computed only inside the exact-match check, which meant a
    // candidate routed to grounding had their level judged by the model instead —
    // so whether the ladder rule applied depended on whether the MAJOR matched.
    const levelVerdict = compareEducationLevel(c.education, requirement);

    // 1. Deterministic exact-match short-circuit (tiered: higher=100, equal=80, lower=50).
    const em = exactEducationMatch(c.education, c.major, requirement);
    const evaluation = await scoreOneInner(c, levelVerdict, em);
    if (traceOut) {
      traceOut.map.set(c.id, {
        education: c.education ?? null,
        major: c.major ?? null,
        requirement,
        requirementSource: traceOut.requirementSource,
        level: {
          candidateRank: levelVerdict.candidateRank,
          requiredRank: levelVerdict.requiredRank,
          requiredRanks: levelVerdict.requiredRanks ?? [],
          isMinimum: levelVerdict.isMinimum,
          comparison: levelVerdict.comparison,
          score: levelVerdict.score,
        },
        exact: {
          matched: em.matched,
          anyMajor: em.anyMajor ?? false,
          alternatives: em.alternatives ?? [],
          candidateMajorTokens: em.candidateMajorTokens ?? [],
          hit: em.hit ?? null,
        },
        path: evaluation.source,
        llm:
          evaluation.educationLevel != null && evaluation.majorRelevance != null && evaluation.groundedMajorAxis != null
            ? {
                educationLevel: evaluation.educationLevel,
                majorRelevance: evaluation.majorRelevance,
                groundedMajorAxis: evaluation.groundedMajorAxis,
              }
            : null,
        score: evaluation.score,
        // The llm numbers above were answered in an earlier run when set.
        reusedFrom: evaluation.reusedFrom,
      });
    }
    return evaluation;
  };

  const scoreOneInner = async (
    c: AhpCandidate,
    levelVerdict: EducationLevelVerdict,
    em: ExactMatch
  ): Promise<EducationEvaluation> => {
    if (em.matched) {
      // The tier table is the ONLY rule here. `em.comparison ?? 'equal'` is
      // always one of its three keys, so the lookup can never miss — the
      // `?? config.ahpTopsis.educationExactMatchScore` that used to sit here was
      // unreachable, and its presence implied a flat-score path that no longer
      // exists. Runs made before the tiering DID use that flat value, which is
      // why some stored exact-match scores (90 here) match no tier; see
      // lib/education-tier.ts for how those are explained without being rewritten.
      const tier = em.comparison ?? 'equal';
      return makeEduEval({
        score: EXACT_TIER_SCORES[tier]!,
        source: "exact-match",
        // The tier that produced the score, recorded so a reader never has to
        // infer it (or invent a different rule) from the number alone.
        exactComparison: tier,
        // Same verdict, recorded under the path-neutral fields so every reader
        // sees one level axis regardless of which path scored the candidate.
        levelScore: EXACT_TIER_SCORES[tier]!,
        levelComparison: tier,
        reason: em.reason,
        matchedTokens: em.matchedTokens,
      });
    }
    // 2. No exact match → grounded Gemini (with a structured repair pass) —
    //    unless the last run of this position already asked the model this
    //    exact question about this candidate, in which case its answer is reused.
    let llmError: string | null = null;
    if (c.education || c.major) {
      const input: EducationPromptInput = {
        education: c.education,
        major: c.major,
        requirement,
        positionTitle: position.title,
        jobPurpose,
        responsibilityDetails,
      };
      const inputKey = educationInputKey(systemPrompt, input, modelSettings);
      if (reuse) reuse.eligible += 1;
      const hit = reuse ? reusableAnswerFor(reuse.source, c.id, inputKey) : null;
      if (hit) {
        reuse!.reused += 1;
        // The MODEL's answer is reused; the level axis is this run's rule.
        const composed = composeEducationScore(
          { education_level: hit.educationLevel, major_relevance: hit.majorRelevance },
          levelVerdict
        );
        return makeEduEval({
          ...composed,
          source: hit.source,
          reason: hit.reason,
          searchQueries: hit.searchQueries,
          sources: hit.sources,
          inputKey,
          reusedFrom: hit.provenance,
        });
      }
      if (geminiReady) {
        if (reuse) reuse.modelCalls += 1;
        try {
          return await evaluateEducationWithGemini(c, systemPrompt, input, inputKey, levelVerdict);
        } catch (err) {
          llmError = err instanceof Error ? err.message : String(err);
        }
      }
    }
    // 3. Not assessable (no education data, Gemini unconfigured, or every
    //    attempt failed) → explicit "tidak dinilai" quoting the ACTUAL error, so
    //    a quota/HTTP failure isn't misreported as invalid JSON.
    return makeEduEval({
      score: 0,
      source: "none",
      levelScore: levelVerdict.score,
      levelComparison: levelVerdict.comparison,
      reason:
        !c.education && !c.major
          ? "Kandidat tidak memiliki data pendidikan/jurusan untuk dinilai."
          : geminiReady
            ? `Skor edukasi tidak tersedia: seluruh percobaan penilaian Gemini (grounded + structured output) gagal. Penyebab terakhir: ${llmError ?? "tidak diketahui"}.`
            : "Skor edukasi tidak tersedia: GEMINI_API_KEY belum diset sehingga penilaian grounded Gemini (wajib untuk non-exact-match) tidak dapat dijalankan.",
    });
  };

  // Worker pool over candidates.
  let done = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      if (signal?.aborted) return;
      const c = candidates[cursor++]!;
      results.set(c.id, await scoreOne(c));
      done += 1;
      if (done % 5 === 0 || done === candidates.length) {
        await onProgress(done, candidates.length);
      }
    }
  };
  const workers = Array.from(
    { length: Math.min(config.ahpTopsis.educationLlmConcurrency, candidates.length) },
    () => worker()
  );
  await Promise.all(workers);
  await onProgress(candidates.length, candidates.length);

  return results;
}

// ─── AHP weights resolution ──────────────────────────────────────
//
// resolveAhpWeights lives in ahp-weights.ts — see the header there.

/**
 * Print the AHP configuration resolved for a run — source, priority weights,
 * consistency diagnostics, and the full pairwise matrix — as a readable block to
 * the console, plus a structured `ahpTopsis.config` log entry.
 */
function logAhpConfiguration(info: {
  runId: string | null;
  sessionId: string;
  position: string;
  source: string;
  weights: Record<AhpCriterionKey, number>;
  cr: number;
  lambdaMax: number;
  ci: number;
  pairwise: number[][];
}): void {
  const order = AHP_CRITERIA_ORDER;
  const pad = (s: string, n: number) => s.padEnd(n).slice(0, n);
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

  const lines: string[] = [];
  lines.push("");
  lines.push("╔═══════════════════════════════════════════════════════════════");
  lines.push(`║ AHP CONFIG — run ${info.runId ?? "(baru)"} · ${info.position}`);
  lines.push("╠═══════════════════════════════════════════════════════════════");
  lines.push(`║ Sumber bobot : ${info.source}`);
  lines.push(
    `║ Konsistensi  : CR=${info.cr.toFixed(4)} ${
      info.cr > 0.1 ? "(> 0.1 — KURANG konsisten)" : "(≤ 0.1 — konsisten)"
    } · λmax=${info.lambdaMax.toFixed(4)} · CI=${info.ci.toFixed(4)}`
  );
  lines.push("║ Bobot prioritas:");
  for (const k of order) {
    lines.push(`║   ${pad(k, 12)}: ${(info.weights[k] * 100).toFixed(1).padStart(5)}%`);
  }
  lines.push("║ Matriks pairwise (skala Saaty):");
  lines.push(`║   ${pad("", 12)}${order.map((k) => pad(k.slice(0, 5), 7)).join("")}`);
  info.pairwise.forEach((row, i) => {
    lines.push(`║   ${pad(order[i]!, 12)}${row.map((v) => pad(fmt(v), 7)).join("")}`);
  });
  lines.push("╚═══════════════════════════════════════════════════════════════");
  console.log(lines.join("\n"));

  // Structured mirror for log scrapers/aggregators.
  log("ahpTopsis.config", {
    sessionId: info.sessionId,
    runId: info.runId,
    source: info.source,
    cr: Number(info.cr.toFixed(4)),
    lambdaMax: Number(info.lambdaMax.toFixed(4)),
    ci: Number(info.ci.toFixed(4)),
    weights: Object.fromEntries(
      order.map((k) => [k, Number((info.weights[k] * 100).toFixed(1))])
    ),
    pairwise: info.pairwise.map((r) => r.map((v) => Number(v.toFixed(4)))),
  });
}

// ─── Progress reporting (polled by the wizard via final_ranked) ─

export type AhpProgress = {
  phase: string;
  done: number;
  total: number;
};

async function setAhpProgress(sessionId: string, progress: AhpProgress) {
  // MERGE (||) rather than replace: `final_ranked` also carries the augment
  // spec (`ahpRerun`) written at session creation, which must survive every
  // progress tick so a restarted service still knows this is an incremental run.
  await execute(
    `UPDATE tournament_sessions
     SET final_ranked = COALESCE(final_ranked, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ ahpProgress: progress }), sessionId]
  );
}

// ─── Deterministic narrative (no LLM) ────────────────────────────

const ASPECT_NARRATIVE: Record<AhpCriterionKey, { strong: string; weak: string; recommendation: string }> = {
  technical: {
    strong: "Kompetensi teknis sangat relevan dengan kebutuhan posisi (kemiripan semantik tinggi)",
    weak: "Cakupan kompetensi teknis terhadap kebutuhan posisi masih rendah",
    recommendation: "Ikutkan pelatihan/sertifikasi teknis yang menutup gap kompetensi posisi target",
  },
  career: {
    strong: "Jejak karier (posisi saat ini & riwayat jabatan) sangat relevan dengan profil pekerjaan posisi target",
    weak: "Relevansi jejak karier terhadap profil pekerjaan posisi target masih rendah",
    recommendation: "Berikan penugasan/rotasi yang mendekatkan pengalaman kandidat ke lingkup posisi target",
  },
  behavior: {
    strong: "Hasil asesmen behavior berada pada kategori peringkat atas",
    weak: "Hasil asesmen behavior berada pada kategori peringkat bawah atau belum tersedia",
    recommendation: "Jadwalkan (ulang) asesmen behavior dan program coaching kepemimpinan",
  },
  performance: {
    strong: "Rekam jejak Performance Appraisal konsisten mendekati ideal (grade A/B terkini)",
    weak: "Rekam jejak Performance Appraisal masih jauh dari solusi ideal positif",
    recommendation: "Susun target kinerja terukur dan review berkala untuk memperbaiki tren PA",
  },
  hav: {
    strong: "Posisi kuadran HAV berada di kelompok yang direkomendasikan",
    weak: "Posisi kuadran HAV berada di kelompok prioritas rendah",
    recommendation: "Validasi ulang pemetaan HAV dan susun rencana pengembangan potensi",
  },
  education: {
    strong: "Latar belakang pendidikan berkorelasi kuat dengan tanggung jawab pekerjaan",
    weak: "Korelasi latar belakang pendidikan terhadap tanggung jawab pekerjaan masih rendah",
    recommendation: "Dorong pendidikan lanjutan/sertifikasi yang relevan dengan tanggung jawab posisi",
  },
};

function buildNarrative(
  rank: number,
  closeness: number,
  aspectScores: Record<AhpCriterionKey, number>,
  educationEval: EducationEvaluation | undefined
) {
  const entries = AHP_CRITERIA_ORDER.map((k) => ({ key: k, score: aspectScores[k] }));
  const sorted = [...entries].sort((a, b) => b.score - a.score);
  const top = sorted.slice(0, 2);
  const bottom = sorted.slice(-2).reverse();

  const justification =
    `Peringkat #${rank} berdasarkan metode AHP + TOPSIS dengan closeness coefficient ${closeness.toFixed(4)} ` +
    `(semakin mendekati 1 semakin dekat ke solusi ideal). ` +
    `Aspek terkuat: ${top.map((t) => `${CRITERIA_LABELS[t.key]} (${t.score})`).join(" dan ")}. ` +
    `Aspek yang perlu dikembangkan: ${bottom.map((b) => `${CRITERIA_LABELS[b.key]} (${b.score})`).join(" dan ")}. ` +
    `Seluruh skor aspek dihitung secara deterministik (BERT similarity, aturan peringkat, dan TOPSIS) sehingga hasil dapat direproduksi.`;

  const strengths = entries
    .filter((e) => e.score >= 70)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((e) => `${ASPECT_NARRATIVE[e.key].strong} — skor ${e.score}/100.`);

  const weaknesses = entries
    .filter((e) => e.score < 50)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((e) => `${ASPECT_NARRATIVE[e.key].weak} — skor ${e.score}/100.`);

  const recommendations = entries
    .filter((e) => e.score < 60)
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((e) => `${ASPECT_NARRATIVE[e.key].recommendation}.`);

  // Surface the education rationale when it's a strength: the grounded/exact
  // reason (new path) or the strongest legacy per-responsibility item.
  const eduScore = educationEval?.score ?? 0;
  if (educationEval?.reason && strengths.length < 4 && eduScore >= 70) {
    strengths.push(educationEval.reason);
  } else {
    const bestEduItem = educationEval?.items
      ?.slice()
      .sort((a, b) => b.score - a.score)[0];
    if (bestEduItem?.analysis && strengths.length < 4 && bestEduItem.score >= 70) {
      strengths.push(bestEduItem.analysis);
    }
  }

  return {
    justification,
    strengths: strengths.length ? strengths : ["Profil dinilai lengkap tanpa aspek menonjol di atas ambang 70."],
    weaknesses,
    recommendations: recommendations.length
      ? recommendations
      : ["Pertahankan kinerja dan kesiapan pada seluruh aspek."],
  };
}

// ─── Frozen-run helpers (pure; see rerun-freeze.ts) ───────────────

/**
 * The six aspect scores TOPSIS ranks, per candidate.
 *
 * A carried candidate (`reused`) takes ALL SIX from its parent — a value the
 * parent did not record (null behavior/performance/HAV on very old rows) is the
 * only thing that falls through to the computed map. Everyone else takes what
 * this run computed, with the engine's long-standing no-data defaults.
 */
export function assembleAspectScores(
  candidateIds: string[],
  computed: Record<AhpCriterionKey, Map<string, number>>,
  reused: Map<string, CachedAspects>
): Map<string, Record<AhpCriterionKey, number>> {
  return new Map(
    candidateIds.map((id) => {
      const hit = reused.get(id);
      return [
        id,
        {
          technical: hit ? hit.technical : (computed.technical.get(id) ?? 0),
          career: hit ? hit.career : (computed.career.get(id) ?? 0),
          behavior: hit?.baseBehavior ?? computed.behavior.get(id) ?? 0,
          performance: hit?.basePerformance ?? computed.performance.get(id) ?? 50,
          hav: hit?.baseHav ?? computed.hav.get(id) ?? 40,
          education: hit ? hit.educationEval.score : (computed.education.get(id) ?? 0),
        },
      ];
    })
  );
}

/**
 * One `scoring_run_pool_aspects` row's two JSON blobs, exactly as persisted —
 * which is what a child's `loadCachedAspects` reads back. A carried candidate
 * whose parent recorded no raw strings keeps `rawInputs: null` rather than
 * storing today's strings as if they were the root's.
 */
export function poolAspectRecord(input: {
  aspects: Record<AhpCriterionKey, number>;
  technicalMatching: TechnicalDetail | null;
  careerMatching: CareerDetail | null;
  educationEval: EducationEvaluation | null;
  /** What `displayRaw` returned for this candidate. */
  raw: Record<string, unknown>;
  reusedHit: CachedAspects | null;
  /** True when these aspects are placeholders, not measurements ("skor sementara"). */
  provisional?: boolean;
  /**
   * This run's TOPSIS output for the candidate at FULL precision. The
   * `closeness` column is numeric(10,6); keeping the unrounded values lets a
   * replay of the ranking from stored data be checked to 1e-9 (NFR-RR-01).
   */
  topsis?: { closeness: number; dPlus: number; dMinus: number } | null;
}): { aspects: string; details: string } {
  return {
    aspects: JSON.stringify(input.aspects),
    details: JSON.stringify({
      technicalMatching: input.technicalMatching,
      careerMatching: input.careerMatching,
      educationEval: input.educationEval,
      // Persisted so a LATER derived run that freezes these scores can also
      // freeze the strings they were computed from. Three short strings.
      rawInputs: input.reusedHit && !input.reusedHit.baseRaw ? null : input.raw,
      provisional: input.provisional === true,
      topsis: input.topsis ?? null,
    }),
  };
}

const knownAnchorSource = (v: string): "env" | "measured" | "fallback" =>
  v === "env" || v === "fallback" ? v : "measured";

/** The parent's technical anchors as this engine's type, or null to resolve live. */
export function inheritedTechnicalAnchors(frozen: FrozenRunBasis | null): TechnicalAnchors | null {
  const t = frozen?.anchors.technical;
  if (!t) return null;
  return {
    simFloor: t.simFloor,
    simCeil: t.simCeil,
    source: knownAnchorSource(t.source),
    reason: `Diwarisi dari run induk (akar ${frozen!.rootRunId}) — tidak diukur ulang, agar kandidat tambahan direntangkan ke skala yang sama dengan kandidat lama.`,
    sampleCount: 0,
    codeCount: 0,
  };
}

/** The parent's career anchors as this engine's type, or null to resolve live. */
export function inheritedCareerAnchors(frozen: FrozenRunBasis | null): CareerAnchors | null {
  const c = frozen?.anchors.career;
  if (!c) return null;
  return {
    simFloor: c.simFloor,
    simCeil: c.simCeil,
    source: knownAnchorSource(c.source),
    reason: `Diwarisi dari run induk (akar ${frozen!.rootRunId}) — tidak diukur ulang.`,
    sampleCount: 0,
    docCount: 0,
    estimates: [],
  };
}

// ─── Run trace: the parameters this process scored with (drizzle/0092) ───
//
// Every constant and env-tunable value a formula in this file reads, captured
// when the run is computed. Several of them (the level span, the surplus, the
// decay rates, the fallback cap) are env-tunable and were never recorded per
// run, so a finished ranking could not say which value produced it.

function collectTraceParameters(): TraceParameters {
  const career = config.ahpTopsis.career;
  const fallback = config.ahpTopsis.careerFallback;
  return {
    technical: {
      levelGapSpan: LEVEL_GAP_SPAN,
      overQualificationSurplus: OVER_QUALIFICATION_SURPLUS,
      levelFactorCeiling: LEVEL_FACTOR_CEILING,
      unknownLevelStandIn: 1,
      defaultRequiredLevel: 2,
      configFallbackFloor: config.ahpTopsis.technical.simFloor,
      configFallbackCeil: config.ahpTopsis.technical.simCeil,
      anchorsMinCodes: TECHNICAL_ANCHOR_PARAMS.minCodes,
      anchorsMinSpread: TECHNICAL_ANCHOR_PARAMS.minSpread,
      anchorsFloorPercentile: TECHNICAL_ANCHOR_PARAMS.floorPercentile,
      anchorsCeilPercentile: TECHNICAL_ANCHOR_PARAMS.ceilPercentile,
    },
    career: {
      breadthWeight: career.breadthWeight,
      concavity: career.concavity,
      recencyDecayPerYear: career.recencyDecayPerYear,
      daysPerYear: 365.25,
      fixedTargetYears: career.fixedTargetYears,
      fixedTargetRows: career.fixedTargetRows,
      minTargetYears: career.minTargetYears,
      maxTargetYears: career.maxTargetYears,
      minTargetRows: career.minTargetRows,
      maxTargetRows: career.maxTargetRows,
      statedMode: career.statedMode,
      statedExperienceMultiplier: career.statedExperienceMultiplier,
      statedExperienceOnlyAboveFixed: career.statedExperienceOnlyAboveFixed,
      useStatedExperience: career.useStatedExperience,
      defaultSource: career.defaultSource,
      titleEmbedMinSim: CAREER_EMBED_MIN_SIM,
      undatedStintYears: 1,
      configFallbackFloor: career.simFloor,
      configFallbackCeil: career.simCeil,
    },
    careerFallback: {
      cap: fallback.cap,
      useIdf: fallback.useIdf,
      anchorLoPinned: fallback.anchorLoPinned,
      anchorHiPinned: fallback.anchorHiPinned,
      idfMinWeight: COMPETENCY_IDF_PARAMS.minWeight,
      idfUnseenFallbackDf: COMPETENCY_IDF_PARAMS.unseenFallbackDf,
    },
    careerAnchors: { ...CAREER_ANCHOR_PARAMS },
    careerDepthCensus: {
      minLevelSamples: CAREER_DEPTH_CENSUS_PARAMS.minLevelSamples,
      levelOrder: [...CAREER_DEPTH_CENSUS_PARAMS.levelOrder],
    },
    performance: {
      gradeValues: { ...PA_GRADE_VALUES },
      idealPositive: PA_IDEAL_POSITIVE,
      idealNegative: PA_IDEAL_NEGATIVE,
      maxPeriods: PA_MAX_PERIODS,
      recencyDecay: PA_RECENCY_DECAY,
      periodWeights: [...PA_PERIOD_WEIGHTS],
    },
    hav: {
      groupScores: Object.fromEntries(Object.entries(HAV_GROUP_SCORES).map(([k, v]) => [k, v])),
      missingScore: 40,
      quadrantMatrix: JSON.parse(JSON.stringify(HAV_QUADRANT_MATRIX)),
    },
    behavior: {
      ranking: [...BEHAVIOR_RANKING],
      values: [...BEHAVIOR_VALUES],
      valueMax: BEHAVIOR_VALUE_MAX,
      missingScore: 0,
    },
    education: {
      tierScores: { ...EDU_LEVEL_TIER_SCORE },
      levelRanks: { ...EDU_LEVEL_RANK },
      maxRetries: config.ahpTopsis.educationMaxRetries,
      model: config.gemini.model || null,
      groundingEnabled: config.gemini.enableGrounding,
      configured: geminiConfigured(),
    },
    ahp: {
      order: [...AHP_CRITERIA_ORDER],
      defaultWeights: { ...DEFAULT_WEIGHTS },
      randomIndex: [...RANDOM_INDEX],
    },
    topsis: {
      criterionType: "benefit",
      zeroNormStandIn: 1e-9,
      tieCloseness: 0.5,
      tieBreak: "closeness menurun, lalu candidate_id menaik (String.localeCompare)",
    },
  };
}

/** The HAV aspect's trace for one candidate, from the tiers loaded with it. */
function havTraceFor(c: AhpCandidate, rawOverride?: string | null): HavTrace {
  const raw = rawOverride !== undefined ? rawOverride : c.havQuadrant ?? null;
  const t = traceHavScore(raw);
  const eff = c.havEffective ?? null;
  return {
    raw,
    source: c.havSource ?? "none",
    manual: eff?.manual ?? null,
    uploaded: eff?.uploaded ?? null,
    formula: eff?.formula ?? null,
    performanceBand: performanceBand(c.performanceGrade) ?? null,
    competencyBand: competencyBand((c.behaviorRecommendation ?? "").trim()) ?? null,
    digits: t.digits,
    quadrant: t.quadrant,
    score: t.score,
  };
}

// ─── Readiness from a run's own thresholds (FR-SN-04) ────────────

type ReadinessThresholds = {
  thresholds: { minScore: number; level: string }[];
  defaultLevel: string;
};

/** A run's `config_snapshot.readiness`, or null when it has none usable. */
export function parseReadinessThresholds(raw: unknown): ReadinessThresholds | null {
  const r = raw as { thresholds?: unknown; defaultLevel?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.thresholds)) return null;
  const thresholds = r.thresholds
    .map((t: any) => ({ minScore: Number(t?.minScore), level: String(t?.level ?? "") }))
    .filter((t) => Number.isFinite(t.minScore) && t.level.length > 0);
  if (thresholds.length === 0 || typeof r.defaultLevel !== "string") return null;
  return { thresholds, defaultLevel: r.defaultLevel };
}

/** The same walk `determineReadiness` does over the live file, over given thresholds. */
export function readinessFromThresholds(cfg: ReadinessThresholds, score: number): string {
  for (const t of cfg.thresholds) if (score >= t.minScore) return t.level;
  return cfg.defaultLevel;
}

// ─── Data versions a run was computed over (FR-SN-01 item 7) ─────

/**
 * When each sync source last succeeded, and fingerprints of the two corpora
 * the scores read. Recorded, never enforced: it lets a reader tell whether two
 * runs of the same seat saw the same data.
 */
async function loadDataVersions(kamus: { fingerprint: string; codes: number } | null) {
  const [syncRows, corpus] = await Promise.all([
    query<{ jobKey: string; finishedAt: Date | string | null }>(
      `SELECT job_key AS "jobKey", max(finished_at) AS "finishedAt"
         FROM sync_runs
        WHERE status = 'success'
        GROUP BY job_key`
    ).catch(() => [] as { jobKey: string; finishedAt: Date | string | null }[]),
    queryOne<{ fingerprint: string | null; documents: number | string | null }>(
      `SELECT md5(string_agg(id::text || ':' || COALESCE(file_hash, '') || ':' ||
                             md5(COALESCE(extracted_data::text, '')), ',' ORDER BY id)) AS fingerprint,
              count(*)::int AS documents
         FROM sync_job_profiles
        WHERE status = 'completed'`
    ).catch(() => null),
  ]);
  return {
    lastSyncByJob: Object.fromEntries(
      syncRows.map((r) => [r.jobKey, r.finishedAt ? new Date(r.finishedAt).toISOString() : null])
    ) as Record<string, string | null>,
    jobProfileCorpus: {
      fingerprint: corpus?.fingerprint ?? null,
      documents: Number(corpus?.documents ?? 0),
    },
    kamus: { fingerprint: kamus?.fingerprint ?? null, codes: kamus?.codes ?? null },
  };
}

// ─── Position basis helpers (FR-RR-07) ───────────────────────────

/** A frozen job profile back into the engine's own shape. */
function jobProfileFromFrozen(fjp: FrozenJobProfile | null): JobProfileMatch | null {
  if (!fjp) return null;
  return {
    id: fjp.id,
    matchTier: fjp.matchTier,
    contentHash: fjp.contentHash,
    positionName: fjp.positionName,
    jobPurpose: fjp.jobPurpose,
    responsibilities: [...fjp.responsibilities],
    responsibilityDetails: fjp.responsibilityDetails.map((r) => ({ ...r })),
    requiredCompetencies: fjp.requiredCompetencies.map((r) => ({ ...r })),
    educationRequirement: fjp.educationRequirement,
    challenges: [...fjp.challenges],
  };
}

/** The values of a resolved job profile, as a run records them. */
function frozenFromJobProfile(jp: JobProfileMatch | null): FrozenJobProfile | null {
  if (!jp) return null;
  return {
    id: jp.id,
    matchTier: jp.matchTier,
    contentHash: jp.contentHash,
    positionName: jp.positionName,
    jobPurpose: jp.jobPurpose,
    responsibilities: [...jp.responsibilities],
    responsibilityDetails: jp.responsibilityDetails.map((r) => ({ ...r })),
    requiredCompetencies: jp.requiredCompetencies.map((r) => ({ ...r })),
    educationRequirement: jp.educationRequirement,
    challenges: [...jp.challenges],
  };
}

type EducationRequirementSource = PositionBasis["education"]["source"];

/**
 * The education requirement from the same three tiers `scoreEducationAspect`
 * has always used — job profile, then the position's own column, then the
 * incumbent's education — with WHICH tier answered.
 */
function resolveEducationRequirement(
  jobProfile: JobProfileMatch | null,
  positionEducation: string | null | undefined,
  incumbentRequirement: string | null
): { requirement: string | null; source: EducationRequirementSource } {
  if (jobProfile?.educationRequirement) {
    return { requirement: jobProfile.educationRequirement, source: "profile" };
  }
  if (positionEducation) return { requirement: positionEducation, source: "critical_position" };
  if (incumbentRequirement) return { requirement: incumbentRequirement, source: "incumbent" };
  return { requirement: null, source: "none" };
}

/**
 * A frozen education requirement, or null when the parent did not record one
 * (`recorded: false` on runs made while the old encryption key was locked) —
 * the caller then resolves live and reports it.
 */
function readFrozenEducation(
  basis: PositionBasis
): { requirement: string | null; source: EducationRequirementSource } | null {
  const e = basis.education;
  if (!e.recorded) return null;
  if (e.source !== "incumbent") return { requirement: e.requirement, source: e.source };
  // An incumbent-derived requirement keeps its historical key
  // `requirementSealed`; it now holds plain text.
  if (!e.requirementSealed) return { requirement: null, source: "none" };
  return { requirement: String(e.requirementSealed), source: "incumbent" };
}

/**
 * The education part of a basis a run RECORDS. An incumbent-derived
 * requirement is stored under the historical key `requirementSealed` (plain
 * text) so the shape older runs and the web app read stays the same.
 */
async function educationForBasis(edu: {
  requirement: string | null;
  source: EducationRequirementSource;
}): Promise<PositionBasis["education"]> {
  if (edu.source !== "incumbent") {
    return { source: edu.source, requirement: edu.requirement, requirementSealed: null, recorded: true };
  }
  return {
    source: "incumbent",
    requirement: null,
    requirementSealed: edu.requirement == null || edu.requirement === "" ? null : String(edu.requirement),
    recorded: true,
  };
}

/** Dimensionality of the job-profile document vectors, for the basis check. */
async function loadJobProfileVectorDims(): Promise<number | null> {
  const rows = await vectorQuery<{ dims: number | string | null }>(
    `SELECT vector_dims(embedding) AS dims FROM job_profile_embed WHERE embedding IS NOT NULL LIMIT 1`
  ).catch(() => [] as { dims: number | string | null }[]);
  const d = Number(rows[0]?.dims);
  return Number.isFinite(d) && d > 0 ? d : null;
}

// ─── Orchestration ───────────────────────────────────────────────

// `rankCandidatesByTopsis` — the final ranking step — lives in the
// dependency-free topsis-ranking.ts so the web app's run comparison can replay
// a ranking with the engine's own function (I-7). Re-exported below.

export async function runAhpTopsisSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<{ runId: string; candidateCount: number }> {
  const session = await loadSession(sessionId);
  if (!session) throw new Error("Sesi penilaian tidak ditemukan.");
  if (session.status === "completed" && session.runId) {
    return { runId: session.runId, candidateCount: session.currentPool.length };
  }
  if (!session.runId) throw new Error("Sesi tidak memiliki run ID.");

  // A run that already COMPLETED is a finished record (I-1). The session can
  // still read `running` if the service stopped between marking the run and
  // marking the session; finish the session then, never recompute over the run.
  const existingRun = await queryOne<{ status: string; candidateCount: number | string | null }>(
    `SELECT status, candidate_count AS "candidateCount" FROM scoring_runs WHERE id = $1`,
    [session.runId]
  ).catch(() => null);
  if (existingRun?.status === "completed") {
    await execute(
      `UPDATE tournament_sessions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    return { runId: session.runId, candidateCount: Number(existingRun.candidateCount) || 0 };
  }

  // ── Durations per phase (NFR-RR-05) ─────────────────────────────────────
  // Measured, never asserted: `run_info.timings` records what each phase took
  // on this run, so a claim about how long a re-run takes can be checked.
  const startedAt = new Date();
  const phaseMs: Record<string, number> = {};
  let phaseMark = startedAt.getTime();
  const endPhase = (name: string) => {
    const now = Date.now();
    phaseMs[name] = (phaseMs[name] ?? 0) + (now - phaseMark);
    phaseMark = now;
  };

  // ── The rerun spec ──────────────────────────────────────────────────────
  // One typed key (`ahpRerun`, see rerun-freeze.ts) or nothing. A session that
  // carries a retired mode or a retired key fails here, with the reason — the
  // rules it was queued under no longer exist, and scoring it under today's
  // would hand back a ranking that answers a question nobody asked.
  const parsed = parseRerunSpec(session.finalRanked);
  if (parsed && "error" in parsed) throw new Error(parsed.error);
  const rerun: AhpRerunSpec | null = parsed ? parsed.spec : null;
  const frozen: FrozenRunBasis | null = rerun?.frozen ?? null;
  const baseRunId = rerun?.baseRunId ?? null;

  // The reference instant every stint age is measured to (Pers. 2.5). A root
  // takes the moment it started and records it; a child takes its root's.
  const referenceDate = frozenReferenceDate(frozen) ?? new Date();

  const candidateIds = [...session.currentPool, ...session.pendingPool];
  const newIdSet = new Set(rerun?.newCandidateIds ?? []);
  const carriedIds = rerun ? candidateIds.filter((id) => !newIdSet.has(id)) : [];
  log("ahpTopsis.begin", {
    sessionId,
    candidates: candidateIds.length,
    derivedFrom: baseRunId,
  });

  await setAhpProgress(sessionId, { phase: "load", done: 0, total: candidateIds.length });

  const [position, candidates, cachedAspects, basePoolEntries, baseRunInfo] = await Promise.all([
    loadPositionRow(session.positionId),
    // Carried candidates load even if soft-deleted since the parent: the child's
    // alternative set is the parent's, untouched.
    loadAhpCandidates(session.tenantId, candidateIds, carriedIds, session.isDemo === true),
    baseRunId
      ? loadCachedAspects(baseRunId)
      : Promise.resolve(new Map<string, CachedAspects>()),
    // The parent's rank/closeness per candidate, for the before/after table.
    baseRunId
      ? loadBasePoolEntries(baseRunId)
      : Promise.resolve(new Map<string, BasePoolEntry>()),
    baseRunId ? loadBaseRunInfo(baseRunId) : Promise.resolve(null),
  ]);
  if (candidates.length === 0) {
    throw new Error("Sesi tidak memiliki kandidat aktif.");
  }
  // The load total above counts persisted pool ids, which still include anyone
  // soft-deleted since the session was created; every phase after this counts
  // hydrated candidates. Restate it now that the real number is known, so the
  // wizard's denominator doesn't drop when the load phase ends.
  if (candidates.length !== candidateIds.length) {
    log("ahpTopsis.stalePoolIds", {
      sessionId,
      pooled: candidateIds.length,
      loaded: candidates.length,
    });
    await setAhpProgress(sessionId, {
      phase: "load",
      done: candidates.length,
      total: candidates.length,
    });
  }

  // ── Who is scored, who is carried ──
  // On a root everyone is scored. On a child only the people new to the
  // parent's pool are; every other candidate — the `existing_pool` ones the user
  // named included — keeps all six of the parent's aspects.
  const plan = rerun
    ? planFrozenRerun({
        candidateIds: candidates.map((c) => c.id),
        newCandidateIds: rerun.newCandidateIds,
        existingPoolCandidateIds: rerun.existingPoolCandidateIds,
        cached: cachedAspects,
      })
    : null;
  if (plan && plan.missingCarried.length > 0) {
    // A carried candidate without stored aspects means the parent's snapshot is
    // incomplete. Scoring that person today would put one live row into a
    // ranking that claims to be frozen; refuse instead.
    throw new Error(
      `Run induk tidak menyimpan skor aspek untuk ${plan.missingCarried.length} kandidat pool-nya, sehingga run pembanding tidak bisa dibekukan. Buat run baru dari wizard scoring.`
    );
  }
  const reused = plan?.reused ?? new Map<string, CachedAspects>();
  const toScore: AhpCandidate[] = plan
    ? candidates.filter((c) => plan.toScore.has(c.id))
    : candidates;
  // Carried candidates soft-deleted since the parent: kept (their numbers are
  // the parent's), counted so the run can say so.
  const carriedDeletedCount =
    carriedIds.length > 0
      ? (
          await query<{ id: string }>(
            `SELECT id FROM candidates WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`,
            [carriedIds]
          ).catch(() => [] as { id: string }[])
        ).length
      : 0;
  if (rerun) {
    log("ahpTopsis.derived", {
      sessionId,
      baseRunId,
      rootRunId: frozen?.rootRunId ?? null,
      total: candidates.length,
      reused: reused.size,
      computed: toScore.length,
      existingPool: rerun.existingPoolCandidateIds.length,
      carriedDeleted: carriedDeletedCount,
    });
  }

  // "Skor sementara": a carried row keeps its parent's flag, because its
  // numbers are the parent's (older runs scored while encrypted candidate
  // columns were unreadable recorded it). Nothing this run scores is
  // provisional any more — candidate data is stored as plain text.
  const provisionalIds = new Set<string>(
    [...reused].filter(([, hit]) => hit.provisional).map(([id]) => id),
  );

  // Readiness labels come from THIS run's frozen thresholds (FR-SN-04): a
  // child's snapshot carries its parent's, a root's the ones captured when it
  // was created. Only a run with no snapshot reads the live file — and says so.
  const snapshotReadiness = await queryOne<{ readiness: unknown }>(
    `SELECT config_snapshot->'readiness' AS readiness FROM scoring_runs WHERE id = $1`,
    [session.runId]
  ).catch(() => null);
  const runThresholds = parseReadinessThresholds(snapshotReadiness?.readiness ?? null);
  const readinessSource: "snapshot" | "live_fallback" = runThresholds ? "snapshot" : "live_fallback";
  const readinessFor = (score: number): string =>
    runThresholds ? readinessFromThresholds(runThresholds, score) : determineReadiness(score);
  endPhase("load");

  // ── The position basis (FR-RR-07) ─────────────────────────────────────
  // What the TARGET seat demands: its job profile, the competency reference,
  // the education requirement and — inside the career pass — the target
  // document vector. A root resolves them live and records them as VALUES
  // (`run_info.frozen.positionBasis`); a child takes its parent's, so the new
  // candidates are measured with the yardstick the carried-over candidates
  // were. A parent from before this change recorded none: the child resolves
  // live, records `live_fallback`, and the page says so.
  const inheritedBasis = frozen ? parsePositionBasis(frozen.positionBasis ?? null) : null;
  const basisSource: "own" | "parent" | "live_fallback" = !frozen
    ? "own"
    : inheritedBasis
      ? "parent"
      : "live_fallback";
  const [liveKamus, liveDocumentModel, liveVectorDims] = await Promise.all([
    kamusCorpusFingerprint().catch(() => null),
    loadStoredJobProfileEmbeddingModel().catch(() => null),
    loadJobProfileVectorDims().catch(() => null),
  ]);
  const basisCaveatList: BasisCaveat[] = inheritedBasis
    ? basisCaveats({
        basis: inheritedBasis,
        liveKamusFingerprint: liveKamus?.fingerprint ?? null,
        liveEmbeddingModel: config.embedding.model,
        liveDocumentModel,
        liveVectorDimensions: liveVectorDims,
      })
    : [];
  const caveatKeys = new Set(basisCaveatList.map((c) => c.key));

  const jobProfile: JobProfileMatch | null = inheritedBasis
    ? jobProfileFromFrozen(inheritedBasis.jobProfile)
    : await findJobProfileForPosition(position.title, position.id);
  log("ahpTopsis.jobProfile", {
    matched: jobProfile?.positionName ?? null,
    responsibilities: jobProfile?.responsibilities.length ?? 0,
    basis: basisSource,
  });

  // ── Shared competency context ──
  // One reference set and one level-vector cache serve BOTH the technical aspect
  // and the career competency fallback, so the fallback is the same measurement
  // rather than a lookalike.
  const targetPositionCode = inheritedBasis
    ? normalizeCode(inheritedBasis.targetPositionCode)
    : normalizeCode(
        (
          await queryOne<{ positionId: string | null }>(
            `SELECT p.position_id AS "positionId"
             FROM critical_positions cp
             LEFT JOIN positions p ON p.id = cp.position_id
             WHERE cp.id = $1
             LIMIT 1`,
            [position.id]
          ).catch(() => null)
        )?.positionId ?? null
      );

  // The kamus name → code map and the level vectors stay LIVE even on a child:
  // a new candidate's competencies were unknown when the parent was computed,
  // so there is nothing frozen to read them from. A kamus that moved since is
  // reported (`kamus_changed`), not hidden.
  const kamusCodes = await loadKamusNameToCode();
  const resolveCode = (name: string) => kamusCodes.byName.get(normalizeCompName(name)) ?? null;
  // Anchors are resolved ONCE per run: recomputed only when the kamus embedding
  // corpus has changed since the last calibration, otherwise read from it.
  // A derived run takes its parent's instead — the corpus may have moved since,
  // and the added candidates must be stretched onto the SAME scale as the
  // carried-over ones. Only a parent that recorded none falls back to live, and
  // the run says so (`frozen.anchors.source`).
  const inheritedTechnical = inheritedTechnicalAnchors(frozen);
  const technicalAnchors: TechnicalAnchors =
    inheritedTechnical ?? (await resolveTechnicalAnchors());
  const levelVectors = createLevelVectorStore(technicalAnchors);
  // Career's own scale, measured from the job-profile document corpus. Same
  // contract as the technical anchors, and the same inheritance on a child.
  const inheritedCareer = inheritedCareerAnchors(frozen);
  const careerAnchors: CareerAnchors = inheritedCareer ?? (await resolveCareerAnchors());

  const targetRequired: TargetRequiredSet = inheritedBasis
    ? {
        required: inheritedBasis.required.items.map((r) => ({ ...r })),
        source: inheritedBasis.required.source as RequiredSource,
        detail: inheritedBasis.required.detail,
        employeeIds: [...inheritedBasis.required.employeeIds],
      }
    : await resolveTargetRequiredSet(position, jobProfile, targetPositionCode, referenceDate, session.isDemo === true);
  const targetRefs = toCompetencyRefs(targetRequired.required, resolveCode);
  log("ahpTopsis.targetRequiredSet", {
    position: position.title,
    source: targetRequired.source,
    count: targetRequired.required.length,
    basis: basisSource,
  });

  // The education requirement: the parent's, when it recorded one that can be
  // read back; otherwise resolved live from the same three tiers as always.
  const frozenEducation = inheritedBasis ? readFrozenEducation(inheritedBasis) : null;
  if (inheritedBasis && !frozenEducation && !caveatKeys.has("education_unrecorded")) {
    basisCaveatList.push({
      key: "education_unrecorded",
      message:
        "Syarat pendidikan run induk tidak dapat dibaca kembali (kunci enkripsi tidak tersedia). Syarat pendidikan kandidat baru dibaca dari kondisi hari ini.",
    });
    caveatKeys.add("education_unrecorded");
  }

  // Incumbent education/major — the benchmark when neither the job profile nor
  // the target position states an education requirement. Matched on the same
  // zero-padded employee id the rest of the codebase joins on.
  //
  // Soft delete is a PREFERENCE here, not a filter (idx_candidates_live_employee
  // makes that cheap). The incumbent is the person an admin most often removes
  // from the Kandidat page — they are barred from their own succession pool by
  // design — and requiring a live row would leave this benchmark null, which can
  // drive education to 'none' for everyone and trip the drop-criterion path
  // below: an entire AHP criterion deleted from the TOPSIS matrix and its weight
  // redistributed. Removing one person must not re-weight the ranking.
  // `id ASC` is the unique tiebreak: two rows sharing a zero-padded NPK with
  // equal or NULL updated_at otherwise resolve nondeterministically.
  const incumbentProfile = !frozenEducation && position.holderEmployeeId
    ? await queryOne<{ education: string | null; major: string | null }>(
        `SELECT education, major
         FROM candidates
         WHERE LPAD(TRIM(employee_id), 5, '0') = LPAD(TRIM($1), 5, '0')
           AND (education IS NOT NULL OR major IS NOT NULL)
         ORDER BY (deleted_at IS NOT NULL) ASC, updated_at DESC NULLS LAST, id ASC
         LIMIT 1`,
        [position.holderEmployeeId]
      ).catch((err) => {
        // Losing the benchmark silently is what makes education 'none' for the
        // whole pool, so say why — an unmigrated database (candidates.deleted_at,
        // drizzle/0045) fails this query on the ORDER BY.
        log("ahpTopsis.incumbentEducation.failed", {
          holderEmployeeId: position.holderEmployeeId,
          error: err instanceof Error ? err.message : String(err),
          hint: "candidates.deleted_at missing (drizzle/0045 not applied)? — education benchmark unavailable",
        });
        return null;
      })
    : null;
  const incumbentEducationRequirement =
    [
      incumbentProfile ? incumbentProfile.education : null,
      incumbentProfile ? incumbentProfile.major : null,
    ]
      .map((v) => (v == null ? "" : String(v)).trim())
      .filter(Boolean)
      .join(" ") || null;
  const educationRequirement =
    frozenEducation ??
    resolveEducationRequirement(jobProfile, position.education, incumbentEducationRequirement);

  // ── Run trace (drizzle/0092) ─────────────────────────────────────────
  // Sinks the scorers fill with the values they compute anyway; nothing here
  // changes a number. A child copies its carried candidates' entries from the
  // parent's trace, so its own is self-contained.
  const technicalTrace = new Map<string, TechnicalCandidateTrace>();
  const careerTrace = emptyCareerTraceSink();
  const educationTrace = { map: new Map<string, EducationTrace>(), requirementSource: String(educationRequirement.source) };
  const parentTrace = baseRunId ? await loadEngineTrace(baseRunId) : null;
  endPhase("basis");

  const abortCheck = () => {
    if (signal?.aborted) throw new Error("Sesi dibatalkan.");
  };

  // ── Aspect scores ──
  // The three expensive aspects run over `toScore` only (everything on a normal
  // run, just the added candidates on an incremental one) and are then merged
  // with the values carried over from the base run.
  await setAhpProgress(sessionId, { phase: "technical", done: 0, total: toScore.length });
  const { scores: technicalScores, details: technicalDetails } = await scoreTechnicalAspect(
    toScore,
    position,
    targetRequired,
    targetRefs,
    resolveCode,
    levelVectors,
    (done, total) => setAhpProgress(sessionId, { phase: "technical", done, total }),
    technicalTrace
  );
  for (const [id, hit] of reused) {
    technicalScores.set(id, hit.technical);
    if (hit.technicalMatching) technicalDetails.set(id, hit.technicalMatching);
  }
  endPhase("technical");
  abortCheck();

  // Incremental run: recover the base run's depth yardstick so the added
  // candidates are measured against the same one the carried-over candidates
  // were. `toScore` here is only the added subset — deriving a fresh pool median
  // from it would re-scale half the ranking against a different standard.
  const pinnedCareerDepth = (() => {
    // The frozen basis first: it is the ROOT's yardstick even when no carried
    // candidate's detail happens to record one.
    if (frozen?.anchors.depth) return { ...frozen.anchors.depth };
    for (const hit of reused.values()) {
      const d = hit.careerMatching as CareerDetail | null;
      const y = Number(d?.targetYears);
      const r = Number(d?.targetRows);
      if (Number.isFinite(y) && y > 0 && Number.isFinite(r) && r > 0) {
        return { targetYears: y, targetRows: r };
      }
    }
    return null; // full run, or a base run that predates the depth targets
  })();

  // Same reasoning as `pinnedCareerDepth`, for the OTHER thing that must stay
  // stable across an incremental run: the fallback calibration. Without this, a
  // stint scored via the incumbent-competency fallback maps its raw coverage to
  // a similarity chosen from only the added candidates' document-matched sample
  // — usually too small to even pass `minSamples`, and never the same p5/p95 the
  // carried-over candidates were calibrated against.
  const pinnedCareerCalibration = (() => {
    for (const hit of reused.values()) {
      const cal = (hit.careerMatching as CareerDetail | null)?.calibration;
      if (cal && Number.isFinite(cal.lo) && Number.isFinite(cal.hi) && cal.hi > cal.lo) {
        return cal;
      }
    }
    return null; // full run, or a base run that predates per-candidate calibration
  })();

  await setAhpProgress(sessionId, { phase: "career", done: 0, total: toScore.length });
  // The career target document: the parent's on a child (FR-RR-07), unless the
  // corpus' dimensionality moved and the frozen vector cannot be compared.
  const pinnedCareerTarget =
    inheritedBasis && !caveatKeys.has("career_vector_dimension")
      ? inheritedBasis.careerTarget
      : null;
  const {
    scores: careerScores,
    details: careerDetails,
    runInfo: careerRunInfo,
    target: careerTargetUsed,
  } = await scoreCareerAspect(
    toScore,
    position,
    targetRequired,
    targetRefs,
    targetPositionCode,
    resolveCode,
    levelVectors,
    careerAnchors,
    (done, total) => setAhpProgress(sessionId, { phase: "career", done, total }),
    pinnedCareerDepth,
    pinnedCareerCalibration,
    referenceDate,
    pinnedCareerTarget,
    careerTrace
  );
  for (const [id, hit] of reused) {
    careerScores.set(id, hit.career);
    if (hit.careerMatching) careerDetails.set(id, hit.careerMatching);
  }
  endPhase("career");
  abortCheck();

  // Behavior / performance / HAV are pure lookups over the candidate row (no
  // I/O, no model), so today's value is ALWAYS computed for everyone — it costs
  // nothing and the drift report below needs it.
  //
  // Whether the RANKING uses it is the mode's decision. A mode that freezes the
  // carried-over candidates freezes all six aspects, not three: the old split
  // (three reused, three live) meant 65% of the weight on this program's matrix
  // silently came from a different date than the other 35%, so a candidate could
  // move for a reason that was neither the addition nor the exclusion the run was
  // created to isolate.
  await setAhpProgress(sessionId, { phase: "behavior", done: 0, total: candidates.length });
  const liveBehavior = new Map(
    candidates.map((c) => [c.id, scoreBehaviorAspect(c.behaviorRecommendation)])
  );
  const livePerformance = new Map(
    candidates.map((c) => [c.id, scorePerformanceAspect(c.performanceGrade)])
  );
  const liveHav = new Map(candidates.map((c) => [c.id, computeHavScore(c.havQuadrant)]));

  const behaviorScores = new Map(liveBehavior);
  const performanceScores = new Map(livePerformance);
  const havScores = new Map(liveHav);
  if (rerun) {
    for (const [id, hit] of reused) {
      // Null means the base run recorded nothing for that aspect — there is
      // nothing to freeze, so today's value stands and the drift report skips it.
      if (hit.baseBehavior != null) behaviorScores.set(id, hit.baseBehavior);
      if (hit.basePerformance != null) performanceScores.set(id, hit.basePerformance);
      if (hit.baseHav != null) havScores.set(id, hit.baseHav);
    }
  }
  /**
   * The raw behavior / PA / HAV strings to DISPLAY for a candidate.
   *
   * On a frozen mode these must be the base run's, not today's: printing this
   * month's PA grade beside a score computed from last month's is a row that
   * contradicts itself, and `loadCachedAspects` would read that mismatched pair
   * back on the next derived run. `from` records which it was, because a base run
   * written before `rawInputs` existed leaves no strings to freeze and the row
   * then honestly shows today's.
   */
  const displayRaw = (c: AhpCandidate) => {
    const raw = rerun ? (reused.get(c.id)?.baseRaw ?? null) : null;
    return raw
      ? { ...raw, from: "base_run" as const }
      : {
          behaviorRecommendation: c.behaviorRecommendation ?? null,
          behaviorNotes: c.behaviorNotes ?? null,
          performanceGrade: c.performanceGrade ?? null,
          havQuadrant: c.havQuadrant ?? null,
          // manual | upload | formula | none — absent on rows written before it existed.
          havSource: c.havSource,
          from: "live" as const,
        };
  };
  abortCheck();

  // ── Did the live half move since the base run? ──────────────────────
  // A derived run tells the reader "nothing was re-scored" — and for the three
  // expensive aspects that is true. The three cheap ones ARE re-read, so a
  // carried-over candidate whose PA grade or HAV quadrant changed in the
  // meantime moves for a reason that has nothing to do with the added or
  // excluded candidate. Measured here and reported, because the alternative is
  // an operator explaining a rank change with the wrong cause.
  const freshness = (() => {
    // Compare against every candidate the base run scored, not only the ones
    // whose scores were reused. On a "today's data" mode nothing is reused, and
    // "did anything actually change since the base run?" is precisely the
    // question that mode exists to answer.
    if (cachedAspects.size === 0) return null;
    const byAspect = { behavior: 0, performance: 0, hav: 0 };
    const changes: {
      candidateId: string;
      name: string | null;
      aspect: "behavior" | "performance" | "hav";
      before: number;
      after: number;
    }[] = [];
    const changed = new Set<string>();
    let compared = 0;
    for (const c of candidates) {
      const hit = cachedAspects.get(c.id);
      if (!hit) continue;
      const id = c.id;
      compared += 1;
      // Deliberately the LIVE maps, not the scoring ones: after a freeze the
      // scoring maps hold the base run's own values, so comparing them would be
      // an identity check that reports "nothing drifted" by construction.
      const now = {
        behavior: liveBehavior.get(id),
        performance: livePerformance.get(id),
        hav: liveHav.get(id),
      };
      const before = {
        behavior: hit.baseBehavior,
        performance: hit.basePerformance,
        hav: hit.baseHav,
      };
      for (const aspect of ["behavior", "performance", "hav"] as const) {
        const a = before[aspect];
        const b = now[aspect];
        // A base run that recorded nothing for this aspect is not evidence of a
        // change; comparing against 0 would report the whole pool as drifted.
        if (a == null || b == null || a === b) continue;
        byAspect[aspect] += 1;
        changed.add(id);
        if (changes.length < 20) {
          changes.push({
            candidateId: id,
            name: candidates.find((c) => c.id === id)?.name ?? null,
            aspect,
            before: a,
            after: b,
          });
        }
      }
    }
    const tally = `behavior ${byAspect.behavior}, performance ${byAspect.performance}, HAV ${byAspect.hav}`;
    return {
      policy: "frozen" as const,
      reusedCandidates: reused.size,
      comparedCandidates: compared,
      changedCandidates: changed.size,
      byAspect,
      changes,
      reason:
        changed.size === 0
          ? `Keenam skor aspek kandidat lama diambil apa adanya dari run induk. Datanya pun memang belum berubah: tidak satu pun dari ${compared} kandidat yang dibandingkan bergeser nilainya, jadi hasil beku dan hasil terkini identik.`
          : `Keenam skor aspek kandidat lama SENGAJA dibekukan dari run induk, supaya pergeseran peringkat hanya bisa berasal dari kandidat yang ditambahkan. ${changed.size} dari ${compared} kandidat sebenarnya sudah berubah datanya sejak run induk (${tally}), dan perubahan itu TIDAK ikut dihitung di sini — buat run baru dari wizard scoring bila ingin memasukkannya.`,
    };
  })();
  if (freshness && freshness.changedCandidates > 0) {
    log("ahpTopsis.reusedAspectDrift", {
      sessionId,
      baseRunId,
      policy: freshness.policy,
      reused: freshness.reusedCandidates,
      compared: freshness.comparedCandidates,
      changed: freshness.changedCandidates,
      byAspect: freshness.byAspect,
    });
  }

  endPhase("behavior");
  await setAhpProgress(sessionId, { phase: "education", done: 0, total: toScore.length });
  // The last completed run of this position, whose model answers are reused for
  // candidates asked an identical question (education-reuse.ts). Read only when
  // something will be scored; a failed read just means every call is made.
  const educationReuse: EducationReuseTally = {
    source:
      config.ahpTopsis.educationReuse && toScore.length > 0
        ? await loadEducationReuseSource(session.positionId, session.isDemo === true, session.runId)
        : null,
    eligible: 0,
    reused: 0,
    modelCalls: 0,
  };
  const educationEvals = await scoreEducationAspect(
    toScore,
    position,
    jobProfile,
    incumbentEducationRequirement,
    (done, total) => setAhpProgress(sessionId, { phase: "education", done, total }),
    signal,
    // Resolved once above — the parent's on a child — so the scorer cannot
    // re-read a requirement edited since.
    { requirement: educationRequirement.requirement },
    educationTrace,
    educationReuse
  );
  if (educationReuse.reused > 0) {
    log("ahpTopsis.educationReused", {
      sessionId,
      fromRunId: educationReuse.source?.runId ?? null,
      eligible: educationReuse.eligible,
      reused: educationReuse.reused,
      modelCalls: educationReuse.modelCalls,
    });
  }
  for (const [id, hit] of reused) educationEvals.set(id, hit.educationEval);
  endPhase("education");
  abortCheck();

  // ── AHP weights + TOPSIS ranking ──
  await setAhpProgress(sessionId, { phase: "topsis", done: 0, total: candidates.length });
  const {
    weights: resolvedWeights,
    cr: resolvedCr,
    lambdaMax: resolvedLambdaMax,
    ci: resolvedCi,
    pairwise: ahpPairwise,
    source: resolvedWeightSource,
  } = await resolveAhpWeights(session.programTemplateId, frozen?.ahp.pairwise ?? null);
  // CR / λmax / CI: on a child, the parent's own figures (FR-RR-06). Recomputed
  // from the matrix above they would describe the stored COPY, which an older
  // parent rounded to 4 decimals — close to the parent's, never equal.
  const { cr, lambdaMax, ci } = frozen?.ahp.consistency ?? {
    cr: resolvedCr,
    lambdaMax: resolvedLambdaMax,
    ci: resolvedCi,
  };
  // A child ranks with its parent's priority vector itself — the stored matrix
  // is rounded and its eigenvector would move every closeness coefficient. The
  // matrix above only feeds the CR/λmax diagnostics on a child.
  const inheritedWeights = frozenWeights(frozen);
  const weights = inheritedWeights ?? resolvedWeights;
  const weightSource = inheritedWeights ? ("inherited" as const) : resolvedWeightSource;
  // Display the AHP weights + settings used for THIS run.
  logAhpConfiguration({
    runId: session.runId,
    sessionId,
    position: position.title,
    source: weightSource,
    weights,
    cr,
    lambdaMax,
    ci,
    pairwise: ahpPairwise,
  });
  if (cr > 0.1) {
    log("ahpTopsis.inconsistentMatrix", { sessionId, cr: Number(cr.toFixed(4)) });
  }
  // A FLAG, not a gate (docs/ahp-input-sync.md §8): the same validateAhpPairwise
  // every save path uses, recorded so a run scored with an off-scale or
  // inconsistent matrix (older data, or a session started before the web gate)
  // says so in run_info and the trace. Nothing below reads it; weights and
  // ranking are exactly as before. The system defaults are off-scale by
  // construction (built from a weight vector) and are marked `expected`.
  const ahpCheck = ahpInputCheck(ahpPairwise, resolvedWeightSource, AHP_CRITERIA_ORDER);
  if (!ahpCheck.ok && !ahpCheck.expected) {
    log("ahpTopsis.matrixInputCheck", { sessionId, offScale: ahpCheck.offScale.length, cr: ahpCheck.cr, reciprocal: ahpCheck.reciprocal });
  }

  const aspectScoresById = assembleAspectScores(
    candidates.map((c) => c.id),
    {
      technical: technicalScores,
      career: careerScores,
      behavior: behaviorScores,
      performance: performanceScores,
      hav: havScores,
      education: new Map([...educationEvals].map(([id, e]) => [id, e.score])),
    },
    reused
  );

  // ── Drop criteria that could not be assessed for ANYONE ──
  // A criterion nobody could be scored on is not "everyone gets 0" — it is an
  // absent measurement. Leaving a dead all-zero column in the matrix keeps
  // consuming its AHP share and drags every closeness score down without
  // separating anyone. Drop it and renormalize the remaining weights, then say
  // so in the run diagnostics rather than letting the number quietly shrink.
  const liveDroppedCriteria: { key: AhpCriterionKey; reason: string }[] = [];
  // The reference set for this position, as any scored candidate saw it. Every
  // candidate is matched against the same required columns, so one detail is
  // enough to know whether ANY of them was measurable.
  const technicalSample = technicalDetails.values().next().value as
    | TechnicalDetail
    | undefined;
  if (targetRequired.required.length === 0) {
    liveDroppedCriteria.push({
      key: "technical",
      reason:
        targetRequired.detail ??
        "Tidak ada acuan kompetensi untuk posisi target (job profile, posisi, incumbent, dan pemegang posisi kosong).",
    });
  } else if (technicalSample && technicalSample.effectiveRequiredCount === 0) {
    // A reference set exists but not one of its competencies could be scored:
    // none resolves to a kamus code (so no level vectors) and no candidate holds
    // any of them by name. That is an all-zero column exactly like an absent
    // criterion, and must be dropped for the same reason rather than dragging
    // every closeness score down while separating nobody.
    liveDroppedCriteria.push({
      key: "technical",
      reason: `Acuan kompetensi ada (${technicalSample.requiredCount} kompetensi) tetapi tidak satu pun dapat diukur: tidak ada yang terpetakan ke kamus kompetensi dan tidak ada kandidat yang memegang namanya. Jalankan pemetaan nama kompetensi ke kamus, atau lengkapi kamus.`,
    });
  }
  if (careerRunInfo.targetStatus !== "ok" && careerRunInfo.fallbackRequiredCount === 0) {
    liveDroppedCriteria.push({
      key: "career",
      reason:
        "Posisi target tidak punya dokumen job profile maupun acuan kompetensi, sehingga tidak ada dasar pembanding relevansi karier.",
    });
  }
  // Evaluated over EVERY candidate being ranked, not just the freshly scored
  // ones: on an incremental or exclusion re-run `toScore` is a subset (empty, in
  // the exclusion case), and judging the criterion by that subset would drop
  // education from a ranking whose carried-over candidates are all scored on it.
  if (
    candidates.length > 0 &&
    candidates.every((c) => (educationEvals.get(c.id)?.source ?? "none") === "none")
  ) {
    liveDroppedCriteria.push({
      key: "education",
      reason:
        "Tidak satu pun kandidat dapat dinilai pendidikannya (lihat alasan per kandidat pada detail Education).",
    });
  }

  // A child takes its parent's active criteria and never re-evaluates them:
  // the canonical disagreement is a parent that dropped education because none
  // of its candidates could be assessed and an added candidate who can. The
  // parent's set stands; the disagreement is recorded, not applied.
  const criteriaFreeze = frozenDroppedCriteria(frozen, liveDroppedCriteria);
  const droppedCriteria = criteriaFreeze.dropped;
  const droppedKeys = new Set(droppedCriteria.map((d) => d.key));

  // ── The TOPSIS yardstick (a child ranks on its PARENT's) ──
  // Classic TOPSIS is set-relative: every divisor √Σx² and both ideals move
  // when somebody is added, so carried candidates whose six aspects are frozen
  // would still swap places (measured on 65 stored runs: adding ONE candidate
  // reordered the carried candidates in 66% of trials and pushed a parent
  // finalist below a parent non-finalist in 13%). A child therefore ranks
  // against the parent's divisors and ideals: every carried candidate keeps
  // the parent's closeness exactly, and an added one is placed between them.
  // The parent's recorded yardstick wins (a grandchild then sits on the ROOT's);
  // a parent that recorded none is re-derived from its stored pool with its own
  // weights — the numbers a classic parent was ranked with.
  let topsisAnchors: TopsisAnchorsByKey | null = null;
  let topsisAnchorSource: RecordedTopsis["source"] = "own";
  if (rerun) {
    const carriedCandidates = candidates.filter((c) => !newIdSet.has(c.id));
    if (carriedCandidates.length > 0) {
      const parentScale = rankCandidatesByTopsis(carriedCandidates, aspectScoresById, weights, droppedKeys);
      const wv = Object.fromEntries(
        parentScale.activeCriteria.map((k, j) => [k, parentScale.detail.weightVector[j]!])
      ) as Partial<Record<AhpCriterionKey, number>>;
      const recorded = readTopsisAnchors(baseRunInfo?.frozen?.topsis, parentScale.activeCriteria, wv);
      topsisAnchors = recorded ?? anchorsFromDetail(parentScale.detail, parentScale.activeCriteria);
      topsisAnchorSource = recorded ? "parent" : "parent_pool";
    }
  }
  const {
    activeCriteria,
    effectiveWeights,
    rankedAll,
    detail: topsisDetail,
  } = rankCandidatesByTopsis(candidates, aspectScoresById, weights, droppedKeys, topsisAnchors);
  // Added candidates whose value lay outside the parent's range on a criterion
  // were placed AT the nearer end of it (anchored mode clamps BOTH ways): above
  // the parent's best counts as the best, below the parent's worst as the worst.
  // Reported with the direction, never silent.
  const topsisClamped = topsisAnchors
    ? topsisDetail.rowIds.flatMap((id, i) => {
        const above: AhpCriterionKey[] = [];
        const below: AhpCriterionKey[] = [];
        activeCriteria.forEach((k, j) => {
          if (!topsisDetail.clamped[i]![j]) return;
          const raw = (topsisDetail.weightVector[j]! * aspectScoresById.get(id)![k]) / topsisDetail.colNorms[j]!;
          (raw > topsisDetail.idealPos[j]! ? above : below).push(k);
        });
        return above.length + below.length > 0
          ? [{ candidateId: id, criteria: [...above, ...below], above, below }]
          : [];
      })
    : [];
  const recordedTopsis: RecordedTopsis = {
    version: 1,
    mode: topsisAnchors ? "anchored" : "classic",
    source: topsisAnchors ? topsisAnchorSource : "own",
    activeCriteria: [...activeCriteria],
    weightVector: Object.fromEntries(activeCriteria.map((k, j) => [k, topsisDetail.weightVector[j]!])),
    ...anchorsFromDetail(topsisDetail, activeCriteria),
  };
  if (droppedKeys.size > 0) {
    log("ahpTopsis.criteriaDropped", {
      sessionId,
      dropped: droppedCriteria.map((d) => d.key),
      active: activeCriteria,
    });
  }

  /** Every scored candidate's rank within the FULL pool, 1-based. */
  const poolRankById = new Map(rankedAll.map((e, i) => [e.candidate.id, i + 1]));
  endPhase("topsis");

  // Cut to the program's target finalist count — only the top N are persisted
  // as results rather than listing every candidate.
  const targetFinalists =
    session.targetFinalists && session.targetFinalists > 0
      ? Math.min(session.targetFinalists, rankedAll.length)
      : rankedAll.length;
  const cutoff = rankedAll.slice(0, targetFinalists);

  // ── Candidates that must appear whatever they scored (FR-RR-09) ──
  // A child lists (1) its own top N — N is the PARENT's finalist count, carried
  // in the session — (2) every parent finalist, wherever it lands now, and
  // (3) every comparison candidate, wherever it lands. Nobody else: the forum
  // asked "how does X compare?", so X must be visible even at 37th of 60; a
  // finalist pushed out must not vanish from view; and a candidate nobody asked
  // about must not appear just because a quota grew. Rows below the cut carry
  // their REAL pool rank (23, not 12), because the honest answer to "how does
  // she compare" is the position itself.
  const comparisonIds = plan?.alwaysInclude ?? new Set<string>();
  const parentFinalistIds = new Set(
    rerun ? [...basePoolEntries].filter(([, e]) => e.isFinalist).map(([id]) => id) : []
  );
  const { listed } = composeChildResultList({
    rankedIds: rankedAll.map((e) => e.candidate.id),
    topN: targetFinalists,
    parentFinalistIds,
    comparisonIds,
    parentRankById: rerun
      ? new Map([...basePoolEntries].map(([id, e]) => [id, e.poolRank]))
      : undefined,
  });
  const listedById = new Map(listed.map((l) => [l.candidateId, l]));
  const appended = rankedAll.slice(targetFinalists).filter((e) => listedById.has(e.candidate.id));
  const ranked = [...cutoff, ...appended];
  log("ahpTopsis.finalists", {
    sessionId,
    scored: rankedAll.length,
    targetFinalists,
    kept: cutoff.length,
    appendedBelowCut: appended.length,
  });

  // ── Insight notes (LLM, finalists only) ──
  //
  // Finalists only, because those are the rows analysis_results holds and the
  // dossier renders; the rest of the scored pool lives in
  // scoring_run_pool_aspects as numbers for a later exclusion re-rank, where
  // prose would never be read. Runs AFTER the ranking is fixed and cannot alter
  // it — the agent is handed final scores as read-only context.
  await setAhpProgress(sessionId, { phase: "narrative", done: 0, total: ranked.length });
  const narrativeInputs: AhpNarrativeInput[] = ranked.map((entry) => {
    const s = aspectScoresById.get(entry.candidate.id)!;
    const weightedScore = Math.round(entry.closeness * 100);
    return {
      // True pool rank — an appended candidate sits at 23 of 24, and telling the
      // narrative model it is 12th would have it write about a near-miss.
      rank: poolRankById.get(entry.candidate.id)!,
      weightedScore,
      readiness: readinessFor(weightedScore),
      aspectScores: s,
      candidate: {
        id: entry.candidate.id,
        name: entry.candidate.name,
        currentPosition: entry.candidate.currentPosition,
        gradeLevel: null,
        yearsExperience: entry.candidate.yearsExperience,
        education: entry.candidate.education,
        major: entry.candidate.major,
        // The frozen strings when the mode froze the scores: prose written from
        // today's PA grade next to a score computed from last month's is
        // unfalsifiable after the fact, and it gets persisted.
        behaviorRecommendation: displayRaw(entry.candidate).behaviorRecommendation,
        behaviorNotes: displayRaw(entry.candidate).behaviorNotes,
        havQuadrant: displayRaw(entry.candidate).havQuadrant,
        performanceGrade: displayRaw(entry.candidate).performanceGrade,
      },
      technical: technicalDetails.get(entry.candidate.id) ?? null,
      career: careerDetails.get(entry.candidate.id) ?? null,
      education: educationEvals.get(entry.candidate.id) ?? null,
    };
  });

  const llmNarratives = new Map<string, AhpNarrativeEntry>();
  // The LLM insight writer runs only on a real-mode run with the writer switched
  // on (AHP_NARRATIVE_LLM). A demo run keeps the template narrative.
  const narrativeLlmEnabled = config.ahpNarrativeLlm && session.isDemo !== true;

  // ── Persist ──
  await setAhpProgress(sessionId, { phase: "persist", done: 0, total: ranked.length });

  // Replace any partial results from an interrupted earlier attempt.
  await execute(`DELETE FROM analysis_results WHERE run_id = $1`, [session.runId]);
  await execute(`DELETE FROM scoring_run_pool_aspects WHERE run_id = $1`, [
    session.runId,
  ]);

  // ── Aspect snapshot for the WHOLE scored pool, not just the finalists ──
  // analysis_results keeps only the top-N, but the six aspects are per-candidate
  // and set-independent, so storing them for everyone is what lets a later
  // exclusion re-rank promote the candidate ranked N+1 into a freed slot and
  // re-rank without re-scoring anyone. Cheap: six numbers plus the three detail
  // blobs already computed above.
  // "Made the cut" — deliberately NOT `ranked`, which also holds the appended
  // below-cut candidates. A later exclusion re-rank reads this to decide who was
  // backfilled, and an appended candidate was never a finalist.
  const finalistIdSet = new Set(cutoff.map((r) => r.candidate.id));
  for (let i = 0; i < rankedAll.length; i += 50) {
    const chunk = rankedAll.slice(i, i + 50);
    const values: unknown[] = [];
    const tuples = chunk.map((entry, j) => {
      const base = j * 7;
      const record = poolAspectRecord({
        aspects: aspectScoresById.get(entry.candidate.id)!,
        technicalMatching: technicalDetails.get(entry.candidate.id) ?? null,
        careerMatching: careerDetails.get(entry.candidate.id) ?? null,
        educationEval: educationEvals.get(entry.candidate.id) ?? null,
        raw: displayRaw(entry.candidate),
        reusedHit: reused.get(entry.candidate.id) ?? null,
        provisional: provisionalIds.has(entry.candidate.id),
        topsis: { closeness: entry.closeness, dPlus: entry.dPlus, dMinus: entry.dMinus },
      });
      values.push(
        session.runId,
        entry.candidate.id,
        i + j + 1,
        entry.closeness.toFixed(6),
        finalistIdSet.has(entry.candidate.id),
        record.aspects,
        record.details
      );
      return `(gen_random_uuid(), $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}::jsonb, $${base + 7}::jsonb)`;
    });
    await execute(
      `INSERT INTO scoring_run_pool_aspects
       (id, run_id, candidate_id, pool_rank, closeness, is_finalist, aspects, details)
       VALUES ${tuples.join(", ")}
       ON CONFLICT (run_id, candidate_id) DO NOTHING`,
      values
    ).catch((err) => {
      // Never fail a completed ranking over the snapshot: without it the run is
      // still valid, only a later exclusion re-rank loses its backfill.
      log("ahpTopsis.poolAspectsFailed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * The `analysis_results.details` blob for ranked row `i`. Read at call time,
   * so the same builder writes the row first with the deterministic narrative
   * and again once the LLM narrative arrives — the numbers in both writes are
   * identical by construction.
   */
  const rowDetails = (i: number) => {
    const { candidate, closeness: cc, dPlus: dp, dMinus: dn } = ranked[i]!;
    // Rank against the WHOLE scored pool, not the row's index in this list. For
    // the finalists the two agree; for an appended below-cut candidate they must
    // not — writing 12 where the truth is 23 would turn "we looked and she is
    // 23rd of 24" into a claim she nearly made the bench.
    const rank = poolRankById.get(candidate.id)!;
    const belowCut = !finalistIdSet.has(candidate.id);
    const s = aspectScoresById.get(candidate.id)!;
    const weightedScore = Math.round(cc * 100);
    const readiness = readinessFor(weightedScore);
    const educationEval = educationEvals.get(candidate.id);
    const template = buildNarrative(rank, cc, s, educationEval);
    const written = llmNarratives.get(candidate.id);
    // `justification` stays deterministic in both cases: it states the method and
    // the closeness coefficient, which is an audit line, not commentary.
    // Per-ARRAY fallback, not per-candidate: the agent guarantees only that
    // recommendations came back. An empty strengths array would render the
    // "Keunggulan Kompetitif" heading with nothing under it, which reads as "this
    // candidate has none" rather than "the writer said nothing".
    const narrative = written
      ? {
          ...template,
          strengths: written.strengths.length ? written.strengths : template.strengths,
          weaknesses: written.weaknesses.length ? written.weaknesses : template.weaknesses,
          recommendations: written.recommendations.length
            ? written.recommendations
            : template.recommendations,
        }
      : template;

    // Frozen scores must be shown with the strings they were computed from.
    const raw = displayRaw(candidate);

    const details = {
      id: candidate.id,
      name: candidate.name,
      currentPosition: candidate.currentPosition ?? "-",
      yearsOfService: candidate.yearsExperience ?? 0,
      havQuadrant: raw.havQuadrant,
      photoUrl: null,
      jobMatch: Math.min(95, Math.max(30, weightedScore - 5)),
      discipline: "-",
      mcu: "-",
      performance: "-",
      behaviorRecommendation: raw.behaviorRecommendation,
      behaviorNotes: raw.behaviorNotes,
      primaryFilter: {
        discipline: "qualified",
        mcu: "qualified",
        performance: "qualified",
        hav: "qualified",
        behavior: "qualified",
      },
      scoreBreakdown: {
        technical: s.technical,
        behavior: s.behavior,
        hav: s.hav,
        performance: s.performance,
        education: s.education,
        career: s.career,
      },
      weightedScore,
      readiness,
      constraint: narrative.justification,
      strengths: narrative.strengths,
      weaknesses: narrative.weaknesses,
      recommendation: narrative.recommendations,
      // Method transparency block — audit/reproduce the ranking + drive the
      // per-criterion breakdown on the Progress Running page.
      ahpTopsis: {
        weights,
        /** Weights actually applied after unscorable criteria were dropped. */
        effectiveWeights,
        droppedCriteria,
        weightSource,
        consistencyRatio: Number(cr.toFixed(4)),
        closeness: Number(cc.toFixed(6)),
        dPlus: Number(dp.toFixed(6)),
        dMinus: Number(dn.toFixed(6)),
        educationSource: educationEval?.source ?? "none",
        educationAnalysis: educationEval?.items?.slice(0, 10) ?? [],
        // Who wrote strengths / weaknesses / recommendations (FR-RR-14): the
        // language model, or the deterministic template. Either way they are
        // prose ABOUT the numbers and never feed them; the page labels which.
        narrativeSource: written ? ("llm" as const) : ("template" as const),
        jobProfileMatched: jobProfile?.positionName ?? null,
        // Derived run: this candidate's aspect scores were carried over from that
        // run instead of being recomputed. Under a frozen mode that is ALL SIX,
        // together with the raw strings they were computed from — `rawInputFrom`
        // says whether those strings really came from the base run, since a base
        // run written before they were persisted leaves none to carry.
        reusedAspectsFromRunId: reused.has(candidate.id) ? baseRunId : null,
        reusedAspectCount: reused.has(candidate.id) ? 6 : 0,
        rawInputFrom: raw.from,
        // On a "Tambah Kandidat Pembanding" child: `new` = scored here, the only
        // rows whose aspects this run computed; `existing_pool` = named by the
        // user but already in the parent's pool, so carried, not re-scored;
        // `carried` = everyone else. Null on a root.
        rerunSource: rerun
          ? newIdSet.has(candidate.id)
            ? "new"
            : rerun.existingPoolCandidateIds.includes(candidate.id)
              ? "existing_pool"
              : "carried"
          : null,
        // Whether a NEW row was stretched onto the parent's anchors or onto
        // live ones because the parent recorded none — the row badge warns on
        // the latter, since its scale may differ from the carried rows'.
        rerunAnchorsSource: rerun
          ? inheritedTechnical && inheritedCareer
            ? "parent"
            : "live_fallback"
          : null,
        // Criteria on which this (added) candidate lay outside the parent's
        // range and was counted AT its nearer end — the child ranks on the
        // parent's TOPSIS yardstick, which cannot stretch past either end.
        topsisClamped: topsisClamped.find((c) => c.candidateId === candidate.id)?.criteria ?? [],
        topsisClampedAbove: topsisClamped.find((c) => c.candidateId === candidate.id)?.above ?? [],
        topsisClampedBelow: topsisClamped.find((c) => c.candidateId === candidate.id)?.below ?? [],
        // ── Where this row sits relative to the finalist cut ──
        // `belowFinalistCut` rows exist only because somebody asked for that
        // person by name; they are NOT part of the bench and every surface that
        // renders a ranking has to say so, or a 23rd-of-24 result reads as the
        // last entry of a shortlist. `poolSize` is the denominator that makes
        // the rank meaningful.
        manuallyAdded: comparisonIds.has(candidate.id),
        belowFinalistCut: belowCut,
        // FR-RR-09 markers on a child: "Kandidat pembanding", "Baru masuk N
        // besar", "Keluar dari N besar" — against the PARENT's top N.
        rerunMarkers: rerun
          ? {
              comparison: listedById.get(candidate.id)?.comparison ?? false,
              enteredTopN: listedById.get(candidate.id)?.enteredTopN ?? false,
              leftTopN: listedById.get(candidate.id)?.leftTopN ?? false,
              // Why a parent finalist left the top N — overtaken by a comparison
              // candidate, or the pool scale moved (see leftTopNCauseOf).
              leftTopNCause: listedById.get(candidate.id)?.leftTopNCause ?? null,
              parentPoolRank: basePoolEntries.get(candidate.id)?.poolRank ?? null,
              topN: targetFinalists,
            }
          : null,
        // "Skor sementara": only ever true on a carried row whose parent
        // recorded it (older runs scored while encrypted candidate columns
        // were unreadable) — their numbers ARE the parent's.
        provisional: provisionalIds.has(candidate.id),
        // Mirrored into the details blob because that is the only thing the
        // position page reads; without it the UI numbers rows by their index and
        // an appended 23rd-of-24 renders as "#12".
        poolRank: rank,
        finalistCut: targetFinalists,
        poolSize: rankedAll.length,
        // Per-competency technical matching (exact-gap / semantic + Hungarian
        // assignment) — feeds the Progress Running visualization.
        technicalMatching: technicalDetails.get(candidate.id) ?? null,
        // Per-stint career matching (duration-weighted job-profile similarity).
        careerMatching: careerDetails.get(candidate.id) ?? null,
        // Raw per-criterion inputs for the six-section candidate dropdown.
        behaviorDetail: {
          recommendation: raw.behaviorRecommendation,
          notes: raw.behaviorNotes,
          score: s.behavior,
        },
        performanceDetail: {
          grade: raw.performanceGrade,
          score: s.performance,
        },
        havDetail: {
          quadrant: raw.havQuadrant,
          score: s.hav,
        },
        // Recommended single-pass storage: the full grounded education analysis
        // lives here in the per-candidate analysis_results snapshot (one write,
        // run-scoped, no extra table/join) and is rendered on Progress Running.
        educationDetail: {
          education: candidate.education ?? null,
          major: candidate.major ?? null,
          requirement: educationRequirement.requirement,
          /** Where that requirement came from — "incumbent" is a fallback, not a spec. */
          requirementSource: educationRequirement.source,
          source: educationEval?.source ?? "none",
          score: s.education,
          educationLevel: educationEval?.educationLevel ?? null,
          majorRelevance: educationEval?.majorRelevance ?? null,
          groundedMajorAxis: educationEval?.groundedMajorAxis ?? null,
          levelScore: educationEval?.levelScore ?? null,
          levelComparison: educationEval?.levelComparison ?? null,
          exactComparison: educationEval?.exactComparison ?? null,
          reason: educationEval?.reason ?? null,
          matchedTokens: educationEval?.matchedTokens ?? [],
          searchQueries: educationEval?.searchQueries ?? [],
          sources: educationEval?.sources?.slice(0, 8) ?? [],
          items: educationEval?.items?.slice(0, 10) ?? [],
          // What the model was asked (fingerprint), and — when it was not asked
          // in this run — the run whose identical-input answer was reused.
          inputKey: educationEval?.inputKey ?? null,
          reusedFrom: educationEval?.reusedFrom ?? null,
        },
      },
    };

    return { candidateId: candidate.id, closeness: cc, rank, details };
  };

  for (let i = 0; i < ranked.length; i++) {
    const row = rowDetails(i);
    await execute(
      `INSERT INTO analysis_results
       (id, run_id, position_id, candidate_id, method, final_score, rank, details, calculated_by, calculated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'AHP_TOPSIS', $4, $5, $6, $7, NOW())`,
      [
        session.runId,
        session.positionId,
        row.candidateId,
        row.closeness.toFixed(6),
        row.rank,
        JSON.stringify(row.details),
        session.createdBy,
      ]
    );
  }
  endPhase("persist");
  const rankingReadyAt = new Date().toISOString();

  // ── Insight notes (LLM) — AFTER the ranking is on disk (NFR-RR-05) ──
  //
  // The ranking and every number are already written above, with the
  // deterministic narrative, so a slow or unreachable writer can delay only the
  // prose, never the ranking. The run stays `in_progress` until the notes are
  // in, and only then is it marked `completed` — after which nothing about it
  // may change (I-1). The agent is handed the final scores as read-only context.
  //
  // A DEMO run never calls the writer: its finalists keep the deterministic
  // template narrative. Demo data is a sandbox copy of real people, and sending
  // it to a model to write prose about them is exactly what demo mode is for
  // avoiding — the ranking does not need the prose, so nothing is lost.
  await setAhpProgress(sessionId, { phase: "narrative", done: 0, total: ranked.length });
  if (narrativeLlmEnabled) try {
    const written = await runAhpNarrativeAgent(
      {
        title: position.title,
        department: position.department,
        division: position.division,
        experienceRequirement: position.experience,
        holderNames: position.holderName ? [position.holderName] : [],
        jobProfileName: jobProfile?.positionName ?? null,
        jobPurpose: jobProfile?.jobPurpose ?? position.jobPurpose ?? null,
        // Responsibilities WITH their success indicators when the job profile
        // resolved; the position's bare list otherwise. This is the block that
        // makes a recommendation specific to the seat rather than to the score.
        responsibilities: jobProfile?.responsibilityDetails?.length
          ? jobProfile.responsibilityDetails.map((r) => ({
              responsibility: r.responsibility,
              successIndicator: r.successIndicator,
            }))
          : (jobProfile?.responsibilities ?? position.responsibilities ?? []).map((r) => ({
              responsibility: String(r),
              successIndicator: null,
            })),
        // Never the incumbent's own education: that is a person's data, and the
        // writer only needs what the seat demands.
        educationRequirement:
          educationRequirement.source === "incumbent" ? null : educationRequirement.requirement,
      },
      narrativeInputs,
      {
        signal,
        onProgress: (done, total) =>
          setAhpProgress(sessionId, { phase: "narrative", done, total }).catch(() => {}),
      }
    );
    for (const [id, entry] of written) llmNarratives.set(id, entry);
  } catch (err) {
    // A ranking that is already computed must never be lost to the writer that
    // only describes it. Everyone falls back to the deterministic narrative.
    log("ahpTopsis.narrativeAgentFailed", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  for (let i = 0; i < ranked.length; i++) {
    const id = ranked[i]!.candidate.id;
    if (!llmNarratives.has(id)) continue;
    const row = rowDetails(i);
    await execute(
      `UPDATE analysis_results SET details = $1 WHERE run_id = $2 AND candidate_id = $3`,
      [JSON.stringify(row.details), session.runId, id]
    );
  }
  endPhase("narrative");

  // Run-level diagnostics (Section 1 of the Progress Running page): mismatches,
  // inaccurate criteria, and parameter dump surfaced before per-candidate detail.
  // Prefer a freshly computed detail — a reused one describes the base run's
  // required-competency set, which may since have changed.
  const anyTechnical = ((toScore.length > 0
    ? technicalDetails.get(toScore[0]!.id)
    : undefined) ?? technicalDetails.values().next().value) as
    | TechnicalDetail
    | undefined;
  /**
   * Every row's rank / score / readiness before and after, measured against the
   * parent's FULL scored pool.
   *
   * The child ranks on the parent's TOPSIS yardstick, so a carried-over
   * candidate keeps the parent's closeness exactly and can only move DOWN, by
   * the comparison candidates inserted above it (a child from before the
   * yardstick was frozen could also reorder carried candidates). A candidate
   * with no parent entry is new to this ranking; one whose parent entry sat
   * outside the finalist cut was pushed in from the pool.
   */
  function buildRankShifts() {
    return ranked.map((entry) => {
      const base = basePoolEntries.get(entry.candidate.id) ?? null;
      const newScore = Math.round(entry.closeness * 100);
      const baseScore = base ? Math.round(base.closeness * 100) : null;
      return {
        candidateId: entry.candidate.id,
        name: entry.candidate.name,
        baseRank: base?.poolRank ?? null,
        // Pool rank, so an appended below-cut candidate reports 23 rather than
        // its row position in this list.
        newRank: poolRankById.get(entry.candidate.id)!,
        baseScore,
        newScore,
        baseReadiness: baseScore == null ? null : readinessFor(baseScore),
        newReadiness: readinessFor(newScore),
        backfilled: base ? !base.isFinalist : false,
      };
    });
  }

  function buildAugmentInfo() {
    const shifts = buildRankShifts();
    return {
      baseRunId: rerun!.baseRunId,
      addedCandidates: rerun!.newCandidateIds.length + rerun!.existingPoolCandidateIds.length,
      computedCandidates: toScore.length,
      reusedCandidates: reused.size,
      // Always the parent's whole scored pool now: a parent without one is
      // refused when the child is created.
      poolSource: "pool_snapshot" as const,
      poolSourceReason: `Perangkingan memakai seluruh ${basePoolEntries.size} kandidat yang dinilai run induk ditambah ${rerun!.newCandidateIds.length} kandidat baru, dengan data, bobot, kriteria aktif, jangkar, tanggal acuan dan skala TOPSIS (pembagi serta titik ideal) yang dibekukan dari run induk — jadi kecocokan dan urutan kandidat lama sama dengan run induk, dan peringkatnya hanya turun sebanyak kandidat pembanding yang disisipkan di atasnya.`,
      newCount: shifts.filter((s) => s.baseRank == null).length,
      backfilledCount: shifts.filter((s) => s.backfilled).length,
      movedCount: shifts.filter((s) => s.baseRank != null && s.baseRank !== s.newRank).length,
      readinessChangedCount: shifts.filter(
        (s) => s.baseReadiness != null && s.baseReadiness !== s.newReadiness
      ).length,
      shifts,
    };
  }

  // A child with nobody new to score computed an empty pass; the parent's
  // career / technical sections are the ones that describe its numbers.
  const carryBaseDiagnostics = Boolean(rerun) && toScore.length === 0 && Boolean(baseRunInfo);

  // ── The position basis this run RECORDS for its own children (FR-RR-07) ──
  // The parent's, with any part that had to be read live replaced by what was
  // actually used; on a root (or a child of a pre-basis parent), the values
  // resolved above.
  const liveEducationForBasis = frozenEducation ? null : await educationForBasis(educationRequirement);
  const recordedBasis: PositionBasis = inheritedBasis
    ? {
        ...inheritedBasis,
        careerTarget: pinnedCareerTarget ? inheritedBasis.careerTarget : careerTargetUsed,
        education: liveEducationForBasis ?? inheritedBasis.education,
      }
    : {
        version: 1,
        resolvedByRunId: session.runId,
        resolvedAt: startedAt.toISOString(),
        originSource: frozen ? "live_fallback" : "own",
        jobProfile: frozenFromJobProfile(jobProfile),
        targetPositionCode: targetPositionCode || null,
        required: {
          items: targetRequired.required.map((r) => ({ ...r })),
          source: targetRequired.source,
          detail: targetRequired.detail,
          employeeIds: [...targetRequired.employeeIds],
        },
        education: liveEducationForBasis ?? {
          source: "none",
          requirement: null,
          requirementSealed: null,
          recorded: true,
        },
        careerTarget: careerTargetUsed,
        kamus: { fingerprint: liveKamus?.fingerprint ?? null, codes: liveKamus?.codes ?? null },
        embedding: {
          model: config.embedding.model,
          documentModel: liveDocumentModel,
          dimensions: careerTargetUsed.vector?.length ?? null,
        },
      };

  // ── Models and data versions (FR-SN-01 items 7 and 8) ──
  const runModels: RunModels = {
    embedding: {
      model: config.embedding.model,
      documentModel: liveDocumentModel ?? config.embedding.documentEmbeddingModel ?? null,
    },
    education: { provider: "gemini", model: config.gemini.model || null, configured: geminiConfigured() },
    narrative: {
      enabled: narrativeLlmEnabled,
      model: narrativeLlmEnabled ? config.llm.model : null,
    },
  };
  const dataVersions = await loadDataVersions(liveKamus);

  // What this run ranked WITH — full precision — so that a child of it inherits
  // these exact values (the web app's `resolveFrozenBasis` reads this first).
  // On a child they are the parent's (and therefore the root's); on a root they
  // are the ones this run resolved.
  const frozenRecord = buildFrozenRecord({
    frozen,
    runId: session.runId,
    referenceDate,
    weights,
    pairwise: ahpPairwise,
    weightSource,
    weightsInherited: Boolean(inheritedWeights),
    activeCriteria,
    liveDroppedCriteria,
    criteriaSource: criteriaFreeze.source,
    technical: technicalAnchors,
    career: careerAnchors,
    anchorsInherited: Boolean(inheritedTechnical && inheritedCareer),
    depth:
      pinnedCareerDepth ??
      (careerRunInfo.depth?.targetYears > 0 && careerRunInfo.depth?.targetRows > 0
        ? { targetYears: careerRunInfo.depth.targetYears, targetRows: careerRunInfo.depth.targetRows }
        : null),
    consistency: { cr, lambdaMax, ci },
    positionBasis: recordedBasis,
    models: runModels,
    topsis: recordedTopsis,
  });

  // What the position basis WAS for this run (FR-RR-07): inherited whole,
  // inherited with named parts read live (caveats), or resolved live.
  const positionBasisStatus = {
    source: basisSource,
    resolvedByRunId: recordedBasis.resolvedByRunId,
    originSource: recordedBasis.originSource,
    caveats: basisCaveatList,
    liveParts: [
      ...(inheritedBasis && pinnedCareerTarget == null ? ["careerTarget"] : []),
      ...(inheritedBasis && !frozenEducation ? ["education"] : []),
    ],
  };

  // ── The run trace (drizzle/0092) — written BEFORE `completed` (I-1) ──
  // Everything between the raw data and the rank that the records above keep
  // only rounded or not at all. Best-effort: a trace that cannot be written is
  // reported in run_info.trace and never fails the ranking.
  const traceOutcome = await (async () => {
    try {
      const toScoreIds = new Set(toScore.map((c) => c.id));
      const candidateTraces: Record<string, CandidateTrace> = {};
      let fromParentTrace = 0;
      const carriedFallbackKeys = new Set<string>();
      for (const c of candidates) {
        const aspects = aspectScoresById.get(c.id)!;
        if (!toScoreIds.has(c.id) && reused.has(c.id)) {
          const inherited = parentTrace?.candidates?.[c.id] ?? null;
          if (inherited) {
            fromParentTrace += 1;
            for (const s of inherited.career?.stints ?? []) if (s.fallbackKey) carriedFallbackKeys.add(s.fallbackKey);
          }
          candidateTraces[c.id] = inherited
            ? { ...inherited, carriedFrom: inherited.carriedFrom ?? baseRunId, aspects }
            : {
                carriedFrom: baseRunId,
                technical: null,
                career: null,
                behavior: null,
                performance: null,
                hav: null,
                education: null,
                aspects,
              };
          continue;
        }
        candidateTraces[c.id] = {
          carriedFrom: null,
          technical: technicalTrace.get(c.id) ?? null,
          career: careerTrace.candidates.get(c.id) ?? null,
          behavior: traceBehaviorAspect(c.behaviorRecommendation),
          performance: tracePerformanceAspect(c.performanceGrade),
          hav: havTraceFor(c),
          education: educationTrace.map.get(c.id) ?? null,
          aspects,
        };
      }
      const fallbacks: Record<string, CareerFallbackTrace> = {};
      for (const key of carriedFallbackKeys) {
        const f = parentTrace?.career?.fallbacks?.[key];
        if (f) fallbacks[key] = f;
      }
      for (const [key, f] of careerTrace.fallbacks) fallbacks[key] = f;

      const technicalInherited = Boolean(inheritedTechnical);
      const careerInherited = Boolean(inheritedCareer);
      const depthPinned = careerTrace.depth.pinned != null;
      const trace: EngineTrace = {
        version: RUN_TRACE_VERSION,
        stage: "engine",
        runId: session.runId!,
        sessionId,
        generatedAt: new Date().toISOString(),
        process: {
          timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || null,
          offsetMinutes: -referenceDate.getTimezoneOffset(),
          node: process.version,
        },
        referenceDate: referenceDate.toISOString(),
        referenceDateLocal: localDateString(referenceDate) ?? "",
        parameters: collectTraceParameters(),
        technical: {
          required: targetRefs.map((r) => ({ name: r.name, code: r.code, norm: r.norm, level: r.level })),
          requiredSource: targetRequired.source,
          requiredDetail: targetRequired.detail,
          anchors: {
            simFloor: technicalAnchors.simFloor,
            simCeil: technicalAnchors.simCeil,
            source: technicalAnchors.source,
            fingerprint: technicalAnchors.fingerprint ?? (technicalInherited ? parentTrace?.technical.anchors.fingerprint ?? null : null),
            inherited: technicalInherited,
          },
          census: technicalAnchors.census ?? (technicalInherited ? parentTrace?.technical.census ?? null : null),
          kamusResolvedByCache: kamusCodes.resolvedByCache,
        },
        career: {
          anchors: {
            simFloor: careerAnchors.simFloor,
            simCeil: careerAnchors.simCeil,
            source: careerAnchors.source,
            fingerprint: careerAnchors.fingerprint ?? (careerInherited ? parentTrace?.career.anchors.fingerprint ?? null : null),
            inherited: careerInherited,
            estimates: (careerInherited ? parentTrace?.career.anchors.estimates ?? [] : careerAnchors.estimates).map((e) => ({
              source: e.source,
              floor: e.floor,
              ceil: e.ceil,
              sampleCount: e.sampleCount,
            })),
          },
          census: careerAnchors.census ?? (careerInherited ? parentTrace?.career.census ?? [] : []),
          target: careerTrace.target ?? {
            jobProfileId: null,
            jobProfileName: null,
            matchType: null,
            status: careerRunInfo.targetStatus,
            statedExperience: null,
            pinned: Boolean(pinnedCareerTarget),
          },
          calibration: careerTrace.calibration,
          depth: {
            targetYears: careerRunInfo.depth.targetYears,
            targetRows: careerRunInfo.depth.targetRows,
            source: careerRunInfo.depth.source,
            pinned: careerTrace.depth.pinned,
            statedExperience: careerTrace.depth.statedExperience,
            statedParsedYears: careerTrace.depth.statedParsedYears,
            fromStated: careerTrace.depth.fromStated,
            readsStated: careerTrace.depth.readsStated,
            useStated: careerTrace.depth.useStated,
            level: careerTrace.depth.level,
            levelLabel: careerTrace.depth.levelLabel,
            measured: careerTrace.depth.measured,
            defaultYears: careerTrace.depth.defaultYears,
            census: careerTrace.depth.census ?? (depthPinned ? parentTrace?.career.depth.census ?? null : null),
          },
          idf: careerTrace.idf ?? parentTrace?.career.idf ?? null,
          fallbacks,
        },
        ahp: {
          pairwise: ahpPairwise,
          weightsUsed: { ...weights },
          weightSource,
          weightsInherited: Boolean(inheritedWeights),
          resolved: { weights: { ...resolvedWeights }, lambdaMax: resolvedLambdaMax, ci: resolvedCi, cr: resolvedCr },
          reported: { lambdaMax, ci, cr },
          inputCheck: ahpCheck,
          randomIndex: RANDOM_INDEX[AHP_CRITERIA_ORDER.length] ?? 1.49,
        },
        topsis: {
          activeCriteria: [...activeCriteria],
          weightVector: [...topsisDetail.weightVector],
          rowIds: [...topsisDetail.rowIds],
          matrix: topsisDetail.rowIds.map((id) => activeCriteria.map((k) => aspectScoresById.get(id)![k])),
          colNorms: [...topsisDetail.colNorms],
          idealPos: [...topsisDetail.idealPos],
          idealNeg: [...topsisDetail.idealNeg],
          closeness: [...topsisDetail.closeness],
          dPlus: [...topsisDetail.dPlus],
          dMinus: [...topsisDetail.dMinus],
          targetFinalists,
          // Anchored (a child): colNorms / idealPos / idealNeg above are the
          // PARENT's yardstick, not derived from this matrix; `clamped` marks
          // cells placed at an ideal.
          anchored: topsisDetail.anchored,
          anchorSource: recordedTopsis.source,
          clamped: topsisDetail.clamped.map((row) => [...row]),
        },
        readiness: {
          source: readinessSource,
          thresholds: runThresholds ? runThresholds.thresholds.map((t) => ({ ...t })) : null,
          defaultLevel: runThresholds?.defaultLevel ?? null,
        },
        carried: {
          parentRunId: baseRunId,
          candidateIds: [...reused.keys()].filter((id) => !toScoreIds.has(id)),
          fromParentTrace,
        },
        candidates: candidateTraces,
      };
      return await persistEngineTrace(trace, session.tenantId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log("ahpTopsis.traceFailed", { runId: session.runId, error: reason });
      return { recorded: false, stage: "engine" as const, version: RUN_TRACE_VERSION, sealed: false, bytes: 0, reason };
    }
  })();

  const runInfo = {
    jobProfileMatched: jobProfile?.positionName ?? null,
    scoredCandidates: rankedAll.length,
    // Whether the calculation trace (drizzle/0092) was written, and if not, why.
    trace: traceOutcome,
    finalists: cutoff.length,
    // Rows persisted below the finalist cut because they were asked for by name.
    appendedBelowCut: appended.length,
    // The derived run's own account of itself, echoed from the spec the web app
    // wrote. `scoring_runs.rerun_mode` / `config_snapshot.rerun` are the
    // authority; this copy exists so a reader holding only `runInfo` can still
    // explain the numbers. Null on a root.
    rerun: rerun
      ? {
          mode: rerun.mode,
          parentRunId: rerun.baseRunId,
          rootRunId: frozen!.rootRunId,
          newCandidates: rerun.newCandidateIds.length,
          existingPoolCandidates: rerun.existingPoolCandidateIds.length,
          ahpSource: frozenRecord.ahp.source,
          anchorsSource: frozenRecord.anchors.source,
          referenceDate: frozenRecord.referenceDate,
          // Criteria a live evaluation would have treated differently (e.g. an
          // added candidate is the first who can be assessed on education). The
          // parent's set was applied; this says what was not.
          criteriaLiveDisagrees: criteriaFreeze.liveDisagrees,
          // Carried candidates soft-deleted since the parent — kept, because
          // they are part of the parent's alternative set.
          carriedDeleted: carriedDeletedCount,
          positionBasis: positionBasisStatus,
          // The parent's model ids against this run's — a provider cannot be
          // pinned to a model it may no longer serve, so a move is reported.
          modelsChanged: modelDifferences(frozen?.models ?? null, runModels),
          // The yardstick the ranking used: the parent's (recorded, or
          // re-derived from its stored pool), so carried candidates keep their
          // parent closeness exactly. `clamped`: added candidates placed AT the
          // parent's ideal on the listed criteria because they exceeded it.
          topsis: {
            mode: recordedTopsis.mode,
            source: recordedTopsis.source,
            clamped: topsisClamped,
          },
        }
      : null,
    // Position basis this run scored against, and how it was obtained.
    positionBasisStatus,
    // What each phase took on THIS run (NFR-RR-05). `rankingReadyAt` is when
    // the ranking was on disk; the narrative followed it.
    timings: {
      startedAt: startedAt.toISOString(),
      rankingReadyAt,
      completedAt: null as string | null,
      validationMs: frozen?.validationMs ?? null,
      phasesMs: phaseMs,
      totalMs: 0,
    },
    // Model ids and data versions (FR-SN-01 items 7 and 8).
    models: runModels,
    dataVersions,
    // Where the readiness labels came from (FR-SN-04).
    readiness: {
      source: readinessSource,
      thresholds: runThresholds,
    },
    // Rows whose four aspects are constants, not measurements.
    provisional: { count: provisionalIds.size },
    // Rank/score movement against the parent (null on a root).
    augment: rerun ? buildAugmentInfo() : null,
    // How far the parent's data has drifted since, NOT applied (null on a root).
    freshness,
    // What this run ranked with, at full precision — inherited by its children.
    frozen: frozenRecord,
    // Where each scored candidate's HAV came from (hav-effective.ts): a Talent
    // Mapping placement, the HAV upload, or the formula. `formula` rows re-weigh
    // PA and behaviour through the HAV aspect — HR chose to accept that overlap,
    // and this is where a run admits how much of it there was.
    hav: { precedence: "manual>upload>formula", sources: countHavSources(candidates) },
    // How many education model answers this run reused from the last run of the
    // position instead of asking again (education-reuse.ts). `eligible` counts
    // the candidates scored here that needed the model at all — an exact match
    // never does — so reused + modelCalls ≤ eligible (the gap is candidates the
    // model could not be called for: no API key).
    education: {
      reuse: {
        enabled: config.ahpTopsis.educationReuse,
        fromRunId: educationReuse.source?.runId ?? null,
        fromCompletedAt: educationReuse.source?.completedAt ?? null,
        eligible: educationReuse.eligible,
        reused: educationReuse.reused,
        modelCalls: educationReuse.modelCalls,
      },
    },
    // Who wrote the insight bullets. A run where the LLM was unreachable still
    // renders three populated sections — from the aspect templates — so without
    // this the difference between a written note and a canned one is invisible.
    narrative: {
      llmEnabled: narrativeLlmEnabled,
      model: narrativeLlmEnabled ? config.llm.model : null,
      // Why the writer did not run when it did not: 'demo' (a demo-mode run
      // never calls it) or 'config' (AHP_NARRATIVE_LLM=false). The web app
      // shows no fallback banner for 'demo' — demo mode carries no indicator.
      disabledBy: narrativeLlmEnabled ? null : session.isDemo === true ? "demo" : "config",
      llmWritten: llmNarratives.size,
      templateFallback: Math.max(0, ranked.length - llmNarratives.size),
    },
    // Always null: application-level encryption was removed, so candidate
    // columns are always readable. The key stays because older runs carry a
    // non-null value here (sealed columns were unreadable) and readers check it.
    encryption: null,
    career: carryBaseDiagnostics ? baseRunInfo!.career ?? careerRunInfo : careerRunInfo,
    technical:
      carryBaseDiagnostics && baseRunInfo!.technical
        ? baseRunInfo!.technical
        : {
            requiredCount: anyTechnical?.requiredCount ?? 0,
            hasRequired: (anyTechnical?.requiredCount ?? 0) > 0,
            // Where the reference competency set came from — "incumbent" /
            // "position_aggregate" mean the position had no job profile.
            requiredSource: targetRequired.source,
            requiredSourceDetail: targetRequired.detail,
            // The anchors every semantic cosine was stretched onto 0..1 with,
            // and WHERE they came from. Recorded per run because they are
            // derived from the kamus embedding corpus and move when it does —
            // which is exactly why a finished ranking has to carry its own copy.
            simFloor: Number(technicalAnchors.simFloor.toFixed(4)),
            simCeil: Number(technicalAnchors.simCeil.toFixed(4)),
            simAnchorSource: technicalAnchors.source,
            simScaleReason: `${technicalAnchors.reason} Model teks yang dipakai: ${config.embedding.documentEmbeddingModel}. Nilai kemiripan makna teks tidak bisa dibaca langsung sebagai persentase — pada kamus ini dua kompetensi yang sama sekali berbeda pun tetap terlihat cukup mirip, sehingga nilai mentahnya akan memberi puluhan poin untuk pasangan yang sebenarnya tidak berhubungan. Kedua batas ini menggambarkan isi kamus, bukan daftar kandidat yang ikut run.`,
            // Pairs whose level term was left neutral because the candidate's
            // proficiency was unreadable. Surfaced because it means "belum
            // diasesmen", not "di bawah target" — an unknown is not a finding.
            levelUnknownPairs: [...technicalDetails.values()].reduce(
              (a, d) => a + (d.levelUnknownPairs ?? 0),
              0
            ),
            // Required competencies nothing could ever score — no kamus code and
            // no candidate holding the literal name. Excluded from the divisor
            // (they would depress every candidate equally), but named here
            // because a job profile demanding something the kamus does not
            // define is a governance finding, not a scoring detail.
            unmeasurableRequired: anyTechnical?.unmeasurableCount ?? 0,
            effectiveRequiredCount: anyTechnical?.effectiveRequiredCount ?? 0,
            unmeasurableNames: (anyTechnical?.pairs ?? [])
              .filter((p) => p.matchType === "unmeasurable")
              .map((p) => p.required.name),
            // How many names the web app's resolver mapped onto kamus codes
            // beyond the exact tier. 0 with unresolved names present means the
            // cache was never primed, not that every name was already exact.
            kamusResolvedByCache: kamusCodes.resolvedByCache,
            levelRule:
              "Faktor level: bila level kandidat (k) kurang dari yang dituntut (t), faktor = 1 − (t − k) ÷ 4, sehingga kurang 1/2/3 level bernilai 0.75/0.50/0.25 dan tidak pernah nol — memiliki kompetensinya meski jauh di bawah level tetap dihargai. Bila memenuhi atau melebihi, faktor = 1.00, dengan tambahan hingga 1.75 khusus pasangan yang identitas kompetensinya sama — melebihi level yang dituntut memang dihargai besar. Level yang tidak terbaca diberi faktor 1.00 (netral): tidak menambah dan tidak mengurangi, karena tidak diasesmen bukan berarti kurang.",
          },
    ahp: {
      weightSource,
      consistencyRatio: Number(cr.toFixed(4)),
      lambdaMax: Number(lambdaMax.toFixed(4)),
      consistencyIndex: Number(ci.toFixed(4)),
      inconsistent: cr > 0.1,
      weights,
      // Criterion order of the pairwise rows/cols + the Saaty-scale matrix used
      // this run (governance-edited when source === "ahp-matrix", else derived).
      criteriaOrder: [...AHP_CRITERIA_ORDER],
      // Full precision (was 4 decimals: 1/3 → 0.3333), with each cell's Saaty
      // label beside it, so this copy is the matrix the run used.
      pairwise: ahpPairwise.map((r) => [...r]),
      pairwiseLabels: ahpPairwise.map((r) => r.map((v) => saatyLabel(v))),
      pairwisePrecision: "full",
      inputCheck: ahpCheck,
      // Criteria nobody could be scored on: excluded from the TOPSIS matrix and
      // their AHP share redistributed over the rest.
      droppedCriteria,
      activeCriteria: [...activeCriteria],
      effectiveWeights,
    },
  };

  endPhase("finalize");
  const completedAt = new Date();
  runInfo.timings.completedAt = completedAt.toISOString();
  runInfo.timings.totalMs = completedAt.getTime() - startedAt.getTime();

  // The diagnostics on the RUN, which is where they belong: a session is
  // working space and is legitimately transient (the wizard used to delete its
  // own session on success, which erased every run's diagnostics the instant it
  // succeeded), while a completed ranking is a permanent record. Written while
  // the run is still `in_progress`: once it is `completed`, nothing about it may
  // change (I-1, enforced in the database by drizzle/0087). Readers COALESCE
  // run first, session second, so a failed write here degrades into the
  // session copy rather than contradicting it.
  await execute(`UPDATE scoring_runs SET run_info = $1::jsonb WHERE id = $2`, [
    JSON.stringify(runInfo),
    session.runId,
  ]).catch((err) => {
    log("ahpTopsis.runInfoPersistFailed", { runId: session.runId, error: String(err) });
  });

  // A child whose parent recorded no weights or no anchors resolved them live.
  // The values it USED are filled into its own `config_snapshot.rerun.frozen`
  // — the one deferred field of a snapshot otherwise written once at creation,
  // because those values did not exist until this point — so the snapshot never
  // carries a fallback without the number it fell back to.
  if (
    frozen &&
    (frozenRecord.ahp.source === "live_fallback" || frozenRecord.anchors.source === "live_fallback")
  ) {
    const filled = {
      ...frozen,
      ahp: {
        ...frozen.ahp,
        weights: frozenRecord.ahp.weights,
        pairwise: frozenRecord.ahp.pairwise,
        activeCriteria: frozenRecord.ahp.activeCriteria,
        droppedCriteria: frozenRecord.ahp.droppedCriteria,
        weightSource: frozenRecord.ahp.weightSource,
      },
      anchors: {
        ...frozen.anchors,
        technical: frozenRecord.anchors.technical,
        career: frozenRecord.anchors.career,
        depth: frozenRecord.anchors.depth,
      },
    };
    await execute(
      `UPDATE scoring_runs
          SET config_snapshot = jsonb_set(config_snapshot, '{rerun,frozen}', $1::jsonb)
        WHERE id = $2 AND config_snapshot ? 'rerun'`,
      [JSON.stringify(filled), session.runId]
    ).catch((err) => {
      log("ahpTopsis.snapshotFallbackFillFailed", { runId: session.runId, error: String(err) });
    });
  }

  // `completed` is the LAST thing written to the run. From here on the run is a
  // record of an assessment on a date and is immutable (I-1).
  await execute(
    `UPDATE scoring_runs
     SET status = 'completed', candidate_count = $1, completed_at = NOW()
     WHERE id = $2 AND status = 'in_progress'`,
    [ranked.length, session.runId]
  );

  await execute(
    `UPDATE tournament_sessions
     SET status = 'completed',
         final_ranked = COALESCE(final_ranked, '{}'::jsonb) || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [
      JSON.stringify({
        ahpProgress: { phase: "completed", done: ranked.length, total: ranked.length },
        runInfo,
      }),
      sessionId,
    ]
  );

  log("ahpTopsis.complete", {
    sessionId,
    runId: session.runId,
    candidateCount: ranked.length,
    weightSource,
    cr: Number(cr.toFixed(4)),
    computed: toScore.length,
    reused: reused.size,
  });

  return { runId: session.runId, candidateCount: ranked.length };
}
