// The comparison in a shape a server action can return (plain objects and
// arrays — no Map, no Set) and the page, the export and the tests can read.
// Pure and client-safe.

import type {
  AttributionStep,
  CandidateBreakdown,
  Replay,
  ReplayUnavailable,
  Comparison,
  ConfigDiffItem,
  CriterionKey,
  CriterionRow,
  Origin,
  RankingRow,
  Relation,
  ReproducibilityResult,
  RunConfigView,
  RunRecord,
  SourceVerdict,
  Cell,
} from './run-compare';
import type { Explanation } from './run-compare-explain';

export type RunHeaderDto = {
  id: string;
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
  lineage: string[];
  poolSize: number;
  poolSource: RunRecord['poolSource'];
  config: RunConfigView;
};

export type BreakdownSideDto = {
  cells: Partial<Record<CriterionKey, Cell>>;
  dPlus: number;
  dMinus: number;
  closeness: number;
} | null;

export type CandidateBreakdownDto = {
  candidateId: string;
  name: string;
  a: BreakdownSideDto;
  b: BreakdownSideDto;
  delta: Partial<Record<CriterionKey, { raw: number; weighted: number; contribPlus: number; contribMinus: number }>>;
  topMovers: CriterionKey[];
};

export type AttributionStepDto = {
  key: AttributionStep['key'];
  label: string;
  rows: { candidateId: string; closeness: number; rank: number }[];
};

export type ComparisonDto = {
  a: RunHeaderDto;
  b: RunHeaderDto;
  relation: Relation;
  relationText: string;
  structured: boolean;
  unavailableReason: string | null;
  sources: SourceVerdict[];
  freezeViolations: SourceVerdict[];
  config: ConfigDiffItem[];
  pairwiseCells: Comparison['pairwiseCells'];
  ranking: RankingRow[];
  criteria: CriterionRow[];
  breakdowns: CandidateBreakdownDto[];
  attribution: AttributionStepDto[] | null;
  reproducibility: { a: ReproducibilityResult; b: ReproducibilityResult };
  explanations: { summary: Explanation[]; perCandidate: Record<string, Explanation[]> };
};

export type { Origin };

function header(r: RunRecord): RunHeaderDto {
  return {
    id: r.id,
    label: r.label,
    method: r.method,
    status: r.status,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    createdByName: r.createdByName,
    parentRunId: r.parentRunId,
    rerunMode: r.rerunMode,
    rerunReason: r.rerunReason,
    legacy: r.legacy,
    modeLabel: r.modeLabel,
    lineage: r.lineage,
    poolSize: r.pool.length,
    poolSource: r.poolSource,
    config: r.config,
  };
}

function side(s: CandidateBreakdown['a']): BreakdownSideDto {
  return s
    ? { cells: Object.fromEntries(s.cells), dPlus: s.dPlus, dMinus: s.dMinus, closeness: s.closeness }
    : null;
}

export function toComparisonDto(
  c: Comparison,
  explanations: { summary: Explanation[]; perCandidate: Map<string, Explanation[]> },
): ComparisonDto {
  return {
    a: header(c.a),
    b: header(c.b),
    relation: c.relation,
    relationText: c.relationText,
    structured: c.structured,
    unavailableReason: c.unavailableReason,
    sources: c.sources,
    freezeViolations: c.freezeViolations,
    config: c.config,
    pairwiseCells: c.pairwiseCells,
    ranking: c.ranking,
    criteria: c.criteria,
    breakdowns: [...c.breakdowns.values()].map((b) => ({
      candidateId: b.candidateId,
      name: b.name,
      a: side(b.a),
      b: side(b.b),
      delta: Object.fromEntries(b.delta),
      topMovers: b.topMovers,
    })),
    attribution: c.attribution
      ? c.attribution.map((s) => ({
          key: s.key,
          label: s.label,
          rows: [...s.byId].map(([candidateId, v]) => ({ candidateId, ...v })),
        }))
      : null,
    reproducibility: c.reproducibility,
    explanations: {
      summary: explanations.summary,
      perCandidate: Object.fromEntries(explanations.perCandidate),
    },
  };
}

// ── One run's TOPSIS, per candidate (FR-SN-06) ─────────────────────────────

export type RunBreakdownDto =
  | {
      available: true;
      runId: string;
      activeCriteria: CriterionKey[];
      criteria: {
        key: CriterionKey;
        weight: number;
        divisor: number;
        idealPos: number;
        idealNeg: number;
        maxRaw: number;
        minRaw: number;
      }[];
      candidates: {
        candidateId: string;
        name: string;
        rank: number;
        closeness: number;
        dPlus: number;
        dMinus: number;
        cells: Partial<Record<CriterionKey, Cell>>;
      }[];
    }
  | { available: false; runId: string; reason: string };

/** A run replayed from its stored data, flattened for the page. */
export function toRunBreakdownDto(run: RunRecord, replay: Replay | ReplayUnavailable): RunBreakdownDto {
  if (!replay.available) return { available: false, runId: run.id, reason: replay.reason };
  const names = new Map(run.pool.map((c) => [c.candidateId, c.name]));
  return {
    available: true,
    runId: run.id,
    activeCriteria: replay.activeCriteria,
    criteria: [...replay.criteria.values()].map((c) => ({
      key: c.key,
      weight: c.weight,
      divisor: c.divisor,
      idealPos: c.idealPos,
      idealNeg: c.idealNeg,
      maxRaw: c.maxRaw,
      minRaw: c.minRaw,
    })),
    candidates: [...replay.byId.entries()]
      .sort((x, y) => x[1].rank - y[1].rank)
      .map(([id, r]) => ({
        candidateId: id,
        name: names.get(id) ?? 'Kandidat',
        rank: r.rank,
        closeness: r.closeness,
        dPlus: r.dPlus,
        dMinus: r.dMinus,
        cells: Object.fromEntries(replay.cells.get(id) ?? new Map()),
      })),
  };
}

