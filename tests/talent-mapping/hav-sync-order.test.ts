// TC-HAVO — when a write counts as a HAV EVENT: the thing that is timestamped
// (candidates.hav_auto_changed_at), that replaces a hand placement made BEFORE
// it, and — since drizzle/0098 — that says which automatic tier is in force
// (candidates.hav_auto_tier). HR's rule (2026-11) is "whichever happened last
// wins":
//
//   1. PA or BA edited on the Kandidat form          → formula   (web app)
//   2. a PA/BA upload or sync that CHANGES PA or BA   → formula
//   3. Talent Mapping drag & drop                     → manual, until 1/2 again
//   4. a HAV upload that differs from the HAV before  → upload
//
// Getting this wrong fails silently in both directions — a placement voided by a
// write that changed nothing, or kept past one that did.
//
//   node --import tsx --test tests/talent-mapping/hav-sync-order.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  automaticHav,
  candidateSyncHavEvent,
  havUploadEvent,
  paBaChanged,
  paBaFormulaEvent,
  type HavInputs,
} from '../../sync-service/src/services/hav-order';
import { paBaChanged as webPaBaChanged, resolveEffectiveHav } from '../../lib/hav-effective';

const inputs = (over: Partial<HavInputs> = {}): HavInputs => ({
  upload: null,
  performanceGrade: 'A,A,,,,',
  behaviorRecommendation: 'STRENGTH', // formula: STRENGTH (High) × AA (High) → Q1
  ...over,
});

describe('TC-HAVO  the automatic HAV (no manual tier)', () => {
  test('TC-HAVO-01 upload, else formula, else none — the static order', () => {
    assert.deepEqual(automaticHav(inputs({ upload: 'Kuadran #7' })), { quadrant: 7, source: 'upload' });
    assert.deepEqual(automaticHav(inputs()), { quadrant: 1, source: 'formula' });
    assert.deepEqual(automaticHav(inputs({ performanceGrade: ',,,,,' })), { quadrant: null, source: 'none' });
  });

  test('TC-HAVO-01b a pinned formula outranks the upload; an uncomputable pin falls back to it', () => {
    assert.deepEqual(automaticHav(inputs({ upload: '7', tier: 'formula' })), { quadrant: 1, source: 'formula' });
    assert.deepEqual(automaticHav(inputs({ upload: '7', tier: 'upload' })), { quadrant: 7, source: 'upload' });
    assert.deepEqual(
      automaticHav(inputs({ upload: '7', tier: 'formula', behaviorRecommendation: null })),
      { quadrant: 7, source: 'upload' },
    );
  });

  test('TC-HAVO-01c the web resolver agrees: manual > pinned formula > upload', () => {
    const base = { uploadedQuadrant: '7', performanceGrade: 'A,A,,,,', behaviorRecommendation: 'STRENGTH' };
    assert.equal(resolveEffectiveHav({ ...base, manualQuadrant: null }).source, 'upload');
    const pinned = resolveEffectiveHav({ ...base, manualQuadrant: null, automaticTier: 'formula' });
    assert.deepEqual([pinned.quadrant, pinned.source, pinned.automatic.source], [1, 'formula', 'formula']);
    const manual = resolveEffectiveHav({ ...base, manualQuadrant: 12, automaticTier: 'formula' });
    assert.deepEqual([manual.quadrant, manual.source, manual.automatic.quadrant], [12, 'manual', 1]);
  });
});

