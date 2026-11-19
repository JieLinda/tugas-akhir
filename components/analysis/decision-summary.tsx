'use client';

// "Rekomendasi sistem dan keputusan forum" (FR-DEC-02, L-1) — now part of the
// "Komparasi Versi" tab instead of a card of its own above every tab.
//
// A forum decision is made FROM a ranking, so it is shown beside that ranking:
// the system's top N of the run the decision cites, and who the forum chose,
// with that person's rank in the same run and the justification. When the
// forum did not take the system's first choice, the justification is the most
// important text on the card, so it is lifted out as "Alasan berbeda dari
// rekomendasi" instead of sitting in a note.
//
// Two renderings of the same read:
//  • DecisionRecord — every decision on the position, grouped by the run it
//    cites, each run one click from the comparison (A or B).
//  • PairDecisions — the same decisions seen from the pair on screen: where
//    each chosen successor stands in run A and in run B. That is the question
//    a comparison exists to answer for a forum ("does our choice still hold
//    once these candidates are added?"), so it sits in the summary.

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Gavel, Loader2 } from 'lucide-react';
import { getDecisionSummaryAction, type DecisionSummary } from '@/lib/run-history-actions';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import { formatDateTime } from '@/lib/datetime';
import { fmtCloseness, fmtNumber, fmtRankDelta } from '@/lib/run-compare-format';
import { shortRunId } from '@/lib/run-history';
import { rerunSpec } from '@/lib/rerun-modes';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { SideBadge, type PairSide } from './run-compare/lineage-navigator';

const scoreText = (method: string, score: number) =>
  method === 'AHP_TOPSIS' ? fmtCloseness(score) : `Skor ${fmtNumber(score, 1)}`;

/** One read, refreshed when the picks change (`refreshKey`). */
export function useDecisionSummary(positionId: string, refreshKey: string) {
  const [data, setData] = useState<DecisionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setError(null);
    getDecisionSummaryAction(positionId)
      .then((d) => active && setData(d))
      .catch(() => active && setError('Ringkasan keputusan forum tidak dapat dimuat. Muat ulang halaman untuk mencoba lagi.'));
    return () => {
      active = false;
    };
  }, [positionId, refreshKey]);
  return { data, error };
}

export function decisionCount(data: DecisionSummary | null): number {
  if (!data) return 0;
  return data.runs.reduce((n, r) => n + r.decisions.length, 0) + data.unlinked.length;
}

function RankPill({ rank, tone = 'default' }: { rank: number | null; tone?: 'default' | 'chosen' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-bold tabular-nums',
        tone === 'chosen'
          ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
      )}
    >
      {rank ?? '—'}
    </span>
  );
}

const NOT_RECORDED = 'Justifikasi tidak tercatat (keputusan dibuat sebelum justifikasi diwajibkan).';

/** The label's first segment — the date is printed beside it, not twice. */
const shortLabel = (label: string | null) => label?.split('—')[0]?.trim() || label || 'Tanpa label';
/** "Run root", as the navigator and the run history call a baseline run. */
const kindText = (modeLabel: string) => (modeLabel === rerunSpec('baseline').label ? 'Run root' : modeLabel);

