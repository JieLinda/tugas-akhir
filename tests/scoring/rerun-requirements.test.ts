// TC-REQ — requirements of "Tambah Kandidat Pembanding" added in the
// requirements-audit session (docs/rerun-requirements-audit.md). Every test
// drives the SAME pure functions the production paths call. No database, no
// model; the database half is scripts/verify-rerun-requirements.ts.
//
//   node --import tsx --test tests/scoring/rerun-requirements.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  childFinalistTarget,
  classifyRerunCandidates,
  resolveFrozenBasis,
  RERUN_REASON_MAX_LENGTH,
  validateRerunRequest,
  type RuleVerdict,
} from '../../lib/rerun-freeze';
import { rerunRequestKey } from '../../lib/rerun-request-key';
import { readinessLabelForRow, parseReadinessConfig } from '../../lib/readiness-label';
import { buildRunForest, displayRunStatus, type RunTreeRow } from '../../lib/run-tree';
import {
  composeChildResultList,
  modelDifferences,
  planFrozenRerun,
  type RunModels,
} from '../../scoring-service/src/rerun-freeze';
import { basisCaveats, parsePositionBasis, type PositionBasis } from '../../scoring-service/src/position-basis';
import {
  parseReadinessThresholds,
  readinessFromThresholds,
  rankCandidatesByTopsis,
  assembleAspectScores,
  type AhpCriterionKey,
} from '../../scoring-service/src/ahp-topsis-engine';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (p: string) => readFileSync(root + p, 'utf8');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const verdict = (over: Partial<RuleVerdict> = {}): RuleVerdict => ({
  rejected: [],
  excluded: [],
  outOfScope: [],
  advisory: [],
  dataMissing: false,
  ...over,
});

// ── One fixture that covers every status a picked person can get ──────────
const POOL = [
  { candidateId: uuid(1), isFinalist: true, poolRank: 1 },
  { candidateId: uuid(2), isFinalist: false, poolRank: 7 },
];
const PEOPLE = new Map([
  [uuid(1), { name: 'Finalis', deleted: false, isIncumbent: false }],
  [uuid(2), { name: 'Di Pool', deleted: false, isIncumbent: false }],
  [uuid(10), { name: 'Baru Lolos', deleted: false, isIncumbent: false }],
  [uuid(11), { name: 'Disiplin', deleted: false, isIncumbent: false }],
  [uuid(12), { name: 'Grade Rendah', deleted: false, isIncumbent: false }],
  [uuid(13), { name: 'Grade Rendah Dikonfirmasi', deleted: false, isIncumbent: false }],
  [uuid(14), { name: 'MCU Catatan', deleted: false, isIncumbent: false }],
  [uuid(15), { name: 'Unit Lain', deleted: false, isIncumbent: false }],
  [uuid(16), { name: 'Terhapus', deleted: true, isIncumbent: false }],
  [uuid(17), { name: 'Pejabat', deleted: false, isIncumbent: true }],
  [uuid(18), { name: 'PA Kosong', deleted: false, isIncumbent: false }],
]);
const VERDICTS = new Map<string, RuleVerdict>([
  [uuid(11), verdict({ rejected: ['Disiplin: Terdapat sanksi disiplin'] })],
  [uuid(12), verdict({ excluded: ['Rentang grade: grade 4 di luar rentang 6–7 run induk'] })],
  [uuid(13), verdict({ excluded: ['Rentang grade: grade 4 di luar rentang 6–7 run induk'] })],
  [uuid(14), verdict({ advisory: ['MCU: Status MCU tidak Fit.'] })],
  [uuid(15), verdict({ outOfScope: ['Business unit: MSO di luar business unit run induk'] })],
  [uuid(18), verdict({ rejected: ['Performance Appraisal: data belum tercatat'], dataMissing: true })],
]);
const PICKED = [10, 11, 12, 13, 14, 15, 16, 17, 1, 2, 18, 99].map(uuid);
const classify = () =>
  classifyRerunCandidates({
    pickedIds: PICKED,
    parentPool: POOL,
    candidates: PEOPLE,
    verdicts: VERDICTS,
    confirmedOutOfRange: new Set([uuid(13)]),
  });

