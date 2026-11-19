// TC-RRF — "Tambah Kandidat Pembanding": a child run is its parent, frozen,
// plus the people somebody asked about. Every test below drives the SAME pure
// helpers the production paths call — `startRerunAction` (lib/rerun-freeze.ts)
// and `runAhpTopsisSession` (scoring-service/src/rerun-freeze.ts plus the
// exported pieces of ahp-topsis-engine.ts) — through a root → child →
// grandchild chain, with JSON round trips standing in for the jsonb columns.
// No database, no model.
//
//   node --import tsx --test tests/scoring/rerun-freeze.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  childFinalistTarget,
  classifyRerunCandidates,
  deriveChildSnapshot,
  nothingLeftToAddMessage,
  resolveFrozenBasis,
  validateRerunRequest,
} from '../../lib/rerun-freeze';
import { LEGACY_RERUN_MODES, rerunSpec } from '../../lib/rerun-modes';
import { buildRunForest } from '../../lib/run-tree';
import type { RunConfigSnapshot, RunRerunSnapshot } from '../../lib/db/schema';

import {
  assembleAspectScores,
  cachedAspectsFromRows,
  inheritedCareerAnchors,
  inheritedTechnicalAnchors,
  poolAspectRecord,
  rankCandidatesByTopsis,
  recencyFactor,
  stintYears,
  type AhpCriterionKey,
  type CachedAspects,
} from '../../scoring-service/src/ahp-topsis-engine';
import {
  buildFrozenRecord,
  frozenDroppedCriteria,
  frozenReferenceDate,
  frozenWeights,
  parseRerunSpec,
  planFrozenRerun,
  type FrozenRunBasis,
} from '../../scoring-service/src/rerun-freeze';
import { computeAhpWeights, pairwiseFromWeights } from '../../scoring-service/src/ahp';
import { AHP_CRITERIA_ORDER, DEFAULT_WEIGHTS } from '../../scoring-service/src/ahp-weights';

type Aspects = Record<AhpCriterionKey, number>;
type PoolRow = { candidateId: string; aspects: any; details: any };

// ── Fixtures ────────────────────────────────────────────────────────────────

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ROOT = uuid(9001);
const CHILD = uuid(9002);
const N1 = uuid(501); // new to the root's pool, CAN be assessed on education
const N2 = uuid(502); // added to the child → grandchild

let seed = 7;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
/** Fractional on purpose: integers would hide rounding mistakes. */
const aspect = () => Math.round(rand() * 100000) / 1000;

function weightsFrom(vector: number[]): Aspects {
  const { weights } = computeAhpWeights(pairwiseFromWeights(vector));
  return Object.fromEntries(AHP_CRITERIA_ORDER.map((k, i) => [k, weights[i]!])) as Aspects;
}
const ROOT_WEIGHTS = weightsFrom(AHP_CRITERIA_ORDER.map((k) => DEFAULT_WEIGHTS[k]));
/** A governance edit made AFTER the root ran. */
const LIVE_WEIGHTS = weightsFrom([10, 30, 20, 20, 10, 10]);

const ROOT_IDS = Array.from({ length: 24 }, (_, i) => uuid(i + 1));
const ROOT_ASPECTS = new Map<string, Aspects>(
  ROOT_IDS.map((id) => [
    id,
    {
      technical: aspect(),
      career: aspect(),
      behavior: aspect(),
      performance: aspect(),
      hav: aspect(),
      // Nobody in the root could be assessed on education → 0 and dropped.
      education: 0,
    },
  ]),
);
const rawOf = (id: string) => ({
  behaviorRecommendation: `B-${id.slice(-3)}`,
  behaviorNotes: null,
  performanceGrade: 'B,B,A',
  havQuadrant: '6',
});
const EDU_DROPPED = [
  { key: 'education' as const, reason: 'Tidak satu pun kandidat dapat dinilai pendidikannya.' },
];

