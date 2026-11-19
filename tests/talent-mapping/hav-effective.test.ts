// TC-HAVE — "HAV yang berlaku": which quadrant every reader uses, which
// candidates Talent Mapping shows (the Talent Pool's discipline rule alone), and
// what a switched-off rule does (nothing). All three fail SILENTLY in the
// product — a person is filtered or scored on the wrong quadrant, vanishes from
// the map, or is judged by a rule somebody turned off — which is why they are
// pinned here.
//
//   node --import tsx --test tests/talent-mapping/hav-effective.test.ts
//
// lib/programs.ts imports 'server-only' and lib/db (which throws at load without
// a connection string). No query is made: the stub and a dummy URL suffice.
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { resolveEffectiveHav } from '../../lib/hav-effective';
import {
  countDisabledFilterRules,
  countEnabledFilterRules,
  decidingFilterTree,
  talentMappingGateRules,
  talentMappingGateTree,
} from '../../lib/filter-rules';

const req = createRequire(import.meta.url);
try {
  req.cache[req.resolve('server-only')] = { exports: {} } as never;
} catch {
  /* not installed */
}
process.env.DATABASE_URL ??= 'postgresql://localhost/none';

type Programs = typeof import('../../lib/programs');
let applyProgramFilters: Programs['applyProgramFilters'];
before(async () => {
  ({ applyProgramFilters } = await import('../../lib/programs'));
});

const csv = (...slots: string[]) => [...slots, '', '', '', '', '', ''].slice(0, 6).join(',');

describe('TC-HAVE-PREC  manual › upload › formula › none', () => {
  const pa = csv('A', 'A'); // formula: STRENGTH × AA → Q1
  test('TC-HAVE-01 manual wins over upload and formula', () => {
    const h = resolveEffectiveHav({ manualQuadrant: 9, uploadedQuadrant: '7', performanceGrade: pa, behaviorRecommendation: 'STRENGTH' });
    assert.equal(h.quadrant, 9);
    assert.equal(h.source, 'manual');
    assert.deepEqual(h.automatic, { quadrant: 7, source: 'upload' }, 'a revert returns to the upload');
  });

  test('TC-HAVE-02 the upload wins over the formula', () => {
    const h = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: 'Kuadran #7', performanceGrade: pa, behaviorRecommendation: 'STRENGTH' });
    assert.equal(h.quadrant, 7);
    assert.equal(h.source, 'upload');
    assert.ok(h.formula.ok && h.formula.quadrant === 1, 'the formula answer is kept for reference');
  });

  test('TC-HAVE-03 the formula applies when there is no upload', () => {
    const h = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: null, performanceGrade: pa, behaviorRecommendation: 'STRENGTH' });
    assert.equal(h.quadrant, 1);
    assert.equal(h.source, 'formula');
    assert.deepEqual(h.automatic, { quadrant: 1, source: 'formula' });
  });

  test('TC-HAVE-04 nothing → none, never a default square', () => {
    const h = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: '', performanceGrade: csv(), behaviorRecommendation: null });
    assert.equal(h.quadrant, null);
    assert.equal(h.source, 'none');
  });

  test('TC-HAVE-05 an out-of-range upload is not a quadrant', () => {
    const h = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: '17', performanceGrade: pa, behaviorRecommendation: 'STRENGTH' });
    assert.equal(h.source, 'formula', 'falls through to the formula');
  });
});

