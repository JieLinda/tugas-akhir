// Seed a WIDE run lineage on one fixture position, so the "Perbandingan Run"
// tab's navigator can be seen with the shape it was built for: one root with
// many "Tambah Kandidat Pembanding" children, a grandchild chain, a failed
// child, a second root with a different AHP matrix, and two forum decisions.
//
//   R1   root, 10 candidates, default weights                      2026-10-01
//   ├─ C1 … C12  twelve children, each adding 1–4 comparison candidates
//   │   (C7 adds an out-of-range candidate on confirmation, C11 only one
//   │   already in R1's pool below the cut)
//   │   └─ C1 has two children G1, G2; G1 has one child GG1
//   └─ CF  a child whose scoring failed (recorded as the engine records it)
//   R2   a newer root, 12 candidates, technical-heavy matrix, one candidate's
//        behaviour re-assessed — with two children
//
// Same method as scripts/seed-rerun-fixtures.ts: the aspect scores are
// SYNTHETIC (no model is reachable locally, and the real engine would give
// every fixture candidate identical aspects), but every ranking is computed by
// the engine's own `rankCandidatesByTopsis`, every child's frozen basis by the
// web app's `resolveFrozenBasis`, every child lists its rows by the FR-RR-09
// rule, and runs are marked `completed` LAST (drizzle/0087, I-1).
//
// Requires scripts/seed-rerun-fixtures.ts first (candidates, program, user).
// Idempotent: deletes everything hanging off its own position, then rebuilds.
//
//   DATABASE_URL=… TZ=Asia/Jakarta npx tsx scripts/seed-wide-lineage.ts

import 'dotenv/config';
// @ts-ignore — the root has no @types/pg (same as scripts/verify-datetime.ts)
import { Pool } from 'pg';
import { rankCandidatesByTopsis } from '../scoring-service/src/ahp-topsis-engine';
import { computeAhpWeights, pairwiseFromWeights } from '../scoring-service/src/ahp';
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from '../scoring-service/src/ahp-weights';
import { buildFrozenRecord } from '../scoring-service/src/rerun-freeze';
import { childFinalistTarget, deriveChildSnapshot, resolveFrozenBasis } from '../lib/rerun-freeze';
import type { RunConfigSnapshot, RunRerunSnapshot } from '../lib/db/schema';
import readinessConfig from '../lib/readiness-config.json';

const TENANT = '10000000-0000-0000-0000-000000000001';
const POSITION = 'fe000000-0000-4000-8000-00000000a004';
const TEMPLATE = 'fe000000-0000-4000-8000-00000000b001';
const TITLE = 'FIXTURE WIDE LINEAGE IT DEVELOPMENT HEAD';
const cand = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Aspects = Record<AhpCriterionKey, number>;
const a = (t: number, c: number, b: number, p: number, h: number, e: number): Aspects => ({
  technical: t, career: c, behavior: b, performance: p, hav: h, education: e,
});
// The fixture candidates of scripts/seed-rerun-fixtures.ts, same aspects.
const PEOPLE: Record<number, { name: string; position: string; aspects: Aspects }> = {
  1: { name: 'Andi Pratama', position: 'IT APPLICATION SECTION HEAD', aspects: a(78, 70, 83, 67, 80, 70) },
  2: { name: 'Budi Santoso', position: 'IT DEVELOPMENT SECTION HEAD', aspects: a(80, 82, 83, 67, 80, 60) },
  3: { name: 'Citra Lestari', position: 'IT QA SECTION HEAD', aspects: a(66, 64, 70, 100, 80, 70) },
  4: { name: 'Dewi Anggraini', position: 'IT BUSINESS ANALYST', aspects: a(72, 58, 83, 67, 60, 85) },
  5: { name: 'Eko Nugroho', position: 'IT INFRA SECTION HEAD', aspects: a(61, 40, 83, 67, 80, 70) },
  6: { name: 'Fajar Hidayat', position: 'SENIOR PROGRAMMER', aspects: a(70, 75, 50, 67, 60, 70) },
  7: { name: 'Gita Permata', position: 'IT PMO SECTION HEAD', aspects: a(55, 62, 83, 33, 80, 70) },
  8: { name: 'Hendra Wijaya', position: 'IT SUPPORT SUPERVISOR', aspects: a(48, 35, 70, 67, 60, 50) },
  9: { name: 'Indah Purnama', position: 'DATA ANALYST', aspects: a(64, 50, 50, 67, 40, 85) },
  10: { name: 'Joko Susilo', position: 'NETWORK SECTION HEAD', aspects: a(45, 30, 83, 33, 60, 50) },
  11: { name: 'Kartika Sari', position: 'SYSTEM ANALYST', aspects: a(68, 66, 33, 67, 40, 70) },
  12: { name: 'Lukman Hakim', position: 'DBA SUPERVISOR', aspects: a(52, 44, 50, 33, 40, 50) },
  13: { name: 'Sari Wulandari', position: 'DIGITAL PRODUCT SECTION HEAD', aspects: a(88, 72, 70, 67, 80, 70) },
  14: { name: 'Teguh Prakoso', position: 'ERP SECTION HEAD', aspects: a(74, 68, 70, 67, 60, 70) },
  16: { name: 'Vina Oktaviani', position: 'PROGRAMMER', aspects: a(62, 40, 70, 67, 60, 70) },
  17: { name: 'Wawan Setiawan', position: 'IT SECURITY SECTION HEAD', aspects: a(69, 63, 70, 67, 80, 70) },
};
const nOf = (id: string) => Number(id.slice(-12));

