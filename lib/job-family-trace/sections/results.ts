// Stage 6: what the map shows. Per document: its family, the cosine to its own
// family centroid and to the nearest other one, and the family keywords found in
// its text; per family: the 2-D position, the representative documents, the
// size and label. Everything is compared with the rows the map persisted.

import { BuildContext, SHEET, cell, docRow, rowRange } from '../context';
import { F, FS, colName, fn, q } from '../../run-trace/sheet';

/** Maximum matched keywords per document (pipeline `_document_reasons`). */
const MAX_MATCHED = 6;

const finalCol = (ctx: BuildContext) => `${q(SHEET.topics)}!$${colName(ctx.finalTopicCol)}$${docRow(1)}:$${colName(ctx.finalTopicCol)}$${docRow(ctx.N)}`;
const finalCell = (ctx: BuildContext, i: number) => cell(SHEET.topics, ctx.finalTopicCol, docRow(i + 1));

/** Whether a persisted assignment was moved by hand after the build (outlier mapped manually). */
function manual(ctx: BuildContext, i: number): boolean {
  const p = ctx.persisted(i);
  return Boolean(p && (ctx.t.topicsFinal[i] ?? -1) === -1 && p.topicId !== -1 && p.probability == null);
}

export function buildReasons(ctx: BuildContext): void {
  const N = ctx.N;
  const D = ctx.D;
  const T = ctx.topicIds;
  const nT = T.length;
  const topN = Math.max(0, ...Object.values(ctx.t.ctfidf.keywords).map((k) => k.length));
  const SIM = 4;
  const ALT = SIM + nT;
  const OWN = ALT + nT;
  const OWNP = OWN + 1;
  const OWND = OWN + 2;
  const ASIM = OWN + 3;
  const AID = OWN + 4;
  const ASIMP = OWN + 5;
  const ASIMD = OWN + 6;
  const AIDP = OWN + 7;
  const AIDD = OWN + 8;
  const PRES = OWN + 9;
  const WORD = PRES + topN;
  const PICK = WORD + topN;
  const JOIN = PICK + topN;
  const JOINP = JOIN + 1;
  const JOIND = JOIN + 2;
  ctx.ownSimCol = OWN;
  ctx.altSimCol = ASIM;
  ctx.altIdCol = AID;
  const s = ctx.sheet(SHEET.reasons, [7, 30, 10, 9, ...Array(nT * 2).fill(10), 12, 12, 11, 12, 10, 12, 11, 10, 9, ...Array(topN * 3).fill(12), 40, 40, 9]);
  s.row(['ALASAN DOKUMEN — kemiripan ke centroid famili sendiri dan famili terdekat lain, dan kata kunci famili yang muncul di teks dokumen']);
  s.row([
    `Centroid famili = rerata vektor UNIT anggotanya (blok di bawah tabel). Kemiripan = cosine(vektor dokumen, centroid). Famili alternatif = famili lain dengan kemiripan terbesar. Kata kunci cocok = kata kunci famili (urut c-TF-IDF) yang ditemukan tokenizer di teks dokumen (masukan, 1/0), maksimal ${MAX_MATCHED}. Dokumen yang DIPETAKAN MANUAL sesudah run dilewati: nilai tersimpannya ditulis ulang oleh pemetaan itu.`,
  ]);
  const head: any[] = ['Dok #', 'Jabatan', 'Famili akhir', 'Dipetakan manual?', ...T, ...T.map((x) => `≠ sendiri: ${x}`)];
  head.push('Kemiripan famili sendiri (rumus)', 'Tersimpan', 'Selisih', 'Kemiripan alternatif (rumus)', 'Famili alternatif (rumus)', 'Kemiripan alternatif tersimpan', 'Selisih', 'Famili alternatif tersimpan', 'Selisih');
  for (let k = 1; k <= topN; k++) head.push(`Ada kata ${k}?`);
  for (let k = 1; k <= topN; k++) head.push(`Kata ${k}`);
  for (let k = 1; k <= topN; k++) head.push(`Dipilih ${k}`);
  head.push('Kata kunci cocok (rumus)', 'Tersimpan', 'Selisih');
  const hr = s.row(head);
  const idRow = `$${colName(SIM)}$${hr}:$${colName(SIM + nT - 1)}$${hr}`;
  const cbHead = docRow(N) + 3;
  const cFirst = cbHead + 1;
  const C0 = 2;
  const NORM = C0 + D;
  const cRow = (n: number) => cFirst + n;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const c = (k: number) => `${colName(k)}${r}`;
    const p = ctx.persisted(i);
    const isManual = manual(ctx, i);
    const f = ctx.t.topicsFinal[i] ?? -1;
    const kwRows = ctx.kwRows.get(f) ?? [];
    const pres = ctx.t.presence[i] ?? [];
    const cells: any[] = [i + 1, ctx.title(i), F(finalCell(ctx, i)), isManual ? 1 : 0];
    for (let n = 0; n < nT; n++) {
      cells.push(
        F(
          `SUMPRODUCT(${rowRange(SHEET.vec, ctx.vecCol0, D, r)},$${colName(C0)}$${cRow(n)}:$${colName(C0 + D - 1)}$${cRow(n)})/(${cell(SHEET.vec, ctx.normCol, r)}*$${colName(NORM)}$${cRow(n)})`,
        ),
      );
    }
    for (let n = 0; n < nT; n++) cells.push(F(`IF(${colName(SIM + n)}$${hr}=$C${r},-2,${colName(SIM + n)}${r})`));
    const simB = `${colName(SIM)}${r}:${colName(SIM + nT - 1)}${r}`;
    const altB = `${colName(ALT)}${r}:${colName(ALT + nT - 1)}${r}`;
    cells.push(
      nT ? F(`IF($C${r}=-1,"",INDEX(${simB},MATCH($C${r},${idRow},0)))`) : '',
      p?.centroidSimilarity ?? null,
      F(`IF(OR($D${r}=1,${c(OWNP)}=""),"",${c(OWN)}-${c(OWNP)})`),
      nT ? F(`IF(MAX(${altB})=-2,"",MAX(${altB}))`) : '',
      nT ? F(`IF(${c(ASIM)}="","",INDEX(${idRow},MATCH(${c(ASIM)},${altB},0)))`) : '',
      p?.altSimilarity ?? null,
      F(`IF(OR($D${r}=1,${c(ASIMP)}=""),"",${c(ASIM)}-${c(ASIMP)})`),
      p?.altTopicId ?? null,
      F(`IF($D${r}=1,0,IF(${c(AID)}&""=${c(AIDP)}&"",0,"BEDA"))`),
    );
    for (let k = 0; k < topN; k++) cells.push(k < pres.length ? (pres[k] ? 1 : 0) : '');
    for (let k = 0; k < topN; k++) cells.push(k < kwRows.length ? FS(`${q(SHEET.ctTopics)}!$C$${kwRows[k]}`) : '');
    for (let k = 0; k < topN; k++) {
      cells.push(
        k < pres.length
          ? FS(`IF(AND(${colName(PRES + k)}${r}=1,SUM(${colName(PRES)}${r}:${colName(PRES + k)}${r})<=${MAX_MATCHED}),${colName(WORD + k)}${r},"")`)
          : '',
      );
    }
    cells.push(
      topN ? FS(`${fn('TEXTJOIN')}(", ",TRUE,${colName(PICK)}${r}:${colName(PICK + topN - 1)}${r})`) : '',
      (p?.matchedKeywords ?? []).map((m) => m.word).join(', '),
      F(`IF($D${r}=1,0,IF(EXACT(${c(JOIN)},${c(JOINP)}),0,"BEDA"))`),
    );
    s.row(cells);
  }
  s.blank();
  s.row(['CENTROID FAMILI — m_k = rerata x_k/‖x‖ atas anggota (rerata vektor unit); kemiripan = Σ x·m / (‖x‖·‖m‖), sama dengan Σ u·(m/‖m‖)']);
  const ch = s.row(['Famili', 'Anggota', ...Array.from({ length: D }, (_, k) => `m${k + 1}`), '‖m‖']);
  if (ch !== cbHead) throw new Error('centroid header row drifted');
  T.forEach((tid, n) => {
    const r = s.next;
    if (r !== cRow(n)) throw new Error('centroid row drifted');
    const cells: any[] = [tid, F(`COUNTIF(${finalCol(ctx)},A${r})`)];
    const norms = `${q(SHEET.vec)}!$${colName(ctx.normCol)}$${docRow(1)}:$${colName(ctx.normCol)}$${docRow(N)}`;
    for (let k = 0; k < D; k++) {
      const vc = `${q(SHEET.vec)}!$${colName(ctx.vecCol0 + k)}$${docRow(1)}:$${colName(ctx.vecCol0 + k)}$${docRow(N)}`;
      cells.push(F(`SUMPRODUCT((${finalCol(ctx)}=$A${r})*${vc}/${norms})/$B${r}`));
    }
    cells.push(F(`SQRT(SUMSQ(${colName(C0)}${r}:${colName(C0 + D - 1)}${r}))`));
    s.row(cells);
  });
  const f0 = docRow(1);
  const fN = docRow(N);
  if (nT) {
    ctx.check('Alasan dokumen: kemiripan ke famili sendiri', SHEET.reasons, OWND, f0, OWND, fN, 1e-5, 'Pustaka menghitung dalam float32; disimpan sebagai real.');
    ctx.check('Alasan dokumen: kemiripan ke famili alternatif', SHEET.reasons, ASIMD, f0, ASIMD, fN, 1e-5, '');
    ctx.check('Alasan dokumen: famili alternatif', SHEET.reasons, AIDD, f0, AIDD, fN, 0, '');
  }
  if (topN) ctx.check('Alasan dokumen: kata kunci cocok', SHEET.reasons, JOIND, f0, JOIND, fN, 0, '');
}

