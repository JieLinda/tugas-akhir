// Stage 0–1: parameters, the database state, the raw job profiles and the
// documents they became, the document vectors, unit vectors, and the cosine
// distance matrix UMAP's neighbour search reads.

import { BuildContext, DOC_HEAD, SHEET, cell, docRow, rowRange } from '../context';
import { DATE_TIME, F, FB, FS, N, colName, deltaF, fn, serialOf, str } from '../../run-trace/sheet';
import { TEMPLATE_TOKENS, tokenValuesOf, type ExtractedJobProfileData } from '../../job-family/restructure';
import { DEFAULT_JOB_FAMILY_CONFIG } from '../../job-family/config';

const MAX_CELL_TEXT = 32000;

// ── Parameter ──────────────────────────────────────────────────────────

export function buildParameters(ctx: BuildContext): void {
  const t = ctx.t;
  const s = ctx.sheet(SHEET.params, [34, 18, 18, 16, 14, 90]);
  s.row(['PARAMETER, KONSTANTA, DAN NILAI EFEKTIF']);
  s.row(['Setiap parameter dirujuk lewat NAMA SEL (P_…). "Dikonfigurasi" = isian run; "Efektif" = nilai yang benar-benar dipakai pipeline sesudah dijepit ke ukuran korpus, dengan rumusnya; "Tercatat" = nilai yang dicatat topic-service.']);
  s.row(['Parameter', 'Dikonfigurasi', 'Efektif (rumus)', 'Tercatat pipeline', 'Selisih', 'Keterangan']);
  const cfg = (t.config ?? {}) as Record<string, unknown>;
  const eff = (t.effective ?? {}) as Record<string, unknown>;
  const def = DEFAULT_JOB_FAMILY_CONFIG.bertopic as unknown as Record<string, unknown>;
  const configured = (k: string) => (k in cfg ? cfg[k] : def[k] ?? null);
  const firstDelta = s.next;

  // P_N first: everything else clamps against it.
  const nRow = s.row(['Jumlah dokumen (N)', ctx.N, F(`COUNT(${cell(SHEET.vec, 0, docRow(1))}:${cell(SHEET.vec, 0, docRow(ctx.N))})`), ctx.N, null, 'Dokumen ber-embedding yang dikelompokkan, urut job_profile_id. Rumus menghitung baris di lembar Vektor.']);
  s.rows[nRow - 1]![4] = deltaF(`C${nRow}`, `D${nRow}`);
  ctx.name('P_N', SHEET.params, 2, nRow);
  const dRow = s.row(['Dimensi vektor (D)', ctx.D, F(`COUNT(${rowRange(SHEET.vec, 8, ctx.D, docRow(1))})`), ctx.D, null, 'Panjang vektor dokumen dari model embedding.']);
  s.rows[dRow - 1]![4] = deltaF(`C${dRow}`, `D${dRow}`);
  ctx.name('P_D', SHEET.params, 2, dRow);

  type Row = [label: string, key: string, name: string, effF: string | null, note: string];
  const rows: Row[] = [
    ['UMAP n_neighbors (k)', 'nNeighbors', 'P_K', `MAX(2,MIN(B{r},P_N-1))`, 'Dijepit ke [2, N−1]. k tetangga terdekat per dokumen, TERMASUK dirinya sendiri (jarak 0).'],
    ['UMAP n_components (d)', 'nComponents', 'P_NCOMP', `MAX(2,MIN(B{r},MAX(2,P_N-2)))`, 'Dimensi ruang hasil reduksi yang dikelompokkan HDBSCAN.'],
    ['UMAP min_dist', 'minDist', 'P_MINDIST', `B{r}`, 'Seberapa rapat titik boleh berkumpul di ruang hasil (menentukan a, b).'],
    ['UMAP metric', 'metric', 'P_METRIC', null, 'Ukuran jarak di ruang asli. "cosine": d = 1 − cos.'],
    ['HDBSCAN min_cluster_size', 'minClusterSize', 'P_MCS', `MAX(2,MIN(B{r},P_N))`, 'Ukuran famili terkecil. Juga ambang "runt" saat kondensasi pohon.'],
    ['HDBSCAN min_samples', 'minSamples', 'P_MS', `MAX(1,MIN(P_N-1,IF(B{r}="",P_MCS,B{r})))`, 'Kosong = min_cluster_size; pustaka menjepitnya ke [1, N−1]. Jarak inti = jarak ke tetangga ke-min_samples (tanpa menghitung dirinya sendiri).'],
    ['HDBSCAN cluster_selection_method', 'clusterSelectionMethod', 'P_METHOD', null, '"eom" (Excess of Mass) atau "leaf".'],
    ['HDBSCAN cluster_selection_epsilon', 'clusterSelectionEpsilon', 'P_EPS', `B{r}`, '0 = mati. Bila > 0, klaster yang lahir di bawah jarak ini digabung ke atas (lihat Panduan).'],
    ['CountVectorizer n-gram min', 'nGramMin', 'P_NGMIN', `MAX(1,B{r})`, 'Rentang n-gram token.'],
    ['CountVectorizer n-gram maks', 'nGramMax', 'P_NGMAX', `MAX(P_NGMIN,B{r})`, ''],
    ['CountVectorizer min_df', 'minDf', 'P_MINDF', `MAX(1,MIN(B{r},P_N))`, 'Diterapkan pada DOKUMEN PER TOPIK (gabungan anggota), bukan dokumen tunggal.'],
    ['CountVectorizer max_df', 'maxDf', 'P_MAXDF', `IF(OR(B{r}<=0,B{r}>1),1,IF(P_MINDF>INT(B{r}*P_N),1,B{r}))`, 'Dilonggarkan ke 1 bila bertentangan dengan min_df.'],
    ['Stopwords', 'stopwords', 'P_STOPWORDS', null, 'Daftar kata yang dibuang sebelum c-TF-IDF.'],
    ['c-TF-IDF top_n_words', 'topNWords', 'P_TOPN', `B{r}`, 'Kata kunci per famili.'],
    ['c-TF-IDF reduce_frequent_words', 'reduceFrequentWords', 'P_RFW', `B{r}`, 'TRUE: tf diakar-kuadratkan (√tf).'],
    ['c-TF-IDF bm25_weighting', 'bm25Weighting', 'P_BM25', `B{r}`, 'TRUE: idf = ln(1 + (A − df + 0,5)/(df + 0,5)); FALSE: idf = ln(A/df + 1).'],
    ['nr_topics', 'nrTopics', 'P_NRTOPICS', null, 'Kosong = tanpa pemangkasan jumlah famili.'],
    ['reduce_outliers', 'reduceOutliers', 'P_REHOME', `B{r}`, 'TRUE: outlier dipindah ke famili terdekat (lembar Outlier - Penempatan).'],
    ['outlier_strategy', 'outlierStrategy', 'P_STRATEGY', null, ''],
    ['outlier_threshold', 'outlierThreshold', 'P_OUTTHR', `MAX(0,MIN(1,B{r}))`, 'Kemiripan minimum agar outlier boleh dipindah.'],
    ['outlier_cascade', 'outlierCascade', 'P_CASCADE', null, ''],
    ['calculate_probabilities', 'calculateProbabilities', 'P_CALCPROB', null, 'TRUE: keanggotaan = vektor keanggotaan lunak HDBSCAN (lembar HDBSCAN - Keanggotaan).'],
    ['diversity (MMR)', 'diversity', 'P_DIVERSITY', null, 'Tidak berpengaruh di pipeline ini (lihat diagnostik run).'],
    ['random_state', 'randomState', 'P_SEED', null, 'Benih UMAP. Optimasi tata letak UMAP bersifat stokastik; benih yang sama → hasil sama.'],
  ];
  for (const [label, key, name, effF, note] of rows) {
    const r = s.next;
    const v = configured(key);
    const val = typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
    // min_samples: the pipeline passes None through; the value HDBSCAN used is
    // the library's own resolution, which the trace records separately.
    const recorded = key === 'minSamples' ? t.hdbscan.params.minSamplesEffective : eff[key];
    const rec = typeof recorded === 'number' || typeof recorded === 'boolean' || typeof recorded === 'string' ? recorded : recorded == null ? '' : JSON.stringify(recorded);
    const effCell = effF ? (typeof v === 'boolean' ? FB(effF.replace(/\{r\}/g, String(r))) : F(effF.replace(/\{r\}/g, String(r)))) : (val as any);
    s.row([label, val as any, effCell, rec as any, typeof recorded === 'number' && effF ? deltaF(`C${r}`, `D${r}`) : null, note]);
    ctx.name(name, SHEET.params, 2, r);
  }
  const lastDelta = s.next - 1;
  ctx.check('Parameter efektif (penjepitan ke ukuran korpus)', SHEET.params, 4, firstDelta, 4, lastDelta, 1e-12, 'Rumus penjepitan vs nilai yang dicatat pipeline.');

  s.blank();
  s.row(['KONSTANTA PUSTAKA (nilai bawaan yang dipakai, tidak dikonfigurasi)']);
  s.row(['Konstanta', 'Nilai', '', '', '', 'Keterangan']);
  const up = t.umap.params;
  const hp = t.hdbscan.params;
  const consts: [string, string, number | string | boolean, string][] = [
    ['UMAP spread', 'P_SPREAD', up.spread, 'Skala jarak efektif titik hasil (bersama min_dist menentukan a, b).'],
    ['UMAP local_connectivity', 'P_LOCALCONN', up.localConnectivity, 'ρ_i = jarak ke tetangga terdekat ke-local_connectivity yang BUKAN nol.'],
    ['UMAP set_op_mix_ratio', 'P_SETOP', up.setOpMixRatio, '1 = gabungan fuzzy murni: P = w + wᵀ − w·wᵀ.'],
    ['UMAP n_epochs (dipakai)', 'P_NEPOCHS', up.nEpochsUsed ?? 500, 'Bawaan pustaka: 500 bila N ≤ 10.000. Tepi dengan bobot < max/n_epochs dibuang sebelum optimasi.'],
    ['UMAP a', 'P_A', up.a, 'Hasil curve_fit φ(d) = 1/(1 + a·d^(2b)) terhadap ψ(d) (lembar UMAP - Kurva a b).'],
    ['UMAP b', 'P_B', up.b, ''],
    ['UMAP learning_rate', 'P_LR', up.learningRate, 'Optimasi SGD — tidak direproduksi rumus sel (lihat Panduan).'],
    ['UMAP negative_sample_rate', 'P_NEG', up.negativeSampleRate, ''],
    ['UMAP repulsion_strength', 'P_REPULSE', up.repulsionStrength, ''],
    ['UMAP init', 'P_INIT', up.init, 'Inisialisasi spektral (vektor eigen Laplacian graf), lalu diskalakan ke [0, 10].'],
    ['UMAP SMOOTH_K_TOLERANCE', 'P_SMOOTHTOL', 1e-5, 'Pencarian biner σ berhenti saat |ψ − log₂k| < nilai ini (maks 64 iterasi).'],
    ['UMAP MIN_K_DIST_SCALE', 'P_MINKDIST', 1e-3, 'σ tidak boleh < MIN_K_DIST_SCALE × rerata jarak kNN dokumen itu.'],
    ['UMAP n_iter pencarian σ', 'P_NITER', 64, 'Batas iterasi pencarian biner σ.'],
    ['UMAP disconnection_distance', 'P_DISCONNECT', up.disconnectionDistance ?? 'inf', 'Jarak ≥ nilai ini dianggap tak terhubung (cosine: 2).'],
    ['HDBSCAN alpha', 'P_ALPHA', hp.alpha, 'Jarak keterjangkauan timbal balik = max(inti_a, inti_b, d/alpha).'],
    ['HDBSCAN metric', 'P_HMETRIC', hp.metric, 'Jarak di ruang hasil UMAP.'],
    ['HDBSCAN algorithm', 'P_ALGO', hp.algorithm, '"best" → boruvka_kdtree untuk dimensi ≤ 60.'],
    ['HDBSCAN approx_min_span_tree', 'P_APPROXMST', hp.approxMinSpanTree, 'TRUE: pohon rentang boleh hampiran — itulah sebabnya MST dicatat, bukan dihitung ulang.'],
    ['HDBSCAN allow_single_cluster', 'P_SINGLE', hp.allowSingleCluster, 'FALSE: akar tidak pernah dipilih sebagai klaster.'],
    ['DBL_MAX', 'P_DBLMAX', 1.7976931348623157e308, 'Pengganti 1/0 pada vektor jarak keanggotaan lunak (jarak 0 ke exemplar).'],
    ['Epsilon keanggotaan', 'P_EPS8', 1e-8, 'Ditambahkan ke λ maks klaster titik pada skor outlier keanggotaan lunak.'],
  ];
  for (const [label, name, v, note] of consts) {
    const r = s.row([label, v as any, '', '', '', note]);
    ctx.name(name, SHEET.params, 1, r);
  }
  {
    const r = s.row(['Sasaran pencarian σ = log₂(k)', F('LOG(P_K,2)'), '', '', '', 'Σ_{j=2..k} exp(−max(0, d_ij − ρ_i)/σ_i) harus sama dengan nilai ini (bandwidth = 1).']);
    ctx.name('P_TARGET', SHEET.params, 1, r);
  }
  if (t.projection2d?.params) {
    const p2 = t.projection2d.params;
    s.blank();
    s.row(['PROYEKSI 2-D (peta sebar; terpisah dari reduksi pengelompokan)']);
    for (const [label, name, v] of [
      ['n_neighbors', 'P_K2D', p2.nNeighbors],
      ['min_dist', 'P_MINDIST2D', p2.minDist],
      ['a', 'P_A2D', p2.a],
      ['b', 'P_B2D', p2.b],
    ] as [string, string, number | undefined][]) {
      const r = s.row([`UMAP 2-D ${label}`, v ?? null, '', '', '', '']);
      ctx.name(name, SHEET.params, 1, r);
    }
  }
}

