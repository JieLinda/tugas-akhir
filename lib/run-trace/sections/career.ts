// Relevansi Karier — from position history to the 0..100 score.
//
//   Karier - Stint        one row per (candidate, stint): dates → whole months →
//                         years; document or fallback similarity → sim′; age →
//                         recency; sim′ × years × recency
//   Pengganti - Pemegang  incumbents' competency rows of a stint position without
//                         a job profile: raw labels/scores → target level
//   Pengganti - Gabungan  their union, highest level per competency name
//   Pengganti - Pasangan  union × the target's required set, IDF-weighted
//   Karier - Pengganti    coverage per position (Σ w·v ÷ Σ w over measurable)
//   Karier - Target T     the IF chain that chose T_tahun / T_stint
//   Karier - Kandidat     Σ over stints → two axes → the combination rule (IF)
//
// Mirrors stintTenure / recencyDetail / applyCalibration / rescaleSim /
// matchCompetencySets / deriveDepthTargets / scoreCareerAspect.

import { BuildContext, SHEET } from '../context';
import type { LabelIndex } from './labels';
import { DATE_ONLY, DATE_TIME, F, FB, FS, FULL, N, serialOf, xcol, type Cell } from '../sheet';
import type { CareerFallbackTrace } from '../../../scoring-service/src/run-trace-types';

const qs = (n: string) => `'${n.replace(/'/g, "''")}'`;

export function collectCareerLabels(ctx: BuildContext, labels: Map<string, number | null>): void {
  for (const f of Object.values(ctx.t?.career?.fallbacks ?? {})) {
    for (const h of f.holders) {
      for (const row of h.rows) {
        for (const lbl of [row.proficiencyName, row.currentProficiencyName]) {
          if (lbl && !labels.has(lbl)) labels.set(lbl, null);
        }
      }
    }
  }
}

