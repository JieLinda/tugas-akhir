// Pembentukan pool — who entered the decision matrix, before any aspect was
// scored. TOPSIS is set-relative (column divisors and ideals come from the pool),
// so membership is itself an input of every closeness value.
//
//   1. population: live candidates of the included business units
//   2. gate: incumbent of the seat (excluded) and the grade range
//   3. program filter rules, each leaf as an Excel test over the value it was
//      judged on, then the DECIDING tree (advisory and switched-off rules
//      removed — decidingFilterTree) as nested AND/OR over those tests.
//
// Mirrors buildPoolFromCandidateIds and applyProgramFilters / evaluateRuleNode
// (lib/scoring-engine.ts, lib/programs.ts).

import { BuildContext, SHEET } from '../context';
import { DATE_TIME, F, FB, FS, N, colName, serialOf, str, type Cell, type SheetBuilder } from '../sheet';
import type { PoolTraceGroup, PoolTraceRule } from '../../../scoring-service/src/run-trace-types';
import type { RunRerunSnapshot } from '../../db/schema';

const ORIGIN_CARRIED = 'dibawa dari run induk';
const ORIGIN_NEW = 'kandidat pembanding baru';
const ORIGIN_EXISTING = 'kandidat pembanding (sudah di pool induk)';

/**
 * A "Tambah Kandidat Pembanding" child never runs the pool builder: its pool is
 * the parent's pool AS IT WAS plus the comparison candidates the request
 * accepted (lib/rerun-freeze.ts, I-2). What decided membership is therefore
 * config_snapshot.rerun — every accepted person with their classification, and
 * every refused one with the reason — not a filter evaluation, so that is what
 * this sheet shows. Only the `new` candidates have their six aspects computed.
 */
function buildChildPool(ctx: BuildContext, s: SheetBuilder, rerun: RunRerunSnapshot): void {
  const t = ctx.t;
  s.row(['RUN TURUNAN "Tambah Kandidat Pembanding": pool = pool run induk apa adanya + kandidat pembanding yang diterima']);
  s.row([
    'Gerbang grade dan aturan filter TIDAK dijalankan ulang untuk kandidat yang dibawa (I-2): keanggotaan mereka adalah keputusan run induk — pembentukan pool asalnya ada di ekspor trace run induk. Kandidat pembanding dinilai dengan aturan run induk menurut kategori Tabel 2.4 (Rejected ditolak, Excluded = di luar rentang grade hanya dengan konfirmasi, Reconsidered dinilai biasa).',
  ]);
  s.blank();
  s.row(['Run induk', rerun.parentRunId]);
  s.row(['Run root', rerun.rootRunId]);
  s.row(['Alasan / permintaan forum', rerun.reason]);
  s.row(['Data kandidat pembanding dibaca', N(serialOf(rerun.dataPulledAt), DATE_TIME)]);
  s.blank();

  const added = Array.isArray(rerun.added) ? rerun.added : [];
  const byId = new Map(added.map((a) => [a.candidateId, a]));
  const ids = ctx.order;
  const sumFirst = s.next;
  // Summary first (formulas over the member table below), so the counts sit at
  // the top of the sheet; the table starts four rows further down.
  const tFirst = sumFirst + 6;
  const tLast = tFirst + Math.max(ids.length, 1) - 1;
  const originCol = `$D$${tFirst}:$D$${tLast}`;
  s.row(['Anggota pool (baris matriks keputusan)', F(`COUNTA($B$${tFirst}:$B$${tLast})`)]);
  s.row(['  dibawa dari run induk (enam aspek induk dipakai apa adanya)', F(`COUNTIF(${originCol},"${ORIGIN_CARRIED}")+COUNTIF(${originCol},"${ORIGIN_EXISTING}")`), 'engine (jejak):', t ? t.carried.candidateIds.length : '', t ? F(`IF(D${sumFirst + 1}="","",B${sumFirst + 1}-D${sumFirst + 1})`) : '']);
  s.row(['  kandidat pembanding baru (enam aspek dihitung)', F(`COUNTIF(${originCol},"${ORIGIN_NEW}")`), 'tercatat:', added.filter((a) => a.classification === 'new').length, F(`IF(D${sumFirst + 2}="","",B${sumFirst + 2}-D${sumFirst + 2})`)]);
  s.row(['Ditolak permintaan', (rerun.skipped ?? []).length]);
  s.blank();
  s.row(['No', 'Kandidat ID', 'Nama', 'Asal', 'Di luar rentang grade (dikonfirmasi)', 'Aturan run induk yang dilanggar', 'Penanda advisory']);
  ids.forEach((id, i) => {
    const a = byId.get(id);
    const origin = !a ? ORIGIN_CARRIED : a.classification === 'new' ? ORIGIN_NEW : ORIGIN_EXISTING;
    s.row([i + 1, id, ctx.candName(id), origin, a ? Boolean(a.outOfRange) : '', a?.failedRules?.join('; ') ?? '', a?.advisory?.join('; ') ?? '']);
  });
  if (t) {
    ctx.checks.push({ label: 'Pool turunan: jumlah kandidat dibawa', range: `'${SHEET.pool}'!$E$${sumFirst + 1}:$E$${sumFirst + 1}`, tolerance: 0, note: 'Anggota pool di luar kandidat pembanding baru vs daftar dibawa pada jejak engine.' });
  }
  ctx.checks.push({ label: 'Pool turunan: kandidat pembanding baru', range: `'${SHEET.pool}'!$E$${sumFirst + 2}:$E$${sumFirst + 2}`, tolerance: 0, note: 'Anggota pool berasal "baru" vs kandidat ber-klasifikasi new di config_snapshot.rerun.' });

  const skipped = rerun.skipped ?? [];
  if (skipped.length > 0) {
    s.blank();
    s.row(['DITOLAK — diminta tetapi tidak dimasukkan (tidak ada yang hilang diam-diam)']);
    s.row(['Kandidat ID', 'Nama', 'Kode alasan', 'Keterangan', 'Aturan']);
    for (const k of skipped) s.row([k.candidateId, k.name ?? '', k.reason, k.message, (k.rules ?? []).join('; ')]);
  }
}

