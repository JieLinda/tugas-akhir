/**
 * Purge a non-built-in company with the SAME code the "delete company" action
 * runs (lib/tenant-purge.ts), then prove nothing of it is left.
 *
 *   node --conditions=react-server --import tsx scripts/verify-tenant-purge.ts \
 *     --tenant <uuid> --confirm "<company name>" [--sync http://localhost:8000]
 *
 * DESTRUCTIVE by design — the company and all its data are deleted permanently,
 * like the dialog; --confirm must equal the company's name. --sync is the
 * sync-service holding the uploaded job-profile PDFs (its upload store), used
 * exactly as deleteTenantAction uses SYNC_SERVICE_URL.
 *
 * Checks: a built-in company is refused; the preview lists what goes; after the
 * purge the tenant, its mapping, candidates, seats, runs, master positions,
 * programs, audit rows, its exclusive job profiles (rows AND uploaded files),
 * every sync_* row of its Company IDs and those employees' HAV/MCU rows are
 * gone — and the built-in companies' candidates and documents are unchanged.
 */
import 'dotenv/config';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../lib/db';
import { planTenantPurge, purgeTenant } from '../lib/tenant-purge';

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const tenantId = arg('tenant');
const confirm = arg('confirm');
const SYNC = arg('sync') ?? process.env.SYNC_SERVICE_URL;
if (!tenantId || !confirm) throw new Error('--tenant <uuid> and --confirm "<company name>" are required');

// The app's own pool (the purge uses it too); the web app has no @types/pg.
type Row = Record<string, any>;
const q = async (sql: string, p: unknown[] = []): Promise<Row[]> => (await pool.query(sql, p)).rows as Row[];
let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
};

function filesUnder(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
  } catch { return []; }
}

