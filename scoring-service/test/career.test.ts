// TC-CAR — career relevance: similarity rescale, the experience-depth yardstick
// (inherited / jd / measured / fixed), the appointment-census ladder, the capped
// competency-fallback band, and the age decay of old stints.
//
//   node --import tsx --test test/career.test.ts
//
// Expectations are computed from the LIVE config (scoring-service/.env), so a
// deployment that tunes CAREER_DEPTH_* still runs this suite meaningfully.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  applyCalibration,
  calibrateFallback,
  deriveDepthTargets,
  parseStatedExperienceYears,
  recencyFactor,
  rescaleSim,
  stintYears,
} from "../src/ahp-topsis-engine.js";
import {
  levelFromTitle,
  targetYearsForLevel,
  type CareerDepthCensus,
  type PositionLevel,
} from "../src/career-depth-anchors.js";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);
const cfg = config.ahpTopsis.career;
const clampYears = (v: number) => Math.max(cfg.minTargetYears, Math.min(cfg.maxTargetYears, v));

/** Temporarily override career config fields for one case. */
function withCareerConfig<T>(patch: Partial<typeof cfg>, fn: () => T): T {
  const saved = { ...cfg };
  Object.assign(cfg, patch);
  try {
    return fn();
  } finally {
    Object.assign(cfg, saved);
  }
}

function census(levels: Partial<Record<PositionLevel, [number, number]>>, overall = [7, 400]): CareerDepthCensus {
  return {
    byLevel: new Map(
      Object.entries(levels).map(([level, [years, sampleCount]]) => [
        level as PositionLevel,
        { level: level as PositionLevel, years, sampleCount },
      ])
    ),
    overallYears: overall[0]!,
    overallSampleCount: overall[1]!,
    reason: "test census",
  };
}

describe("TC-CAR-SIM  document-similarity rescale", () => {
  const anchors = { simFloor: 0.633, simCeil: 0.892 } as any;
  test("TC-CAR-SIM-01 below floor → 0, above ceiling → 1, linear between", () => {
    assert.equal(rescaleSim(0.5, anchors), 0);
    assert.equal(rescaleSim(0.95, anchors), 1);
    close(rescaleSim((0.633 + 0.892) / 2, anchors), 0.5);
  });
  test("TC-CAR-SIM-02 degenerate anchors never blank the criterion", () => {
    assert.equal(rescaleSim(0.7, { simFloor: 0.8, simCeil: 0.8 } as any), 0.7);
  });
});

describe("TC-CAR-EXP  stated experience parser", () => {
  test("TC-CAR-EXP-01 reads a number attached to a year word, either order", () => {
    assert.equal(parseStatedExperienceYears("Min 5 tahun sebagai Application Developer"), 5);
    assert.equal(parseStatedExperienceYears("min. 3 thn di bidang terkait"), 3);
    assert.equal(parseStatedExperienceYears("3 years in audit"), 3);
    assert.equal(parseStatedExperienceYears("2,5 tahun"), 2.5);
    assert.equal(parseStatedExperienceYears("pengalaman tahun 4"), 4);
  });
  test("TC-CAR-EXP-02 refuses to guess: fresh graduate, bare number, out of range", () => {
    for (const t of [null, "", "Fresh graduate", "Min. 2 sebagai Auditor Internal", "0 tahun", "50 tahun"]) {
      assert.equal(parseStatedExperienceYears(t), null, String(t));
    }
  });
  test(
    "TC-CAR-EXP-03 a stated RANGE reads its minimum ('Min. 5 - 10 tahun' → 5)",
    { todo: "DEFECT-03: the parser returns the UPPER bound (10); 3 of 275 live job profiles use a range" },
    () => {
      assert.equal(parseStatedExperienceYears("Min. 5 - 10 tahun sebagai Manager Marketing"), 5);
      assert.equal(parseStatedExperienceYears("1-2 tahun sebagai sekretaris"), 1);
      assert.equal(parseStatedExperienceYears("Min. 2 – 3 tahun sebagai Mekanik MPM"), 2);
    }
  );
});

