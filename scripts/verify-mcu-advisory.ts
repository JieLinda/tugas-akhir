/**
 * Verify the advisory-severity filter semantics.
 *
 *   npx tsx scripts/verify-mcu-advisory.ts
 *
 * Two of these guard traps that are easy to reintroduce and that fail SILENTLY
 * — nothing throws, candidates simply appear or vanish from a pool:
 *
 *  • An advisory rule must be STRIPPED from the tree, not evaluated as `true`.
 *    A rule that always passes satisfies any `or` group it sits in, which would
 *    disable the real alternative beside it.
 *  • Stripping can empty a group, and an empty group — `and` or `or` alike —
 *    must be vacuously satisfied. If an emptied `or` returned false, a program
 *    whose MCU rule sat alone in one would disqualify every candidate.
 *
 * Makes NO queries, but `lib/programs.ts` pulls in `lib/db`, which throws at
 * module load without one — so DATABASE_URL (or POSTGRES_URL) must be set to
 * anything parseable, e.g.
 *   DATABASE_URL=postgresql://localhost/none npx tsx scripts/verify-mcu-advisory.ts
 */
import { createRequire } from 'node:module';

// lib/programs.ts imports 'server-only', which throws outside a server
// component. Same stub scripts/bench-job-profile-match.ts uses; the modules
// under test are loaded dynamically afterwards because static imports hoist.
const req = createRequire(import.meta.url);
try {
  req.cache[req.resolve('server-only')] = { exports: {} } as never;
} catch {
  /* not installed — nothing to stub */
}

let pass = 0;
let fail = 0;
function ok(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    fail++;
    console.log('  FAIL ' + name);
  }
}

async function main() {
  const { applyProgramFilters } = await import('@/lib/programs');
  const { normalizeFilterTree } = await import('@/lib/filter-rules');
  type FilterRule = import('@/lib/db/schema').FilterRule;

  const cand = (id: string, mcu: string, disc = 'CLEAR') => ({
    id,
    name: id,
    disciplineStatus: disc,
    mcuStatus: mcu,
    performanceGrade: 'A,A,A,A,A,A',
    havQuadrant: '1',
    behaviorRecommendation: 'Disarankan',
    yearsExperience: 10,
    education: 'S1',
  });

  const mcuRule = (severity?: 'hard' | 'advisory'): FilterRule => ({
    field: 'mcuStatus',
    operator: 'in',
    value: ['fit', 'fit_with_note'],
    label: 'MCU',
    message: 'Status MCU tidak Fit.',
    ...(severity ? { severity } : {}),
  });
  const discRule: FilterRule = {
    field: 'disciplineStatus',
    operator: 'in',
    value: ['CLEAR', 'ST'],
    label: 'Disiplin',
    message: 'Sanksi aktif.',
  };

  const people = [cand('fit', 'fit'), cand('unfit', 'unfit'), cand('sanctioned', 'fit', 'SP3')];

  // 1. Absent severity means 'hard' — every rule written before this existed
  //    must behave exactly as it did.
  {
    const tree = normalizeFilterTree([mcuRule(), discRule]);
    const byId = new Map(
      applyProgramFilters({ filterTree: tree }, people).map((x) => [x.candidateId, x]),
    );
    ok('absent severity still disqualifies (back-compat)', byId.get('unfit')!.qualified === false);
    ok(
      'hard MCU produces a failedRule',
      byId.get('unfit')!.failedRules.some((r) => r.field === 'mcuStatus'),
    );
    ok('hard MCU produces NO flag', byId.get('unfit')!.flaggedRules.length === 0);
  }

  // 2. Advisory: scored and ranked, but reported.
  {
    const tree = normalizeFilterTree([mcuRule('advisory'), discRule]);
    const byId = new Map(
      applyProgramFilters({ filterTree: tree }, people).map((x) => [x.candidateId, x]),
    );
    ok('advisory MCU no longer disqualifies', byId.get('unfit')!.qualified === true);
    ok(
      'advisory MCU is flagged instead',
      byId.get('unfit')!.flaggedRules.some((r) => r.field === 'mcuStatus'),
    );
    ok('advisory MCU absent from failedRules', byId.get('unfit')!.failedRules.length === 0);
    ok('fit candidate is not flagged', byId.get('fit')!.flaggedRules.length === 0);
    ok('OTHER hard rules still bite', byId.get('sanctioned')!.qualified === false);
    const both = applyProgramFilters({ filterTree: tree }, [cand('x', 'unfit', 'SP3')])[0]!;
    ok(
      'a disqualified person can still carry flags',
      both.qualified === false && both.flaggedRules.length === 1,
    );
  }

  // 3. Stripping empties a group — it must stay vacuously satisfied.
  {
    const tree = normalizeFilterTree({
      tree: {
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'rule', rule: discRule },
          { kind: 'group', op: 'or', children: [{ kind: 'rule', rule: mcuRule('advisory') }] },
        ],
      },
    });
    const byId = new Map(
      applyProgramFilters({ filterTree: tree }, people).map((x) => [x.candidateId, x]),
    );
    ok(
      'OR group emptied by stripping does NOT disqualify everyone',
      byId.get('unfit')!.qualified === true && byId.get('fit')!.qualified === true,
    );
    ok('still flagged from inside the OR group', byId.get('unfit')!.flaggedRules.length === 1);
    ok('sibling hard rule unaffected', byId.get('sanctioned')!.qualified === false);
  }

  // 4. The reason advisory rules are stripped rather than passed: "discipline OK
  //    OR MCU fit" must not become "always true" for a sanctioned person.
  {
    const tree = normalizeFilterTree({
      tree: {
        kind: 'group',
        op: 'or',
        children: [
          { kind: 'rule', rule: discRule },
          { kind: 'rule', rule: mcuRule('advisory') },
        ],
      },
    });
    const d = applyProgramFilters({ filterTree: tree }, [cand('bad', 'unfit', 'SP3')]);
    ok('advisory does not satisfy an OR for a sanctioned person', d[0]!.qualified === false);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
