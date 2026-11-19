// TC-HAV — the Talent Mapping formula: PA × Behavioral Assessment → HAV 16-box →
// 5-Box. Every case here would fail SILENTLY in the product — a candidate just
// lands one square off — which is why the specification is pinned cell by cell.
//
//   node --import tsx --test tests/talent-mapping/hav-formula.test.ts
//
// lib/hav-quadrant-derive.ts is pure (no db, no server-only), so nothing is stubbed.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HAV_GRID_COLUMNS,
  HAV_GRID_ROWS,
  HAV_QUADRANT_MATRIX,
  QUADRANTS_BY_TALENT_BOX,
  bandsOfQuadrant,
  competencyBand,
  deriveHavQuadrant,
  readPerformance,
  talentBoxFromQuadrant,
} from '../../lib/hav-quadrant-derive';

/** The six-slot CSV candidate-populate writes: [yr-1 S2, yr-1 S1, yr-2 S2, yr-2 S1, yr-3 S2, yr-3 S1]. */
const csv = (...slots: string[]) => [...slots, '', '', '', '', '', ''].slice(0, 6).join(',');
const band = (raw: string) => readPerformance(raw)?.band ?? null;

describe('TC-HAV-GRID  the matrix as specified', () => {
  // Rows top → bottom = BA High … Low; columns left → right = PA Low … High.
  const drawn = HAV_GRID_ROWS.map((row) => HAV_GRID_COLUMNS.map((col) => HAV_QUADRANT_MATRIX[row][col]));

  test('TC-HAV-GRID-01 quadrant numbers, row by row', () => {
    assert.deepEqual(drawn, [
      [10, 6, 4, 1],
      [11, 5, 3, 2],
      [12, 9, 8, 7],
      [16, 15, 14, 13],
    ]);
  });

  test('TC-HAV-GRID-02 5-Box of every cell — Q13 is STRONG, Q14 SOLID', () => {
    assert.deepEqual(
      drawn.map((row) => row.map((q) => talentBoxFromQuadrant(q))),
      [
        ['BORDER', 'SOLID', 'STRONG', 'TOP'],
        ['BORDER', 'SOLID', 'STRONG', 'STRONG'],
        ['BORDER', 'SOLID', 'SOLID', 'STRONG'],
        ['BOTTOM', 'BORDER', 'SOLID', 'STRONG'],
      ],
    );
  });

  test('TC-HAV-GRID-03 the box rollup lists', () => {
    assert.deepEqual(QUADRANTS_BY_TALENT_BOX, {
      TOP: [1],
      STRONG: [2, 3, 4, 7, 13],
      SOLID: [5, 6, 8, 9, 14],
      BORDER: [10, 11, 12, 15],
      BOTTOM: [16],
    });
  });

  test('TC-HAV-GRID-04 bandsOfQuadrant inverts the matrix for all 16', () => {
    for (let q = 1; q <= 16; q += 1) {
      const bands = bandsOfQuadrant(q);
      assert.ok(bands, `Q${q} has no cell`);
      assert.equal(HAV_QUADRANT_MATRIX[bands.competencyBand][bands.performanceBand], q);
    }
    assert.equal(bandsOfQuadrant(17), null);
  });
});

describe('TC-HAV-PA  performance axis (2 periode terakhir; Low = D/E/C- dalam 2 tahun)', () => {
  test('TC-HAV-PA-01 High: AA, AB, BA, BB', () => {
    for (const [a, b] of [['A', 'A'], ['A', 'B'], ['B', 'A'], ['B', 'B']]) assert.equal(band(csv(a!, b!)), 'High');
  });

  test('TC-HAV-PA-02 Mid High: CA, CB, AC, BC', () => {
    for (const [a, b] of [['C', 'A'], ['C', 'B'], ['A', 'C'], ['B', 'C']]) assert.equal(band(csv(a!, b!)), 'Mid High');
  });

  test('TC-HAV-PA-03 Mid Low: CC', () => {
    assert.equal(band(csv('C', 'C')), 'Mid Low');
  });

  test('TC-HAV-PA-04 Low: D, E or C- in the newest pair', () => {
    assert.equal(band(csv('D', 'A')), 'Low');
    assert.equal(band(csv('A', 'E')), 'Low');
    assert.equal(band(csv('C-', 'B')), 'Low');
  });

  test('TC-HAV-PA-05 Low: a below-C grade TWO years back overrides a perfect newest year', () => {
    assert.equal(band(csv('A', 'A', 'D', 'B')), 'Low');
    assert.equal(band(csv('A', 'A', 'B', 'E')), 'Low');
    const r = readPerformance(csv('A', 'A', 'D', 'B'));
    assert.deepEqual(r?.periodSlots, [0, 1], 'the band still names the pair it would have read');
    assert.deepEqual(r?.lowTrigger, { slot: 2, grade: 'D' }, 'and names the grade that overrode it');
  });

  test('TC-HAV-PA-06 a below-C grade THREE years back does not force Low', () => {
    assert.equal(band(csv('A', 'A', 'B', 'B', 'D', 'E')), 'High');
  });

  test('TC-HAV-PA-07 blank slots are skipped: the newest two GRADED periods are read', () => {
    // Newest semester missing → yr-1 S1 and yr-2 S2, not a lone B counted twice.
    assert.equal(band(csv('', 'B', 'C', 'C')), 'Mid High');
    assert.deepEqual(readPerformance(csv('', 'B', 'C', 'C'))?.periodSlots, [1, 2]);
    // A whole year still blank (the source lags) falls through to the year before.
    assert.equal(band(csv('', '', 'A', 'B')), 'High');
  });

  test('TC-HAV-PA-08 a lone graded period counts twice — never promotes on half the evidence', () => {
    assert.equal(band(csv('', '', '', '', 'C')), 'Mid Low');
    assert.equal(band(csv('B')), 'High');
    assert.deepEqual(readPerformance(csv('', '', '', '', 'C'))?.grades, ['C', 'C']);
  });

  test('TC-HAV-PA-09 a below-C pair past the 2-year window is still Low (no other cell holds a D)', () => {
    assert.equal(band(csv('', '', '', '', 'D', 'B')), 'Low');
  });

  test('TC-HAV-PA-10 no graded period → null, not a default band', () => {
    assert.equal(readPerformance(csv()), null);
    assert.equal(readPerformance(null), null);
    assert.equal(readPerformance('X,Y,,,,'), null, 'unknown letters are not grades');
  });
});

