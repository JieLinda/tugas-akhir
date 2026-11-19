'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  previewProgramRescoreAction,
  rescoreProgramPositionsAction,
  type ProgramRescorePreview,
  type ProgramRescoreResult,
} from '@/lib/position-bulk-actions';
import type { ProgramOption } from '@/components/position-form-dialog';
import { EMPTY_DATE, formatDate } from '@/lib/datetime';
import { cn } from '@/lib/utils';

function formatRunDate(iso: string | null): string {
  const text = formatDate(iso);
  return text === EMPTY_DATE ? 'belum pernah' : text;
}

export function PositionsRescoreDialog({
  programs,
  trigger,
  onDone,
}: {
  programs: ProgramOption[];
  trigger: React.ReactNode;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [programTemplateId, setProgramTemplateId] = useState(programs[0]?.id ?? '');
  const [scoreWithoutJobProfile, setScoreWithoutJobProfile] = useState(true);

  const [preview, setPreview] = useState<ProgramRescorePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProgramRescoreResult | null>(null);

  const loadPreview = useCallback(async () => {
    if (!programTemplateId) return;
    setLoading(true);
    try {
      setPreview(await previewProgramRescoreAction({ programTemplateId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat daftar posisi.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [programTemplateId]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void loadPreview();
  }, [open, loadPreview]);

  async function run() {
    if (!programTemplateId) {
      toast.error('Pilih program lebih dulu.');
      return;
    }
    setRunning(true);
    try {
      const res = await rescoreProgramPositionsAction({ programTemplateId, scoreWithoutJobProfile });
      setResult(res);
      const tail =
        (res.skippedInProgress > 0 ? `, ${res.skippedInProgress} sedang berjalan` : '') +
        (res.skippedNoProfile > 0 ? `, ${res.skippedNoProfile} tanpa job profile dilewati` : '') +
        '.';
      // A queued batch is not a successful batch: the sessions exist but nothing
      // is scoring them, so it gets a warning and the reason — once, not per
      // position.
      if (res.queued > 0) {
        toast.warning(
          `${res.queued} sesi menunggu layanan scoring${res.started > 0 ? `, ${res.started} berjalan` : ''}${tail} ` +
            (res.queuedMessage ?? 'Layanan scoring tidak merespons.'),
          { duration: 15000 },
        );
      } else {
        toast.success(`${res.started} posisi diantrikan untuk scoring ulang${tail}`);
      }
      onDone();
      void loadPreview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menjalankan scoring ulang.');
    } finally {
      setRunning(false);
    }
  }

  const dispatchCount = preview
    ? scoreWithoutJobProfile
      ? preview.eligible
      : preview.eligible - preview.withoutJobProfile
    : 0;
  const failures = result?.outcomes.filter((o) => o.status === 'failed') ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto min-w-4xl">
        <DialogHeader>
          <DialogTitle>Scoring ulang satu program</DialogTitle>
          <DialogDescription>
            Menjalankan ulang penilaian AHP + TOPSIS untuk SEMUA posisi yang terdaftar pada satu
            program. Setiap posisi mendapat run BARU — hasil lama tidak dihapus dan tetap dapat
            dibuka dari riwayat run posisi tersebut.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Program <span className="text-destructive">*</span>
            </Label>
            <Combobox
              options={programs.map((p) => ({ value: p.id, label: p.name }))}
              value={programTemplateId}
              onValueChange={setProgramTemplateId}
              placeholder="Pilih program..."
              searchPlaceholder="Cari program..."
              triggerClassName="text-sm bg-card"
            />
            <p className="text-[10px] leading-normal text-muted-foreground">
              Dikerjakan layanan scoring di latar belakang secara bergiliran — halaman ini tidak
              perlu dibiarkan terbuka. Rentang level dan aturan filter mengikuti yang tersimpan
              pada tiap posisi.
            </p>
          </div>

          {/* Same warning the bulk add gives, for the same reason: without a JD
              the technical and career aspects are computed from the incumbents'
              competencies, which is a different number under the same label. */}
          {(preview?.withoutJobProfile ?? 0) > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-500/5 p-3 dark:border-amber-900/50">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                    {preview!.withoutJobProfile} dari {preview!.eligible} posisi belum punya job
                    profile
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                    Aspek <strong>Kompetensi Teknis</strong> dan <strong>Relevansi Karier</strong>{' '}
                    posisi tersebut akan dihitung dari kompetensi pemangku jabatan, bukan dari
                    tuntutan JD.
                  </p>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-amber-300/60 bg-background/60 p-2 text-[11px]">
                <Checkbox
                  checked={scoreWithoutJobProfile}
                  onCheckedChange={(v) => setScoreWithoutJobProfile(v === true)}
                />
                <span>Tetap jalankan scoring untuk posisi tanpa job profile.</span>
              </label>
            </div>
          )}

          <div className="rounded-lg border">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
              <p className="text-xs font-semibold">Posisi pada program ini</p>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {preview?.eligible ?? 0} akan dijalankan
                  </Badge>
                  {(preview?.inProgress ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[10px] text-sky-700 dark:text-sky-300">
                      {preview!.inProgress} sedang berjalan
                    </Badge>
                  )}
                  {(preview?.neverScored ?? 0) > 0 && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {preview!.neverScored} belum pernah
                    </Badge>
                  )}
                </div>
              )}
            </div>
            <div className="max-h-52 overflow-y-auto">
              {(preview?.rows.length ?? 0) === 0 && !loading ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Belum ada posisi terdaftar pada program ini.
                </p>
              ) : (
                <ul className="divide-y">
                  {preview?.rows.map((row) => (
                    <li
                      key={row.positionId}
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                        row.inProgress ? 'opacity-45' : ''
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        run terakhir: {formatRunDate(row.lastRunAt)}
                      </span>
                      {row.jobProfileId == null && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-300/70 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                          title="Belum ada job profile yang cocok untuk posisi ini"
                        >
                          tanpa JD
                        </Badge>
                      )}
                      {row.inProgress && (
                        <span className="shrink-0 text-[10px] text-sky-700 dark:text-sky-300">
                          sedang scoring
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {result && (
            <div
              className={cn(
                'space-y-2 rounded-lg border p-3',
                result.queued > 0
                  ? 'border-amber-300/60 bg-amber-500/5 dark:border-amber-900/50'
                  : 'border-emerald-300/60 bg-emerald-500/5 dark:border-emerald-900/50',
              )}
            >
              <p
                className={cn(
                  'text-xs font-semibold',
                  result.queued > 0
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-emerald-700 dark:text-emerald-300',
                )}
              >
                {result.started} posisi diantrikan
                {result.queued > 0 ? ` · ${result.queued} menunggu layanan scoring` : ''}
                {result.skippedInProgress > 0
                  ? ` · ${result.skippedInProgress} dilewati (sedang berjalan)`
                  : ''}
                {result.skippedNoProfile > 0
                  ? ` · ${result.skippedNoProfile} dilewati (tanpa JD)`
                  : ''}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Hasil lama tetap tersimpan; run baru muncul di tiap posisi setelah selesai diproses.
              </p>
              {result.queued > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/10 p-2">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <p className="min-w-0 text-[11px] text-amber-700 dark:text-amber-300">
                    {result.queuedMessage ??
                      'Layanan scoring tidak merespons, jadi sesi-sesi ini menunggu.'}{' '}
                    Sesinya sudah tersimpan — jangan jalankan ulang, itu hanya menambah antrean untuk
                    posisi yang sama.
                  </p>
                </div>
              )}
              {failures.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/5 p-2">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <div className="min-w-0 text-[11px] text-amber-700 dark:text-amber-300">
                    <p className="font-medium">{failures.length} posisi gagal dijalankan:</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {failures.slice(0, 5).map((f) => (
                        <li key={f.positionId} className="truncate">
                          {f.title} — {f.error ?? 'tidak diketahui'}
                        </li>
                      ))}
                    </ul>
                    {failures.length > 5 && <p className="mt-0.5">…dan {failures.length - 5} lainnya.</p>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>
            Tutup
          </Button>
          <Button onClick={run} disabled={running || loading || dispatchCount === 0}>
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-4 w-4" />
            )}
            {running ? 'Menjalankan...' : `Jalankan ulang ${dispatchCount} posisi`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
