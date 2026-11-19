// The shape of a run's calculation trace — the numbers between a candidate's raw
// data and the final rank that no other record keeps (drizzle/0092).
//
// ONE definition for both deployables: scoring-service writes the `engine`
// stage, the web app writes the `pool` stage and reads both for the XLSX export
// (lib/run-trace/). Dependency-free on purpose — no imports at all — so the web
// build can include it the way it includes topsis.ts (see the web .dockerignore).
//
// Every number here is FULL precision. The stored run records round several of
// them (similarityRaw and recency to 4 decimals, effectiveYears to 3, anchors to
// 4 in run_info, closeness to 6 in its column); a trace that rounded too would
// make a recomputation disagree with itself, which is the opposite of its point.
//
// Bump RUN_TRACE_VERSION when a field changes meaning; readers branch on it.

import type { AhpInputCheck } from "./ahp-saaty";

export const RUN_TRACE_VERSION = 1 as const;

export type RunTraceStage = "pool" | "engine";

// ─── Census snapshots ─────────────────────────────────────────────────────

export type CensusKind =
  | "technical_kamus"
  | "career_corpus"
  | "career_family"
  | "career_transitions"
  | "career_depth"
  | "competency_idf";

export type CensusRef = { kind: CensusKind; fingerprint: string };

/** Kamus level-embedding census: per (code, level) row, its best similarity to a row of a DIFFERENT code. */
export type TechnicalCensusPayload = {
  model: string | null;
  codes: number;
  rows: { code: string; level: number; sim: number; bestCode: string | null; bestLevel: number | null }[];
};

/** Job-profile corpus census: every unordered document pair (a < b) of the md5-ordered, capped document set. */
export type CareerCorpusCensusPayload = {
  model: string | null;
  limit: number;
  duplicateSim: number;
  docs: number[];
  /** [a, b, sim] with a < b. The estimator's SQL sees both (a,b) and (b,a); the export expands them. */
  pairs: [number, number, number][];
};

/** Job-family precision census: labelled pairs in the order the estimator walked them (sim descending). */
export type CareerFamilyCensusPayload = {
  topicRunId: string | null;
  topicRows: number;
  minSupport: number;
  duplicateSim: number;
  /** [jobProfileId, topicId] from the topic-service run the labels came from. */
  labels: [number, number][];
  /** [a, b, sim, same] sorted by sim descending, exactly as the sweep consumed them. */
  pairs: [number, number, number, 0 | 1][];
};

/** Revealed-preference census: distinct internal moves between resolved job profiles. */
export type CareerTransitionsCensusPayload = {
  duplicateSim: number;
  /** [fromJobProfileId, toJobProfileId, sim | null]; null = a side has no vector (skipped by the estimator). */
  moves: [number, number, number | null][];
};

/** Appointment census behind the measured depth target T_years. */
export type CareerDepthCensusPayload = {
  daysPerYear: number;
  minLevelSamples: number;
  levelOrder: string[];
  /** One row per appointment that counted (years > 0): title of the seat appointed INTO. */
  appointments: { title: string | null; level: string; firstFrom: string; currentFrom: string; years: number }[];
};

/** Document frequencies behind the career fallback's IDF weights. */
export type CompetencyIdfCensusPayload = {
  docCount: number;
  minWeight: number;
  unseenFallbackDf: number;
  unseenWeight: number;
  /** Identity key per profile (deduplicated within the profile), for df = COUNTIF. */
  docs: { id: number; keys: string[] }[];
  keys: { key: string; name: string; df: number; weight: number }[];
};

export type CensusPayloadByKind = {
  technical_kamus: TechnicalCensusPayload;
  career_corpus: CareerCorpusCensusPayload;
  career_family: CareerFamilyCensusPayload;
  career_transitions: CareerTransitionsCensusPayload;
  career_depth: CareerDepthCensusPayload;
  competency_idf: CompetencyIdfCensusPayload;
};

// ─── Parameters the engine ran with ───────────────────────────────────────

