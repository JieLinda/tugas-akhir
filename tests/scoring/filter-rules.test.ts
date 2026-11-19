// TC-FLT — program eligibility ("aturan filter"): which candidates enter the
// scoring pool at all. These traps fail SILENTLY — nobody throws, candidates just
// appear or vanish — which is why they are pinned here.
//
//   node --import tsx --test tests/scoring/filter-rules.test.ts
//
// lib/programs.ts imports 'server-only' and lib/db (which throws at load without
// a connection string). No query is made: the stub and a dummy URL suffice.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
try {
  req.cache[req.resolve('server-only')] = { exports: {} } as never;
} catch {
  /* not installed */
}
process.env.DATABASE_URL ??= 'postgresql://localhost/none';

type Programs = typeof import('../../lib/programs');
let applyProgramFilters: Programs['applyProgramFilters'];
let systemProgramTemplates: (typeof import('../../lib/program-defaults'))['systemProgramTemplates'];

before(async () => {
  ({ applyProgramFilters } = await import('../../lib/programs'));
  ({ systemProgramTemplates } = await import('../../lib/program-defaults'));
});

const person = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Kandidat',
  disciplineStatus: 'CLEAR',
  mcuStatus: 'fit',
  performanceGrade: 'B,B,B,B,B,B',
  havQuadrant: '5',
  behaviorRecommendation: 'HIGH',
  yearsExperience: 6,
  education: 'S1',
  ...over,
});
const rule = (field: string, operator: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  kind: 'rule' as const,
  rule: { field, operator, value, label: field, message: `${field} gagal`, ...extra } as any,
});
const group = (op: 'and' | 'or', ...children: any[]) => ({ kind: 'group' as const, op, children });
const run = (tree: any, cands: any[], opts?: any) => applyProgramFilters({ filterTree: tree } as any, cands, opts);

