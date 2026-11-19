/**
 * Reconcile the two competency lists a Job Profile PDF carries.
 *
 * WHY THIS EXISTS: the extraction is a vision model reading a scanned table, and
 * the page puts BEHAVIORAL COMPETENCY and TECHNICAL COMPETENCY in two different
 * arrangements — sometimes stacked, sometimes SIDE BY SIDE. Read side-by-side,
 * one visual row spans both tables:
 *
 *   Passion for Excellence | Leadership | Consumer Engagement Techniques | 1 | ...
 *   \___________ behavioral __________/ \___________ technical ____________/
 *
 * so a model that follows the row lands technical names in `behavioralCompetencies`
 * and vice versa. The technical table compounds it by packing TWO (name, level)
 * pairs per row, which is where a dropped level comes from.
 *
 * Until now nothing checked: `extractJobProfile`'s output went straight into
 * `sync_job_profiles.extracted_data` via `JSON.stringify`. The failure was then
 * silent at every later layer — the detail page's `toStringList` DROPS a
 * non-string, so a technical object landing in the behavioral list renders as
 * nothing at all, and `normalizeRequiredLevel` in the scoring engine turns a
 * missing level into a plausible `2`. A wrong answer that looks like a right one.
 *
 * A better prompt reduces the rate; it cannot make it zero, because the model is
 * guessing at a layout. So this module decides the question deterministically
 * afterwards, from two facts the document itself guarantees:
 *
 *   1. Only the TECHNICAL table has a level column. A level is proof of technical.
 *   2. The kamus (`sync_kamus_kompetensi`, "Dictionary Technical Competency for
 *      MPM") is the authoritative list of technical competency names.
 *
 * Neither is sufficient alone — the kamus covers roughly two thirds of the names
 * that appear in real JDs, and a mis-read row can lose the level that would have
 * proved the rest — so they are combined, with the closed behavioral vocabulary
 * as the third input.
 *
 * Nothing here invents data. An item it cannot classify stays exactly where the
 * model put it, and a level it cannot read stays `null` rather than becoming a
 * guess — `null` is the honest answer, and the warnings say so out loud.
 */

import { query } from "../db/postgres.js";

// ── Types ────────────────────────────────────────────────────

export type TechnicalCompetency = { competency: string; level: number | null };

export type CompetencyWarning = {
  kind:
    | "moved-to-technical"
    | "moved-to-behavioral"
    | "missing-level"
    | "dropped-empty"
    | "duplicate";
  competency: string;
  detail: string;
};

export type ReconciledCompetencies = {
  behavioral: string[];
  technical: TechnicalCompetency[];
  warnings: CompetencyWarning[];
};

/**
 * MPM's behavioural framework, as printed in the BEHAVIORAL COMPETENCY box.
 *
 * Deliberately a SEED, not a gate: a name that is not here and carries no level
 * is left where the model put it. Listing a name here only says "if this turns
 * up among the technical competencies, it was a mis-read" — so entries must be
 * unambiguous. Anything that could legitimately be a technical competency in the
 * kamus (Performance Management, Risk Management, Project Management — all of
 * which appear in real technical tables WITH levels) is deliberately absent.
 */
const BEHAVIORAL_VOCABULARY = [
  "PASSION FOR EXCELLENCE",
  "CUSTOMER FOCUS",
  "CONTINUOUS IMPROVEMENT",
  "ADAPTABILITY",
  "TEAM WORK",
  "TEAMWORK",
  "LEADERSHIP",
  "TARGET SETTING AND MONITORING",
  "COACHING",
  "DEVELOP TALENT",
  "DEVELOPING TALENT",
  "PROBLEM SOLVING",
  "DECISION MAKING",
  "COMMUNICATION",
  "ANALYTICAL THINKING",
  "BUILDING PARTNERSHIP",
  "PLANNING AND ORGANIZING",
  "DRIVING EXECUTION",
  "INTEGRITY",
];