const FIELD_LABEL: Record<string, string> = {
  disciplineStatus: 'Status disiplin',
  mcuStatus: 'Status MCU',
  performanceGrade: 'PA (periode A–E)',
  havQuadrant: 'Kuadran HAV',
  behaviorRecommendation: 'Rekomendasi behavior',
  yearsExperience: 'Masa kerja',
  education: 'Pendidikan',
};

/** An Excel test for one leaf rule against the value in `v`, or null when only the engine verdict can be shown. */
function ruleTest(rule: PoolTraceRule, v: string): string | null {
  const vals = (Array.isArray(rule.value) ? rule.value : [rule.value]).filter((x) => x != null).map((x) => String(x).trim());
  // The engine's sameScalar is String(a).trim() === String(b).trim(). For a
  // NUMERIC cell, v&"" renders the number in the reader's locale (3,5 under a
  // decimal comma) where JS always writes 3.5 — so a rule value in canonical
  // number form is compared as a number when the cell holds one. A non-canonical
  // one ("07", "3.50") keeps the text path: String(7) is "7", never "07".
  const same = (x: string) => {
    const text = `EXACT(TRIM(${v}&""),${str(x)})`;
    const n = Number(x);
    return x !== '' && Number.isFinite(n) && String(n) === x ? `IF(ISNUMBER(${v}),${v}=${x},${text})` : text;
  };
  if (rule.field === 'performanceGrade') {
    // `v` holds the periods as "A,B,C" (blank record → "C"); set/equality rules
    // read EVERY period: in = ∃, notIn = ∄, eq = ∃ = set[0], neq = ∀ ≠ set[0].
    const has = (x: string) => `ISNUMBER(FIND(${str(`,${x.toUpperCase()},`)},","&${v}&","))`;
    const set = vals.map((x) => x.toUpperCase());
    switch (rule.operator) {
      case 'in':
        return set.length ? `OR(${set.map(has).join(',')})` : 'FALSE';
      case 'notIn':
        return set.length ? `NOT(OR(${set.map(has).join(',')}))` : 'TRUE';
      case 'eq':
        return set[0] ? has(set[0]) : 'FALSE';
      case 'neq':
        return set[0] ? `NOT(${has(set[0])})` : 'TRUE';
      default:
        return 'FALSE';
    }
  }
  switch (rule.operator) {
    case 'eq':
      return vals[0] != null ? `IF(${v}="",FALSE,${same(vals[0])})` : 'FALSE';
    case 'neq':
      return vals[0] != null ? `IF(${v}="",TRUE,NOT(${same(vals[0])}))` : 'TRUE';
    case 'in':
      return Array.isArray(rule.value) ? (vals.length ? `IF(${v}="",FALSE,OR(${vals.map(same).join(',')}))` : 'FALSE') : 'FALSE';
    case 'notIn':
      return Array.isArray(rule.value) ? (vals.length ? `IF(${v}="",TRUE,NOT(OR(${vals.map(same).join(',')})))` : 'TRUE') : 'FALSE';
    case 'gte':
    case 'lte':
    case 'gt':
    case 'lt': {
      const op = { gte: '>=', lte: '<=', gt: '>', lt: '<' }[rule.operator];
      return typeof rule.value === 'number' ? `AND(ISNUMBER(${v}),${v}${op}${rule.value})` : 'FALSE';
    }
    default:
      // isExpired / notExpired compare against the clock at run creation.
      return null;
  }
}

