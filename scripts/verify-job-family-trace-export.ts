// Is the job-family calculation-trace workbook (Pengaturan Job Family →
// "Unduh trace perhitungan (XLSX)", lib/job-family-trace/) an honest restatement
// of a map build?
//
// Read-only. For the selected completed run(s) it builds the workbook exactly as
// the route does, then RECALCULATES it with LibreOffice — the formulas are
// written without cached values, so a recalculation is the only way to see what
// they produce — and asserts:
//
//   1. no formula evaluates to an error;
//   2. "Ringkasan" reads SEMUA COCOK: every stage's formulas reproduce the
//      numbers topic-service recorded and the rows the map persisted;
//   3. two PLANTED faults — a persisted centroid similarity moved by 0,01 and a
//      recorded HDBSCAN label changed — are each reported by the check that
//      owns that stage: a counter that cannot see a fault proves nothing;
//   4. 1–3 hold under an Indonesian locale too: criteria such as ">"&cell are
//      parsed in the READER's locale.
//
// Usage:
//   node --conditions=react-server --import tsx scripts/verify-job-family-trace-export.ts [--run <runId>]
//   options: --keep <dir>  keep the workbooks and recalculated copies there
//            --no-locale   skip the Indonesian-locale pass
//
// Without --run it checks the newest completed run. --conditions=react-server
// because the loader is `server-only`. Needs `soffice` (LibreOffice ≥ 7).

import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { jobFamilyTopicConfigs, jobFamilyTopicRuns } from '../lib/db/schema';
import { normalizeJobFamilyConfig, type JobFamilyConfig } from '../lib/job-family/config';
import { loadJobFamilyTraceBundle, type JobFamilyTraceBundle } from '../lib/job-family-trace/load';
import { buildJobFamilyTraceWorkbook } from '../lib/job-family-trace/workbook';
import { SHEET } from '../lib/job-family-trace/context';
import { renderTraceWorkbook } from '../lib/run-trace/xlsx';
import { BUILTIN_TENANTS as TENANTS } from '../lib/tenant';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const LOCALES = process.argv.includes('--no-locale') ? ['en_US'] : ['en_US', 'id_ID'];

function hasSoffice(): boolean {
  return spawnSync('soffice', ['--version'], { encoding: 'utf8' }).status === 0;
}

type Recalc = { errors: string[]; status: string | null; nonZero: string[]; checks: number; ms: number };

