// TC-RNK — the final AHP + TOPSIS ranking step (rankCandidatesByTopsis, the same
// function runAhpTopsisSession calls) and TC-E2E — whole-pipeline scenarios that
// start from raw HR values, run them through the real aspect scorers, weight them
// with the real AHP defaults and rank them.
//
//   node --import tsx --test test/ranking-scenarios.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  rankCandidatesByTopsis,
  scoreBehaviorAspect,
  type AhpCriterionKey,
} from "../src/ahp-topsis-engine.js";
import { scorePerformanceAspect } from "../src/pa-score.js";
import { computeHavScore, determineReadiness } from "../src/scoring-engine.js";
import { resolveAhpWeights } from "../src/ahp-weights.js";
import { pairwiseFromWeights } from "../src/ahp.js";

type Aspects = Record<AhpCriterionKey, number>;
const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

async function defaultWeights() {
  return (await resolveAhpWeights(null)).weights;
}

function rank(pool: Record<string, Aspects>, weights: Aspects, dropped: AhpCriterionKey[] = []) {
  const ids = Object.keys(pool);
  return rankCandidatesByTopsis(
    ids.map((id) => ({ id })),
    new Map(ids.map((id) => [id, pool[id]!])),
    weights,
    new Set(dropped)
  );
}
const order = (r: ReturnType<typeof rank>) => r.rankedAll.map((e) => e.candidate.id);
const A = (t: number, c: number, b: number, p: number, h: number, e: number): Aspects => ({
  technical: t, career: c, behavior: b, performance: p, hav: h, education: e,
});

describe("TC-RNK  rankCandidatesByTopsis", () => {
  test("TC-RNK-01 a candidate best on every aspect ranks first, worst on every aspect last", async () => {
    const r = rank({ mid: A(60, 60, 60, 60, 60, 60), top: A(90, 90, 90, 90, 90, 90), low: A(20, 20, 20, 20, 20, 20) }, await defaultWeights());
    assert.deepEqual(order(r), ["top", "mid", "low"]);
    close(r.rankedAll[0]!.closeness, 1);
    close(r.rankedAll[2]!.closeness, 0);
  });

  test("TC-RNK-02 exact ties break by candidate id — deterministic, whatever the input order", async () => {
    const w = await defaultWeights();
    const same = A(70, 50, 83, 67, 80, 90);
    const pools = [
      { zed: same, amy: same, kim: A(10, 10, 10, 10, 10, 10) },
      { kim: A(10, 10, 10, 10, 10, 10), amy: same, zed: same },
    ];
    for (const p of pools) assert.deepEqual(order(rank(p, w)), ["amy", "zed", "kim"]);
  });

  test("TC-RNK-03 a dropped criterion leaves the matrix and the rest are renormalised to 1", async () => {
    const r = rank({ a: A(80, 0, 50, 50, 60, 70), b: A(40, 0, 60, 60, 60, 70) }, await defaultWeights(), ["career"]);
    assert.ok(!r.activeCriteria.includes("career"));
    assert.equal(r.effectiveWeights.career, 0);
    close(Object.values(r.effectiveWeights).reduce((a, b) => a + b, 0), 1, 1e-5);
    close(r.effectiveWeights.behavior, 0.35 / 0.95, 1e-6);
  });

  test("TC-RNK-04 dropping EVERY criterion falls back to the full set (never ranks on nothing)", async () => {
    const all: AhpCriterionKey[] = ["technical", "career", "behavior", "performance", "hav", "education"];
    const r = rank({ a: A(1, 1, 1, 1, 1, 1), b: A(2, 2, 2, 2, 2, 2) }, await defaultWeights(), all);
    assert.equal(r.activeCriteria.length, 6);
  });

  test("TC-RNK-05 all-zero weights → equal shares instead of NaN", () => {
    const zero = A(0, 0, 0, 0, 0, 0);
    const r = rank({ a: A(90, 10, 10, 10, 10, 10), b: A(10, 10, 10, 10, 10, 90) }, zero);
    for (const k of r.activeCriteria) close(r.effectiveWeights[k], 1 / 6, 1e-6);
    assert.ok(r.rankedAll.every((e) => Number.isFinite(e.closeness)));
  });

  test("TC-RNK-06 the weights decide trade-offs: behavior (35%) outweighs education (5%)", async () => {
    const r = rank(
      { behaviorStar: A(50, 50, 100, 50, 50, 0), educationStar: A(50, 50, 0, 50, 50, 100) },
      await defaultWeights()
    );
    assert.deepEqual(order(r), ["behaviorStar", "educationStar"]);
  });

  test("TC-RNK-07 an edited matrix that favours education flips that same trade-off", async () => {
    const eduHeavy = (await resolveAhpWeights(null, pairwiseFromWeights([10, 5, 10, 10, 10, 55]))).weights;
    const r = rank({ behaviorStar: A(50, 50, 100, 50, 50, 0), educationStar: A(50, 50, 0, 50, 50, 100) }, eduHeavy);
    assert.deepEqual(order(r), ["educationStar", "behaviorStar"]);
  });

  test("TC-RNK-08 EXCLUSION re-rank: removing one alternative keeps every other id and re-numbers", async () => {
    const w = await defaultWeights();
    const pool = {
      p1: A(90, 80, 83, 67, 80, 90), p2: A(70, 60, 100, 51, 60, 80),
      p3: A(85, 40, 67, 100, 100, 50), p4: A(40, 30, 50, 33, 40, 60),
    };
    const base = order(rank(pool, w));
    const { p1: _gone, ...rest } = pool;
    const after = order(rank(rest, w));
    assert.equal(after.length, 3);
    assert.deepEqual([...after].sort(), base.filter((id) => id !== "p1").sort());
  });

  test("TC-RNK-09 closeness is reproducible bit-for-bit across runs of the same inputs", async () => {
    const w = await defaultWeights();
    const pool = { a: A(81, 44, 83, 51, 80, 90), b: A(66, 70, 67, 67, 60, 80), c: A(90, 20, 50, 100, 100, 70) };
    const r1 = rank(pool, w).rankedAll.map((e) => e.closeness);
    const r2 = rank(pool, w).rankedAll.map((e) => e.closeness);
    assert.deepEqual(r1, r2);
  });
});

