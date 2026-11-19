/**
 * Pins how Postgres date/time types become JavaScript Dates.
 *
 * ── The bug this exists to close ────────────────────────────────────────────
 *
 * 55 columns in this schema are `timestamp without time zone` (audit_log,
 * scoring_runs, tournament_sessions, analysis_results, position_picks,
 * chat_messages, …). They hold WIB wall-clock, because
 * the database's own `TimeZone` is Asia/Bangkok (+07) and `DEFAULT now()`
 * therefore stamps local time.
 *
 * node-postgres parses a value with no offset using the *reading process's*
 * timezone. So the same row became two different instants depending on where
 * the code ran:
 *
 *   stored                    2026-08-24 11:04:21    (11:04 WIB — correct)
 *   read in a UTC container → 2026-08-24T11:04:21Z   (7 hours late)
 *   read on a WIB laptop    → 2026-08-24T04:04:21Z   (correct)
 *
 * Rendering the first one in Asia/Jakarta printed 18:04 for an 11:04 event.
 * On a developer machine the parse error and the render offset cancelled
 * exactly, so the audit trail and run history looked right in dev and were
 * seven hours wrong in the container — nothing failed, nothing logged.
 *
 * Pinning the parse here removes the ambient timezone from the answer: these
 * values mean the same instant whether they are read by the web app, a script,
 * a UTC container, or a laptop.
 *
 * ── Why not migrate the columns to timestamptz ──────────────────────────────
 *
 * That is the better schema and it is also a 55-column migration across three
 * deployables that share this database, with ~73% of access being hand-written
 * SQL. It would have to be its own change, with the writers converted first.
 * This makes the existing convention *true* rather than merely assumed.
 *
 * ── This pin does NOT cover Drizzle ────────────────────────────────────────
 *
 * drizzle-orm's node-postgres session passes a per-query `types` override that
 * returns TIMESTAMP/DATE/TIMESTAMPTZ as raw strings, so these module-global
 * parsers never run for ORM queries — drizzle maps the string itself, and its
 * mapping declares naive wall-clock to be UTC (`new Date(value + "+0000")`),
 * which is +7 on EVERY host, not just UTC containers. `lib/db/drizzle-time.ts`
 * closes that; this file remains the whole story only for raw `pg` clients
 * (the two services, scripts).
 *
 * ── The raw-pg write side is NOT fixed here ─────────────────────────────────
 *
 * node-postgres serialises a JS Date using the process timezone too, so
 * `updatedAt: new Date()` into a zone-less column stores UTC wall-clock in a
 * UTC container — 7 hours behind the `now()`-written column beside it. Reads
 * cannot repair that; the process timezone has to be WIB when writing. See
 * `assertBusinessTimezone` below and the `TZ` setting in docker-compose.yml.
 * (Drizzle ORM writes are the exception: `drizzle-time.ts` replaces
 * `mapToDriverValue` on every naive column, so those serialise WIB wall-clock
 * regardless of the process timezone.)
 */
// @ts-ignore — `pg` ships no bundled types and @types/pg is not installed;
// `lib/db/vector-db.ts` suppresses the same import the same way.
import pgTypes from 'pg';

/** Fixed +07:00 — Indonesia has never observed DST. */
const WIB_OFFSET = '+07:00';

// Postgres OIDs. Only the zone-less types are re-pinned; `timestamptz` (1184)
// arrives with an offset and the default parser already reads it correctly.
const OID_DATE = 1082;
const OID_TIMESTAMP = 1114;

/**
 * `2026-08-24 11:18:39.204683` → the instant that wall-clock names in WIB.
 *
 * Microseconds are truncated to milliseconds: the ECMAScript date grammar
 * specifies exactly three fractional digits, and while V8 tolerates six, that
 * is engine behaviour rather than a guarantee.
 */
export function parseNaiveTimestamp(value: string | null): Date | null {
  if (value == null) return null;
  const text = value.trim();
  if (text === '') return null;
  // Postgres can return these for a timestamp column; `new Date` of either
  // string is Invalid Date, which every formatter already renders as '-'.
  if (text === 'infinity' || text === '-infinity') return new Date(NaN);

  const match = /^(\d{4,})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(text);
  if (!match) {
    // A shape we did not anticipate (BC dates carry an era suffix). Falling
    // back to the engine keeps the old behaviour for it, rather than returning
    // null and turning a rendered date into a crash somewhere downstream.
    return new Date(text);
  }

  const [, y, mo, d, h, mi, s, frac = ''] = match;
  const ms = (frac + '000').slice(0, 3);
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}${WIB_OFFSET}`);
}

/**
 * A `date` column becomes UTC midnight, not local midnight.
 *
 * Deliberate: UTC midnight reads back as the same calendar day both when
 * formatted in Asia/Jakarta and when sliced off an ISO string, so the two
 * habits already present in this codebase agree — `lib/age.ts` reads local
 * calendar fields off birth_date, exports slice `toISOString()`. Local
 * midnight would make one of them off by a day depending on the host.
 */
export function parseDateOnly(value: string | null): Date | null {
  if (value == null) return null;
  const text = value.trim();
  if (text === '') return null;
  if (text === 'infinity' || text === '-infinity') return new Date(NaN);
  const match = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return new Date(text);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
}

let installed = false;

/**
 * Idempotent, and must run before the first query on any pool — `pg`'s type
 * parsers are module-global, which is what lets one call cover the main pool,
 * the vector pool, and any script that imports either.
 */
export function installPgTimeParsers(): void {
  if (installed) return;
  installed = true;
  pgTypes.types.setTypeParser(OID_TIMESTAMP, parseNaiveTimestamp as never);
  pgTypes.types.setTypeParser(OID_DATE, parseDateOnly as never);
}

/**
 * Warns once if the process timezone is not +07:00.
 *
 * Reads are pinned above, so a mismatch no longer corrupts what is displayed.
 * Writes are not: a JS Date handed to a zone-less column is serialised in
 * process-local time, so a UTC process silently stores stamps 7 hours behind
 * the ones Postgres writes with `now()`. That is invisible in every log, which
 * is exactly why it is worth a line on startup.
 */
export function assertBusinessTimezone(): void {
  // Two dates six months apart: equal offsets confirm there is no DST rule in
  // play, which is part of what makes the fixed +07:00 above safe.
  const jan = -new Date(Date.UTC(2026, 0, 15)).getTimezoneOffset();
  const jul = -new Date(Date.UTC(2026, 6, 15)).getTimezoneOffset();
  if (jan === 420 && jul === 420) return;

  const sign = jan >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(jan) / 60)).padStart(2, '0');
  const mm = String(Math.abs(jan) % 60).padStart(2, '0');
  const dst = jan === jul ? '' : ' (this zone observes DST)';

  console.warn(
    `[pg-time] Process timezone is UTC${sign}${hh}:${mm}${dst}, not UTC+07:00. ` +
      'Reading timestamps is unaffected (parsers are pinned), but writing a JS Date ' +
      'into a `timestamp without time zone` column will store the wrong wall-clock. ' +
      'Set TZ=Asia/Jakarta for this process.',
  );
}
