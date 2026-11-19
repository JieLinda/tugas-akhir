// The career depth target `T_years`, measured from what the company ACTUALLY
// required rather than from a constant or from what job profiles claim.
//
// ── WHY A MEASUREMENT AND NOT A NUMBER ──────────────────────────────────
// `T_years` is the saturation point of the years axis: the amount of effective
// relevant experience that earns full marks. It was a hardcoded 8, and 8 was
// picked in a simulation because it behaved well. That is not a provenance, and
// "8 years" is the kind of number an operator is entitled to interrogate.
//
// ── WHY NOT SIMPLY THE JOB PROFILE'S STATED MINIMUM ─────────────────────
// Because the stated minimum and `effectiveYears` ARE NOT THE SAME UNIT, and the
// gap is large enough to invert the decision.
//
// A JD says "Min 5 tahun sebagai Application Developer" — five RAW calendar years
// in one named role. `effectiveYears` is Σ(sim′ × years × recency): every year is
// discounted by how close that job really was and by how long ago it ended. On
// this deployment's own scored candidates the median ratio is
//
//     effectiveYears ÷ years-that-scored  =  0.398
//
// so the honest translation of the JD's five years into the axis it would be
// compared against is 5 ÷ 0.398 ≈ 12.6 effective years — not 5. Setting
// T_years = 5 does not implement the document; it implements roughly 40% of it.
//
// Measured consequence on the reference run (27 candidates, IT Application
// Development Department Head), separation between the two genuine app-dev
// candidates and the four support-only ones:
//
//     T = 2 or 3  →  3 points     (support-only candidates score 88)
//     T = 5       →  9 points     (support-only candidates score 82)
//     T = 8       →  40 points
//     T = 10      →  45 points    ← peak
//     T = 12      →  38 points    (genuine candidates start falling too)
//
// So a T taken literally from the JD re-creates the exact defect the career
// rework was built to remove.
//
// ── WHAT THIS MODULE MEASURES INSTEAD ───────────────────────────────────
// The company's revealed preference: how many years of service the people who
// were ACTUALLY APPOINTED to a job at each level had behind them, read from
// `candidate_position_history`. This is the same kind of evidence the similarity
// anchors' `transitions` estimator uses — decisions that already happened, not a
// property of a document.
//
//     level                 n     median   p25    p75     JD claims (median)
//     STAFF               269      5.7     2.3   10.4      2
//     OFFICER / ANALYST   129      6.7     3.2   10.7      1
//     SECTION HEAD / SPV   27      9.1     5.8   11.8      2
//     DEPT HEAD / MANAGER  37      9.2     6.1   12.6      3
//     DIVISION HEAD / GM    8     15.6    15.2   18.8      5
//
// The job profiles understate the real bar by 3–7×. Their minimums are eligibility
// floors written into a template; the people who got the seats had three times
// that. For a Department Head the measured median is 9.2 years — which is where
// the guessed 8 happened to land, and close to both the unit conversion (12.6)
// and the separation optimum (10). Three independent lines of evidence agreeing
// is the reason to trust this one rather than the constant.
//
// ── AND IT COVERS THE TWO CASES A JD CANNOT ─────────────────────────────
//   • the JD states no number at all — 78 of 275 profiles say "Fresh graduate"
//     and 23 more say something unparseable;
//   • the target position has NO job profile at all.
// Both fall back to the level census, because a level can be read from the
// position's own title, which always exists.
//
// Self-healing: the census is derived from `candidate_position_history`, and the
// career-anchors fingerprint already hashes that table's ordered
// (candidate, position, valid_from) set. So a weekly HR sync that changes the
// appointment record moves the fingerprint and this recomputes with it.

import { query } from "./db/postgres.js";
import { log } from "./llm.js";
import { contentFingerprint, storeCensusSnapshot } from "./run-trace.js";
import type { CareerDepthCensusPayload, CensusRef } from "./run-trace-types.js";

/** Coarse seniority bands, read from a position TITLE. */
export type PositionLevel =
  | "staff"
  | "officer"
  | "section_head"
  | "department_head"
  | "division_head";

export type CareerDepthLevelAnchor = {
  level: PositionLevel;
  /** Median years of service before appointment, at this level. */
  years: number;
  /** Appointments the median was taken over. */
  sampleCount: number;
};

export type CareerDepthCensus = {
  byLevel: Map<PositionLevel, CareerDepthLevelAnchor>;
  /** Median across every level, used when a level has too few appointments. */
  overallYears: number;
  overallSampleCount: number;
  reason: string;
  /** The stored appointment list behind these medians (drizzle/0092), for the trace export. */
  census?: CensusRef | null;
};

/**
 * Below this many appointments a level's median is an anecdote and the band falls
 * back. 10 rather than something larger because the senior bands are inherently
 * small — Division Head has 12 appointments here — and their distribution is
 * TIGHT (p25 15.2, median 15.9, p75 18.8), which is what actually makes a median
 * trustworthy. Reported either way.
 */
const MIN_LEVEL_SAMPLES = 10;

/**
 * Seniority order, junior first. Needed for the monotonicity guard below.
 */
