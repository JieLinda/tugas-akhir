'use server';

import { requirePermission } from '@/lib/rbac';

import { db } from '@/lib/db';
import { syncJobProfiles } from '@/lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { getCurrentTenantId } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { resolveJobProfileIdentifier } from '@/lib/job-family/resolve-profile';
import {
  getJobProfileOwnership,
  isUnassigned,
  jobProfileVisibleTo,
} from '@/lib/job-profile-tenant-scope';
import { demoMaskJobProfile, demoMaskJobProfiles } from '@/lib/demo/content';

/**
 * Auto-suggest ONE job profile for a position, combining the incumbent
 * pairing with a title fallback:
 *   • 'family' — the profile paired with this position via the Job Family Sync
 *     (holder → candidate → job_family_matches, or linked position → job_family_matches).
 *   • 'title'  — exact then substring title match against sync_job_profiles.
 * Powers the auto-fill suggestion in the "Pilih dari Job Profile" dialog; the
 * user can still override the choice manually.
 */
export async function suggestJobProfileForPositionAction(
  positionId: string,
): Promise<{ jobProfileId: number | null; source: 'family' | 'title' | null; positionName: string | null }> {
  await requirePermission('positions.manage');

  const cp = await db.execute(sql`
    SELECT cp.title,
           cp.position_id AS "masterPositionId",
           c.id::text AS "candidateId"
    FROM critical_positions cp
    -- Identity resolution (NPK → candidate) feeding the job-family pairing, so
    -- a soft-deleted holder must not be resolved.
    LEFT JOIN candidates c
      ON LPAD(c.employee_id, 5, '0') = LPAD(cp.holder_employee_id, 5, '0') AND c.tenant_id = cp.tenant_id
     AND c.deleted_at IS NULL
    WHERE cp.id = ${positionId}
    -- The join key is LPAD-normalized while candidates' unique index is on the
    -- RAW employee_id, so two LIVE rows ('682' and '0682' — the padded form is
    -- hand-creatable) collapse onto one key and this LIMIT 1 would otherwise
    -- hand resolveJobProfileIdentifier an arbitrary, plan-dependent one of them.
    -- Prefer the exact NPK match, then the oldest row, then the id.
    ORDER BY (c.employee_id = cp.holder_employee_id) DESC NULLS LAST,
             c.created_at ASC NULLS LAST,
             c.id ASC
    LIMIT 1
  `);
  const row = (cp.rows as Array<{ title: string | null; masterPositionId: string | null; candidateId: string | null }>)[0];
  if (!row) return { jobProfileId: null, source: null, positionName: null };

  const found = await resolveJobProfileIdentifier({
    candidateId: row.candidateId,
    masterPositionId: row.masterPositionId,
    titleFallback: row.title,
  });
  if (!found) return { jobProfileId: null, source: null, positionName: null };
  return {
    jobProfileId: found.jobProfileId,
    source: found.source === 'title' ? 'title' : 'family',
    positionName: found.positionName,
  };
}

export type JobProfileSelectionSuggestion = {
  jobProfileId: number | null;
  source: 'family-candidate' | 'family-position' | 'title' | null;
  positionName: string | null;
  divisionDepartment: string | null;
  jobPurpose: string | null;
  supervisor: string | null;
  extractedData: unknown | null;
};

/**
 * Same pairing logic as suggestJobProfileForPositionAction, but keyed on raw
 * identifiers (a candidate id and/or a master `positions` id) instead of an
 * existing critical_positions row. Powers the Tambah/Edit Posisi form's live
 * auto-suggest, which needs a suggestion the moment a candidate or master
 * position is picked — before the position is saved, so there is no
 * critical_positions.id yet. Bundles the full profile data (needed to
 * auto-fill qualifications) in the same round trip.
 */
// Demo mode: purpose and the named sections are masked; the form only copies qualifications and competencies, which stay intact.
export async function suggestJobProfileForSelectionAction(
  ...args: Parameters<typeof suggestJobProfileForSelectionActionImpl>
): ReturnType<typeof suggestJobProfileForSelectionActionImpl> {
  return demoMaskJobProfile(await suggestJobProfileForSelectionActionImpl(...args));
}

