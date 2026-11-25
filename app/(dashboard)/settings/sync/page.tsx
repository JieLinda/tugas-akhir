import { DashboardHeader } from '@/components/dashboard-header';
import { Suspense } from 'react';
import { Brain } from 'lucide-react';
import { db } from '@/lib/db';
import { listTenants } from '@/lib/tenant';
import {
  listCompanyTenantMappings,
  getSyncStats,
  getLatestSyncRunsAction,
  listSyncRunsAction,
} from '@/lib/sync-actions';
import { SyncSettingsClient } from '@/components/settings/sync-settings-client';
import { SourceConnectionsCard } from '@/components/settings/source-connections-card';
import { CandidateDataCard } from '@/components/settings/candidate-data-card';

const SHOW_SOURCE_CONNECTIONS = false;
const SHOW_CANDIDATE_MAINTENANCE = false;
import { EmbeddingTabContent } from '@/components/settings/embedding-tab-content';
import { CollapsibleCard } from '@/components/settings/collapsible-card';
import { requirePagePermission } from '@/lib/rbac';
import { getJobFamilyConfig, getEmbeddingModelsAction } from '@/lib/job-family-actions';

export const dynamic = 'force-dynamic';


export default async function SyncSettingsPage() {
  await requirePagePermission('sync.manage');
  const [mappings, allTenants, stats, latestRuns, runHistory, jobFamilyConfig, embeddingModels] =
    await Promise.all([
      listCompanyTenantMappings(),
      // Live companies only: a removed one (drizzle/0100) must not be offered as a mapping target.
      listTenants().then((rows) => rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug })).sort((x, y) => x.name.localeCompare(y.name))),
      getSyncStats(),
      getLatestSyncRunsAction(),
      listSyncRunsAction({ page: 1, pageSize: 25 }),
      getJobFamilyConfig(),
      getEmbeddingModelsAction().catch(() => []),
    ]);

  return (
    <>
      <DashboardHeader
        title="Sinkronisasi"
        info="Tarik data HR ke Pulse dan unggah berkas sumber. Sinkronisasi terjadwal berjalan otomatis setiap Senin 01.00; halaman ini untuk menjalankannya lebih awal, mengunggah berkas, dan memeriksa apakah datanya segar."
      />
      <div className="flex-1 overflow-auto p-6">
        <SyncSettingsClient
          mappings={mappings.map((m) => ({
            id: m.id,
            companyId: m.companyId,
            tenantId: m.tenantId,
            label: m.label,
            isActive: m.isActive,
            tenantName: m.tenantName ?? '—',
            tenantSlug: m.tenantSlug ?? '',
            createdAt: m.createdAt.toISOString(),
            updatedAt: m.updatedAt.toISOString(),
          }))}
          tenants={allTenants}
          stats={stats}
          latestRuns={latestRuns}
          initialRunHistory={runHistory}
          knowledge={
            <CollapsibleCard
              defaultOpen={false}
              storageKey="sync:knowledge"
              accent="neutral"
              title={
                <>
                  <Brain className="h-4 w-4" />
                  Pengetahuan AI — embedding &amp; pemetaan nama kompetensi
                </>
              }
              description="Mengubah job profile dan kamus kompetensi menjadi vektor yang dibaca penilaian teknis & relevansi karier (AHP+TOPSIS) dan peta Job Family. Jalankan setelah mengunggah job profile atau kamus baru; tombol yang sama juga ada di Peta Job Family."
            >
              <Suspense
                fallback={
                  <p className="py-12 text-center text-sm text-muted-foreground">Memuat konfigurasi embedding…</p>
                }
              >
                <EmbeddingTabContent initialConfig={jobFamilyConfig} availableModels={embeddingModels} />
              </Suspense>
            </CollapsibleCard>
          }
          connections={SHOW_SOURCE_CONNECTIONS ? <SourceConnectionsCard /> : undefined}
          maintenance={SHOW_CANDIDATE_MAINTENANCE ? <CandidateDataCard /> : undefined}
        />
      </div>
    </>
  );
}
