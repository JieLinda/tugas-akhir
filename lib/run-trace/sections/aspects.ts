// Behavior, Performance Appraisal, HAV and Pendidikan — the four aspects scored
// from one or two raw values each. Formulas mirror traceBehaviorAspect,
// tracePerformanceAspect (absoluteAnchorTopsisDetailed), traceHavScore +
// resolveEffectiveHav, and compareEducationLevel / composeEducationScore.

import { BuildContext, SHEET } from '../context';
import { F, FB, FS, FULL, N, colName, type Cell } from '../sheet';

const qs = (n: string) => `'${n.replace(/'/g, "''")}'`;

export function buildAspects(ctx: BuildContext): void {
  buildBehavior(ctx);
  buildPerformance(ctx);
  buildHav(ctx);
  buildEducation(ctx);
}

/** The raw strings a run scored a candidate on — the trace's, else the stored rawInputs. */
function rawInputs(ctx: BuildContext, id: string): Record<string, any> {
  return (ctx.poolRow(id)?.details?.rawInputs ?? {}) as Record<string, any>;
}

function buildBehavior(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.behavior, [38, 24, 36, 36, 36, 11, 36, 10, 8, 10, 10, 12, 9]);
  s.row(['BEHAVIOR — label rekomendasi asesmen → nilai ordinal 6..0 → skor 0..100']);
  s.row([
    'Diseragamkan = UPPER, "–"/"—" → "-", spasi dirapikan. Pencocokan berurutan: SAMA PERSIS → kategori TERPANJANG yang terkandung dalam label → kategori TERPENDEK yang memuat label. skor = ROUND(nilai × 100 ÷ P_BEH_MAX, 0); tanpa kategori → 0.',
  ]);
  s.blank();
  s.row([
    'Kandidat ID',
    'Nama',
    'Label mentah',
    'Diseragamkan (rumus)',
    'Diseragamkan engine',
    'Cara cocok',
    'Kategori cocok',
    'Cek cocok',
    'Indeks',
    'Nilai ordinal',
    'Skor (rumus)',
    'Skor dipakai TOPSIS',
    'Selisih',
  ]);
  const first = s.next;
  const cats = ctx.hasName('P_BEH_TABEL') ? `INDEX(P_BEH_TABEL,0,1)` : null;
  for (const id of ctx.order) {
    const bt = ctx.t?.candidates?.[id]?.behavior ?? null;
    const r = s.next;
    const label = bt ? bt.raw : rawInputs(ctx, id).behaviorRecommendation ?? null;
    const stored = ctx.storedAspects(id)?.behavior ?? null;
    s.row([
      id,
      ctx.candName(id),
      label ?? '',
      FS(`UPPER(TRIM(SUBSTITUTE(SUBSTITUTE(C${r},"–","-"),"—","-")))`),
      bt?.normalized ?? '',
      bt?.method ?? (bt ? 'none' : 'tidak tercatat'),
      bt?.category ?? '',
      bt
        ? FB(`IF(F${r}="exact",EXACT(D${r},G${r}),IF(F${r}="contains",ISNUMBER(FIND(G${r},D${r})),IF(F${r}="contained",ISNUMBER(FIND(D${r},G${r})),G${r}="")))`)
        : '',
      bt && cats ? F(`IF(G${r}="","",MATCH(G${r},${cats},0)-1)`) : bt?.index ?? '',
      bt && ctx.hasName('P_BEH_TABEL') ? F(`IF(G${r}="","",VLOOKUP(G${r},P_BEH_TABEL,2,FALSE))`) : bt?.value ?? '',
      bt ? F(`IF(J${r}="",0,ROUND(J${r}*100/P_BEH_MAX,0))`) : stored,
      stored,
      F(`IF(L${r}="","",K${r}-L${r})`),
    ]);
    ctx.setAspectCell(id, 'behavior', `${qs(SHEET.behavior)}!$K$${r}`);
  }
  ctx.checks.push({ label: 'Behavior: skor kriteria', range: `'${SHEET.behavior}'!$M$${first}:$M$${s.next - 1}`, tolerance: 0, note: '' });
}

