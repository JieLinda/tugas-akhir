// ── Comparing two scoring runs of one position, 1:1 — computed, never narrated ──
//
// Why two rankings of the same seat differ can only come from five places
// (docs/rerun-requirements-audit.md, §2 of the requirements):
//
//   S1  the pool — TOPSIS is set-relative: every column's divisor sqrt(Σx²) and
//       the ideal / anti-ideal are taken from the alternatives present;
//   S2  the weights and the active criteria;
//   S3  the six aspect values of candidates both runs scored;
//   S4  the "skor sementara" (provisional) flag;
//   S5  presentation / filtering configuration: filter rules, grade range,
//       business units, readiness thresholds, finalist count.
//
// S1, S3 and S4 read as "perubahan data atau himpunan", S2 and S5 as "perubahan
// konfigurasi atau pertimbangan". This module states which of them differ and
// by how much, re-ranks from STORED data only (FR-CMP-13: no model, no aspect
// is recomputed), and — through `replayRun` — proves that a stored ranking is
// what its stored inputs produce (NFR-RR-01).
//
// I-7: every ranking here is produced by scoring-service's own
// `rankCandidatesByTopsis` (scoring-service/src/topsis-ranking.ts, included in
// the web build — see .dockerignore). There is no second copy of the formula.
//
// Pure: lib/run-compare-data.ts does the reads.

import { rankCandidatesByTopsis } from '../scoring-service/src/topsis-ranking';
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from '../scoring-service/src/ahp-criteria';
import type { RunModelsRecord } from './rerun-modes';
import { fmtNumber, fmtWeight } from './run-compare-format';
import { formatDateTime } from './datetime';

export type CriterionKey = AhpCriterionKey;
export const CRITERIA: readonly CriterionKey[] = AHP_CRITERIA_ORDER;

export const CRITERION_LABEL: Record<CriterionKey, string> = {
  technical: 'Kompetensi Teknis',
  career: 'Relevansi Karier',
  behavior: 'Behavior',
  performance: 'Performance Appraisal',
  hav: 'HAV',
  education: 'Pendidikan',
};

/**
 * Where a configuration item's value came from (I-3), stated on every item.
 *  - `root_snapshot` — frozen when this root run was created / computed;
 *  - `frozen_parent` — inherited from the parent ("Tambah Kandidat Pembanding");
 *  - `live`          — read from today's state when the run was created;
 *  - `live_fallback` — should have been frozen, but the parent (an older run)
 *                      did not record it, so today's value was used;
 *  - `default`       — the system default (no program matrix);
 *  - `not_recorded`  — the run does not hold it at all ("Tidak tersimpan").
 */
export type Origin = 'root_snapshot' | 'frozen_parent' | 'live' | 'live_fallback' | 'default' | 'not_recorded';

export const ORIGIN_LABEL: Record<Origin, string> = {
  root_snapshot: 'Dibekukan saat run dibuat',
  frozen_parent: 'Diwarisi dari run induk',
  live: 'Kondisi saat run dibuat',
  live_fallback: 'Nilai hari ini (run lama tidak menyimpan)',
  default: 'Bawaan sistem',
  not_recorded: 'Tidak tersimpan pada run ini',
};

/** The engine's `weightSource` values in words (as on the run's configuration panel). */
export const WEIGHT_SOURCE_LABEL: Record<string, string> = {
  'ahp-matrix': 'Matriks perbandingan dari Tata Kelola',
  default: 'Bobot bawaan sistem (program tanpa matriks AHP)',
  inherited: 'Diwarisi dari run induk',
  'criteria-weights': 'Diturunkan dari bobot "Kriteria & Bobot" program (aturan lama)',
};

/** Where a position's competency reference came from (engine `RequiredSource`). */
export const REQUIRED_SOURCE_LABEL: Record<string, string> = {
  profile: 'dokumen job profile',
  critical_position: 'daftar kompetensi pada posisi',
  incumbent: 'kompetensi pemegang jabatan saat ini',
  position_aggregate: 'gabungan kompetensi seluruh pemegang jabatan',
  none: 'tidak ada acuan',
};

/** Where the career depth target T came from (engine `CareerDepthTargets.source`). */
export const DEPTH_SOURCE_LABEL: Record<string, string> = {
  jd: 'syarat pengalaman pada job profile',
  measured: 'median masa kerja saat pengangkatan nyata',
  fixed: 'nilai tetap',
  inherited: 'diwarisi dari run induk',
  pool: 'median pool (aturan lama)',
};

export type ReadinessThresholds = {
  thresholds: { minScore: number; level: string }[];
  defaultLevel: string;
};

export type RunConfigView = {
  /** Nominal AHP priority vector at full precision, before redistribution. */
  weights: Record<CriterionKey, number> | null;
  weightsOrigin: Origin;
  /** The pairwise matrix as recorded (full precision when the run kept it). */
  pairwise: number[][] | null;
  consistency: { cr: number; lambdaMax: number; ci: number } | null;
  /** `ahp-matrix` | `default` | `inherited` | … as the engine recorded it. */
  weightSource: string | null;
  activeCriteria: CriterionKey[] | null;
  droppedCriteria: { key: CriterionKey; reason: string }[];
  criteriaOrigin: Origin;
  filter: {
    ruleLabels: string[];
    ruleCount: number;
    /** Canonical JSON of the frozen filter tree — equality only. */
    treeKey: string | null;
    enforce: boolean | null;
    origin: Origin;
  };
  gradeRange: { min: string | null; max: string | null };
  includedTenantIds: string[];
  readiness: ReadinessThresholds | null;
  readinessOrigin: Origin;
  /** N — how many made the cut. */
  finalistCount: number | null;
  anchors: {
    technical: { simFloor: number; simCeil: number; source: string } | null;
    career: { simFloor: number; simCeil: number; source: string } | null;
    depth: { targetYears: number; targetRows: number } | null;
    origin: Origin;
  };
  referenceDate: string | null;
  referenceDateOrigin: Origin;
  positionBasis: {
    jobProfileName: string | null;
    contentHash: string | null;
    requiredCount: number;
    requiredSource: string | null;
    educationSource: string | null;
    /** Null when the requirement is the incumbent's own (personal data). */
    educationRequirement: string | null;
    careerTarget: string | null;
    kamusFingerprint: string | null;
    origin: Origin;
    /**
     * What the engine said about a basis it inherited (FR-RR-07c/d): parts it
     * had to read live, and caveats such as "kamus berubah sejak run induk".
     */
    liveParts: string[];
    caveats: string[];
  } | null;
  models: RunModelsRecord | null;
  dataVersions: {
    lastSyncByJob: Record<string, string | null>;
    jobProfileCorpus: { fingerprint: string | null; documents: number };
    kamus: { fingerprint: string | null; codes: number | null };
  } | null;
};

