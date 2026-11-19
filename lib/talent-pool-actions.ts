'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { FilterConditionGroup } from '@/lib/db/schema';
import {
  countDisabledFilterRules,
  countEnabledFilterRules,
  normalizeFilterTree,
  toFilterTreeSet,
} from '@/lib/filter-rules';
import { isPositionProgram, listProgramTemplates } from '@/lib/programs';
import { systemProgramTemplates } from '@/lib/program-defaults';
import { hasPermission, requirePermission } from '@/lib/rbac';
import { ensureLocalUser } from '@/lib/pulse-data';
import { logAudit } from '@/lib/audit';
import { getCurrentTenantId } from '@/lib/tenant';
import {
  getTalentPoolData,
  TALENT_POOL_PROGRAM_CODE,
  type TalentPoolData,
} from '@/lib/talent-pool-data';
import { demoScrub } from '@/lib/demo/names';

/**
 * Editing the Talent Pool's eligibility rules from the Talent Pool page.
 *
 * The rules already had an editor — in Tata Kelola, under the program that owns
 * them — and they still do; this is the same tree, the same column, the same
 * normalisation. What it did not have was the ANSWER beside it. Deciding
 * whether "minimal 3 tahun masa kerja" is the right bar means knowing how many
 * people it removes, and that number lived on a different page, so tuning a
 * rule was: edit, save, navigate, count, navigate back. These two actions
 * collapse that loop by keeping the edit where the consequence is displayed.
 *
 * `preview` writes nothing and `save` returns the recomputed pool, so the page
 * never has to guess what the new rules did — and because both go through
 * `getTalentPoolData`, a previewed count and a saved one are produced by one
 * evaluator rather than two that could disagree.
 */

/** Resolve the Talent Pool program for the active business unit. */
async function resolveTalentTemplate(tenantId: string) {
  const templates = await listProgramTemplates(tenantId);
  return templates.find((t) => t.code === TALENT_POOL_PROGRAM_CODE) ?? null;
}

export type TalentPoolFilterSaveResult = {
  ok: boolean;
  message: string;
  /** The pool as it stands AFTER the save — null when nothing was written. */
  data: TalentPoolData | null;
};

/**
 * Evaluate the pool against rules that have NOT been saved.
 *
 * Read-only, so it is gated on `candidates.view` like the page itself: seeing
 * what a rule would do is the same class of act as seeing what it did.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function previewTalentPoolFilterAction(
  ...args: Parameters<typeof previewTalentPoolFilterActionImpl>
): ReturnType<typeof previewTalentPoolFilterActionImpl> {
  return demoScrub(await previewTalentPoolFilterActionImpl(...args));
}

async function previewTalentPoolFilterActionImpl(
  filterTree: FilterConditionGroup,
): Promise<TalentPoolData> {
  await requirePermission('candidates.view');
  return getTalentPoolData(TALENT_POOL_PROGRAM_CODE, normalizeFilterTree(filterTree));
}

/**
 * Write the rules onto the Talent Pool program and return the recomputed pool.
 *
 * `governance.manage`, not `candidates.view`: this is the same write the
 * governance program editor performs, on a template that also governs which
 * candidates a scoring run will accept, so the page it is invoked from must not
 * widen who may perform it. The page hides the editor without this permission
 * and the action refuses regardless, because a guard that lives in the UI is
 * not a guard.
 */
// Demo mode: the rules are saved as sent; the recomputed pool leaves the server with initials.
export async function updateTalentPoolFilterAction(
  ...args: Parameters<typeof updateTalentPoolFilterActionImpl>
): ReturnType<typeof updateTalentPoolFilterActionImpl> {
  return demoScrub(await updateTalentPoolFilterActionImpl(...args));
}

