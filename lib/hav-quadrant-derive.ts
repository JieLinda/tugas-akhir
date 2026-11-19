/**
 * Derive a HAV 16-quadrant placement from the two inputs the company's talent
 * methodology actually uses: the behavioral-competency recommendation
 * (assessment centre) and the performance appraisal.
 *
 * WHY THIS EXISTS
 * ---------------
 * `candidates.hav_quadrant` is populated from an Excel upload (`sync_hav`,
 * see sync-service). That makes the Beranda "HAV Heat Grid" a picture of how
 * complete one spreadsheet is rather than of the workforce: an employee whose
 * PA and assessment-centre results both synced still reads as "no quadrant"
 * until somebody types the number. Both axes of the grid are already in
 * Postgres, so the quadrant is computable — this module computes it.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It writes nothing. A derived quadrant is a *fallback* used at read time; an
 * uploaded HAV value always wins, the same way `final_validated_box` outranks
 * `system_recommended_box` in the Talent module — a calibrated human decision
 * is not overturned by a rule. Nothing here reaches AHP+TOPSIS, and that is
 * deliberate: `scoring-service/src/ahp-topsis-engine.ts` scores HAV as its own
 * 20% aspect alongside behavior (35%) and PA (10%), so persisting a HAV value
 * that is a pure function of behavior and PA would quietly rest 65% of the
 * weight on two inputs. Making the derived quadrant authoritative for scoring
 * is a scoring-policy decision, not a display one.
 *
 * The quadrant vocabulary (numbers, names, categories) is NOT redefined here —
 * it comes from HAV_QUADRANTS in lib/hav-quadrant.ts, which is what every
 * other surface already renders.
 *
 * TWO CONSUMERS, ONE RULE
 * -----------------------
 * Beranda's HAV Heat Grid reads this as a fallback under the uploaded value.
 * Talent Mapping (/talent-pool/mapping, lib/talent-mapping-data.ts) reads it as
 * the BASE placement of every Talent Pool candidate, under which a saved manual
 * placement wins. Both call the same `deriveHavQuadrant`, so one person cannot
 * sit in two quadrants on two screens for a reason that is about code rather
 * than data. Change the rule here, and both move together.
 */

import { HAV_QUADRANTS } from './hav-quadrant';

/** Band on either axis of the grid, best → worst. */
export type HavBand = 'High' | 'Mid High' | 'Mid Low' | 'Low';

export const HAV_BANDS: HavBand[] = ['High', 'Mid High', 'Mid Low', 'Low'];

/** The five boxes of the existing Talent Matrix (see lib/db/schema.ts). */
export type TalentBox = 'TOP' | 'STRONG' | 'SOLID' | 'BORDER' | 'BOTTOM';

/**
 * (competency band × performance band) → quadrant number.
 *
 * All 16 cells are stated explicitly rather than computed from an index, because
 * the numbering is not a raster scan of the grid — it walks the diagonal
 * (Q1 top-left, then Q2/Q3/Q4 around it) exactly as the methodology document
 * numbers it. Any arithmetic shortcut here would be a re-derivation of a table
 * that HR wrote, and would silently disagree with HAV_QUADRANTS.
 */
export const HAV_QUADRANT_MATRIX: Record<HavBand, Record<HavBand, number>> = {
  //             perf High  perf Mid High  perf Mid Low  perf Low
  High: { High: 1, 'Mid High': 4, 'Mid Low': 6, Low: 10 },
  'Mid High': { High: 2, 'Mid High': 3, 'Mid Low': 5, Low: 11 },
  'Mid Low': { High: 7, 'Mid High': 8, 'Mid Low': 9, Low: 12 },
  Low: { High: 13, 'Mid High': 14, 'Mid Low': 15, Low: 16 },
};

