// The anchors and yardsticks a run measured from the DATABASE as it stood —
// the "jangkar" numbers that move whenever a corpus moves — recomputed with
// Excel from the census distributions stored beside them (drizzle/0092).
//
//   Jangkar Teknis   L/U = PERCENTILE.INC over the kamus best-wrong-match census
//   Jangkar Karier   corpus / family / transitions estimates → MEDIAN
//   Sensus Pengangkatan  per-level medians + the monotonicity guard → T terukur
//   IDF              ln(N ÷ df) per competency key, floored at P_IDF_MIN
//
// Cached calibrations are stored as `real` (float4), so a run that READ a cached
// pair used values rounded to ~7 significant digits, while the percentile here is
// exact: a Δ around 1e-8 on those rows is that rounding, not a different answer.

import { BuildContext, SHEET } from '../context';
import { F, FB, FULL, N, fn, xcol, type Cell } from '../sheet';

const qs = (n: string) => `'${n.replace(/'/g, "''")}'`;

export function buildAnchors(ctx: BuildContext): void {
  buildTechnicalAnchors(ctx);
  buildCareerAnchors(ctx);
  buildDepthCensus(ctx);
  buildIdf(ctx);
}

function buildTechnicalAnchors(ctx: BuildContext): void {
  const t = ctx.t;
  const census = ctx.b.census.technical_kamus ?? null;
  const s = ctx.sheet(SHEET.techAnchors, [52, 18, 18, 14, 70]);
  s.row(['JANGKAR KEMIRIPAN KOMPETENSI TEKNIS (L, U) — diukur dari isi kamus kompetensi']);
  s.row([
    'Untuk setiap baris (kode, level) kamus: kemiripan TERTINGGI ke baris kode LAIN ("pasangan salah terbaik"). L = persentil 25, U = persentil 99 sebaran itu (Postgres percentile_cont = PERCENTILE.INC).',
  ]);
  s.blank();
  s.row(['Butir', 'Dipakai run', 'Dihitung ulang', 'Selisih', 'Keterangan']);
  const anchors = t?.technical?.anchors ?? null;
  const n = census?.payload?.rows?.length ?? 0;
  const simR = n > 0 ? `${qs(SHEET.censusKamus)}!$C$5:$C$${4 + n}` : null;
  const rL = s.next;
  s.row(['Batas bawah L', F('P_TEK_L', FULL), simR ? F(`${fn('PERCENTILE.INC')}(${simR},0.25)`, FULL) : '', F(`IF(C${rL}="","",B${rL}-C${rL})`), `Sumber: ${anchors?.source ?? ctx.b.runInfo?.technical?.simAnchorSource ?? 'tidak tercatat'}${anchors?.inherited ? ' (diwarisi dari run induk)' : ''}`]);
  const rU = s.next;
  s.row(['Batas atas U', F('P_TEK_U', FULL), simR ? F(`${fn('PERCENTILE.INC')}(${simR},0.99)`, FULL) : '', F(`IF(C${rU}="","",B${rU}-C${rU})`), 'p99, bukan maksimum: satu kompetensi kembar tidak boleh menarik U ke ~0,99.']);
  s.row(['Persentil 50', '', simR ? F(`${fn('PERCENTILE.INC')}(${simR},0.5)`, FULL) : '', '', '']);
  s.row(['Persentil 95', '', simR ? F(`${fn('PERCENTILE.INC')}(${simR},0.95)`, FULL) : '', '', '']);
  s.row(['Jumlah baris sensus', '', simR ? F(`COUNT(${simR})`) : '', '', '']);
  s.row(['Rentang U − L ≥ minimum?', '', simR ? FB(`C${rU}-C${rL}>=${t?.parameters?.technical?.anchorsMinSpread ?? 0.02}`) : '', '', 'Di bawahnya engine memakai nilai cadangan konfigurasi.']);
  s.row(['Fingerprint korpus', anchors?.fingerprint ?? ctx.b.runInfo?.frozen?.positionBasis?.kamus?.fingerprint ?? '—', '', '', 'md5(kode:level:content_hash …):model — berubah begitu kamus atau modelnya berubah.']);
  if (census) {
    ctx.checks.push({ label: 'Jangkar teknis L, U', range: `'${SHEET.techAnchors}'!$D$${rL}:$D$${rU}`, tolerance: 1e-6, note: 'Toleransi 1e-6: nilai kalibrasi tersimpan sebagai real (float4).' });
  } else {
    ctx.gaps.push(
      anchors?.source === 'env'
        ? 'Jangkar teknis dipatok manual (TECHNICAL_SIM_FLOOR/CEIL): tidak ada sensus.'
        : 'Sebaran sensus kamus di balik jangkar teknis tidak tersimpan untuk run ini; L dan U tercatat sebagai angka saja.',
    );
  }

  const c = ctx.sheet(SHEET.censusKamus, [14, 8, 16, 14, 10]);
  c.row(['SENSUS KAMUS — per (kode, level): kemiripan tertinggi ke baris kode lain']);
  c.row([census ? `Fingerprint ${census.fingerprint} · diukur ${census.createdAt} · model ${census.payload.model ?? '—'}` : 'Tidak tersimpan.']);
  c.blank();
  c.row(['Kode', 'Level', 'Kemiripan terbaik ke kode lain', 'Kode terdekat', 'Level terdekat']);
  for (const row of census?.payload?.rows ?? []) c.row([row.code, row.level, N(row.sim, FULL), row.bestCode ?? '', row.bestLevel ?? '']);
}

