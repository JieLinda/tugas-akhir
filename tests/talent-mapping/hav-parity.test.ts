// TC-HAVP — the HAV in force exists THREE times: lib/hav-effective.ts (web:
// eligibility rules, profiles, Beranda, Talent Mapping),
// scoring-service/src/hav-effective.ts (the HAV aspect of both engines) and
// sync-service/src/services/hav-effective.ts (deciding when a PA/BA write MOVED
// the automatic HAV, which timestamps it and supersedes older hand placements).
// No shared library keeps them in step, and a drift never throws — a run would
// filter its pool on one quadrant and score the HAV aspect on another, or a sync
// would void a placement over a change that never happened. This runs all three
// over the same inputs, exhaustively where the input space is small enough.
//
//   node --import tsx --test tests/talent-mapping/hav-parity.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveEffectiveHav as webResolve } from '../../lib/hav-effective';
import { competencyBand as webCompetency, performanceBand as webPerformance } from '../../lib/hav-quadrant-derive';
import {
  competencyBand as svcCompetency,
  performanceBand as svcPerformance,
  resolveEffectiveHav as svcResolve,
} from '../../scoring-service/src/hav-effective';
import {
  competencyBand as syncCompetency,
  performanceBand as syncPerformance,
  resolveEffectiveHav as syncResolve,
} from '../../sync-service/src/services/hav-effective';

const GRADES = ['', 'A', 'B', 'C', 'D', 'E', 'C-'];

function* allSixSlotCsvs(): Generator<string> {
  const n = GRADES.length;
  const total = n ** 6;
  for (let i = 0; i < total; i += 1) {
    let k = i;
    const slots: string[] = [];
    for (let s = 0; s < 6; s += 1) {
      slots.push(GRADES[k % n]!);
      k = Math.floor(k / n);
    }
    yield slots.join(',');
  }
}

const BA_LABELS = [
  'STRENGTH', 'VERY HIGH', 'PENGEMBANGAN JANGKA PENDEK', 'NEED TARGETED DEVELOPMENT',
  'NEED DEVELOPMENT (9 MONTHS - 2 YEARS)', 'BUTUH PENGEMBANGAN', 'HIGH', 'READY', 'POTENSI',
  'MIDDLE HIGH', 'READY WITH DEVELOPMENT', 'LOW', 'MIDDLE LOW', 'VERY LOW', 'NOT READY',
  'FOCUS ON OPTIMILIZATION', 'FOCUS ON OPTIMIZATION', 'FOCUS ON OPTIMIZATION IN CURRENT POSITION',
  'BELUM ADA POTENSI',
  // decorated, truncated, cased, dashed and unknown forms
  'READY WITH DEVELOPMENT (2024)', 'Very  High', 'need development (9 months – 2 years)', 'READY WITH', 'GOOD', '-', '',
];

describe('TC-HAVP  web ↔ scoring-service ↔ sync-service', () => {
  test('TC-HAVP-01 performance band agrees on every six-slot CSV over {–,A,B,C,D,E,C-}', () => {
    let checked = 0;
    for (const raw of allSixSlotCsvs()) {
      const web = webPerformance(raw);
      assert.equal(svcPerformance(raw), web, raw);
      assert.equal(syncPerformance(raw), web, raw);
      checked += 1;
    }
    assert.equal(checked, GRADES.length ** 6);
  });

  test('TC-HAVP-02 performance band agrees on bare methodology tokens', () => {
    for (const raw of ['AA', 'AB', 'CB', 'CC', 'D', 'E', 'C-', 'C MINUS', 'A', 'C', 'XY', '']) {
      assert.equal(svcPerformance(raw), webPerformance(raw), raw);
      assert.equal(syncPerformance(raw), webPerformance(raw), raw);
    }
  });

  test('TC-HAVP-03 behavioural band agrees on every vocabulary entry and odd form', () => {
    for (const label of BA_LABELS) {
      assert.equal(svcCompetency(label), webCompetency(label), label);
      assert.equal(syncCompetency(label), webCompetency(label), label);
    }
  });

  test('TC-HAVP-04 the resolved quadrant and source agree across the precedence', () => {
    const pas = ['A,A,,,,', 'C,C,A,B,,', 'A,A,D,B,,', ',,,,,', 'B,,,,,'];
    const uploads = [null, '', '7', 'Kuadran #13', '17'];
    const manuals = [null, 4, 16];
    for (const pa of pas) {
      for (const ba of BA_LABELS) {
        for (const up of uploads) {
          for (const man of manuals) {
            // drizzle/0098: the formula pinned by a PA/BA change, the upload
            // pinned back by a HAV upload, or neither (the static order).
            for (const automaticTier of [null, 'upload', 'formula'] as const) {
              const input = { manualQuadrant: man, uploadedQuadrant: up, performanceGrade: pa, behaviorRecommendation: ba, automaticTier };
              const w = webResolve(input);
              const s = svcResolve(input);
              const y = syncResolve(input);
              const expected = { quadrant: w.quadrant, source: w.source };
              assert.deepEqual({ quadrant: s.quadrant, source: s.source }, expected, JSON.stringify(input));
              assert.deepEqual({ quadrant: y.quadrant, source: y.source }, expected, JSON.stringify(input));
            }
          }
        }
      }
    }
  });
});