const maps = (byId: Map<string, Aspects>): Record<AhpCriterionKey, Map<string, number>> =>
  Object.fromEntries(
    AHP_CRITERIA_ORDER.map((k) => [k, new Map([...byId].map(([id, a]) => [id, a[k]]))]),
  ) as Record<AhpCriterionKey, Map<string, number>>;

function rank(ids: string[], aspects: Map<string, Aspects>, weights: Aspects, dropped: { key: AhpCriterionKey }[]) {
  return rankCandidatesByTopsis(
    [...ids].sort().map((id) => ({ id })),
    aspects,
    weights,
    new Set(dropped.map((d) => d.key)),
  );
}

/** Persist a ranked pool the way the engine does, through a JSON round trip. */
function persist(
  ids: string[],
  aspects: Map<string, Aspects>,
  reused: Map<string, CachedAspects>,
  liveRaw: (id: string) => Record<string, unknown>,
): PoolRow[] {
  return ids.map((id) => {
    const hit = reused.get(id) ?? null;
    // `displayRaw` in the engine: the parent's strings on a frozen run.
    const raw = hit?.baseRaw ? { ...hit.baseRaw, from: 'base_run' } : { ...liveRaw(id), from: 'live' };
    const rec = poolAspectRecord({
      aspects: aspects.get(id)!,
      technicalMatching: null,
      careerMatching: null,
      educationEval: (hit?.educationEval ?? { score: aspects.get(id)!.education, source: 'none' }) as never,
      raw,
      reusedHit: hit,
    });
    return { candidateId: id, aspects: JSON.parse(rec.aspects), details: JSON.parse(rec.details) };
  });
}

// ── The root run ────────────────────────────────────────────────────────────

const rootRank = rank(ROOT_IDS, ROOT_ASPECTS, ROOT_WEIGHTS, EDU_DROPPED);
const ROOT_FINALISTS = new Set(rootRank.rankedAll.slice(0, 10).map((e) => e.candidate.id));
const rootPool = persist(ROOT_IDS, ROOT_ASPECTS, new Map(), rawOf);
const ROOT_REF = new Date('2026-06-01T03:00:00.000Z');
const rootRecord = buildFrozenRecord({
  frozen: null,
  runId: ROOT,
  referenceDate: ROOT_REF,
  weights: ROOT_WEIGHTS,
  pairwise: pairwiseFromWeights(AHP_CRITERIA_ORDER.map((k) => DEFAULT_WEIGHTS[k])),
  weightSource: 'default',
  weightsInherited: false,
  activeCriteria: rootRank.activeCriteria,
  liveDroppedCriteria: EDU_DROPPED,
  criteriaSource: 'live',
  technical: { simFloor: 0.41234567, simCeil: 0.93456789, source: 'measured' },
  career: { simFloor: 0.63312345, simCeil: 0.89198765, source: 'measured' },
  anchorsInherited: false,
  depth: { targetYears: 8, targetRows: 2 },
});
/** What `scoring_runs.run_info` holds, as read back from jsonb. */
const rootRunInfo = JSON.parse(
  JSON.stringify({
    frozen: rootRecord,
    ahp: { weights: ROOT_WEIGHTS, droppedCriteria: EDU_DROPPED, activeCriteria: rootRank.activeCriteria },
  }),
);

// ── The child: + N1, created after governance and the corpus both moved ─────

