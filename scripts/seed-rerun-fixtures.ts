// Seed a small, self-contained set of scoring runs for ONE position, so the
// re-run ("Tambah Kandidat Pembanding"), the run tree and the 1:1 run
// comparison can be exercised end to end on a local database.
//
//   DATABASE_URL=postgres://… tsx scripts/seed-rerun-fixtures.ts
//
// Idempotent: every row it writes hangs off one fixture position (and a fixed
// set of fixture candidate ids), and a re-run deletes those first. It never
// touches anything else.
//
// The numbers are SYNTHETIC aspect scores, but every ranking is computed by the
// engine's own ranking function (`rankCandidatesByTopsis`, scoring-service) and
// every derived run's frozen basis by the web app's own `resolveFrozenBasis` —
// so the rows have exactly the shape and the arithmetic real runs have. What
// the fixture contains:
//
//   R1  root, default AHP weights, 12 candidates, 6 finalists, a forum decision
//       (rank 2 chosen, not rank 1) and one exclusion mark
//   C1  "Tambah Kandidat Pembanding" child of R1: +1 new candidate (scored),
//       +1 already in R1's pool below the cut (carried, not re-scored)
//   F1  a child of R1 whose scoring failed (session failed, run never completed)
//   R2  a second root with a different AHP matrix, a changed pool and one
//       candidate's data changed — the "root vs root" comparison case
//   L1  a legacy-mode child (`refresh_add`) of R1 — must stay readable
//   O1  a legacy `exclude` child whose parent was deleted (FK set it to NULL)

import 'dotenv/config';
// @ts-ignore — the root has no @types/pg (same as scripts/verify-datetime.ts)
import { Pool } from 'pg';
import { rankCandidatesByTopsis } from '../scoring-service/src/ahp-topsis-engine';
import { computeAhpWeights, pairwiseFromWeights } from '../scoring-service/src/ahp';
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from '../scoring-service/src/ahp-weights';
import { buildFrozenRecord } from '../scoring-service/src/rerun-freeze';
import { resolveFrozenBasis, deriveChildSnapshot } from '../lib/rerun-freeze';
import { systemProgramTemplates } from '../lib/program-defaults';
import type { RunConfigSnapshot, RunRerunSnapshot, FilterCondition } from '../lib/db/schema';
import readinessConfig from '../lib/readiness-config.json';

const TENANT = '10000000-0000-0000-0000-000000000001'; // Mulia
const POSITION = 'fe000000-0000-4000-8000-00000000a001';
const TEMPLATE = 'fe000000-0000-4000-8000-00000000b001';
const id = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const RUN = {
  R1: 'fe000000-0000-4000-8000-00000000c001',
  C1: 'fe000000-0000-4000-8000-00000000c002',
  F1: 'fe000000-0000-4000-8000-00000000c003',
  R2: 'fe000000-0000-4000-8000-00000000c004',
  L1: 'fe000000-0000-4000-8000-00000000c005',
  O1: 'fe000000-0000-4000-8000-00000000c006',
  P0: 'fe000000-0000-4000-8000-00000000c007', // O1's parent, deleted below
};

type Aspects = Record<AhpCriterionKey, number>;
type Cand = {
  n: number;
  name: string;
  grade: string;
  position: string;
  department: string;
  discipline: string;
  mcu: string;
  mcuNote?: string;
  aspects: Aspects;
};
const a = (t: number, c: number, b: number, p: number, h: number, e: number): Aspects => ({
  technical: t,
  career: c,
  behavior: b,
  performance: p,
  hav: h,
  education: e,
});