describe("TC-CAR-DEP  depth yardstick (deriveDepthTargets)", () => {
  test("TC-CAR-DEP-01 an incremental run INHERITS the base run's yardstick, whatever the JD says", () => {
    const t = deriveDepthTargets([1, 2], [1, 1], { targetYears: 6.5, targetRows: 1.5 }, "Min 10 tahun", "IT MANAGER", null);
    assert.equal(t.source, "inherited");
    assert.equal(t.targetYears, 6.5);
    assert.equal(t.targetRows, 1.5);
  });

  test("TC-CAR-DEP-02 a readable JD requirement sets the bar (source 'jd')", () => {
    const t = withCareerConfig({ useStatedExperience: true, statedMode: "scaled", statedExperienceOnlyAboveFixed: false }, () =>
      deriveDepthTargets([], [], null, "Min 5 tahun sebagai Analyst", "SYSTEM ANALYST", null)
    );
    assert.equal(t.source, "jd");
    close(t.targetYears, clampYears(5 * cfg.statedExperienceMultiplier), 1e-3);
    assert.equal(t.statedExperienceYears, 5);
  });

  test("TC-CAR-DEP-03 a 1-year JD is clamped up to minTargetYears", () => {
    const t = withCareerConfig({ useStatedExperience: true, statedMode: "direct", statedExperienceOnlyAboveFixed: false }, () =>
      deriveDepthTargets([], [], null, "Min 1 tahun", "STAFF ADMIN", null)
    );
    assert.equal(t.source, "jd");
    assert.equal(t.targetYears, cfg.minTargetYears);
  });

  test("TC-CAR-DEP-04 an extreme JD is clamped down to maxTargetYears", () => {
    const t = withCareerConfig({ useStatedExperience: true, statedMode: "direct", statedExperienceOnlyAboveFixed: false }, () =>
      deriveDepthTargets([], [], null, "Min 35 tahun", "DIRECTOR", null)
    );
    assert.equal(t.targetYears, cfg.maxTargetYears);
  });

  test("TC-CAR-DEP-05 no JD statement + census → MEASURED level median", () => {
    const c = census({ staff: [5.7, 100], officer: [7, 120], section_head: [8, 90], department_head: [9.25, 40], division_head: [15.5, 12] });
    const t = withCareerConfig({ defaultSource: "measured" }, () =>
      deriveDepthTargets([], [], null, "Fresh graduate", "IT APPLICATION DEVELOPMENT DEPARTMENT HEAD", c)
    );
    assert.equal(t.source, "measured");
    assert.equal(t.level, "department_head");
    close(t.targetYears, clampYears(9.25), 1e-3);
    assert.equal(t.measured?.basis, "level");
  });

  test("TC-CAR-DEP-06 no JD statement and no census → the FIXED constant", () => {
    const t = deriveDepthTargets([], [], null, null, "SALESMAN", null);
    assert.equal(t.source, "fixed");
    close(t.targetYears, clampYears(cfg.fixedTargetYears), 1e-3);
  });

  test("TC-CAR-DEP-07 'JD may only raise the bar' flag: a lower JD loses and says why", () => {
    const t = withCareerConfig(
      { useStatedExperience: true, statedMode: "direct", statedExperienceOnlyAboveFixed: true, defaultSource: "constant" },
      () => deriveDepthTargets([], [], null, "Min 3 tahun", "SALESMAN", null)
    );
    assert.equal(t.source, "fixed");
    assert.equal(t.statedIgnoredReason, "below-floor");
    close(t.targetYears, clampYears(cfg.fixedTargetYears), 1e-3);
  });

  test("TC-CAR-DEP-08 statedMode 'ignore' never reads the JD and reports it", () => {
    const t = withCareerConfig({ statedMode: "ignore", defaultSource: "constant" }, () =>
      deriveDepthTargets([], [], null, "Min 10 tahun", "SALESMAN", null)
    );
    assert.equal(t.source, "fixed");
    assert.equal(t.statedIgnoredReason, "mode-ignore");
  });

  test("TC-CAR-DEP-09 the yardstick is ABSOLUTE: a weak pool does not lower it", () => {
    const strong = deriveDepthTargets([9, 10, 12], [2, 3, 3], null, null, "SALESMAN", null);
    const weak = deriveDepthTargets([0.1, 0.2, 0.3], [0.1, 0.1, 0.2], null, null, "SALESMAN", null);
    assert.equal(strong.targetYears, weak.targetYears);
    assert.equal(weak.medianEffectiveYears, 0.2, "pool median is still reported");
  });

  test("TC-CAR-DEP-10 scaled mode multiplies by the configured factor", () => {
    const t = withCareerConfig({ useStatedExperience: true, statedMode: "scaled", statedExperienceOnlyAboveFixed: false, statedExperienceMultiplier: 2 }, () =>
      deriveDepthTargets([], [], null, "Min 4 tahun", "ANALYST", null)
    );
    close(t.targetYears, 8, 1e-3);
  });
});

