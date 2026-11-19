'use server';

import { requirePermission } from '@/lib/rbac';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { AhpConfig, DefaultCriterion } from '@/lib/db/schema';
import { normalizeFilterTree, toFilterTreeSet } from '@/lib/filter-rules';
import { decideAhpSave } from '@/lib/ahp-save-rules';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { getProgramTemplate } from '@/lib/programs';

/** The finalist target N (the top-N cut of an AHP+TOPSIS ranking), clamped to 1..50. */
function parseTargetFinalists(value: FormDataEntryValue | null, fallback = 10) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.round(parsed)));
}

export async function createProgramTemplateAction(formData: FormData) {
  await requirePermission('governance.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const code = String(formData.get('code') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  if (!code || !name) throw new Error('Code dan nama program wajib diisi.');

  const description = (formData.get('description') as string | null)?.trim() || null;
  const defaultMethod = String(formData.get('defaultMethod') ?? 'SAW');
  const targetFinalists = parseTargetFinalists(formData.get('targetFinalists'), 10);
  // Default true when the field is absent (new-template forms may omit it).
  const enforceFilterRulesRaw = formData.get('enforceFilterRules');
  const enforceFilterRules = enforceFilterRulesRaw === null ? true : enforceFilterRulesRaw === 'true';
  const filterRulesRaw = formData.get('filterRules') as string | null;
  const defaultCriteriaRaw = formData.get('defaultCriteria') as string | null;

  const filterTree = normalizeFilterTree(filterRulesRaw ? JSON.parse(filterRulesRaw) : null);
  const defaultCriteria: DefaultCriterion[] = defaultCriteriaRaw ? JSON.parse(defaultCriteriaRaw) : [];

  const [inserted] = await db
    .insert(schema.programTemplates)
    .values({
      tenantId,
      code,
      name,
      description,
      targetFinalists,
      filterRules: toFilterTreeSet(filterTree) as unknown as object,
      defaultCriteria: defaultCriteria as unknown as object,
      defaultMethod,
      enforceFilterRules,
      isSystem: false,
      createdBy: actorId,
    })
    .returning({ id: schema.programTemplates.id });

  await logAudit({
    tenantId,
    actorId,
    entityType: 'program_template',
    entityId: inserted!.id,
    action: 'create',
    summary: `Program template "${name}" dibuat`,
  });

  revalidatePath('/governance');
  return inserted!.id;
}

export async function saveAhpConfigAction(templateId: string, ahpConfig: AhpConfig | null) {
  await requirePermission('governance.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  if (!templateId) throw new Error('id template wajib disediakan.');

  const existing = await getProgramTemplate(templateId);
  if (!existing) throw new Error('Template tidak ditemukan.');
  if (existing.tenantId !== tenantId) throw new Error('Tidak diizinkan.');

  // The explicit AHP save always validates: on the Saaty scale, reciprocal,
  // CR ≤ 0.1 — the same validateAhpPairwise the editor's badge shows.
  const decision = decideAhpSave(ahpConfig, existing.ahpConfig, { allowUnchanged: false });
  if (decision.kind === 'reject') throw new Error(decision.message);

  await db
    .update(schema.programTemplates)
    .set({ ahpConfig: ahpConfig, updatedAt: new Date() })
    .where(eq(schema.programTemplates.id, templateId));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'program_template',
    entityId: templateId,
    action: 'update',
    summary: `Konfigurasi AHP program "${existing.name}" ${ahpConfig ? 'diperbarui' : 'dinonaktifkan'}`,
  });

  revalidatePath('/governance');
}

export async function updateProgramTemplateAction(formData: FormData) {
  await requirePermission('governance.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('id template wajib disediakan.');

  const existing = await getProgramTemplate(id);
  if (!existing) throw new Error('Template tidak ditemukan.');
  if (existing.tenantId !== tenantId) throw new Error('Tidak diizinkan.');

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const name = (formData.get('name') as string | null)?.trim();
  if (name) patch.name = name;
  const description = formData.get('description') as string | null;
  if (description !== null) patch.description = description.trim() || null;
  const defaultMethod = formData.get('defaultMethod') as string | null;
  if (defaultMethod) patch.defaultMethod = defaultMethod;
  const targetFinalistsEntry = formData.get('targetFinalists');
  if (targetFinalistsEntry !== null) patch.targetFinalists = parseTargetFinalists(targetFinalistsEntry, (existing as any).targetFinalists ?? 10);
  const enforceFilterRulesEntry = formData.get('enforceFilterRules');
  if (enforceFilterRulesEntry !== null) patch.enforceFilterRules = enforceFilterRulesEntry === 'true';
  const filterRulesRaw = formData.get('filterRules') as string | null;
  if (filterRulesRaw) {
    patch.filterRules = toFilterTreeSet(normalizeFilterTree(JSON.parse(filterRulesRaw))) as unknown as object;
  }
  const defaultCriteriaRaw = formData.get('defaultCriteria') as string | null;
  if (defaultCriteriaRaw) patch.defaultCriteria = JSON.parse(defaultCriteriaRaw) as unknown as object;
  // The program's pairwise matrix — the only weighting configuration there is.
  // Empty string clears it, which means the program falls back to the system
  // default weights (never to the criteria list, which has carried no weight
  // since drizzle/0074).
  const ahpConfigRaw = formData.get('ahpConfig') as string | null;
  if (ahpConfigRaw !== null) {
    if (!ahpConfigRaw.trim()) {
      patch.ahpConfig = null;
    } else {
      const parsed = JSON.parse(ahpConfigRaw) as AhpConfig;
      // Same validation as the AHP save, with one difference: this bar always
      // sends the matrix along with every other field, so a matrix identical to
      // the one STORED (compared here against the database, never a client
      // flag) is left untouched — a program holding an older off-scale matrix
      // can still be renamed. Changing the matrix validates it in full.
      const decision = decideAhpSave(parsed, existing.ahpConfig, { allowUnchanged: true });
      if (decision.kind === 'reject') throw new Error(decision.message);
      if (decision.kind === 'store') patch.ahpConfig = { pairwise: decision.pairwise } as unknown as object;
    }
  }

  await db.update(schema.programTemplates).set(patch).where(eq(schema.programTemplates.id, id));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'program_template',
    entityId: id,
    action: 'update',
    summary: `Program template "${existing.name}" diperbarui`,
    diff: { changed: Object.keys(patch).filter((k) => k !== 'updatedAt') },
  });

  revalidatePath('/governance');
}

export async function deleteProgramTemplateAction(formData: FormData) {
  await requirePermission('governance.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const id = String(formData.get('id') ?? '');
  if (!id) throw new Error('id template wajib disediakan.');

  const existing = await getProgramTemplate(id);
  if (!existing) return;
  if (existing.tenantId !== tenantId) throw new Error('Tidak diizinkan.');
  if (existing.isSystem) throw new Error('Template sistem tidak dapat dihapus.');

  await db.delete(schema.programTemplates).where(eq(schema.programTemplates.id, id));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'program_template',
    entityId: id,
    action: 'delete',
    summary: `Program template "${existing.name}" dihapus`,
  });

  revalidatePath('/governance');
}
