// Stage 2: UMAP. Cosine distances → each document's k nearest neighbours →
// ρ and σ (the bisection, column by column) → membership weights → the fuzzy
// union graph → the edges the layout keeps → the a, b curve → the coordinates
// the optimisation produced.

import { BuildContext, SHEET, cell, docRow, rowRange } from '../context';
import { F, FB, FS, colName, fn, q } from '../../run-trace/sheet';

/** Iterations UMAP's smooth_knn_dist allows (n_iter). */
const N_ITER = 64;
const SMOOTH_K_TOLERANCE = 1e-5;

/**
 * How many bisection columns the workbook writes: the iterations the slowest
 * document needs (re-run here in double precision, as the cells will compute
 * it), plus a margin, capped at the library's 64. Columns after convergence
 * would only repeat the frozen value; the "Konvergen" column proves nothing
 * was cut short.
 */
function sigmaIterations(ctx: BuildContext): number {
  const t = ctx.t;
  const k = t.umap.params.nNeighbors;
  const X = ctx.vectors;
  const norm = X.map((v) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)));
  const target = Math.log2(k);
  let worst = 0;
  t.umap.knnIndices.forEach((nb, i) => {
    const d = nb.map((j) => (j === i ? 0 : 1 - X[i]!.reduce((a, x, c) => a + x * X[j]![c]!, 0) / (norm[i]! * norm[j]!)));
    const pos = d.filter((x) => x > 0);
    const rho = pos.length ? Math.min(...pos) : 0;
    let lo = 0;
    let hi = Infinity;
    let mid = 1;
    let n = 0;
    for (; n < N_ITER; n++) {
      let psi = 0;
      for (let j = 1; j < d.length; j++) psi += Math.exp(-((d[j]! - rho) + Math.abs(d[j]! - rho)) / (2 * mid));
      if (Math.abs(psi - target) < SMOOTH_K_TOLERANCE) break;
      if (psi > target) {
        hi = mid;
        mid = (lo + hi) / 2;
      } else {
        lo = mid;
        mid = hi === Infinity ? mid * 2 : (lo + hi) / 2;
      }
    }
    worst = Math.max(worst, n + 1);
  });
  return Math.min(N_ITER, worst + 3);
}

/** Layout of the bisection sheet: Dok # | ρ | Jabatan | lo×I | hi×I | mid×(I+1) | ψ×I | iterations | converged. */
function sigmaLayout(iters: number) {
  const LO = 3;
  const HI = LO + iters;
  const MID = HI + iters;
  const PSI = MID + iters + 1;
  /** The result: the last mid column (frozen on the converged value when the search stopped early). */
  const FINAL = MID + iters;
  return { LO, HI, MID, PSI, FINAL, ITERS: PSI + iters, CONV: PSI + iters + 1 };
}