function buildPerformance(ctx: BuildContext): void {
  // Slots: the CSV as the engine split it — usually 6, newest first.
  const partsOf = (id: string): { parts: string[]; fromTrace: boolean } => {
    const pt = ctx.t?.candidates?.[id]?.performance ?? null;
    if (pt) return { parts: pt.parts, fromTrace: true };
    const raw = rawInputs(ctx, id).performanceGrade;
    return { parts: String(raw ?? '').split(',').map((p) => p.trim().toUpperCase()), fromTrace: false };
  };
  const K = Math.max(6, ...ctx.order.map((id) => partsOf(id).parts.length));
  const s = ctx.sheet(SHEET.pa, [38, 24, 26, 7, ...Array(K * 3).fill(8), 12, 12, 12, 10, 12, 9, 12, 9]);
  s.row(['PERFORMANCE APPRAISAL — TOPSIS berjangkar absolut atas slot semester (terbaru lebih dulu)']);
  s.row([
    'nilai(k) = huruf → angka (P_PA_TABEL), kosong/tak dikenal → C. bobot mentah(k) = P_PA_W(k) untuk k ≤ 6, slot ke-7 dst memakai bobot slot 6; lalu dinormalisasi atas slot yang ADA.',
  ]);
  s.row(['D⁺ = √Σ w(k)·(x(k) − P_PA_POS)² · D⁻ = √Σ w(k)·(x(k) − P_PA_NEG)² · CC = D⁻ ÷ (D⁺ + D⁻) (0,5 bila keduanya 0) · skor = ROUND(CC × 100, 0).']);
  const head: Cell[] = ['Kandidat ID', 'Nama', 'CSV mentah', 'Jumlah slot n'];
  for (let k = 1; k <= K; k++) head.push(`Huruf ${k}`);
  for (let k = 1; k <= K; k++) head.push(`Nilai ${k}`);
  for (let k = 1; k <= K; k++) head.push(`Bobot ${k}`);
  head.push('D⁺', 'D⁻', 'CC', 'Skor (rumus)', 'Skor dipakai TOPSIS', 'Selisih', 'CC engine', 'Selisih CC');
  s.row(head);
  const first = s.next;
  const g0 = 4;
  const v0 = g0 + K;
  const w0 = v0 + K;
  const after = w0 + K;
  const col = (i: number) => colName(i);
  for (const id of ctx.order) {
    const r = s.next;
    const { parts, fromTrace } = partsOf(id);
    const pt = ctx.t?.candidates?.[id]?.performance ?? null;
    const stored = ctx.storedAspects(id)?.performance ?? null;
    const row: Cell[] = [id, ctx.candName(id), fromTrace ? pt?.raw ?? '' : rawInputs(ctx, id).performanceGrade ?? '', parts.length];
    for (let k = 1; k <= K; k++) row.push(k <= parts.length ? parts[k - 1]! : '');
    for (let k = 1; k <= K; k++) {
      row.push(F(`IF(${k}<=$D${r},IFERROR(VLOOKUP(${col(g0 + k - 1)}${r},P_PA_TABEL,2,FALSE),P_PA_C),0)`));
    }
    const rawW: string[] = [];
    for (let k = 1; k <= K; k++) rawW.push(`IF(${k}<=$D${r},INDEX(P_PA_W,${Math.min(k, 6)}),0)`);
    const wSum = rawW.join('+');
    for (let k = 1; k <= K; k++) row.push(F(`(${rawW[k - 1]})/(${wSum})`, FULL));
    const vR = `${col(v0)}${r}:${col(v0 + K - 1)}${r}`;
    const wR = `${col(w0)}${r}:${col(w0 + K - 1)}${r}`;
    const dp = col(after);
    const dn = col(after + 1);
    const cc = col(after + 2);
    const sc = col(after + 3);
    const st = col(after + 4);
    const ce = col(after + 6);
    row.push(
      F(`SQRT(SUMPRODUCT(${wR},(${vR}-P_PA_POS)^2))`, FULL),
      F(`SQRT(SUMPRODUCT(${wR},(${vR}-P_PA_NEG)^2))`, FULL),
      F(`IF(${dp}${r}+${dn}${r}>0,${dn}${r}/(${dp}${r}+${dn}${r}),0.5)`, FULL),
      F(`ROUND(${cc}${r}*100,0)`),
      stored,
      F(`IF(${st}${r}="","",${sc}${r}-${st}${r})`),
      N(pt?.closeness ?? null, FULL),
      F(`IF(${ce}${r}="","",${cc}${r}-${ce}${r})`),
    );
    s.row(row);
    ctx.setAspectCell(id, 'performance', `${qs(SHEET.pa)}!$${sc}$${r}`);
  }
  const last = s.next - 1;
  ctx.checks.push({ label: 'PA: skor kriteria', range: `'${SHEET.pa}'!$${col(after + 5)}$${first}:$${col(after + 5)}$${last}`, tolerance: 0, note: '' });
  ctx.checks.push({ label: 'PA: kedekatan CC', range: `'${SHEET.pa}'!$${col(after + 7)}$${first}:$${col(after + 7)}$${last}`, tolerance: 1e-12, note: '' });
}