describe('TC-HAVO-PABA  a change to PA or BA puts the formula in force (rules 1, 2)', () => {
  test('TC-HAVO-02 a PA change IS an event and pins the formula', () => {
    const d = paBaFormulaEvent(inputs(), inputs({ performanceGrade: 'C,C,,,,' })); // AA → CC: Q1 → Q6
    assert.equal(d.changed, true);
    assert.equal(d.tier, 'formula');
    assert.deepEqual([d.before.quadrant, d.after.quadrant], [1, 6]);
  });

  test('TC-HAVO-03 a BA change IS an event', () => {
    const d = paBaFormulaEvent(inputs(), inputs({ behaviorRecommendation: 'READY' })); // Q1 → Q7
    assert.equal(d.changed, true);
    assert.deepEqual([d.before.quadrant, d.after.quadrant], [1, 7]);
  });

  test('TC-HAVO-04 a PA change within the same band IS an event too (the data changed)', () => {
    // A,A → A,B: still Q1, but a manual placement holds only until PA/BA changes again.
    const d = paBaFormulaEvent(inputs(), inputs({ performanceGrade: 'A,B,,,,' }));
    assert.equal(d.changed, true);
    assert.equal(d.after.quadrant, 1);
  });

  test('TC-HAVO-05 a PA/BA change outranks an existing upload', () => {
    const d = paBaFormulaEvent(inputs({ upload: '7' }), inputs({ upload: '7', performanceGrade: 'D,D,,,,' }));
    assert.equal(d.changed, true);
    assert.deepEqual(d.before, { quadrant: 7, source: 'upload' });
    assert.deepEqual(d.after, { quadrant: 10, source: 'formula' });
  });

  test('TC-HAVO-06 an identical re-read (any formatting) is NOT an event', () => {
    assert.equal(paBaFormulaEvent(inputs(), inputs({ performanceGrade: ' a, a ,,,' })).changed, false);
    assert.equal(paBaFormulaEvent(inputs(), inputs({ behaviorRecommendation: ' strength ' })).changed, false);
    assert.equal(paBaFormulaEvent(inputs({ performanceGrade: 'A,A' }), inputs()).changed, false, 'short CSV = padded');
  });

  test('TC-HAVO-07 a change that leaves the formula unable to answer is NOT an event', () => {
    const d = paBaFormulaEvent(inputs(), inputs({ performanceGrade: null, behaviorRecommendation: null }));
    assert.equal(d.changed, false, 'a placement must not be voided because PA/BA went missing');
    assert.equal(paBaFormulaEvent(inputs(), inputs({ behaviorRecommendation: 'SOMETHING UNKNOWN' })).changed, false);
  });

  test('TC-HAVO-08 data appearing IS an event (nothing → a quadrant)', () => {
    const d = paBaFormulaEvent(inputs({ performanceGrade: ',,,,,' }), inputs());
    assert.equal(d.changed, true);
    assert.deepEqual([d.before.quadrant, d.after.quadrant], [null, 1]);
  });

  test('TC-HAVO-09 the web and sync copies of paBaChanged agree', () => {
    const pairs: [string | null, string | null, string | null, string | null][] = [
      ['A,A,,,,', 'STRENGTH', 'A,A', 'strength'],
      ['A,A,,,,', 'STRENGTH', 'A,B,,,,', 'STRENGTH'],
      ['', 'READY', null, 'READY'],
      ['C,C,,,,', 'NEED DEVELOPMENT – 9', 'C,C,,,,', 'need development - 9'],
      ['B,,,,,', null, 'B,,,,,', 'LOW'],
    ];
    for (const [pa1, ba1, pa2, ba2] of pairs) {
      const a = { performanceGrade: pa1, behaviorRecommendation: ba1 };
      const b = { performanceGrade: pa2, behaviorRecommendation: ba2 };
      assert.equal(webPaBaChanged(a, b), paBaChanged(a, b), JSON.stringify([a, b]));
    }
  });
});

describe('TC-HAVO-CAND  the candidate sync (populate)', () => {
  test('TC-HAVO-11 a PA/BA change is an event', () => {
    const d = candidateSyncHavEvent(inputs(), inputs({ performanceGrade: 'C,C,,,,' }));
    assert.equal(d.changed, true);
    assert.equal(d.uploadRecopied, false);
  });

  test('TC-HAVO-12 re-copying an OLDER upload value is not an event (it is flagged, not stamped)', () => {
    const d = candidateSyncHavEvent(inputs({ upload: '1' }), inputs({ upload: '15' }));
    assert.equal(d.changed, false);
    assert.equal(d.uploadRecopied, true);
  });

  test('TC-HAVO-13 a PA/BA change under an unchanged upload IS an event now', () => {
    const d = candidateSyncHavEvent(inputs({ upload: '7' }), inputs({ upload: '7', behaviorRecommendation: 'LOW' }));
    assert.equal(d.changed, true);
    assert.equal(d.after.source, 'formula');
  });
});

describe('TC-HAVO-UP  a HAV upload (rule 4)', () => {
  test('TC-HAVO-14 a new upload value IS an event and pins the upload, even over a pinned formula', () => {
    const d = havUploadEvent(inputs({ upload: '7', tier: 'formula' }), '12', { inForce: 1, againstInForce: false });
    assert.equal(d.changed, true);
    assert.equal(d.tier, 'upload');
    assert.deepEqual(d.before, { quadrant: 1, source: 'formula' });
    assert.deepEqual(d.after, { quadrant: 12, source: 'upload' });
  });

  test('TC-HAVO-15 in-app upload: unchanged sheet value that differs from the HAV IN FORCE is an event', () => {
    // A PA edit pinned the formula (Q1); the sheet still says Q7 and is uploaded again.
    const before = inputs({ upload: '7', tier: 'formula' });
    assert.equal(havUploadEvent(before, '7', { inForce: 1, againstInForce: true }).changed, true);
  });

  test('TC-HAVO-16 shared HAV.xlsx re-read: an unchanged value is never an event', () => {
    const before = inputs({ upload: '7', tier: 'formula' });
    assert.equal(havUploadEvent(before, 'Kuadran #7', { inForce: 1, againstInForce: false }).changed, false);
  });

  test('TC-HAVO-17 in-app upload equal to the HAV in force and to the stored value is NOT an event', () => {
    assert.equal(havUploadEvent(inputs({ upload: '7' }), '7', { inForce: 7, againstInForce: true }).changed, false);
  });

  test('TC-HAVO-18 in-app upload differing from a manual placement in force is an event', () => {
    assert.equal(havUploadEvent(inputs({ upload: '7' }), '7', { inForce: 3, againstInForce: true }).changed, true);
  });
});
