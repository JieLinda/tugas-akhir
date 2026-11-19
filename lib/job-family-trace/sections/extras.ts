// Stage 7 (beside the map): the Family Tree (Ward linkage over c-TF-IDF
// distances), the generalized node titles, and the seed-stability check.

import { BuildContext, SHEET, docRow } from '../context';
import { F, FS, colName, fn, q } from '../../run-trace/sheet';

export function buildHierarchy(ctx: BuildContext): void {
  const hier = ctx.t.hierarchy;
  if (!hier || 'error' in hier) {
    if (hier && 'error' in hier) ctx.gaps.push(`Family Tree: jarak dan linkage tidak tercatat (${hier.error}).`);
    return;
  }
  const dist = ctx.matrix(hier.distance);
  const Z = ctx.matrix(hier.linkage);
  const order = ctx.t.ctfidf.topicOrder;
  const real = order.map((tid, n) => ({ tid, n })).filter((x) => x.tid !== -1);
  const T = real.length;
  if (T < 2 || dist.length !== T) return;
  const s = ctx.sheet(SHEET.hier, [12, ...Array(Math.max(T, 2 * T - 1) + 4).fill(10)]);
  s.row(['FAMILY TREE — jarak antar famili dan penggabungan Ward (hierarchical_topics)']);
  s.row([
    'Jarak = 1 − cosine antara baris c-TF-IDF dua famili (hanya kata yang dimiliki keduanya berkontribusi pada hasil kali titik; norma dari seluruh kata famili). Penggabungan Ward (Lance–Williams): d(i∪j, k) = √(((n_i+n_k)·d_ik² + (n_j+n_k)·d_jk² − n_k·d_ij²)/(n_i+n_j+n_k)). Pada tiap langkah pasangan yang digabung harus pasangan aktif terdekat.',
  ]);
  // Shared terms (in ≥ 2 real topics), dense block of weights.
  const byTerm = new Map<number, Map<number, number>>();
  for (const [key, row] of ctx.ctCell) {
    const [nStr, vStr] = key.split(':');
    const n = Number(nStr);
    if (order[n] === -1) continue;
    const v = Number(vStr);
    const m = byTerm.get(v) ?? new Map<number, number>();
    m.set(n, row);
    byTerm.set(v, m);
  }
  const shared = Array.from(byTerm.entries()).filter(([, m]) => m.size >= 2).sort((a, b) => a[0] - b[0]);
  const hcFirst = 4;
  const hcLast = 3 + ctx.t.ctfidf.counts.val.length;
  const hcCol = (c: string) => `${q(SHEET.ctCounts)}!$${c}$${hcFirst}:$${c}$${hcLast}`;

  s.blank();
  s.row(['NORMA BARIS c-TF-IDF']);
  const normHead = s.row(['Famili', ...real.map((x) => x.tid)]);
  const normRow = s.row(['‖w‖', ...real.map((x) => F(`SQRT(SUMIF(${hcCol('A')},${x.tid},${hcCol('L')}))`))]);
  s.blank();
  s.row(['MATRIKS JARAK (rumus) — baris/kolom = famili']);
  const dHead = s.row(['', ...real.map((x) => x.tid)]);
  const dFirst = dHead + 1;
  const denseFirst = dFirst + T + 3 + T + 2; // after the distance matrix, the recorded matrix and their headers
  const denseLast = denseFirst + shared.length - 1;
  const denseCol = (j: number) => `$${colName(1 + j)}$${denseFirst}:$${colName(1 + j)}$${denseLast}`;
  for (let i = 0; i < T; i++) {
    const r = dFirst + i;
    const cells: any[] = [real[i]!.tid];
    for (let j = 0; j < T; j++) {
      if (i === j) cells.push(0);
      else if (j > i) {
        const dot = shared.length ? `SUMPRODUCT(${denseCol(i)},${denseCol(j)})` : '0';
        cells.push(F(`1-${dot}/(${colName(1 + i)}$${normRow}*${colName(1 + j)}$${normRow})`));
      } else cells.push(F(`${colName(1 + i)}${dFirst + j}`));
    }
    s.row(cells);
  }
  s.blank();
  s.row(['MATRIKS JARAK (pustaka) dan selisih maks per baris']);
  const rHead = s.row(['', ...real.map((x) => x.tid), 'Selisih maks baris']);
  const rFirst = rHead + 1;
  for (let i = 0; i < T; i++) {
    const r = rFirst + i;
    const recRange = `${colName(1)}${r}:${colName(T)}${r}`;
    const fRange = `${colName(1)}${dFirst + i}:${colName(T)}${dFirst + i}`;
    s.row([real[i]!.tid, ...dist[i]!, F(`SQRT(SUMXMY2(${fRange},${recRange}))`)]);
  }
  ctx.check('Family Tree: jarak antar famili (1 − cosine c-TF-IDF)', SHEET.hier, T + 1, rFirst, T + 1, rFirst + T - 1, 1e-9, 'Selisih = jarak Euclid baris rumus vs pustaka.');
  s.blank();
  const sh = s.row(['KATA BERSAMA (bobot per famili; kata yang hanya dimiliki satu famili tidak berkontribusi pada hasil kali titik)', ...real.map((x) => x.tid)]);
  if (sh + 1 !== denseFirst) throw new Error('dense block row drifted');
  for (const [v, m] of shared) {
    s.row([
      FS(`${q(SHEET.ctVocab)}!$B$${4 + v}`),
      ...real.map((x) => (m.has(x.n) ? F(`${q(SHEET.ctCounts)}!$I$${m.get(x.n)}`) : 0)),
    ]);
  }
  void normHead;

  // ── Ward merges with Lance–Williams ──
  const M = 2 * T - 1;
  s.blank();
  s.row(['PENGGABUNGAN WARD — Z dari pustaka (scipy linkage, optimal_ordering) dan jarak Lance–Williams (rumus)']);
  const zHead = s.row(['Langkah', 'Anak a', 'Anak b', 'Jarak (pustaka)', 'Ukuran (pustaka)', 'Klaster baru', 'Jarak a–b (rumus)', 'Ukuran (rumus)', 'Selisih jarak', 'Selisih ukuran', 'Min pasangan aktif', 'Selisih ke min']);
  const zFirst = zHead + 1;
  const zLast = zFirst + T - 2;
  const wHeadRow = zLast + 2;
  const wFirst = wHeadRow + 1;
  const wLast = wFirst + M - 1;
  const W0 = 2; // first matrix column on the LW block (col 0 id, col 1 size)
  // Direct references: the merged pair of every step is a recorded input, so
  // each Lance–Williams cell can name exactly the cells it combines.
  const W = (x: number, y: number) => `$${colName(W0 + y)}$${wFirst + x}`;
  const sizeOf = (x: number) => `$B$${wFirst + x}`;
  const ACT0 = W0 + M + 1; // active flags block: rows = clusters, cols = steps
  const RMIN0 = ACT0 + (T - 1) + 1; // per-row minimum among active partners, per step
  for (let st = 1; st <= T - 1; st++) {
    const r = zFirst + st - 1;
    const z = Z[st - 1]!;
    s.row([
      st,
      Math.round(z[0]!),
      Math.round(z[1]!),
      z[2]!,
      Math.round(z[3]!),
      T + st - 1,
      F(W(Math.round(z[0]!), Math.round(z[1]!))),
      F(`${sizeOf(Math.round(z[0]!))}+${sizeOf(Math.round(z[1]!))}`),
      F(`G${r}-D${r}`),
      F(`H${r}-E${r}`),
      F(`${fn('MINIFS')}($${colName(RMIN0 + st - 1)}$${wFirst}:$${colName(RMIN0 + st - 1)}$${wLast},$${colName(ACT0 + st - 1)}$${wFirst}:$${colName(ACT0 + st - 1)}$${wLast},1)`),
      F(`G${r}-K${r}`),
    ]);
  }
  ctx.check('Family Tree: jarak penggabungan Ward', SHEET.hier, 8, zFirst, 8, zLast, hier.uniquified ? 1e-6 : 1e-9, hier.uniquified ? 'Jarak kembar dibuat unik oleh BERTopic (derau ≤ 1E-7).' : '');
  ctx.check('Family Tree: ukuran klaster gabungan', SHEET.hier, 9, zFirst, 9, zLast, 0, '');
  ctx.check('Family Tree: pasangan digabung = pasangan aktif terdekat', SHEET.hier, 11, zFirst, 11, zLast, 1e-12, '');
  s.blank();
  const headCells: any[] = ['Klaster', 'Ukuran'];
  for (let y = 0; y < M; y++) headCells.push(y);
  headCells.push('');
  for (let st = 1; st <= T - 1; st++) headCells.push(`aktif t=${st}`);
  headCells.push('');
  for (let st = 1; st <= T - 1; st++) headCells.push(`min baris t=${st}`);
  const wh = s.row(headCells);
  if (wh !== wHeadRow) throw new Error('LW header row drifted');
  const idRow = `$${colName(W0)}$${wHeadRow}:$${colName(W0 + M - 1)}$${wHeadRow}`;
  // merged-at step per cluster, as a helper below the block
  const mergedRow = wLast + 2;
  const actTFirst = mergedRow + 2;
  for (let x = 0; x < M; x++) {
    const r = wFirst + x;
    const cells: any[] = [x];
    if (x < T) cells.push(1);
    else {
      const zr = zFirst + (x - T);
      cells.push(F(`H${zr}`));
    }
    for (let y = 0; y < M; y++) {
      if (x === y) cells.push(0);
      else if (x < T && y < T) cells.push(F(`${colName(1 + y)}${dFirst + x}`));
      else if (y > x) cells.push(F(`${colName(W0 + x)}${wFirst + y}`));
      else {
        // x is a merged cluster created at step x − T + 1, y < x.
        const z = Z[x - T]!;
        const a = Math.round(z[0]!);
        const bb = Math.round(z[1]!);
        const na = sizeOf(a);
        const nb = sizeOf(bb);
        const nk = sizeOf(y);
        cells.push(F(`SQRT(MAX(0,((${na}+${nk})*${W(a, y)}^2+(${nb}+${nk})*${W(bb, y)}^2-${nk}*${W(a, bb)}^2)/(${na}+${nb}+${nk})))`));
      }
    }
    cells.push('');
    // active at the start of step st: created before st and not yet merged
    for (let st = 1; st <= T - 1; st++) {
      cells.push(F(`IF(AND(${x}<${T + st - 1},${colName(W0 + x)}$${mergedRow}>=${st}),1,0)`));
    }
    cells.push('');
    for (let st = 1; st <= T - 1; st++) {
      const wrow = `$${colName(W0)}${r}:$${colName(W0 + M - 1)}${r}`;
      const actRow = `$${colName(W0)}$${actTFirst + st - 1}:$${colName(W0 + M - 1)}$${actTFirst + st - 1}`;
      cells.push(F(`${fn('MINIFS')}(${wrow},${actRow},1,${idRow},"<>"&$A${r})`));
    }
    s.row(cells);
  }
  s.blank();
  const merged: any[] = ['Digabung pada langkah', ''];
  for (let x = 0; x < M; x++) {
    merged.push(F(`IFERROR(MATCH(${x},$B$${zFirst}:$B$${zLast},0),IFERROR(MATCH(${x},$C$${zFirst}:$C$${zLast},0),1E9))`));
  }
  const mr = s.row(merged);
  if (mr !== mergedRow) throw new Error('merged row drifted');
  s.blank();
  for (let st = 1; st <= T - 1; st++) {
    const cells: any[] = [`aktif t=${st}`, ''];
    for (let x = 0; x < M; x++) cells.push(F(`${colName(ACT0 + st - 1)}${wFirst + x}`));
    const r = s.row(cells);
    if (r !== actTFirst + st - 1) throw new Error('active row drifted');
  }
  const rows = ctx.t.hierarchyRows as { linkage?: Record<string, unknown>[] } | null;
  if (rows?.linkage?.length) {
    s.blank();
    s.row(['BARIS HIERARKI BERTopic (Parent_ID, nama gabungan dari c-TF-IDF dokumen gabungan) — sebagaimana disimpan run']);
    s.row(['Parent ID', 'Nama induk', 'Anak kiri', 'Nama kiri', 'Anak kanan', 'Nama kanan', 'Jarak']);
    for (const r of rows.linkage) {
      s.row([String(r.parentId ?? ''), String(r.parentName ?? ''), String(r.childLeftId ?? ''), String(r.childLeftName ?? ''), String(r.childRightId ?? ''), String(r.childRightName ?? ''), typeof r.distance === 'number' ? r.distance : null]);
    }
    ctx.gaps.push('Nama simpul Family Tree (Parent_Name) dihitung BERTopic dari c-TF-IDF gabungan dokumen tiap subtree — dicantumkan sebagai hasil pustaka, bukan diturunkan ulang.');
  }
}

