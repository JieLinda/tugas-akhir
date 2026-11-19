// NFR-RR-05 — how long a "Tambah Kandidat Pembanding" child takes, MEASURED
// on fixtures rather than asserted. Runs the REAL scoring engine
// (`runAhpTopsisSession`) in-process, the same way
// scripts/verify-rerun-requirements.ts does, on a position of its own:
//
//   root            12 candidates, everything scored
//   existing only   a child whose one comparison candidate is already in the
//                   parent's pool (nothing scored anew)
//   k = 1, 2, 4     children adding that many candidates the parent never scored
//
// each repeated --reps times (default 5). It prints, per scenario, the wall
// clock around the engine call, the engine's own `run_info.timings.totalMs`,
// the time until the ranking was on disk (`rankingReadyAt − startedAt`), and
// the median of every phase.
//
// What these numbers are NOT: production timings. No model is reachable here
// (the narrative LLM is off, Gemini has no key, the embedding endpoint
// refuses), so education, technical and career take their deterministic
// fallbacks and the narrative is the template. In production those phases
// wait on model calls; the measurement shows the shape — which phases scale
// with k and that the ranking does not wait for the narrative — not the
// durations HC will see. No threshold is asserted (NFR-RR-05).
//
// Requires the fixtures from scripts/seed-rerun-fixtures.ts and migrations
// through 0087. Writes only rows hanging off its own position, deletes them
// first, and deletes them again at the end unless --keep is given.
//
//   DATABASE_URL=… AHP_NARRATIVE_LLM=false TZ=Asia/Jakarta \
//     npx tsx scripts/measure-rerun-durations.ts [--reps 5] [--keep]

import 'dotenv/config';

process.env.AHP_NARRATIVE_LLM ??= 'false';
process.env.VECTOR_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.EMBEDDING_API_BASE ??= 'http://127.0.0.1:9/v1';

// @ts-ignore — the root has no @types/pg (same as scripts/verify-datetime.ts)
import { Pool } from 'pg';
import { resolveFrozenBasis, childFinalistTarget } from '../lib/rerun-freeze';

const TENANT = '10000000-0000-0000-0000-000000000001';
const POSITION = 'fe000000-0000-4000-8000-00000000a003';
const TEMPLATE = 'fe000000-0000-4000-8000-00000000b001';
const JP_ID = 990003;
const TITLE = 'FIXTURE DURATION IT DEVELOPMENT HEAD';
const cand = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const args = process.argv.slice(2);
const repsArg = args.indexOf('--reps');
const REPS = repsArg >= 0 ? Math.max(1, Number(args[repsArg + 1]) || 5) : 5;
const KEEP = args.includes('--keep');

const PHASES = ['load', 'basis', 'technical', 'career', 'behavior', 'education', 'topsis', 'persist', 'narrative', 'finalize'];

type Sample = { wallMs: number; totalMs: number; rankingMs: number; phases: Record<string, number> };

