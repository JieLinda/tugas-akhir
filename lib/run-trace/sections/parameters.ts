// Sheet "Parameter": every constant and setting a formula in the workbook reads,
// with where its value came from, each exposed as a defined name (P_…) so the
// formulas elsewhere read `P_TEK_L` rather than an address.
//
// Provenance is stated per row, because the four sources carry different weight:
//   trace     — recorded by scoring-service when THIS run was computed;
//   run_info  — the run's own diagnostics (older runs: the only record);
//   snapshot  — config_snapshot, frozen when the run was created;
//   kode      — the code default, used ONLY when the run recorded nothing. Such a
//               row says so, because a default is not evidence of what applied.

import { BuildContext, SHEET } from '../context';
import { DATE_TIME, F, FULL, N, serialOf, type Cell } from '../sheet';

type Src = 'trace' | 'run_info' | 'snapshot' | 'kode' | 'rumus';
const SRC_LABEL: Record<Src, string> = {
  trace: 'Jejak run (dicatat scoring-service saat run dihitung)',
  run_info: 'run_info (diagnostik run)',
  snapshot: 'config_snapshot (dibekukan saat run dibuat)',
  kode: 'NILAI BAWAAN KODE — run ini tidak mencatatnya',
  rumus: 'Rumus di workbook ini',
};

function pick<T>(...candidates: [T | null | undefined, Src][]): { value: T | null; src: Src } {
  for (const [v, s] of candidates) if (v !== null && v !== undefined) return { value: v, src: s };
  return { value: null, src: 'kode' };
}

