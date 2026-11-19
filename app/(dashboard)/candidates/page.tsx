import { requirePagePermission } from '@/lib/rbac';
import { CandidatesPageClient } from '@/components/candidates-page-client';
import {
  getCandidateLevelOptions,
  getCandidateProfilesPage,
  getLookupDepartments,
  getLookupDivisions,
  getLookupPositions,
  getLookupTechnicalCompetencies,
} from '@/lib/pulse-data';
import { demoScrub } from '@/lib/demo/names';

export default async function CandidatesPage() {
  await requirePagePermission('candidates.view');
  const [{ candidates, total, successorSeats }, departments, divisions, positions, competencies, levelOptions] = await Promise.all([
    getCandidateProfilesPage(1, 8, '', 'name'),
    getLookupDepartments(),
    getLookupDivisions(),
    getLookupPositions(),
    getLookupTechnicalCompetencies(),
    getCandidateLevelOptions(),
  ]);

  // Demo mode: candidate names leave the server as initials (no-op otherwise).
  const shown = await demoScrub({ candidates, successorSeats });

  return (
    <CandidatesPageClient
      initialCandidates={shown.candidates}
      initialTotal={total}
      initialSuccessorSeats={shown.successorSeats}
      masterDepartments={departments}
      masterDivisions={divisions}
      masterPositions={positions}
      masterCompetencies={competencies}
      levelOptions={levelOptions}
    />
  );
}