function buildHav(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.hav, [38, 24, 10, 10, 10, 11, 11, 12, 12, 11, 11, 10, 12, 9, 10]);
  s.row(['HAV — kuadran YANG BERLAKU (manual > upload > rumus) → skor kelompok']);
  s.row([
    'Kuadran rumus = matriks P_HAV_MATRIX[pita behavior, pita PA]. Pita dibaca aplikasi dari slot PA (2 periode bernilai terbaru; D/E/C- di 4 slot terakhir → Low) dan label behavior — keduanya MASUKAN di sini.',
  ]);
  s.blank();
  s.row([
    'Kandidat ID',
    'Nama',
    'Sumber engine',
    'Kuadran manual',
    'Kuadran upload',
    'Pita PA',
    'Pita behavior',
    'Kuadran rumus (rumus)',
    'Kuadran rumus engine',
    'Kuadran berlaku',
    'Sumber (rumus)',
    'Skor (rumus)',
    'Skor dipakai TOPSIS',
    'Selisih',
    'Cek sumber',
  ]);
  const first = s.next;
  const hasMatrix = ctx.hasName('P_HAV_MATRIX');
  for (const id of ctx.order) {
    const ht = ctx.t?.candidates?.[id]?.hav ?? null;
    const r = s.next;
    const stored = ctx.storedAspects(id)?.hav ?? null;
    const rawQ = ht ? ht.raw : rawInputs(ctx, id).havQuadrant ?? null;
    const rawNum = rawQ != null && /\d+/.test(String(rawQ)) ? Number(String(rawQ).match(/\d+/)![0]) : null;
    s.row([
      id,
      ctx.candName(id),
      ht?.source ?? rawInputs(ctx, id).havSource ?? 'tidak tercatat',
      ht ? N(ht.manual) : '',
      ht ? N(ht.uploaded) : rawNum ?? '',
      ht?.performanceBand ?? '',
      ht?.competencyBand ?? '',
      hasMatrix && ht
        ? F(`IF(OR(F${r}="",G${r}=""),"",INDEX(P_HAV_MATRIX,MATCH(G${r},P_HAV_ROWS,0),MATCH(F${r},P_HAV_COLS,0)))`)
        : '',
      ht ? N(ht.formula) : '',
      F(`IF(D${r}<>"",D${r},IF(E${r}<>"",E${r},IF(H${r}<>"",H${r},"")))`),
      FS(`IF(D${r}<>"","manual",IF(E${r}<>"","upload",IF(H${r}<>"","formula","none")))`),
      F(`IF(J${r}="",P_HAV_MISSING,IFERROR(VLOOKUP(J${r},P_HAV_TABEL,2,FALSE),P_HAV_MISSING))`),
      stored,
      F(`IF(M${r}="","",L${r}-M${r})`),
      ht ? FS(`IF(K${r}=C${r},"","BEDA")`) : '',
    ]);
    ctx.setAspectCell(id, 'hav', `${qs(SHEET.hav)}!$L$${r}`);
  }
  const last = s.next - 1;
  ctx.checks.push({ label: 'HAV: skor kriteria', range: `'${SHEET.hav}'!$N$${first}:$N$${last}`, tolerance: 0, note: '' });
  ctx.checks.push({ label: 'HAV: sumber kuadran', range: `'${SHEET.hav}'!$O$${first}:$O$${last}`, tolerance: 0, note: 'Prioritas manual > upload > rumus (rumus) vs engine.' });
}

