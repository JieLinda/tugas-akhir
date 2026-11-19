// "HAV yang berlaku" — the automatic half of it, as sync-service needs it.
//
// THIRD COPY of the web app's lib/hav-effective.ts + the PA/behaviour banding of
// lib/hav-quadrant-derive.ts (the second is scoring-service/src/hav-effective.ts).
// Separate deployable, no shared lib/. tests/talent-mapping/hav-parity.test.ts
// runs all three over the same inputs; run it after touching any of them.
//
// Why sync-service needs the formula at all: HR's time rule is "whichever came
// LAST wins" between a Talent Mapping placement and a sync, and a sync changes
// the automatic HAV (upload › formula) not only through the HAV Excel but also
// by carrying a new PA or behavioural assessment from the MSSQL syncs into the
// candidate row. Knowing whether the automatic answer MOVED — and so whether to
// stamp `candidates.hav_auto_changed_at` and supersede an older placement —
// means computing the formula before and after the write. A drift here never
// throws: the stamp would land on people whose HAV did not change, and miss
// people whose HAV did.
//
// Pure: no I/O, no imports. The writer is hav-supersede.ts.

export type HavBand = "High" | "Mid High" | "Mid Low" | "Low";
export type HavSource = "manual" | "upload" | "formula" | "none";

const HAV_BANDS: HavBand[] = ["High", "Mid High", "Mid Low", "Low"];

/** (behavioural band × performance band) → quadrant, as the methodology numbers it. */
export const HAV_QUADRANT_MATRIX: Record<HavBand, Record<HavBand, number>> = {
  High: { High: 1, "Mid High": 4, "Mid Low": 6, Low: 10 },
  "Mid High": { High: 2, "Mid High": 3, "Mid Low": 5, Low: 11 },
  "Mid Low": { High: 7, "Mid High": 8, "Mid Low": 9, Low: 12 },
  Low: { High: 13, "Mid High": 14, "Mid Low": 15, Low: 16 },
};

// ── Performance axis ────────────────────────────────────────────────────────

const PA_BELOW_C = new Set(["D", "E", "C-", "C MINUS"]);
const PA_LETTERS = new Set(["A", "B", "C", "D", "E"]);
/** Newest graded periods the High/Mid High/Mid Low band reads ("2 periode terakhir"). */
const PERFORMANCE_BAND_PERIODS = 2;
/** Slots in the "pernah ada D, E, C- pada 2 tahun terakhir" window. */
const PERFORMANCE_LOW_LOOKBACK_SLOTS = 4;

function isBelowC(grade: string): boolean {
  return PA_BELOW_C.has(grade.trim().toUpperCase());
}

/** The six semester slots of candidates.performance_grade, newest first, blanks kept. */
export function splitPerformanceSlots(raw: string | null | undefined): (string | null)[] {
  const slots = (raw ?? "").split(",").map((p) => {
    const v = p.trim().toUpperCase();
    return PA_LETTERS.has(v) || PA_BELOW_C.has(v) ? v : null;
  });
  while (slots.length < 6) slots.push(null);
  return slots.slice(0, 6);
}

function performanceBandFromPair(first: string | null | undefined, second: string | null | undefined): HavBand | null {
  const normalize = (v: string | null | undefined) => {
    const s = (v ?? "").trim().toUpperCase();
    if (!s) return null;
    if (PA_BELOW_C.has(s)) return "D";
    return PA_LETTERS.has(s) ? s : null;
  };
  const a = normalize(first);
  const b = normalize(second);
  const present = [a, b].filter((v): v is string => v !== null);
  if (present.length === 0) return null;
  const pair = present.length === 1 ? [present[0]!, present[0]!] : present;
  if (pair.some((g) => g === "D" || g === "E")) return "Low";
  if (pair.every((g) => g === "A" || g === "B")) return "High";
  if (pair.every((g) => g === "C")) return "Mid Low";
  return "Mid High";
}

function readPerformanceBand(raw: string | null | undefined): HavBand | null {
  const slots = splitPerformanceSlots(raw);
  const graded: { slot: number; grade: string }[] = [];
  slots.forEach((grade, slot) => {
    if (grade) graded.push({ slot, grade });
  });
  if (graded.length === 0) return null;
  const pair = graded.slice(0, PERFORMANCE_BAND_PERIODS);
  const first = pair[0]!;
  const second = pair[1] ?? first;
  const low =
    graded.some((g) => g.slot < PERFORMANCE_LOW_LOOKBACK_SLOTS && isBelowC(g.grade)) ||
    pair.some((g) => isBelowC(g.grade));
  if (low) return "Low";
  return performanceBandFromPair(first.grade, second.grade) ?? "Low";
}

