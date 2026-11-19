'use server';

// Read-only detail of an AHP+TOPSIS scoring run, surfacing the per-candidate
// technical-competency matching (exact-gap / semantic + Hungarian assignment,
// persisted by the scoring-service into
// analysis_results.details.ahpTopsis.technicalMatching) plus the other aspect
// scores. Scoped to the current tenant. Consumed by the Readiness tab of a
// position's run-scoring page (components/analysis/run-candidate-analysis).

import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isDemoSql } from '@/lib/demo/run-mode';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_NPK } from '@/lib/app-mode-shared';
import { programTemplates, AHP_CRITERIA_ORDER } from '@/lib/db/schema';
import type {
  DefaultCriterion,
  FilterConditionGroup,
  RunConfigSnapshot,
} from '@/lib/db/schema';
import { computeAhpWeights, isValidPairwise } from '@/lib/ahp';
import { countFilterRules, normalizeFilterTree } from '@/lib/filter-rules';
import { getProgramTemplate } from '@/lib/programs';
import { decryptCandidateDetailsSnapshot } from '@/lib/candidate-crypto';
import { requirePermission } from '@/lib/rbac';
import { getCurrentTenantId, TENANTS } from '@/lib/tenant';
import { getReadinessConfig, type ReadinessConfig } from '@/lib/readiness-config-actions';
import { demoScrub } from '@/lib/demo/names';

// ── Shared shapes (mirrors scoring-service TechnicalDetail) ─────────

export type TechnicalPair = {
  required: { name: string; level: number; code: string | null };
  candidate: { name: string; level: number; code: string | null } | null;
  /**
   * exact = identity, same literal name. code = identity, different spellings
   * resolved to one kamus code. semantic = paired by embedding similarity.
   * unmeasurable = column nothing could score; excluded from the divisor.
   */
  matchType: 'exact' | 'code' | 'semantic' | 'unmatched' | 'unmeasurable';
  /** sim′ × levelFactor. Every field below is absent on runs scored before this. */
  value: number;
  /** Rescaled similarity credited (0..1); 1 for an exact name match. */
  similarity?: number | null;
  /** Raw cosine the rescale started from; null for exact matches. */
  similarityRaw?: number | null;
  /** Level term applied (0..1.75); 1 when the candidate's level is unknown. */
  levelFactor?: number;
  /** Candidate proficiency unreadable — level left neutral, not scored as a gap. */
  levelUnknown?: boolean;
};

/**
 * Which tier produced the target's reference competency set. "incumbent" and
 * "position_aggregate" mean the position has NO job profile and the people
 * holding it stood in for one.
 */
export type RequiredSource =
  | 'profile'
  | 'critical_position'
  | 'incumbent'
  | 'position_aggregate'
  | 'none';

export type TechnicalDetail = {
  /**
   * 0..100. Runs finished BEFORE the aggregate was saturated can hold a value
   * above 100 (measured: 6 rows, all 113) — those are kept as scored, never
   * rewritten, and labelled as such wherever they render. A run's score is the
   * record of an assessment on a date.
   */
  score: number;
  /** `score` / 100 — the saturated mean, and the TOPSIS input. */
  normalized: number;
  /**
   * The mean BEFORE saturation. Above 1 means the candidate overshot the
   * requirements; that is a finding, not a higher score. Absent on runs scored
   * before it was recorded.
   */
  normalizedRaw?: number;
  requiredCount: number;
  candidateCount: number;
  pairs: TechnicalPair[];
  /** Candidate competencies left unpaired by Hungarian (N>M); contribute 0. Absent on older runs. */
  surplusCandidates?: { name: string; level: number; code: string | null }[];
  /** Provenance of the reference set. Absent on older runs. */
  requiredSource?: RequiredSource;
  requiredSourceDetail?: string | null;
  /** Pairs whose level term was neutral because the proficiency was unreadable. */
  levelUnknownPairs?: number;
  /** Required competencies nothing could ever score. Excluded from the divisor. */
  unmeasurableCount?: number;
  /** requiredCount minus unmeasurableCount — the divisor actually used. */
  effectiveRequiredCount?: number;
  /** Pairs settled by identity before the similarity stage. Absent on older runs. */
  identityPairs?: number;
  /** Anchors semantic cosines were stretched onto 0..1 with. Absent on older runs. */
  simFloor?: number;
  simCeil?: number;
};

// ── Career relevance (mirrors scoring-service CareerDetail) ─────────

export type CareerMatchStatus = 'ok' | 'no_match' | 'no_embedding';

/**
 * How a position resolved to a comparable representation. The first four mirror
 * the Job Family Sync matcher; the last three are the profile-less fallbacks.
 */
export type CareerMatchType =
  | 'filename'
  | 'jfm'
  | 'exact'
  | 'embedding'
  | 'incumbent_competency'
  | 'incumbent_position'
  | 'pseudo_profile';

/** How a stint's similarity was obtained. */
export type CareerScoreBasis = 'document' | 'incumbent_competency' | 'unscored';

/**
 * WHY a stint contributed 0. Three different failures, each pointing at
 * different data to fix:
 *   no_target_reference     — the target has no reference competency set at all,
 *                             so the fallback could not run for any stint.
 *   no_position_code        — the stint is recorded by title only, so there is no
 *                             key to look its incumbents up with.
 *   no_incumbent_competency — the code is known but no usable holder / no
 *                             competency rows.
 * Absent on runs made before the engine split these apart.
 */
export type CareerUnscoredReason =
  | 'no_target_reference'
  | 'no_position_code'
  | 'no_incumbent_competency';

/** Which temporal tier selected an incumbent's competency assessment. */
export type CompetencyBasis = 'position_column' | 'create_date_window' | 'active_all';

export type CareerPair = {
  positionId: string | null;
  companyId: string | null;
  title: string;
  years: number;
  isCurrent: boolean;
  /** How the stint resolved to a JOB PROFILE (not how it was scored — see `basis`). */
  status: CareerMatchStatus;
  /** How this stint resolved; null when unmatched. Absent on older runs. */
  matchType?: CareerMatchType | null;
  jobProfileId: number | null;
  jobProfileName: string | null;
  /**
   * RESCALED similarity (0..1) actually accumulated. On runs before the rescale
   * this is the raw cosine instead — `similarityRaw` is absent there.
   */
  similarity: number | null;
  /** Pre-rescale similarity on the raw cosine scale. Absent on older runs. */
  similarityRaw?: number | null;
  /**
   * Human-capital depreciation factor: exp(−δ × years since the stint ended), 1.0
   * while ongoing. ABSENT on runs made before recency was applied at all — treat
   * a missing value as 1, which is exactly what those runs did.
   */
  recencyFactor?: number;
  /** similarity × years × recency — this stint's contribution. Absent on older runs. */
  effectiveYears?: number;
  /** Which path produced `similarity`. Absent on older runs (always document). */
  basis?: CareerScoreBasis;
  /** Why it contributed 0; null/absent unless `basis === 'unscored'`. */
  unscoredReason?: CareerUnscoredReason | null;
  /** Raw Σ/M coverage before calibration (competency fallback only). */
  fallbackRaw?: number | null;
  fallbackEmployeeIds?: string[];
  fallbackBasis?: CompetencyBasis | null;
  fallbackPairs?: TechnicalPair[];
};

/** How the fallback coverage was mapped onto the document-similarity scale. */
export type CareerCalibration = {
  lo: number;
  hi: number;
  /**
   * 'capped'    = the measured scale, top held at `cap` of it so a competency
   *               argument cannot assert "same job".
   * 'pinned'    = operator-pinned anchors.
   * 'inherited' = pinned to the base run's calibration on an incremental run.
   * 'empirical' / 'fixed' = the RETIRED per-run p5/p95 rule. Only historical runs
   *               carry these, and they must keep rendering — those numbers came
   *               from a band whose top was the best document match in the run.
   */
  source: 'capped' | 'pinned' | 'inherited' | 'empirical' | 'fixed';
  /** Fraction of the measured band full coverage may reach. Absent on older runs. */
  cap?: number;
  sampleCount: number;
  /** Whether coverage was IDF-weighted. Absent (i.e. false) on older runs. */
  idfWeighted?: boolean;
  reason: string;
};

/** One estimator's answer for the anchor pair (see scoring-service/career-anchors.ts). */
export type CareerAnchorEstimate = {
  source: 'corpus' | 'family' | 'transitions';
  floor: number;
  ceil: number;
  sampleCount: number;
  note: string;
};

/**
 * The anchors every stint similarity was stretched onto 0..1 with. Fixed within a
 * run and across runs — never per-run percentiles — but MEASURED, and recomputed
 * when the job-profile corpus changes. `source`/`sampleCount`/`docCount` are
 * absent on runs made before the census existed, where the values were hardcoded
 * per model family; `estimates` is absent on runs from before there were three.
 */
