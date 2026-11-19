'use client';

// Kamus-Kompetensi embedding panel (on /settings/sync). Turns each competency
// (sync_kamus_kompetensi) into a document vector in kamus_kompetensi_embed
// (pgvector). Thin wrapper over the shared EmbeddingRebuildPanel — see that file
// for the batched plan → process → cancel flow and live progress UI.

import { BookOpen } from 'lucide-react';
import { EmbeddingRebuildPanel } from '@/components/embedding-rebuild-panel';
import {
  getKamusEmbedStatusAction,
  startKamusEmbedAction,
  processKamusEmbedBatchAction,
  cancelKamusEmbedAction,
} from '@/lib/kamus-embed-actions';

export function KamusEmbedPanel() {
  return (
    <EmbeddingRebuildPanel
      title="Transformasi Kamus Kompetensi"
      icon={BookOpen}
      description={
        <>
          Vektor dokumen tiap kompetensi →{' '}
          <code className="font-mono">kamus_kompetensi_embed</code>.
        </>
      }
      loadStatus={getKamusEmbedStatusAction}
      startPlan={startKamusEmbedAction}
      processBatch={processKamusEmbedBatchAction}
      cancel={cancelKamusEmbedAction}
    />
  );
}
