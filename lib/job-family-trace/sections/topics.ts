// Stage 4: HDBSCAN labels become BERTopic topic ids (frequency order), an
// optional nr_topics reduction, and the optional re-homing of outliers to the
// nearest family. The final family of every document is assembled here.

import { BuildContext, SHEET, cell, docRow, rowRange } from '../context';
import { F, FS, colName, q } from '../../run-trace/sheet';

/** BERTopic - Topik document columns. */
const TP = { dok: 0, title: 1, label: 2, fit: 3, fitL: 4, dFit: 5, red: 6, redL: 7, dRed: 8, before: 9, final: 10, finalL: 11, dFinal: 12 } as const;
const MAP0 = 14;

export function buildTopicIds(ctx: BuildContext): void {
  const t = ctx.t;
  const N = ctx.N;
  const fit = t.mappingFit.mappings;
  const red = t.mappingReduced?.mappings ?? null;
  const redByLabel = new Map<number, number>();
  if (red) for (const r of red) redByLabel.set(r[0]!, r[r.length - 1]!);
  ctx.beforeRehomeCol = TP.before;
  ctx.finalTopicCol = TP.final;
  ctx.fitTopicCol = TP.fit;

  const s = ctx.sheet(SHEET.topics, [7, 30, 10, 10, 10, 8, 10, 10, 8, 12, 11, 11, 8, 3, 10, 9, 11, 11, 10, 10, 22, 12]);
  s.row(['BERTopic — LABEL HDBSCAN → NOMOR TOPIK (urut ukuran), reduksi, dan topik akhir tiap dokumen']);
  s.row([
    'BERTopic menomori ulang klaster menurut ukuran: terbesar = topik 0 (−1 tetap −1). Ukuran yang SAMA diurutkan pustaka dengan quicksort (tidak stabil untuk > 16 topik), sehingga pemeriksaannya membandingkan UKURAN (LARGE), bukan nomor. Tabel kanan: pemetaan label → topik; kiri: topik tiap dokumen.',
  ]);
  s.row([
    'Dok #', 'Jabatan', 'Label HDBSCAN', 'Topik fit (rumus)', 'Topik fit (pustaka)', 'Selisih',
    'Topik sesudah reduksi (rumus)', 'Topik sesudah reduksi (pustaka)', 'Selisih', 'Topik sebelum penempatan outlier', 'Topik akhir (rumus)', 'Topik akhir (pustaka)', 'Selisih', '',
    'Label HDBSCAN', 'Ukuran (rumus)', 'Kemunculan pertama (Dok #)', 'Peringkat ukuran (rumus)', 'Topik (pustaka)', 'Selisih ukuran-urutan', 'Seri diurutkan sama dengan kemunculan?', red ? 'Topik sesudah reduksi (pustaka)' : '',
  ]);
  const mFirst = docRow(1);
  const mLast = mFirst + fit.length - 1;
  const mcol = (c: number) => `$${colName(c)}$${mFirst}:$${colName(c)}$${mLast}`;
  const labelsCol = `$${colName(TP.label)}$${docRow(1)}:$${colName(TP.label)}$${docRow(N)}`;
  const realRows = fit.map((r, n) => ({ label: r[0]!, row: mFirst + n })).filter((x) => x.label !== -1);
  const realSizes = realRows.length ? `$${colName(MAP0 + 1)}$${realRows[0]!.row}:$${colName(MAP0 + 1)}$${realRows[realRows.length - 1]!.row}` : null;
  const rows = Math.max(N, fit.length);
  for (let n = 0; n < rows; n++) {
    const r = docRow(n + 1);
    const cells: any[] = [];
    if (n < N) {
      const c = (k: number) => `${colName(k)}${r}`;
      cells.push(
        n + 1,
        ctx.title(n),
        F(cell(SHEET.labels, ctx.labelCol, r)),
        F(`INDEX(${mcol(MAP0 + 4)},MATCH(${c(TP.label)},${mcol(MAP0)},0))`),
        t.topicsFit[n] ?? null,
        F(`IF(${c(TP.fit)}=${c(TP.fitL)},0,"BEDA")`),
        red ? F(`INDEX(${mcol(MAP0 + 7)},MATCH(${c(TP.label)},${mcol(MAP0)},0))`) : '',
        red ? (t.topicsReduced?.[n] ?? null) : '',
        red ? F(`IF(${c(TP.red)}=${c(TP.redL)},0,"BEDA")`) : '',
        F(red ? c(TP.red) : c(TP.fit)),
        null, // final — filled in by fillFinalTopics once the outlier sheet exists
        t.topicsFinal[n] ?? null,
        F(`IF(${c(TP.final)}=${c(TP.finalL)},0,"BEDA")`),
        '',
      );
    } else {
      cells.push(...Array(MAP0).fill(''));
    }
    if (n < fit.length) {
      const m = fit[n]!;
      const c = (k: number) => `${colName(k)}${r}`;
      cells.push(
        m[0]!,
        F(`COUNTIF(${labelsCol},${c(MAP0)})`),
        F(`IFERROR(MATCH(${c(MAP0)},${labelsCol},0),"")`),
        F(`IF(${c(MAP0)}=-1,-1,SUMPRODUCT((${mcol(MAP0)}<>-1)*(${mcol(MAP0 + 1)}>${c(MAP0 + 1)}))+SUMPRODUCT((${mcol(MAP0)}<>-1)*(${mcol(MAP0 + 1)}=${c(MAP0 + 1)})*(${mcol(MAP0 + 2)}<${c(MAP0 + 2)})))`),
        m[m.length - 1]!,
        m[0] === -1 || !realSizes
          ? F(`IF(${c(MAP0 + 4)}=-1,0,"BEDA")`)
          : F(`${c(MAP0 + 1)}-LARGE(${realSizes},${c(MAP0 + 4)}+1)`),
        FS(`IF(${c(MAP0 + 3)}=${c(MAP0 + 4)},"sama","beda — seri diurutkan pustaka")`),
        red ? (redByLabel.get(m[0]!) ?? null) : '',
      );
    }
    s.row(cells);
  }
  ctx.check('BERTopic: nomor topik mengikuti urutan ukuran', SHEET.topics, MAP0 + 5, mFirst, MAP0 + 5, mLast, 0, 'Dibandingkan sebagai ukuran agar tidak bergantung pada urutan seri.');
  ctx.check('BERTopic: topik fit tiap dokumen', SHEET.topics, TP.dFit, docRow(1), TP.dFit, docRow(N), 0, '');
  if (red) {
    ctx.check('BERTopic: topik sesudah reduksi nr_topics', SHEET.topics, TP.dRed, docRow(1), TP.dRed, docRow(N), 0, '');
    ctx.gaps.push(
      'Reduksi nr_topics: BERTopic menggabungkan topik dengan AgglomerativeClustering (average linkage) atas jarak cosine centroid topik, lalu menomori ulang menurut ukuran. Pemetaan hasilnya dicatat dan dipakai sebagai MASUKAN (kolom "Topik sesudah reduksi (pustaka)" di tabel kanan); penggabungan iteratifnya tidak ditulis ulang sebagai rumus.',
    );
  }
}

