// ── The comparison as a workbook for the forum's archive (FR-CMP-12, NF-1) ──
//
// Sheets: Ringkasan, Konfigurasi, Pool, Peringkat, Kriteria, Rincian kandidat,
// Kalimat penjelasan, plus Atribusi. Numbers are stored as NUMBERS (closeness
// as 0..1, weights as 0..1, Δ in percentage points) so a reader can sort and
// recompute in Excel; only labels are text. `buildComparisonSheets` is pure and
// tested; `exportComparisonWorkbook` hands it to SheetJS the way
// lib/analysis-export.ts already does.

import { ATTRIBUTION_NOTE, configStatusLabel, CRITERIA, CRITERION_LABEL, ORIGIN_LABEL, type CriterionKey } from './run-compare';
import type { ComparisonDto } from './run-compare-dto';
import { formatDateTime } from './datetime';
import { leftCauseText } from './run-compare-format';
import { shortRunId } from './run-history';

export type Sheet = { name: string; rows: (string | number | null)[][] };

const MEMBERSHIP = { both: 'Ada di keduanya', only_a: 'Hanya di A', only_b: 'Hanya di B' } as const;
const FINALIST = { masuk: 'Masuk N besar', keluar: 'Keluar dari N besar', tetap: 'Tetap finalis', tidak: 'Bukan finalis' } as const;

