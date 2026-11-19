import { getCurrentTenant } from '@/lib/tenant';
import {
  getLatestMatchRunAction,
  getMatchTenantsAction,
  getSavedMatchReportAction,
  type MatchTenant,
} from '@/lib/job-family-sync-actions';
import { JobProfileMatchClient } from '@/components/job-profiles/job-profile-match-client';

export const metadata = {
  title: 'Job Profile Match | PULSE Command Center',
  description: 'Pencocokan posisi aktif kandidat dengan job profile.',
};

// Section "Job Profile Match" of the Dokumen menu (gate + header in
// ../layout.tsx). Opens on the LAST RUN for this business unit
// (job_profile_match_runs — one indexed read, the full report), falling back to
// the committed mapping rebuilt from job_family_matches when no run has been
// stored yet. The live ~20s matching is started only from a button and
// replaces the stored run — see JobProfileMatchClient.
export default async function JobProfileMatchPage() {
  const tenant = await getCurrentTenant();
  const [lastRun, saved, tenants] = await Promise.all([
    getLatestMatchRunAction().catch(() => null),
    getSavedMatchReportAction({ tenantIds: [tenant.id] }).catch(() => null),
    getMatchTenantsAction().catch(() => [] as MatchTenant[]),
  ]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <JobProfileMatchClient
        activeTenantId={tenant.id}
        initialReport={lastRun ?? saved}
        initialTenants={tenants}
      />
    </div>
  );
}
