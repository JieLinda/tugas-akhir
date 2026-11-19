// Is the calculation-trace workbook ("Unduh trace perhitungan (XLSX)",
// lib/run-trace/) an honest restatement of a run?
//
// Read-only. For each selected completed AHP + TOPSIS run it builds the workbook
// exactly as the route does, then RECALCULATES it with LibreOffice — the formulas
// are written without cached values, so a recalculation is the only way to see
// what they actually produce — and asserts:
//
//   1. no formula evaluates to an error;
//   2. "Ringkasan" reads SEMUA COCOK: every stage's formulas reproduce the
//      numbers the run stored (engine trace AND persisted rows);
//   3. a PLANTED fault (one stored final score moved by 0.001) is reported —
//      a counter that cannot see a fault proves nothing;
//   4. 1–3 hold under an Indonesian locale as well: COUNTIF-style criteria are
//      parsed in the READER's locale, and ">0.4" written as text matches
//      nothing under a decimal comma (measured), which would make 2 vacuous.
//
// Usage:
//   node --conditions=react-server --import tsx scripts/verify-run-trace-export.ts --run <runId>
//   node --conditions=react-server --import tsx scripts/verify-run-trace-export.ts --position <positionId>
//   options: --keep <dir>  keep the workbooks and recalculated copies there
//            --no-locale   skip the Indonesian-locale pass
//
// --conditions=react-server because the loader is `server-only`. Needs `soffice`
// (LibreOffice ≥ 7) on PATH; without it the workbook is only built and sized.

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { loadRunTraceBundle, type RunTraceBundle } from '../lib/run-trace/load';
import { buildTraceWorkbook } from '../lib/run-trace/workbook';
import { renderTraceWorkbook } from '../lib/run-trace/xlsx';
import { SHEET } from '../lib/run-trace/context';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const LOCALES = process.argv.includes('--no-locale') ? ['en_US'] : ['en_US', 'id_ID'];

function hasSoffice(): boolean {
  return spawnSync('soffice', ['--version'], { encoding: 'utf8' }).status === 0;
}

type Recalc = { errors: string[]; status: string | null; nonZero: string[]; checks: number };

/** Recalculate `file` in a fresh LibreOffice profile under `locale` and read the result back. */
function recalc(file: string, dir: string, locale: string): Recalc {
  const out = join(dir, `out-${locale}`);
  mkdirSync(out, { recursive: true });
  const profile = `file://${join(dir, `lo-profile-${locale}`)}`;
  const r = spawnSync(
    'soffice',
    [`-env:UserInstallation=${profile}`, '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, file],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: `${locale}.UTF-8`, LANG: `${locale}.UTF-8` }, timeout: 600_000 },
  );
  if (r.status !== 0) throw new Error(`soffice gagal (${locale}): ${r.stderr || r.stdout}`);
  const base = file.split('/').pop()!;
  const wb = XLSX.read(readFileSync(join(out, base)), { cellFormula: true });
  const errors: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]!;
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const c = ws[addr] as XLSX.CellObject;
      if (c.t === 'e') errors.push(`${name}!${addr} ${c.w ?? ''} = ${c.f ?? ''}`);
    }
  }
  // Ringkasan: rows after the "Tahap" header up to "Status keseluruhan".
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[SHEET.summary]!, { header: 1, raw: true, defval: null });
  let on = false;
  let status: string | null = null;
  const nonZero: string[] = [];
  let checks = 0;
  for (const row of rows) {
    const label = row[0];
    if (label === 'Tahap') {
      on = true;
      continue;
    }
    if (!on || label == null || label === '') continue;
    if (label === 'Status keseluruhan') {
      status = String(row[1] ?? '');
      break;
    }
    checks += 1;
    if (row[1] !== 0) nonZero.push(`${label} = ${String(row[1])}`);
  }
  return { errors, status, nonZero, checks };
}

