/**
 * Proves the timestamp fix under both process timezones.
 *
 * Run twice:
 *   npx tsx scripts/verify-datetime.ts
 *   TZ=UTC npx tsx scripts/verify-datetime.ts
 *
 * Both must print identical rendered text. Before the fix the second run was
 * seven hours ahead of the first, which is the bug this guards.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';
import { formatDate, formatDateTime, formatHistoryDate } from '../lib/datetime';

installPgTimeParsers();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

async function main() {
  await client.connect();
  console.log('process TZ :', Intl.DateTimeFormat().resolvedOptions().timeZone);
  console.log('');

  // `::text` is the ground truth of what the bytes say; the Date beside it is
  // what the app receives. They must name the same wall-clock.
  const naive = await client.query(
    `SELECT created_at, created_at::text AS stored, summary
       FROM audit_log ORDER BY created_at DESC LIMIT 3`,
  );
  console.log('audit_log  (timestamp without time zone)');
  for (const r of naive.rows) {
    console.log(
      `  stored ${r.stored.slice(0, 19)}  ->  rendered ${formatDateTime(r.created_at)}` +
        `   ${r.stored.slice(0, 16) === formatDateTime(r.created_at) ? 'MATCH' : 'MISMATCH'}`,
    );
  }

  const runs = await client.query(
    `SELECT created_at, created_at::text AS stored, completed_at
       FROM scoring_runs ORDER BY created_at DESC LIMIT 3`,
  );
  console.log('\nscoring_runs  (timestamp without time zone)');
  for (const r of runs.rows) {
    console.log(
      `  stored ${r.stored.slice(0, 19)}  ->  rendered ${formatDateTime(r.created_at)}` +
        `   ${r.stored.slice(0, 16) === formatDateTime(r.created_at) ? 'MATCH' : 'MISMATCH'}`,
    );
  }

  // A real instant. The rendered text must be the SAME under both TZs, but it
  // is legitimately not the same as the stored UTC text.
  const tz = await client.query(
    `SELECT started_at, started_at::text AS stored FROM sync_runs
      WHERE started_at IS NOT NULL ORDER BY started_at DESC LIMIT 2`,
  );
  console.log('\nsync_runs  (timestamp WITH time zone — should already have been right)');
  for (const r of tz.rows) {
    console.log(`  stored ${r.stored}  ->  rendered ${formatDateTime(r.started_at)}`);
  }

  const dates = await client.query(
    `SELECT birth_date, birth_date::text AS stored FROM sync_employee_personal
      WHERE birth_date IS NOT NULL ORDER BY birth_date LIMIT 2`,
  );
  console.log('\nsync_employee_personal.birth_date  (plain date)');
  for (const r of dates.rows) {
    console.log(
      `  stored ${r.stored}  ->  rendered ${formatDate(r.birth_date)}` +
        `   ${r.stored === formatDate(r.birth_date) ? 'MATCH' : 'MISMATCH'}`,
    );
  }

  const hist = await client.query(
    `SELECT valid_from, valid_to FROM candidate_position_history
      ORDER BY valid_from DESC NULLS LAST LIMIT 3`,
  );
  console.log('\ncandidate_position_history (open-ended sentinel handling)');
  for (const r of hist.rows) {
    console.log(`  ${formatHistoryDate(r.valid_from)} -> ${formatHistoryDate(r.valid_to)}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
