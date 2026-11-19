'use server';

import { getCandidateRunHistory, type CandidateRunHistoryEntry } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';

/**
 * Every run of ONE position that ranked this candidate.
 *
 * The candidate detail page renders only the newest run per position on first
 * paint; a reader who wants the rest expands that position and this fills it
 * in. The alternative — shipping every run with the page — put a candidate's
 * whole assessment history (32 runs across 9 positions on the reference record)
 * into the initial payload to answer a question most visits never ask.
 *
 * Same permission as the page: this is the identical data `getCandidateRunHistory`
 * already returns, sliced, and it is tenant-scoped inside that function.
 */
export async function getCandidateRunsForPositionAction(
  candidateId: string,
  positionId: string,
): Promise<CandidateRunHistoryEntry[]> {
  await requirePermission('candidates.view');
  return getCandidateRunHistory(candidateId, positionId);
}
