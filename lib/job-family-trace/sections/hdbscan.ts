// Stage 3: HDBSCAN on the UMAP coordinates. Euclidean distances → core
// distances → mutual-reachability spanning tree → single-linkage tree (the
// union-find written out step by step) → condensed tree → stability → EOM
// selection → labels and hard probabilities → soft membership vectors.
//
// Ids follow the library: points 0..N−1, single-linkage nodes N..2N−2, condensed
// clusters N (root), N+1, … Dok # = point id + 1.

import { BuildContext, SHEET, cell, docRow, rowRange } from '../context';
import { F, FS, colName, fn, q } from '../../run-trace/sheet';

/** Big-but-finite stand-in for an infinite lambda (a zero merge distance). */
const LAMBDA_INF = 1e300;

const lam = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? LAMBDA_INF : v);

/** Excel formula rounding x to float32 (24 significant bits) — `cdef float` in the library. */
const f32 = (x: string) =>
  `IF(${x}=0,0,ROUND(${x}/2^(INT(LOG(ABS(${x}),2))-23),0)*2^(INT(LOG(ABS(${x}),2))-23))`;

export function buildEuclid(ctx: BuildContext): void {
  const N = ctx.N;
  const d = ctx.t.umap.params.nComponents;
  const s = ctx.sheet(SHEET.euclid, [7, ...Array(Math.min(N, 60)).fill(10)]);
  s.row(['JARAK EUCLID DI RUANG HASIL UMAP — d_ij = √Σ (y_ik − y_jk)²']);
  s.row([`Dihitung dari lembar ${SHEET.layout} (${d} dimensi). Dihitung sekali per pasangan (segitiga atas) lalu dicerminkan.`]);
  s.row(['Dok #', ...Array.from({ length: N }, (_, j) => `Dok ${j + 1}`)]);
  for (let i = 1; i <= N; i++) {
    const r = docRow(i);
    const cells: any[] = [i];
    for (let j = 1; j <= N; j++) {
      if (j === i) cells.push(0);
      else if (j > i) cells.push(F(`SQRT(SUMXMY2(${rowRange(SHEET.layout, 2, d, docRow(i))},${rowRange(SHEET.layout, 2, d, docRow(j))}))`));
      else cells.push(F(`${colName(i)}${docRow(j)}`));
    }
    s.row(cells);
  }
}

const euclidRange = (N: number) => `${q(SHEET.euclid)}!$B$${docRow(1)}:$${colName(N)}$${docRow(N)}`;

export function buildCore(ctx: BuildContext): void {
  const N = ctx.N;
  const core = ctx.flat(ctx.t.hdbscan.core);
  ctx.coreCol = 3;
  const s = ctx.sheet(SHEET.core, [7, 8, 30, 16, 16, 12]);
  s.row(['HDBSCAN — JARAK INTI (core distance)']);
  s.row(['Jarak inti titik = jarak ke tetangga ke-(min_samples + 1) TERMASUK dirinya sendiri (jarak 0), yaitu tetangga lain ke-min_samples: SMALL(baris Jarak Euclid, P_MS + 1).']);
  s.row(['Dok #', 'Id titik', 'Jabatan', 'Jarak inti (rumus)', 'Jarak inti (pustaka)', 'Selisih']);
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    s.row([
      i + 1,
      i,
      ctx.title(i),
      F(`SMALL(${q(SHEET.euclid)}!$B$${r}:$${colName(N)}$${r},P_MS+1)`),
      core[i],
      F(`D${r}-E${r}`),
    ]);
  }
  ctx.check('HDBSCAN: jarak inti', SHEET.core, 5, docRow(1), 5, docRow(N), 1e-12, '');
}

const MST_HEAD = 3;

export function buildMst(ctx: BuildContext): void {
  const N = ctx.N;
  const m = ctx.t.hdbscan.mst!;
  const w = ctx.flat(m.w);
  const s = ctx.sheet(SHEET.mst, [7, 9, 9, 14, 14, 14, 16, 16, 12, 10]);
  s.row(['HDBSCAN — POHON RENTANG MINIMUM atas jarak keterjangkauan timbal balik (mutual reachability)']);
  s.row([
    'mrd(a, b) = max(inti_a, inti_b, d_ab / alpha). Tepi pohon dibangun pustaka (Borůvka KD-tree; dengan approx_min_span_tree pohonnya boleh hampiran) lalu DIURUTKAN menurut bobot — urutan itulah yang dibaca tahap single linkage. Pasangan tepi adalah MASUKAN; bobotnya rumus.',
  ]);
  s.row(['Langkah t', 'Titik a (id)', 'Titik b (id)', 'd_ab (rumus)', 'Inti a', 'Inti b', 'mrd (rumus)', 'Bobot (pustaka)', 'Selisih', 'Terurut?']);
  const coreRange = `${q(SHEET.core)}!$D$${docRow(1)}:$D$${docRow(N)}`;
  for (let t = 1; t <= N - 1; t++) {
    const r = MST_HEAD + t;
    s.row([
      t,
      m.a[t - 1]!,
      m.b[t - 1]!,
      F(`INDEX(${euclidRange(N)},B${r}+1,C${r}+1)`),
      F(`INDEX(${coreRange},B${r}+1)`),
      F(`INDEX(${coreRange},C${r}+1)`),
      F(`MAX(E${r},F${r},D${r}/P_ALPHA)`),
      w[t - 1]!,
      F(`G${r}-H${r}`),
      t === 1 ? 0 : F(`IF(H${r}>=H${r - 1},0,"BEDA")`),
    ]);
  }
  ctx.check('HDBSCAN: bobot pohon rentang = mrd', SHEET.mst, 8, MST_HEAD + 1, 8, MST_HEAD + N - 1, 1e-12, '');
  ctx.check('HDBSCAN: tepi pohon terurut menurut bobot', SHEET.mst, 9, MST_HEAD + 1, 9, MST_HEAD + N - 1, 0, '');
}

/** Rows of the union-find sheet. */
const UF = { step: 3, a: 4, b: 5, ra: 6, rb: 7, node: 8, size: 9, dist: 10, pt0: 13 };

