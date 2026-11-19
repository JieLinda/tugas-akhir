'use client';

// L-3 — what the run on screen IS, said before its ranking is read.
//
// A "Tambah Kandidat Pembanding" child: whose child it is, how many comparison
// candidates it added, that everything else follows the parent, a link to the
// comparison with the parent, the candidates the server refused and why
// (FR-RR-10), and — in amber — anything that had to be read from today's state
// instead of the parent (I-3, I-6). A root: an offer to compare it with the root
// before it (FR-RH-04). A legacy-mode run: that its mode no longer exists.

import { useEffect, useState } from 'react';
import { AlertTriangle, GitCompare, History, Link2Off, UserPlus, XCircle } from 'lucide-react';
import { getRunLineageSummaryAction, type RunLineageSummary } from '@/lib/run-history-actions';
import { CompareLink } from '@/components/analysis/run-compare/compare-nav';

export function DerivedRunBanner({ runId, positionId }: { runId: string; positionId: string }) {
  const [s, setS] = useState<RunLineageSummary | null>(null);
  useEffect(() => {
    let active = true;
    setS(null);
    getRunLineageSummaryAction(runId)
      .then((r) => active && setS(r))
      .catch(() => active && setS(null));
    return () => {
      active = false;
    };
  }, [runId]);
  if (!s) return null;

  if (!s.isChild && !s.legacy && !s.parentDeleted) {
    if (!s.previousRoot || s.status !== 'completed' || s.method !== 'AHP_TOPSIS') return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/30">
        <span>
          Run root <span className="font-mono">{s.shortId}</span>. Posisi ini punya run root sebelumnya (
          <span className="font-mono">{s.previousRoot.shortId}</span>) yang dapat dibandingkan untuk melihat dampak
          perubahan data atau konfigurasi.
        </span>
        <CompareLink
          positionId={positionId}
          a={s.previousRoot.id}
          b={s.runId}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
        >
          <GitCompare className="h-3.5 w-3.5" />
          Bandingkan dengan root sebelumnya
        </CompareLink>
      </div>
    );
  }

  // Read from today's state vs merely noted (not recorded, derived, carried).
  const LIVE = new Set(['weights_live', 'anchors_live', 'basis_live', 'basis_part_live', 'basis_caveat', 'models_changed']);
  const liveWarnings = s.warnings.filter((w) => LIVE.has(w.key));
  const otherNotes = s.warnings.filter((w) => !LIVE.has(w.key));
  const newCount = s.added.filter((a) => !a.existingPool).length;
  const existingCount = s.added.length - newCount;

  return (
    <div className="space-y-2 rounded-lg border border-emerald-300/60 bg-emerald-50/50 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/20">
      {s.isChild ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserPlus className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
          <span className="font-semibold">
            Turunan dari Run {s.parent ? <span className="font-mono">{s.parent.shortId}</span> : '(induk dihapus)'} —{' '}
            {s.added.length} kandidat pembanding ditambahkan.
          </span>
          <span>Bobot, kriteria aktif, aturan, jangkar, dan tanggal acuan mengikuti run induk.</span>
          {s.parent && (
            <CompareLink
              positionId={positionId}
              a={s.parent.id}
              b={s.runId}
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              <GitCompare className="h-3.5 w-3.5" />
              Lihat perbandingan dengan induk
            </CompareLink>
          )}
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          <History className="h-4 w-4 text-slate-600" aria-hidden />
          <span className="font-semibold">{s.modeLabel}.</span>
          <span>Mode ini tidak lagi dapat dibuat; hasilnya tetap utuh, dapat dibuka, dan dapat dibandingkan.</span>
        </p>
      )}

      {s.parentDeleted && (
        <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
          <Link2Off className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          Induk run ini sudah dihapus. Run ini tidak dihitung ulang dan tetap dapat dibuka, tetapi tidak dapat
          dibandingkan dengan induknya.
        </p>
      )}

      {s.reason && (
        <p>
          <span className="font-semibold">Alasan / permintaan forum:</span> {s.reason}
        </p>
      )}

      {s.isChild && s.added.length > 0 && (
        <div>
          <p className="font-semibold">
            Kandidat pembanding ({newCount} dinilai baru{existingCount > 0 ? `, ${existingCount} sudah ada di pool induk` : ''})
          </p>
          <ul className="mt-0.5 flex flex-wrap gap-1">
            {s.added.map((a) => (
              <li key={a.candidateId} className="inline-flex flex-wrap items-center gap-1 rounded border bg-background px-1.5 py-0.5">
                <span className="font-medium">{a.name}</span>
                {a.existingPool && <span className="text-[10px] text-muted-foreground">· sudah ada di pool induk, tidak dinilai ulang</span>}
                {a.outOfRange && <span className="text-[10px] font-semibold text-orange-700 dark:text-orange-300">· di luar rentang grade</span>}
                {a.advisory.length > 0 && <span className="text-[10px] text-muted-foreground">· ditandai: {a.advisory.join('; ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.skipped.length > 0 && (
        <div>
          <p className="flex items-center gap-1 font-semibold">
            <XCircle className="h-3.5 w-3.5 text-rose-600" aria-hidden />
            Kandidat yang ditolak ({s.skipped.length})
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {s.skipped.map((k) => (
              <li key={k.candidateId}>
                <span className="font-medium">{k.name ?? 'Kandidat'}</span> — {k.message}
                {/* The message already quotes its rules when the server wrote them in. */}
                {k.rules.length > 0 && !k.rules.every((r) => k.message.includes(r)) && (
                  <span className="text-muted-foreground"> ({k.rules.join('; ')})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {liveWarnings.length > 0 && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
          <p className="flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            Nilai hari ini dipakai pada run ini
          </p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-100">
            {liveWarnings.map((w, i) => (
              <li key={`${w.key}-${i}`}>{w.text}</li>
            ))}
          </ul>
        </div>
      )}
      {otherNotes.length > 0 && (
        <div className="rounded-md border border-slate-400/50 bg-slate-400/10 p-2">
          <p className="font-semibold">Catatan pembekuan</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
            {otherNotes.map((w, i) => (
              <li key={`${w.key}-${i}`}>{w.text}</li>
            ))}
          </ul>
        </div>
      )}

      {s.provisionalCount > 0 && (
        <p className="text-violet-800 dark:text-violet-200">
          {s.provisionalCount} kandidat bernilai sementara: sebagian aspeknya tidak dapat dibaca saat penilaian.
        </p>
      )}
    </div>
  );
}
