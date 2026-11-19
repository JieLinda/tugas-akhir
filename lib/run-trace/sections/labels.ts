// Sheet "Label Level": every distinct proficiency label the run read, turned
// into a level 1..4 by ONE formula row per label — `proficiencyToLevel` in
// scoring-service/src/ahp-topsis-engine.ts, written in Excel:
//
//   kosong / "#N/A" / "NOT ASSESSED" / "-"     → tidak terbaca
//   memuat MASTERY atau EXPERT                 → 4
//   memuat ADVANCE                             → 3
//   memuat INTERMEDIATE                        → 2
//   memuat BASIC atau NOVICE                   → 1
//   selain itu: angka 1–4 PERTAMA dalam teks  → angka itu (kolom bantu C:F
//                                                 memegang posisi tiap angka)
//
// Other sheets look a label up here (VLOOKUP, column H) instead of repeating
// the rule, so the rule is written once.

import { BuildContext, SHEET } from '../context';
import { F, FS, a1, type Cell } from '../sheet';

export type LabelIndex = {
  /** Excel expression for the level of the label held in `cellRef` ("" when unreadable). */
  levelOf: (cellRef: string) => string;
};

export function buildLabels(ctx: BuildContext, labels: Map<string, number | null>): LabelIndex {
  const s = ctx.sheet(SHEET.labels, [34, 34, 8, 8, 8, 8, 10, 12, 14, 10]);
  s.row(['LABEL LEVEL KOMPETENSI → LEVEL 1..4 (proficiencyToLevel)']);
  s.row(['Satu baris per label berbeda yang dibaca run ini. Lembar lain mencari labelnya di sini (kolom A) dan memakai kolom H.']);
  s.blank();
  s.row([
    'Label (apa adanya)',
    'Label diseragamkan = UPPER(TRIM(A))',
    'Posisi "1"',
    'Posisi "2"',
    'Posisi "3"',
    'Posisi "4"',
    'Angka pertama',
    'Level (rumus)',
    'Level engine',
    'Selisih',
  ]);
  const first = s.next;
  for (const [label, engineLevel] of [...labels.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const r = s.next;
    const B = a1(1, r);
    const pos = (d: string) => F(`IFERROR(FIND("${d}",${B}),999)`);
    const level =
      `IF(OR(${B}="",${B}="#N/A",${B}="NOT ASSESSED",${B}="-"),"",` +
      `IF(OR(ISNUMBER(SEARCH("MASTERY",${B})),ISNUMBER(SEARCH("EXPERT",${B}))),4,` +
      `IF(ISNUMBER(SEARCH("ADVANCE",${B})),3,` +
      `IF(ISNUMBER(SEARCH("INTERMEDIATE",${B})),2,` +
      `IF(OR(ISNUMBER(SEARCH("BASIC",${B})),ISNUMBER(SEARCH("NOVICE",${B}))),1,` +
      `IF(${a1(6, r)}="","",${a1(6, r)}))))))`;
    const row: Cell[] = [
      label,
      FS(`UPPER(TRIM(A${r}))`),
      pos('1'),
      pos('2'),
      pos('3'),
      pos('4'),
      F(`IF(MIN(C${r}:F${r})=999,"",MATCH(MIN(C${r}:F${r}),C${r}:F${r},0))`),
      F(level),
      engineLevel,
      F(`IF(OR(H${r}="",I${r}=""),IF(H${r}=I${r},"","BEDA"),H${r}-I${r})`),
    ];
    s.row(row);
  }
  const last = s.next - 1;
  if (last >= first) {
    ctx.checks.push({
      label: 'Label level kompetensi',
      range: `'${SHEET.labels}'!$J$${first}:$J$${last}`,
      tolerance: 0,
      note: 'Level dari label (rumus) vs level yang dipakai engine.',
    });
  }
  const table = `'${SHEET.labels}'!$A$${first}:$H$${Math.max(first, last)}`;
  return {
    levelOf: (cellRef: string) => `IF(${cellRef}="","",IFERROR(VLOOKUP(${cellRef},${table},8,FALSE),""))`,
  };
}
