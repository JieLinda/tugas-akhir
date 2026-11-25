/**
 * READ-ONLY audit of stored AHP matrices against the Saaty-scale rules
 * (docs/ahp-input-sync.md §9). Reports; changes nothing.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/audit-ahp-saaty.ts --out ./audit-ahp
 *
 * Sources:
 *   (a) program_templates.ahp_config — the matrix a NEW run would use;
 *   (b) scoring_runs.config_snapshot.template.ahpConfig — the matrix frozen at
 *       each run's creation, plus run_info.frozen.ahp.pairwise (the matrix the
 *       engine actually scored with) where recorded. The engine reads the live
 *       template at scoring time, so the two can differ if governance changed
 *       in between; that is reported, not resolved.
 *
 * Per matrix: off-scale cells (stored → nearest Saaty), reciprocal + max
 * deviation, diagonal, CR as stored and after snapping, and the six weights
 * before and after snapping.
 *
 * Safety: every query runs inside BEGIN READ ONLY … ROLLBACK, and the script
 * checks `transaction_read_only = on` before reading — Postgres itself refuses
 * any write. There is no INSERT, UPDATE or DELETE in this file, and it does
 * not import lib/db (no time hooks). Writes only the report files under --out.
 */
import fs from 'node:fs';
import path from 'node:path';
// `pg` ships no types in this package (the same gap lib/db/index.ts has); typed loosely here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as { Client: new (opts: { connectionString: string }) => any };

import { computeAhpWeights, saatyLabel, validateAhpPairwise, AHP_CR_MAX } from '../lib/ahp';
import { AHP_SHORT_LABELS, canonicalize } from '../lib/ahp-input';

const KEYS = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'];

type Row = Record<string, string | number | boolean | null>;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const fmt = (x: number | null | undefined, d = 4) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '');

/** Everything the report says about one matrix. */
function analyse(pairwise: unknown) {
  const v = validateAhpPairwise(pairwise);
  const shapeOk = v.result != null;
  const out: Row = {};
  if (!shapeOk) {
    out.kategori = 'struktur tidak valid';
    out.isu = v.issues.map((i) => i.code).join(', ');
    return out;
  }
  const m = pairwise as number[][];
  const off = v.issues.filter((i) => i.code === 'off_scale' && i.row < i.col) as Extract<(typeof v.issues)[number], { code: 'off_scale' }>[];
  let maxDev = 0;
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) maxDev = Math.max(maxDev, Math.abs(m[i]![j]! * m[j]![i]! - 1));
  const reciprocal = !v.issues.some((i) => i.code === 'not_reciprocal');
  const diagonal = !v.issues.some((i) => i.code === 'diagonal');
  const snapped = canonicalize(m).matrix;
  const after = computeAhpWeights(snapped);
  const before = v.result!;
  const maxDw = Math.max(...before.weights.map((w, k) => Math.abs(w - after.weights[k]!)));
  const crOk = before.cr <= AHP_CR_MAX;
  const crSnapOk = after.cr <= AHP_CR_MAX;

  let kategori: string;
  if (!reciprocal || !diagonal) kategori = 'tidak resiprokal';
  else if (off.length === 0) kategori = crOk ? 'kanonik' : 'kanonik, CR > 0,10';
  else kategori = crSnapOk ? 'di luar S, lolos setelah snap' : 'di luar S, GAGAL setelah snap';

  out.kategori = kategori;
  out.sel_di_luar_s = off
    .map((i) => `${AHP_SHORT_LABELS[i.row]}/${AHP_SHORT_LABELS[i.col]}=${saatyLabel(i.value)}→${saatyLabel(i.nearest)}`)
    .join('; ');
  out.jumlah_sel_di_luar_s = off.length;
  out.resiprokal = reciprocal ? 'ya' : 'tidak';
  out.deviasi_resiprokal_maks = Number(maxDev.toExponential(3));
  out.diagonal_1 = diagonal ? 'ya' : 'tidak';
  out.cr_asli = fmt(before.cr);
  out.lolos_asli = v.ok ? 'ya' : 'tidak';
  out.cr_setelah_snap = fmt(after.cr);
  out.lolos_setelah_snap = validateAhpPairwise(snapped).ok ? 'ya' : 'tidak';
  KEYS.forEach((k, i) => (out[`w_${k}_asli`] = fmt(before.weights[i], 6)));
  KEYS.forEach((k, i) => (out[`w_${k}_snap`] = fmt(after.weights[i], 6)));
  out.delta_bobot_maks = fmt(maxDw, 6);
  return out;
}