export type RunCandidate = {
  candidateId: string;
  name: string;
  unit: string | null;
  aspects: Record<CriterionKey, number>;
  /** `scoring_run_pool_aspects.closeness` — numeric(10,6). */
  storedCloseness: number;
  /** `details.topsis.closeness` at full precision (runs computed after FR-SN-01). */
  fullCloseness: number | null;
  /** `pool_rank`, 1-based over the whole scored pool. */
  storedRank: number;
  /** Made the finalist cut. */
  isFinalist: boolean;
  /** Has an `analysis_results` row (listed on the run). */
  listed: boolean;
  /** The readiness label stored with the row (FR-SN-04); null when not listed. */
  readiness: string | null;
  provisional: boolean;
  markers: {
    comparison: boolean;
    existingPool: boolean;
    newlyScored: boolean;
    enteredTopN: boolean;
    leftTopN: boolean;
    outOfRange: boolean;
  };
  excluded: { reason: string; note: string | null } | null;
  decision: { notes: string | null; programCode: string } | null;
};

export type RunRecord = {
  id: string;
  positionId: string;
  tenantId: string;
  label: string | null;
  method: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  createdByName: string | null;
  parentRunId: string | null;
  rerunMode: string;
  rerunReason: string | null;
  legacy: boolean;
  modeLabel: string;
  /** Root → … → this run (ids), as far as the lineage is intact. */
  lineage: string[];
  config: RunConfigView;
  pool: RunCandidate[];
  poolSource: 'pool_snapshot' | 'finalists_only' | 'none';
  /** Per-candidate filter rejections recorded by this run. */
  disqualified: Map<string, string[]>;
  /** Candidates whose record is soft-deleted now. */
  deletedNow: Set<string>;
  /** Candidates who hold the position now. */
  incumbentsNow: Set<string>;
};

// ── Replay (NFR-RR-01, I-4) ─────────────────────────────────────────────────

export type Replay = {
  available: true;
  activeCriteria: CriterionKey[];
  effectiveWeights: Record<CriterionKey, number>;
  /** By candidate: replayed closeness, distances, rank. */
  byId: Map<string, { closeness: number; dPlus: number; dMinus: number; rank: number }>;
  /** Per active criterion: divisor, weighted ideals and the raw extremes with their holders. */
  criteria: Map<CriterionKey, CriterionStat>;
  /** Per candidate, per active criterion: r, v, contributions. */
  cells: Map<string, Map<CriterionKey, Cell>>;
};
export type ReplayUnavailable = { available: false; reason: string };

export type CriterionStat = {
  key: CriterionKey;
  weight: number;
  divisor: number;
  idealPos: number;
  idealNeg: number;
  maxRaw: number;
  minRaw: number;
  idealPosHolders: string[];
  idealNegHolders: string[];
};
export type Cell = {
  raw: number;
  normalized: number;
  weighted: number;
  contribPlus: number;
  contribMinus: number;
};

/** Byte order — Postgres's uuid order, the engine's matrix row order. */
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Rank a pool exactly as the engine did: candidates in id order, the run's own
 * nominal weights and active criteria, scoring-service's `rankCandidatesByTopsis`.
 */
export function rankPool(
  pool: { candidateId: string; aspects: Record<CriterionKey, number> }[],
  weights: Record<CriterionKey, number>,
  activeCriteria: CriterionKey[],
): Replay {
  const ids = pool.map((p) => p.candidateId).sort(byId);
  const aspects = new Map(pool.map((p) => [p.candidateId, p.aspects]));
  const dropped = new Set(CRITERIA.filter((k) => !activeCriteria.includes(k)));
  const r = rankCandidatesByTopsis(
    ids.map((id) => ({ id })),
    aspects,
    weights,
    dropped,
  );
  const byIdMap = new Map<string, { closeness: number; dPlus: number; dMinus: number; rank: number }>();
  r.rankedAll.forEach((e, i) =>
    byIdMap.set(e.candidate.id, { closeness: e.closeness, dPlus: e.dPlus, dMinus: e.dMinus, rank: i + 1 }),
  );
  const d = r.detail;
  const criteria = new Map<CriterionKey, CriterionStat>();
  const cells = new Map<string, Map<CriterionKey, Cell>>();
  r.activeCriteria.forEach((key, j) => {
    const raws = d.rowIds.map((id) => aspects.get(id)![key]);
    const maxRaw = raws.length ? Math.max(...raws) : 0;
    const minRaw = raws.length ? Math.min(...raws) : 0;
    criteria.set(key, {
      key,
      weight: d.weightVector[j]!,
      divisor: d.colNorms[j]!,
      idealPos: d.idealPos[j]!,
      idealNeg: d.idealNeg[j]!,
      maxRaw,
      minRaw,
      idealPosHolders: d.rowIds.filter((_, i) => d.weighted[i]![j] === d.idealPos[j]),
      idealNegHolders: d.rowIds.filter((_, i) => d.weighted[i]![j] === d.idealNeg[j]),
    });
  });
  d.rowIds.forEach((id, i) => {
    const m = new Map<CriterionKey, Cell>();
    r.activeCriteria.forEach((key, j) => {
      m.set(key, {
        raw: aspects.get(id)![key],
        normalized: d.normalized[i]![j]!,
        weighted: d.weighted[i]![j]!,
        contribPlus: d.contribPlus[i]![j]!,
        contribMinus: d.contribMinus[i]![j]!,
      });
    });
    cells.set(id, m);
  });
  return {
    available: true,
    activeCriteria: r.activeCriteria,
    effectiveWeights: r.effectiveWeights,
    byId: byIdMap,
    criteria,
    cells,
  };
}

