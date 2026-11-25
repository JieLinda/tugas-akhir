/**
 * Verifies the CRUD of program filter rules ("aturan filter") through the REAL
 * server actions, against the real database, and that what is saved is what
 * decides the Talent Pool and the Talent Mapping population.
 *
 *   npx tsx scripts/verify-filter-rules-crud.ts            # Mulia
 *   npx tsx scripts/verify-filter-rules-crud.ts --tenant <uuid>
 *
 * Tata Kelola (lib/program-actions.ts):
 *   • create a program with a nested AND/OR tree → read back identical;
 *   • update it (operator change, a new nested group, a switched-off rule) → read back identical;
 *   • a legacy flat list saved through the action is stored as the canonical {tree};
 *   • an invalid tree (≥ on Status Disiplin, an empty `in`) is REFUSED on create
 *     and on update, and the stored tree does not move;
 *   • delete removes it; deleting a system template is refused.
 * Talent Pool page (lib/talent-pool-actions.ts):
 *   • preview of an edited discipline rule = an independent recompute over the
 *     live candidates, for both the pool and the map population;
 *   • an invalid save is refused with ok:false and writes nothing;
 *   • a valid save returns exactly what the preview showed (one code path);
 *   • switching the discipline rule OFF opens the map to every live candidate;
 *   • for every cut-off of the discipline order, the map holds exactly the
 *     people at or below it.
 *
 * WRITES, then puts back: the created program is deleted and the Talent Pool
 * program's filter_rules and updated_at are restored byte for byte. Audit rows
 * are captured in memory (logAudit is stubbed), so the trail holds no test
 * events. RBAC, the tenant cookie, auth and next/cache are stubbed exactly as
 * scripts/verify-talent-mapping.ts does.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const req = createRequire(import.meta.url);
const tenantArg = process.argv.indexOf('--tenant');
let currentTenant = tenantArg > 0 ? process.argv[tenantArg + 1]! : '10000000-0000-0000-0000-000000000001';
const SYSTEM = { email: 'system@pulse.local', name: 'System User' };
const audits: { action: string; summary: string }[] = [];

function stub(spec: string, exports: Record<string, unknown>) {
  const resolved = req.resolve(spec);
  const real = (() => {
    try {
      return req(resolved);
    } catch {
      return {};
    }
  })();
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ...real, ...exports } } as never;
}

let failures = 0;
function check(ok: boolean, label: string, detail?: unknown) {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
}
async function refused(fn: () => Promise<unknown>, re: RegExp): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (err) {
    return re.test(String(err instanceof Error ? err.message : err));
  }
}
const equal = (a: unknown, b: unknown) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

async function main() {
  try {
    req.cache[req.resolve('server-only')] = { exports: {} } as never;
  } catch {
    /* not installed */
  }
  stub('../lib/rbac.ts', {
    requirePermission: async () => {},
    requirePagePermission: async () => {},
    hasPermission: async () => true,
    getCurrentUserAccess: async () => ({ isAdmin: true, permissions: new Set(), isPending: false }),
  });
  stub('../lib/tenant.ts', {
    getCurrentTenantId: async () => currentTenant,
    getCurrentTenant: async () => ({ id: currentTenant, slug: 'verify', name: 'verify' }),
  });
  stub('../lib/auth.ts', { getCurrentUser: async () => SYSTEM });
  stub('../lib/audit.ts', {
    logAudit: async (e: { action: string; summary: string }) => {
      audits.push({ action: e.action, summary: e.summary });
    },
  });
  stub('next/cache', { revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f });

  const { db } = await import('../lib/db');
  const { sql } = await import('drizzle-orm');
  const programActions = await import('../lib/program-actions');
  const talentActions = await import('../lib/talent-pool-actions');
  const { getProgramTemplate, listProgramTemplates, loadFilterableCandidates, applyProgramFilters } = await import('../lib/programs');
  const { getTalentPoolData } = await import('../lib/talent-pool-data');
  const { normalizeFilterTree, talentMappingGateTree } = await import('../lib/filter-rules');
  const { DISCIPLINE_LEVELS } = await import('../lib/discipline');
  const rows = async <T,>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;

  const r = (field: string, operator: string, value: unknown, extra: Record<string, unknown> = {}) => ({
    kind: 'rule' as const,
    rule: { field, operator, value, label: `verify ${field}`, message: `${field} gagal`, ...extra },
  });
  const g = (op: 'and' | 'or', ...children: unknown[]) => ({ kind: 'group' as const, op, children });
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  // ── Tata Kelola: program CRUD ─────────────────────────────────────────
  console.log(`\n[Tata Kelola] program CRUD, tenant ${currentTenant}`);
  const code = `verify-crud-${Date.now()}`;
  let createdId: string | null = null;
  const talentTpl = (await listProgramTemplates(currentTenant)).find((t) => t.code === 'talent');
  if (!talentTpl) throw new Error('Talent Pool program not found for this tenant');
  const [original] = await rows<{ filter_rules: unknown; updated_at: string }>(
    sql`SELECT filter_rules, updated_at::text FROM program_templates WHERE id = ${talentTpl.id}::uuid`,
  );

  try {
    const tree1 = g(
      'and',
      r('disciplineStatus', 'in', ['CLEAR', 'ST', 'SP_OVER_2_YEARS']),
      g('or', r('havQuadrant', 'in', ['1', '2']), g('and', r('havQuadrant', 'in', ['7']), r('yearsExperience', 'gte', 5))),
    );
    check(
      await refused(
        () => programActions.createProgramTemplateAction(form({ code: `${code}-bad`, name: 'verify bad', filterRules: JSON.stringify(g('and', r('disciplineStatus', 'in', []))) })),
        /belum ada nilai/,
      ),
      'create with an empty `in` list is refused',
    );
    const [badRow] = await rows<{ n: number }>(sql`SELECT count(*)::int AS n FROM program_templates WHERE code = ${`${code}-bad`}`);
    check(badRow!.n === 0, '…and nothing was inserted');

    createdId = (await programActions.createProgramTemplateAction(
      form({ code, name: 'verify CRUD', filterRules: JSON.stringify(tree1) }),
    )) as string;
    const created = await getProgramTemplate(createdId);
    check(!!created && equal(created.filterTree, tree1), 'create: nested AND/OR tree reads back identical', created?.filterTree);

    const tree2 = g(
      'or',
      r('disciplineStatus', 'notIn', ['ACTIVE_SP', 'SP3', 'SP_FIRST_LAST']),
      g('and', r('havQuadrant', 'notIn', ['16']), r('yearsExperience', 'lt', 3, { enabled: false })),
    );
    await programActions.updateProgramTemplateAction(form({ id: createdId, filterRules: JSON.stringify(tree2) }));
    check(equal((await getProgramTemplate(createdId))?.filterTree, tree2), 'update: operator change, new group and a switched-off rule read back identical');

    check(
      await refused(
        () => programActions.updateProgramTemplateAction(form({ id: createdId!, filterRules: JSON.stringify(g('and', r('disciplineStatus', 'gte', 2))) })),
        /operator "gte" tidak berlaku/,
      ),
      'update with ≥ on Status Disiplin is refused',
    );
    check(equal((await getProgramTemplate(createdId))?.filterTree, tree2), '…and the stored tree did not move');

    const legacy = [
      { field: 'disciplineStatus', operator: 'in', value: ['CLEAR'], label: 'D', message: 'm' },
      { field: 'mcuStatus', operator: 'in', value: ['fit'], label: 'M', message: 'm', severity: 'advisory' },
    ];
    await programActions.updateProgramTemplateAction(form({ id: createdId, filterRules: JSON.stringify(legacy) }));
    const [stored] = await rows<{ filter_rules: { tree?: unknown } }>(sql`SELECT filter_rules FROM program_templates WHERE id = ${createdId}::uuid`);
    check(
      equal(stored!.filter_rules, { tree: { kind: 'group', op: 'and', children: legacy.map((rule) => ({ kind: 'rule', rule })) } }),
      'a legacy flat list is stored as the canonical {tree}',
      stored!.filter_rules,
    );

    // The stored program decides: its verdict equals a plain recompute of its one deciding rule.
    const live = await loadFilterableCandidates(currentTenant);
    const tpl = (await getProgramTemplate(createdId))!;
    const engine = applyProgramFilters(tpl, live).filter((d) => d.qualified).length;
    const plain = live.filter((c) => c.disciplineStatus === 'CLEAR').length;
    check(engine === plain, `stored program decides: ${engine} qualify = ${plain} with discipline CLEAR (MCU only flags)`);

    check(
      await refused(() => programActions.deleteProgramTemplateAction(form({ id: talentTpl.id })), /sistem tidak dapat dihapus/),
      'deleting a system template is refused',
    );
    await programActions.deleteProgramTemplateAction(form({ id: createdId }));
    check((await getProgramTemplate(createdId)) == null, 'delete removes the program');
    createdId = null;

    // ── Talent Pool page ─────────────────────────────────────────────────
    console.log('\n[Talent Pool] preview / save / switch off');
    const baseTree = normalizeFilterTree(original!.filter_rules);
    const replaceDiscipline = (node: any, values: string[] | null, enabled = true): any =>
      node.kind === 'rule'
        ? node.rule.field === 'disciplineStatus'
          ? { kind: 'rule', rule: { ...node.rule, ...(values ? { value: values } : {}), ...(enabled ? {} : { enabled: false }) } }
          : node
        : { ...node, children: node.children.map((c: any) => replaceDiscipline(c, values, enabled)) };
    const hasDiscipline = JSON.stringify(baseTree).includes('disciplineStatus');
    check(hasDiscipline, 'the Talent Pool program has a discipline rule');

    const recompute = (tree: any) => {
      const pool = applyProgramFilters({ filterTree: tree }, live).filter((d) => d.qualified).length;
      const map = applyProgramFilters({ filterTree: talentMappingGateTree(tree) }, live).filter((d) => d.qualified).length;
      return { pool, map };
    };

    const tight = replaceDiscipline(baseTree, ['CLEAR']);
    const preview = await talentActions.previewTalentPoolFilterAction(tight);
    const expect = recompute(tight);
    check(
      preview.qualified.length === expect.pool && preview.mappingPopulation === expect.map,
      `preview = recompute (pool ${preview.qualified.length}, map ${preview.mappingPopulation})`,
      { preview: [preview.qualified.length, preview.mappingPopulation], expect },
    );
    check(preview.mappingPopulation === live.filter((c) => c.disciplineStatus === 'CLEAR').length, 'map population under [CLEAR] = people whose status is CLEAR');

    const bad = await talentActions.updateTalentPoolFilterAction({ filterTree: replaceDiscipline(baseTree, []) });
    const [afterBad] = await rows<{ filter_rules: unknown }>(sql`SELECT filter_rules FROM program_templates WHERE id = ${talentTpl.id}::uuid`);
    check(!bad.ok && /belum ada nilai/.test(bad.message) && equal(afterBad!.filter_rules, original!.filter_rules), 'invalid Talent Pool save → ok:false, nothing written', bad.message);

    const saved = await talentActions.updateTalentPoolFilterAction({ filterTree: tight });
    check(
      saved.ok && saved.data!.qualified.length === preview.qualified.length && saved.data!.mappingPopulation === preview.mappingPopulation,
      'valid save returns exactly what the preview showed',
    );
    const fresh = await getTalentPoolData();
    check(equal(fresh.program!.filterTree, tight), 'the saved tree is what the page now reads');

    const off = await talentActions.previewTalentPoolFilterAction(replaceDiscipline(baseTree, null, false));
    check(off.mappingPopulation === live.length, `discipline rule OFF → the map holds every live candidate (${off.mappingPopulation}/${live.length})`);

    // Every cut-off of the HR order.
    const order = DISCIPLINE_LEVELS.filter((l) => !l.legacy);
    let cutsOk = true;
    for (let k = 1; k <= order.length; k++) {
      const allowed = order.slice(0, k).map((l) => l.value as string);
      const p = await talentActions.previewTalentPoolFilterAction(replaceDiscipline(baseTree, allowed));
      const want = live.filter((c) => allowed.includes(String(c.disciplineStatus))).length;
      if (p.mappingPopulation !== want) {
        cutsOk = false;
        console.log(`        cut ${k}: map ${p.mappingPopulation} ≠ ${want}`);
      }
    }
    check(cutsOk, `for every cut-off of the ${order.length} discipline levels, the map = the people at or below it`);

    check(audits.filter((a) => a.action !== 'read').length === 5, `one audit entry per successful write (5), none for refusals`, audits);
  } finally {
    if (createdId) await db.execute(sql`DELETE FROM program_templates WHERE id = ${createdId}::uuid`);
    await db.execute(sql`
      UPDATE program_templates
         SET filter_rules = ${JSON.stringify(original!.filter_rules)}::jsonb,
             updated_at = ${original!.updated_at}::timestamp
       WHERE id = ${talentTpl.id}::uuid`);
    const [back] = await rows<{ filter_rules: unknown; updated_at: string }>(
      sql`SELECT filter_rules, updated_at::text FROM program_templates WHERE id = ${talentTpl.id}::uuid`,
    );
    check(equal(back!.filter_rules, original!.filter_rules) && back!.updated_at === original!.updated_at, 'restored: Talent Pool rules and updated_at as before');
  }

  console.log(failures === 0 ? '\nPASS' : `\nFAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
