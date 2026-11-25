// End-to-end check that a "Tambah Kandidat Pembanding" child ranks on its
// PARENT's TOPSIS yardstick, against a REAL database with the REAL scoring
// engine (`runAhpTopsisSession`, in-process — the function scoring-service runs).
// What the unit tests (tests/scoring/topsis-anchored.test.ts) cannot see:
//
//   ANCH-1  a root records its own yardstick in run_info.frozen.topsis (classic, own);
//   ANCH-7  a parent that recorded NO yardstick (a run from before this rule —
//           the seeded R1, whose stored aspects differ per candidate) gets one
//           re-derived from its stored pool ('parent_pool');
//   ANCH-3  every carried candidate's closeness equals the parent's — bit for
//           bit where the parent stored full precision, at its 6 stored
//           decimals where it did not (R1) — and their order is identical;
//   ANCH-4  added candidates' clamp record matches their aspects: exactly the
//           criteria outside the ROOT's range, with the direction (above the
//           best / below the worst);
//   ANCH-5  "Keluar dari N besar" rows carry a cause, 'overtaken_by_comparison'
//           on an anchored child — and it BITES: a strong comparison candidate
//           enters the top N and pushes R1's last finalist out, and Komparasi
//           Versi names the same cause. A control prints what the old classic
//           rule would have done to the same child;
//   ANCH-6  a grandchild takes the child's RECORDED yardstick (= R1's) and keeps
//           the child's closeness bit for bit (incl. the child's added ones);
//   ANCH-8  every run here replays from its stored data (I-4), the anchored
//           ones on their recorded anchors, and the comparison's last
//           attribution step equals the child;
//   EXCL-1  the parent's exclusion mark is copied into the child by the SAME
//           statement startRerunAction runs (`inheritExclusionsStatement`), with
//           the origin run named, and a grandchild still names the origin.
//
// Why the chain runs on R1 and not on a root made here: with no model reachable
// the engine scores every fixture candidate alike (closeness 0.5 for all), so a
// root made here proves only ANCH-1 and I-4.
//
// Requires every migration through 0102 and the fixtures from
// scripts/seed-rerun-fixtures.ts. Writes only rows hanging off its own fixture
// position (and children of the seeded R1 on the seeded position), deletes its
// own position first, and deletes everything it wrote at the end unless --keep.
//
//   AHP_NARRATIVE_LLM=false TZ=Asia/Jakarta \
//     node --conditions=react-server --import tsx scripts/verify-anchored-rerun.ts [--keep]
//
// No model is reachable on purpose (narrative off, no Gemini key, embedding
// endpoint refused): model-backed aspects take their deterministic fallbacks.
// The yardstick does not depend on how an aspect was computed, only on the
// numbers, which is what is checked.

import 'dotenv/config';

process.env.AHP_NARRATIVE_LLM ??= 'false';
process.env.VECTOR_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.EMBEDDING_API_BASE ??= 'http://127.0.0.1:9/v1';
process.env.GEMINI_API_KEY = '';

// @ts-ignore — the root has no @types/pg (same as scripts/verify-datetime.ts)
import { Pool } from 'pg';
import { resolveFrozenBasis, childFinalistTarget } from '../lib/rerun-freeze';
import { inheritExclusionsStatement } from '../lib/rerun-exclusions';

const TENANT = '10000000-0000-0000-0000-000000000001';
const POSITION = 'fe000000-0000-4000-8000-00000000a005';
const SEEDED_POSITION = 'fe000000-0000-4000-8000-00000000a001';
const SEEDED_R1 = 'fe000000-0000-4000-8000-00000000c001';
const TEMPLATE = 'fe000000-0000-4000-8000-00000000b001';
const JP_ID = 990005;
const TITLE = 'FIXTURE ANCHORED IT DEVELOPMENT HEAD';
const cand = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const KEEP = process.argv.includes('--keep');

