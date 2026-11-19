// End-to-end checks for "Tambah Kandidat Pembanding" against a REAL database,
// running the REAL scoring engine (`runAhpTopsisSession`) in-process. What the
// unit tests (tests/scoring/rerun-requirements.test.ts) cannot see:
//
//   FR-RR-07  a child scores its new candidates against the PARENT's position
//             basis even after the job profile changed in between;
//   FR-RR-06  the child's CR / λmax / CI and readiness thresholds are the parent's;
//   FR-RR-08  carried candidates' aspects are byte-identical to the parent (Q5b);
//   FR-RR-09  the child lists top N ∪ parent finalists ∪ comparison candidates;
//   NFR-RR-02 two children of one parent with the same request are identical;
//   NFR-RR-05 every run records `run_info.timings`, and the ranking is on disk
//             before the narrative;
//   FR-SN-05  a completed run cannot be changed (drizzle/0087);
//   FR-RR-12  a failed child records its failure on the RUN and leaves the
//             parent untouched;
//   NFR-RR-07 another tenant sees neither the runs nor the position's history,
//             and the comparison guard refuses it.
//
// Requires: a database with every migration applied (incl. 0086 and 0087) and
// the fixtures from scripts/seed-rerun-fixtures.ts (tenants, user, candidates,
// program template). Writes only rows hanging off its own fixture position and
// deletes them first, so it can be re-run.
//
//   DATABASE_URL=… AHP_NARRATIVE_LLM=false TZ=Asia/Jakarta \
//     npx tsx scripts/verify-rerun-requirements.ts
//
// No model is reachable here on purpose: the narrative LLM is switched off,
// Gemini has no key and the embedding endpoint refuses, so every model-backed
// branch takes its deterministic fallback. That is exactly the setting NFR-RR-02
// asks for ("with model calls mocked").

import 'dotenv/config';

process.env.AHP_NARRATIVE_LLM ??= 'false';
process.env.VECTOR_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.EMBEDDING_API_BASE ??= 'http://127.0.0.1:9/v1';

// @ts-ignore — the root has no @types/pg (same as scripts/verify-datetime.ts)
import { Pool } from 'pg';
import { resolveFrozenBasis, childFinalistTarget } from '../lib/rerun-freeze';
import { composeChildResultList } from '../scoring-service/src/rerun-freeze';