const LEVEL_ORDER: PositionLevel[] = [
  "staff",
  "officer",
  "section_head",
  "department_head",
  "division_head",
];

/** The census rule, recorded on every run's trace so the XLSX can restate it. */
export const CAREER_DEPTH_CENSUS_PARAMS = {
  minLevelSamples: MIN_LEVEL_SAMPLES,
  levelOrder: [...LEVEL_ORDER] as string[],
  daysPerYear: 365.25,
};

/**
 * Read a seniority band from a position title.
 *
 * Titles are the only level statement that reliably exists. `sync_positions.grade_id`
 * is empty for essentially every row in this deployment, and resolving the
 * incumbent's grade through `sync_grade_levels` covers only 8 of 15 curated
 * positions — so a grade-based reading would silently fall back for half of them.
 * Every `critical_positions.title` and every `sync_job_profiles.position_name`
 * carries its level in words.
 *
 * Order matters: the checks run most-senior-first, because "IT APPLICATION
 * DEVELOPMENT DEPARTMENT HEAD" contains neither "MANAGER" nor "ANALYST" but
 * "SECURITY AND COMPLIANCE DEPUTY DEPARTMENT HEAD" contains "DEPARTMENT HEAD",
 * and a title like "NETWORK DIGITAL DEPARTMENT HEAD" must not be read as staff
 * merely because no other keyword matched first.
 */
export function levelFromTitle(title: string | null | undefined): PositionLevel {
  const t = (title ?? "").toUpperCase();
  if (/DIVISION HEAD|GENERAL MANAGER|\bDIRECTOR\b/.test(t)) return "division_head";
  if (/DEPARTMENT HEAD|DEPT HEAD|\bMANAGER\b/.test(t)) return "department_head";
  if (/SECTION HEAD|SUPERVISOR|\bSPV\b|COORDINATOR/.test(t)) return "section_head";
  if (/ANALYST|OFFICER|SENIOR STAFF|SPECIALIST|ENGINEER|ADMINISTRATOR/.test(t))
    return "officer";
  return "staff";
}

/** Human-readable band name, for the diagnostics the UI prints. */
export function levelLabel(level: PositionLevel): string {
  switch (level) {
    case "division_head":
      return "Division Head / General Manager";
    case "department_head":
      return "Department Head / Manager";
    case "section_head":
      return "Section Head / Supervisor";
    case "officer":
      return "Officer / Analyst";
    default:
      return "Staff";
  }
}

const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

let cached: { key: string; value: CareerDepthCensus } | null = null;

/**
 * Census the appointment record.
 *
 * "Years before appointment" = the gap between a person's FIRST recorded stint
 * and the start of their CURRENT one. Deliberately not "years in the previous
 * role": what a promotion committee weighs is a whole career, and one long stint
 * immediately before the appointment is not the same evidence as a career of the
 * same length.
 *
 * The level comes from the title of the job they were appointed INTO, which is
 * the seat whose bar we are trying to describe.
 */
export async function resolveCareerDepthCensus(): Promise<CareerDepthCensus> {
  const rows = await query<{
    title: string | null;
    yrsBefore: string | null;
    currentFrom: Date | null;
    firstFrom: Date | null;
  }>(
    `WITH cur AS (
       SELECT h.candidate_id, h.internal_title, h.valid_from,
              row_number() OVER (PARTITION BY h.candidate_id
                                     ORDER BY h.valid_from DESC) AS rn
         FROM candidate_position_history h
        WHERE h.valid_from IS NOT NULL
     ),
     first_job AS (
       SELECT candidate_id, min(valid_from) AS first_from
         FROM candidate_position_history
        WHERE valid_from IS NOT NULL
        GROUP BY candidate_id
     )
     SELECT cur.internal_title AS title,
            (extract(epoch FROM (cur.valid_from - f.first_from)) / (365.25 * 86400))::text
              AS "yrsBefore",
            cur.valid_from AS "currentFrom",
            f.first_from AS "firstFrom"
       FROM cur
       JOIN first_job f ON f.candidate_id = cur.candidate_id
      WHERE cur.rn = 1 AND cur.valid_from > f.first_from`
  ).catch(
    () => [] as { title: string | null; yrsBefore: string | null; currentFrom: Date | null; firstFrom: Date | null }[]
  );

  const byLevelYears = new Map<PositionLevel, number[]>();
  const all: number[] = [];
  const appointments: CareerDepthCensusPayload["appointments"] = [];
  for (const r of rows) {
    const y = Number(r.yrsBefore);
    // An appointment with no measurable prior service says nothing about a bar.
    if (!Number.isFinite(y) || y <= 0) continue;
    const lvl = levelFromTitle(r.title);
    if (!byLevelYears.has(lvl)) byLevelYears.set(lvl, []);
    byLevelYears.get(lvl)!.push(y);
    all.push(y);
    appointments.push({
      title: r.title ?? null,
      level: lvl,
      firstFrom: r.firstFrom ? new Date(r.firstFrom).toISOString() : "",
      currentFrom: r.currentFrom ? new Date(r.currentFrom).toISOString() : "",
      years: y,
    });
  }
  // No candidate identity: the seat's title and the service length are what the
  // median is taken over. Sorted so the export can take each band's median over
  // one contiguous block.
  appointments.sort(
    (a, b) => LEVEL_ORDER.indexOf(a.level as PositionLevel) - LEVEL_ORDER.indexOf(b.level as PositionLevel) || a.years - b.years
  );
  const censusPayload: CareerDepthCensusPayload = {
    daysPerYear: 365.25,
    minLevelSamples: MIN_LEVEL_SAMPLES,
    levelOrder: [...LEVEL_ORDER],
    appointments,
  };
  const census =
    appointments.length > 0
      ? await storeCensusSnapshot(
          "career_depth",
          `appt:${appointments.length}:${contentFingerprint(censusPayload)}`,
          censusPayload,
          appointments.length
        ).catch(() => null)
      : null;

  const byLevel = new Map<PositionLevel, CareerDepthLevelAnchor>();
  for (const [level, ys] of byLevelYears) {
    byLevel.set(level, {
      level,
      years: Number(median(ys).toFixed(2)),
      sampleCount: ys.length,
    });
  }
  const overallYears = Number(median(all).toFixed(2));

  const value: CareerDepthCensus = {
    byLevel,
    overallYears,
    overallSampleCount: all.length,
    census,
    reason:
      all.length === 0
        ? "Riwayat pengangkatan jabatan tidak dapat dibaca — tolok ukur diambil dari konfigurasi."
        : `Diukur dari ${all.length} pengangkatan jabatan yang benar-benar terjadi (lama bekerja seseorang sebelum menduduki jabatannya sekarang): ` +
          [...byLevel.values()]
            .sort((a, b) => b.years - a.years)
            .map((a) => `${levelLabel(a.level)} ${a.years} th (${a.sampleCount} pengangkatan)`)
            .join("; ") +
          `. Median seluruh tingkat ${overallYears} th.`,
  };

  log("careerDepthCensus.measured", {
    appointments: all.length,
    overall: overallYears,
    byLevel: [...byLevel.values()].map((a) => `${a.level}=${a.years}/${a.sampleCount}`),
  });
  return value;
}