/** Outlier re-homing: one block per strategy step, then the final topic column. */
export function buildRehoming(ctx: BuildContext): void {
  const t = ctx.t;
  const N = ctx.N;
  const D = ctx.D;
  const steps = t.rehoming ?? [];
  if (!steps.length) return;
  const te = t.topicEmbeddingsReduced ?? t.topicEmbeddingsFit;
  const teRows = te ? ctx.matrix(te.embeddings) : [];
  const offset = te?.outliersRow ?? 0;
  const s = ctx.sheet(SHEET.rehome, [7, 30, ...Array(Math.min(D, 40)).fill(11)]);
  s.row(['PENEMPATAN ULANG OUTLIER (reduce_outliers)']);
  s.row([
    `Strategi "embeddings": kemiripan = cosine(vektor dokumen, rerata vektor anggota tiap topik). Kemiripan di bawah ambang (P_OUTTHR) dijadikan 0; dokumen dipindah ke topik dengan kemiripan terbesar bila masih ada yang > 0, selain itu tetap −1. Strategi lain (c-tf-idf, probabilities, distributions) dicatat sebagai hasil pustaka.`,
  ]);
  const before = `${q(SHEET.topics)}!$${colName(ctx.beforeRehomeCol)}$${docRow(1)}:$${colName(ctx.beforeRehomeCol)}$${docRow(N)}`;
  const needCentroids = steps.some((st) => st.strategy === 'embeddings' && st.similarity);
  const topicIds = steps.find((st) => st.topicIds)?.topicIds ?? [];
  const cRow = new Map<number, number>();
  if (needCentroids && teRows.length) {
    s.blank();
    s.row(['RERATA VEKTOR TIAP TOPIK (topic_embeddings_) — rerata vektor ASLI anggota (bukan vektor unit)']);
    const C0 = 2;
    const NORM = C0 + D;
    const DIST = NORM + 1;
    const REC0 = DIST + 1;
    s.row(['Topik', 'Anggota', ...Array.from({ length: D }, (_, k) => `c${k + 1} (rumus)`), '‖c‖', 'Jarak ke centroid pustaka', ...Array.from({ length: D }, (_, k) => `c${k + 1} (pustaka)`)]);
    const firstC = s.next;
    topicIds.forEach((tid, n) => {
      const r = s.next;
      cRow.set(tid, r);
      const rec = teRows[offset + n] ?? [];
      const cells: any[] = [tid, F(`COUNTIF(${before},A${r})`)];
      for (let k = 0; k < D; k++) {
        const vc = `${q(SHEET.vec)}!$${colName(ctx.vecCol0 + k)}$${docRow(1)}:$${colName(ctx.vecCol0 + k)}$${docRow(N)}`;
        cells.push(F(`AVERAGEIF(${before},$A${r},${vc})`));
      }
      cells.push(
        F(`SQRT(SUMSQ(${colName(C0)}${r}:${colName(C0 + D - 1)}${r}))`),
        F(`SQRT(SUMXMY2(${colName(C0)}${r}:${colName(C0 + D - 1)}${r},${colName(REC0)}${r}:${colName(REC0 + D - 1)}${r}))`),
        ...rec,
      );
      s.row(cells);
    });
    ctx.check('Outlier: rerata vektor topik vs pustaka (jarak Euclid)', SHEET.rehome, DIST, firstC, DIST, s.next - 1, 1e-5, 'Pustaka merata-rata dalam float32.');
    ctx.rehomeCentroid = { C0, NORM, rowOf: cRow };
  }

  steps.forEach((st, si) => {
    s.blank();
    s.row([`LANGKAH ${si + 1}: strategi "${st.strategy}", ambang ${st.threshold}${st.error ? ` — gagal: ${st.error}` : ''}`]);
    const sim = st.similarity ? ctx.matrix(st.similarity) : null;
    const T = (st.topicIds ?? topicIds).length;
    const SIM = 2;
    const REC = SIM + T;
    const DS = REC + T;
    const TH = DS + T;
    const PR = TH + T;
    const PRL = PR + 1;
    const PRD = PR + 2;
    const ids = st.topicIds ?? topicIds;
    const idRow = s.row([
      'Dok #',
      'Jabatan',
      ...ids,
      ...ids.map((x) => `${x} (pustaka)`),
      ...ids.map((x) => `Δ ${x}`),
      ...ids.map((x) => `${x} sesudah ambang`),
      'Usulan (rumus)',
      'Usulan (pustaka)',
      'Selisih',
    ]);
    const idRange = `$${colName(SIM)}$${idRow}:$${colName(SIM + T - 1)}$${idRow}`;
    const firstR = s.next;
    st.outlierIdx.forEach((i, n) => {
      const r = s.next;
      const cells: any[] = [i + 1, ctx.title(i)];
      const canFormula = st.strategy === 'embeddings' && sim && ctx.rehomeCentroid;
      for (let j = 0; j < T; j++) {
        if (canFormula) {
          const cr = ctx.rehomeCentroid!.rowOf.get(ids[j]!)!;
          const cent = `$${colName(ctx.rehomeCentroid!.C0)}$${cr}:$${colName(ctx.rehomeCentroid!.C0 + D - 1)}$${cr}`;
          const vrow = rowRange(SHEET.vec, ctx.vecCol0, D, docRow(i + 1));
          cells.push(F(`SUMPRODUCT(${vrow},${cent})/(${cell(SHEET.vec, ctx.normCol, docRow(i + 1))}*$${colName(ctx.rehomeCentroid!.NORM)}$${cr})`));
        } else {
          cells.push(sim ? sim[n]![j]! : '');
        }
      }
      for (let j = 0; j < T; j++) cells.push(sim ? sim[n]![j]! : '');
      for (let j = 0; j < T; j++) cells.push(canFormula ? F(`${colName(SIM + j)}${r}-${colName(REC + j)}${r}`) : '');
      for (let j = 0; j < T; j++) cells.push(sim ? F(`IF(${colName(SIM + j)}${r}<P_OUTTHR,0,${colName(SIM + j)}${r})`) : '');
      const th = `${colName(TH)}${r}:${colName(TH + T - 1)}${r}`;
      cells.push(
        sim ? F(`IF(SUM(${th})>0,INDEX(${idRange},MATCH(MAX(${th}),${th},0)),-1)`) : '',
        st.proposed[n] ?? null,
        sim ? F(`IF(${colName(PR)}${r}=${colName(PRL)}${r},0,"BEDA")`) : '',
      );
      s.row(cells);
      const ref = `${q(SHEET.rehome)}!$${colName(sim ? PR : PRL)}$${r}`;
      const list = ctx.rehomeRefs.get(i) ?? [];
      list.push(ref);
      ctx.rehomeRefs.set(i, list);
    });
    const lastR = s.next - 1;
    if (st.outlierIdx.length && sim) {
      if (st.strategy === 'embeddings' && ctx.rehomeCentroid) {
        ctx.check(`Outlier langkah ${si + 1}: kemiripan cosine ke topik`, SHEET.rehome, DS, firstR, DS + T - 1, lastR, 1e-5, 'Pustaka menghitung dalam float32.');
      }
      ctx.check(`Outlier langkah ${si + 1}: usulan topik (ambang + argmax)`, SHEET.rehome, PRD, firstR, PRD, lastR, 0, '');
    }
    if (!sim) ctx.gaps.push(`Penempatan outlier langkah ${si + 1} (strategi "${st.strategy}"): kemiripan per topik tidak tercatat untuk strategi ini — usulan topik dibaca dari pustaka.`);
    if (st.strategy === 'c-tf-idf' && sim) ctx.gaps.push(`Penempatan outlier langkah ${si + 1} (strategi c-tf-idf): kemiripan dihitung pustaka dari tokenisasi dokumen outlier (masukan); ambang dan pemilihan topiknya rumus.`);
  });
  void N;
}

/** Fill "Topik akhir (rumus)": the topic before re-homing, or what re-homing proposed. */
export function fillFinalTopics(ctx: BuildContext): void {
  const s = ctx.sheets.get(SHEET.topics)!;
  for (let i = 0; i < ctx.N; i++) {
    const r = docRow(i + 1);
    const before = `${colName(ctx.beforeRehomeCol)}${r}`;
    const refs = ctx.rehomeRefs.get(i) ?? [];
    let f = '-1';
    for (let n = refs.length - 1; n >= 0; n--) f = `IF(${refs[n]}<>-1,${refs[n]},${f})`;
    s.rows[r - 1]![ctx.finalTopicCol] = F(refs.length ? `IF(${before}<>-1,${before},${f})` : before);
  }
  ctx.check('Topik akhir tiap dokumen (sesudah penempatan outlier)', SHEET.topics, TP.dFinal, docRow(1), TP.dFinal, docRow(ctx.N), 0, '');
}