export type TraceParameters = {
  technical: {
    levelGapSpan: number;
    overQualificationSurplus: number;
    levelFactorCeiling: number;
    /** Stand-in level for an unreadable proficiency (level term then neutral). */
    unknownLevelStandIn: number;
    /** Required level when a job profile states none. */
    defaultRequiredLevel: number;
    configFallbackFloor: number;
    configFallbackCeil: number;
    anchorsMinCodes: number;
    anchorsMinSpread: number;
    anchorsFloorPercentile: number;
    anchorsCeilPercentile: number;
  };
  career: {
    breadthWeight: number;
    concavity: number;
    recencyDecayPerYear: number;
    daysPerYear: number;
    fixedTargetYears: number;
    fixedTargetRows: number;
    minTargetYears: number;
    maxTargetYears: number;
    minTargetRows: number;
    maxTargetRows: number;
    statedMode: string;
    statedExperienceMultiplier: number;
    statedExperienceOnlyAboveFixed: boolean;
    useStatedExperience: boolean;
    defaultSource: string;
    titleEmbedMinSim: number;
    undatedStintYears: number;
    configFallbackFloor: number;
    configFallbackCeil: number;
  };
  careerFallback: {
    cap: number;
    useIdf: boolean;
    anchorLoPinned: number | null;
    anchorHiPinned: number | null;
    idfMinWeight: number;
    idfUnseenFallbackDf: number;
  };
  careerAnchors: {
    minDocs: number;
    minSpread: number;
    duplicateSim: number;
    maxCensusDocs: number;
    minFamilyPairs: number;
    minTransitions: number;
    familyMinSupport: number;
    corpusFloorPercentile: number;
    corpusCeilPercentile: number;
    familyFloorPrecision: number;
    familyCeilPrecision: number;
    transitionsFloorPercentile: number;
    transitionsCeilPercentile: number;
    methodVersion: string;
  };
  careerDepthCensus: { minLevelSamples: number; levelOrder: string[] };
  performance: {
    gradeValues: Record<string, number>;
    idealPositive: number;
    idealNegative: number;
    maxPeriods: number;
    recencyDecay: number;
    periodWeights: number[];
  };
  hav: {
    groupScores: Record<string, number>;
    missingScore: number;
    quadrantMatrix: Record<string, Record<string, number>>;
  };
  behavior: { ranking: string[]; values: number[]; valueMax: number; missingScore: number };
  education: {
    tierScores: { higher: number; equal: number; lower: number };
    levelRanks: Record<string, number>;
    maxRetries: number;
    model: string | null;
    groundingEnabled: boolean;
    configured: boolean;
  };
  ahp: { order: string[]; defaultWeights: Record<string, number>; randomIndex: number[] };
  topsis: { criterionType: "benefit"; zeroNormStandIn: number; tieCloseness: number; tieBreak: string };
};

// ─── Shared competency-matcher trace (technical + career fallback) ────────

export type TraceCompetencyRef = {
  name: string;
  code: string | null;
  /** normalizeCompName(name) — with `code`, the identity key. */
  norm: string;
  level: number;
};

export type CompetencyMatchTrace = {
  /** Stage 1: [requiredIndex, heldIndex] pairs settled by identity before Hungarian. */
  identity: [number, number][];
  /** Stage 2 inputs: indices identity left open. */
  openReq: number[];
  openHeld: number[];
  /** Raw cosine per [openHeld][openReq] cell; null when either side has no level vector. */
  cellRaw: (number | null)[][];
  /** Hungarian output in ORIGINAL indices: [heldIndex, requiredIndex]. */
  assignment: [number, number][];
  /** Per required competency: could anything ever score it (code, or a held identity match). */
  measurable: boolean[];
  /** Per required competency weight of the mean (1 = unweighted). */
  weights: number[];
  weightedSum: number;
  weightTotal: number;
  normalizedRaw: number;
  normalized: number;
};

// ─── Per-candidate aspect traces ──────────────────────────────────────────

export type TechnicalCandidateTrace = {
  /** The required set THIS candidate was matched against (its match indices point into it). */
  required: TraceCompetencyRef[];
  held: (TraceCompetencyRef & { levelKnown: boolean; proficiencyRaw: string | null })[];
  match: CompetencyMatchTrace;
  score: number;
};

