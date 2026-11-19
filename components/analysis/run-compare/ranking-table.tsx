'use client';

// FR-CMP-06 — every candidate of A ∪ B: membership, rank A → B with its Δ
// (arrow AND words), Kecocokan A → B with Δ in percentage points, finalist
// status, readiness and the forum's decision on each side, and the markers. B's order by default; three
// filters a forum actually asks for.

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, Gavel } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import type { RankingRow } from '@/lib/run-compare';
import { fmtCloseness, fmtPp } from '@/lib/run-compare-format';
import { finalistText, membershipLabel, RankDelta, RowMarkers } from './parts';

type Filter = 'changed' | 'finalists' | 'comparison';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'changed', label: 'Hanya yang berubah' },
  { key: 'finalists', label: 'Hanya finalis' },
  { key: 'comparison', label: 'Hanya kandidat pembanding' },
];

export function isChangedRow(r: RankingRow): boolean {
  return (
    r.membership !== 'both' ||
    (r.deltaRank ?? 0) !== 0 ||
    Math.abs(r.deltaPp ?? 0) >= 0.05 ||
    r.finalistChange === 'masuk' ||
    r.finalistChange === 'keluar'
  );
}

function Decision({ text }: { text: string | null }) {
  if (text == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1" title={text || 'Dipilih forum (justifikasi tidak tercatat)'}>
      <Gavel className="h-3 w-3 text-emerald-700 dark:text-emerald-400" aria-hidden />
      Dipilih
    </span>
  );
}

export function ComparisonRankingTable({
  dto,
  compact = false,
  onSelectCandidate,
}: {
  dto: ComparisonDto;
  /** The run-page panel: fewer columns, rows on either list only by default. */
  compact?: boolean;
  onSelectCandidate?: (candidateId: string) => void;
}) {
  const [filters, setFilters] = useState<Set<Filter>>(new Set(compact ? ['finalists'] : []));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const colCount = compact ? 6 : 9;
  const rows = useMemo(
    () =>
      dto.ranking.filter(
        (r) =>
          (!filters.has('changed') || isChangedRow(r)) &&
          (!filters.has('finalists') || r.finalistA || r.finalistB || r.markers.comparison) &&
          (!filters.has('comparison') || r.markers.comparison),
      ),
    [dto, filters],
  );
  const toggle = (f: Filter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Saringan tabel peringkat">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filters.has(f.key)}
            onClick={() => toggle(f.key)}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all duration-200 focus-visible:outline-2 focus-visible:outline-primary',
              filters.has(f.key)
                ? 'border-indigo-500/50 bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-indigo-950'
                : 'text-muted-foreground hover:border-foreground/20 hover:bg-muted hover:text-foreground',
            )}
          >
            {filters.has(f.key) ? '✓ ' : ''}
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">
          {rows.length} dari {dto.ranking.length} kandidat · urut menurut peringkat B
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border shadow-xs">
        <table className={cn('w-full text-[11px]', compact ? 'min-w-[640px]' : 'min-w-[1080px]')}>
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kandidat</th>
              {!compact && <th className="px-2 py-1.5 font-medium">Keanggotaan</th>}
              <th className="px-2 py-1.5 font-medium">Peringkat A → B</th>
              <th className="px-2 py-1.5 font-medium">Δ peringkat</th>
              <th className="px-2 py-1.5 font-medium">Kecocokan A → B</th>
              <th className="px-2 py-1.5 font-medium">Δ</th>
              <th className="px-2 py-1.5 font-medium">Finalis</th>
              {!compact && <th className="px-2 py-1.5 font-medium">Readiness A → B</th>}
              {!compact && <th className="px-2 py-1.5 font-medium">Keputusan forum A | B</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">
                  Tidak ada kandidat yang cocok dengan saringan ini. Matikan salah satu saringan untuk melihat kandidat lain.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const explanation = dto.explanations.perCandidate[r.candidateId]?.[0]?.text ?? null;
                const isOpen = open.has(r.candidateId);
                return (
                  <Fragment key={r.candidateId}>
                  <tr
                    className={cn(
                      'border-t border-border/50 align-top transition-colors hover:bg-muted/30',
                      r.finalistChange === 'masuk' && 'bg-blue-500/[0.04]',
                      r.finalistChange === 'keluar' && 'bg-orange-500/[0.05]',
                    )}
                  >
                    <td className="px-2 py-1.5">
                      {onSelectCandidate ? (
                        <button
                          type="button"
                          onClick={() => onSelectCandidate(r.candidateId)}
                          className="text-left font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                          title="Buka rincian perhitungan kandidat ini"
                        >
                          {r.name}
                        </button>
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                      {r.unit && <span className="ml-1 text-muted-foreground">· {r.unit}</span>}
                      <div className="mt-0.5">
                        <RowMarkers row={r} />
                      </div>
                      {explanation && (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setOpen((prev) => {
                              const next = new Set(prev);
                              next.has(r.candidateId) ? next.delete(r.candidateId) : next.add(r.candidateId);
                              return next;
                            })
                          }
                          className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                        >
                          <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} aria-hidden />
                          Penjelasan
                        </button>
                      )}
                    </td>
                    {!compact && (
                      <td className="px-2 py-1.5">
                        {membershipLabel(r.membership)}
                        {r.membership !== 'both' && (
                          <p className="text-[10px] text-muted-foreground">
                            {r.membershipReason ?? 'Sebab tidak tercatat pada data tersimpan.'}
                          </p>
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums">
                      {r.rankA ?? '—'} → {r.rankB ?? '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      <RankDelta delta={r.deltaRank} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                      {r.ccA != null ? fmtCloseness(r.ccA) : '—'} → {r.ccB != null ? fmtCloseness(r.ccB) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{r.deltaPp != null ? fmtPp(r.deltaPp) : '—'}</td>
                    <td className="px-2 py-1.5">
                      <span
                        className={cn(
                          'inline-flex whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold',
                          r.finalistChange === 'masuk'
                            ? 'bg-blue-500/12 text-blue-800 dark:text-blue-200'
                            : r.finalistChange === 'keluar'
                              ? 'bg-orange-500/12 text-orange-800 dark:text-orange-200'
                              : r.finalistChange === 'tetap'
                                ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                                : 'text-muted-foreground',
                        )}
                      >
                        {finalistText(r.finalistChange)}
                      </span>
                    </td>
                    {!compact && (
                      <td className="px-2 py-1.5">
                        {r.readinessA ?? '—'} → {r.readinessB ?? '—'}
                      </td>
                    )}
                    {!compact && (
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <Decision text={r.decisionA} /> | <Decision text={r.decisionB} />
                      </td>
                    )}
                  </tr>
                  {isOpen && explanation && (
                    <tr className="bg-muted/20">
                      <td colSpan={colCount} className="px-3 py-1.5 text-[11px] leading-relaxed">
                        {explanation}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
