/**
 * Which aspect scores — and which HAV quadrant — a ranked row DISPLAYS: on the
 * Kandidat tab's chips, the dossier, the comparison, the Excel export and both
 * printed reports.
 *
 * The rule: the run's own stored values, verbatim. Both scoring engines write
 * every aspect into `analysis_results.details.scoreBreakdown`, and those are the
 * values the ranking was computed from. A finished run is a record of an
 * assessment on a date (I-1), so nothing read from today's candidate row may
 * stand in for one of them.
 *
 * Two overrides used to break that, both in `getScoringRunResults`:
 *  - PA was recomputed from the candidate's CURRENT grade on every row, so once
 *    a sync brought a new PA the chip, the export and the print showed a score
 *    the ranking never used, beside a criterion panel showing the stored one.
 *  - A stored technical of 0 was replaced by a live average of the candidate's
 *    competency scores (50 when they had none). 0 is a real result — nothing in
 *    the candidate's set matched what the seat demands — and it is what the
 *    ranking used.
 *
 * A live value is used only where the stored row carries no number at all for
 * that aspect (rows from the old demo seeder, which wrote no details): there is
 * nothing recorded to prefer. Pure and dependency-free so it can be pinned by a
 * test (`tests/scoring/run-score-breakdown.test.ts`); `lib/scoring-engine.ts` is a
 * "use server" module and may not export it.
 */

export type ScoreBreakdown = {
  technical: number;
  behavior: number;
  hav: number;
  performance: number;
  education: number;
  career?: number;
};

/** The two aspects a row without stored details falls back to computing live. */
export type LiveFallback = {
  technical: number;
  /** Lazy: computing PA parses the grade history, which a stored row never needs. */
  performance: () => number;
};

/**
 * Where a ranked row's displayed HAV quadrant comes from:
 * - `run`: the quadrant the run scored, as it recorded it (null = the candidate
 *   had no HAV at the time);
 * - `not_recorded`: the row stores no per-criterion record (a legacy row of
 *   another method, or a detail-less seeder row);
 * - `locked`: recorded, but sealed and the encryption key is not available.
 */
export type HavQuadrantSource = 'run' | 'not_recorded' | 'locked';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * The HAV quadrant a ranked row DISPLAYS — the run's, never today's.
 *
 * It used to be the candidate's HAV in force TODAY (manual > upload > formula),
 * laid over the row on purpose as "what the next run would score". That put a
 * quadrant beside the run's HAV score that the score was not computed from: a
 * Talent Mapping move or a HAV upload after the run changed the chip, the
 * dossier, the comparison, the Excel export and the print, while the score and
 * the criterion panel kept the run's.
 *
 * A row recorded its quadrant when it carries the AHP+TOPSIS record
 * (`ahpTopsis`, whose top-level `havQuadrant` is the raw string the engine
 * scored). A row without it may hold `havQuadrant: null` regardless, so its null
 * means "not recorded", not "no HAV" — hence the marker check rather than
 * reading the field alone. A value still in the `v1:` sealed format after the
 * snapshot was decrypted could not be opened (key unavailable).
 *
 * @param details the row's stored details, already through
 *                `decryptCandidateDetailsSnapshot`; null when it has none
 */
export function recordedHavQuadrant(
  details: Record<string, unknown> | null | undefined,
): { quadrant: string | null; source: HavQuadrantSource } {
  if (!details || !isRecord(details.ahpTopsis)) {
    return { quadrant: null, source: 'not_recorded' };
  }
  const v = details.havQuadrant;
  if (v == null || v === '') return { quadrant: null, source: 'run' };
  const s = String(v);
  if (s.startsWith('v1:')) return { quadrant: null, source: 'locked' };
  return { quadrant: s, source: 'run' };
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * @param base   the breakdown the row starts from: the stored one when the row
 *               has details, otherwise the placeholder built for a detail-less row
 * @param stored the stored `details.scoreBreakdown`, or null/undefined when the
 *               row has none
 * @param live   the live fallbacks, used only for an aspect `stored` lacks
 */
export function displayedScoreBreakdown(
  base: ScoreBreakdown,
  stored: Partial<Record<keyof ScoreBreakdown, unknown>> | null | undefined,
  live: LiveFallback,
): ScoreBreakdown {
  return {
    ...base,
    technical: finiteNumber(stored?.technical) ?? live.technical,
    performance: finiteNumber(stored?.performance) ?? live.performance(),
  };
}