export function buildUnionFind(ctx: BuildContext): void {
  const N = ctx.N;
  const s = ctx.sheet(SHEET.uf, [26, 8, ...Array(Math.min(N, 80)).fill(8)]);
  s.row(['HDBSCAN — UNION-FIND: dari pohon rentang ke pohon single linkage']);
  s.row([
    'Kolom = langkah t (tepi ke-t pohon rentang, urut bobot). Baris titik = id kelompok tempat titik itu berada SESUDAH langkah t. Akar a/b = kelompok titik a/b sebelum langkah; keduanya digabung menjadi simpul baru N + t − 1; ukuran = banyak titik yang kini berlabel simpul itu.',
  ]);
  const pts = (t: number) => `${colName(1 + t)}$${UF.pt0}:${colName(1 + t)}$${UF.pt0 + N - 1}`;
  const row = (label: string, f: (t: number) => any, step0: any = '') => {
    const cells: any[] = [label, step0];
    for (let t = 1; t <= N - 1; t++) cells.push(f(t));
    s.row(cells);
  };
  const mstA = `${q(SHEET.mst)}!$B$${MST_HEAD + 1}:$B$${MST_HEAD + N - 1}`;
  const mstB = `${q(SHEET.mst)}!$C$${MST_HEAD + 1}:$C$${MST_HEAD + N - 1}`;
  const mstW = `${q(SHEET.mst)}!$G$${MST_HEAD + 1}:$G$${MST_HEAD + N - 1}`;
  row('Langkah t', (t) => t, 0);
  row('Titik a', (t) => F(`INDEX(${mstA},${colName(1 + t)}$${UF.step})`));
  row('Titik b', (t) => F(`INDEX(${mstB},${colName(1 + t)}$${UF.step})`));
  row('Akar a (kelompok a sebelum langkah)', (t) => F(`INDEX(${pts(t - 1)},${colName(1 + t)}$${UF.a}+1)`));
  row('Akar b', (t) => F(`INDEX(${pts(t - 1)},${colName(1 + t)}$${UF.b}+1)`));
  row('Simpul baru = N + t − 1', (t) => F(`P_N+${colName(1 + t)}$${UF.step}-1`));
  row('Ukuran simpul baru', (t) => F(`COUNTIF(${pts(t)},${colName(1 + t)}$${UF.node})`));
  row('Jarak gabung (mrd)', (t) => F(`INDEX(${mstW},${colName(1 + t)}$${UF.step})`));
  s.blank();
  s.row(['Titik (id)', 'Awal', ...Array.from({ length: N - 1 }, (_, t) => `t=${t + 1}`)]);
  if (s.next !== UF.pt0) throw new Error('union-find point rows drifted');
  for (let p = 0; p < N; p++) {
    const r = UF.pt0 + p;
    const cells: any[] = [p, p];
    for (let t = 1; t <= N - 1; t++) {
      const prev = `${colName(t)}${r}`;
      const c = colName(1 + t);
      cells.push(F(`IF(OR(${prev}=${c}$${UF.ra},${prev}=${c}$${UF.rb}),${c}$${UF.node},${prev})`));
    }
    s.row(cells);
  }
}

/** Single-linkage sheet columns. */
const SL = {
  t: 0, node: 1, left: 2, right: 3, dist: 4, size: 5, leftL: 6, rightL: 7, distL: 8, sizeL: 9,
  dChild: 10, dDist: 11, dSize: 12, lambda: 13, parent: 14, isRight: 15, sizeLeft: 16, sizeRight: 17,
  depth: 18, key: 19, bfs: 20, processed: 21, split: 22, splitRank: 23, relabel: 24, birth: 25, fallNode: 26,
} as const;
const SL_HEAD = 3;