/** Replay a stored run from its stored inputs, or say why it cannot be. */
export function replayRun(run: RunRecord): Replay | ReplayUnavailable {
  if (run.method !== 'AHP_TOPSIS') {
    return { available: false, reason: 'Run ini bukan AHP + TOPSIS, jadi tidak punya matriks keputusan yang dapat dihitung ulang.' };
  }
  if (run.poolSource !== 'pool_snapshot' || run.pool.length === 0) {
    return { available: false, reason: 'Run ini tidak menyimpan skor aspek seluruh pool (run lama).' };
  }
  if (!run.config.weights) {
    return { available: false, reason: 'Run ini tidak menyimpan vektor bobotnya.' };
  }
  const active =
    run.config.activeCriteria ??
    CRITERIA.filter((k) => !run.config.droppedCriteria.some((d) => d.key === k));
  return rankPool(run.pool, run.config.weights, active);
}

export type ReproducibilityResult =
  | {
      verifiable: true;
      /** Every closeness and rank matches what is stored (I-4). */
      reproducible: boolean;
      /** Largest |replay − stored| at the stored precision (6 decimals). */
      maxStoredDelta: number;
      /** Largest |replay − stored| at full precision, when stored. Null for older runs. */
      maxFullDelta: number | null;
      rankMismatches: { candidateId: string; stored: number; replayed: number }[];
      closenessMismatches: { candidateId: string; stored: number; replayed: number }[];
      checked: number;
    }
  | { verifiable: false; reason: string };

/** I-4 tolerance: |Δ| ≤ 1e-9 and identical ranks. */
export const REPRODUCIBILITY_TOLERANCE = 1e-9;

/**
 * NFR-RR-01: recompute the run's TOPSIS from its STORED aspects, weights and
 * active criteria, and compare with its stored closeness and ranks.
 *
 * The `closeness` column is numeric(10,6), so the replay is compared at that
 * precision (round to 6 decimals, then |Δ| ≤ 1e-9); a run that also stored the
 * unrounded value (`details.topsis`) is compared at full precision too.
 */
export function verifyRunReproducibility(run: RunRecord): ReproducibilityResult {
  const replay = replayRun(run);
  if (!replay.available) return { verifiable: false, reason: replay.reason };
  let maxStoredDelta = 0;
  let maxFullDelta: number | null = null;
  const rankMismatches: { candidateId: string; stored: number; replayed: number }[] = [];
  const closenessMismatches: { candidateId: string; stored: number; replayed: number }[] = [];
  for (const c of run.pool) {
    const r = replay.byId.get(c.candidateId);
    if (!r) {
      rankMismatches.push({ candidateId: c.candidateId, stored: c.storedRank, replayed: -1 });
      continue;
    }
    const rounded = Number(r.closeness.toFixed(6));
    const dStored = Math.abs(rounded - c.storedCloseness);
    maxStoredDelta = Math.max(maxStoredDelta, dStored);
    if (dStored > REPRODUCIBILITY_TOLERANCE) {
      closenessMismatches.push({ candidateId: c.candidateId, stored: c.storedCloseness, replayed: r.closeness });
    }
    if (c.fullCloseness != null) {
      const dFull = Math.abs(r.closeness - c.fullCloseness);
      maxFullDelta = Math.max(maxFullDelta ?? 0, dFull);
      if (dFull > REPRODUCIBILITY_TOLERANCE) {
        closenessMismatches.push({ candidateId: c.candidateId, stored: c.fullCloseness, replayed: r.closeness });
      }
    }
    if (r.rank !== c.storedRank) {
      rankMismatches.push({ candidateId: c.candidateId, stored: c.storedRank, replayed: r.rank });
    }
  }
  return {
    verifiable: true,
    reproducible: rankMismatches.length === 0 && closenessMismatches.length === 0,
    maxStoredDelta,
    maxFullDelta,
    rankMismatches,
    closenessMismatches,
    checked: run.pool.length,
  };
}

// ── Relationship between A and B (FR-CMP-02) ────────────────────────────────

export type Relation =
  | { kind: 'same_run' }
  | { kind: 'b_child_of_a' }
  | { kind: 'b_descendant_of_a'; generations: number }
  | { kind: 'a_child_of_b' }
  | { kind: 'a_descendant_of_b'; generations: number }
  | { kind: 'same_tree'; commonAncestorId: string }
  | { kind: 'different_root' };

/**
 * Why two loaded runs cannot be compared, or null when they can (FR-CMP-01,
 * I-5). The loader returns null for a run that does not exist OR belongs to
 * another tenant, so "not found here" covers both — a run of another company
 * is indistinguishable from no run at all.
 */
export function comparabilityError(a: RunRecord | null, b: RunRecord | null): string | null {
  if (!a || !b || a.tenantId !== b.tenantId) return 'Run tidak ditemukan di Company ini.';
  if (a.positionId !== b.positionId) {
    return 'Perbandingan hanya untuk dua run pada posisi target yang sama. Run pada posisi lain menilai kursi yang berbeda.';
  }
  for (const [side, r] of [['A', a], ['B', b]] as const) {
    if (r.method !== 'AHP_TOPSIS') {
      return `Run ${side} bukan AHP + TOPSIS, jadi tidak punya matriks keputusan per kriteria untuk dibandingkan secara terstruktur.`;
    }
    if (r.status !== 'completed') return `Run ${side} belum selesai, jadi belum ada hasil untuk dibandingkan.`;
  }
  return null;
}

export function relationOf(a: RunRecord, b: RunRecord): Relation {
  if (a.id === b.id) return { kind: 'same_run' };
  const ia = b.lineage.indexOf(a.id);
  if (ia >= 0) {
    const g = b.lineage.length - 1 - ia;
    return g === 1 ? { kind: 'b_child_of_a' } : { kind: 'b_descendant_of_a', generations: g };
  }
  const ib = a.lineage.indexOf(b.id);
  if (ib >= 0) {
    const g = a.lineage.length - 1 - ib;
    return g === 1 ? { kind: 'a_child_of_b' } : { kind: 'a_descendant_of_b', generations: g };
  }
  if (a.lineage[0] && a.lineage[0] === b.lineage[0]) {
    let common = a.lineage[0]!;
    for (let i = 0; i < Math.min(a.lineage.length, b.lineage.length); i++) {
      if (a.lineage[i] === b.lineage[i]) common = a.lineage[i]!;
      else break;
    }
    return { kind: 'same_tree', commonAncestorId: common };
  }
  return { kind: 'different_root' };
}