const DEFAULT_VECTOR = AHP_CRITERIA_ORDER.map((k) => ({ technical: 25, career: 5, behavior: 35, performance: 10, hav: 20, education: 5 })[k]);
const TECHNICAL_VECTOR = AHP_CRITERIA_ORDER.map((k) => ({ technical: 40, career: 10, behavior: 25, performance: 10, hav: 10, education: 5 })[k]);

function ahpFrom(vector: number[]) {
  const pairwise = pairwiseFromWeights(vector);
  const r = computeAhpWeights(pairwise);
  const weights = Object.fromEntries(AHP_CRITERIA_ORDER.map((k, i) => [k, r.weights[i]!])) as Aspects;
  return { pairwise, weights, cr: r.cr, lambdaMax: r.lambdaMax, ci: r.ci };
}
type Ahp = ReturnType<typeof ahpFrom>;

function readinessOf(score: number): string {
  for (const t of readinessConfig.thresholds) if (score >= t.minScore) return t.level;
  return readinessConfig.defaultLevel;
}

type Ranked = ReturnType<typeof rankCandidatesByTopsis<{ id: string }>>;
const rank = (pool: Map<string, Aspects>, weights: Aspects): Ranked =>
  rankCandidatesByTopsis([...pool.keys()].sort().map((id) => ({ id })), pool, weights, new Set());

