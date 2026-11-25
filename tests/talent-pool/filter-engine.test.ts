// TC-FE — the filter engine end to end, as the Talent Pool, Talent Mapping and
// every scoring pool build use it: the stored-shape parser, every operator, the
// AND/OR tree against an independent oracle, switched-off and advisory rules,
// the Talent Mapping gate, the save-time validation, and the discipline levels.
//
//   node --import tsx --test tests/talent-pool/filter-engine.test.ts
//
// Pure: lib/programs.ts needs 'server-only' stubbed and a connection string to
// load, but no query is made.
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

type FilterRules = typeof import('../../lib/filter-rules');
type Programs = typeof import('../../lib/programs');
let fr: FilterRules;
let applyProgramFilters: Programs['applyProgramFilters'];
let systemProgramTemplates: (typeof import('../../lib/program-defaults'))['systemProgramTemplates'];
let discipline: typeof import('../../lib/discipline');
let FIELD_VALUE_OPTIONS: (typeof import('../../lib/candidate-field-values'))['FIELD_VALUE_OPTIONS'];
let DISCIPLINE_VALUES: (typeof import('../../lib/candidate-values'))['DISCIPLINE_VALUES'];
let disciplineLabel: (typeof import('../../lib/candidate-labels'))['disciplineLabel'];

before(async () => {
  fr = await import('../../lib/filter-rules');
  ({ applyProgramFilters } = await import('../../lib/programs'));
  ({ systemProgramTemplates } = await import('../../lib/program-defaults'));
  discipline = await import('../../lib/discipline');
  ({ FIELD_VALUE_OPTIONS } = await import('../../lib/candidate-field-values'));
  ({ DISCIPLINE_VALUES } = await import('../../lib/candidate-values'));
  ({ disciplineLabel } = await import('../../lib/candidate-labels'));
});

