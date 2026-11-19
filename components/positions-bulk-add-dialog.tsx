'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Sparkles, TriangleAlert } from 'lucide-react';
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
  bulkAddPositionsAction,
  previewBulkPositionsAction,
  type BulkAddResult,
  type BulkPositionPreview,
} from '@/lib/position-bulk-actions';
import type { ProgramOption } from '@/components/position-form-dialog';
import { ScrollArea } from './ui/scroll-area';

/**
 * What the successor range means per program — the rule the server applies, said
 * in the dialog so it is a visible choice rather than a surprise in the data.
 */
const RANGE_RULE: Record<string, string> = {
  successor: 'satu level DI BAWAH pemangku jabatan (kaderisasi).',
  emergency: 'level yang SAMA dengan pemangku jabatan sampai satu level di atasnya (siap menggantikan sekarang).',
  default: 'satu level di bawah pemangku jabatan sampai level pemangku itu sendiri.',
};

/** Grade thresholds, labelled with the level each one starts at (sync_grade_levels). */
const GRADE_OPTIONS = [
  { value: '5', label: 'Supervisor ke atas' },
  { value: '7', label: 'Manager ke atas' },
  { value: '9', label: 'General Manager ke atas' },
  { value: '13', label: 'Director ke atas' },
];

/** "GENERAL MANAGER" → "General Manager". Level names are stored uppercase. */
function levelLabel(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function PositionsBulkAddDialog({
  programs,
  trigger,
  onDone,
}: {
  programs: ProgramOption[];
  trigger: React.ReactNode;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [minGrade, setMinGrade] = useState('7');
  const [programTemplateId, setProgramTemplateId] = useState(programs[0]?.id ?? '');
  const [autoScore, setAutoScore] = useState(true);
  // Seats with no job profile can still be scored — technical and career fall
  // back to the incumbents' competencies — but that is a different kind of
  // result, so the operator decides before the batch runs.
  const [scoreWithoutJobProfile, setScoreWithoutJobProfile] = useState(true);

  const [preview, setPreview] = useState<BulkPositionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BulkAddResult | null>(null);

  const loadPreview = useCallback(async () => {
    if (!programTemplateId) return;
    setLoading(true);
    try {
      setPreview(await previewBulkPositionsAction({ minGrade: Number(minGrade), programTemplateId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat daftar jabatan.');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [minGrade, programTemplateId]);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void loadPreview();
  }, [open, loadPreview]);

  async function run() {
    if (!programTemplateId) {
      toast.error('Pilih program suksesi lebih dulu.');
      return;
    }
    setRunning(true);
    try {
      const res = await bulkAddPositionsAction({
        minGrade: Number(minGrade),
        programTemplateId,
        autoScore,
        scoreWithoutJobProfile,
      });
      setResult(res);
      const summary =
        `${res.created} posisi ditambahkan` +
        (res.skipped > 0 ? `, ${res.skipped} dilewati` : '') +
        (autoScore ? `, ${res.scoringStarted} scoring diantrikan` : '') +
        (res.scoringSkippedNoProfile > 0
          ? `, ${res.scoringSkippedNoProfile} tanpa job profile tidak di-scoring.`
          : '.');
      // The positions WERE created, so this is not a failure — but the scoring
      // half did not start, and reporting only the success half is what made a
      // dead scoring service look like a finished batch.
      if (res.scoringQueued > 0) {
        toast.warning(
          `${summary} ${res.scoringQueued} sesi scoring menunggu: ` +
            (res.scoringQueuedMessage ?? 'layanan scoring tidak merespons.'),
          { duration: 15000 },
        );
      } else {
        toast.success(summary);
      }
      onDone();
      void loadPreview();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambahkan posisi.');
    } finally {
      setRunning(false);
    }
  }

  const selectedProgram = programs.find((p) => p.id === programTemplateId);
  const programName = selectedProgram?.name ?? '';
  const programCode = selectedProgram?.code ?? '';
  const failures = result?.outcomes.filter((o) => o.scoring === 'failed') ?? [];
  const withWarnings = result?.outcomes.filter((o) => o.warnings.length > 0) ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] min-w-4xl">
        <DialogHeader>
          <DialogTitle>Tambah posisi Batch</DialogTitle>
          <DialogDescription>
            Mendaftarkan seluruh jabatan aktif yang pemangkunya berada pada level tertentu ke atas,
            lalu (opsional) langsung menjalankan scoring AHP + TOPSIS di latar belakang.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className='min-h-0'>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Level pemangku jabatan minimum</Label>
                <Combobox
                  options={GRADE_OPTIONS}
                  value={minGrade}
                  onValueChange={setMinGrade}
                  placeholder="Pilih batas grade..."
                  searchPlaceholder="Cari grade..."
                  triggerClassName="text-sm bg-card"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Program suksesi <span className="text-destructive">*</span>
                </Label>
                <Combobox
                  options={programs.map((p) => ({ value: p.id, label: p.name }))}
                  value={programTemplateId}
                  onValueChange={setProgramTemplateId}
                  placeholder="Pilih program..."
                  searchPlaceholder="Cari program..."
                  triggerClassName="text-sm bg-card"
                />
                {/* The successor range follows the program's purpose, so say which
                    rule is about to be applied before the batch runs. */}
                <p className="text-[10px] leading-normal text-muted-foreground">
                  Rentang level suksesor: {RANGE_RULE[programCode] ?? RANGE_RULE.default}
                </p>
              </div>
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
              <Checkbox checked={autoScore} onCheckedChange={(v) => setAutoScore(v === true)} />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  Jalankan scoring AHP + TOPSIS otomatis
                </span>
                <span className="mt-0.5 block text-[11px] leading-normal text-muted-foreground">
                  Satu run per posisi, dikerjakan layanan scoring di latar belakang secara bergiliran —
                  halaman ini tidak perlu dibiarkan terbuka. Hasilnya muncul di tiap posisi setelah
                  selesai.
                </span>
              </span>
            </label>

            {/* Told BEFORE the batch runs, not discovered afterwards: a seat with
                no job profile still scores, but technical and career relevance
                then come from the incumbents' competencies instead of the JD —
                a different kind of number under the same label. */}
            {autoScore && (preview?.withoutJobProfile ?? 0) > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-300/70 bg-amber-500/5 p-3 dark:border-amber-900/50">
                <div className="flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                      {preview!.withoutJobProfile} dari {preview!.eligible} jabatan belum punya job
                      profile
                    </p>
                    <p className="text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-300/90">
                      Scoring tetap bisa berjalan, tetapi aspek <strong>Kompetensi Teknis</strong> dan{' '}
                      <strong>Relevansi Karier</strong> akan memakai kompetensi pemangku jabatan
                      sebagai pengganti tuntutan jabatan — hasilnya sah, namun tidak sebanding dengan
                      posisi yang punya JD. Pasangkan JD-nya lebih dulu di{' '}
                      <Link href="/job-profiles/match" className="underline hover:text-amber-900">
                        Job Profile Match
                      </Link>{' '}
                      bila ingin hasil penuh.
                    </p>
                    <ul className="space-y-0.5 pt-0.5">
                      {preview!.rows
                        .filter((r) => !r.alreadyRegistered && r.jobProfileId == null)
                        .slice(0, 5)
                        .map((r) => (
                          <li
                            key={r.masterPositionId}
                            className="truncate text-[11px] text-amber-700/80 dark:text-amber-300/80"
                          >
                            • {r.title}
                          </li>
                        ))}
                      {preview!.withoutJobProfile > 5 && (
                        <li className="text-[11px] text-amber-700/80 dark:text-amber-300/80">
                          • …dan {preview!.withoutJobProfile - 5} lainnya
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
                <label className="flex cursor-pointer items-center gap-2 rounded-md border border-amber-300/60 bg-background/60 p-2 text-[11px]">
                  <Checkbox
                    checked={scoreWithoutJobProfile}
                    onCheckedChange={(v) => setScoreWithoutJobProfile(v === true)}
                  />
                  <span>
                    Tetap jalankan scoring untuk {preview!.withoutJobProfile} jabatan tanpa job profile.
                    {!scoreWithoutJobProfile && (
                      <span className="block text-muted-foreground">
                        Posisinya tetap dibuat, hanya scoring-nya yang ditunda sampai JD-nya ada.
                      </span>
                    )}
                  </span>
                </label>
              </div>
            )}

            {/* Preview — the number is the point of this dialog: it says exactly
                what the button will do before it does it. */}
            <div className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                <p className="text-xs font-semibold">Jabatan yang akan ditambahkan</p>
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px]">
                      {preview?.eligible ?? 0} baru
                    </Badge>
                    {(preview?.alreadyRegistered ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {preview!.alreadyRegistered} sudah terdaftar
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <div className="max-h-52 overflow-y-auto">
                {(preview?.rows.length ?? 0) === 0 && !loading ? (
                  <p className="p-3 text-xs text-muted-foreground">
                    Tidak ada jabatan aktif dengan pemangku pada grade tersebut.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {preview?.rows.map((row) => (
                      <li
                        key={row.masterPositionId}
                        className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                          row.alreadyRegistered ? 'opacity-45' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{row.title}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {row.holders.length > 1
                            ? `${row.holders.length} pejabat`
                            : row.holders[0]?.name || '—'}
                        </span>
                        {!row.alreadyRegistered && row.jobProfileId == null && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-amber-300/70 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                            title="Belum ada job profile yang cocok untuk jabatan ini"
                          >
                            tanpa JD
                          </Badge>
                        )}
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                          title={`Level pemangku jabatan (grade ${row.topGrade})`}
                        >
                          {levelLabel(row.topLevelName) || `Grade ${row.topGrade}`}
                        </Badge>
                        {row.successorRange && (
                          <Badge
                            variant="outline"
                            className="shrink-0 text-[10px] text-muted-foreground"
                            title={`Rentang level suksesor: ${row.successorRange.label}`}
                          >
                            →{' '}
                            {row.successorRange.levels
                              .split('–')
                              .map((part) => levelLabel(part))
                              .join(' – ')}
                          </Badge>
                        )}
                        {row.alreadyRegistered && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">terdaftar</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {result && (
              <div className="space-y-2 rounded-lg border border-emerald-300/60 bg-emerald-500/5 p-3 dark:border-emerald-900/50">
                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {result.created} posisi ditambahkan pada program {programName}
                  {result.skipped > 0 ? ` · ${result.skipped} dilewati (sudah terdaftar)` : ''}
                  {autoScore ? ` · ${result.scoringStarted} scoring diantrikan` : ''}
                  {result.scoringQueued > 0
                    ? ` · ${result.scoringQueued} menunggu layanan scoring`
                    : ''}
                  {result.scoringSkippedNoProfile > 0
                    ? ` · ${result.scoringSkippedNoProfile} tanpa JD tidak di-scoring`
                    : ''}
                </p>
                {result.scoringQueued > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/10 p-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <p className="min-w-0 text-[11px] text-amber-700 dark:text-amber-300">
                      {result.scoringQueuedMessage ??
                        'Layanan scoring tidak merespons, jadi sesi-sesi ini menunggu.'}{' '}
                      Posisinya sudah tersimpan — cukup tunggu, tidak perlu menambah ulang.
                    </p>
                  </div>
                )}
                {withWarnings.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {withWarnings.length} posisi tersimpan dengan catatan (mis. belum ada job profile),
                    jadi kualifikasi & kompetensinya perlu dilengkapi lewat halaman posisi.
                  </p>
                )}
                {failures.length > 0 && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-500/5 p-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <div className="min-w-0 text-[11px] text-amber-700 dark:text-amber-300">
                      <p className="font-medium">{failures.length} posisi gagal dijalankan scoring-nya:</p>
                      <ul className="mt-0.5 space-y-0.5">
                        {failures.slice(0, 5).map((f) => (
                          <li key={f.title} className="truncate">
                            {f.title} — {f.scoringError ?? 'tidak diketahui'}
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
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>
            Tutup
          </Button>
          <Button onClick={run} disabled={running || loading || (preview?.eligible ?? 0) === 0}>
            {running && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {running
              ? 'Menambahkan...'
              : `Tambahkan ${preview?.eligible ?? 0} posisi${
                  autoScore
                    ? ` + ${
                        scoreWithoutJobProfile
                          ? preview?.eligible ?? 0
                          : (preview?.eligible ?? 0) - (preview?.withoutJobProfile ?? 0)
                      } scoring`
                    : ''
                }`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
