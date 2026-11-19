import { getDashboardOverview } from '@/lib/pulse-data';
import { DashboardPageClient } from '@/components/dashboard-page-client';
import { demoScrub } from '@/lib/demo/names';

export default async function DashboardPage() {
  // Demo mode: candidate and holder names leave the server as initials.
  const overview = await demoScrub(await getDashboardOverview());

  return <DashboardPageClient overview={overview} />;
}