export type CareerStintTrace = {
  index: number;
  title: string;
  positionId: string | null;
  companyId: string | null;
  /** The engine appended this stint for the current job_family match (no history row). */
  synthetic: boolean;
  /** Instants as read (ISO) and the local calendar date the month arithmetic used. */
  validFrom: string | null;
  validTo: string | null;
  validFromLocal: string | null;
  /** valid_to empty or in year 9999 (the "Sekarang" sentinel). */
  ongoing: boolean;
  /** End of tenure used for the duration: the reference date when ongoing or later. */
  tenureEnd: string | null;
  tenureEndLocal: string | null;
  clampedToReference: boolean;
  wholeMonths: number | null;
  years: number;
  isCurrent: boolean;
  status: string;
  matchType: string | null;
  jobProfileId: number | null;
  jobProfileName: string | null;
  /** max(0, cosine(target document, stint document)); null without a document vector. */
  documentSimilarity: number | null;
  /** Key into the run's fallback table when scored by incumbent competencies. */
  fallbackKey: string | null;
  fallbackRaw: number | null;
  /** applyCalibration(fallbackRaw) — the fallback's similarity on the document scale. */
  calibrated: number | null;
  /** The raw similarity rescaled: documentSimilarity, else calibrated. */
  similarityRaw: number | null;
  similarity: number | null;
  yearsSinceEnd: number | null;
  recency: number;
  effectiveYears: number;
  effectiveRows: number;
  basis: string;
  unscoredReason: string | null;
};

export type CareerCandidateTrace = {
  excludeEmployeeIds: string[];
  stints: CareerStintTrace[];
  effectiveYears: number;
  effectiveRows: number;
  depthYears: number;
  depthRows: number;
  normalized: number;
  score: number;
  binding: "years" | "rows";
};

export type CareerFallbackTrace = {
  key: string;
  code: string;
  companyId: string | null;
  excluded: string[];
  holders: {
    employeeId: string;
    companyId: string | null;
    validFrom: string | null;
    validTo: string | null;
    active: boolean;
    isPrimary: boolean;
    basis: string;
    rows: {
      name: string;
      /** normalizeCompName(name) — the key unionMaxLevel merges on. */
      norm: string;
      proficiencyName: string | null;
      score: number | null;
      currentProficiencyName: string | null;
      currentScore: number | null;
      level: number;
    }[];
  }[];
  /** unionMaxLevel of the holders' rows — the "held" side of the match. */
  union: TraceCompetencyRef[];
  /** The target's required set the union was matched against (match indices point into it). */
  required: TraceCompetencyRef[];
  match: CompetencyMatchTrace | null;
  /** Null when no holder or no competency row was found. */
  normalized: number | null;
  basis: string | null;
};

export type BehaviorTrace = {
  raw: string | null;
  normalized: string | null;
  method: "exact" | "contains" | "contained" | "none";
  index: number | null;
  category: string | null;
  value: number | null;
  score: number;
};

export type PerformanceTrace = {
  raw: string | null;
  parts: string[];
  values: number[];
  rawWeights: number[];
  weights: number[];
  dPlus: number;
  dMinus: number;
  closeness: number;
  score: number;
};

export type HavTrace = {
  /** The quadrant IN FORCE as a string (what the aspect scored). */
  raw: string | null;
  source: string;
  manual: number | null;
  uploaded: number | null;
  formula: number | null;
  performanceBand: string | null;
  competencyBand: string | null;
  digits: string | null;
  quadrant: number | null;
  score: number;
};

export type EducationTrace = {
  education: string | null;
  major: string | null;
  requirement: string | null;
  requirementSource: string;
  level: {
    candidateRank: number;
    requiredRank: number | null;
    requiredRanks: number[];
    isMinimum: boolean;
    comparison: "higher" | "equal" | "lower" | null;
    score: number | null;
  };
  exact: {
    matched: boolean;
    anyMajor: boolean;
    alternatives: string[][];
    candidateMajorTokens: string[];
    hit: string[] | null;
  };
  path: string;
  llm: { educationLevel: number; majorRelevance: number; groundedMajorAxis: number } | null;
  score: number;
  /**
   * Set when `llm` was NOT asked in this run: the model's answer was reused from
   * the last run of the position because every input it reads was identical
   * (education-reuse.ts). Absent on traces written before reuse existed.
   */
  reusedFrom?: { runId: string; answeredInRunId: string; answeredAt: string | null } | null;
};

export type CandidateTrace = {
  /** Set when the six aspects were carried from the parent run, not computed here. */
  carriedFrom: string | null;
  technical: TechnicalCandidateTrace | null;
  career: CareerCandidateTrace | null;
  behavior: BehaviorTrace | null;
  performance: PerformanceTrace | null;
  hav: HavTrace | null;
  education: EducationTrace | null;
  /** The six values TOPSIS ranked, keyed by criterion. */
  aspects: Record<string, number>;
};

// ─── The engine stage ─────────────────────────────────────────────────────

