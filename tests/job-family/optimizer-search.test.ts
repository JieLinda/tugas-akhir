// TC-OPT — the measured Job Family optimizer (Pengaturan → Optimasi Job Family).
//
// lib/job-family/optimize/measured.ts judges a goal from what topic-service
// MEASURED on the current corpus; search.ts plans which settings to measure;
// freshness.ts says whether the map still describes the corpus. These tests pin
// the definitions a reader is told: what "met" means per goal, what counts as
// "got worse", when the search stops, and what can be judged after a rebuild.
//
//   node --import tsx --test tests/job-family/*.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOB_FAMILY_CONFIG, type BertopicConfig } from '../../lib/job-family/config';
import {
  alreadyMet,
  configKey,
  goalVerdict,
  metricsFromSizes,
  metricsOfTrial,
  movedDocuments,
  normalizeBertopic,
  sideEffects,
  strictCounts,
  strictThresholdFor,
  verifyRun,
  type Expectation,
  type TrialMeasurement,
  type TrialResult,
} from '../../lib/job-family/optimize/measured';
import {
  SEARCH_LIMITS,
  baselineTrial,
  evaluateSearch,
  isSettled,
  planNextRound,
} from '../../lib/job-family/optimize/search';
import { classifyFreshness } from '../../lib/job-family/optimize/freshness';

const BASE: BertopicConfig = { ...DEFAULT_JOB_FAMILY_CONFIG.bertopic };

/** Families 0..k-1 with the given sizes, then `outliers` documents at -1. */
function members(sizes: number[], outliers = 0): number[] {
  const out: number[] = [];
  sizes.forEach((n, id) => {
    for (let i = 0; i < n; i++) out.push(id);
  });
  for (let i = 0; i < outliers; i++) out.push(-1);
  return out;
}

function trial(opts: {
  config?: Partial<BertopicConfig>;
  membership: number[];
  own?: (number | null)[];
  nearest?: (number | null)[];
  rehomed?: boolean[];
  keywords?: Record<string, string[]>;
  note?: string;
}): TrialMeasurement {
  const config = normalizeBertopic({ ...BASE, ...opts.config });
  const ids = [...new Set(opts.membership.filter((t) => t !== -1))].sort((a, b) => a - b);
  return {
    key: configKey(config),
    config,
    note: opts.note ?? '',
    ok: true,
    topicCount: ids.length,
    outlierCount: opts.membership.filter((t) => t === -1).length,
    numDocuments: opts.membership.length,
    sizes: ids.map((id) => opts.membership.filter((t) => t === id).length),
    keywords: opts.keywords ?? Object.fromEntries(ids.map((id) => [String(id), [`k${id}a`, `k${id}b`]])),
    membership: opts.membership,
    ownSimilarity: opts.own ?? opts.membership.map((t) => (t === -1 ? null : 0.8)),
    nearestSimilarity: opts.nearest ?? opts.membership.map(() => 0.3),
    rehomed: opts.rehomed ?? opts.membership.map(() => false),
  };
}

const subject = (t: TrialMeasurement) => ({ metrics: metricsOfTrial(t), trial: t });

