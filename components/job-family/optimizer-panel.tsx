'use client';

/**
 * Optimasi Job Family — panel tombol di halaman Pengaturan Job Family (/posisi/job-family/pengaturan).
 *
 * Tombol, bukan percakapan: himpunan keinginan yang mungkin terhadap sebuah
 * clustering TERBATAS dan sudah seluruhnya terdaftar (`OPTIMIZE_GOALS`), jadi
 * kotak teks hanya menambah satu langkah tebak-menebak di depan jawaban yang
 * sudah pasti. Panel ini tidak memakai model bahasa sama sekali.
 *
 * Setiap tombol sasaran MENGUKUR, tidak menebak. topic-service menjalankan kode
 * clustering yang sama dengan pembangunan peta pada korpus yang ter-embed
 * SEKARANG, untuk pengaturan yang berlaku lalu untuk kandidatnya, dan hanya
 * kandidat yang terukur mencapai sasaran yang ditawarkan untuk diterapkan
 * (lib/job-family/optimize/search.ts). Karena pipeline-nya deterministik, peta
 * yang dibangun ulang dengan pengaturan itu pada korpus yang sama adalah peta
 * yang terukur — dan sesudah dibangun, panel memeriksanya
 * (`getOptimizationVerificationAction`). Bila tidak ada pengaturan dalam
 * rentang aman yang mencapai sasaran, panel mengatakan itu, bukan menawarkan
 * yang paling dekat seolah berhasil.
 *
 * Diagnosis ("Periksa keadaan sekarang") membaca PETA terakhir, yang bisa basi
 * setelah transformasi ulang; kartu kesegaran di puncak panel mengatakan kapan
 * itu terjadi.
 *
 * Yang TIDAK berubah: setiap penulisan tetap menunggu klik yang memperlihatkan
 * nilai lama → nilai baru lebih dulu, dan pekerjaan panjang tetap dipantau di
 * dalam panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleSlash,
  Gauge,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Tags,
  TriangleAlert,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { InfoHint } from '@/components/ui/info-hint';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/datetime';
import {
  applyMeasuredOptimizationAction,
  getMapFreshnessAction,
  getOptimizationVerificationAction,
  proposeOptimizationAction,
  startOptimizationSearchAction,
  stepOptimizationSearchAction,
  type MapFreshness,
  type OptimizationProposal,
  type OptimizationVerification,
  type SearchDone,
  type SearchStep,
} from '@/lib/job-family-optimize-actions';
import {
  getOutlierExplanationsAction,
  getTopicRunStatusAction,
  startTopicRunAction,
  type OutlierReport,
  type TopicRunSummary,
} from '@/lib/job-family-topics-actions';
import type { OptimizeGoal } from '@/lib/job-family/optimize/objective';
import type { EvaluatedTrial } from '@/lib/job-family/optimize/search';
import type { MeasuredMetrics } from '@/lib/job-family/optimize/measured';

const MINIMIZED_KEY = 'pulse.jobFamilyOptimizer.minimized';

/**
 * Setiap tombol = satu sasaran di `OPTIMIZE_GOALS`, tanpa kecuali.
 *
 * Labelnya dinyatakan sebagai HASIL yang diinginkan, bukan nama parameter, karena
 * itulah satu-satunya bentuk yang user memang tahu ia inginkan. `hint` menyebut
 * ukuran yang dipakai menilainya, supaya "tercapai" dapat diperiksa.
 */
