// TC-RSB — the aspect scores a finished run's rows DISPLAY (Kandidat chips,
// dossier, comparison, Excel export, printed reports) are the run's stored
// values, never a recomputation from today's candidate row. Pure; no database,
// no browser.
//
//   node --import tsx --test tests/scoring/run-score-breakdown.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  displayedScoreBreakdown,
  recordedHavQuadrant,
  type ScoreBreakdown,
} from '../../lib/run-score-breakdown';
import { computePaBreakdown } from '../../lib/pa-topsis';
import { runHavText } from '../../lib/analysis-utils';

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

const stored: ScoreBreakdown = {
  technical: 0,
  behavior: 67,
  hav: 60,
  performance: computePaBreakdown('A,A,B,B,B,B').score,
  education: 100,
  career: 41,
};

/** A live fallback that fails the test if it is ever consulted. */
const untouchable = {
  technical: 50,
  performance: () => {
    throw new Error('live PA was computed for a row that stored one');
  },
};

describe('TC-RSB displayed score breakdown', () => {
  test('a stored PA is shown even after the candidate\'s grade changed', () => {
    // The sync since the run brought a worse grade history: recomputing would
    // print a different number from the one the ranking used.
    const today = computePaBreakdown('E,E,D,D,C,C').score;
    assert.notEqual(today, stored.performance, 'fixture must make the two differ');
    const shown = displayedScoreBreakdown(stored, stored, {
      technical: 50,
      performance: () => today,
    });
    assert.equal(shown.performance, stored.performance);
  });

  test('the live PA is not even computed when the row stored one', () => {
    assert.doesNotThrow(() => displayedScoreBreakdown(stored, stored, untouchable));
  });

  test('a stored technical of 0 stays 0 — it is a result, not a gap', () => {
    const shown = displayedScoreBreakdown(stored, stored, untouchable);
    assert.equal(shown.technical, 0);
  });

  test('the other aspects pass through untouched', () => {
    const shown = displayedScoreBreakdown(stored, stored, untouchable);
    assert.deepEqual(shown, stored);
  });

  test('a row with no stored details falls back to the live values', () => {
    const placeholder: ScoreBreakdown = { technical: 72, behavior: 0, hav: 0, performance: 0, education: 0 };
    const shown = displayedScoreBreakdown(placeholder, null, { technical: 72, performance: () => 33 });
    assert.equal(shown.technical, 72);
    assert.equal(shown.performance, 33);
  });

  test('only an aspect the stored row lacks (or holds as a non-number) falls back', () => {
    const partial = { ...stored, performance: undefined, technical: 'n/a' } as unknown as ScoreBreakdown;
    const shown = displayedScoreBreakdown(partial, partial, { technical: 55, performance: () => 33 });
    assert.equal(shown.performance, 33);
    assert.equal(shown.technical, 55);
    assert.equal(shown.behavior, stored.behavior);
    assert.equal(shown.career, stored.career);
  });

  test('getScoringRunResults routes its breakdown through the rule', () => {
    // Structural: the override this replaced assigned `performance:` from the
    // live grade inline. Pin that the loader uses the shared rule and that the
    // live PA is reachable only as the rule's fallback callback.
    const src = read('lib/scoring-engine.ts');
    assert.match(src, /scoreBreakdown:\s*displayedScoreBreakdown\(/);
    assert.doesNotMatch(src, /performance:\s*compute(Live|Hardcoded)PAScore\(|performance:\s*computeLivePaScore\(/i);
  });
});

describe('TC-RSB HAV quadrant shown on a run row', () => {
  test('an AHP+TOPSIS row shows the quadrant the run scored', () => {
    const hav = recordedHavQuadrant({ havQuadrant: '13', ahpTopsis: {} });
    assert.deepEqual(hav, { quadrant: '13', source: 'run' });
    assert.equal(runHavText({ havQuadrant: hav.quadrant, havQuadrantSource: hav.source }, { withHash: true }), '#13 MAXIMAL CONTRIBUTOR (STRONG)');
  });

  test('a recorded null means the candidate had no HAV then — not "unknown"', () => {
    const hav = recordedHavQuadrant({ havQuadrant: null, ahpTopsis: {} });
    assert.deepEqual(hav, { quadrant: null, source: 'run' });
    assert.equal(runHavText({ havQuadrant: null, havQuadrantSource: 'run' }), '—');
  });

  test('a row without the AHP+TOPSIS record (null written regardless) is "not recorded", never today\'s', () => {
    const hav = recordedHavQuadrant({ havQuadrant: null, scoreBreakdown: {} });
    assert.deepEqual(hav, { quadrant: null, source: 'not_recorded' });
    assert.equal(runHavText({ havQuadrant: '4', havQuadrantSource: 'not_recorded' }), 'tidak tercatat di run');
  });

  test('a row with no details records nothing', () => {
    assert.deepEqual(recordedHavQuadrant(null), { quadrant: null, source: 'not_recorded' });
  });

  test('neither the loader nor the Kandidat tab lays today\'s HAV over a run row', () => {
    const loader = read('lib/scoring-engine.ts');
    assert.match(loader, /havQuadrant:\s*hav\.quadrant/);
    assert.doesNotMatch(loader, /havQuadrant:\s*candidate\.havQuadrant\s*\?\?\s*enrichedBase\.havQuadrant/);
    assert.doesNotMatch(loader, /withEffectiveHav/);
    const tab = read('components/position-detail-tabs.tsx');
    assert.doesNotMatch(tab, /havQuadrant:\s*profile\?\.havQuadrant/);
  });
});
