/**
 * Which run labels carry a date stamp, in what shape, and WHEN they were
 * written — the last part is what separates historical residue from a code path
 * still emitting the old format.
 *
 * Also replays runLabelCore over every real label to find the ones whose stamp
 * it fails to strip. An unstripped stamp is not cosmetic: buildDerivedRunLabel
 * carries the core through and appends a fresh stamp, so a stamp the stripper
 * misses accumulates one per generation until the varchar(255) INSERT fails.
 *
 * Read-only.
 */
import 'dotenv/config';
// @ts-ignore
import { Client } from 'pg';
import { installPgTimeParsers } from '../lib/db/pg-time';
import {
  runLabelCore,
  buildDerivedRunLabel,
  assertDeltaSegmentCoversRerunModes,
  RUN_LABEL_SEPARATOR,
} from '../lib/run-label';
import { RERUN_MODES } from '../lib/rerun-modes';

installPgTimeParsers();

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
});

const SHAPES: [string, RegExp][] = [
  ['ISO datetime  2026-08-24 11:05', /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/],
  ['ISO date      2026-08-24', /^\d{4}-\d{2}-\d{2}$/],
  ['slash         24/8/2026', /^\d{1,2}\/\d{1,2}\/\d{4}$/],
  ['id-ID stamp   3 Agu 2026, 13.49', /^\d{1,2}\s+\S+\s+\d{4},\s*\d{1,2}[.:]\d{2}$/],
];

async function main() {
  await client.connect();

  const { rows } = await client.query(
    `SELECT label, created_at, created_at::text AS created_text
       FROM scoring_runs WHERE label IS NOT NULL ORDER BY created_at`,
  );

  const counts = new Map<string, { n: number; first: string; last: string }>();
  const unstripped: { label: string; tail: string; created: string }[] = [];

  for (const r of rows as { label: string; created_text: string }[]) {
    const parts = r.label.split(RUN_LABEL_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    const tail = parts[parts.length - 1] ?? '';

    let shape = 'no stamp';
    for (const [name, re] of SHAPES) if (re.test(tail)) { shape = name; break; }

    const c = counts.get(shape) ?? { n: 0, first: r.created_text, last: r.created_text };
    c.n += 1;
    c.last = r.created_text;
    counts.set(shape, c);

    // Does the stripper actually remove it?
    if (shape !== 'no stamp' && runLabelCore(r.label).includes(tail)) {
      unstripped.push({ label: r.label, tail, created: r.created_text.slice(0, 16) });
    }
  }

  console.log(`scoring_runs with a label: ${rows.length}\n`);
  console.log('trailing-segment shape          count   first written      last written');
  for (const [shape, c] of [...counts].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${shape.padEnd(30)} ${String(c.n).padStart(4)}   ${c.first.slice(0, 16)}   ${c.last.slice(0, 16)}`,
    );
  }

  console.log(`\nlabels whose stamp runLabelCore FAILS to strip: ${unstripped.length}`);
  for (const u of unstripped.slice(0, 10)) {
    console.log(`  [${u.created}] tail "${u.tail}"`);
    console.log(`     ${u.label.slice(0, 120)}`);
  }

  // Growth check: what happens if each distinct shape is re-run twice.
  console.log('\ngrowth under two successive re-runs:');
  const samples = new Map<string, string>();
  for (const r of rows as { label: string }[]) {
    const parts = r.label.split(RUN_LABEL_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    const tail = parts[parts.length - 1] ?? '';
    for (const [name, re] of SHAPES) {
      if (re.test(tail) && !samples.has(name)) samples.set(name, r.label);
    }
  }
  const now = new Date('2026-08-24T05:15:00.000Z');
  for (const [shape, label] of samples) {
    const g1 = buildDerivedRunLabel('Re-ranking (−1 kandidat)', label, 'Penilaian', now);
    const g2 = buildDerivedRunLabel('Re-ranking (−1 kandidat)', g1, 'Penilaian', now);
    const grows = g2.length > g1.length;
    console.log(`  ${grows ? 'GROWS ' : 'stable'} ${shape}`);
    console.log(`     base ${label.length} -> gen1 ${g1.length} -> gen2 ${g2.length}`);
    if (grows) console.log(`     gen2: ${g2.slice(0, 150)}`);
  }

  // Deltas: the prefix side of the same problem. A delta the stripper misses
  // stacks one per re-run instead of collapsing.
  const missedDeltas = assertDeltaSegmentCoversRerunModes(
    Object.values(RERUN_MODES) as never,
  );
  console.log(`\nrerun-mode deltas DELTA_SEGMENT fails to match: ${missedDeltas.length}`);
  for (const m of missedDeltas) console.log(`  ${m.mode}: "${m.delta}"`);

  const pass = unstripped.length === 0 && missedDeltas.length === 0;
  console.log(
    pass
      ? '\nPASS — every stamp and every rerun-mode delta is recognised'
      : `\nFAIL — ${unstripped.length} labels carry an unrecognised stamp, ` +
        `${missedDeltas.length} rerun-mode deltas unrecognised`,
  );

  await client.end();
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