const TENANT = '10000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '10000000-0000-0000-0000-000000000002';
const POSITION = 'fe000000-0000-4000-8000-00000000a002';
const TEMPLATE = 'fe000000-0000-4000-8000-00000000b001';
const JP_ID = 990001;
const TITLE = 'FIXTURE E2E IT DEVELOPMENT HEAD';
const cand = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
  const pool = new Pool({ connectionString: url });
  const q = async <T = any>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

  // The engine reads its DB url at import time — import after the env is set.
  const { runAhpTopsisSession } = await import('../scoring-service/src/ahp-topsis-engine');
  const { startSessionProcessing } = await import('../scoring-service/src/runner');

  const [{ id: userId }] = await q<{ id: string }>(`SELECT id FROM users WHERE email = 'system@pulse.local'`);
  if (!userId) throw new Error('Run scripts/seed-rerun-fixtures.ts first.');

  // ── Clean slate for this script's own position ─────────────────────────
  await q(`DELETE FROM tournament_sessions WHERE position_id = $1`, [POSITION]);
  await q(`DELETE FROM critical_positions WHERE id = $1`, [POSITION]);
  await q(`DELETE FROM sync_job_profiles WHERE id = $1`, [JP_ID]);

  // ── The position and its job profile (the basis a root resolves) ───────
  await q(
    `INSERT INTO critical_positions (id, tenant_id, title, department, division, status, program_template_id,
       program_code, holder_name, holder_employee_id, min_grade_id, max_grade_id, created_by)
     VALUES ($1, $2, $3, 'IT Application', 'IT', 'active', $4, 'fx-successor', 'Yusuf Maulana', 'FX090', '6', '7', $5)`,
    [POSITION, TENANT, TITLE, TEMPLATE, userId],
  );
  const jd = (education: string, competencies: { competency: string; level: string }[]) =>
    JSON.stringify({
      responsibilities: [{ responsibility: 'Memimpin pengembangan aplikasi inti', successIndicator: 'Rilis tepat waktu' }],
      technicalCompetencies: competencies,
      jobSpecification: { education, experience: '5 tahun' },
      problemSolving: { challenges: ['Koordinasi lintas divisi'] },
    });
  await q(
    `INSERT INTO sync_job_profiles (id, file_name, file_path, status, position_name, job_purpose, extracted_data)
     VALUES ($1, 'JD-E2E.pdf', '/fixture/JD-E2E.pdf', 'completed', $2, 'Memimpin pengembangan aplikasi', $3::jsonb)`,
    [JP_ID, TITLE, jd('S1 Teknik Informatika', [
      { competency: 'SOFTWARE DEVELOPMENT', level: 'ADVANCE' },
      { competency: 'PROJECT MANAGEMENT', level: 'INTERMEDIATE' },
    ])],
  );

  const snapshot = (await q<{ config_snapshot: any }>(
    `SELECT config_snapshot FROM scoring_runs WHERE id = 'fe000000-0000-4000-8000-00000000c001'`,
  ))[0]?.config_snapshot;
  if (!snapshot) throw new Error('Run scripts/seed-rerun-fixtures.ts first (R1 snapshot missing).');

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
       VALUES ($1, $2, 'AHP_TOPSIS', 'E2E', $3, $4, $5, 'fx-successor', 'in_progress',
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
       VALUES ($1, $2, $3, 'E2E', $4, $5::jsonb, '[]'::jsonb, 'ahp_topsis', 'running',
         $6::jsonb, $7, $8) RETURNING id`,
      [TENANT, POSITION, TEMPLATE, input.targetFinalists, JSON.stringify(input.pool), JSON.stringify(input.finalRanked ?? {}), run!.id, userId],
    );
    return { runId: run!.id, sessionId: session!.id };
  }

  const loadRun = async (runId: string) =>
    (await q<any>(`SELECT * FROM scoring_runs WHERE id = $1`, [runId]))[0];
  const loadPool = async (runId: string) =>
    q<{ candidate_id: string; aspects: any; closeness: string; pool_rank: number; is_finalist: boolean; details: any }>(
      `SELECT candidate_id, aspects, closeness, pool_rank, is_finalist, details FROM scoring_run_pool_aspects WHERE run_id = $1 ORDER BY pool_rank`,
      [runId],
    );
  const loadResults = async (runId: string) =>
    q<{ candidate_id: string; rank: number; details: string }>(
      `SELECT candidate_id, rank, details FROM analysis_results WHERE run_id = $1 ORDER BY rank`,
      [runId],
    );

  // ── 1. Root ────────────────────────────────────────────────────────────
  const rootPool = Array.from({ length: 12 }, (_, i) => cand(i + 1)).sort();
  const root = await createRun({ pool: rootPool, targetFinalists: 6, finalRanked: {}, configSnapshot: snapshot });
  const t0 = Date.now();
  await runAhpTopsisSession(root.sessionId);
  const rootMs = Date.now() - t0;
  const rootRun = await loadRun(root.runId);
  const rootInfo = rootRun.run_info;
  check('root completed', rootRun.status === 'completed');
  check(
    'FR-RR-07a root records its position basis as values',
    rootInfo?.frozen?.positionBasis?.jobProfile?.educationRequirement === 'S1 Teknik Informatika' &&
      rootInfo?.frozen?.positionBasis?.required?.items?.length === 2,
    JSON.stringify(rootInfo?.frozen?.positionBasis?.required?.items ?? null),
  );
  check(
    'NFR-RR-05 root records timings per phase',
    rootInfo?.timings?.totalMs > 0 && typeof rootInfo?.timings?.phasesMs?.topsis === 'number' &&
      Boolean(rootInfo?.timings?.rankingReadyAt),
    JSON.stringify(rootInfo?.timings?.phasesMs ?? null),
  );
  check('FR-SN-04 root labels readiness from its own snapshot', rootInfo?.readiness?.source === 'snapshot');
  check('FR-SN-01 root records models and data versions', Boolean(rootInfo?.models?.embedding) && Boolean(rootInfo?.dataVersions));

  // ── 2. Governance and data move after the root ─────────────────────────
  await q(`UPDATE sync_job_profiles SET extracted_data = $2::jsonb WHERE id = $1`, [JP_ID, jd('S2 Magister Manajemen', [])]);
  await q(`UPDATE critical_positions SET education = 'D3 Akuntansi' WHERE id = $1`, [POSITION]);

  // ── 3. Child: + Sari (new) + one in the root's pool below its cut ──────
  const rootPoolRows = await loadPool(root.runId);
  const belowCut = rootPoolRows.find((r) => !r.is_finalist)!.candidate_id;
  const newId = cand(13);
  const frozen = resolveFrozenBasis({
    parent: { id: root.runId, completedAt: rootRun.completed_at, createdAt: rootRun.created_at, runInfo: rootInfo },
    rootRunId: root.runId,
  });
  const childPool = [...rootPool, newId].sort();
  const parentFinalists = rootPoolRows.filter((r) => r.is_finalist).length;
  const spec = {
    ahpRerun: {
      mode: 'incremental_add',
      baseRunId: root.runId,
      newCandidateIds: [newId],
      existingPoolCandidateIds: [belowCut],
      frozen,
    },
  };
  const childSnapshot = { ...snapshot, templateSource: 'inherited', inheritedFrom: root.runId };
  const makeChild = () =>
    createRun({
      pool: childPool,
      targetFinalists: childFinalistTarget(parentFinalists, childPool.length),
      finalRanked: spec,
      configSnapshot: childSnapshot,
      parentRunId: root.runId,
      rerunMode: 'incremental_add',
      reason: 'E2E: forum meminta Sari dibandingkan',
    });
  const child = await makeChild();
  const t1 = Date.now();
  await runAhpTopsisSession(child.sessionId);
  const childMs = Date.now() - t1;
  const childRun = await loadRun(child.runId);
  const childInfo = childRun.run_info;
  check('child completed', childRun.status === 'completed');
  check('FR-RR-07b child takes the parent basis', childInfo?.positionBasisStatus?.source === 'parent', JSON.stringify(childInfo?.positionBasisStatus ?? null));

  const childResults = await loadResults(child.runId);
  const newRow = childResults.find((r) => r.candidate_id === newId);
  const newDetails = newRow ? JSON.parse(newRow.details) : null;
  check(
    'FR-RR-07c the new candidate is scored against the PARENT education requirement',
    newDetails?.ahpTopsis?.educationDetail?.requirement === 'S1 Teknik Informatika',
    String(newDetails?.ahpTopsis?.educationDetail?.requirement),
  );
  check(
    'FR-RR-07d the new candidate is matched against the PARENT competency reference',
    newDetails?.ahpTopsis?.technicalMatching?.requiredCount === 2,
    String(newDetails?.ahpTopsis?.technicalMatching?.requiredCount),
  );
  check(
    'FR-RR-06 child CR / λmax / CI are the parent\'s',
    childInfo?.ahp?.consistencyRatio === rootInfo?.ahp?.consistencyRatio &&
      childInfo?.ahp?.lambdaMax === rootInfo?.ahp?.lambdaMax,
  );
  check('FR-RR-06 child labels readiness from its (inherited) snapshot', childInfo?.readiness?.source === 'snapshot');

  // Carried candidates byte-identical (Q5b).
  const q5b = await q(
    `SELECT pc.candidate_id FROM scoring_run_pool_aspects pc
       JOIN scoring_run_pool_aspects pp ON pp.run_id = $2 AND pp.candidate_id = pc.candidate_id
      WHERE pc.run_id = $1 AND pc.aspects IS DISTINCT FROM pp.aspects`,
    [child.runId, root.runId],
  );
  check('FR-RR-08 carried candidates keep the parent\'s aspects exactly (Q5b = 0 rows)', q5b.length === 0, `${q5b.length} rows`);

  // FR-RR-09: listed rows are exactly the composition rule.
  const childPoolRows = await loadPool(child.runId);
  const expected = composeChildResultList({
    rankedIds: childPoolRows.map((r) => r.candidate_id),
    topN: parentFinalists,
    parentFinalistIds: new Set(rootPoolRows.filter((r) => r.is_finalist).map((r) => r.candidate_id)),
    comparisonIds: new Set([newId, belowCut]),
  }).listed.map((l) => l.candidateId);
  check(
    'FR-RR-09 child lists top N ∪ parent finalists ∪ comparison candidates',
    JSON.stringify(childResults.map((r) => r.candidate_id)) === JSON.stringify(expected),
    `${childResults.length} rows`,
  );
  const marked = childResults.map((r) => JSON.parse(r.details).ahpTopsis.rerunMarkers);
  check('FR-RR-09 rows carry the markers', marked.every((m: any) => m && typeof m.comparison === 'boolean'));

  // ── 4. Determinism: the same request again (NFR-RR-02) ─────────────────
  const twin = await makeChild();
  await runAhpTopsisSession(twin.sessionId);
  const twinPool = await loadPool(twin.runId);
  const same =
    twinPool.length === childPoolRows.length &&
    twinPool.every((r, i) => {
      const a = childPoolRows[i]!;
      return (
        r.candidate_id === a.candidate_id &&
        JSON.stringify(r.aspects) === JSON.stringify(a.aspects) &&
        r.details?.topsis?.closeness === a.details?.topsis?.closeness
      );
    });
  check('NFR-RR-02 two children with the same request are identical to full precision', same);

  // ── 5. Immutability (FR-SN-05 / NFR-RR-03) ─────────────────────────────
  let blocked = false;
  try {
    await q(`UPDATE scoring_runs SET run_info = run_info || '{"tampered":true}' WHERE id = $1`, [child.runId]);
  } catch {
    blocked = true;
  }
  check('FR-SN-05 a completed run refuses any change', blocked);
  let resultBlocked = false;
  try {
    await q(`UPDATE analysis_results SET final_score = 0.01 WHERE run_id = $1`, [child.runId]);
  } catch {
    resultBlocked = true;
  }
  check('FR-SN-05 a completed run\'s results refuse any change', resultBlocked);

  // ── 6. Failure is recorded on the run; the parent is untouched ─────────
  const rootBefore = JSON.stringify((await loadRun(root.runId)).run_info);
  const broken = await createRun({
    pool: childPool,
    targetFinalists: 6,
    finalRanked: { ahpExclude: { baseRunId: root.runId, excludedCandidateIds: [] } },
    configSnapshot: childSnapshot,
    parentRunId: root.runId,
    rerunMode: 'incremental_add',
    reason: 'E2E: sesi dengan kunci lama',
  });
  startSessionProcessing(broken.sessionId);
  let brokenRun: any = null;
  for (let i = 0; i < 50; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    brokenRun = await loadRun(broken.runId);
    if (brokenRun.run_info?.failure) break;
  }
  check(
    'FR-RR-12 a failed child records why, on the run',
    brokenRun?.status === 'in_progress' && /versi lama/.test(brokenRun?.run_info?.failure?.message ?? ''),
    brokenRun?.run_info?.failure?.message,
  );
  check('FR-RR-12 the parent is untouched by the failure', JSON.stringify((await loadRun(root.runId)).run_info) === rootBefore);

  // The comparison and its run pickers read through these two loaders; another
  // tenant must see neither the runs nor the position's history.
  const { loadRunRecord, listPositionRuns } = await import('../lib/run-compare-data');
  const { comparabilityError } = await import('../lib/run-compare');
  const own = await loadRunRecord(child.runId, TENANT);
  const foreign = await loadRunRecord(child.runId, OTHER_TENANT);
  check('NFR-RR-07 a run is invisible to another tenant (comparison loader)', Boolean(own) && foreign === null);
  check(
    'NFR-RR-07 another tenant cannot compare it (server guard)',
    comparabilityError(own, foreign) === 'Run tidak ditemukan di Company ini.',
  );
  const ownRuns = await listPositionRuns(POSITION, TENANT);
  const foreignRuns = await listPositionRuns(POSITION, OTHER_TENANT);
  check('NFR-RR-07 the position history is invisible to another tenant', ownRuns.length > 0 && foreignRuns.length === 0, `${ownRuns.length} vs ${foreignRuns.length}`);

  console.log(`\nDurations (fixture, no model reachable): root ${rootMs} ms · child ${childMs} ms`);
  console.log('root phases (ms):', JSON.stringify(rootInfo?.timings?.phasesMs));
  console.log('child phases (ms):', JSON.stringify(childInfo?.timings?.phasesMs));
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