/**
 * Canonical form for name comparison. Mirrors `normalizeCompName` in
 * scoring-service's ahp-topsis-engine so a name this module calls technical is
 * the same name that engine will later try to resolve against the kamus.
 */
export function normalizeCompetencyName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BEHAVIORAL_KEYS = new Set(BEHAVIORAL_VOCABULARY.map(normalizeCompetencyName));

/** True when the name is one of the printed behavioural competencies. */
export function isKnownBehavioral(name: string): boolean {
  return BEHAVIORAL_KEYS.has(normalizeCompetencyName(name));
}

// ── Level parsing ────────────────────────────────────────────

/**
 * A proficiency level as an integer 1..4, or null when the document did not
 * legibly state one.
 *
 * `null` rather than a default is the whole point. The scoring engine's
 * `normalizeRequiredLevel` already substitutes 2 for an absent level, which is a
 * reasonable thing for IT to do and a terrible thing for THIS layer to do: once
 * a guess is written into `extracted_data` it is indistinguishable from a level
 * the document really stated, and nobody can ever audit it again.
 *
 * Accepts the shapes the model actually emits: 1, "1", "Level 1", "2 =
 * Intermediate", "Basic". A bare word is matched before digits so "Level 4" does
 * not become 4 by way of the word rather than the number — both give 4 here, but
 * "Intermediate (2)" must not be read as anything but 2.
 */
export function parseCompetencyLevel(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 1 && value <= 4 ? Math.round(value) : null;
  }
  const text = String(value).trim();
  if (!text) return null;

  const upper = text.toUpperCase();
  // Word forms first: the kamus column names, and the labels the prompt uses.
  if (/\bBASIC\b|\bNOVICE\b/.test(upper)) return 1;
  if (/\bINTERMEDIATE\b/.test(upper)) return 2;
  if (/\bADVANCE(D)?\b/.test(upper)) return 3;
  if (/\bEXPERT\b|\bMASTERY\b/.test(upper)) return 4;

  // Then a bare digit 1-4. Anchored to a token boundary so "Level 10" or a
  // stray page number cannot be harvested as a level.
  const digit = text.match(/(?:^|[^0-9])([1-4])(?:[^0-9]|$)/);
  return digit ? parseInt(digit[1]!, 10) : null;
}

// ── Kamus lookup ─────────────────────────────────────────────

/**
 * Normalized names of every technical competency in the dictionary.
 *
 * Degrades to an EMPTY SET on any failure — an unsynced or unreachable kamus
 * must not fail a job-profile extraction, and an empty set simply means this
 * rule abstains and the level/vocabulary rules decide alone. Loaded once per
 * sync run by the caller and passed in, not re-queried per file.
 */
export async function loadKamusNameKeys(): Promise<Set<string>> {
  try {
    const rows = await query<{ name: string }>(
      `SELECT name FROM sync_kamus_kompetensi WHERE name IS NOT NULL`,
    );
    return new Set(rows.map((r) => normalizeCompetencyName(r.name)).filter(Boolean));
  } catch (err) {
    console.warn(
      `[JOB-PROFILE] kamus lookup unavailable, competency reclassification will rely on levels alone: ${
        (err as Error).message
      }`,
    );
    return new Set();
  }
}

// ── Reconciliation ───────────────────────────────────────────

/** Pull a usable name out of whatever shape the model produced for an entry. */
function entryName(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return String(o.competency ?? o.name ?? o.technicalName ?? o.behavioral ?? "").trim();
  }
  return "";
}

/** Pull a level out of an entry, if it carries one at all. */
function entryLevel(item: unknown): number | null {
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    return parseCompetencyLevel(o.level ?? o.targetProficiency ?? o.proficiency);
  }
  return null;
}