export function buildCareer(ctx: BuildContext, labelIndex: LabelIndex): void {
  const t = ctx.t;
  buildFallbackSheets(ctx, labelIndex);
  buildTargetSheet(ctx);

  // ── Karier - Stint ───────────────────────────────────────────────
  const s = ctx.sheet(SHEET.careerStints, [
    38, 24, 4, 34, 12, 10, 8, 19, 19, 9, 19, 11, 11, 8, 10, 10, 9, 10, 14, 8, 30, 16, 14, 40, 12, 14, 14, 12, 12, 12, 12, 12, 12, 9, 12, 9, 12, 9, 22,
  ]);
  s.row(['RIWAYAT JABATAN → TAHUN EFEKTIF (per stint)']);
  s.row([
    'Tanggal disimpan sebagai serial Excel UTC. Bulan penuh memakai tanggal KALENDER lokal proses (UTC + P_TZ_OFFSET). Stint berjalan (tanpa tanggal selesai / tahun 9999) dihitung sampai tanggal acuan dan tidak meluruh.',
  ]);
  s.blank();
  const C = {
    id: 0, name: 1, i: 2, title: 3, code: 4, company: 5, synthetic: 6, from: 7, to: 8, ongoing: 9, end: 10, fromLocal: 11,
    endLocal: 12, months: 13, years: 14, storedYears: 15, dYears: 16, status: 17, matchType: 18, jpId: 19, jpName: 20,
    basis: 21, docSim: 22, fbKey: 23, fbCov: 24, calibrated: 25, rawUsed: 26, sim: 27, since: 28, rec: 29, effY: 30,
    effR: 31, storedSim: 32, dSim: 33, storedRec: 34, dRec: 35, storedEffY: 36, dEffY: 37, reason: 38,
  };
  s.row([
    'Kandidat ID',
    'Nama',
    'i',
    'Jabatan',
    'Kode posisi',
    'Perusahaan',
    'Ditambah engine?',
    'Mulai (UTC)',
    'Selesai (UTC)',
    'Berjalan?',
    'Akhir masa dipakai (UTC)',
    'Mulai (lokal)',
    'Akhir (lokal)',
    'Bulan penuh',
    'Tahun (rumus)',
    'Tahun engine',
    'Selisih',
    'Status cocok',
    'Tipe cocok',
    'JP ID',
    'Job profile',
    'Basis',
    'Kemiripan dokumen m',
    'Kunci pengganti',
    'Cakupan pengganti',
    'Kemiripan terkalibrasi',
    'Kemiripan mentah dipakai',
    'sim′ (rumus)',
    'Tahun sejak berakhir',
    'Faktor recency',
    'Tahun efektif',
    'Stint efektif',
    'sim′ engine',
    'Selisih',
    'Recency engine',
    'Selisih',
    'Tahun efektif engine',
    'Selisih',
    'Alasan tidak dinilai',
  ]);
  const first = s.next;
  const fbSummary = `${qs(SHEET.careerFallback)}!$A:$M`;
  for (const id of ctx.order) {
    const ct = t?.candidates?.[id]?.career ?? null;
    if (!ct) continue;
    for (const st of ct.stints) {
      const r = s.next;
      const L = (k: keyof typeof C) => `${colLetter(C[k])}${r}`;
      const row: Cell[] = [];
      row[C.id] = id;
      row[C.name] = ctx.candName(id);
      row[C.i] = st.index + 1;
      row[C.title] = st.title;
      row[C.code] = st.positionId ?? '';
      row[C.company] = st.companyId ?? '';
      row[C.synthetic] = st.synthetic;
      row[C.from] = N(serialOf(st.validFrom), DATE_TIME);
      row[C.to] = N(serialOf(st.validTo), DATE_TIME);
      row[C.ongoing] = FB(`OR(${L('to')}="",YEAR(${L('to')})>=9999)`);
      row[C.end] = F(`IF(${L('from')}="","",IF(${L('ongoing')},P_REF_UTC,MIN(${L('to')},P_REF_UTC)))`, DATE_TIME);
      row[C.fromLocal] = F(`IF(${L('from')}="","",INT(${L('from')}+P_TZ_OFFSET))`, DATE_ONLY);
      row[C.endLocal] = F(`IF(${L('end')}="","",INT(${L('end')}+P_TZ_OFFSET))`, DATE_ONLY);
      row[C.months] = F(
        `IF(${L('from')}="","",IF(${L('end')}<=${L('from')},0,MAX(0,(YEAR(${L('endLocal')})-YEAR(${L('fromLocal')}))*12+(MONTH(${L('endLocal')})-MONTH(${L('fromLocal')}))-IF(DAY(${L('endLocal')})<DAY(${L('fromLocal')}),1,0))))`,
      );
      row[C.years] = F(`IF(${L('from')}="",P_KAR_UNDATED,IF(${L('end')}<=${L('from')},0,${L('months')}/12))`, FULL);
      row[C.storedYears] = N(st.years, FULL);
      row[C.dYears] = F(`${L('years')}-${L('storedYears')}`);
      row[C.status] = st.status;
      row[C.matchType] = st.matchType ?? '';
      row[C.jpId] = st.jobProfileId ?? '';
      row[C.jpName] = st.jobProfileName ?? '';
      row[C.basis] = st.basis;
      row[C.docSim] = N(st.documentSimilarity, FULL);
      row[C.fbKey] = st.fallbackKey ?? '';
      row[C.fbCov] = F(`IF(${L('fbKey')}="","",IFERROR(VLOOKUP(${L('fbKey')},${fbSummary},13,FALSE),""))`, FULL);
      row[C.calibrated] = F(
        `IF(AND(${L('basis')}="incumbent_competency",${L('fbCov')}<>""),MAX(0,MIN(1,P_KAR_FB_LO+MAX(0,MIN(1,${L('fbCov')}))*(P_KAR_FB_HI-P_KAR_FB_LO))),"")`,
        FULL,
      );
      row[C.rawUsed] = F(`IF(${L('basis')}="document",${L('docSim')},IF(${L('basis')}="incumbent_competency",${L('calibrated')},""))`, FULL);
      row[C.sim] = F(
        `IF(${L('rawUsed')}="","",IF(P_KAR_U>P_KAR_L,MAX(0,MIN(1,(${L('rawUsed')}-P_KAR_L)/(P_KAR_U-P_KAR_L))),MAX(0,MIN(1,${L('rawUsed')}))))`,
        FULL,
      );
      row[C.since] = F(`IF(OR(P_KAR_DECAY<=0,${L('ongoing')},${L('to')}>=P_REF_UTC),"",(P_REF_UTC-${L('to')})/P_KAR_HARI_TAHUN)`, FULL);
      row[C.rec] = F(`IF(${L('since')}="",1,EXP(-P_KAR_DECAY*${L('since')}))`, FULL);
      row[C.effY] = F(`IF(${L('sim')}="",0,${L('sim')}*${L('years')}*${L('rec')})`, FULL);
      row[C.effR] = F(`IF(${L('sim')}="",0,${L('sim')}*${L('rec')})`, FULL);
      row[C.storedSim] = N(st.similarity, FULL);
      row[C.dSim] = F(`IF(OR(${L('sim')}="",${L('storedSim')}=""),IF(${L('sim')}=${L('storedSim')},"","BEDA"),${L('sim')}-${L('storedSim')})`);
      row[C.storedRec] = N(st.recency, FULL);
      row[C.dRec] = F(`${L('rec')}-${L('storedRec')}`);
      row[C.storedEffY] = N(st.effectiveYears, FULL);
      row[C.dEffY] = F(`${L('effY')}-${L('storedEffY')}`);
      row[C.reason] = st.unscoredReason ?? '';
      s.row(row);
    }
  }
  const last = s.next - 1;
  if (last >= first) {
    for (const [label, col, tol] of [
      ['Karier: lama stint (tahun)', C.dYears, 1e-12],
      ['Karier: sim′ per stint', C.dSim, 1e-9],
      ['Karier: faktor recency', C.dRec, 1e-9],
      ['Karier: tahun efektif per stint', C.dEffY, 1e-9],
    ] as const) {
      ctx.checks.push({
        label,
        range: `'${SHEET.careerStints}'!$${colLetter(col)}$${first}:$${colLetter(col)}$${last}`,
        tolerance: tol,
        note: 'Rumus vs nilai engine pada presisi penuh.',
      });
    }
  }

  // ── Karier - Kandidat ────────────────────────────────────────────
  const k = ctx.sheet(SHEET.careerCand, [38, 24, 14, 14, 10, 10, 12, 12, 13, 13, 12, 14, 10, 12, 10, 12, 12, 12, 12, 10, 12]);
  k.row(['SKOR RELEVANSI KARIER per kandidat — dua sumbu dan aturan penggabungannya']);
  k.row([
    'Sumbu TAHUN = jenuh(Σ tahun efektif ÷ T_tahun); sumbu STINT = jenuh(Σ stint efektif ÷ T_stint); jenuh(x) = MIN(1,MAX(0,x)) atau ^(1/γ) bila γ > 1.',
  ]);
  k.row([
    'Aturan "perkalian" (berlaku): skor = MAX(0,MIN(1, sumbu_tahun × (1 − w + w × sumbu_stint))) × 100. Aturan "min" (run lama): skor = IF(sumbu_tahun ≤ sumbu_stint, sumbu_tahun, sumbu_stint) × 100.',
  ]);
  k.row([
    'Sumbu pengikat: perkalian → IF(1 − sumbu_tahun ≥ w × (1 − sumbu_stint), "tahun", "stint") (sumbu yang memotong poin lebih banyak); min → sumbu yang lebih kecil.',
  ]);
  k.blank();
  k.row([
    'Kandidat ID',
    'Nama',
    'Σ tahun efektif',
    'Σ stint efektif',
    'T_tahun',
    'T_stint',
    'Rasio tahun',
    'Rasio stint',
    'Sumbu tahun (jenuh)',
    'Sumbu stint (jenuh)',
    'Aturan',
    'Dinormalisasi',
    'Skor (rumus)',
    'Sumbu pengikat',
    'Skor dipakai TOPSIS',
    'Selisih',
    'Σ tahun efektif engine',
    'Selisih',
    'Sumbu tahun engine',
    'Pengikat engine',
    'Cek pengikat',
  ]);
  const kFirst = k.next;
  const S = (col: number) => xcol(SHEET.careerStints, col);
  for (const id of ctx.order) {
    const ct = t?.candidates?.[id]?.career ?? null;
    const r = k.next;
    const storedScore = ctx.storedAspects(id)?.career ?? null;
    const sat = (x: string) => `IF(P_KAR_GAMMA>1,MAX(0,MIN(1,${x}))^(1/P_KAR_GAMMA),MAX(0,MIN(1,${x})))`;
    k.row([
      id,
      ctx.candName(id),
      ct ? F(`SUMIFS(${S(C.effY)},${S(C.id)},A${r})`, FULL) : N(ctx.poolRow(id)?.details?.careerMatching?.effectiveYears ?? null, FULL),
      ct ? F(`SUMIFS(${S(C.effR)},${S(C.id)},A${r})`, FULL) : N(ctx.poolRow(id)?.details?.careerMatching?.effectiveRows ?? null, FULL),
      F('P_KAR_T_TAHUN'),
      F('P_KAR_T_STINT'),
      F(`IF(E${r}>0,C${r}/E${r},"")`, FULL),
      F(`IF(F${r}>0,D${r}/F${r},"")`, FULL),
      F(`IF(G${r}="",0,${sat(`G${r}`)})`, FULL),
      F(`IF(H${r}="",0,${sat(`H${r}`)})`, FULL),
      F('P_KAR_ATURAN'),
      F(`IF(K${r}="perkalian",MAX(0,MIN(1,I${r}*(1-P_KAR_W+P_KAR_W*J${r}))),IF(I${r}<=J${r},I${r},J${r}))`, FULL),
      F(`ROUND(L${r}*100,0)`),
      FS(`IF(K${r}="perkalian",IF(1-I${r}>=P_KAR_W*(1-J${r}),"tahun","stint"),IF(I${r}<=J${r},"tahun","stint"))`),
      storedScore,
      F(`IF(O${r}="","",M${r}-O${r})`),
      N(ct?.effectiveYears ?? null, FULL),
      F(`IF(Q${r}="","",C${r}-Q${r})`),
      N(ct?.depthYears ?? null, FULL),
      ct ? (ct.binding === 'years' ? 'tahun' : 'stint') : '',
      FS(`IF(T${r}="","",IF(N${r}=T${r},"","BEDA"))`),
    ]);
    ctx.setAspectCell(id, 'career', `${qs(SHEET.careerCand)}!$M$${r}`);
  }
  const kLast = k.next - 1;
  ctx.checks.push({ label: 'Karier: skor kriteria', range: `'${SHEET.careerCand}'!$P$${kFirst}:$P$${kLast}`, tolerance: 0, note: 'Skor karier (rumus) vs skor yang masuk matriks TOPSIS.' });
  ctx.checks.push({ label: 'Karier: Σ tahun efektif', range: `'${SHEET.careerCand}'!$R$${kFirst}:$R$${kLast}`, tolerance: 1e-9, note: '' });
  ctx.checks.push({ label: 'Karier: sumbu pengikat', range: `'${SHEET.careerCand}'!$U$${kFirst}:$U$${kLast}`, tolerance: 0, note: 'IF tahun/stint (rumus) vs engine.' });
  if (!t) ctx.gaps.push('Rincian per stint (tanggal, bulan penuh, recency presisi penuh) tidak tercatat pada run ini; lembar Karier memakai nilai tersimpan yang dibulatkan.');
}

