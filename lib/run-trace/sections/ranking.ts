// AHP (criterion weights) and TOPSIS (the final ranking).
//
// AHP mirrors computeAhpWeights (scoring-service/src/ahp.ts): geometric mean per
// row, normalised; λmax = mean of (A·w)_i ÷ w_i; CI = (λmax − n) ÷ (n − 1);
// CR = CI ÷ RI(n). A child ranks with its parent's weights at full precision
// (rerun-freeze.ts → frozenWeights), so on a child "Bobot dipakai" is that
// inherited vector, and the matrix only feeds the consistency figures.
//
// TOPSIS mirrors rankCandidatesByTopsis + topsisDetailed (topsis-ranking.ts,
// topsis.ts): dropped criteria removed, weights renormalised over the active
// ones, v = (w × x) ÷ norm in that operation order, ideals from the extremes of
// the pool, closeness, then rank by closeness descending with the candidate id
// as the (arbitrary, deterministic) tie-break.

import { BuildContext, CRITERIA, CRITERION_LABEL, SHEET, type Criterion } from '../context';
import { F, FB, FS, FULL, N, colName, type Cell } from '../sheet';
import { SAATY_SCALE, ahpInputCheck, saatyLabel, type AhpInputCheck } from '@/lib/ahp';

export function buildAhp(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.ahp, [26, 13, 13, 13, 13, 13, 13, 16, 14, 14, 14, 14, 14, 14, 10, 9, 14]);
  const t = ctx.t;
  const ri = ctx.b.runInfo ?? {};
  const pairwise: number[][] | null =
    t?.ahp?.pairwise ?? ri.frozen?.ahp?.pairwise ?? (Array.isArray(ri.ahp?.pairwise) ? ri.ahp.pairwise : null);
  // run_info.ahp.pairwise is stored at 4 decimals (1/3 → 0.3333); the trace and
  // the frozen basis carry the matrix the engine actually computed with.
  // Runs since docs/ahp-input-sync.md §8.2 store it at full precision and say so.
  const pairwiseRounded =
    !t?.ahp?.pairwise && !ri.frozen?.ahp?.pairwise && pairwise != null && ri.ahp?.pairwisePrecision !== 'full';
  const used: Record<string, number> | null = t?.ahp?.weightsUsed ?? ri.frozen?.ahp?.weights ?? ri.ahp?.weights ?? null;
  const inherited = t?.ahp?.weightsInherited ?? ri.ahp?.weightSource === 'inherited';
  const active: string[] = t?.topsis?.activeCriteria ?? ri.ahp?.activeCriteria ?? [...CRITERIA];

  s.row(['AHP — BOBOT KRITERIA DARI MATRIKS PERBANDINGAN BERPASANGAN (skala Saaty)']);
  s.row([
    `Sumber bobot: ${t?.ahp?.weightSource ?? ri.ahp?.weightSource ?? '—'}${inherited ? ' — run turunan: bobot DIWARISI dari run induk pada presisi penuh; matriks hanya untuk angka konsistensi.' : ''}`,
  ]);
  s.row(['bobot_i = (Π_j a_ij)^(1/n) ÷ Σ_k (Π_j a_kj)^(1/n). Kriteria yang tidak dapat dinilai untuk siapa pun dikeluarkan; bobot sisanya dinormalisasi ulang (Pers. 2.12).']);
  s.blank();
  const head: Cell[] = ['Kriteria', ...CRITERIA.map((k) => CRITERION_LABEL[k]), 'Π baris', 'Rata-rata geometrik', 'Bobot (rumus)', '(A·w)_i', 'λ_i', 'Bobot dipakai', 'Bobot engine', 'Selisih', 'Aktif?', 'Bobot efektif'];
  s.row(head);
  const first = s.next;
  const n = CRITERIA.length;
  CRITERIA.forEach((k, i) => {
    const r = first + i;
    const row: Cell[] = [CRITERION_LABEL[k]];
    for (let j = 0; j < n; j++) row.push(N(pairwise?.[i]?.[j] ?? null, FULL));
    const rowRange = `B${r}:${colName(n)}${r}`;
    row.push(pairwise ? F(`PRODUCT(${rowRange})`, FULL) : '');
    row.push(pairwise ? F(`H${r}^(1/${n})`, FULL) : '');
    row.push(pairwise ? F(`I${r}/SUM($I$${first}:$I$${first + n - 1})`, FULL) : '');
    // (A·w)_i written as an explicit sum so no array evaluation is needed.
    row.push(pairwise ? F(CRITERIA.map((_, j) => `${colName(1 + j)}${r}*$J$${first + j}`).join('+'), FULL) : '');
    row.push(pairwise ? F(`K${r}/J${r}`, FULL) : '');
    row.push(inherited || !pairwise ? N(used?.[k] ?? null, FULL) : F(`J${r}`, FULL));
    row.push(N(used?.[k] ?? null, FULL));
    row.push(F(`IF(N${r}="","",M${r}-N${r})`));
    row.push(active.includes(k));
    row.push(F(`IF(P${r},IF(SUMIF($P$${first}:$P$${first + n - 1},TRUE,$M$${first}:$M$${first + n - 1})>0,M${r}/SUMIF($P$${first}:$P$${first + n - 1},TRUE,$M$${first}:$M$${first + n - 1}),1/COUNTIF($P$${first}:$P$${first + n - 1},TRUE)),0)`, FULL));
    s.row(row);
    ctx.name(`P_WEFF_${k.toUpperCase()}`, SHEET.ahp, 16, r);
  });
  const last = first + n - 1;
  ctx.checks.push({
    label: 'AHP: bobot kriteria',
    range: `'${SHEET.ahp}'!$O$${first}:$O$${last}`,
    tolerance: pairwiseRounded ? 1e-4 : 1e-12,
    note: pairwiseRounded
      ? 'Matriks hanya tersimpan 4 desimal (run_info.ahp.pairwise) pada run ini: bobot dari matriks itu dibandingkan pada presisi tersebut.'
      : 'Bobot dari rata-rata geometrik matriks vs bobot yang dipakai engine.',
  });
  if (pairwiseRounded) ctx.gaps.push('Matriks AHP run ini hanya tersimpan 4 desimal (run_info.ahp.pairwise); bobot dan konsistensi yang dihitung ulang darinya dibandingkan pada presisi itu.');
  s.blank();
  // Full precision first: the trace, then the frozen basis every AHP run has
  // written since the freeze (run_info.frozen.ahp.consistency). run_info.ahp
  // keeps λmax / CI / CR only as toFixed(4), so a run that has nothing else is
  // compared at the precision it was stored with — never at 1e-9 against a
  // number that was rounded on the way in.
  const frozenCons = ri.frozen?.ahp?.consistency ?? null;
  const rep = t?.ahp?.reported ?? frozenCons ?? { lambdaMax: ri.ahp?.lambdaMax, ci: ri.ahp?.consistencyIndex, cr: ri.ahp?.consistencyRatio };
  const repRounded = !t?.ahp?.reported && !frozenCons;
  s.row(['Konsistensi', 'Rumus', 'Nilai', repRounded ? 'Engine (run_info, 4 desimal)' : 'Engine', 'Selisih']);
  const rl = s.next;
  s.row(['λ maks', '= RATA-RATA(λ_i)', pairwise ? F(`AVERAGE(L${first}:L${last})`, FULL) : '', N(rep?.lambdaMax ?? null, FULL), F(`IF(OR(C${rl}="",D${rl}=""),"",C${rl}-D${rl})`)]);
  const rci = s.next;
  s.row(['CI', '= (λmaks − n) ÷ (n − 1)', pairwise ? F(`(C${rl}-${n})/(${n}-1)`, FULL) : '', N(rep?.ci ?? null, FULL), F(`IF(OR(C${rci}="",D${rci}=""),"",C${rci}-D${rci})`)]);
  const rri = s.next;
  s.row(['RI (n = 6)', 'Random Index Saaty', t?.ahp?.randomIndex ?? 1.24, '', '']);
  const rcr = s.next;
  s.row(['CR', '= CI ÷ RI (layak bila ≤ 0,1)', pairwise ? F(`IF(C${rri}>0,C${rci}/C${rri},0)`, FULL) : '', N(rep?.cr ?? null, FULL), F(`IF(OR(C${rcr}="",D${rcr}=""),"",C${rcr}-D${rcr})`)]);
  if (pairwise && !inherited) {
    ctx.checks.push({
      label: 'AHP: λmaks, CI, CR',
      range: `'${SHEET.ahp}'!$E$${rl}:$E$${rcr}`,
      // A stored toFixed(4) is within 5E-5 of the value it rounded; a matrix
      // stored at 4 decimals moves the recomputed figure by less than that again.
      tolerance: repRounded || pairwiseRounded ? 1e-4 : 1e-9,
      note: repRounded || pairwiseRounded ? 'Run ini hanya menyimpan matriks/konsistensi 4 desimal (run_info.ahp): dibandingkan pada presisi itu.' : '',
    });
  }
  const dropped: { key: string; reason: string }[] = ri.ahp?.droppedCriteria ?? [];
  if (dropped.length > 0) {
    s.blank();
    s.row(['Kriteria dikeluarkan dari TOPSIS', 'Alasan']);
    for (const d of dropped) s.row([CRITERION_LABEL[d.key as Criterion] ?? d.key, d.reason]);
  }
  if (pairwise) {
    buildAhpInputCheck(ctx, s, pairwise, first, pairwiseRounded, rcr, t?.ahp?.inputCheck ?? ri.ahp?.inputCheck ?? null, t?.ahp?.weightSource ?? ri.ahp?.weightSource ?? null);
  }
}

