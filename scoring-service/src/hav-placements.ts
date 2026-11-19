// The manual tier of the HAV in force: Talent Mapping placements, decrypted.
// See hav-effective.ts for the precedence and the web app's lib/hav-placements.ts
// for its twin.
//
// A placement counts only while it is NEWER than candidates.hav_auto_changed_at
// — the last time a sync changed that person's automatic HAV (drizzle/0080;
// whichever happened last wins). Same predicate as the web app's loader, so the
// eligibility rules and the HAV aspect can never read two different HAVs for one
// person; keep the two in step.
//
// Looked up by candidate id alone — a scoring pool may span business units, and
// a candidate's placement can only have been made in their own unit's Talent
// Mapping. A failure here (drizzle/0078 not yet applied, a transient error)
// degrades to "no manual placements" so a scoring run is never lost to it; the
// run then reports every HAV as upload/formula, which is exactly what it used.

import { query } from "./db/postgres.js";
import { decryptField, ensureUnlocked } from "./services/crypto.js";
import { canonicalQuadrant, resolveEffectiveHav, type EffectiveHav, type HavSource } from "./hav-effective.js";

let warnedUnavailable = false;
let warnedNoClock = false;

/** Placements in force: newer than the last sync change, or no sync change at all. */
const IN_FORCE_SQL = `
  SELECT p.candidate_id AS "candidateId", p.quadrant
    FROM talent_mapping_placements p
    JOIN candidates c ON c.id = p.candidate_id
   WHERE p.candidate_id = ANY($1::uuid[])
     AND (c.hav_auto_changed_at IS NULL OR p.updated_at > c.hav_auto_changed_at)`;

/** Before drizzle/0080 no sync event was timestamped, so every stored placement stands. */
const PRECEDENCE_ONLY_SQL = `
  SELECT candidate_id AS "candidateId", quadrant
    FROM talent_mapping_placements
   WHERE candidate_id = ANY($1::uuid[])`;

function isUndefinedColumn(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "42703");
}

export async function loadManualHavQuadrants(candidateIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  if (ids.length === 0) return out;
  await ensureUnlocked();
  let rows: { candidateId: string; quadrant: string }[];
  try {
    try {
      rows = await query<{ candidateId: string; quadrant: string }>(IN_FORCE_SQL, [ids]);
    } catch (err) {
      if (!isUndefinedColumn(err)) throw err;
      if (!warnedNoClock) {
        console.warn("[hav-placements] candidates.hav_auto_changed_at missing (drizzle/0080); comparing by precedence only");
        warnedNoClock = true;
      }
      rows = await query<{ candidateId: string; quadrant: string }>(PRECEDENCE_ONLY_SQL, [ids]);
    }
  } catch (err) {
    if (!warnedUnavailable) {
      console.warn("[hav-placements] talent_mapping_placements unreadable; manual HAV tier skipped:", String(err));
      warnedUnavailable = true;
    }
    return out;
  }
  for (const row of rows) {
    const quadrant = canonicalQuadrant(decryptField(row.quadrant));
    if (quadrant != null) out.set(row.candidateId, quadrant);
    else console.warn(`[hav-placements] placement for candidate ${row.candidateId} could not be opened`);
  }
  return out;
}

let warnedNoTier = false;

/**
 * Candidates whose last HAV event was a PA/BA change (or "Hitung kuadran HAV"):
 * `candidates.hav_auto_tier = 'formula'` (drizzle/0098), which puts the formula
 * above an older upload. Same read as the web app's loadHavOverrides. Before
 * the migration nobody is pinned — the static order, exactly as before.
 */
export async function loadHavFormulaPins(candidateIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  const out = new Set<string>();
  if (ids.length === 0) return out;
  try {
    const rows = await query<{ id: string }>(
      `SELECT id FROM candidates WHERE id = ANY($1::uuid[]) AND hav_auto_tier = 'formula'`,
      [ids],
    );
    for (const row of rows) out.add(row.id);
  } catch (err) {
    if (!warnedNoTier) {
      console.warn("[hav-placements] candidates.hav_auto_tier unreadable (drizzle/0098?); static HAV order only:", String(err));
      warnedNoTier = true;
    }
  }
  return out;
}

/**
 * Fold the HAV in force into decrypted candidate rows: `havQuadrant` becomes the
 * quadrant in force (as the string the scorers expect), `havSource` says where it
 * came from. The HAV scorer reads `havQuadrant` unchanged.
 */
export async function withEffectiveHav<
  T extends { id: string; havQuadrant: string | null; performanceGrade: string | null; behaviorRecommendation: string | null },
>(
  rows: T[],
  /**
   * Demo sessions (drizzle/0093): candidates whose demo copy EDITS the HAV
   * (demo-overlay.ts `havEditedIds`). Their real manual placements must not
   * outrank that edit, exactly as the web app's withEffectiveHav does; a HAV
   * nobody edited resolves as usual over the merged PA and behaviour.
   */
  opts: {
    ignorePlacementsFor?: Set<string>;
    /**
     * Demo sessions: candidates whose demo copy pinned the formula (a PA/BA
     * edit or "Hitung kuadran HAV" in demo mode, demo-overlay.ts
     * `havFormulaPinnedIds`). The formula outranks their real placement AND
     * their real upload, as the web app's withEffectiveHav does.
     */
    formulaPinnedFor?: Set<string>;
  } = {},
): Promise<(T & { havSource: HavSource; effectiveHav: EffectiveHav })[]> {
  const ids = rows.map((r) => r.id);
  const [manual, pins] = await Promise.all([loadManualHavQuadrants(ids), loadHavFormulaPins(ids)]);
  for (const id of opts.ignorePlacementsFor ?? []) manual.delete(id);
  for (const id of opts.formulaPinnedFor ?? []) {
    manual.delete(id);
    pins.add(id);
  }
  // A demo HAV EDIT outranks a real formula pin too: the edit is the answer.
  // (formulaPinnedFor never holds an edited id — havFormulaPinnedIds excludes them.)
  for (const id of opts.ignorePlacementsFor ?? []) pins.delete(id);
  return rows.map((row) => {
    const effectiveHav = resolveEffectiveHav({
      manualQuadrant: manual.get(row.id) ?? null,
      uploadedQuadrant: row.havQuadrant,
      performanceGrade: row.performanceGrade,
      behaviorRecommendation: row.behaviorRecommendation,
      automaticTier: pins.has(row.id) ? "formula" : null,
    });
    return {
      ...row,
      havQuadrant: effectiveHav.quadrant != null ? String(effectiveHav.quadrant) : null,
      havSource: effectiveHav.source,
      effectiveHav,
    };
  });
}

/** Count of candidates per HAV source — what a run records about the HAV it scored. */
export function countHavSources(rows: { havSource?: HavSource }[]): Record<HavSource, number> {
  const counts: Record<HavSource, number> = { manual: 0, upload: 0, formula: 0, none: 0 };
  for (const row of rows) counts[row.havSource ?? "none"] += 1;
  return counts;
}