export type CareerScale = {
  simFloor: number;
  simCeil: number;
  /** env = pinned by operator · measured = median of the estimators · fallback = defaults. */
  source?: 'env' | 'measured' | 'fallback';
  /** Cross-pairs the corpus estimator was taken over (0 when not measured). */
  sampleCount?: number;
  docCount?: number;
  /**
   * Every estimator that contributed. Its absence is meaningful: a run without it
   * was anchored on the arbitrary-pair census alone, whose floor sat where only
   * 10% of pairs are genuinely related.
   */
  estimates?: CareerAnchorEstimate[];
  reason: string;
};

/** The experience yardstick depth was measured against, and where it came from. */
export type CareerDepthTargets = {
  targetYears: number;
  targetRows: number;
  /**
   * jd = the target JD's stated requirement × multiplier · fixed = absolute
   * config default · inherited = base run · pool = RETIRED (median of the run's
   * own candidates × 2), which only historical runs carry and which makes those
   * scores incomparable with later ones.
   */
  source: 'jd' | 'measured' | 'fixed' | 'inherited' | 'pool';
  /** The JD's stated minimum in years, when one was parsed. Absent on older runs. */
  statedExperienceYears?: number | null;
  statedExperienceText?: string | null;
  /**
   * Multiplier applied to the JD's stated minimum on this run. Absent on runs
   * finished before it was recorded — those were all scored at 2, so readers
   * must default to 2 rather than to today's setting.
   */
  statedExperienceMultiplier?: number | null;
  /**
   * Why a parsed stated minimum did NOT become the target. Distinguishing this
   * from "the JD says nothing" is the whole point: an operator read a correctly
   * detected 5-year requirement as undetected because both cases printed the same
   * ambiguous sentence.
   */
  statedIgnoredReason?: 'mode-ignore' | 'below-floor' | null;
  /** How a stated minimum is turned into a target. Absent on older runs. */
  statedMode?: 'scaled' | 'direct' | 'ignore';
  statedMultiplier?: number;
  /** Seniority band read from the target's title. */
  level?: string | null;
  levelLabel?: string | null;
  /**
   * The appointment census behind a `measured` target: the median years of service
   * of people actually appointed to a job at this level. Absent on runs that
   * predate it.
   */
  measured?: {
    years: number;
    basis: 'level' | 'overall' | 'monotonic';
    sampleCount: number;
    reason: string;
  } | null;
  /** Pool medians — DIAGNOSTIC only on current runs; they were the yardstick before. */
  medianEffectiveYears: number;
  medianEffectiveRows: number;
  poolSize: number;
  /** score = depthYears × (1−w + w×depthRows). Absent on runs that used min(). */
  breadthWeight?: number;
  /** x^(1/γ) saturation exponent; 1 = linear. Absent on older runs (linear). */
  concavity?: number;
  /** Per-year decay on a finished stint. Absent on older runs (no decay at all). */
  recencyDecayPerYear?: number;
  reason: string;
};

export type CareerDetail = {
  score: number;
  /**
   * depthYears × (1−w + w×depthRows) on current runs; `min(depthYears, depthRows)`
   * on runs between the accumulation rework and the shape change; the old
   * duration-weighted mean on the oldest ones. Three different formulas have worn
   * this field name, which is why `targetSource` and `breadthWeight` have to
   * travel with the number.
   */
  normalized: number;
  /** ── Accumulated relevant experience (absent on runs before the rework) ── */
  /** Σ(sim'×years×recency) over scored stints. */
  effectiveYears?: number;
  /** Σ(sim'×recency) over scored stints. */
  effectiveRows?: number;
  depthYears?: number;
  depthRows?: number;
  /**
   * Which axis costs this candidate more. On current runs this compares points
   * LOST (1−depthYears against w×(1−depthRows)); on older runs it was simply
   * whichever attainment was lower, because the two combined with min().
   */
  binding?: 'years' | 'rows';
  targetYears?: number;
  targetRows?: number;
  /** Where the yardstick came from — 'pool' means the score is pool-relative. */
  targetSource?: CareerDepthTargets['source'];
  /**
   * The shape parameters that produced `normalized`, echoed per candidate so a
   * stored row explains itself. Their ABSENCE is the marker for the old
   * `min(both axes)` formula with no recency decay — three formulas have used the
   * `normalized` field name, and nothing else distinguishes them.
   */
  breadthWeight?: number;
  concavity?: number;
  recencyDecayPerYear?: number;
  /** The target JD's stated requirement, when the yardstick came from it. */
  statedExperienceYears?: number | null;
  statedExperienceText?: string | null;
  /**
   * Multiplier applied to the JD's stated minimum on this run. Absent on runs
   * finished before it was recorded — those were all scored at 2, so readers
   * must default to 2 rather than to today's setting.
   */
  statedExperienceMultiplier?: number | null;
  /*
   * How the depth yardstick was chosen — mirrors the engine's CareerDetail
   * (scoring-service/src/ahp-topsis-engine.ts), which writes all five on every
   * candidate. Optional because runs finished before they existed lack them.
   */
  /** Why a parsed stated minimum did not become the target (null when it did). */
  statedIgnoredReason?: 'mode-ignore' | 'below-floor' | null;
  /** How the stated minimum was turned into a target. */
  statedMode?: 'scaled' | 'direct' | 'ignore';
  /** The multiplier as the engine applied it (same value as statedExperienceMultiplier). */
  statedMultiplier?: number;
  /** Seniority band of the target position, for a `measured` yardstick. */
  levelLabel?: string | null;
  /** The appointment census behind a `measured` target. */
  measured?: {
    years: number;
    basis: 'level' | 'overall' | 'monotonic';
    sampleCount: number;
    reason: string;
  } | null;
  /** Duration-weighted mean similarity — diagnostic only, no longer the score. */
  meanSimilarity?: number;
  matchedYears: number;
  totalYears: number;
  targetStatus: CareerMatchStatus;
  targetJobProfileId: number | null;
  targetJobProfileName: string | null;
  matchedCount: number;
  unmatchedCount: number;
  pairs: CareerPair[];
  /** ── Coverage breakdown (absent on older runs) ── */
  documentCount?: number;
  documentYears?: number;
  fallbackCount?: number;
  fallbackYears?: number;
  unscoredCount?: number;
  unscoredYears?: number;
  /** Share of total tenure that produced a score, 0..1. */
  coverage?: number;
  /**
   * The fallback calibration in force for this candidate's run (null when no
   * stint needed it, absent on runs before it was carried per candidate). Stored
   * per candidate so an incremental run can pin it, like targetYears/targetRows.
   */
  calibration?: CareerCalibration | null;
};

// ── Remaining per-criterion detail blocks for the candidate dropdown ─

export type BehaviorDetail = { recommendation: string | null; notes: string | null; score: number };
export type PerformanceDetail = { grade: string | null; score: number };
export type HavDetail = { quadrant: string | null; score: number };
export type EducationItem = { idResponsibility: number; score: number; analysis: string };
export type GroundingSource = { title: string; uri: string };
export type EducationDetail = {
  education: string | null;
  major: string | null;
  /** Job profile's stated education requirement (extracted jobSpecification.education). */
  requirement: string | null;
  /** Where that requirement came from — 'incumbent' is a fallback, not a spec. */
  requirementSource?: 'profile' | 'critical_position' | 'incumbent' | 'none';
  /** exact-match | llm-grounded | llm-structured | bert-fallback | none */
  source: string;
  /** Final 0-100 education aspect score (100 on an exact match). */
  score: number;
  /**
   * RAW grounded-LLM answers (0-100), null on exact-match/fallback. INPUTS, not
   * axes: both accumulate into `groundedMajorAxis`, because the level axis is
   * decided by rule on every path and never by the model.
   */
  educationLevel: number | null;
  majorRelevance: number | null;
  /**
   * LLM PATH: the single axis the two grounded answers accumulate into —
   * mean(educationLevel, majorRelevance). Absent on runs scored before the level
   * axis was moved out of the model's hands.
   */
  groundedMajorAxis?: number | null;
  /**
   * The level axis by RULE (100 higher / 80 equal / 50 lower), on BOTH paths.
   * Null when neither side names a recognisable level — the axis is then dropped,
   * not guessed. Absent on older runs, where the LLM path had no level axis at all
   * and the model's own `educationLevel` acted as one.
   */
  levelScore?: number | null;
  levelComparison?: 'higher' | 'equal' | 'lower' | null;
  /**
   * EXACT-MATCH PATH ONLY: how the candidate's level compares to the requirement,
   * which is what picks the tier (higher 100 / equal 80 / lower 50). Absent on
   * runs made before it was recorded — derivable from the score there, since the
   * three tiers are distinct. Null on the LLM and no-data paths.
   */
  exactComparison?: 'higher' | 'equal' | 'lower' | null;
  /** Rationale — LLM reasoning (with cited sources) or exact-match explanation. */
  reason: string | null;
  /** Tokens matched on the deterministic exact-match path. */
  matchedTokens: string[];
  /** Grounding with Google Search: queries issued + web sources cited. */
  searchQueries: string[];
  sources: GroundingSource[];
  /** Legacy per-responsibility correlation items (older runs). */
  items: EducationItem[];
  /**
   * LLM PATH: set when the model was NOT asked in this run — its answer was
   * reused from the last run of the position because everything it reads was
   * identical (scoring-service/src/education-reuse.ts). `answeredInRunId` is the
   * run in which the model actually answered. Absent on older runs.
   */
  reusedFrom?: { runId: string; answeredInRunId: string; answeredAt: string | null } | null;
};

