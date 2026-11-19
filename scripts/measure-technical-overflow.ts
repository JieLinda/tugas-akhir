/**
 * How far past 100 does the technical aspect actually go, and what would
 * capping it cost?
 *
 * The engine's docblock calls over-100 technical scores "slightly above 100",
 * but that text was written when TECHNICAL_OVERQUALIFICATION_SURPLUS was 0.25
 * (ceiling 1.25). It is now 0.75, so the ceiling is 1.75 and the theoretical
 * maximum score is 175. This measures the real distribution.
 *
 * Read-only.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';

installPgTimeParsers();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

function pct(n: number, of: number) {
  return of === 0 ? '0%' : `${((n / of) * 100).toFixed(1)}%`;
}

async function main() {
  await client.connect();

  type Row = { run_id: string; aspects: Record<string, number> | null };
  // Annotated rather than inferred: `pg` is imported under @ts-ignore (no
  // @types/pg here), so Client is `any` and query<T> cannot flow a type out.
  const rows: Row[] = (
    await client.query(
      `SELECT run_id, candidate_id, pool_rank, closeness, aspects
         FROM scoring_run_pool_aspects`,
    )
  ).rows;

  const tech: number[] = rows
    .map((r: Row) => Number(r.aspects?.technical))
    .filter((n: number) => Number.isFinite(n));

  tech.sort((a: number, b: number) => a - b);
  const q = (p: number) => tech[Math.min(tech.length - 1, Math.floor(p * tech.length))];

  console.log(`scored candidate rows: ${rows.length}   with a technical score: ${tech.length}\n`);
  console.log('technical score distribution');
  console.log(`  min    ${q(0)}`);
  console.log(`  p25    ${q(0.25)}`);
  console.log(`  median ${q(0.5)}`);
  console.log(`  p75    ${q(0.75)}`);
  console.log(`  p95    ${q(0.95)}`);
  console.log(`  max    ${tech[tech.length - 1]}`);

  const over = tech.filter((n: number) => n > 100);
  console.log(`\nabove 100: ${over.length} of ${tech.length}  (${pct(over.length, tech.length)})`);
  if (over.length) {
    console.log(`  their range: ${Math.min(...over)} .. ${Math.max(...over)}`);
    const buckets = [
      [101, 110],
      [111, 125],
      [126, 150],
      [151, 175],
    ] as [number, number][];
    for (const [lo, hi] of buckets) {
      const n = over.filter((v: number) => v >= lo && v <= hi).length;
      if (n) console.log(`  ${lo}-${hi}: ${n}`);
    }
  }

  // What capping at 100 would flatten: within one run, how many candidates
  // currently ABOVE 100 would become tied with each other on this criterion?
  const byRun = new Map<string, number[]>();
  for (const r of rows) {
    const t = Number(r.aspects?.technical);
    if (!Number.isFinite(t)) continue;
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, []);
    byRun.get(r.run_id)!.push(t);
  }

  let runsAffected = 0;
  let runsWithNewTies = 0;
  let maxTieGroup = 0;
  for (const [, scores] of byRun) {
    const above = scores.filter((s: number) => s > 100);
    if (above.length === 0) continue;
    runsAffected += 1;
    // Distinct values above 100 collapse to one value (100) under a cap.
    const distinctAbove = new Set(above).size;
    if (distinctAbove > 1) {
      runsWithNewTies += 1;
      maxTieGroup = Math.max(maxTieGroup, above.length);
    }
  }

  console.log(`\nruns with any candidate above 100: ${runsAffected} of ${byRun.size}`);
  console.log(`runs where a cap would CREATE a tie: ${runsWithNewTies}`);
  console.log(`largest group a cap would flatten to one value: ${maxTieGroup}`);

  // Spread contributed to TOPSIS. Vector normalisation is scale-invariant to a
  // uniform multiple, but the surplus stretches only the TOP of the column, so
  // it changes the column's dispersion relative to the other five criteria —
  // which is how a criterion gets more discriminating power than its AHP weight
  // was set to give it.
  console.log('\nper-run technical spread (max - min), current vs capped');
  let widened = 0;
  const deltas: number[] = [];
  for (const [runId, scores] of byRun) {
    if (scores.length < 2) continue;
    const cur = Math.max(...scores) - Math.min(...scores);
    const cap = scores.map((s: number) => Math.min(s, 100));
    const capped = Math.max(...cap) - Math.min(...cap);
    if (cur !== capped) {
      widened += 1;
      deltas.push(cur - capped);
      if (deltas.length <= 8) {
        console.log(`  ${runId.slice(0, 8)}  spread ${cur} -> ${capped}  (−${cur - capped})`);
      }
    }
  }
  if (deltas.length) {
    const mean = deltas.reduce((a: number, b: number) => a + b, 0) / deltas.length;
    console.log(`  runs whose spread would narrow: ${widened};  mean narrowing ${mean.toFixed(1)} points`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