export function buildSingleLinkage(ctx: BuildContext): void {
  const N = ctx.N;
  const h = ctx.t.hdbscan;
  const sl = h.singleLinkage;
  const sd = ctx.flat(sl.dist);
  const hasMst = Boolean(h.mst);

  // condense_tree() walks the single-linkage tree breadth-first from the root
  // (bfs_from_hierarchy: level by level, left child before right) and numbers
  // the clusters of each true split in that order. The traversal itself is an
  // ordering, not a cell formula, so it is written as an input — and the column
  // "Cek urutan BFS" proves it IS breadth-first: consecutive positions must
  // increase in (depth, position of the parent, right-before-left).
  const bfs = new Map<number, number>();
  {
    let level = [2 * (N - 1)];
    let pos = 0;
    while (level.length) {
      const next: number[] = [];
      for (const node of level) {
        if (node < N) continue;
        bfs.set(node, ++pos);
        const k = node - N;
        next.push(sl.left[k]!, sl.right[k]!);
      }
      level = next;
    }
  }

  const s = ctx.sheet(SHEET.sl, [6, 8, 9, 9, 13, 8, 9, 9, 13, 8, 8, 10, 8, 12, 9, 7, 9, 9, 9, 10, 10, 9, 9, 9, 11, 11, 11]);
  s.row(['HDBSCAN — POHON SINGLE LINKAGE dan KONDENSASINYA']);
  s.row([
    'Kiri/kanan/jarak/ukuran dari lembar Union-Find. λ = 1/jarak. Kondensasi (min_cluster_size = P_MCS): simpul berukuran ≥ P_MCS DIPROSES; pecah sejati bila kedua anaknya ≥ P_MCS → dua klaster baru, dinomori menurut urutan penelusuran melebar (BFS) dari akar, kiri dulu; bila hanya satu anak ≥ P_MCS, anak itu meneruskan label induknya dan titik di anak kecil "jatuh" pada λ simpul itu. Kolom yang bergantung pada induk hanya merujuk baris di BAWAHNYA (induk selalu digabung belakangan), sehingga tidak ada rujukan melingkar.',
  ]);
  s.row([
    't', 'Simpul (id)', 'Kiri (rumus)', 'Kanan (rumus)', 'Jarak (rumus)', 'Ukuran (rumus)',
    'Kiri (pustaka)', 'Kanan (pustaka)', 'Jarak (pustaka)', 'Ukuran (pustaka)', 'Selisih anak', 'Selisih jarak', 'Selisih ukuran',
    'λ = 1/jarak', 'Langkah induk', 'Anak kanan?', 'Ukuran anak kiri', 'Ukuran anak kanan', 'Kedalaman', 'Cek urutan BFS', 'Urutan BFS (penelusuran)',
    'Diproses (ukuran ≥ mcs)', 'Pecah sejati', 'Urutan pecah', 'Label klaster', 'Klaster lahir di sini', 'Simpul jatuh (leluhur terdalam ≥ mcs)',
  ]);
  const first = SL_HEAD + 1;
  const last = SL_HEAD + N - 1;
  const col = (c: number) => `$${colName(c)}$${first}:$${colName(c)}$${last}`;
  for (let t = 1; t <= N - 1; t++) {
    const r = SL_HEAD + t;
    const c = (k: number) => `${colName(k)}${r}`;
    const isRoot = t === N - 1;
    // Rows strictly below this one (the parent is always below): INDEX(below, parentStep − t).
    const below = (k: number) => `INDEX($${colName(k)}$${r + 1}:$${colName(k)}$${last},${c(SL.parent)}-${t})`;
    const ufc = colName(1 + t);
    const ufRef = (row: number) => `${q(SHEET.uf)}!$${ufc}$${row}`;
    const parentBfs = (rowIdx: string) => `IF(INDEX(${col(SL.parent)},${rowIdx})="",0,INDEX(${col(SL.bfs)},INDEX(${col(SL.parent)},${rowIdx})))`;
    const prevIdx = `MATCH(${c(SL.bfs)}-1,${col(SL.bfs)},0)`;
    s.row([
      t,
      F(`P_N+A${r}-1`),
      hasMst ? F(ufRef(UF.ra)) : sl.left[t - 1]!,
      hasMst ? F(ufRef(UF.rb)) : sl.right[t - 1]!,
      hasMst ? F(ufRef(UF.dist)) : sd[t - 1]!,
      hasMst ? F(ufRef(UF.size)) : sl.size[t - 1]!,
      sl.left[t - 1]!,
      sl.right[t - 1]!,
      sd[t - 1]!,
      sl.size[t - 1]!,
      F(`IF(AND(${c(SL.left)}=${c(SL.leftL)},${c(SL.right)}=${c(SL.rightL)}),0,"BEDA")`),
      F(`${c(SL.dist)}-${c(SL.distL)}`),
      F(`${c(SL.size)}-${c(SL.sizeL)}`),
      F(`IF(${c(SL.dist)}>0,1/${c(SL.dist)},${LAMBDA_INF})`),
      isRoot ? '' : F(`IFERROR(MATCH(${c(SL.node)},${col(SL.left)},0),IFERROR(MATCH(${c(SL.node)},${col(SL.right)},0),""))`),
      isRoot ? 0 : F(`IF(INDEX(${col(SL.right)},${c(SL.parent)})=${c(SL.node)},1,0)`),
      t === 1 ? 1 : F(`IF(${c(SL.left)}>=P_N,INDEX($${colName(SL.size)}$${first}:$${colName(SL.size)}$${r - 1},${c(SL.left)}-P_N+1),1)`),
      t === 1 ? 1 : F(`IF(${c(SL.right)}>=P_N,INDEX($${colName(SL.size)}$${first}:$${colName(SL.size)}$${r - 1},${c(SL.right)}-P_N+1),1)`),
      isRoot ? 0 : F(`${below(SL.depth)}+1`),
      F(
        `IF(${c(SL.bfs)}=1,IF(${c(SL.parent)}="",0,"BEDA"),IF(OR(INDEX(${col(SL.depth)},${prevIdx})<${c(SL.depth)},AND(INDEX(${col(SL.depth)},${prevIdx})=${c(SL.depth)},OR(${parentBfs(prevIdx)}<${parentBfs(String(t))},AND(${parentBfs(prevIdx)}=${parentBfs(String(t))},INDEX(${col(SL.isRight)},${prevIdx})<${c(SL.isRight)})))),0,"BEDA"))`,
      ),
      bfs.get(N + t - 1) ?? null,
      F(`IF(${c(SL.size)}>=P_MCS,1,0)`),
      F(`IF(AND(${c(SL.processed)}=1,${c(SL.sizeLeft)}>=P_MCS,${c(SL.sizeRight)}>=P_MCS),1,0)`),
      F(`IF(${c(SL.split)}=1,1+COUNTIFS(${col(SL.split)},1,${col(SL.bfs)},"<"&${c(SL.bfs)}),"")`),
      isRoot
        ? F('P_N')
        : F(`IF(${below(SL.split)}=1,P_N+2*(${below(SL.splitRank)}-1)+IF(${c(SL.isRight)}=1,2,1),IF(${c(SL.processed)}=1,${below(SL.relabel)},""))`),
      isRoot ? '' : F(`IF(${below(SL.split)}=1,${c(SL.relabel)},"")`),
      isRoot ? F(c(SL.node)) : F(`IF(${c(SL.processed)}=1,${c(SL.node)},${below(SL.fallNode)})`),
    ]);
  }
  ctx.slRows = { first, last };
  ctx.check('HDBSCAN: urutan penelusuran BFS valid (kondensasi)', SHEET.sl, SL.key, first, SL.key, last, 0, 'Posisi BFS adalah urutan penelusuran (masukan); kolom ini membuktikan urutannya melebar: kedalaman, lalu posisi induk, lalu kiri sebelum kanan.');
  if (hasMst) {
    ctx.check('HDBSCAN: single linkage — pasangan anak', SHEET.sl, SL.dChild, first, SL.dChild, last, 0, '');
    ctx.check('HDBSCAN: single linkage — jarak', SHEET.sl, SL.dDist, first, SL.dDist, last, 1e-12, '');
    ctx.check('HDBSCAN: single linkage — ukuran', SHEET.sl, SL.dSize, first, SL.dSize, last, 0, '');
  } else {
    ctx.gaps.push('Pohon rentang minimum tidak tercatat: pohon single linkage dibaca dari pustaka (masukan), bukan diturunkan dengan union-find.');
  }
}