const median = (xs: number[]) => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const fmt = (x: number) => (Number.isFinite(x) ? String(Math.round(x)) : '—');
const spread = (xs: number[]) => `${fmt(median(xs))} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))})`;

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
  const pool = new Pool({ connectionString: url });
  const q = async <T = any>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

  // The engine reads its DB url at import time — import after the env is set.
  const { runAhpTopsisSession } = await import('../scoring-service/src/ahp-topsis-engine');

  const [{ id: userId } = { id: '' }] = await q<{ id: string }>(`SELECT id FROM users WHERE email = 'system@pulse.local'`);
  if (!userId) throw new Error('Run scripts/seed-rerun-fixtures.ts first.');
  const snapshot = (await q<{ config_snapshot: any }>(
    `SELECT config_snapshot FROM scoring_runs WHERE id = 'fe000000-0000-4000-8000-00000000c001'`,
  ))[0]?.config_snapshot;
  if (!snapshot) throw new Error('Run scripts/seed-rerun-fixtures.ts first (R1 snapshot missing).');

  const cleanup = async () => {
    await q(`DELETE FROM tournament_sessions WHERE position_id = $1`, [POSITION]);
    await q(`DELETE FROM scoring_runs WHERE position_id = $1`, [POSITION]);
    await q(`DELETE FROM critical_positions WHERE id = $1`, [POSITION]);
    await q(`DELETE FROM sync_job_profiles WHERE id = $1`, [JP_ID]);
  };
  await cleanup();

  await q(
    `INSERT INTO critical_positions (id, tenant_id, title, department, division, status, program_template_id,
       program_code, holder_name, holder_employee_id, min_grade_id, max_grade_id, created_by)
     VALUES ($1, $2, $3, 'IT Application', 'IT', 'active', $4, 'fx-successor', 'Yusuf Maulana', 'FX090', '6', '7', $5)`,
    [POSITION, TENANT, TITLE, TEMPLATE, userId],
  );
  await q(
    `INSERT INTO sync_job_profiles (id, file_name, file_path, status, position_name, job_purpose, extracted_data)
     VALUES ($1, 'JD-DURATION.pdf', '/fixture/JD-DURATION.pdf', 'completed', $2, 'Memimpin pengembangan aplikasi', $3::jsonb)`,
    [
      JP_ID,
      TITLE,
      JSON.stringify({
        responsibilities: [{ responsibility: 'Memimpin pengembangan aplikasi inti', successIndicator: 'Rilis tepat waktu' }],
        technicalCompetencies: [
          { competency: 'SOFTWARE DEVELOPMENT', level: 'ADVANCE' },
          { competency: 'PROJECT MANAGEMENT', level: 'INTERMEDIATE' },
        ],
        jobSpecification: { education: 'S1 Teknik Informatika', experience: '5 tahun' },
        problemSolving: { challenges: ['Koordinasi lintas divisi'] },
      }),
    ],
  );

  async function createRun(input: {
    pool: string[];
    targetFinalists: number;
    finalRanked: unknown;
    configSnapshot: unknown;
    parentRunId?: string | null;
    rerunMode?: string;
    reason?: string | null;
  }): Promise<{ runId: string; sessionId: string }> {
    const [run] = await q<{ id: string }>(
      `INSERT INTO scoring_runs (position_id, tenant_id, method, label, candidate_count, created_by, program_template_id,
         program, status, filter_summary, config_snapshot, parent_run_id, rerun_mode, rerun_reason)
       VALUES ($1, $2, 'AHP_TOPSIS', 'Durasi', $3, $4, $5, 'fx-successor', 'in_progress',
         $6::jsonb, $7::jsonb, $8, $9, $10) RETURNING id`,
      [
        POSITION, TENANT, input.pool.length, userId, TEMPLATE,
        JSON.stringify({ minGradeId: '6', maxGradeId: '7', includedTenantIds: [TENANT] }),
        JSON.stringify(input.configSnapshot), input.parentRunId ?? null, input.rerunMode ?? 'baseline', input.reason ?? null,
      ],
    );
    const [session] = await q<{ id: string }>(
      `INSERT INTO tournament_sessions (tenant_id, position_id, program_template_id, label, target_finalists,
         current_pool, pending_pool, scoring_method, status, final_ranked, run_id, created_by)
       VALUES ($1, $2, $3, 'Durasi', $4, $5::jsonb, '[]'::jsonb, 'ahp_topsis', 'running',
         $6::jsonb, $7, $8) RETURNING id`,
      [TENANT, POSITION, TEMPLATE, input.targetFinalists, JSON.stringify(input.pool), JSON.stringify(input.finalRanked ?? {}), run!.id, userId],
    );
    return { runId: run!.id, sessionId: session!.id };
  }

  async function measure(make: () => Promise<{ runId: string; sessionId: string }>): Promise<Sample & { runId: string }> {
    const { runId, sessionId } = await make();
    const t0 = performance.now();
    await runAhpTopsisSession(sessionId);
    const wallMs = performance.now() - t0;
    const [row] = await q<{ status: string; run_info: any }>(`SELECT status, run_info FROM scoring_runs WHERE id = $1`, [runId]);
    if (row?.status !== 'completed') throw new Error(`run ${runId} did not complete: ${JSON.stringify(row?.run_info?.failure ?? null)}`);
    const t = row.run_info?.timings ?? {};
    const rankingMs = t.rankingReadyAt && t.startedAt ? Date.parse(t.rankingReadyAt) - Date.parse(t.startedAt) : NaN;
    return { runId, wallMs, totalMs: Number(t.totalMs), rankingMs, phases: t.phasesMs ?? {} };
  }

  const rootPool = Array.from({ length: 12 }, (_, i) => cand(i + 1)).sort();
  const results: { name: string; samples: Sample[] }[] = [];

  // Roots: the same pool scored from scratch, for scale.
  const roots: (Sample & { runId: string })[] = [];
  for (let i = 0; i < REPS; i++) {
    roots.push(await measure(() => createRun({ pool: rootPool, targetFinalists: 6, finalRanked: {}, configSnapshot: snapshot })));
  }
  results.push({ name: 'Root (12 kandidat, semua dinilai)', samples: roots });

  // The parent every child below is derived from: the first root.
  const parentId = roots[0]!.runId;
  const [parentRun] = await q<any>(`SELECT * FROM scoring_runs WHERE id = $1`, [parentId]);
  const parentPoolRows = await q<{ candidate_id: string; is_finalist: boolean }>(
    `SELECT candidate_id, is_finalist FROM scoring_run_pool_aspects WHERE run_id = $1 ORDER BY pool_rank`,
    [parentId],
  );
  const parentFinalists = parentPoolRows.filter((r) => r.is_finalist).length;
  const belowCut = parentPoolRows.find((r) => !r.is_finalist)!.candidate_id;
  const frozen = resolveFrozenBasis({
    parent: { id: parentId, completedAt: parentRun.completed_at, createdAt: parentRun.created_at, runInfo: parentRun.run_info },
    rootRunId: parentId,
  });
  const childSnapshot = { ...snapshot, templateSource: 'inherited', inheritedFrom: parentId };

  const scenarios: { name: string; newIds: string[]; existing: string[] }[] = [
    { name: 'Turunan, 1 kandidat sudah di pool induk (tidak ada yang dinilai baru)', newIds: [], existing: [belowCut] },
    { name: 'Turunan, k = 1 kandidat baru', newIds: [cand(13)], existing: [] },
    { name: 'Turunan, k = 2 kandidat baru', newIds: [cand(13), cand(17)], existing: [] },
    { name: 'Turunan, k = 4 kandidat baru', newIds: [cand(13), cand(14), cand(16), cand(17)], existing: [] },
  ];
  for (const s of scenarios) {
    const childPool = [...rootPool, ...s.newIds].sort();
    const spec = {
      ahpRerun: { mode: 'incremental_add', baseRunId: parentId, newCandidateIds: s.newIds, existingPoolCandidateIds: s.existing, frozen },
    };
    const samples: Sample[] = [];
    for (let i = 0; i < REPS; i++) {
      samples.push(
        await measure(() =>
          createRun({
            pool: childPool,
            targetFinalists: childFinalistTarget(parentFinalists, childPool.length),
            finalRanked: spec,
            configSnapshot: childSnapshot,
            parentRunId: parentId,
            rerunMode: 'incremental_add',
            reason: 'Pengukuran durasi (NFR-RR-05)',
          }),
        ),
      );
    }
    results.push({ name: s.name, samples });
  }

  console.log(`\nNFR-RR-05 — durasi per skenario, ${REPS} ulangan, median (min–maks), milidetik.`);
  console.log('Tanpa model yang dapat dijangkau: angka ini batas bawah, bukan durasi produksi.\n');
  console.log('| Skenario | Jam dinding | Total engine | Sampai peringkat tersimpan |');
  console.log('|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${spread(r.samples.map((x) => x.wallMs))} | ${spread(r.samples.map((x) => x.totalMs))} | ${spread(r.samples.map((x) => x.rankingMs))} |`,
    );
  }
  console.log('\nMedian per tahap (ms):\n');
  console.log(`| Skenario | ${PHASES.join(' | ')} |`);
  console.log(`|---|${PHASES.map(() => '---').join('|')}|`);
  for (const r of results) {
    console.log(`| ${r.name} | ${PHASES.map((p) => fmt(median(r.samples.map((x) => Number(x.phases[p] ?? NaN))))).join(' | ')} |`);
  }

  if (!KEEP) await cleanup();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
