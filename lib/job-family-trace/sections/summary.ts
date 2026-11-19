// "Panduan" (how to read the workbook) and "Ringkasan" (identity + every
// check, counted live: change an input and the mismatch counts follow).

import { BuildContext, SHEET } from '../context';
import { DATE_TIME, FS, N, mismatchCountF, serialOf } from '../../run-trace/sheet';

const STAGES: [string, string, string][] = [
  ['0', SHEET.params, 'Parameter BERTopic yang dikonfigurasi, nilai efektif sesudah dijepit ke ukuran korpus (rumus), dan konstanta pustaka — semuanya bernama sel P_….'],
  ['0', SHEET.db, 'Kondisi database: sidik korpus, model, status job profile, dan parameter — saat run vs kini.'],
  ['1', SHEET.docs + ', ' + SHEET.lines, 'Data mentah job profile (nilai token hasil ekstraksi) + template restrukturisasi → dokumen yang di-embed, baris demi baris.'],
  ['1', SHEET.vec + ', ' + SHEET.cos, 'Vektor embedding (masukan), norma ‖x‖, dan matriks jarak cosine d = 1 − Σx_i·x_j/(‖x_i‖·‖x_j‖).'],
  ['2', SHEET.knn + ', ' + SHEET.sigma, 'UMAP: k tetangga terdekat, ρ, pencarian biner σ (64 iterasi tertulis), bobot keanggotaan w.'],
  ['2', SHEET.graph + ', ' + SHEET.curve + ', ' + SHEET.layout, 'UMAP: graf fuzzy P = w + wᵀ − w·wᵀ, pemangkasan, kurva a/b (gradien SSE ≈ 0), koordinat hasil optimasi.'],
  ['3', SHEET.euclid + ', ' + SHEET.core + ', ' + SHEET.mst, 'HDBSCAN: jarak Euclid, jarak inti, pohon rentang atas mutual reachability.'],
  ['3', SHEET.uf + ', ' + SHEET.sl, 'HDBSCAN: union-find → pohon single linkage → kondensasi (urutan BFS, pecah sejati, label klaster).'],
  ['3', SHEET.points + ', ' + SHEET.clusters + ', ' + SHEET.select, 'HDBSCAN: titik jatuh, klaster terkondensasi, stabilitas, seleksi Excess of Mass.'],
  ['3', SHEET.labels + ', ' + SHEET.ancestors + ', ' + SHEET.soft, 'HDBSCAN: label, probabilitas keras, leluhur & tinggi gabung, vektor keanggotaan lunak.'],
  ['4', SHEET.topics + (', ' + SHEET.rehome), 'BERTopic: label → nomor topik (urut ukuran), reduksi nr_topics, penempatan ulang outlier, topik akhir.'],
  ['5', SHEET.ctCounts + ', ' + SHEET.ctVocab + ', ' + SHEET.ctTopics, 'c-TF-IDF: hitungan kata per topik → tf → idf → bobot → kata kunci → label.'],
  ['6', SHEET.reasons + ', ' + SHEET.proj + ', ' + SHEET.reps, 'Alasan dokumen (centroid, famili alternatif, kata kunci cocok), proyeksi 2-D, dokumen representatif.'],
  ['7', SHEET.hier + ', ' + SHEET.gen + ', ' + SHEET.seeds, 'Family Tree (Ward), generalisasi simpul, stabilitas benih (ARI).'],
  ['8', SHEET.result, 'Hasil akhir: famili tiap dokumen dan ringkasan famili vs yang ditampilkan peta.'],
];

export function buildSummary(ctx: BuildContext): void {
  const b = ctx.b;
  const t = ctx.t;
  const s = ctx.sheet(SHEET.summary, [56, 22, 14, 80]);
  s.row(['RINGKASAN PETA JOB FAMILY & PEMERIKSAAN']);
  s.blank();
  const kv = (k: string, v: unknown) => s.row([k, v == null || v === '' ? '—' : (v as any)]);
  kv('Run', b.run.id);
  kv('Status', b.run.status);
  kv('Cakupan', b.run.tenantId ? `Business unit ${b.tenantName ?? b.run.tenantId}` : 'Global (seluruh korpus)');
  s.row(['Dibuat', N(serialOf(b.run.createdAt), DATE_TIME)]);
  s.row(['Selesai', N(serialOf(b.run.completedAt), DATE_TIME)]);
  s.row(['Workbook dibuat', N(serialOf(b.generatedAt), DATE_TIME)]);
  kv('Dokumen dikelompokkan (N)', ctx.N);
  kv('Dimensi vektor (D)', ctx.D);
  kv('Model embedding', t.corpus.embeddingModel ?? b.run.embeddingModel);
  kv('Famili', ctx.topicIds.length);
  kv('Outlier', t.topicsFinal.filter((x) => x === -1).length);
  kv('Versi config', b.run.configId);
  kv('Jejak perhitungan', `versi ${b.traceStatus.version ?? '?'}, ${b.traceStatus.bytes ?? '?'} byte terkompresi`);
  kv('Sidik korpus saat run', t.corpus.fingerprint);
  kv('Sidik korpus kini', b.now.corpus?.fingerprint ?? null);
  s.row([
    'Korpus masih sama?',
    b.now.corpus?.fingerprint
      ? b.now.corpus.fingerprint === t.corpus.fingerprint
        ? 'ya — peta menggambarkan korpus yang ter-embed sekarang'
        : 'TIDAK — korpus berubah sejak run ini; workbook tetap menurunkan run ini dari vektor yang dikelompokkannya'
      : 'tidak dapat dibandingkan',
  ]);
  s.blank();
  s.row(['PEMERIKSAAN INTERNAL TOPIC-SERVICE SAAT RUN (rekaman ulang vs model pustaka)']);
  const internal: [string, Record<string, unknown> | undefined][] = [
    ['UMAP', t.umap.checks],
    ['HDBSCAN', t.hdbscan.checks],
    ['c-TF-IDF', t.ctfidf.checks],
  ];
  for (const [name, checks] of internal) {
    for (const [k, v] of Object.entries(checks ?? {})) s.row([`${name}: ${k}`, typeof v === 'number' || typeof v === 'boolean' ? v : String(v)]);
  }
  s.blank();
  s.row(['PEMERIKSAAN — rumus di workbook ini vs angka yang dicatat pustaka dan yang tersimpan di peta (dihitung langsung)']);
  s.row(['Tahap', 'Jumlah selisih', 'Toleransi', 'Keterangan']);
  for (const c of ctx.checks) {
    const r = s.next;
    s.row([c.label, mismatchCountF(c.range, `$C$${r}`), c.tolerance, c.note]);
  }
  const last = s.next - 1;
  const first = last - ctx.checks.length + 1;
  s.blank();
  s.row([
    'Status keseluruhan',
    ctx.checks.length ? FS(`IF(SUM(B${first}:B${last})=0,"SEMUA COCOK","ADA SELISIH — lihat baris di atas")`) : 'Tidak ada pemeriksaan (data tidak cukup)',
  ]);
}

