'use client';

// The one prominent element of the comparison page (§6): how the finalists —
// and every comparison candidate — moved from run A to run B.
//
// Each side lists its candidates in rank order, one slot per candidate, so the
// vertical position is the ORDER on that side and the number printed at each
// end is the real rank (a finalist pushed to 37th does not stretch the chart to
// 37 rows; its label says 37). A line joins the same person in both runs.
// Direction is a diverging pair validated for colour-vision deficiency (blue
// up, orange down, gray unchanged — green/red measured ΔE 5.8 under deutan and
// was refused), and is never colour alone: every right-hand label carries
// ▲/▼/— and the word. A person only one run holds is a single dot, labelled.
// Hover or keyboard focus on a line shows its numbers; the Peringkat tab is the
// table view of the same data.

import { useMemo, useState } from 'react';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import type { RankingRow } from '@/lib/run-compare';
import { fmtCloseness, fmtPp, fmtRankDelta } from '@/lib/run-compare-format';
import { shortRunId } from '@/lib/run-history';
import { finalistText } from './parts';
import { InfoHint } from '@/components/ui/info-hint';

const ROW_H = 26;
const TOP = 40;
const W = 780;
const LABEL_W = 270;
const X_LEFT = LABEL_W;
const X_RIGHT = W - LABEL_W;

const truncate = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

type Plotted = {
  row: RankingRow;
  leftSlot: number | null;
  rightSlot: number | null;
  dir: 'up' | 'down' | 'same' | 'single';
};

const STROKE: Record<Plotted['dir'], string> = {
  up: 'stroke-[#2563eb] dark:stroke-[#3b82f6]',
  down: 'stroke-[#ea580c]',
  same: 'stroke-[#94a3b8] dark:stroke-[#64748b]',
  single: 'stroke-[#94a3b8] dark:stroke-[#64748b]',
};
const FILL: Record<Plotted['dir'], string> = {
  up: 'fill-[#2563eb] dark:fill-[#3b82f6]',
  down: 'fill-[#ea580c]',
  same: 'fill-[#94a3b8] dark:fill-[#64748b]',
  single: 'fill-[#94a3b8] dark:fill-[#64748b]',
};