const childFrozen: FrozenRunBasis = resolveFrozenBasis({
  parent: { id: ROOT, completedAt: ROOT_REF, createdAt: ROOT_REF, runInfo: rootRunInfo },
  rootRunId: ROOT,
}) as FrozenRunBasis;
const childSpec = parseRerunSpec(
  JSON.parse(
    JSON.stringify({
      ahpRerun: {
        mode: 'incremental_add',
        baseRunId: ROOT,
        newCandidateIds: [N1],
        existingPoolCandidateIds: [],
        frozen: childFrozen,
      },
    }),
  ),
);
assert.ok(childSpec && 'spec' in childSpec);
const CHILD_IDS = [...ROOT_IDS, N1].sort();
const rootCached = cachedAspectsFromRows([], rootPool);
const childPlan = planFrozenRerun({
  candidateIds: CHILD_IDS,
  newCandidateIds: [N1],
  existingPoolCandidateIds: [],
  cached: rootCached,
});
// What the engine computes today: N1 scored, and EVERY carried candidate's data
// drifted since the root (e.g. a new PA grade) — none of which may reach the
// child's ranking.
const childComputed = new Map<string, Aspects>(
  CHILD_IDS.map((id) => [
    id,
    id === N1
      ? { technical: 99.5, career: 12.25, behavior: 70.125, performance: 55.5, hav: 60, education: 90 }
      : { technical: 1, career: 1, behavior: 1, performance: 1, hav: 1, education: 77 },
  ]),
);
const childAspects = assembleAspectScores(CHILD_IDS, maps(childComputed), childPlan.reused);
const childWeights = frozenWeights(childFrozen) ?? LIVE_WEIGHTS;
// Live evaluation of the child: education is now assessable (N1 has data).
const childCriteria = frozenDroppedCriteria(childFrozen, []);
const childRank = rank(CHILD_IDS, childAspects, childWeights, childCriteria.dropped);
const childPool = persist(CHILD_IDS, childAspects, childPlan.reused, rawOf);

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TC-RRF  frozen re-run', () => {
  test('TC-RRF-01 invariance: the child minus its added candidate re-ranks EXACTLY like the parent', () => {
    const withoutAdded = rank(ROOT_IDS, childAspects, childWeights, childCriteria.dropped);
    const rootById = new Map(rootRank.rankedAll.map((e, i) => [e.candidate.id, { rank: i + 1, c: e.closeness }]));
    withoutAdded.rankedAll.forEach((e, i) => {
      const r = rootById.get(e.candidate.id)!;
      assert.equal(i + 1, r.rank, `rank of ${e.candidate.id}`);
      assert.ok(Math.abs(e.closeness - r.c) <= 1e-9, `closeness ${e.closeness} vs ${r.c}`);
      // Stronger than the required tolerance: bit-identical.
      assert.equal(e.closeness, r.c);
    });
    // And the addition really did move the carried candidates — otherwise the
    // invariance above would be vacuous.
    const moved = childRank.rankedAll.filter(
      (e) => e.candidate.id !== N1 && e.closeness !== rootById.get(e.candidate.id)!.c,
    );
    assert.ok(moved.length > 0);
  });

  test('TC-RRF-01b the parent weights vector is used, not the one re-derived from the rounded stored matrix', () => {
    const rounded = pairwiseFromWeights(AHP_CRITERIA_ORDER.map((k) => DEFAULT_WEIGHTS[k])).map((r) =>
      r.map((v) => Number(v.toFixed(4))),
    );
    const rederived = computeAhpWeights(rounded).weights;
    // The trap this guards: the rounded matrix's eigenvector differs from the
    // parent's own weights by more than the invariance tolerance.
    const drift = Math.max(...AHP_CRITERIA_ORDER.map((k, i) => Math.abs(rederived[i]! - ROOT_WEIGHTS[k])));
    assert.ok(drift > 1e-9, `rounded-matrix drift ${drift}`);
    assert.deepEqual(childWeights, ROOT_WEIGHTS);
  });

  test('TC-RRF-02 six aspects and baseRaw of every carried candidate are identical to the parent', () => {
    const childCached = cachedAspectsFromRows([], childPool);
    for (const id of ROOT_IDS) {
      const r = rootCached.get(id)!;
      const c = childCached.get(id)!;
      assert.equal(c.technical, r.technical);
      assert.equal(c.career, r.career);
      assert.equal(c.baseBehavior, r.baseBehavior);
      assert.equal(c.basePerformance, r.basePerformance);
      assert.equal(c.baseHav, r.baseHav);
      assert.equal(c.educationEval.score, r.educationEval.score);
      assert.deepEqual(c.baseRaw, r.baseRaw);
      assert.deepEqual(childAspects.get(id), ROOT_ASPECTS.get(id));
    }
    assert.equal(childPlan.toScore.size, 1);
    assert.ok(childPlan.toScore.has(N1));
  });

  test('TC-RRF-03 AHP matrix, filter rules and live anchors changed in between → child keeps the parent\'s', () => {
    // Weights: the live matrix is ignored.
    assert.deepEqual(frozenWeights(childFrozen), ROOT_WEIGHTS);
    assert.notDeepEqual(LIVE_WEIGHTS, ROOT_WEIGHTS);
    // Active criteria: the parent's.
    assert.deepEqual(childRank.activeCriteria, rootRank.activeCriteria);
    // Anchors: the parent's, at full precision, whatever the corpus says today.
    assert.deepEqual(
      { f: inheritedTechnicalAnchors(childFrozen)!.simFloor, c: inheritedTechnicalAnchors(childFrozen)!.simCeil },
      { f: 0.41234567, c: 0.93456789 },
    );
    assert.deepEqual(
      { f: inheritedCareerAnchors(childFrozen)!.simFloor, c: inheritedCareerAnchors(childFrozen)!.simCeil },
      { f: 0.63312345, c: 0.89198765 },
    );
    assert.deepEqual(childFrozen.anchors.depth, { targetYears: 8, targetRows: 2 });
    assert.equal(childFrozen.anchors.source, 'parent');
    assert.equal(childFrozen.ahp.source, 'parent');
    // Reference date: the root's, not today's.
    assert.equal(frozenReferenceDate(childFrozen)!.toISOString(), ROOT_REF.toISOString());
    // Filter rules: the parent's frozen tree, even though governance now offers another.
    const parentTree = { kind: 'group', op: 'and', children: [{ kind: 'rule', rule: { field: 'disciplineStatus' } }] };
    const liveTree = { kind: 'group', op: 'and', children: [] };
    const parentSnapshot = {
      version: 1,
      capturedAt: '2026-06-01T00:00:00.000Z',
      templateSource: 'live',
      template: { id: 'tpl', code: 'successor', name: 'Critical', filterTree: parentTree, ruleCount: 1 },
      readiness: { thresholds: [{ minScore: 80, level: 'Short' }], defaultLevel: 'Not Ready' },
    } as unknown as RunConfigSnapshot;
    const child = deriveChildSnapshot(
      parentSnapshot,
      ROOT,
      () =>
        ({
          ...parentSnapshot,
          template: { ...parentSnapshot.template!, filterTree: liveTree },
          readiness: { thresholds: [], defaultLevel: 'X' },
        }) as unknown as RunConfigSnapshot,
      { mode: 'incremental_add' } as RunRerunSnapshot,
    );
    assert.deepEqual(child.template!.filterTree, parentTree);
    assert.deepEqual(child.readiness, parentSnapshot.readiness);
    assert.equal(child.templateSource, 'inherited');
    assert.equal(child.inheritedFrom, ROOT);
  });

  test('TC-RRF-04 a criterion the parent dropped stays dropped when an added candidate could be assessed on it', () => {
    assert.equal(childAspects.get(N1)!.education, 90);
    assert.ok(!childRank.activeCriteria.includes('education'));
    assert.equal(childRank.effectiveWeights.education, 0);
    assert.equal(childCriteria.source, 'parent');
    assert.deepEqual(childCriteria.liveDisagrees, [{ key: 'education', parent: 'dropped', live: 'active' }]);
  });

  test('TC-RRF-05 an existing_pool-only request re-scores nobody and reproduces the parent ranking', () => {
    const x = rootRank.rankedAll.find((e) => !ROOT_FINALISTS.has(e.candidate.id))!.candidate.id;
    const plan = planFrozenRerun({
      candidateIds: ROOT_IDS,
      newCandidateIds: [],
      existingPoolCandidateIds: [x],
      cached: rootCached,
    });
    assert.equal(plan.toScore.size, 0);
    assert.ok(plan.reused.has(x));
    assert.ok(plan.alwaysInclude.has(x));
    const aspects = assembleAspectScores(ROOT_IDS, maps(childComputed), plan.reused);
    const r = rank(ROOT_IDS, aspects, frozenWeights(childFrozen)!, frozenDroppedCriteria(childFrozen, []).dropped);
    assert.deepEqual(
      r.rankedAll.map((e) => [e.candidate.id, e.closeness]),
      rootRank.rankedAll.map((e) => [e.candidate.id, e.closeness]),
    );
    // Classified as existing_pool by the web side.
    const { accepted } = classifyRerunCandidates({
      pickedIds: [x],
      parentPool: ROOT_IDS.map((id) => ({ candidateId: id, isFinalist: ROOT_FINALISTS.has(id) })),
      candidates: new Map([[x, { name: 'X', deleted: false, isIncumbent: false }]]),
      verdicts: new Map(),
      confirmedOutOfRange: new Set(),
    });
    assert.deepEqual(accepted.map((a) => a.classification), ['existing_pool']);
  });

  test('TC-RRF-06 the server refuses every invalid request', () => {
    const ok = { tenantMatches: true, status: 'completed', method: 'AHP_TOPSIS', poolSnapshotRows: 24 };
    const req = (over: Partial<Parameters<typeof validateRerunRequest>[0]>) =>
      validateRerunRequest({ mode: 'incremental_add', reason: 'Forum 28 Okt', addedCandidateIds: [N1], parent: ok, ...over });
    assert.equal(req({}), null);
    assert.match(req({ parent: { ...ok, method: 'SAW' } })!, /AHP \+ TOPSIS/);
    assert.match(req({ parent: { ...ok, status: 'in_progress' } })!, /belum selesai atau gagal/);
    assert.match(req({ parent: { ...ok, status: 'failed' } })!, /belum selesai atau gagal/);
    assert.match(req({ parent: { ...ok, poolSnapshotRows: 0 } })!, /snapshot/);
    assert.match(req({ parent: null })!, /tidak ditemukan di Company ini/);
    for (const mode of [...LEGACY_RERUN_MODES, 'baseline', 'nonsense']) {
      assert.match(req({ mode })!, /tidak dapat dibuat lagi/, mode);
    }
    assert.match(req({ addedCandidateIds: [] })!, /minimal satu kandidat/);
    assert.match(req({ reason: '   ' })!, /Alasan/);
    // All picked candidates soft-deleted → nothing left → refused with the names.
    const { accepted, skipped } = classifyRerunCandidates({
      pickedIds: [N1, N2],
      parentPool: [],
      candidates: new Map([
        [N1, { name: 'Ani', deleted: true, isIncumbent: false }],
        [N2, { name: 'Budi', deleted: true, isIncumbent: false }],
      ]),
      verdicts: new Map(),
      confirmedOutOfRange: new Set(),
    });
    assert.equal(accepted.length, 0);
    assert.match(nothingLeftToAddMessage(skipped), /Ani.*Budi/);
    // The engine refuses a session queued under a retired mode or key.
    assert.ok('error' in parseRerunSpec({ ahpRerun: { mode: 'refresh_full', baseRunId: ROOT } })!);
    assert.ok('error' in parseRerunSpec({ ahpExclude: { baseRunId: ROOT, excludedCandidateIds: [] } })!);
    assert.ok('error' in parseRerunSpec({ ahpRerun: { mode: 'incremental_add', baseRunId: ROOT } })!);
    assert.equal(parseRerunSpec({ ahpProgress: { phase: 'load' } }), null);
  });

  test('TC-RRF-07 soft-deleted, finalist, unknown and incumbent picks come back in `skipped`, never vanish', () => {
    const finalist = [...ROOT_FINALISTS][0]!;
    const inPool = ROOT_IDS.find((id) => !ROOT_FINALISTS.has(id))!;
    const { accepted, skipped } = classifyRerunCandidates({
      pickedIds: [N1, N2, finalist, inPool, uuid(777), uuid(778), 'not-a-uuid', N1],
      parentPool: ROOT_IDS.map((id) => ({ candidateId: id, isFinalist: ROOT_FINALISTS.has(id) })),
      candidates: new Map([
        [N1, { name: 'Baru', deleted: false, isIncumbent: false }],
        [N2, { name: 'Terhapus', deleted: true, isIncumbent: false }],
        [finalist, { name: 'Finalis', deleted: false, isIncumbent: false }],
        [inPool, { name: 'Pool', deleted: false, isIncumbent: false }],
        [uuid(778), { name: 'Pejabat', deleted: false, isIncumbent: true }],
      ]),
      verdicts: new Map(),
      confirmedOutOfRange: new Set(),
    });
    assert.deepEqual(
      accepted.map((a) => [a.candidateId, a.classification]),
      [
        [N1, 'new'],
        [inPool, 'existing_pool'],
      ],
    );
    assert.deepEqual(
      skipped.map((s) => [s.candidateId, s.reason]),
      [
        [N2, 'soft_deleted'],
        [finalist, 'parent_finalist'],
        [uuid(777), 'not_found'],
        [uuid(778), 'incumbent'],
        ['not-a-uuid', 'not_found'],
      ],
    );
    assert.ok(skipped.every((s) => s.message.length > 0));
    // FR-RR-09: the child's "N besar" is the parent's own N, never grown by the
    // number of comparison candidates; capped by the pool.
    assert.equal(childFinalistTarget(10, 25), 10);
    assert.equal(childFinalistTarget(10, 7), 7);
  });

  test('TC-RRF-08 root → child → grandchild: root candidates keep the root\'s aspects and basis', () => {
    // The child records what it ranked with — the inherited values.
    const childRecord = buildFrozenRecord({
      frozen: childFrozen,
      runId: CHILD,
      referenceDate: frozenReferenceDate(childFrozen)!,
      weights: childWeights,
      pairwise: rootRecord.ahp.pairwise,
      weightSource: 'inherited',
      weightsInherited: true,
      activeCriteria: childRank.activeCriteria,
      liveDroppedCriteria: [],
      criteriaSource: childCriteria.source,
      technical: inheritedTechnicalAnchors(childFrozen)!,
      career: inheritedCareerAnchors(childFrozen)!,
      anchorsInherited: true,
      depth: childFrozen.anchors.depth,
    });
    const childRunInfo = JSON.parse(
      JSON.stringify({ frozen: childRecord, ahp: { weights: childWeights, droppedCriteria: childCriteria.dropped } }),
    );
    const grandFrozen = resolveFrozenBasis({
      parent: { id: CHILD, completedAt: new Date('2026-10-28T03:00:00Z'), createdAt: new Date(), runInfo: childRunInfo },
      rootRunId: ROOT,
    }) as FrozenRunBasis;
    assert.equal(grandFrozen.rootRunId, ROOT);
    assert.equal(grandFrozen.parentRunId, CHILD);
    assert.deepEqual(grandFrozen.ahp.weights, ROOT_WEIGHTS);
    assert.deepEqual(grandFrozen.ahp.droppedCriteria, EDU_DROPPED); // reasons not decorated twice
    assert.deepEqual(grandFrozen.anchors.technical, rootRecord.anchors.technical);
    assert.deepEqual(grandFrozen.anchors.career, rootRecord.anchors.career);
    assert.equal(grandFrozen.referenceDate, ROOT_REF.toISOString());
    assert.equal(grandFrozen.referenceDateSource, 'parent_frozen');

    const childCached = cachedAspectsFromRows([], childPool);
    const grandIds = [...CHILD_IDS, N2].sort();
    const plan = planFrozenRerun({
      candidateIds: grandIds,
      newCandidateIds: [N2],
      existingPoolCandidateIds: [],
      cached: childCached,
    });
    const grandComputed = new Map<string, Aspects>(
      grandIds.map((id) => [id, { technical: 5, career: 5, behavior: 5, performance: 5, hav: 5, education: 5 }]),
    );
    const grandAspects = assembleAspectScores(grandIds, maps(grandComputed), plan.reused);
    const grandPool = cachedAspectsFromRows([], persist(grandIds, grandAspects, plan.reused, rawOf));
    for (const id of ROOT_IDS) {
      assert.deepEqual(grandAspects.get(id), ROOT_ASPECTS.get(id), id);
      assert.deepEqual(grandPool.get(id)!.baseRaw, rootCached.get(id)!.baseRaw, id);
    }
    // The child's added candidate is carried into the grandchild unchanged too.
    assert.deepEqual(grandAspects.get(N1), childAspects.get(N1));
  });

  test('TC-RRF-09 legacy modes stay readable and stay in the run tree', () => {
    for (const mode of LEGACY_RERUN_MODES) {
      const spec = rerunSpec(mode);
      assert.equal(spec.mode, mode);
      assert.equal(spec.legacy, true);
      assert.ok(spec.label.length > 0 && spec.expectation.length > 20);
    }
    const t = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
    const row = (id: string, mode: string | null, parent: string | null, n: number, reason: string | null = null) => ({
      runId: id,
      label: `${mode ?? 'root'} — Critical — X — 2026-01-0${n}`,
      mode,
      reason,
      method: 'AHP_TOPSIS',
      status: 'completed',
      program: 'successor',
      candidateCount: 10,
      createdAt: t(n),
      completedAt: t(n),
      parentRunId: parent,
    });
    const forest = buildRunForest([
      row('r', 'baseline', null, 1),
      row('a', 'exclude', 'r', 2),
      row('b', 'refresh_add', 'r', 3),
      row('c', 'refresh_full', 'r', 4),
      row('d', 'finalists_rematch', 'r', 5),
      row('e', 'incremental_add', 'a', 6, '  Forum minta Budi dibandingkan  '),
      row('f', 'something-unknown', null, 7),
      row('g', 'exclude', 'deleted-parent', 8),
      // Parent deleted: ON DELETE SET NULL blanked the column, the mode remains.
      row('h', 'incremental_add', null, 9),
    ]);
    assert.equal(forest.totalRuns, 9);
    const all = new Map<string, (typeof forest.roots)[number]>();
    const walk = (ns: typeof forest.roots) => ns.forEach((n) => (all.set(n.runId, n), walk(n.children)));
    walk(forest.roots);
    assert.equal(all.size, 9);
    for (const id of ['a', 'b', 'c', 'd']) assert.equal(all.get(id)!.legacy, true, id);
    assert.equal(all.get('e')!.legacy, false);
    assert.equal(all.get('e')!.reason, 'Forum minta Budi dibandingkan');
    assert.equal(all.get('e')!.depth, 2);
    assert.equal(all.get('f')!.mode, 'baseline');
    assert.equal(all.get('g')!.orphaned, true);
    assert.equal(all.get('h')!.orphaned, true);
    assert.equal(all.get('r')!.orphaned, false);
    assert.equal(all.get('f')!.orphaned, false); // unknown mode reads as baseline
    assert.equal(forest.orphanCount, 2);
  });
});

