/**
 * Two ways to make the technical aspect a real 0..100, measured against every
 * scored candidate in the database.
 *
 * The defect: each matched requirement contributes `sim' x levelFactor`, and an
 * IDENTITY pair's levelFactor may reach 1 + TECHNICAL_OVERQUALIFICATION_SURPLUS
 * (1.75 today). The divisor is M, the plain count of requirements. So the
 * numerator can exceed the denominator and the "0..100" score can reach 175.
 *
 *   SATURATE  score = 100 x min(sum, M) / M
 *             100 means "fully meets every requirement". Surplus still
 *             COMPENSATES for a shortfall elsewhere but cannot exceed the bar.
 *
 *   CEILING   score = 100 x sum / sum_j(1 + SURPLUS x (Lmax - r_j) / 3)
 *             100 means "holds Mastery on every required competency" — the best
 *             attainable, which is what 100 means on the other five aspects.
 *             A genuinely normalized denominator, no clamp.
 *
 * Read-only. Recomputes from the stored per-pair detail; scores nothing.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';

installPgTimeParsers();

const SURPLUS = 0.75;
const LMAX = 4;

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

type Pair = {
  required: { level: number };
  matchType: string;
  value: number;
};

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  return {
    min: q(0),
    p25: q(0.25),
    median: q(0.5),
    p75: q(0.75),
    max: s[s.length - 1] ?? 0,
    mean: xs.reduce((a, b) => a + b, 0) / (xs.length || 1),
  };
}

function show(label: string, xs: number[]) {
  const t = stats(xs);
  console.log(
    `  ${label.padEnd(10)} min ${t.min.toFixed(0).padStart(3)}` +
      `  p25 ${t.p25.toFixed(0).padStart(3)}` +
      `  med ${t.median.toFixed(0).padStart(3)}` +
      `  p75 ${t.p75.toFixed(0).padStart(3)}` +
      `  max ${t.max.toFixed(0).padStart(3)}` +
      `  mean ${t.mean.toFixed(1).padStart(5)}`,
  );
}

async function main() {
  await client.connect();

  type Row = {
    run_id: string;
    candidate_id: string;
    aspects: Record<string, number> | null;
    details: { technicalMatching?: { pairs?: Pair[] } } | null;
  };
  // Annotated rather than inferred: `pg` is imported under @ts-ignore (no
  // @types/pg here), so Client is `any` and query<T> cannot flow a type out.
  const rows: Row[] = (
    await client.query(`SELECT run_id, candidate_id, aspects, details FROM scoring_run_pool_aspects`)
  ).rows;

  const cur: number[] = [];
  const sat: number[] = [];
  const ceil: number[] = [];
  let noDetail = 0;
  // per-run technical vectors, for the rank-change check
  const byRun = new Map<string, { id: string; cur: number; sat: number; ceil: number }[]>();

  for (const r of rows) {
    const tm = r.details?.technicalMatching;
    const pairs = tm?.pairs;
    const current = Number(r.aspects?.technical);
    if (!Number.isFinite(current)) continue;
    if (!pairs || pairs.length === 0) {
      noDetail += 1;
      continue;
    }

    // Reproduce the engine's divisor: M minus unmeasurable columns.
    const scored = pairs.filter((p: Pair) => p.matchType !== 'unmeasurable');
    const M = scored.length;
    if (M === 0) continue;

    const sum = scored.reduce((a: number, p: Pair) => a + (Number(p.value) || 0), 0);
    const capSum = scored.reduce(
      (a: number, p: Pair) => a + (1 + (SURPLUS * Math.max(0, LMAX - Math.max(1, p.required.level))) / 3),
      0,
    );

    const vSat = Math.round((Math.min(sum, M) / M) * 100);
    const vCeil = Math.round((sum / capSum) * 100);

    cur.push(current);
    sat.push(vSat);
    ceil.push(vCeil);
    if (!byRun.has(r.run_id)) byRun.set(r.run_id, []);
    byRun.get(r.run_id)!.push({ id: r.candidate_id, cur: current, sat: vSat, ceil: vCeil });
  }

  console.log(`rows with per-pair detail: ${cur.length}   without: ${noDetail}\n`);
  console.log('technical score distribution');
  show('current', cur);
  show('SATURATE', sat);
  show('CEILING', ceil);

  console.log(`\nabove 100 — current ${cur.filter((v) => v > 100).length}` +
    `, SATURATE ${sat.filter((v) => v > 100).length}` +
    `, CEILING ${ceil.filter((v) => v > 100).length}`);

  const changed = (a: number[], b: number[]) => a.filter((v, i) => v !== b[i]).length;
  console.log(`rows whose score CHANGES — SATURATE ${changed(cur, sat)}` +
    ` (${((changed(cur, sat) / cur.length) * 100).toFixed(1)}%)` +
    `, CEILING ${changed(cur, ceil)}` +
    ` (${((changed(cur, ceil) / cur.length) * 100).toFixed(1)}%)`);

  // Does the criterion's own ordering inside a run survive? Technical is one of
  // six inputs, so a preserved per-criterion order means TOPSIS sees the same
  // relative judgement even though the magnitudes moved.
  let satOrderBroken = 0;
  let ceilOrderBroken = 0;
  let runs = 0;
  for (const [, list] of byRun) {
    if (list.length < 2) continue;
    runs += 1;
    const key = (x: { cur: number }) => x.cur;
    const base = [...list].sort((a, b) => key(b) - key(a)).map((x) => x.id);
    const bySat = [...list].sort((a, b) => b.sat - a.sat).map((x) => x.id);
    const byCeil = [...list].sort((a, b) => b.ceil - a.ceil).map((x) => x.id);
    if (base.join() !== bySat.join()) satOrderBroken += 1;
    if (base.join() !== byCeil.join()) ceilOrderBroken += 1;
  }
  console.log(`\nruns (>=2 candidates): ${runs}`);
  console.log(`  runs where the technical ORDERING changes — SATURATE ${satOrderBroken}, CEILING ${ceilOrderBroken}`);

  // What does "exactly meets every requirement" score under each rule? This is
  // the number that decides whether CEILING is a re-definition or a bug fix.
  console.log('\nwhat a candidate who EXACTLY meets every requirement scores:');
  for (const reqLevel of [1, 2, 3, 4]) {
    const cap = 1 + (SURPLUS * (LMAX - reqLevel)) / 3;
    console.log(
      `  all requirements at level ${reqLevel}:  SATURATE 100   CEILING ${Math.round((1 / cap) * 100)}`,
    );
  }

  // Level profile of real requirement sets — how often CEILING's denominator
  // actually inflates.
  const levelCounts = new Map<number, number>();
  for (const r of rows) {
    for (const p of r.details?.technicalMatching?.pairs ?? []) {
      if (p.matchType === 'unmeasurable') continue;
      const l = Math.max(1, p.required.level);
      levelCounts.set(l, (levelCounts.get(l) ?? 0) + 1);
    }
  }
  const totalPairs = [...levelCounts.values()].reduce((a, b) => a + b, 0);
  console.log('\nrequired-level mix across all scored pairs:');
  for (const l of [...levelCounts.keys()].sort()) {
    const n = levelCounts.get(l)!;
    console.log(`  level ${l}: ${n} (${((n / totalPairs) * 100).toFixed(1)}%)  ceiling ${(1 + (SURPLUS * (LMAX - l)) / 3).toFixed(3)}`);
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
