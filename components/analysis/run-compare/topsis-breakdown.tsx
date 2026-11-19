'use client';

// FR-SN-06 / FR-CMP-08 — how one candidate's Kecocokan is built, criterion by
// criterion: the raw aspect, its normalised value r = x / pembagi, the weighted
// value v = w·x / pembagi, and its share of each distance — (v − nilai
// tertinggi)² for D⁺ and (v − nilai terendah)² for D⁻ — then D⁺, D⁻ and the
// Kecocokan D⁻ / (D⁺ + D⁻). The same table serves a single run page and the
// two sides of a comparison, so a number is never explained two ways.

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CRITERION_LABEL, type Cell, type CriterionKey } from '@/lib/run-compare';
import type { CandidateBreakdownDto, RunBreakdownDto } from '@/lib/run-compare-dto';
import { fmtAspect, fmtCloseness, fmtNumber, fmtSigned } from '@/lib/run-compare-format';
import { getRunTopsisBreakdownAction } from '@/lib/run-compare-actions';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const f4 = (x: number) => fmtNumber(x, 4);
const f6 = (x: number) => fmtNumber(x, 6);

export type BreakdownSide = {
  cells: Partial<Record<CriterionKey, Cell>>;
  dPlus: number;
  dMinus: number;
  closeness: number;
};

