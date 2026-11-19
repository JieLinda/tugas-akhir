import { notFound } from 'next/navigation';
import {
  getCandidateById,
  getCandidateRunHistory,
  getLookupDepartments,
  getLookupDivisions,
  getLookupPositions,
  getLookupTechnicalCompetencies,
} from '@/lib/pulse-data';
import { getCandidateTalentPoolStatus } from '@/lib/talent-pool-data';
import { CandidateDetailPageClient } from '@/components/candidate-detail-page-client';
import { requirePagePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

export default async function CandidateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePagePermission('candidates.view');
  const { id } = await params;
  const [candidate, departments, divisions, positions, competencies, runHistory, talentPool] =
    await Promise.all([
      getCandidateById(id),
      getLookupDepartments(),
      getLookupDivisions(),
      getLookupPositions(),
      getLookupTechnicalCompetencies(),
      getCandidateRunHistory(id),
      // "Is this person in the Talent Pool" is the headline of the page, and
      // the only standing figure on it that is not derived from a run. Degrades
      // to null rather than taking the page down.
      getCandidateTalentPoolStatus(id).catch(() => null),
    ]);

  if (!candidate) notFound();

  // Only the NEWEST run per position reaches the client; the rest is fetched on
  // demand when a position is expanded (getCandidateRunsForPositionAction).
  // runHistory is already newest-first, so the first hit per position wins.
  const seen = new Set<string>();
  const runSummary = runHistory
    .filter((r) => {
      if (seen.has(r.positionId)) return false;
      seen.add(r.positionId);
      return true;
    })
    .map((latest) => {
      const all = runHistory.filter((r) => r.positionId === latest.positionId);
      return {
        latest,
        runCount: all.length,
        bestRank: Math.min(...all.map((r) => r.rank)),
      };
    });

  // Demo mode: candidate names leave the server as initials (no-op otherwise).
  const shown = await demoScrub({ candidate, runSummary, talentPool });

  return (
    <CandidateDetailPageClient
      candidate={shown.candidate}
      masterDepartments={departments}
      masterDivisions={divisions}
      masterPositions={positions}
      masterCompetencies={competencies}
      runSummary={shown.runSummary}
      talentPool={shown.talentPool}
    />
  );
}
