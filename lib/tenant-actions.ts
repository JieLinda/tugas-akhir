'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { vectorDb } from '@/lib/db/vector-db';
import { jobProfileEmbed } from '@/lib/db/vector-schema';
import { planTenantPurge, purgeTenant } from '@/lib/tenant-purge';
import { logAudit } from '@/lib/audit';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import {
  TENANT_ID_PREFIX,
  TENANT_NAME_MAX_LENGTH,
  getCurrentTenantId,
  listTenants,
} from '@/lib/tenant';

/**
 * Who may add or remove a company. `sync.manage` because a company is only
 * useful once a Company ID is mapped to it, and that mapping (Tambah Data →
 * "Pemetaan Company ID → Company") already needs this permission. The sidebar
 * shows the "+" and the delete icons on the same permission.
 */
const TENANT_PERMISSION = 'sync.manage' as const;

export type TenantMutationResult =
  | { ok: true; tenant: { id: string; slug: string; name: string }; restored?: boolean }
  | { ok: false; error: string };

export async function switchTenantAction(formData: FormData) {
  const slug = formData.get('slug');
  if (typeof slug !== 'string') return;

  const tenant = (await listTenants()).find((t) => t.slug === slug);
  if (!tenant) return;

  const cookieStore = await cookies();
  cookieStore.set('pulse_tenant', tenant.slug, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  revalidatePath('/', 'layout');
}

/** Trim and collapse inner whitespace, so "PT  Baru " and "PT Baru" are one name. */
function normalizeName(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Add a company. The id follows the seed format (`10000000-0000-0000-0000-` +
 * the next 12-digit number) and the slug is the name in lower case.
 *
 * Re-using the name of a removed company RESTORES that row (same id) instead of
 * failing on the total slug index — its history is still attached to that id.
 */
export async function createTenantAction(rawName: string): Promise<TenantMutationResult> {
  await requirePermission(TENANT_PERMISSION);
  const name = normalizeName(rawName);
  if (!name) return { ok: false, error: 'Nama Company wajib diisi.' };
  if (name.length > TENANT_NAME_MAX_LENGTH) {
    return { ok: false, error: `Nama Company maksimal ${TENANT_NAME_MAX_LENGTH} karakter.` };
  }
  const slug = name.toLowerCase();

  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  let result: TenantMutationResult;
  try {
    result = await db.transaction(async (tx) => {
      // Two concurrent creates must not compute the same next id.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('pulse:tenants:create'))`);

      const existing = (
        await tx.execute(sql`
          SELECT id::text AS id, slug, name, deleted_at IS NOT NULL AS deleted
            FROM tenants WHERE lower(slug) = ${slug} LIMIT 1
        `)
      ).rows as Array<{ id: string; slug: string; name: string; deleted: boolean }>;
      const hit = existing[0];
      if (hit && !hit.deleted) {
        return { ok: false, error: `Company "${hit.name}" sudah ada.` } as const;
      }
      if (hit) {
        await tx.execute(sql`
          UPDATE tenants SET name = ${name}, slug = ${slug}, deleted_at = NULL WHERE id = ${hit.id}::uuid
        `);
        return { ok: true, tenant: { id: hit.id, slug, name }, restored: true } as const;
      }

      const maxRes = (
        await tx.execute(sql`
          SELECT coalesce(max(right(id::text, 12)::bigint), 0)::text AS n
            FROM tenants
           WHERE id::text LIKE ${TENANT_ID_PREFIX + '%'}
             AND right(id::text, 12) ~ '^[0-9]{12}$'
        `)
      ).rows as Array<{ n: string }>;
      const next = BigInt(maxRes[0]?.n ?? '0') + BigInt(1);
      const id = TENANT_ID_PREFIX + next.toString().padStart(12, '0');
      if (id.length !== 36) return { ok: false, error: 'Nomor Company sudah habis.' } as const;

      await tx.execute(sql`
        INSERT INTO tenants (id, slug, name, is_builtin) VALUES (${id}::uuid, ${slug}, ${name}, false)
      `);
      return { ok: true, tenant: { id, slug, name } } as const;
    });
  } catch (error) {
    console.error('[tenant] create failed:', error);
    return { ok: false, error: 'Gagal menambah Company. Pastikan migrasi drizzle/0100 sudah diterapkan.' };
  }

  if (result.ok) {
    await logAudit({
      tenantId: actorTenantId,
      actorId,
      entityType: 'tenants',
      entityId: result.tenant.id,
      action: 'create',
      summary: result.restored
        ? `Company "${result.tenant.name}" dipulihkan (${result.tenant.id})`
        : `Company "${result.tenant.name}" ditambahkan (${result.tenant.id}, slug "${result.tenant.slug}")`,
    });
    revalidatePath('/', 'layout');
  }
  return result;
}

export type TenantDeletionPreview =
  | { ok: true; name: string; companyIds: string[]; counts: Array<{ label: string; n: number }>; blockers: string[] }
  | { ok: false; error: string };

/** What deleting this company would remove — shown in the confirmation dialog. */
export async function previewTenantDeletionAction(tenantId: string): Promise<TenantDeletionPreview> {
  await requirePermission(TENANT_PERMISSION);
  if (typeof tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tenantId)) return { ok: false, error: 'Company tidak ditemukan.' };
  const plan = await planTenantPurge(tenantId);
  if (!plan) return { ok: false, error: 'Company tidak ditemukan.' };
  return { ok: true, name: plan.tenant.name, companyIds: plan.companyIds, counts: plan.counts, blockers: plan.blockers };
}

/**
 * PERMANENTLY delete a non-built-in company and all of its data
 * (lib/tenant-purge.ts lists exactly what). `confirmName` must equal the
 * company's name — checked HERE, because a guard that lives only in the dialog
 * is not a guard. Refused for a built-in company, while one of its scoring runs
 * is in progress, or when its candidates appear in another company's results.
 *
 * After the commit, the documents' uploaded PDFs are removed from the
 * sync-service upload store (otherwise the next full sync would re-ingest them,
 * unassigned and visible to every company) and their vectors from the vector
 * DB. Both are best-effort and reported, never a reason to undo the purge.
 */
export async function deleteTenantAction(tenantId: string, confirmName: string): Promise<TenantMutationResult & { notes?: string[] }> {
  await requirePermission(TENANT_PERMISSION);
  if (typeof tenantId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    return { ok: false, error: 'Company tidak ditemukan.' };
  }
  const before = await planTenantPurge(tenantId);
  if (!before) return { ok: false, error: 'Company tidak ditemukan.' };
  if (before.tenant.isBuiltin) return { ok: false, error: `Company bawaan "${before.tenant.name}" tidak dapat dihapus.` };
  if ((confirmName ?? '').trim() !== before.tenant.name) {
    return { ok: false, error: `Ketik nama Company persis "${before.tenant.name}" untuk mengonfirmasi penghapusan.` };
  }

  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const outcome = await purgeTenant(tenantId);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const notes: string[] = [];
  // Uploaded PDFs of the deleted documents, in the sync-service upload store.
  if (outcome.jobProfileFiles.length > 0) {
    const baseUrl = process.env.SYNC_SERVICE_URL;
    try {
      if (!baseUrl) throw new Error('SYNC_SERVICE_URL belum diset');
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/sync/upload/_purge-job-profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: outcome.jobProfileFiles }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => null)) as { removed?: number; failed?: string[]; skipped?: number } | null;
      if (!res.ok || !body) throw new Error(`HTTP ${res.status}`);
      if ((body.failed?.length ?? 0) > 0) notes.push(`${body.failed!.length} berkas PDF job profile gagal dihapus dari server sync.`);
      if ((body.skipped ?? 0) > 0) notes.push(`${body.skipped} dokumen berasal dari folder bersama dan berkasnya tidak dihapus (bukan unggahan).`);
    } catch (err) {
      notes.push(
        `Berkas PDF ${outcome.jobProfileFiles.length} job profile tidak dapat dihapus dari server sync (${err instanceof Error ? err.message : String(err)}); ` +
          'sinkronisasi penuh berikutnya bisa memuatnya lagi tanpa Company.',
      );
    }
  }
  // Their vectors, behind VECTOR_DATABASE_URL (possibly another instance).
  if (outcome.jobProfileIds.length > 0) {
    try {
      await vectorDb.delete(jobProfileEmbed).where(inArray(jobProfileEmbed.jobProfileId, outcome.jobProfileIds));
    } catch (err) {
      notes.push(`Vektor job profile tidak terhapus (${err instanceof Error ? err.message : String(err)}); akan dibersihkan saat peta Job Family dibangun ulang.`);
    }
  }
  if (outcome.positionsKept > 0) notes.push(`${outcome.positionsKept} posisi master tetap ada karena masih dirujuk master posisi Company lain.`);

  // The deleted company's own audit rows went with it; record the deletion
  // under the actor's company — or the first built-in one when the actor was
  // working inside the company being deleted.
  const auditTenant =
    actorTenantId !== tenantId
      ? actorTenantId
      : ((await listTenants()).find((t) => t.isBuiltin && t.id !== tenantId)?.id ?? actorTenantId);
  await logAudit({
    tenantId: auditTenant,
    actorId,
    entityType: 'tenants',
    entityId: tenantId,
    action: 'delete',
    summary:
      `Company "${before.tenant.name}" dihapus permanen (${tenantId}; Company ID ${outcome.plan.companyIds.join(', ') || '-'}): ` +
      (outcome.plan.counts.map((c) => `${c.n} ${c.label}`).join(', ') || 'tanpa data'),
  });
  revalidatePath('/', 'layout');
  return { ok: true, tenant: { id: tenantId, slug: before.tenant.name.toLowerCase(), name: before.tenant.name }, notes };
}