// Pool of R1 = 1..12. 13 (Sari) is the comparison candidate added in C1 and
// the new technical maximum; 14 joins R2; 15 fails a hard rule (Rejected),
// 16 is outside the grade range (Excluded), 17 is MCU fit-with-note
// (Reconsidered). 90 is the sitting incumbent.
const CANDS: Cand[] = [
  { n: 1, name: 'Andi Pratama', grade: '7', position: 'IT APPLICATION SECTION HEAD', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(78, 70, 83, 67, 80, 70) },
  { n: 2, name: 'Budi Santoso', grade: '7', position: 'IT DEVELOPMENT SECTION HEAD', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(80, 82, 83, 67, 80, 60) },
  { n: 3, name: 'Citra Lestari', grade: '7', position: 'IT QA SECTION HEAD', department: 'IT Quality', discipline: 'CLEAR', mcu: 'fit', aspects: a(66, 64, 70, 100, 80, 70) },
  { n: 4, name: 'Dewi Anggraini', grade: '6', position: 'IT BUSINESS ANALYST', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(72, 58, 83, 67, 60, 85) },
  { n: 5, name: 'Eko Nugroho', grade: '7', position: 'IT INFRA SECTION HEAD', department: 'IT Infrastructure', discipline: 'CLEAR', mcu: 'fit', aspects: a(61, 40, 83, 67, 80, 70) },
  { n: 6, name: 'Fajar Hidayat', grade: '6', position: 'SENIOR PROGRAMMER', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(70, 75, 50, 67, 60, 70) },
  { n: 7, name: 'Gita Permata', grade: '7', position: 'IT PMO SECTION HEAD', department: 'IT PMO', discipline: 'CLEAR', mcu: 'fit', aspects: a(55, 62, 83, 33, 80, 70) },
  { n: 8, name: 'Hendra Wijaya', grade: '6', position: 'IT SUPPORT SUPERVISOR', department: 'IT Support', discipline: 'CLEAR', mcu: 'fit', aspects: a(48, 35, 70, 67, 60, 50) },
  { n: 9, name: 'Indah Purnama', grade: '6', position: 'DATA ANALYST', department: 'IT Data', discipline: 'CLEAR', mcu: 'fit', aspects: a(64, 50, 50, 67, 40, 85) },
  { n: 10, name: 'Joko Susilo', grade: '7', position: 'NETWORK SECTION HEAD', department: 'IT Infrastructure', discipline: 'CLEAR', mcu: 'fit', aspects: a(45, 30, 83, 33, 60, 50) },
  { n: 11, name: 'Kartika Sari', grade: '6', position: 'SYSTEM ANALYST', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(68, 66, 33, 67, 40, 70) },
  { n: 12, name: 'Lukman Hakim', grade: '6', position: 'DBA SUPERVISOR', department: 'IT Infrastructure', discipline: 'CLEAR', mcu: 'fit', aspects: a(52, 44, 50, 33, 40, 50) },
  { n: 13, name: 'Sari Wulandari', grade: '7', position: 'DIGITAL PRODUCT SECTION HEAD', department: 'Digital', discipline: 'CLEAR', mcu: 'fit', aspects: a(88, 72, 70, 67, 80, 70) },
  { n: 14, name: 'Teguh Prakoso', grade: '7', position: 'ERP SECTION HEAD', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(74, 68, 70, 67, 60, 70) },
  { n: 15, name: 'Umar Bakri', grade: '7', position: 'IT AUDIT SECTION HEAD', department: 'Internal Audit', discipline: 'SP1', mcu: 'fit', aspects: a(70, 60, 70, 67, 60, 70) },
  { n: 16, name: 'Vina Oktaviani', grade: '4', position: 'PROGRAMMER', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(62, 40, 70, 67, 60, 70) },
  { n: 17, name: 'Wawan Setiawan', grade: '7', position: 'IT SECURITY SECTION HEAD', department: 'IT Security', discipline: 'CLEAR', mcu: 'fit_with_note', mcuNote: 'Tekanan darah tinggi terkontrol obat', aspects: a(69, 63, 70, 67, 80, 70) },
  { n: 90, name: 'Yusuf Maulana', grade: '8', position: 'IT APPLICATION DEVELOPMENT DEPARTMENT HEAD', department: 'IT Application', discipline: 'CLEAR', mcu: 'fit', aspects: a(90, 90, 83, 100, 100, 85) },
];
const byN = new Map(CANDS.map((c) => [c.n, c]));
const npk = (n: number) => `FX${String(n).padStart(3, '0')}`;

const DEFAULT_VECTOR = AHP_CRITERIA_ORDER.map((k) => ({ technical: 25, career: 5, behavior: 35, performance: 10, hav: 20, education: 5 })[k]);
const TECHNICAL_VECTOR = AHP_CRITERIA_ORDER.map((k) => ({ technical: 40, career: 10, behavior: 25, performance: 10, hav: 10, education: 5 })[k]);

function ahpFrom(vector: number[]) {
  const pairwise = pairwiseFromWeights(vector);
  const r = computeAhpWeights(pairwise);
  const weights = Object.fromEntries(AHP_CRITERIA_ORDER.map((k, i) => [k, r.weights[i]!])) as Aspects;
  return { pairwise, weights, cr: r.cr, lambdaMax: r.lambdaMax, ci: r.ci };
}

function readinessOf(score: number): string {
  for (const t of readinessConfig.thresholds) if (score >= t.minScore) return t.level;
  return readinessConfig.defaultLevel;
}

