import { getCurrentTenant } from '@/lib/tenant';
import { hasPermission } from '@/lib/rbac';
import { getJobFamilyStats } from '@/lib/job-family-actions';
import {
  getLatestTopicRunAction,
  getTopicResultsAction,
  getTopicRunStatusAction,
} from '@/lib/job-family-topics-actions';
import { FamilyTreeView } from '@/components/job-family/family-tree-view';

export const metadata = {
  title: 'Peta Job Family | PULSE Command Center',
  description: 'Pengelompokan job profile menjadi rumpun jabatan hasil clustering BERTopic.',
};

// Section "Job Family" of the Posisi menu (gate + header in ../layout.tsx).
// Replaces /family-configuration, /family-tree and /job-profiles/job-family,
// which redirect here with their query intact. The page IS the map: the restructure template and
// the BERTopic parameters used to sit beside it as two more tabs (a third menu
// row under the sidebar and the hub strip), and moved to ./pengaturan.
export default async function JobFamilyPage({
  searchParams,
}: {
  // Deep-link into one job family card. runId matters: a topicId only
  // identifies a family WITHIN one clustering run, so opening topicId against
  // a rebuilt map would show a different family under the same number.
  searchParams?: Promise<{ runId?: string; topicId?: string; family?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const [stats, tenant, requestedRun, canManage] = await Promise.all([
    getJobFamilyStats(),
    getCurrentTenant(),
    // A run id from another business unit reads as null here (the action
    // enforces that), so fall back to the latest rather than 404 — the map is
    // still the right page to land on.
    sp.runId ? getTopicRunStatusAction(sp.runId) : Promise.resolve(null),
    hasPermission('job_profiles.manage'),
  ]);

  const latestRun = requestedRun ?? (await getLatestTopicRunAction());

  const parsedTopicId = sp.topicId != null ? Number.parseInt(sp.topicId, 10) : NaN;
  // Bucket -1 is the outlier pile, which has no card at all.
  const focusTopicId = Number.isFinite(parsedTopicId) && parsedTopicId >= 0 ? parsedTopicId : null;
  const focusFamily = sp.family?.trim() || null;

  const latestResults =
    latestRun && latestRun.status === 'completed'
      ? await getTopicResultsAction(latestRun.runId)
      : null;

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="space-y-6">
        {/* The "hasil kurang pas? ubah pengaturannya" notice that used to open
            this page is now the last line of pipeline step 3, where it is a
            follow-up to a map that exists rather than the first thing a reader
            meets. */}
        <FamilyTreeView
          stats={stats}
          latestRun={latestRun}
          latestResults={latestResults}
          showEmbedSync={canManage}
          focusTopicId={focusTopicId}
          focusFamily={focusFamily}
          tenantLabel={tenant.name}
        />
      </div>
    </div>
  );
}