/** The performance band from the stored CSV or a bare methodology token (`AB`, `CC`, `C-`). */
export function performanceBand(raw: string | null | undefined): HavBand | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (value.includes(",")) return readPerformanceBand(value);
  const token = value.toUpperCase();
  if (PA_BELOW_C.has(token)) return "Low";
  if (/^[A-E]{2}$/.test(token)) return performanceBandFromPair(token[0], token[1]);
  return performanceBandFromPair(token, null);
}

// ── Behavioural axis ────────────────────────────────────────────────────────

const COMPETENCY_BANDS: Record<string, HavBand> = {
  STRENGTH: "High",

  "VERY HIGH": "Mid High",
  "PENGEMBANGAN JANGKA PENDEK": "Mid High",

  "NEED TARGETED DEVELOPMENT": "Mid Low",
  "NEED DEVELOPMENT (9 MONTHS - 2 YEARS)": "Mid Low",
  "BUTUH PENGEMBANGAN": "Mid Low",
  HIGH: "Mid Low",
  READY: "Mid Low",
  POTENSI: "Mid Low",
  "MIDDLE HIGH": "Mid Low",
  "READY WITH DEVELOPMENT": "Mid Low",

  LOW: "Low",
  "MIDDLE LOW": "Low",
  "VERY LOW": "Low",
  "NOT READY": "Low",
  "FOCUS ON OPTIMILIZATION": "Low",
  "FOCUS ON OPTIMIZATION": "Low",
  "FOCUS ON OPTIMIZATION IN CURRENT POSITION": "Low",
  "BELUM ADA POTENSI": "Low",
};

/** The behavioural band; null for an unrecognised label rather than a guessed band. */
export function competencyBand(raw: string | null | undefined): HavBand | null {
  if (!raw) return null;
  const value = raw.toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  if (!value || value === "-") return null;
  const exact = COMPETENCY_BANDS[value];
  if (exact) return exact;
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

/** The formula's quadrant, or null when either axis is missing or unrecognised. */
export function formulaQuadrant(input: {
  performanceGrade: string | null | undefined;
  behaviorRecommendation: string | null | undefined;
}): number | null {
  const perf = performanceBand(input.performanceGrade);
  const comp = competencyBand((input.behaviorRecommendation ?? "").trim());
  if (!perf || !comp) return null;
  return HAV_QUADRANT_MATRIX[comp][perf];
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Canonical 1..16 from any stored form ("6", "Kuadran #6"), else null. */
export function canonicalQuadrant(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const match = String(raw).match(/\d+/);
  if (!match) return null;
  const n = parseInt(match[0], 10);
  return n >= 1 && n <= 16 ? n : null;
}

export type EffectiveHav = {
  quadrant: number | null;
  source: HavSource;
  manual: number | null;
  uploaded: number | null;
  formula: number | null;
};

/** Which automatic tier the last event put in force (`candidates.hav_auto_tier`); null = the static order. */
export type HavAutomaticTier = "upload" | "formula";

/**
 * manual > automatic, where automatic is upload > formula — UNLESS the last
 * event was a PA/BA change (or "Hitung kuadran HAV"), which pins the formula
 * (`automaticTier = 'formula'`, drizzle/0098) over an older upload. A pinned
 * formula that cannot be computed falls back to the upload. Mirrors
 * lib/hav-effective.ts.
 */
export function resolveEffectiveHav(input: {
  manualQuadrant: string | number | null | undefined;
  uploadedQuadrant: string | number | null | undefined;
  performanceGrade: string | null | undefined;
  behaviorRecommendation: string | null | undefined;
  automaticTier?: HavAutomaticTier | null;
}): EffectiveHav {
  const manual = canonicalQuadrant(input.manualQuadrant);
  const uploaded = canonicalQuadrant(input.uploadedQuadrant);
  const formula = formulaQuadrant(input);
  if (manual != null) return { quadrant: manual, source: "manual", manual, uploaded, formula };
  if (input.automaticTier === "formula" && formula != null) {
    return { quadrant: formula, source: "formula", manual, uploaded, formula };
  }
  if (uploaded != null) return { quadrant: uploaded, source: "upload", manual, uploaded, formula };
  if (formula != null) return { quadrant: formula, source: "formula", manual, uploaded, formula };
  return { quadrant: null, source: "none", manual, uploaded, formula };
}

/** Exposed for the parity test: the band order both copies must agree on. */
export const HAV_BAND_ORDER = HAV_BANDS;