function recalc(file: string, dir: string, locale: string): Recalc {
  const out = join(dir, `out-${locale}`);
  mkdirSync(out, { recursive: true });
  const profile = `file://${join(dir, `lo-profile-${locale}`)}`;
  const t0 = Date.now();
  const r = spawnSync(
    'soffice',
    [`-env:UserInstallation=${profile}`, '--headless', '--calc', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', out, file],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: `${locale}.UTF-8`, LANG: `${locale}.UTF-8` }, timeout: 1_800_000 },
  );
  const ms = Date.now() - t0;
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
  return { errors, status, nonZero, checks, ms };
}

/**
 * The same run with two values moved — one the map PERSISTED (a centroid
 * similarity) and one the library RECORDED mid-pipeline (an HDBSCAN label) —
 * and the check each must surface in. A counter that cannot see a fault
 * proves nothing, and seeing only the last stage would not show that the
 * upstream comparisons are live.
 */
function plantFaults(b: JobFamilyTraceBundle): { what: string; check: string }[] {
  const out: { what: string; check: string }[] = [];
  const a = b.assignments.find((x) => x.centroidSimilarity != null && x.probability != null);
  if (a) {
    a.centroidSimilarity = (a.centroidSimilarity ?? 0) + 0.01;
    out.push({ what: `centroid_similarity job profile ${a.jobProfileId} + 0,01`, check: 'Alasan dokumen: kemiripan ke famili sendiri' });
  }
  const labels = b.trace?.hdbscan.labels;
  if (labels && labels.length) {
    labels[0] = labels[0] === 0 ? 1 : 0;
    out.push({ what: 'label HDBSCAN tercatat dokumen 1 diubah', check: 'HDBSCAN: label' });
  }
  return out;
}

async function activeConfig(): Promise<JobFamilyConfig> {
  const [row] = await db
    .select({ params: jobFamilyTopicConfigs.params })
    .from(jobFamilyTopicConfigs)
    .where(eq(jobFamilyTopicConfigs.isActive, true))
    .orderBy(desc(jobFamilyTopicConfigs.createdAt))
    .limit(1);
  return normalizeJobFamilyConfig((row?.params as Partial<JobFamilyConfig>) ?? null);
}

async function main() {
  let runId = arg('--run');
  if (!runId) {
    const [r] = await db
      .select({ id: jobFamilyTopicRuns.id })
      .from(jobFamilyTopicRuns)
      .where(eq(jobFamilyTopicRuns.status, 'completed'))
      .orderBy(desc(jobFamilyTopicRuns.createdAt))
      .limit(1);
    runId = r?.id ?? null;
  }
  if (!runId) {
    console.error('Tidak ada run peta job family berstatus completed.');
    process.exit(2);
  }
  const [run] = await db.select({ tenantId: jobFamilyTopicRuns.tenantId }).from(jobFamilyTopicRuns).where(eq(jobFamilyTopicRuns.id, runId)).limit(1);
  const tenant = TENANTS.find((x) => x.id === run?.tenantId) ?? TENANTS[0]!;
  const config = await activeConfig();
  const keep = arg('--keep');
  const root = keep ?? mkdtempSync(join(tmpdir(), 'pulse-jf-trace-verify-'));
  mkdirSync(root, { recursive: true });

  const bundle = await loadJobFamilyTraceBundle(runId, tenant.id, config, tenant.name);
  if (!bundle) {
    console.error(`Run ${runId} tidak terbaca dari business unit ${tenant.name}.`);
    process.exit(2);
  }
  const t0 = Date.now();
  const model = buildJobFamilyTraceWorkbook(bundle);
  const built = Date.now() - t0;
  const buf = renderTraceWorkbook(model);
  const clean = join(root, 'trace.xlsx');
  writeFileSync(clean, buf);
  const cells = model.sheets.reduce((n, s) => n + s.rows.reduce((m, r) => m + (r?.length ?? 0), 0), 0);
  console.log(
    `RUN   ${runId}\n      jejak: ${bundle.traceStatus.stored ? `ada (${bundle.traceStatus.bytes} byte)` : `tidak — ${bundle.traceStatus.reason}`} · ` +
      `${model.sheets.length} lembar · ${cells} sel · dibuat ${built} ms · berkas ${(buf.length / 1024 / 1024).toFixed(2)} MB`,
  );
  if (!bundle.trace) process.exit(0);
  if (!hasSoffice()) {
    console.log('soffice (LibreOffice) tidak ditemukan: workbook hanya dibuat, tidak dihitung ulang.');
    process.exit(0);
  }
  const faultBundle = (await loadJobFamilyTraceBundle(runId, tenant.id, config, tenant.name))!;
  const faults = plantFaults(faultBundle);
  const faulty = join(root, 'trace-fault.xlsx');
  if (faults.length) writeFileSync(faulty, renderTraceWorkbook(buildJobFamilyTraceWorkbook(faultBundle)));

  let ok = true;
  for (const loc of LOCALES) {
    const c = recalc(clean, root, loc);
    const good = c.errors.length === 0 && c.status === 'SEMUA COCOK';
    console.log(`      ${loc}  ${good ? 'OK  ' : 'FAIL'}  ${c.checks} pemeriksaan · ${c.status ?? 'status tidak terbaca'} · ${c.errors.length} sel galat · hitung ulang ${(c.ms / 1000).toFixed(1)} s`);
    for (const e of c.errors.slice(0, 8)) console.log(`            galat ${e}`);
    for (const n of c.nonZero) console.log(`            selisih ${n}`);
    if (!good) ok = false;
    if (faults.length) {
      const f = recalc(faulty, join(root, 'fault'), loc);
      for (const fault of faults) {
        const caught = f.status != null && f.status !== 'SEMUA COCOK' && f.nonZero.some((n) => n.startsWith(fault.check));
        console.log(`      ${loc}  ${caught ? 'OK  ' : 'FAIL'}  kesalahan sengaja (${fault.what}) ${caught ? 'terdeteksi' : 'TIDAK terdeteksi'} di "${fault.check}"`);
        if (!caught) ok = false;
      }
      console.log(`            semua selisih pada workbook berkesalahan: ${f.nonZero.join('; ')}`);
    }
  }
  console.log(`\nberkas di ${root}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