describe('TC-REQ  Tambah Kandidat Pembanding — kebutuhan', () => {
  test('TC-REQ-RR03 the preview and the server take the SAME classification path', () => {
    // Structural: both server entry points go through classifyAgainstParent,
    // which is the only caller of the pure classifier.
    const engine = src('lib/scoring-engine.ts');
    const body = (name: string) => {
      const i = engine.indexOf(`export async function ${name}(`);
      assert.ok(i >= 0, name);
      return engine.slice(i, engine.indexOf('\nexport ', i + 10));
    };
    for (const fn of ['startRerunAction', 'getRerunCandidateStatusesAction', 'searchRerunCandidatesAction']) {
      assert.match(body(fn), /classifyAgainstParent\(/, fn);
    }
    assert.equal((engine.match(/classifyRerunCandidates\(/g) ?? []).length, 1);
    // Behavioural: the per-person verdicts the dialog shows are exactly the
    // accepted/skipped split the server acts on.
    const { verdicts, accepted, skipped } = classify();
    assert.deepEqual(
      verdicts.filter((v) => v.status === 'accepted').map((v) => v.candidateId),
      accepted.map((a) => a.candidateId),
    );
    assert.deepEqual(
      verdicts.filter((v) => v.status === 'skipped').map((v) => v.candidateId),
      skipped.map((s) => s.candidateId),
    );
  });

  test('TC-REQ-RR05 Rejected is refused, Excluded needs confirmation, Reconsidered is scored', () => {
    const { verdicts } = classify();
    const by = new Map(verdicts.map((v) => [v.candidateId, v]));
    const status = (n: number) => {
      const v = by.get(uuid(n))!;
      return v.status === 'accepted' ? `accepted:${v.classification}${v.outOfRange ? ':outOfRange' : ''}` : `skipped:${v.reason}`;
    };
    assert.equal(status(10), 'accepted:new');
    assert.equal(status(11), 'skipped:rejected_rules');
    assert.equal(status(12), 'skipped:needs_confirmation');
    assert.equal(status(13), 'accepted:new:outOfRange');
    assert.equal(status(14), 'accepted:new');
    assert.equal(status(15), 'skipped:outside_scope');
    assert.equal(status(16), 'skipped:soft_deleted');
    assert.equal(status(17), 'skipped:incumbent');
    assert.equal(status(1), 'skipped:parent_finalist');
    assert.equal(status(2), 'accepted:existing_pool');
    assert.equal(status(18), 'skipped:rejected_rules');
    assert.equal(status(99), 'skipped:not_found');
    // The refused rows say WHICH rule; the confirmed out-of-range row keeps the
    // range rule it breaks (it goes to filter_summary.forceIncluded); the
    // Reconsidered row carries its advisory flag.
    const rejected = by.get(uuid(11))!;
    assert.ok(rejected.status === 'skipped' && rejected.message.includes('Disiplin'));
    const confirmed = by.get(uuid(13))!;
    assert.ok(confirmed.status === 'accepted' && confirmed.excludedRules[0]!.includes('grade 4'));
    const reconsidered = by.get(uuid(14))!;
    assert.ok(reconsidered.status === 'accepted' && reconsidered.advisory.length === 1);
    // An existing_pool person carries the parent's pool rank, and no rule is
    // re-evaluated for them.
    const inPool = by.get(uuid(2))!;
    assert.ok(inPool.status === 'accepted' && inPool.poolRank === 7 && inPool.excludedRules.length === 0);
  });

  test('TC-REQ-RR04 the reason is required, trimmed, and at most 1000 characters', () => {
    const ok = { tenantMatches: true, status: 'completed', method: 'AHP_TOPSIS', poolSnapshotRows: 5 };
    const req = (reason: string) =>
      validateRerunRequest({ mode: 'incremental_add', reason, addedCandidateIds: [uuid(10)], parent: ok });
    assert.equal(RERUN_REASON_MAX_LENGTH, 1000);
    assert.equal(req('x'.repeat(1000)), null);
    assert.equal(req(`   ${'x'.repeat(1000)}   `), null);
    assert.match(req('x'.repeat(1001))!, /paling panjang 1\.000 karakter/);
    assert.match(req('   ')!, /wajib diisi/);
    // The dialog enforces the same limit (FR-RR-04 "di klien maupun server").
    assert.match(src('components/rerun-dialog.tsx'), /RERUN_REASON_MAX_LENGTH/);
  });

  test('TC-REQ-RR09 the child lists top N ∪ parent finalists ∪ comparison candidates, nobody else', () => {
    // Parent N = 3, parent finalists A B C. The child ranks:
    //   1 A · 2 X(new, comparison) · 3 B · 4 D (old, never finalist)
    //   5 C (parent finalist pushed out) · 6 E · 7 Y (comparison, low)
    const { listed } = composeChildResultList({
      rankedIds: ['A', 'X', 'B', 'D', 'C', 'E', 'Y'],
      topN: childFinalistTarget(3, 7),
      parentFinalistIds: new Set(['A', 'B', 'C']),
      comparisonIds: new Set(['X', 'Y']),
    });
    assert.deepEqual(
      listed.map((l) => [l.candidateId, l.poolRank]),
      [['A', 1], ['X', 2], ['B', 3], ['C', 5], ['Y', 7]],
    );
    // D (rank 4) and E (rank 6) were nobody's question and are not listed —
    // the old rule (N + k = 5) would have listed D.
    const m = new Map(listed.map((l) => [l.candidateId, l]));
    assert.deepEqual(
      [m.get('X')!.comparison, m.get('X')!.enteredTopN, m.get('X')!.leftTopN],
      [true, true, false],
    );
    assert.deepEqual([m.get('C')!.leftTopN, m.get('C')!.belowCut], [true, true]);
    assert.deepEqual([m.get('Y')!.comparison, m.get('Y')!.belowCut, m.get('Y')!.enteredTopN], [true, true, false]);
    // A root lists its top N with no markers at all.
    const rootList = composeChildResultList({
      rankedIds: ['A', 'B', 'C', 'D'],
      topN: 2,
      parentFinalistIds: new Set(),
      comparisonIds: new Set(),
    }).listed;
    assert.deepEqual(rootList.map((l) => l.candidateId), ['A', 'B']);
    assert.ok(rootList.every((l) => !l.enteredTopN && !l.leftTopN && !l.comparison));
  });

  test('TC-REQ-RR13 an identical request has one key, regardless of order and duplicates', () => {
    const k = (picked: string[], confirmed: string[], reason: string) =>
      rerunRequestKey({ parentId: uuid(500), pickedIds: picked, confirmedIds: confirmed, reason });
    const base = k([uuid(1), uuid(2)], [uuid(2)], 'Forum 28 Okt');
    assert.equal(k([uuid(2), uuid(1), uuid(1)], [uuid(2)], '  Forum 28 Okt '), base);
    assert.notEqual(k([uuid(1)], [uuid(2)], 'Forum 28 Okt'), base);
    assert.notEqual(k([uuid(1), uuid(2)], [], 'Forum 28 Okt'), base);
    assert.notEqual(k([uuid(1), uuid(2)], [uuid(2)], 'Forum 29 Okt'), base);
    // The action creates under an advisory lock on that key.
    assert.match(src('lib/scoring-engine.ts'), /pg_advisory_xact_lock\(hashtextextended\(\$\{requestKey\}/);
  });
});

describe('TC-REQ  pembekuan basis posisi (FR-RR-07) dan isi basis induk (FR-RR-06)', () => {
  const basis: PositionBasis = {
    version: 1,
    resolvedByRunId: uuid(700),
    resolvedAt: '2026-09-01T03:00:00.000Z',
    originSource: 'own',
    jobProfile: {
      id: 12,
      matchTier: 'exact',
      contentHash: 'abc',
      positionName: 'IT Application Development Department Head',
      jobPurpose: 'Memimpin pengembangan aplikasi',
      responsibilities: ['Merencanakan rilis'],
      responsibilityDetails: [{ responsibility: 'Merencanakan rilis', successIndicator: 'Rilis tepat waktu' }],
      requiredCompetencies: [{ name: 'SOFTWARE DEVELOPMENT', level: 3 }],
      educationRequirement: 'S1 Teknik Informatika',
      challenges: [],
    },
    targetPositionCode: 'ITAD01',
    required: { items: [{ name: 'SOFTWARE DEVELOPMENT', level: 3 }], source: 'profile', detail: null, employeeIds: [] },
    education: { source: 'profile', requirement: 'S1 Teknik Informatika', requirementSealed: null, recorded: true },
    careerTarget: {
      jobProfileId: 12,
      jobProfileName: 'IT Application Development Department Head',
      matchType: 'jfm',
      status: 'ok',
      vector: [0.1, 0.2, 0.3],
      pseudoNote: null,
      statedExperience: '5 tahun',
    },
    kamus: { fingerprint: 'k1:model-a', codes: 90 },
    embedding: { model: 'model-a', documentModel: 'model-a', dimensions: 3 },
  };

  test('TC-REQ-RR07a a basis survives the jsonb round trip a child inherits it through', () => {
    const back = parsePositionBasis(JSON.parse(JSON.stringify(basis)));
    assert.deepEqual(back, basis);
    // Malformed or absent → null, so the engine resolves live and SAYS so.
    assert.equal(parsePositionBasis(null), null);
    assert.equal(parsePositionBasis({ version: 2 }), null);
  });

  test('TC-REQ-RR07b the web passes the parent\'s basis through to the child unchanged', () => {
    const frozen = resolveFrozenBasis({
      parent: {
        id: uuid(700),
        completedAt: '2026-09-01T03:02:00.000Z',
        createdAt: '2026-09-01T03:00:00.000Z',
        runInfo: { frozen: { referenceDate: '2026-09-01T03:00:00.000Z', positionBasis: basis } },
      },
      rootRunId: uuid(700),
    });
    assert.deepEqual(frozen.positionBasis, basis);
    // A parent from before the basis was recorded has none to pass.
    const legacy = resolveFrozenBasis({
      parent: { id: uuid(701), completedAt: null, createdAt: '2026-01-01T00:00:00Z', runInfo: { ahp: {} } },
      rootRunId: uuid(701),
    });
    assert.equal(legacy.positionBasis, null);
  });

  test('TC-REQ-RR07c what moved around a frozen basis is named, never applied silently', () => {
    const none = basisCaveats({
      basis,
      liveKamusFingerprint: 'k1:model-a',
      liveEmbeddingModel: 'model-a',
      liveDocumentModel: 'model-a',
      liveVectorDimensions: 3,
    });
    assert.deepEqual(none, []);
    const keys = basisCaveats({
      basis: { ...basis, education: { source: 'incumbent', requirement: null, requirementSealed: null, recorded: false } },
      liveKamusFingerprint: 'k2:model-a',
      liveEmbeddingModel: 'model-b',
      liveDocumentModel: 'model-b',
      liveVectorDimensions: 768,
    }).map((c) => c.key);
    assert.deepEqual(keys, ['kamus_changed', 'embedding_model_changed', 'career_vector_dimension', 'education_unrecorded']);
  });

  test('TC-REQ-RR06 the parent\'s CR / λmax / CI and models are inherited, not recomputed', () => {
    const full = resolveFrozenBasis({
      parent: {
        id: uuid(702),
        completedAt: '2026-09-01T03:02:00.000Z',
        createdAt: '2026-09-01T03:00:00.000Z',
        runInfo: {
          frozen: { ahp: { consistency: { cr: 0.0123456789, lambdaMax: 6.0765432, ci: 0.0153086 } } },
          ahp: { consistencyRatio: 0.0123, lambdaMax: 6.0765, consistencyIndex: 0.0153 },
        },
      },
      rootRunId: uuid(702),
    });
    // Full precision from `frozen` beats the 4-decimal display copy.
    assert.equal(full.ahp.consistency!.cr, 0.0123456789);
    const legacy = resolveFrozenBasis({
      parent: {
        id: uuid(703),
        completedAt: '2026-09-01T03:02:00.000Z',
        createdAt: '2026-09-01T03:00:00.000Z',
        runInfo: { ahp: { consistencyRatio: 0.0123, lambdaMax: 6.0765, consistencyIndex: 0.0153 } },
      },
      rootRunId: uuid(703),
    });
    assert.equal(legacy.ahp.consistency!.cr, 0.0123);

    const parentModels: RunModels = {
      embedding: { model: 'nomic', documentModel: 'nomic' },
      education: { provider: 'gemini', model: 'gemini-2.5-flash', configured: true },
      narrative: { enabled: true, model: 'qwen3' },
    };
    assert.deepEqual(modelDifferences(parentModels, parentModels), []);
    assert.deepEqual(
      modelDifferences(parentModels, { ...parentModels, education: { ...parentModels.education, model: 'gemini-3' } }),
      [{ key: 'education', parent: 'gemini-2.5-flash', current: 'gemini-3' }],
    );
    assert.deepEqual(modelDifferences(null, parentModels), []);
  });
});

describe('TC-REQ  label readiness dari snapshot run (FR-SN-04)', () => {
  const snapshot = {
    thresholds: [
      { minScore: 80, level: 'Short' },
      { minScore: 65, level: 'Medium' },
      { minScore: 50, level: 'Long' },
    ],
    defaultLevel: 'Not Ready',
  };
  // Governance raised every threshold by 10 AFTER the run.
  const liveAfterEdit = (s: number) => (s >= 90 ? 'Short' : s >= 75 ? 'Medium' : s >= 60 ? 'Long' : 'Not Ready');

  test('TC-REQ-SN04a a stored label wins; the run snapshot comes next; today\'s thresholds never, unless nothing is recorded', () => {
    assert.deepEqual(
      readinessLabelForRow({ stored: 'Short', scorePct: 82, snapshot, live: liveAfterEdit }),
      { level: 'Short', source: 'stored' },
    );
    assert.deepEqual(
      readinessLabelForRow({ stored: null, scorePct: 82, snapshot, live: liveAfterEdit }),
      { level: 'Short', source: 'snapshot' },
    );
    // The same row with neither a stored label nor a snapshot is the ONLY case
    // that moves with governance — and it says so.
    assert.deepEqual(
      readinessLabelForRow({ stored: null, scorePct: 82, snapshot: null, live: liveAfterEdit }),
      { level: 'Medium', source: 'live_fallback' },
    );
  });

  test('TC-REQ-SN04b the engine labels rows with the RUN\'s thresholds, by the same walk', () => {
    const cfg = parseReadinessThresholds(snapshot)!;
    for (const s of [0, 49, 50, 64, 65, 79, 80, 100]) {
      assert.equal(readinessFromThresholds(cfg, s), readinessLabelForRow({ stored: null, scorePct: s, snapshot, live: liveAfterEdit }).level, String(s));
    }
    assert.equal(parseReadinessConfig({ thresholds: 'x' }), null);
    // Every web reader that labels finished rows routes through rowReadiness.
    const data = src('lib/pulse-data.ts');
    assert.equal((data.match(/readinessFromScore\(score\)/g) ?? []).length, 0);
    assert.ok((data.match(/rowReadiness\(/g) ?? []).length >= 4);
  });
});

describe('TC-REQ  kegagalan dan riwayat (FR-RR-12, FR-RH-01)', () => {
  const row = (over: Partial<RunTreeRow>): RunTreeRow => ({
    runId: uuid(800),
    label: 'x',
    mode: 'incremental_add',
    method: 'AHP_TOPSIS',
    status: 'in_progress',
    program: 'successor',
    candidateCount: 3,
    createdAt: '2026-09-16T01:00:00Z',
    completedAt: null,
    parentRunId: null,
    ...over,
  });

  test('TC-REQ-RR12 a failed run reads "failed" with its message, wherever the failure was recorded', () => {
    assert.equal(displayRunStatus(row({})), 'in_progress');
    assert.equal(displayRunStatus(row({ failure: { kind: 'error', message: 'x' } })), 'failed');
    assert.equal(displayRunStatus(row({ sessionStatus: 'failed' })), 'failed');
    // A completed run is never re-labelled, whatever its session says.
    assert.equal(displayRunStatus(row({ status: 'completed', sessionStatus: 'failed' })), 'completed');
    const forest = buildRunForest([
      row({ runId: uuid(801), mode: 'baseline', status: 'completed' }),
      row({ runId: uuid(802), parentRunId: uuid(801), failure: { kind: 'error', message: 'Run induk tidak menyimpan skor aspek …', at: '2026-09-16T01:00:30Z' } }),
      row({ runId: uuid(803), parentRunId: uuid(801), sessionStatus: 'failed' }),
    ]);
    const kids = forest.roots[0]!.children;
    assert.deepEqual(kids.map((k) => k.status), ['failed', 'failed']);
    assert.match(kids[0]!.failure!.message, /tidak menyimpan skor aspek/);
    assert.match(kids[1]!.failure!.message, /tidak tercatat/);
    // The scoring service records the failure on the RUN, not only the session.
    const runner = src('scoring-service/src/runner.ts');
    assert.match(runner, /recordRunFailure\(failed\.runId/);
    assert.doesNotMatch(runner, /SET status = 'failed', completed_at/);
  });

  test('TC-REQ-RH01 the tree carries creator, comparison count and badges', () => {
    const forest = buildRunForest([
      row({
        runId: uuid(810),
        mode: 'baseline',
        status: 'completed',
        createdByName: 'Praktisi HC',
        decisionCount: 1,
      }),
      row({
        runId: uuid(811),
        parentRunId: uuid(810),
        status: 'completed',
        addedCount: 2,
        skippedCount: 1,
        outOfRangeCount: 1,
        liveValues: true,
        provisionalCount: 0,
      }),
    ]);
    const r = forest.roots[0]!;
    assert.equal(r.createdByName, 'Praktisi HC');
    assert.equal(r.badges.decisions, 1);
    const c = r.children[0]!;
    assert.deepEqual([c.addedCount, c.skippedCount], [2, 1]);
    assert.deepEqual(c.badges, { outOfRange: 1, liveValues: true, provisional: 0, decisions: 0 });
  });
});

describe('TC-REQ  determinisme re-run (NFR-RR-02)', () => {
  test('TC-REQ-NFR02 two children of one parent with the same additions give identical numbers', () => {
    // Parent aspects; the "model-dependent" aspects of the new candidate are a
    // fixed stand-in for a mocked model call.
    const parent = new Map<string, Record<AhpCriterionKey, number>>([
      [uuid(1), { technical: 80, career: 70, behavior: 83, performance: 67, hav: 80, education: 70 }],
      [uuid(2), { technical: 60, career: 50, behavior: 70, performance: 100, hav: 60, education: 85 }],
      [uuid(3), { technical: 72, career: 64, behavior: 50, performance: 67, hav: 40, education: 50 }],
    ]);
    const cached = new Map(
      [...parent].map(([id, a]) => [
        id,
        {
          technical: a.technical,
          career: a.career,
          baseBehavior: a.behavior,
          basePerformance: a.performance,
          baseHav: a.hav,
          baseRaw: null,
          technicalMatching: null,
          careerMatching: null,
          educationEval: { score: a.education } as never,
          provisional: false,
        },
      ]),
    );
    const mockModel = () => ({ technical: 88, career: 72, education: 70 });
    const once = () => {
      const plan = planFrozenRerun({
        candidateIds: [uuid(1), uuid(2), uuid(3), uuid(4)],
        newCandidateIds: [uuid(4)],
        existingPoolCandidateIds: [],
        cached,
      });
      const m = mockModel();
      const computed = {
        technical: new Map([[uuid(4), m.technical]]),
        career: new Map([[uuid(4), m.career]]),
        behavior: new Map([[uuid(4), 70]]),
        performance: new Map([[uuid(4), 67]]),
        hav: new Map([[uuid(4), 80]]),
        education: new Map([[uuid(4), m.education]]),
      };
      const aspects = assembleAspectScores([uuid(1), uuid(2), uuid(3), uuid(4)], computed, plan.reused);
      const w = { technical: 0.25, career: 0.05, behavior: 0.35, performance: 0.1, hav: 0.2, education: 0.05 };
      return rankCandidatesByTopsis([uuid(1), uuid(2), uuid(3), uuid(4)].map((id) => ({ id })), aspects, w, new Set())
        .rankedAll.map((e) => [e.candidate.id, e.closeness, e.dPlus, e.dMinus]);
    };
    assert.deepEqual(once(), once());
  });
});
