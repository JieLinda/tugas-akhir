// TC-TEC — the technical aspect: two-stage competency matching (identity first,
// then Hungarian over embedding similarity), the level term, and the saturated
// 0..1 aggregate. A stub vector store stands in for kamus_kompetensi_level_embed
// so every cosine in these cases is known exactly.
//
//   node --import tsx --test test/technical-matching.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { matchCompetencySets, type CompetencyRef } from "../src/ahp-topsis-engine.js";
import {
  LEVEL_FACTOR_CEILING,
  competencyLevelFactor,
  rescaleTechnicalSimilarity,
} from "../src/competency-level.js";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const ANCHORS = { simFloor: 0.5, simCeil: 0.9 };

/** 2-D unit vector at angle whose cosine to [1,0] is `c`. */
const unit = (c: number) => [c, Math.sqrt(Math.max(0, 1 - c * c))];

/**
 * A vector store where every level of a code shares one direction. `dir` maps a
 * kamus code to the cosine its vector has against the reference axis [1, 0].
 */
function store(dir: Record<string, number>, anchors = ANCHORS) {
  return {
    anchors: { ...anchors, source: "test" } as any,
    ensure: async () => {},
    get: (key: string) => {
      const code = key.split(":")[0]!;
      return code in dir ? unit(dir[code]!) : undefined;
    },
  };
}

const norm = (s: string) =>
  s.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const ref = (name: string, level: number, code: string | null = null, levelKnown = true): CompetencyRef => ({
  name, level, code, norm: norm(name), levelKnown,
});

describe("TC-TEC-LVL  level factor and similarity rescale", () => {
  test("TC-TEC-LVL-01 the full 1..4 ladder (identity / similarity)", () => {
    const identity = [
      [1.0, 1.25, 1.5, 1.75],
      [0.75, 1.0, 1.25, 1.5],
      [0.5, 0.75, 1.0, 1.25],
      [0.25, 0.5, 0.75, 1.0],
    ];
    for (let r = 1; r <= 4; r++)
      for (let c = 1; c <= 4; c++) {
        close(competencyLevelFactor(c, r, true, true), identity[r - 1]![c - 1]!);
        close(competencyLevelFactor(c, r, false, true), Math.min(1, identity[r - 1]![c - 1]!));
      }
    assert.equal(LEVEL_FACTOR_CEILING, 1.75);
  });

  test("TC-TEC-LVL-02 an unreadable candidate level is NEUTRAL (1), not a shortfall", () => {
    assert.equal(competencyLevelFactor(1, 4, true, false), 1);
    assert.equal(competencyLevelFactor(1, 4, false, false), 1);
  });

  test("TC-TEC-LVL-03 similarity rescale onto the corpus anchors", () => {
    assert.equal(rescaleTechnicalSimilarity(0.4, ANCHORS), 0);
    close(rescaleTechnicalSimilarity(0.7, ANCHORS), 0.5);
    assert.equal(rescaleTechnicalSimilarity(0.95, ANCHORS), 1);
    // Degenerate anchors fall back to the clamped raw value, never to zero.
    assert.equal(rescaleTechnicalSimilarity(0.7, { simFloor: 0.9, simCeil: 0.9 }), 0.7);
  });
});