// ── Run-level diagnostics (Section 1 of the Progress Running page) ──

export type CareerRunInfo = {
  targetStatus: CareerMatchStatus;
  targetJobProfileId: number | null;
  targetJobProfileName: string | null;
  message: string | null;
  /** How the target resolved, incl. the two target-only fallbacks. Absent on older runs. */
  targetMatchType?: CareerMatchType | null;
  /** Null when no stint needed the competency fallback. Absent on older runs. */
  calibration?: CareerCalibration | null;
  /** Fixed anchors the raw cosines were stretched onto 0..1 with. Absent on older runs. */
  scale?: CareerScale;
  /** The depth yardstick and its provenance. Absent on older runs. */
  depth?: CareerDepthTargets;
  /** Reference competency set backing the fallback. Absent on older runs. */
  fallbackRequiredCount?: number;
  fallbackRequiredSource?: RequiredSource;
  /**
   * The IDF census behind the fallback's coverage mean. Null when no stint needed
   * the fallback or weighting was off; ABSENT on runs that predate weighting
   * entirely, where every required competency counted the same and a
   * near-universal one was worth as much as a defining one.
   */
  idf?: {
    docCount: number;
    keyCount: number;
    mostCommon: { name: string; documentFrequency: number; weight: number }[];
    reason: string;
  } | null;
  /** Run-wide stint coverage by scoring path. Absent on older runs. */
  coverage?: {
    documentStints: number;
    fallbackStints: number;
    unscoredStints: number;
    documentYears: number;
    fallbackYears: number;
    unscoredYears: number;
    /** Unscored stints split by cause. Absent on older runs. */
    unscoredByReason?: Record<CareerUnscoredReason, number>;
  };
};

/**
 * How much of a DERIVED run's numbers came from today's data rather than from
 * the run it derives from.
 *
 * Both derived kinds reuse technical / career / education (expensive: embeddings
 * + Gemini) and recompute behavior / performance / HAV (free lookups over the
 * candidate row). Recomputing the cheap three is right — it keeps those columns
 * consistent across the whole re-ranked pool — but it means the run's numbers
 * straddle two dates, and on the default matrix those three carry 65% of the
 * weight. So a carried-over candidate whose PA grade moved in the Monday sync
 * shifts rank for a reason that has nothing to do with the candidate added or
 * excluded, and the panels used to state flatly that "nothing was re-scored".
 * Null on a full run, where everything is fresh by definition.
 */
export type RunFreshnessInfo = {
  /**
   * `frozen` — the mode reused the base run's six aspect scores, so any drift
   * listed below was deliberately NOT applied to this ranking.
   * `live` — everyone was re-scored, so the drift IS in these numbers.
   * Absent on runs finished before the modes existed; treat as `frozen`, which
   * is what those runs did for three of six aspects.
   */
  policy?: 'frozen' | 'live';
  /** Candidates present in both runs, i.e. the denominator of the drift. */
  comparedCandidates?: number;
  reusedCandidates: number;
  changedCandidates: number;
  byAspect: { behavior: number; performance: number; hav: number };
  changes: {
    candidateId: string;
    name: string | null;
    aspect: 'behavior' | 'performance' | 'hav';
    before: number;
    after: number;
  }[];
  reason: string;
};

/**
 * Set when this run was produced by adding candidates to an earlier AHP+TOPSIS
 * run: the six criteria were computed only for `computedCandidates`, the other
 * `reusedCandidates` carried their aspect scores over from `baseRunId`, and
 * TOPSIS was recomputed over the union. Null/absent on a full run.
 *
 * The fields below `reusedCandidates` are optional because runs finished before
 * this reporting existed carry only the three counts. They matter for the same
 * reason the exclusion re-rank's do: adding an alternative rescales TOPSIS, so
 * carried-over candidates move without being re-scored, and `poolSource` says
 * whether the base run's full scored pool was available to rank against or only
 * its finalists — the truncated case is where that movement gets large.
 */
export type RunAugmentInfo = {
  baseRunId: string;
  addedCandidates: number;
  computedCandidates: number;
  reusedCandidates: number;
  poolSource?: 'pool_snapshot' | 'finalists_only';
  poolSourceReason?: string;
  /** Candidates with no row in the base run at all — the ones just added. */
  newCount?: number;
  backfilledCount?: number;
  movedCount?: number;
  readinessChangedCount?: number;
  shifts?: RunRankShift[];
};

/**
 * One finalist's position before and after a re-rank that changed the
 * alternative set — an exclusion or an incremental addition. Both are the same
 * event as far as the reader is concerned: nobody carried over was re-scored,
 * and the numbers moved anyway.
 */
export type RunRankShift = {
  candidateId: string;
  name: string;
  /** Rank in the base run's FULL scored pool; null if it had no snapshot row. */
  baseRank: number | null;
  newRank: number;
  baseScore: number | null;
  newScore: number;
  baseReadiness: string | null;
  newReadiness: string;
  /** Was outside the base run's finalist cut — promoted into a freed slot. */
  backfilled: boolean;
};

/**
 * Set when this run was produced by excluding candidates from an earlier
 * AHP+TOPSIS run. Nothing was re-scored — the six aspects are per-candidate and
 * do not depend on the pool — but TOPSIS itself is set-relative: dropping an
 * alternative rescales the column norms and moves the ideal / anti-ideal
 * solutions, so every survivor's closeness changes and ranks can swap. `shifts`
 * exists so that movement is shown rather than discovered.
 */
export type RunExcludeInfo = {
  baseRunId: string;
  excludedCandidateIds: string[];
  excludedCount: number;
  /**
   * `pool_snapshot` — re-ranked against the base run's full scored pool, so a
   * freed finalist slot was backfilled from rank N+1.
   * `finalists_only` — the base run predates the pool snapshot, so only the
   * surviving finalists could be ranked: no backfill, and the alternative set is
   * a truncated (uniformly high-scoring) one.
   */
  poolSource: 'pool_snapshot' | 'finalists_only';
  poolSourceReason: string;
  reusedCandidates: number;
  recomputedCandidates: number;
  backfilledCount: number;
  movedCount: number;
  readinessChangedCount: number;
  shifts: RunRankShift[];
};

/**
 * Sealed candidate columns the engine could not read. Absent/null on a healthy
 * run — and on every run made before the engine started reporting it.
 *
 * This is not a cosmetic gap. `candidates.name` is NOT NULL, so a null after
 * decryption proves the DEK was unavailable, and the same key seals education,
 * major, behavior_recommendation, hav_quadrant and performance_grade. Those feed
 * four of the six AHP aspects, each of which has a no-data fallback that still
 * produces a number: behavior 0, education 0, HAV 40 (no-data tier),
 * performance 33 (all-C). The ranking then rests on technical + career alone
 * while presenting six measured criteria — which is why it is surfaced instead
 * of inferred from suspiciously flat columns.
 */
export type RunEncryptionInfo = {
  unreadableCandidates: number;
  totalCandidates: number;
  masterKeyFile: string;
  unlocked: boolean;
  affectedAspects: string[];
};

