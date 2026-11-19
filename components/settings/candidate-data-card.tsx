'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ChevronDown,
  Eraser,
  History,
  Info,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserCheck,
  UserMinus,
  UserX,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CollapsibleCard } from '@/components/settings/collapsible-card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/datetime';

import {
  clearAllCandidatesAction,
  getCandidateLifecycleStatsAction,
  listDeletedCandidatesAction,
  restoreClearedCandidatesAction,
  type CandidateLifecycleStats,
  type DeletedCandidateRow,
} from '@/lib/candidate-lifecycle-actions';
import { restoreCandidateAction } from '@/lib/pulse-crud-actions';

/** Typed literally, uppercase, before the destructive button unlocks. */
const CONFIRM_WORD = 'HAPUS';

/**
 * Mirrors the LIMIT in listDeletedCandidatesAction. Kept here only so the UI can
 * warn that the list is truncated instead of silently implying completeness.
 */
const DELETED_LIST_LIMIT = 200;

type CandidateDataCardProps = {
  className?: string;
};

// ── Stat tile ─────────────────────────────────────────────────

type Tone = 'live' | 'cleared' | 'deleted';

const TONE_CLASSES: Record<Tone, { box: string; icon: string; value: string }> = {
  live: {
    box: 'border-emerald-500/30 bg-emerald-500/5',
    icon: 'text-emerald-600 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-300',
  },
  cleared: {
    box: 'border-amber-500/30 bg-amber-500/5',
    icon: 'text-amber-600 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-300',
  },
  deleted: {
    box: 'border-rose-500/30 bg-rose-500/5',
    icon: 'text-rose-600 dark:text-rose-400',
    value: 'text-rose-700 dark:text-rose-300',
  },
};

function LifecycleTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: number | undefined;
  hint: string;
  tone: Tone;
  loading: boolean;
}) {
  const tokens = TONE_CLASSES[tone];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('rounded-lg border p-3 text-left', tokens.box)}>
          <div className="flex items-center gap-1.5">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', tokens.icon)} />
            <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
          </div>
          <p className={cn('mt-1 text-2xl font-bold tabular-nums', tokens.value)}>
            {loading || value == null ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              value.toLocaleString('id-ID')
            )}
          </p>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Individually-deleted candidates, with per-row restore ─────

/**
 * The only way back for a candidate deleted one at a time from the Kandidat
 * page: the sync deliberately leaves 'manual' tombstones alone, so nothing else
 * will ever resurrect them. Rendered only when there is at least one such row.
 *
 * The list is fetched lazily on first open — this card sits on a settings page
 * and this panel is a recovery tool, not primary content worth a query on every
 * page view. Component state lives here (not in the parent) so that when the
 * last row is restored and the panel unmounts, the stale list unmounts with it.
 */
