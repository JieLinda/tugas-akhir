// Kompetensi Teknis — from the candidate's competency list to the 0..100 score.
//
//   Teknis - Acuan        the required set (the position's demand), with identity keys
//   Teknis - Dimiliki     each candidate competency: raw proficiency label → level
//   Teknis - Pasangan     one row per (candidate, required competency): the pair the
//                         matcher settled on, sim′, level factor and cell value
//   Teknis - Sel Hungarian every cell the assignment chose FROM (not just the chosen
//                         ones), so the optimum can be checked with Solver
//   Teknis - Kandidat     Σ over measurable columns ÷ M_eff, saturated at 1, × 100
//
// Formulas mirror competencyCell / competencyLevelFactor / matchCompetencySets
// (scoring-service/src/ahp-topsis-engine.ts, competency-level.ts) term by term.

import { BuildContext, SHEET } from '../context';
import type { LabelIndex } from './labels';
import { F, FB, FS, FULL, N, a1, xcol, type Cell } from '../sheet';
import type { TechnicalCandidateTrace } from '../../../scoring-service/src/run-trace-types';

const STAGE_ID = 'identitas';
const STAGE_HUN = 'Hungarian';
const STAGE_NONE = 'tidak berpasangan';

/** sim′ for a NON-identity cell from its raw cosine in `m`. */
const simFormula = (m: string) =>
  `IF(${m}="",0,IF(P_TEK_U>P_TEK_L,MAX(0,MIN(1,(${m}-P_TEK_L)/(P_TEK_U-P_TEK_L))),MAX(0,MIN(1,${m}))))`;

/** Level factor: competencyLevelFactor(k, t, identity, known). */
const lfFormula = (k: string, t: string, known: string, identity: string) =>
  `IF(NOT(${known}),1,IF(${k}>=MAX(1,${t}),IF(${identity},MIN(1+(P_TEK_SURPLUS*(${k}-MAX(1,${t})))/3,P_TEK_LF_MAX),1),MAX(0,1-(MAX(1,${t})-${k})/P_TEK_SPAN)))`;

export function collectTechnicalLabels(ctx: BuildContext, labels: Map<string, number | null>): void {
  for (const id of ctx.order) {
    const tt = ctx.t?.candidates?.[id]?.technical;
    if (!tt) continue;
    for (const h of tt.held) {
      const key = h.proficiencyRaw ?? '';
      if (key && !labels.has(key)) labels.set(key, h.levelKnown ? h.level : null);
    }
  }
}

