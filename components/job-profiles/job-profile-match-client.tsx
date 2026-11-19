'use client';

import { useCallback, useState } from 'react';
import { AlertCircle, Link2, Loader2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { SyncMatchView } from '@/components/job-family/sync-match-view';
import {
  getMatchTenantsAction,
  runJobProfileMatchAction,
  type JobFamilyMatchReport,
  type MatchTenant,
} from '@/lib/job-family-sync-actions';

/**
 * Opens on what is already known and runs the live matching only on request.
 *
 * `initialReport` is, in order of preference, the LAST RUN stored for the
 * active Company (job_profile_match_runs — the full report, so every card
 * answers) or the committed mapping rebuilt from job_family_matches
 * (`source: 'saved'`, matched pairs only). Either paints immediately. The live
 * run takes on the order of 20s (see getJobFamilyMatchReport), so building it
 * on mount made merely opening the section look hung; it starts from a button
 * here or from "Jalankan Ulang" inside the report, and every run goes through
 * runJobProfileMatchAction so its result REPLACES the stored run — the next
 * visit opens on it without running anything. It stays a client-side fetch
 * rather than a streamed server response because a proxy with a short read
 * timeout cuts a 20s body mid-stream, and the failure here is recoverable with
 * one click.
 */
export function JobProfileMatchClient({
  activeTenantId,
  initialReport,
  initialTenants,
}: {
  activeTenantId: string;
  /** Last stored run, else the saved mapping; null when neither exists or could be read. */
  initialReport: JobFamilyMatchReport | null;
  initialTenants: MatchTenant[];
}) {
  // A stored run is worth showing even when it matched nothing — its
  // "unmatched" lists are the finding. A saved-mapping fallback with no pairs
  // is an empty table, so that one opens on the empty state instead.
  const hasReport =
    initialReport !== null &&
    (initialReport.source !== 'saved' || initialReport.matched.length > 0);
  const [report, setReport] = useState<JobFamilyMatchReport | null>(
    hasReport ? initialReport : null,
  );
  const [tenants, setTenants] = useState<MatchTenant[]>(initialTenants);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    hasReport ? 'ready' : 'idle',
  );

  const load = useCallback(() => {
    setState('loading');
    Promise.all([
      runJobProfileMatchAction({ tenantIds: [activeTenantId] }),
      getMatchTenantsAction().catch(() => [] as MatchTenant[]),
    ])
      .then(([nextReport, nextTenants]) => {
        setReport(nextReport);
        if (nextTenants.length > 0) setTenants(nextTenants);
        setState('ready');
      })
      .catch(() => setState('error'));
  }, [activeTenantId]);

  const loading = state === 'loading';

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      {/* A title bar now that its explanation sits behind the "?": the card's
          own vertical padding framed a three-line paragraph, not one row. */}
      <Card className="py-0 shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Link2 className="h-4 w-4" />
            </div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              Pencocokan Posisi ↔ Job Profile
              <InfoHint title="Pencocokan Posisi ↔ Job Profile">
                <p>
                  Cocokkan posisi aktif kandidat dengan job profile berdasarkan kode nama file, nama
                  posisi, dan kemiripan embedding — untuk mengidentifikasi celah cakupan job profile
                  serta potensi kebutuhan suksesi.
                </p>
                <p>
                  Hasil pencocokan terakhir tersimpan dan langsung tampil di kunjungan berikutnya;
                  jalankan ulang (±20 detik) hanya bila data posisi atau job profile berubah.
                </p>
              </InfoHint>
            </h3>
          </div>
          {state !== 'ready' && (
            <Button size="sm" className="shrink-0 gap-1.5" onClick={load} disabled={loading}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {loading ? 'Menjalankan…' : 'Jalankan Pencocokan'}
            </Button>
          )}
        </CardContent>
      </Card>

      {report && state === 'ready' ? (
        <SyncMatchView initialReport={report} tenants={tenants} />
      ) : state === 'error' ? (
        <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 py-12 text-center">
          <CardContent className="mx-auto max-w-sm space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-200">Gagal memuat pencocokan</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Terjadi kesalahan saat menyiapkan laporan pencocokan. Coba jalankan lagi.
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5" /> Coba Lagi
            </Button>
          </CardContent>
        </Card>
      ) : loading ? (
        <Card className="shadow-sm border-slate-200/60 dark:border-slate-800/80 bg-white dark:bg-slate-900 py-16 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Menyiapkan laporan pencocokan…</p>
            <p className="text-xs text-muted-foreground/70">
              Membaca posisi aktif, judul dokumen, dan embedding — biasanya 5–20 detik. Hasilnya
              disimpan, jadi ini hanya perlu sekali.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed shadow-none py-14 text-center">
          <CardContent className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Link2 className="h-5 w-5" />
            </div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              Belum ada pencocokan untuk Company ini
              <InfoHint title="Jalankan Pencocokan" align="center">
                <p>
                  Tekan <strong>Jalankan Pencocokan</strong> sekali untuk menyusun pasangan posisi
                  kandidat ↔ job profile. Hasilnya tersimpan dan langsung tampil di kunjungan
                  berikutnya.
                </p>
                <p>
                  Tekan <strong>Simpan Pemetaan</strong> bila pasangannya ingin dipakai fitur lain
                  (saran job profile posisi, peta job family hasil scoring).
                </p>
              </InfoHint>
            </p>
            <Button size="sm" className="mt-1 gap-1.5" onClick={load}>
              <Play className="h-3.5 w-3.5" />
              Jalankan Pencocokan
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