export type RunInfo = {
  jobProfileMatched: string | null;
  scoredCandidates: number;
  finalists: number;
  /** Incremental-augmentation summary (absent on older runs / full runs). */
  augment?: RunAugmentInfo | null;
  /** Exclusion re-rank summary (absent on every other kind of run). */
  exclude?: RunExcludeInfo | null;
  /** Which half of a derived run's numbers is today's (absent on full runs). */
  freshness?: RunFreshnessInfo | null;
  /** Unreadable encrypted candidate data (absent on a healthy run). */
  encryption?: RunEncryptionInfo | null;
  /**
   * Who wrote the insight bullets on an AHP+TOPSIS run (absent on older runs).
   *
   * A run whose narrative agent was unreachable still renders three populated
   * sections — from the deterministic aspect templates — so without this the
   * difference between "Ikutkan pelatihan/sertifikasi teknis yang menutup gap
   * kompetensi posisi target" and a note about a named competency is invisible to
   * whoever is reading the dossier.
   */
  narrative?: {
    llmEnabled: boolean;
    model: string | null;
    /**
     * Why the writer did not run, when it did not: 'demo' (a demo-mode run
     * never calls it — its template narrative is the intended output) or
     * 'config' (AHP_NARRATIVE_LLM=false). Absent on runs from before the field.
     */
    disabledBy?: 'demo' | 'config' | null;
    llmWritten: number;
    templateFallback: number;
  } | null;
  /**
   * Education model answers this run reused from the last run of the position
   * instead of asking again (scoring-service/src/education-reuse.ts). Absent on
   * runs finished before reuse existed.
   */
  education?: {
    reuse?: {
      enabled: boolean;
      fromRunId: string | null;
      fromCompletedAt: string | null;
      /** Candidates scored here that needed the model at all. */
      eligible: number;
      reused: number;
      modelCalls: number;
    } | null;
  } | null;
  career: CareerRunInfo;
  technical: {
    requiredCount: number;
    hasRequired: boolean;
    /** Provenance of the reference competency set (absent on older runs). */
    requiredSource?: RequiredSource;
    requiredSourceDetail?: string | null;
    /** ── Similarity anchors this run used (absent on older runs) ── */
    simFloor?: number;
    simCeil?: number;
    /**
     * env      — pinned by TECHNICAL_SIM_FLOOR/_CEIL, no census run.
     * measured — derived from the kamus embedding corpus in force at run time.
     * fallback — corpus absent/too small; hardcoded defaults.
     */
    simAnchorSource?: 'env' | 'measured' | 'fallback';
    simScaleReason?: string;
    /** How the level gap was turned into a score. */
    levelRule?: string;
    /** Required competencies excluded from the divisor as unmeasurable. */
    unmeasurableRequired?: number;
    effectiveRequiredCount?: number;
    unmeasurableNames?: string[];
    /** Pairs whose level term was neutral (proficiency unreadable). */
    levelUnknownPairs?: number;
    /** Names the resolver mapped to a kamus code beyond the exact tier. */
    kamusResolvedByCache?: number;
  };
  ahp: {
    weightSource: string;
    consistencyRatio: number;
    /** λmax + CI consistency diagnostics (absent on older runs). */
    lambdaMax?: number;
    consistencyIndex?: number;
    inconsistent: boolean;
    weights: Record<string, number>;
    /** Criterion key order of the pairwise matrix rows/cols (absent on older runs). */
    criteriaOrder?: string[];
    /** Saaty-scale pairwise comparison matrix used this run (absent on older runs). */
    pairwise?: number[][];
    /** Criteria nobody could be scored on — excluded from TOPSIS, weights
     *  redistributed over the rest. Absent on older runs. */
    droppedCriteria?: { key: string; reason: string }[];
    activeCriteria?: string[];
    /** Weights actually applied after the drop (0 for dropped criteria). */
    effectiveWeights?: Record<string, number>;
  };
};

export type AhpProgress = { phase: string; done: number; total: number };

// ── Resolved AHP configuration (matrix + weights) for a run ────────
// Where the config came from: `run` = persisted by the scoring-service on this
// exact run (authoritative); `snapshot` = frozen into the run at creation, still
// this run's own config; `template` = reconstructed NOW from the run's program
// template (may differ from run-time if the template was edited since);
// `unavailable` = none available (very old run, template deleted/cleared).
export type AhpConfigOrigin = 'run' | 'snapshot' | 'template' | 'unavailable';

export type AhpConfigResolved = {
  criteriaOrder: string[];
  /** Saaty-scale pairwise matrix (empty when origin === 'unavailable'). */
  pairwise: number[][];
  /** Criterion key → priority weight (0..1). */
  weights: Record<string, number>;
  weightSource: string;
  consistencyRatio: number;
  lambdaMax: number | null;
  consistencyIndex: number | null;
  inconsistent: boolean;
  origin: AhpConfigOrigin;
};

// ── Run lineage (prior AHP runs for the same position) ─────────────
export type RunLineageEntry = {
  runId: string;
  label: string | null;
  status: string;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  /** True for the run currently being viewed. */
  isCurrent: boolean;
};

/** The immediately-preceding AHP run for the same position + its AHP config. */
export type PredecessorInfo = {
  run: RunLineageEntry;
  ahp: AhpConfigResolved;
};

export type ScoringRunSummary = {
  runId: string;
  positionId: string;
  positionTitle: string;
  status: string;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  progress: AhpProgress | null;
};

export type ScoreBreakdown = {
  technical: number;
  career: number;
  behavior: number;
  performance: number;
  hav: number;
  education: number;
};

export type CandidateProgressRow = {
  candidateId: string;
  name: string;
  rank: number | null;
  weightedScore: number | null;
  readiness: string | null;
  scoreBreakdown: ScoreBreakdown | null;
  technicalMatching: TechnicalDetail | null;
  careerMatching: CareerDetail | null;
  behaviorDetail: BehaviorDetail | null;
  performanceDetail: PerformanceDetail | null;
  havDetail: HavDetail | null;
  educationDetail: EducationDetail | null;
  jobProfileMatched: string | null;
};

// ── Readiness analysis (run-level summary of the MCDM result) ──────

export type ReadinessLevelSummary = {
  level: string;
  eta: string | null;
  description: string | null;
  minScore: number;
  count: number;
  /** Share of scored finalists at this level, 0..100 (rounded). */
  percentage: number;
  /** Average weighted (closeness×100) score of candidates at this level. */
  avgScore: number | null;
  topCandidate: { candidateId: string; name: string; score: number; rank: number | null } | null;
};

export type ReadinessAnalysis = {
  /** Finalists with a resolvable readiness verdict. */
  totalScored: number;
  avgWeightedScore: number | null;
  /** Level holding the most candidates (ties broken toward the readier level). */
  dominantLevel: string | null;
  /** Mean of each aspect score across finalists (null if none carry a breakdown). */
  avgAspects: ScoreBreakdown | null;
  /** One entry per configured readiness level, ordered readiest → least ready. */
  levels: ReadinessLevelSummary[];
};

// ── Pool & filtering funnel (candidates assessed before finalist cut) ──

export type DisqualifiedCandidate = {
  candidateId: string;
  name: string;
  /** Human-readable failed-rule messages (empty/placeholder reasons stripped). */
  reasons: string[];
};

/**
 * A candidate that failed an ADVISORY rule.
 *
 * Structured rather than the flat "label: message" strings `disqualified` uses,
 * because a reader has to be able to tell WHICH rule flagged them (by `field`),
 * and `dataMissing` separates
 * "this person fails the rule" from "nobody has filled this column in yet".
 */
export type FlaggedCandidate = {
  candidateId: string;
  name: string;
  rules: { field: string | null; label: string; message: string; dataMissing: boolean }[];
};

export type RunFilterSummary = {
  templateId: string | null;
  /** Pool that passed the initial (grade-range) filter. */
  totalEvaluated: number;
  /** Assessed talent pool — passed the program-template hard filter too. */
  qualifiedCount: number;
  disqualifiedCount: number;
  minGradeId: string | null;
  maxGradeId: string | null;
  disqualified: DisqualifiedCandidate[];
  /**
   * Candidates that failed an ADVISORY rule. They are in the pool and were
   * scored — the flag is reported, not acted on — which is exactly why it has to
   * be recorded: nothing else in the run would show that the rule had anything
   * to say about them.
   *
   * Empty on runs made before advisory rules existed, which is
   * indistinguishable from "nothing flagged" and is fine: neither had a flag.
   */
  flagged: FlaggedCandidate[];
};

export type RunDetail = {
  run: ScoringRunSummary | null;
  runInfo: RunInfo | null;
  /** AHP config used by THIS run — always resolved (stored → template → unavailable). */
  ahpConfig: AhpConfigResolved | null;
  /** All AHP runs for this run's position (newest first), for the lineage view. */
  lineage: RunLineageEntry[];
  /** Immediately-preceding AHP run for the same position (+ its config), for comparison. */
  predecessor: PredecessorInfo | null;
  readinessAnalysis: ReadinessAnalysis | null;
  filterSummary: RunFilterSummary | null;
  candidates: CandidateProgressRow[];
};

const ASPECT_KEYS: (keyof ScoreBreakdown)[] = [
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
];

