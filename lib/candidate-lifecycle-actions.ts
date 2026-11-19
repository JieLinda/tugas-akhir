'use server';

import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { refuseInDemoMode } from '@/lib/demo/write';
import { isDemoMode } from '@/lib/app-mode';
import { maskNpk } from '@/lib/app-mode-shared';
import * as schema from '@/lib/db/schema';
import { decryptCandidateRows } from '@/lib/candidate-crypto';
import { requirePermission } from '@/lib/rbac';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { logAudit } from '@/lib/audit';
import { demoScrub } from '@/lib/demo/names';

/**
 * Bulk clear / restore of a tenant's candidate pool.
 *
 * The intended workflow is: clear → upload corrected source data → run the
 * candidate sync → everyone comes back, refreshed, with the SAME uuid they had
 * before. That identity stability is the whole point:
 *
 *   • `candidates.id` is cascade-referenced by analysis_results,
 *     position_picks and job_family_matches, and is
 *     embedded with no foreign key inside tournament_sessions' jsonb pools.
 *     A real DELETE-then-reimport hands every candidate a fresh uuid, which
 *     detaches them from every finished scoring run they ever appeared in.
 *   • The sync upserts on (tenant_id, employee_id), so as long as the row is
 *     still there the NPK matches and the original uuid is reused.
 *
 * Hence 'bulk' mode, which candidate-populate.ts treats as "resurrect on next
 * sync", as opposed to the 'manual' single-candidate delete which it must
 * leave alone.
 */

function revalidateCandidatePaths() {
  revalidatePath('/candidates');
  revalidatePath('/settings/sync');
  revalidatePath('/analysis');
  revalidatePath('/');
}

export type CandidateLifecycleStats = {
  live: number;
  clearedBulk: number;
  deletedManual: number;
};

export async function getCandidateLifecycleStatsAction(): Promise<CandidateLifecycleStats> {
  await requirePermission('candidates.view');
  const tenantId = await getCurrentTenantId();

  const [row] = await db
    .select({
      live: sql<number>`count(*) FILTER (WHERE deleted_at IS NULL)::int`,
      clearedBulk: sql<number>`count(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_mode = 'bulk')::int`,
      deletedManual: sql<number>`count(*) FILTER (WHERE deleted_at IS NOT NULL AND deleted_mode = 'manual')::int`,
    })
    .from(schema.candidates)
    .where(eq(schema.candidates.tenantId, tenantId));

  return {
    live: Number(row?.live ?? 0),
    clearedBulk: Number(row?.clearedBulk ?? 0),
    deletedManual: Number(row?.deletedManual ?? 0),
  };
}

export type DeletedCandidateRow = {
  id: string;
  name: string;
  employeeId: string | null;
  deletedAt: string;
  mode: 'bulk' | 'manual';
};

/**
 * Individually-deleted candidates, so they can be put back.
 *
 * Without this, converting the per-candidate delete from a hard DELETE to a
 * tombstone would turn it into a one-way door for a row that still physically
 * exists — the worst of both worlds. The bulk-cleared set is excluded because it
 * has its own restore path and would otherwise flood this list.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function listDeletedCandidatesAction(
  ...args: Parameters<typeof listDeletedCandidatesActionImpl>
): ReturnType<typeof listDeletedCandidatesActionImpl> {
  return demoScrub(await listDeletedCandidatesActionImpl(...args));
}

async function listDeletedCandidatesActionImpl(): Promise<DeletedCandidateRow[]> {
  await requirePermission('candidates.view');
  const tenantId = await getCurrentTenantId();

  const rows = decryptCandidateRows(
    await db
      .select({
        id: schema.candidates.id,
        name: schema.candidates.name,
        employeeId: schema.candidates.employeeId,
        deletedAt: schema.candidates.deletedAt,
        mode: schema.candidates.deletedMode,
      })
      .from(schema.candidates)
      .where(
        and(
          eq(schema.candidates.tenantId, tenantId),
          isNotNull(schema.candidates.deletedAt),
          eq(schema.candidates.deletedMode, 'manual'),
        ),
      )
      .orderBy(desc(schema.candidates.deletedAt))
      // A tenant that has been cleared and re-cleared could accumulate a long
      // list; this panel is a recovery tool, not a browsable archive.
      .limit(200),
  );

  // Demo mode: no NPK leaves the server.
  const demo = await isDemoMode();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    employeeId: demo ? maskNpk(r.employeeId) || null : r.employeeId,
    deletedAt: (r.deletedAt ?? new Date()).toISOString(),
    mode: (r.mode as 'bulk' | 'manual') ?? 'manual',
  }));
}

/**
 * Tombstone every live candidate in the CURRENT tenant.
 *
 * Scoped to one tenant on purpose. This is a multi-tenant deployment where
 * Mulia / MSO / ERRO share a database; "clear all candidates" from within one
 * business unit must never reach into another's pool.
 */
export async function clearAllCandidatesAction(): Promise<{
  success: boolean;
  cleared: number;
  message: string;
}> {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const cleared = await db
      .update(schema.candidates)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        deletedMode: 'bulk',
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.candidates.tenantId, tenantId), isNull(schema.candidates.deletedAt)),
      )
      .returning({ id: schema.candidates.id });

    await logAudit({
      tenantId,
      actorId,
      entityType: 'candidate',
      entityId: 'bulk',
      action: 'delete',
      summary: `${cleared.length} kandidat dikosongkan (soft delete, dapat dipulihkan).`,
    });

    revalidateCandidatePaths();

    return {
      success: true,
      cleared: cleared.length,
      message:
        cleared.length === 0
          ? 'Tidak ada kandidat aktif untuk dikosongkan.'
          : `${cleared.length} kandidat dikosongkan. Riwayat scoring tetap utuh — ` +
            `jalankan sinkronisasi kandidat untuk memunculkannya kembali dengan ID yang sama.`,
    };
  } catch (err) {
    return {
      success: false,
      cleared: 0,
      message: err instanceof Error ? err.message : 'Gagal mengosongkan data kandidat.',
    };
  }
}

/**
 * Undo a bulk clear without waiting for a sync.
 *
 * Only touches rows cleared in bulk: a candidate removed one at a time from the
 * Kandidat page was a deliberate judgement about that person, and a blanket
 * "restore" that quietly reinstated them would be a different, unasked-for
 * action. Those are restored individually via restoreCandidateAction.
 */
export async function restoreClearedCandidatesAction(): Promise<{
  success: boolean;
  restored: number;
  message: string;
}> {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const restored = await db
      .update(schema.candidates)
      .set({ deletedAt: null, deletedBy: null, deletedMode: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.candidates.tenantId, tenantId),
          isNotNull(schema.candidates.deletedAt),
          eq(schema.candidates.deletedMode, 'bulk'),
        ),
      )
      .returning({ id: schema.candidates.id });

    await logAudit({
      tenantId,
      actorId,
      entityType: 'candidate',
      entityId: 'bulk',
      action: 'update',
      summary: `${restored.length} kandidat dipulihkan dari pengosongan massal.`,
    });

    revalidateCandidatePaths();

    return {
      success: true,
      restored: restored.length,
      message:
        restored.length === 0
          ? 'Tidak ada kandidat yang dikosongkan secara massal.'
          : `${restored.length} kandidat dipulihkan.`,
    };
  } catch (err) {
    return {
      success: false,
      restored: 0,
      message: err instanceof Error ? err.message : 'Gagal memulihkan data kandidat.',
    };
  }
}
