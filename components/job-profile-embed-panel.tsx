'use client';

// Job-Profile embedding panel (on /settings/sync). Restructures each completed
// job profile and embeds it into job_profile_embed (pgvector) — the exact same
// batched rebuild the "Bangun Ulang Embedding" button on /posisi/job-family
// runs. Thin wrapper over the shared EmbeddingRebuildPanel.

import { FileText } from 'lucide-react';
import {
  EmbeddingRebuildPanel,
  type EmbedPanelStatus,
} from '@/components/embedding-rebuild-panel';
import {
  getJobFamilyStats,
  startRebuildAction,
  processRebuildBatchAction,
  cancelRebuildAction,
} from '@/lib/job-family-actions';

async function loadStatus(): Promise<EmbedPanelStatus> {
  const s = await getJobFamilyStats();
  return {
    ready: s.pgvectorReady,
    embedded: s.embeddedCount,
    total: s.completedProfiles,
    embeddingModel: s.embeddingModel,
    error: s.pgvectorReady
      ? undefined
      : 'Ekstensi pgvector / tabel job_profile_embed belum tersedia.',
  };
}

export function JobProfileEmbedPanel() {
  return (
    <EmbeddingRebuildPanel
      title="Transformasi Job Profile"
      icon={FileText}
      description={
        <>
          Restrukturisasi &amp; embed ulang <strong>semua</strong> job profile →{' '}
          <code className="font-mono">job_profile_embed</code>, dan hapus dokumen sumbernya sudah tidak ada.
        </>
      }
      loadStatus={loadStatus}
      startPlan={startRebuildAction}
      processBatch={processRebuildBatchAction}
      cancel={cancelRebuildAction}
    />
  );
}
