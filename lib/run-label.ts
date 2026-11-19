/**
 * Composition rules for `scoring_runs.label` / `tournament_sessions.label`.
 *
 * A derived run names itself `<delta> — <base label> — <timestamp>`. Because the
 * base is itself a derived label, naive composition nests: every re-run adds a
 * delta to the front and a timestamp to the back, so the string grows by ~45
 * characters per run and eventually overflows the `varchar(255)` column, failing
 * the INSERT rather than the scoring. `buildDerivedRunLabel` collapses that
 * chain instead of nesting it — the run keeps its own delta and its own
 * timestamp, and the *core* (the original run's name) is carried through
 * unchanged, so the label is bounded no matter how many re-runs deep it is.
 *
 * Dropping the intermediate deltas loses nothing: run lineage is recorded
 * structurally (`final_ranked.runInfo`, `scoring_run_exclusions`, and the
 * predecessor chain read by `lib/progress-running-actions.ts`), and
 * `compactRunLabel` in `lib/activity-thread.ts` only ever reads the leading
 * segment — which is why the head must stay whole when anything is elided.
 */

import { formatDateTime } from '@/lib/datetime';

/** `varchar(255)` on both label columns (`lib/db/schema.ts`). */
export const RUN_LABEL_MAX_LENGTH = 255;

/** Segment separator — space, em dash, space. */
export const RUN_LABEL_SEPARATOR = ' — ';

/**
 * The delta prefixes the re-run actions prepend, in every vocabulary this app
 * has used. `RERUN_MODES[*].delta` in `lib/rerun-modes.ts` is the source of
 * truth for the current set; `assertDeltaSegmentCoversRerunModes` below ties
 * this regex to it so adding a sixth mode fails loudly instead of silently
 * un-stripping.
 *
 * Current (the five-mode table):
 *   `+2 kandidat`  ·  `+2 kandidat (data terbaru)`  ·  `−1 kandidat`
 *   `tanding finalis`  ·  `data terbaru`
 *
 * Legacy (pre-refactor, still sitting in `scoring_runs.label`):
 *   `Re-scoring (+2 kandidat)` · `Re-ranking (−1 kandidat)` ·
 *   `Run pool penuh (+2 kandidat)`
 *
 * Missing a delta shape is the growth failure, and it was live: the rerun-modes
 * refactor changed the wording without updating this pattern, so none of the
 * five current deltas matched and every derived run stacked its prefix onto its
 * base's — `+1 kandidat — +1 kandidat (data terbaru) — <core> — <stamp>`, about
 * 15–28 characters per generation, heading for the `varchar(255)` INSERT.
 *
 * The sign class covers both the ASCII hyphen and the U+2212 minus actually
 * emitted by the exclusion re-run.
 */
const DELTA_SEGMENT = new RegExp(
  '^(?:' +
    // Current: a signed candidate count, optionally tagged "(data terbaru)".
    '[+−-]\\d+\\s*kandidat(?:\\s*\\(data terbaru\\))?' +
    '|' +
    // Current: the two count-free deltas.
    'tanding finalis' +
    '|' +
    'data terbaru' +
    '|' +
    // Legacy: named mode with a parenthesised count.
    '(?:Re-scoring|Re-ranking|Run pool penuh)\\s*\\([+−-]\\d+\\s*kandidat\\)' +
    ')$',
  'i',
);

/**
 * A date-or-timestamp tail, in EVERY shape this app has ever written. All four
 * alternatives are load-bearing; the list was verified against the 183 real
 * labels in `scoring_runs`, not inferred from the code that writes them.
 *
 *   `2026-08-24 11:05`   current — `formatDateTime`, appended by a derived run.
 *   `2026-08-24`         current — `formatDate`, the tail of a BASE run's label
 *                        (`<program> — <position> — <date>`, written by the
 *                        scoring wizard and `lib/scoring-engine.ts`).
 *   `24/8/2026`          legacy — `toLocaleDateString('id-ID')`, unpadded, so
 *                        the day and month groups must allow one digit.
 *   `3 Agu 2026, 13.49`  legacy — the localised timestamp used before the app
 *                        standardised on ISO ordering.
 *
 * Two distinct failures come from missing a shape, and the *date-only* ones are
 * the reason this list is not just the timestamp forms:
 *
 *  • Duplication. A base label already ends in a date. If the stripper does not
 *    recognise it, `buildDerivedRunLabel` carries it through as part of the core
 *    AND appends its own stamp, so the run reads
 *    `… — IT APPLICATION DEVELOPMENT ANALYST — 2026-08-24 — 2026-08-24 13:02`.
 *    Two dates, which reads as a formatting bug because it is one. Measured: 15
 *    of 183 labels hit this, 12 legacy-slash and 3 written after the ISO switch.
 *
 *  • Growth. A missed shape that sits where the NEXT generation also appends
 *    would accumulate one stamp per re-run, ~45 chars each, until the
 *    `varchar(255)` INSERT fails — surfacing as a failed scoring run rather than
 *    a labelling bug. (Measured on the real labels this does not currently
 *    happen, because the appended tail was always recognised even when the
 *    embedded one was not; the duplication was the live symptom.)
 *
 * Dropping the base run's own date loses nothing: run lineage is structural
 * (`scoring_runs.parent_run_id`, `runInfo`), the derived run carries its own
 * stamp, and every reader that wants the base run's date reads its row.
 *
 * The cost is that a custom label deliberately ENDING in a date has that date
 * treated as scaffolding on re-run. Accepted: the alternative is a label that
 * grows or repeats itself, and `runLabelCore` still returns the whole string
 * when stripping would leave nothing.
 */