describe('TC-HAVE-POP  Talent Mapping population = the Talent Pool DISCIPLINE rule alone', () => {
  const rule = (field: string, operator: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    kind: 'rule' as const,
    rule: { field, operator, value, label: field, message: `${field} gagal`, ...extra } as any,
  });
  const group = (op: 'and' | 'or', ...children: any[]) => ({ kind: 'group' as const, op, children });
  const person = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'Kandidat',
    disciplineStatus: 'CLEAR',
    mcuStatus: 'fit',
    performanceGrade: 'B,B,B,B,B,B',
    havQuadrant: '9',
    behaviorRecommendation: 'HIGH',
    yearsExperience: 6,
    education: 'S1',
    ...over,
  });
  const qualifies = (tree: any, c: any) => applyProgramFilters({ filterTree: tree } as any, [c])[0]!.qualified;
  const onMap = (tree: any, c: any) => qualifies(talentMappingGateTree(tree), c);

  // The live Mulia shape: discipline, advisory MCU, BA, HAV, and a PA × tenure OR.
  const talentPool = group(
    'and',
    rule('disciplineStatus', 'in', ['CLEAR', 'ST']),
    rule('mcuStatus', 'in', ['fit', 'fit_with_note'], { severity: 'advisory' }),
    rule('behaviorRecommendation', 'in', ['STRENGTH', 'VERY HIGH']),
    rule('havQuadrant', 'in', ['1', '2', '3', '4', '7']),
    group(
      'or',
      group('and', rule('performanceGrade', 'in', ['A', 'B', 'C']), rule('yearsExperience', 'gte', 3)),
      group('and', rule('performanceGrade', 'notIn', ['A', 'B']), rule('yearsExperience', 'lt', 3)),
    ),
  );

  test('TC-HAVE-06 HAV, PA, BA, MCU and tenure do not gate the map — only discipline does', () => {
    const c = person({ havQuadrant: '16', behaviorRecommendation: 'LOW', mcuStatus: 'unfit', performanceGrade: 'D,D,,,,', yearsExperience: 1 });
    assert.equal(qualifies(talentPool, c), false, 'fails the Talent Pool');
    assert.equal(onMap(talentPool, c), true, 'but is on the map');
  });

  test('TC-HAVE-07 a sanction keeps somebody off the map', () => {
    assert.equal(onMap(talentPool, person({ disciplineStatus: 'SP3' })), false);
    assert.equal(onMap(talentPool, person({ disciplineStatus: 'ST' })), true);
  });

  test('TC-HAVE-08 switching the discipline rule OFF opens the map to everybody', () => {
    const off = group('and', rule('disciplineStatus', 'in', ['CLEAR'], { enabled: false }), rule('havQuadrant', 'in', ['1']));
    assert.equal(onMap(off, person({ disciplineStatus: 'SP3' })), true);
    assert.deepEqual(talentMappingGateRules(off as any), [], 'no switched-on discipline rule gates the map');
  });

  test('TC-HAVE-09 everyone in the Talent Pool is on the map (non-discipline rules become TRUE, never removed)', () => {
    // "discipline CLEAR OR PA A": a sanctioned PA-A employee is IN the pool; the
    // map must not turn them away for a criterion it does not judge.
    const mixed = group('and', group('or', rule('disciplineStatus', 'in', ['CLEAR']), rule('performanceGrade', 'in', ['A'])));
    const c = person({ disciplineStatus: 'SP3', performanceGrade: 'A,A,,,,' });
    assert.equal(qualifies(mixed, c), true);
    assert.equal(onMap(mixed, c), true);
    // And over a spread of people against the live shape: pool ⊆ map.
    for (const d of ['CLEAR', 'ST', 'SP3', 'ACTIVE_SP']) {
      for (const hav of ['1', '7', '9', '16']) {
        for (const pa of ['A,A,,,,', 'C,C,,,,', 'D,B,,,,']) {
          const p = person({ disciplineStatus: d, havQuadrant: hav, performanceGrade: pa, behaviorRecommendation: 'STRENGTH' });
          if (qualifies(talentPool, p)) assert.equal(onMap(talentPool, p), true, JSON.stringify(p));
        }
      }
    }
  });

  test('TC-HAVE-10 the gate leaves the stored tree untouched', () => {
    const before = JSON.stringify(talentPool);
    talentMappingGateTree(talentPool as any);
    assert.equal(JSON.stringify(talentPool), before);
  });
});

describe('TC-HAVE-OFF  a switched-off rule takes part in nothing', () => {
  const rule = (field: string, operator: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    kind: 'rule' as const,
    rule: { field, operator, value, label: field, message: `${field} gagal`, ...extra } as any,
  });
  const group = (op: 'and' | 'or', ...children: any[]) => ({ kind: 'group' as const, op, children });
  const c = {
    id: 'c',
    name: 'K',
    disciplineStatus: 'SP3',
    mcuStatus: 'unfit',
    performanceGrade: 'B,B,,,,',
    havQuadrant: '9',
    behaviorRecommendation: 'HIGH',
    yearsExperience: 6,
    education: 'S1',
  };
  const decide = (tree: any) => applyProgramFilters({ filterTree: tree } as any, [c as any])[0]!;

  test('TC-HAVE-11 off: no verdict, no reason in "Tidak Lolos"', () => {
    const d = decide(group('and', rule('disciplineStatus', 'in', ['CLEAR'], { enabled: false })));
    assert.equal(d.qualified, true);
    assert.deepEqual(d.failedRules, []);
  });

  test('TC-HAVE-12 off inside an OR is REMOVED, not TRUE — the other alternative decides', () => {
    const d = decide(
      group('and', group('or', rule('havQuadrant', 'in', ['1']), rule('disciplineStatus', 'in', ['SP3'], { enabled: false }))),
    );
    assert.equal(d.qualified, false, 'HAV 9 is not in {1}; a switched-off sibling must not satisfy the OR');
  });

  test('TC-HAVE-13 an advisory rule switched off flags nobody', () => {
    const on = decide(group('and', rule('mcuStatus', 'in', ['fit'], { severity: 'advisory' })));
    const off = decide(group('and', rule('mcuStatus', 'in', ['fit'], { severity: 'advisory', enabled: false })));
    assert.equal(on.flaggedRules.length, 1);
    assert.equal(off.flaggedRules.length, 0);
  });

  test('TC-HAVE-14 counts separate on from off; `enabled: true` and absent are both on', () => {
    const tree = group('and', rule('a', 'eq', 1, { enabled: false }), rule('b', 'eq', 1, { enabled: true }), rule('c', 'eq', 1));
    assert.equal(countEnabledFilterRules(tree as any), 2);
    assert.equal(countDisabledFilterRules(tree as any), 1);
    assert.equal(decidingFilterTree(tree as any).children.length, 2);
  });
});