async function suggestJobProfileForSelectionActionImpl(input: {
  candidateId?: string | null;
  masterPositionId?: string | null;
  titleFallback?: string | null;
}): Promise<JobProfileSelectionSuggestion> {
  await requirePermission('positions.manage');

  const found = await resolveJobProfileIdentifier(input);
  if (!found) {
    return {
      jobProfileId: null,
      source: null,
      positionName: null,
      divisionDepartment: null,
      jobPurpose: null,
      supervisor: null,
      extractedData: null,
    };
  }

  const full = await db
    .select({
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      jobPurpose: syncJobProfiles.jobPurpose,
      supervisor: syncJobProfiles.supervisor,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(eq(syncJobProfiles.id, found.jobProfileId))
    .limit(1);

  return {
    jobProfileId: found.jobProfileId,
    source: found.source,
    positionName: full[0]?.positionName ?? found.positionName,
    divisionDepartment: full[0]?.divisionDepartment ?? null,
    jobPurpose: full[0]?.jobPurpose ?? null,
    supervisor: full[0]?.supervisor ?? null,
    extractedData: full[0]?.extractedData ?? null,
  };
}

/**
 * Fetch the synced job profiles VISIBLE TO THE ACTIVE TENANT.
 * Deliberately excludes raw_text (the full OCR dump per PDF) — no consumer
 * renders it, and shipping it for every profile bloated the page payload.
 *
 * Scoping comes from job_profile_tenants (see lib/job-profile-tenant-scope.ts);
 * documents nobody has assigned to a tenant yet stay visible to everyone and are
 * flagged `unmapped` so the gap is actionable rather than invisible.
 */
// Demo mode: purpose and the named sections keep three words per point.
export async function getJobProfilesAction(
  ...args: Parameters<typeof getJobProfilesActionImpl>
): ReturnType<typeof getJobProfilesActionImpl> {
  return demoMaskJobProfiles(await getJobProfilesActionImpl(...args));
}

async function getJobProfilesActionImpl() {
  await requirePermission('job_profiles.view');
  try {
    const tenantId = await getCurrentTenantId();
    const rows = await db
      .select({
        id: syncJobProfiles.id,
        fileName: syncJobProfiles.fileName,
        filePath: syncJobProfiles.filePath,
        sourceFolder: syncJobProfiles.sourceFolder,
        fileHash: syncJobProfiles.fileHash,
        jobProfileNumber: syncJobProfiles.jobProfileNumber,
        positionName: syncJobProfiles.positionName,
        divisionDepartment: syncJobProfiles.divisionDepartment,
        supervisor: syncJobProfiles.supervisor,
        jobPurpose: syncJobProfiles.jobPurpose,
        extractedData: syncJobProfiles.extractedData,
        status: syncJobProfiles.status,
        errorMessage: syncJobProfiles.errorMessage,
        syncedAt: syncJobProfiles.syncedAt,
        processedAt: syncJobProfiles.processedAt,
        /** Non-null while the file is waiting for (re)extraction. */
        queuedAt: syncJobProfiles.queuedAt,
      })
      .from(syncJobProfiles)
      .where(jobProfileVisibleTo(tenantId))
      .orderBy(desc(syncJobProfiles.syncedAt));

    const ownership = await getJobProfileOwnership(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...r,
      /** No tenant assigned yet — shown to every tenant for now. */
      unmapped: isUnassigned(ownership.get(r.id)),
      tenantIds: ownership.get(r.id) ?? [],
    }));
  } catch (error) {
    console.error('Error fetching job profiles:', error);
    return [];
  }
}

/**
 * Deletes a single job profile sync entry
 */