/** The same run with one persisted final score moved — what every check must be able to see. */
function plantFault(b: RunTraceBundle): string | null {
  const res = b.results[0];
  if (res) {
    res.finalScore = Number(res.finalScore) + 0.001;
    return `analysis_results.final_score kandidat ${res.candidateId.slice(0, 8)} + 0,001`;
  }
  const pool = b.pool[0];
  if (pool) {
    const k = Object.keys(pool.aspects)[0];
    if (k) {
      pool.aspects[k] = (pool.aspects[k] ?? 0) + 1;
      return `scoring_run_pool_aspects.aspects.${k} kandidat ${pool.candidateId.slice(0, 8)} + 1`;
    }
  }
  return null;
}

async function main() {
  const runId = arg('--run');
  const positionId = arg('--position');
  if (!runId && !positionId) {
    console.error('Gunakan --run <runId> atau --position <positionId>.');
    process.exit(2);
  }
  const res = await db.execute(sql`
    SELECT id::text AS id, tenant_id::text AS "tenantId", label
      FROM scoring_runs
     WHERE status = 'completed' AND method = 'AHP_TOPSIS'
       ${runId ? sql`AND id = ${runId}` : sql``}
       ${positionId ? sql`AND position_id = ${positionId}` : sql``}
     ORDER BY created_at
  `);
  const runs = res.rows as { id: string; tenantId: string; label: string | null }[];
  if (runs.length === 0) {
    console.error('Tidak ada run AHP + TOPSIS berstatus completed yang cocok.');
    process.exit(2);
  }
  const keep = arg('--keep');
  const root = keep ?? mkdtempSync(join(tmpdir(), 'pulse-trace-verify-'));
  mkdirSync(root, { recursive: true });
  const soffice = hasSoffice();
  if (!soffice) console.log('soffice (LibreOffice) tidak ditemukan: workbook hanya dibuat, tidak dihitung ulang.\n');

  let failed = 0;
  for (const r of runs) {
    const bundle = await loadRunTraceBundle(r.id, r.tenantId);
    if (!bundle) {
      console.log(`SKIP  ${r.id} — tidak terbaca`);
      continue;
    }
    const dir = join(root, r.id.slice(0, 8));
    mkdirSync(dir, { recursive: true });
    const t0 = Date.now();
    const clean = join(dir, 'trace.xlsx');
    writeFileSync(clean, renderTraceWorkbook(buildTraceWorkbook(bundle)));
    const built = Date.now() - t0;
    const faultBundle = (await loadRunTraceBundle(r.id, r.tenantId))!;
    const fault = plantFault(faultBundle);
    const faulty = join(dir, 'trace-fault.xlsx');
    if (fault) writeFileSync(faulty, renderTraceWorkbook(buildTraceWorkbook(faultBundle)));

    console.log(
      `RUN   ${r.id}  ${r.label ?? ''}\n      jejak engine: ${bundle.engineTraceStatus.readable ? 'ada' : `tidak (${bundle.engineTraceStatus.reason ?? '—'})`} · ` +
        `jejak pool: ${bundle.poolTraceStatus.readable ? 'ada' : 'tidak'} · dibuat ${built} ms`,
    );
    if (!soffice) continue;
    let ok = true;
    for (const loc of LOCALES) {
      const c = recalc(clean, dir, loc);
      const good = c.errors.length === 0 && c.status === 'SEMUA COCOK';
      console.log(`      ${loc}  ${good ? 'OK  ' : 'FAIL'}  ${c.checks} pemeriksaan · ${c.status ?? 'status tidak terbaca'} · ${c.errors.length} sel galat`);
      for (const e of c.errors.slice(0, 5)) console.log(`            galat ${e}`);
      for (const n of c.nonZero) console.log(`            selisih ${n}`);
      if (!good) ok = false;
      if (fault) {
        const f = recalc(faulty, join(dir, 'fault'), loc);
        const caught = f.status != null && f.status !== 'SEMUA COCOK' && f.nonZero.length > 0;
        console.log(`      ${loc}  ${caught ? 'OK  ' : 'FAIL'}  kesalahan sengaja (${fault}) ${caught ? `terdeteksi: ${f.nonZero.join('; ')}` : 'TIDAK terdeteksi'}`);
        if (!caught) ok = false;
      }
    }
    if (!ok) failed += 1;
  }
  console.log(`\n${runs.length} run · ${failed} gagal · berkas di ${root}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
