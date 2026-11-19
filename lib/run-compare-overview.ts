// The numbers on the "Ringkasan" tiles of the run comparison, read straight
// off the ComparisonDto the detail tables use — nothing is recomputed, so a
// tile can never disagree with the table it summarises. Pure and client-safe
// (tests/scoring/run-compare.test.ts, TC-CMP-OVERVIEW).

import type { ComparisonDto } from './run-compare-dto';

export type OverviewFacts = {
  topA: string | null;
  topB: string | null;
  poolA: number;
  poolB: number;
  comparison: number;
  comparisonInTopN: number;
  moved: number;
  movedFinalists: number;
  /** Finalist in B and not in A — a comparison candidate who went straight in counts. */
  entered: number;
  enteredComparison: number;
  /** Finalist in A and not in B. */
  left: number;
  nA: number;
  nB: number;
  differing: { key: string; label: string }[];
};

/** The tiles' numbers. */
export function overviewFacts(dto: ComparisonDto): OverviewFacts {
  const r = dto.ranking;
  const top = (side: 'rankA' | 'rankB') => r.find((x) => x[side] === 1)?.name ?? null;
  const both = r.filter((x) => x.membership === 'both');
  const moved = both.filter((x) => (x.deltaRank ?? 0) !== 0);
  return {
    topA: top('rankA'),
    topB: top('rankB'),
    poolA: dto.a.poolSize,
    poolB: dto.b.poolSize,
    comparison: r.filter((x) => x.markers.comparison).length,
    comparisonInTopN: r.filter((x) => x.markers.comparison && x.finalistB).length,
    moved: moved.length,
    movedFinalists: moved.filter((x) => x.finalistA || x.finalistB).length,
    entered: r.filter((x) => x.finalistB === true && x.finalistA !== true).length,
    enteredComparison: r.filter((x) => x.finalistB === true && x.finalistA !== true && x.markers.comparison).length,
    left: r.filter((x) => x.finalistA === true && x.finalistB !== true).length,
    nA: r.filter((x) => x.finalistA).length,
    nB: r.filter((x) => x.finalistB).length,
    differing: dto.sources.filter((s) => s.differs).map((s) => ({ key: s.key, label: s.label })),
  };
}