const slCol = (ctx: BuildContext, c: number) => `${q(SHEET.sl)}!$${colName(c)}$${ctx.slRows!.first}:$${colName(c)}$${ctx.slRows!.last}`;

/** Per point: where it falls out of the condensed tree. */
export function buildPoints(ctx: BuildContext): void {
  const N = ctx.N;
  const ct = ctx.t.hdbscan.condensed;
  const byChild = new Map<number, { parent: number; lambda: number }>();
  ct.child.forEach((c, n) => {
    if (ct.size[n] === 1 && c < N) byChild.set(c, { parent: ct.parent[n]!, lambda: lam(ct.lambda[n]) });
  });
  ctx.ptClusterCol = 7;
  ctx.ptLambdaCol = 6;
  const s = ctx.sheet(SHEET.points, [7, 8, 30, 12, 12, 12, 16, 12, 12, 16, 10, 12]);
  s.row(['HDBSCAN — TITIK DI POHON TERKONDENSASI: di klaster mana tiap titik "jatuh", dan pada λ berapa']);
  s.row(['Titik jatuh di leluhur terdalamnya yang berukuran ≥ P_MCS (kolom terakhir lembar Single Linkage), pada λ simpul itu; klaster induknya adalah label klaster simpul itu.']);
  s.row(['Dok #', 'Id titik', 'Jabatan', 'Langkah gabung pertama', 'Simpul jatuh', 'Langkah simpul jatuh', 'λ jatuh (rumus)', 'Klaster induk (rumus)', 'Klaster induk (pustaka)', 'λ (pustaka)', 'Selisih klaster', 'Selisih λ']);
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const rec = byChild.get(i);
    s.row([
      i + 1,
      i,
      ctx.title(i),
      F(`IFERROR(MATCH(B${r},${slCol(ctx, SL.left)},0),MATCH(B${r},${slCol(ctx, SL.right)},0))`),
      F(`INDEX(${slCol(ctx, SL.fallNode)},D${r})`),
      F(`E${r}-P_N+1`),
      F(`INDEX(${slCol(ctx, SL.lambda)},F${r})`),
      F(`INDEX(${slCol(ctx, SL.relabel)},F${r})`),
      rec?.parent ?? null,
      rec?.lambda ?? null,
      F(`IF(H${r}=I${r},0,"BEDA")`),
      F(`(G${r}-J${r})/MAX(1,ABS(J${r}))`),
    ]);
  }
  ctx.check('HDBSCAN: klaster jatuh tiap titik', SHEET.points, 10, docRow(1), 10, docRow(N), 0, '');
  ctx.check('HDBSCAN: λ jatuh tiap titik (relatif)', SHEET.points, 11, docRow(1), 11, docRow(N), 1e-12, '');
}

const CL_HEAD = 3;

/** Cluster rows of the condensed tree. */
export function buildClusters(ctx: BuildContext): void {
  const ct = ctx.t.hdbscan.condensed;
  const rows: { child: number; parent: number; lambda: number; size: number }[] = [];
  ct.child.forEach((c, n) => {
    if ((ct.size[n] ?? 0) > 1) rows.push({ child: c, parent: ct.parent[n]!, lambda: lam(ct.lambda[n]), size: ct.size[n]! });
  });
  rows.sort((a, b) => a.child - b.child);
  ctx.clusterIds = rows.map((r) => r.child);
  const s = ctx.sheet(SHEET.clusters, [9, 9, 9, 11, 14, 9, 11, 14, 9, 9, 12, 9, 14]);
  s.row(['HDBSCAN — KLASTER DI POHON TERKONDENSASI']);
  s.row(['Setiap pecah sejati melahirkan dua klaster. Induk = label klaster simpul pecah itu; λ lahir = λ simpul pecah; ukuran = ukuran simpul anak.']);
  s.row(['Klaster', 'Langkah lahir', 'Simpul', 'Induk (rumus)', 'λ lahir (rumus)', 'Ukuran (rumus)', 'Induk (pustaka)', 'λ (pustaka)', 'Ukuran (pustaka)', 'Selisih induk', 'Selisih λ', 'Selisih ukuran', 'λ × ukuran']);
  const first = CL_HEAD + 1;
  rows.forEach((rec, n) => {
    const r = first + n;
    s.row([
      rec.child,
      F(`MATCH(A${r},${slCol(ctx, SL.birth)},0)`),
      F(`P_N+B${r}-1`),
      F(`INDEX(${slCol(ctx, SL.relabel)},INDEX(${slCol(ctx, SL.parent)},B${r}))`),
      F(`INDEX(${slCol(ctx, SL.lambda)},INDEX(${slCol(ctx, SL.parent)},B${r}))`),
      F(`INDEX(${slCol(ctx, SL.size)},B${r})`),
      rec.parent,
      rec.lambda,
      rec.size,
      F(`IF(D${r}=G${r},0,"BEDA")`),
      F(`(E${r}-H${r})/MAX(1,ABS(H${r}))`),
      F(`F${r}-I${r}`),
      F(`E${r}*F${r}`),
    ]);
  });
  const last = first + rows.length - 1;
  ctx.clRows = { first, last: Math.max(first, last) };
  s.blank();
  const cr = s.row(['Jumlah klaster (rumus) = 2 × Σ pecah sejati', '', '', '', '', '', '', '', '', F(`2*SUM(${slCol(ctx, SL.split)})-${rows.length}`)]);
  s.row(['', '', '', '', '', '', '', '', '', '↑ selisih terhadap jumlah klaster yang dicatat pustaka (' + rows.length + ')']);
  if (rows.length) {
    ctx.check('HDBSCAN: klaster terkondensasi — induk', SHEET.clusters, 9, first, 9, last, 0, '');
    ctx.check('HDBSCAN: klaster terkondensasi — λ lahir (relatif)', SHEET.clusters, 10, first, 10, last, 1e-12, '');
    ctx.check('HDBSCAN: klaster terkondensasi — ukuran', SHEET.clusters, 11, first, 11, last, 0, '');
  }
  ctx.check('HDBSCAN: jumlah klaster terkondensasi', SHEET.clusters, 9, cr, 9, cr, 0, '');
}

