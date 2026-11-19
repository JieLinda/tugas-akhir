import type { Metadata } from 'next';
import { requirePagePermission } from '@/lib/rbac';
import { JobProfilesHubChrome } from '@/components/job-profiles/hub-chrome';

// The "Dokumen" menu: job-profile documents, Job Profile Match and Kamus
// Kompetensi. It shares one permission with the "Posisi" menu
// (app/(dashboard)/posisi) — job_profiles.* is deliberately a single RBAC
// bundle — so the gate runs once here instead of once per section page.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Dokumen | PULSE Command Center',
  description: 'Dokumen job profile, pencocokan job profile, dan kamus kompetensi.',
};

export default async function JobProfilesHubLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission('job_profiles.view');

  // A fragment, not a wrapper div: DashboardHeader relies on being a direct
  // child of the dashboard layout's `flex flex-col` container for its
  // `shrink-0` to hold (see the comment in components/dashboard-header.tsx).
  return (
    <>
      <JobProfilesHubChrome />
      {children}
    </>
  );
}
