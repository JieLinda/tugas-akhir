/**
 * Hunts for timestamps the formatter fix CANNOT reach.
 *
 * `lib/datetime.ts` governs values rendered at read time. It does nothing for a
 * timestamp that was already turned into TEXT and stored — those keep whatever
 * format and whatever offset was in force when they were written. Read-only.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';

installPgTimeParsers();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

// The localised shapes this app used to emit, e.g. "3 Agu 2026, 13.49".
const LEGACY_STAMP = /\d{1,2}\s+\S+\s+\d{4},\s*\d{1,2}[.:]\d{2}/;
const LEGACY_DATE = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/;
const LEGACY_MONTH = /\b\d{1,2}\s+(Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Agt|Sep|Okt|Nov|Des)\b/;
const ISO_STAMP = /\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2})?/;

async function main() {
  await client.connect();

  console.log('=== 1. Timestamps BAKED INTO stored text ===\n');
  for (const [table, col] of [
    ['scoring_runs', 'label'],
    ['tournament_sessions', 'label'],
    ['audit_log', 'summary'],
  ] as [string, string][]) {
    const { rows } = await client.query(
      `SELECT ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL`,
    );
    const vals: string[] = rows.map((r: { v: string }) => String(r.v));
    const legacy = vals.filter((v) => LEGACY_STAMP.test(v) || LEGACY_DATE.test(v) || LEGACY_MONTH.test(v));
    const iso = vals.filter((v) => !LEGACY_STAMP.test(v) && !LEGACY_DATE.test(v) && !LEGACY_MONTH.test(v) && ISO_STAMP.test(v));
    console.log(`${table}.${col}: ${vals.length} rows`);
    console.log(`  legacy-format stamp inside the text : ${legacy.length}`);
    console.log(`  ISO-format stamp inside the text    : ${iso.length}`);
    for (const v of legacy.slice(0, 6)) console.log(`    LEGACY  ${v.slice(0, 110)}`);
    for (const v of iso.slice(0, 3)) console.log(`    ISO     ${v.slice(0, 110)}`);
    console.log('');
  }

  console.log('=== 2. Column types the parser pin does NOT cover ===\n');
  const { rows: odd } = await client.query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema='public'
        AND (data_type LIKE 'time%' OR data_type = 'interval')
        AND data_type NOT IN ('timestamp without time zone','timestamp with time zone','date')
      ORDER BY 1,2`,
  );
  if (odd.length === 0) console.log('  none — only timestamp/timestamptz/date are in use\n');
  for (const r of odd as { table_name: string; column_name: string; data_type: string }[]) {
    console.log(`  ${r.table_name}.${r.column_name} = ${r.data_type}`);
  }

  console.log('=== 3. Timestamps stored as TEXT / VARCHAR ===\n');
  const { rows: textCols } = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema='public' AND data_type IN ('text','character varying')
        AND (column_name LIKE '%_at' OR column_name LIKE '%date%' OR column_name LIKE '%time%')
      ORDER BY 1,2`,
  );
  if (textCols.length === 0) console.log('  none\n');
  for (const r of textCols as { table_name: string; column_name: string }[]) {
    const { rows: sample } = await client.query(
      `SELECT ${r.column_name} AS v FROM ${r.table_name}
        WHERE ${r.column_name} IS NOT NULL LIMIT 2`,
    );
    const vals = (sample as { v: string }[]).map((x) => String(x.v)).join(' | ');
    console.log(`  ${r.table_name}.${r.column_name}  e.g. ${vals.slice(0, 80)}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
