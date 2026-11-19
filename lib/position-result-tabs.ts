// ── The result tabs of the position page, as data ──
//
// Two components need the same answer to "which tab does this URL open":
// `PositionRunSection` (which owns the tab state and mirrors it into `?tab=`)
// and `PositionDetailTabs` (which renders the triggers). They used to keep
// their own lists, so hiding a tab in one left a URL that still opened it in
// the other. Pure and client-safe.

import { RESULT_TAB_ALIASES, RUN_COMPARE_TAB } from './run-history';

/**
 * The AI Assistant tab is HIDDEN, not deleted: its panel, the chat export and
 * the ask-AI handoff all still exist and come back by flipping this flag. While
 * it is off the tab has no trigger, `?tab=ai-assistant` opens Kandidat, and the
 * "Tanya AI" buttons on derivation panels are not rendered — a button that
 * switched to a tab nobody can see would strand the reader.
 */
export const AI_ASSISTANT_TAB_ENABLED = false;

export const DEFAULT_RESULT_TAB = 'candidates';

/**
 * Every tab a URL may open, in menu order. "Konfigurasi" exists only for
 * AHP + TOPSIS runs; the tabs component falls back to Kandidat when the run on
 * screen is not one.
 */
export const RESULT_TAB_IDS: readonly string[] = [
  'candidates',
  'readiness',
  'analisis-visual',
  'komparasi',
  ...(AI_ASSISTANT_TAB_ENABLED ? ['ai-assistant'] : []),
  'job-family-map',
  'konfigurasi-run',
  RUN_COMPARE_TAB,
];

/** `?tab=` → the tab to open: current ids as-is, retired ids via their alias, anything else Kandidat. */
export function parseResultTab(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_RESULT_TAB;
  const id = RESULT_TAB_ALIASES[raw] ?? raw;
  return RESULT_TAB_IDS.includes(id) ? id : DEFAULT_RESULT_TAB;
}