/** Normalize the stored scoring_runs.filter_summary (jsonb) into a RunFilterSummary. */
function parseFilterSummary(raw: any): RunFilterSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const disqualified: DisqualifiedCandidate[] = Array.isArray(raw.disqualified)
    ? raw.disqualified.map((d: any) => ({
        candidateId: String(d?.candidateId ?? ''),
        name: String(d?.name ?? '(tanpa nama)'),
        // Reasons sometimes contain empty/placeholder entries (e.g. ": ") — strip them.
        reasons: Array.isArray(d?.reasons)
          ? d.reasons
              .map((r: any) => String(r ?? '').trim())
              .filter((r: string) => r.replace(/[:\s]/g, '') !== '')
          : [],
      }))
    : [];
  const flagged: FlaggedCandidate[] = Array.isArray(raw.flagged)
    ? raw.flagged
        .map((f: any) => ({
          candidateId: String(f?.candidateId ?? ''),
          name: String(f?.name ?? '(tanpa nama)'),
          rules: Array.isArray(f?.rules)
            ? f.rules
                .map((r: any) => ({
                  field: r?.field ? String(r.field) : null,
                  label: String(r?.label ?? '').trim(),
                  message: String(r?.message ?? '').trim(),
                  dataMissing: Boolean(r?.dataMissing),
                }))
                .filter((r: { label: string; message: string }) => r.label || r.message)
            : [],
        }))
        .filter((f: FlaggedCandidate) => f.rules.length > 0)
    : [];
  return {
    templateId: raw.templateId ?? null,
    totalEvaluated: Number(raw.totalEvaluated ?? 0),
    qualifiedCount: Number(raw.qualifiedCount ?? 0),
    disqualifiedCount: Number(raw.disqualifiedCount ?? disqualified.length),
    minGradeId: raw.minGradeId ?? null,
    maxGradeId: raw.maxGradeId ?? null,
    disqualified,
    flagged,
  };
}

/** analysis_results.details is a TEXT (JSON-string) column — parse defensively. */
function parseDetails(raw: unknown): any {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw; // already parsed (defensive)
  try {
    return JSON.parse(raw as string) ?? {};
  } catch {
    return {};
  }
}

type ReadinessLevelDef = {
  level: string;
  eta: string | null;
  description: string | null;
  minScore: number;
};

/** Configured readiness levels, ordered readiest → least ready, ETA/description attached. */
function orderedReadinessLevels(config: ReadinessConfig): ReadinessLevelDef[] {
  const sorted = [...config.thresholds].sort((a, b) => b.minScore - a.minScore);
  const levels: ReadinessLevelDef[] = sorted.map((t) => ({
    level: t.level,
    eta: t.eta ?? null,
    description: t.description ?? null,
    minScore: t.minScore,
  }));
  // The default level (e.g. "Not Ready") isn't always listed as a threshold.
  if (!levels.some((l) => l.level === config.defaultLevel)) {
    levels.push({ level: config.defaultLevel, eta: null, description: null, minScore: 0 });
  }
  return levels;
}

/** Resolve a weighted score to a readiness level via the config thresholds. */
function resolveReadinessLevel(score: number, config: ReadinessConfig): string {
  for (const t of [...config.thresholds].sort((a, b) => b.minScore - a.minScore)) {
    if (score >= t.minScore) return t.level;
  }
  return config.defaultLevel;
}

/**
 * Aggregate the persisted per-candidate MCDM results (rank, weighted score, and
 * the stored readiness verdict) into a run-level readiness distribution — the
 * summary rendered above the per-candidate detail on the Progress Running page.
 */
function computeReadinessAnalysis(
  candidates: CandidateProgressRow[],
  config: ReadinessConfig,
): ReadinessAnalysis | null {
  const scored = candidates.filter((c) => c.readiness != null || c.weightedScore != null);
  if (scored.length === 0) return null;

  const levelDefs = orderedReadinessLevels(config);
  const orderIndex = new Map(levelDefs.map((l, i) => [l.level, i]));

  const byLevel = new Map<string, CandidateProgressRow[]>();
  for (const c of scored) {
    const level =
      c.readiness ??
      (c.weightedScore != null ? resolveReadinessLevel(c.weightedScore, config) : config.defaultLevel);
    const bucket = byLevel.get(level) ?? [];
    bucket.push(c);
    byLevel.set(level, bucket);
  }

  const total = scored.length;
  const mean = (xs: number[]) =>
    xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

  const avgWeightedScore = mean(
    scored.map((c) => c.weightedScore).filter((v): v is number => v != null),
  );

  const withBreakdown = scored.filter((c) => c.scoreBreakdown);
  const avgAspects: ScoreBreakdown | null = withBreakdown.length
    ? (Object.fromEntries(
        ASPECT_KEYS.map((k) => [
          k,
          mean(withBreakdown.map((c) => c.scoreBreakdown![k] ?? 0)) ?? 0,
        ]),
      ) as ScoreBreakdown)
    : null;

  const levels: ReadinessLevelSummary[] = levelDefs.map((def) => {
    const group = byLevel.get(def.level) ?? [];
    const top = group.reduce<CandidateProgressRow | null>((best, c) => {
      if (!best) return c;
      return (c.weightedScore ?? -1) > (best.weightedScore ?? -1) ? c : best;
    }, null);
    return {
      level: def.level,
      eta: def.eta,
      description: def.description,
      minScore: def.minScore,
      count: group.length,
      percentage: total > 0 ? Math.round((group.length / total) * 100) : 0,
      avgScore: mean(group.map((c) => c.weightedScore).filter((v): v is number => v != null)),
      topCandidate: top
        ? { candidateId: top.candidateId, name: top.name, score: top.weightedScore ?? 0, rank: top.rank }
        : null,
    };
  });

  const dominant = levels
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count || orderIndex.get(a.level)! - orderIndex.get(b.level)!)[0];

  return {
    totalScored: total,
    avgWeightedScore,
    dominantLevel: dominant?.level ?? null,
    avgAspects,
    levels,
  };
}

// ── AHP config resolution (stored → reconstructed → unavailable) ───

/**
 * Resolve the AHP config for a run so the pairwise matrix can ALWAYS be shown:
 *  1. Prefer what the scoring-service persisted on the run (authoritative).
 *  2. Else the matrix frozen into the run's config snapshot at creation.
 *  3. Else reconstruct from the run's program template's CURRENT ahp_config.
 *  4. Else mark unavailable (very old run / template deleted or cleared).
 *
 * Step 3 is a last resort and is labelled as such: governance is editable, so a
 * matrix read today is not evidence of what this run was scored with.
 */
async function resolveAhpConfig(
  storedAhp: RunInfo['ahp'] | null | undefined,
  programTemplateId: string | null,
  snapshotPairwise?: number[][] | null,
): Promise<AhpConfigResolved> {
  const order = [...AHP_CRITERIA_ORDER] as string[];

  // 1. Persisted on the run — the matrix actually used at run time.
  if (
    storedAhp &&
    Array.isArray(storedAhp.pairwise) &&
    storedAhp.pairwise.length === order.length &&
    (storedAhp.criteriaOrder?.length ?? 0) === order.length
  ) {
    return {
      criteriaOrder: storedAhp.criteriaOrder ?? order,
      pairwise: storedAhp.pairwise,
      weights: storedAhp.weights ?? {},
      weightSource: storedAhp.weightSource,
      consistencyRatio: storedAhp.consistencyRatio,
      lambdaMax: storedAhp.lambdaMax ?? null,
      consistencyIndex: storedAhp.consistencyIndex ?? null,
      inconsistent: storedAhp.inconsistent,
      origin: 'run',
    };
  }

  // 2. Frozen at run creation — still this run's own configuration.
  if (isValidPairwise(snapshotPairwise, order.length)) {
    const { weights, lambdaMax, ci, cr } = computeAhpWeights(snapshotPairwise);
    return {
      criteriaOrder: order,
      pairwise: snapshotPairwise,
      weights: Object.fromEntries(order.map((k, i) => [k, weights[i] ?? 0])),
      weightSource: 'ahp-matrix',
      consistencyRatio: Number(cr.toFixed(4)),
      lambdaMax: Number(lambdaMax.toFixed(4)),
      consistencyIndex: Number(ci.toFixed(4)),
      inconsistent: cr > 0.1,
      origin: 'snapshot',
    };
  }

  // 3. Reconstruct from the run's program template (current governance config).
  if (programTemplateId) {
    const [tpl] = await db
      .select({ ahpConfig: programTemplates.ahpConfig })
      .from(programTemplates)
      .where(eq(programTemplates.id, programTemplateId))
      .limit(1);
    const pairwise = tpl?.ahpConfig?.pairwise;
    if (isValidPairwise(pairwise, order.length)) {
      const { weights, lambdaMax, ci, cr } = computeAhpWeights(pairwise);
      return {
        criteriaOrder: order,
        pairwise,
        weights: Object.fromEntries(order.map((k, i) => [k, weights[i] ?? 0])),
        weightSource: 'ahp-matrix',
        consistencyRatio: Number(cr.toFixed(4)),
        lambdaMax: Number(lambdaMax.toFixed(4)),
        consistencyIndex: Number(ci.toFixed(4)),
        inconsistent: cr > 0.1,
        origin: 'template',
      };
    }
  }

  // 4. Nothing usable.
  return {
    criteriaOrder: order,
    pairwise: [],
    weights: {},
    weightSource: 'unknown',
    consistencyRatio: 0,
    lambdaMax: null,
    consistencyIndex: null,
    inconsistent: false,
    origin: 'unavailable',
  };
}

