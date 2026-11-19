/**
 * Walks the exact production hop that the audit trail and run history use:
 *
 *   Postgres text  →  pg parse  →  Date.toISOString()  →  client formatDateTime
 *
 * The `toISOString()` step matters: `lib/audit.ts` and `lib/progress-running-
 * actions.ts` serialise Dates to ISO strings to cross the server/client
 * boundary, so a parse error is baked in as a `Z` instant before any component
 * sees it. Run with and without TZ=UTC; the rendered column must be identical
 * and must equal the stored wall-clock.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';
import { formatDateTime } from '../lib/datetime';
import { runLabelCore, buildDerivedRunLabel } from '../lib/run-label';
import { compactRunLabel } from '../lib/activity-thread';

installPgTimeParsers();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

async function main() {
  await client.connect();
  console.log('process TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone, '\n');

  let bad = 0;
  for (const [table, col] of [
    ['audit_log', 'created_at'],
    ['scoring_runs', 'created_at'],
    ['tournament_sessions', 'updated_at'],
    ['analysis_results', 'calculated_at'],
    ['chat_messages', 'created_at'],
    ['position_picks', 'created_at'],
  ] as [string, string][]) {
    const { rows } = await client.query(
      `SELECT ${col} AS v, ${col}::text AS stored FROM ${table}
        WHERE ${col} IS NOT NULL ORDER BY ${col} DESC LIMIT 2`,
    );
    for (const r of rows) {
      const overWire = (r.v as Date).toISOString(); // server → client
      const rendered = formatDateTime(overWire); // what the component prints
      const expected = (r.stored as string).slice(0, 16);
      const ok = rendered === expected;
      if (!ok) bad += 1;
      console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${table}.${col}  stored ${expected}  wire ${overWire}  rendered ${rendered}`,
      );
    }
  }

  // Label collapse: a re-run of a run whose label carries the LEGACY timestamp
  // must still strip it, or the string grows every generation until the
  // varchar(255) INSERT fails.
  console.log('\nrun-label collapse');
  const cases = [
    'Re-scoring (+2 kandidat) — Talent Pool — Analis IT — 3 Agu 2026, 13.49',
    'Re-scoring (+2 kandidat) — Talent Pool — Analis IT — 2026-08-24 11:05',
  ];
  for (const label of cases) {
    const core = runLabelCore(label);
    const derived = buildDerivedRunLabel('Re-ranking (−1 kandidat)', label, 'Penilaian');
    const grew = derived.length > label.length + 30;
    console.log(`  ${grew ? 'FAIL' : 'ok  '} core="${core}"`);
    console.log(`       derived (${derived.length} chars) = ${derived}`);
    if (grew) bad += 1;
  }

  // The unlabelled-run fallback used to slice UTC fields off the ISO string.
  const { rows: unl } = await client.query(
    `SELECT id, created_at, created_at::text AS stored FROM scoring_runs
       ORDER BY created_at DESC LIMIT 1`,
  );
  const iso = (unl[0].v ?? unl[0].created_at).toISOString();
  const compact = compactRunLabel(null, iso);
  const wall = (unl[0].stored as string).slice(0, 16);
  const ok = compact === `Run ${wall}`;
  if (!ok) bad += 1;
  console.log(`\n${ok ? 'ok  ' : 'FAIL'} compactRunLabel(null) = "${compact}"  (stored ${wall})`);

  console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILURES`);
  await client.end();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