// ── Kondisi Database ───────────────────────────────────────────────────

export function buildDatabaseState(ctx: BuildContext): void {
  const b = ctx.b;
  const t = ctx.t;
  const s = ctx.sheet(SHEET.db, [40, 46, 46, 16, 70]);
  s.row(['KONDISI DATABASE — saat run dibangun vs saat workbook ini dibuat']);
  s.row(['Angka di kolom "Saat run" berasal dari jejak run; kolom "Kini" dibaca dari database ketika tombol unduh ditekan.']);
  s.row(['Butir', 'Saat run', 'Kini', 'Sama?', 'Keterangan']);
  const cmp = (label: string, then: string | number | null, now: string | number | null, note: string) => {
    const r = s.next;
    s.row([label, then ?? '—', now ?? '—', FS(`IF(OR(B${r}="—",C${r}="—"),"tidak tercatat",IF(B${r}=C${r},"sama","BERUBAH"))`), note]);
  };
  cmp('Sidik korpus (md5)', t.corpus.fingerprint, b.now.corpus?.fingerprint ?? null, 'md5 atas "job_profile_id:md5(dokumen):md5(vektor)" seluruh baris ber-vektor, urut id — rumus yang sama di topic-service dan web app. Berbeda = peta ini tidak lagi menggambarkan korpus.');
  cmp('Dokumen ber-embedding', ctx.N, b.now.corpus?.documents ?? null, run_scope(ctx));
  cmp('Model embedding', t.corpus.embeddingModel, b.now.embeddingModels.map((m) => `${m.model ?? '—'} (${m.count})`).join(', ') || null, 'Model yang menghasilkan vektor.');
  cmp('Embedding terakhir', t.corpus.meta.map((m) => m.embeddedAt ?? '').sort().pop() || null, b.now.corpus?.lastEmbeddedAt ?? null, 'Waktu pembaruan vektor terbaru (UTC).');
  s.row(['Run', b.run.id, '', '', `Dibuat ${b.run.createdAt}; selesai ${b.run.completedAt ?? '—'}.`]);
  s.row(['Cakupan run', b.run.tenantId ? `Business unit ${b.tenantName ?? b.run.tenantId}` : 'Global (seluruh korpus)', '', '', '']);
  s.row(['Versi config', b.run.configId ?? '—', '', '', 'job_family_topic_configs.id yang dijalankan run.']);
  s.blank();
  s.row(['Status job profile (sync_job_profiles) kini', 'Jumlah']);
  for (const st of b.now.profileStatus) s.row([st.status, st.count]);
  s.blank();
  s.row(['Parameter BERTopic', 'Saat run', 'Aktif kini', 'Sama?', '']);
  const now = b.now.config.bertopic as unknown as Record<string, unknown>;
  const runCfg = (t.config ?? {}) as Record<string, unknown>;
  const def = DEFAULT_JOB_FAMILY_CONFIG.bertopic as unknown as Record<string, unknown>;
  for (const key of Object.keys(def)) {
    const r = s.next;
    const a = key in runCfg ? runCfg[key] : def[key];
    const c = now[key];
    s.row([key, a == null ? '(kosong)' : String(a), c == null ? '(kosong)' : String(c), FS(`IF(B${r}=C${r},"sama","BERUBAH")`), '']);
  }
  s.blank();
  s.row(['Embedding kini', '', '', '', '']);
  s.row(['Sumber', b.now.config.embedding.source]);
  s.row(['Model', b.now.config.embedding.model]);
  s.row(['Dimensi', b.now.config.embedding.dimensions]);
  s.row(['Ukuran batch', b.now.config.embedding.batchSize]);
  if (t.reproducibility) {
    s.blank();
    s.row(['Versi pustaka saat run', 'Versi']);
    for (const [k, v] of Object.entries(t.reproducibility.versions ?? {})) s.row([k, v ?? '—']);
    s.row(['Urutan dokumen', t.reproducibility.documentOrder]);
  }
}