export function buildTechnical(ctx: BuildContext, labelIndex: LabelIndex): void {
  const t = ctx.t;

  // ── Teknis - Acuan ───────────────────────────────────────────────
  const acuan = ctx.sheet(SHEET.techRequired, [6, 42, 12, 42, 10, 22]);
  acuan.row(['ACUAN KOMPETENSI POSISI SASARAN (M kolom)']);
  acuan.row([
    `Sumber: ${t?.technical?.requiredSource ?? ctx.b.runInfo?.technical?.requiredSource ?? 'tidak tercatat'} — ${t?.technical?.requiredDetail ?? ctx.b.runInfo?.technical?.requiredSourceDetail ?? ''}`,
  ]);
  acuan.row(['Kunci identitas = "C:" & kode kamus bila ada, selain itu "N:" & nama yang diseragamkan. Dua kompetensi berkunci sama ADALAH kompetensi yang sama.']);
  acuan.blank();
  acuan.row(['j', 'Kompetensi dituntut', 'Kode kamus', 'Nama diseragamkan', 'Level t', 'Kunci identitas (rumus)']);
  for (const [j, r] of (t?.technical?.required ?? []).entries()) {
    const row = acuan.next;
    acuan.row([j + 1, r.name, r.code ?? '', r.norm, r.level, FS(`IF(C${row}<>"","C:"&C${row},"N:"&D${row})`)]);
  }

  // ── Teknis - Dimiliki ────────────────────────────────────────────
  const held = ctx.sheet(SHEET.techHeld, [38, 26, 5, 38, 12, 38, 24, 10, 10, 12, 22, 10, 10, 10]);
  held.row(['KOMPETENSI YANG DIMILIKI KANDIDAT — level dari label (current_proficiency_name, else proficiency_name)']);
  held.row(['Level tak terbaca → faktor level NETRAL (1) dan level pengganti P_TEK_LVL_STANDIN dipakai hanya untuk mencari vektor.']);
  held.blank();
  held.row([
    'Kandidat ID',
    'Nama',
    'i',
    'Kompetensi',
    'Kode kamus',
    'Nama diseragamkan',
    'Label level (mentah)',
    'Level dari label',
    'Terbaca?',
    'Level dipakai k',
    'Kunci identitas',
    'Level engine',
    'Terbaca engine',
    'Selisih',
  ]);
  const heldRow = new Map<string, number>(); // `${id}#${i}` → row
  for (const id of ctx.order) {
    const tt = t?.candidates?.[id]?.technical;
    if (!tt) continue;
    tt.held.forEach((h, i) => {
      const r = held.next;
      heldRow.set(`${id}#${i}`, r);
      held.row([
        id,
        ctx.candName(id),
        i,
        h.name,
        h.code ?? '',
        h.norm,
        h.proficiencyRaw ?? '',
        F(labelIndex.levelOf(`G${r}`)),
        FB(`H${r}<>""`),
        F(`IF(I${r},H${r},P_TEK_LVL_STANDIN)`),
        FS(`IF(E${r}<>"","C:"&E${r},"N:"&F${r})`),
        h.level,
        h.levelKnown,
        F(`IF(J${r}=L${r},IF(I${r}=M${r},0,"BEDA"),J${r}-L${r})`),
      ]);
    });
  }
  const heldLast = held.next - 1;
  if (heldRow.size > 0) {
    ctx.checks.push({
      label: 'Teknis: level kompetensi kandidat',
      range: `'${SHEET.techHeld}'!$N$5:$N$${heldLast}`,
      tolerance: 0,
      note: 'Level dari label vs level yang dipakai engine.',
    });
  }

  // ── Teknis - Pasangan ────────────────────────────────────────────
  const pairs = ctx.sheet(SHEET.techPairs, [38, 26, 4, 36, 12, 36, 7, 22, 16, 5, 36, 12, 9, 9, 16, 14, 12, 12, 12, 10, 12, 12, 10]);
  pairs.row(['PASANGAN KOMPETENSI per (kandidat, kompetensi dituntut j) — nilai sel = sim′ × faktor level']);
  pairs.row([
    'Tahap 1 IDENTITAS (kunci sama) diselesaikan lebih dulu: sim′ = 1. Tahap 2 HUNGARIAN memasangkan sisanya satu-satu memaksimalkan Σ nilai sel (lihat lembar Sel Hungarian). Kolom yang tidak terukur dikeluarkan dari pembagi M.',
  ]);
  pairs.blank();
  const H = {
    id: 0, name: 1, j: 2, req: 3, reqCode: 4, reqNorm: 5, t: 6, reqKey: 7, stage: 8, ci: 9, cand: 10, candCode: 11,
    k: 12, known: 13, m: 14, sim: 15, lf: 16, value: 17, measurable: 18, storedValue: 19, delta: 20, storedMeasurable: 21, measDelta: 22,
  };
  pairs.row([
    'Kandidat ID',
    'Nama',
    'j',
    'Kompetensi dituntut',
    'Kode',
    'Nama diseragamkan',
    'Level t',
    'Kunci identitas',
    'Tahap',
    'i kandidat',
    'Kompetensi kandidat',
    'Kode',
    'Level k',
    'Terbaca?',
    'Cosinus mentah m',
    'sim′ (rumus)',
    'Faktor level (rumus)',
    'Nilai sel (rumus)',
    'Terukur? (rumus)',
    'Nilai sel engine',
    'Selisih',
    'Terukur engine',
    'Cek terukur',
  ]);
  const pairFirst = pairs.next;
  let anyPairs = false;
  for (const id of ctx.order) {
    const tt = t?.candidates?.[id]?.technical ?? null;
    const stored = (ctx.poolRow(id)?.details?.technicalMatching ?? null) as any;
    const storedPairs: any[] = Array.isArray(stored?.pairs) ? stored.pairs : [];
    if (tt) {
      anyPairs = true;
      writeTracedPairs(ctx, pairs, H, id, tt, storedPairs, heldRow);
    } else if (storedPairs.length > 0) {
      anyPairs = true;
      writeStoredPairs(ctx, pairs, H, id, storedPairs);
    }
  }
  const pairLast = pairs.next - 1;
  if (anyPairs) {
    ctx.checks.push({
      label: 'Teknis: nilai sel per pasangan',
      range: `'${SHEET.techPairs}'!$U$${pairFirst}:$U$${pairLast}`,
      tolerance: 1e-9,
      note: 'sim′ × faktor level (rumus) vs nilai sel yang disimpan engine.',
    });
    ctx.checks.push({
      label: 'Teknis: kolom terukur',
      range: `'${SHEET.techPairs}'!$W$${pairFirst}:$W$${pairLast}`,
      tolerance: 0,
      note: 'Status terukur (rumus) vs engine.',
    });
  }

  // ── Teknis - Sel Hungarian ───────────────────────────────────────
  const cells = ctx.sheet(SHEET.techCells, [38, 26, 5, 34, 9, 9, 5, 34, 7, 14, 12, 12, 12, 10]);
  cells.row(['SEL HUNGARIAN — setiap kombinasi (kompetensi kandidat terbuka × kompetensi dituntut terbuka) yang dipertimbangkan tahap 2']);
  cells.row([
    'Hungarian (Kuhn–Munkres) memilih pasangan satu-satu yang MEMAKSIMALKAN Σ nilai sel. Untuk memeriksa optimalitasnya pakai Solver: variabel biner per sel, kendala ≤ 1 per baris & kolom, maksimalkan Σ nilai × pilih. Kolom "Dipilih" = pilihan engine.',
  ]);
  cells.blank();
  cells.row(['Kandidat ID', 'Nama', 'i', 'Kompetensi kandidat', 'Level k', 'Terbaca?', 'j', 'Kompetensi dituntut', 'Level t', 'Cosinus mentah m', 'sim′ (rumus)', 'Faktor level (rumus)', 'Nilai sel (rumus)', 'Dipilih']);
  for (const id of ctx.order) {
    const tt = t?.candidates?.[id]?.technical;
    if (!tt) continue;
    const chosen = new Set(tt.match.assignment.map(([ci, rj]) => `${ci}#${rj}`));
    tt.match.openHeld.forEach((ci, a) => {
      tt.match.openReq.forEach((rj, b) => {
        const r = cells.next;
        const hr = heldRow.get(`${id}#${ci}`);
        const h = tt.held[ci]!;
        const req = tt.required[rj]!;
        const m = tt.match.cellRaw[a]?.[b];
        cells.row([
          id,
          ctx.candName(id),
          ci,
          h.name,
          hr ? F(`${quoteSheet(SHEET.techHeld)}!$J$${hr}`) : h.level,
          hr ? FB(`${quoteSheet(SHEET.techHeld)}!$I$${hr}`) : h.levelKnown,
          rj + 1,
          req.name,
          req.level,
          N(m ?? null, FULL),
          F(simFormula(`J${r}`), FULL),
          F(`IF(J${r}="",0,${lfFormula(`E${r}`, `I${r}`, `F${r}`, 'FALSE')})`, FULL),
          F(`K${r}*L${r}`, FULL),
          chosen.has(`${ci}#${rj}`),
        ]);
      });
    });
  }

  // ── Teknis - Kandidat ────────────────────────────────────────────
  const cand = ctx.sheet(SHEET.techCand, [38, 26, 8, 8, 14, 14, 14, 10, 12, 10, 14, 12, 16]);
  cand.row(['SKOR KOMPETENSI TEKNIS per kandidat']);
  cand.row(['skor = ROUND( MIN( Σ nilai sel kolom terukur ÷ M_eff , 1 ) × 100 , 0 ). Surplus kelebihan level boleh menutup kekurangan di kolom lain, tidak boleh melampaui 1.']);
  cand.blank();
  cand.row([
    'Kandidat ID',
    'Nama',
    'M',
    'M_eff',
    'Σ nilai terukur',
    'Rata-rata mentah',
    'Dijenuhkan (≤ 1)',
    'Skor (rumus)',
    'Skor dipakai TOPSIS',
    'Selisih',
    'Rata-rata mentah engine',
    'Selisih',
    'Σ sel Hungarian terpilih',
  ]);
  const candFirst = cand.next;
  const P = (col: number) => xcol(SHEET.techPairs, col);
  for (const id of ctx.order) {
    const r = cand.next;
    const storedScore = ctx.storedAspects(id)?.technical ?? null;
    const tt = t?.candidates?.[id]?.technical ?? null;
    const stored = ctx.poolRow(id)?.details?.technicalMatching ?? null;
    const hasRows = Boolean(tt) || (Array.isArray(stored?.pairs) && stored.pairs.length > 0);
    const raw = tt?.match?.normalizedRaw ?? (typeof stored?.normalizedRaw === 'number' ? stored.normalizedRaw : null);
    cand.row([
      id,
      ctx.candName(id),
      hasRows ? F(`COUNTIFS(${P(H.id)},A${r})`) : 0,
      hasRows ? F(`COUNTIFS(${P(H.id)},A${r},${P(H.measurable)},TRUE)`) : 0,
      hasRows ? F(`SUMIFS(${P(H.value)},${P(H.id)},A${r},${P(H.measurable)},TRUE)`, FULL) : 0,
      F(`IF(D${r}>0,E${r}/D${r},0)`, FULL),
      F(`MIN(1,F${r})`, FULL),
      hasRows ? F(`ROUND(G${r}*100,0)`) : storedScore,
      storedScore,
      F(`IF(I${r}="","",H${r}-I${r})`),
      N(raw, FULL),
      F(`IF(K${r}="","",F${r}-K${r})`),
      tt ? F(`SUMIFS(${xcol(SHEET.techCells, 12)},${xcol(SHEET.techCells, 0)},A${r},${xcol(SHEET.techCells, 13)},TRUE)`, FULL) : '',
    ]);
    ctx.setAspectCell(id, 'technical', `${quoteSheet(SHEET.techCand)}!$H$${r}`);
  }
  const candLast = cand.next - 1;
  ctx.checks.push({
    label: 'Teknis: skor kriteria',
    range: `'${SHEET.techCand}'!$J$${candFirst}:$J$${candLast}`,
    tolerance: 0,
    note: 'Skor teknis (rumus) vs skor yang masuk matriks TOPSIS.',
  });
  ctx.checks.push({
    label: 'Teknis: rata-rata sebelum dijenuhkan',
    range: `'${SHEET.techCand}'!$L$${candFirst}:$L$${candLast}`,
    tolerance: 1e-9,
    note: 'Σ/M_eff (rumus) vs normalizedRaw engine.',
  });
}

