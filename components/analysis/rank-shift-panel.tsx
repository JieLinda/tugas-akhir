'use client';

// "Selisih Peringkat" — on a run derived from an earlier AHP+TOPSIS run.
//
// A "Tambah Kandidat Pembanding" child differs from its parent only by its
// candidate set, yet carried-over candidates' Kecocokan moves: TOPSIS is
// set-relative, so an added alternative changes every column's normalisation
// divisor and may become the new best or worst value of a criterion. That is
// the method behaving as defined, but it is indefensible in a succession review
// if it happens silently — so this panel shows, against the parent by default
// and against the root on request, the SAME comparison the full page computes
// (`compareRuns`, lib/run-compare.ts; FR-CMP): the sources of change, the
// template sentences and the ranking, with a link to the full comparison. It is
// the compact view of that page, not a second implementation of it.
//
// Runs the engine cannot replay — legacy modes whose pool or weights were never
// recorded — fall back to the before/after the engine wrote at the time.

import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Ban,
  History,
  Loader2,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import {
  getAhpRunDetailAction,
  type RunAugmentInfo,
  type RunExcludeInfo,
  type RunFreshnessInfo,
  type RunRankShift,
} from '@/lib/progress-running-actions';
import { getRunShiftAction, type RunShiftResult } from '@/lib/run-compare-actions';
import { shortRunId } from '@/lib/run-history';
import { CompareLink } from '@/components/analysis/run-compare/compare-nav';
import { ExplanationList, SourceSummary } from '@/components/analysis/run-compare/parts';
import { ComparisonRankingTable } from '@/components/analysis/run-compare/ranking-table';

type ChipTone = 'neutral' | 'good' | 'warn' | 'bad';

/** What the panel needs from the run's own stored record. */
type StoredView = {
  kind: 'exclude' | 'augment';
  chips: { label: string; tone: ChipTone }[];
  /** Legacy runs only: their stored explanation, which predates the full freeze. */
  legacyNote: string | null;
  driftWarning: string | null;
  shifts: RunRankShift[];
};

const TONE: Record<ChipTone, string> = {
  neutral: '',
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  bad: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

function buildStoredView(
  exclude: RunExcludeInfo | null,
  augment: RunAugmentInfo | null,
  freshness: RunFreshnessInfo | null,
): StoredView | null {
  const driftWarning =
    freshness && freshness.changedCandidates > 0 ? freshness.reason : null;
  if (exclude) {
    const chips: { label: string; tone: ChipTone }[] = [
      { label: `${exclude.excludedCount} kandidat dikecualikan`, tone: 'neutral' },
    ];
    if (exclude.backfilledCount > 0)
      chips.push({ label: `${exclude.backfilledCount} naik dari pool`, tone: 'good' });
    if (exclude.movedCount > 0)
      chips.push({ label: `${exclude.movedCount} peringkat bergeser`, tone: 'warn' });
    if (exclude.readinessChangedCount > 0)
      chips.push({ label: `${exclude.readinessChangedCount} readiness berubah`, tone: 'bad' });
    return {
      kind: 'exclude',
      chips,
      legacyNote:
        'Run ini dibuat dengan mode lama "Kecualikan kandidat", yang tidak lagi tersedia: himpunan alternatifnya dipersempit dari run dasar. ' +
        (exclude.poolSourceReason ?? ''),
      driftWarning,
      shifts: exclude.shifts,
    };
  }
  if (!augment) return null;
  const chips: { label: string; tone: ChipTone }[] = [
    { label: `${augment.addedCandidates} kandidat ditambahkan`, tone: 'neutral' },
    { label: `${augment.reusedCandidates} skor aspek dibekukan`, tone: 'neutral' },
  ];
  if (augment.newCount) chips.push({ label: `${augment.newCount} masuk daftar`, tone: 'good' });
  if (augment.movedCount)
    chips.push({ label: `${augment.movedCount} peringkat bergeser`, tone: 'warn' });
  if (augment.readinessChangedCount)
    chips.push({ label: `${augment.readinessChangedCount} readiness berubah`, tone: 'bad' });
  return {
    kind: 'augment',
    chips,
    legacyNote:
      augment.poolSource === 'finalists_only'
        ? 'Run ini dibuat sebelum re-run dibekukan penuh, dan run dasarnya tidak menyimpan snapshot seluruh pool — himpunan pembandingnya hanya finalis, jadi peringkat kandidat lama bisa bergeser karena penyempitan itu sendiri.'
        : null,
    driftWarning,
    shifts: augment.shifts ?? [],
  };
}

function RankDelta({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (delta === 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <ArrowRight className="h-3 w-3" />
        tetap
      </span>
    );
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 font-semibold',
        delta > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
      )}
    >
      {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(delta)}
    </span>
  );
}