/** The full record: every decision on the position, by the run it cites. */
export function DecisionRecord({
  data,
  error,
  programLabels,
  a,
  b,
  onCompare,
}: {
  data: DecisionSummary | null;
  error: string | null;
  programLabels: Record<string, string>;
  /** Runs currently in the comparison, so their blocks say so. */
  a?: string | null;
  b?: string | null;
  /** Put a decision's run into the comparison. Absent → no buttons. */
  onCompare?: (side: PairSide, runId: string) => void;
}) {
  if (error) return <p className="text-xs text-rose-600">{error}</p>;
  if (!data)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat keputusan forum…
      </p>
    );
  if (data.runs.length === 0 && data.unlinked.length === 0)
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        <Gavel className="mx-auto mb-2 h-5 w-5 opacity-60" aria-hidden />
        Belum ada keputusan forum untuk posisi ini. Tetapkan suksesor dari daftar kandidat sebuah run (tab Kandidat);
        keputusan akan tampil di sini berdampingan dengan rekomendasi run tersebut.
      </div>
    );

  const total = decisionCount(data);
  const differing = data.runs.reduce((n, r) => n + r.decisions.filter((d) => d.rankInRun !== 1).length, 0);

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="rounded-full bg-emerald-500/12 px-2.5 py-0.5 font-semibold text-emerald-800 dark:text-emerald-200">
          {total} keputusan pada {data.runs.length} run
        </span>
        {differing > 0 && (
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 font-semibold text-amber-800 dark:text-amber-200">
            {differing} berbeda dari rekomendasi teratas
          </span>
        )}
        <InfoHint size="xs" title="Rekomendasi sistem">
          Rekomendasi adalah peringkat 1–N run yang dirujuk keputusan, apa adanya saat run itu selesai.
        </InfoHint>
      </p>

      {data.runs.map(({ run, recommendation, decisions }) => {
        const side: PairSide | null = run.id === b ? 'b' : run.id === a ? 'a' : null;
        const top = recommendation[0] ?? null;
        return (
          <article
            key={run.id}
            className={cn(
              'overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow duration-300 hover:shadow-md',
              side === 'b' ? 'border-indigo-400/70 dark:border-indigo-700' : side === 'a' ? 'border-slate-500/60' : 'border-slate-200 dark:border-slate-800',
            )}
          >
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-linear-to-r from-emerald-500/8 via-muted/30 to-transparent px-4 py-2">
              {side && <SideBadge side={side} />}
              <span className="text-sm font-semibold">
                Run <span className="font-mono">{run.shortId}</span>
              </span>
              <span className="min-w-0 truncate text-xs text-muted-foreground" title={run.label ?? undefined}>
                {shortLabel(run.label)}
              </span>
              <span className="text-xs text-muted-foreground">· {formatDateTime(run.createdAt)}</span>
              <span className="rounded border px-1.5 text-[10px] font-medium">{kindText(run.modeLabel)}</span>
              {onCompare && run.method === 'AHP_TOPSIS' && (
                <span className="ml-auto flex items-center gap-1">
                  {(['a', 'b'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onCompare(s, run.id)}
                      disabled={(s === 'a' ? a : b) === run.id}
                      className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium hover:bg-muted disabled:opacity-40"
                    >
                      Jadikan <SideBadge side={s} className="h-4 min-w-4 text-[9px]" />
                    </button>
                  ))}
                </span>
              )}
            </header>

            <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:divide-x divide-slate-200/70 dark:divide-slate-800">
              <div className="p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Rekomendasi sistem · peringkat 1–{recommendation.length}
                </p>
                <ol className="space-y-1">
                  {recommendation.map((r) => {
                    const chosen = decisions.some((d) => d.candidateId === r.candidateId);
                    return (
                      <li
                        key={r.candidateId}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-1.5 py-1 text-xs',
                          chosen && 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30',
                        )}
                      >
                        <RankPill rank={r.rank} tone={chosen ? 'chosen' : 'default'} />
                        <span className={cn('min-w-0 flex-1 truncate', chosen && 'font-semibold')}>{r.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground" title="Kecocokan (skor TOPSIS) di run ini">
                          {scoreText(run.method, r.score)}
                        </span>
                        {chosen && (
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" aria-hidden /> Dipilih
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>

              <div className="space-y-3 p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Keputusan forum</p>
                {decisions.map((d) => {
                  const asRecommended = d.rankInRun === 1;
                  return (
                    <div key={d.pickId} className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Gavel className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden />
                        <span className="text-sm font-semibold">{d.name}</span>
                        {d.candidateDeleted && <span className="text-[10px] text-muted-foreground">(data kini dihapus)</span>}
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
                          {d.rankInRun != null ? `Peringkat ${d.rankInRun} di run ini` : 'Tidak diperingkat di run ini'}
                        </span>
                        {asRecommended ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:text-emerald-200">
                            <CheckCircle2 className="h-3 w-3" aria-hidden /> Sesuai rekomendasi teratas
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                            <AlertTriangle className="h-3 w-3" aria-hidden /> Berbeda dari rekomendasi teratas
                          </span>
                        )}
                      </div>
                      {asRecommended ? (
                        <p className="whitespace-pre-line text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Justifikasi:</span> {d.justification?.trim() || NOT_RECORDED}
                        </p>
                      ) : (
                        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2.5">
                          <p className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
                            <AlertTriangle className="h-3 w-3" aria-hidden />
                            Alasan berbeda dari rekomendasi
                            {top && (
                              <span className="font-normal">
                                {' '}
                                (peringkat 1 sistem: {top.name})
                              </span>
                            )}
                          </p>
                          <p className="mt-1 whitespace-pre-line text-xs text-amber-950 dark:text-amber-50">
                            {d.justification?.trim() || NOT_RECORDED}
                          </p>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {programLabels[d.programCode] ?? d.programCode}
                        {d.decidedBy ? ` · oleh ${d.decidedBy}` : ''} · {formatDateTime(d.decidedAt)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </article>
        );
      })}

      {data.unlinked.length > 0 && (
        <div className="rounded-xl border border-dashed p-4 text-xs">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Keputusan yang run dasarnya sudah dihapus
          </p>
          <ul className="space-y-1">
            {data.unlinked.map((d) => (
              <li key={d.pickId}>
                <span className="font-semibold">{d.name}</span> · {programLabels[d.programCode] ?? d.programCode} ·{' '}
                {formatDateTime(d.decidedAt)}
                {d.justification && <span className="text-muted-foreground"> — {d.justification}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The decisions seen from the pair on screen: where each chosen successor
 * stands in A and in B. Every decision on the position is listed, not only the
 * ones citing A or B — "where is the person we chose?" is the question either way.
 */
export function PairDecisions({
  data,
  dto,
  onOpenRecord,
}: {
  data: DecisionSummary | null;
  dto: ComparisonDto;
  onOpenRecord: () => void;
}) {
  if (!data) return null;
  const rows = data.runs.flatMap(({ run, decisions }) =>
    decisions.map((d) => ({ run, d, ranking: dto.ranking.find((r) => r.candidateId === d.candidateId) ?? null })),
  );
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 6);
  const where = (rank: number | null | undefined, finalist: boolean | null | undefined) =>
    rank == null ? 'tidak ada' : `#${rank}${finalist === false ? ' (bukan finalis)' : ''}`;

  return (
    <section
      className="rounded-2xl border border-emerald-500/30 bg-linear-to-br from-emerald-500/10 via-emerald-500/4 to-card p-4 shadow-xs"
      aria-label="Keputusan forum pada pasangan ini"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
          <Gavel className="h-3.5 w-3.5" aria-hidden />
        </span>
        <h4 className="text-sm font-semibold">Suksesor yang dipilih forum, di run A dan B</h4>
        <button type="button" onClick={onOpenRecord} className="ml-auto text-[11px] font-semibold text-primary hover:underline">
          Lihat rekomendasi sistem dan keputusan forum →
        </button>
      </div>
      <ul className="divide-y divide-emerald-500/15">
        {shown.map(({ run, d, ranking }) => {
          const delta = ranking?.deltaRank ?? null;
          const cites = run.id === dto.a.id ? 'a' : run.id === dto.b.id ? 'b' : null;
          return (
            <li key={d.pickId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
              <span className="min-w-40 font-semibold">{d.name}</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                diputuskan dari run <span className="font-mono">{shortRunId(run.id)}</span>
                {cites && <SideBadge side={cites} className="h-4 min-w-4 text-[9px]" />}
              </span>
              <span className="ml-auto inline-flex items-center gap-2 tabular-nums">
                <span className="inline-flex items-center gap-1">
                  <SideBadge side="a" className="h-4 min-w-4 text-[9px]" /> {where(ranking?.rankA, ranking?.finalistA)}
                </span>
                <span aria-hidden>→</span>
                <span className="inline-flex items-center gap-1">
                  <SideBadge side="b" className="h-4 min-w-4 text-[9px]" /> {where(ranking?.rankB, ranking?.finalistB)}
                </span>
                {delta != null && <span className="w-24 text-right font-semibold">{fmtRankDelta(delta)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length && (
        <p className="mt-1 text-[11px] text-muted-foreground">dan {rows.length - shown.length} keputusan lain.</p>
      )}
    </section>
  );
}
