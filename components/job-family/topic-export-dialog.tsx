'use client';

// Export dialog for a finished Job Family run. Everything it exports comes from
// the results payload already on the page — no fetch, so the file can never
// disagree with the map the user is looking at.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Table2,
  Loader2,
  Users,
  Layers,
  FileWarning,
} from 'lucide-react';
import type { TopicResults, TopicRunSummary } from '@/lib/job-family-topics-actions';
import {
  DEFAULT_JOB_FAMILY_EXPORT_OPTIONS,
  describeJobFamilyExport,
  exportJobFamily,
  type JobFamilyExportFormat,
  type JobFamilyExportOptions,
} from '@/lib/job-family-export';

/** The three formats, with the audience each one is for — a user picking blind
 *  otherwise downloads a spreadsheet when they wanted something to hand over. */
const FORMATS: {
  value: JobFamilyExportFormat;
  label: string;
  hint: string;
  icon: typeof FileSpreadsheet;
  tone: string;
}[] = [
  {
    value: 'xlsx',
    label: 'Excel (.xlsx)',
    hint: 'Beberapa sheet: ringkasan, job family, job profile, incumbent, outlier, sebaran divisi. Untuk diolah sendiri.',
    icon: FileSpreadsheet,
    tone: 'text-emerald-600',
  },
  {
    value: 'html',
    label: 'Laporan cetak (HTML / PDF)',
    hint: 'Laporan rapi per job family lengkap dengan incumbent, kata kunci, dan panduan membaca angkanya. Untuk dibagikan.',
    icon: FileText,
    tone: 'text-rose-600',
  },
  {
    value: 'csv',
    label: 'CSV datar',
    hint: 'Satu tabel pada tingkat job profile. Untuk pivot cepat atau diimpor ke alat lain.',
    icon: Table2,
    tone: 'text-sky-600',
  },
];

const TOGGLES: {
  key: keyof Pick<
    JobFamilyExportOptions,
    | 'includeIncumbents'
    | 'includeKeywords'
    | 'includeOutliers'
    | 'includeProfileSummary'
    | 'includePlacementReason'
  >;
  label: string;
  hint: string;
}[] = [
  {
    key: 'includeIncumbents',
    label: 'Incumbent',
    hint: 'Nama karyawan yang tercocok ke tiap job profile, plus sheet/daftar tersendiri.',
  },
  {
    key: 'includePlacementReason',
    label: 'Alasan penempatan',
    hint: 'Keanggotaan, kedekatan ke pusat family, dan family alternatif tiap dokumen.',
  },
  {
    key: 'includeKeywords',
    label: 'Kata kunci family',
    hint: 'Istilah c-TF-IDF yang membedakan tiap family.',
  },
  {
    key: 'includeOutliers',
    label: 'Outlier',
    hint: 'Dokumen yang tidak masuk kelompok mana pun, beserta family terdekatnya.',
  },
  {
    key: 'includeProfileSummary',
    label: 'Ringkasan job profile',
    hint: 'Tujuan jabatan, tanggung jawab, dan kompetensi teknis. Menambah panjang berkas cukup banyak.',
  },
];

export function TopicExportDialog({
  run,
  results,
  tenantLabel,
}: {
  run: TopicRunSummary;
  results: TopicResults;
  /** Business unit the map is read as — printed on the report header. */
  tenantLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<JobFamilyExportOptions>(DEFAULT_JOB_FAMILY_EXPORT_OPTIONS);

  const families = useMemo(
    () => results.topics.filter((t) => t.topicId !== -1),
    [results.topics],
  );
  const payload = useMemo(
    () => ({ run, results, tenantLabel: tenantLabel ?? null }),
    [run, results, tenantLabel],
  );
  const counts = useMemo(() => describeJobFamilyExport(payload, opts), [payload, opts]);

  const set = <K extends keyof JobFamilyExportOptions>(key: K, value: JobFamilyExportOptions[K]) =>
    setOpts((o) => ({ ...o, [key]: value }));

  async function run_() {
    setBusy(true);
    try {
      await exportJobFamily(payload, opts);
      setOpen(false);
      toast.success(
        opts.format === 'html'
          ? 'Laporan dibuka di tab baru — gunakan tombol Cetak untuk menyimpan sebagai PDF.'
          : 'Berkas ekspor sedang diunduh.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal membuat berkas ekspor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={families.length === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Ekspor Hasil
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ekspor hasil pemetaan job family</DialogTitle>
          <DialogDescription>
            Diambil dari hasil proses yang sedang tampil, jadi isinya persis sama dengan peta di
            layar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Format */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">Format berkas</p>
            <div className="space-y-1.5">
              {FORMATS.map((f) => {
                const active = opts.format === f.value;
                const Icon = f.icon;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => set('format', f.value)}
                    className={`flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${f.tone}`} />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold">{f.label}</span>
                      <span className="block text-[11px] leading-relaxed text-muted-foreground">
                        {f.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scope */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">Cakupan</p>
            <Select
              value={opts.scope === 'all' ? 'all' : String(opts.scope)}
              onValueChange={(v) => set('scope', v === 'all' ? 'all' : Number(v))}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Seluruh job family ({families.length} kelompok)
                </SelectItem>
                {families.map((t) => (
                  <SelectItem key={t.topicId} value={String(t.topicId)} className="text-xs">
                    {t.generalTitle || t.label || `Job Family ${t.topicId}`} — {t.size} profil
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {opts.scope !== 'all' && (
              <p className="text-[11px] text-muted-foreground">
                Sheet sebaran divisi dan bagian outlier hanya ikut pada ekspor seluruh job family —
                keduanya hanya bermakna dibandingkan antar kelompok.
              </p>
            )}
          </div>

          {/* Content toggles */}
          <div className="space-y-2">
            <p className="text-xs font-semibold">Isi yang disertakan</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TOGGLES.map((t) => (
                <label
                  key={t.key}
                  htmlFor={`jf-export-${t.key}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    id={`jf-export-${t.key}`}
                    checked={opts[t.key]}
                    onCheckedChange={(v) => set(t.key, v === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-medium leading-tight">{t.label}</span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">
                      {t.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* What will actually come out */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-muted/30 p-3 text-[11px]">
            <span className="font-semibold">Akan diekspor:</span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              {counts.families} job family
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              {counts.profiles} job profile
            </span>
            {opts.includeIncumbents && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                {counts.incumbents} incumbent
              </span>
            )}
            {opts.includeOutliers && counts.outliers > 0 && opts.scope === 'all' && (
              <span className="inline-flex items-center gap-1 tabular-nums">
                <FileWarning className="h-3.5 w-3.5 text-muted-foreground" />
                {counts.outliers} outlier
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
            Batal
          </Button>
          <Button size="sm" onClick={run_} disabled={busy || counts.families === 0}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            {opts.format === 'html' ? 'Buka laporan' : 'Unduh'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