describe('TC-FLT  applyProgramFilters', () => {
  test('TC-FLT-01 empty tree → everyone qualifies', () => {
    assert.equal(run(group('and'), [person()])[0]!.qualified, true);
  });

  test('TC-FLT-02 a failing hard rule disqualifies and is named', () => {
    const d = run(group('and', rule('disciplineStatus', 'eq', 'CLEAR')), [person({ disciplineStatus: 'SP2' })])[0]!;
    assert.equal(d.qualified, false);
    assert.deepEqual(d.failedRules.map((f) => f.label), ['disciplineStatus']);
  });

  test('TC-FLT-03 an ADVISORY rule never disqualifies; it is reported as a flag', () => {
    const tree = group('and', rule('mcuStatus', 'in', ['fit', 'fit_with_note'], { severity: 'advisory' }));
    const d = run(tree, [person({ mcuStatus: 'unfit' })])[0]!;
    assert.equal(d.qualified, true);
    assert.deepEqual(d.flaggedRules.map((f) => f.label), ['mcuStatus']);
  });

  test('TC-FLT-04 advisory is STRIPPED from an OR group, not evaluated as true', () => {
    // If advisory evaluated as `true`, the OR would always pass and the HAV
    // alternative would be disabled for everyone.
    const tree = group('and', group('or', rule('mcuStatus', 'eq', 'fit', { severity: 'advisory' }), rule('havQuadrant', 'in', ['1', '2'])));
    const d = run(tree, [person({ havQuadrant: '9' })])[0]!;
    assert.equal(d.qualified, false);
  });

  test('TC-FLT-05 a group emptied by stripping is vacuously satisfied (and/or alike)', () => {
    for (const op of ['and', 'or'] as const) {
      const tree = group('and', group(op, rule('mcuStatus', 'eq', 'fit', { severity: 'advisory' })));
      assert.equal(run(tree, [person({ mcuStatus: 'unfit' })])[0]!.qualified, true, op);
    }
  });

  test('TC-FLT-06 HAV rule values stored as NUMBERS still match string quadrants', () => {
    const tree = group('and', rule('havQuadrant', 'in', [1, 2, 3, 4, 7]));
    assert.equal(run(tree, [person({ havQuadrant: 'Kuadran #3' })])[0]!.qualified, true);
    assert.equal(run(tree, [person({ havQuadrant: '9' })])[0]!.qualified, false);
  });

  test("TC-FLT-07 PA 'in' is existential, 'notIn' is universal", () => {
    const anyAB = group('and', rule('performanceGrade', 'in', ['A', 'B']));
    const noDE = group('and', rule('performanceGrade', 'notIn', ['D', 'E']));
    const mixed = person({ performanceGrade: 'A,A,A,A,D,E' });
    assert.equal(run(anyAB, [mixed])[0]!.qualified, true);
    assert.equal(run(noDE, [mixed])[0]!.qualified, false);
  });

  test("TC-FLT-08 missing data: 'evaluate' rejects and marks dataMissing; 'pass' lets it through", () => {
    const tree = group('and', rule('behaviorRecommendation', 'in', ['HIGH', 'VERY HIGH']));
    const blank = person({ behaviorRecommendation: null });
    const strict = run(tree, [blank])[0]!;
    assert.equal(strict.qualified, false);
    assert.equal(strict.failedRules[0]!.dataMissing, true);
    assert.equal(run(tree, [blank], { missing: 'pass' })[0]!.qualified, true);
  });

  test('TC-FLT-09 empty PA under the program policy reads as a single C', () => {
    const tree = group('and', rule('performanceGrade', 'in', ['A', 'B', 'C']));
    assert.equal(run(tree, [person({ performanceGrade: null })])[0]!.qualified, true);
  });

  test('TC-FLT-10 numeric operators require numbers on both sides', () => {
    const tree = group('and', rule('yearsExperience', 'gte', 5));
    assert.equal(run(tree, [person({ yearsExperience: 5 })])[0]!.qualified, true);
    assert.equal(run(tree, [person({ yearsExperience: 4.9 })])[0]!.qualified, false);
    assert.equal(run(tree, [person({ yearsExperience: null })])[0]!.qualified, false);
  });

  test('TC-FLT-11 string comparison is case-SENSITIVE by design (no silent widening)', () => {
    const tree = group('and', rule('disciplineStatus', 'eq', 'CLEAR'));
    assert.equal(run(tree, [person({ disciplineStatus: 'clear' })])[0]!.qualified, false);
  });

  test('TC-FLT-12 a failing OR lists every alternative so the reason is complete', () => {
    const tree = group('and', group('or', rule('havQuadrant', 'eq', '1'), rule('behaviorRecommendation', 'eq', 'VERY HIGH')));
    const d = run(tree, [person()])[0]!;
    assert.deepEqual(d.failedRules.map((f) => f.label).sort(), ['behaviorRecommendation', 'havQuadrant']);
  });

  test('TC-FLT-13 hard failure and advisory flag can coexist on one candidate', () => {
    const tree = group('and', rule('disciplineStatus', 'eq', 'CLEAR'), rule('mcuStatus', 'eq', 'fit', { severity: 'advisory' }));
    const d = run(tree, [person({ disciplineStatus: 'SP1', mcuStatus: 'unfit' })])[0]!;
    assert.equal(d.qualified, false);
    assert.equal(d.flaggedRules.length, 1);
  });
});

describe('TC-FLT-SYS  shipped system programs', () => {
  test('TC-FLT-SYS-01 every system program keeps MCU as an ADVISORY rule (never a knockout)', () => {
    for (const t of systemProgramTemplates) {
      const mcu = t.filterRules.filter((r) => r.field === 'mcuStatus');
      for (const r of mcu) assert.equal(r.severity, 'advisory', `${t.code}`);
    }
  });

  test('TC-FLT-SYS-02 system criteria carry no weight (AHP is the only weighting surface)', () => {
    for (const t of systemProgramTemplates) {
      for (const c of t.defaultCriteria) assert.equal((c as { weight?: number }).weight, undefined, `${t.code}/${c.name}`);
    }
  });
});
