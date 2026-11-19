import { AlertTriangle } from 'lucide-react';
import type { JobFamilyStats } from '@/lib/job-family-actions';
import type { TopicRunSummary, TopicResults } from '@/lib/job-family-topics-actions';
import { TopicModelingPanel } from '@/components/job-family/topic-modeling-panel';

/**
 * The Job Family map.
 *
 * A row of four stat chips (Job Profile / Ter-embed / Menunggu / Model) used to
 * sit here, one of them hiding the embedding action behind a 28px icon. The
 * same numbers are now the values of the pipeline steps inside
 * TopicModelingPanel, next to the buttons that change them — a count and the
 * control that moves it belong together, and the fourth chip ("Model", value
 * "1") answered a question nobody on this page asks; the model name is printed
 * in step 2's detail line instead.
 */
export function FamilyTreeView({
  stats,
  latestRun,
  latestResults,
  showEmbedSync = false,
  focusTopicId = null,
  focusFamily = null,
  tenantLabel = null,
}: {
  stats: JobFamilyStats;
  latestRun: TopicRunSummary | null;
  latestResults: TopicResults | null;
  /** Deep-link target: open this family's card on first paint. */
  focusTopicId?: number | null;
  focusFamily?: string | null;
  /** Offer the pipeline's controls (embedding + build). Requires job_profiles.manage. */
  showEmbedSync?: boolean;
  /** Active business unit — printed on the exported job-family report. */
  tenantLabel?: string | null;
}) {
  return (
    <div className="space-y-6">
      {!stats.pgvectorReady && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/70 bg-amber-500/5 p-4 dark:border-amber-900/50">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Ekstensi pgvector belum aktif
            </p>
            <p className="text-xs text-amber-700/90 dark:text-amber-300/90 leading-relaxed">
              Tabel <code className="font-mono">job_profile_embed</code> membutuhkan ekstensi
              PostgreSQL <code className="font-mono">pgvector</code>. Install pgvector di server
              PostgreSQL, lalu jalankan migrasi{' '}
              <code className="font-mono">drizzle/0031_job_family_embeddings.sql</code> (mis.{' '}
              <code className="font-mono">tsx scripts/apply-sql.ts drizzle/0031_job_family_embeddings.sql</code>).
              Setelah itu langkah 2 pada alur di bawah bisa dijalankan.
            </p>
          </div>
        </div>
      )}

      {/* Pipeline steps + BERTopic run trigger, live progress, and results. */}
      <TopicModelingPanel
        initialRun={latestRun}
        initialResults={latestResults}
        embeddedCount={stats.embeddedCount}
        completedProfiles={stats.completedProfiles}
        pendingCount={stats.pendingCount}
        embeddingModel={stats.embeddingModel}
        canManage={showEmbedSync}
        showEmbedGuidance={showEmbedSync}
        pgvectorReady={stats.pgvectorReady}
        focusTopicId={focusTopicId}
        focusFamily={focusFamily}
        embeddingDimensions={stats.embeddingDimensions ?? undefined}
        tenantLabel={tenantLabel}
      />
    </div>
  );
}