export function buildKnn(ctx: BuildContext): void {
  const t = ctx.t;
  const N = ctx.N;
  const k = t.umap.params.nNeighbors;
  const idx = t.umap.knnIndices;
  const dl = ctx.matrix(t.umap.knnDists);
  const sig = ctx.flat(t.umap.sigmas);
  const rho = ctx.flat(t.umap.rhos);

  const NB = 2; // first neighbour-index column
  const DC = NB + k; // d (rumus)
  const DL = DC + k; // d (pustaka)
  const DD = DL + k; // Δ d
  const SM = DD + k; // SMALL check
  const S0 = SM + k; // scalar columns
  const RHO = S0;
  const RHO_L = S0 + 1;
  const RHO_D = S0 + 2;
  const MEAN = S0 + 3;
  const FLOOR = S0 + 4;
  const MID = S0 + 5;
  const SIG = S0 + 6;
  const SIG_L = S0 + 7;
  const SIG_D = S0 + 8;
  const PSI = S0 + 9;
  const W0 = S0 + 10;
  ctx.knnWCol0 = W0;
  ctx.knnLayout = { k, DC, RHO, SIG, W0 };
  ctx.sigmaIters = sigmaIterations(ctx);
  const SG = sigmaLayout(ctx.sigmaIters);

  const s = ctx.sheet(SHEET.knn, [7, 30, ...Array(k * 5).fill(10), 12, 12, 11, 12, 12, 12, 12, 12, 11, 12, ...Array(k).fill(10)]);
  s.row([`UMAP — ${k} TETANGGA TERDEKAT, ρ, σ, DAN BOBOT KEANGGOTAAN (k = P_K, termasuk dirinya sendiri)`]);
  s.row([
    'j1..jk = tetangga yang dipilih pustaka (Dok #, urut jarak). d = jarak cosine dari lembar Jarak Cosine. SMALL(baris, j) − d membuktikan tetangga itu memang k terkecil. ρ = jarak bukan-nol terkecil. σ = hasil pencarian biner (lembar ' +
      SHEET.sigma +
      ') dengan batas bawah. w = exp(−(d − ρ)/σ); w = 1 bila d ≤ ρ; w = 0 untuk dirinya sendiri.',
  ]);
  const head: string[] = ['Dok #', 'Jabatan'];
  for (let j = 1; j <= k; j++) head.push(`j${j} (Dok #)`);
  for (let j = 1; j <= k; j++) head.push(`d${j} (rumus)`);
  for (let j = 1; j <= k; j++) head.push(`d${j} (pustaka, float32)`);
  for (let j = 1; j <= k; j++) head.push(`Δd${j}`);
  for (let j = 1; j <= k; j++) head.push(`SMALL(baris,${j}) − d${j}`);
  head.push('ρ (rumus)', 'ρ (pustaka)', 'Δρ', 'Rerata d (k jarak)', 'Batas bawah σ', 'σ hasil biseksi', 'σ (rumus)', 'σ (pustaka)', 'Δσ relatif', 'ψ(σ) − log₂k');
  for (let j = 1; j <= k; j++) head.push(`w${j}`);
  s.row(head);

  const cosRange = `${q(SHEET.cos)}!$B$${docRow(1)}:$${colName(N)}$${docRow(N)}`;
  const meanRow = docRow(N) + 2;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const cells: any[] = [i + 1, ctx.title(i)];
    for (let j = 0; j < k; j++) cells.push((idx[i]![j] ?? -1) + 1);
    for (let j = 0; j < k; j++) cells.push(F(`INDEX(${cosRange},$A${r},${colName(NB + j)}${r})`));
    for (let j = 0; j < k; j++) cells.push(dl[i]![j]);
    for (let j = 0; j < k; j++) cells.push(F(`${colName(DC + j)}${r}-${colName(DL + j)}${r}`));
    const cosRow = `${q(SHEET.cos)}!$B$${r}:$${colName(N)}$${r}`;
    for (let j = 0; j < k; j++) cells.push(F(`SMALL(${cosRow},${j + 1})-${colName(DC + j)}${r}`));
    const dRange = `${colName(DC)}${r}:${colName(DC + k - 1)}${r}`;
    const d2k = `${colName(DC + 1)}${r}:${colName(DC + k - 1)}${r}`;
    cells.push(
      F(`${fn('MINIFS')}(${dRange},${dRange},">0")`),
      rho[i],
      F(`${colName(RHO)}${r}-${colName(RHO_L)}${r}`),
      F(`AVERAGE(${dRange})`),
      F(`P_MINKDIST*IF(${colName(RHO)}${r}>0,${colName(MEAN)}${r},P_MEANKNN)`),
      F(`${cell(SHEET.sigma, SG.FINAL, r, false)}`),
      F(`MAX(${colName(MID)}${r},${colName(FLOOR)}${r})`),
      sig[i],
      F(`(${colName(SIG)}${r}-${colName(SIG_L)}${r})/${colName(SIG_L)}${r}`),
      F(`SUMPRODUCT(EXP(-((${d2k}-${colName(RHO)}${r})+ABS(${d2k}-${colName(RHO)}${r}))/(2*${colName(SIG)}${r})))-P_TARGET`),
    );
    for (let j = 0; j < k; j++) {
      const d = `${colName(DC + j)}${r}`;
      const nb = `${colName(NB + j)}${r}`;
      cells.push(F(`IF(${nb}=$A${r},0,IF(OR(${d}-$${colName(RHO)}${r}<=0,$${colName(SIG)}${r}=0),1,EXP(-(${d}-$${colName(RHO)}${r})/$${colName(SIG)}${r})))`));
    }
    s.row(cells);
  }
  s.blank();
  const allD = `$${colName(DC)}$${docRow(1)}:$${colName(DC + k - 1)}$${docRow(N)}`;
  const mr = s.row(['Rerata seluruh jarak kNN', '', ...Array(MEAN - 2).fill(''), F(`AVERAGE(${allD})`)]);
  if (mr !== meanRow) throw new Error('knn mean row drifted');
  ctx.name('P_MEANKNN', SHEET.knn, MEAN, meanRow);
  s.row(['Batas bawah σ memakai rerata dokumen itu sendiri bila ρ > 0, dan rerata seluruh jarak kNN bila ρ = 0 (dokumen yang semua tetangganya berjarak nol).']);

  const f = docRow(1);
  const l = docRow(N);
  ctx.check('UMAP: jarak tetangga (rumus cosine vs pustaka float32)', SHEET.knn, DD, f, DD + k - 1, l, 1e-6, 'Pustaka menghitung cosine dalam float32; selisih ~1E-8 adalah pembulatan itu.');
  ctx.check('UMAP: tetangga = k jarak terkecil (SMALL)', SHEET.knn, SM, f, SM + k - 1, l, 1e-6, 'Nol berarti tetangga yang dipilih pustaka memang k dokumen terdekat menurut matriks Jarak Cosine.');
  ctx.check('UMAP: ρ (jarak bukan-nol terdekat)', SHEET.knn, RHO_D, f, RHO_D, l, 1e-6, '');
  ctx.check('UMAP: σ (pencarian biner, relatif)', SHEET.knn, SIG_D, f, SIG_D, l, 1e-4, 'Pustaka mencari dalam float32 dan berhenti saat |ψ − log₂k| < 1E-5; workbook mencari dalam double dengan langkah yang sama. Jalurnya biasanya identik (Δ = 0); di dekat batas toleransi satu langkah bisa berbeda.');
  void sig;
}