const program = systemProgramTemplates.find((t) => t.code === 'successor')!;
const filterTree: FilterCondition & { kind: 'group' } = {
  kind: 'group',
  op: 'and',
  children: program.filterRules.map((rule) => ({ kind: 'rule' as const, rule })),
};

function snapshot(capturedAt: string, ahpConfig: unknown): RunConfigSnapshot {
  return {
    version: 1,
    capturedAt,
    templateSource: 'live',
    template: {
      id: TEMPLATE,
      code: 'successor',
      name: 'Critical Position',
      description: program.description,
      targetFinalists: 6,
      defaultMethod: 'AHP_TOPSIS',
      enforceFilterRules: true,
      isSystem: true,
      filterTree,
      ruleCount: program.filterRules.length,
      defaultCriteria: program.defaultCriteria,
      ahpConfig: (ahpConfig ?? null) as NonNullable<RunConfigSnapshot['template']>['ahpConfig'],
      updatedAt: capturedAt,
    },
    readiness: readinessConfig,
  };
}

type Ranked = ReturnType<typeof rankCandidatesByTopsis<{ id: string }>>;

function rank(pool: Map<string, Aspects>, weights: Aspects, dropped: AhpCriterionKey[] = []): Ranked {
  // Engine row order: candidates ORDER BY id (loadAhpCandidates).
  const candidates = [...pool.keys()].sort().map((cid) => ({ id: cid }));
  return rankCandidatesByTopsis(candidates, pool, weights, new Set(dropped));
}