const clCol = (ctx: BuildContext, c: number) => `${q(SHEET.clusters)}!$${colName(c)}$${ctx.clRows!.first}:$${colName(c)}$${ctx.clRows!.last}`;
const ptCol = (ctx: BuildContext, c: number) => `${q(SHEET.points)}!$${colName(c)}$${docRow(1)}:$${colName(c)}$${docRow(ctx.N)}`;

/** Selection sheet columns. */
const SE = {
  id: 0, parent: 1, birth: 2, stab: 3, stabL: 4, dStab: 5, childSum: 6, childSum32: 7, keep: 8, best: 9, leaf: 10, ancKeep: 11,
  base: 12, eps: 13, up: 14, target: 15, sel: 16, selL: 17, dSel: 18, label: 19, death: 20, selCluster: 21, depth: 22,
} as const;
const SE_HEAD = 3;

export function buildSelection(ctx: BuildContext): void {
  const N = ctx.N;
  const h = ctx.t.hdbscan;
  const ids = [N, ...ctx.clusterIds];
  const selectedSet = new Set(h.selected);
  const s = ctx.sheet(SHEET.select, [9, 9, 12, 14, 14, 11, 14, 14, 9, 14, 7, 9, 9, 11, 9, 9, 9, 9, 9, 7, 12, 11, 9]);
  s.row(['HDBSCAN — STABILITAS DAN SELEKSI KLASTER (Excess of Mass)']);
  s.row([
    'Stabilitas(C) = Σ_baris anak (λ_baris − λ_lahir(C)) × ukuran_baris, atas semua baris yang induknya C (titik jatuh dan klaster anak). EOM: dari id terbesar ke terkecil, bila Σ stabilitas-terbaik anak (dibulatkan ke float32, variabel C `float` pustaka) > stabilitas sendiri, klaster dilepas dan nilainya diganti jumlah itu; selain itu klaster dipertahankan dan seluruh keturunannya dilepas. Akar tidak pernah dipilih (allow_single_cluster = FALSE).',
  ]);
  s.row([
    'Klaster', 'Induk', 'λ lahir', 'Stabilitas (rumus)', 'Stabilitas (pustaka)', 'Selisih (relatif)', 'Σ terbaik anak', 'Σ anak (float32)', 'Dipertahankan sendiri',
    'Stabilitas terbaik', 'Daun?', 'Ada leluhur dipertahankan', 'Terpilih dasar (EOM/leaf)', 'ε lahir = 1/λ', 'Naik-ε', 'Target-ε',
    'Terpilih (rumus)', 'Terpilih (pustaka)', 'Selisih', 'Label', 'λ maks baris langsung', 'Klaster terpilih pemuat', 'Kedalaman',
  ]);
  const first = SE_HEAD + 1;
  const last = SE_HEAD + ids.length;
  const col = (c: number) => `$${colName(c)}$${first}:$${colName(c)}$${last}`;
  ids.forEach((id, n) => {
    const r = first + n;
    const c = (k: number) => `${colName(k)}${r}`;
    const isRoot = n === 0;
    const isLast = n === ids.length - 1;
    // Parents have smaller ids (rows above), children larger ids (rows below):
    // a column that recurses on itself only ever looks the other way.
    const above = (k: number) => `$${colName(k)}$${first}:$${colName(k)}$${r - 1}`;
    const below = (k: number) => `$${colName(k)}$${r + 1}:$${colName(k)}$${last}`;
    const rowOf = (ref: string) => `MATCH(${ref},${above(SE.id)},0)`;
    const stab = h.stability[String(id)];
    s.row([
      id,
      isRoot ? '' : F(`INDEX(${clCol(ctx, 3)},MATCH(A${r},${clCol(ctx, 0)},0))`),
      isRoot ? 0 : F(`INDEX(${clCol(ctx, 4)},MATCH(A${r},${clCol(ctx, 0)},0))`),
      F(
        `SUMIF(${ptCol(ctx, 7)},A${r},${ptCol(ctx, 6)})-C${r}*COUNTIF(${ptCol(ctx, 7)},A${r})` +
          (ctx.clusterIds.length ? `+SUMIF(${clCol(ctx, 3)},A${r},${clCol(ctx, 12)})-C${r}*SUMIF(${clCol(ctx, 3)},A${r},${clCol(ctx, 5)})` : ''),
      ),
      stab == null ? LAMBDA_INF : stab,
      F(`(${c(SE.stab)}-${c(SE.stabL)})/MAX(1,ABS(${c(SE.stabL)}))`),
      isLast ? 0 : F(`SUMIF(${below(SE.parent)},A${r},${below(SE.best)})`),
      F(f32(c(SE.childSum))),
      isRoot ? 0 : F(`IF(${c(SE.childSum32)}>${c(SE.stab)},0,1)`),
      F(`IF(${c(SE.keep)}=1,${c(SE.stab)},${c(SE.childSum32)})`),
      F(`IF(COUNTIF(${col(SE.parent)},A${r})=0,1,0)`),
      isRoot ? 0 : F(`IF(${c(SE.parent)}=P_N,0,MAX(INDEX(${above(SE.keep)},${rowOf(c(SE.parent))}),INDEX(${above(SE.ancKeep)},${rowOf(c(SE.parent))})))`),
      isRoot ? 0 : F(`IF(P_METHOD="leaf",${c(SE.leaf)},IF(AND(${c(SE.keep)}=1,${c(SE.ancKeep)}=0),1,0))`),
      isRoot ? '' : F(`1/${c(SE.birth)}`),
      isRoot ? '' : F(`IF(${c(SE.parent)}=P_N,A${r},IF(INDEX(${above(SE.eps)},${rowOf(c(SE.parent))})>P_EPS,${c(SE.parent)},INDEX(${above(SE.up)},${rowOf(c(SE.parent))})))`),
      isRoot ? '' : F(`IF(${c(SE.base)}=1,IF(AND(P_EPS>0,${c(SE.eps)}<P_EPS),${c(SE.up)},A${r}),"")`),
      isRoot ? 0 : F(`IF(P_EPS>0,IF(COUNTIF(${col(SE.target)},A${r})>0,1,0),${c(SE.base)})`),
      selectedSet.has(id) ? 1 : 0,
      F(`IF(${c(SE.sel)}=${c(SE.selL)},0,"BEDA")`),
      F(`IF(${c(SE.sel)}=1,COUNTIFS(${col(SE.sel)},1,${col(SE.id)},"<"&A${r}),"")`),
      F(
        `MAX(${fn('MAXIFS')}(${ptCol(ctx, 6)},${ptCol(ctx, 7)},A${r})` +
          (ctx.clusterIds.length ? `,${fn('MAXIFS')}(${clCol(ctx, 4)},${clCol(ctx, 3)},A${r})` : '') +
          ')',
      ),
      isRoot ? FS(`IF(${c(SE.sel)}=1,A${r},"")`) : FS(`IF(${c(SE.sel)}=1,A${r},INDEX(${above(SE.selCluster)},${rowOf(c(SE.parent))}))`),
      isRoot ? 0 : F(`INDEX(${above(SE.depth)},${rowOf(c(SE.parent))})+1`),
    ]);
  });
  ctx.seRows = { first, last };
  ctx.check('HDBSCAN: stabilitas klaster (relatif)', SHEET.select, SE.dStab, first, SE.dStab, last, 1e-9, '');
  ctx.check('HDBSCAN: klaster terpilih', SHEET.select, SE.dSel, first, SE.dSel, last, 0, '');
  if (h.params.clusterSelectionEpsilon > 0) {
    ctx.gaps.push('cluster_selection_epsilon > 0: rumus memakai aturan "naik ke leluhur pertama yang lahir di atas ε" per klaster; urutan pemrosesan pustaka (daftar "processed") bisa menghasilkan pilihan berbeda pada pohon tertentu — selisihnya tampil di lembar Seleksi.');
  }
}

