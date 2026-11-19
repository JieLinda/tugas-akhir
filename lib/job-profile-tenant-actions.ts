'use server';

// Direct tenant assignment for job profile documents.
//
// Replaces the old folder→tenant mapping indirection (job_profile_folder_map,
// removed in drizzle/0055_drop_job_profile_folder_map.sql): in practice every
// real share folder mapped 1:1 to a tenant of the same name, so registering a
// folder before its documents would scope correctly was a step that added
// nothing an admin couldn't already say directly. Now ownership is set at the
// moment it's known — chosen at upload time (Sinkronisasi → Job Profile) or
// edited per document on the Job Profiles page — with no detour through
// Tata Kelola.

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { TENANTS, getCurrentTenantId } from '@/lib/tenant';

/**
 * Set which tenant(s) own a document, replacing whatever was assigned before.
 * An empty list un-assigns it, which by design makes it visible to every
 * tenant again rather than to none — see lib/job-profile-tenant-scope.ts.
 */
export async function setJobProfileTenantsAction(
  jobProfileId: number,
  tenantIds: string[],
): Promise<{ success: boolean; error?: string }> {
  await requirePermission('job_profiles.manage');

  const valid = TENANTS.map((t) => t.id);
  const wanted = Array.from(new Set(tenantIds.filter((id) => valid.includes(id))));

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM job_profile_tenants WHERE job_profile_id = ${jobProfileId}
      `);
      for (const tenantId of wanted) {
        await tx.execute(sql`
          INSERT INTO job_profile_tenants (job_profile_id, tenant_id, source)
          VALUES (${jobProfileId}, ${tenantId}::uuid, 'manual')
          ON CONFLICT (job_profile_id, tenant_id) DO NOTHING
        `);
      }
    });
  } catch (error) {
    console.error('Error assigning job profile tenants:', error);
    return { success: false, error: 'Gagal menyimpan pemetaan Company.' };
  }

  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  await logAudit({
    tenantId,
    actorId,
    entityType: 'job_profile_tenants',
    entityId: String(jobProfileId),
    action: 'update',
    summary:
      wanted.length === 0
        ? `Pemetaan Company dokumen job profile ${jobProfileId} dihapus (tampil di semua Company)`
        : `Dokumen job profile ${jobProfileId} dipetakan ke ${wanted
            .map((id) => TENANTS.find((t) => t.id === id)?.name ?? id)
            .join(', ')}`,
  });

  revalidatePath('/job-profiles');
  return { success: true };
}
