import { getCurrentUser } from '@/lib/auth';
import { hasPermission, requirePagePermission } from '@/lib/rbac';
import { getTalentMappingData } from '@/lib/talent-mapping-data';
import { TalentMappingPageClient } from '@/components/talent-mapping/talent-mapping-page-client';
import { demoScrub } from '@/lib/demo/names';

export const metadata = { title: 'Talent Mapping' };

export default async function TalentMappingPage() {
  // Same gate as the Talent Pool page: the map is a reading of that list.
  // Moving people needs candidates.manage, checked again by the action itself.
  await requirePagePermission('candidates.view');
  const [data, canManage, user] = await Promise.all([
    getTalentMappingData(),
    hasPermission('candidates.manage'),
    getCurrentUser().catch(() => null),
  ]);

  return (
    <TalentMappingPageClient
      // Demo mode: candidate names — on the map, in the queue and in the HAV
      // history — leave the server as initials (no-op otherwise).
      data={await demoScrub(data)}
      canManage={canManage}
      actor={{ name: user?.name ?? null, username: user?.email ?? null }}
    />
  );
}
