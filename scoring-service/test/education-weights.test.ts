// TC-EDU — education: the rule-based level ladder, the deterministic exact match
// that short-circuits the grounded model, and how the two axes combine.
// TC-WGT — weighting: the AHP defaults and matrix precedence (inherited >
// program > default).
//
//   node --import tsx --test test/education-weights.test.ts
//
// resolveAhpWeights is only called with a null program id or a pinned matrix,
// both of which return before any query — no database needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  compareEducationLevel,
  composeEducationScore,
  exactEducationMatch,
} from "../src/ahp-topsis-engine.js";
import {
  AHP_CRITERIA_ORDER,
  DEFAULT_WEIGHTS,
  resolveAhpWeights,
} from "../src/ahp-weights.js";
import { pairwiseFromWeights } from "../src/ahp.js";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

describe("TC-EDU-LVL  education level ladder (by rule, both paths)", () => {
  const cases: [string | null, string | null, "higher" | "equal" | "lower" | null, number | null][] = [
    ["S1", "Minimal S1", "equal", 80],
    ["S2 Manajemen", "Min S1", "higher", 100],
    ["D3 Akuntansi", "Min S1", "lower", 50],
    ["S1", "S1 / D4", "equal", 80],
    ["Sarjana Terapan", "Min S1", "equal", 80],
    ["S-1 Teknik", "Minimal S1", "equal", 80],
    ["S2", "D3 / S1", "higher", 100],
    ["SMA", "D3", "lower", 50],
    ["Senior High School", "Min SMA/SMK", "equal", 80],
    [null, "Min S1", null, null],
    ["S1", null, null, null],
    ["S1", "Semua jurusan", null, null],
  ];
  for (const [edu, req, cmp, score] of cases) {
    test(`TC-EDU-LVL "${edu}" vs "${req}" → ${cmp}`, () => {
      const v = compareEducationLevel(edu, req);
      assert.equal(v.comparison, cmp);
      assert.equal(v.score, score);
    });
  }

  test("TC-EDU-LVL-13 'Kelas 3' must not be read as a doctorate (S3)", () => {
    assert.equal(compareEducationLevel("SMA Kelas 3", "Min S1").comparison, "lower");
  });
});

describe("TC-EDU-EXACT  deterministic exact match", () => {
  test("TC-EDU-EXACT-01 one of several listed majors is enough", () => {
    const m = exactEducationMatch("S1", "Akuntansi", "Min S1 Akuntansi / Manajemen / Ekonomi");
    assert.equal(m.matched, true);
    assert.equal(m.comparison, "equal");
  });

  test("TC-EDU-EXACT-02 a shared word is NOT the same major (Teknik vs Manajemen Informatika)", () => {
    assert.equal(exactEducationMatch("S1", "Teknik Informatika", "S1 Manajemen Informatika").matched, false);
  });

  test("TC-EDU-EXACT-03 direction: a candidate covering what was asked matches", () => {
    assert.equal(exactEducationMatch("S1", "Manajemen Informatika", "S1 Informatika").matched, true);
  });

  test("TC-EDU-EXACT-04 'semua jurusan' accepts any major at a sufficient level", () => {
    const m = exactEducationMatch("S2", "Hukum", "Min S1 Semua Jurusan");
    assert.equal(m.matched, true);
    assert.equal(m.comparison, "higher");
  });

  test("TC-EDU-EXACT-05 a parenthesised preference is not mandatory", () => {
    assert.equal(exactEducationMatch("S1", "Ekonomi", "S1 Ekonomi (diutamakan Akuntansi)").matched, true);
  });

  test("TC-EDU-EXACT-06 a level below the requirement never exact-matches", () => {
    assert.equal(exactEducationMatch("D3", "Akuntansi", "Min S1 Akuntansi").matched, false);
  });

  test("TC-EDU-EXACT-07 English HR major vs Indonesian JD (ACCOUNTING vs Akuntansi)", () => {
    assert.equal(exactEducationMatch("S1", "ACCOUNTING", "S1 Akuntansi").matched, true);
  });

  test("TC-EDU-EXACT-08 no requirement, or no candidate data → no match (no guess)", () => {
    assert.equal(exactEducationMatch("S1", "Hukum", null).matched, false);
    assert.equal(exactEducationMatch(null, null, "Min S1").matched, false);
  });
});

describe("TC-EDU-CMP  composing the two axes", () => {
  test("TC-EDU-CMP-01 the documented table", () => {
    const higher = compareEducationLevel("S2", "Min S1");
    const equal = compareEducationLevel("S1", "Min S1");
    assert.equal(composeEducationScore({ education_level: 100, major_relevance: 100 }, higher).score, 100);
    assert.equal(composeEducationScore({ education_level: 100, major_relevance: 100 }, equal).score, 90);
    assert.equal(composeEducationScore({ education_level: 40, major_relevance: 40 }, higher).score, 70);
    assert.equal(composeEducationScore({ education_level: 40, major_relevance: 40 }, equal).score, 60);
  });

  test("TC-EDU-CMP-02 an undeterminable level is DROPPED, not filled with a guess", () => {
    const none = compareEducationLevel(null, "Min S1");
    const r = composeEducationScore({ education_level: 70, major_relevance: 90 }, none);
    assert.equal(r.score, 80);
    assert.equal(r.levelScore, null);
  });

  test("TC-EDU-CMP-03 a higher level always beats an equal one at identical major relevance", () => {
    const higher = compareEducationLevel("S2", "Min S1");
    const equal = compareEducationLevel("S1", "Min S1");
    for (let m = 0; m <= 100; m += 10) {
      const p = { education_level: m, major_relevance: m };
      assert.ok(composeEducationScore(p, higher).score > composeEducationScore(p, equal).score);
    }
  });
});

describe("TC-WGT  AHP weights", () => {
  test("TC-WGT-01 shipped defaults: behavior 35, technical 25, HAV 20, PA 10, career 5, education 5", () => {
    assert.deepEqual(DEFAULT_WEIGHTS, { technical: 25, career: 5, behavior: 35, performance: 10, hav: 20, education: 5 });
    assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
    assert.deepEqual([...AHP_CRITERIA_ORDER], ["technical", "career", "behavior", "performance", "hav", "education"]);
  });

  test("TC-WGT-02 no program matrix → defaults, CR = 0, source 'default'", async () => {
    const r = await resolveAhpWeights(null);
    assert.equal(r.source, "default");
    for (const k of AHP_CRITERIA_ORDER) close(r.weights[k], DEFAULT_WEIGHTS[k] / 100, 1e-12);
    close(r.cr, 0, 1e-9);
  });

  test("TC-WGT-03 a derived run's pinned matrix WINS (source 'inherited')", async () => {
    const pinned = pairwiseFromWeights([10, 10, 10, 10, 50, 10]);
    const r = await resolveAhpWeights(null, pinned);
    assert.equal(r.source, "inherited");
    close(r.weights.hav, 0.5, 1e-12);
  });

  test("TC-WGT-04 an invalid pinned matrix (wrong size) falls back to defaults, never crashes", async () => {
    const r = await resolveAhpWeights(null, pairwiseFromWeights([1, 1, 1, 1, 1]));
    assert.equal(r.source, "default");
  });
});