describe("TC-TEC-MATCH  matchCompetencySets", () => {
  test("TC-TEC-01 exact identity at the required level → 1.0", () => {
    const m = matchCompetencySets([ref("Budgeting", 3, "K1")], [ref("Budgeting", 3, "K1")], store({}));
    assert.equal(m.pairs[0]!.matchType, "exact");
    assert.equal(m.normalized, 1);
    assert.equal(m.identityPairs, 1);
  });

  test("TC-TEC-02 two spellings resolved to one kamus code are identity ('code')", () => {
    const m = matchCompetencySets(
      [ref("BUSINESS PROCESS ANALYSIS", 2, "K7")],
      [ref("Business Process Analyst", 2, "K7")],
      store({})
    );
    assert.equal(m.pairs[0]!.matchType, "code");
    assert.equal(m.normalized, 1);
  });

  test("TC-TEC-03 identity without any code still matches by normalised name", () => {
    const m = matchCompetencySets([ref("SHE Management", 2)], [ref("she  management", 2)], store({}));
    assert.equal(m.pairs[0]!.matchType, "exact");
    assert.equal(m.effectiveRequiredCount, 1);
  });

  test("TC-TEC-04 under-qualified identity earns partial credit (1 vs 4 → 0.25)", () => {
    const m = matchCompetencySets([ref("Audit", 1, "A")], [ref("Audit", 4, "A")], store({}));
    close(m.normalized, 0.25);
  });

  test("TC-TEC-05 over-qualification SATURATES the aggregate at 1; raw mean reports 1.75", () => {
    const m = matchCompetencySets([ref("Audit", 4, "A")], [ref("Audit", 1, "A")], store({}));
    assert.equal(m.normalized, 1);
    close(m.normalizedRaw, 1.75);
    close(m.pairs[0]!.value, 1.75, 1e-12);
  });

  test("TC-TEC-06 the surplus is COMPENSATORY: it offsets a missing competency", () => {
    const m = matchCompetencySets(
      [ref("Audit", 4, "A")],
      [ref("Audit", 1, "A"), ref("Tax", 2, "T")],
      store({ A: 1, T: 0 })
    );
    close(m.normalized, (1.75 + 0) / 2);
  });

  test("TC-TEC-07 an UNMEASURABLE requirement (no code, nobody holds it) leaves the divisor", () => {
    const m = matchCompetencySets(
      [ref("Budgeting", 2, "K1")],
      [ref("Budgeting", 2, "K1"), ref("Leadership", 3)],
      store({})
    );
    assert.equal(m.requiredCount, 2);
    assert.equal(m.effectiveRequiredCount, 1);
    assert.equal(m.unmeasurableCount, 1);
    assert.equal(m.pairs[1]!.matchType, "unmeasurable");
    assert.equal(m.normalized, 1, "not halved by the dictionary's gap");
  });

  test("TC-TEC-08 a semantic pair is credited sim′ × levelFactor, capped at 1 per cell", () => {
    // cos(X, Y) = 0.7 → sim′ = (0.7 − 0.5) / 0.4 = 0.5. Candidate is over-levelled,
    // but a SIMILARITY pair earns no surplus.
    const m = matchCompetencySets(
      [ref("Data Mining", 4, "X")],
      [ref("Data Analysis", 2, "Y")],
      store({ X: 1, Y: 0.7 })
    );
    const p = m.pairs[0]!;
    assert.equal(p.matchType, "semantic");
    close(p.similarity!, 0.5, 1e-9);
    assert.equal(p.levelFactor, 1);
    close(m.normalized, 0.5, 1e-9);
  });

  test("TC-TEC-09 identity is settled BEFORE Hungarian and cannot be traded away", () => {
    // Documented trap: the under-levelled identity cell A→A is worth only 0.25,
    // while A_cand→B_req is worth 0.6 (cos 0.74 → sim′ 0.6). A sum-maximiser
    // over the whole matrix is free to trade the identity away; stage 1 is not.
    const m = matchCompetencySets(
      [ref("Alpha", 1, "A"), ref("Zeta", 2, "Z")],
      [ref("Alpha", 4, "A"), ref("Beta", 2, "B")],
      store({ A: 1, B: 0.74, Z: 0.62 })
    );
    const alpha = m.pairs.find((p) => p.required.name === "Alpha")!;
    assert.equal(alpha.candidate?.name, "Alpha");
    assert.equal(alpha.matchType, "exact");
  });

  test("TC-TEC-10 duplicate held competencies: the higher level is used", () => {
    const m = matchCompetencySets(
      [ref("Audit", 1, "A"), ref("Audit", 4, "A")],
      [ref("Audit", 4, "A")],
      store({})
    );
    assert.equal(m.pairs[0]!.candidate?.level, 4);
    assert.equal(m.normalized, 1);
  });

  test("TC-TEC-11 a required competency listed twice cannot reuse one held competency", () => {
    const m = matchCompetencySets(
      [ref("Audit", 3, "A")],
      [ref("Audit", 3, "A"), ref("Audit", 3, "A")],
      store({})
    );
    const used = m.pairs.filter((p) => p.candidate !== null);
    assert.equal(used.length, 1);
    close(m.normalized, 0.5);
  });

  test("TC-TEC-12 unreadable candidate level is counted and left neutral", () => {
    const m = matchCompetencySets([ref("Audit", 1, "A", false)], [ref("Audit", 4, "A")], store({}));
    assert.equal(m.levelUnknownPairs, 1);
    assert.equal(m.normalized, 1);
  });

  test("TC-TEC-13 IDF weights change the MEAN only, never which competency pairs with which", () => {
    const held = [ref("Common", 2, "C"), ref("Rare", 1, "R")];
    const req = [ref("Common", 2, "C"), ref("Rare", 4, "R")];
    const plain = matchCompetencySets(held, req, store({}));
    const idf = matchCompetencySets(held, req, store({}), (r) => (r.code === "R" ? 3 : 0.1));
    assert.deepEqual(
      plain.pairs.map((p) => p.candidate?.name),
      idf.pairs.map((p) => p.candidate?.name)
    );
    close(plain.normalized, (1 + 0.25) / 2);
    close(idf.normalized, (0.1 * 1 + 3 * 0.25) / 3.1);
    assert.equal(idf.idfWeighted, true);
    assert.equal(plain.idfWeighted, false);
  });

  test("TC-TEC-14 empty inputs never produce NaN", () => {
    const noHeld = matchCompetencySets([], [ref("Audit", 2, "A")], store({}));
    assert.equal(noHeld.normalized, 0);
    assert.equal(noHeld.pairs[0]!.matchType, "unmatched");
    const noReq = matchCompetencySets([ref("Audit", 2, "A")], [], store({}));
    assert.equal(noReq.normalized, 0);
    assert.equal(noReq.surplusCandidates.length, 1);
  });

  test("TC-TEC-15 surplus held competencies are reported, not scored", () => {
    const m = matchCompetencySets(
      [ref("Audit", 3, "A"), ref("Coaching", 3), ref("Driving", 2)],
      [ref("Audit", 3, "A")],
      store({})
    );
    assert.equal(m.normalized, 1);
    assert.deepEqual(m.surplusCandidates.map((s) => s.name).sort(), ["Coaching", "Driving"]);
  });

  test("TC-TEC-16 aggregate is a true 0..1 for random inputs (bound property)", () => {
    let seed = 99;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const codes = ["A", "B", "C", "D", "E"];
    const dir = Object.fromEntries(codes.map((c) => [c, rand()]));
    for (let t = 0; t < 300; t++) {
      const mk = () =>
        Array.from({ length: Math.floor(rand() * 5) }, () => {
          const c = codes[Math.floor(rand() * codes.length)]!;
          return ref(`N${c}`, 1 + Math.floor(rand() * 4), rand() < 0.8 ? c : null);
        });
      const m = matchCompetencySets(mk(), mk(), store(dir));
      assert.ok(m.normalized >= 0 && m.normalized <= 1, `normalized ${m.normalized}`);
      assert.ok(m.normalizedRaw <= LEVEL_FACTOR_CEILING + 1e-9);
    }
  });

  test(
    "TC-TEC-17 a Hungarian assignment worth 0 is reported 'unmatched', not as a semantic pair",
    { todo: "DEFECT-02: zero-value assignments are labelled 'semantic' and swallow a surplus competency" },
    () => {
      // Neither side has a level vector, so every similarity cell is 0. Hungarian
      // still returns min(m, n) pairs, and the drill-down then claims a pairing.
      const m = matchCompetencySets([ref("Driving", 2, "Q")], [ref("Tax", 2, "T")], store({}));
      assert.equal(m.pairs[0]!.matchType, "unmatched");
      assert.equal(m.surplusCandidates.length, 1);
    }
  );
});