/**
 * The grid as it is DRAWN — rows are the behavioural-assessment band top to
 * bottom (High first), columns the performance band left to right (Low first,
 * so High sits at the right edge), exactly as HR's methodology prints it:
 *
 *   Q10 BORDER | Q6  SOLID  | Q4  STRONG | Q1  TOP
 *   Q11 BORDER | Q5  SOLID  | Q3  STRONG | Q2  STRONG
 *   Q12 BORDER | Q9  SOLID  | Q8  SOLID  | Q7  STRONG
 *   Q16 BOTTOM | Q15 BORDER | Q14 SOLID  | Q13 STRONG
 *
 * Display order only; which quadrant a cell holds is still HAV_QUADRANT_MATRIX.
 */
export const HAV_GRID_ROWS: readonly HavBand[] = ['High', 'Mid High', 'Mid Low', 'Low'];
export const HAV_GRID_COLUMNS: readonly HavBand[] = ['Low', 'Mid Low', 'Mid High', 'High'];

/** The (competency, performance) bands a quadrant sits at — the matrix read backwards. */
export function bandsOfQuadrant(
  quadrant: number,
): { competencyBand: HavBand; performanceBand: HavBand } | null {
  for (const competencyBand of HAV_BANDS) {
    for (const performanceBand of HAV_BANDS) {
      if (HAV_QUADRANT_MATRIX[competencyBand][performanceBand] === quadrant) {
        return { competencyBand, performanceBand };
      }
    }
  }
  return null;
}

// ── Performance axis ─────────────────────────────────────────────────────────

/**
 * PA letters that count as "below C". The methodology writes this as the token
 * `C-` on a single-value input; the synced data expresses it as a D or an E.
 */
const PA_BELOW_C = new Set(['D', 'E', 'C-', 'C MINUS']);
const PA_LETTERS = new Set(['A', 'B', 'C', 'D', 'E']);

/**
 * How many of the newest GRADED periods the High / Mid High / Mid Low band is
 * read from — "PA 1 tahun terakhir atau 2 periode terakhir", one appraisal year
 * of two semesters.
 */
export const PERFORMANCE_BAND_PERIODS = 2;

/**
 * How far back a below-C grade still forces Low: "khusus jika pernah ada D, E,
 * C- pada 2 tahun terakhir" — the first four semester slots of the CSV
 * (yr-1 S2, yr-1 S1, yr-2 S2, yr-2 S1).
 *
 * This window is deliberately WIDER than the band's. A D two semesters before
 * the newest pair would otherwise be invisible to the grid — somebody with
 * `A,A,D,B` would read as High on the strength of one good year — and the
 * methodology says that grade still counts.
 */
export const PERFORMANCE_LOW_LOOKBACK_SLOTS = 4;

/** True for a grade the methodology treats as below C (D, E, C-). */
export function isBelowCGrade(grade: string | null | undefined): boolean {
  return PA_BELOW_C.has((grade ?? '').trim().toUpperCase());
}

/**
 * Split `candidates.performance_grade` into its six semester slots WITHOUT
 * dropping blanks.
 *
 * The column is a CSV written by sync-service candidate-populate as
 * [yr-1 S2, yr-1 S1, yr-2 S2, yr-2 S1, yr-3 S2, yr-3 S1] — newest first, two
 * slots per year. `parsePerformancePeriods` in lib/programs.ts filters blanks
 * out, which is right for its window rules ("any period is a D") but wrong
 * here: this axis needs to know WHICH year a letter belongs to, and a filtered
 * list of five letters no longer says whether the missing one was a semester or
 * a whole year.
 */
export function splitPerformanceSlots(raw: string | null | undefined): (string | null)[] {
  const slots = (raw ?? '').split(',').map((p) => {
    const v = p.trim().toUpperCase();
    return PA_LETTERS.has(v) || PA_BELOW_C.has(v) ? v : null;
  });
  while (slots.length < 6) slots.push(null);
  return slots.slice(0, 6);
}

/**
 * How the performance band of one employee was read — enough to show a reviewer
 * WHICH semesters decided it, not just the band.
 */
export type PerformanceReading = {
  band: HavBand;
  /**
   * Slot indexes (0 = newest, see `splitPerformanceSlots`) of the periods the
   * band was read from: the newest two graded ones, or one when only one exists.
   */
  periodSlots: number[];
  /** The pair as banded. A lone graded period appears twice — see below. */
  grades: [string, string];
  /**
   * The below-C grade that forced Low, when one did. Its slot can sit OUTSIDE
   * `periodSlots`: that is the two-year lookback at work, and the case a reader
   * most needs spelled out, because the newest pair alone would band higher.
   */
  lowTrigger: { slot: number; grade: string } | null;
};

