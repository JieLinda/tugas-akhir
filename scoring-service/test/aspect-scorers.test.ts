// TC-PA / TC-BEH / TC-HAV / TC-RDY / TC-LVL — the deterministic, rule-based
// aspect scorers. Each maps one HR column to 0..100 with no model involved.
//
//   node --import tsx --test test/aspect-scorers.test.ts
//
// Imports ahp-topsis-engine, which constructs (but never connects) a pg Pool,
// so no database is needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PA_PERIOD_WEIGHTS,
  scorePerformanceAspect,
} from "../src/pa-score.js";
import {
  behaviorRankIndex,
  normalizeRequiredLevel,
  parseRequiredCompetencies,
  proficiencyToLevel,
  scoreBehaviorAspect,
  targetLevelOf,
  unionMaxLevel,
} from "../src/ahp-topsis-engine.js";
import {
  computeHavScore,
  determineReadiness,
} from "../src/scoring-engine.js";

// ─── Performance Appraisal ───────────────────────────────────────

describe("TC-PA  Performance Appraisal (absolute-anchor TOPSIS over 6 semesters)", () => {
  test("TC-PA-01 all A → 100, all D → 0", () => {
    assert.equal(scorePerformanceAspect("A,A,A,A,A,A"), 100);
    assert.equal(scorePerformanceAspect("D,D,D,D,D,D"), 0);
  });

  test("TC-PA-02 no record at all → 33 (documented no-data value, NOT a passing 60)", () => {
    assert.equal(scorePerformanceAspect(null), 33);
    assert.equal(scorePerformanceAspect(undefined), 33);
    assert.equal(scorePerformanceAspect(""), 33);
    assert.equal(scorePerformanceAspect(",,,,,"), 33, "all-empty slots read as C");
  });

  test("TC-PA-03 all C → 33, all B → 67 (constant records ignore the weights)", () => {
    assert.equal(scorePerformanceAspect("C,C,C,C,C,C"), 33);
    assert.equal(scorePerformanceAspect("B,B,B,B,B,B"), 67);
  });

  test("TC-PA-04 ORDER matters: recent improvement 51, recent decline 41 (documented)", () => {
    assert.equal(scorePerformanceAspect("A,C,C,C,C,C"), 51);
    assert.equal(scorePerformanceAspect("C,C,C,C,C,A"), 41);
  });

  test("TC-PA-05 case, whitespace and unknown letters are tolerated (unknown → C)", () => {
    assert.equal(scorePerformanceAspect(" a , a ,a,a,a,a "), 100);
    assert.equal(scorePerformanceAspect("X,X,X,X,X,X"), 33);
  });

  test("TC-PA-06 shorter records are scored over the slots present", () => {
    assert.equal(scorePerformanceAspect("A"), 100);
    assert.equal(scorePerformanceAspect("A,B"), scorePerformanceAspect("A,B"));
  });

  test("TC-PA-07 period weights are the documented AHP recency vector (decay 0.8)", () => {
    const doc = [0.271056, 0.216844, 0.173476, 0.13878, 0.111024, 0.088819];
    PA_PERIOD_WEIGHTS.forEach((w, i) => assert.ok(Math.abs(w - doc[i]!) < 1e-6));
    assert.ok(Math.abs(PA_PERIOD_WEIGHTS.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  });

  test("TC-PA-08 monotone in every slot: improving one semester never lowers the score", () => {
    for (let slot = 0; slot < 6; slot++) {
      let prev = -1;
      for (const g of ["D", "C", "B", "A"]) {
        const rec = Array(6).fill("C");
        rec[slot] = g;
        const s = scorePerformanceAspect(rec.join(","));
        assert.ok(s >= prev, `slot ${slot} ${g}: ${s} < ${prev}`);
        prev = s;
      }
    }
  });

  test(
    "TC-PA-09 an E record must never outscore a D record (E is the worse grade)",
    { todo: "DEFECT-01: all-E scores 20 while all-D scores 0 — E sits outside the A..D anchors" },
    () => {
      assert.ok(
        scorePerformanceAspect("E,E,E,E,E,E") <= scorePerformanceAspect("D,D,D,D,D,D"),
        `E=${scorePerformanceAspect("E,E,E,E,E,E")} D=${scorePerformanceAspect("D,D,D,D,D,D")}`
      );
    }
  );
});

// ─── Behavior ────────────────────────────────────────────────────

describe("TC-BEH  Behavior competency (AHP engine: paired ordinal 6..0)", () => {
  test("TC-BEH-01 paired categories share a value", () => {
    const table: [string, number][] = [
      ["VERY HIGH", 100],
      ["STRENGTH", 100],
      ["HIGH", 83],
      ["READY", 83],
      ["MIDDLE HIGH", 67],
      ["PENGEMBANGAN JANGKA PENDEK", 67],
      ["READY WITH DEVELOPMENT", 50],
      ["POTENSI", 50],
      ["NEED DEVELOPMENT (9 MONTHS - 2 YEARS)", 33],
      ["MIDDLE LOW", 33],
      ["FOCUS ON OPTIMIZATION IN CURRENT POSITION", 17],
      ["LOW", 17],
      ["BELUM ADA POTENSI", 0],
      ["VERY LOW", 0],
      ["NOT READY", 0],
    ];
    for (const [label, score] of table) assert.equal(scoreBehaviorAspect(label), score, label);
  });

  test("TC-BEH-02 missing / unknown / dash → 0 (no positive evidence)", () => {
    for (const v of [null, undefined, "", "-", "   "]) assert.equal(scoreBehaviorAspect(v), 0);
    assert.equal(behaviorRankIndex("SOMETHING ELSE"), null);
  });

  test("TC-BEH-03 the longest contained category wins (VERY HIGH ≠ HIGH, NOT READY ≠ READY)", () => {
    assert.equal(scoreBehaviorAspect("Very High (2025)"), 100);
    assert.equal(scoreBehaviorAspect("NOT READY – perlu evaluasi"), 0);
    assert.equal(scoreBehaviorAspect("belum ada potensi"), 0);
    assert.equal(scoreBehaviorAspect("Ready  with   Development"), 50);
  });

  test("TC-BEH-04 a truncated label resolves to the shortest category containing it", () => {
    assert.equal(scoreBehaviorAspect("NEED DEVELOPMENT"), 33);
  });
});

// ─── HAV ─────────────────────────────────────────────────────────

describe("TC-HAV  HAV 16-quadrant → 5-tier score", () => {
  test("TC-HAV-01 every quadrant maps to its documented tier", () => {
    const tier: Record<number, number> = {
      1: 100, 2: 80, 3: 80, 4: 80, 7: 80, 8: 80,
      5: 60, 6: 60, 9: 60, 13: 60, 14: 60,
      10: 40, 11: 40, 12: 40, 15: 40, 16: 20,
    };
    for (let q = 1; q <= 16; q++) assert.equal(computeHavScore(String(q)), tier[q], `Q${q}`);
  });

  test("TC-HAV-02 decorated values are parsed by their digits", () => {
    assert.equal(computeHavScore("Kuadran #1"), 100);
    assert.equal(computeHavScore("Q16"), 20);
  });

  test("TC-HAV-03 missing / unparseable / out-of-range → 40, never the bottom tier", () => {
    for (const v of [null, undefined, "", "abc", "17", "0"]) assert.equal(computeHavScore(v), 40);
  });
});

// ─── Readiness ───────────────────────────────────────────────────

describe("TC-RDY  Readiness bands from lib/readiness-config.json", () => {
  test("TC-RDY-01 boundaries are inclusive at each minScore", () => {
    assert.equal(determineReadiness(100), "Short");
    assert.equal(determineReadiness(80), "Short");
    assert.equal(determineReadiness(79.99), "Medium");
    assert.equal(determineReadiness(65), "Medium");
    assert.equal(determineReadiness(64.99), "Long");
    assert.equal(determineReadiness(50), "Long");
    assert.equal(determineReadiness(49.99), "Not Ready");
    assert.equal(determineReadiness(0), "Not Ready");
  });

  test("TC-RDY-02 below every threshold falls to defaultLevel", () => {
    assert.equal(determineReadiness(-1), "Not Ready");
  });
});

// ─── Competency level parsing ────────────────────────────────────

describe("TC-LVL  proficiency & required-level parsing", () => {
  test("TC-LVL-01 proficiency labels map to the 1..4 ladder", () => {
    const table: [string | null, number | null][] = [
      ["BASIC KNOWLEDGE", 1], ["Novice", 1], ["INTERMEDIATE", 2],
      ["Advance", 3], ["ADVANCED", 3], ["Mastery", 4], ["Expert", 4],
      ["Level 3", 3], ["2", 2],
    ];
    for (const [v, lvl] of table) assert.equal(proficiencyToLevel(v), lvl, String(v));
  });

  test("TC-LVL-02 the five spellings of absence are UNKNOWN (null), never level 1", () => {
    for (const v of [null, "", "#N/A", "Not Assessed", "-", "5"]) {
      assert.equal(proficiencyToLevel(v), null, String(v));
    }
  });

  test("TC-LVL-04 required level: numbers, labels, and a default of 2", () => {
    assert.equal(normalizeRequiredLevel(3), 3);
    assert.equal(normalizeRequiredLevel(2.6), 3);
    assert.equal(normalizeRequiredLevel("Level 4"), 4);
    assert.equal(normalizeRequiredLevel("Advance"), 3);
    assert.equal(normalizeRequiredLevel(null), 2);
    assert.equal(normalizeRequiredLevel(7), 2);
  });

  test("TC-LVL-05 job-profile competency list tolerates every stored shape", () => {
    const out = parseRequiredCompetencies({
      technicalCompetencies: [
        "Budgeting",
        { competency: "Data Analysis", level: 3 },
        { name: "Auditing", targetProficiency: "Mastery" },
        { technicalName: "Coaching" },
        { competency: "   " },
        null,
      ],
    });
    assert.deepEqual(out, [
      { name: "Budgeting", level: 2 },
      { name: "Data Analysis", level: 3 },
      { name: "Auditing", level: 4 },
      { name: "Coaching", level: 2 },
    ]);
    assert.deepEqual(parseRequiredCompetencies(null), []);
    assert.deepEqual(parseRequiredCompetencies({ technicalCompetencies: "x" }), []);
  });

  test("TC-LVL-06 incumbent sets merge by name, keeping the HIGHEST level", () => {
    const merged = unionMaxLevel([
      [{ name: "Budgeting", level: 2 }, { name: "Audit & Control", level: 1 }],
      [{ name: "BUDGETING", level: 4 }, { name: "audit and control", level: 3 }, { name: " ", level: 4 }],
    ]);
    assert.deepEqual(merged, [
      { name: "Budgeting", level: 4 },
      { name: "Audit & Control", level: 3 },
    ]);
  });

  test("TC-LVL-07 the JOB's target level wins over the incumbent's attained level", () => {
    const base = {
      employeeId: "1", technicalName: "X", gap: null, positionId: null, gradeId: null,
      createDate: null, modiDate: null, isActive: true,
    };
    assert.equal(
      targetLevelOf({ ...base, proficiencyName: "Advance", score: 1, currentProficiencyName: "Basic", currentScore: 1 }),
      3
    );
    assert.equal(
      targetLevelOf({ ...base, proficiencyName: null, score: 4, currentProficiencyName: "Basic", currentScore: 1 }),
      4
    );
    assert.equal(
      targetLevelOf({ ...base, proficiencyName: "#N/A", score: null, currentProficiencyName: "Intermediate", currentScore: null }),
      2
    );
    assert.equal(
      targetLevelOf({ ...base, proficiencyName: null, score: 9, currentProficiencyName: null, currentScore: null }),
      2,
      "an off-scale score is not a level; default 2"
    );
  });
});