export function buildParameters(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.params, [26, 46, 18, 70, 44, 18]);
  const t = ctx.t;
  const p = t?.parameters ?? null;
  const ri = ctx.b.runInfo ?? {};
  const frozen = ri.frozen ?? null;

  s.row(['PARAMETER & KONSTANTA RUN']);
  s.row(['Setiap rumus di workbook ini merujuk parameter lewat NAMA SEL (kolom F), mis. P_TEK_L. Ubah nilai di kolom C untuk melihat pengaruhnya — seluruh lembar menghitung ulang.']);
  s.blank();
  s.row(['Kelompok', 'Parameter', 'Nilai', 'Satuan / keterangan', 'Sumber nilai', 'Nama sel']);

  const add = (
    group: string,
    label: string,
    value: Cell,
    desc: string,
    src: Src,
    name?: string,
  ): number => {
    const r = s.row([group, label, value, desc, SRC_LABEL[src], name ?? '']);
    if (name) ctx.name(name, SHEET.params, 2, r);
    return r;
  };

  // ── Waktu ─────────────────────────────────────────────────────────
  const ref = pick<string>([t?.referenceDate, 'trace'], [frozen?.referenceDate, 'run_info'], [ctx.b.run.createdAt, 'kode']);
  add(
    'Waktu',
    'Tanggal acuan penilaian (UTC)',
    N(serialOf(ref.value), DATE_TIME),
    'Pers. 2.5: umur stint & masa jabatan berjalan diukur sampai instan ini. Disimpan sebagai serial Excel UTC.',
    ref.src === 'kode' ? 'kode' : ref.src,
    'P_REF_UTC',
  );
  const offMin = t?.process?.offsetMinutes ?? null;
  add(
    'Waktu',
    'Selisih zona waktu proses scoring-service (hari)',
    F(`${offMin ?? 420}/1440`),
    `Bulan penuh dihitung dari tanggal KALENDER lokal proses (getFullYear/getMonth/getDate). Zona: ${t?.process?.timeZone ?? 'tidak tercatat (diasumsikan Asia/Jakarta, +07:00)'}; ${offMin ?? 420} menit.`,
    offMin != null ? 'trace' : 'kode',
    'P_TZ_OFFSET',
  );

  // ── Kompetensi Teknis ────────────────────────────────────────────
  const tl = pick<number>(
    [t?.technical?.anchors?.simFloor, 'trace'],
    [frozen?.anchors?.technical?.simFloor, 'run_info'],
    [ri.technical?.simFloor, 'run_info'],
  );
  const tu = pick<number>(
    [t?.technical?.anchors?.simCeil, 'trace'],
    [frozen?.anchors?.technical?.simCeil, 'run_info'],
    [ri.technical?.simCeil, 'run_info'],
  );
  const tSrc = t?.technical?.anchors?.source ?? frozen?.anchors?.technical?.source ?? ri.technical?.simAnchorSource ?? '—';
  add('Teknis', 'Batas bawah kemiripan L (jangkar)', N(tl.value, FULL), `sim′ = 0 pada atau di bawah L. Asal jangkar: ${tSrc}. Lihat lembar ${SHEET.techAnchors}.`, tl.src, 'P_TEK_L');
  add('Teknis', 'Batas atas kemiripan U (jangkar)', N(tu.value, FULL), 'sim′ = 1 pada atau di atas U.', tu.src, 'P_TEK_U');
  add('Teknis', 'Rentang selisih level (SPAN)', p?.technical?.levelGapSpan ?? 4, 'Faktor level bila k < t: 1 − (t − k) ÷ SPAN. Env TECHNICAL_LEVEL_GAP_SPAN.', p ? 'trace' : 'kode', 'P_TEK_SPAN');
  add('Teknis', 'Surplus kelebihan level (SURPLUS)', p?.technical?.overQualificationSurplus ?? 0.75, 'Pasangan identitas, k ≥ t: 1 + SURPLUS × (k − t) ÷ 3. Env TECHNICAL_OVERQUALIFICATION_SURPLUS.', p ? 'trace' : 'kode', 'P_TEK_SURPLUS');
  add('Teknis', 'Plafon faktor level', F('1+P_TEK_SURPLUS'), '= 1 + SURPLUS (dicapai pada syarat Basic vs dimiliki Mastery).', 'rumus', 'P_TEK_LF_MAX');
  add('Teknis', 'Level pengganti bila level kandidat tak terbaca', p?.technical?.unknownLevelStandIn ?? 1, 'Dipakai hanya untuk mencari vektor; faktor level-nya NETRAL (= 1).', p ? 'trace' : 'kode', 'P_TEK_LVL_STANDIN');
  add('Teknis', 'Level dituntut bila job profile tidak menyebut', p?.technical?.defaultRequiredLevel ?? 2, 'normalizeRequiredLevel / targetLevelOf: default 2 (Intermediate).', p ? 'trace' : 'kode', 'P_TEK_REQ_DEFAULT');

  // ── Relevansi Karier ─────────────────────────────────────────────
  const kl = pick<number>(
    [t?.career?.anchors?.simFloor, 'trace'],
    [frozen?.anchors?.career?.simFloor, 'run_info'],
    [ri.career?.scale?.simFloor, 'run_info'],
  );
  const ku = pick<number>(
    [t?.career?.anchors?.simCeil, 'trace'],
    [frozen?.anchors?.career?.simCeil, 'run_info'],
    [ri.career?.scale?.simCeil, 'run_info'],
  );
  const kSrc = t?.career?.anchors?.source ?? frozen?.anchors?.career?.source ?? ri.career?.scale?.source ?? '—';
  add('Karier', 'Batas bawah kemiripan dokumen L (jangkar)', N(kl.value, FULL), `sim′ = (m − L) ÷ (U − L), dipotong 0..1. Asal: ${kSrc}. Lihat ${SHEET.careerAnchors}.`, kl.src, 'P_KAR_L');
  add('Karier', 'Batas atas kemiripan dokumen U (jangkar)', N(ku.value, FULL), '', ku.src, 'P_KAR_U');
  const depth = ri.career?.depth ?? null;
  const decay = pick<number>([p?.career?.recencyDecayPerYear, 'trace'], [depth?.recencyDecayPerYear, 'run_info']);
  add('Karier', 'Laju peluruhan pengalaman δ (per tahun)', decay.value ?? 0, 'r(i) = EXP(−δ × tahun sejak stint berakhir); stint berjalan → 1. 0 = tanpa peluruhan (aturan lama).', decay.src, 'P_KAR_DECAY');
  add('Karier', 'Hari per tahun', p?.career?.daysPerYear ?? 365.25, 'Pembagi umur stint: (acuan − akhir) ÷ 365,25 hari.', p ? 'trace' : 'kode', 'P_KAR_HARI_TAHUN');
  const w = pick<number>([p?.career?.breadthWeight, 'trace'], [depth?.breadthWeight, 'run_info']);
  add(
    'Karier',
    'Bobot keragaman w',
    w.value ?? 0,
    w.value == null
      ? 'TIDAK TERCATAT — run memakai aturan lama min(kedalaman tahun, kedalaman stint). Lihat P_KAR_ATURAN.'
      : 'skor = kedalaman_tahun × (1 − w + w × kedalaman_stint).',
    w.src,
    'P_KAR_W',
  );
  add(
    'Karier',
    'Aturan penggabungan dua sumbu',
    w.value == null ? 'min' : 'perkalian',
    '"perkalian" = aturan berlaku; "min" = aturan lama. Rumus skor Career memakai IF atas sel ini.',
    w.value == null ? 'run_info' : w.src,
    'P_KAR_ATURAN',
  );
  const gamma = pick<number>([p?.career?.concavity, 'trace'], [depth?.concavity, 'run_info']);
  add('Karier', 'Kelandaian γ (Mincer)', gamma.value ?? 1, 'jenuh(x) = MIN(1,MAX(0,x))^(1/γ) bila γ > 1; γ = 1 → linear (bawaan).', gamma.value == null ? 'kode' : gamma.src, 'P_KAR_GAMMA');
  add('Karier', 'Lama stint tanpa tanggal mulai (tahun)', p?.career?.undatedStintYears ?? 1, 'stintYears: tanpa tanggal mulai → 1 tahun.', p ? 'trace' : 'kode', 'P_KAR_UNDATED');
  const cal = t?.career?.calibration ?? ri.career?.calibration ?? null;
  add('Karier', 'Jalur pengganti: lo', N(cal?.lo ?? null, FULL), 'm(i) = lo + cakupan × (hi − lo). Lihat lembar Karier - Pengganti.', t?.career?.calibration ? 'trace' : cal ? 'run_info' : 'kode', 'P_KAR_FB_LO');
  add('Karier', 'Jalur pengganti: hi', N(cal?.hi ?? null, FULL), `hi = lo + cap × (batas atas penuh − lo); sumber kalibrasi: ${cal?.source ?? 'tidak dipakai'}.`, t?.career?.calibration ? 'trace' : cal ? 'run_info' : 'kode', 'P_KAR_FB_HI');
  add('Karier', 'Jalur pengganti: plafon cap', p?.careerFallback?.cap ?? cal?.cap ?? 0.5, 'Bagian rentang penuh yang boleh dicapai cakupan 100%. Env CAREER_FALLBACK_CAP.', p ? 'trace' : cal?.cap != null ? 'run_info' : 'kode', 'P_KAR_FB_CAP');
  add('Karier', 'IDF: bobot minimum', p?.careerFallback?.idfMinWeight ?? 0.15, 'bobot(k) = MAX(minimum, LN(N ÷ df(k))).', p ? 'trace' : 'kode', 'P_IDF_MIN');
  add('Karier', 'Target T: konstanta tetap (tahun)', p?.career?.fixedTargetYears ?? 8, 'Dipakai bila JD tak menyebut syarat dan sensus pengangkatan tak tersedia. Env CAREER_DEPTH_TARGET_YEARS.', p ? 'trace' : 'kode', 'P_KAR_FIXED_T');
  add('Karier', 'Target T: batas bawah (tahun)', p?.career?.minTargetYears ?? 3, 'Env CAREER_DEPTH_MIN_TARGET_YEARS.', p ? 'trace' : 'kode', 'P_KAR_MIN_T');
  add('Karier', 'Target T: batas atas (tahun)', p?.career?.maxTargetYears ?? 20, 'Env CAREER_DEPTH_MAX_TARGET_YEARS.', p ? 'trace' : 'kode', 'P_KAR_MAX_T');
  add('Karier', 'Target stint: konstanta tetap', p?.career?.fixedTargetRows ?? 2, 'Env CAREER_DEPTH_TARGET_ROWS.', p ? 'trace' : 'kode', 'P_KAR_FIXED_R');
  add('Karier', 'Target stint: batas bawah', p?.career?.minTargetRows ?? 1, '', p ? 'trace' : 'kode', 'P_KAR_MIN_R');
  add('Karier', 'Target stint: batas atas', p?.career?.maxTargetRows ?? 8, '', p ? 'trace' : 'kode', 'P_KAR_MAX_R');
  add('Karier', 'Pengali syarat JD', p?.career?.statedExperienceMultiplier ?? depth?.statedExperienceMultiplier ?? 1, 'Mode "scaled": T = syarat × pengali. Env CAREER_DEPTH_STATED_MULTIPLIER.', p ? 'trace' : depth?.statedExperienceMultiplier != null ? 'run_info' : 'kode', 'P_KAR_MULT');
  add('Karier', 'Mode syarat JD', p?.career?.statedMode ?? depth?.statedMode ?? 'scaled', '"scaled" | "direct" | "ignore". Env CAREER_DEPTH_STATED_MODE.', p ? 'trace' : depth?.statedMode ? 'run_info' : 'kode', 'P_KAR_MODE');
  add('Karier', 'Syarat JD hanya boleh menaikkan T', p?.career?.statedExperienceOnlyAboveFixed ?? false, 'Env CAREER_DEPTH_STATED_ONLY_ABOVE_FIXED.', p ? 'trace' : 'kode', 'P_KAR_ONLY_ABOVE');
  add('Karier', 'Baca syarat pengalaman JD', p?.career?.useStatedExperience ?? true, 'Env CAREER_DEPTH_USE_STATED.', p ? 'trace' : 'kode', 'P_KAR_USE_STATED');
  add('Karier', 'Sumber T bawaan', p?.career?.defaultSource ?? 'measured', '"measured" (sensus pengangkatan) | "constant". Env CAREER_DEPTH_DEFAULT_SOURCE.', p ? 'trace' : 'kode', 'P_KAR_DEFAULT_SRC');
  add('Karier', 'Sensus pengangkatan: minimum sampel per jenjang', p?.careerDepthCensus?.minLevelSamples ?? 10, 'Di bawahnya median jenjang tidak dipakai sendiri.', p ? 'trace' : 'kode', 'P_DEPTH_MIN_N');

  // ── PA ───────────────────────────────────────────────────────────
  add('Performance Appraisal', 'Jangkar ideal positif (semua A)', p?.performance?.idealPositive ?? 4, '', p ? 'trace' : 'kode', 'P_PA_POS');
  add('Performance Appraisal', 'Jangkar ideal negatif (semua D)', p?.performance?.idealNegative ?? 1, '', p ? 'trace' : 'kode', 'P_PA_NEG');
  add('Performance Appraisal', 'Peluruhan preferensi periode', p?.performance?.recencyDecay ?? 0.8, 'Preferensi slot k = peluruhan^(k−1); env PA_RECENCY_DECAY.', p ? 'trace' : 'kode', 'P_PA_DECAY');
  s.blank();
  s.row(['Performance Appraisal', 'Bobot periode (AHP dari preferensi 0,8^k — konsisten sempurna, CR = 0)']);
  s.row(['', 'Slot k', 'Preferensi p(k)', 'Bobot w(k) = p(k) ÷ Σp (rumus)', 'Bobot tercatat (engine)', 'Selisih']);
  const wStart = s.next;
  const storedW = p?.performance?.periodWeights ?? null;
  for (let k = 1; k <= 6; k++) {
    const r = s.next;
    s.row([
      '',
      k,
      F(`P_PA_DECAY^(B${r}-1)`),
      F(`C${r}/SUM($C$${wStart}:$C$${wStart + 5})`, FULL),
      N(storedW?.[k - 1] ?? null, FULL),
      F(`IF(E${r}="","",D${r}-E${r})`),
    ]);
  }
  ctx.nameRange('P_PA_W', SHEET.params, 3, wStart, 3, wStart + 5);
  ctx.checks.push({ label: 'Bobot periode PA', range: `'${SHEET.params}'!$F$${wStart}:$F$${wStart + 5}`, tolerance: 1e-12, note: 'Bobot AHP dari matriks konsisten = p(k) ÷ Σp.' });
  s.blank();
  s.row(['Performance Appraisal', 'Nilai huruf PA (slot kosong / tak dikenal dibaca C)']);
  s.row(['', 'Huruf', 'Nilai']);
  const gStart = s.next;
  const gv = p?.performance?.gradeValues ?? { A: 4, B: 3, C: 2, D: 1, E: 0 };
  for (const [g, v] of Object.entries(gv)) s.row(['', g, v]);
  ctx.nameRange('P_PA_TABEL', SHEET.params, 1, gStart, 2, gStart + Object.keys(gv).length - 1);
  ctx.name('P_PA_C', SHEET.params, 2, gStart + Object.keys(gv).indexOf('C'));

  // ── HAV ──────────────────────────────────────────────────────────
  s.blank();
  s.row(['HAV', 'Skor per kuadran (kuadran lain / kosong → P_HAV_MISSING)']);
  s.row(['', 'Kuadran', 'Skor']);
  const hStart = s.next;
  const hav = p?.hav?.groupScores ?? { 1: 100, 2: 80, 3: 80, 4: 80, 7: 80, 8: 80, 5: 60, 6: 60, 9: 60, 13: 60, 14: 60, 10: 40, 11: 40, 12: 40, 15: 40, 16: 20 };
  const havKeys = Object.keys(hav).map(Number).sort((a, b) => a - b);
  for (const k of havKeys) s.row(['', k, (hav as any)[k]]);
  ctx.nameRange('P_HAV_TABEL', SHEET.params, 1, hStart, 2, hStart + havKeys.length - 1);
  add('HAV', 'Skor bila kuadran kosong / tak terbaca', p?.hav?.missingScore ?? 40, '', p ? 'trace' : 'kode', 'P_HAV_MISSING');
  // The formula tier's 4×4 matrix: rows = behavioural band, columns = PA band.
  const matrix = p?.hav?.quadrantMatrix ?? null;
  if (matrix) {
    s.blank();
    s.row(['HAV', 'Matriks kuadran rumus (baris = pita behavior, kolom = pita PA)']);
    const bands = ['High', 'Mid High', 'Mid Low', 'Low'];
    const hr = s.row(['', 'Behavior \\ PA', ...bands]);
    const mStart = s.next;
    for (const comp of bands) s.row(['', comp, ...bands.map((perf) => matrix[comp]?.[perf] ?? null)]);
    ctx.nameRange('P_HAV_MATRIX', SHEET.params, 2, mStart, 5, mStart + 3);
    ctx.nameRange('P_HAV_ROWS', SHEET.params, 1, mStart, 1, mStart + 3);
    ctx.nameRange('P_HAV_COLS', SHEET.params, 2, hr, 5, hr);
  }

  // ── Behavior ─────────────────────────────────────────────────────
  s.blank();
  s.row(['Behavior', 'Kategori rekomendasi → nilai ordinal (berpasangan; urutan = prioritas pencocokan)']);
  s.row(['', 'Indeks', 'Kategori', 'Nilai ordinal']);
  const bStart = s.next;
  const ranking = p?.behavior?.ranking ?? [];
  const values = p?.behavior?.values ?? [];
  ranking.forEach((cat, i) => s.row(['', i, cat, values[i] ?? 0]));
  if (ranking.length > 0) ctx.nameRange('P_BEH_TABEL', SHEET.params, 2, bStart, 3, bStart + ranking.length - 1);
  add('Behavior', 'Nilai ordinal maksimum', p?.behavior?.valueMax ?? 6, 'skor = ROUND(nilai × 100 ÷ maks, 0).', p ? 'trace' : 'kode', 'P_BEH_MAX');

  // ── Pendidikan ───────────────────────────────────────────────────
  s.blank();
  s.row(['Pendidikan', 'Skor sumbu jenjang (aturan tetap)']);
  s.row(['', 'Perbandingan', 'Skor']);
  const eStart = s.next;
  const tier = p?.education?.tierScores ?? { higher: 100, equal: 80, lower: 50 };
  s.row(['', 'higher', tier.higher]);
  s.row(['', 'equal', tier.equal]);
  s.row(['', 'lower', tier.lower]);
  ctx.nameRange('P_EDU_TIER', SHEET.params, 1, eStart, 2, eStart + 2);
  s.blank();
  s.row(['Pendidikan', 'Peringkat jenjang per token (D4 = S1 = 8, KKNI 6)']);
  s.row(['', 'Token', 'Peringkat']);
  const rStart = s.next;
  const ranks = p?.education?.levelRanks ?? {};
  for (const [tok, rank] of Object.entries(ranks)) s.row(['', tok, rank]);
  if (Object.keys(ranks).length > 0) ctx.nameRange('P_EDU_RANK', SHEET.params, 1, rStart, 2, rStart + Object.keys(ranks).length - 1);
  add('Pendidikan', 'Model penilai relevansi (jalur 2)', p?.education?.model ?? ri.models?.education?.model ?? '—', 'Jawaban model adalah MASUKAN di lembar Pendidikan, bukan rumus: model bahasa tidak deterministik.', p ? 'trace' : 'run_info');

  // ── TOPSIS & penyajian ───────────────────────────────────────────
  s.blank();
  add('TOPSIS', 'Pengganti pembagi kolom nol', p?.topsis?.zeroNormStandIn ?? 1e-9, 'norm_j = √Σx² , atau 1E-9 bila 0 (tidak pernah membagi nol).', p ? 'trace' : 'kode', 'P_TOPSIS_ZERO');
  add('TOPSIS', 'Kedekatan bila D⁺ + D⁻ = 0', p?.topsis?.tieCloseness ?? 0.5, '', p ? 'trace' : 'kode', 'P_TOPSIS_TIE');
  const nFinal = ctx.t?.topsis?.targetFinalists ?? ri.finalists ?? ctx.b.pool.filter((x) => x.isFinalist).length;
  add('TOPSIS', 'Jumlah finalis N', nFinal, 'Peringkat ≤ N = finalis. Pemecah seri: closeness menurun, lalu candidate_id menaik.', ctx.t ? 'trace' : 'run_info', 'P_N');

  s.blank();
  s.row(['Readiness', 'Ambang kesiapan (dibaca BERURUTAN, ambang pertama yang terpenuhi menang)']);
  s.row(['', 'Urutan', 'Skor minimum', 'Tingkat']);
  const thr =
    ctx.t?.readiness?.thresholds ??
    ctx.b.configSnapshot?.readiness?.thresholds ??
    ri.readiness?.thresholds?.thresholds ??
    [];
  const defLevel =
    ctx.t?.readiness?.defaultLevel ??
    ctx.b.configSnapshot?.readiness?.defaultLevel ??
    ri.readiness?.thresholds?.defaultLevel ??
    'Not Ready';
  const thStart = s.next;
  (thr as { minScore: number; level: string }[]).forEach((x, i) => s.row(['', i + 1, x.minScore, x.level]));
  if (thr.length > 0) ctx.nameRange('P_READY_MIN', SHEET.params, 2, thStart, 2, thStart + thr.length - 1);
  add('Readiness', 'Tingkat di bawah semua ambang', defLevel, '', ctx.t ? 'trace' : 'snapshot', 'P_READY_DEFAULT');
  // Remember where the thresholds are so TOPSIS can build its nested IF.
  ctx.readinessRows = (thr as { minScore: number; level: string }[]).map((x, i) => ({
    minRef: `'${SHEET.params}'!$C$${thStart + i}`,
    levelRef: `'${SHEET.params}'!$D$${thStart + i}`,
    level: x.level,
  }));

  if (!p) {
    ctx.gaps.push(
      'Run ini tidak menyimpan parameter proses scoring-service (dihitung sebelum jejak tersedia). Baris berlabel "NILAI BAWAAN KODE" adalah nilai bawaan kode saat ini, BUKAN bukti nilai yang berlaku waktu itu.',
    );
  }
}
