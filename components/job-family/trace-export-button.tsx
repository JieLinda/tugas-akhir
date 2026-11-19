'use client';

// "Unduh trace perhitungan (XLSX)" on Pengaturan Job Family: the workbook of
// every number between a job profile's extracted data and its family — the
// document, the vectors, UMAP, HDBSCAN, BERTopic's topic ids, outlier re-homing
// and c-TF-IDF — as live Excel formulas beside what the library recorded and
// what the map persisted (lib/job-family-trace/). Built on the server by
// app/api/job-family/trace-xlsx; a full corpus runs to tens of megabytes, so
// the button says it is working instead of leaving the click unanswered.

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/file-download';

export function JobFamilyTraceExportButton({
  runId,
  runLabel,
  traceStored,
}: {
  /** The run the map shows (newest completed); null when none exists yet. */
  runId: string | null;
  /** When that run finished, as the page renders it. */
  runLabel: string | null;
  /** Whether that run stored its calculation trace (false → a short workbook that says so). */
  traceStored: boolean | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/job-family/trace-xlsx?runId=${encodeURIComponent(runId)}`, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        setError(text.trim() || `Trace gagal diunduh (HTTP ${res.status}).`);
        return;
      }
      downloadBlob(await res.blob(), `trace-peta-job-family-${runId.slice(0, 8)}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trace gagal diunduh.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <Button
        size="sm"
        variant="outline"
        className="h-auto min-h-8 max-w-full shrink gap-1.5 whitespace-normal py-1.5 text-left text-xs"
        disabled={!runId || busy}
        onClick={run}
        title="Workbook berisi setiap parameter, kondisi database, dan tahap pembentukan peta (embedding → UMAP → HDBSCAN → c-TF-IDF) dengan rumus Excel yang hidup — untuk verifikasi dan penelusuran manual rumus clustering dan algoritma BERTopic."
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
        {busy ? 'Menyusun workbook…' : 'Unduh trace perhitungan (XLSX)'}
      </Button>
      <span className="text-[11px] text-muted-foreground">
        {!runId
          ? 'Belum ada peta yang selesai dibangun.'
          : traceStored === false
            ? `Peta ${runLabel ?? ''} dibangun sebelum jejak perhitungan dicatat — bangun ulang peta untuk workbook lengkap.`
            : `Peta yang ditampilkan saat ini${runLabel ? ` (selesai ${runLabel})` : ''}.`}
      </span>
      {error ? <span className="basis-full text-[11px] text-destructive">{error}</span> : null}
    </div>
  );
}