export function buildProjection(ctx: BuildContext): void {
  const N = ctx.N;
  const p2 = ctx.t.projection2d;
  const xy = ctx.matrix(p2.coords);
  const s = ctx.sheet(SHEET.proj, [7, 30, 13, 13, 13, 13, 11, 11, 10]);
  s.row(['PROYEKSI 2-D (peta sebar) — UMAP terpisah dari reduksi pengelompokan']);
  s.row([
    `UMAP kedua atas vektor ASLI dengan n_neighbors = max(2, min(15, N − 1)) = ${p2.params?.nNeighbors ?? '—'}, n_components 2, min_dist 0,1 (a = ${p2.params?.a ?? '—'}, b = ${p2.params?.b ?? '—'}), metric dan benih yang sama. Koordinatnya hasil optimasi (masukan); posisi famili = rerata koordinat anggotanya (rumus).`,
  ]);
  s.row(['Dok #', 'Jabatan', 'x (jejak)', 'y (jejak)', 'x tersimpan', 'y tersimpan', 'Selisih x', 'Selisih y', 'Famili akhir']);
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const p = ctx.persisted(i);
    s.row([
      i + 1,
      ctx.title(i),
      xy[i]?.[0] ?? null,
      xy[i]?.[1] ?? null,
      p?.x ?? null,
      p?.y ?? null,
      p?.x == null ? '' : F(`C${r}-E${r}`),
      p?.y == null ? '' : F(`D${r}-F${r}`),
      F(finalCell(ctx, i)),
    ]);
  }
  ctx.check('Proyeksi 2-D: koordinat dokumen vs tersimpan', SHEET.proj, 6, docRow(1), 7, docRow(N), 1e-4, 'Tersimpan sebagai real (float4).');
  s.blank();
  s.row(['POSISI FAMILI = rerata koordinat anggota']);
  s.row(['Famili', 'Anggota', 'x̄ (rumus)', 'ȳ (rumus)', 'x tersimpan', 'y tersimpan', 'Selisih x', 'Selisih y']);
  const ids = Array.from(new Set(ctx.t.topicsFinal)).sort((a, b) => a - b);
  const xs = `$C$${docRow(1)}:$C$${docRow(N)}`;
  const ys = `$D$${docRow(1)}:$D$${docRow(N)}`;
  const ts = `$I$${docRow(1)}:$I$${docRow(N)}`;
  const first = s.next;
  for (const tid of ids) {
    const r = s.next;
    const pt = ctx.b.topics.find((x) => x.topicId === tid);
    s.row([
      tid,
      F(`COUNTIF(${ts},A${r})`),
      F(`AVERAGEIF(${ts},A${r},${xs})`),
      F(`AVERAGEIF(${ts},A${r},${ys})`),
      pt?.x ?? null,
      pt?.y ?? null,
      pt?.x == null ? '' : F(`C${r}-E${r}`),
      pt?.y == null ? '' : F(`D${r}-F${r}`),
    ]);
  }
  ctx.check('Proyeksi 2-D: posisi famili', SHEET.proj, 6, first, 7, s.next - 1, 1e-4, '');
}

