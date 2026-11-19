'use client';

// L-5 — the run's snapshot: what this run was computed WITH, in the words of
// the naskah, every item with where its value came from (I-3). Nothing here is
// read from today's governance: an item an older run did not store says "Tidak
// tersimpan pada run ini" instead of borrowing today's value (I-6). The raw
// blobs download as JSON for audit (FR-SN-03), and "Periksa keterulangan"
// replays the run from what it stored (NFR-RR-01).
//
// This file used to render its own panel ("Snapshot run #…", nine numbered
// sections) above the Konfigurasi panel, which then repeated half of it — the
// matrix, the weights, the thresholds, the rules — in a second visual language.
// The Konfigurasi tab now renders ONE hierarchy (run-configuration-panel.tsx)
// and takes the snapshot's items from here, each placed in the section it
// belongs to. Every item the old panel showed is still shown there, and so are
// its three actions: keterulangan, the JSON snapshot and the XLSX trace.

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Origin, ReproducibilityResult } from '@/lib/run-compare';
import {
  getRunSnapshotAction,
  verifyRunReproducibilityAction,
  type RunSnapshotView,
} from '@/lib/run-compare-actions';
import { fmtTiny } from '@/lib/run-compare-format';
import { shortRunId } from '@/lib/run-history';
import { downloadBlob } from '@/lib/file-download';
import { OriginTag } from './run-compare/parts';

export const NOT_STORED = 'Tidak tersimpan pada run ini';

// The engine's phases in the order it runs them. jsonb re-sorts object keys
// (shortest first), so the stored order is not the execution order.
export const PHASE_LABEL: Record<string, string> = {
  load: 'Memuat data',
  basis: 'Basis posisi',
  technical: 'Kompetensi Teknis',
  career: 'Relevansi Karier',
  behavior: 'Behavior, PA, HAV',
  education: 'Pendidikan',
  topsis: 'AHP + TOPSIS',
  persist: 'Menyimpan hasil',
  narrative: 'Narasi',
  finalize: 'Finalisasi',
};
const PHASE_ORDER = Object.keys(PHASE_LABEL);
export const phaseRank = (p: string) => {
  const i = PHASE_ORDER.indexOf(p);
  return i < 0 ? PHASE_ORDER.length : i;
};

export const SYNC_LABEL: Record<string, string> = {
  employees: 'Karyawan',
  performance: 'Performance Appraisal',
  'behavior-competencies': 'Behavior',
  hav: 'HAV',
  'technical-competencies': 'Kompetensi',
  'position-history': 'Riwayat jabatan',
};

/** A bordered list of snapshot items. */
export function SnapshotList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-xl border bg-background/60', className)}>{children}</div>;
}

/**
 * One snapshot item: label, value, and where the value came from. The origin
 * tag sits beside the value and wraps under it when the column is narrow, so a
 * half-width list never squeezes the value into a three-line sliver.
 */
export function SnapshotItem({
  label,
  origin,
  children,
}: {
  label: string;
  origin?: Origin;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-1 border-t px-3 py-2 text-xs transition-colors first:border-t-0 hover:bg-muted/30 sm:grid-cols-[minmax(7.5rem,11.5rem)_1fr] sm:gap-3">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 basis-40 break-words">{children}</span>
        {origin ? <OriginTag origin={origin} /> : null}
      </span>
    </div>
  );
}

export function downloadSnapshot(view: RunSnapshotView) {
  const blob = new Blob([JSON.stringify({ runId: view.runId, ...view.raw }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `snapshot-run-${shortRunId(view.runId).slice(1)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Unduh trace perhitungan (XLSX)": every number between the candidates' raw data
 * and the final rank, with live Excel formulas (lib/run-trace/). Built on the
 * server from what the run stored, so it streams from a route instead of being
 * assembled here. Resolves to an error message, or null when the file was saved.
 */
export async function downloadTrace(runId: string): Promise<string | null> {
  const res = await fetch(`/api/scoring-runs/${runId}/trace-xlsx`, { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return text.trim() || `Trace gagal diunduh (HTTP ${res.status}).`;
  }
  const blob = await res.blob();
  downloadBlob(blob, `trace-perhitungan-run-${shortRunId(runId).slice(1)}.xlsx`);
  return null;
}

/** The trace export's state for a button: running, and the last error to show. */
export function useTraceExport(runId: string) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [runId]);
  const run = useCallback(async () => {
    setExporting(true);
    setError(null);
    try {
      setError(await downloadTrace(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trace gagal diunduh.');
    } finally {
      setExporting(false);
    }
  }, [runId]);
  return { exporting, error, run };
}

/** undefined while loading, null when it could not be read. */
export function useRunSnapshot(runId: string): RunSnapshotView | null | undefined {
  const [view, setView] = useState<RunSnapshotView | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    setView(undefined);
    getRunSnapshotAction(runId)
      .then((v) => active && setView(v))
      .catch(() => active && setView(null));
    return () => {
      active = false;
    };
  }, [runId]);
  return view;
}

/** "Periksa keterulangan" — replay the run from what it stored (NFR-RR-01). */
export function useReproducibilityCheck(runId: string) {
  const [repro, setRepro] = useState<ReproducibilityResult | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => setRepro(null), [runId]);
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setRepro(await verifyRunReproducibilityAction(runId));
    } finally {
      setChecking(false);
    }
  }, [runId]);
  return { repro, checking, check };
}

export function ReproducibilityNotice({ repro }: { repro: ReproducibilityResult }) {
  const ok = repro.verifiable && repro.reproducible;
  return (
    <p
      role="status"
      className={cn(
        'flex items-start gap-2 rounded-xl border p-3 text-xs leading-relaxed animate-in fade-in-0 slide-in-from-top-1 duration-300',
        ok ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-amber-500/50 bg-amber-500/10',
      )}
    >
      {ok ? (
        <CheckCircle2 className="mt-px h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
      ) : (
        <XCircle className="mt-px h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
      )}
      <span>
        {!repro.verifiable
          ? `Tidak dapat diverifikasi: ${repro.reason}`
          : repro.reproducible
            ? `Terulang: TOPSIS yang dihitung ulang dari ${repro.checked} skor aspek, bobot, dan kriteria aktif yang tersimpan menghasilkan kecocokan dan peringkat yang sama (selisih maks ${fmtTiny(repro.maxStoredDelta)}${
                repro.maxFullDelta != null ? `; presisi penuh ${fmtTiny(repro.maxFullDelta)}` : ''
              }).`
            : `TIDAK terulang: ${repro.rankMismatches.length} peringkat dan ${repro.closenessMismatches.length} kecocokan berbeda dari yang tersimpan. Laporkan run ini.`}{' '}
        Bagian yang memakai model bahasa (pendidikan, MCU) tidak dihitung ulang dari nol karena model bahasa tidak
        deterministik; itulah sebabnya hasil mentahnya disimpan.
      </span>
    </p>
  );
}

/** Inline state for a snapshot that is still loading or could not be read. */
export function SnapshotPending({ view }: { view: RunSnapshotView | null | undefined }) {
  if (view === undefined)
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat snapshot run…
      </p>
    );
  return <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">Snapshot run tidak dapat dimuat.</p>;
}
