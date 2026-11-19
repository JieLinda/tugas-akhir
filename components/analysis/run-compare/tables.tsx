'use client';

// The quieter tabs of the comparison page: per criterion (FR-CMP-07),
// configuration side by side with origins (FR-CMP-04), pool membership
// (FR-CMP-05) and the stepwise attribution (FR-CMP-10).

import { cn } from '@/lib/utils';
import { ATTRIBUTION_NOTE, configStatusLabel, CRITERIA, CRITERION_LABEL } from '@/lib/run-compare';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import { fmtAspect, fmtCloseness, fmtNumber, fmtPp, fmtWeight } from '@/lib/run-compare-format';
import { membershipLabel, OriginTag } from './parts';
import { InfoHint } from '@/components/ui/info-hint';

const nameMap = (dto: ComparisonDto) => new Map(dto.ranking.map((r) => [r.candidateId, r.name]));

/** FR-CMP-07 — weight, active, best/worst value and their holders, divisor and B/A ratio. */
export function CriteriaTable({ dto }: { dto: ComparisonDto }) {
  const names = nameMap(dto);
  // Many people can share an extreme (a capped scale); three names and a count say it.
  const who = (ids: string[]) =>
    ids.length === 0
      ? '—'
      : ids.length <= 3
        ? ids.map((id) => names.get(id) ?? 'Kandidat').join(', ')
        : `${ids.slice(0, 3).map((id) => names.get(id) ?? 'Kandidat').join(', ')}, +${ids.length - 3} lainnya`;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        Bobot, nilai ekstrem, dan pembagi normalisasi per kriteria
        <InfoHint title="Cara membaca tabel kriteria">
          Normalisasi yang dipakai modul TOPSIS adalah normalisasi vektor: setiap nilai dibagi akar jumlah kuadrat kolomnya
          (pembagi normalisasi), yang dihitung dari isi pool. Rasio di atas 1 berarti setiap nilai pada kriteria itu mengecil
          setelah normalisasi. Nilai tertinggi dan terendah di pool adalah ideal positif dan ideal negatif pada naskah. Baris
          bersorot kuning: status aktif kriteria berbeda antara A dan B.
        </InfoHint>
      </p>
      <div className="overflow-x-auto rounded-xl border shadow-xs">
        <table className="w-full min-w-[980px] text-[11px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kriteria</th>
              <th className="px-2 py-1.5 font-medium">Aktif A | B</th>
              <th className="px-2 py-1.5 font-medium">Bobot efektif A → B</th>
              <th className="px-2 py-1.5 font-medium" title="Ideal positif">Nilai tertinggi di pool A → B</th>
              <th className="px-2 py-1.5 font-medium" title="Ideal negatif">Nilai terendah di pool A → B</th>
              <th className="px-2 py-1.5 font-medium" title="Pembagi normalisasi vektor: √Σx² dari isi pool">Pembagi normalisasi A → B</th>
              <th className="px-2 py-1.5 font-medium">Rasio B/A</th>
            </tr>
          </thead>
          <tbody>
            {dto.criteria.map((c) => {
              const activeDiff = c.activeA !== c.activeB;
              return (
                <tr key={c.key} className={cn('border-t border-border/50 align-top transition-colors hover:bg-muted/30', activeDiff && 'bg-amber-500/10')}>
                  <td className="px-2 py-1.5 font-medium">{c.label}</td>
                  <td className="px-2 py-1.5">
                    {c.activeA ? 'Aktif' : 'Dibuang'} | {c.activeB ? 'Aktif' : 'Dibuang'}
                    {activeDiff && <span className="ml-1 font-semibold text-amber-800 dark:text-amber-200">(berbeda)</span>}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {c.weightA != null ? fmtWeight(c.weightA) : '—'} → {c.weightB != null ? fmtWeight(c.weightB) : '—'}
                    {c.deltaWeightPp != null && c.deltaWeightPp !== 0 && (
                      <span className="ml-1 text-muted-foreground">({fmtPp(c.deltaWeightPp, 2)})</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {c.idealPosA ? fmtAspect(c.idealPosA.raw) : '—'} → {c.idealPosB ? fmtAspect(c.idealPosB.raw) : '—'}
                    <p className="text-[10px] text-muted-foreground">
                      {who(c.idealPosA?.holders ?? [])} → {who(c.idealPosB?.holders ?? [])}
                    </p>
                  </td>
                  <td className="px-2 py-1.5">
                    {c.idealNegA ? fmtAspect(c.idealNegA.raw) : '—'} → {c.idealNegB ? fmtAspect(c.idealNegB.raw) : '—'}
                    <p className="text-[10px] text-muted-foreground">
                      {who(c.idealNegA?.holders ?? [])} → {who(c.idealNegB?.holders ?? [])}
                    </p>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">
                    {c.divisorA != null ? fmtNumber(c.divisorA, 4) : '—'} → {c.divisorB != null ? fmtNumber(c.divisorB, 4) : '—'}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{c.divisorRatio != null ? `${fmtNumber(c.divisorRatio, 4)}×` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** FR-CMP-04 — every configuration item A | B with its origin, status and Δ; the AHP matrix per cell. */
export function ConfigCompare({ dto }: { dto: ComparisonDto }) {
  const groups = [...new Set(dto.config.map((c) => c.group))];
  const anyMatrix = dto.pairwiseCells.some((c) => c.a != null || c.b != null);
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g} className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {g}
            {(() => {
              const n = dto.config.filter((c) => c.group === g && c.recordedA && c.recordedB && !c.same).length;
              return n > 0 ? (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-[9px] text-amber-800 dark:text-amber-200">{n} berbeda</span>
              ) : null;
            })()}
          </p>
          <div className="overflow-x-auto rounded-xl border shadow-xs">
            <table className="w-full min-w-[860px] text-[11px]">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-56 px-2 py-1 font-medium">Butir</th>
                  <th className="px-2 py-1 font-medium">Run A</th>
                  <th className="px-2 py-1 font-medium">Run B</th>
                  <th className="w-24 px-2 py-1 font-medium">Status</th>
                  <th className="w-20 px-2 py-1 font-medium">Δ</th>
                </tr>
              </thead>
              <tbody>
                {dto.config
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <tr
                      key={c.key}
                      className={cn(
                        'border-t border-border/50 align-top transition-colors hover:bg-muted/30',
                        c.recordedA && c.recordedB && !c.same && 'bg-amber-500/10 hover:bg-amber-500/15',
                      )}
                    >
                      <td className="px-2 py-1 font-medium">{c.label}</td>
                      <td className="px-2 py-1">
                        <span className="break-words">{c.a}</span>
                        <div className="mt-0.5">
                          <OriginTag origin={c.originA} />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <span className="break-words">{c.b}</span>
                        <div className="mt-0.5">
                          <OriginTag origin={c.originB} />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        {c.recordedA && c.recordedB && !c.same ? (
                          <strong className="inline-flex rounded-full bg-amber-500/20 px-1.5 text-amber-900 dark:text-amber-100">Berbeda</strong>
                        ) : (
                          <span className={cn(!(c.recordedA && c.recordedB) && 'text-muted-foreground')}>{configStatusLabel(c)}</span>
                        )}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {c.delta == null ? '—' : c.key.startsWith('weight.') && c.key !== 'weight.cr' ? fmtPp(c.delta, 2) : fmtNumber(c.delta, c.key === 'weight.cr' ? 4 : 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-violet-500" />
          Matriks perbandingan berpasangan AHP (A / B per sel)
        </p>
        {anyMatrix ? (
          <div className="overflow-x-auto rounded-xl border shadow-xs">
            <table className="text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1" />
                  {CRITERIA.map((c) => (
                    <th key={c} className="px-2 py-1 font-medium">
                      {CRITERION_LABEL[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CRITERIA.map((row) => (
                  <tr key={row} className="border-t border-border/50">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">{CRITERION_LABEL[row]}</th>
                    {CRITERIA.map((col) => {
                      const cell = dto.pairwiseCells.find((x) => x.row === row && x.col === col)!;
                      const f = (v: number | null) => (v == null ? '—' : fmtNumber(v, v === Math.round(v) ? 0 : 3));
                      return (
                        <td
                          key={col}
                          className={cn('px-2 py-1 text-center tabular-nums', !cell.same && 'bg-amber-500/15 font-semibold')}
                          title={cell.same ? 'Sama' : 'Berbeda'}
                        >
                          {cell.same ? f(cell.a) : `${f(cell.a)} / ${f(cell.b)}`}
                          {!cell.same && <span className="sr-only"> (berbeda)</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tidak tersimpan pada kedua run (program tanpa matriks AHP memakai bobot bawaan sistem).
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">Sel bersorot berbeda; isinya "nilai A / nilai B".</p>
      </div>
    </div>
  );
}

/** FR-CMP-05 — A ∪ B with membership and, for one-sided candidates, why. */
export function PoolTable({ dto }: { dto: ComparisonDto }) {
  const counts = {
    both: dto.ranking.filter((r) => r.membership === 'both').length,
    onlyA: dto.ranking.filter((r) => r.membership === 'only_a').length,
    onlyB: dto.ranking.filter((r) => r.membership === 'only_b').length,
  };
  const rows = [...dto.ranking].sort((x, y) => {
    const order = { only_b: 0, only_a: 1, both: 2 } as const;
    return order[x.membership] - order[y.membership] || x.name.localeCompare(y.name, 'id');
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full border border-slate-300/70 bg-slate-500/8 px-2.5 py-0.5 font-semibold">
          {counts.both} kandidat ada di keduanya
        </span>
        <span className="rounded-full border border-slate-500/40 bg-slate-500/12 px-2.5 py-0.5 font-semibold text-slate-800 dark:text-slate-200">
          {counts.onlyA} hanya di A
        </span>
        <span className="rounded-full border border-indigo-500/40 bg-indigo-500/12 px-2.5 py-0.5 font-semibold text-indigo-800 dark:text-indigo-200">
          {counts.onlyB} hanya di B
        </span>
        <span className="text-muted-foreground">
          · Pool A berisi {dto.a.poolSize} kandidat, pool B {dto.b.poolSize}.
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border shadow-xs">
        <table className="w-full min-w-[640px] text-[11px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kandidat</th>
              <th className="px-2 py-1.5 font-medium">Unit</th>
              <th className="px-2 py-1.5 font-medium">Keanggotaan</th>
              <th className="px-2 py-1.5 font-medium">Sebab</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.candidateId} className="border-t border-border/50 transition-colors hover:bg-muted/30">
                <td className="px-2 py-1 font-medium">{r.name}</td>
                <td className="px-2 py-1 text-muted-foreground">{r.unit ?? '—'}</td>
                <td className="px-2 py-1">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold',
                      r.membership === 'both'
                        ? 'bg-slate-500/10 text-slate-700 dark:text-slate-300'
                        : r.membership === 'only_a'
                          ? 'bg-slate-600/15 text-slate-800 dark:text-slate-200'
                          : 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-200',
                    )}
                  >
                    {membershipLabel(r.membership)}
                  </span>
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {r.membership === 'both' ? '—' : r.membershipReason ?? 'Sebab tidak tercatat pada data tersimpan.'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** FR-CMP-10 — A → B one source at a time, in a fixed and stated order. */
export function AttributionTable({ dto }: { dto: ComparisonDto }) {
  if (!dto.attribution) {
    return <p className="text-xs text-muted-foreground">Atribusi bertahap memerlukan kedua run dapat dihitung ulang dari data tersimpan.</p>;
  }
  const steps = dto.attribution;
  const byStep = steps.map((s) => new Map(s.rows.map((r) => [r.candidateId, r])));
  const rows = dto.ranking.filter((r) => r.finalistA || r.finalistB || r.markers.comparison);
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-semibold">
        Dari A ke B, satu sumber per langkah
        <InfoHint title="Atribusi bertahap">{ATTRIBUTION_NOTE}</InfoHint>
      </p>
      <div className="overflow-x-auto rounded-xl border shadow-xs">
        <table className="w-full min-w-[900px] text-[11px]">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kandidat</th>
              {steps.map((s, i) => (
                <th key={s.key} className="px-2 py-1.5 font-medium">
                  {i}. {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.candidateId} className="border-t border-border/50 transition-colors hover:bg-muted/30">
                <td className="px-2 py-1 font-medium">{r.name}</td>
                {steps.map((s, i) => {
                  const v = byStep[i]!.get(r.candidateId);
                  const prev = i > 0 ? byStep[i - 1]!.get(r.candidateId) : undefined;
                  const moved = v && prev ? v.rank !== prev.rank || Math.abs(v.closeness - prev.closeness) > 5e-7 : i > 0 && Boolean(v) !== Boolean(prev);
                  return (
                    <td key={s.key} className={cn('px-2 py-1 tabular-nums transition-colors', moved && 'bg-amber-500/12 font-semibold text-amber-900 dark:text-amber-100')}>
                      {v ? (
                        <>
                          #{v.rank} · {fmtCloseness(v.closeness)}
                        </>
                      ) : (
                        <span className="text-muted-foreground">tidak ada</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Sel bersorot berubah dibanding langkah sebelumnya. Langkah terakhir sama persis dengan run B yang tersimpan.
      </p>
    </div>
  );
}