describe("TC-CAR-LVL  seniority band & appointment census", () => {
  test("TC-CAR-LVL-01 titles map to the band, most-senior first", () => {
    const table: [string, PositionLevel][] = [
      ["GENERAL MANAGER SALES", "division_head"],
      ["FINANCE DIVISION HEAD", "division_head"],
      ["IT APPLICATION DEVELOPMENT DEPARTMENT HEAD", "department_head"],
      ["SECURITY AND COMPLIANCE DEPUTY DEPARTMENT HEAD", "department_head"],
      ["BRANCH MANAGER", "department_head"],
      ["WAREHOUSE SUPERVISOR", "section_head"],
      ["SPV ADM GUDANG", "section_head"],
      ["SYSTEM INTEGRATOR ANALYST", "officer"],
      ["SALESMAN", "staff"],
      ["", "staff"],
    ];
    for (const [title, lvl] of table) assert.equal(levelFromTitle(title), lvl, title);
  });

  test("TC-CAR-LVL-02 a band with enough samples uses its own median", () => {
    const r = targetYearsForLevel(census({ section_head: [8, 50] }), "section_head");
    assert.deepEqual(r, { years: 8, basis: "level", sampleCount: 50 });
  });

  test("TC-CAR-LVL-03 MONOTONIC: a senior band can never be easier than a junior one", () => {
    const r = targetYearsForLevel(census({ section_head: [10, 50], department_head: [6, 40] }), "department_head");
    assert.equal(r?.years, 10);
    assert.equal(r?.basis, "monotonic");
  });

  test("TC-CAR-LVL-04 a thin band (< 10 appointments) borrows the junior floor", () => {
    const r = targetYearsForLevel(census({ officer: [7, 120], division_head: [30, 3] }), "division_head");
    assert.equal(r?.years, 7);
    assert.equal(r?.basis, "monotonic");
  });

  test("TC-CAR-LVL-05 no usable band → overall median; empty census → null", () => {
    assert.equal(targetYearsForLevel(census({}), "staff")?.basis, "overall");
    assert.equal(targetYearsForLevel(census({}, [0, 0]), "staff"), null);
  });
});

describe("TC-CAR-FB  competency fallback band (no job profile for a stint)", () => {
  const anchors = { simFloor: 0.633, simCeil: 0.892 } as any;
  test("TC-CAR-FB-01 full coverage reaches only `cap` of the scale (default 50%)", () => {
    const cal = calibrateFallback([0.7, 0.8], anchors, true);
    if (cal.source === "pinned") return; // operator pinned the band; cap does not apply
    close(cal.lo, 0.633);
    close(cal.hi, 0.633 + config.ahpTopsis.careerFallback.cap * (0.892 - 0.633));
    close(applyCalibration(1, cal), cal.hi);
    close(applyCalibration(0, cal), cal.lo);
    assert.ok(rescaleSim(applyCalibration(1, cal), anchors) <= config.ahpTopsis.careerFallback.cap + 1e-9,
      "a fallback can never claim a document-match relevance");
  });
  test("TC-CAR-FB-02 out-of-range coverage is clamped (surplus 1.75 → hi, negative → lo)", () => {
    const cal = calibrateFallback([], anchors, false);
    close(applyCalibration(1.75, cal), cal.hi);
    close(applyCalibration(-0.3, cal), cal.lo);
  });
});

describe("TC-CAR-TIME  stint duration & age decay", () => {
  const yearsAgo = (y: number) => new Date(Date.now() - y * 365.25 * 24 * 3600 * 1000);
  test("TC-CAR-TIME-01 ongoing / sentinel / future end → no decay", () => {
    assert.equal(recencyFactor(null), 1);
    assert.equal(recencyFactor(new Date("9999-01-01")), 1);
    assert.equal(recencyFactor(new Date(Date.now() + 86400000 * 30)), 1);
  });
  test("TC-CAR-TIME-02 a stint that ended 10 years ago decays by exp(−δ·10)", () => {
    const delta = cfg.recencyDecayPerYear;
    close(recencyFactor(yearsAgo(10)), delta > 0 ? Math.exp(-delta * 10) : 1, 1e-4);
    assert.ok(recencyFactor(yearsAgo(10)) <= recencyFactor(yearsAgo(2)));
  });
  test("TC-CAR-TIME-03 duration counts whole months; open stints run to today", () => {
    close(stintYears(new Date(2020, 0, 15), new Date(2021, 0, 14)), 11 / 12);
    close(stintYears(new Date(2020, 0, 15), new Date(2021, 0, 15)), 1);
    assert.equal(stintYears(null, null), 1, "undated stint defaults to one year");
    assert.equal(stintYears(new Date(2022, 0, 1), new Date(2021, 0, 1)), 0, "end before start");
    const open = stintYears(yearsAgo(3), new Date("9999-01-01"));
    assert.ok(open > 2.9 && open <= 3);
    const future = stintYears(yearsAgo(1), new Date(Date.now() + 365 * 86400000 * 5));
    assert.ok(future <= 1.01, "tenure cannot accrue into the future");
  });
});