function buildCareerAnchors(ctx: BuildContext): void {
  const t = ctx.t;
  const P = t?.parameters?.careerAnchors;
  const dup = P?.duplicateSim ?? 0.999;
  const corpus = ctx.b.census.career_corpus ?? null;
  const family = ctx.b.census.career_family ?? null;
  const moves = ctx.b.census.career_transitions ?? null;

  // ── Sensus Korpus JP (ordered pairs) + best per document ───────
  const k = ctx.sheet(SHEET.censusCorpus, [12, 12, 16]);
  k.row(['SENSUS KORPUS JOB PROFILE — setiap pasangan dokumen BERURUT (a, b), a ≠ b']);
  k.row([corpus ? `Fingerprint ${corpus.fingerprint} · ${corpus.payload.docs.length} dokumen · batas sensus ${corpus.payload.limit}` : 'Tidak tersimpan.']);
  k.row(['Estimator menghitung persentil atas (a,b) DAN (b,a); kemiripan simetris, jadi tiap pasangan ditulis dua kali — itulah yang membuat PERCENTILE.INC di sini sama dengan percentile_cont engine.']);
  k.row(['Dokumen a', 'Dokumen b', 'Kemiripan']);
  const kFirst = k.next;
  for (const [a, b, sim] of corpus?.payload?.pairs ?? []) {
    k.row([a, b, N(sim, FULL)]);
    k.row([b, a, N(sim, FULL)]);
  }
  const kLast = k.next - 1;
  const best = ctx.sheet(SHEET.censusBest, [12, 18, 12]);
  best.row(['KEMBAR TERDEKAT per dokumen (pasangan ≥ batas duplikat dibuang lebih dulu)']);
  best.row([`Batas duplikat = ${dup}. terbaik(a) = MAXIFS(kemiripan, a, dokumen, kemiripan, "<" & batas).`]);
  best.blank();
  best.row(['Dokumen', 'Kemiripan kembar terdekat', 'Pasangan genuine']);
  const bFirst = best.next;
  for (const id of corpus?.payload?.docs ?? []) {
    const r = best.next;
    const A = xcol(SHEET.censusCorpus, 0);
    const C = xcol(SHEET.censusCorpus, 2);
    best.row([
      id,
      // "<"&0.999, not "<0.999": a criterion is parsed in the reader's locale
      // (see mismatchCountF), a formula literal is not.
      F(`IF(C${r}=0,"",${fn('MAXIFS')}(${C},${A},A${r},${C},"<"&${dup}))`, FULL),
      F(`COUNTIFS(${A},A${r},${C},"<"&${dup})`),
    ]);
  }
  const bLast = best.next - 1;

  // ── Sensus Rumpun (family precision sweep) ─────────────────────
  const f = ctx.sheet(SHEET.censusFamily, [12, 12, 16, 9, 9, 9, 12, 11, 11]);
  const minSupport = family?.payload?.minSupport ?? P?.familyMinSupport ?? 30;
  f.row(['SENSUS RUMPUN JABATAN — kurva ketepatan atas pasangan berlabel (label = rumpun hasil topic-service)']);
  f.row([
    family
      ? `Topic run ${family.payload.topicRunId ?? '—'} (${family.payload.topicRows} penugasan). Pasangan diurutkan menurun menurut kemiripan, persis urutan yang dilalui estimator.`
      : 'Tidak tersimpan.',
  ]);
  f.row([
    `ketepatan = Σ serumpun ÷ jumlah dilalui. Batas ATAS = kemiripan pertama dengan ketepatan < 95% (setelah ≥ ${minSupport} pasangan); batas BAWAH = kemiripan pertama dengan ketepatan < 50%.`,
  ]);
  f.row(['Dokumen a', 'Dokumen b', 'Kemiripan', 'Serumpun?', 'Dilalui', 'Σ serumpun', 'Ketepatan', '< 95%?', '< 50%?']);
  const fFirst = f.next;
  (family?.payload?.pairs ?? []).forEach(([a, b, sim, same], i) => {
    const r = f.next;
    f.row([
      a,
      b,
      N(sim, FULL),
      same,
      i + 1,
      i === 0 ? F(`D${r}`) : F(`F${r - 1}+D${r}`),
      F(`F${r}/E${r}`, FULL),
      FB(`AND(E${r}>=${minSupport},G${r}<0.95)`),
      FB(`AND(E${r}>=${minSupport},G${r}<0.5)`),
    ]);
  });
  const fLast = f.next - 1;

  // ── Sensus Mutasi (transitions) ───────────────────────────────
  const m = ctx.sheet(SHEET.censusMoves, [14, 14, 16, 16]);
  m.row(['SENSUS MUTASI NYATA — perpindahan jabatan internal antar-job profile (preferensi yang terungkap)']);
  m.row([moves ? `Fingerprint ${moves.fingerprint}. Kemiripan kosong = salah satu dokumen tanpa vektor (dibuang estimator).` : 'Tidak tersimpan.']);
  m.blank();
  m.row(['Job profile asal', 'Job profile tujuan', 'Kemiripan', 'Dipakai (< batas duplikat)']);
  const mFirst = m.next;
  for (const [a, b, sim] of moves?.payload?.moves ?? []) {
    const r = m.next;
    m.row([a, b, N(sim, FULL), F(`IF(AND(C${r}<>"",C${r}<${dup}),C${r},"")`, FULL)]);
  }
  const mLast = m.next - 1;

  // ── Jangkar Karier (summary) ──────────────────────────────────
  const s = ctx.sheet(SHEET.careerAnchors, [44, 16, 16, 16, 16, 12, 60]);
  const anchors = t?.career?.anchors ?? null;
  s.row(['JANGKAR KEMIRIPAN DOKUMEN KARIER (L, U) — NILAI TENGAH tiga estimator']);
  s.row(['Setiap estimator menjawab pertanyaan yang sama dari bukti berbeda; nilai tengah (MEDIAN) dipakai supaya satu estimator tidak bisa menggeser skala sendirian.']);
  s.blank();
  s.row(['Estimator', 'L dihitung ulang', 'U dihitung ulang', 'L engine', 'U engine', 'Data', 'Rumus']);
  const est = new Map((anchors?.estimates ?? ctx.b.runInfo?.career?.scale?.estimates ?? []).map((e: any) => [e.source, e]));
  const rows: { src: string; r: number }[] = [];
  const addEst = (src: string, label: string, lf: Cell, uf: Cell, data: Cell, rule: string) => {
    const e: any = est.get(src);
    const r = s.next;
    s.row([label, lf, uf, N(e?.floor ?? null, FULL), N(e?.ceil ?? null, FULL), data, rule]);
    if (e) rows.push({ src, r });
  };
  addEst(
    'corpus',
    'corpus — sebaran dokumen sembarang',
    corpus && kLast >= kFirst ? F(`${fn('PERCENTILE.INC')}(${qs(SHEET.censusCorpus)}!$C$${kFirst}:$C$${kLast},0.25)`, FULL) : '',
    corpus && bLast >= bFirst ? F(`${fn('PERCENTILE.INC')}(${qs(SHEET.censusBest)}!$B$${bFirst}:$B$${bLast},0.99)`, FULL) : '',
    corpus ? F(`COUNT(${qs(SHEET.censusCorpus)}!$C$${kFirst}:$C$${Math.max(kFirst, kLast)})`) : '',
    'L = PERCENTILE.INC(pasangan berurut, 0,25) · U = PERCENTILE.INC(kembar terdekat, 0,99)',
  );
  addEst(
    'family',
    'family — kurva ketepatan rumpun jabatan',
    family && fLast >= fFirst ? F(`IFERROR(INDEX(${qs(SHEET.censusFamily)}!$C$${fFirst}:$C$${fLast},MATCH(TRUE,${qs(SHEET.censusFamily)}!$I$${fFirst}:$I$${fLast},0)),"")`, FULL) : '',
    family && fLast >= fFirst ? F(`IFERROR(INDEX(${qs(SHEET.censusFamily)}!$C$${fFirst}:$C$${fLast},MATCH(TRUE,${qs(SHEET.censusFamily)}!$H$${fFirst}:$H$${fLast},0)),"")`, FULL) : '',
    family ? fLast - fFirst + 1 : '',
    'L = kemiripan pertama dengan ketepatan < 50% · U = pertama dengan ketepatan < 95%',
  );
  addEst(
    'transitions',
    'transitions — mutasi jabatan nyata',
    moves && mLast >= mFirst ? F(`${fn('PERCENTILE.INC')}(${qs(SHEET.censusMoves)}!$D$${mFirst}:$D$${mLast},0.1)`, FULL) : '',
    moves && mLast >= mFirst ? F(`${fn('PERCENTILE.INC')}(${qs(SHEET.censusMoves)}!$D$${mFirst}:$D$${mLast},0.75)`, FULL) : '',
    moves ? F(`COUNT(${qs(SHEET.censusMoves)}!$D$${mFirst}:$D$${Math.max(mFirst, mLast)})`) : '',
    'L = PERCENTILE.INC(kemiripan mutasi, 0,10) · U = PERCENTILE.INC(…, 0,75)',
  );
  s.blank();
  const rMed = s.next;
  const used = rows.map((x) => x.r);
  s.row([
    'NILAI TENGAH estimator yang tersedia',
    used.length ? F(`IF(COUNT(${used.map((r) => `B${r}`).join(',')})=0,"",MEDIAN(${used.map((r) => `B${r}`).join(',')}))`, FULL) : '',
    used.length ? F(`IF(COUNT(${used.map((r) => `C${r}`).join(',')})=0,"",MEDIAN(${used.map((r) => `C${r}`).join(',')}))`, FULL) : '',
    used.length ? F(`IF(COUNT(${used.map((r) => `D${r}`).join(',')})=0,"",MEDIAN(${used.map((r) => `D${r}`).join(',')}))`, FULL) : '',
    used.length ? F(`IF(COUNT(${used.map((r) => `E${r}`).join(',')})=0,"",MEDIAN(${used.map((r) => `E${r}`).join(',')}))`, FULL) : '',
    '',
    'Dari estimasi yang dihitung ulang (B, C) dan dari estimasi engine (D, E).',
  ]);
  const rUse = s.next;
  s.row(['Dipakai run (P_KAR_L, P_KAR_U)', F('P_KAR_L', FULL), F('P_KAR_U', FULL), F(`IF(D${rMed}="","",B${rUse}-D${rMed})`), F(`IF(E${rMed}="","",C${rUse}-E${rMed})`), '', `Sumber: ${anchors?.source ?? ctx.b.runInfo?.career?.scale?.source ?? 'tidak tercatat'}${anchors?.inherited ? ' (diwarisi dari run induk)' : ''}. D, E di baris ini = selisih dipakai − nilai tengah engine (float4).`]);
  s.blank();
  s.row(['Selisih estimasi (dihitung ulang − engine)', 'L', 'U']);
  const dFirst = s.next;
  for (const { src, r } of rows) {
    s.row([src, F(`IF(B${r}="","",B${r}-D${r})`), F(`IF(C${r}="","",C${r}-E${r})`)]);
  }
  const dLast = s.next - 1;
  if (dLast >= dFirst) ctx.checks.push({ label: 'Jangkar karier: estimator', range: `'${SHEET.careerAnchors}'!$B$${dFirst}:$C$${dLast}`, tolerance: 1e-9, note: '' });
  ctx.checks.push({ label: 'Jangkar karier: dipakai vs nilai tengah', range: `'${SHEET.careerAnchors}'!$D$${rUse}:$E$${rUse}`, tolerance: 1e-6, note: 'float4 bila jangkar dibaca dari kalibrasi tersimpan.' });
  if (!corpus && !family && !moves) {
    ctx.gaps.push('Sebaran sensus di balik jangkar karier tidak tersimpan untuk run ini; ketiga estimasi tercatat sebagai angka saja.');
  }
}