function buildEducation(ctx: BuildContext): void {
  const s = ctx.sheet(SHEET.education, [38, 24, 26, 26, 34, 14, 9, 14, 8, 8, 9, 12, 10, 14, 9, 30, 26, 22, 11, 11, 11, 10, 12, 9]);
  s.row(['PENDIDIKAN — sumbu jenjang (ATURAN) + sumbu relevansi (model bahasa) bila jurusan tidak cocok persis']);
  s.row([
    'Peringkat jenjang: token → P_EDU_RANK (D4 = S1 = 8). Syarat "minimal …" dibandingkan dengan peringkat terendah yang disebut; selain itu peringkat yang disebut = setara, di atas peringkat tertinggi = lebih tinggi.',
  ]);
  s.row([
    'Jalur exact-match: skor = skor jenjang. Jalur model (grounded / structured): sumbu relevansi = ROUND((jawaban jenjang + jawaban jurusan) ÷ 2, 0); skor = ROUND((skor jenjang + sumbu relevansi) ÷ 2, 0), atau sumbu relevansi saja bila jenjang tak terbandingkan. Tidak dinilai → 0. Jawaban model adalah MASUKAN (tidak deterministik).',
  ]);
  s.row([
    'Kandidat ID',
    'Nama',
    'Jenjang kandidat',
    'Jurusan kandidat',
    'Syarat pendidikan',
    'Sumber syarat',
    'Peringkat kandidat',
    'Peringkat yang disebut syarat',
    'Terendah',
    'Tertinggi',
    'Syarat "minimal"?',
    'Perbandingan (rumus)',
    'Skor jenjang (rumus)',
    'Jalur',
    'Cocok persis?',
    'Alternatif jurusan syarat (token)',
    'Token jurusan kandidat',
    'Alternatif yang cocok',
    'Model: jenjang',
    'Model: jurusan',
    'Sumbu relevansi (rumus)',
    'Skor (rumus)',
    'Skor dipakai TOPSIS',
    'Selisih',
  ]);
  const first = s.next;
  for (const id of ctx.order) {
    const et = ctx.t?.candidates?.[id]?.education ?? null;
    const r = s.next;
    const stored = ctx.storedAspects(id)?.education ?? null;
    const ee = ctx.poolRow(id)?.details?.educationEval ?? null;
    if (!et) {
      // No trace: the stored evaluation's own fields, scored by the same rule.
      s.row([
        id,
        ctx.candName(id),
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ee?.levelComparison ?? '',
        ee?.levelScore ?? '',
        ee?.source ?? 'tidak tercatat',
        '',
        '',
        '',
        '',
        ee?.educationLevel ?? '',
        ee?.majorRelevance ?? '',
        F(`IF(OR(S${r}="",T${r}=""),"",ROUND((S${r}+T${r})/2,0))`),
        F(`IF(N${r}="exact-match",M${r},IF(OR(N${r}="llm-grounded",N${r}="llm-structured"),IF(M${r}="",U${r},ROUND((M${r}+U${r})/2,0)),0))`),
        stored,
        F(`IF(W${r}="","",V${r}-W${r})`),
      ]);
      ctx.setAspectCell(id, 'education', `${qs(SHEET.education)}!$V$${r}`);
      continue;
    }
    const ranks = et.level.requiredRanks ?? [];
    s.row([
      id,
      ctx.candName(id),
      et.education ?? '',
      et.major ?? '',
      et.requirement ?? '',
      et.requirementSource,
      et.level.candidateRank,
      ranks.join(', '),
      ranks.length ? Math.min(...ranks) : '',
      ranks.length ? Math.max(...ranks) : '',
      et.level.isMinimum,
      FS(
        `IF(OR(G${r}=0,H${r}=""),"",IF(K${r},IF(G${r}>I${r},"higher",IF(G${r}=I${r},"equal","lower")),IF(ISNUMBER(SEARCH(","&G${r}&",",","&SUBSTITUTE(H${r}," ","")&",")),"equal",IF(G${r}>J${r},"higher","lower"))))`,
      ),
      F(`IF(L${r}="","",VLOOKUP(L${r},P_EDU_TIER,2,FALSE))`),
      et.path,
      et.exact.matched,
      et.exact.anyMajor ? 'semua jurusan' : et.exact.alternatives.map((a) => a.join(' ')).join(' | '),
      et.exact.candidateMajorTokens.join(' '),
      et.exact.hit ? et.exact.hit.join(' ') : '',
      et.llm?.educationLevel ?? '',
      et.llm?.majorRelevance ?? '',
      F(`IF(OR(S${r}="",T${r}=""),"",ROUND((S${r}+T${r})/2,0))`),
      F(`IF(N${r}="exact-match",M${r},IF(OR(N${r}="llm-grounded",N${r}="llm-structured"),IF(M${r}="",U${r},ROUND((M${r}+U${r})/2,0)),0))`),
      stored,
      F(`IF(W${r}="","",V${r}-W${r})`),
    ]);
    ctx.setAspectCell(id, 'education', `${qs(SHEET.education)}!$V$${r}`);
  }
  ctx.checks.push({ label: 'Pendidikan: skor kriteria', range: `'${SHEET.education}'!$X$${first}:$X$${s.next - 1}`, tolerance: 0, note: '' });
}