export function buildGeneralization(ctx: BuildContext): void {
  const nodes = ctx.t.generalize;
  if (!nodes || !nodes.length) return;
  const s = ctx.sheet(SHEET.gen, [10, 10, 16, 18, 12, 36, 12, 36, 10, 60, 50]);
  s.row(['GENERALISASI SIMPUL — judul dan deskripsi umum tiap famili dan sub-famili']);
  s.row([
    'Kata kunci gabungan simpul internal = Σ_daun (skor kata di daun × ukuran daun), 10 terbesar, lalu dibagi jumlah kesepuluhnya. Judul dari model bahasa (Gemini) bila tersedia — MASUKAN; bila tidak, judul cadangan = empat kata kunci pertama (rumus). Perwakilan = anggota terdekat ke centroid subtree.',
  ]);
  s.row(['Simpul', 'Jenis', 'Anak', 'Famili daun', 'Jumlah dokumen (rumus)', 'Judul', 'Sumber judul', 'Judul cadangan (rumus)', 'Selisih', 'Deskripsi', 'Perwakilan']);
  const first = s.next;
  const nodeRows = new Map<string, number>();
  nodes.forEach((n) => {
    nodeRows.set(n.node, s.next);
    s.row([]);
  });
  // Merged-keyword candidates for internal nodes.
  s.blank();
  s.row(['KATA KUNCI GABUNGAN SIMPUL INTERNAL — semua kata kandidat dari daun-daunnya']);
  const kh = s.row(['Simpul', 'Urutan sisip', 'Kata', 'Akumulasi (rumus)', 'Peringkat (rumus)', 'Terpilih (10 besar)', 'Skor ternormal (rumus)', 'Skor tercatat', 'Selisih', 'Tercatat?', 'Selisih pilihan']);
  const kkScore = (row: number) => `${q(SHEET.ctTopics)}!$D$${row}`;
  const candFirst = kh + 1;
  const plan: { node: string; rows: number[]; words: string[] }[] = [];
  for (const n of nodes) {
    if (n.kind !== 'internal' || n.leafTopics.length < 2) continue;
    const acc = new Map<string, string[]>();
    for (const leaf of n.leafTopics) {
      const kwRows = ctx.kwRows.get(leaf) ?? [];
      const words = ctx.t.ctfidf.keywords[String(leaf)] ?? [];
      const size = ctx.topicSizeCell.get(leaf) ?? '1';
      words.forEach(([w], k) => {
        if (!w) return;
        const terms = acc.get(w) ?? [];
        terms.push(`${kkScore(kwRows[k]!)}*${size}`);
        acc.set(w, terms);
      });
    }
    plan.push({ node: n.node, rows: [], words: Array.from(acc.keys()) });
    const recorded = new Map(n.keywords.map(([w, sc]) => [w, sc]));
    const start = s.next;
    const end = start + acc.size - 1;
    let ins = 0;
    for (const [w, terms] of acc) {
      const r = s.next;
      ins++;
      s.row([
        n.node,
        ins,
        w,
        F(terms.join('+')),
        F(`1+SUMPRODUCT(($D$${start}:$D$${end}>D${r})*1)+SUMPRODUCT(($D$${start}:$D$${end}=D${r})*($B$${start}:$B$${end}<B${r}))`),
        F(`IF(E${r}<=10,1,0)`),
        F(`IF(F${r}=1,D${r}/SUMIF($F$${start}:$F$${end},1,$D$${start}:$D$${end}),"")`),
        recorded.has(w) ? recorded.get(w)! : null,
        F(`IF(AND(F${r}=1,H${r}<>""),G${r}-H${r},"")`),
        recorded.has(w) ? 1 : 0,
        F(`IF(F${r}=J${r},0,"BEDA")`),
      ]);
      plan[plan.length - 1]!.rows.push(r);
    }
  }
  const candLast = s.next - 1;
  if (candLast >= candFirst) {
    ctx.check('Generalisasi: skor kata kunci gabungan', SHEET.gen, 8, candFirst, 8, candLast, 1e-9, '');
    ctx.check('Generalisasi: 10 kata kunci gabungan terpilih', SHEET.gen, 10, candFirst, 10, candLast, 0, '');
  }
  // Fill the node rows.
  for (const n of nodes) {
    const r = nodeRows.get(n.node)!;
    const p = plan.find((x) => x.node === n.node);
    let fallback: any = '';
    if (n.kind === 'leaf') {
      const kwRows = ctx.kwRows.get(n.leafTopics[0]!) ?? [];
      fallback = kwRows.length ? FS(`${fn('TEXTJOIN')}(", ",TRUE,${kwRows.slice(0, 4).map((x) => `${q(SHEET.ctTopics)}!$C$${x}`).join(',')})`) : 'Kelompok';
    } else if (p) {
      // First four of the merged keywords, in rank order.
      const words = [1, 2, 3, 4].map(
        (k) => `IFERROR(INDEX($C$${p.rows[0]}:$C$${p.rows[p.rows.length - 1]},MATCH(${k},$E$${p.rows[0]}:$E$${p.rows[p.rows.length - 1]},0)),"")`,
      );
      fallback = FS(`${fn('TEXTJOIN')}(", ",TRUE,${words.join(',')})`);
    } else {
      fallback = n.keywords.slice(0, 4).map(([w]) => w).join(', ') || 'Kelompok';
    }
    const sizeRefs = n.leafTopics.map((x) => ctx.topicSizeCell.get(x)).filter(Boolean) as string[];
    s.rows[r - 1] = [
      n.node,
      n.kind === 'leaf' ? 'famili' : 'sub-famili',
      (n.children ?? []).join(', '),
      n.leafTopics.join(', '),
      sizeRefs.length ? F(sizeRefs.join('+')) : null,
      n.title,
      n.fromModel ? 'model bahasa' : 'cadangan (rumus)',
      fallback,
      n.fromModel ? 0 : F(`IF(EXACT(F${r},H${r}),0,"BEDA")`),
      n.description ?? '',
      n.representatives.join(' | '),
    ];
  }
  ctx.check('Generalisasi: judul cadangan', SHEET.gen, 8, first, 8, first + nodes.length - 1, 0, 'Hanya simpul yang judulnya tidak dari model bahasa.');
  if (nodes.some((n) => n.fromModel)) ctx.gaps.push('Judul dan deskripsi umum dari model bahasa (Gemini) adalah keluaran model — dicantumkan apa adanya, bukan hasil rumus.');
}

