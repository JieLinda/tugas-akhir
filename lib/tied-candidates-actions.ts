'use server';

import { requirePermission } from '@/lib/rbac';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { analysisResults, scoringRuns } from '@/lib/db/schema';
import { getCurrentTenantId } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { logAudit } from '@/lib/audit';

export type TiedCandidateOrder = {
  candidateId: string;
  manualRank: number;
};

/**
 * Persist a manual rank override for tied candidates within a single run.
 * The `order` array provides the new display order: the first candidate
 * gets the lowest manualRank, etc. All other results in the run are
 * unaffected.
 */
export async function reorderTiedCandidatesAction(input: {
  runId: string;
  order: TiedCandidateOrder[];
}) {
  await requirePermission('analysis.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const { runId, order } = input;

  if (!runId) throw new Error('runId wajib diisi.');
  if (!Array.isArray(order) || order.length === 0) return;

  // Verify run belongs to current tenant (the comment used to promise this
  // while the query only checked that the run had results).
  const runRows = await db
    .select({ id: scoringRuns.id })
    .from(scoringRuns)
    .where(and(eq(scoringRuns.id, runId), eq(scoringRuns.tenantId, tenantId)))
    .limit(1);
  if (!runRows[0]) {
    throw new Error('Run tidak ditemukan.');
  }

  // Apply each manualRank
  for (const { candidateId, manualRank } of order) {
    await db
      .update(analysisResults)
      .set({ manualRank })
      .where(
        and(
          eq(analysisResults.runId, runId),
          eq(analysisResults.candidateId, candidateId),
        ),
      );
  }

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'scoring_run',
    entityId: runId,
    action: 'update',
    summary: `Mengubah urutan ${order.length} kandidat tie-breaker (manual rank)`,
  });

  revalidatePath('/positions');
}