describe('TC-OPT measured metrics and verdicts', () => {
  test('TC-OPT-01 a config key ignores key order and missing keys, and changes with any value', () => {
    const reordered = Object.fromEntries(Object.entries(BASE).reverse()) as BertopicConfig;
    assert.equal(configKey(reordered), configKey(BASE));
    assert.equal(configKey({ minClusterSize: 5 }), configKey(BASE));
    assert.notEqual(configKey({ ...BASE, minClusterSize: 6 }), configKey(BASE));
  });

  test('TC-OPT-02 metrics are read from family sizes the way the panel reads a run', () => {
    const m = metricsFromSizes([10, 2, 6, 2], 25, { 0: ['a', 'b'], 1: ['a', 'c'], 2: ['d'], 3: ['e'] });
    assert.equal(m.topicCount, 4);
    assert.equal(m.outlierCount, 5);
    assert.equal(m.outlierPct, 20);
    assert.deepEqual(m.sizes, [10, 6, 2, 2]);
    assert.equal(m.tinyCount, 2);
    assert.equal(m.largestShare, 0.5);
    assert.equal(m.medianSize, 4);
    // Two of four families share "a": shares 1/2, 1/2, 0, 0.
    assert.equal(m.labelOverlap, 0.25);
    assert.equal(metricsFromSizes([5, 5, 5], 15).sizeCv, 0);
  });

  test('TC-OPT-03 renumbered families move nobody; a real move is counted', () => {
    assert.equal(movedDocuments([0, 0, 1, 1, -1], [1, 1, 0, 0, -1]), 0);
    assert.equal(movedDocuments([0, 0, 0, 1, 1], [0, 0, 1, 1, 1]), 1);
  });

  test('TC-OPT-04 each goal is judged by its own number', () => {
    const ctx = (goal: Parameters<typeof goalVerdict>[0]['goal']) => ({ goal, threshold: null });
    const b = subject(trial({ membership: members([20, 10, 2], 18) }));
    // reduce_outliers: more than the 0.5-point noise band.
    assert.equal(goalVerdict(ctx('reduce_outliers'), b, subject(trial({ membership: members([20, 10, 2, 1], 17) }))).met, true);
    assert.equal(goalVerdict(ctx('reduce_outliers'), b, b).met, false);
    // no_outliers: zero, nothing less.
    assert.equal(goalVerdict(ctx('no_outliers'), b, subject(trial({ membership: members([29, 19, 2]) }))).met, true);
    assert.equal(goalVerdict(ctx('no_outliers'), b, subject(trial({ membership: members([29, 19, 1], 1) }))).met, false);
    // more / fewer families.
    const more = subject(trial({ membership: members([12, 8, 10, 2], 18) }));
    assert.equal(goalVerdict(ctx('more_topics'), b, more).met, true);
    assert.equal(goalVerdict(ctx('fewer_topics'), b, more).met, false);
    // remove_tiny: no family under 3.
    assert.equal(goalVerdict(ctx('remove_tiny'), b, subject(trial({ membership: members([20, 12], 18) }))).met, true);
    assert.equal(goalVerdict(ctx('remove_tiny'), b, b).met, false);
  });

  test('TC-OPT-05 cleaner labels must not move anybody, and must make names more distinct', () => {
    const base = trial({ membership: members([5, 5]), keywords: { 0: ['umum', 'a'], 1: ['umum', 'b'] } });
    const distinct = trial({
      config: { bm25Weighting: true },
      membership: members([5, 5]),
      keywords: { 0: ['x', 'a'], 1: ['y', 'b'] },
    });
    const moved = trial({ config: { minDf: 2 }, membership: [0, 0, 0, 0, 1, 1, 1, 1, 1, 1], keywords: distinct.keywords });
    const ctx = { goal: 'cleaner_labels' as const, threshold: null };
    assert.equal(goalVerdict(ctx, subject(base), subject(distinct)).met, true);
    const v = goalVerdict(ctx, subject(base), subject(moved));
    assert.equal(v.met, false);
    assert.match(v.summary, /1 jabatan pindah/);
  });

  test('TC-OPT-06 strict outliers: the bar comes from every unclustered document, re-homed ones included', () => {
    // Docs 6..9 were HDBSCAN noise: two re-homed at 0.7/0.72, two still out at 0.3/0.32.
    const t = trial({
      config: { reduceOutliers: true, outlierThreshold: 0 },
      membership: [0, 0, 0, 1, 1, 1, 0, 1, -1, -1],
      own: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.7, 0.72, null, null],
      nearest: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.32],
      rehomed: [false, false, false, false, false, false, true, true, false, false],
    });
    const th = strictThresholdFor(t, t.config);
    assert.equal(th.source, 'data');
    assert.equal(th.value, 0.51);
    assert.deepEqual(strictCounts(t, th.value), { near: 0, forced: 0 });
    assert.ok(alreadyMet({ goal: 'strict_outliers', threshold: th.value }, subject(t)));
    // A setting that forces the far ones in too is caught.
    const forced = { ...t, rehomed: t.rehomed.map((r, i) => r || i >= 8), membership: [0, 0, 0, 1, 1, 1, 0, 1, 0, 1], ownSimilarity: [...t.ownSimilarity.slice(0, 8), 0.3, 0.32] };
    assert.deepEqual(strictCounts(forced, th.value), { near: 0, forced: 2 });
  });

  test('TC-OPT-07 a goal\'s own metric is never reported as a side effect; others are', () => {
    const b = metricsFromSizes([20, 20], 40);
    const many = metricsFromSizes([4, 4, 4, 4, 4, 4, 4, 4, 4, 4], 40);
    assert.deepEqual(sideEffects('more_topics', b, many).regressions, []);
    const fewer = metricsFromSizes([40], 40);
    assert.ok(sideEffects('reduce_outliers', b, fewer).regressions.some((r) => r.startsWith('Jumlah famili')));
  });
});

