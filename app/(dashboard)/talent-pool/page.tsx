import { hasPermission, requirePagePermission } from '@/lib/rbac';
import { TalentPoolPageClient } from '@/components/talent-pool-page-client';
import { getTalentPoolData } from '@/lib/talent-pool-data';
import { getCandidateFilterValues } from '@/lib/programs';
import { demoScrub } from '@/lib/demo/names';

export const metadata = { title: 'Talent Pool' };

export default async function TalentPoolPage() {
  await requirePagePermission('candidates.view');
  // The eligibility rules are shown — and, with governance.manage, edited — on
  // this page now, so it loads what that editor needs: the distinct values each
  // candidate attribute actually takes (so a rule picks from the real domain
  // rather than free text) and whether this user may write.
  const [data, fieldValues, canManageFilter] = await Promise.all([
    getTalentPoolData(),
    getCandidateFilterValues().catch(() => ({})),
    hasPermission('governance.manage'),
  ]);

  // Demo mode: candidate names leave the server as initials (no-op otherwise).
  // fieldValues are not scrubbed: they hold no names, and the filter editor
  // saves them back into rules.
  const shown = await demoScrub({ data });

  return (
    <TalentPoolPageClient
      data={shown.data}
      fieldValues={fieldValues}
      canManageFilter={canManageFilter}
    />
  );
}