// ── Fallback (incumbent competencies) ──────────────────────────────

function buildFallbackSheets(ctx: BuildContext, labelIndex: LabelIndex): void {
  const fallbacks: CareerFallbackTrace[] = Object.values(ctx.t?.career?.fallbacks ?? {});

  // Pemegang: every holder row, raw → target level (targetLevelOf).
  const h = ctx.sheet('Pengganti - Pemegang', [40, 12, 12, 19, 19, 8, 8, 18, 36, 36, 22, 8, 22, 8, 10, 10, 10, 10, 10, 10, 9]);
  h.row(['PEMEGANG JABATAN (jalur pengganti) — baris kompetensi sync_technical_competencies yang dipilih per pemegang']);
  h.row([
    'Level target (targetLevelOf) = level dari proficiency_name, else dari score (bulat 1–4), else dari current_proficiency_name, else dari current_score, else P_TEK_REQ_DEFAULT.',
  ]);
  h.blank();
  h.row([
    'Kunci pengganti',
    'Pemegang',
    'Perusahaan',
    'Mulai',
    'Selesai',
    'Aktif?',
    'Utama?',
    'Basis baris',
    'Kompetensi',
    'Nama diseragamkan',
    'proficiency_name',
    'score',
    'current_proficiency_name',
    'current_score',
    'Lv label',
    'Lv score',
    'Lv current label',
    'Lv current score',
    'Level target (rumus)',
    'Level engine',
    'Selisih',
  ]);
  const hFirst = h.next;
  const scoreLv = (c: string) => `IF(${c}="","",IF(AND(ROUND(${c},0)>=1,ROUND(${c},0)<=4),ROUND(${c},0),""))`;
  for (const f of fallbacks) {
    for (const holder of f.holders) {
      for (const row of holder.rows) {
        const r = h.next;
        h.row([
          f.key,
          holder.employeeId,
          holder.companyId ?? '',
          N(serialOf(holder.validFrom), DATE_TIME),
          N(serialOf(holder.validTo), DATE_TIME),
          holder.active,
          holder.isPrimary,
          holder.basis,
          row.name,
          row.norm,
          row.proficiencyName ?? '',
          row.score ?? '',
          row.currentProficiencyName ?? '',
          row.currentScore ?? '',
          F(labelIndex.levelOf(`K${r}`)),
          F(scoreLv(`L${r}`)),
          F(labelIndex.levelOf(`M${r}`)),
          F(scoreLv(`N${r}`)),
          F(`IF(O${r}<>"",O${r},IF(P${r}<>"",P${r},IF(Q${r}<>"",Q${r},IF(R${r}<>"",R${r},P_TEK_REQ_DEFAULT))))`),
          row.level,
          F(`S${r}-T${r}`),
        ]);
      }
    }
  }
  const hLast = h.next - 1;
  if (hLast >= hFirst) {
    ctx.checks.push({ label: 'Karier pengganti: level target pemegang', range: `'Pengganti - Pemegang'!$U$${hFirst}:$U$${hLast}`, tolerance: 0, note: '' });
  }

  // Gabungan: unionMaxLevel per key.
  const g = ctx.sheet('Pengganti - Gabungan', [40, 4, 36, 36, 12, 12, 22, 10, 10]);
  g.row(['GABUNGAN KOMPETENSI PEMEGANG per posisi — level TERTINGGI per nama (unionMaxLevel), bukan dijumlah atau dirata-rata']);
  g.blank();
  g.row(['Kunci pengganti', 'i', 'Kompetensi', 'Nama diseragamkan', 'Kode kamus', 'Level (rumus = MAXIFS)', 'Kunci identitas', 'Level engine', 'Selisih']);
  const gFirst = g.next;
  const HH = (col: number) => xcol('Pengganti - Pemegang', col);
  const unionRow = new Map<string, number>();
  for (const f of fallbacks) {
    f.union.forEach((u, i) => {
      const r = g.next;
      unionRow.set(`${f.key}#${i}`, r);
      g.row([
        f.key,
        i,
        u.name,
        u.norm,
        u.code ?? '',
        F(`_xlfn.MAXIFS(${HH(18)},${HH(0)},A${r},${HH(9)},D${r})`),
        FS(`IF(E${r}<>"","C:"&E${r},"N:"&D${r})`),
        u.level,
        F(`F${r}-H${r}`),
      ]);
    });
  }
  const gLast = g.next - 1;
  if (gLast >= gFirst) {
    ctx.checks.push({ label: 'Karier pengganti: level gabungan', range: `'Pengganti - Gabungan'!$I$${gFirst}:$I$${gLast}`, tolerance: 0, note: '' });
  }

  // Pasangan: union × required, IDF-weighted mean.
  const p = ctx.sheet('Pengganti - Pasangan', [40, 4, 34, 12, 34, 7, 22, 12, 16, 4, 34, 7, 14, 12, 12, 12, 10, 12, 12, 10]);
  p.row(['PASANGAN JALUR PENGGANTI — gabungan kompetensi pemegang × acuan posisi sasaran, bobot kekhasan IDF per kompetensi acuan']);
  p.row(['Rumus sel sama dengan Kompetensi Teknis (lembar Teknis - Pasangan). Bedanya hanya rata-ratanya DIBOBOT IDF: cakupan = Σ(w × nilai) ÷ Σ w atas kolom terukur.']);
  p.blank();
  p.row([
    'Kunci pengganti',
    'j',
    'Kompetensi acuan',
    'Kode',
    'Nama diseragamkan',
    'Level t',
    'Kunci identitas',
    'Bobot IDF w',
    'Tahap',
    'i',
    'Kompetensi pemegang',
    'Level k',
    'Cosinus mentah m',
    'sim′',
    'Faktor level',
    'Nilai sel',
    'Terukur?',
    'w × nilai',
    'Bobot engine',
    'Selisih bobot',
  ]);
  const pFirst = p.next;
  const idfUsed = Boolean(ctx.t?.career?.idf);
  for (const f of fallbacks) {
    const m = f.match;
    if (!m) continue;
    const identity = new Map(m.identity.map(([rj, ci]) => [rj, ci]));
    const assigned = new Map(m.assignment.map(([ci, rj]) => [rj, ci]));
    const required = f.required ?? ctx.t?.technical?.required ?? [];
    required.forEach((req, rj) => {
      const r = p.next;
      const ci = identity.get(rj) ?? assigned.get(rj) ?? null;
      const stage = identity.has(rj) ? 'identitas' : assigned.has(rj) ? 'Hungarian' : 'tidak berpasangan';
      let cos: number | null = null;
      if (stage === 'Hungarian' && ci != null) {
        cos = m.cellRaw[m.openHeld.indexOf(ci)]?.[m.openReq.indexOf(rj)] ?? null;
      }
      const u = ci != null ? f.union[ci] : null;
      // The fallback runs the TECHNICAL matcher, so its cosines stretch on the
      // technical anchors (vectors.anchors), not on the career ones.
      const sim = `IF(M${r}="",0,IF(P_TEK_U>P_TEK_L,MAX(0,MIN(1,(M${r}-P_TEK_L)/(P_TEK_U-P_TEK_L))),MAX(0,MIN(1,M${r}))))`;
      p.row([
        f.key,
        rj + 1,
        req.name,
        req.code ?? '',
        req.norm,
        req.level,
        FS(`IF(D${r}<>"","C:"&D${r},"N:"&E${r})`),
        idfUsed ? F(`IFERROR(VLOOKUP(G${r},${qs(SHEET.idf)}!$A:$F,6,FALSE),P_IDF_UNSEEN)`, FULL) : 1,
        stage,
        ci ?? '',
        u?.name ?? '',
        u ? (unionRow.has(`${f.key}#${ci}`) ? F(`${qs('Pengganti - Gabungan')}!$F$${unionRow.get(`${f.key}#${ci}`)}`) : u.level) : '',
        N(cos, FULL),
        F(`IF(I${r}="tidak berpasangan","",IF(I${r}="identitas",1,${sim}))`, FULL),
        F(
          `IF(I${r}="tidak berpasangan",0,IF(AND(I${r}<>"identitas",M${r}=""),0,IF(L${r}>=MAX(1,F${r}),IF(I${r}="identitas",MIN(1+(P_TEK_SURPLUS*(L${r}-MAX(1,F${r})))/3,P_TEK_LF_MAX),1),MAX(0,1-(MAX(1,F${r})-L${r})/P_TEK_SPAN))))`,
          FULL,
        ),
        F(`IF(I${r}="tidak berpasangan",0,IF(I${r}="identitas",O${r},N${r}*O${r}))`, FULL),
        FB(`OR(D${r}<>"",COUNTIFS(${xcol('Pengganti - Gabungan', 0)},A${r},${xcol('Pengganti - Gabungan', 6)},G${r})>0)`),
        F(`IF(Q${r},H${r}*P${r},0)`, FULL),
        N(m.weights[rj] ?? null, FULL),
        F(`IF(S${r}="","",H${r}-S${r})`),
      ]);
    });
  }
  const pLast = p.next - 1;
  if (pLast >= pFirst) {
    ctx.checks.push({ label: 'Karier pengganti: bobot IDF', range: `'Pengganti - Pasangan'!$T$${pFirst}:$T$${pLast}`, tolerance: 1e-12, note: '' });
  }

  // Ringkasan per kunci (VLOOKUP target of Karier - Stint, column 13 = cakupan).
  const a = ctx.sheet(SHEET.careerFallback, [44, 12, 12, 30, 18, 9, 7, 9, 12, 12, 14, 14, 14, 14, 10]);
  a.row(['JALUR PENGGANTI per posisi riwayat tanpa job profile — cakupan kompetensi']);
  a.row(['cakupan = MIN(1, Σ(w × nilai) ÷ Σ w), kolom terukur saja. Lalu di lembar Karier - Stint: m = lo + cakupan × (hi − lo).']);
  a.blank();
  a.row([
    'Kunci pengganti',
    'Kode posisi',
    'Perusahaan',
    'Dikecualikan (kandidat sendiri)',
    'Basis baris',
    'Pemegang',
    'M',
    'M_eff',
    'Σ w',
    'Σ w × nilai',
    'Cakupan mentah',
    'Cakupan dijenuhkan',
    'Cakupan (dipakai)',
    'Cakupan engine',
    'Selisih',
  ]);
  const aFirst = a.next;
  const PP = (col: number) => xcol('Pengganti - Pasangan', col);
  for (const f of fallbacks) {
    const r = a.next;
    const has = Boolean(f.match);
    a.row([
      f.key,
      f.code,
      f.companyId ?? '',
      f.excluded.join(' | '),
      f.basis ?? 'tidak ada pemegang / baris kompetensi',
      f.holders.length,
      has ? F(`COUNTIFS(${PP(0)},A${r})`) : 0,
      has ? F(`COUNTIFS(${PP(0)},A${r},${PP(16)},TRUE)`) : 0,
      has ? F(`SUMIFS(${PP(7)},${PP(0)},A${r},${PP(16)},TRUE)`, FULL) : 0,
      has ? F(`SUMIFS(${PP(17)},${PP(0)},A${r},${PP(16)},TRUE)`, FULL) : 0,
      has ? F(`IF(I${r}>0,J${r}/I${r},0)`, FULL) : '',
      has ? F(`MIN(1,K${r})`, FULL) : '',
      has ? F(`L${r}`, FULL) : '',
      N(f.normalized, FULL),
      has ? F(`IF(N${r}="","",M${r}-N${r})`) : '',
    ]);
  }
  const aLast = a.next - 1;
  if (aLast >= aFirst) {
    ctx.checks.push({ label: 'Karier pengganti: cakupan per posisi', range: `'${SHEET.careerFallback}'!$O$${aFirst}:$O$${aLast}`, tolerance: 1e-9, note: '' });
  }
}

// ── T_tahun / T_stint ────────────────────────────────────────────────

function buildTargetSheet(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.careerTarget, [46, 22, 70, 22, 12]);
  const d = ctx.t?.career?.depth ?? null;
  const ri = ctx.b.runInfo?.career?.depth ?? null;
  s.row(['TOLOK UKUR PENGALAMAN T_tahun & T_stint — rantai IF deriveDepthTargets']);
  s.row(['Urutan keputusan: (1) run turunan → diwarisi; (2) syarat JD terbaca → syarat (×pengali bila "scaled"); (3) sensus pengangkatan → median jenjang; (4) konstanta P_KAR_FIXED_T. Lalu dijepit ke [P_KAR_MIN_T, P_KAR_MAX_T] dan dibulatkan 3 desimal.']);
  s.blank();
  s.row(['Langkah', 'Nilai', 'Rumus / keterangan', 'Engine', 'Selisih']);
  const row = (label: string, value: Cell, note: string, engine: Cell = null): number => {
    const r = s.row([label, value, note, engine]);
    if (engine !== null) {
      s.rows[r - 1]![4] = F(`IF(OR(B${r}="",D${r}=""),IF(B${r}=D${r},"","BEDA"),IF(ISNUMBER(B${r}),B${r}-D${r},IF(B${r}=D${r},0,"BEDA")))`);
    }
    return r;
  };
  const pinned = d?.pinned ?? null;
  // A pinned (inherited) yardstick returns before the JD/census steps run, so
  // those steps have no engine value to compare against.
  const pinnedEngine = (c: Cell): Cell => (pinned ? null : c);
  const rPinned = row('Diwarisi dari run induk?', Boolean(pinned), 'TRUE = run turunan: T dibaca dari run induk, tidak diturunkan ulang.');
  const rPinY = row('T_tahun run induk', N(pinned?.targetYears ?? null, FULL), '');
  const rPinR = row('T_stint run induk', N(pinned?.targetRows ?? null, FULL), '');
  row('Syarat pengalaman pada JD (teks)', d?.statedExperience ?? ri?.statedExperienceText ?? '', 'Dibaca dari jobSpecification.experience job profile sasaran.');
  const rParsed = row(
    'Syarat terbaca (tahun)',
    N(d?.statedParsedYears ?? ri?.statedExperienceYears ?? null),
    'MASUKAN dari engine: angka pertama yang diikuti/didahului "tahun|thn|th|year(s)|yr(s)", 0 < n ≤ 40 (regex parseStatedExperienceYears). "Fresh graduate" → kosong.',
  );
  const rReads = row('Syarat JD dibaca?', FB(`AND(P_KAR_USE_STATED,P_KAR_MODE<>"ignore")`), '= AND(P_KAR_USE_STATED, P_KAR_MODE ≠ "ignore")', pinnedEngine(d ? d.readsStated : null));
  const rFrom = row(
    'Syarat setelah mode',
    F(`IF(OR(NOT(B${rReads}),B${rParsed}=""),"",IF(P_KAR_MODE="direct",B${rParsed},B${rParsed}*P_KAR_MULT))`, FULL),
    '= IF(mode = "direct", syarat, syarat × P_KAR_MULT)',
    pinnedEngine(N(d?.fromStated ?? null, FULL)),
  );
  row('Jenjang posisi sasaran', d?.level ?? '', `Dari judul posisi (levelFromTitle): ${d?.levelLabel ?? ri?.levelLabel ?? '—'}.`);
  // Measured anchor from the census sheet, when there is one.
  const rMeasured = row(
    'T terukur (sensus pengangkatan, jenjang ini)',
    ctx.depthMeasuredRef ? F(ctx.depthMeasuredRef) : N(d?.measured?.years ?? null),
    ctx.depthMeasuredRef
      ? `Dari lembar ${SHEET.censusDepth}: median jenjang, dengan penjaga monotonisitas (jenjang senior tidak boleh lebih mudah daripada jenjang di bawahnya).`
      : 'Sensus pengangkatan tidak tersimpan — nilai engine dipakai sebagai masukan.',
    pinnedEngine(N(d?.measured?.years ?? null)),
  );
  const rDefault = row(
    'T bawaan',
    F(`IF(AND(P_KAR_DEFAULT_SRC="measured",B${rMeasured}<>""),B${rMeasured},P_KAR_FIXED_T)`, FULL),
    '= IF(sumber bawaan = "measured" DAN T terukur ada, T terukur, P_KAR_FIXED_T)',
    pinnedEngine(N(d?.defaultYears ?? null, FULL)),
  );
  const rUse = row(
    'Pakai syarat JD?',
    FB(`AND(B${rFrom}<>"",OR(NOT(P_KAR_ONLY_ABOVE),B${rFrom}>B${rDefault}))`),
    '= AND(syarat ada, OR(NOT hanya-boleh-menaikkan, syarat > T bawaan))',
    pinnedEngine(d ? d.useStated : null),
  );
  const rRawT = row('T sebelum dijepit', F(`IF(B${rUse},B${rFrom},B${rDefault})`, FULL), '');
  const rTy = row(
    'T_tahun (dipakai)',
    F(`IF(B${rPinned},B${rPinY},ROUND(MAX(P_KAR_MIN_T,MIN(P_KAR_MAX_T,B${rRawT})),3))`, FULL),
    '= IF(diwarisi, T induk, ROUND(MAX(min, MIN(maks, T)), 3))',
    N(d?.targetYears ?? ri?.targetYears ?? null, FULL),
  );
  const rTr = row(
    'T_stint (dipakai)',
    F(`IF(B${rPinned},B${rPinR},ROUND(MAX(P_KAR_MIN_R,MIN(P_KAR_MAX_R,P_KAR_FIXED_R)),3))`, FULL),
    '= IF(diwarisi, T induk, ROUND(MAX(min, MIN(maks, P_KAR_FIXED_R)), 3))',
    N(d?.targetRows ?? ri?.targetRows ?? null, FULL),
  );
  row(
    'Sumber T',
    FS(`IF(B${rPinned},"inherited",IF(B${rUse},"jd",IF(AND(P_KAR_DEFAULT_SRC="measured",B${rMeasured}<>""),"measured","fixed")))`),
    '',
    d?.source ?? ri?.source ?? null,
  );
  ctx.name('P_KAR_T_TAHUN', SHEET.careerTarget, 1, rTy);
  ctx.name('P_KAR_T_STINT', SHEET.careerTarget, 1, rTr);
  ctx.checks.push({ label: 'Karier: T_tahun / T_stint', range: `'${SHEET.careerTarget}'!$E$5:$E$${s.next - 1}`, tolerance: 1e-9, note: 'Rantai IF (rumus) vs keputusan engine.' });
}

function colLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