// ── Full detail for one run ────────────────────────────────────────

/**
 * One run's live progress + per-candidate breakdown (rank, aspect scores, and
 * the technical-competency matching detail). While a run is still processing,
 * `candidates` is typically empty — results are persisted only at the end — so
 * the client shows the phase progress bar and polls until completion.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getAhpRunDetailAction(
  ...args: Parameters<typeof getAhpRunDetailActionImpl>
): ReturnType<typeof getAhpRunDetailActionImpl> {
  return demoScrub(await getAhpRunDetailActionImpl(...args));
}

async function getAhpRunDetailActionImpl(runId: string): Promise<RunDetail> {
  await requirePermission('job_profiles.view');
  const tenantId = await getCurrentTenantId();

  const runRes = await db.execute(sql`
    SELECT sr.id::text                    AS "runId",
           sr.position_id::text           AS "positionId",
           cp.title                       AS "positionTitle",
           COALESCE(ts.status, sr.status) AS "status",
           sr.candidate_count             AS "candidateCount",
           sr.created_at                  AS "createdAt",
           sr.completed_at                AS "completedAt",
           sr.program_template_id::text   AS "programTemplateId",
           sr.filter_summary              AS "filterSummary",
           sr.config_snapshot             AS "configSnapshot",
           ts.final_ranked                AS "finalRanked",
           sr.run_info                    AS "runInfoOwn"
    FROM scoring_runs sr
    JOIN critical_positions cp ON cp.id = sr.position_id
    LEFT JOIN tournament_sessions ts ON ts.run_id = sr.id
    WHERE sr.id = ${runId} AND cp.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
    LIMIT 1
  `);
  const rr = (runRes.rows as any[])[0];
  if (!rr) {
    return {
      run: null,
      runInfo: null,
      ahpConfig: null,
      lineage: [],
      predecessor: null,
      readinessAnalysis: null,
      filterSummary: null,
      candidates: [],
    };
  }

  const run: ScoringRunSummary = {
    runId: rr.runId,
    positionId: rr.positionId,
    positionTitle: rr.positionTitle ?? '(tanpa judul)',
    status: rr.status ?? 'unknown',
    candidateCount: Number(rr.candidateCount ?? 0),
    createdAt: new Date(rr.createdAt).toISOString(),
    completedAt: rr.completedAt ? new Date(rr.completedAt).toISOString() : null,
    progress: (rr.finalRanked?.ahpProgress as AhpProgress | undefined) ?? null,
  };

  // The run's own copy (drizzle/0065) first, the session's second. A session is
  // transient working space and can be deleted while its run survives — which is
  // how these diagnostics used to vanish the moment a wizard run succeeded.
  const runInfo =
    (rr.runInfoOwn as RunInfo | undefined) ??
    (rr.finalRanked?.runInfo as RunInfo | undefined) ??
    null;

  // AHP config for THIS run (forced: stored → template → unavailable) + lineage
  // of prior AHP runs for the same position, plus the immediate predecessor's
  // config for the side-by-side comparison.
  const ahpConfig = await resolveAhpConfig(
    runInfo?.ahp,
    rr.programTemplateId ?? null,
    rr.configSnapshot?.template?.ahpConfig?.pairwise ?? null,
  );

  const linRes = await db.execute(sql`
    SELECT sr.id::text                    AS "runId",
           sr.label                       AS "label",
           COALESCE(ts.status, sr.status) AS "status",
           sr.candidate_count             AS "candidateCount",
           sr.created_at                  AS "createdAt",
           sr.completed_at                AS "completedAt",
           sr.program_template_id::text   AS "programTemplateId",
           sr.config_snapshot             AS "configSnapshot",
           ts.final_ranked                AS "finalRanked",
           sr.run_info                    AS "runInfoOwn"
    FROM scoring_runs sr
    JOIN critical_positions cp ON cp.id = sr.position_id
    LEFT JOIN tournament_sessions ts ON ts.run_id = sr.id
    WHERE sr.method = 'AHP_TOPSIS'
      AND sr.position_id = ${rr.positionId}
      AND cp.tenant_id = ${tenantId}
      AND ${await isDemoSql('sr')}
    ORDER BY sr.created_at DESC
  `);
  const linRows = linRes.rows as any[];

  const lineage: RunLineageEntry[] = linRows.map((r) => ({
    runId: r.runId,
    label: r.label ?? null,
    status: r.status ?? 'unknown',
    candidateCount: Number(r.candidateCount ?? 0),
    createdAt: new Date(r.createdAt).toISOString(),
    completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
    isCurrent: r.runId === run.runId,
  }));

  // Immediate predecessor = most recent run strictly older than the current one.
  const currentCreatedAt = new Date(rr.createdAt).getTime();
  const predRow = linRows.find(
    (r) => r.runId !== run.runId && new Date(r.createdAt).getTime() < currentCreatedAt,
  );
  let predecessor: PredecessorInfo | null = null;
  if (predRow) {
    const predAhp =
      ((predRow.runInfoOwn as RunInfo | undefined) ??
        (predRow.finalRanked?.runInfo as RunInfo | undefined))?.ahp ?? null;
    predecessor = {
      run: {
        runId: predRow.runId,
        label: predRow.label ?? null,
        status: predRow.status ?? 'unknown',
        candidateCount: Number(predRow.candidateCount ?? 0),
        createdAt: new Date(predRow.createdAt).toISOString(),
        completedAt: predRow.completedAt ? new Date(predRow.completedAt).toISOString() : null,
        isCurrent: false,
      },
      ahp: await resolveAhpConfig(
        predAhp,
        predRow.programTemplateId ?? null,
        predRow.configSnapshot?.template?.ahpConfig?.pairwise ?? null,
      ),
    };
  }

  const arRes = await db.execute(sql`
    SELECT candidate_id::text AS "candidateId", rank, details
    FROM analysis_results
    WHERE run_id = ${runId}
    ORDER BY rank ASC NULLS LAST
  `);

  const candidates: CandidateProgressRow[] = (arRes.rows as any[]).map((r) => {
    // analysis_results.details is a TEXT column holding a JSON string — parse it
    // (as everywhere else in the app) and decrypt any person fields that a
    // pre-decryption scoring-service may have stored encrypted.
    const d = decryptCandidateDetailsSnapshot(parseDetails(r.details)) ?? {};
    const ahp = d.ahpTopsis ?? {};
    return {
      candidateId: r.candidateId,
      name: d.name ?? '(tanpa nama)',
      rank: r.rank != null ? Number(r.rank) : null,
      weightedScore: d.weightedScore != null ? Number(d.weightedScore) : null,
      readiness: d.readiness ?? null,
      scoreBreakdown: (d.scoreBreakdown as ScoreBreakdown | undefined) ?? null,
      technicalMatching: (ahp.technicalMatching as TechnicalDetail | undefined) ?? null,
      careerMatching: (ahp.careerMatching as CareerDetail | undefined) ?? null,
      behaviorDetail: (ahp.behaviorDetail as BehaviorDetail | undefined) ?? null,
      performanceDetail: (ahp.performanceDetail as PerformanceDetail | undefined) ?? null,
      havDetail: (ahp.havDetail as HavDetail | undefined) ?? null,
      educationDetail: (ahp.educationDetail as EducationDetail | undefined) ?? null,
      jobProfileMatched: ahp.jobProfileMatched ?? null,
    };
  });

  const readinessAnalysis = computeReadinessAnalysis(candidates, await getReadinessConfig());
  const filterSummary = parseFilterSummary(rr.filterSummary);

  return { run, runInfo, ahpConfig, lineage, predecessor, readinessAnalysis, filterSummary, candidates };
}

// ── Run configuration ("Konfigurasi Run" sub-tab) ──────────────────
// Everything that DECIDED an AHP+TOPSIS run, as opposed to what it produced:
// the pool and the filters that shaped it, the AHP pairwise matrix with the
// weights and consistency coefficients it yields, the criteria that survived
// into the TOPSIS matrix, and the readiness thresholds the scores were cut on.
//
// Everything here is the run's OWN state, not the current governance config:
//   • scoring_runs.config_snapshot — program template (filter tree, criteria,
//     AHP matrix, finalist target) and readiness thresholds, frozen at creation.
//   • scoring_runs.filter_summary — grade range, business units, who was
//     disqualified and on which rule.
//   • tournament_sessions.final_ranked.runInfo — the AHP matrix/weights the
//     engine actually used, dropped criteria, aspect fallbacks.
// Governance is only ever read as a LAST RESORT, for runs created before the
// snapshot column existed, and every such payload says so via `source` so the
// UI can never present a reconstruction as the real thing.

export type RunConfigSource = 'snapshot' | 'inherited' | 'live-fallback';

/** Program template config — frozen copy from the run unless `source` says otherwise. */
// Fields below are NULL when the stored snapshot does not carry them — "not
// recorded", which the panel must say rather than infer (see templateFromSnapshot).
export type RunConfigTemplate = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  targetFinalists: number | null;
  defaultMethod: string | null;
  /** Null: the snapshot does not record whether the rules were enforced. */
  enforceFilterRules: boolean | null;
  isSystem: boolean;
  /**
   * Nested AND/OR eligibility tree; an empty group when the program has no
   * rules, NULL when the snapshot holds no tree at all — two different facts.
   */
  filterTree: FilterConditionGroup | null;
  ruleCount: number | null;
  /** Null: not recorded (distinct from an empty list). */
  defaultCriteria: DefaultCriterion[] | null;
  /** Whether an explicit pairwise matrix was configured for this program. */
  hasAhpMatrix: boolean;
  /** The template's own updatedAt — at capture time for a snapshot, now for a fallback. */
  updatedAt: string | null;
  /**
   * `snapshot` — frozen when this run was created (authoritative).
   * `inherited` — frozen on the base run this one derives from, which is where
   *   the eligibility rules were actually applied.
   * `live-fallback` — run predates the snapshot column; read from governance
   *   NOW and therefore only an approximation of what ran.
   */
  source: RunConfigSource;
  /** Base run the frozen copy came from (`inherited` only). */
  inheritedFrom: string | null;
  /** When the frozen copy was taken (null on a live fallback). */
  capturedAt: string | null;
  /** Live fallback only: template was saved after this run finished. */
  editedAfterRun: boolean;
};

