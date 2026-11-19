// NFR-RR-01 — is every stored ranking what its stored inputs produce?
//
// Read-only. For each completed AHP+TOPSIS run, re-ranks the run from what it
// STORED — the six aspects of every pool candidate, its nominal weight vector
// and its active criteria — with scoring-service's own ranking function, and
// compares the result with the stored closeness and ranks (I-4: |Δ| ≤ 1e-9 at
// the stored precision, identical ranks; full precision too where the run kept
// it). Two kinds of reproducibility are different things:
//
//   (a) replay from stored data — guaranteed, and what this checks;
//   (b) recomputing from scratch — NOT guaranteed for the model-backed parts
//       (education via Gemini): a model is not deterministic,
//       which is exactly why their raw responses are stored with the run.
//
//   tsx scripts/verify-run-reproducibility.ts --run <runId>
//   tsx scripts/verify-run-reproducibility.ts --position <positionId>
//   tsx scripts/verify-run-reproducibility.ts --all
//
// Exit code 1 when any verifiable run does not reproduce.

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { loadRunRecord } from '../lib/run-compare-data';
import { verifyRunReproducibility } from '../lib/run-compare';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main() {
  const runId = arg('--run');
  const positionId = arg('--position');
  const all = process.argv.includes('--all');
  if (!runId && !positionId && !all) {
    console.error('Usage: tsx scripts/verify-run-reproducibility.ts --run <id> | --position <id> | --all');
    process.exit(2);
  }
  const res = await db.execute(sql`
    SELECT id::text AS id, tenant_id::text AS "tenantId", label, method, status
      FROM scoring_runs
     WHERE status = 'completed'
       ${runId ? sql`AND id = ${runId}` : sql``}
       ${positionId ? sql`AND position_id = ${positionId}` : sql``}
     ORDER BY created_at
  `);
  const runs = res.rows as { id: string; tenantId: string; label: string | null; method: string; status: string }[];
  let verified = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of runs) {
    const record = await loadRunRecord(r.id, r.tenantId);
    if (!record) continue;
    const v = verifyRunReproducibility(record);
    if (!v.verifiable) {
      skipped += 1;
      console.log(`SKIP  ${r.id}  ${r.label ?? ''} — ${v.reason}`);
      continue;
    }
    verified += 1;
    if (v.reproducible) {
      console.log(
        `OK    ${r.id}  ${v.checked} kandidat · maks |Δ| tersimpan ${v.maxStoredDelta.toExponential(1)}` +
          (v.maxFullDelta != null ? ` · presisi penuh ${v.maxFullDelta.toExponential(1)}` : ' · presisi penuh tidak tersimpan'),
      );
    } else {
      failed += 1;
      console.log(`FAIL  ${r.id}  ${r.label ?? ''}`);
      for (const m of v.rankMismatches.slice(0, 5)) console.log(`        peringkat ${m.candidateId}: tersimpan ${m.stored}, dihitung ulang ${m.replayed}`);
      for (const m of v.closenessMismatches.slice(0, 5)) console.log(`        kedekatan ${m.candidateId}: tersimpan ${m.stored}, dihitung ulang ${m.replayed}`);
    }
  }
  console.log(`\n${verified} run diverifikasi, ${failed} tidak terulang, ${skipped} tidak dapat diverifikasi.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