/**
 * Read the performance axis from the stored six-slot CSV.
 *
 * Two windows, per the methodology:
 *   • Low   — ANY below-C grade (D, E, C-) in the last two years, i.e. slots
 *             0–3. Checked first, because it overrides whatever the newest pair
 *             says.
 *   • else  — the newest TWO graded periods ("2 periode terakhir"), banded by
 *             `performanceBandFromPair`: AA/AB/BA/BB High, CA/CB/AC/BC Mid High,
 *             CC Mid Low.
 *
 * "Graded" matters in both directions. Blank slots are skipped rather than read
 * as a grade, so a year still in progress (the source DB routinely has no rows
 * yet for it) does not put the whole workforce in "no PA" — the read falls
 * through to the newest periods that exist. And the pair is the two newest
 * GRADED periods even across a year boundary: with the newest semester blank,
 * `[–, B, C, C]` reads `B` and `C` (Mid High), not a lone `B` counted twice
 * (High) — the latter would promote somebody on half a year of evidence.
 *
 * A lone graded period in the whole window is read as if it repeated (`C` → `CC`
 * → Mid Low): the conservative reading, it never promotes on half the evidence.
 * A below-C grade in the pair itself is Low too even when it sits past the
 * two-year window — the band table has no other cell for a D.
 *
 * Null when no slot carries a grade at all.
 */
export function readPerformance(raw: string | null | undefined): PerformanceReading | null {
  const slots = splitPerformanceSlots(raw);
  const graded: { slot: number; grade: string }[] = [];
  slots.forEach((grade, slot) => {
    if (grade) graded.push({ slot, grade });
  });
  if (graded.length === 0) return null;

  const pair = graded.slice(0, PERFORMANCE_BAND_PERIODS);
  const first = pair[0]!;
  const second = pair[1] ?? first;
  const reading = {
    periodSlots: pair.map((p) => p.slot),
    grades: [first.grade, second.grade] as [string, string],
  };

  const lowTrigger =
    graded.find((g) => g.slot < PERFORMANCE_LOW_LOOKBACK_SLOTS && isBelowCGrade(g.grade)) ??
    pair.find((g) => isBelowCGrade(g.grade)) ??
    null;
  if (lowTrigger) return { ...reading, band: 'Low', lowTrigger };

  // performanceBandFromPair cannot return null here: both grades are letters.
  const band = performanceBandFromPair(first.grade, second.grade) ?? 'Low';
  return { ...reading, band, lowTrigger: null };
}

/**
 * Band a pair of semester grades.
 *
 * The methodology lists the pairs verbatim — AA/AB/BA/BB = High, CA/CB/AC/BC =
 * Mid High, CC = Mid Low, D/E/C- = Low — and every listed pair appears in both
 * orders, so the rule is over the multiset, not the sequence:
 *   • any semester below C            → Low   (one bad half is not averaged away)
 *   • both in {A,B}                   → High
 *   • one C and one in {A,B}          → Mid High
 *   • both C                          → Mid Low
 *
 * A lone graded semester is read as if it repeated (a single `C` bands as `CC`),
 * which is the conservative reading: it never promotes somebody on half the
 * evidence.
 */
export function performanceBandFromPair(
  first: string | null | undefined,
  second: string | null | undefined,
): HavBand | null {
  const normalize = (v: string | null | undefined) => {
    const s = (v ?? '').trim().toUpperCase();
    if (!s) return null;
    if (PA_BELOW_C.has(s)) return 'D';
    return PA_LETTERS.has(s) ? s : null;
  };

  const a = normalize(first);
  const b = normalize(second);
  const present = [a, b].filter((v): v is string => v !== null);
  if (present.length === 0) return null;

  // A lone semester counts twice — see the doc comment.
  const pair = present.length === 1 ? [present[0]!, present[0]!] : present;

  if (pair.some((g) => g === 'D' || g === 'E')) return 'Low';
  if (pair.every((g) => g === 'A' || g === 'B')) return 'High';
  if (pair.every((g) => g === 'C')) return 'Mid Low';
  // Remaining case: exactly one C paired with an A or a B.
  return 'Mid High';
}