/**
 * "Is this matrix a valid expert input?" — on the Saaty scale, reciprocal,
 * CR <= 0.1 (docs/ahp-input-sync.md §8.4). The engine never gates on it; this
 * block shows it, with live formulas next to the engine's own flag. A run
 * written before the flag existed is checked here, at export, with the same
 * validateAhpPairwise (1e-3 in log space for a 4-decimal stored copy).
 */
function buildAhpInputCheck(
  ctx: BuildContext,
  s: ReturnType<BuildContext['sheet']>,
  pairwise: number[][],
  first: number,
  rounded: boolean,
  crRow: number,
  recorded: AhpInputCheck | null,
  source: string | null,
): void {
  const n = CRITERIA.length;
  const tol = rounded ? 1e-3 : 1e-6;
  const matrixSource = source === 'default' || source === 'inherited' ? source : 'ahp-matrix';
  const check = recorded ?? ahpInputCheck(pairwise, matrixSource, CRITERIA, tol);
  s.blank();
  s.row(['PEMERIKSAAN MASUKAN MATRIKS — skala Saaty, resiprokal, CR ≤ 0,1 (penanda, bukan gerbang: bobot di atas tidak bergantung padanya)']);
  const scaleRow = s.next;
  s.row(['Skala Saaty S', ...SAATY_SCALE.map((v) => N(v, FULL))]);
  const lastScaleCol = colName(SAATY_SCALE.length);
  const S = '$B$' + scaleRow + ':$' + lastScaleCol + '$' + scaleRow;
  const tolRow = s.next;
  s.row(['Toleransi skala (ruang log)', N(tol, '0.0E+00'), rounded ? 'matriks hanya tersimpan 4 desimal: toleransi dilonggarkan' : '']);
  s.row(['Pasangan', 'Nilai aᵢⱼ', 'Label Saaty', '∈ S (rumus)', 'aᵢⱼ·aⱼᵢ = 1 (rumus)', 'Penanda engine']);
  const pairsFirst = s.next;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = s.next;
      const cell = `${colName(1 + j)}${first + i}`;
      const twin = `${colName(1 + i)}${first + j}`;
      const flagged = check.offScale.some((c) => c.row === CRITERIA[i] && c.col === CRITERIA[j]);
      const engineText = flagged ? 'di luar S' : '∈ S';
      s.row([
        `${CRITERION_LABEL[CRITERIA[i]!]} vs ${CRITERION_LABEL[CRITERIA[j]!]}`,
        F(cell, FULL),
        saatyLabel(pairwise[i]![j]!, tol),
        FS(`IF(SUMPRODUCT(--(ABS(LN(B${r})-LN(${S}))<=$B$${tolRow}))>0,"∈ S","di luar S")`),
        FS(`IF(ABS(${cell}*${twin}-1)<=1E-9,"ya","TIDAK")`),
        recorded ? engineText : `${engineText} (diperiksa saat ekspor)`,
      ]);
    }
  }
  const pairsLast = s.next - 1;
  const count = pairsLast - pairsFirst + 1;
  s.row(['Semua sel ∈ S', FS(`IF(COUNTIF(D${pairsFirst}:D${pairsLast},"∈ S")=${count},"ya","TIDAK")`)]);
  s.row(['Resiprokal', FS(`IF(COUNTIF(E${pairsFirst}:E${pairsLast},"ya")=${count},"ya","TIDAK")`)]);
  s.row(['CR ≤ 0,1', FS(`IF(C${crRow}="","",IF(C${crRow}<=0.1,"ya","TIDAK"))`)]);
  const problems = [
    check.offScale.length ? `berisi ${check.offScale.length} nilai di luar skala Saaty` : '',
    check.reciprocal ? '' : 'tidak resiprokal',
    check.crExceeded ? `ber-CR ${check.cr?.toFixed(4)} > 0,1` : '',
  ].filter(Boolean);
  const verdict = check.ok
    ? 'Masukan valid: semua sel pada skala Saaty, resiprokal, CR ≤ 0,1.'
    : check.expected
      ? 'Bobot bawaan sistem: matriks dibentuk dari vektor bobot (wᵢ/wⱼ), bukan masukan pakar — nilai di luar skala Saaty pada matriks ini wajar.'
      : `PERHATIAN: matriks run ini ${problems.join(', ')} — tidak akan lolos validasi simpan saat ini.`;
  s.row(['Penanda', `${verdict}${recorded ? '' : ' (run ini dibuat sebelum penanda dicatat; diperiksa saat ekspor)'}`]);
  if (!check.ok && !check.expected) ctx.gaps.push(`AHP: ${verdict}`);
}