export function buildPool(ctx: BuildContext): void {
  const pt = ctx.b.poolTrace;
  const fs = ctx.b.filterSummary ?? {};
  const s = ctx.sheet(SHEET.pool, [38, 26, 14, 12, 10, 10, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12]);
  s.row(['PEMBENTUKAN POOL — siapa yang masuk matriks keputusan']);
  s.row([
    ctx.t?.topsis?.anchored
      ? 'Run turunan ini memeringkat dengan skala TOPSIS run induk (pembagi kolom dan titik ideal induk), sehingga kandidat yang dibawa dari induk mempertahankan nilai kedekatannya dan kandidat pembanding disisipkan di antaranya.'
      : 'TOPSIS bersifat relatif terhadap himpunan: pembagi kolom dan titik ideal diambil dari kandidat yang ada, jadi keanggotaan pool ikut menentukan setiap nilai kedekatan.',
  ]);
  s.blank();
  const rerun = ctx.b.configSnapshot?.rerun as RunRerunSnapshot | undefined;
  if (!pt && rerun?.mode === 'incremental_add') {
    buildChildPool(ctx, s, rerun);
    return;
  }
  if (!pt) {
    s.row([ctx.b.poolTraceStatus.reason ?? 'Jejak pembentukan pool tidak tersimpan.']);
    s.row(['Ringkasan tersimpan (filter_summary):']);
    s.row(['Lolos gerbang awal (dievaluasi)', fs.totalEvaluated ?? '']);
    s.row(['Lolos aturan filter', fs.qualifiedCount ?? '']);
    s.row(['Gugur aturan filter', fs.disqualifiedCount ?? '']);
    s.blank();
    s.row(['Kandidat gugur', 'Alasan']);
    for (const d of Array.isArray(fs.disqualified) ? fs.disqualified : []) {
      s.row([String(d.name ?? d.candidateId ?? ''), Array.isArray(d.reasons) ? d.reasons.join('; ') : '']);
    }
    ctx.gaps.push('Jejak pembentukan pool (nilai kolom aturan filter per kandidat) tidak tersimpan untuk run ini.');
    return;
  }

  // ── 1–2: population and gate ─────────────────────────────────
  s.row(['Populasi kandidat aktif (business unit yang disertakan)', pt.population]);
  s.row(['Dikecualikan manual oleh pengguna', pt.excludedByUser.length]);
  // The gate table starts four rows down: this summary row, the range row, a
  // blank and the header.
  const gFirst = s.next + 4;
  const gLast = gFirst + pt.gate.length - 1;
  s.row(['Lolos gerbang (bukan pejabat & grade dalam rentang)', F(`COUNTIF($H$${gFirst}:$H$${Math.max(gFirst, gLast)},TRUE)`), 'tersimpan:', fs.totalEvaluated ?? '']);
  s.row(['Rentang grade (angka pertama pada teks grade)', pt.grade.min ?? '', 's.d.', pt.grade.max ?? '', `(${pt.grade.minGradeId ?? '—'} … ${pt.grade.maxGradeId ?? '—'})`]);
  const rMin = s.next - 1;
  s.blank();
  s.row(['Kandidat ID', 'Nama', 'Grade (teks)', 'Grade (angka)', 'Pejabat posisi?', 'Grade dalam rentang? (rumus)', 'Grade dalam rentang engine', 'Lolos gerbang (rumus)', 'Lolos engine', 'Cek']);
  for (const g of pt.gate) {
    const r = s.next;
    s.row([
      g.candidateId,
      ctx.candName(g.candidateId),
      g.grade ?? '',
      g.gradeNumeric ?? '',
      g.incumbent,
      FB(`IF(AND($B$${rMin}="",$D$${rMin}=""),TRUE,IF(D${r}="",FALSE,AND(OR($B$${rMin}="",D${r}>=$B$${rMin}),OR($D$${rMin}="",D${r}<=$D$${rMin}))))`),
      g.gradeOk,
      FB(`AND(NOT(E${r}),F${r})`),
      g.passed,
      FS(`IF(H${r}=I${r},"","BEDA")`),
    ]);
  }
  if (pt.gate.length > 0) ctx.checks.push({ label: 'Pool: gerbang pejabat & grade', range: `'${SHEET.pool}'!$J$${gFirst}:$J$${gLast}`, tolerance: 0, note: '' });

  // ── 3: filter rules ──────────────────────────────────────────
  const fl = pt.filter;
  s.blank();
  if (!fl) {
    s.row(['Program tidak punya aturan filter — seluruh kandidat yang lolos gerbang masuk pool.']);
    return;
  }
  s.row([`ATURAN FILTER (${fl.enforce ? 'ditegakkan: gagal aturan keras = tidak dinilai' : 'tidak ditegakkan — hanya dievaluasi'})`]);
  s.row(['#', 'Kolom', 'Operator', 'Nilai aturan', 'Sifat', 'Aktif?', 'Label']);
  for (const rule of fl.rules) {
    s.row([
      rule.index,
      FIELD_LABEL[rule.field] ?? rule.field,
      rule.operator,
      Array.isArray(rule.value) ? rule.value.join(', ') : rule.value == null ? '' : String(rule.value),
      rule.severity === 'advisory' ? 'hanya menandai' : 'menggugurkan',
      rule.enabled,
      rule.label,
    ]);
  }
  s.blank();
  s.row(['Pohon penentu (aturan "hanya menandai" dan yang nonaktif dikeluarkan; grup kosong = terpenuhi):']);
  const describe = (path: number[]): string => {
    const g = fl.groups.find((x) => x.path.join('.') === path.join('.'));
    if (!g || g.children.length === 0) return 'BENAR';
    const parts = g.children.map((c) => ('rule' in c ? `R${c.rule}` : `(${describe(c.group)})`));
    return parts.join(g.op === 'and' ? ' DAN ' : ' ATAU ');
  };
  s.row([describe([])]);
  s.blank();

  // Per-candidate columns: values (one per distinct field), then per rule (formula, engine).
  const fields = Array.from(new Set(fl.rules.map((r) => r.field)));
  const head: Cell[] = ['Kandidat ID', 'Nama'];
  fields.forEach((f) => head.push(`Nilai: ${FIELD_LABEL[f] ?? f}`));
  const ruleCol = new Map<number, number>();
  fl.rules.forEach((rule) => {
    ruleCol.set(rule.index, head.length);
    head.push(`R${rule.index} (rumus)`, `R${rule.index} engine`);
  });
  const qCol = head.length;
  head.push('Lolos aturan keras (rumus)', 'Lolos engine', 'Cek', 'Ditandai (hanya menandai)');
  s.row(head);
  const cFirst = s.next;
  const valueCol = new Map(fields.map((f, i) => [f, 2 + i]));
  for (const c of fl.candidates) {
    const r = s.next;
    const row: Cell[] = [c.candidateId, ctx.candName(c.candidateId)];
    fields.forEach((f) => {
      let v = c.values[f];
      if (f === 'performanceGrade') {
        // The periods the rule reads: A–E letters of the CSV; none → "C".
        const periods = String(v ?? '')
          .split(',')
          .map((p) => p.trim().toUpperCase())
          .filter((p) => ['A', 'B', 'C', 'D', 'E'].includes(p));
        v = (periods.length ? periods : ['C']).join(',');
      }
      row[valueCol.get(f)!] = v == null ? '' : typeof v === 'number' || typeof v === 'boolean' ? v : String(v);
    });
    for (const rule of fl.rules) {
      const col = ruleCol.get(rule.index)!;
      const engine = c.results[String(rule.index)];
      const vRef = `${colName(valueCol.get(rule.field)!)}${r}`;
      const test = rule.enabled ? ruleTest(rule, vRef) : null;
      row[col] = !rule.enabled ? 'nonaktif' : test ? FB(test) : engine ?? '';
      row[col + 1] = engine == null ? '' : engine;
    }
    const expr = (path: number[]): string => {
      const g: PoolTraceGroup | undefined = fl.groups.find((x) => x.path.join('.') === path.join('.'));
      if (!g || g.children.length === 0) return 'TRUE';
      const parts = g.children.map((ch) => ('rule' in ch ? `${colName(ruleCol.get(ch.rule)!)}${r}` : expr(ch.group)));
      return `${g.op === 'and' ? 'AND' : 'OR'}(${parts.join(',')})`;
    };
    row[qCol] = FB(expr([]));
    row[qCol + 1] = c.qualified;
    row[qCol + 2] = FS(`IF(${colName(qCol)}${r}=${colName(qCol + 1)}${r},"","BEDA")`);
    row[qCol + 3] = c.flagged.join('; ');
    s.row(row);
  }
  const cLast = s.next - 1;
  if (cLast >= cFirst) {
    ctx.checks.push({
      label: 'Pool: lolos aturan filter',
      range: `'${SHEET.pool}'!$${colName(qCol + 2)}$${cFirst}:$${colName(qCol + 2)}$${cLast}`,
      tolerance: 0,
      note: 'Pohon AND/OR (rumus) vs keputusan engine.',
    });
  }
  s.blank();
  s.row(['Lolos aturan filter (rumus)', F(`COUNTIF($${colName(qCol)}$${cFirst}:$${colName(qCol)}$${Math.max(cFirst, cLast)},TRUE)`), 'tersimpan:', fs.qualifiedCount ?? '']);
}