export type RunConfigPool = {
  /** Pool after the grade + incumbent gate, before the program hard filter. */
  totalEvaluated: number;
  /** Passed the hard filter too — the candidates actually scored. */
  qualifiedCount: number;
  disqualifiedCount: number;
  disqualified: DisqualifiedCandidate[];
  /** Failed an advisory rule: scored and ranked anyway, reported here. */
  flagged: FlaggedCandidate[];
  minGradeId: string | null;
  maxGradeId: string | null;
  minGradeName: string | null;
  maxGradeName: string | null;
  /** Business units that contributed candidates (cross-tenant runs list >1). */
  businessUnits: { id: string; name: string }[];
  /** Always excluded from their own succession pool. */
  incumbent: { name: string | null; employeeId: string | null } | null;
  /** Finalist cut configured on the session (`tournament_sessions.target_finalists`). */
  targetFinalists: number | null;
  /** Candidates the engine ranked, and how many were kept as finalists. */
  scoredCandidates: number | null;
  finalists: number | null;
};

/** Where this run's numbers came from: a full scoring pass or a derived re-rank. */
export type RunConfigOrigin = {
  kind: 'full' | 'augment' | 'exclude';
  baseRunId: string | null;
  baseRunLabel: string | null;
  augment: RunAugmentInfo | null;
  exclude: RunExcludeInfo | null;
  /**
   * Which of a derived run's aspects came from today's data. Null on a full run
   * and on derived runs finished before it was measured — the latter is silence,
   * not a claim that nothing drifted.
   */
  freshness: RunFreshnessInfo | null;
  /**
   * A "Tambah Kandidat Pembanding" child's own record of what it inherited and
   * why it exists (`config_snapshot.rerun`). Null on roots and legacy children.
   */
  rerun: RunConfigSnapshot['rerun'] | null;
};

export type RunConfiguration = {
  run: {
    runId: string;
    label: string | null;
    method: string;
    program: string | null;
    status: string;
    positionTitle: string;
    candidateCount: number;
    createdAt: string;
    completedAt: string | null;
    /** `ahp_topsis` (the only method now) — the session's execution mode. */
    sessionMethod: string | null;
  };
  origin: RunConfigOrigin;
  template: RunConfigTemplate | null;
  pool: RunConfigPool;
  /** Pairwise matrix + weights + consistency, resolved stored → template → unavailable. */
  ahp: AhpConfigResolved;
  /** Criteria dropped/kept and the renormalized weights actually applied. */
  ahpRun: RunInfo['ahp'] | null;
  /** Aspect-level fallbacks recorded for this run (career/technical degradations). */
  runInfo: RunInfo | null;
  /** Readiness thresholds frozen with the run; falls back to the current file on old runs. */
  readiness: ReadinessConfig;
  /** False when `readiness` had to be read from the current config file. */
  readinessFromSnapshot: boolean;
};

/**
 * Grade id → level name, mirroring the loose matching used elsewhere: stored
 * ids sometimes carry a letter suffix ("5a") that the level table doesn't, so
 * index both the raw id and its numeric prefix.
 */
async function loadGradeNameMap(): Promise<Map<string, string>> {
  const res = await db.execute(sql`
    SELECT DISTINCT grade_id AS "gradeId", level_name AS "levelName"
    FROM sync_grade_levels
    WHERE level_name IS NOT NULL
  `);
  const map = new Map<string, string>();
  for (const row of res.rows as any[]) {
    const id = String(row.gradeId ?? '');
    const name = String(row.levelName ?? '');
    if (!id || !name) continue;
    if (!map.has(id)) map.set(id, name);
    const numeric = String(parseInt(id, 10));
    if (numeric !== 'NaN' && !map.has(numeric)) map.set(numeric, name);
  }
  return map;
}

function resolveGradeName(map: Map<string, string>, id: string | null): string | null {
  if (!id) return null;
  return map.get(id) ?? map.get(String(parseInt(id, 10))) ?? `Level ${id}`;
}

/**
 * Full configuration behind one AHP+TOPSIS run. Returns null when the run does
 * not exist for the current tenant. Callers should only render this for runs
 * with `method = 'AHP_TOPSIS'` — a legacy run of another method has no AHP
 * config at all.
 */
// ── Stored-snapshot hygiene ──────────────────────────────────────────
// `config_snapshot` is jsonb written once and never migrated, so this is the
// one place its shape is checked before it reaches the panel. A field the stored
// copy lacks becomes an explicit "not recorded" (null) instead of `undefined`,
// which either crashed the whole position page (`defaultCriteria.length`, or an
// absent filter tree handed to the tree renderer) or read as a claim the run
// never made (a missing `enforceFilterRules` rendered "Tidak ditegakkan").
// Nothing is invented: a value is kept, re-derived from what IS stored (the rule
// count from the stored tree), or reported missing.

type StoredTemplate = NonNullable<RunConfigSnapshot['template']>;

function templateFromSnapshot(stored: StoredTemplate, snapshot: RunConfigSnapshot): RunConfigTemplate {
  const raw = stored as Partial<Record<keyof StoredTemplate, unknown>>;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  // `null`/absent = no tree recorded; anything else goes through the same parser
  // live templates use, which also reads the legacy stored shapes.
  const tree = raw.filterTree == null ? null : normalizeFilterTree(raw.filterTree);
  return {
    id: str(raw.id) ?? '',
    code: str(raw.code) ?? '',
    name: str(raw.name)?.trim() || 'program (nama tidak tersimpan)',
    description: str(raw.description),
    targetFinalists: typeof raw.targetFinalists === 'number' ? raw.targetFinalists : null,
    defaultMethod: str(raw.defaultMethod),
    enforceFilterRules: typeof raw.enforceFilterRules === 'boolean' ? raw.enforceFilterRules : null,
    isSystem: raw.isSystem === true,
    filterTree: tree,
    // What is rendered is the tree, so the count comes from it; the stored number
    // only stands in when the tree itself is missing.
    ruleCount: tree ? countFilterRules(tree) : typeof raw.ruleCount === 'number' ? raw.ruleCount : null,
    defaultCriteria: Array.isArray(raw.defaultCriteria)
      ? (raw.defaultCriteria as unknown[]).filter(
          (c): c is DefaultCriterion => c != null && typeof c === 'object' && typeof (c as { name?: unknown }).name === 'string',
        )
      : null,
    hasAhpMatrix: Boolean((raw.ahpConfig as StoredTemplate['ahpConfig'] | undefined)?.pairwise?.length),
    updatedAt: str(raw.updatedAt),
    source: snapshot.templateSource === 'inherited' ? 'inherited' : 'snapshot',
    inheritedFrom: snapshot.inheritedFrom ?? null,
    capturedAt: snapshot.capturedAt ?? null,
    editedAfterRun: false,
  };
}

/** The rerun block with its lists guaranteed to be lists (the panel counts and joins them). */
function rerunFromSnapshot(stored: RunConfigSnapshot['rerun'] | null | undefined): RunConfigOrigin['rerun'] {
  if (!stored || typeof stored !== 'object') return null;
  return {
    ...stored,
    added: Array.isArray(stored.added) ? stored.added : [],
    skipped: Array.isArray(stored.skipped) ? stored.skipped : [],
  };
}

// Demo mode: pool, incumbent and added / skipped names leave the server as initials.
export async function getRunConfigurationAction(
  ...args: Parameters<typeof getRunConfigurationActionImpl>
): ReturnType<typeof getRunConfigurationActionImpl> {
  return demoScrub(await getRunConfigurationActionImpl(...args));
}