export function relationSentence(rel: Relation): string {
  switch (rel.kind) {
    case 'same_run':
      return 'A dan B adalah run yang sama.';
    case 'b_child_of_a':
      return 'B turunan langsung A.';
    case 'b_descendant_of_a':
      return `B keturunan A sejauh ${rel.generations} tingkat.`;
    case 'a_child_of_b':
      return 'A turunan langsung B.';
    case 'a_descendant_of_b':
      return `A keturunan B sejauh ${rel.generations} tingkat.`;
    case 'same_tree':
      return 'A dan B satu pohon, tetapi beda cabang.';
    case 'different_root':
      return 'A dan B berasal dari root yang berbeda (penilaian terpisah).';
  }
}

/** Is the pair a "Tambah Kandidat Pembanding" parent → child, either way round? */
function frozenPair(a: RunRecord, b: RunRecord, rel: Relation): boolean {
  if (rel.kind === 'b_child_of_a') return b.rerunMode === 'incremental_add';
  if (rel.kind === 'a_child_of_b') return a.rerunMode === 'incremental_add';
  return false;
}

// ── The comparison ──────────────────────────────────────────────────────────

const EPS = 1e-9;

export type SourceKey = 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
export type SourceVerdict = { key: SourceKey; label: string; differs: boolean; summary: string };

export type MembershipStatus = 'both' | 'only_a' | 'only_b';

export type RankingRow = {
  candidateId: string;
  name: string;
  unit: string | null;
  membership: MembershipStatus;
  /** Why the candidate is on one side only, when the stored data can say. */
  membershipReason: string | null;
  rankA: number | null;
  rankB: number | null;
  /** rankA − rankB: positive = moved UP in B. Null when not in both. */
  deltaRank: number | null;
  ccA: number | null;
  ccB: number | null;
  /** (ccB − ccA) × 100 — percentage points. */
  deltaPp: number | null;
  finalistA: boolean | null;
  finalistB: boolean | null;
  finalistChange: 'masuk' | 'keluar' | 'tetap' | 'tidak' | null;
  readinessA: string | null;
  readinessB: string | null;
  decisionA: string | null;
  decisionB: string | null;
  markers: {
    comparison: boolean;
    existingPool: boolean;
    excludedA: boolean;
    excludedB: boolean;
    outOfRange: boolean;
    provisionalA: boolean;
    provisionalB: boolean;
  };
  aspectsChanged: CriterionKey[];
};

export type CriterionRow = {
  key: CriterionKey;
  label: string;
  activeA: boolean;
  activeB: boolean;
  weightA: number | null;
  weightB: number | null;
  /** Percentage points. */
  deltaWeightPp: number | null;
  idealPosA: { raw: number; holders: string[] } | null;
  idealPosB: { raw: number; holders: string[] } | null;
  idealNegA: { raw: number; holders: string[] } | null;
  idealNegB: { raw: number; holders: string[] } | null;
  divisorA: number | null;
  divisorB: number | null;
  /** divisorB / divisorA. */
  divisorRatio: number | null;
};

export type CandidateBreakdown = {
  candidateId: string;
  name: string;
  a: { cells: Map<CriterionKey, Cell>; dPlus: number; dMinus: number; closeness: number } | null;
  b: { cells: Map<CriterionKey, Cell>; dPlus: number; dMinus: number; closeness: number } | null;
  /** Per criterion, B − A, for criteria active on both sides. */
  delta: Map<CriterionKey, { raw: number; weighted: number; contribPlus: number; contribMinus: number }>;
  /** The two criteria whose contribution moved most (|ΔD⁺ share| + |ΔD⁻ share|). */
  topMovers: CriterionKey[];
};

export type ConfigDiffItem = {
  key: string;
  group: 'Pembobotan' | 'Kriteria aktif' | 'Aturan penyaringan' | 'Penyajian' | 'Parameter & jangkar' | 'Basis posisi' | 'Model' | 'Versi data';
  label: string;
  a: string;
  b: string;
  same: boolean;
  /**
   * Whether each side stored the item at all. Two unrecorded values are not
   * "the same" (I-6), so the status reads from these before `same`.
   */
  recordedA: boolean;
  recordedB: boolean;
  /** For numbers: B − A. */
  delta: number | null;
  originA: Origin;
  originB: Origin;
};

/** The status word for one configuration item (UI and export share it). */
export function configStatusLabel(c: Pick<ConfigDiffItem, 'same' | 'recordedA' | 'recordedB'>): string {
  if (!c.recordedA && !c.recordedB) return 'Tidak tercatat';
  if (!c.recordedA) return 'Tidak tercatat pada run A';
  if (!c.recordedB) return 'Tidak tercatat pada run B';
  return c.same ? 'Sama' : 'Berbeda';
}

export type AttributionStep = {
  key: 'A' | 'weights' | 'aspects' | 'pool';
  label: string;
  /** Closeness and rank per candidate AFTER this step (candidates present at this step). */
  byId: Map<string, { closeness: number; rank: number }>;
};

export type Comparison = {
  a: RunRecord;
  b: RunRecord;
  relation: Relation;
  relationText: string;
  /** Structured comparison is possible (both AHP+TOPSIS with a pool snapshot). */
  structured: boolean;
  unavailableReason: string | null;
  sources: SourceVerdict[];
  /** S2–S5 differ on a "Tambah Kandidat Pembanding" pair: a frozen part moved — a bug. */
  freezeViolations: SourceVerdict[];
  config: ConfigDiffItem[];
  pairwiseCells: { row: CriterionKey; col: CriterionKey; a: number | null; b: number | null; same: boolean }[];
  ranking: RankingRow[];
  criteria: CriterionRow[];
  breakdowns: Map<string, CandidateBreakdown>;
  attribution: AttributionStep[] | null;
  reproducibility: { a: ReproducibilityResult; b: ReproducibilityResult };
};

const fmtList = (xs: string[]) => xs.join(', ');

function sameWeights(a: Record<CriterionKey, number> | null, b: Record<CriterionKey, number> | null): boolean {
  if (!a || !b) return a === b;
  return CRITERIA.every((k) => Math.abs(a[k] - b[k]) <= 1e-12);
}
function sameList(a: readonly string[] | null, b: readonly string[] | null): boolean {
  return JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
}
function readinessKey(r: ReadinessThresholds | null): string {
  return r ? JSON.stringify(r.thresholds.map((t) => [t.minScore, t.level]).concat([[r.defaultLevel]])) : '';
}