// TC-RDF (lib/run-diff.ts) moved to tests/scoring/run-compare.test.ts when the
// rank-shift panel was rebuilt on compareRuns: the oracle and property (i) pin
// the web replay to the engine bit for bit, and T-02 names the added candidate
// who became a new extreme.

describe('TC-REF  reference date (Pers. 2.5)', () => {
  test('TC-REF-01 stint age and ongoing tenure are measured to asOf, not to the wall clock', () => {
    const asOf = new Date('2026-06-01T00:00:00Z');
    const ended = new Date('2021-06-01T00:00:00Z');
    const r1 = recencyFactor(ended, asOf);
    const r2 = recencyFactor(ended, new Date(asOf.getTime()));
    assert.equal(r1, r2);
    assert.ok(r1 < 1);
    // A stint that ends after the reference date is not decayed.
    assert.equal(recencyFactor(new Date('2026-09-01T00:00:00Z'), asOf), 1);
    // Ongoing tenure stops at asOf: 2024-06 → 2026-06 = 2 years exactly.
    assert.equal(stintYears(new Date(2024, 5, 1), new Date('9999-01-01'), new Date(2026, 5, 1)), 2);
    // A stint that starts after asOf contributes nothing.
    assert.equal(stintYears(new Date(2026, 7, 1), null, new Date(2026, 5, 1)), 0);
  });
});