function DeletedCandidatesPanel({
  count,
  onRestored,
}: {
  count: number;
  onRestored: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DeletedCandidateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row, not a single flag: one slow restore must not freeze the whole list.
  const [restoringIds, setRestoringIds] = useState<Set<string>>(() => new Set());

  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listDeletedCandidatesAction());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Fetch on first open only; reopening reuses what is already in state.
    if (next && rows == null && !loading) void loadRows();
  }

  async function handleRestore(row: DeletedCandidateRow) {
    setRestoringIds((prev) => new Set(prev).add(row.id));
    try {
      // Returns void and throws on failure (normalizeError re-throws), so a
      // clean return is the only success signal available.
      const formData = new FormData();
      formData.set('id', row.id);
      await restoreCandidateAction(formData);

      setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
      toast.success('Kandidat dipulihkan', {
        description: `${row.name} kembali aktif di halaman Kandidat.`,
      });
      await onRestored();
    } catch (e) {
      // Leave the row in place so the action can be retried.
      toast.error('Gagal memulihkan kandidat', { description: (e as Error).message });
    } finally {
      setRestoringIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className="rounded-lg border border-rose-500/30 bg-rose-500/5"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 rounded-lg p-3 text-left text-xs font-semibold text-rose-900 transition-colors hover:bg-rose-500/5 dark:text-rose-200"
        >
          <span className="flex items-center gap-2">
            <UserX className="h-4 w-4 shrink-0" />
            Lihat kandidat yang dihapus manual ({count.toLocaleString('id-ID')})
          </span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-2 px-3 pb-3">
        <p className="text-[11px] leading-snug text-rose-800/90 dark:text-rose-300/90">
          Kandidat ini dihapus satu per satu dari halaman Kandidat, dan{' '}
          <strong>tidak ikut kembali</strong> pada sinkronisasi kandidat berikutnya — berbeda dengan
          kandidat yang <strong>dikosongkan</strong> lewat tombol di bawah. Satu-satunya jalan
          kembali adalah tombol Pulihkan di sini.
        </p>

        {loading && (
          <p className="flex items-center gap-1.5 py-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            Memuat daftar kandidat…
          </p>
        )}

        {!loading && error && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-rose-500/10 p-2">
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span className="min-w-0 break-words">Gagal memuat daftar: {error}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-[11px]"
              onClick={() => void loadRows()}
            >
              <RefreshCw className="h-3 w-3" />
              Coba lagi
            </Button>
          </div>
        )}

        {!loading && !error && rows != null && rows.length === 0 && (
          <p className="py-2 text-[11px] text-muted-foreground">
            Tidak ada kandidat yang dihapus manual di Company ini.
          </p>
        )}

        {!loading && !error && rows != null && rows.length > 0 && (
          <>
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {rows.map((row) => {
                const restoring = restoringIds.has(row.id);
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/60 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{row.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">{row.employeeId ?? '—'}</span>
                        {' · dihapus '}
                        {formatDateTime(row.deletedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 shrink-0 gap-1.5 text-[11px]"
                      disabled={restoring}
                      onClick={() => void handleRestore(row)}
                    >
                      {restoring ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                      Pulihkan
                    </Button>
                  </li>
                );
              })}
            </ul>

            {rows.length >= DELETED_LIST_LIMIT && (
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                <Info className="mt-px h-3 w-3 shrink-0" />
                <span>
                  Hanya {DELETED_LIST_LIMIT.toLocaleString('id-ID')} penghapusan terbaru yang
                  ditampilkan; masih ada kandidat lain yang dihapus manual di luar daftar ini.
                </span>
              </p>
            )}
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main component ────────────────────────────────────────────

export function CandidateDataCard({ className }: CandidateDataCardProps) {
  const router = useRouter();
  const [stats, setStats] = useState<CandidateLifecycleStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isPending, startTransition] = useTransition();

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      setStats(await getCandidateLifecycleStatsAction());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const confirmed = confirmText.trim() === CONFIRM_WORD;
  const busy = isPending || loading;
  const hasCleared = (stats?.clearedBulk ?? 0) > 0;
  const hasDeletedManual = (stats?.deletedManual ?? 0) > 0;
  const nothingToClear = stats != null && stats.live === 0;

  /** After a single restore: the tiles are now off by one, so refetch them. */
  const handleSingleRestored = useCallback(async () => {
    await loadStats();
    router.refresh();
  }, [loadStats, router]);

  function closeDialog() {
    setDialogOpen(false);
    setConfirmText('');
  }

  function handleClear() {
    startTransition(async () => {
      try {
        const res = await clearAllCandidatesAction();
        if (res.success) {
          toast.success('Data kandidat dikosongkan', { description: res.message });
        } else {
          toast.error('Gagal mengosongkan data kandidat', { description: res.message });
        }
      } catch (e) {
        toast.error('Gagal mengosongkan data kandidat', { description: (e as Error).message });
      } finally {
        closeDialog();
        await loadStats();
        // Candidate counts are also rendered server-side elsewhere on this page.
        router.refresh();
      }
    });
  }

  function handleRestore() {
    startTransition(async () => {
      try {
        const res = await restoreClearedCandidatesAction();
        if (res.success) {
          toast.success('Kandidat dipulihkan', { description: res.message });
        } else {
          toast.error('Gagal memulihkan data kandidat', { description: res.message });
        }
      } catch (e) {
        toast.error('Gagal memulihkan data kandidat', { description: (e as Error).message });
      } finally {
        await loadStats();
        router.refresh();
      }
    });
  }

  return (
    // Collapsed by default: this card exists for one maintenance flow
    // (empty the pool before re-importing corrected source data) and a
    // destructive button, neither of which belongs in the weekly path. The
    // summary keeps the three counts readable without opening it.
    <CollapsibleCard
      className={className}
      defaultOpen={false}
      storageKey="sync:candidate-data"
      accent="danger"
      title={
        <>
          <Users className="h-4 w-4 text-primary" />
          Data Kandidat
        </>
      }
      summary={
        stats ? (
          <span className="tabular-nums">
            {stats.live.toLocaleString('id-ID')} aktif
            {stats.clearedBulk > 0 && ` · ${stats.clearedBulk.toLocaleString('id-ID')} dikosongkan`}
            {stats.deletedManual > 0 && ` · ${stats.deletedManual.toLocaleString('id-ID')} dihapus manual`}
          </span>
        ) : null
      }
      description="Pengosongan massal pool kandidat Company aktif — dipakai sebelum mengunggah data sumber yang sudah diperbaiki, lalu sinkronisasi kandidat memunculkannya kembali dengan ID yang sama."
      headerExtra={
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={busy}
          onClick={() => void loadStats()}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Muat ulang
        </Button>
      }
    >
        {/* ── Counts ────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LifecycleTile
            icon={UserCheck}
            label="Aktif"
            value={stats?.live}
            tone="live"
            loading={loading}
            hint="Kandidat yang terlihat di halaman Kandidat dan ikut diperhitungkan saat scoring."
          />
          <LifecycleTile
            icon={UserMinus}
            label="Dikosongkan"
            value={stats?.clearedBulk}
            tone="cleared"
            loading={loading}
            hint="Disembunyikan lewat tombol di kartu ini. Muncul kembali otomatis pada sinkronisasi kandidat berikutnya, atau langsung lewat tombol Pulihkan."
          />
          <LifecycleTile
            icon={UserX}
            label="Dihapus manual"
            value={stats?.deletedManual}
            tone="deleted"
            loading={loading}
            hint="Dihapus satu per satu dari halaman Kandidat. Sinkronisasi TIDAK memunculkannya kembali — harus dipulihkan sendiri per kandidat."
          />
        </div>

        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" />
          <span>
            <strong>Dikosongkan</strong> kembali sendiri setelah sinkronisasi kandidat berikutnya.{' '}
            <strong>Dihapus manual</strong> tidak — penghapusan per kandidat dianggap keputusan
            sengaja dan tetap dihormati oleh sinkronisasi.
          </span>
        </p>

        {loadError && (
          <p className="flex items-start gap-1.5 rounded-md bg-rose-500/10 p-2 text-[11px] leading-snug text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">Gagal memuat statistik kandidat: {loadError}</span>
          </p>
        )}

        {/* ── What clearing actually does ───────────────────── */}
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-xs leading-relaxed text-sky-800 dark:text-sky-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Mengosongkan bukan menghapus permanen</p>
            <ul className="mt-1 space-y-1 text-sky-700/90 dark:text-sky-300/90">
              <li className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>Data kandidat hanya <strong>disembunyikan</strong>, barisnya tetap ada di database.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>
                  Riwayat scoring tetap utuh — hasil analisis (<code className="rounded bg-sky-500/10 px-1 py-0.5">analysis_results</code>),
                  successor terpilih (<code className="rounded bg-sky-500/10 px-1 py-0.5">position_picks</code>),
                  dan sesi scoring tidak ikut hilang.
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>
                  Setelah unggah data baru lalu jalankan <strong>sinkronisasi kandidat</strong>, kandidat
                  muncul kembali dengan <strong>ID yang sama</strong>, jadi riwayat lamanya tetap tersambung.
                </span>
              </li>
              <li className="flex items-start gap-1.5">
                <span aria-hidden>•</span>
                <span>
                  Hanya berlaku untuk <strong>Company / business unit yang sedang aktif</strong> —
                  pool Company lain tidak tersentuh.
                </span>
              </li>
            </ul>
          </div>
        </div>

        {/* ── Restore: the safe direction, so no type-to-confirm ─ */}
        {hasCleared && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <History className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {stats!.clearedBulk.toLocaleString('id-ID')} kandidat sedang dikosongkan
                </p>
                <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
                  Pulihkan sekarang bila pengosongan tadi keliru, tanpa menunggu sinkronisasi berikutnya.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
              disabled={busy}
              onClick={handleRestore}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Pulihkan
            </Button>
          </div>
        )}

        {/* ── The other, non-automatic way back: per-candidate ── */}
        {hasDeletedManual && (
          <DeletedCandidatesPanel
            count={stats!.deletedManual}
            onRestored={handleSingleRestored}
          />
        )}

        <Separator />

        {/* ── Destructive action, deliberately fenced off ────── */}
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2 text-xs leading-relaxed text-rose-900 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">Kosongkan seluruh data kandidat</p>
                <p className="mt-0.5 text-rose-800/90 dark:text-rose-300/90">
                  {nothingToClear
                    ? 'Tidak ada kandidat aktif untuk dikosongkan saat ini.'
                    : 'Semua kandidat aktif di Company ini akan disembunyikan sekaligus. Perlu ketik konfirmasi.'}
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={busy || stats == null || nothingToClear}
              onClick={() => setDialogOpen(true)}
            >
              <Eraser className="h-3.5 w-3.5" />
              Kosongkan Data Kandidat
            </Button>
          </div>
        </div>

      {/* ── Type-to-confirm dialog ──────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              Kosongkan Data Kandidat?
            </DialogTitle>
            <DialogDescription>
              {stats?.live.toLocaleString('id-ID') ?? '—'} kandidat aktif di Company ini akan
              disembunyikan. Ini <strong>bukan</strong> penghapusan permanen: riwayat scoring tetap
              utuh dan kandidat muncul kembali dengan ID yang sama setelah sinkronisasi kandidat
              berikutnya.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5 pt-2">
            <Label htmlFor="clearCandidatesConfirm">
              Ketik <span className="font-mono font-semibold">{CONFIRM_WORD}</span> untuk melanjutkan
            </Label>
            <Input
              id="clearCandidatesConfirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="font-mono"
              autoComplete="off"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Harus persis <span className="font-mono">{CONFIRM_WORD}</span> dengan huruf besar.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={closeDialog} disabled={isPending}>
              Batal
            </Button>
            <Button variant="destructive" disabled={!confirmed || isPending} onClick={handleClear}>
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Mengosongkan…
                </>
              ) : (
                <>
                  <Eraser className="mr-2 h-4 w-4" />
                  Kosongkan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CollapsibleCard>
  );
}
