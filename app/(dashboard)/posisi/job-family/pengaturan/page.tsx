import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { hasPermission } from '@/lib/rbac';
import {
  getJobFamilyConfig,
  getJobFamilyStats,
  getEmbeddingModelsAction,
  getRestructureSampleAction,
  listJobProfileOptionsAction,
} from '@/lib/job-family-actions';
import { ConfigurationClient } from '@/components/job-family/configuration-client';
import { JobFamilyTraceExportButton } from '@/components/job-family/trace-export-button';
import { latestRunTraceSummary } from '@/lib/job-family-trace/load';
import { getCurrentTenantId } from '@/lib/tenant';
import { formatDateTime } from '@/lib/datetime';
import { InfoHint } from '@/components/ui/info-hint';

export const metadata = {
  title: 'Pengaturan Job Family | PULSE Command Center',
  description: 'Template restrukturisasi dokumen dan parameter pipeline BERTopic.',
};

// Settings sub-page of the Job Family section. Hidden from the hub strip (see
// `hidden` in lib/navigation.ts) — it is reached from the button on the map,
// and the strip keeps "Job Family" lit while it is open. The hub layout's
// `dynamic = 'force-dynamic'` covers this route too, so a save followed by
// router.refresh() re-reads the config without a revalidatePath of its own.
export default async function JobFamilySettingsPage() {
  const tenantId = await getCurrentTenantId();
  const [config, stats, initialSample, profileOptions, models, canManage, traceRun] = await Promise.all([
    getJobFamilyConfig(),
    getJobFamilyStats(),
    getRestructureSampleAction().catch(() => null),
    listJobProfileOptionsAction().catch(() => []),
    getEmbeddingModelsAction().catch(() => []),
    hasPermission('job_profiles.manage'),
    latestRunTraceSummary(tenantId).catch(() => null),
  ]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="space-y-5">
        {/* Nothing on this page changes the map by itself, and that was the
            single most confusing thing about it: a reader pressed Simpan, went
            back, and found the same map. So the one sentence that says so stays
            ON the page, beside the way back; the detail of which section feeds
            which pipeline step sits behind its "!". The trace export sits beside
            the way back to the map because it is ABOUT that map: the run it
            exports is the one the map shows. */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/posisi/job-family"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Kembali ke Peta Job Family
            </Link>
            <JobFamilyTraceExportButton
              runId={traceRun?.runId ?? null}
              runLabel={traceRun?.completedAt ? formatDateTime(traceRun.completedAt) : null}
              traceStored={traceRun ? traceRun.traceStored : null}
            />
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/8 px-3 py-1 text-xs font-semibold text-amber-900 dark:text-amber-100">
            Halaman ini mengubah pengaturan, bukan petanya.
            <InfoHint kind="note" title="Kapan pengaturan berlaku" align="end">
              <p>
                Seksi <strong>1</strong> menentukan bagian dokumen yang dibaca mesin dan berlaku saat{' '}
                <strong>langkah 2 (Jalankan Transformasi)</strong> dijalankan ulang.
              </p>
              <p>
                Seksi <strong>2</strong> menentukan cara pengelompokan dan berlaku saat{' '}
                <strong>langkah 3 (Bangun Ulang)</strong>.
              </p>
              <p>Keduanya dijalankan dari halaman Peta Job Family.</p>
            </InfoHint>
          </div>
        </div>
        <ConfigurationClient
          initialConfig={config}
          initialSample={initialSample}
          profileOptions={profileOptions}
          pgvectorReady={stats.pgvectorReady}
          availableModels={models}
          showGuidance
          showOptimizer={canManage}
          canManage={canManage}
        />
      </div>
    </div>
  );
}