/** The bisection of smooth_knn_dist, written out: one column group per iteration. */
export function buildSigmaSearch(ctx: BuildContext): void {
  const N = ctx.N;
  const L = ctx.knnLayout!;
  const k = L.k;
  const I = ctx.sigmaIters;
  const { LO, HI, MID, PSI } = sigmaLayout(I);
  const s = ctx.sheet(SHEET.sigma, [7, 12, 30, ...Array(I * 4 + 1).fill(11), 10, 12]);
  s.row(['PENCARIAN BINER σ (smooth_knn_dist) — satu kelompok kolom per iterasi']);
  s.row([
    `Mulai lo = 0, hi = ∞ (sel kosong), mid = 1. Tiap iterasi: ψ = Σ_{j=2..k} exp(−max(0, d_j − ρ)/mid). Bila |ψ − log₂k| < P_SMOOTHTOL: berhenti (kolom berikutnya membeku). Bila ψ > log₂k: hi = mid, mid = (lo+hi)/2; selain itu lo = mid, mid = 2·mid bila hi = ∞, atau (lo+hi)/2. Pustaka mengizinkan 64 iterasi; ${I === N_ITER ? 'semua 64 ditulis' : `ditulis ${I} — dokumen paling lambat butuh ${I - 3}, sisanya hanya mengulang nilai yang sudah beku`}. Kolom "Konvergen" membuktikan tidak ada pencarian yang terpotong.`,
  ]);
  const head: string[] = ['Dok #', 'ρ', 'Jabatan'];
  for (let n = 0; n < I; n++) head.push(`lo${n}`);
  for (let n = 0; n < I; n++) head.push(`hi${n}`);
  for (let n = 0; n <= I; n++) head.push(`mid${n}`);
  for (let n = 0; n < I; n++) head.push(`ψ${n}`);
  head.push('Iterasi', 'Konvergen');
  s.row(head);
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const rhoRef = cell(SHEET.knn, L.RHO, r);
    const d2k = `${q(SHEET.knn)}!$${colName(L.DC + 1)}$${r}:$${colName(L.DC + k - 1)}$${r}`;
    const psiOf = (mid: string) => `SUMPRODUCT(EXP(-((${d2k}-$B${r})+ABS(${d2k}-$B${r}))/(2*${mid})))`;
    const cells: any[] = [i + 1, F(rhoRef), ctx.title(i)];
    const lo = (n: number) => `${colName(LO + n)}${r}`;
    const hi = (n: number) => `${colName(HI + n)}${r}`;
    const mid = (n: number) => `${colName(MID + n)}${r}`;
    const psi = (n: number) => `${colName(PSI + n)}${r}`;
    const done = (n: number) => `ABS(${psi(n)}-P_TARGET)<P_SMOOTHTOL`;
    for (let n = 0; n < I; n++) {
      cells.push(n === 0 ? 0 : F(`IF(${done(n - 1)},${lo(n - 1)},IF(${psi(n - 1)}>P_TARGET,${lo(n - 1)},${mid(n - 1)}))`));
    }
    for (let n = 0; n < I; n++) {
      cells.push(n === 0 ? FS('""') : FS(`IF(${done(n - 1)},${hi(n - 1)},IF(${psi(n - 1)}>P_TARGET,${mid(n - 1)},${hi(n - 1)}))`));
    }
    for (let n = 0; n <= I; n++) {
      cells.push(
        n === 0
          ? 1
          : F(
              `IF(${done(n - 1)},${mid(n - 1)},IF(${psi(n - 1)}>P_TARGET,(${lo(n - 1)}+${mid(n - 1)})/2,IF(${hi(n - 1)}="",${mid(n - 1)}*2,(${mid(n - 1)}+${hi(n - 1)})/2)))`,
            ),
      );
    }
    for (let n = 0; n < I; n++) {
      cells.push(n === 0 ? F(psiOf(mid(0))) : F(`IF(${done(n - 1)},${psi(n - 1)},${psiOf(mid(n))})`));
    }
    const psiBlock = `${colName(PSI)}${r}:${colName(PSI + I - 1)}${r}`;
    cells.push(
      F(`MIN(P_NITER,SUMPRODUCT(--(ABS(${psiBlock}-P_TARGET)>=P_SMOOTHTOL))+1)`),
      // Not converged inside the written columns is a finding only when columns
      // were cut short of the library's 64; at 64 the library stops there too.
      F(`IF(${done(I - 1)},0,IF(${I}<P_NITER,"BEDA",0))`),
    );
    s.row(cells);
  }
  ctx.check('UMAP: pencarian σ selesai dalam kolom yang ditulis', SHEET.sigma, sigmaLayout(I).CONV, docRow(1), sigmaLayout(I).CONV, docRow(N), 0, '');
}