function runInfoFor(input: {
  runId: string;
  ranked: Ranked;
  ahp: ReturnType<typeof ahpFrom>;
  weightSource: string;
  finalists: number;
  referenceDate: string;
  frozen: Parameters<typeof buildFrozenRecord>[0]['frozen'];
  extra?: Record<string, unknown>;
}) {
  const technical = { simFloor: 0.5123456789, simCeil: 0.8876543211, source: 'measured' };
  const career = { simFloor: 0.6331234567, simCeil: 0.8921234567, source: 'measured' };
  const depth = { targetYears: 9.25, targetRows: 2 };
  const frozenRecord = buildFrozenRecord({
    frozen: input.frozen,
    runId: input.runId,
    referenceDate: new Date(input.referenceDate),
    weights: input.frozen?.ahp.weights ?? input.ahp.weights,
    pairwise: input.frozen?.ahp.pairwise ?? input.ahp.pairwise,
    weightSource: input.weightSource,
    weightsInherited: Boolean(input.frozen?.ahp.weights),
    activeCriteria: input.ranked.activeCriteria,
    liveDroppedCriteria: [],
    criteriaSource: input.frozen ? 'parent' : 'live',
    technical: input.frozen?.anchors.technical ?? technical,
    career: input.frozen?.anchors.career ?? career,
    anchorsInherited: Boolean(input.frozen?.anchors.technical && input.frozen?.anchors.career),
    depth: input.frozen?.anchors.depth ?? depth,
  });
  return {
    jobProfileMatched: 'IT Application Development Department Head',
    scoredCandidates: input.ranked.rankedAll.length,
    finalists: input.finalists,
    appendedBelowCut: 0,
    rerun: null,
    augment: null,
    freshness: null,
    frozen: frozenRecord,
    narrative: { llmEnabled: false, model: null, llmWritten: 0, templateFallback: input.finalists },
    encryption: null,
    technical: {
      requiredCount: 9,
      hasRequired: true,
      requiredSource: 'job_profile',
      simFloor: Number(technical.simFloor.toFixed(4)),
      simCeil: Number(technical.simCeil.toFixed(4)),
      simAnchorSource: technical.source,
    },
    career: {
      scale: { simFloor: Number(career.simFloor.toFixed(4)), simCeil: Number(career.simCeil.toFixed(4)), source: career.source },
      depth: { ...depth, source: 'measured' },
    },
    ahp: {
      weightSource: input.weightSource,
      consistencyRatio: Number(input.ahp.cr.toFixed(4)),
      lambdaMax: Number(input.ahp.lambdaMax.toFixed(4)),
      consistencyIndex: Number(input.ahp.ci.toFixed(4)),
      inconsistent: input.ahp.cr > 0.1,
      weights: frozenRecord.ahp.weights,
      criteriaOrder: [...AHP_CRITERIA_ORDER],
      pairwise: frozenRecord.ahp.pairwise.map((r: number[]) => r.map((v) => Number(v.toFixed(4)))),
      droppedCriteria: [],
      activeCriteria: [...input.ranked.activeCriteria],
      effectiveWeights: input.ranked.effectiveWeights,
    },
    ...input.extra,
  };
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
  const pool = new Pool({ connectionString: url });
  const q = (text: string, params: unknown[] = []) => pool.query(text, params);

  // ── Clean up a previous seed ────────────────────────────────────────────
  await q(`DELETE FROM tournament_sessions WHERE position_id = $1`, [POSITION]);
  await q(`DELETE FROM critical_positions WHERE id = $1`, [POSITION]);
  await q(`DELETE FROM candidates WHERE id = ANY($1::uuid[])`, [CANDS.map((c) => id(c.n))]);
  await q(`DELETE FROM program_templates WHERE id = $1`, [TEMPLATE]);

  // ── Tenants, user, program, position, candidates ────────────────────────
  for (const t of [
    ['10000000-0000-0000-0000-000000000001', 'mulia', 'Mulia'],
    ['10000000-0000-0000-0000-000000000002', 'mso', 'MSO'],
    ['10000000-0000-0000-0000-000000000003', 'erro', 'ERRO'],
  ]) {
    await q(`INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, t);
  }
  const user = await q(
    `INSERT INTO users (email, name, tenant_id) VALUES ('system@pulse.local', 'System User', $1)
     ON CONFLICT (email) DO UPDATE SET updated_at = NOW() RETURNING id`,
    [TENANT],
  );
  const userId = user.rows[0].id as string;

  await q(
    `INSERT INTO program_templates (id, tenant_id, code, name, description, filter_rules, default_criteria,
       default_method, is_system, created_by, target_finalists, enforce_filter_rules, ahp_config)
     VALUES ($1, $2, 'fx-successor', 'Critical Position (fixture)', $3, $4::jsonb, $5::jsonb,
       'AHP_TOPSIS', false, $6, 6, true, NULL)`,
    [TEMPLATE, TENANT, program.description, JSON.stringify({ tree: filterTree }), JSON.stringify(program.defaultCriteria), userId],
  );
  await q(
    `INSERT INTO critical_positions (id, tenant_id, title, department, division, status, program_template_id,
       program_code, holder_name, holder_employee_id, min_grade_id, max_grade_id, created_by)
     VALUES ($1, $2, 'FIXTURE IT APPLICATION DEVELOPMENT DEPARTMENT HEAD', 'IT Application', 'IT',
       'active', $3, 'fx-successor', $4, $5, '6', '7', $6)`,
    [POSITION, TENANT, TEMPLATE, byN.get(90)!.name, npk(90), userId],
  );
  for (const c of CANDS) {
    await q(
      `INSERT INTO candidates (id, tenant_id, name, current_position, department, division, years_experience,
         created_by, employee_id, discipline_status, mcu_status, mcu_note, performance_grade, hav_quadrant,
         education, major, grade, behavior_recommendation)
       VALUES ($1, $2, $3, $4, $5, 'IT', '8', $6, $7, $8, $9, $10, 'B', '2', 'S1', 'Teknik Informatika', $11, 'DISARANKAN')`,
      [id(c.n), TENANT, c.name, c.position, c.department, userId, npk(c.n), c.discipline, c.mcu, c.mcuNote ?? null, c.grade],
    );
  }

  // ── Generic writers ─────────────────────────────────────────────────────
  // Runs are written `in_progress` and marked `completed` LAST, like the engine
  // does: drizzle/0087 refuses any write to a completed run (I-1).
  const toComplete: string[] = [];
  async function writeRun(input: {
    runId: string;
    label: string;
    status?: string;
    createdAt: string;
    completedAt: string | null;
    parentRunId?: string | null;
    rerunMode?: string;
    rerunReason?: string | null;
    candidateCount: number;
    configSnapshot: RunConfigSnapshot | null;
    runInfo: unknown;
    filterSummary: unknown;
  }) {
    await q(
      `INSERT INTO scoring_runs (id, position_id, tenant_id, method, label, candidate_count, created_by, created_at,
         program_template_id, program, status, filter_summary, completed_at, config_snapshot, run_info,
         parent_run_id, rerun_mode, rerun_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'fx-successor', $10, $11::jsonb, $12, $13::jsonb, $14::jsonb,
         $15, $16, $17)`,
      [
        input.runId, POSITION, TENANT, 'AHP_TOPSIS', input.label, input.candidateCount, userId,
        input.createdAt, TEMPLATE, (input.status ?? 'completed') === 'completed' ? 'in_progress' : input.status,
        JSON.stringify(input.filterSummary),
        input.completedAt, input.configSnapshot ? JSON.stringify(input.configSnapshot) : null,
        input.runInfo ? JSON.stringify(input.runInfo) : null, input.parentRunId ?? null,
        input.rerunMode ?? 'baseline', input.rerunReason ?? null,
      ],
    );
    if ((input.status ?? 'completed') === 'completed') toComplete.push(input.runId);
  }

  async function writeSession(runId: string, status: string, poolIds: string[], finalRanked: unknown, createdAt: string) {
    await q(
      `INSERT INTO tournament_sessions (tenant_id, position_id, program_template_id, label, target_finalists,
         current_pool, pending_pool, scoring_method, status, final_ranked, run_id,
         created_by, created_at, updated_at)
       VALUES ($1, $2, $3, 'fixture', 6, $4::jsonb, '[]'::jsonb, 'ahp_topsis', $5,
         $6::jsonb, $7, $8, $9, $9)`,
      [TENANT, POSITION, TEMPLATE, JSON.stringify(poolIds), status, JSON.stringify(finalRanked), runId, userId, createdAt],
    );
  }

  async function writeResults(input: {
    runId: string;
    ranked: Ranked;
    aspects: Map<string, Aspects>;
    finalists: number;
    alwaysInclude?: Set<string>;
    weights: Aspects;
    weightSource: string;
    cr: number;
    rerunSource?: (cid: string) => string | null;
    reusedFrom?: string | null;
    reusedIds?: Set<string>;
  }) {
    const finalistIds = new Set(input.ranked.rankedAll.slice(0, input.finalists).map((e) => e.candidate.id));
    for (const [i, e] of input.ranked.rankedAll.entries()) {
      await q(
        `INSERT INTO scoring_run_pool_aspects (run_id, candidate_id, pool_rank, closeness, is_finalist, aspects, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          input.runId, e.candidate.id, i + 1, e.closeness.toFixed(6), finalistIds.has(e.candidate.id),
          JSON.stringify(input.aspects.get(e.candidate.id)),
          JSON.stringify({ technicalMatching: null, careerMatching: null, educationEval: null, rawInputs: { performanceGrade: 'B', havQuadrant: '2', behaviorRecommendation: 'DISARANKAN', behaviorNotes: null } }),
        ],
      );
    }
    const rows = input.ranked.rankedAll
      .map((e, i) => ({ e, rank: i + 1 }))
      .filter(({ e, rank }) => rank <= input.finalists || input.alwaysInclude?.has(e.candidate.id));
    for (const { e, rank } of rows) {
      const cand = CANDS.find((c) => id(c.n) === e.candidate.id)!;
      const s = input.aspects.get(e.candidate.id)!;
      const weightedScore = Math.round(e.closeness * 100);
      const details = {
        id: e.candidate.id,
        name: cand.name,
        currentPosition: cand.position,
        yearsOfService: 8,
        havQuadrant: '2',
        weightedScore,
        readiness: readinessOf(weightedScore),
        scoreBreakdown: { ...s },
        constraint: `AHP+TOPSIS: koefisien kedekatan ${e.closeness.toFixed(4)}.`,
        strengths: ['(fixture) narasi templat'],
        weaknesses: ['(fixture) narasi templat'],
        recommendation: ['(fixture) narasi templat'],
        ahpTopsis: {
          weights: input.weights,
          effectiveWeights: input.ranked.effectiveWeights,
          droppedCriteria: [],
          weightSource: input.weightSource,
          consistencyRatio: Number(input.cr.toFixed(4)),
          closeness: Number(e.closeness.toFixed(6)),
          dPlus: Number(e.dPlus.toFixed(6)),
          dMinus: Number(e.dMinus.toFixed(6)),
          reusedAspectsFromRunId: input.reusedIds?.has(e.candidate.id) ? input.reusedFrom ?? null : null,
          reusedAspectCount: input.reusedIds?.has(e.candidate.id) ? 6 : 0,
          rerunSource: input.rerunSource?.(e.candidate.id) ?? null,
          rerunAnchorsSource: input.rerunSource ? 'parent' : null,
          manuallyAdded: input.alwaysInclude?.has(e.candidate.id) ?? false,
          belowFinalistCut: !finalistIds.has(e.candidate.id),
          poolRank: rank,
          finalistCut: input.finalists,
          poolSize: input.ranked.rankedAll.length,
        },
      };
      await q(
        `INSERT INTO analysis_results (run_id, position_id, candidate_id, method, final_score, rank, details, calculated_by)
         VALUES ($1, $2, $3, 'AHP_TOPSIS', $4, $5, $6, $7)`,
        [input.runId, POSITION, e.candidate.id, e.closeness.toFixed(6), rank, JSON.stringify(details), userId],
      );
    }
  }

  const filterSummary = (poolIds: string[], extra: Record<string, unknown> = {}) => ({
    templateId: TEMPLATE,
    totalEvaluated: poolIds.length,
    qualifiedCount: poolIds.length,
    disqualifiedCount: 0,
    disqualified: [],
    minGradeId: '6',
    maxGradeId: '7',
    includedTenantIds: [TENANT],
    forceIncluded: [],
    flagged: [],
    ...extra,
  });

  // ── R1: root, default weights ───────────────────────────────────────────
  const r1Ahp = ahpFrom(DEFAULT_VECTOR);
  const r1Aspects = new Map(CANDS.filter((c) => c.n <= 12).map((c) => [id(c.n), c.aspects]));
  const r1Ranked = rank(r1Aspects, r1Ahp.weights);
  const r1Ref = '2026-09-01T03:00:00.000Z';
  const r1Info = runInfoFor({ runId: RUN.R1, ranked: r1Ranked, ahp: r1Ahp, weightSource: 'default', finalists: 6, referenceDate: r1Ref, frozen: null });
  await writeRun({
    runId: RUN.R1, label: 'Critical Position — FIXTURE IT APP DEV DEPT HEAD — 2026-09-01', createdAt: '2026-09-01 10:00:00',
    completedAt: '2026-09-01 10:02:00', candidateCount: 6, configSnapshot: snapshot('2026-09-01T03:00:00.000Z', null),
    runInfo: r1Info, filterSummary: filterSummary([...r1Aspects.keys()]),
  });
  await writeSession(RUN.R1, 'completed', [...r1Aspects.keys()].sort(), { runInfo: r1Info }, '2026-09-01 10:00:00');
  await writeResults({ runId: RUN.R1, ranked: r1Ranked, aspects: r1Aspects, finalists: 6, weights: r1Ahp.weights, weightSource: 'default', cr: r1Ahp.cr });

  // Forum decision on R1: the candidate ranked 2nd was chosen, with a reason.
  const r1Second = r1Ranked.rankedAll[1]!.candidate.id;
  await q(
    `INSERT INTO position_picks (position_id, candidate_id, program_code, notes, score, readiness, run_id, rank, created_by)
     VALUES ($1, $2, 'fx-successor', $3, $4, $5, $6, 0, $7)`,
    [POSITION, r1Second, 'Forum TC 2026-09-10: dipilih karena pengalaman memimpin proyek ERP lintas divisi; peringkat 1 baru dipromosikan.',
      Math.round(r1Ranked.rankedAll[1]!.closeness * 100), readinessOf(Math.round(r1Ranked.rankedAll[1]!.closeness * 100)), RUN.R1, userId],
  );

  // ── C1: "Tambah Kandidat Pembanding" child of R1 ───────────────────────
  const frozen = resolveFrozenBasis({
    parent: { id: RUN.R1, completedAt: '2026-09-01T03:02:00.000Z', createdAt: '2026-09-01T03:00:00.000Z', runInfo: r1Info },
    rootRunId: RUN.R1,
  });
  const newId = id(13);
  const existingId = id(8); // in R1's pool, below its cut
  const c1Aspects = new Map(r1Aspects);
  c1Aspects.set(newId, byN.get(13)!.aspects);
  const c1Ranked = rank(c1Aspects, frozen.ahp.weights as Aspects);
  const reason = 'Forum Talent Committee 2026-09-15: Kepala Divisi meminta Sari Wulandari (Digital) dan Hendra Wijaya dibandingkan dengan finalis.';
  const rerunSnapshot: RunRerunSnapshot = {
    mode: 'incremental_add',
    parentRunId: RUN.R1,
    rootRunId: RUN.R1,
    reason,
    dataPulledAt: '2026-09-15T02:00:00.000Z',
    anchorsSource: frozen.anchors.source,
    added: [
      { candidateId: newId, name: byN.get(13)!.name, classification: 'new', failedRules: [] },
      { candidateId: existingId, name: byN.get(8)!.name, classification: 'existing_pool', failedRules: [] },
    ],
    skipped: [
      { candidateId: id(15), name: byN.get(15)!.name, reason: 'parent_finalist', message: '(fixture) contoh kandidat yang ditolak' },
    ],
    frozen,
  };
  const c1Snapshot = deriveChildSnapshot(snapshot('2026-09-01T03:00:00.000Z', null), RUN.R1, () => snapshot('2026-09-15T02:00:00.000Z', null), rerunSnapshot, new Date('2026-09-15T02:00:00.000Z'));
  const c1Finalists = 6;
  const c1Info = runInfoFor({
    runId: RUN.C1, ranked: c1Ranked, ahp: r1Ahp, weightSource: 'inherited', finalists: c1Finalists, referenceDate: frozen.referenceDate, frozen,
    extra: {
      rerun: {
        mode: 'incremental_add', parentRunId: RUN.R1, rootRunId: RUN.R1, newCandidates: 1, existingPoolCandidates: 1,
        ahpSource: 'parent', anchorsSource: 'parent', referenceDate: frozen.referenceDate, criteriaLiveDisagrees: [],
        carriedDeleted: 0, positionBasis: null,
      },
    },
  });
  await writeRun({
    runId: RUN.C1, label: '+2 kandidat — Critical Position — FIXTURE IT APP DEV DEPT HEAD — 2026-09-15 09:00',
    createdAt: '2026-09-15 09:00:00', completedAt: '2026-09-15 09:01:00', parentRunId: RUN.R1, rerunMode: 'incremental_add',
    rerunReason: reason, candidateCount: 8, configSnapshot: c1Snapshot, runInfo: c1Info,
    filterSummary: filterSummary([...c1Aspects.keys()], { forceIncluded: [{ candidateId: newId, name: byN.get(13)!.name, source: 'added', reasons: [], outsideEvaluatedPool: false }] }),
  });
  await writeSession(RUN.C1, 'completed', [...c1Aspects.keys()].sort(), { runInfo: c1Info, ahpRerun: { mode: 'incremental_add', baseRunId: RUN.R1, newCandidateIds: [newId], existingPoolCandidateIds: [existingId], frozen } }, '2026-09-15 09:00:00');
  await writeResults({
    runId: RUN.C1, ranked: c1Ranked, aspects: c1Aspects, finalists: c1Finalists, alwaysInclude: new Set([newId, existingId]),
    weights: frozen.ahp.weights as Aspects, weightSource: 'inherited', cr: r1Ahp.cr,
    rerunSource: (cid) => (cid === newId ? 'new' : cid === existingId ? 'existing_pool' : 'carried'),
    reusedFrom: RUN.R1, reusedIds: new Set(r1Aspects.keys()),
  });
  // An exclusion MARK on C1 — numbers untouched.
  await q(
    `INSERT INTO scoring_run_exclusions (tenant_id, run_id, candidate_id, reason, note, excluded_by)
     VALUES ($1, $2, $3, 'promoted', 'Dipromosikan ke posisi lain per 2026-09-20', $4)`,
    [TENANT, RUN.C1, r1Ranked.rankedAll[0]!.candidate.id, userId],
  );

  // ── F1: a child of R1 whose scoring failed ─────────────────────────────
  await writeRun({
    runId: RUN.F1, label: '+1 kandidat — Critical Position — FIXTURE IT APP DEV DEPT HEAD — 2026-09-16 08:00',
    status: 'in_progress', createdAt: '2026-09-16 08:00:00', completedAt: null, parentRunId: RUN.R1, rerunMode: 'incremental_add',
    rerunReason: 'Forum 2026-09-16: tambah Teguh Prakoso', candidateCount: 13, configSnapshot: c1Snapshot,
    // What scoring-service now records when a run fails (FR-RR-12).
    runInfo: {
      failure: {
        kind: 'error',
        message: 'Run induk tidak menyimpan skor aspek untuk 1 kandidat pool-nya, sehingga run pembanding tidak bisa dibekukan. Buat run baru dari wizard scoring.',
        at: '2026-09-16T01:00:30.000Z',
      },
    },
    filterSummary: filterSummary([...r1Aspects.keys(), id(14)]),
  });
  await writeSession(RUN.F1, 'failed', [...r1Aspects.keys(), id(14)].sort(), { ahpRerun: { mode: 'incremental_add', baseRunId: RUN.R1, newCandidateIds: [id(14)], existingPoolCandidateIds: [], frozen } }, '2026-09-16 08:00:00');

  // ── R2: a second root — different matrix, changed pool, changed data ───
  const r2Ahp = ahpFrom(TECHNICAL_VECTOR);
  const r2Aspects = new Map(CANDS.filter((c) => (c.n <= 11 || c.n === 13 || c.n === 14)).map((c) => [id(c.n), { ...c.aspects }]));
  r2Aspects.get(id(3))!.behavior = 55; // Citra's BA re-assessed between the roots
  const r2Ranked = rank(r2Aspects, r2Ahp.weights);
  const r2Ref = '2026-10-01T03:00:00.000Z';
  const r2Info = runInfoFor({ runId: RUN.R2, ranked: r2Ranked, ahp: r2Ahp, weightSource: 'ahp-matrix', finalists: 6, referenceDate: r2Ref, frozen: null });
  await writeRun({
    runId: RUN.R2, label: 'Critical Position — FIXTURE IT APP DEV DEPT HEAD — 2026-10-01', createdAt: '2026-10-01 10:00:00',
    completedAt: '2026-10-01 10:03:00', candidateCount: 6, configSnapshot: snapshot('2026-10-01T03:00:00.000Z', { pairwise: r2Ahp.pairwise }),
    runInfo: r2Info, filterSummary: filterSummary([...r2Aspects.keys()]),
  });
  await writeSession(RUN.R2, 'completed', [...r2Aspects.keys()].sort(), { runInfo: r2Info }, '2026-10-01 10:00:00');
  await writeResults({ runId: RUN.R2, ranked: r2Ranked, aspects: r2Aspects, finalists: 6, weights: r2Ahp.weights, weightSource: 'ahp-matrix', cr: r2Ahp.cr });

  // ── L1: legacy refresh_add child of R1 (must stay readable) ────────────
  const l1Aspects = new Map(r1Aspects);
  l1Aspects.set(id(14), byN.get(14)!.aspects);
  l1Aspects.set(id(5), { ...byN.get(5)!.aspects, performance: 100 }); // re-read live under the old mode
  const l1Ranked = rank(l1Aspects, r1Ahp.weights);
  const l1Info = { ...runInfoFor({ runId: RUN.L1, ranked: l1Ranked, ahp: r1Ahp, weightSource: 'default', finalists: 7, referenceDate: '2026-08-20T03:00:00.000Z', frozen: null }), frozen: undefined };
  await writeRun({
    runId: RUN.L1, label: '+1 kandidat (data terbaru) — Critical Position — FIXTURE IT APP DEV DEPT HEAD — 2026-09-05 14:00',
    createdAt: '2026-09-05 14:00:00', completedAt: '2026-09-05 14:02:00', parentRunId: RUN.R1, rerunMode: 'refresh_add',
    candidateCount: 7, configSnapshot: snapshot('2026-09-05T07:00:00.000Z', null), runInfo: l1Info,
    filterSummary: filterSummary([...l1Aspects.keys()]),
  });
  await writeResults({ runId: RUN.L1, ranked: l1Ranked, aspects: l1Aspects, finalists: 7, alwaysInclude: new Set([id(14)]), weights: r1Ahp.weights, weightSource: 'default', cr: r1Ahp.cr });

  // ── O1: legacy exclude child whose parent was deleted ──────────────────
  await writeRun({
    runId: RUN.P0, label: 'Critical Position — FIXTURE (induk yang kemudian dihapus) — 2026-07-01', createdAt: '2026-07-01 10:00:00',
    completedAt: '2026-07-01 10:02:00', candidateCount: 6, configSnapshot: null, runInfo: null, filterSummary: filterSummary([...r1Aspects.keys()]),
  });
  const o1Aspects = new Map([...r1Aspects].filter(([cid]) => cid !== id(2)));
  const o1Ranked = rank(o1Aspects, r1Ahp.weights);
  await writeRun({
    runId: RUN.O1, label: '−1 kandidat — Critical Position — FIXTURE — 2026-07-02 09:00', createdAt: '2026-07-02 09:00:00',
    completedAt: '2026-07-02 09:01:00', parentRunId: RUN.P0, rerunMode: 'exclude', candidateCount: 6, configSnapshot: null,
    runInfo: { ...runInfoFor({ runId: RUN.O1, ranked: o1Ranked, ahp: r1Ahp, weightSource: 'default', finalists: 6, referenceDate: '2026-07-02T02:00:00.000Z', frozen: null }), frozen: undefined },
    filterSummary: filterSummary([...o1Aspects.keys()]),
  });
  await writeResults({ runId: RUN.O1, ranked: o1Ranked, aspects: o1Aspects, finalists: 6, weights: r1Ahp.weights, weightSource: 'default', cr: r1Ahp.cr });

  // Completed LAST (I-1), then delete O1's parent: FK ON DELETE SET NULL
  // orphans O1, which the guard explicitly allows.
  await q(`UPDATE scoring_runs SET status = 'completed' WHERE id = ANY($1::uuid[])`, [toComplete]);
  await q(`DELETE FROM scoring_runs WHERE id = $1`, [RUN.P0]);

  console.log('Seeded fixture position', POSITION);
  for (const [k, v] of Object.entries(RUN)) console.log(`  ${k}  ${v}`);
  console.log('Open: /positions/' + POSITION);
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