function run_scope(ctx: BuildContext): string {
  return ctx.b.run.tenantId
    ? 'Run per business unit: korpusnya dokumen yang terlihat oleh unit itu.'
    : 'Run global: seluruh dokumen ber-vektor.';
}

// ── Dokumen + Dokumen - Baris ──────────────────────────────────────────
//
// restructureJobProfile(): substitute every {{token}}, split into physical
// lines, drop a non-blank line ending in ":" (a label whose value came out
// empty), strip trailing whitespace, join with "\n", collapse runs of 3+
// newlines to 2, trim. In cells: a running document per line — a kept blank
// line is skipped when the last kept line was blank too (that IS the collapse,
// and also drops leading blank lines), and a trailing newline is cut at the end.

/** Dokumen - Baris columns. */
const BL = { dok: 0, tplLine: 1, tplText: 2, tokens: 3, phys: 4, subOk: 5, keep: 6, line: 7, blank: 8, lastBlank: 9, incl: 10, cum: 11 } as const;

export function buildDocuments(ctx: BuildContext): void {
  const b = ctx.b;
  const t = ctx.t;
  const tokens = [...TEMPLATE_TOKENS];
  const s = ctx.sheet(SHEET.docs, [7, 10, 34, 26, 30, 11, 30, 18, 18, 14, 60, 9, 12, 12, 10, 12, 12, 10, 24, 12, 9, 20, 60, 22, ...tokens.map(() => 30)]);
  const lines = ctx.sheet(SHEET.lines, [7, 8, 46, 22, 60, 12, 11, 60, 8, 11, 10, 40]);

  s.row(['DOKUMEN — data mentah job profile → dokumen yang di-embed']);
  s.row([
    'Dokumen = template restrukturisasi diisi nilai data hasil ekstraksi (kolom token di kanan). Baris yang labelnya berakhir ":" tanpa isi dibuang, spasi di ujung baris dihapus, baris kosong berturut-turut diringkas menjadi satu, lalu dokumen di-trim. Lembar Dokumen - Baris menurunkannya baris demi baris.',
  ]);
  const headers = [
    'Dok #', 'ID job profile', 'Jabatan', 'Divisi / Departemen', 'Nama berkas', 'Status kini', 'Template yang dipakai', 'Sidik data ekstraksi saat embedding', 'Sidik data ekstraksi kini', 'Data ekstraksi berubah?',
    'Dokumen yang dikelompokkan (teks di-embed)', 'Panjang', 'md5 dokumen (run)', 'md5 dokumen (kini)', 'Dokumen berubah?', 'md5 vektor (run)', 'md5 vektor (kini)', 'Vektor berubah?',
    'Model embedding', 'Sumber embedding', 'Dimensi tercatat', 'Waktu embedding (UTC)', 'Dokumen hasil rumus (Dokumen - Baris)', 'Rumus = dokumen?',
    ...tokens.map((k) => `{{${k}}}`),
  ];
  s.row(headers);
  lines.row(['DOKUMEN - BARIS — penurunan dokumen baris demi baris']);
  lines.row([
    'Per dokumen: tiap baris template → teks sesudah {{token}} diganti nilai data (nilai multi-baris menjadi beberapa baris fisik) → dibuang bila tidak kosong dan berakhir ":" → baris kosong dilewati bila baris terakhir yang dipertahankan juga kosong → dokumen berjalan.',
  ]);
  lines.row(['Dok #', 'Baris template', 'Teks template', 'Token', 'Sesudah substitusi (baris fisik)', 'Rumus substitusi cocok?', 'Dipertahankan?', 'Baris (tanpa spasi ujung)', 'Kosong?', 'Terakhir dipertahankan kosong?', 'Masuk dokumen?', 'Dokumen sejauh ini']);

  const TOKEN_COL0 = 24;
  const now = b.now.config;
  const firstDocRow = docRow(1);
  let anyRecordedTemplate = false;
  for (let i = 0; i < ctx.N; i++) {
    const r = docRow(i + 1);
    const m = t.corpus.meta[i]!;
    const prof = b.profiles.get(m.jobProfileId);
    const override = now.restructureOverrides[String(m.jobProfileId)];
    const template = m.embedTemplate ?? (override?.trim() ? override : now.restructureTemplate);
    if (m.embedTemplate) anyRecordedTemplate = true;
    const values = tokenValuesOf((prof?.extractedData ?? null) as ExtractedJobProfileData | null);
    const doc = t.corpus.documents[i] ?? '';
    const nowE = b.now.embedded.get(m.jobProfileId);

    const firstLine = lines.next;
    template.split('\n').forEach((tl, li) => {
      const matches = Array.from(tl.matchAll(/\{\{\s*(\w+)\s*\}\}/g));
      const substituted = tl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : '',
      );
      const physical = substituted.split('\n');
      physical.forEach((pl, pi) => {
        const lr = lines.next;
        const c = (k: number) => `${colName(k)}${lr}`;
        const prev = (k: number) => `${colName(k)}${lr - 1}`;
        const first = lr === firstLine;
        // Substitution as a formula for a template line that stays one line.
        let subF: string | null = null;
        if (physical.length === 1) {
          let f = c(BL.tplText);
          for (const mt of matches) {
            const ti = tokens.indexOf(mt[1]! as (typeof tokens)[number]);
            f = `SUBSTITUTE(${f},${str(mt[0])},${ti >= 0 ? cell(SHEET.docs, TOKEN_COL0 + ti, r) : '""'})`;
          }
          subF = f;
        }
        const trimmed = pl.replace(/\s+$/, '');
        const text = (x: string) => (x.length > MAX_CELL_TEXT ? x.slice(0, MAX_CELL_TEXT) : x);
        lines.row([
          i + 1,
          li + 1,
          pi === 0 ? tl : '↳ lanjutan nilai multi-baris',
          pi === 0 ? matches.map((x) => x[1]).join(', ') : '',
          text(pl),
          subF ? FS(`IF(EXACT(${subF},${c(BL.phys)}),"cocok","BEDA")`) : 'baris fisik',
          F(`IF(AND(LEN(TRIM(${c(BL.phys)}))>0,RIGHT(TRIM(${c(BL.phys)}),1)=":"),0,1)`),
          // &"" — a reference to an empty cell is 0, not "", in every spreadsheet.
          trimmed === pl ? FS(`${c(BL.phys)}&""`) : text(trimmed),
          F(`IF(LEN(${c(BL.line)})=0,1,0)`),
          F(`IF(${c(BL.keep)}=1,${c(BL.blank)},${first ? 1 : prev(BL.lastBlank)})`),
          F(`IF(AND(${c(BL.keep)}=1,NOT(AND(${c(BL.blank)}=1,${first ? 1 : prev(BL.lastBlank)}=1))),1,0)`),
          first
            ? FS(`IF(${c(BL.incl)}=1,${c(BL.line)},"")`)
            : FS(`IF(${c(BL.incl)}=1,IF(${prev(BL.cum)}="",${c(BL.line)},${prev(BL.cum)}&CHAR(10)&${c(BL.line)}),${prev(BL.cum)})`),
        ]);
      });
    });
    const lastLine = lines.next - 1;
    const cumLast = cell(SHEET.lines, BL.cum, lastLine);
    const recordedTemplate = Boolean(m.embedTemplate);
    s.row([
      i + 1,
      m.jobProfileId,
      m.positionName ?? '',
      m.divisionDepartment ?? '',
      prof?.fileName ?? '—',
      prof?.status ?? 'tidak ada',
      recordedTemplate ? 'tercatat saat embedding' : override?.trim() ? 'template khusus profil KINI (saat embedding tidak tercatat)' : 'template global KINI (saat embedding tidak tercatat)',
      m.extractedHash ?? '—',
      prof?.extractedHash ?? '—',
      FS(`IF(H${r}="—","tidak tercatat",IF(EXACT(H${r},I${r}),"sama","BERUBAH"))`),
      doc.length > MAX_CELL_TEXT ? doc.slice(0, MAX_CELL_TEXT) : doc,
      F(`LEN(K${r})`),
      m.docMd5 ?? '—',
      nowE?.docMd5 ?? '—',
      FS(`IF(OR(M${r}="—",N${r}="—"),"tidak ada kini",IF(EXACT(M${r},N${r}),"sama","BERUBAH"))`),
      m.embMd5 ?? '—',
      nowE?.embMd5 ?? '—',
      FS(`IF(OR(P${r}="—",Q${r}="—"),"tidak ada kini",IF(EXACT(P${r},Q${r}),"sama","BERUBAH"))`),
      m.embeddingModel ?? '—',
      m.embedSource ?? '—',
      m.embedDimensions ?? '—',
      m.embeddedAt ?? '—',
      FS(`IF(RIGHT(${cumLast},1)=CHAR(10),LEFT(${cumLast},LEN(${cumLast})-1),${cumLast})`),
      // A difference is a finding only when the template used at embedding was
      // recorded and the extracted data has not changed since; otherwise the
      // rebuild uses today's template/data and can legitimately differ.
      FS(
        `IF(EXACT(W${r},K${r}),"cocok",IF(AND(${recordedTemplate ? 'TRUE' : 'FALSE'},J${r}="sama"),"BEDA","berbeda — template atau data ekstraksi berubah sejak embedding"))`,
      ),
      ...tokens.map((k) => {
        const v = values[k] ?? '';
        return v.length > MAX_CELL_TEXT ? v.slice(0, MAX_CELL_TEXT) : v;
      }),
    ]);
  }
  const lastDocRow = docRow(ctx.N);
  if (!anyRecordedTemplate) {
    ctx.gaps.push(
      'Template restrukturisasi saat embedding tidak tercatat (vektor dibuat sebelum drizzle/0094): penurunan dokumen memakai template dan data ekstraksi yang berlaku KINI. "berbeda" di lembar Dokumen berarti template atau data berubah sejak vektor dibuat — informatif, karena yang dikelompokkan adalah teks yang di-embed (kolom K).',
    );
  }
  ctx.check(
    'Dokumen ← data mentah + template (rumus = teks yang di-embed)',
    SHEET.docs,
    23,
    firstDocRow,
    23,
    lastDocRow,
    0,
    'Dihitung sebagai selisih hanya bila template saat embedding tercatat dan data ekstraksi tidak berubah sejak itu.',
  );
  ctx.check('Dokumen - Baris: substitusi token', SHEET.lines, BL.subOk, 4, BL.subOk, Math.max(4, lines.next - 1), 0, '');
}