export function buildGraph(ctx: BuildContext): void {
  const t = ctx.t;
  const N = ctx.N;
  const L = ctx.knnLayout!;
  const k = L.k;
  const idx = t.umap.knnIndices;
  const full = t.umap.graph;
  const kept = t.umap.graphKept;
  const s = ctx.sheet(SHEET.graph, [7, 7, 11, 11, 12, 12, 11, 11, 11, 11, 11, 12, 12, 12, 12, 12]);
  s.row(['UMAP — GRAF FUZZY: gabungan keanggotaan dua arah, lalu pemangkasan sebelum optimasi tata letak']);
  s.row([
    'Satu baris per pasangan dokumen (i < j) yang saling atau salah satunya bertetangga. P = r·(w_ij + w_ji − w_ij·w_ji) + (1 − r)·w_ij·w_ji, r = P_SETOP. Tepi dengan P < maks(P)/n_epochs dibuang. Kolom kanan: jarak di ruang hasil, q = 1/(1 + a·d^(2b)), dan suku cross-entropy yang diminimalkan optimasi.',
  ]);
  s.row(['Dok i', 'Dok j', 'w_ij (rumus)', 'w_ji (rumus)', 'P (rumus)', 'P (pustaka, graf penuh)', 'ΔP', 'Dipertahankan (rumus)', 'Dipertahankan (pustaka)', 'Selisih keputusan', 'P sesudah pangkas (pustaka)', 'epochs_per_sample', 'd ruang hasil', 'q = 1/(1+a·d^(2b))', 'Cross-entropy', '']);

  // Every unordered kNN pair, plus anything the recorded graph holds.
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const pairs = new Map<string, [number, number]>();
  for (let i = 0; i < N; i++) for (const j of idx[i] ?? []) if (j !== i && j >= 0) pairs.set(key(i, j), i < j ? [i, j] : [j, i]);
  const fullVal = new Map<string, number>();
  if (full) {
    const v = ctx.flat(full.vals);
    full.rows.forEach((a, n) => {
      fullVal.set(key(a, full.cols[n]!), v[n]!);
      pairs.set(key(a, full.cols[n]!), [Math.min(a, full.cols[n]!), Math.max(a, full.cols[n]!)]);
    });
  }
  const keptVal = new Map<string, number>();
  if (kept) {
    const v = ctx.flat(kept.vals);
    kept.rows.forEach((a, n) => keptVal.set(key(a, kept.cols[n]!), v[n]!));
  }
  const list = Array.from(pairs.values()).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const wRef = (i: number, j: number): string | number => {
    const pos = (idx[i] ?? []).indexOf(j);
    return pos < 0 ? 0 : `${cell(SHEET.knn, L.W0 + pos, docRow(i + 1))}`;
  };
  const first = s.next;
  const last = first + list.length - 1;
  const sumRow = last + 2;
  const coord = (i: number) => rowRange(SHEET.layout, 2, ctx.t.umap.params.nComponents, docRow(i + 1));
  for (const [i, j] of list) {
    const r = s.next;
    const a = wRef(i, j);
    const b = wRef(j, i);
    const kv = keptVal.get(key(i, j));
    const fv = fullVal.get(key(i, j));
    s.row([
      i + 1,
      j + 1,
      typeof a === 'number' ? a : F(a),
      typeof b === 'number' ? b : F(b),
      F(`P_SETOP*(C${r}+D${r}-C${r}*D${r})+(1-P_SETOP)*C${r}*D${r}`),
      fv ?? (full ? 0 : null),
      full ? F(`E${r}-F${r}`) : null,
      FB(`AND(E${r}>0,E${r}>=P_GTHR)`),
      kept ? kv !== undefined && kv > 0 : null,
      kept ? F(`IF(H${r}=I${r},0,IF(ABS(E${r}-P_GTHR)<=1E-6,0,"BEDA"))`) : null,
      kv !== undefined && kv > 0 ? kv : null,
      F(`IF(H${r},P_GMAX/E${r},"")`),
      F(`SQRT(SUMXMY2(${coord(i)},${coord(j)}))`),
      F(`1/(1+P_A*M${r}^(2*P_B))`),
      F(`IF(H${r},-(E${r}*LN(MAX(N${r},1E-300))+(1-E${r})*LN(MAX(1-N${r},1E-300))),"")`),
    ]);
  }
  s.blank();
  const gm = s.row(['Maks P (rumus)', '', '', '', F(`MAX(E${first}:E${last})`), full ? full.max : null, full ? F(`E${sumRow}-F${sumRow}`) : null]);
  ctx.name('P_GMAX', SHEET.graph, 4, gm);
  const gt = s.row(['Ambang pangkas = maks P / n_epochs', '', '', '', F(`P_GMAX/P_NEPOCHS`)]);
  ctx.name('P_GTHR', SHEET.graph, 4, gt);
  s.row(['Tepi dipertahankan', '', '', '', F(`COUNTIF(H${first}:H${last},TRUE)`), kept ? ctx.flat(kept.vals).filter((v) => v > 0).length : null]);
  s.row(['Σ cross-entropy tepi dipertahankan (fungsi objektif yang diturunkan SGD)', '', '', '', F(`SUM(O${first}:O${last})`)]);
  s.row([`Optimasi tata letak (SGD, ${t.umap.params.nEpochsUsed ?? '?'} epoch, learning_rate ${t.umap.params.learningRate}, ${t.umap.params.negativeSampleRate} sampel negatif) adalah proses stokastik berbenih — tidak dapat ditulis sebagai rumus sel; koordinat hasilnya ada di lembar ${SHEET.layout}, dan kolom q / cross-entropy di atas menunjukkan seberapa baik koordinat itu memenuhi graf.`]);
  if (full) ctx.check('UMAP: graf fuzzy P (gabungan dua arah)', SHEET.graph, 6, first, 6, last, 1e-5, 'Bobot keanggotaan pustaka disimpan float32.');
  if (kept) ctx.check('UMAP: tepi yang dipertahankan (pemangkasan maks/n_epochs)', SHEET.graph, 9, first, 9, last, 0, 'Keputusan yang tepat di garis ambang (±1E-6) tidak dihitung sebagai selisih.');
  void k;
}