/**
 * Sort each extracted competency into the list the DOCUMENT puts it in.
 *
 * Decision order, strongest evidence first:
 *   1. printed behavioural vocabulary  → behavioral (and any level is dropped,
 *      because the behavioural table has no level column — a level on one of
 *      these names is residue from a mis-read row)
 *   2. present in the kamus            → technical
 *   3. carries a legible level 1..4    → technical
 *   4. neither                         → stays where the model put it
 *
 * Rule 1 outranks rule 2 so that a behavioural name which also happens to exist
 * in the dictionary cannot be dragged across; the vocabulary is curated to keep
 * that case empty, and the ordering makes it safe if it ever stops being.
 */
export function reconcileCompetencies(
  rawBehavioral: unknown,
  rawTechnical: unknown,
  kamusKeys: Set<string>,
): ReconciledCompetencies {
  const warnings: CompetencyWarning[] = [];
  const behavioral: string[] = [];
  const technical: TechnicalCompetency[] = [];
  const seenBehavioral = new Set<string>();
  const seenTechnical = new Set<string>();

  const pushBehavioral = (name: string, from: "behavioral" | "technical") => {
    const key = normalizeCompetencyName(name);
    if (!key) return;
    if (seenBehavioral.has(key)) {
      warnings.push({ kind: "duplicate", competency: name, detail: "duplicate behavioral entry" });
      return;
    }
    seenBehavioral.add(key);
    behavioral.push(name);
    if (from === "technical") {
      warnings.push({
        kind: "moved-to-behavioral",
        competency: name,
        detail: "printed behavioural competency found among the technical list",
      });
    }
  };

  const pushTechnical = (
    name: string,
    level: number | null,
    from: "behavioral" | "technical",
    reason: string,
  ) => {
    const key = normalizeCompetencyName(name);
    if (!key) return;
    if (seenTechnical.has(key)) {
      // Keep the entry that actually carries a level: two halves of one mis-read
      // row can produce the same name twice, once with the level and once without.
      const existing = technical.find((t) => normalizeCompetencyName(t.competency) === key);
      if (existing && existing.level == null && level != null) existing.level = level;
      warnings.push({ kind: "duplicate", competency: name, detail: "duplicate technical entry" });
      return;
    }
    seenTechnical.add(key);
    technical.push({ competency: name, level });
    if (from === "behavioral") {
      warnings.push({ kind: "moved-to-technical", competency: name, detail: reason });
    }
    if (level == null) {
      warnings.push({
        kind: "missing-level",
        competency: name,
        detail: "no legible level 1-4 in the document; left null rather than guessed",
      });
    }
  };

  const classify = (item: unknown, from: "behavioral" | "technical") => {
    const name = entryName(item);
    if (!name) {
      warnings.push({ kind: "dropped-empty", competency: "", detail: `empty ${from} entry` });
      return;
    }
    const level = entryLevel(item);

    if (isKnownBehavioral(name)) {
      pushBehavioral(name, from);
      return;
    }
    if (kamusKeys.has(normalizeCompetencyName(name))) {
      pushTechnical(name, level, from, "name is in the technical competency dictionary");
      return;
    }
    if (level != null) {
      pushTechnical(name, level, from, "entry carries a proficiency level, which only the technical table has");
      return;
    }
    if (from === "technical") pushTechnical(name, null, from, "");
    else pushBehavioral(name, from);
  };

  for (const item of Array.isArray(rawBehavioral) ? rawBehavioral : []) classify(item, "behavioral");
  for (const item of Array.isArray(rawTechnical) ? rawTechnical : []) classify(item, "technical");

  return { behavioral, technical, warnings };
}

/** One-line summary for the sync log. Empty string when nothing was wrong. */
export function summarizeWarnings(warnings: CompetencyWarning[]): string {
  if (warnings.length === 0) return "";
  const counts = new Map<string, number>();
  for (const w of warnings) counts.set(w.kind, (counts.get(w.kind) ?? 0) + 1);
  return [...counts.entries()].map(([k, n]) => `${k}=${n}`).join(" ");
}
