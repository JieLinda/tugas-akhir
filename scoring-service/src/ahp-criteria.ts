// The six AHP+TOPSIS criteria, in the order of every stored pairwise matrix.
//
// Its own dependency-free module so the ranking step (topsis-ranking.ts) can be
// imported by the web app too — the run comparison replays rankings with the
// engine's own functions instead of a copy of them (I-7). ahp-weights.ts
// re-exports these, so every existing import keeps working.

export const AHP_CRITERIA_ORDER = [
  "technical",
  "career",
  "behavior",
  "performance",
  "hav",
  "education",
] as const;

export type AhpCriterionKey = (typeof AHP_CRITERIA_ORDER)[number];