describe('TC-OPT measured search', () => {
  const baseRound = (t: TrialMeasurement): TrialResult[] => [{ ...t, ...baselineTrial(t.config) }];

  test('TC-OPT-08 round 1 is planned from the MEASURED baseline, normalized, without the baseline itself', () => {
    const b = trial({ membership: members([20, 10], 20) });
    const plan = planNextRound('reduce_outliers', [baseRound(b)]);
    assert.ok(plan.length > 0 && plan.length <= SEARCH_LIMITS.maxPerRound);
    for (const p of plan) {
      assert.notEqual(p.key, b.key);
      assert.equal(p.key, configKey(p.config));
      assert.deepEqual(Object.keys(p.config).sort(), Object.keys(BASE).sort());
      assert.ok(p.note.length > 0);
    }
    assert.ok(plan.some((p) => p.config.reduceOutliers === true));
  });

  test('TC-OPT-09 the search stops when the goal is met with nothing worse, and picks that one', () => {
    const b = trial({ membership: members([20, 10], 20) });
    const plan = planNextRound('reduce_outliers', [baseRound(b)]);
    const round1: TrialResult[] = plan.map((p, i) =>
      i === 0
        ? { ...trial({ config: p.config, membership: members([28, 17], 5) }), note: p.note }
        : { ...trial({ config: p.config, membership: members([20, 10], 20) }), note: p.note },
    );
    const rounds = [baseRound(b), round1];
    const ev = evaluateSearch('reduce_outliers', rounds);
    assert.equal(isSettled(ev), true);
    assert.equal(ev.best?.key, plan[0]!.key);
    assert.equal(ev.best?.reason, plan[0]!.note);
    assert.deepEqual(planNextRound('reduce_outliers', rounds), []);
  });

  test('TC-OPT-10 nothing met: continue from the closest; met at a price: also try a milder version', () => {
    const b = trial({ membership: members([20, 10, 6], 14) });
    const plan = planNextRound('reduce_outliers', [baseRound(b)]);
    const shrink = plan.find((p) => p.config.minClusterSize === 3)!;
    assert.ok(shrink, 'expected the minClusterSize 5 → 3 candidate');
    const round1: TrialResult[] = plan.map((p) =>
      p === shrink
        ? // Meets the goal, but turns everything into one giant family.
          { ...trial({ config: p.config, membership: members([44, 4], 2) }), note: p.note }
        : // Changes nothing that matters.
          { ...trial({ config: p.config, membership: members([20, 10, 6], 14) }), note: p.note },
    );
    const rounds = [baseRound(b), round1];
    const ev = evaluateSearch('reduce_outliers', rounds);
    assert.equal(ev.best?.key, shrink.key);
    assert.ok(ev.best!.regressions.length > 0);
    assert.equal(isSettled(ev), false);
    const next = planNextRound('reduce_outliers', rounds);
    assert.ok(next.some((p) => p.config.minClusterSize === 4 && /lebih lunak/.test(p.note)));
    assert.ok(next.some((p) => /Dilanjutkan/.test(p.note)));
    const keys = new Set(rounds.flat().map((t) => t.key));
    assert.ok(next.every((p) => !keys.has(p.key)));
  });

  test('TC-OPT-11 the search never exceeds its rounds, and says when the setting in force already meets the goal', () => {
    const b = trial({ membership: members([20, 10], 20) });
    const filler = (n: number): TrialResult[] =>
      Array.from({ length: n }, (_, i) => trial({ config: { randomState: 1000 + i }, membership: members([20, 10], 20) }));
    const rounds = [baseRound(b), filler(1), filler(1), filler(1)];
    assert.deepEqual(planNextRound('reduce_outliers', rounds), []);

    const none = trial({ membership: members([20, 10]) });
    const ev = evaluateSearch('no_outliers', [baseRound(none)]);
    assert.ok(ev.alreadyMet);
    assert.deepEqual(planNextRound('no_outliers', [baseRound(none)]), []);
  });

  test('TC-OPT-12 a baseline that could not be measured stops the search with its error', () => {
    const failed: TrialResult = { ...baselineTrial(BASE), ok: false, error: 'boom' };
    assert.throws(() => evaluateSearch('balance', [[failed]]), /boom/);
  });
});