function buildDepthCensus(ctx: BuildContext): void {
  const census = ctx.b.census.career_depth ?? null;
  const s = ctx.sheet(SHEET.censusDepth, [44, 16, 20, 20, 12, 12, 10, 4, 14, 12, 12, 12, 12]);
  s.row(['SENSUS PENGANGKATAN — lama bekerja sebelum diangkat ke jabatan sekarang, per jenjang (T_tahun terukur)']);
  s.row([
    census
      ? `${census.payload.appointments.length} pengangkatan · fingerprint ${census.fingerprint}. tahun = (mulai jabatan sekarang − mulai jabatan pertama) ÷ 365,25 hari. Jenjang dibaca dari JUDUL jabatan yang dimasuki (levelFromTitle).`
      : 'Tidak tersimpan untuk run ini.',
  ]);
  s.blank();
  s.row(['Judul jabatan', 'Jenjang', 'Mulai jabatan pertama', 'Mulai jabatan sekarang', 'Tahun (rumus)', 'Tahun engine', 'Selisih']);
  const first = s.next;
  for (const a of census?.payload?.appointments ?? []) {
    const r = s.next;
    s.row([
      a.title ?? '',
      a.level,
      N(a.firstFrom ? new Date(a.firstFrom).getTime() / 86_400_000 + 25_569 : null, 'yyyy-mm-dd hh:mm:ss'),
      N(a.currentFrom ? new Date(a.currentFrom).getTime() / 86_400_000 + 25_569 : null, 'yyyy-mm-dd hh:mm:ss'),
      F(`(D${r}-C${r})/365.25`, FULL),
      N(a.years, FULL),
      F(`E${r}-F${r}`),
    ]);
  }
  const last = s.next - 1;
  if (!census) return;
  ctx.checks.push({ label: 'Sensus pengangkatan: tahun', range: `'${SHEET.censusDepth}'!$G$${first}:$G$${last}`, tolerance: 1e-9, note: '' });

  // Per-level medians (blocks are contiguous: the census is sorted by level, then years).
  const order = census.payload.levelOrder;
  const lvl = `$B$${first}:$B$${last}`;
  const yrs = `$E$${first}:$E$${last}`;
  s.blank();
  s.row(['', '', '', '', '', '', '', '', 'Jenjang', 'n', 'Median (2 desimal)', 'Cukup sampel?', 'Batas dari jenjang junior']);
  const lr: Record<string, number> = {};
  order.forEach((level, i) => {
    const r = s.next;
    lr[level] = r;
    const juniors = order.slice(0, i).map((l) => lr[l]!);
    s.row([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      level,
      F(`COUNTIF(${lvl},I${r})`),
      F(`IF(J${r}=0,"",ROUND(MEDIAN(INDEX(${yrs},MATCH(I${r},${lvl},0)):INDEX(${yrs},MATCH(I${r},${lvl},0)+J${r}-1)),2))`, FULL),
      FB(`J${r}>=P_DEPTH_MIN_N`),
      juniors.length ? F(`MAX(0,${juniors.map((jr) => `IF(L${jr},K${jr},0)`).join(',')})`) : 0,
    ]);
  });
  const rAll = s.next;
  s.row(['', '', '', '', '', '', '', '', 'Semua jenjang', F(`COUNT(${yrs})`), F(`IF(J${rAll}=0,"",ROUND(MEDIAN(${yrs}),2))`, FULL), '', '']);
  const target = ctx.t?.career?.depth?.level ?? null;
  if (target && lr[target]) {
    const tr = lr[target]!;
    const rT = s.next;
    s.row([
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      `T terukur untuk jenjang sasaran (${target})`,
      '',
      F(
        `IF(AND(L${tr},K${tr}>=M${tr}),K${tr},IF(L${tr},M${tr},IF(M${tr}>0,M${tr},IF(J${rAll}>0,K${rAll},""))))`,
        FULL,
      ),
      'Rumus: jenjang sendiri bila cukup sampel DAN tidak lebih mudah dari junior; kalau tidak, batas junior; kalau tidak ada, median semua jenjang.',
    ]);
    ctx.depthMeasuredRef = `${qs(SHEET.censusDepth)}!$K$${rT}`;
  }
}