const STAMP_SEGMENT = new RegExp(
  '^(?:' +
    // 2026-08-24, optionally followed by a time
    '\\d{4}-\\d{2}-\\d{2}(?:\\s+\\d{1,2}[.:]\\d{2}(?::\\d{2})?)?' +
    '|' +
    // 24/8/2026 or 24/08/2026, optionally followed by a time
    '\\d{1,2}\\/\\d{1,2}\\/\\d{4}(?:\\s+\\d{1,2}[.:]\\d{2})?' +
    '|' +
    // 3 Agu 2026, 13.49  — and the date-only "3 Agu 2026"
    '\\d{1,2}\\s+\\S+\\s+\\d{4}(?:,\\s*\\d{1,2}[.:]\\d{2})?' +
    ')$',
);

/**
 * Strip the accumulated re-run scaffolding from a label, leaving the original
 * run's own name. Deltas only ever accumulate at the front and timestamps only
 * at the back, so the core is what survives in the middle. A label that is
 * nothing but scaffolding has no core — return it whole rather than empty.
 */
export function runLabelCore(label: string | null | undefined): string {
  const parts = (label ?? '')
    .split(RUN_LABEL_SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean);

  let start = 0;
  let end = parts.length;
  while (start < end && DELTA_SEGMENT.test(parts[start]!)) start += 1;
  while (end > start && STAMP_SEGMENT.test(parts[end - 1]!)) end -= 1;

  const core = parts.slice(start, end).join(RUN_LABEL_SEPARATOR);
  return core || (label ?? '').trim();
}

/**
 * Asserts DELTA_SEGMENT still recognises every delta the mode table emits.
 *
 * The two live in separate files by necessity — `lib/rerun-modes.ts` owns the
 * five modes and their wording, this file owns label composition — and the last
 * time they drifted, nothing failed: labels just started growing a prefix per
 * re-run. Exported so a script can run it; called from `runLabelCore` would put
 * a loop over the mode table in a hot path for no benefit.
 *
 * Returns the deltas it could NOT match, so an empty array means "in step".
 */
export function assertDeltaSegmentCoversRerunModes(
  modes: { mode: string; delta: (c: { added: number; excluded: number }) => string }[],
): { mode: string; delta: string }[] {
  const missed: { mode: string; delta: string }[] = [];
  for (const spec of modes) {
    // Counts chosen to exercise both the single- and multi-digit paths; a mode
    // whose delta ignores them returns its fixed wording either way.
    for (const counts of [
      { added: 1, excluded: 1 },
      { added: 12, excluded: 12 },
    ]) {
      const delta = spec.delta(counts).trim();
      // An empty delta is legitimate — `refresh_full` opens with no prefix.
      if (delta === '') continue;
      if (!DELTA_SEGMENT.test(delta)) missed.push({ mode: spec.mode, delta });
    }
  }
  return missed;
}

/** Fit a user-supplied label to the column, marking the cut. */
export function clampRunLabel(label: string | null | undefined): string {
  const trimmed = (label ?? '').trim();
  if (trimmed.length <= RUN_LABEL_MAX_LENGTH) return trimmed;
  return `${trimmed.slice(0, RUN_LABEL_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * `<delta> — <core of base label> — <now>`, guaranteed to fit the column.
 *
 * @param delta      This run's own change, e.g. `Re-scoring (+2 kandidat)`.
 * @param baseLabel  The base run's label; its core is carried through.
 * @param fallback   Used when the base run has no label at all.
 */
export function buildDerivedRunLabel(
  delta: string,
  baseLabel: string | null | undefined,
  fallback: string,
  now: Date = new Date(),
): string {
  const stamp = formatDateTime(now);
  const core = runLabelCore(baseLabel) || fallback;
  const full = `${delta}${RUN_LABEL_SEPARATOR}${core}${RUN_LABEL_SEPARATOR}${stamp}`;
  if (full.length <= RUN_LABEL_MAX_LENGTH) return full;

  // Collapsing bounds the scaffolding, not the core — a custom base label can
  // still be long enough on its own to overflow. Elide the core: the delta and
  // the timestamp are what tell this run apart from its base.
  const budget =
    RUN_LABEL_MAX_LENGTH -
    (delta.length + RUN_LABEL_SEPARATOR.length * 2 + stamp.length + 1);
  if (budget < 1) return full.slice(0, RUN_LABEL_MAX_LENGTH);

  return `${delta}${RUN_LABEL_SEPARATOR}${core.slice(0, budget).trimEnd()}…${RUN_LABEL_SEPARATOR}${stamp}`;
}