describe('TC-HAV-BA  behavioural-assessment axis', () => {
  const expected: Record<string, string> = {
    STRENGTH: 'High',
    'VERY HIGH': 'Mid High',
    'PENGEMBANGAN JANGKA PENDEK': 'Mid High',
    'NEED TARGETED DEVELOPMENT': 'Mid Low',
    HIGH: 'Mid Low',
    READY: 'Mid Low',
    POTENSI: 'Mid Low',
    'MIDDLE HIGH': 'Mid Low',
    'READY WITH DEVELOPMENT': 'Mid Low',
    LOW: 'Low',
    'MIDDLE LOW': 'Low',
    'FOCUS ON OPTIMIZATION': 'Low',
  };

  test('TC-HAV-BA-01 every category the specification names', () => {
    for (const [label, want] of Object.entries(expected)) assert.equal(competencyBand(label), want, label);
  });

  test('TC-HAV-BA-02 equivalents in this system’s vocabulary', () => {
    assert.equal(competencyBand('NEED DEVELOPMENT (9 MONTHS - 2 YEARS)'), 'Mid Low');
    assert.equal(competencyBand('FOCUS ON OPTIMIZATION IN CURRENT POSITION'), 'Low');
    assert.equal(competencyBand('VERY LOW'), 'Low');
    assert.equal(competencyBand('NOT READY'), 'Low');
    assert.equal(competencyBand('BELUM ADA POTENSI'), 'Low');
  });

  test('TC-HAV-BA-03 "VERY HIGH" and "MIDDLE HIGH" are not read as "HIGH"', () => {
    assert.equal(competencyBand('very  high'), 'Mid High');
    assert.equal(competencyBand('Middle High'), 'Mid Low');
  });

  test('TC-HAV-BA-04 an unrecognised label is null, not a guessed band', () => {
    assert.equal(competencyBand('GOOD'), null);
    assert.equal(competencyBand('-'), null);
    assert.equal(competencyBand(''), null);
  });
});

describe('TC-HAV-DERIVE  both axes together', () => {
  test('TC-HAV-DERIVE-01 STRENGTH × AA → Q1 TOP', () => {
    const r = deriveHavQuadrant({ performanceGrade: csv('A', 'A'), behaviorRecommendation: 'STRENGTH' });
    assert.ok(r.ok);
    assert.equal(r.quadrant, 1);
    assert.equal(r.category, 'TOP');
  });

  test('TC-HAV-DERIVE-02 LOW × BB → Q13 STRONG', () => {
    const r = deriveHavQuadrant({ performanceGrade: csv('B', 'B'), behaviorRecommendation: 'LOW' });
    assert.ok(r.ok);
    assert.equal(r.quadrant, 13);
    assert.equal(r.category, 'STRONG');
  });

  test('TC-HAV-DERIVE-03 STRENGTH with a D in yr-2 → Q10 BORDER, provenance kept', () => {
    const r = deriveHavQuadrant({ performanceGrade: csv('A', 'A', 'B', 'D'), behaviorRecommendation: 'STRENGTH' });
    assert.ok(r.ok);
    assert.equal(r.quadrant, 10);
    assert.deepEqual(r.performance?.lowTrigger, { slot: 3, grade: 'D' });
  });

  test('TC-HAV-DERIVE-04 a missing axis names its gap instead of picking a cell', () => {
    const noPa = deriveHavQuadrant({ performanceGrade: csv(), behaviorRecommendation: 'READY' });
    assert.deepEqual(noPa, { ok: false, gaps: ['performance-missing'] });
    const odd = deriveHavQuadrant({ performanceGrade: csv('A', 'A'), behaviorRecommendation: 'GOOD' });
    assert.deepEqual(odd, { ok: false, gaps: ['competency-unrecognized'] });
    const none = deriveHavQuadrant({ performanceGrade: null, behaviorRecommendation: null });
    assert.deepEqual(none, { ok: false, gaps: ['performance-missing', 'competency-missing'] });
  });

  test('TC-HAV-DERIVE-05 a bare methodology token still works (no slots to point at)', () => {
    const r = deriveHavQuadrant({ performanceGrade: 'CB', behaviorRecommendation: 'VERY HIGH' });
    assert.ok(r.ok);
    assert.equal(r.quadrant, 3);
    assert.equal(r.performance, null);
  });
});
