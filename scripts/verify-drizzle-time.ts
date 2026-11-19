/**
 * Reads the same scoring_runs row through every path the app actually uses and
 * asserts they name the SAME instant:
 *
 *   1. Drizzle ORM select (typed column -> PgTimestamp.mapFromDriverValue)
 *   2. db.execute(sql``)   (drizzle raw -> per-query identity parser -> string)
 *   3. raw pg Client       (global pinned parser)
 *   4. created_at::text    (ground truth: the stored wall-clock)
 *
 * Path 1 is the one the fix targets: drizzle overrides pg's type parsers per
 * query, so the global pin never runs, and its own mapping appends "+0000" to
 * a WIB wall-clock — every ORM-read timestamp was 7 hours late on every host.
 *
 * Read-only.
 */
import 'dotenv/config';
import { desc, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { scoringRuns } from '../lib/db/schema';
import { formatDateTime } from '../lib/datetime';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';

installPgTimeParsers();

async function main() {
  const [orm] = await db
    .select({ id: scoringRuns.id, createdAt: scoringRuns.createdAt })
    .from(scoringRuns)
    .orderBy(desc(scoringRuns.createdAt))
    .limit(1);
  if (!orm) throw new Error('no scoring_runs rows');

  const raw = await db.execute(
    sql`SELECT created_at, created_at::text AS truth FROM scoring_runs WHERE id = ${orm.id}`,
  );
  const rawRow = raw.rows[0] as { created_at: unknown; truth: string };

  const client = new Client({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  });
  await client.connect();
  const pinned = await client.query('SELECT created_at FROM scoring_runs WHERE id = $1', [orm.id]);
  await client.end();

  const truthMinute = rawRow.truth.slice(0, 16); // "2026-08-24 13:28"
  const viaOrm = formatDateTime(orm.createdAt);
  const viaRaw = formatDateTime(rawRow.created_at as never);
  const viaPin = formatDateTime(pinned.rows[0].created_at);

  console.log(`stored wall-clock (::text)     : ${truthMinute}`);
  console.log(`drizzle ORM   -> formatDateTime: ${viaOrm}   raw value: ${String(orm.createdAt)}`);
  console.log(`drizzle sql\`\` -> formatDateTime: ${viaRaw}   raw value: ${String(rawRow.created_at)} (${typeof rawRow.created_at})`);
  console.log(`pinned pg     -> formatDateTime: ${viaPin}`);

  // Write side, without writing: the column's own mapToDriverValue must emit
  // WIB wall-clock for a naive column (drizzle's default emitted toISOString(),
  // i.e. UTC wall-clock — the source of the 7.00h-skewed updated_at rows), and
  // must remain toISOString() for a timestamptz column.
  const instant = new Date('2026-08-24T06:28:00.000Z'); // = 13:28:00 WIB
  const naiveOut = (
    scoringRuns.createdAt as unknown as { mapToDriverValue: (v: Date) => string }
  ).mapToDriverValue(instant);
  const { candidates } = await import('../lib/db/schema');
  const tzOut = (
    candidates.deletedAt as unknown as { mapToDriverValue: (v: Date) => string }
  ).mapToDriverValue(instant);

  console.log(`naive column write literal     : ${naiveOut}   (want 2026-08-24 13:28:00.000)`);
  console.log(`timestamptz column write value : ${tzOut}   (want 2026-08-24T06:28:00.000Z)`);

  const writeOk =
    naiveOut === '2026-08-24 13:28:00.000' && tzOut === '2026-08-24T06:28:00.000Z';

  const ok =
    viaOrm === truthMinute && viaRaw === truthMinute && viaPin === truthMinute && writeOk;
  console.log(
    ok ? '\nPASS — reads render the stored wall-clock, writes store WIB wall-clock' : '\nFAIL',
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