function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

type Cols = Record<string, number>;

/** Pair rows rebuilt from the run trace — every value an input, every step a formula. */
function writeTracedPairs(
  ctx: BuildContext,
  s: ReturnType<BuildContext['sheet']>,
  H: Cols,
  id: string,
  tt: TechnicalCandidateTrace,
  storedPairs: any[],
  heldRow: Map<string, number>,
): void {
  const identity = new Map(tt.match.identity.map(([rj, ci]) => [rj, ci]));
  const assigned = new Map(tt.match.assignment.map(([ci, rj]) => [rj, ci]));
  tt.required.forEach((req, rj) => {
    const r = s.next;
    const ci = identity.get(rj) ?? assigned.get(rj) ?? null;
    const stage = identity.has(rj) ? STAGE_ID : assigned.has(rj) ? STAGE_HUN : STAGE_NONE;
    let m: number | null = null;
    if (stage === STAGE_HUN && ci != null) {
      const a = tt.match.openHeld.indexOf(ci);
      const b = tt.match.openReq.indexOf(rj);
      m = tt.match.cellRaw[a]?.[b] ?? null;
    }
    const h = ci != null ? tt.held[ci]! : null;
    const hr = ci != null ? heldRow.get(`${id}#${ci}`) : undefined;
    const sp = storedPairs[rj];
    const row: Cell[] = [];
    row[H.id] = id;
    row[H.name] = ctx.candName(id);
    row[H.j] = rj + 1;
    row[H.req] = req.name;
    row[H.reqCode] = req.code ?? '';
    row[H.reqNorm] = req.norm;
    row[H.t] = req.level;
    row[H.reqKey] = FS(`IF(E${r}<>"","C:"&E${r},"N:"&F${r})`);
    row[H.stage] = stage;
    row[H.ci] = ci ?? '';
    row[H.cand] = h?.name ?? '';
    row[H.candCode] = h?.code ?? '';
    row[H.k] = hr ? F(`${quoteSheet(SHEET.techHeld)}!$J$${hr}`) : h?.level ?? '';
    row[H.known] = hr ? FB(`${quoteSheet(SHEET.techHeld)}!$I$${hr}`) : h ? h.levelKnown : '';
    row[H.m] = N(m, FULL);
    row[H.sim] = F(`IF(I${r}="${STAGE_NONE}","",IF(I${r}="${STAGE_ID}",1,${simFormula(`O${r}`)}))`, FULL);
    row[H.lf] = F(
      `IF(I${r}="${STAGE_NONE}",0,IF(AND(I${r}<>"${STAGE_ID}",O${r}=""),0,${lfFormula(`M${r}`, `G${r}`, `N${r}`, `I${r}="${STAGE_ID}"`)}))`,
      FULL,
    );
    row[H.value] = F(`IF(I${r}="${STAGE_NONE}",0,IF(I${r}="${STAGE_ID}",Q${r},P${r}*Q${r}))`, FULL);
    row[H.measurable] = FB(
      `OR(E${r}<>"",COUNTIFS(${xcol(SHEET.techHeld, 0)},A${r},${xcol(SHEET.techHeld, 10)},H${r})>0)`,
    );
    row[H.storedValue] = N(typeof sp?.value === 'number' ? sp.value : null, FULL);
    row[H.delta] = F(`IF(T${r}="","",R${r}-T${r})`);
    row[H.storedMeasurable] = tt.match.measurable[rj] ?? '';
    row[H.measDelta] = FS(`IF(V${r}="","",IF(S${r}=V${r},"","BEDA"))`);
    s.row(row);
  });
}