// WIB wall clock → the naive timestamp the database stores, and its instant.
const at = (d: number, h = 9, m = 0) => {
  const wall = `2026-10-${String(d).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const iso = new Date(Date.UTC(2026, 9, d, h - 7, m)).toISOString();
  return { wall, iso, stamp: wall.slice(0, 16) };
};

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL or POSTGRES_URL is not set');
  const pool = new Pool({ connectionString: url });
  const q = async <T = any>(text: string, params: unknown[] = []) => (await pool.query(text, params)).rows as T[];

  const [{ id: userId } = { id: '' }] = await q<{ id: string }>(`SELECT id FROM users WHERE email = 'system@pulse.local'`);
  const base = (await q<{ config_snapshot: RunConfigSnapshot }>(
    `SELECT config_snapshot FROM scoring_runs WHERE id = 'fe000000-0000-4000-8000-00000000c001'`,
  ))[0]?.config_snapshot;
  if (!userId || !base) throw new Error('Run scripts/seed-rerun-fixtures.ts first.');

  await q(`DELETE FROM position_picks WHERE position_id = $1`, [POSITION]);
  await q(`DELETE FROM tournament_sessions WHERE position_id = $1`, [POSITION]);
  await q(`DELETE FROM scoring_runs WHERE position_id = $1`, [POSITION]);
  await q(`DELETE FROM critical_positions WHERE id = $1`, [POSITION]);
  await q(
    `INSERT INTO critical_positions (id, tenant_id, title, department, division, status, program_template_id,
       program_code, holder_name, holder_employee_id, min_grade_id, max_grade_id, created_by)
     VALUES ($1, $2, $3, 'IT Application', 'IT', 'active', $4, 'fx-successor', 'Yusuf Maulana', 'FX090', '6', '7', $5)`,
    [POSITION, TENANT, TITLE, TEMPLATE, userId],
  );

  const snapshotAt = (iso: string, pairwise: number[][] | null): RunConfigSnapshot => ({
    ...base,
    capturedAt: iso,
    templateSource: 'live',
    template: base.template ? { ...base.template, ahpConfig: (pairwise ? { pairwise } : null) as any } : base.template,
  });

  const toComplete: string[] = [];
  type Run = { runId: string; aspects: Map<string, Aspects>; ranked: Ranked; finalists: number; info: any; snapshot: RunConfigSnapshot; ahp: Ahp; createdIso: string; completedIso: string };

  function runInfoFor(runId: string, ranked: Ranked, ahp: Ahp, finalists: number, referenceDate: string, frozen: any, extra: Record<string, unknown> = {}) {
    const technical = { simFloor: 0.5123456789, simCeil: 0.8876543211, source: 'measured' };
    const career = { simFloor: 0.6331234567, simCeil: 0.8921234567, source: 'measured' };
    const depth = { targetYears: 9.25, targetRows: 2 };
    const record = buildFrozenRecord({
      frozen,
      runId,
      referenceDate: new Date(referenceDate),
      weights: frozen?.ahp.weights ?? ahp.weights,
      pairwise: frozen?.ahp.pairwise ?? ahp.pairwise,
      weightSource: frozen ? 'inherited' : 'default',
      weightsInherited: Boolean(frozen?.ahp.weights),
      activeCriteria: ranked.activeCriteria,
      liveDroppedCriteria: [],
      criteriaSource: frozen ? 'parent' : 'live',
      technical: frozen?.anchors.technical ?? technical,
      career: frozen?.anchors.career ?? career,
      anchorsInherited: Boolean(frozen?.anchors.technical && frozen?.anchors.career),
      depth: frozen?.anchors.depth ?? depth,
    });
    return {
      jobProfileMatched: 'IT Application Development Department Head',
      scoredCandidates: ranked.rankedAll.length,
      finalists,
      appendedBelowCut: 0,
      rerun: null,
      frozen: record,
      narrative: { llmEnabled: false, model: null, llmWritten: 0, templateFallback: finalists },
      technical: { requiredCount: 9, hasRequired: true, requiredSource: 'job_profile', simFloor: 0.5123, simCeil: 0.8877, simAnchorSource: 'measured' },
      career: { scale: { simFloor: 0.6331, simCeil: 0.8921, source: 'measured' }, depth: { ...depth, source: 'measured' } },
      ahp: {
        weightSource: frozen ? 'inherited' : 'ahp-matrix',
        consistencyRatio: Number(ahp.cr.toFixed(4)),
        lambdaMax: Number(ahp.lambdaMax.toFixed(4)),
        consistencyIndex: Number(ahp.ci.toFixed(4)),
        inconsistent: ahp.cr > 0.1,
        weights: record.ahp.weights,
        criteriaOrder: [...AHP_CRITERIA_ORDER],
        pairwise: record.ahp.pairwise.map((r: number[]) => r.map((v) => Number(v.toFixed(4)))),
        droppedCriteria: [],
        activeCriteria: [...ranked.activeCriteria],
        effectiveWeights: ranked.effectiveWeights,
      },
      readiness: { source: 'snapshot' },
      ...extra,
    };
  }

  async function writeRun(input: {
    label: string;
    created: ReturnType<typeof at>;
    completed: ReturnType<typeof at> | null;
    parentRunId?: string | null;
    reason?: string | null;
    candidateCount: number;
    snapshot: RunConfigSnapshot;
    runInfo: unknown;
    filterSummary: unknown;
    complete?: boolean;
  }): Promise<string> {
    const [row] = await q<{ id: string }>(
      `INSERT INTO scoring_runs (position_id, tenant_id, method, label, candidate_count, created_by, created_at,
         program_template_id, program, status, filter_summary, completed_at, config_snapshot, run_info,
         parent_run_id, rerun_mode, rerun_reason)
       VALUES ($1, $2, 'AHP_TOPSIS', $3, $4, $5, $6, $7, 'fx-successor', 'in_progress', $8::jsonb, $9, $10::jsonb,
         $11::jsonb, $12, $13, $14) RETURNING id`,
      [
        POSITION, TENANT, input.label, input.candidateCount, userId, input.created.wall, TEMPLATE,
        JSON.stringify(input.filterSummary), input.completed?.wall ?? null, JSON.stringify(input.snapshot),
        JSON.stringify(input.runInfo), input.parentRunId ?? null, input.parentRunId ? 'incremental_add' : 'baseline',
        input.reason ?? null,
      ],
    );
    if (input.complete !== false) toComplete.push(row!.id);
    return row!.id;
  }

  async function writeRows(runId: string, run: Pick<Run, 'ranked' | 'aspects' | 'finalists' | 'ahp'>, listed: Set<string>, opts: {
    weights: Aspects;
    rerunSource?: (cid: string) => string | null;
    reusedFrom?: string | null;
    reusedIds?: Set<string>;
    added?: Set<string>;
  }) {
    const finalistIds = new Set(run.ranked.rankedAll.slice(0, run.finalists).map((e) => e.candidate.id));
    for (const [i, e] of run.ranked.rankedAll.entries()) {
      await q(
        `INSERT INTO scoring_run_pool_aspects (run_id, candidate_id, pool_rank, closeness, is_finalist, aspects, details)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
        [
          runId, e.candidate.id, i + 1, e.closeness.toFixed(6), finalistIds.has(e.candidate.id),
          JSON.stringify(run.aspects.get(e.candidate.id)),
          JSON.stringify({ rawInputs: { performanceGrade: 'B', havQuadrant: '2', behaviorRecommendation: 'DISARANKAN', behaviorNotes: null } }),
        ],
      );
    }
    for (const [i, e] of run.ranked.rankedAll.entries()) {
      if (!listed.has(e.candidate.id)) continue;
      const person = PEOPLE[nOf(e.candidate.id)]!;
      const weightedScore = Math.round(e.closeness * 100);
      const details = {
        id: e.candidate.id,
        name: person.name,
        currentPosition: person.position,
        yearsOfService: 8,
        havQuadrant: '2',
        weightedScore,
        readiness: readinessOf(weightedScore),
        scoreBreakdown: { ...run.aspects.get(e.candidate.id)! },
        constraint: `AHP+TOPSIS: koefisien kedekatan ${e.closeness.toFixed(4)}.`,
        strengths: ['(fixture) narasi templat'],
        weaknesses: ['(fixture) narasi templat'],
        recommendation: ['(fixture) narasi templat'],
        ahpTopsis: {
          weights: opts.weights,
          effectiveWeights: run.ranked.effectiveWeights,
          droppedCriteria: [],
          weightSource: opts.reusedFrom ? 'inherited' : 'ahp-matrix',
          consistencyRatio: Number(run.ahp.cr.toFixed(4)),
          closeness: Number(e.closeness.toFixed(6)),
          dPlus: Number(e.dPlus.toFixed(6)),
          dMinus: Number(e.dMinus.toFixed(6)),
          reusedAspectsFromRunId: opts.reusedIds?.has(e.candidate.id) ? opts.reusedFrom ?? null : null,
          reusedAspectCount: opts.reusedIds?.has(e.candidate.id) ? 6 : 0,
          rerunSource: opts.rerunSource?.(e.candidate.id) ?? null,
          rerunAnchorsSource: opts.rerunSource ? 'parent' : null,
          manuallyAdded: opts.added?.has(e.candidate.id) ?? false,
          belowFinalistCut: !finalistIds.has(e.candidate.id),
          poolRank: i + 1,
          finalistCut: run.finalists,
          poolSize: run.ranked.rankedAll.length,
          narrativeSource: 'template',
        },
      };
      await q(
        `INSERT INTO analysis_results (run_id, position_id, candidate_id, method, final_score, rank, details, calculated_by)
         VALUES ($1, $2, $3, 'AHP_TOPSIS', $4, $5, $6, $7)`,
        [runId, POSITION, e.candidate.id, e.closeness.toFixed(6), i + 1, JSON.stringify(details), userId],
      );
    }
  }

  const filterSummary = (ids: string[], extra: Record<string, unknown> = {}) => ({
    templateId: TEMPLATE,
    totalEvaluated: ids.length,
    qualifiedCount: ids.length,
    disqualifiedCount: 0,
    disqualified: [],
    minGradeId: '6',
    maxGradeId: '7',
    includedTenantIds: [TENANT],
    forceIncluded: [],
    flagged: [],
    ...extra,
  });

  async function root(ns: number[], created: ReturnType<typeof at>, vector: number[], tweak?: (m: Map<string, Aspects>) => void): Promise<Run> {
    const ahp = ahpFrom(vector);
    const aspects = new Map(ns.map((n) => [cand(n), { ...PEOPLE[n]!.aspects }]));
    tweak?.(aspects);
    const ranked = rank(aspects, ahp.weights);
    const completed = at(Number(created.wall.slice(8, 10)), Number(created.wall.slice(11, 13)), 2);
    const finalists = 6;
    const snapshot = snapshotAt(created.iso, vector === DEFAULT_VECTOR ? null : ahp.pairwise);
    const pre = { ranked, aspects, finalists, ahp };
    const runId = await writeRun({
      label: `Critical Position — ${TITLE} — ${created.stamp.slice(0, 10)}`,
      created,
      completed,
      candidateCount: finalists,
      snapshot,
      runInfo: {},
      filterSummary: filterSummary([...aspects.keys()]),
    });
    const info = runInfoFor(runId, ranked, ahp, finalists, created.iso, null);
    await q(`UPDATE scoring_runs SET run_info = $2::jsonb WHERE id = $1`, [runId, JSON.stringify(info)]);
    const listed = new Set(ranked.rankedAll.slice(0, finalists).map((e) => e.candidate.id));
    await writeRows(runId, pre, listed, { weights: ahp.weights });
    return { runId, ...pre, info, snapshot, createdIso: created.iso, completedIso: completed.iso };
  }

  async function child(
    parent: Run,
    rootRunId: string,
    added: { n: number; existing?: boolean; outOfRange?: boolean; advisory?: string[] }[],
    reason: string,
    created: ReturnType<typeof at>,
  ): Promise<Run> {
    const frozen = resolveFrozenBasis({
      parent: { id: parent.runId, completedAt: parent.completedIso, createdAt: parent.createdIso, runInfo: parent.info },
      rootRunId,
    });
    const aspects = new Map(parent.aspects);
    const newIds = added.filter((x) => !x.existing).map((x) => cand(x.n));
    for (const id of newIds) aspects.set(id, { ...PEOPLE[nOf(id)]!.aspects });
    const ranked = rank(aspects, frozen.ahp.weights as Aspects);
    // FR-RR-09: N stays the parent's; the list is top N ∪ parent finalists ∪ comparison candidates.
    const finalists = childFinalistTarget(parent.finalists, aspects.size);
    const parentFinalists = new Set(parent.ranked.rankedAll.slice(0, parent.finalists).map((e) => e.candidate.id));
    const addedIds = new Set(added.map((x) => cand(x.n)));
    const listed = new Set([
      ...ranked.rankedAll.slice(0, finalists).map((e) => e.candidate.id),
      ...parentFinalists,
      ...addedIds,
    ]);
    const rerun: RunRerunSnapshot = {
      mode: 'incremental_add',
      parentRunId: parent.runId,
      rootRunId,
      reason,
      dataPulledAt: created.iso,
      anchorsSource: frozen.anchors.source,
      added: added.map((x) => ({
        candidateId: cand(x.n),
        name: PEOPLE[x.n]!.name,
        classification: x.existing ? 'existing_pool' : 'new',
        failedRules: x.outOfRange ? ['Rentang grade posisi (6–7)'] : [],
        outOfRange: Boolean(x.outOfRange),
        advisory: x.advisory ?? [],
      })),
      skipped: [],
      frozen,
    };
    const snapshot = deriveChildSnapshot(parent.snapshot, parent.runId, () => parent.snapshot, rerun, new Date(created.iso));
    const completed = at(Number(created.wall.slice(8, 10)), Number(created.wall.slice(11, 13)), 1);
    const pre = { ranked, aspects, finalists, ahp: parent.ahp };
    const forced = added.filter((x) => x.outOfRange);
    const runId = await writeRun({
      label: `+${added.length} kandidat — Critical Position — ${created.stamp}`,
      created,
      completed,
      parentRunId: parent.runId,
      reason,
      candidateCount: listed.size,
      snapshot,
      runInfo: {},
      filterSummary: filterSummary([...aspects.keys()], {
        forceIncluded: forced.map((x) => ({
          candidateId: cand(x.n),
          name: PEOPLE[x.n]!.name,
          source: 'added',
          reasons: ['Rentang grade posisi (6–7)'],
          outsideEvaluatedPool: true,
        })),
      }),
    });
    const info = runInfoFor(runId, ranked, parent.ahp, finalists, frozen.referenceDate, frozen, {
      rerun: {
        mode: 'incremental_add', parentRunId: parent.runId, rootRunId, newCandidates: newIds.length,
        existingPoolCandidates: added.length - newIds.length, ahpSource: 'parent', anchorsSource: 'parent',
        referenceDate: frozen.referenceDate, criteriaLiveDisagrees: [], carriedDeleted: 0, positionBasis: null,
      },
    });
    await q(`UPDATE scoring_runs SET run_info = $2::jsonb WHERE id = $1`, [runId, JSON.stringify(info)]);
    const existing = new Set(added.filter((x) => x.existing).map((x) => cand(x.n)));
    await writeRows(runId, pre, listed, {
      weights: frozen.ahp.weights as Aspects,
      rerunSource: (cid) => (newIds.includes(cid) ? 'new' : existing.has(cid) ? 'existing_pool' : 'carried'),
      reusedFrom: parent.runId,
      reusedIds: new Set(parent.aspects.keys()),
      added: addedIds,
    });
    return { runId, ...pre, info, snapshot, createdIso: created.iso, completedIso: completed.iso };
  }

  // ── R1 and its twelve children ───────────────────────────────────────────
  const r1 = await root([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], at(1), DEFAULT_VECTOR);
  const asks: { add: Parameters<typeof child>[2]; reason: string }[] = [
    { add: [{ n: 13 }], reason: 'Forum meminta Sari Wulandari dibandingkan.' },
    { add: [{ n: 14 }], reason: 'Direktur menanyakan Teguh Prakoso.' },
    { add: [{ n: 17, advisory: ['MCU fit dengan catatan'] }], reason: 'Wawan Setiawan diusulkan atasan langsung.' },
    { add: [{ n: 11 }], reason: 'Kartika Sari diusulkan HC BP.' },
    { add: [{ n: 12 }], reason: 'Bandingkan Lukman Hakim dari infrastruktur.' },
    { add: [{ n: 13 }, { n: 14 }], reason: 'Dua kandidat lintas divisi sekaligus.' },
    { add: [{ n: 16, outOfRange: true }], reason: 'Vina Oktaviani (grade 4) diminta sebagai talenta muda; di luar rentang, dikonfirmasi.' },
    { add: [{ n: 11 }, { n: 12 }], reason: 'Dua kandidat dari daftar talent pool.' },
    { add: [{ n: 13 }, { n: 17, advisory: ['MCU fit dengan catatan'] }], reason: 'Forum kedua: Sari dan Wawan.' },
    { add: [{ n: 14 }, { n: 11 }, { n: 12 }], reason: 'Tiga kandidat usulan rapat divisi.' },
    { add: [{ n: 8, existing: true }], reason: 'Hendra Wijaya sudah di pool tetapi di bawah batas; forum ingin melihatnya.' },
    { add: [{ n: 13 }, { n: 14 }, { n: 17, advisory: ['MCU fit dengan catatan'] }, { n: 11 }], reason: 'Simulasi gabungan semua usulan.' },
  ];
  const children: Run[] = [];
  for (const [i, ask] of asks.entries()) children.push(await child(r1, r1.runId, ask.add, ask.reason, at(2 + i, 10)));

  // ── A chain under C1: G1, G2, and GG1 under G1 ──────────────────────────
  const g1 = await child(children[0]!, r1.runId, [{ n: 14 }], 'Dari run Sari: tambah Teguh.', at(15, 9, 30));
  const g2 = await child(children[0]!, r1.runId, [{ n: 11 }], 'Dari run Sari: tambah Kartika.', at(15, 11));
  const gg1 = await child(g1, r1.runId, [{ n: 12 }], 'Dari run Sari + Teguh: tambah Lukman.', at(16, 9));

  // ── A failed child, recorded the way the engine records a failure ───────
  await writeRun({
    label: `+1 kandidat — Critical Position — ${at(14, 15).stamp}`,
    created: at(14, 15),
    completed: null,
    parentRunId: r1.runId,
    reason: 'Percobaan saat layanan penilaian terputus.',
    candidateCount: 11,
    snapshot: r1.snapshot,
    runInfo: { failure: { kind: 'error', message: '(fixture) Layanan penilaian terputus sebelum selesai.', at: at(14, 15, 2).iso } },
    filterSummary: filterSummary([...r1.aspects.keys(), cand(14)]),
    complete: false,
  });

  // ── R2: a newer root — technical-heavy matrix, Citra re-assessed ────────
  const r2 = await root([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], at(20), TECHNICAL_VECTOR, (m) => {
    m.get(cand(3))!.behavior = 55;
  });
  const r2c1 = await child(r2, r2.runId, [{ n: 13 }], 'Root baru: Sari dibandingkan lagi.', at(21, 10));
  await child(r2, r2.runId, [{ n: 14 }, { n: 17, advisory: ['MCU fit dengan catatan'] }], 'Root baru: Teguh dan Wawan.', at(22, 10));

  // ── Two forum decisions: one as recommended, one not ────────────────────
  const top = r1.ranked.rankedAll[0]!.candidate.id;
  const second = children[5]!.ranked.rankedAll[1]!.candidate.id;
  await q(
    `INSERT INTO position_picks (position_id, candidate_id, program_code, notes, run_id, rank, created_by, created_at, updated_at)
     VALUES ($1, $2, 'fx-successor', $3, $4, 1, $5, $6, $6), ($1, $7, 'fx-successor', $8, $9, 2, $5, $10, $10)`,
    [
      POSITION, top, 'Kandidat teratas sistem; atasan langsung setuju.', r1.runId, userId, at(5, 14).wall,
      second,
      'Forum memilih kandidat peringkat 2 karena pengalaman memimpin proyek ERP lintas divisi dinilai lebih relevan untuk tahun pertama.',
      children[5]!.runId, at(9, 14).wall,
    ],
  );

  // Completed LAST (I-1).
  await q(`UPDATE scoring_runs SET status = 'completed' WHERE id = ANY($1::uuid[])`, [toComplete]);

  const total = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM scoring_runs WHERE position_id = $1`, [POSITION]))[0]!.n;
  console.log(`Silsilah lebar siap: ${total} run pada posisi ${POSITION}.`);
  console.log(`R1 ${r1.runId} · C1 ${children[0]!.runId} · C6 ${children[5]!.runId} · G1 ${g1.runId} · G2 ${g2.runId} · GG1 ${gg1.runId}`);
  console.log(`R2 ${r2.runId} · R2-C1 ${r2c1.runId}`);
  console.log(`Buka: /positions/${POSITION}?runId=${children[5]!.runId}&tab=perbandingan-run`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