describe('TC-OPT after the rebuild', () => {
  const exp = (over: Partial<Expectation> = {}): Expectation => {
    const baseline = metricsFromSizes([20, 10], 50);
    const predicted = metricsFromSizes([28, 17], 50);
    return {
      goal: 'reduce_outliers',
      threshold: null,
      corpusFingerprint: 'fp1',
      corpusDocuments: 50,
      baseline,
      predicted,
      verdict: goalVerdict({ goal: 'reduce_outliers', threshold: null }, { metrics: baseline }, { metrics: predicted }),
      regressions: [],
      ...over,
    };
  };

  test('TC-OPT-13 same corpus and same families: reproduced, and the measured verdict stands', () => {
    const v = verifyRun(exp(), { fingerprint: 'fp1', metrics: metricsFromSizes([17, 28], 50) });
    assert.equal(v.corpus, 'same');
    assert.equal(v.reproduced, true);
    assert.equal(v.goalMet, true);
    assert.deepEqual(v.mismatches, []);
  });

  test('TC-OPT-14 same corpus but different families is reported, not smoothed over', () => {
    const v = verifyRun(exp(), { fingerprint: 'fp1', metrics: metricsFromSizes([30, 15], 50) });
    assert.equal(v.reproduced, false);
    assert.ok(v.mismatches.some((m) => m.startsWith('Ukuran famili')));
  });

  test('TC-OPT-15 a changed corpus: absolute goals are judged on the map, relative ones need a new measurement', () => {
    const relative = verifyRun(exp(), { fingerprint: 'fp2', metrics: metricsFromSizes([30, 25], 55) });
    assert.equal(relative.corpus, 'changed');
    assert.equal(relative.goalMet, null);
    const absolute = verifyRun(exp({ goal: 'no_outliers' }), { fingerprint: 'fp2', metrics: metricsFromSizes([30, 25], 55) });
    assert.equal(absolute.goalMet, true);
  });

  test('TC-OPT-16 freshness: exact with a fingerprint, cautious without one', () => {
    const corpus = { fingerprint: 'fp1', documents: 50, lastEmbeddedAt: '2026-10-01T00:00:00Z' };
    const run = { fingerprint: 'fp1', documents: 50, createdAt: '2026-09-01T00:00:00Z', completedAt: '2026-09-01T00:05:00Z' };
    assert.equal(classifyFreshness(run, corpus).state, 'fresh');
    const changed = classifyFreshness({ ...run, fingerprint: 'fp0' }, corpus);
    assert.equal(changed.state, 'stale');
    assert.match(changed.reasons[0]!, /berubah/);
    assert.equal(classifyFreshness({ ...run, fingerprint: null }, corpus).state, 'stale');
    assert.equal(
      classifyFreshness({ ...run, fingerprint: null }, { ...corpus, lastEmbeddedAt: '2026-08-01T00:00:00Z' }).state,
      'unverifiable',
    );
    assert.match(classifyFreshness({ ...run, fingerprint: null, documents: 49 }, corpus).reasons[0]!, /49 dokumen/);
  });
});