async function main() {
  const builtin = (await q(`SELECT id::text FROM tenants WHERE is_builtin ORDER BY id LIMIT 1`))[0]?.id as string;
  const builtinPlan = await planTenantPurge(builtin);
  check(!!builtinPlan && builtinPlan.blockers.some((b) => b.includes('bawaan')), 'a built-in company is refused (blocker)', builtinPlan?.blockers);

  const plan = await planTenantPurge(tenantId!);
  if (!plan) throw new Error('company not found');
  if (plan.tenant.name !== confirm) throw new Error(`--confirm does not match the company name "${plan.tenant.name}"`);
  console.log(`\nCompany "${plan.tenant.name}" · Company ID ${plan.companyIds.join(', ') || '-'}`);
  for (const c of plan.counts) console.log(`  akan dihapus: ${c.n} ${c.label}`);
  check(plan.blockers.length === 0, 'no blockers', plan.blockers);

  const ids = plan.companyIds;
  const npks = (await q(`SELECT employee_id FROM sync_employees WHERE company_id = ANY($1::text[])`, [ids])).map((r) => r.employee_id as string);
  const docs = await q(
    `SELECT jp.id, jp.file_path, jp.file_name FROM sync_job_profiles jp JOIN job_profile_tenants t ON t.job_profile_id = jp.id WHERE t.tenant_id = $1::uuid`,
    [tenantId],
  );
  const builtinBefore = await q(
    `SELECT t.name, (SELECT count(*)::int FROM candidates c WHERE c.tenant_id = t.id) cand,
            (SELECT count(*)::int FROM job_profile_tenants j WHERE j.tenant_id = t.id) docs
       FROM tenants t WHERE t.is_builtin ORDER BY t.name`,
  );
  const kamusBefore = (await q(`SELECT count(*)::int n FROM sync_kamus_kompetensi`))[0].n;

  const outcome = await purgeTenant(tenantId!);
  check(outcome.ok, 'purge committed', outcome.ok ? undefined : outcome.error);
  if (!outcome.ok) return finish();

  // The PDFs, through the sync-service endpoint deleteTenantAction calls.
  if (outcome.jobProfileFiles.length > 0 && SYNC) {
    const res = await fetch(`${SYNC.replace(/\/$/, '')}/api/sync/upload/_purge-job-profiles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: outcome.jobProfileFiles }),
    });
    const body = await res.json();
    check(res.ok && body.removed === outcome.jobProfileFiles.length, `uploaded job-profile PDFs removed from the upload store (${body.removed}/${outcome.jobProfileFiles.length})`, body);
    const dirs = [...new Set(outcome.jobProfileFiles.map((f) => f.replace(/[\\/][^\\/]+$/, '')))];
    const left = dirs.flatMap(filesUnder).filter((f) => docs.some((d) => f.endsWith(d.file_name) || f.endsWith(`${d.file_name}.tenants.json`)));
    check(left.length === 0, 'no PDF (or tenant sidecar) of the deleted documents left on disk, so a full sync cannot re-ingest them', left);
  }

  const left = (await q(
    `SELECT (SELECT count(*)::int FROM tenants WHERE id = $1::uuid) tenant,
            (SELECT count(*)::int FROM sync_company_tenant_map WHERE tenant_id = $1::uuid OR company_id = ANY($2::text[])) mapping,
            (SELECT count(*)::int FROM candidates WHERE tenant_id = $1::uuid) candidates,
            (SELECT count(*)::int FROM critical_positions WHERE tenant_id = $1::uuid) seats,
            (SELECT count(*)::int FROM scoring_runs WHERE tenant_id = $1::uuid) runs,
            (SELECT count(*)::int FROM tournament_sessions WHERE tenant_id = $1::uuid) sessions,
            (SELECT count(*)::int FROM positions WHERE tenant_id = $1::uuid) positions,
            (SELECT count(*)::int FROM program_templates WHERE tenant_id = $1::uuid) programs,
            (SELECT count(*)::int FROM audit_log WHERE tenant_id = $1::uuid) audit,
            (SELECT count(*)::int FROM job_profile_tenants WHERE tenant_id = $1::uuid) doc_links,
            (SELECT count(*)::int FROM sync_job_profiles WHERE id = ANY($3::int[])) docs`,
    [tenantId, ids, docs.map((d) => d.id)],
  ))[0];
  check(Object.values(left).every((n) => n === 0), 'company row, mapping, candidates, seats, runs, sessions, master positions, programs, audit rows and its documents are gone', left);

  const syncLeft: Record<string, number> = {};
  for (const t of ['sync_employees', 'sync_positions', 'sync_position_hierarchy', 'sync_employee_positions', 'sync_technical_competencies',
    'sync_performance_appraisals', 'sync_behavior_competencies', 'sync_disciplinary', 'sync_education', 'sync_grade_levels']) {
    const n = (await q(`SELECT count(*)::int n FROM ${t} WHERE company_id = ANY($1::text[])`, [ids]))[0].n;
    if (n > 0) syncLeft[t] = n;
  }
  check(Object.keys(syncLeft).length === 0, `every sync_* row of Company ID ${ids.join(', ')} is gone`, syncLeft);
  const npkLeft = (await q(
    `SELECT (SELECT count(*)::int FROM sync_hav WHERE npk = ANY($1::text[])) hav, (SELECT count(*)::int FROM sync_mcu WHERE npk = ANY($1::text[])) mcu`,
    [npks],
  ))[0];
  check(npkLeft.hav === 0 && npkLeft.mcu === 0, `HAV and MCU rows of its ${npks.length} employees are gone`, npkLeft);

  const builtinAfter = await q(
    `SELECT t.name, (SELECT count(*)::int FROM candidates c WHERE c.tenant_id = t.id) cand,
            (SELECT count(*)::int FROM job_profile_tenants j WHERE j.tenant_id = t.id) docs
       FROM tenants t WHERE t.is_builtin ORDER BY t.name`,
  );
  check(JSON.stringify(builtinBefore) === JSON.stringify(builtinAfter), `built-in companies untouched (${builtinAfter.map((r) => `${r.name}: ${r.cand} kandidat, ${r.docs} dokumen`).join('; ')})`, { builtinBefore, builtinAfter });
  const kamusAfter = (await q(`SELECT count(*)::int n FROM sync_kamus_kompetensi`))[0].n;
  check(kamusAfter === kamusBefore, `kamus kept (global, ${kamusAfter} entries)`);
  return finish();
}

async function finish() {
  await pool.end().catch(() => {});
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); process.exit(1); });
