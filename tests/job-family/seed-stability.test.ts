// TC-SEED — how a run's UMAP-seed dependence reaches the optimizer diagnosis.
//
// topic-service measures it (pipeline.seed_stability: the published partition
// against cluster() under randomState+1..k, by ARI) and stores it in
// diagnostics.seedStability; diagnose() only reports it. These tests pin the
// bands a reader is told and that a run without the measurement says nothing.
//
//   node --import tsx --test tests/job-family/*.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOB_FAMILY_CONFIG } from '../../lib/job-family/config';
import {
  diagnose,
  SEED_ARI_STABLE,
  SEED_ARI_UNSTABLE,
  type SeedStabilityInput,
} from '../../lib/job-family/optimize/diagnose';

function run(seedStability: SeedStabilityInput | null | undefined) {
  return diagnose({
    config: DEFAULT_JOB_FAMILY_CONFIG.bertopic,
    numDocuments: 100,
    sizes: [20, 20, 20, 20, 20],
    outliers: [],
    seedStability,
  }).findings.filter((f) => f.code.startsWith('seed_'));
}

function measured(ariMin: number): SeedStabilityInput {
  return {
    publishedSeed: 42,
    seeds: [
      { seed: 43, ari: ariMin },
      { seed: 44, ari: 0.99 },
    ],
    ariMean: (ariMin + 0.99) / 2,
    ariMin,
    unstableCount: 7,
  };
}

describe('TC-SEED seed stability findings', () => {
  test('a run without the measurement produces no seed finding', () => {
    assert.deepEqual(run(undefined), []);
    assert.deepEqual(run(null), []);
  });

  test('judged by the WORST other seed, in three bands', () => {
    assert.equal(run(measured(SEED_ARI_STABLE))[0].code, 'seed_stable');
    assert.equal(run(measured(SEED_ARI_STABLE - 0.01))[0].code, 'seed_moderate');
    assert.equal(run(measured(SEED_ARI_UNSTABLE - 0.01))[0].code, 'seed_unstable');
    assert.equal(run(measured(SEED_ARI_UNSTABLE - 0.01))[0].severity, 'warning');
  });

  test('evidence names the seeds compared and the unstable document count', () => {
    const [f] = run(measured(0.6));
    assert.match(f.evidence, /Seed 42 dibandingkan dengan 43, 44/);
    assert.match(f.evidence, /7 dari 100 dokumen/);
  });

  test('a failed check is reported, not read as stable', () => {
    const [f] = run({ error: 'boom' });
    assert.equal(f.code, 'seed_stability_failed');
    assert.equal(f.evidence, 'boom');
  });
});