export function buildRepresentatives(ctx: BuildContext): void {
  const N = ctx.N;
  const s = ctx.sheet(SHEET.reps, [7, 12, 30, 10, 14, 14, 10, 12, 12, 12, 12, 12, 12, 9]);
  s.row(['DOKUMEN REPRESENTATIF — tiga anggota dengan keanggotaan tertinggi per famili']);
  s.row(['Peringkat dalam famili = 1 + banyak anggota dengan keanggotaan lebih tinggi + banyak anggota bernilai sama dengan Dok # lebih kecil (pengurutan stabil Python). Keanggotaan kosong dihitung 0.']);
  s.row(['Dok #', 'ID job profile', 'Jabatan', 'Famili akhir', 'Keanggotaan', 'Nilai urut', 'Peringkat dalam famili']);
  const probRef = (i: number) =>
    ctx.probPerDocCol >= 0 ? cell(SHEET.soft, ctx.probPerDocCol, docRow(i + 1)) : cell(SHEET.labels, ctx.hardProbCol, docRow(i + 1));
  const col = (c: string) => `$${c}$${docRow(1)}:$${c}$${docRow(N)}`;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    s.row([
      i + 1,
      ctx.t.corpus.meta[i]!.jobProfileId,
      ctx.title(i),
      F(finalCell(ctx, i)),
      F(probRef(i)),
      F(`IF(ISNUMBER(E${r}),E${r},0)`),
      F(`1+SUMPRODUCT((${col('D')}=D${r})*(${col('F')}>F${r}))+SUMPRODUCT((${col('D')}=D${r})*(${col('F')}=F${r})*(${col('A')}<A${r}))`),
    ]);
  }
  s.blank();
  s.row(['PER FAMILI']);
  s.row(['Famili', 'Anggota', 'Rep 1 (rumus)', 'Rep 2 (rumus)', 'Rep 3 (rumus)', 'Rep 1 tersimpan', 'Rep 2 tersimpan', 'Rep 3 tersimpan', 'Selisih']);
  const ids = Array.from(new Set(ctx.t.topicsFinal)).sort((a, b) => a - b);
  const first = s.next;
  for (const tid of ids) {
    const r = s.next;
    const pt = ctx.b.topics.find((x) => x.topicId === tid);
    const reps = pt?.representativeDocIds ?? [];
    const repF = (k: number) => F(`IF(B${r}<${k},"",SUMPRODUCT((${col('D')}=A${r})*(${col('G')}=${k})*${col('B')}))`);
    s.row([
      tid,
      F(`COUNTIF(${col('D')},A${r})`),
      repF(1),
      repF(2),
      repF(3),
      reps[0] ?? null,
      reps[1] ?? null,
      reps[2] ?? null,
      F(`IF(AND(C${r}&""=F${r}&"",D${r}&""=G${r}&"",E${r}&""=H${r}&""),0,"BEDA")`),
    ]);
  }
  ctx.check('Dokumen representatif per famili', SHEET.reps, 8, first, 8, s.next - 1, 0, '');
}