// ── Vektor, Vektor Unit, Jarak Cosine ──────────────────────────────────

export function buildVectors(ctx: BuildContext): void {
  const D = ctx.D;
  const s = ctx.sheet(SHEET.vec, [7, 10, 34, 12, 12, 12, 12, 9, ...Array.from({ length: Math.min(D, 50) }, () => 11)]);
  ctx.vecCol0 = 8;
  ctx.normCol = 3;
  s.row(['VEKTOR DOKUMEN — keluaran model embedding (masukan, bukan rumus)']);
  s.row([`Satu baris per dokumen, ${D} komponen. Nilai float32 yang dikelompokkan pipeline, ditulis sebagai double tepatnya. ‖x‖ = √Σx²; rentang = komponen terkecil/terbesar.`]);
  s.row(['Dok #', 'ID job profile', 'Jabatan', '‖x‖ (rumus)', 'Min (rumus)', 'Maks (rumus)', 'Rerata (rumus)', 'Komponen (rumus)', ...Array.from({ length: D }, (_, k) => `x${k + 1}`)]);
  for (let i = 0; i < ctx.N; i++) {
    const r = docRow(i + 1);
    const rng = `${colName(8)}${r}:${colName(8 + D - 1)}${r}`;
    s.row([
      i + 1,
      ctx.t.corpus.meta[i]!.jobProfileId,
      ctx.title(i),
      F(`SQRT(SUMSQ(${rng}))`),
      F(`MIN(${rng})`),
      F(`MAX(${rng})`),
      F(`AVERAGE(${rng})`),
      F(`COUNT(${rng})`),
      ...ctx.vectors[i]!,
    ]);
  }

  // Cosine distance matrix: d_ij = 1 − Σ x_i·x_j / (‖x_i‖·‖x_j‖), computed once
  // per pair (upper triangle) and mirrored; the diagonal is the library's exact 0.
  // (Written from the raw vectors and their norms rather than from a sheet of
  // unit vectors u = x/‖x‖: the same number, and N × D fewer formula cells.)
  const c = ctx.sheet(SHEET.cos, [7, ...Array.from({ length: Math.min(ctx.N, 60) }, () => 10)]);
  c.row(['JARAK COSINE — d_ij = 1 − cos(x_i, x_j) = 1 − Σ_k x_ik·x_jk / (‖x_i‖·‖x_j‖)']);
  c.row(['Matriks penuh yang dibaca pencarian tetangga UMAP (eksak untuk N < 4096). ‖x‖ dari kolom D lembar Vektor. Dihitung sekali per pasangan (segitiga atas), dicerminkan; diagonal = 0 seperti pustaka.']);
  c.row(['Dok #', ...Array.from({ length: ctx.N }, (_, j) => `Dok ${j + 1}`)]);
  for (let i = 1; i <= ctx.N; i++) {
    const r = docRow(i);
    const cells: any[] = [i];
    for (let j = 1; j <= ctx.N; j++) {
      if (j === i) cells.push(0);
      else if (j > i)
        cells.push(
          F(`1-SUMPRODUCT(${rowRange(SHEET.vec, 8, D, docRow(i))},${rowRange(SHEET.vec, 8, D, docRow(j))})/(${cell(SHEET.vec, 3, docRow(i))}*${cell(SHEET.vec, 3, docRow(j))})`),
        );
      else cells.push(F(`${colName(i)}${docRow(j)}`));
    }
    c.row(cells);
  }
  void DOC_HEAD;
  void N;
  void DATE_TIME;
  void serialOf;
}