function membershipReason(c: RunCandidate | undefined, other: RunRecord, side: 'A' | 'B', run: RunRecord): string | null {
  // c is the candidate as it appears on `run` (the side it IS on); `other` lacks it.
  if (!c) return null;
  if (c.markers.comparison && run.rerunMode === 'incremental_add') {
    return c.markers.outOfRange
      ? `Kandidat pembanding di run ${side}, di luar rentang grade, ditambahkan dengan konfirmasi`
      : `Kandidat pembanding yang ditambahkan di run ${side}`;
  }
  const rejected = other.disqualified.get(c.candidateId);
  if (rejected && rejected.length > 0) {
    const rulesDiffer = (other.config.filter.treeKey ?? '') !== (run.config.filter.treeKey ?? '');
    return `Tidak lolos aturan filter di run ${side === 'A' ? 'B' : 'A'}: ${rejected.join('; ')}${
      rulesDiffer ? ' (aturan filter kedua run berbeda)' : ''
    }`;
  }
  // Both sets describe TODAY and are loaded over a run's own pool, so the
  // candidate can only be found in the sets of the run that holds them.
  if (run.incumbentsNow.has(c.candidateId)) return 'Kini pemegang jabatan target';
  if (run.deletedNow.has(c.candidateId)) return 'Data kandidat kini dihapus';
  return null;
}

/**
 * Compare run A (pembanding) with run B (yang dibandingkan). Same tenant and
 * same position are the caller's responsibility (I-5) — the loader refuses
 * anything else before this runs.
 */