export function buildGuide(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.guide, [10, 34, 120]);
  const b = ctx.b;
  s.row(['TRACE PERHITUNGAN PETA JOB FAMILY (BERTopic: embedding → UMAP → HDBSCAN → c-TF-IDF)']);
  s.row(['', 'Run', `${b.run.id}${b.run.completedAt ? ` — selesai ${b.run.completedAt}` : ''}`]);
  s.blank();
  s.row(['', 'Tujuan', 'Verifikasi dan penelusuran manual: setiap angka antara data mentah job profile dan famili akhir diturunkan ulang di sini dengan RUMUS EXCEL yang hidup, di samping angka yang dicatat pustaka (topic-service) dan yang tersimpan di peta.']);
  s.row(['', 'Cara membaca', 'Kolom bertajuk "(rumus)" dihitung oleh Excel; kolom "(pustaka)" adalah nilai yang dicatat topic-service dari model yang sedang di-fit; kolom "tersimpan" adalah baris peta di database; kolom "Selisih" = rumus − pustaka/tersimpan. Lembar Ringkasan menghitung jumlah selisih per tahap secara langsung.']);
  s.row(['', 'Parameter', 'Semua parameter dirujuk lewat NAMA SEL (P_K, P_MCS, P_RFW, …) di lembar Parameter. Ubah nilainya untuk melihat tahap mana yang bergerak — rumus yang bergantung padanya menghitung ulang (lihat "Masukan vs rumus" untuk batasnya).']);
  s.row(['', 'Masukan vs rumus', 'MASUKAN (bukan rumus): nilai hasil ekstraksi job profile, vektor embedding dari model, indeks tetangga dan pohon rentang yang dipilih pustaka, koordinat hasil optimasi SGD UMAP (2-D maupun hasil reduksi), hitungan kata keluaran tokenizer, kata dalam dokumen (ada/tidak), partisi pembanding uji benih, dan judul/deskripsi dari model bahasa. Semua langkah sesudahnya adalah rumus. Mengubah parameter tidak memilih ulang tetangga, tidak mengoptimasi ulang tata letak, dan tidak menokenisasi ulang — tahap itu adalah algoritma iteratif/stokastik, bukan rumus sel.']);
  s.row(['', 'Presisi', 'Pustaka bekerja dalam float32 (vektor, jarak cosine, bobot graf, centroid) atau float64 (HDBSCAN, c-TF-IDF); Excel menghitung dalam double. Toleransi tiap pemeriksaan di Ringkasan mengikuti presisi tahapnya. Nilai tersimpan di peta bertipe real (float4).']);
  s.row(['', 'Seri (nilai sama)', 'Bila beberapa topik sama besar atau beberapa kata sama bobotnya, urutannya ditentukan algoritma pengurutan pustaka. Pemeriksaan untuk tahap itu membandingkan UKURAN/BOBOT pada urutan ke-k (LARGE), bukan identitasnya, sehingga tidak bergantung pada urutan seri.']);
  s.row(['', 'Aplikasi', 'Butuh Excel 2019 / Microsoft 365 atau LibreOffice Calc ≥ 6 (fungsi MAXIFS, MINIFS, TEXTJOIN). Lembar matriks (Jarak Cosine, Jarak Euclid, Union-Find) berukuran N × N; hitung ulang penuh bisa memakan beberapa detik sampai menit.']);
  s.row(['', 'Kerahasiaan', 'Workbook ini memuat isi job profile dan struktur organisasi. Unduhan ini dicatat di Riwayat Perubahan.']);
  s.blank();
  s.row(['Tahap', 'Lembar', 'Isi']);
  for (const [n, sheet, text] of STAGES) s.row([n, sheet, text]);
  s.blank();
  s.row(['', 'YANG TIDAK TERCATAT ATAU TIDAK DITURUNKAN PADA RUN INI']);
  const gaps = Array.from(new Set(ctx.gaps));
  if (gaps.length === 0) s.row(['', '—', 'Tidak ada: seluruh tahap dapat diturunkan ulang dari data yang dicatat run.']);
  for (const g of gaps) s.row(['', '•', g]);
}