export type EngineTrace = {
  version: typeof RUN_TRACE_VERSION;
  stage: "engine";
  runId: string;
  sessionId: string;
  generatedAt: string;
  process: { timeZone: string | null; offsetMinutes: number; node: string };
  referenceDate: string;
  referenceDateLocal: string;
  parameters: TraceParameters;
  technical: {
    required: TraceCompetencyRef[];
    requiredSource: string;
    requiredDetail: string | null;
    anchors: { simFloor: number; simCeil: number; source: string; fingerprint: string | null; inherited: boolean };
    census: CensusRef | null;
    kamusResolvedByCache: number;
  };
  career: {
    anchors: {
      simFloor: number;
      simCeil: number;
      source: string;
      fingerprint: string | null;
      inherited: boolean;
      estimates: { source: string; floor: number; ceil: number; sampleCount: number }[];
    };
    census: CensusRef[];
    target: {
      jobProfileId: number | null;
      jobProfileName: string | null;
      matchType: string | null;
      status: string;
      statedExperience: string | null;
      pinned: boolean;
    };
    calibration: null | {
      lo: number;
      hi: number;
      hiFull: number | null;
      cap: number;
      source: string;
      pinnedLo: number | null;
      pinnedHi: number | null;
    };
    depth: {
      targetYears: number;
      targetRows: number;
      source: string;
      pinned: { targetYears: number; targetRows: number } | null;
      statedExperience: string | null;
      statedParsedYears: number | null;
      fromStated: number | null;
      readsStated: boolean;
      useStated: boolean;
      level: string | null;
      levelLabel: string | null;
      measured: { years: number; basis: string; sampleCount: number } | null;
      defaultYears: number | null;
      census: CensusRef | null;
    };
    idf: { census: CensusRef | null; docCount: number; unseenWeight: number } | null;
    fallbacks: Record<string, CareerFallbackTrace>;
  };
  ahp: {
    pairwise: number[][];
    weightsUsed: Record<string, number>;
    weightSource: string;
    weightsInherited: boolean;
    resolved: { weights: Record<string, number>; lambdaMax: number; ci: number; cr: number };
    reported: { lambdaMax: number; ci: number; cr: number };
    /** validateAhpPairwise of `pairwise` (docs/ahp-input-sync.md §8). Absent on traces written before it. */
    inputCheck?: AhpInputCheck;
    randomIndex: number;
  };
  topsis: {
    activeCriteria: string[];
    weightVector: number[];
    rowIds: string[];
    matrix: number[][];
    colNorms: number[];
    idealPos: number[];
    idealNeg: number[];
    closeness: number[];
    dPlus: number[];
    dMinus: number[];
    targetFinalists: number;
  };
  readiness: { source: string; thresholds: { minScore: number; level: string }[] | null; defaultLevel: string | null };
  carried: { parentRunId: string | null; candidateIds: string[]; fromParentTrace: number };
  candidates: Record<string, CandidateTrace>;
};

// ─── The pool stage (web app, at run creation) ────────────────────────────

export type PoolTraceRule = {
  /** Position in the flattened tree, 1-based — also the rule's column in the export. */
  index: number;
  /** Path of group indices from the root, e.g. [0, 2]. */
  path: number[];
  field: string;
  operator: string;
  value: unknown;
  label: string;
  severity: "hard" | "advisory";
  enabled: boolean;
};

export type PoolTraceGroup = { path: number[]; op: "and" | "or"; children: ({ rule: number } | { group: number[] })[] };

export type PoolTrace = {
  version: typeof RUN_TRACE_VERSION;
  stage: "pool";
  generatedAt: string;
  /** Live candidates in the included business units before any gate. */
  population: number;
  excludedByUser: string[];
  grade: { minGradeId: string | null; maxGradeId: string | null; min: number | null; max: number | null };
  gate: {
    candidateId: string;
    grade: string | null;
    gradeNumeric: number | null;
    incumbent: boolean;
    gradeOk: boolean;
    passed: boolean;
  }[];
  filter: null | {
    enforce: boolean;
    rules: PoolTraceRule[];
    groups: PoolTraceGroup[];
    candidates: {
      candidateId: string;
      values: Record<string, unknown>;
      /** Per rule index: pass / fail / not evaluated (switched off). */
      results: Record<string, boolean | null>;
      dataMissing: Record<string, boolean>;
      qualified: boolean;
      flagged: string[];
    }[];
  };
};
