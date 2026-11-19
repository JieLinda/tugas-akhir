// TC-TPI — "Terapkan dari template program" on the Talent Pool filter panel:
// applying rules already saved on a program template to the Talent Pool draft.
//
//   node --import tsx --test tests/talent-pool/filter-rule-import.test.ts
//
// The traps pinned here all fail silently: an import into an `or` root that
// LOOSENS the bar, a same-field import that is out-ruled by the stricter rule it
// sits beside, and a no-op import that marks the draft as edited.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyImportedRules,
  importNodeStatus,
  nodeIdentity,
} from '../../lib/filter-rule-import';
import type { FilterCondition, FilterConditionGroup, FilterRule } from '../../lib/db/schema';

const rule = (r: Partial<FilterRule> & Pick<FilterRule, 'field' | 'operator'>): FilterCondition => ({
  kind: 'rule',
  rule: { label: r.field, message: '', ...r } as FilterRule,
});
const and = (...children: FilterCondition[]): FilterConditionGroup => ({ kind: 'group', op: 'and', children });
const or = (...children: FilterCondition[]): FilterConditionGroup => ({ kind: 'group', op: 'or', children });

const discipline = rule({ field: 'disciplineStatus', operator: 'in', value: ['CLEAR', 'ST'] });
const paAB = rule({ field: 'performanceGrade', operator: 'in', value: ['A', 'B'] });
const paABC = rule({ field: 'performanceGrade', operator: 'in', value: ['A', 'B', 'C'] });
const tenure = rule({ field: 'yearsExperience', operator: 'gte', value: 5 });
const mcuAdvisory = rule({ field: 'mcuStatus', operator: 'in', value: ['fit', 'fit_with_note'], severity: 'advisory' });

describe('TC-TPI identity', () => {
  test('wording does not change identity; value order does not either', () => {
    const a = rule({ field: 'havQuadrant', operator: 'in', value: ['1', '2'], label: 'HAV', message: 'x' });
    const b = rule({ field: 'havQuadrant', operator: 'in', value: ['2', '1'], label: 'Kuadran', message: 'y' });
    assert.equal(nodeIdentity(a), nodeIdentity(b));
  });
  test('severity and on/off are part of what a rule decides', () => {
    const hard = rule({ field: 'mcuStatus', operator: 'in', value: ['fit', 'fit_with_note'] });
    assert.notEqual(nodeIdentity(hard), nodeIdentity(mcuAdvisory));
    const off = rule({ field: 'mcuStatus', operator: 'in', value: ['fit', 'fit_with_note'], enabled: false });
    assert.notEqual(nodeIdentity(hard), nodeIdentity(off));
  });
});

describe('TC-TPI status', () => {
  test('same / conflict / new', () => {
    const draft = and(discipline, paAB);
    assert.equal(importNodeStatus(draft, discipline), 'same');
    assert.equal(importNodeStatus(draft, paABC), 'conflict');
    assert.equal(importNodeStatus(draft, tenure), 'new');
  });
  test('under an or-root nothing is "same": a top-level rule there is an alternative', () => {
    assert.equal(importNodeStatus(or(discipline, paAB), discipline), 'conflict');
  });
});

describe('TC-TPI append', () => {
  test('adds new rules, skips identical ones, keeps the rest', () => {
    const res = applyImportedRules(and(discipline, paAB), [discipline, tenure], {
      mode: 'append',
      replaceSameField: true,
      sourceOp: 'and',
    });
    assert.deepEqual(res.tree, and(discipline, paAB, tenure));
    assert.equal(res.added, 1);
    assert.equal(res.skippedDuplicates, 1);
    assert.equal(res.replaced, 0);
  });

  test('replaceSameField swaps the draft rule on that field', () => {
    const res = applyImportedRules(and(discipline, paAB), [paABC], {
      mode: 'append',
      replaceSameField: true,
      sourceOp: 'and',
    });
    assert.deepEqual(res.tree, and(discipline, paABC));
    assert.equal(res.replaced, 1);
  });

  test('without replaceSameField both rules stay (AND)', () => {
    const res = applyImportedRules(and(discipline, paAB), [paABC], {
      mode: 'append',
      replaceSameField: false,
      sourceOp: 'and',
    });
    assert.deepEqual(res.tree, and(discipline, paAB, paABC));
  });

  test('a rule nested in a draft group is never removed', () => {
    const draft = and(discipline, or(paAB, tenure));
    const res = applyImportedRules(draft, [paABC], { mode: 'append', replaceSameField: true, sourceOp: 'and' });
    assert.deepEqual(res.tree, and(discipline, or(paAB, tenure), paABC));
    assert.equal(res.replaced, 0);
  });

  test('an or-root draft is wrapped, never given new alternatives', () => {
    const res = applyImportedRules(or(discipline, paAB), [tenure], {
      mode: 'append',
      replaceSameField: true,
      sourceOp: 'and',
    });
    assert.deepEqual(res.tree, and(or(discipline, paAB), tenure));
  });

  test('a no-op import returns the draft unchanged (no false "Belum disimpan")', () => {
    const draft = or(discipline, paAB);
    const res = applyImportedRules(draft, [], { mode: 'append', replaceSameField: true, sourceOp: 'and' });
    assert.deepEqual(res.tree, draft);
    const same = applyImportedRules(and(discipline, paAB), [paAB], {
      mode: 'append',
      replaceSameField: true,
      sourceOp: 'and',
    });
    assert.deepEqual(same.tree, and(discipline, paAB));
    assert.equal(same.replaced, 0);
    assert.equal(same.skippedDuplicates, 1);
  });

  test('rules are copied verbatim (advisory stays advisory) and not shared by reference', () => {
    const picked = [mcuAdvisory];
    const res = applyImportedRules(and(discipline), picked, { mode: 'append', replaceSameField: true, sourceOp: 'and' });
    const added = res.tree.children[1];
    assert.equal(added.kind === 'rule' && added.rule.severity, 'advisory');
    assert.notEqual(added, mcuAdvisory);
  });
});

describe('TC-TPI replace', () => {
  test('the draft becomes exactly the picked rules under the source operator', () => {
    const res = applyImportedRules(and(discipline, paAB), [paABC, tenure], {
      mode: 'replace',
      replaceSameField: true,
      sourceOp: 'or',
    });
    assert.deepEqual(res.tree, or(paABC, tenure));
    assert.equal(res.replaced, 2);
    assert.equal(res.added, 2);
  });
});