export function compareRuns(a: RunRecord, b: RunRecord): Comparison {
  const relation = relationOf(a, b);
  const replayA = replayRun(a);
  const replayB = replayRun(b);
  const structured = replayA.available && replayB.available;
  const unavailableReason = structured
    ? null
    : [!replayA.available ? `A: ${replayA.reason}` : null, !replayB.available ? `B: ${replayB.reason}` : null]
        .filter(Boolean)
        .join(' ');

  const poolA = new Map(a.pool.map((c) => [c.candidateId, c]));
  const poolB = new Map(b.pool.map((c) => [c.candidateId, c]));
  const allIds = [...new Set([...poolA.keys(), ...poolB.keys()])];
  const both = allIds.filter((id) => poolA.has(id) && poolB.has(id));
  const onlyA = allIds.filter((id) => poolA.has(id) && !poolB.has(id));
  const onlyB = allIds.filter((id) => !poolA.has(id) && poolB.has(id));
  const nameOf = (id: string) => poolB.get(id)?.name ?? poolA.get(id)?.name ?? id;

  // ── S1–S5 ──
  const aspectChanges = both
    .map((id) => {
      const x = poolA.get(id)!.aspects;
      const y = poolB.get(id)!.aspects;
      return { id, keys: CRITERIA.filter((k) => Math.abs(x[k] - y[k]) > EPS) };
    })
    .filter((c) => c.keys.length > 0);
  const provisionalChanges = both.filter((id) => poolA.get(id)!.provisional !== poolB.get(id)!.provisional);
  const activeA = replayA.available ? replayA.activeCriteria : (a.config.activeCriteria ?? null);
  const activeB = replayB.available ? replayB.activeCriteria : (b.config.activeCriteria ?? null);
  const weightsDiffer = !sameWeights(a.config.weights, b.config.weights);
  const activeDiffer = !sameList(activeA, activeB);
  const s5Parts: string[] = [];
  if ((a.config.filter.treeKey ?? '') !== (b.config.filter.treeKey ?? '')) s5Parts.push('aturan filter');
  if (a.config.gradeRange.min !== b.config.gradeRange.min || a.config.gradeRange.max !== b.config.gradeRange.max)
    s5Parts.push('rentang grade');
  if (!sameList(a.config.includedTenantIds, b.config.includedTenantIds)) s5Parts.push('business unit');
  if (readinessKey(a.config.readiness) !== readinessKey(b.config.readiness)) s5Parts.push('ambang readiness');
  if (a.config.finalistCount !== b.config.finalistCount) s5Parts.push('jumlah finalis');

  const sources: SourceVerdict[] = [
    {
      key: 'S1',
      label: 'Komposisi pool',
      differs: onlyA.length + onlyB.length > 0,
      summary:
        onlyA.length + onlyB.length > 0
          ? `Pool: +${onlyB.length} kandidat, −${onlyA.length}`
          : 'Pool: sama',
    },
    {
      key: 'S2',
      label: 'Bobot dan kriteria aktif',
      differs: weightsDiffer || activeDiffer,
      summary: weightsDiffer || activeDiffer
        ? `Bobot: ${weightsDiffer ? 'berbeda' : 'sama'}; kriteria aktif: ${activeDiffer ? 'berbeda' : 'sama'}`
        : 'Bobot: sama',
    },
    {
      key: 'S3',
      label: 'Nilai enam aspek',
      differs: aspectChanges.length > 0,
      summary:
        aspectChanges.length > 0 ? `Nilai aspek: ${aspectChanges.length} kandidat berubah` : 'Nilai aspek: sama',
    },
    {
      key: 'S4',
      label: 'Penanda skor sementara',
      differs: provisionalChanges.length > 0,
      summary:
        provisionalChanges.length > 0
          ? `Skor sementara: ${provisionalChanges.length} kandidat berbeda`
          : 'Penanda skor sementara: sama',
    },
    {
      key: 'S5',
      label: 'Penyajian dan penyaringan',
      differs: s5Parts.length > 0,
      summary: s5Parts.length > 0 ? `Berbeda: ${fmtList(s5Parts)}` : 'Aturan, ambang, dan jumlah finalis: sama',
    },
  ];
  // On a "Tambah Kandidat Pembanding" pair only S1 may differ.
  const freezeViolations = frozenPair(a, b, relation)
    ? sources.filter(
        (s) =>
          (s.key === 'S2' || s.key === 'S3' || s.key === 'S5') && s.differs,
      ).concat(provisionalChanges.length > 0 ? [sources[3]!] : [])
    : [];

  // ── Configuration side by side (FR-CMP-04) ──
  const config = configDiff(a, b, activeA, activeB);
  const pairwiseCells: Comparison['pairwiseCells'] = [];
  CRITERIA.forEach((row, i) =>
    CRITERIA.forEach((col, j) => {
      const va = a.config.pairwise?.[i]?.[j] ?? null;
      const vb = b.config.pairwise?.[i]?.[j] ?? null;
      pairwiseCells.push({
        row,
        col,
        a: va,
        b: vb,
        same: va != null && vb != null ? Math.abs(va - vb) <= 1e-9 : va === vb,
      });
    }),
  );

  // ── Ranking rows (FR-CMP-06) ──
  const finalistChange = (x: boolean | null, y: boolean | null): RankingRow['finalistChange'] =>
    x == null || y == null ? null : x && y ? 'tetap' : !x && y ? 'masuk' : x && !y ? 'keluar' : 'tidak';
  const ranking: RankingRow[] = allIds.map((id) => {
    const ca = poolA.get(id);
    const cb = poolB.get(id);
    const membership: MembershipStatus = ca && cb ? 'both' : ca ? 'only_a' : 'only_b';
    const reason =
      membership === 'only_b'
        ? membershipReason(cb, a, 'B', b)
        : membership === 'only_a'
          ? membershipReason(ca, b, 'A', a)
          : null;
    const ccA = ca ? ca.storedCloseness : null;
    const ccB = cb ? cb.storedCloseness : null;
    return {
      candidateId: id,
      name: nameOf(id),
      unit: cb?.unit ?? ca?.unit ?? null,
      membership,
      membershipReason: reason,
      rankA: ca?.storedRank ?? null,
      rankB: cb?.storedRank ?? null,
      deltaRank: ca && cb ? ca.storedRank - cb.storedRank : null,
      ccA,
      ccB,
      deltaPp: ccA != null && ccB != null ? (ccB - ccA) * 100 : null,
      finalistA: ca ? ca.isFinalist : null,
      finalistB: cb ? cb.isFinalist : null,
      finalistChange: finalistChange(ca ? ca.isFinalist : null, cb ? cb.isFinalist : null),
      readinessA: ca?.readiness ?? null,
      readinessB: cb?.readiness ?? null,
      decisionA: ca?.decision?.notes ?? (ca?.decision ? '' : null),
      decisionB: cb?.decision?.notes ?? (cb?.decision ? '' : null),
      markers: {
        comparison: Boolean(cb?.markers.comparison && b.rerunMode === 'incremental_add') ||
          Boolean(ca?.markers.comparison && a.rerunMode === 'incremental_add'),
        existingPool: Boolean(cb?.markers.existingPool || ca?.markers.existingPool),
        excludedA: Boolean(ca?.excluded),
        excludedB: Boolean(cb?.excluded),
        outOfRange: Boolean(cb?.markers.outOfRange || ca?.markers.outOfRange),
        provisionalA: Boolean(ca?.provisional),
        provisionalB: Boolean(cb?.provisional),
      },
      aspectsChanged: aspectChanges.find((c) => c.id === id)?.keys ?? [],
    };
  });
  ranking.sort((x, y) => {
    const rx = x.rankB ?? Number.POSITIVE_INFINITY;
    const ry = y.rankB ?? Number.POSITIVE_INFINITY;
    if (rx !== ry) return rx - ry;
    return (x.rankA ?? Number.POSITIVE_INFINITY) - (y.rankA ?? Number.POSITIVE_INFINITY);
  });

  // ── Criteria (FR-CMP-07) ──
  const criteria: CriterionRow[] = CRITERIA.map((key) => {
    const sa = replayA.available ? replayA.criteria.get(key) ?? null : null;
    const sb = replayB.available ? replayB.criteria.get(key) ?? null : null;
    const wa = replayA.available ? replayA.effectiveWeights[key] : null;
    const wb = replayB.available ? replayB.effectiveWeights[key] : null;
    return {
      key,
      label: CRITERION_LABEL[key],
      activeA: Boolean(sa),
      activeB: Boolean(sb),
      weightA: sa ? sa.weight : wa ?? null,
      weightB: sb ? sb.weight : wb ?? null,
      deltaWeightPp:
        (sa?.weight ?? wa) != null && (sb?.weight ?? wb) != null
          ? ((sb?.weight ?? wb ?? 0) - (sa?.weight ?? wa ?? 0)) * 100
          : null,
      idealPosA: sa ? { raw: sa.maxRaw, holders: sa.idealPosHolders } : null,
      idealPosB: sb ? { raw: sb.maxRaw, holders: sb.idealPosHolders } : null,
      idealNegA: sa ? { raw: sa.minRaw, holders: sa.idealNegHolders } : null,
      idealNegB: sb ? { raw: sb.minRaw, holders: sb.idealNegHolders } : null,
      divisorA: sa?.divisor ?? null,
      divisorB: sb?.divisor ?? null,
      divisorRatio: sa && sb ? sb.divisor / sa.divisor : null,
    };
  });

  // ── Per-candidate breakdown (FR-CMP-08, FR-SN-06) ──
  const breakdowns = new Map<string, CandidateBreakdown>();
  for (const id of allIds) {
    const side = (rp: Replay | ReplayUnavailable) => {
      if (!rp.available) return null;
      const cells = rp.cells.get(id);
      const r = rp.byId.get(id);
      return cells && r ? { cells, dPlus: r.dPlus, dMinus: r.dMinus, closeness: r.closeness } : null;
    };
    const sa = side(replayA);
    const sb = side(replayB);
    const delta = new Map<CriterionKey, { raw: number; weighted: number; contribPlus: number; contribMinus: number }>();
    if (sa && sb) {
      for (const key of CRITERIA) {
        const x = sa.cells.get(key);
        const y = sb.cells.get(key);
        if (!x || !y) continue;
        delta.set(key, {
          raw: y.raw - x.raw,
          weighted: y.weighted - x.weighted,
          contribPlus: y.contribPlus - x.contribPlus,
          contribMinus: y.contribMinus - x.contribMinus,
        });
      }
    }
    const topMovers = [...delta.entries()]
      .map(([k, d]) => [k, Math.abs(d.contribPlus) + Math.abs(d.contribMinus)] as const)
      .sort((x, y) => y[1] - x[1] || CRITERIA.indexOf(x[0]) - CRITERIA.indexOf(y[0]))
      .filter(([, m]) => m > 0)
      .slice(0, 2)
      .map(([k]) => k);
    breakdowns.set(id, { candidateId: id, name: nameOf(id), a: sa, b: sb, delta, topMovers });
  }

  return {
    a,
    b,
    relation,
    relationText: relationSentence(relation),
    structured,
    unavailableReason,
    sources,
    freezeViolations,
    config,
    pairwiseCells,
    ranking,
    criteria,
    breakdowns,
    attribution: structured ? attribute(a, b) : null,
    reproducibility: { a: verifyRunReproducibility(a), b: verifyRunReproducibility(b) },
  };
}