function sameMatrix(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toCsv(rows: Row[]): string {
  if (rows.length === 0) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

function mdTable(rows: Row[], cols: string[]): string {
  if (rows.length === 0) return '_tidak ada_\n';
  const cell = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|');
  return [
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${cols.map((c) => cell(r[c])).join(' | ')} |`),
  ].join('\n') + '\n';
}

function tally(rows: Row[]): Record<string, number> {
  const t: Record<string, number> = {};
  for (const r of rows) t[String(r.kategori)] = (t[String(r.kategori)] ?? 0) + 1;
  return t;
}

async function main() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL (atau POSTGRES_URL) wajib diisi.');
  const outDir = path.resolve(arg('out') ?? './audit-ahp');
  fs.mkdirSync(outDir, { recursive: true });

  const client = new Client({ connectionString: url });
  await client.connect();
  let programs: Row[] = [];
  let runs: Row[] = [];
  try {
    await client.query('BEGIN READ ONLY');
    const ro = (await client.query('SHOW transaction_read_only')).rows[0]?.transaction_read_only;
    if (ro !== 'on') throw new Error(`Transaksi tidak read-only (transaction_read_only = ${ro}); berhenti.`);

    const p = await client.query(`
      SELECT pt.id, t.slug AS tenant, pt.code, pt.name, pt.updated_at::text AS updated_at, pt.ahp_config
        FROM program_templates pt LEFT JOIN tenants t ON t.id = pt.tenant_id
       WHERE pt.ahp_config IS NOT NULL AND pt.ahp_config <> 'null'::jsonb
       ORDER BY t.slug, pt.code`);
    programs = p.rows.map((r: any) => ({
      sumber: 'program_templates.ahp_config',
      id: r.id,
      tenant: r.tenant,
      kode: r.code,
      nama: r.name,
      updated_at: r.updated_at,
      ...analyse(r.ahp_config?.pairwise),
    }));

    const q = await client.query(`
      SELECT r.id, r.label, r.created_at::text AS created_at, r.status, r.method,
             pt.code AS program_code, pt.name AS program_name, t.slug AS tenant,
             r.config_snapshot->'template'->'ahpConfig'->'pairwise' AS snapshot_pairwise,
             r.run_info->'frozen'->'ahp'->'pairwise' AS engine_pairwise,
             r.run_info->'ahp'->>'weightSource' AS weight_source
        FROM scoring_runs r
        LEFT JOIN program_templates pt ON pt.id = r.program_template_id
        LEFT JOIN tenants t ON t.id = r.tenant_id
       WHERE jsonb_typeof(r.config_snapshot->'template'->'ahpConfig'->'pairwise') = 'array'
       ORDER BY r.created_at`);
    runs = q.rows.map((r: any) => {
      const engine = Array.isArray(r.engine_pairwise) ? r.engine_pairwise : null;
      const engineCheck = engine ? validateAhpPairwise(engine) : null;
      return {
        sumber: 'scoring_runs.config_snapshot.template.ahpConfig',
        id: r.id,
        tenant: r.tenant,
        label: r.label,
        created_at: r.created_at,
        status: r.status,
        metode: r.method,
        program: r.program_code ? `${r.program_code} (${r.program_name})` : '',
        ...analyse(r.snapshot_pairwise),
        matriks_engine_tercatat: engine ? 'ya' : 'tidak',
        matriks_engine_sama_dengan_snapshot: engine ? (sameMatrix(engine, r.snapshot_pairwise) ? 'ya' : 'TIDAK') : '',
        matriks_engine_sel_di_luar_s: engineCheck
          ? engineCheck.issues.filter((i) => i.code === 'off_scale' && i.row < i.col).length
          : '',
        sumber_bobot_engine: r.weight_source ?? '',
      };
    });
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }

  fs.writeFileSync(path.join(outDir, 'ahp-audit-programs.csv'), toCsv(programs));
  fs.writeFileSync(path.join(outDir, 'ahp-audit-runs.csv'), toCsv(runs));

  const issues = (rows: Row[]) => rows.filter((r) => r.kategori !== 'kanonik');
  const cols = ['id', 'tenant', 'kategori', 'sel_di_luar_s', 'resiprokal', 'cr_asli', 'cr_setelah_snap', 'lolos_setelah_snap', 'delta_bobot_maks'];
  const md = [
    '# Audit matriks AHP terhadap skala Saaty',
    '',
    `Dibuat ${new Date().toISOString()} dari ${url.replace(/\/\/[^@]*@/, '//***@')} dalam transaksi READ ONLY. Tidak ada data yang diubah.`,
    '',
    'Kategori: **kanonik** (semua sel ∈ S, resiprokal, CR ≤ 0,10) · **kanonik, CR > 0,10** · **di luar S, lolos setelah snap** · **di luar S, GAGAL setelah snap** (pembulatan saja tidak cukup; penilaian perlu diperbaiki) · **tidak resiprokal** · **struktur tidak valid**.',
    '',
    '## (a) program_templates.ahp_config',
    '',
    `${programs.length} program bermatriks. Per kategori: ${JSON.stringify(tally(programs))}.`,
    '',
    mdTable(issues(programs), ['kode', 'nama', ...cols]),
    '## (b) scoring_runs.config_snapshot.template.ahpConfig',
    '',
    `${runs.length} run dengan snapshot matriks. Per kategori: ${JSON.stringify(tally(runs))}.`,
    `Run yang matriks engine-nya tercatat tetapi berbeda dari snapshot: ${runs.filter((r) => r.matriks_engine_sama_dengan_snapshot === 'TIDAK').length}.`,
    '',
    mdTable(issues(runs), ['label', 'created_at', 'program', ...cols, 'matriks_engine_sama_dengan_snapshot']),
    'Rincian lengkap, termasuk bobot sebelum dan sesudah snap per kriteria, ada di `ahp-audit-programs.csv` dan `ahp-audit-runs.csv`.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'ahp-audit.md'), md);
  console.log(`Program: ${programs.length} ${JSON.stringify(tally(programs))}`);
  console.log(`Run: ${runs.length} ${JSON.stringify(tally(runs))}`);
  console.log(`Laporan: ${outDir}/ahp-audit.md, ahp-audit-programs.csv, ahp-audit-runs.csv`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