let failures = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
  const pool = new Pool({ connectionString: url });
  const q = async <T = any>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

  const { runAhpTopsisSession } = await import('../scoring-service/src/ahp-topsis-engine');
  const { loadRunRecord } = await import('../lib/run-compare-data');
  const { verifyRunReproducibility, attribute, replayRun } = await import('../lib/run-compare');
  const { db } = await import('../lib/db');

  const [{ id: userId }] = await q<{ id: string }>(`SELECT id FROM users WHERE email = 'system@pulse.local'`);
  const snapshot = (await q<{ config_snapshot: any }>(`SELECT config_snapshot FROM scoring_runs WHERE id = $1`, [SEEDED_R1]))[0]
    ?.config_snapshot;
  if (!userId || !snapshot) throw new Error('Run scripts/seed-rerun-fixtures.ts first.');

  const cleanup = async () => {
    await q(`DELETE FROM tournament_sessions WHERE position_id = $1`, [POSITION]);
    await q(`DELETE FROM critical_positions WHERE id = $1`, [POSITION]);
    await q(`DELETE FROM sync_job_profiles WHERE id = $1`, [JP_ID]);
    await q(`DELETE FROM scoring_run_exclusions WHERE run_id = $1 AND note = 'ANCH-VERIFY'`, [SEEDED_R1]);
    // The chain this script hung off the seeded R1 (child and grandchild).
    const mine = await q<{ id: string }>(`SELECT id FROM scoring_runs WHERE position_id = $1 AND label = 'ANCH-LEGACY'`, [SEEDED_POSITION]);
    for (const r of mine) {
      await q(`DELETE FROM tournament_sessions WHERE run_id = $1`, [r.id]);
      await q(`DELETE FROM scoring_runs WHERE id = $1`, [r.id]);
    }
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
     VALUES ($1, 'JD-ANCH.pdf', '/fixture/JD-ANCH.pdf', 'completed', $2, 'Memimpin pengembangan aplikasi', $3::jsonb)`,
    [JP_ID, TITLE, JSON.stringify({
      responsibilities: [{ responsibility: 'Memimpin pengembangan aplikasi inti', successIndicator: 'Rilis tepat waktu' }],
      technicalCompetencies: [{ competency: 'SOFTWARE DEVELOPMENT', level: 'ADVANCE' }, { competency: 'PROJECT MANAGEMENT', level: 'INTERMEDIATE' }],
      jobSpecification: { education: 'S1 Teknik Informatika', experience: '5 tahun' },
      problemSolving: { challenges: ['Koordinasi lintas divisi'] },
    })],
  );

  async function createRun(input: {
    positionId: string;
    pool: string[];
    targetFinalists: number;
    finalRanked: unknown;
    configSnapshot: unknown;
    parentRunId?: string | null;
    label?: string;
  }) {
    const [run] = await q<{ id: string }>(
      `INSERT INTO scoring_runs (position_id, tenant_id, method, label, candidate_count, created_by, program_template_id,
         program, status, filter_summary, config_snapshot, parent_run_id, rerun_mode, rerun_reason)
       VALUES ($1, $2, 'AHP_TOPSIS', $3, $4, $5, $6, 'fx-successor', 'in_progress', $7::jsonb, $8::jsonb, $9, $10, $11) RETURNING id`,
      [
        input.positionId, TENANT, input.label ?? 'ANCH', input.pool.length, userId, TEMPLATE,
        JSON.stringify({ minGradeId: '6', maxGradeId: '7', includedTenantIds: [TENANT] }),
        JSON.stringify(input.configSnapshot), input.parentRunId ?? null,
        input.parentRunId ? 'incremental_add' : 'baseline', input.parentRunId ? 'Verifikasi skala TOPSIS induk' : null,
      ],
    );
    const [session] = await q<{ id: string }>(
      `INSERT INTO tournament_sessions (tenant_id, position_id, program_template_id, label, target_finalists,
         current_pool, pending_pool, scoring_method, status, final_ranked, run_id, created_by)
       VALUES ($1, $2, $3, 'ANCH', $4, $5::jsonb, '[]'::jsonb, 'ahp_topsis', 'running', $6::jsonb, $7, $8) RETURNING id`,
      [TENANT, input.positionId, TEMPLATE, input.targetFinalists, JSON.stringify(input.pool), JSON.stringify(input.finalRanked ?? {}), run!.id, userId],
    );
    return { runId: run!.id, sessionId: session!.id };
  }
  const loadRun = async (id: string) => (await q<any>(`SELECT * FROM scoring_runs WHERE id = $1`, [id]))[0];
  const loadPool = async (id: string) =>
    q<{ candidate_id: string; aspects: any; closeness: string; pool_rank: number; is_finalist: boolean; details: any }>(
      `SELECT candidate_id::text, aspects, closeness, pool_rank, is_finalist, details FROM scoring_run_pool_aspects WHERE run_id = $1 ORDER BY pool_rank`,
      [id],
    );
  const fullCc = (row: { details: any; closeness: string }) => {
    const d = typeof row.details === 'string' ? JSON.parse(row.details) : row.details;
    return typeof d?.topsis?.closeness === 'number' ? (d.topsis.closeness as number) : Number(row.closeness);
  };

  /** Build and run a child of `parentId`, the way startRerunAction does. */
  async function child(parentId: string, positionId: string, rootId: string, newIds: string[], label?: string) {
    const parent = await loadRun(parentId);
    const parentPool = await loadPool(parentId);
    const frozen = resolveFrozenBasis({
      parent: { id: parentId, completedAt: parent.completed_at, createdAt: parent.created_at, runInfo: parent.run_info },
      rootRunId: rootId,
    });
    const poolIds = [...parentPool.map((r) => r.candidate_id), ...newIds].sort();
    const created = await createRun({
      positionId,
      pool: poolIds,
      targetFinalists: childFinalistTarget(parentPool.filter((r) => r.is_finalist).length, poolIds.length),
      finalRanked: { ahpRerun: { mode: 'incremental_add', baseRunId: parentId, newCandidateIds: newIds, existingPoolCandidateIds: [], frozen } },
      configSnapshot: { ...(parent.config_snapshot ?? snapshot), templateSource: 'inherited', inheritedFrom: parentId },
      parentRunId: parentId,
      label,
    });
    // The statement startRerunAction runs in its creation transaction.
    const copied = await db.execute(inheritExclusionsStatement(created.runId, parentId, TENANT));
    await runAhpTopsisSession(created.sessionId);
    return { ...created, copied: (copied.rows as unknown[]).length };
  }

  const CRIT = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'];

  /** ANCH-3/4/5 for one parent → child pair. */
  async function checkPair(tag: string, parentId: string, childId: string, newIds: string[], yardstickRunId: string) {
    const pp = await loadPool(parentId);
    const cp = await loadPool(childId);
    const pById = new Map(pp.map((r) => [r.candidate_id, r]));
    // A parent written with full precision (details.topsis) is compared bit for
    // bit; one that kept only numeric(10,6) — the seeded R1 — at those 6 decimals.
    const hasFull = (row: { details: any }) => {
      const d = typeof row.details === "string" ? JSON.parse(row.details) : row.details;
      return typeof d?.topsis?.closeness === "number";
    };
    let identical = 0;
    let at6 = 0;
    const differs: string[] = [];
    for (const r of cp) {
      const p = pById.get(r.candidate_id);
      if (!p) continue;
      if (hasFull(p)) {
        if (fullCc(r) === fullCc(p)) identical++;
        else differs.push(`${r.candidate_id.slice(-2)}: ${fullCc(p)} → ${fullCc(r)}`);
      } else if (Number(fullCc(r).toFixed(6)) === Number(p.closeness)) at6++;
      else differs.push(`${r.candidate_id.slice(-2)}: ${p.closeness} → ${fullCc(r)}`);
    }
    check(
      `${tag} ANCH-3 carried closeness equal to the parent's`,
      differs.length === 0 && identical + at6 === pp.length,
      `${identical} bit-identical, ${at6} equal at the parent's stored 6 decimals, of ${pp.length}${differs.length ? ` · ${differs.slice(0, 3).join("; ")}` : ""}`,
    );
    const carriedOrder = cp.filter((r) => pById.has(r.candidate_id)).map((r) => r.candidate_id);
    check(`${tag} ANCH-3 carried order identical to the parent`, carriedOrder.join() === pp.map((r) => r.candidate_id).join());
    const placed = cp.filter((r) => !pById.has(r.candidate_id)).map((r) => `#${r.pool_rank} (${fullCc(r).toFixed(4)})`);
    console.log(`INFO  ${tag}: added candidates placed at: ${placed.join(", ")} of ${cp.length}`);

    // ANCH-4: the clamp record = the added candidate's aspects outside the range
    // of the run that OWNS the yardstick (the root), with the right direction.
    // Same weights and divisor on both sides, so the raw comparison decides.
    const yp = await loadPool(yardstickRunId);
    const info = (await loadRun(childId)).run_info;
    const active: string[] = info?.frozen?.topsis?.activeCriteria ?? CRIT;
    const rec = new Map<string, any>((info?.rerun?.topsis?.clamped ?? []).map((c: any) => [c.candidateId, c]));
    let clampOk = true;
    const clampNotes: string[] = [];
    for (const id of newIds) {
      const row = cp.find((r) => r.candidate_id === id)!;
      const range = (k: string) => yp.map((r) => Number(r.aspects[k]));
      const above = active.filter((k) => Number(row.aspects[k]) > Math.max(...range(k))).sort();
      const below = active.filter((k) => Number(row.aspects[k]) < Math.min(...range(k))).sort();
      const got = rec.get(id);
      const gotAbove = [...(got?.above ?? [])].sort();
      const gotBelow = [...(got?.below ?? [])].sort();
      if (above.join() !== gotAbove.join() || below.join() !== gotBelow.join()) clampOk = false;
      clampNotes.push(`${id.slice(-2)}: atas [${gotAbove.join(", ")}] bawah [${gotBelow.join(", ")}]`);
    }
    check(`${tag} ANCH-4 clamp record = aspects outside the root's range, with direction`, clampOk, clampNotes.join(" · "));

    // ANCH-5: markers on the child's result rows.
    const results = await q<{ candidate_id: string; details: string }>(`SELECT candidate_id::text, details FROM analysis_results WHERE run_id = $1`, [childId]);
    const left = results
      .map((r) => ({ id: r.candidate_id, m: JSON.parse(r.details)?.ahpTopsis?.rerunMarkers }))
      .filter((r) => r.m?.leftTopN);
    check(
      `${tag} ANCH-5 every "Keluar dari N besar" row says it was overtaken by a comparison candidate`,
      left.every((r) => r.m.leftTopNCause === 'overtaken_by_comparison'),
      `${left.length} keluar: ${left.map((r) => `${r.id.slice(-2)}=${r.m.leftTopNCause}`).join(', ') || '—'}`,
    );
  }

  /** ANCH-8: replay + attribution. */
  async function checkReplay(tag: string, aId: string, bId: string) {
    const a = await loadRunRecord(aId, TENANT);
    const b = await loadRunRecord(bId, TENANT);
    const vb = verifyRunReproducibility(b!);
    check(`${tag} ANCH-8 the child replays from its stored data (I-4)`, vb.verifiable && vb.reproducible, JSON.stringify(vb.verifiable ? { maxStored: vb.maxStoredDelta, maxFull: vb.maxFullDelta, mode: b!.config.topsis.mode } : vb));
    const rb = replayRun(b!);
    const steps = attribute(a!, b!);
    const lastOk = Boolean(steps && rb.available && [...rb.byId].every(([id, v]) => steps[3]!.byId.get(id)?.rank === v.rank && steps[3]!.byId.get(id)?.closeness === v.closeness));
    check(`${tag} ANCH-8 the last attribution step equals the child`, lastOk);
  }

  // ── Root ───────────────────────────────────────────────────────────────
  const rootPool = Array.from({ length: 12 }, (_, i) => cand(i + 1)).sort();
  const root = await createRun({ positionId: POSITION, pool: rootPool, targetFinalists: 6, finalRanked: {}, configSnapshot: snapshot });
  await runAhpTopsisSession(root.sessionId);
  const rootRun = await loadRun(root.runId);
  const rt = rootRun.run_info?.frozen?.topsis;
  check('root completed', rootRun.status === 'completed');
  check('ANCH-1 root records its own yardstick', rt?.mode === 'classic' && rt?.source === 'own' && Number.isFinite(rt?.colNorms?.behavior), JSON.stringify({ mode: rt?.mode, source: rt?.source }));
  const rootPoolRows = await loadPool(root.runId);
  const ccs = rootPoolRows.map((r) => fullCc(r));
  console.log(`INFO  own root closeness: ${Math.min(...ccs).toFixed(4)} … ${Math.max(...ccs).toFixed(4)} (${new Set(ccs).size} distinct of ${ccs.length}) — with no model reachable the engine scores the fixture candidates alike, so the CHAIN below runs on the seeded R1, whose stored aspects differ`);
  const rootRec = await loadRunRecord(root.runId, TENANT);
  const vr = verifyRunReproducibility(rootRec!);
  check("ANCH-8 root replays from its stored data (I-4)", vr.verifiable && vr.reproducible);

  // ── The chain on R1: a parent that recorded NO yardstick (seeded, diverse aspects) ──
  const r1Run = await loadRun(SEEDED_R1);
  const r1Pool = await loadPool(SEEDED_R1);
  const r1Cc = r1Pool.map((r) => fullCc(r));
  console.log(`INFO  R1 closeness: ${Math.min(...r1Cc).toFixed(4)} … ${Math.max(...r1Cc).toFixed(4)} (${new Set(r1Cc).size} distinct of ${r1Cc.length})`);
  check("ANCH-7 precondition: R1 recorded no yardstick", r1Run.run_info?.frozen?.topsis == null);
  // The forum marks R1's rank-2 finalist (resigned). Marks live in their own
  // table (not guarded by I-1); this one is removed again in cleanup().
  await q(
    `INSERT INTO scoring_run_exclusions (tenant_id, run_id, candidate_id, reason, note, excluded_by)
     VALUES ($1, $2, $3, 'resigned', 'ANCH-VERIFY', $4) ON CONFLICT (run_id, candidate_id) DO NOTHING`,
    [TENANT, SEEDED_R1, r1Pool[1]!.candidate_id, userId],
  );
  const r1Marks = await q<{ candidate_id: string }>(`SELECT candidate_id::text FROM scoring_run_exclusions WHERE run_id = $1`, [SEEDED_R1]);
  const outsiders = Array.from({ length: 18 }, (_, i) => cand(i + 1)).filter((id) => !r1Pool.some((r) => r.candidate_id === id));
  if (outsiders.length < 3) throw new Error("Need 3 fixture candidates outside R1's pool.");

  // Child of R1: +2 new.
  const c1 = await child(SEEDED_R1, SEEDED_POSITION, SEEDED_R1, outsiders.slice(0, 2), "ANCH-LEGACY");
  const c1Run = await loadRun(c1.runId);
  const c1t = c1Run.run_info?.frozen?.topsis;
  check("child completed", c1Run.status === "completed", c1Run.run_info?.failure?.message);
  check("ANCH-7 the yardstick is re-derived from R1's stored pool", c1t?.mode === "anchored" && c1t?.source === "parent_pool", JSON.stringify({ mode: c1t?.mode, source: c1t?.source }));
  await checkPair("child", SEEDED_R1, c1.runId, outsiders.slice(0, 2), SEEDED_R1);
  await checkReplay("child", SEEDED_R1, c1.runId);
  const ex1 = await q<{ candidate_id: string; inherited_from_run_id: string }>(
    `SELECT candidate_id::text, inherited_from_run_id::text FROM scoring_run_exclusions WHERE run_id = $1`,
    [c1.runId],
  );
  check(
    "EXCL-1 the child inherits R1's marks, naming R1",
    r1Marks.length > 0 && c1.copied === r1Marks.length && ex1.length === r1Marks.length && ex1.every((e) => e.inherited_from_run_id === SEEDED_R1) &&
      r1Marks.every((m) => ex1.some((e) => e.candidate_id === m.candidate_id)),
    `R1 ${r1Marks.length} → child ${ex1.length}`,
  );

  // Grandchild: +1 new, on the child.
  const g = await child(c1.runId, SEEDED_POSITION, SEEDED_R1, outsiders.slice(2, 3), "ANCH-LEGACY");
  const gRun = await loadRun(g.runId);
  const gt = gRun.run_info?.frozen?.topsis;
  check("grandchild completed", gRun.status === "completed", gRun.run_info?.failure?.message);
  check(
    "ANCH-6 grandchild takes the child's RECORDED yardstick (= R1's), not one re-derived from the child's pool",
    gt?.mode === "anchored" && gt?.source === "parent" &&
      CRIT.every((k) => gt?.colNorms?.[k] === c1t?.colNorms?.[k] && gt?.idealPos?.[k] === c1t?.idealPos?.[k] && gt?.idealNeg?.[k] === c1t?.idealNeg?.[k]),
    JSON.stringify({ mode: gt?.mode, source: gt?.source }),
  );
  await checkPair("grandchild", c1.runId, g.runId, outsiders.slice(2, 3), SEEDED_R1);
  await checkReplay("grandchild", c1.runId, g.runId);
  const ex2 = await q<{ inherited_from_run_id: string }>(`SELECT inherited_from_run_id::text FROM scoring_run_exclusions WHERE run_id = $1`, [g.runId]);
  check("EXCL-1 the grandchild still names R1 as the origin", ex2.length === r1Marks.length && ex2.every((e) => e.inherited_from_run_id === SEEDED_R1));

  // ── A comparison candidate strong enough to enter the top N ───────────
  // Fixture #16 gets the strongest behaviour / PA / HAV the engine reads (its
  // technical and career fall back without a model), restored afterwards. This
  // is what makes ANCH-5 bite: somebody must actually leave the top N.
  const STRONG = cand(16);
  const [orig] = await q<{ performance_grade: string | null; behavior_recommendation: string | null; hav_quadrant: string | null }>(
    `SELECT performance_grade, behavior_recommendation, hav_quadrant FROM candidates WHERE id = $1`,
    [STRONG],
  );
  if (!orig || r1Pool.some((r) => r.candidate_id === STRONG)) throw new Error('Fixture #16 must exist and be outside R1.');
  try {
    await q(
      `UPDATE candidates SET performance_grade = 'A,A,A,A,A,A', behavior_recommendation = 'VERY HIGH', hav_quadrant = '1' WHERE id = $1`,
      [STRONG],
    );
    const s = await child(SEEDED_R1, SEEDED_POSITION, SEEDED_R1, [STRONG], 'ANCH-LEGACY');
    check('strong child completed', (await loadRun(s.runId)).status === 'completed');
    await checkPair('strong', SEEDED_R1, s.runId, [STRONG], SEEDED_R1);
    const sp = await loadPool(s.runId);
    const strongRank = sp.find((r) => r.candidate_id === STRONG)!.pool_rank;
    const res = await q<{ candidate_id: string; details: string }>(`SELECT candidate_id::text, details FROM analysis_results WHERE run_id = $1`, [s.runId]);
    const leftRows = res.filter((r) => JSON.parse(r.details)?.ahpTopsis?.rerunMarkers?.leftTopN);
    const r1Sixth = r1Pool.filter((r) => r.is_finalist).at(-1)!.candidate_id;
    check(
      'ANCH-5 (bites) the strong candidate enters the top N and pushes R1\'s last finalist out, marked "disalip kandidat pembanding"',
      strongRank <= r1Pool.filter((r) => r.is_finalist).length &&
        leftRows.length === 1 && leftRows[0]!.candidate_id === r1Sixth &&
        JSON.parse(leftRows[0]!.details).ahpTopsis.rerunMarkers.leftTopNCause === 'overtaken_by_comparison',
      `#16 at ${strongRank}; keluar: ${leftRows.map((r) => r.candidate_id.slice(-2)).join(', ') || '—'}`,
    );
    await checkReplay('strong', SEEDED_R1, s.runId);
    // Control: the SAME child ranked the old way (classic TOPSIS over the union).
    {
      const { rankPool } = await import('../lib/run-compare');
      const rec = (await loadRunRecord(s.runId, TENANT))!;
      const classic = rankPool(rec.pool, rec.config.weights!, rec.config.activeCriteria!);
      const order = [...classic.byId].sort((x, y) => x[1].rank - y[1].rank).map(([id]) => id);
      const carriedClassic = order.filter((id) => r1Pool.some((r) => r.candidate_id === id));
      const r1Order = r1Pool.map((r) => r.candidate_id);
      const moved = r1Order.filter((id, i) => carriedClassic[i] !== id).map((id) => `${id.slice(-2)} ${r1Order.indexOf(id) + 1}→${carriedClassic.indexOf(id) + 1}`);
      console.log(`INFO  control (old classic rule, same child): carried candidates reordered: ${moved.length ? moved.join(', ') : 'none'}; out of top N: ${r1Order.slice(0, 6).filter((id) => order.indexOf(id) >= 6).map((id) => id.slice(-2)).join(', ') || '—'}`);
    }
    // The comparison page must name the same cause.
    const { compareRuns } = await import('../lib/run-compare');
    const cmp = compareRuns((await loadRunRecord(SEEDED_R1, TENANT))!, (await loadRunRecord(s.runId, TENANT))!);
    const out = cmp.ranking.filter((r) => r.finalistChange === 'keluar');
    check(
      'ANCH-5 Komparasi Versi names the same cause',
      out.length === 1 && out[0]!.candidateId === r1Sixth && out[0]!.leftCause === 'overtaken_by_comparison',
      out.map((r) => `${r.candidateId.slice(-2)}=${r.leftCause}`).join(', '),
    );
  } finally {
    await q(
      `UPDATE candidates SET performance_grade = $2, behavior_recommendation = $3, hav_quadrant = $4 WHERE id = $1`,
      [STRONG, orig.performance_grade, orig.behavior_recommendation, orig.hav_quadrant],
    );
  }

  if (!KEEP) {
    await cleanup();
    const left = await q(`SELECT count(*)::int n FROM scoring_runs WHERE position_id = $1 OR (position_id = $2 AND label = 'ANCH-LEGACY')`, [POSITION, SEEDED_POSITION]);
    check('cleanup: nothing of this script is left', left[0].n === 0);
  }
  await pool.end();
  console.log(failures === 0 ? '\nSEMUA LULUS' : `\n${failures} GAGAL`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