async function getRunConfigurationActionImpl(runId: string): Promise<RunConfiguration | null> {
  await requirePermission('positions.view');
  const tenantId = await getCurrentTenantId();

  const runRes = await db.execute(sql`
    SELECT sr.id::text                    AS "runId",
           sr.label                       AS "label",
           sr.method                      AS "method",
           sr.program                     AS "program",
           COALESCE(ts.status, sr.status) AS "status",
           sr.candidate_count             AS "candidateCount",
           sr.created_at                  AS "createdAt",
           sr.completed_at                AS "completedAt",
           sr.program_template_id::text   AS "programTemplateId",
           sr.filter_summary              AS "filterSummary",
           sr.config_snapshot             AS "configSnapshot",
           cp.title                       AS "positionTitle",
           cp.holder_name                 AS "holderName",
           cp.holder_employee_id          AS "holderEmployeeId",
           ts.target_finalists            AS "targetFinalists",
           ts.scoring_method              AS "sessionMethod",
           ts.final_ranked                AS "finalRanked",
           sr.run_info                    AS "runInfoOwn"
    FROM scoring_runs sr
    JOIN critical_positions cp ON cp.id = sr.position_id
    LEFT JOIN tournament_sessions ts ON ts.run_id = sr.id
    WHERE sr.id = ${runId} AND cp.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
    LIMIT 1
  `);
  const rr = (runRes.rows as any[])[0];
  if (!rr) return null;

  // The run's own copy (drizzle/0065) first, the session's second. A session is
  // transient working space and can be deleted while its run survives — which is
  // how these diagnostics used to vanish the moment a wizard run succeeded.
  const runInfo =
    (rr.runInfoOwn as RunInfo | undefined) ??
    (rr.finalRanked?.runInfo as RunInfo | undefined) ??
    null;
  const filterSummary = parseFilterSummary(rr.filterSummary);
  const completedAt = rr.completedAt ? new Date(rr.completedAt) : null;
  const snapshot = (rr.configSnapshot as RunConfigSnapshot | null) ?? null;

  const [ahpConfig, gradeNames] = await Promise.all([
    resolveAhpConfig(
      runInfo?.ahp,
      rr.programTemplateId ?? null,
      snapshot?.template?.ahpConfig?.pairwise ?? null,
    ),
    loadGradeNameMap(),
  ]);

  // ── Program template ──
  // The frozen copy is the answer whenever the run has one: it is the rule set
  // that produced this ranking. Governance is consulted only for runs created
  // before the snapshot column, and the result is labelled `live-fallback` so
  // the UI never claims a reconstruction is the original.
  let template: RunConfigTemplate | null = null;
  const snapTpl = snapshot?.template ?? null;
  if (snapTpl && typeof snapTpl === 'object') {
    template = templateFromSnapshot(snapTpl, snapshot!);
  } else if (rr.programTemplateId) {
    const tpl = await getProgramTemplate(rr.programTemplateId);
    if (tpl) {
      template = {
        id: tpl.id,
        code: tpl.code,
        name: tpl.name,
        description: tpl.description,
        targetFinalists: tpl.targetFinalists,
        defaultMethod: tpl.defaultMethod,
        enforceFilterRules: tpl.enforceFilterRules,
        isSystem: tpl.isSystem,
        filterTree: tpl.filterTree,
        ruleCount: tpl.filterRules.length,
        defaultCriteria: tpl.defaultCriteria,
        hasAhpMatrix: Boolean(tpl.ahpConfig?.pairwise?.length),
        updatedAt: tpl.updatedAt.toISOString(),
        source: 'live-fallback',
        inheritedFrom: null,
        capturedAt: null,
        // Only meaningful on the fallback path: a template saved after the run
        // finished certainly isn't the one that ran.
        editedAfterRun:
          completedAt != null && tpl.updatedAt.getTime() > completedAt.getTime(),
      };
    }
  }

  // Readiness thresholds as frozen with the run. The stored shape is a subset of
  // ReadinessConfig (eta/description optional), so fill the gaps rather than
  // widening the type every consumer of ReadinessConfig relies on.
  // A frozen copy without its threshold list or default level is not a usable
  // record of either, so it counts as absent: the live file stands in and
  // `readinessFromSnapshot` says so, instead of `.map` throwing on the row.
  const storedReadiness = snapshot?.readiness;
  const snapshotReadiness: ReadinessConfig | null =
    storedReadiness && Array.isArray(storedReadiness.thresholds) && typeof storedReadiness.defaultLevel === 'string'
      ? {
          thresholds: storedReadiness.thresholds
            .filter((t): t is NonNullable<typeof t> => t != null && typeof t === 'object')
            .map((t) => ({
              minScore: Number(t.minScore ?? 0),
              level: String(t.level ?? ''),
              eta: t.eta ?? '',
              description: t.description ?? '',
            })),
          defaultLevel: storedReadiness.defaultLevel,
        }
      : null;

  // Business units that contributed candidates. Runs created before
  // `includedTenantIds` existed only ever pooled the owning tenant.
  const includedTenantIds: string[] =
    (rr.filterSummary?.includedTenantIds as string[] | undefined)?.filter(Boolean) ?? [tenantId];
  const businessUnits = includedTenantIds.map((id) => ({
    id,
    name: TENANTS.find((t) => t.id === id)?.name ?? id,
  }));

  const demoView = await isDemoMode();
  const pool: RunConfigPool = {
    totalEvaluated: filterSummary?.totalEvaluated ?? Number(rr.candidateCount ?? 0),
    qualifiedCount: filterSummary?.qualifiedCount ?? Number(rr.candidateCount ?? 0),
    disqualifiedCount: filterSummary?.disqualifiedCount ?? 0,
    disqualified: filterSummary?.disqualified ?? [],
    flagged: filterSummary?.flagged ?? [],
    minGradeId: filterSummary?.minGradeId ?? null,
    maxGradeId: filterSummary?.maxGradeId ?? null,
    minGradeName: resolveGradeName(gradeNames, filterSummary?.minGradeId ?? null),
    maxGradeName: resolveGradeName(gradeNames, filterSummary?.maxGradeId ?? null),
    businessUnits,
    incumbent:
      rr.holderName || rr.holderEmployeeId
        ? {
            // Demo mode: no NPK leaves the server; a holder known only by NPK
            // stays nameless rather than being named by it.
            name: demoView && rr.holderName && rr.holderName === rr.holderEmployeeId ? null : rr.holderName ?? null,
            employeeId: demoView ? (rr.holderEmployeeId ? MASKED_NPK : null) : rr.holderEmployeeId ?? null,
          }
        : null,
    targetFinalists: rr.targetFinalists != null ? Number(rr.targetFinalists) : null,
    scoredCandidates: runInfo?.scoredCandidates ?? null,
    finalists: runInfo?.finalists ?? null,
  };

  // Derived runs (augment / exclusion re-rank) name their base run so the
  // configuration can be read as "this ranking came from that one".
  const augment = runInfo?.augment ?? null;
  const exclude = runInfo?.exclude ?? null;
  const baseRunId = exclude?.baseRunId ?? augment?.baseRunId ?? null;
  let baseRunLabel: string | null = null;
  if (baseRunId) {
    const baseRes = await db.execute(sql`
      SELECT sr.label AS "label"
      FROM scoring_runs sr
      JOIN critical_positions cp ON cp.id = sr.position_id
      WHERE sr.id = ${baseRunId} AND cp.tenant_id = ${tenantId}
      LIMIT 1
    `);
    baseRunLabel = ((baseRes.rows as any[])[0]?.label as string | null) ?? null;
  }

  return {
    run: {
      runId: rr.runId,
      label: rr.label ?? null,
      method: rr.method ?? 'AHP_TOPSIS',
      program: rr.program ?? null,
      status: rr.status ?? 'unknown',
      positionTitle: rr.positionTitle ?? '(tanpa judul)',
      candidateCount: Number(rr.candidateCount ?? 0),
      createdAt: new Date(rr.createdAt).toISOString(),
      completedAt: completedAt ? completedAt.toISOString() : null,
      sessionMethod: rr.sessionMethod ?? null,
    },
    origin: {
      kind: exclude ? 'exclude' : augment ? 'augment' : 'full',
      freshness: runInfo?.freshness ?? null,
      baseRunId,
      baseRunLabel,
      augment,
      exclude,
      rerun: rerunFromSnapshot(snapshot?.rerun),
    },
    template,
    pool,
    ahp: ahpConfig,
    ahpRun: runInfo?.ahp ?? null,
    runInfo,
    // Thresholds frozen with the run; the live file only stands in for runs
    // created before the snapshot existed.
    readiness: snapshotReadiness ?? (await getReadinessConfig()),
    readinessFromSnapshot: snapshotReadiness != null,
  };
}