export async function deleteJobProfileAction(id: number) {
  await requirePermission('job_profiles.manage');
  try {
    // The actor is resolved like every other audit call in this file: a delete
    // recorded without one could never answer "who removed this document".
    const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
    await db.delete(syncJobProfiles).where(eq(syncJobProfiles.id, id));

    await logAudit({
      tenantId,
      actorId,
      entityType: 'sync_job_profiles',
      entityId: String(id),
      action: 'delete',
      summary: `Deleted job profile sync entry id=${id}`,
    });

    revalidatePath('/job-profiles');
    return { success: true };
  } catch (error) {
    console.error('Error deleting job profile:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Re-read ONE job profile's PDF, for a profile whose extraction is wrong.
 *
 * The work happens in sync-service, which is where the PDF and the vision model
 * live; this is the authorisation boundary and the audit point. It is a long
 * call — one vision-model pass over every page — so the timeout is generous and
 * an abort reports itself rather than looking like a server fault.
 *
 * Permission is `job_profiles.manage` rather than `sync.manage`: this fixes ONE
 * document that the person is looking at, which is job-profile curation, not
 * running a sync. (The generic `/api/sync` proxy demands `sync.manage`, so this
 * deliberately calls the service directly rather than routing through it.)
 */
export async function reextractJobProfileAction(
  id: number,
): Promise<{ success: boolean; message: string; missingFile?: boolean }> {
  await requirePermission('job_profiles.manage');

  const baseUrl = process.env.SYNC_SERVICE_URL;
  if (!baseUrl) {
    return { success: false, message: 'SYNC_SERVICE_URL belum diset.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300_000);
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/sync/job-profiles/${encodeURIComponent(String(id))}/reextract`,
      { method: 'POST', signal: controller.signal },
    );
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; message?: string; missingFile?: boolean }
      | null;

    if (body?.success) {
      const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
      await logAudit({
        tenantId,
        actorId,
        entityType: 'sync_job_profiles',
        entityId: String(id),
        action: 'update',
        summary: `Re-read job profile id=${id} (extraction judged wrong)`,
      });
      revalidatePath('/job-profiles');
      return { success: true, message: body.message ?? 'Job profile berhasil dibaca ulang.' };
    }

    return {
      success: false,
      // The service names the real reason — a missing PDF needs a re-upload, not
      // a retry — so its message is preferred over anything invented here.
      message: body?.message ?? `Layanan sinkronisasi menolak permintaan (HTTP ${res.status}).`,
      missingFile: body?.missingFile === true,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      success: false,
      message: aborted
        ? 'Pembacaan ulang melebihi batas waktu. Prosesnya mungkin masih berjalan di latar belakang — muat ulang halaman sebentar lagi untuk memeriksa.'
        : 'Layanan sinkronisasi tidak dapat dihubungi.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-read EVERY job profile whose last extraction failed.
 *
 * Short timeout on purpose (unlike the single re-read's 300s): the service
 * answers as soon as the batch is QUEUED, so this is waiting on one UPDATE and a
 * count, not on the extraction. The work itself is watched through
 * `sync_job_profiles.queued_at`, which the Job Profiles page polls while the
 * queue is non-empty.
 */
export async function retryFailedJobProfilesAction(): Promise<{
  success: boolean;
  message: string;
  queued?: number;
  missing?: number;
}> {
  await requirePermission('job_profiles.manage');

  const baseUrl = process.env.SYNC_SERVICE_URL;
  if (!baseUrl) {
    return { success: false, message: 'SYNC_SERVICE_URL belum diset.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(
      `${baseUrl.replace(/\/$/, '')}/api/sync/job-profiles/retry-failed`,
      { method: 'POST', signal: controller.signal },
    );
    const body = (await res.json().catch(() => null)) as
      | { success?: boolean; message?: string; queued?: number; missing?: number }
      | null;

    if (body?.success) {
      const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
      await logAudit({
        tenantId,
        actorId,
        entityType: 'sync_job_profiles',
        entityId: 'retry-failed',
        action: 'update',
        summary:
          `Antre baca ulang ${body.queued ?? 0} job profile yang gagal diekstrak` +
          (body.missing ? `, ${body.missing} dilewati (berkas PDF hilang)` : ''),
      });
      revalidatePath('/job-profiles');
      return {
        success: true,
        message: body.message ?? 'Job profile gagal dimasukkan ke antrean.',
        queued: body.queued,
        missing: body.missing,
      };
    }

    return {
      success: false,
      // The service distinguishes "already running" (409) from a real fault, and
      // names missing PDFs, so its own message beats anything invented here.
      message: body?.message ?? `Layanan sinkronisasi menolak permintaan (HTTP ${res.status}).`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      success: false,
      message: aborted
        ? 'Layanan sinkronisasi tidak menjawab tepat waktu. Muat ulang halaman untuk memeriksa apakah antreannya sudah terbentuk.'
        : 'Layanan sinkronisasi tidak dapat dihubungi.',
    };
  } finally {
    clearTimeout(timer);
  }
}
