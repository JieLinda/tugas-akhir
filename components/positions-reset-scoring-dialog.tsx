'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Trash2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  previewProgramScoringResetAction,
  resetProgramScoringAction,
  type ProgramScoringResetPreview,
  type ProgramScoringResetResult,
} from '@/lib/position-bulk-actions';
import type { ProgramOption } from '@/components/position-form-dialog';

/** One deleted thing, with its count — the list IS the warning. */
function ResetLine({ count, label }: { count: number; label: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{count}</span>
    </li>
  );
}

export function PositionsResetScoringDialog({
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
  const [deletePicks, setDeletePicks] = useState(false);
  const [confirmName, setConfirmName] = useState('');

  const [preview, setPreview] = useState<ProgramScoringResetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProgramScoringResetResult | null>(null);

  const loadPreview = useCallback(async () => {
    if (!programTemplateId) return;
    setLoading(true);
    try {
      setPreview(await previewProgramScoringResetAction({ programTemplateId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat ringkasan.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [programTemplateId]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setConfirmName('');
    void loadPreview();
  }, [open, loadPreview]);

  // Switching program invalidates a confirmation typed for the previous one.
  useEffect(() => setConfirmName(''), [programTemplateId]);

  const programName = preview?.programName ?? programs.find((p) => p.id === programTemplateId)?.name ?? '';
  const confirmed = confirmName.trim() === programName && programName.length > 0;
  const hasSomethingToDelete = (preview?.runs ?? 0) > 0 || (preview?.sessions ?? 0) > 0;

  async function run() {
    setRunning(true);
    try {
      const res = await resetProgramScoringAction({ programTemplateId, confirmName, deletePicks });
      setResult(res);
      toast.success(
        `${res.deletedRuns} run dan ${res.deletedSessions} sesi dihapus` +
          (res.deletedPicks > 0 ? `, ${res.deletedPicks} suksesor terpilih dihapus` : '') +
          '.',
      );
      onDone();
      void loadPreview();
      setConfirmName('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus hasil scoring.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-destructive">Reset hasil scoring satu program</DialogTitle>
          <DialogDescription>
            MENGHAPUS PERMANEN seluruh riwayat penilaian pada program terpilih — semua run, sesi,
            hasil peringkat, catatan pengecualian, dan percakapan analisisnya. Posisi, kandidat,
            rentang level, dan pemangku jabatan TIDAK ikut terhapus.
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
          </div>

          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-semibold text-destructive">
                  Yang akan dihapus dari program {programName || '—'}
                </p>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <ul className="space-y-1 text-xs">
                    <ResetLine count={preview?.runs ?? 0} label="Riwayat penilaian (run)" />
                    <ResetLine count={preview?.sessions ?? 0} label="Sesi penilaian" />
                    <ResetLine count={preview?.analysisResults ?? 0} label="Baris hasil peringkat" />
                    <ResetLine
                      count={preview?.positionsWithRuns ?? 0}
                      label={`Posisi terdampak (dari ${preview?.positions ?? 0} posisi program ini)`}
                    />
                  </ul>
                )}
                {(preview?.inProgress ?? 0) > 0 && (
                  <p className="text-[11px] text-destructive/90">
                    {preview!.inProgress} run sedang berjalan — akan dihentikan lebih dulu sebelum
                    dihapus.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Tidak dapat dibatalkan. Cache skor aspek per kandidat sengaja dipertahankan (ia
                  terkunci pada sidik jari data kandidat, jadi tidak pernah menyajikan angka basi)
                  supaya scoring berikutnya lebih cepat.
                </p>
              </div>
            </div>
          </div>

          {(preview?.picks ?? 0) > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
              <Checkbox checked={deletePicks} onCheckedChange={(v) => setDeletePicks(v === true)} />
              <span className="min-w-0">
                <span className="text-sm font-medium">
                  Hapus juga {preview!.picks} suksesor terpilih pada program ini
                </span>
                <span className="mt-0.5 block text-[11px] leading-normal text-muted-foreground">
                  Suksesor terpilih adalah keputusan manusia, bukan bagian dari hasil penilaian, jadi
                  secara bawaan DIPERTAHANKAN — ia hanya kehilangan tautan ke run-nya.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Ketik <span className="font-semibold text-foreground">{programName || '...'}</span>{' '}
              untuk mengonfirmasi
            </Label>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={programName}
              autoComplete="off"
              className="text-sm"
            />
          </div>

          {result && (
            <div className="rounded-lg border border-emerald-300/60 bg-emerald-500/5 p-3 text-xs dark:border-emerald-900/50">
              <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                {result.deletedRuns} run dan {result.deletedSessions} sesi dihapus
                {result.cancelledSessions > 0
                  ? ` · ${result.cancelledSessions} run berjalan dihentikan`
                  : ''}
                {result.deletedPicks > 0 ? ` · ${result.deletedPicks} suksesor dihapus` : ''}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                Posisi program ini sekarang tercatat belum pernah di-scoring. Jalankan “Scoring
                Ulang” bila ingin langsung menilai kembali.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>
            Tutup
          </Button>
          <Button
            variant="destructive"
            onClick={run}
            disabled={running || loading || !confirmed || !hasSomethingToDelete}
          >
            {running ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            {running ? 'Menghapus...' : `Hapus ${preview?.runs ?? 0} run`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