const seCol = (ctx: BuildContext, c: number) => `${q(SHEET.select)}!$${colName(c)}$${ctx.seRows!.first}:$${colName(c)}$${ctx.seRows!.last}`;

export function buildLabels(ctx: BuildContext): void {
  const N = ctx.N;
  const h = ctx.t.hdbscan;
  const probs = ctx.flat(h.probabilities);
  ctx.labelCol = 5;
  ctx.hardProbCol = 10;
  const s = ctx.sheet(SHEET.labels, [7, 8, 30, 11, 11, 10, 10, 9, 14, 14, 14, 14, 12]);
  s.row(['HDBSCAN — LABEL DAN PROBABILITAS KERAS']);
  s.row([
    'Label = klaster terpilih yang memuat klaster jatuh titik (dirinya sendiri atau leluhurnya), dinomori 0.. menurut id; tanpa klaster terpilih → −1 (outlier). Probabilitas = min(λ_titik, λ_maks)/λ_maks, λ_maks = λ terbesar baris langsung klaster terpilih itu.',
  ]);
  s.row(['Dok #', 'Id titik', 'Jabatan', 'Klaster jatuh', 'Klaster terpilih', 'Label (rumus)', 'Label (pustaka)', 'Selisih', 'λ titik', 'λ maks klaster', 'Probabilitas (rumus)', 'Probabilitas (pustaka)', 'Selisih']);
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    s.row([
      i + 1,
      i,
      ctx.title(i),
      F(`${cell(SHEET.points, 7, r)}`),
      FS(`INDEX(${seCol(ctx, SE.selCluster)},MATCH(D${r},${seCol(ctx, SE.id)},0))`),
      F(`IF(E${r}="",-1,INDEX(${seCol(ctx, SE.label)},MATCH(E${r},${seCol(ctx, SE.id)},0)))`),
      h.labels[i]!,
      F(`IF(F${r}=G${r},0,"BEDA")`),
      F(`${cell(SHEET.points, 6, r)}`),
      F(`IF(E${r}="","",INDEX(${seCol(ctx, SE.death)},MATCH(E${r},${seCol(ctx, SE.id)},0)))`),
      F(`IF(F${r}=-1,0,IF(OR(J${r}=0,I${r}>=${LAMBDA_INF}),1,MIN(I${r},J${r})/J${r}))`),
      probs[i]!,
      F(`K${r}-L${r}`),
    ]);
  }
  ctx.check('HDBSCAN: label', SHEET.labels, 7, docRow(1), 7, docRow(N), 0, '');
  ctx.check('HDBSCAN: probabilitas keras', SHEET.labels, 12, docRow(1), 12, docRow(N), 1e-12, '');
}