export function buildComparisonSheets(dto: ComparisonDto, positionTitle: string): Sheet[] {
  const name = new Map(dto.ranking.map((r) => [r.candidateId, r.name]));
  const runLine = (side: 'A' | 'B', r: ComparisonDto['a']) => [
    `Run ${side}`,
    `${shortRunId(r.id)} · ${r.label ?? ''} · ${r.modeLabel} · ${formatDateTime(r.createdAt)}${r.createdByName ? ` · oleh ${r.createdByName}` : ''}`,
  ];
  const repro = (r: ComparisonDto['reproducibility']['a']) =>
    !r.verifiable ? `Tidak dapat diverifikasi: ${r.reason}` : r.reproducible ? 'Terulang dari data tersimpan' : 'TIDAK terulang';

  const ringkasan: Sheet = {
    name: 'Ringkasan',
    rows: [
      ['Posisi', positionTitle],
      runLine('A', dto.a),
      runLine('B', dto.b),
      ['Hubungan', dto.relationText],
      ['Jalur pohon A', dto.a.lineage.map(shortRunId).join(' → ')],
      ['Jalur pohon B', dto.b.lineage.map(shortRunId).join(' → ')],
      ['Alasan run B', dto.b.rerunReason ?? ''],
      [],
      ['Sumber', 'Kelompok', 'Status', 'Ringkasan'],
      ...dto.sources.map((s) => [
        `${s.key} · ${s.label}`,
        s.key === 'S2' || s.key === 'S5' ? 'Perubahan konfigurasi atau pertimbangan' : 'Perubahan data atau himpunan',
        s.differs ? 'Berbeda' : 'Sama',
        s.summary,
      ]),
      [],
      [
        'Pelanggaran pembekuan',
        dto.freezeViolations.length ? dto.freezeViolations.map((v) => `${v.key} ${v.label}`).join('; ') : 'Tidak ada',
      ],
      ['Keterulangan run A', repro(dto.reproducibility.a)],
      ['Keterulangan run B', repro(dto.reproducibility.b)],
    ],
  };

  // Numeric items go in as numbers — weights 0..1 like everywhere in this
  // workbook, the CR, N — and only the rest as their labels.
  const numericOf = (key: string, cfg: ComparisonDto['a']['config']): number | null => {
    if (key === 'weight.cr') return cfg.consistency?.cr ?? null;
    if (key === 'present.finalists') return cfg.finalistCount ?? null;
    if (key.startsWith('weight.') && key !== 'weight.source') {
      const k = key.slice('weight.'.length) as CriterionKey;
      const w = cfg.weights;
      if (!w || typeof w[k] !== 'number') return null;
      const sum = CRITERIA.reduce((acc, x) => acc + w[x], 0) || 1;
      return w[k] / sum;
    }
    return null;
  };
  const konfigurasi: Sheet = {
    name: 'Konfigurasi',
    rows: [
      ['Kelompok', 'Butir', 'Run A', 'Asal A', 'Run B', 'Asal B', 'Status', 'Δ (B − A; bobot dalam poin persen)'],
      ...dto.config.map((c) => [
        c.group,
        c.label,
        numericOf(c.key, dto.a.config) ?? c.a,
        ORIGIN_LABEL[c.originA],
        numericOf(c.key, dto.b.config) ?? c.b,
        ORIGIN_LABEL[c.originB],
        configStatusLabel(c),
        c.delta,
      ]),
      [],
      ['Matriks AHP — baris', 'kolom', 'Run A', 'Run B', 'Status'],
      ...dto.pairwiseCells.map((p) => [CRITERION_LABEL[p.row], CRITERION_LABEL[p.col], p.a, p.b, p.same ? 'Sama' : 'Berbeda']),
    ],
  };

  const pool: Sheet = {
    name: 'Pool',
    rows: [
      ['Kandidat', 'Unit', 'Keanggotaan', 'Sebab'],
      ...dto.ranking.map((r) => [
        r.name,
        r.unit,
        MEMBERSHIP[r.membership],
        r.membership === 'both' ? '' : r.membershipReason ?? 'Sebab tidak tercatat pada data tersimpan',
      ]),
    ],
  };

  const peringkat: Sheet = {
    name: 'Peringkat',
    rows: [
      [
        'Kandidat',
        'Unit',
        'Keanggotaan',
        'Peringkat A',
        'Peringkat B',
        'Δ peringkat (positif = naik)',
        'Kecocokan A',
        'Kecocokan B',
        'Δ kecocokan (pp)',
        'Finalis A',
        'Finalis B',
        'Status finalis',
        'Readiness A',
        'Readiness B',
        'Keputusan forum A',
        'Keputusan forum B',
        'Penanda',
      ],
      ...dto.ranking.map((r) => [
        r.name,
        r.unit,
        MEMBERSHIP[r.membership],
        r.rankA,
        r.rankB,
        r.deltaRank,
        r.ccA,
        r.ccB,
        r.deltaPp,
        r.finalistA == null ? null : r.finalistA ? 'Ya' : 'Tidak',
        r.finalistB == null ? null : r.finalistB ? 'Ya' : 'Tidak',
        r.finalistChange === 'keluar' ? leftCauseText(r.leftCause) : r.finalistChange ? FINALIST[r.finalistChange] : null,
        r.readinessA,
        r.readinessB,
        r.decisionA == null ? null : `Dipilih${r.decisionA ? `: ${r.decisionA}` : ''}`,
        r.decisionB == null ? null : `Dipilih${r.decisionB ? `: ${r.decisionB}` : ''}`,
        [
          r.markers.comparison && 'Kandidat pembanding',
          r.markers.existingPool && 'Sudah ada di pool induk',
          r.markers.outOfRange && 'Di luar rentang grade',
          r.markers.excludedA && 'Ditandai dikecualikan di A',
          r.markers.excludedB && 'Ditandai dikecualikan di B',
          (r.markers.provisionalA || r.markers.provisionalB) && 'Skor sementara',
        ]
          .filter(Boolean)
          .join('; '),
      ]),
    ],
  };

  const kriteria: Sheet = {
    name: 'Kriteria',
    rows: [
      [
        'Kriteria',
        'Aktif A',
        'Aktif B',
        'Bobot efektif A',
        'Bobot efektif B',
        'Δ bobot (pp)',
        'Nilai tertinggi A',
        'Pemegang A',
        'Nilai tertinggi B',
        'Pemegang B',
        'Nilai terendah A',
        'Pemegang A',
        'Nilai terendah B',
        'Pemegang B',
        'Pembagi A',
        'Pembagi B',
        'Rasio B/A',
      ],
      ...dto.criteria.map((c) => [
        c.label,
        c.activeA ? 'Ya' : 'Tidak',
        c.activeB ? 'Ya' : 'Tidak',
        c.weightA,
        c.weightB,
        c.deltaWeightPp,
        c.idealPosA?.raw ?? null,
        (c.idealPosA?.holders ?? []).map((h) => name.get(h) ?? h).join(', '),
        c.idealPosB?.raw ?? null,
        (c.idealPosB?.holders ?? []).map((h) => name.get(h) ?? h).join(', '),
        c.idealNegA?.raw ?? null,
        (c.idealNegA?.holders ?? []).map((h) => name.get(h) ?? h).join(', '),
        c.idealNegB?.raw ?? null,
        (c.idealNegB?.holders ?? []).map((h) => name.get(h) ?? h).join(', '),
        c.divisorA,
        c.divisorB,
        c.divisorRatio,
      ]),
    ],
  };

  const rincianRows: (string | number | null)[][] = [
    [
      'Kandidat',
      'Kriteria',
      'Nilai aspek A',
      'Nilai aspek B',
      'Ternormalisasi A',
      'Ternormalisasi B',
      'Terbobot A',
      'Terbobot B',
      'Sumbangan D+ A',
      'Sumbangan D+ B',
      'Sumbangan D- A',
      'Sumbangan D- B',
    ],
  ];
  for (const b of dto.breakdowns) {
    for (const k of CRITERIA) {
      const x = b.a?.cells[k];
      const y = b.b?.cells[k];
      if (!x && !y) continue;
      rincianRows.push([
        b.name,
        CRITERION_LABEL[k],
        x?.raw ?? null,
        y?.raw ?? null,
        x?.normalized ?? null,
        y?.normalized ?? null,
        x?.weighted ?? null,
        y?.weighted ?? null,
        x?.contribPlus ?? null,
        y?.contribPlus ?? null,
        x?.contribMinus ?? null,
        y?.contribMinus ?? null,
      ]);
    }
    rincianRows.push([b.name, 'D+', b.a?.dPlus ?? null, b.b?.dPlus ?? null]);
    rincianRows.push([b.name, 'D-', b.a?.dMinus ?? null, b.b?.dMinus ?? null]);
    rincianRows.push([b.name, 'Kecocokan', b.a?.closeness ?? null, b.b?.closeness ?? null]);
  }

  const kalimat: Sheet = {
    name: 'Kalimat penjelasan',
    rows: [
      ['Kode templat', 'Kandidat', 'Kalimat'],
      ...dto.explanations.summary.map((e) => [e.id, null, e.text]),
      ...Object.entries(dto.explanations.perCandidate).flatMap(([id, xs]) => xs.map((e) => [e.id, name.get(id) ?? id, e.text])),
    ],
  };

  const atribusi: Sheet = {
    name: 'Atribusi',
    rows: dto.attribution
      ? [
          [ATTRIBUTION_NOTE],
          ['Kandidat', ...dto.attribution.flatMap((s, i) => [`${i}. ${s.label} — peringkat`, `${i}. ${s.label} — kecocokan`])],
          ...dto.ranking.map((r) => [
            r.name,
            ...dto.attribution!.flatMap((s) => {
              const v = s.rows.find((x) => x.candidateId === r.candidateId);
              return [v?.rank ?? null, v?.closeness ?? null];
            }),
          ]),
        ]
      : [['Atribusi bertahap tidak tersedia: kedua run harus dapat dihitung ulang dari data tersimpan.']],
  };

  return [ringkasan, konfigurasi, pool, peringkat, kriteria, { name: 'Rincian kandidat', rows: rincianRows }, kalimat, atribusi];
}

export async function exportComparisonWorkbook(dto: ComparisonDto, positionTitle: string): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  for (const s of buildComparisonSheets(dto, positionTitle)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(s.rows), s.name.slice(0, 31));
  }
  const arrayBuffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `komparasi-versi-${shortRunId(dto.a.id).slice(1)}-${shortRunId(dto.b.id).slice(1)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