export function buildTopsis(ctx: BuildContext): void {
  const t = ctx.t;
  const ri = ctx.b.runInfo ?? {};
  const active = (t?.topsis?.activeCriteria ?? ri.ahp?.activeCriteria ?? [...CRITERIA]) as Criterion[];
  const A = active.length;
  const s = ctx.sheet(SHEET.topsis, [5, 38, 26, ...Array(A).fill(11), ...Array(A).fill(13), 13, 13, 13, 8, 8, 16, 8, 13, 10, 9, 9, ...Array(A).fill(10)]);
  s.row(['TOPSIS — PERINGKAT AKHIR (matriks keputusan: kandidat × kriteria aktif)']);
  s.row([
    'x_ij = skor kriteria (dirujuk dari lembar aspek). norm_j = √Σ_i x_ij² (1E-9 bila 0). v_ij = (w_j × x_ij) ÷ norm_j. A⁺_j = MAX_i v_ij, A⁻_j = MIN_i v_ij (semua kriteria benefit).',
  ]);
  s.row([
    'D⁺_i = √Σ_j (v_ij − A⁺_j)², D⁻_i = √Σ_j (v_ij − A⁻_j)², CC_i = D⁻ ÷ (D⁺ + D⁻). Peringkat = 1 + #(CC lebih besar) + #(CC sama DAN candidate_id lebih kecil). Skor = ROUND(CC × 100, 0).',
  ]);
  s.blank();
  // Column layout.
  const cX = 3;
  const cV = cX + A;
  const cDp = cV + A;
  const cDn = cDp + 1;
  const cCC = cDp + 2;
  const cRank = cDp + 3;
  const cScore = cDp + 4;
  const cReady = cDp + 5;
  const cFinal = cDp + 6;
  const cStoredCC = cDp + 7;
  const cDeltaCC = cDp + 8;
  const cStoredRank = cDp + 9;
  const cDeltaRank = cDp + 10;
  const cStoredX = cDp + 11;
  const L = (c: number) => colName(c);

  const ids = ctx.order;
  const dataFirst = 11;
  const dataLast = dataFirst + ids.length - 1;
  const colRange = (c: number) => `$${L(c)}$${dataFirst}:$${L(c)}$${dataLast}`;

  // Row 5: weights, 6: norms, 7: A+, 8: A-, 9: engine norms (trace), 10: header.
  const wRow: Cell[] = ['', 'Bobot efektif w_j', ''];
  const nRow: Cell[] = ['', 'Pembagi norm_j', ''];
  const pRow: Cell[] = ['', 'Ideal positif A⁺_j', ''];
  const mRow: Cell[] = ['', 'Ideal negatif A⁻_j', ''];
  const eRow: Cell[] = ['', 'norm_j engine', ''];
  active.forEach((k, j) => {
    wRow[cX + j] = F(`P_WEFF_${k.toUpperCase()}`, FULL);
    nRow[cX + j] = F(`IF(SUMSQ(${colRange(cX + j)})=0,P_TOPSIS_ZERO,SQRT(SUMSQ(${colRange(cX + j)})))`, FULL);
    pRow[cV + j] = F(`MAX(${colRange(cV + j)})`, FULL);
    mRow[cV + j] = F(`MIN(${colRange(cV + j)})`, FULL);
    eRow[cX + j] = N(t?.topsis?.colNorms?.[j] ?? null, FULL);
    eRow[cV + j] = N(t?.topsis?.idealPos?.[j] ?? null, FULL);
  });
  s.row(wRow); // 5
  s.row(nRow); // 6
  s.row(pRow); // 7
  s.row(mRow); // 8
  s.row(eRow); // 9 (engine: norms under x, A+ under v)
  const head: Cell[] = ['No', 'Kandidat ID', 'Nama'];
  active.forEach((k, j) => {
    head[cX + j] = `x ${CRITERION_LABEL[k]}`;
    head[cV + j] = `v ${CRITERION_LABEL[k]}`;
    head[cStoredX + j] = `x engine ${CRITERION_LABEL[k]}`;
  });
  head[cDp] = 'D⁺';
  head[cDn] = 'D⁻';
  head[cCC] = 'Kedekatan CC';
  head[cRank] = 'Peringkat';
  head[cScore] = 'Skor';
  head[cReady] = 'Readiness';
  head[cFinal] = 'Finalis?';
  head[cStoredCC] = 'CC engine';
  head[cDeltaCC] = 'Selisih CC';
  head[cStoredRank] = 'Peringkat engine';
  head[cDeltaRank] = 'Selisih';
  s.row(head); // 10

  const readinessIf = (score: string): string => {
    const rows = ctx.readinessRows;
    if (rows.length === 0) return 'P_READY_DEFAULT';
    return rows.reduceRight<string>((acc, r) => `IF(${score}>=${r.minRef},${r.levelRef},${acc})`, 'P_READY_DEFAULT');
  };

  ids.forEach((id, i) => {
    const r = dataFirst + i;
    const row: Cell[] = [i + 1, id, ctx.candName(id)];
    const stored = ctx.storedAspects(id);
    const links = ctx.aspectCell.get(id) ?? {};
    active.forEach((k, j) => {
      row[cX + j] = links[k] ? F(links[k]!) : N(stored?.[k] ?? null);
      row[cV + j] = F(`(${L(cX + j)}$5*${L(cX + j)}${r})/${L(cX + j)}$6`, FULL);
      row[cStoredX + j] = N(stored?.[k] ?? null);
    });
    const vR = `${L(cV)}${r}:${L(cV + A - 1)}${r}`;
    row[cDp] = F(`SQRT(SUMXMY2(${vR},$${L(cV)}$7:$${L(cV + A - 1)}$7))`, FULL);
    row[cDn] = F(`SQRT(SUMXMY2(${vR},$${L(cV)}$8:$${L(cV + A - 1)}$8))`, FULL);
    row[cCC] = F(`IF(${L(cDp)}${r}+${L(cDn)}${r}>0,${L(cDn)}${r}/(${L(cDp)}${r}+${L(cDn)}${r}),P_TOPSIS_TIE)`, FULL);
    row[cRank] = F(
      `1+SUMPRODUCT(--(${colRange(cCC)}>${L(cCC)}${r}))+SUMPRODUCT((${colRange(cCC)}=${L(cCC)}${r})*(${colRange(1)}<${L(1)}${r}))`,
    );
    row[cScore] = F(`ROUND(${L(cCC)}${r}*100,0)`);
    row[cReady] = FS(readinessIf(`${L(cScore)}${r}`));
    row[cFinal] = FB(`${L(cRank)}${r}<=P_N`);
    const traceIdx = t?.topsis?.rowIds?.indexOf(id) ?? -1;
    const pool = ctx.poolRow(id);
    const storedCC =
      traceIdx >= 0 ? t!.topsis.closeness[traceIdx]! : typeof pool?.details?.topsis?.closeness === 'number' ? pool.details.topsis.closeness : pool?.closeness ?? null;
    row[cStoredCC] = N(storedCC, FULL);
    row[cDeltaCC] = F(`IF(${L(cStoredCC)}${r}="","",${L(cCC)}${r}-${L(cStoredCC)}${r})`);
    row[cStoredRank] = pool?.poolRank ?? ctx.b.results.find((x) => x.candidateId === id)?.rank ?? '';
    row[cDeltaRank] = F(`IF(${L(cStoredRank)}${r}="","",${L(cRank)}${r}-${L(cStoredRank)}${r})`);
    s.row(row);
  });

  // Engine A− row below the data, so every intermediate has its comparison.
  const engNeg: Cell[] = ['', 'A⁻_j engine', ''];
  active.forEach((_, j) => (engNeg[cV + j] = N(t?.topsis?.idealNeg?.[j] ?? null, FULL)));
  s.blank();
  s.row(engNeg);

  ctx.checks.push({ label: 'TOPSIS: kedekatan CC', range: `'${SHEET.topsis}'!$${L(cDeltaCC)}$${dataFirst}:$${L(cDeltaCC)}$${dataLast}`, tolerance: 1e-9, note: 'CC (rumus) vs CC engine presisi penuh (I-4: |Δ| ≤ 1e-9).' });
  ctx.checks.push({ label: 'TOPSIS: peringkat', range: `'${SHEET.topsis}'!$${L(cDeltaRank)}$${dataFirst}:$${L(cDeltaRank)}$${dataLast}`, tolerance: 0, note: 'Peringkat (rumus) vs pool_rank tersimpan.' });
  // x vs stored x: an aspect sheet that recomputed a different score shows here.
  const xDeltaCol = cStoredX + A;
  active.forEach((k, j) => {
    s.rows[9]![xDeltaCol + j] = `Δ x ${CRITERION_LABEL[k]}`;
    ids.forEach((_, i) => {
      const r = dataFirst + i;
      s.rows[r - 1]![xDeltaCol + j] = F(`IF(${L(cStoredX + j)}${r}="","",${L(cX + j)}${r}-${L(cStoredX + j)}${r})`);
    });
  });
  if (A > 0) {
    ctx.checks.push({
      label: 'TOPSIS: masukan x = skor aspek engine',
      range: `'${SHEET.topsis}'!$${L(xDeltaCol)}$${dataFirst}:$${L(xDeltaCol + A - 1)}$${dataLast}`,
      tolerance: 0,
      note: 'Skor aspek yang dihitung ulang lembar aspek vs yang dipakai engine.',
    });
  }

  // ── Persisted rows vs the formulas ───────────────────────────────
  // Every check above compares a formula with the ENGINE TRACE. What the app
  // shows and what a child run inherits are the PERSISTED rows —
  // scoring_run_pool_aspects (aspects, closeness, pool_rank, is_finalist) and
  // analysis_results (rank, final_score, details.scoreBreakdown) — so they are
  // compared here too: a trace that agrees with itself but not with the stored
  // ranking must not read "SEMUA COCOK". All six aspects, active or dropped.
  const P0 = xDeltaCol + A;
  const nK = CRITERIA.length;
  const cPoolX = P0; // nK stored, then nK Δ
  const cPoolCC = P0 + 2 * nK;
  const cPoolFin = cPoolCC + 2;
  const cResRank = cPoolFin + 2;
  const cResScore = cResRank + 2;
  const cResX = cResScore + 2; // nK stored, then nK Δ
  const hdr = s.rows[9]!;
  CRITERIA.forEach((k, j) => {
    hdr[cPoolX + j] = `${CRITERION_LABEL[k]} tersimpan (pool)`;
    hdr[cPoolX + nK + j] = `Δ ${CRITERION_LABEL[k]} (pool)`;
    hdr[cResX + j] = `${CRITERION_LABEL[k]} tersimpan (hasil)`;
    hdr[cResX + nK + j] = `Δ ${CRITERION_LABEL[k]} (hasil)`;
  });
  hdr[cPoolCC] = 'CC tersimpan (pool, 6 desimal)';
  hdr[cPoolCC + 1] = 'Δ CC (pool)';
  hdr[cPoolFin] = 'Finalis tersimpan (pool)';
  hdr[cPoolFin + 1] = 'Finalis cocok?';
  hdr[cResRank] = 'Peringkat tersimpan (hasil)';
  hdr[cResRank + 1] = 'Δ peringkat (hasil)';
  hdr[cResScore] = 'Skor akhir tersimpan (hasil, CC 6 desimal)';
  hdr[cResScore + 1] = 'Δ skor akhir (hasil)';
  const numOrBlank = (v: unknown): Cell => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : '');
  ids.forEach((id, i) => {
    const r = dataFirst + i;
    const row = s.rows[r - 1]!;
    const pool = ctx.poolRow(id);
    const res = ctx.b.results.find((x) => x.candidateId === id) ?? null;
    const links = ctx.aspectCell.get(id) ?? {};
    const traced = ctx.storedAspects(id);
    const breakdown = (res?.details?.scoreBreakdown ?? null) as Record<string, unknown> | null;
    CRITERIA.forEach((k, j) => {
      // The derivation of aspect k: the aspect sheet's formula cell when there is
      // one, else the value the engine traced (a run whose sheet could not be
      // rebuilt still has its persisted rows compared with its own trace).
      const derived = links[k] ?? null;
      const ref = derived ?? (typeof traced?.[k] === 'number' ? String(traced[k]) : null);
      row[cPoolX + j] = numOrBlank(pool?.aspects?.[k]);
      row[cPoolX + nK + j] = ref == null ? '' : F(`IF(${L(cPoolX + j)}${r}="","",(${ref})-${L(cPoolX + j)}${r})`);
      row[cResX + j] = numOrBlank(breakdown?.[k]);
      row[cResX + nK + j] = ref == null ? '' : F(`IF(${L(cResX + j)}${r}="","",(${ref})-${L(cResX + j)}${r})`);
    });
    row[cPoolCC] = numOrBlank(pool?.closeness);
    row[cPoolCC + 1] = F(`IF(${L(cPoolCC)}${r}="","",${L(cCC)}${r}-${L(cPoolCC)}${r})`);
    row[cPoolFin] = typeof pool?.isFinalist === 'boolean' ? pool.isFinalist : '';
    row[cPoolFin + 1] = FS(`IF(${L(cPoolFin)}${r}="","",IF(${L(cFinal)}${r}=${L(cPoolFin)}${r},"","BEDA"))`);
    row[cResRank] = numOrBlank(res?.rank);
    row[cResRank + 1] = F(`IF(${L(cResRank)}${r}="","",${L(cRank)}${r}-${L(cResRank)}${r})`);
    row[cResScore] = numOrBlank(res?.finalScore);
    row[cResScore + 1] = F(`IF(${L(cResScore)}${r}="","",${L(cCC)}${r}-${L(cResScore)}${r})`);
  });
  const block = (c0: number, c1: number) => `'${SHEET.topsis}'!$${L(c0)}$${dataFirst}:$${L(c1)}$${dataLast}`;
  ctx.checks.push(
    {
      label: 'Tersimpan: skor aspek (scoring_run_pool_aspects)',
      range: block(cPoolX + nK, cPoolX + 2 * nK - 1),
      tolerance: 0,
      note: 'Skor enam aspek yang disimpan per kandidat pool (dipakai tampilan dan diwarisi run turunan) vs rumus lembar aspek.',
    },
    {
      label: 'Tersimpan: kedekatan CC pool (6 desimal)',
      range: block(cPoolCC + 1, cPoolCC + 1),
      tolerance: 6e-7,
      note: 'Kolom closeness disimpan numeric(10,6) (toFixed(6)): selisih ≤ 5E-7 adalah pembulatan itu.',
    },
    {
      label: 'Tersimpan: status finalis (pool)',
      range: block(cPoolFin + 1, cPoolFin + 1),
      tolerance: 0,
      note: 'is_finalist vs peringkat (rumus) ≤ P_N.',
    },
    {
      label: 'Tersimpan: peringkat hasil (analysis_results)',
      range: block(cResRank + 1, cResRank + 1),
      tolerance: 0,
      note: 'Peringkat pool penuh pada baris hasil vs peringkat (rumus).',
    },
    {
      label: 'Tersimpan: skor akhir hasil (6 desimal)',
      range: block(cResScore + 1, cResScore + 1),
      tolerance: 6e-7,
      note: 'final_score = CC disimpan numeric(10,6): selisih ≤ 5E-7 adalah pembulatan itu.',
    },
    {
      label: 'Tersimpan: rincian skor hasil (scoreBreakdown)',
      range: block(cResX + nK, cResX + 2 * nK - 1),
      tolerance: 0,
      note: 'Skor aspek yang ditampilkan di daftar hasil vs rumus lembar aspek.',
    },
  );
}