/**
 * Band the performance axis from whatever form the caller holds: the stored
 * six-slot CSV, or a bare methodology token (`AB`, `CC`, `D`, `C-`).
 */
export function performanceBand(raw: string | null | undefined): HavBand | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  if (value.includes(',')) return readPerformance(value)?.band ?? null;

  const token = value.toUpperCase();
  if (PA_BELOW_C.has(token)) return 'Low';
  // A two-letter token is a semester pair; a single letter is one grade.
  if (/^[A-E]{2}$/.test(token)) return performanceBandFromPair(token[0], token[1]);
  return performanceBandFromPair(token, null);
}

// ── Competency axis ──────────────────────────────────────────────────────────

/**
 * Assessment-centre recommendation → band.
 *
 * Keys are the canonical `sync_behavior_competencies.rekomendasi_name` strings
 * (the DVP_MASTER_REKOMENDASI vocabulary, listed in lib/candidate-field-values.ts).
 * Four of them are not in the methodology's own list and are placed by their
 * rank in that vocabulary, which is the order the AHP behavior scorer already
 * uses (`BEHAVIOR_RANKING` in scoring-service/src/ahp-topsis-engine.ts):
 *   • NEED DEVELOPMENT (9 MONTHS - 2 YEARS) — the methodology's
 *     "NEED TARGETED DEVELOPMENT", ranked with POTENSI → Mid Low
 *   • BELUM ADA POTENSI / VERY LOW / NOT READY — bottom of the ranking → Low
 */
const COMPETENCY_BANDS: Record<string, HavBand> = {
  STRENGTH: 'High',

  'VERY HIGH': 'Mid High',
  'PENGEMBANGAN JANGKA PENDEK': 'Mid High',

  'NEED TARGETED DEVELOPMENT': 'Mid Low',
  'NEED DEVELOPMENT (9 MONTHS - 2 YEARS)': 'Mid Low',
  'BUTUH PENGEMBANGAN': 'Mid Low',
  HIGH: 'Mid Low',
  READY: 'Mid Low',
  POTENSI: 'Mid Low',
  'MIDDLE HIGH': 'Mid Low',
  'READY WITH DEVELOPMENT': 'Mid Low',

  LOW: 'Low',
  'MIDDLE LOW': 'Low',
  'VERY LOW': 'Low',
  'NOT READY': 'Low',
  'FOCUS ON OPTIMILIZATION': 'Low',
  'FOCUS ON OPTIMIZATION': 'Low',
  'FOCUS ON OPTIMIZATION IN CURRENT POSITION': 'Low',
  'BELUM ADA POTENSI': 'Low',
};

/**
 * Collapse an HR-written recommendation to a comparable key: uppercase, single
 * spaces, en/em dashes folded to hyphens. Deliberately no more than that —
 * anything fuzzier would start banding strings nobody has verified.
 */