// ── builders ────────────────────────────────────────────────────────────────
type Cand = {
  id: string;
  name: string;
  disciplineStatus: string | null;
  mcuStatus: string | null;
  performanceGrade: string | null;
  havQuadrant: string | null;
  behaviorRecommendation: string | null;
  yearsExperience: number | null;
  education: string | null;
};
const person = (over: Partial<Cand> = {}): Cand => ({
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
const verdict = (tree: any, c: Cand) => applyProgramFilters({ filterTree: tree } as any, [c as any])[0]!;
const passes = (tree: any, c: Cand) => verdict(tree, c).qualified;

// ── 1. stored shapes ───────────────────────────────────────────────────────
describe('TC-FE-PARSE  normalizeFilterTree', () => {
  test('01 canonical {tree}, a bare group, a legacy AND list and legacy {groups} all become one root group', () => {
    const r = { field: 'disciplineStatus', operator: 'in', value: ['CLEAR'], label: 'D', message: 'm' };
    const r2 = { field: 'havQuadrant', operator: 'in', value: ['1'], label: 'H', message: 'm' };
    const canonical = fr.normalizeFilterTree({ tree: group('and', { kind: 'rule', rule: r }) });
    assert.deepEqual(canonical, group('and', { kind: 'rule', rule: r }));
    assert.deepEqual(fr.normalizeFilterTree(group('or', { kind: 'rule', rule: r })), group('or', { kind: 'rule', rule: r }));
    assert.deepEqual(fr.normalizeFilterTree([r, r2]), group('and', { kind: 'rule', rule: r }, { kind: 'rule', rule: r2 }));
    // {groups}: AND of (OR of each group's rules); a one-rule group is the rule itself.
    assert.deepEqual(
      fr.normalizeFilterTree({ groups: [{ rules: [r] }, { rules: [r, r2] }, { rules: [] }] }),
      group('and', { kind: 'rule', rule: r }, group('or', { kind: 'rule', rule: r }, { kind: 'rule', rule: r2 })),
    );
  });

  test('02 garbage reads as an EMPTY tree (admits everyone) rather than throwing', () => {
    for (const raw of [null, undefined, 42, 'x', {}, { tree: null }, { kind: 'group', op: 'xor', children: 'no' }]) {
      const t = fr.normalizeFilterTree(raw);
      assert.equal(t.kind, 'group');
      assert.equal(t.children.length, 0, JSON.stringify(raw));
    }
  });

  test('03 an unknown group operator reads as AND, junk children are dropped, a bare rule child is accepted', () => {
    const t = fr.normalizeFilterTree({
      kind: 'group',
      op: 'xor',
      children: [null, 5, { field: 'mcuStatus', operator: 'eq', value: 'fit' }, { kind: 'rule' }],
    });
    assert.equal(t.op, 'and');
    assert.equal(t.children.length, 1);
    assert.equal((t.children[0] as any).rule.field, 'mcuStatus');
  });

  test('04 save → read round-trips exactly (toFilterTreeSet ∘ normalizeFilterTree is the identity)', () => {
    const t = group('and', rule('disciplineStatus', 'in', ['CLEAR', 'ST']), group('or', rule('havQuadrant', 'in', ['1']), group('and')));
    assert.deepEqual(fr.normalizeFilterTree(JSON.parse(JSON.stringify(fr.toFilterTreeSet(t as any)))), t);
  });

  test('05 every system program default parses, and counts agree', () => {
    for (const tpl of systemProgramTemplates) {
      const t = fr.normalizeFilterTree(tpl.filterRules);
      assert.equal(fr.countFilterRules(t), tpl.filterRules.length, tpl.code);
      assert.equal(fr.countEnabledFilterRules(t) + fr.countDisabledFilterRules(t), fr.countFilterRules(t));
    }
  });
});

// ── 2. operators ───────────────────────────────────────────────────────────
describe('TC-FE-OP  operators', () => {
  test('01 eq / neq / in / notIn on a text field', () => {
    const c = person({ disciplineStatus: 'ST' });
    assert.equal(passes(group('and', rule('disciplineStatus', 'eq', 'ST')), c), true);
    assert.equal(passes(group('and', rule('disciplineStatus', 'eq', 'CLEAR')), c), false);
    assert.equal(passes(group('and', rule('disciplineStatus', 'neq', 'CLEAR')), c), true);
    assert.equal(passes(group('and', rule('disciplineStatus', 'in', ['CLEAR', 'ST'])), c), true);
    assert.equal(passes(group('and', rule('disciplineStatus', 'notIn', ['CLEAR', 'ST'])), c), false);
  });

  test('02 HAV compares "1" and 1 alike (governance writes numbers, the seed strings)', () => {
    const c = person({ havQuadrant: 'Kuadran #7' });
    assert.equal(passes(group('and', rule('havQuadrant', 'in', [1, 7])), c), true);
    assert.equal(passes(group('and', rule('havQuadrant', 'in', ['7'])), c), true);
    assert.equal(passes(group('and', rule('havQuadrant', 'notIn', [7])), c), false);
  });

  test('03 numeric operators on Masa Kerja, boundaries included', () => {
    const c = person({ yearsExperience: 5 });
    assert.equal(passes(group('and', rule('yearsExperience', 'gte', 5)), c), true);
    assert.equal(passes(group('and', rule('yearsExperience', 'gt', 5)), c), false);
    assert.equal(passes(group('and', rule('yearsExperience', 'lte', 5)), c), true);
    assert.equal(passes(group('and', rule('yearsExperience', 'lt', 5)), c), false);
    assert.equal(passes(group('and', rule('yearsExperience', 'in', [3, 5])), c), true);
  });

  test('04 PA is a WINDOW: in = some period, notIn = no period', () => {
    const c = person({ performanceGrade: 'A,A,B,B,D,' });
    assert.equal(passes(group('and', rule('performanceGrade', 'in', ['A'])), c), true);
    assert.equal(passes(group('and', rule('performanceGrade', 'notIn', ['D', 'E'])), c), false);
    assert.equal(passes(group('and', rule('performanceGrade', 'neq', 'C')), c), true);
  });

  test('05 missing data fails a positive rule and is reported as missing, not as a verdict', () => {
    const d = verdict(group('and', rule('havQuadrant', 'in', ['1'])), person({ havQuadrant: null }));
    assert.equal(d.qualified, false);
    assert.equal(d.failedRules[0]!.dataMissing, true);
  });

  test('06 case is NOT folded (why discipline values are stored upper-case)', () => {
    assert.equal(passes(group('and', rule('disciplineStatus', 'in', ['CLEAR'])), person({ disciplineStatus: 'clear' })), false);
    assert.equal(discipline.canonicalDisciplineStatus(' clear '), 'CLEAR');
  });
});

// ── 3. the tree, against an oracle ─────────────────────────────────────────
// An independent evaluator (allowed: an oracle in a test). Rules are drawn so
// each is either clearly true or clearly false for a candidate.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DISC = ['CLEAR', 'ST', 'SP_OVER_2_YEARS', 'SP_UNDER_2_YEARS', 'ACTIVE_SP', 'SP3'];
const HAV = ['1', '2', '5', '7', '9', '16'];
function oracleRule(r: any, c: Cand): boolean {
  const v = r.field === 'disciplineStatus' ? c.disciplineStatus : r.field === 'havQuadrant' ? c.havQuadrant : c.yearsExperience;
  switch (r.operator) {
    case 'in': return (r.value as unknown[]).map(String).includes(String(v));
    case 'notIn': return !(r.value as unknown[]).map(String).includes(String(v));
    case 'eq': return String(v) === String(r.value);
    case 'neq': return String(v) !== String(r.value);
    case 'gte': return (v as number) >= r.value;
    case 'lt': return (v as number) < r.value;
  }
  throw new Error(r.operator);
}
function oracle(node: any, c: Cand): boolean {
  if (node.kind === 'rule') return oracleRule(node.rule, c);
  const kids = node.children.filter((k: any) => k.kind === 'group' || (k.rule.enabled !== false && k.rule.severity !== 'advisory'));
  if (kids.length === 0) return true;
  return node.op === 'and' ? kids.every((k: any) => oracle(k, c)) : kids.some((k: any) => oracle(k, c));
}
function randomTree(rnd: () => number, depth = 0): any {
  const n = 1 + Math.floor(rnd() * 3);
  const children: any[] = [];
  for (let i = 0; i < n; i++) {
    if (depth < 3 && rnd() < 0.35) {
      children.push(randomTree(rnd, depth + 1));
      continue;
    }
    const pick = Math.floor(rnd() * 3);
    const extra: Record<string, unknown> = {};
    if (rnd() < 0.12) extra.enabled = false;
    if (rnd() < 0.1) extra.severity = 'advisory';
    if (pick === 0) {
      const ops = ['in', 'notIn', 'eq', 'neq'];
      const op = ops[Math.floor(rnd() * 4)]!;
      const val = op === 'in' || op === 'notIn' ? DISC.filter(() => rnd() < 0.5) : DISC[Math.floor(rnd() * DISC.length)];
      children.push(rule('disciplineStatus', op, Array.isArray(val) && val.length === 0 ? ['CLEAR'] : val, extra));
    } else if (pick === 1) {
      const vals = HAV.filter(() => rnd() < 0.5);
      children.push(rule('havQuadrant', rnd() < 0.5 ? 'in' : 'notIn', vals.length ? vals : ['1'], extra));
    } else {
      children.push(rule('yearsExperience', rnd() < 0.5 ? 'gte' : 'lt', Math.floor(rnd() * 12), extra));
    }
  }
  return group(rnd() < 0.5 ? 'and' : 'or', ...children);
}
function randomCand(rnd: () => number, i: number): Cand {
  return person({
    id: `c${i}`,
    disciplineStatus: DISC[Math.floor(rnd() * DISC.length)]!,
    havQuadrant: HAV[Math.floor(rnd() * HAV.length)]!,
    yearsExperience: Math.floor(rnd() * 15),
  });
}

describe('TC-FE-TREE  AND / OR evaluation', () => {
  test('01 a hand-written nested tree: A AND (B OR (C AND D))', () => {
    const tree = group(
      'and',
      rule('disciplineStatus', 'in', ['CLEAR', 'ST']),
      group('or', rule('havQuadrant', 'in', ['1', '2']), group('and', rule('havQuadrant', 'in', ['7']), rule('yearsExperience', 'gte', 5))),
    );
    assert.equal(passes(tree, person({ havQuadrant: '1', yearsExperience: 0 })), true);
    assert.equal(passes(tree, person({ havQuadrant: '7', yearsExperience: 5 })), true);
    assert.equal(passes(tree, person({ havQuadrant: '7', yearsExperience: 4 })), false);
    assert.equal(passes(tree, person({ havQuadrant: '1', disciplineStatus: 'SP3' })), false);
  });

  test('02 600 random trees × 40 candidates agree with the oracle (incl. off and advisory rules)', () => {
    const rnd = mulberry32(20261125);
    let checked = 0;
    for (let t = 0; t < 600; t++) {
      const tree = randomTree(rnd);
      const cands = Array.from({ length: 40 }, (_, i) => randomCand(rnd, i));
      const decisions = applyProgramFilters({ filterTree: tree } as any, cands as any);
      decisions.forEach((d, i) => {
        assert.equal(d.qualified, oracle(tree, cands[i]!), JSON.stringify({ tree, cand: cands[i] }));
        checked++;
      });
    }
    assert.equal(checked, 24_000);
  });

  test('03 every reason given for a rejection is a rule the candidate really fails, and a pass has none', () => {
    const rnd = mulberry32(7);
    for (let t = 0; t < 300; t++) {
      const tree = randomTree(rnd);
      const cands = Array.from({ length: 20 }, (_, i) => randomCand(rnd, i));
      const decisions = applyProgramFilters({ filterTree: tree } as any, cands as any);
      const leaves = fr.flattenFilterTree(fr.decidingFilterTree(tree as any));
      decisions.forEach((d, i) => {
        if (d.qualified) return assert.equal(d.failedRules.length, 0);
        assert.ok(d.failedRules.length > 0, 'a rejection names at least one rule');
        for (const f of d.failedRules) {
          const failing = leaves.filter((r) => r.label === f.label && !oracleRule(r, cands[i]!));
          assert.ok(failing.length > 0, `reason "${f.label}" is a failing rule`);
        }
      });
    }
  });

  test('04 an advisory rule flags but never rejects; a switched-off rule does neither', () => {
    const adv = verdict(group('and', rule('disciplineStatus', 'in', ['CLEAR'], { severity: 'advisory' })), person({ disciplineStatus: 'SP3' }));
    assert.equal(adv.qualified, true);
    assert.equal(adv.flaggedRules.length, 1);
    const off = verdict(group('and', rule('disciplineStatus', 'in', ['CLEAR'], { enabled: false })), person({ disciplineStatus: 'SP3' }));
    assert.equal(off.qualified, true);
    assert.equal(off.flaggedRules.length, 0);
  });

  test('05 a switched-off rule inside an OR does not open the OR for everybody', () => {
    const tree = group('and', group('or', rule('disciplineStatus', 'eq', 'SP3', { enabled: false }), rule('havQuadrant', 'in', ['1'])));
    assert.equal(passes(tree, person({ havQuadrant: '9' })), false);
    assert.equal(passes(tree, person({ havQuadrant: '1' })), true);
  });
});

// ── 4. Talent Mapping gate ─────────────────────────────────────────────────
describe('TC-FE-GATE  talentMappingGateTree', () => {
  test('01 keeps only the discipline rules; the map is a SUPERSET of the pool for 500 random trees', () => {
    const rnd = mulberry32(99);
    for (let t = 0; t < 500; t++) {
      const tree = randomTree(rnd) as any;
      const gate = fr.talentMappingGateTree(tree);
      assert.ok(fr.flattenFilterTree(gate).every((r) => r.field === 'disciplineStatus'));
      for (let i = 0; i < 20; i++) {
        const c = randomCand(rnd, i);
        if (passes(tree, c)) assert.equal(passes(gate, c), true, 'pool ⊆ map');
      }
    }
  });

  test('02 switching the discipline rule off opens the map to everyone', () => {
    const tree = group('and', rule('disciplineStatus', 'in', ['CLEAR'], { enabled: false }), rule('havQuadrant', 'in', ['1']));
    assert.equal(passes(fr.talentMappingGateTree(tree as any), person({ disciplineStatus: 'SP3', havQuadrant: '9' })), true);
  });
});

// ── 5. what a rule may say ─────────────────────────────────────────────────
describe('TC-FE-VALID  validateFilterTree / operatorsForField', () => {
  test('01 every system default and every rule the editor can build is valid', () => {
    for (const tpl of systemProgramTemplates) {
      assert.deepEqual(fr.validateFilterTree(fr.normalizeFilterTree(tpl.filterRules)), [], tpl.code);
    }
  });

  test('02 numeric and date operators are offered only where they can be true', () => {
    assert.ok(fr.operatorsForField('yearsExperience').includes('gte'));
    for (const f of ['disciplineStatus', 'mcuStatus', 'havQuadrant', 'behaviorRecommendation', 'education', 'performanceGrade'] as const) {
      for (const op of ['gte', 'lte', 'gt', 'lt', 'isExpired', 'notExpired'] as const) {
        assert.equal(fr.operatorsForField(f).includes(op), false, `${f} ${op}`);
      }
    }
    // …and the refusal is real: such a rule rejects everybody.
    assert.equal(passes(group('and', rule('disciplineStatus', 'gte', 1)), person()), false);
    assert.equal(passes(group('and', rule('havQuadrant', 'notExpired', undefined)), person()), false);
  });

  test('03 each silent-failure shape is refused with a reason', () => {
    const cases: [any, RegExp][] = [
      [rule('disciplineStatus', 'gte', 2), /operator "gte" tidak berlaku/],
      [rule('mcuStatus', 'isExpired', undefined), /operator "isExpired" tidak berlaku/],
      [rule('disciplineStatus', 'in', []), /belum ada nilai.*menggugurkan semua/],
      [rule('havQuadrant', 'notIn', []), /belum ada nilai/],
      [rule('havQuadrant', 'in', ['1', '']), /nilai kosong/],
      [rule('disciplineStatus', 'eq', '  '), /nilai belum diisi/],
      [rule('yearsExperience', 'gte', '5'), /harus berupa angka/],
      [rule('salary', 'eq', '1'), /tidak dikenal/],
      [rule('mcuStatus', 'in', ['fit'], { severity: 'soft' }), /sifat aturan/],
    ];
    for (const [r, re] of cases) {
      const problems = fr.validateFilterTree(group('and', r) as any);
      assert.equal(problems.length, 1, JSON.stringify(r.rule));
      assert.match(problems[0]!, re);
    }
  });

  test('04 findings are numbered in tree order and switched-off rules are checked too', () => {
    const problems = fr.validateFilterTree(
      group('and', rule('disciplineStatus', 'in', ['CLEAR']), group('or', rule('havQuadrant', 'in', [], { enabled: false }))) as any,
    );
    assert.equal(problems.length, 1);
    assert.match(problems[0]!, /^Aturan 2 /);
  });
});

// ── 6. discipline levels ───────────────────────────────────────────────────
describe('TC-FE-DISC  discipline levels (HR order, 2026-11-25)', () => {
  const ORDER = ['CLEAR', 'ST', 'SP_OVER_2_YEARS', 'SP_UNDER_2_YEARS', 'ACTIVE_SP', 'SP3', 'SP_FIRST_LAST'];

  test('01 one order everywhere: the levels, the stored-value list, the rule picker, the form', () => {
    const current = discipline.DISCIPLINE_LEVELS.filter((l) => !l.legacy).map((l) => l.value);
    assert.deepEqual(current, ORDER);
    assert.deepEqual([...DISCIPLINE_VALUES].slice(0, ORDER.length), ORDER);
    assert.deepEqual(FIELD_VALUE_OPTIONS.disciplineStatus!.map((o) => o.value), discipline.DISCIPLINE_LEVELS.map((l) => l.value));
    const ranks = discipline.DISCIPLINE_LEVELS.filter((l) => !l.legacy).map((l) => l.rank);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), 'ranks never decrease');
    const sorted = [...ORDER].reverse().sort(discipline.compareDisciplineStatus);
    assert.deepEqual(sorted.slice(0, 5), ORDER.slice(0, 5));
    assert.deepEqual(new Set(sorted.slice(5)), new Set(['SP3', 'SP_FIRST_LAST']), 'equally heavy');
  });

  test('02 every status has a label, case-insensitively; an unknown one shows as itself', () => {
    for (const v of ORDER) assert.ok(disciplineLabel(v) && disciplineLabel(v) !== '-', v);
    assert.equal(disciplineLabel('clear'), 'Bersih');
    assert.equal(disciplineLabel('sp_over_2_years'), 'SP1/SP2 berakhir ≥ 2 tahun');
    assert.equal(disciplineLabel('xyz'), 'XYZ');
    assert.equal(disciplineLabel(null), '-');
  });

  test('03 a rule listing the first k levels admits exactly those k (picking a cut-off)', () => {
    for (let k = 1; k <= ORDER.length; k++) {
      const tree = group('and', rule('disciplineStatus', 'in', ORDER.slice(0, k)));
      ORDER.forEach((s, i) => assert.equal(passes(tree, person({ disciplineStatus: s })), i < k, `cut ${k} status ${s}`));
    }
  });

  test('04 the default discipline rule admits CLEAR, ST and SP ended ≥ 2 years, and the map follows it', () => {
    const talent = systemProgramTemplates.find((t) => t.code === 'talent')!;
    const tree = fr.normalizeFilterTree(talent.filterRules);
    const gate = fr.talentMappingGateTree(tree);
    for (const s of ORDER) {
      const admitted = ['CLEAR', 'ST', 'SP_OVER_2_YEARS'].includes(s);
      assert.equal(passes(gate, person({ disciplineStatus: s })), admitted, s);
    }
  });
});