export function buildSeeds(ctx: BuildContext): void {
  const st = ctx.t.seedStability;
  if (!st || !st.partitions?.length) return;
  const N = ctx.N;
  const P = st.partitions;
  const S = P.length;
  const PUB = 2;
  const ALT0 = 3;
  const AG0 = ALT0 + S;
  const MEAN = AG0 + S;
  const UNST = MEAN + 1;
  const NA = UNST + 1; // per seed: n_ab, n_a, n_b helper blocks
  const s = ctx.sheet(SHEET.seeds, [7, 30, 10, ...Array(S * 5 + 4).fill(10)]);
  s.row(['STABILITAS SEED — seberapa bergantung peta pada benih UMAP']);
  s.row([
    `Partisi pembanding = cluster() yang sama di bawah benih ${P.map((x) => x.seed).join(', ')} (MASUKAN: masing-masing satu pengelompokan penuh). Kesepakatan dokumen = |A ∩ B| / |A ∪ B| atas rekan sefamilinya (outlier = keluarga dirinya sendiri). ARI (sklearn, matriks kebingungan pasangan): tp = Σn_ij² − n, fp = Σb_j² − Σn_ij², fn = Σa_i² − Σn_ij², tn = n² − fp − fn − Σn_ij²; ARI = 2(tp·tn − fn·fp)/((tp+fn)(fn+tn) + (tp+fp)(fp+tn)).`,
  ]);
  const head: any[] = ['Dok #', 'Jabatan', 'Famili terbit'];
  for (const p of P) head.push(`Benih ${p.seed}`);
  for (const p of P) head.push(`Kesepakatan ${p.seed}`);
  head.push('Rerata kesepakatan', 'Tidak stabil?');
  for (const p of P) head.push(`n_ab ${p.seed}`, `n_a ${p.seed}`, `n_b ${p.seed}`);
  s.row(head);
  const col = (c: number) => `$${colName(c)}$${docRow(1)}:$${colName(c)}$${docRow(N)}`;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const cells: any[] = [i + 1, ctx.title(i), F(`${q(SHEET.topics)}!$${colName(ctx.finalTopicCol)}$${r}`)];
    for (const p of P) cells.push(p.topics[i] ?? null);
    for (let k = 0; k < S; k++) {
      const a = `$C${r}`;
      const b = `${colName(ALT0 + k)}${r}`;
      const inter = `IF(OR(${a}=-1,${b}=-1),1,COUNTIFS(${col(PUB)},${a},${col(ALT0 + k)},${b}))`;
      const na = `IF(${a}=-1,1,COUNTIF(${col(PUB)},${a}))`;
      const nb = `IF(${b}=-1,1,COUNTIF(${col(ALT0 + k)},${b}))`;
      cells.push(F(`${inter}/(${na}+${nb}-${inter})`));
    }
    cells.push(F(`AVERAGE(${colName(AG0)}${r}:${colName(AG0 + S - 1)}${r})`), F(`IF(${colName(MEAN)}${r}<${st.agreementThreshold},1,0)`));
    for (let k = 0; k < S; k++) {
      cells.push(
        F(`COUNTIFS(${col(PUB)},$C${r},${col(ALT0 + k)},${colName(ALT0 + k)}${r})`),
        F(`COUNTIF(${col(PUB)},$C${r})`),
        F(`COUNTIF(${col(ALT0 + k)},${colName(ALT0 + k)}${r})`),
      );
    }
    s.row(cells);
  }
  s.blank();
  s.row(['PER BENIH']);
  s.row(['Benih', 'ARI (rumus)', 'ARI tercatat (4 desimal)', 'Selisih', 'Famili (rumus)', 'Famili tercatat', 'Outlier (rumus)', 'Outlier tercatat', 'Selisih famili', 'Selisih outlier', 'Σn_ij²', 'Σa_i²', 'Σb_j²', 'tp', 'fp', 'fn', 'tn']);
  const first = s.next;
  P.forEach((p, k) => {
    const r = s.next;
    const rec = st.seeds.find((x) => x.seed === p.seed);
    const nab = col(NA + 3 * k);
    const na = col(NA + 3 * k + 1);
    const nb = col(NA + 3 * k + 2);
    const altCol = col(ALT0 + k);
    s.row([
      p.seed,
      F(`IF(AND(O${r}=0,P${r}=0),1,2*(N${r}*Q${r}-P${r}*O${r})/((N${r}+P${r})*(P${r}+Q${r})+(N${r}+O${r})*(O${r}+Q${r})))`),
      rec?.ari ?? null,
      F(`B${r}-C${r}`),
      F(`SUMPRODUCT((${altCol}<>-1)/COUNTIF(${altCol},${altCol}))`),
      rec?.topicCount ?? null,
      F(`COUNTIF(${altCol},-1)`),
      rec?.outlierCount ?? null,
      F(`E${r}-F${r}`),
      F(`G${r}-H${r}`),
      F(`SUM(${nab})`),
      F(`SUM(${na})`),
      F(`SUM(${nb})`),
      F(`K${r}-P_N`),
      F(`M${r}-K${r}`),
      F(`L${r}-K${r}`),
      F(`P_N^2-O${r}-P${r}-K${r}`),
    ]);
  });
  const last = s.next - 1;
  // The run stores round(·, 4) — Python rounds half-to-even on the binary value,
  // Excel's ROUND half-away on the decimal one, so a tie (0,68285) can round
  // either way. Comparing the unrounded value against half a unit of the 4th
  // decimal is exact for both.
  const HALF = 5.0001e-5;
  ctx.check('Stabilitas seed: ARI per benih', SHEET.seeds, 3, first, 3, last, HALF, 'ARI tercatat dibulatkan 4 desimal: selisih ≤ 0,00005.');
  ctx.check('Stabilitas seed: jumlah famili dan outlier per benih', SHEET.seeds, 8, first, 9, last, 0, '');
  s.blank();
  // The run averages the per-seed ARIs AFTER rounding each to 4 decimals.
  const ar = s.row(['Rerata ARI (dari ARI per benih yang sudah dibulatkan)', F(`SUMPRODUCT(ROUND(B${first}:B${last},4))/${S}`), st.ariMean, F(`B${s.next}-C${s.next}`)]);
  const mr = s.row(['Rerata kesepakatan dokumen', F(`AVERAGE(${col(MEAN)})`), st.meanAgreement ?? null, F(`B${s.next}-C${s.next}`)]);
  const ur = s.row(['Dokumen tidak stabil', F(`SUM(${col(UNST)})`), st.unstableCount, F(`B${s.next}-C${s.next}`)]);
  ctx.check('Stabilitas seed: rerata ARI dan rerata kesepakatan', SHEET.seeds, 3, ar, 3, mr, HALF, 'Nilai tercatat dibulatkan 4 desimal: selisih ≤ 0,00005.');
  ctx.check('Stabilitas seed: jumlah dokumen tidak stabil', SHEET.seeds, 3, ur, 3, ur, 0, '');
}
