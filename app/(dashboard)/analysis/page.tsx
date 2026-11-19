import { redirect } from 'next/navigation';
import { getFirstPositionManagementId } from '@/lib/pulse-data';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage() {
  // One-row query — this page only redirects, so don't build all summaries.
  const firstPositionId = await getFirstPositionManagementId();
  redirect(firstPositionId ? `/positions/${firstPositionId}` : '/positions');
}
