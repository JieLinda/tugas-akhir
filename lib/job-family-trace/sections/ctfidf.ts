// Stage 5: c-TF-IDF. Documents are concatenated per topic, tokenised by the
// fitted CountVectorizer (counts are the tokenizer's output — an input), then
// tf = count / tokens of the topic (L1), √tf when reduce_frequent_words,
// idf = ln(A / f + 1) (or the BM25 form) with f = the word's total count over
// all topics and A = INT(mean tokens per topic), weight = tf' × idf. Keywords
// are each topic's largest weights; the label is the first four.

import { BuildContext, SHEET, cell } from '../context';
import { F, FS, colName, fn, q } from '../../run-trace/sheet';

const HEAD = 3;
/** Kata Kunci: topic block row of topicOrder position `n`. */
const kkTopicRow = (n: number) => HEAD + 1 + n;
/** Kosakata: row of vocabulary term `v` (0-based). */
const vocabRow = (v: number) => HEAD + 1 + v;

export function buildCtfidf(ctx: BuildContext): void {
  const t = ctx.t;
  const ct = t.ctfidf;
  const order = ct.topicOrder;
  const vocab = ct.vocabulary;
  const w = ctx.flat(ct.weights);
  const idf = ctx.flat(ct.idf);
  const R = order.length;
  const N = ctx.N;

  // Triplets sorted by (topic row, term).
  const trip = ct.counts.row.map((r, n) => ({ r, c: ct.counts.col[n]!, v: ct.counts.val[n]!, w: w[n]! }));
  trip.sort((a, b) => a.r - b.r || a.c - b.c);

  // ── Counts ──
  const hc = ctx.sheet(SHEET.ctCounts, [8, 9, 26, 9, 11, 13, 13, 13, 14, 14, 11, 14]);
  hc.row(['c-TF-IDF — HITUNGAN KATA PER TOPIK DAN BOBOTNYA']);
  hc.row([
    `Satu baris per (topik, kata) yang muncul. "Jumlah" adalah keluaran tokenizer (CountVectorizer: n-gram ${ct.params.ngramRange.join('–')}, lowercase ${ct.params.lowercase}, pola token ${ct.params.tokenPattern}, ${ct.params.stopWordsCount ?? 0} stopword, min_df ${ct.params.minDf}, max_df ${ct.params.maxDf}) atas gabungan dokumen tiap topik sesudah pembersihan BERTopic (karakter non-alfanumerik dibuang) — MASUKAN. tf = jumlah / Σ token topik; tf' = √tf bila P_RFW; w = tf' × idf.`,
  ]);
  hc.row(['Topik', 'Indeks kata', 'Kata', 'Jumlah', 'Σ token topik', 'tf', "tf'", 'idf', 'w (rumus)', 'w (pustaka)', 'Selisih', 'w²']);
  const termRefs = new Map<number, string[]>();
  trip.forEach((x) => {
    const r = hc.next;
    const range = ctx.ctTopicRows.get(x.r);
    if (!range) ctx.ctTopicRows.set(x.r, { first: r, last: r });
    else range.last = r;
    ctx.ctCell.set(`${x.r}:${x.c}`, r);
    const refs = termRefs.get(x.c) ?? [];
    refs.push(`${q(SHEET.ctCounts)}!$D$${r}`);
    termRefs.set(x.c, refs);
    hc.row([
      order[x.r]!,
      x.c,
      FS(cell(SHEET.ctVocab, 1, vocabRow(x.c))),
      x.v,
      F(cell(SHEET.ctTopics, 1, kkTopicRow(x.r))),
      F(`D${r}/E${r}`),
      F(`IF(P_RFW,SQRT(F${r}),F${r})`),
      F(cell(SHEET.ctVocab, 3, vocabRow(x.c))),
      F(`G${r}*H${r}`),
      x.w,
      F(`I${r}-J${r}`),
      F(`I${r}^2`),
    ]);
  });
  const hcFirst = HEAD + 1;
  const hcLast = hc.next - 1;
  ctx.ctWeightCol = 8;
  ctx.check('c-TF-IDF: bobot kata per topik', SHEET.ctCounts, 10, hcFirst, 10, hcLast, 1e-12, '');
  const hcCol = (c: number) => `${q(SHEET.ctCounts)}!$${colName(c)}$${hcFirst}:$${colName(c)}$${hcLast}`;

  // ── Vocabulary ──
  const kv = ctx.sheet(SHEET.ctVocab, [9, 30, 12, 14, 14, 11]);
  kv.row(['c-TF-IDF — KOSAKATA DAN IDF']);
  kv.row(['f = frekuensi total kata di SEMUA topik (jumlah kolom matriks hitungan, termasuk topik −1). idf = ln(A/f + 1); dengan bm25_weighting: ln(1 + (A − f + 0,5)/(f + 0,5)). A = P_AVG (lembar ' + SHEET.ctTopics + ').']);
  kv.row(['Indeks', 'Kata', 'f (rumus)', 'idf (rumus)', 'idf (pustaka)', 'Selisih']);
  ctx.vocabFirst = HEAD + 1;
  vocab.forEach((word, v) => {
    const r = kv.next;
    const refs = termRefs.get(v) ?? [];
    kv.row([
      v,
      word,
      refs.length ? F(refs.join('+')) : 0,
      F(`IF(P_BM25,LN(1+((P_AVG-C${r}+0.5)/(C${r}+0.5))),LN(P_AVG/C${r}+1))`),
      idf[v] ?? null,
      F(`D${r}-E${r}`),
    ]);
  });
  ctx.check('c-TF-IDF: idf tiap kata', SHEET.ctVocab, 5, HEAD + 1, 5, HEAD + vocab.length, 1e-12, '');

  // ── Topics, keywords, labels ──
  const kk = ctx.sheet(SHEET.ctTopics, [9, 12, 10, 12, 52, 52, 10, 6, 26, 14, 14, 14, 11, 11, 26, 14, 10, 10]);
  kk.row(['c-TF-IDF — TOPIK, KATA KUNCI, DAN LABEL']);
  kk.row([
    'Kata kunci = kata dengan bobot c-TF-IDF terbesar di topiknya (P_TOPN). Bobot yang sama besar sering terjadi; urutan di antara mereka ditentukan pustaka (argpartition/argsort), sehingga pemeriksaannya membandingkan BOBOT kata ke-k dengan LARGE(bobot topik, k), bukan identitas kata. Label = empat kata kunci pertama dipisah koma; topik −1 berlabel "Noise / Outlier".',
  ]);
  kk.row(['Topik', 'Σ token (rumus)', 'Kata unik', 'Dokumen anggota', 'Label (rumus)', 'Label tersimpan', 'Selisih']);
  const persistedByTopic = new Map(ctx.b.topics.map((x) => [x.topicId, x]));
  const labelRow = new Map<number, number>();
  order.forEach((tid, n) => {
    const r = kk.next;
    if (r !== kkTopicRow(n)) throw new Error('topic row drifted');
    labelRow.set(tid, r);
    kk.row([
      tid,
      F(`SUMIF(${hcCol(0)},A${r},${hcCol(3)})`),
      F(`COUNTIF(${hcCol(0)},A${r})`),
      F(`COUNTIF(${q(SHEET.topics)}!$${colName(ctx.finalTopicCol)}$4:$${colName(ctx.finalTopicCol)}$${3 + N},A${r})`),
      null, // label — filled once the keyword rows exist
      persistedByTopic.get(tid)?.label ?? '',
      F(`IF(EXACT(E${r},F${r}),0,"BEDA")`),
    ]);
  });
  const sumFirst = kkTopicRow(0);
  const sumLast = kkTopicRow(R - 1);
  kk.blank();
  const avgRow = kk.row(['A = INT(rerata Σ token per topik)', F(`INT(AVERAGE(B${sumFirst}:B${sumLast}))`), ct.avgNrSamples, F(`B${kk.next}-C${kk.next}`)]);
  ctx.name('P_AVG', SHEET.ctTopics, 1, avgRow);
  ctx.check('c-TF-IDF: A (rerata token per topik)', SHEET.ctTopics, 3, avgRow, 3, avgRow, 0, '');
  kk.blank();
  kk.row(['KATA KUNCI']);
  const kwHead = kk.row(['Topik', 'k', 'Kata (pustaka)', 'Skor (pustaka)', 'Bobot kata ini (rumus)', 'LARGE(bobot topik, k)', 'Selisih skor', 'Selisih urutan', 'Kata tersimpan', 'Skor tersimpan', 'Selisih tersimpan', 'Dokumen anggota']);
  const wordIndex = new Map(vocab.map((x, v) => [x, v]));
  const kwFirst = kwHead + 1;
  for (const [n, tid] of order.entries()) {
    const kws = ct.keywords[String(tid)] ?? [];
    const persisted = persistedByTopic.get(tid)?.keywords ?? [];
    const range = ctx.ctTopicRows.get(n);
    const rowsOfTopic: number[] = [];
    kws.forEach(([word, score], k) => {
      const r = kk.next;
      rowsOfTopic.push(r);
      const v = wordIndex.get(word);
      const tr = v == null ? undefined : ctx.ctCell.get(`${n}:${v}`);
      const pk = persisted[k];
      kk.row([
        tid,
        k + 1,
        word,
        score,
        tr ? F(`${q(SHEET.ctCounts)}!$I$${tr}`) : '',
        range ? F(`LARGE(${q(SHEET.ctCounts)}!$I$${range.first}:$I$${range.last},B${r})`) : '',
        F(`E${r}-D${r}`),
        F(`E${r}-F${r}`),
        pk?.word ?? '',
        pk?.score ?? null,
        F(`IF(AND(EXACT(C${r},I${r}),ABS(D${r}-J${r})<1E-12),0,"BEDA")`),
        F(`D$${labelRow.get(tid)}`),
      ]);
    });
    ctx.kwRows.set(tid, rowsOfTopic);
    // The label of this topic: its first four keywords, joined.
    const lr = labelRow.get(tid)!;
    const words = rowsOfTopic.slice(0, 4).map((r) => `C${r}`);
    kk.rows[lr - 1]![4] =
      tid === -1
        ? 'Noise / Outlier'
        : words.length
          ? FS(`${fn('TEXTJOIN')}(", ",TRUE,${words.join(',')})`)
          : FS(`"Topic ${tid}"`);
    ctx.labelCell.set(tid, `${q(SHEET.ctTopics)}!$E$${lr}`);
  }
  const kwLast = kk.next - 1;
  ctx.kwBlock = { first: kwFirst, last: kwLast };
  if (kwLast >= kwFirst) {
    ctx.check('c-TF-IDF: skor kata kunci = bobot kata itu', SHEET.ctTopics, 6, kwFirst, 6, kwLast, 1e-12, '');
    ctx.check('c-TF-IDF: kata kunci ke-k = bobot terbesar ke-k (aman terhadap seri)', SHEET.ctTopics, 7, kwFirst, 7, kwLast, 1e-12, '');
    ctx.check('c-TF-IDF: kata kunci = yang tersimpan di peta', SHEET.ctTopics, 10, kwFirst, 10, kwLast, 0, '');
  }
  ctx.check('Label topik = 4 kata kunci pertama', SHEET.ctTopics, 6, sumFirst, 6, sumLast, 0, '');
  void ctx.D;
}