/** One candidate in one run. `highlight` marks the criteria a comparison names. */
export function TopsisSideTable({
  side,
  title,
  highlight = [],
}: {
  side: BreakdownSide;
  title?: string;
  highlight?: CriterionKey[];
}) {
  const keys = (Object.keys(side.cells) as CriterionKey[]).filter((k) => side.cells[k]);
  return (
    <div className="space-y-1">
      {title && <p className="text-[11px] font-semibold">{title}</p>}
      <div className="overflow-x-auto rounded-xl border shadow-xs">
        <table className="w-full min-w-[560px] text-[11px]">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1 font-medium">Kriteria</th>
              <th className="px-2 py-1 font-medium" title="Nilai aspek mentah (skala 0–100)">Nilai aspek</th>
              <th className="px-2 py-1 font-medium" title="r = x / pembagi normalisasi">Ternormalisasi</th>
              <th className="px-2 py-1 font-medium" title="v = bobot × x / pembagi">Terbobot</th>
              <th className="px-2 py-1 font-medium" title="(v − nilai tertinggi di pool)²">Sumbangan D⁺</th>
              <th className="px-2 py-1 font-medium" title="(v − nilai terendah di pool)²">Sumbangan D⁻</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const c = side.cells[k]!;
              return (
                <tr key={k} className={cn('border-t border-border/50 transition-colors hover:bg-muted/30', highlight.includes(k) && 'bg-amber-500/10')}>
                  <td className="px-2 py-1 font-medium">
                    {CRITERION_LABEL[k]}
                    {highlight.includes(k) && <span className="ml-1 text-[9px] font-semibold text-amber-800 dark:text-amber-200">(perubahan terbesar)</span>}
                  </td>
                  <td className="px-2 py-1 tabular-nums">{fmtAspect(c.raw)}</td>
                  <td className="px-2 py-1 tabular-nums">{f4(c.normalized)}</td>
                  <td className="px-2 py-1 tabular-nums">{f4(c.weighted)}</td>
                  <td className="px-2 py-1 tabular-nums">{f6(c.contribPlus)}</td>
                  <td className="px-2 py-1 tabular-nums">{f6(c.contribMinus)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/20">
            <tr>
              <td className="px-2 py-1 font-medium" colSpan={4}>
                D⁺ (jarak ke nilai tertinggi) · D⁻ (jarak ke nilai terendah)
              </td>
              <td className="px-2 py-1 tabular-nums">{f4(side.dPlus)}</td>
              <td className="px-2 py-1 tabular-nums">{f4(side.dMinus)}</td>
            </tr>
            <tr>
              <td className="px-2 py-1 font-semibold" colSpan={4}>
                Kecocokan = D⁻ / (D⁺ + D⁻)
              </td>
              <td className="px-2 py-1 font-semibold tabular-nums" colSpan={2}>
                {f4(side.closeness)} ({fmtCloseness(side.closeness)})
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** FR-CMP-08: one candidate, A beside B, with Δ per criterion. */
export function CandidateBreakdownCompare({ breakdown }: { breakdown: CandidateBreakdownDto }) {
  const keys = Object.keys(breakdown.delta) as CriterionKey[];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2">
        {breakdown.a ? (
          <TopsisSideTable side={breakdown.a} title="Run A" highlight={breakdown.topMovers} />
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Kandidat ini tidak ada di pool run A.</p>
        )}
        {breakdown.b ? (
          <TopsisSideTable side={breakdown.b} title="Run B" highlight={breakdown.topMovers} />
        ) : (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">Kandidat ini tidak ada di pool run B.</p>
        )}
      </div>
      {keys.length > 0 && (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold">
            Selisih B − A per kriteria
            <InfoHint size="xs" title="Selisih B − A per kriteria">
              Baris bersorot adalah dua kriteria dengan perubahan sumbangan terbesar. Sumbangan D⁺ yang naik dan sumbangan
              D⁻ yang turun sama-sama menurunkan kecocokan.
            </InfoHint>
          </p>
          <div className="overflow-x-auto rounded-xl border shadow-xs">
            <table className="w-full min-w-[520px] text-[11px]">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-medium">Kriteria</th>
                  <th className="px-2 py-1 font-medium">Δ nilai aspek</th>
                  <th className="px-2 py-1 font-medium">Δ terbobot</th>
                  <th className="px-2 py-1 font-medium">Δ sumbangan D⁺</th>
                  <th className="px-2 py-1 font-medium">Δ sumbangan D⁻</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const d = breakdown.delta[k]!;
                  return (
                    <tr key={k} className={cn('border-t border-border/50', breakdown.topMovers.includes(k) && 'bg-amber-500/10')}>
                      <td className="px-2 py-1 font-medium">{CRITERION_LABEL[k]}</td>
                      <td className="px-2 py-1 tabular-nums">{fmtSigned(d.raw, 1)}</td>
                      <td className="px-2 py-1 tabular-nums">{fmtSigned(d.weighted, 4)}</td>
                      <td className="px-2 py-1 tabular-nums">{fmtSigned(d.contribPlus, 6)}</td>
                      <td className="px-2 py-1 tabular-nums">{fmtSigned(d.contribMinus, 6)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FR-SN-06 on a run page: pick a candidate, see their TOPSIS line by line,
 * replayed from what the run stored (never recomputed aspects).
 */
export function RunTopsisBreakdownCard({ runId }: { runId: string }) {
  const [data, setData] = useState<RunBreakdownDto | null>(null);
  const [candidateId, setCandidateId] = useState<string>('');
  useEffect(() => {
    let active = true;
    setData(null);
    getRunTopsisBreakdownAction(runId)
      .then((d) => {
        if (!active) return;
        setData(d);
        if (d.available) setCandidateId(d.candidates[0]?.candidateId ?? '');
      })
      .catch(() => active && setData({ available: false, runId, reason: 'Rincian perhitungan tidak dapat dimuat.' }));
    return () => {
      active = false;
    };
  }, [runId]);
  const selected = useMemo(
    () => (data?.available ? data.candidates.find((c) => c.candidateId === candidateId) ?? null : null),
    [data, candidateId],
  );

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          Rincian perhitungan TOPSIS per kandidat
          <InfoHint title="Rincian perhitungan TOPSIS">
            Dihitung ulang dari skor aspek, bobot, dan kriteria aktif yang disimpan run ini, dengan fungsi TOPSIS yang sama
            dengan layanan scoring. Pilih kandidat untuk melihat nilai aspek, nilai ternormalisasi, nilai terbobot, dan
            sumbangannya pada jarak D⁺ dan D⁻.
          </InfoHint>
        </p>
        {data?.available && (
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="h-8 w-72 text-xs" aria-label="Pilih kandidat">
              <SelectValue placeholder="Pilih kandidat" />
            </SelectTrigger>
            <SelectContent>
              {data.candidates.map((c) => (
                <SelectItem key={c.candidateId} value={c.candidateId} className="text-xs">
                  {c.rank}. {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!data ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menghitung ulang dari data tersimpan…
        </p>
      ) : !data.available ? (
        <p className="text-xs text-muted-foreground">{data.reason}</p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Pembagi normalisasi:</span>{' '}
            {data.criteria.map((c) => `${CRITERION_LABEL[c.key]} ${f4(c.divisor)}`).join(' · ')}.
          </p>
          {selected && <TopsisSideTable side={selected} title={`${selected.rank}. ${selected.name}`} />}
        </>
      )}
    </div>
  );
}