export function buildCurve(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.curve, [8, 14, 14, 14, 14, 14, 16, 16]);
  s.row(['UMAP — PARAMETER KURVA a, b: kuadrat terkecil φ(x) = 1/(1 + a·x^(2b)) terhadap ψ(x)']);
  s.row(['ψ(x) = 1 bila x < min_dist, selain itu exp(−(x − min_dist)/spread), pada 300 titik x = 0 … 3·spread. a dan b adalah hasil curve_fit (Levenberg–Marquardt). Di titik optimum, turunan SSE terhadap a dan b ≈ 0 — itulah yang diperiksa di bawah.']);
  s.row(['#', 'x', 'ψ(x)', 'φ(x)', 'r = φ − ψ', 'r²', '∂φ/∂a', '∂φ/∂b']);
  const first = s.next;
  for (let n = 0; n < 300; n++) {
    const r = s.next;
    s.row([
      n,
      F(`A${r}*(3*P_SPREAD)/299`),
      F(`IF(B${r}<P_MINDIST,1,EXP(-(B${r}-P_MINDIST)/P_SPREAD))`),
      F(`1/(1+P_A*B${r}^(2*P_B))`),
      F(`D${r}-C${r}`),
      F(`E${r}^2`),
      F(`-(B${r}^(2*P_B))/(1+P_A*B${r}^(2*P_B))^2`),
      F(`IF(B${r}=0,0,-2*P_A*B${r}^(2*P_B)*LN(B${r})/(1+P_A*B${r}^(2*P_B))^2)`),
    ]);
  }
  const last = s.next - 1;
  s.blank();
  s.row(['SSE', '', '', '', '', F(`SUM(F${first}:F${last})`)]);
  const ga = s.row(['∂SSE/∂a', '', '', '', '', F(`2*SUMPRODUCT(E${first}:E${last},G${first}:G${last})`)]);
  const gb = s.row(['∂SSE/∂b', '', '', '', '', F(`2*SUMPRODUCT(E${first}:E${last},H${first}:H${last})`)]);
  s.row(['Nilai a, b yang dipakai ada di lembar Parameter (P_A, P_B). Ubah salah satunya: SSE naik — tanda bahwa nilai tercatat adalah minimum kuadrat terkecil.']);
  ctx.check('UMAP: a, b meminimalkan SSE kurva (gradien ≈ 0)', SHEET.curve, 5, ga, 5, gb, 1e-5, 'curve_fit berhenti pada toleransi relatif ~1,5E-8; gradien sisa sekecil itu.');
}

export function buildLayout(ctx: BuildContext): void {
  const t = ctx.t;
  const d = t.umap.params.nComponents;
  const emb = ctx.matrix(t.umap.embedding);
  ctx.coordCol0 = 2;
  const s = ctx.sheet(SHEET.layout, [7, 30, ...Array(d).fill(14)]);
  s.row([`UMAP — KOORDINAT ${d}-D HASIL OPTIMASI (masukan HDBSCAN)`]);
  s.row([`Hasil optimasi SGD berbenih (random_state = ${t.umap.params.randomState ?? '—'}) atas graf di lembar ${SHEET.graph}, mulai dari inisialisasi ${t.umap.params.init}. Ini MASUKAN (float32 dari pustaka), bukan rumus: optimasi stokastik tidak dapat ditulis sebagai rumus sel.`]);
  s.row(['Dok #', 'Jabatan', ...Array.from({ length: d }, (_, c) => `y${c + 1}`)]);
  for (let i = 0; i < ctx.N; i++) s.row([i + 1, ctx.title(i), ...(emb[i] ?? [])]);
}