function StoredShiftTable({ shifts }: { shifts: RunRankShift[] }) {
  if (shifts.length === 0)
    return (
      <p className="text-[11px] text-muted-foreground">
        Run ini selesai sebelum tabel pergeseran dicatat, jadi perbandingan peringkat sebelum /
        sesudah tidak tersedia.
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-[11px]">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Kandidat</th>
            <th className="py-1 pr-2 font-medium">Peringkat</th>
            <th className="py-1 pr-2 font-medium">Δ</th>
            <th className="py-1 pr-2 font-medium">Skor</th>
            <th className="py-1 font-medium">Readiness</th>
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => (
            <tr key={s.candidateId} className="border-b border-border/40 last:border-0">
              <td className="py-1 pr-2">
                <span className="font-medium">{s.name}</span>
                {s.baseRank == null ? (
                  <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-px text-[9px] font-semibold text-sky-700 dark:text-sky-300">
                    <UserPlus className="h-2.5 w-2.5" />
                    kandidat baru
                  </span>
                ) : (
                  s.backfilled && (
                    <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                      <Sparkles className="h-2.5 w-2.5" />
                      naik dari pool
                    </span>
                  )
                )}
              </td>
              <td className="py-1 pr-2 font-mono">
                {s.baseRank ?? '—'} → {s.newRank}
              </td>
              <td className="py-1 pr-2">
                <RankDelta delta={s.baseRank == null ? null : s.baseRank - s.newRank} />
              </td>
              <td className="py-1 pr-2 font-mono">
                {s.baseScore ?? '—'} → {s.newScore}
              </td>
              <td className="py-1">
                {s.baseReadiness ? `${s.baseReadiness} → ` : ''}
                {s.newReadiness}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RankShiftPanel({ runId, positionId }: { runId: string; positionId: string }) {
  const [stored, setStored] = useState<StoredView | null | undefined>(undefined);
  const [against, setAgainst] = useState<'parent' | 'root'>('parent');
  const [shift, setShift] = useState<RunShiftResult | null | undefined>(undefined);

  // What the engine recorded at the time — only used when the pair cannot be
  // replayed (legacy runs).
  useEffect(() => {
    let active = true;
    setStored(undefined);
    setAgainst('parent');
    getAhpRunDetailAction(runId)
      .then((detail) => {
        if (active)
          setStored(
            buildStoredView(
              detail.runInfo?.exclude ?? null,
              detail.runInfo?.augment ?? null,
              detail.runInfo?.freshness ?? null,
            ),
          );
      })
      .catch(() => active && setStored(null));
    return () => {
      active = false;
    };
  }, [runId]);

  useEffect(() => {
    let active = true;
    setShift(undefined);
    getRunShiftAction(runId, against)
      .then((r) => active && setShift(r))
      .catch(() => active && setShift(null));
    return () => {
      active = false;
    };
  }, [runId, against]);

  if (shift === undefined)
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Memeriksa selisih peringkat…
      </div>
    );
  // A root run — not derived from another, so there is no "before".
  if (!shift || shift.kind === 'root') return null;

  const rootIsParent = shift.rootIsParent;
  const KindIcon = stored?.kind === 'exclude' ? Ban : UserPlus;

  return (
    <div className="space-y-3 rounded-lg border border-sky-200/70 bg-sky-50/40 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <KindIcon className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
          Selisih Peringkat
          <InfoHint title="Selisih Peringkat">
            Peringkat run ini dibandingkan dengan induk langsungnya atau root-nya, memakai mesin perbandingan yang sama
            dengan tab Komparasi Versi. Kedua peringkat dihitung ulang dari skor aspek seluruh pool dan bobot yang disimpan
            masing-masing run, tanpa data hari ini dan tanpa model bahasa.
          </InfoHint>
        </span>
        <div className="inline-flex rounded-md border bg-background p-0.5 text-[10px]" role="group" aria-label="Bandingkan dengan">
          {(['parent', 'root'] as const).map((k) => (
            <button
              key={k}
              type="button"
              disabled={k === 'root' && rootIsParent}
              aria-pressed={against === k}
              onClick={() => setAgainst(k)}
              title={k === 'root' && rootIsParent ? 'Induk run ini sudah merupakan root.' : undefined}
              className={cn(
                'rounded px-2 py-0.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                against === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {k === 'parent' ? 'vs induk langsung' : 'vs root'}
            </button>
          ))}
        </div>
        {shift.baseRunId && (
          <CompareLink
            positionId={positionId}
            a={shift.baseRunId}
            b={runId}
            className="ml-auto text-[11px] font-semibold text-primary hover:underline"
          >
            Buka perbandingan lengkap →
          </CompareLink>
        )}
      </div>

      {shift.kind === 'compared' ? (
        <>
          <p className="text-[11px] text-muted-foreground">
            Run A = <strong>{shift.against === 'parent' ? 'induk' : 'root'}</strong>{' '}
            <span className="font-mono">{shortRunId(shift.baseRunId)}</span>, run B = run ini.
          </p>
          <SourceSummary sources={shift.comparison.sources} freezeViolations={shift.comparison.freezeViolations} compact />
          <ExplanationList items={shift.comparison.explanations.summary} />
          <ComparisonRankingTable dto={shift.comparison} compact />
        </>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            {shift.reason}
            {stored ? ' Ditampilkan pergeseran yang dicatat saat run selesai.' : ''}
          </p>
          {stored?.legacyNote && (
            <p className="flex items-start gap-1.5 rounded border border-slate-400/40 bg-slate-400/10 p-2 text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
              <History className="mt-px h-3 w-3 shrink-0" />
              {stored.legacyNote}
            </p>
          )}
          {stored?.driftWarning && (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
              {stored.driftWarning}
            </p>
          )}
          {stored && (
            <div className="flex flex-wrap gap-1">
              {stored.chips.map((c) => (
                <Badge key={c.label} variant="outline" className={`text-[10px] ${TONE[c.tone]}`}>
                  {c.label}
                </Badge>
              ))}
            </div>
          )}
          {stored && <StoredShiftTable shifts={stored.shifts} />}
        </>
      )}
    </div>
  );
}

