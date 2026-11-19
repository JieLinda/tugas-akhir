import { DashboardHeader } from '@/components/dashboard-header';
import { Suspense } from 'react';
import { Brain } from 'lucide-react';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import {
  listCompanyTenantMappings,
  getSyncStats,
  getLatestSyncRunsAction,
  listSyncRunsAction,
} from '@/lib/sync-actions';
import { SyncSettingsClient } from '@/components/settings/sync-settings-client';
import { SourceConnectionsCard } from '@/components/settings/source-connections-card';
import { CandidateDataCard } from '@/components/settings/candidate-data-card';

/**
 * Two cards of "Pengaturan & Pemeliharaan" are HIDDEN, not deleted (by request,
 * 2026-11): "Koneksi Source Database" and the candidate-data card (clearing the
 * candidate pool). Their components and server actions are untouched, and a
 * stored source connection keeps being used by sync-service (an active row in
 * sync_source_connections still wins over DB_MPMDS_* / DB_MPMHRGA_*) — it just
 * cannot be edited from here. Flip either flag to bring its card back.
 */
const SHOW_SOURCE_CONNECTIONS = false;
const SHOW_CANDIDATE_MAINTENANCE = false;
import { EmbeddingTabContent } from '@/components/settings/embedding-tab-content';
import { CollapsibleCard } from '@/components/settings/collapsible-card';
import { requirePagePermission } from '@/lib/rbac';
import { getJobFamilyConfig, getEmbeddingModelsAction } from '@/lib/job-family-actions';

export const dynamic = 'force-dynamic';

// One page, ordered by how often an operator needs each part:
//   1. status + "Jalankan Sinkronisasi Penuh"      (every visit)
//   2. ringkasan data per modul                    (every visit — is the data fresh?)
//   3. pemetaan Company ID → Company            (decides where every synced row lands)
//   4. unggah berkas sumber                        (the ONLY route for JD/kamus/HAV/MCU)
//   5. sinkronisasi per modul                      (when one source fails)
//   6. riwayat                                     (collapsed — per-module rows already show the last run)
//   7. pengetahuan AI / embedding                  (collapsed — after new JDs; also reachable from Peta Job Family)
//   8. pengaturan & pemeliharaan                   (collapsed — set once, or destructive)
// The former "BERT" tab is section 7. Anything collapsed by default carries a
// one-line summary in its header, so the common question is answered without
// opening it. Every card has its own colour accent (CollapsibleCard `accent`)
// — a light tint on the header band in one of four semantic tones —
// so sections are distinguishable without the page turning into a palette.
export default async function SyncSettingsPage() {
  await requirePagePermission('sync.manage');
  const [mappings, allTenants, stats, latestRuns, runHistory, jobFamilyConfig, embeddingModels] =
    await Promise.all([
      listCompanyTenantMappings(),
      db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants).orderBy(tenants.name),
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