async function updateTalentPoolFilterActionImpl(input: {
  filterTree: FilterConditionGroup;
  /**
   * Names of the rule sets applied into this draft through "Terapkan dari
   * template program", for the audit line only. The tree itself is what is
   * saved and is validated like any other; this list decides nothing.
   */
  appliedFrom?: string[];
}): Promise<TalentPoolFilterSaveResult> {
  await requirePermission('governance.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const template = await resolveTalentTemplate(tenantId);
  if (!template) {
    return {
      ok: false,
      message: `Program dengan kode "${TALENT_POOL_PROGRAM_CODE}" tidak ditemukan pada Company ini.`,
      data: null,
    };
  }

  const tree = normalizeFilterTree(input.filterTree);
  const enabled = countEnabledFilterRules(tree);
  const disabled = countDisabledFilterRules(tree);
  const appliedFrom = Array.isArray(input.appliedFrom)
    ? [...new Set(input.appliedFrom.filter((s): s is string => typeof s === 'string'))]
        .map((s) => s.trim().slice(0, 120))
        .filter(Boolean)
        .slice(0, 10)
    : [];

  await db
    .update(schema.programTemplates)
    .set({
      // Stored in the same shape the governance editor writes, through the same
      // helper — the column is read by applyProgramFilters and by every scoring
      // run's pool build, so a second serialisation here would be a second
      // format to keep working.
      filterRules: toFilterTreeSet(tree) as unknown as object,
      // `enforceFilterRules` is deliberately NOT written. It decides whether a
      // scoring run drops a failing candidate, and `talent` is in
      // NON_POSITION_PROGRAM_CODES — no run is ever started under it, so the
      // column has no reader for this program. The Talent Pool page therefore
      // does not offer the switch, and this action must not move a value the
      // page never showed. Tata Kelola still owns it for the programs that
      // score.
      updatedAt: new Date(),
    })
    .where(eq(schema.programTemplates.id, template.id));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'program_template',
    entityId: template.id,
    action: 'update',
    summary:
      `Aturan filter Talent Pool "${template.name}" diperbarui dari halaman Talent Pool ` +
      `(${enabled} aktif${disabled > 0 ? `, ${disabled} nonaktif` : ''})` +
      (appliedFrom.length > 0 ? ` — menerapkan aturan dari: ${appliedFrom.join(', ')}` : ''),
    diff: {
      changed: ['filterRules'],
      ruleCount: enabled,
      disabledRuleCount: disabled,
      ...(appliedFrom.length > 0 ? { appliedFrom } : {}),
    },
  });

  // Every page that reads this template. Governance would otherwise keep
  // serving the rules this call just replaced, and the dashboard's Talent Pool
  // figure comes from the same evaluator. Talent Mapping takes WHO is on the map
  // from this tree's discipline rule and shows each person's verdict under the
  // full tree, so it moves with the rules too.
  revalidatePath('/talent-pool');
  revalidatePath('/talent-pool/mapping');
  revalidatePath('/governance');
  revalidatePath('/');

  return {
    ok: true,
    message:
      `Tersimpan — ${enabled} aturan filter aktif mulai sekarang` +
      (disabled > 0 ? `; ${disabled} dinonaktifkan (tetap tersimpan, tidak dinilai).` : '.'),
    data: await getTalentPoolData(),
  };
}

/**
 * One place a set of saved rules can be applied from ("Terapkan dari template
 * program"). `saved` is a program template row as it stands in this business
 * unit right now; `system_default` is the rule set a system program ships with,
 * which is what a template held before anybody edited it.
 */
export type TalentPoolRuleSource = {
  key: string;
  kind: 'saved' | 'system_default';
  code: string;
  name: string;
  /** The Talent Pool template's own saved rules — the ones in force on this page. */
  isTalentPool: boolean;
  /** Programs that score a seat; their rules also gate scoring pools. */
  isPositionProgram: boolean;
  /** ISO timestamp of the template's last save; null for system defaults. */
  updatedAt: string | null;
  tree: FilterConditionGroup;
};

/**
 * Every saved rule set the Talent Pool editor may apply from: each program
 * template in the active business unit (Talent Pool's own first), then the
 * system programs' shipped defaults.
 *
 * Read-only, but it exists only for the editor, so it carries the editor's
 * permission. Templates are read from the current tenant only — the same scope
 * every other read on this page has.
 */
export async function listTalentPoolRuleSourcesAction(): Promise<TalentPoolRuleSource[]> {
  await requirePermission('governance.manage');
  const tenantId = await getCurrentTenantId();
  const templates = await listProgramTemplates(tenantId);

  const saved: TalentPoolRuleSource[] = templates
    .map((t) => ({
      key: `saved:${t.id}`,
      kind: 'saved' as const,
      code: t.code,
      name: t.name,
      isTalentPool: t.code === TALENT_POOL_PROGRAM_CODE,
      isPositionProgram: isPositionProgram(t.code),
      updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
      tree: t.filterTree,
    }))
    .sort((a, b) => Number(b.isTalentPool) - Number(a.isTalentPool));

  const defaults: TalentPoolRuleSource[] = systemProgramTemplates.map((t) => ({
    key: `default:${t.code}`,
    kind: 'system_default' as const,
    code: t.code,
    name: t.name,
    isTalentPool: t.code === TALENT_POOL_PROGRAM_CODE,
    isPositionProgram: isPositionProgram(t.code),
    updatedAt: null,
    tree: normalizeFilterTree(t.filterRules),
  }));

  return [...saved, ...defaults];
}

/** Whether the current user may edit the rules (drives the page's editor). */
export async function canManageTalentPoolFilter(): Promise<boolean> {
  return hasPermission('governance.manage');
}