/**
 * Pair rows from the STORED detail only — a run without a trace. The candidate's
 * level and whether it was readable come from the stored pair (no label to
 * re-derive it from), and the Hungarian alternatives are not known.
 */
function writeStoredPairs(ctx: BuildContext, s: ReturnType<BuildContext['sheet']>, H: Cols, id: string, storedPairs: any[]): void {
  storedPairs.forEach((p, rj) => {
    const r = s.next;
    const mt = String(p?.matchType ?? 'unmatched');
    const stage =
      mt === 'exact' || mt === 'code'
        ? STAGE_ID
        : mt === 'semantic' || (mt === 'unmeasurable' && p?.candidate)
          ? STAGE_HUN
          : STAGE_NONE;
    const row: Cell[] = [];
    row[H.id] = id;
    row[H.name] = ctx.candName(id);
    row[H.j] = rj + 1;
    row[H.req] = p?.required?.name ?? '';
    row[H.reqCode] = p?.required?.code ?? '';
    row[H.reqNorm] = '';
    row[H.t] = Number(p?.required?.level ?? 0);
    row[H.reqKey] = FS(`IF(E${r}<>"","C:"&E${r},"N:"&F${r})`);
    row[H.stage] = stage;
    row[H.ci] = '';
    row[H.cand] = p?.candidate?.name ?? '';
    row[H.candCode] = p?.candidate?.code ?? '';
    row[H.k] = p?.candidate ? Number(p.candidate.level) : '';
    row[H.known] = p?.candidate ? p.levelUnknown !== true : '';
    row[H.m] = N(typeof p?.similarityRaw === 'number' ? p.similarityRaw : null, FULL);
    row[H.sim] = F(`IF(I${r}="${STAGE_NONE}","",IF(I${r}="${STAGE_ID}",1,${simFormula(`O${r}`)}))`, FULL);
    row[H.lf] = F(
      `IF(I${r}="${STAGE_NONE}",0,IF(AND(I${r}<>"${STAGE_ID}",O${r}=""),0,${lfFormula(`M${r}`, `G${r}`, `N${r}`, `I${r}="${STAGE_ID}"`)}))`,
      FULL,
    );
    row[H.value] = F(`IF(I${r}="${STAGE_NONE}",0,IF(I${r}="${STAGE_ID}",Q${r},P${r}*Q${r}))`, FULL);
    // Without the held list the measurable test cannot be re-derived; the stored verdict stands.
    row[H.measurable] = mt !== 'unmeasurable';
    row[H.storedValue] = N(typeof p?.value === 'number' ? p.value : null, FULL);
    row[H.delta] = F(`IF(T${r}="","",R${r}-T${r})`);
    row[H.storedMeasurable] = mt !== 'unmeasurable';
    row[H.measDelta] = '';
    s.row(row);
  });
  void a1;
}