const GROUPS: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  goals: { goal: OptimizeGoal; label: string; hint: string }[];
}[] = [
  {
    title: 'Outlier',
    icon: Users,
    goals: [
      {
        goal: 'reduce_outliers',
        label: 'Kurangi outlier',
        hint: 'Tercapai bila persentase outlier turun lebih dari 0,5 poin.',
      },
      {
        goal: 'no_outliers',
        label: 'Nol outlier',
        hint: 'Tercapai hanya bila tidak tersisa satu pun outlier — setiap jabatan dipaksa masuk rumpun terdekat.',
      },
      {
        goal: 'strict_outliers',
        label: 'Sisakan yang benar-benar asing',
        hint: 'Tercapai bila tidak ada jabatan yang dekat sebuah rumpun tertinggal di luar, dan tidak ada yang jauh dipaksa masuk.',
      },
    ],
  },
  {
    title: 'Ukuran & jumlah famili',
    icon: Layers,
    goals: [
      {
        goal: 'bigger_clusters',
        label: 'Perbesar cluster',
        hint: 'Tercapai bila median anggota per famili naik.',
      },
      {
        goal: 'smaller_clusters',
        label: 'Perkecil cluster',
        hint: 'Tercapai bila median anggota per famili turun.',
      },
      {
        goal: 'fewer_topics',
        label: 'Lebih sedikit famili',
        hint: 'Tercapai bila jumlah famili berkurang.',
      },
      {
        goal: 'more_topics',
        label: 'Lebih banyak famili',
        hint: 'Tercapai bila jumlah famili bertambah.',
      },
      {
        goal: 'split_dominant',
        label: 'Pecah famili raksasa',
        hint: 'Tercapai bila porsi famili terbesar turun lebih dari 2 poin.',
      },
      {
        goal: 'remove_tiny',
        label: 'Hapus famili kekecilan',
        hint: 'Tercapai bila tidak ada famili beranggota kurang dari 3.',
      },
      {
        goal: 'balance_sizes',
        label: 'Ratakan ukuran',
        hint: 'Tercapai bila ketimpangan ukuran famili (koefisien variasi) turun minimal 10%.',
      },
    ],
  },
  {
    title: 'Penamaan',
    icon: Tags,
    goals: [
      {
        goal: 'cleaner_labels',
        label: 'Perbaiki nama & kata kunci',
        hint: 'Tercapai bila keanggotaan tidak berubah dan kata kunci yang dipakai bersama antarfamili berkurang.',
      },
    ],
  },
  {
    title: 'Umum',
    icon: Wand2,
    goals: [
      {
        goal: 'balance',
        label: 'Rapikan seadanya',
        hint: 'Tercapai bila skor mutu keseluruhan naik tanpa satu pun ukuran yang memburuk.',
      },
    ],
  },
];

const GOAL_LABEL: Record<string, string> = Object.fromEntries(
  GROUPS.flatMap((g) => g.goals.map((x) => [x.goal, x.label])),
);

const SEVERITY_STYLE: Record<string, { box: string; icon: React.ComponentType<{ className?: string }> }> = {
  critical: { box: 'border-red-300/70 bg-red-500/5 dark:border-red-900/50', icon: AlertTriangle },
  warning: { box: 'border-amber-300/70 bg-amber-500/5 dark:border-amber-900/50', icon: TriangleAlert },
  info: { box: 'border-blue-300/70 bg-blue-500/5 dark:border-blue-900/50', icon: Info },
  ok: { box: 'border-emerald-300/70 bg-emerald-500/5 dark:border-emerald-900/50', icon: CheckCircle2 },
};

const BLOCKED_LABEL: Record<string, string> = {
  rehoming_off: 'Penempatan ulang outlier belum dinyalakan',
  below_threshold: 'Kemiripannya di bawah ambang yang ditetapkan',
  rehoming_failed: 'Penempatan ulang aktif tetapi gagal menempatkannya',
};