/** Ancestor matrix + the per (cluster, selected cluster) merge heights. */
export function buildAncestors(ctx: BuildContext): void {
  const N = ctx.N;
  const ids = [N, ...ctx.clusterIds];
  const sel = ctx.t.hdbscan.selected;
  const C = ids.length;
  const K = sel.length;
  const M0 = 3; // first matrix column
  const LCA0 = M0 + C + 1;
  const REL0 = LCA0 + K;
  const SPL0 = REL0 + K;
  const s = ctx.sheet(SHEET.ancestors, [9, 9, 9, ...Array(Math.min(C, 60)).fill(6), 4, ...Array(K * 3).fill(10)]);
  s.row(['HDBSCAN — LELUHUR KLASTER dan TINGGI GABUNG (untuk keanggotaan lunak)']);
  s.row([
    'A[c, a] = 1 bila a leluhur-atau-sama-dengan c. Leluhur bersama terdalam (LCA) c dan klaster terpilih S: kedalamannya = Σ A[c,·]·A[S,·] − 1 (leluhur bersama membentuk rantai dari akar). "Berkerabat" = salah satunya leluhur yang lain → tinggi gabung = λ titik. Selain itu tinggi gabung = λ saat LCA pecah.',
  ]);
  const hdr: any[] = ['Klaster', 'Induk', 'Kedalaman', ...ids];
  hdr.push('');
  for (const S of sel) hdr.push(`LCA dgn ${S}`);
  for (const S of sel) hdr.push(`Berkerabat ${S}`);
  for (const S of sel) hdr.push(`λ pecah LCA ${S}`);
  s.row(hdr);
  const idRowN = 3;
  const depthRowN = s.row(['Kedalaman kolom', '', '', ...ids.map((_, n) => F(`INDEX(${seCol(ctx, SE.depth)},MATCH(${colName(M0 + n)}$${idRowN},${seCol(ctx, SE.id)},0))`))]);
  const first = depthRowN + 1;
  const last = first + C - 1;
  const matrix = `$${colName(M0)}$${first}:$${colName(M0 + C - 1)}$${last}`;
  const idRow = `$${colName(M0)}$${idRowN}:$${colName(M0 + C - 1)}$${idRowN}`;
  const depthRow = `$${colName(M0)}$${depthRowN}:$${colName(M0 + C - 1)}$${depthRowN}`;
  ids.forEach((id, n) => {
    const r = first + n;
    const cells: any[] = [
      id,
      n === 0 ? '' : F(`INDEX(${seCol(ctx, SE.parent)},MATCH(A${r},${seCol(ctx, SE.id)},0))`),
      F(`INDEX(${seCol(ctx, SE.depth)},MATCH(A${r},${seCol(ctx, SE.id)},0))`),
    ];
    for (let a = 0; a < C; a++) {
      const colLetter = colName(M0 + a);
      if (n === 0) {
        cells.push(F(`IF($A${r}=${colLetter}$${idRowN},1,0)`));
        continue;
      }
      const above = `${colLetter}$${first}:${colLetter}$${r - 1}`;
      cells.push(F(`IF($A${r}=${colLetter}$${idRowN},1,INDEX(${above},MATCH($B${r},$A$${first}:$A$${r - 1},0)))`));
    }
    cells.push('');
    const rowC = `INDEX(${matrix},${n + 1},0)`;
    for (let j = 0; j < K; j++) {
      const rowS = `INDEX(${matrix},${ids.indexOf(sel[j]!) + 1},0)`;
      cells.push(F(`SUMPRODUCT(${rowC}*${rowS}*(${depthRow}=SUMPRODUCT(${rowC}*${rowS})-1)*${idRow})`));
    }
    for (let j = 0; j < K; j++) {
      const lca = `${colName(LCA0 + j)}${r}`;
      cells.push(F(`IF(OR(${lca}=$A${r},${lca}=${sel[j]}),1,0)`));
    }
    for (let j = 0; j < K; j++) {
      const lca = `${colName(LCA0 + j)}${r}`;
      cells.push(
        ctx.clusterIds.length
          ? F(`IF(${colName(REL0 + j)}${r}=1,"",${fn('MAXIFS')}(${clCol(ctx, 4)},${clCol(ctx, 3)},${lca}))`)
          : '',
      );
    }
    s.row(cells);
  });
  ctx.ancLayout = { first, last, REL0, SPL0 };
}

