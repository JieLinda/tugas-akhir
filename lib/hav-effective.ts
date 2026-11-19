/**
 * "HAV yang berlaku" — the ONE HAV quadrant every reader uses: the Talent Pool
 * and scoring eligibility rules, the AHP/LLM HAV aspect, the candidate profile,
 * Beranda. Pure and client-safe; the server loader is lib/hav-placements.ts.
 *
 * PRECEDENCE (HR decision, 2026-10)
 * ---------------------------------
 *   1. manual   — a placement saved on Talent Mapping (talent_mapping_placements)
 *   2. upload   — the HAV Excel (sync_hav → candidates.hav_quadrant)
 *   3. formula  — PA × behavioural assessment (deriveHavQuadrant)
 *   4. none
 *
 * A CHANGE TO PA OR BEHAVIOUR PUTS THE FORMULA IN FORCE (HR decision, 2026-11)
 * ---------------------------------------------------------------------------
 * The static order above is what applies when nothing has happened. But an
 * edit of PA or behaviour on the Kandidat form, a PA/BA workbook upload or MSSQL
 * sync that changes the candidate's PA/BA, and the "Hitung kuadran HAV" button
 * are each a statement that the HAV should follow the formula NOW — over an
 * older upload as well as an older placement. That is recorded on the candidate
 * as `candidates.hav_auto_tier = 'formula'` (drizzle/0098) and passed here as
 * `automaticTier`; a later HAV upload that differs sets it back to 'upload'. A
 * pinned formula that cannot be computed (PA or BA vanished since) falls back to
 * the upload rather than to nothing — data going missing is not a decision.
 *
 * TIME decides between 1 and the rest: whichever happened LAST wins. A
 * placement is in force only while it is newer than the last SYNC that changed
 * the automatic answer (2–3) — a HAV upload, the shared HAV.xlsx, or the
 * candidate sync carrying a new PA/BA from MSSQL (`candidates.hav_auto_changed_at`,
 * drizzle/0080). That comparison happens where placements are loaded
 * (lib/hav-placements.ts, SQL), and the sync that moves the clock deletes the
 * older placement and logs it (sync-service hav-supersede.ts) — so a
 * `manualQuadrant` that reaches this function has already won on time, and the
 * function itself stays pure precedence.
 *
 * THE FORMULA COUNTS, DELIBERATELY
 * --------------------------------
 * A formula-derived HAV is a pure function of PA and behaviour, both of which
 * are AHP aspects of their own, so letting it reach scoring re-weighs those two
 * inputs (behaviour 35% + PA 10% + HAV 20% on the default matrix). That was put
 * to HR as a choice, and the answer was to use it — below the upload, above
 * nothing. Every run records which source each candidate's HAV came from
 * (`rawInputs.havSource`), so the overlap is visible rather than hidden.
 *
 * MIRRORED in scoring-service/src/hav-effective.ts and
 * sync-service/src/services/hav-effective.ts (separate deployables, no shared
 * lib/ — sync-service needs the formula to know when a PA/BA write MOVED the
 * automatic answer). tests/talent-mapping/hav-parity.test.ts pins all three
 * together; run it after touching any of them.
 */

import { normalizeHavQuadrant } from './hav-quadrant';
import { deriveHavQuadrant, splitPerformanceSlots, type HavDeriveResult } from './hav-quadrant-derive';

export type HavSource = 'manual' | 'upload' | 'formula' | 'none';

/** The fallback a manual placement overrides: upload, else formula. */
export type HavAutomaticSource = Exclude<HavSource, 'manual'>;

export const HAV_SOURCE_LABEL: Record<HavSource, string> = {
  manual: 'Manual (Talent Mapping)',
  upload: 'Upload HAV',
  formula: 'Rumus PA × BA',
  none: 'Belum ada',
};

export type EffectiveHav = {
  /** The quadrant in force, 1..16, or null. */
  quadrant: number | null;
  source: HavSource;
  /** The Talent Mapping placement, when one is in force. */
  manual: number | null;
  /** The HAV Excel value (candidates.hav_quadrant), canonicalized. */
  uploaded: number | null;
  /** The formula's full answer, kept even when another source won. */
  formula: HavDeriveResult;
  /** What applies without a manual placement — the square a revert returns to. */
  automatic: { quadrant: number | null; source: HavAutomaticSource };
};

function toQuadrant(value: string | number | null | undefined): number | null {
  const canonical = normalizeHavQuadrant(value);
  return canonical ? Number(canonical) : null;
}

/** Which automatic tier the last event put in force (`candidates.hav_auto_tier`); null = the static order. */
export type HavAutomaticTier = 'upload' | 'formula';

export function resolveEffectiveHav(input: {
  manualQuadrant: number | string | null | undefined;
  uploadedQuadrant: number | string | null | undefined;
  performanceGrade: string | null | undefined;
  behaviorRecommendation: string | null | undefined;
  automaticTier?: HavAutomaticTier | null;
}): EffectiveHav {
  const manual = toQuadrant(input.manualQuadrant);
  const uploaded = toQuadrant(input.uploadedQuadrant);
  const formula = deriveHavQuadrant({
    performanceGrade: input.performanceGrade,
    behaviorRecommendation: input.behaviorRecommendation,
  });
  const automatic: EffectiveHav['automatic'] =
    input.automaticTier === 'formula' && formula.ok
      ? { quadrant: formula.quadrant, source: 'formula' }
      : uploaded != null
      ? { quadrant: uploaded, source: 'upload' }
      : formula.ok
        ? { quadrant: formula.quadrant, source: 'formula' }
        : { quadrant: null, source: 'none' };

  if (manual != null) {
    return { quadrant: manual, source: 'manual', manual, uploaded, formula, automatic };
  }
  return { quadrant: automatic.quadrant, source: automatic.source, manual: null, uploaded, formula, automatic };
}

/** The effective quadrant in the string form the filter engine and the UI compare ("1".."16" or null). */
export function effectiveHavString(hav: EffectiveHav): string | null {
  return hav.quadrant != null ? String(hav.quadrant) : null;
}

/** PA as compared for "did it change": the six graded slots, blanks kept, so formatting never counts. */
export function comparablePerformance(raw: string | null | undefined): string {
  const slots = splitPerformanceSlots(raw);
  return slots.every((v) => v == null) ? '' : slots.map((v) => v ?? '').join(',');
}

/** BA as compared for "did it change": uppercase, single spaces, dashes folded. */
export function comparableBehavior(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

/**
 * True when PA or behaviour differs between two readings of one candidate — the
 * event that puts the formula in force (drizzle/0098). Mirrors sync-service
 * hav-order.ts `paBaChanged`, pinned together by the parity test.
 */
export function paBaChanged(
  before: { performanceGrade: string | null | undefined; behaviorRecommendation: string | null | undefined },
  after: { performanceGrade: string | null | undefined; behaviorRecommendation: string | null | undefined },
): boolean {
  return (
    comparablePerformance(before.performanceGrade) !== comparablePerformance(after.performanceGrade) ||
    comparableBehavior(before.behaviorRecommendation) !== comparableBehavior(after.behaviorRecommendation)
  );
}
