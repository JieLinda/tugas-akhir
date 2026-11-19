/**
 * Finds rows whose zone-less timestamp was written by a UTC Node process.
 *
 * `updatedAt: new Date()` handed to a `timestamp without time zone` column is
 * serialised in process-local time, so a UTC container stored WIB-minus-7. The
 * tell is an `updated_at` EARLIER than the `created_at` written by Postgres
 * `now()` in the same statement — impossible unless the two clocks disagree.
 *
 * Read-only. Reports what a corrective UPDATE would touch; runs nothing.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

async function main() {
  await client.connect();

  const naive = await client.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'timestamp without time zone'
      ORDER BY table_name, column_name`,
  );

  // Tables carrying both, where created_at is Postgres-stamped and updated_at
  // is a candidate for the JS-Date path.
  const byTable = new Map<string, Set<string>>();
  for (const r of naive.rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name)!.add(r.column_name);
  }

  let totalSkewed = 0;
  console.log('table                              rows  skewed  worst skew');
  console.log('----------------------------------------------------------------');
  for (const [table, cols] of [...byTable].sort()) {
    if (!cols.has('created_at') || !cols.has('updated_at')) continue;
    const { rows } = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE updated_at < created_at - interval '1 hour')::int AS skewed,
              COALESCE(max(extract(epoch FROM (created_at - updated_at)))::int, 0) AS worst
         FROM ${table}`,
    );
    const r = rows[0];
    if (r.total === 0) continue;
    const flag = r.skewed > 0 ? '  <== ' + (r.worst / 3600).toFixed(2) + 'h' : '';
    console.log(
      `${table.padEnd(34)} ${String(r.total).padStart(5)}  ${String(r.skewed).padStart(6)}${flag}`,
    );
    totalSkewed += r.skewed;
  }

  console.log('\nRows with a >1h backwards updated_at:', totalSkewed);
  if (totalSkewed > 0) {
    console.log(
      '\nThese were written by a UTC process. A corrective statement per affected\n' +
        "table would be:  UPDATE <t> SET updated_at = updated_at + interval '7 hours'\n" +
        "                   WHERE updated_at < created_at - interval '1 hour';\n" +
        'It is NOT run here: the filter cannot tell a genuinely-old updated_at from\n' +
        'a skewed one on a row that was legitimately edited hours before, so this\n' +
        'needs a human decision per table.',
    );
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