export function buildFinal(ctx: BuildContext): void {
  const N = ctx.N;
  const b = ctx.b;
  const s = ctx.sheet(SHEET.result, [7, 12, 30, 28, 10, 10, 18, 13, 13, 11, 52]);
  s.row(['HASIL AKHIR — famili tiap dokumen dan ringkasan famili, dibanding dengan yang ditampilkan peta']);
  s.row(['"Dipetakan manual" = dokumen outlier yang sesudah run dipindahkan tangan ke sebuah famili (probability dikosongkan oleh pemetaan itu) — bukan selisih perhitungan.']);
  s.row(['Dok #', 'ID job profile', 'Jabatan', 'Divisi / Departemen', 'Famili (rumus)', 'Famili tersimpan', 'Status', 'Keanggotaan (rumus)', 'Keanggotaan tersimpan', 'Selisih', 'Label famili (rumus)']);
  const probRef = (i: number) =>
    ctx.probPerDocCol >= 0 ? cell(SHEET.soft, ctx.probPerDocCol, docRow(i + 1)) : cell(SHEET.labels, ctx.hardProbCol, docRow(i + 1));
  const kkTopics = `${q(SHEET.ctTopics)}!$A$4:$A$${3 + ctx.t.ctfidf.topicOrder.length}`;
  const kkLabels = `${q(SHEET.ctTopics)}!$E$4:$E$${3 + ctx.t.ctfidf.topicOrder.length}`;
  for (let i = 0; i < N; i++) {
    const r = docRow(i + 1);
    const p = ctx.persisted(i);
    const m = ctx.t.corpus.meta[i]!;
    s.row([
      i + 1,
      m.jobProfileId,
      ctx.title(i),
      m.divisionDepartment ?? '',
      F(finalCell(ctx, i)),
      p?.topicId ?? null,
      F(`IF(E${r}=F${r},0,IF(AND(E${r}=-1,F${r}<>-1,I${r}=""),"Dipetakan manual","BEDA"))`),
      F(probRef(i)),
      p?.probability ?? null,
      F(`IF(I${r}="","",H${r}-I${r})`),
      FS(`IFERROR(INDEX(${kkLabels},MATCH(E${r},${kkTopics},0)),"")`),
    ]);
  }
  ctx.check('Hasil akhir: famili tiap dokumen = yang tersimpan di peta', SHEET.result, 6, docRow(1), 6, docRow(N), 0, '"Dipetakan manual" tidak dihitung sebagai selisih.');
  ctx.check('Hasil akhir: keanggotaan tersimpan', SHEET.result, 9, docRow(1), 9, docRow(N), 1e-6, '');
  s.blank();
  s.row(['FAMILI']);
  s.row(['Famili', 'Ukuran (rumus)', 'Ukuran tersimpan', 'Selisih', 'Label (rumus)', 'Label tersimpan', 'Judul umum', 'Deskripsi umum', 'Kata kunci tersimpan']);
  const first = s.next;
  const fcol = `$E$${docRow(1)}:$E$${docRow(N)}`;
  for (const pt of b.topics) {
    const r = s.next;
    ctx.topicSizeCell.set(pt.topicId, `${q(SHEET.result)}!$B$${r}`);
    s.row([
      pt.topicId,
      F(`COUNTIF(${fcol},A${r})`),
      pt.size,
      F(`B${r}-C${r}`),
      ctx.labelCell.has(pt.topicId) ? FS(ctx.labelCell.get(pt.topicId)!) : '',
      pt.label ?? '',
      pt.generalTitle ?? '',
      pt.generalDescription ?? '',
      pt.keywords.map((k) => k.word).join(', '),
    ]);
  }
  ctx.check('Hasil akhir: ukuran famili', SHEET.result, 3, first, 3, s.next - 1, 0, '');
}