function buildIdf(ctx: BuildContext): void {
  const census = ctx.b.census.competency_idf ?? null;
  const t = ctx.t;
  const docs = ctx.sheet(SHEET.idfDocs, [12, 44, 4, 12, 10]);
  docs.row(['DOKUMEN JOB PROFILE × KUNCI KOMPETENSI (df dihitung per dokumen, satu kali per kunci)']);
  docs.blank();
  docs.row(['Dokumen', 'Kunci identitas', '', 'Dokumen (daftar)', 'Jumlah kunci']);
  const dFirst = docs.next;
  const docList = census?.payload?.docs ?? [];
  let r = dFirst;
  for (const d of docList) {
    for (const key of d.keys) {
      docs.rows[r - 1] = [d.id, key];
      r++;
    }
  }
  docList.forEach((d, i) => {
    const row = docs.rows[dFirst - 1 + i] ?? [];
    row[3] = d.id;
    row[4] = d.keys.length;
    docs.rows[dFirst - 1 + i] = row;
  });
  // Pad the sparse rows array so every index exists.
  for (let i = 0; i < docs.rows.length; i++) if (!docs.rows[i]) docs.rows[i] = [];

  const s = ctx.sheet(SHEET.idf, [44, 40, 10, 10, 14, 14, 10, 12, 10]);
  s.row(['BOBOT KEKHASAN KOMPETENSI (IDF) — hanya untuk jalur pengganti Career']);
  s.row(['bobot(k) = MAX(P_IDF_MIN, LN(N ÷ MAX(1, df(k)))). Kompetensi yang tidak pernah muncul di korpus: P_IDF_UNSEEN = bobot TERTINGGI yang ditunjukkan korpus.']);
  s.row([census ? `Fingerprint ${census.fingerprint}` : 'Sensus IDF tidak tersimpan untuk run ini (atau jalur pengganti tidak dipakai).']);
  const rN = s.next;
  s.row(['N (dokumen job profile)', census ? census.payload.docCount : t?.career?.idf?.docCount ?? '', '', 'Daftar dokumen (lembar IDF - Dokumen):', census ? F(`COUNT(${qs(SHEET.idfDocs)}!$D:$D)`) : '']);
  ctx.name('P_IDF_N', SHEET.idf, 1, rN);
  s.blank();
  s.row(['Kunci identitas', 'Nama', 'df (rumus)', 'N', 'ln(N ÷ df)', 'Bobot (rumus)', 'df engine', 'Bobot engine', 'Selisih']);
  const kFirst = s.next;
  for (const k of census?.payload?.keys ?? []) {
    const rr = s.next;
    s.row([
      k.key,
      k.name,
      F(`COUNTIF(${qs(SHEET.idfDocs)}!$B:$B,A${rr})`),
      F('P_IDF_N'),
      F(`LN(D${rr}/MAX(1,C${rr}))`, FULL),
      F(`MAX(P_IDF_MIN,E${rr})`, FULL),
      k.df,
      N(k.weight, FULL),
      F(`F${rr}-H${rr}`),
    ]);
  }
  const kLast = s.next - 1;
  s.blank();
  const rU = s.next;
  s.row([
    'Bobot untuk kunci yang tak pernah muncul',
    '',
    '',
    '',
    '',
    kLast >= kFirst ? F(`IF(MAX(F${kFirst}:F${kLast})>0,MAX(F${kFirst}:F${kLast}),MAX(P_IDF_MIN,LN(P_IDF_N/1)))`, FULL) : N(t?.career?.idf?.unseenWeight ?? null, FULL),
    '',
    N(census?.payload?.unseenWeight ?? t?.career?.idf?.unseenWeight ?? null, FULL),
    F(`IF(H${rU}="","",F${rU}-H${rU})`),
  ]);
  ctx.name('P_IDF_UNSEEN', SHEET.idf, 5, rU);
  if (kLast >= kFirst) ctx.checks.push({ label: 'IDF: bobot kekhasan', range: `'${SHEET.idf}'!$I$${kFirst}:$I$${rU}`, tolerance: 1e-12, note: '' });
}