export function RankSlopeChart({ dto }: { dto: ComparisonDto }) {
  const [active, setActive] = useState<string | null>(null);

  const { plotted, leftCount, rightCount, cutA, cutB } = useMemo(() => {
    const rows = dto.ranking.filter((r) => r.finalistA || r.finalistB || r.markers.comparison);
    const left = rows.filter((r) => r.rankA != null).sort((x, y) => x.rankA! - y.rankA!);
    const right = rows.filter((r) => r.rankB != null).sort((x, y) => x.rankB! - y.rankB!);
    const leftSlot = new Map(left.map((r, i) => [r.candidateId, i]));
    const rightSlot = new Map(right.map((r, i) => [r.candidateId, i]));
    const plotted: Plotted[] = rows.map((row) => ({
      row,
      leftSlot: leftSlot.get(row.candidateId) ?? null,
      rightSlot: rightSlot.get(row.candidateId) ?? null,
      dir:
        row.deltaRank == null ? 'single' : row.deltaRank > 0 ? 'up' : row.deltaRank < 0 ? 'down' : 'same',
    }));
    return {
      plotted,
      leftCount: left.length,
      rightCount: right.length,
      // Finalists are the top N of each pool, all plotted, so they fill the first slots.
      cutA: left.filter((r) => r.finalistA).length,
      cutB: right.filter((r) => r.finalistB).length,
    };
  }, [dto]);

  const rows = Math.max(leftCount, rightCount, 1);
  const height = TOP + rows * ROW_H + 12;
  const y = (slot: number) => TOP + slot * ROW_H + ROW_H / 2;
  const activeRow = plotted.find((p) => p.row.candidateId === active) ?? null;

  if (plotted.length === 0) {
    return <p className="text-xs text-muted-foreground">Tidak ada finalis atau kandidat pembanding untuk digambarkan.</p>;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Pergeseran peringkat finalis dan kandidat pembanding
          <InfoHint title="Cara membaca grafik">
            Posisi tegak mengikuti urutan di masing-masing run; angka di ujung garis adalah peringkat sebenarnya di seluruh
            pool. Arahkan kursor atau fokus ke sebuah garis untuk melihat angkanya. Tabel lengkapnya ada di bagian Peringkat.
          </InfoHint>
        </span>
        {(
          [
            ['up', 'naik'],
            ['down', 'turun'],
            ['same', 'tetap'],
          ] as const
        ).map(([dir, text]) => (
          <span key={dir} className="inline-flex items-center gap-1">
            <svg width="18" height="6" aria-hidden>
              <line x1="1" y1="3" x2="17" y2="3" strokeWidth="2" strokeLinecap="round" className={STROKE[dir]} />
            </svg>
            {text}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <svg width="10" height="10" aria-hidden>
            <circle cx="5" cy="5" r="4" className={FILL.single} />
          </svg>
          hanya ada di satu run
        </span>
      </figcaption>
      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full min-w-[640px] text-foreground"
          role="list"
          aria-label={`Pergeseran peringkat dari run A ${shortRunId(dto.a.id)} ke run B ${shortRunId(dto.b.id)}`}
          onMouseLeave={() => setActive(null)}
        >
          <text x={X_LEFT} y={16} textAnchor="end" className="fill-current text-[12px] font-semibold">
            Run A {shortRunId(dto.a.id)} (pembanding)
          </text>
          <text x={X_RIGHT} y={16} textAnchor="start" className="fill-current text-[12px] font-semibold">
            Run B {shortRunId(dto.b.id)}
          </text>
          {/* Recessive rails: one hairline per side. */}
          <line x1={X_LEFT + 10} y1={TOP} x2={X_LEFT + 10} y2={TOP + rows * ROW_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
          <line x1={X_RIGHT - 10} y1={TOP} x2={X_RIGHT - 10} y2={TOP + rows * ROW_H} className="stroke-slate-200 dark:stroke-slate-800" strokeWidth={1} />
          {/* The finalist cut on each side. */}
          {cutA > 0 && cutA < leftCount && (
            <g>
              <line x1={0} y1={TOP + cutA * ROW_H} x2={X_LEFT + 10} y2={TOP + cutA * ROW_H} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={1} />
              <text x={4} y={TOP + cutA * ROW_H - 3} className="fill-muted-foreground text-[9px]">
                batas N = {cutA}
              </text>
            </g>
          )}
          {cutB > 0 && cutB < rightCount && (
            <g>
              <line x1={X_RIGHT - 10} y1={TOP + cutB * ROW_H} x2={W} y2={TOP + cutB * ROW_H} className="stroke-slate-300 dark:stroke-slate-700" strokeWidth={1} />
              <text x={W - 4} y={TOP + cutB * ROW_H - 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
                batas N = {cutB}
              </text>
            </g>
          )}

          {plotted.map((p) => {
            const r = p.row;
            const dim = active != null && active !== r.candidateId;
            const ly = p.leftSlot != null ? y(p.leftSlot) : null;
            const ry = p.rightSlot != null ? y(p.rightSlot) : null;
            const label = `${r.name}: ${r.rankA != null ? `peringkat ${r.rankA} di A` : 'tidak ada di A'}, ${
              r.rankB != null ? `peringkat ${r.rankB} di B` : 'tidak ada di B'
            }${r.deltaRank != null ? `, ${fmtRankDelta(r.deltaRank)}` : ''}`;
            return (
              <g
                key={r.candidateId}
                role="listitem"
                tabIndex={0}
                aria-label={label}
                onMouseEnter={() => setActive(r.candidateId)}
                onFocus={() => setActive(r.candidateId)}
                onBlur={() => setActive(null)}
                className="cursor-default outline-none focus-visible:[&_.hit]:stroke-primary/20"
                opacity={dim ? 0.25 : 1}
              >
                {ly != null && ry != null && (
                  <>
                    {/* Hit area wider than the 2px line. */}
                    <line x1={X_LEFT + 10} y1={ly} x2={X_RIGHT - 10} y2={ry} strokeWidth={16} className="hit stroke-transparent" />
                    <line
                      x1={X_LEFT + 10}
                      y1={ly}
                      x2={X_RIGHT - 10}
                      y2={ry}
                      strokeWidth={2}
                      strokeLinecap="round"
                      className={STROKE[p.dir]}
                    />
                  </>
                )}
                {ly != null && (
                  <>
                    <circle cx={X_LEFT + 10} cy={ly} r={6} className="fill-background" />
                    <circle cx={X_LEFT + 10} cy={ly} r={4} className={FILL[p.dir]} />
                    <rect x={0} y={ly - ROW_H / 2} width={X_LEFT} height={ROW_H} className="fill-transparent" />
                    <text x={X_LEFT} y={ly + 4} textAnchor="end" className="fill-current text-[11px]">
                      <tspan className="fill-muted-foreground font-mono">{r.rankA}.</tspan> {truncate(r.name)}
                      {ry == null && <tspan className="fill-muted-foreground"> (tidak ada di B)</tspan>}
                    </text>
                  </>
                )}
                {ry != null && (
                  <>
                    <circle cx={X_RIGHT - 10} cy={ry} r={6} className="fill-background" />
                    <circle cx={X_RIGHT - 10} cy={ry} r={4} className={FILL[p.dir]} />
                    <rect x={X_RIGHT} y={ry - ROW_H / 2} width={LABEL_W} height={ROW_H} className="fill-transparent" />
                    <text x={X_RIGHT} y={ry + 4} textAnchor="start" className="fill-current text-[11px]">
                      <tspan className="fill-muted-foreground font-mono">{r.rankB}.</tspan> {truncate(r.name, 22)}{' '}
                      <tspan className="fill-muted-foreground">
                        {r.deltaRank != null ? fmtRankDelta(r.deltaRank) : '(baru di B)'}
                      </tspan>
                    </text>
                  </>
                )}
                <title>{label}</title>
              </g>
            );
          })}
        </svg>
        {activeRow && (
          <div
            className="pointer-events-none absolute left-1/2 z-10 w-64 -translate-x-1/2 rounded-md border bg-popover p-2 text-[11px] shadow-md"
            style={{ top: Math.min(height - 70, y(activeRow.rightSlot ?? activeRow.leftSlot ?? 0) + 14) }}
            role="status"
          >
            <p className="font-semibold">{activeRow.row.name}</p>
            <p>
              Peringkat <strong>{activeRow.row.rankA ?? '—'}</strong> → <strong>{activeRow.row.rankB ?? '—'}</strong>
              {activeRow.row.deltaRank != null && <> · {fmtRankDelta(activeRow.row.deltaRank)}</>}
            </p>
            <p>
              Kecocokan {activeRow.row.ccA != null ? fmtCloseness(activeRow.row.ccA) : '—'} →{' '}
              {activeRow.row.ccB != null ? fmtCloseness(activeRow.row.ccB) : '—'}
              {activeRow.row.deltaPp != null && <> ({fmtPp(activeRow.row.deltaPp)})</>}
            </p>
            <p className="text-muted-foreground">{finalistText(activeRow.row.finalistChange, activeRow.row.leftCause)}</p>
          </div>
        )}
      </div>
    </figure>
  );
}