// ── Configuration items side by side ────────────────────────────────────────


function configDiff(
  a: RunRecord,
  b: RunRecord,
  activeA: CriterionKey[] | null,
  activeB: CriterionKey[] | null,
): ConfigDiffItem[] {
  const items: ConfigDiffItem[] = [];
  const UNRECORDED = 'Tidak tersimpan';
  const push = (it: Omit<ConfigDiffItem, 'same' | 'recordedA' | 'recordedB'> & { same?: boolean }) =>
    items.push({
      ...it,
      same: it.same ?? it.a === it.b,
      recordedA: it.a !== UNRECORDED && it.originA !== 'not_recorded',
      recordedB: it.b !== UNRECORDED && it.originB !== 'not_recorded',
    });
  const ca = a.config;
  const cb = b.config;
  const sumW = (w: Record<CriterionKey, number> | null) => (w ? CRITERIA.reduce((s, k) => s + w[k], 0) : 0);
  for (const key of CRITERIA) {
    const wa = ca.weights ? ca.weights[key] / (sumW(ca.weights) || 1) : null;
    const wb = cb.weights ? cb.weights[key] / (sumW(cb.weights) || 1) : null;
    push({
      key: `weight.${key}`,
      group: 'Pembobotan',
      label: `Bobot nominal ${CRITERION_LABEL[key]}`,
      a: wa == null ? 'Tidak tersimpan' : fmtWeight(wa),
      b: wb == null ? 'Tidak tersimpan' : fmtWeight(wb),
      same: wa != null && wb != null ? Math.abs(wa - wb) <= 1e-12 : wa === wb,
      delta: wa != null && wb != null ? (wb - wa) * 100 : null,
      originA: ca.weightsOrigin,
      originB: cb.weightsOrigin,
    });
  }
  // A child's source reads "inherited" over the very vector its parent used, so
  // the item is "Sama" whenever the vectors are: the label is the origin, not a
  // second value.
  const sourceLabel = (x: string | null) => (x == null ? 'Tidak tersimpan' : WEIGHT_SOURCE_LABEL[x] ?? x);
  push({
    key: 'weight.source',
    group: 'Pembobotan',
    label: 'Sumber bobot',
    a: sourceLabel(ca.weightSource),
    b: sourceLabel(cb.weightSource),
    delta: null,
    originA: ca.weightsOrigin,
    originB: cb.weightsOrigin,
    same: ca.weights != null && cb.weights != null ? sameWeights(ca.weights, cb.weights) : ca.weightSource === cb.weightSource,
  });
  push({
    key: 'weight.cr',
    group: 'Pembobotan',
    label: 'Rasio konsistensi (CR)',
    a: ca.consistency ? fmtNumber(ca.consistency.cr, 4) : 'Tidak tersimpan',
    b: cb.consistency ? fmtNumber(cb.consistency.cr, 4) : 'Tidak tersimpan',
    delta: ca.consistency && cb.consistency ? cb.consistency.cr - ca.consistency.cr : null,
    originA: ca.weightsOrigin,
    originB: cb.weightsOrigin,
  });
  push({
    key: 'criteria.active',
    group: 'Kriteria aktif',
    label: 'Kriteria aktif',
    a: activeA ? activeA.map((k) => CRITERION_LABEL[k]).join(', ') : 'Tidak tersimpan',
    b: activeB ? activeB.map((k) => CRITERION_LABEL[k]).join(', ') : 'Tidak tersimpan',
    same: sameList(activeA, activeB),
    delta: null,
    originA: ca.criteriaOrigin,
    originB: cb.criteriaOrigin,
  });
  push({
    key: 'filter.rules',
    group: 'Aturan penyaringan',
    label: 'Aturan filter',
    a: ca.filter.ruleLabels.length ? ca.filter.ruleLabels.join('; ') : 'Tidak tersimpan',
    b: cb.filter.ruleLabels.length ? cb.filter.ruleLabels.join('; ') : 'Tidak tersimpan',
    same: (ca.filter.treeKey ?? '') === (cb.filter.treeKey ?? ''),
    delta: null,
    originA: ca.filter.origin,
    originB: cb.filter.origin,
  });
  const grade = (g: { min: number | string | null; max: number | string | null }) =>
    g.min == null && g.max == null ? UNRECORDED : `${g.min ?? '…'}–${g.max ?? '…'}`;
  push({
    key: 'filter.grade',
    group: 'Aturan penyaringan',
    label: 'Rentang grade',
    a: grade(ca.gradeRange),
    b: grade(cb.gradeRange),
    delta: null,
    originA: ca.filter.origin,
    originB: cb.filter.origin,
  });
  push({
    key: 'present.readiness',
    group: 'Penyajian',
    label: 'Ambang readiness',
    a: ca.readiness ? ca.readiness.thresholds.map((t) => `${t.level} ≥ ${t.minScore}`).join('; ') : 'Tidak tersimpan',
    b: cb.readiness ? cb.readiness.thresholds.map((t) => `${t.level} ≥ ${t.minScore}`).join('; ') : 'Tidak tersimpan',
    same: readinessKey(ca.readiness) === readinessKey(cb.readiness),
    delta: null,
    originA: ca.readinessOrigin,
    originB: cb.readinessOrigin,
  });
  push({
    key: 'present.finalists',
    group: 'Penyajian',
    label: 'Jumlah finalis (N)',
    a: ca.finalistCount == null ? 'Tidak tersimpan' : String(ca.finalistCount),
    b: cb.finalistCount == null ? 'Tidak tersimpan' : String(cb.finalistCount),
    delta: ca.finalistCount != null && cb.finalistCount != null ? cb.finalistCount - ca.finalistCount : null,
    originA: ca.readinessOrigin,
    originB: cb.readinessOrigin,
  });
  const anchor = (x: { simFloor: number; simCeil: number } | null) =>
    x ? `L ${fmtNumber(x.simFloor, 4)} · U ${fmtNumber(x.simCeil, 4)}` : 'Tidak tersimpan';
  push({
    key: 'anchor.technical',
    group: 'Parameter & jangkar',
    label: 'Jangkar Kompetensi Teknis',
    a: anchor(ca.anchors.technical),
    b: anchor(cb.anchors.technical),
    delta: null,
    originA: ca.anchors.origin,
    originB: cb.anchors.origin,
  });
  push({
    key: 'anchor.career',
    group: 'Parameter & jangkar',
    label: 'Jangkar Relevansi Karier',
    a: anchor(ca.anchors.career),
    b: anchor(cb.anchors.career),
    delta: null,
    originA: ca.anchors.origin,
    originB: cb.anchors.origin,
  });
  const depth = (x: { targetYears: number; targetRows: number } | null) =>
    x ? `T_tahun ${fmtNumber(x.targetYears, 2)} · T_stint ${fmtNumber(x.targetRows, 2)}` : 'Tidak tersimpan';
  push({
    key: 'anchor.depth',
    group: 'Parameter & jangkar',
    label: 'Target kedalaman karier',
    a: depth(ca.anchors.depth),
    b: depth(cb.anchors.depth),
    delta: null,
    originA: ca.anchors.origin,
    originB: cb.anchors.origin,
  });
  push({
    key: 'anchor.referenceDate',
    group: 'Parameter & jangkar',
    label: 'Tanggal acuan peluruhan (Pers. 2.5)',
    a: ca.referenceDate ? formatDateTime(ca.referenceDate) : 'Tidak tersimpan',
    b: cb.referenceDate ? formatDateTime(cb.referenceDate) : 'Tidak tersimpan',
    delta: null,
    originA: ca.referenceDateOrigin,
    originB: cb.referenceDateOrigin,
  });
  const basis = (x: RunConfigView['positionBasis']) =>
    x
      ? `${x.jobProfileName ?? 'tanpa job profile'} · ${x.requiredCount} acuan kompetensi (${x.requiredSource ? REQUIRED_SOURCE_LABEL[x.requiredSource] ?? x.requiredSource : '-'}) · pendidikan: ${
          x.educationSource === 'incumbent' ? 'dari pejabat (tidak ditampilkan)' : x.educationRequirement ?? '-'
        }`
      : 'Tidak tersimpan';
  push({
    key: 'basis',
    group: 'Basis posisi',
    label: 'Basis posisi (job profile, acuan, pendidikan)',
    a: basis(ca.positionBasis),
    b: basis(cb.positionBasis),
    same: JSON.stringify(ca.positionBasis && { ...ca.positionBasis, origin: null }) ===
      JSON.stringify(cb.positionBasis && { ...cb.positionBasis, origin: null }),
    delta: null,
    originA: ca.positionBasis?.origin ?? 'not_recorded',
    originB: cb.positionBasis?.origin ?? 'not_recorded',
  });
  const model = (m: RunModelsRecord | null) =>
    m
      ? `embedding ${m.embedding.documentModel ?? m.embedding.model} · pendidikan ${m.education.model ?? '-'} · narasi ${m.narrative.enabled ? m.narrative.model ?? '-' : 'nonaktif'}`
      : 'Tidak tersimpan';
  push({
    key: 'models',
    group: 'Model',
    label: 'Model yang dipakai',
    a: model(ca.models),
    b: model(cb.models),
    delta: null,
    originA: ca.models ? 'root_snapshot' : 'not_recorded',
    originB: cb.models ? 'root_snapshot' : 'not_recorded',
  });
  const versions = (v: RunConfigView['dataVersions']) =>
    v
      ? `korpus JD ${v.jobProfileCorpus.documents} dok (${(v.jobProfileCorpus.fingerprint ?? '-').slice(0, 8)}) · kamus ${(v.kamus.fingerprint ?? '-').slice(0, 8)}`
      : 'Tidak tersimpan';
  push({
    key: 'dataVersions',
    group: 'Versi data',
    label: 'Versi data',
    a: versions(ca.dataVersions),
    b: versions(cb.dataVersions),
    delta: null,
    originA: ca.dataVersions ? 'root_snapshot' : 'not_recorded',
    originB: cb.dataVersions ? 'root_snapshot' : 'not_recorded',
  });
  return items;
}