const ISOLATION_LABEL: Record<string, { text: string; tone: string }> = {
  fringe: { text: 'Di pinggir sebuah famili', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  between: { text: 'Terjepit dua famili', tone: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
  distant: { text: 'Jauh dari semuanya', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  isolated: { text: 'Tidak menyerupai apa pun', tone: 'bg-red-500/10 text-red-700 dark:text-red-300' },
};

const TONE = {
  ok: 'border-emerald-300/70 bg-emerald-500/5 text-emerald-800 dark:border-emerald-900/50 dark:text-emerald-200',
  warn: 'border-amber-300/70 bg-amber-500/5 text-amber-800 dark:border-amber-900/50 dark:text-amber-200',
  bad: 'border-red-300/70 bg-red-500/5 text-red-800 dark:border-red-900/50 dark:text-red-200',
  info: 'border-blue-300/70 bg-blue-500/5 text-blue-800 dark:border-blue-900/50 dark:text-blue-200',
} as const;

const RUNNING = (s: string) => s === 'pending' || s === 'processing';

/** Between search steps: topic-service measures a config in roughly this time once warm. */
const SEARCH_POLL_MS = 1500;

export function OptimizerPanel({
  canManage = false,
  unsavedParams = false,
  onConfigApplied,
}: {
  canManage?: boolean;
  /** The parameter card below holds unsaved edits; the panel measures the SAVED setting. */
  unsavedParams?: boolean;
  /**
   * Dipanggil setelah parameter benar-benar tersimpan, supaya kartu "Parameter
   * Pipeline BERTopic" di bawah panel mengambil nilai yang baru berlaku alih-alih
   * tetap menampilkan yang lama.
   */
  onConfigApplied?: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<OptimizationProposal | null>(null);
  const [outliers, setOutliers] = useState<OutlierReport | null>(null);
  const [search, setSearch] = useState<(SearchStep & { goal?: OptimizeGoal }) | null>(null);
  const [freshness, setFreshness] = useState<MapFreshness | null>(null);
  const [verification, setVerification] = useState<OptimizationVerification | null>(null);
  const [run, setRun] = useState<TopicRunSummary | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchToken = useRef(0);

  useEffect(() => {
    try {
      setMinimized(window.localStorage.getItem(MINIMIZED_KEY) === '1');
    } catch {
      /* penyimpanan lokal diblokir — panel terbuka, dan itu bukan kegagalan */
    }
  }, []);

  const refreshState = useCallback(async (runId?: string) => {
    const [f, v] = await Promise.all([
      getMapFreshnessAction().catch(() => null),
      getOptimizationVerificationAction(runId).catch(() => null),
    ]);
    setFreshness(f);
    setVerification(v);
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  function toggleMinimized() {
    setMinimized((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(MINIMIZED_KEY, next ? '1' : '0');
      } catch {
        /* diabaikan dengan sengaja */
      }
      return next;
    });
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);
  useEffect(() => stopPolling, [stopPolling]);
  // Leaving the page ends the search loop; topic-service finishes its batch on its own.
  useEffect(() => () => void (searchToken.current += 1), []);

  /**
   * Pantau run yang sedang berjalan.
   *
   * Interval 2 detik, sama dengan panel Peta — bukan angka yang dipilih bebas:
   * `job_family_topic_runs.progress` ditulis per fase oleh topic-service, dan
   * memeriksanya lebih sering hanya menambah kueri tanpa menambah kabar.
   */
  const watchRun = useCallback(
    (runId: string) => {
      stopPolling();
      const tick = async () => {
        const next = await getTopicRunStatusAction(runId).catch(() => null);
        if (!next) return;
        setRun(next);
        if (next.status === 'completed') {
          stopPolling();
          toast.success(`Peta job family dibangun ulang — ${next.numTopics} famili.`);
          // Diagnosis lama dihitung dari run SEBELUMNYA, jadi ia sudah tidak berlaku.
          setProposal(null);
          setOutliers(null);
          void refreshState(runId);
        } else if (next.status === 'failed') {
          stopPolling();
          toast.error(next.error ?? 'Pembangunan peta gagal.');
        }
      };
      pollRef.current = setInterval(tick, 2000);
      void tick();
    },
    [stopPolling, refreshState],
  );

  async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    if (busy) return null;
    setBusy(key);
    try {
      return await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menjalankan.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  /**
   * One search, start to answer. Steps run one after another (never two at a
   * time): a step may start the next round, and a second concurrent step would
   * try to start it again.
   */
  async function measure(goal: OptimizeGoal) {
    if (busy || searching) return;
    const token = ++searchToken.current;
    setOutliers(null);
    setSearch({ status: 'running', goal, handle: { goal, trialIds: [] }, round: 0, done: 0, total: 1, message: 'Memulai pengukuran…' });
    let step: SearchStep = await startOptimizationSearchAction({ goal }).catch((e: unknown) => ({
      status: 'failed' as const,
      message: e instanceof Error ? e.message : 'Gagal memulai pengukuran.',
    }));
    while (token === searchToken.current) {
      setSearch({ ...step, goal });
      if (step.status !== 'running') break;
      await new Promise((r) => setTimeout(r, SEARCH_POLL_MS));
      if (token !== searchToken.current) break;
      const handle = step.handle;
      step = await stepOptimizationSearchAction(handle).catch((e: unknown) => ({
        status: 'failed' as const,
        message: e instanceof Error ? e.message : 'Pengukuran terputus.',
      }));
    }
  }

  function cancelSearch() {
    searchToken.current += 1;
    setSearch(null);
  }

  async function inspect() {
    const p = await withBusy('inspect', () => proposeOptimizationAction());
    if (!p) return;
    setOutliers(null);
    setProposal(p);
  }

  async function showOutliers() {
    const r = await withBusy('outliers', () => getOutlierExplanationsAction());
    if (!r) return;
    setProposal(null);
    setOutliers(r);
    if (r.outliers.length === 0) {
      toast.info(
        r.totalOutliersInRun === 0
          ? 'Tidak ada outlier pada run terakhir.'
          : 'Outlier pada run ini bukan milik unit bisnis Anda.',
      );
    }
  }

  async function apply(done: SearchDone, thenRebuild: boolean) {
    const chosen = done.chosen;
    if (!chosen) return;
    const res = await withBusy('apply', () =>
      applyMeasuredOptimizationAction({ handle: done.handle, key: chosen.key }),
    );
    if (!res) return;
    toast.success(res.message);
    if (!res.expectationSaved) {
      toast.warning(
        'Pengukurannya tidak tercatat (migrasi drizzle/0090 belum dijalankan), jadi peta baru tidak dapat dicek terhadapnya.',
      );
    }
    setSearch(null);
    onConfigApplied?.();
    void refreshState();
    if (thenRebuild) await rebuild();
  }

  async function rebuild() {
    const res = await withBusy('rebuild', () => startTopicRunAction('global'));
    if (!res) return;
    if (!res.ok || !res.runId) {
      toast.error(res.message);
      return;
    }
    toast.success(res.message);
    watchRun(res.runId);
  }

  const running = run != null && RUNNING(run.status);
  const searching = search?.status === 'running';

  return (
    <section
      className={cn(
        'overflow-hidden rounded-2xl border transition',
        'border-primary/30 bg-linear-to-br from-primary/10 via-primary/4 to-transparent',
        minimized ? 'shadow-none' : 'shadow-[0_24px_48px_-40px_rgba(234,88,12,0.85)]',
      )}
    >
      {/* ── Kepala ── */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="size-4.5" />
        </span>
        <h3 className="flex min-w-0 flex-1 items-center gap-1.5 text-sm font-semibold">
          Optimasi Job Family
          <InfoHint title="Optimasi Job Family">
            <p>
              Pilih hasil yang Anda inginkan — pengaturannya diukur pada korpus sekarang sebelum
              ditawarkan, dan tidak ada yang tersimpan sebelum Anda menyetujuinya.
            </p>
          </InfoHint>
        </h3>
        {(running || searching) && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <Loader2 className="size-3 animate-spin" />
            {running ? 'Membangun peta' : 'Mengukur'}
          </span>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0"
          onClick={toggleMinimized}
          aria-expanded={!minimized}
          aria-label={minimized ? 'Buka panel optimasi' : 'Kecilkan panel optimasi'}
        >
          <ChevronDown className={cn('size-4 transition', minimized && '-rotate-90')} />
        </Button>
      </div>

      {/* Disembunyikan dengan CSS, bukan dilepas: pemantauan run dan pengukuran
          hidup di komponen ini, dan mengecilkan panel di tengah jalan tidak
          boleh menghentikannya. */}
      <div className={cn(minimized && 'hidden')}>
        <div className="space-y-4 border-t border-primary/15 bg-card/60 px-4 py-3.5 backdrop-blur">
          {!canManage && (
            <Note tone="warn" icon={TriangleAlert}>
              Anda dapat memeriksa dan mengukur, tetapi menerapkan hasilnya membutuhkan izin pengelolaan
              job profile.
            </Note>
          )}

          <FreshnessNotice freshness={freshness} />

          {verification && (
            <VerificationCard
              v={verification}
              onRemeasure={() => void measure(verification.goal)}
              disabled={!!busy || searching || running}
              onClose={() => setVerification(null)}
            />
          )}

          {/* ── Tombol pemeriksaan ── */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Langkah 1 · Lihat keadaan peta sekarang
          </p>
          <div className="-mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void inspect()} disabled={!!busy || searching}>
              {busy === 'inspect' ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-3.5" />
              )}
              Periksa keadaan sekarang
            </Button>
            <Button size="sm" variant="outline" onClick={() => void showOutliers()} disabled={!!busy || searching}>
              {busy === 'outliers' ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Users className="mr-1.5 size-3.5" />
              )}
              Rincian tiap outlier
            </Button>
            {/* A third standalone "Bangun ulang peta" used to sit here, beside
                two read-only diagnostics. It is gone, not hidden: rebuilding is
                step 3 of the flow on the map page, and the one rebuild that
                belongs to THIS panel — the one that applies a measured setting —
                is the filled button on the result card below. */}
          </div>

          {/* ── Progres run ── */}
          {run && RUNNING(run.status) && (
            <div className="rounded-xl border bg-muted/10 p-3">
              <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
                <Loader2 className="size-3.5 animate-spin text-primary" />
                {run.progress?.message ?? 'Memproses…'}
              </div>
              <Progress
                value={
                  run.progress?.total
                    ? Math.round(((run.progress.done ?? 0) / run.progress.total) * 100)
                    : 5
                }
                className="h-1.5"
              />
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                Fase <span className="font-mono">{run.progress?.phase ?? '—'}</span> ·{' '}
                {run.numDocuments} dokumen · biarkan tab ini terbuka untuk memantau
              </p>
            </div>
          )}

          {/* ── Hasil: diagnosis ── */}
          {proposal && (
            <DiagnosisCard
              proposal={proposal}
              stale={freshness?.state === 'stale'}
              disabled={!!busy || searching || running}
              onMeasure={(goal) => {
                setProposal(null);
                void measure(goal);
              }}
              onClose={() => setProposal(null)}
            />
          )}

          {/* ── Tombol sasaran, dikelompokkan ── */}
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Langkah 2 · Pilih hasil yang Anda inginkan
          </p>
          {unsavedParams && (
            <Note tone="info" icon={Info}>
              Kartu parameter di bawah memuat perubahan yang belum disimpan. Pengukuran memakai pengaturan
              yang <strong>tersimpan</strong>.
            </Note>
          )}
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-1.5">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                <g.icon className="size-3" />
                {g.title}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.goals.map((x) => (
                  <button
                    key={x.goal}
                    type="button"
                    title={x.hint}
                    disabled={!!busy || searching || running}
                    onClick={() => void measure(x.goal)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50',
                      search?.goal === x.goal
                        ? 'border-primary/60 bg-primary/15 text-primary'
                        : 'border-primary/25 bg-card/80 hover:border-primary/50 hover:bg-primary/10',
                    )}
                  >
                    {searching && search?.goal === x.goal && <Loader2 className="size-3 animate-spin" />}
                    {x.label}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* ── Hasil: pengukuran ── */}
          {search?.status === 'running' && <SearchProgressCard step={search} onCancel={cancelSearch} />}
          {search?.status === 'failed' && (
            <div className={cn('flex items-start gap-2 rounded-xl border p-3 text-[11px] leading-relaxed', TONE.bad)}>
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
              <span className="flex-1">
                <strong>Pengukuran {search.goal ? `"${GOAL_LABEL[search.goal]}" ` : ''}tidak selesai.</strong>{' '}
                {search.message}
              </span>
              <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={() => setSearch(null)} aria-label="Tutup">
                <X className="size-3.5" />
              </Button>
            </div>
          )}
          {search?.status === 'done' && (
            <SearchResultCard
              done={search}
              busy={busy}
              canManage={canManage}
              onApply={(rebuildAfter) => void apply(search, rebuildAfter)}
              onClose={() => setSearch(null)}
            />
          )}

          {/* ── Hasil: rincian outlier ── */}
          {outliers && outliers.outliers.length > 0 && (
            <OutlierCard report={outliers} onClose={() => setOutliers(null)} />
          )}
        </div>
      </div>
    </section>
  );
}

// ── Kesegaran peta ─────────────────────────────────────────────────────

function FreshnessNotice({ freshness }: { freshness: MapFreshness | null }) {
  if (!freshness || freshness.state === 'unavailable') return null;
  if (freshness.state === 'no_run') {
    return (
      <Note tone="info" icon={Info}>
        Belum ada peta job family yang selesai dibangun. Pengukuran sasaran tetap dapat dijalankan pada
        korpus yang ter-embed.
      </Note>
    );
  }
  const scope = freshness.run?.scope === 'tenant' ? ' (peta khusus unit bisnis ini)' : '';
  const configLine = freshness.configChanged ? (
    <p className="mt-1">
      Parameter yang berlaku juga sudah berbeda dari parameter peta ini, jadi peta belum mencerminkan
      pengaturan sekarang.
    </p>
  ) : null;

  if (freshness.state === 'fresh') {
    return (
      <Note tone={freshness.configChanged ? 'warn' : 'ok'} icon={freshness.configChanged ? TriangleAlert : CheckCircle2}>
        <span>
          Peta terakhir{scope} sesuai dengan korpus yang ter-embed sekarang ({freshness.corpus?.documents}{' '}
          dokumen).
        </span>
        {configLine}
      </Note>
    );
  }
  if (freshness.state === 'unverifiable') {
    return (
      <Note tone={freshness.configChanged ? 'warn' : 'info'} icon={Info}>
        {freshness.reasons.map((r) => (
          <p key={r}>{r}</p>
        ))}
        {configLine}
      </Note>
    );
  }
  return (
    <Note tone="warn" icon={TriangleAlert}>
      <p className="font-semibold">Peta terakhir{scope} sudah tidak sesuai dengan korpus sekarang.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {freshness.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {configLine}
      <p className="mt-1">
        &ldquo;Periksa keadaan sekarang&rdquo; dan &ldquo;Rincian tiap outlier&rdquo; membaca peta itu. Tombol
        sasaran di bawah selalu mengukur pada korpus sekarang. Bangun ulang peta agar keduanya sama.
      </p>
    </Note>
  );
}

// ── Kartu diagnosis ────────────────────────────────────────────────────

function DiagnosisCard({
  proposal,
  stale,
  disabled,
  onMeasure,
  onClose,
}: {
  proposal: OptimizationProposal;
  stale: boolean;
  disabled: boolean;
  onMeasure: (goal: OptimizeGoal) => void;
  onClose: () => void;
}) {
  const m = proposal.metrics;
  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Chip tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{m.topicCount} famili</Chip>
          <Chip>{m.numDocuments} dokumen</Chip>
          <Chip
            tone={
              m.outlierPct >= 30
                ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                : m.outlierPct >= 12
                  ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : undefined
            }
          >
            {m.outlierPct}% outlier ({m.outlierCount})
          </Chip>
          <Chip>famili terbesar {Math.round(m.largestShare * 100)}%</Chip>
          {m.tinyCount > 0 && <Chip>{m.tinyCount} famili &lt; 3 anggota</Chip>}
        </div>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose} aria-label="Tutup">
          <X className="size-3.5" />
        </Button>
      </div>

      {stale && (
        <p className={cn('rounded-lg border p-2 text-[11px] leading-relaxed', TONE.warn)}>
          Angka di atas berasal dari peta terakhir, yang dibangun dari korpus lama. Pengukuran sasaran memakai
          korpus sekarang, jadi angkanya bisa berbeda.
        </p>
      )}

      {proposal.failedNewerRun && (
        <p className={cn('rounded-lg border p-2 text-[11px] leading-relaxed', TONE.warn)}>
          Ada run yang lebih baru dan GAGAL, jadi angka di atas bukan dari percobaan terakhir Anda.
          {proposal.failedNewerRun.error ? ` Penyebabnya: ${proposal.failedNewerRun.error}` : ''}
        </p>
      )}

      {proposal.findings.length > 0 && (
        <ul className="space-y-1.5">
          {proposal.findings.slice(0, 4).map((f) => {
            const st = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info!;
            return (
              <li key={f.code} className={cn('flex gap-2 rounded-lg border p-2', st.box)}>
                <st.icon className="mt-px size-3.5 shrink-0 opacity-80" />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-[11px] font-semibold leading-snug">{f.title}</p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">{f.evidence}</p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground/90">{f.soWhat}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
        <span className="text-[11px] text-muted-foreground">
          Sasaran yang paling sesuai: <strong className="text-foreground">{GOAL_LABEL[proposal.goal]}</strong>
        </span>
        <Button size="sm" variant="outline" onClick={() => onMeasure(proposal.goal)} disabled={disabled}>
          <Gauge className="mr-1.5 size-3.5" />
          Ukur sasaran ini
        </Button>
      </div>
    </div>
  );
}

// ── Pengukuran ─────────────────────────────────────────────────────────

function SearchProgressCard({
  step,
  onCancel,
}: {
  step: Extract<SearchStep, { status: 'running' }> & { goal?: OptimizeGoal };
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-primary/25 bg-card p-3">
      <div className="mb-1.5 flex items-center gap-2 text-xs font-medium">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        <span className="flex-1">
          {step.goal ? <strong>{GOAL_LABEL[step.goal]}: </strong> : null}
          {step.message}{' '}
          <InfoHint title="Cara mengukur" size="xs">
            <p>
              Tiap pengaturan dijalankan dengan kode clustering yang sama dengan pembangunan peta,
              tanpa menyimpan apa pun. Putaran berikutnya dipilih dari hasil putaran ini.
            </p>
          </InfoHint>
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onCancel}>
          Hentikan
        </Button>
      </div>
      <Progress value={step.total ? Math.max(5, Math.round((step.done / step.total) * 100)) : 5} className="h-1.5" />
    </div>
  );
}

function SearchResultCard({
  done,
  busy,
  canManage,
  onApply,
  onClose,
}: {
  done: SearchDone;
  busy: string | null;
  canManage: boolean;
  onApply: (rebuildAfter: boolean) => void;
  onClose: () => void;
}) {
  const header = {
    met: { tone: TONE.ok, icon: CheckCircle2, text: 'Sasaran tercapai — terukur' },
    met_with_regressions: {
      tone: TONE.warn,
      icon: TriangleAlert,
      text: 'Sasaran tercapai, tetapi ada ukuran lain yang memburuk',
    },
    already_met: { tone: TONE.ok, icon: CheckCircle2, text: 'Sudah tercapai dengan pengaturan sekarang' },
    not_met: { tone: TONE.bad, icon: CircleSlash, text: 'Tidak tercapai dalam rentang aman' },
  }[done.outcome];
  const chosen = done.chosen;

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold">{GOAL_LABEL[done.goal]}</p>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
              header.tone,
            )}
          >
            <header.icon className="size-3" />
            {header.text}
          </span>
          <p className="text-[10px] text-muted-foreground">
            Diukur pada korpus sekarang: {done.corpus.documents} dokumen · {done.trials} pengaturan diukur,
            termasuk yang berlaku{done.rounds > 0 ? `, dalam ${done.rounds} putaran` : ''}.
          </p>
        </div>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose} aria-label="Tutup">
          <X className="size-3.5" />
        </Button>
      </div>

      <MetricChips label="Sekarang" m={done.baseline} />

      {done.threshold && (
        <p className="rounded-lg border bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground/90">Ambang dari data: </span>
          {done.threshold.rationale}
        </p>
      )}

      {done.outcome === 'already_met' && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {done.alreadyMet} Tidak ada yang perlu diubah.
        </p>
      )}

      {chosen && <CandidateDetail e={chosen} />}

      {chosen && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
          <Button size="sm" onClick={() => onApply(true)} disabled={!!busy || !canManage}>
            {busy === 'apply' ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Terapkan &amp; bangun ulang peta
          </Button>
          <Button size="sm" variant="outline" onClick={() => onApply(false)} disabled={!!busy || !canManage}>
            Simpan saja, bangun nanti
          </Button>
          <span className="text-[10px] leading-snug text-muted-foreground">
            Berlaku untuk <strong>semua unit bisnis</strong>. Ditolak bila korpus atau parameter berubah
            sebelum diterapkan — hasil ini hanya berlaku untuk korpus yang diukur.
          </span>
        </div>
      )}

      {done.outcome === 'not_met' && (
        <div className="space-y-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Tidak satu pun pengaturan dalam rentang amannya mencapai sasaran ini pada korpus sekarang, jadi
            tidak ada yang ditawarkan untuk diterapkan.
          </p>
          {done.closest && (
            <div className="rounded-lg border border-dashed p-2">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Paling mendekati (belum mencapai sasaran)
              </p>
              <CandidateDetail e={done.closest} />
            </div>
          )}
        </div>
      )}

      {(done.tried.length > 0 || done.failed.length > 0) && (
        // Open when nothing met the goal: the measurements ARE the answer then.
        <details className="rounded-lg border bg-muted/10 p-2 text-[11px]" open={done.outcome === 'not_met'}>
          <summary className="cursor-pointer select-none font-medium text-muted-foreground">
            Semua yang diukur ({done.tried.length + done.failed.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {done.tried.map((e) => (
              <li key={e.key} className="rounded-md border bg-card p-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip
                    tone={
                      e.verdict.met
                        ? e.regressions.length
                          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : undefined
                    }
                  >
                    {e.verdict.met ? (e.regressions.length ? 'tercapai, ada yang memburuk' : 'tercapai') : 'belum'}
                  </Chip>
                  <span className="text-[10px] text-muted-foreground">putaran {e.round}</span>
                </div>
                <p className="mt-1 text-[10px] leading-relaxed">{e.verdict.summary}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {e.changes.map((c) => `${c.key} ${c.from}→${c.to}`).join(' · ')}
                </p>
              </li>
            ))}
            {done.failed.map((f) => (
              <li key={f.key} className={cn('rounded-md border p-2 text-[10px]', TONE.bad)}>
                Gagal diukur: {f.error}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CandidateDetail({ e }: { e: EvaluatedTrial }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold leading-snug">{e.verdict.summary}</p>
      <MetricChips label="Sesudah" m={e.metrics} />
      <div className="grid gap-1 sm:grid-cols-2">
        {e.deltas.map((d) => (
          <div
            key={d.metric}
            className={cn(
              'flex items-baseline gap-2 rounded-md px-2 py-1 text-[10px]',
              d.direction === 'better'
                ? 'bg-emerald-500/10'
                : d.direction === 'worse'
                  ? 'bg-amber-500/10'
                  : 'bg-muted/50',
            )}
          >
            <span className="text-muted-foreground">{d.metric}</span>
            <span className="ml-auto tabular-nums">
              {d.from} → <strong>{d.to}</strong>
            </span>
          </div>
        ))}
      </div>
      {e.regressions.length > 0 && (
        <ul className={cn('space-y-0.5 rounded-lg border p-2 text-[10px] leading-relaxed', TONE.warn)}>
          {e.regressions.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        {e.changes.map((c) => (
          <div key={c.key} className="flex items-baseline gap-2 rounded-md bg-muted/50 px-2 py-1 text-[11px]">
            <code className="font-mono text-foreground/90">{c.key}</code>
            <span className="ml-auto flex items-baseline gap-1.5 tabular-nums">
              <span className="text-muted-foreground line-through">{c.from}</span>
              <span aria-hidden>→</span>
              <span className="font-semibold text-primary">{c.to}</span>
            </span>
          </div>
        ))}
      </div>
      {e.reason && <p className="text-[11px] leading-relaxed text-muted-foreground">{e.reason}</p>}
    </div>
  );
}

function MetricChips({ label, m }: { label: string; m: MeasuredMetrics }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">{label}</span>
      <Chip>{m.topicCount} famili</Chip>
      <Chip>
        {m.outlierPct}% outlier ({m.outlierCount})
      </Chip>
      <Chip>terbesar {Math.round(m.largestShare * 100)}%</Chip>
      <Chip>median {m.medianSize}</Chip>
      {m.tinyCount > 0 && <Chip>{m.tinyCount} famili &lt; 3</Chip>}
    </div>
  );
}

// ── Sesudah dibangun ulang ─────────────────────────────────────────────

function VerificationCard({
  v,
  onRemeasure,
  disabled,
  onClose,
}: {
  v: OptimizationVerification;
  onRemeasure: () => void;
  disabled: boolean;
  onClose: () => void;
}) {
  const tone = v.reproduced === false ? TONE.bad : v.goalMet === true ? TONE.ok : v.goalMet === false ? TONE.bad : TONE.warn;
  return (
    <div className={cn('space-y-1.5 rounded-xl border p-3 text-[11px] leading-relaxed', tone)}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">
          Peta terakhir dibanding pengukuran &ldquo;{GOAL_LABEL[v.goal]}&rdquo;
        </p>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose} aria-label="Tutup">
          <X className="size-3.5" />
        </Button>
      </div>
      {v.corpus === 'same' && v.reproduced === true && (
        <p>Sesuai pengukuran: jumlah famili, ukuran tiap famili, dan outlier sama persis.</p>
      )}
      {v.corpus === 'same' && v.reproduced === false && (
        <>
          <p className="font-semibold">Berbeda dari pengukuran, padahal korpusnya sama.</p>
          <ul className="list-disc pl-4">
            {v.mismatches.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
      {v.corpus !== 'same' && <p>Korpus berubah antara pengukuran dan pembangunan peta.</p>}
      <p>
        {v.goalMet === true ? 'Sasaran tercapai: ' : v.goalMet === false ? 'Sasaran tidak tercapai: ' : ''}
        {v.summary}
      </p>
      {v.regressions.length > 0 && (
        <ul className="list-disc pl-4">
          {v.regressions.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <span className="text-[10px] opacity-80">
          Diterapkan {formatDateTime(v.appliedAt)}
          {v.appliedBy ? ` oleh ${v.appliedBy}` : ''}.
        </span>
        {v.goalMet !== true && (
          <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={onRemeasure} disabled={disabled}>
            <Gauge className="mr-1 size-3" />
            Ukur ulang sasaran ini
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Kartu rincian outlier ──────────────────────────────────────────────

function OutlierCard({ report, onClose }: { report: OutlierReport; onClose: () => void }) {
  const rescuable = report.outliers.filter(
    (o) => o.isolation === 'fringe' || o.isolation === 'between',
  ).length;
  const isolated = report.outliers.filter((o) => o.isolation === 'isolated').length;

  return (
    <div className="space-y-3 rounded-xl border border-primary/25 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            {report.outliers.length} jabatan di luar semua job family
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            <strong>{rescuable}</strong> sebenarnya berada di pinggir sebuah famili dan akan masuk
            bila ambangnya tepat · <strong>{isolated}</strong> memang tidak menyerupai famili mana
            pun{report.settings.reduceOutliers ? '' : ' · penempatan ulang belum dinyalakan pada run ini'}.
          </p>
        </div>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose} aria-label="Tutup">
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="scrollbar-slim max-h-72 overflow-y-auto pr-1">
        <ul className="space-y-1.5">
          {report.outliers.map((o) => {
            const iso = ISOLATION_LABEL[o.isolation] ?? ISOLATION_LABEL.distant!;
            return (
              <li key={o.jobProfileId} className="rounded-lg border p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-semibold">
                      {o.positionName ?? `Dokumen #${o.jobProfileId}`}
                    </p>
                    {o.divisionDepartment && (
                      <p className="truncate text-[10px] text-muted-foreground">
                        {o.divisionDepartment}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold',
                      iso.tone,
                    )}
                  >
                    {iso.text}
                  </span>
                </div>
                <dl className="mt-1 space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
                  <div>
                    <span className="font-medium">Famili terdekat: </span>
                    {o.nearest
                      ? `${o.nearest.generalTitle ?? o.nearest.label ?? 'tanpa nama'} (kemiripan ${o.nearest.similarity})`
                      : 'tidak dapat dihitung — vektor dokumen tidak terbaca'}
                  </div>
                  {o.runnerUp && (
                    <div>
                      <span className="font-medium">Famili kedua: </span>
                      {o.runnerUp.generalTitle ?? o.runnerUp.label ?? 'tanpa nama'} (
                      {o.runnerUp.similarity}
                      {o.margin != null ? `, selisih ${o.margin}` : ''})
                    </div>
                  )}
                  <div>
                    <span className="font-medium">Tertahan oleh: </span>
                    {BLOCKED_LABEL[o.blockedBy] ?? o.blockedBy}
                  </div>
                  {o.entersAtThreshold != null && (
                    <div>
                      <span className="font-medium">Masuk bila ambang ≤ </span>
                      <span className="tabular-nums">{o.entersAtThreshold}</span>
                    </div>
                  )}
                </dl>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Note({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof TONE;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border p-2.5 text-[11px] leading-relaxed', TONE[tone])}>
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-px text-[10px] font-medium tabular-nums',
        tone ?? 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}