describe("TC-E2E  raw HR record → aspects → AHP + TOPSIS → readiness", () => {
  type Raw = { pa: string | null; behavior: string | null; hav: string | null; technical: number; career: number; education: number };
  const toAspects = (r: Raw): Aspects => ({
    technical: r.technical,
    career: r.career,
    behavior: scoreBehaviorAspect(r.behavior),
    performance: scorePerformanceAspect(r.pa),
    hav: computeHavScore(r.hav),
    education: r.education,
  });

  const personas: Record<string, Raw> = {
    star:       { pa: "A,A,A,A,A,A", behavior: "VERY HIGH",   hav: "1",  technical: 95, career: 90, education: 100 },
    solid:      { pa: "B,B,B,B,B,B", behavior: "HIGH",        hav: "5",  technical: 75, career: 60, education: 80 },
    improving:  { pa: "A,B,C,C,C,C", behavior: "MIDDLE HIGH", hav: "3",  technical: 70, career: 55, education: 80 },
    declining:  { pa: "C,C,C,B,A,A", behavior: "MIDDLE HIGH", hav: "3",  technical: 70, career: 55, education: 80 },
    noData:     { pa: null,          behavior: null,          hav: null, technical: 0,  career: 0,  education: 0 },
    deadwood:   { pa: "D,D,D,D,D,D", behavior: "NOT READY",   hav: "16", technical: 30, career: 20, education: 50 },
  };

  test("TC-E2E-01 personas land in the intuitive order under the default weights", async () => {
    const pool = Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, toAspects(v)]));
    const ids = order(rank(pool, await defaultWeights()));
    assert.equal(ids[0], "star");
    assert.equal(ids[1], "solid");
    assert.ok(ids.indexOf("improving") < ids.indexOf("declining"), "recent improvement outranks recent decline");
    assert.deepEqual(ids.slice(-2).sort(), ["deadwood", "noData"]);
  });

  test("TC-E2E-02 missing data scores the documented neutral values, not zero everywhere", () => {
    const a = toAspects(personas.noData!);
    assert.equal(a.performance, 33);
    assert.equal(a.hav, 40);
    assert.equal(a.behavior, 0);
  });

  test("TC-E2E-03 readiness follows the closeness × 100 bands", async () => {
    const pool = Object.fromEntries(Object.entries(personas).map(([k, v]) => [k, toAspects(v)]));
    const r = rank(pool, await defaultWeights()).rankedAll;
    assert.equal(determineReadiness(Math.round(r[0]!.closeness * 100)), "Short");
    assert.equal(determineReadiness(Math.round(r[r.length - 1]!.closeness * 100)), "Not Ready");
  });

  test("TC-E2E-04 adding a candidate to the pool can move untouched candidates' closeness", async () => {
    const w = await defaultWeights();
    const pool = Object.fromEntries(
      ["solid", "improving", "declining"].map((k) => [k, toAspects(personas[k]!)])
    );
    const before = rank(pool, w).rankedAll.find((e) => e.candidate.id === "solid")!.closeness;
    const after = rank({ ...pool, star: toAspects(personas.star!) }, w).rankedAll.find((e) => e.candidate.id === "solid")!.closeness;
    assert.notEqual(before, after, "TOPSIS is set-relative: same person, different pool, different closeness");
  });
});