// ── Stepwise attribution (FR-CMP-10) ────────────────────────────────────────

/**
 * A → B in a FIXED order, one source at a time, each step re-ranked with the
 * engine's own function:
 *   0. A as stored inputs give it;
 *   1. B's weights and active criteria;
 *   2. B's aspect values for the candidates both runs scored;
 *   3. B's pool membership (B's candidates, with B's aspects) — this is B.
 * The result depends on that order; the order is fixed and stated. There is no
 * post-TOPSIS step.
 */
export function attribute(a: RunRecord, b: RunRecord): AttributionStep[] | null {
  const ra = replayRun(a);
  const rb = replayRun(b);
  if (!ra.available || !rb.available || !a.config.weights || !b.config.weights) return null;
  const poolA = new Map(a.pool.map((c) => [c.candidateId, c]));
  const poolB = new Map(b.pool.map((c) => [c.candidateId, c]));
  const stepOf = (
    key: AttributionStep['key'],
    label: string,
    pool: { candidateId: string; aspects: Record<CriterionKey, number> }[],
    weights: Record<CriterionKey, number>,
    active: CriterionKey[],
  ): AttributionStep => {
    const r = rankPool(pool, weights, active);
    const byIdMap = new Map<string, { closeness: number; rank: number }>();
    for (const [id, v] of r.byId) byIdMap.set(id, { closeness: v.closeness, rank: v.rank });
    return { key, label, byId: byIdMap };
  };
  const aPool = a.pool.map((c) => ({ candidateId: c.candidateId, aspects: c.aspects }));
  const aPoolWithB = a.pool.map((c) => ({
    candidateId: c.candidateId,
    aspects: poolB.get(c.candidateId)?.aspects ?? c.aspects,
  }));
  const bPool = b.pool.map((c) => ({ candidateId: c.candidateId, aspects: c.aspects }));
  return [
    stepOf('A', 'A (dari data tersimpan)', aPool, a.config.weights, ra.activeCriteria),
    stepOf('weights', 'Bobot dan kriteria aktif B', aPool, b.config.weights, rb.activeCriteria),
    stepOf('aspects', 'Nilai aspek B (kandidat yang ada di keduanya)', aPoolWithB, b.config.weights, rb.activeCriteria),
    stepOf('pool', 'Keanggotaan pool B', bPool, b.config.weights, rb.activeCriteria),
  ];
}

export const ATTRIBUTION_NOTE =
  'Atribusi dihitung bertahap dengan urutan tetap: bobot dan kriteria aktif → nilai aspek → keanggotaan pool. Besar pengaruh tiap langkah bergantung pada urutan ini; urutannya tidak berubah antarperbandingan.';