function normalizeCompetencyLabel(value: string): string {
  return value
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Band the competency axis. Returns null for an unrecognized recommendation
 * rather than guessing a band — an employee with an unknown label is reported
 * as uncategorized, because a wrong band is a wrong quadrant is a wrong box.
 *
 * Exact match first, then the same containment fallback the AHP behavior scorer
 * uses, which absorbs decorated ("READY WITH DEVELOPMENT (2024)") and truncated
 * forms of a known category.
 */
export function competencyBand(raw: string | null | undefined): HavBand | null {
  if (!raw) return null;
  const value = normalizeCompetencyLabel(raw);
  if (!value || value === '-') return null;

  const exact = COMPETENCY_BANDS[value];
  if (exact) return exact;

  // Longest known category contained in the value wins; failing that, the
  // shortest category that contains the value (the value is a truncation).
  let byContains: HavBand | null = null;
  let byContainsLen = -1;
  let byContained: HavBand | null = null;
  let byContainedLen = Infinity;
  for (const [category, band] of Object.entries(COMPETENCY_BANDS)) {
    if (value.includes(category) && category.length > byContainsLen) {
      byContains = band;
      byContainsLen = category.length;
    }
    if (category.includes(value) && category.length < byContainedLen) {
      byContained = band;
      byContainedLen = category.length;
    }
  }
  return byContains ?? byContained;
}

// ── Derivation ───────────────────────────────────────────────────────────────

/** Why no quadrant could be derived — surfaced so a gap names its own cause. */
export type HavDeriveGap =
  | 'performance-missing'
  | 'competency-missing'
  | 'competency-unrecognized';

export type DerivedHavQuadrant = {
  quadrant: number;
  name: string;
  /** The 5-box this quadrant rolls up to. */
  category: TalentBox;
  competencyBand: HavBand;
  performanceBand: HavBand;
  /**
   * Which semesters decided the performance band, for provenance display. Null
   * when the input was a bare methodology token (`AB`, `CC`) rather than the
   * stored six-slot CSV — there are no slots to point at.
   */
  performance: PerformanceReading | null;
};

export type HavDeriveResult =
  | ({ ok: true } & DerivedHavQuadrant)
  | { ok: false; gaps: HavDeriveGap[] };

/**
 * Derive the quadrant for one employee from their stored PA CSV and behavioral
 * recommendation. Both axes are required: the grid has no cell for "half known",
 * so a missing input yields a reason, never a default cell.
 */
export function deriveHavQuadrant(input: {
  performanceGrade: string | null | undefined;
  behaviorRecommendation: string | null | undefined;
}): HavDeriveResult {
  const gaps: HavDeriveGap[] = [];

  const reading = (input.performanceGrade ?? '').includes(',')
    ? readPerformance(input.performanceGrade)
    : null;
  const perf = reading?.band ?? performanceBand(input.performanceGrade);
  if (!perf) gaps.push('performance-missing');

  const rawBehavior = (input.behaviorRecommendation ?? '').trim();
  const comp = competencyBand(rawBehavior);
  if (!comp) gaps.push(rawBehavior ? 'competency-unrecognized' : 'competency-missing');

  if (!perf || !comp) return { ok: false, gaps };

  const quadrant = HAV_QUADRANT_MATRIX[comp][perf];
  const meta = HAV_QUADRANTS.find((q) => q.number === quadrant);
  return {
    ok: true,
    quadrant,
    name: meta?.name ?? `Q${quadrant}`,
    category: (meta?.category as TalentBox) ?? 'BOTTOM',
    competencyBand: comp,
    performanceBand: perf,
    performance: reading,
  };
}

// ── 16 quadrants → the existing 5-Box ────────────────────────────────────────

/**
 * The 16 → 5 translation. It is a lookup into HAV_QUADRANTS' own `category`
 * column, not a second rule set: that column already carries TOP / STRONG /
 * SOLID / BORDER / BOTTOM for every quadrant, so re-deriving the box from the
 * bands would create a second answer to a question the table already answers.
 */
export function talentBoxFromQuadrant(num: number | string | null | undefined): TalentBox | null {
  if (num == null || num === '') return null;
  const n = typeof num === 'string' ? parseInt(num.replace(/\D/g, ''), 10) : num;
  if (!Number.isFinite(n)) return null;
  const category = HAV_QUADRANTS.find((q) => q.number === n)?.category;
  return category ? (category as TalentBox) : null;
}

export const TALENT_BOXES: TalentBox[] = ['TOP', 'STRONG', 'SOLID', 'BORDER', 'BOTTOM'];

/** Quadrant numbers that roll up into each box — the grid read box-first. */
export const QUADRANTS_BY_TALENT_BOX: Record<TalentBox, number[]> = TALENT_BOXES.reduce(
  (acc, box) => {
    acc[box] = HAV_QUADRANTS.filter((q) => q.category === box).map((q) => q.number);
    return acc;
  },
  {} as Record<TalentBox, number[]>,
);

// ── The methodology's own 5-Box rules (three-year window) ─────────────────────

/**
 * The 5-Box stated directly, from a three-year PA window and the assessment
 * centre — the rules as HR writes them, where TOP means "A or B across all six
 * appraisal periods", not "the top band of the latest year".
 *
 * This is a SEPARATE reading from `talentBoxFromQuadrant`, and the difference is
 * the point rather than a bug to smooth over: the 16-grid bands one year, these
 * rules quantify over three. Somebody who slipped from A to C last year is TOP
 * by neither — but somebody with one C in year-3 and A/B since is STRONG here
 * and can still be Q1 on the grid. Nothing consumes this yet; it exists so the
 * two readings can be compared explicitly (and disagreements shown) instead of
 * one being quietly assumed to imply the other.
 */
export function paWindowBox(raw: string | null | undefined): TalentBox | null {
  const periods = splitPerformanceSlots(raw).filter((p): p is string => p !== null);
  if (periods.length === 0) return null;

  const graded = periods.map((p) => (PA_BELOW_C.has(p) ? 'D' : p));
  if (graded.some((g) => g === 'D' || g === 'E')) return 'BORDER'; // below C → BORDER/BOTTOM, AC decides
  if (graded.every((g) => g === 'A' || g === 'B')) return 'TOP';
  if (graded.every((g) => g === 'C')) return 'SOLID';
  return 'STRONG'; // a mix of A, B and C across the window
}

/** Assessment-centre recommendation → box tier, per the 5-Box rule list. */
const COMPETENCY_BOXES: Record<string, TalentBox> = {
  STRENGTH: 'TOP',
  'VERY HIGH': 'TOP',

  HIGH: 'STRONG',
  'PENGEMBANGAN JANGKA PENDEK': 'STRONG',
  READY: 'STRONG',

  'BUTUH PENGEMBANGAN': 'SOLID',
  'NEED TARGETED DEVELOPMENT': 'SOLID',
  'NEED DEVELOPMENT (9 MONTHS - 2 YEARS)': 'SOLID',
  POTENSI: 'SOLID',
  'MIDDLE HIGH': 'SOLID',
  'READY WITH DEVELOPMENT': 'SOLID',

  LOW: 'BORDER',
  'MIDDLE LOW': 'BORDER',
  'VERY LOW': 'BORDER',
  'FOCUS ON OPTIMILIZATION': 'BORDER',
  'FOCUS ON OPTIMIZATION': 'BORDER',
  'FOCUS ON OPTIMIZATION IN CURRENT POSITION': 'BORDER',
  'NOT READY': 'BORDER',

  // "sisa terbawahnya" — ranked below every category the BORDER list names.
  'BELUM ADA POTENSI': 'BOTTOM',
};

export function competencyBox(raw: string | null | undefined): TalentBox | null {
  if (!raw) return null;
  const value = normalizeCompetencyLabel(raw);
  if (!value || value === '-') return null;
  const exact = COMPETENCY_BOXES[value];
  if (exact) return exact;
  let byContains: TalentBox | null = null;
  let byContainsLen = -1;
  for (const [category, box] of Object.entries(COMPETENCY_BOXES)) {
    if (value.includes(category) && category.length > byContainsLen) {
      byContains = box;
      byContainsLen = category.length;
    }
  }
  return byContains;
}

/**
 * The box from both axes of the rule list. Every rule pairs a PA tier with an
 * assessment-centre tier at the same level, so where the two axes disagree the
 * WEAKER one decides — a TOP performance appraisal alongside a MIDDLE LOW
 * assessment is not a TOP talent, and the rule list has no cell that says
 * otherwise. Requires both axes; one alone yields null.
 */
export function talentBoxFromRules(input: {
  performanceGrade: string | null | undefined;
  behaviorRecommendation: string | null | undefined;
}): TalentBox | null {
  const pa = paWindowBox(input.performanceGrade);
  const ac = competencyBox(input.behaviorRecommendation);
  if (!pa || !ac) return null;
  const weaker = Math.max(TALENT_BOXES.indexOf(pa), TALENT_BOXES.indexOf(ac));
  return TALENT_BOXES[weaker] ?? null;
}
