/**
 * The single place this app turns a timestamp into text.
 *
 * ── Format ──────────────────────────────────────────────────────────────────
 *
 *   with time  →  2026-08-24 11:05
 *   date only  →  2026-08-24
 *
 * Deliberately ISO-ordered rather than localised. The app previously mixed
 * `24/08/2026 18:04`, `24 Agu, 18.18`, `24 Agu 2026, 04.18` and `24 Agustus
 * 2026` on adjacent screens, and `24/08` vs `08/24` is unreadable without
 * knowing which convention a given component picked. Big-endian digits sort
 * lexicographically, never ambiguate day and month, and are the same width in
 * every row — which is what a table of run timestamps actually needs.
 *
 * ── Timezone ────────────────────────────────────────────────────────────────
 *
 * Every formatter pins BOTH the calendar and the zone, and never reads the
 * host. A bare toLocaleString() takes them from the environment, so the same
 * value renders one way in a server component (container, UTC) and another in
 * the browser (WIB) — wrong text in SSR'd markup plus a hydration mismatch.
 *
 * The zone is the business zone, not the viewer's: an HR user in Jakarta and
 * one travelling must read the same wall-clock for the same run, because these
 * timestamps are evidence about when an assessment was made.
 *
 * ── Why the input is trustworthy ────────────────────────────────────────────
 *
 * 55 columns in this schema are `timestamp without time zone` holding WIB
 * wall-clock (Postgres `TimeZone` is Asia/Bangkok, so `now()::timestamp` is
 * +07 local). node-postgres parses such a value using the *reading process's*
 * zone, so a UTC container turned 11:04 WIB into 11:04Z — an instant 7 hours
 * late — and pinning the formatter to Asia/Jakarta then rendered 18:04. On a
 * developer machine already set to WIB the two errors cancelled, which is why
 * it shipped. `lib/db/pg-time.ts` now pins that parse, so by the time a value
 * reaches this module it is a true instant regardless of where the code runs.
 */

/** Business timezone. Indonesia has no DST, so this is a fixed +07:00. */
export const DISPLAY_TIME_ZONE = 'Asia/Jakarta';

export type DateInput = Date | string | number | null | undefined;

/** What every formatter returns for a missing or unparseable value. */
export const EMPTY_DATE = '-';

// A timestamp string with NO offset is WIB wall-clock — that is what this
// app's `timestamp without time zone` columns hold, and raw `db.execute(sql``)`
// results deliver them as strings (drizzle's per-query parser skips column
// mapping). `new Date("2026-08-24 13:02:51")` would parse that in the HOST
// zone, which is right on a WIB laptop and 7 hours wrong in a UTC container —
// the same trap `lib/db/pg-time.ts` closes for the driver, closed here for
// strings that reach a formatter directly. Fixed +07:00: no DST in Indonesia.
const NAIVE_TIMESTAMP =
  /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

function toDate(value: DateInput): Date | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const m = NAIVE_TIMESTAMP.exec(value.trim());
    if (m) {
      const [, y, mo, d, h, mi, s = '00', frac = ''] = m;
      const ms = (frac + '000').slice(0, 3);
      const pinned = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}+07:00`);
      return Number.isNaN(pinned.getTime()) ? null : pinned;
    }
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Parts are assembled by hand rather than handed to a locale. `en-CA` happens
// to print YYYY-MM-DD today, but that is a property of one locale's data, not a
// guarantee — and `hour12: false` still yields "24" for midnight in some ICU
// builds. Reading the parts and joining them ourselves cannot drift.
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type Fields = { y: string; m: string; d: string; h: string; min: string; s: string };

function fields(date: Date): Fields {
  const out: Record<string, string> = {};
  for (const part of PARTS.formatToParts(date)) out[part.type] = part.value;
  return {
    y: out.year ?? '0000',
    m: out.month ?? '01',
    d: out.day ?? '01',
    // h23 gives 00..23; a stray "24" from an older ICU would misread as the
    // next day, so fold it here rather than trusting the option alone.
    h: out.hour === '24' ? '00' : (out.hour ?? '00'),
    min: out.minute ?? '00',
    s: out.second ?? '00',
  };
}

/** `2026-08-24 11:05` — the default when a timestamp carries a time. */
export function formatDateTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.y}-${f.m}-${f.d} ${f.h}:${f.min}`;
}

/** `2026-08-24` — for values where only the day is meaningful. */
export function formatDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.y}-${f.m}-${f.d}`;
}

/** `11:05` — only for a column that already states the date elsewhere. */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.h}:${f.min}`;
}

/**
 * `2026-08-24 11:05:32`. Reserved for logs and diagnostics, where two events
 * inside the same minute have to be orderable by eye.
 */
export function formatDateTimeSeconds(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.y}-${f.m}-${f.d} ${f.h}:${f.min}:${f.s}`;
}

/**
 * `2026-08-24` as a sortable key — same text as formatDate, but returns null
 * instead of a dash so a caller can tell "no date" from a rendered value.
 * Use for query parameters and day bucketing, never for display.
 */
export function toDayKey(value: DateInput): string | null {
  const date = toDate(value);
  if (!date) return null;
  const f = fields(date);
  return `${f.y}-${f.m}-${f.d}`;
}

/** `20260824` — for filenames, which cannot contain a colon on Windows. */
export function formatDateCompact(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.y}${f.m}${f.d}`;
}

/** `20260824-1105` — filenames that need to distinguish two exports one day. */
export function formatDateTimeCompact(value: DateInput): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const f = fields(date);
  return `${f.y}${f.m}${f.d}-${f.h}${f.min}`;
}

/**
 * A `candidate_position_history` boundary: `2026-08-24`, `Sekarang`, or `—`.
 *
 * The sync writes an open-ended stint as year 9999 rather than NULL, so a
 * current position renders as "8 Sep 9999" unless that sentinel is folded in.
 * Five separate copies of this helper existed (the two chat prompt builders,
 * the candidate detail timeline, the candidate list timeline, the dossier), and
 * they were the reason a stint could read `Sekarang` on one screen and `31 Des
 * 9999` on another.
 *
 * The em dash rather than EMPTY_DATE is deliberate and matches what those five
 * already rendered: a missing boundary on a career timeline means "not
 * recorded", which reads differently from a value that failed to parse.
 */
export function formatHistoryDate(value: DateInput): string {
  const date = toDate(value);
  if (!date) return '—';
  // Compared in UTC: the sentinel is a year, and no zone shift can move 9999.
  if (date.getUTCFullYear() >= 9999) return 'Sekarang';
  return formatDate(date);
}

/**
 * "3 jam lalu", falling back to an absolute `2026-08-24` past a month, where
 * "38 hari lalu" stops being easier to read than the date itself.
 *
 * Relative text is deliberately NOT used for anything a user might cite: it
 * moves every time the page is opened, so it cannot be quoted in a report.
 */
export function formatRelative(value: DateInput, now: DateInput = new Date()): string {
  const date = toDate(value);
  if (!date) return EMPTY_DATE;
  const base = toDate(now) ?? new Date();

  const seconds = Math.floor((base.getTime() - date.getTime()) / 1000);
  if (seconds < 0) return formatDateTime(date);
  if (seconds < 60) return 'baru saja';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} hari lalu`;
  return formatDate(date);
}