export function buildSoft(ctx: BuildContext): void {
  const N = ctx.N;
  const h = ctx.t.hdbscan;
  const sel = h.selected;
  const K = sel.length;
  const soft = h.soft ? ctx.matrix(h.soft) : null;
  const A = ctx.ancLayout!;
  if (K === 0 || !soft) {
    const s = ctx.sheet(SHEET.soft, [100]);
    s.row(['HDBSCAN — KEANGGOTAAN LUNAK']);
    s.row([K === 0 ? 'Tidak ada klaster terpilih: semua dokumen outlier, tidak ada vektor keanggotaan.' : 'Vektor keanggotaan lunak tidak tercatat pada run ini.']);
    ctx.probPerDocCol = -1;
    return;
  }
  const B0 = 6;
  const DMIN = B0;
  const INV = DMIN + K;
  const DV = INV + K;
  const H = DV + K;
  const SC = H + K;
  const OV = SC + K;
  const INS = OV + K;
  const CB = INS + 1;
  const SR = CB + K;
  const SD = SR + K;
  const PP = SD + K;
  const PPL = PP + 1;
  const PPD = PP + 2;
  const PPS = PP + 3;
  const PPSD = PP + 4;
  ctx.probPerDocCol = PP;
  const s = ctx.sheet(SHEET.soft, [7, 30, 9, 12, 12, 8, ...Array(K * 9 + 6).fill(11)]);
  s.row(['HDBSCAN — VEKTOR KEANGGOTAAN LUNAK (all_points_membership_vectors) → keanggotaan dokumen']);
  s.row([
    'Bagian jarak: 1/(jarak terdekat ke exemplar klaster), dinormalkan per baris (jarak 0 → DBL_MAX/K). Bagian outlier: skor = exp(−(λmaks klaster jatuh + 1E-8)/tinggi gabung), lalu softmax per baris. Hasil = (jarak × outlier) dinormalkan × peluang-di-suatu-klaster, dengan peluang = tinggi maks / max(λmaks klaster terpilih dengan tinggi maks, λ titik). Keanggotaan dokumen = nilai terbesar barisnya.',
  ]);
  const head: string[] = ['Dok #', 'Jabatan', 'Klaster jatuh', 'λ titik', 'λ maks klaster jatuh', 'Baris di Leluhur'];
  const blk = (label: string) => sel.forEach((S, j) => head.push(`${label} ${S} (label ${j})`));
  blk('d min exemplar');
  blk('1/d');
  blk('Bagian jarak');
  blk('Tinggi gabung');
  blk('Skor outlier');
  blk('Bagian outlier');
  head.push('Peluang di suatu klaster');
  blk('Keanggotaan (rumus)');
  blk('Keanggotaan (pustaka)');
  blk('Selisih');
  head.push('Keanggotaan dokumen (rumus)', 'Keanggotaan dokumen (pustaka)', 'Selisih', 'Keanggotaan tersimpan', 'Selisih tersimpan');
  s.row(head);
  const probPerDoc = ctx.t.probPerDoc;
  const smaxRow = docRow(N) + 2;
  const lmRow = docRow(N) + 3;
  // Exemplar flags (1 = point is an exemplar of selected cluster j), one row per
  // cluster, laid out like a row of Jarak Euclid so MINIFS can pair them.
  const exHead = docRow(N) + 7;
  const exRow = (j: number) => exHead + 1 + j;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const c = (k: number) => `${colName(k)}${r}`;
    const blockRange = (b: number) => `${colName(b)}${r}:${colName(b + K - 1)}${r}`;
    const cells: any[] = [
      i + 1,
      ctx.title(i),
      F(`${cell(SHEET.points, 7, r)}`),
      F(`${cell(SHEET.points, 6, r)}`),
      F(`INDEX(${seCol(ctx, SE.death)},MATCH(C${r},${seCol(ctx, SE.id)},0))`),
      F(`MATCH(C${r},${q(SHEET.ancestors)}!$A$${A.first}:$A$${A.last},0)`),
    ];
    const euRow = `${q(SHEET.euclid)}!$B$${r}:$${colName(N)}$${r}`;
    for (let j = 0; j < K; j++) {
      cells.push((h.exemplars[j] ?? []).length ? F(`${fn('MINIFS')}(${euRow},$B$${exRow(j)}:$${colName(N)}$${exRow(j)},1)`) : '');
    }
    for (let j = 0; j < K; j++) cells.push(F(`IF(${c(DMIN + j)}=0,P_DBLMAX/${K},1/${c(DMIN + j)})`));
    for (let j = 0; j < K; j++) cells.push(F(`${c(INV + j)}/SUM(${blockRange(INV)})`));
    for (let j = 0; j < K; j++) {
      const relCell = `INDEX(${q(SHEET.ancestors)}!$${colName(A.REL0 + j)}$${A.first}:$${colName(A.REL0 + j)}$${A.last},$F${r})`;
      const splCell = `INDEX(${q(SHEET.ancestors)}!$${colName(A.SPL0 + j)}$${A.first}:$${colName(A.SPL0 + j)}$${A.last},$F${r})`;
      cells.push(F(`IF(${relCell}=1,$D${r},${splCell})`));
    }
    for (let j = 0; j < K; j++) cells.push(F(`IF(${c(H + j)}=0,0,EXP(-($E${r}+P_EPS8)/${c(H + j)}))`));
    for (let j = 0; j < K; j++) cells.push(F(`EXP(${c(SC + j)}-P_SMAX)/SUMPRODUCT(EXP(${blockRange(SC)}-P_SMAX))`));
    cells.push(F(`MAX(${blockRange(H)})/MAX(INDEX($${colName(H)}$${lmRow}:$${colName(H + K - 1)}$${lmRow},MATCH(MAX(${blockRange(H)}),${blockRange(H)},0)),$D${r})`));
    for (let j = 0; j < K; j++) cells.push(F(`${c(DV + j)}*${c(OV + j)}/SUMPRODUCT(${blockRange(DV)},${blockRange(OV)})*$${colName(INS)}${r}`));
    for (let j = 0; j < K; j++) cells.push(soft[i]![j]!);
    for (let j = 0; j < K; j++) cells.push(F(`${c(CB + j)}-${c(SR + j)}`));
    const persisted = ctx.persisted(i)?.probability;
    cells.push(
      F(`IF(P_CALCPROB,MAX(${blockRange(CB)}),${cell(SHEET.labels, ctx.hardProbCol, r)})`),
      probPerDoc[i] ?? null,
      probPerDoc[i] == null ? null : F(`${c(PP)}-${c(PPL)}`),
      persisted ?? null,
      persisted == null ? null : F(`${c(PP)}-${c(PPS)}`),
    );
    s.row(cells);
  }
  s.blank();
  const sm = s.row(['Skor outlier terbesar (seluruh matriks)', '', '', '', '', '', ...Array(SC - 6).fill(''), F(`MAX($${colName(SC)}$${docRow(1)}:$${colName(SC + K - 1)}$${docRow(N)})`)]);
  if (sm !== smaxRow) throw new Error('soft smax row drifted');
  ctx.name('P_SMAX', SHEET.soft, SC, smaxRow);
  const lm: any[] = ['λ maks klaster terpilih', '', '', '', '', '', ...Array(H - 6).fill('')];
  for (const S of sel) lm.push(F(`INDEX(${seCol(ctx, SE.death)},MATCH(${S},${seCol(ctx, SE.id)},0))`));
  const lr = s.row(lm);
  if (lr !== lmRow) throw new Error('soft leafmax row drifted');
  s.row(['Pustaka mengurangkan skor terbesar seluruh matriks sebelum exp (stabilitas numerik); karena barisnya dinormalkan, pengurangan itu tidak mengubah hasil.']);
  s.row([`Kolom keanggotaan mengikuti urutan label HDBSCAN (0..${K - 1}); BERTopic memetakan kolom label → nomor topik (lembar ${SHEET.topics}), yang tidak mengubah nilai terbesar baris.`]);
  s.blank();
  const eh = s.row([
    'EXEMPLAR — titik daun klaster terpilih yang λ-nya sama dengan λ maks daun itu (PredictionData). 1 = exemplar; kolom = Dok #. d min exemplar = MINIFS(baris Jarak Euclid, baris ini, 1).',
    ...Array.from({ length: N }, (_, p) => p + 1),
  ]);
  if (eh !== exHead) throw new Error('exemplar header row drifted');
  sel.forEach((S, j) => {
    const set = new Set(h.exemplars[j] ?? []);
    s.row([`Klaster ${S} (label ${j})`, ...Array.from({ length: N }, (_, p) => (set.has(p) ? 1 : 0))]);
  });
  ctx.check('HDBSCAN: vektor keanggotaan lunak', SHEET.soft, SD, docRow(1), SD + K - 1, docRow(N), 1e-9, '');
  ctx.check('BERTopic: keanggotaan dokumen (nilai terbesar baris)', SHEET.soft, PPD, docRow(1), PPD, docRow(N), 1e-9, '');
  ctx.check('Keanggotaan dokumen vs nilai tersimpan peta', SHEET.soft, PPSD, docRow(1), PPSD, docRow(N), 1e-6, 'Kolom probability tersimpan sebagai real (float4).');
}