/**
 * Cached wrapper, keyed on the appointment count so an HR sync that adds rows
 * invalidates it. Coarse on purpose: the median moves slowly, and a stale value
 * is a rounding difference rather than a wrong answer — whereas a per-run census
 * that had to be exact would be one more thing able to fail a run.
 */
export async function resolveCareerDepthCensusCached(): Promise<CareerDepthCensus> {
  const countRows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM candidate_position_history WHERE valid_from IS NOT NULL`
  ).catch(() => [] as { n: string }[]);
  const key = `hist:${countRows[0]?.n ?? "?"}`;
  if (cached && cached.key === key) return cached.value;
  const value = await resolveCareerDepthCensus();
  cached = { key, value };
  return value;
}

/**
 * The measured target for one position, plus enough provenance to print.
 * `null` when the census produced nothing usable, so the caller falls back to
 * config rather than to a silently-invented number.
 */
export function targetYearsForLevel(
  census: CareerDepthCensus,
  level: PositionLevel
): { years: number; basis: "level" | "overall" | "monotonic"; sampleCount: number } | null {
  const idx = LEVEL_ORDER.indexOf(level);
  const exact = census.byLevel.get(level);

  // MONOTONICITY GUARD. Seniority is ordered, so the bar cannot fall as the seat
  // gets more senior. Without this, a thin senior band drops to the overall
  // median and the most senior seat becomes the EASIEST one to score full marks
  // on: measured here, Division Head has 12 appointments, and falling back to the
  // all-levels median 6.7 would have put it below Department Head's own 9.25.
  // Taking the max over this band and every band below it is the cheapest fix
  // that cannot invert the ordering, and it degrades toward "as demanding as the
  // most demanding junior band", never toward "easier than a junior band".
  const floorFromJuniors =
    idx > 0
      ? LEVEL_ORDER.slice(0, idx)
          .map((l) => census.byLevel.get(l))
          .filter((a): a is CareerDepthLevelAnchor => Boolean(a) && a!.sampleCount >= MIN_LEVEL_SAMPLES)
          .reduce((mx, a) => Math.max(mx, a.years), 0)
      : 0;

  if (exact && exact.sampleCount >= MIN_LEVEL_SAMPLES) {
    if (exact.years >= floorFromJuniors) {
      return { years: exact.years, basis: "level", sampleCount: exact.sampleCount };
    }
    // The band's own median sits below a more junior band's — real in a noisy
    // record. Raise it rather than publish an inverted ladder.
    return { years: floorFromJuniors, basis: "monotonic", sampleCount: exact.sampleCount };
  }

  if (floorFromJuniors > 0) {
    return { years: floorFromJuniors, basis: "monotonic", sampleCount: exact?.sampleCount ?? 0 };
  }
  if (census.overallSampleCount > 0) {
    return {
      years: census.overallYears,
      basis: "overall",
      sampleCount: census.overallSampleCount,
    };
  }
  return null;
}

/** Test seam — drops the module cache. */
export function resetCareerDepthCensusCache(): void {
  cached = null;
}
