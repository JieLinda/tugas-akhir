import 'server-only';

import { pool } from '@/lib/db';

// The web app has no @types/pg (a known tsc baseline item), so the client is
// typed from the pool rather than imported from "pg".
type PoolClient = Awaited<ReturnType<typeof pool.connect>>;

/**
 * PERMANENT removal of a non-built-in company and everything that belongs to
 * it — the data assigned to the tenant AND the synced/uploaded data of every
 * Company ID mapped to it. Built for a demo company loaded from demo-data/:
 * deleting it must leave no trace that a later sync could resurrect or another
 * company could see.
 *
 * What goes (one transaction, in foreign-key order):
 *   • scoring: the tenant's sessions (BEFORE runs: a leftover running session is
 *     what the orphan sweeper re-dispatches) and runs, with their results, pool
 *     rows, traces, exclusions and chats (FK cascades);
 *   • Manajemen Posisi seats, picks, candidates (hard delete — with every child
 *     row by cascade: history, competencies, placements, demo copies), the
 *     company's master positions and program templates, agent rows;
 *   • job-profile documents assigned to THIS company only (shared ones keep
 *     their other assignments); their uploaded PDFs are removed from the
 *     sync-service upload store afterwards and their vectors from the vector DB;
 *   • every sync_* row of the mapped Company IDs, and the NPK-keyed HAV / MCU
 *     rows of those employees unless another company employs the same NPK;
 *   • the tenant's audit rows (the FK requires it; the deletion itself is
 *     audited under another company), the mapping, and the tenant row.
 * What stays: the kamus (global, not company data), sync_runs logs, and a
 * synced master position another company's master list still points at.
 *
 * Refused (nothing written) for a built-in company, while one of its scoring
 * runs is in progress, or when its candidates appear in ANOTHER company's
 * runs or picks — deleting them would rewrite that company's finished
 * assessment record (invariant I-1), so those must be handled first.
 */

const NPK_KEY = (expr: string) =>
  `(CASE WHEN btrim(${expr}) ~ '^[0-9]+$' AND length(btrim(${expr})) < 5 THEN lpad(btrim(${expr}), 5, '0') ELSE btrim(${expr}) END)`;

/** Synced tables keyed by Company ID; employee tables last-but-one, sync_employees last. */
const COMPANY_TABLES = [
  'sync_employee_positions',
  'sync_technical_competencies',
  'sync_performance_appraisals',
  'sync_behavior_competency_history',
  'sync_behavior_competencies',
  'sync_disciplinary',
  'sync_education',
  'sync_employee_personal',
  'sync_assessment_center',
  'sync_rtc_history',
  'sync_talent_mapping_history',
  'sync_position_hierarchy',
  'sync_positions',
  'sync_grade_levels',
  'sync_departments',
  'sync_divisions',
  'sync_employees',
];

export type TenantPurgePlan = {
  tenant: { id: string; name: string; isBuiltin: boolean };
  companyIds: string[];
  /** What a purge would delete, as user-facing labels. Zero counts omitted. */
  counts: Array<{ label: string; n: number }>;
  /** Why it cannot run now; empty = it can. */
  blockers: string[];
};

async function exists(c: PoolClient, table: string): Promise<boolean> {
  const { rows } = await c.query<{ ok: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${table}`]);
  return rows[0]?.ok === true;
}

async function count(c: PoolClient, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await c.query<{ n: number }>(sql, params);
  return Number(rows[0]?.n ?? 0);
}

/** Documents assigned to this tenant and to no other. */
const EXCLUSIVE_JOB_PROFILES = `
  SELECT jp.id, jp.file_path FROM sync_job_profiles jp
   WHERE EXISTS (SELECT 1 FROM job_profile_tenants t WHERE t.job_profile_id = jp.id AND t.tenant_id = $1::uuid)
     AND NOT EXISTS (SELECT 1 FROM job_profile_tenants t WHERE t.job_profile_id = jp.id AND t.tenant_id <> $1::uuid)`;

/** NPK keys employed by the purged Company IDs and by no other company. */
const PURGED_NPKS = `
  SELECT DISTINCT ${NPK_KEY('e.employee_id')} AS k FROM sync_employees e
   WHERE e.company_id = ANY($1::text[])
  EXCEPT
  SELECT DISTINCT ${NPK_KEY('o.employee_id')} FROM sync_employees o
   WHERE o.company_id IS NOT NULL AND NOT (o.company_id = ANY($1::text[]))`;

async function buildPlan(c: PoolClient, tenantId: string): Promise<TenantPurgePlan | null> {
  const t = (await c.query<{ id: string; name: string; is_builtin: boolean }>(
    `SELECT id::text, name, is_builtin FROM tenants WHERE id = $1::uuid`,
    [tenantId],
  )).rows[0];
  if (!t) return null;
  const companyIds = (await c.query<{ company_id: string }>(
    `SELECT company_id FROM sync_company_tenant_map WHERE tenant_id = $1::uuid ORDER BY company_id`,
    [tenantId],
  )).rows.map((r: { company_id: string }) => r.company_id);

  const blockers: string[] = [];
  if (t.is_builtin) blockers.push(`Company bawaan "${t.name}" tidak dapat dihapus.`);

  const running = await count(c,
    `SELECT count(*)::int n FROM tournament_sessions WHERE tenant_id = $1::uuid AND status IN ('running', 'finalizing')`,
    [tenantId]);
  if (running > 0) blockers.push(`${running} penilaian (scoring) masih berjalan. Tunggu selesai atau hentikan dulu.`);

  const foreign = (await c.query<{ label: string }>(
    `SELECT DISTINCT coalesce(r.label, r.id::text) AS label
       FROM candidates cand
       JOIN analysis_results ar ON ar.candidate_id = cand.id
       JOIN scoring_runs r ON r.id = ar.run_id
      WHERE cand.tenant_id = $1::uuid AND r.tenant_id <> $1::uuid
     UNION
     SELECT DISTINCT 'pilihan suksesor: ' || cp.title
       FROM candidates cand
       JOIN position_picks pp ON pp.candidate_id = cand.id
       JOIN critical_positions cp ON cp.id = pp.position_id
      WHERE cand.tenant_id = $1::uuid AND cp.tenant_id <> $1::uuid
      LIMIT 6`,
    [tenantId],
  )).rows.map((r: { label: string }) => r.label);
  if (foreign.length > 0) {
    blockers.push(
      `Kandidat Company ini tercatat di hasil Company lain (${foreign.slice(0, 5).join('; ')}${foreign.length > 5 ? '; …' : ''}). ` +
        'Menghapusnya akan mengubah catatan penilaian yang sudah selesai milik Company itu.',
    );
  }

  const counts: Array<{ label: string; n: number }> = [];
  const add = (label: string, n: number) => { if (n > 0) counts.push({ label, n }); };
  add('kandidat', await count(c, `SELECT count(*)::int n FROM candidates WHERE tenant_id = $1::uuid`, [tenantId]));
  add('posisi di Manajemen Posisi', await count(c, `SELECT count(*)::int n FROM critical_positions WHERE tenant_id = $1::uuid`, [tenantId]));
  add('run scoring', await count(c, `SELECT count(*)::int n FROM scoring_runs WHERE tenant_id = $1::uuid`, [tenantId]));
  add('posisi master Company', await count(c, `SELECT count(*)::int n FROM positions WHERE tenant_id = $1::uuid`, [tenantId]));
  add('program penilaian', await count(c, `SELECT count(*)::int n FROM program_templates WHERE tenant_id = $1::uuid`, [tenantId]));
  add('dokumen job profile (hanya milik Company ini)', await count(c, `SELECT count(*)::int n FROM (${EXCLUSIVE_JOB_PROFILES}) x`, [tenantId]));
  if (companyIds.length > 0) {
    let synced = 0;
    for (const table of COMPANY_TABLES) {
      if (await exists(c, table)) synced += await count(c, `SELECT count(*)::int n FROM ${table} WHERE company_id = ANY($1::text[])`, [companyIds]);
    }
    add(`baris data sinkron/unggahan Company ID ${companyIds.join(', ')}`, synced);
    const npkSql = `SELECT count(*)::int n FROM %T WHERE ${NPK_KEY('npk')} IN (${PURGED_NPKS})`;
    add('baris HAV', await count(c, npkSql.replace('%T', 'sync_hav'), [companyIds]));
    add('baris MCU', await count(c, npkSql.replace('%T', 'sync_mcu'), [companyIds]));
  }
  return { tenant: { id: t.id, name: t.name, isBuiltin: t.is_builtin }, companyIds, counts, blockers };
}

export async function planTenantPurge(tenantId: string): Promise<TenantPurgePlan | null> {
  const c = await pool.connect();
  try {
    return await buildPlan(c, tenantId);
  } finally {
    c.release();
  }
}

export type TenantPurgeOutcome =
  | { ok: true; plan: TenantPurgePlan; jobProfileIds: number[]; jobProfileFiles: string[]; positionsKept: number }
  | { ok: false; error: string };

/** Runs the purge in ONE transaction; anything unexpected rolls all of it back. */
export async function purgeTenant(tenantId: string): Promise<TenantPurgeOutcome> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // Serialise against a concurrent create/delete of companies.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('pulse:tenants:create'))`);
    await c.query(`SELECT 1 FROM tenants WHERE id = $1::uuid FOR UPDATE`, [tenantId]);
    const plan = await buildPlan(c, tenantId);
    if (!plan) { await c.query('ROLLBACK'); return { ok: false, error: 'Company tidak ditemukan.' }; }
    if (plan.blockers.length > 0) { await c.query('ROLLBACK'); return { ok: false, error: plan.blockers.join(' ') }; }
    const ids = plan.companyIds;

    // 1. Documents assigned to this company only (job_profile_tenants, matches
    //    and the AI-match cache go by cascade).
    const docs = (await c.query<{ id: number; file_path: string }>(EXCLUSIVE_JOB_PROFILES, [tenantId])).rows;
    if (docs.length > 0) await c.query(`DELETE FROM sync_job_profiles WHERE id = ANY($1::int[])`, [docs.map((d: { id: number }) => d.id)]);

    // 2. Scoring: sessions BEFORE runs (orphan sweeper), then the runs.
    await c.query(`DELETE FROM tournament_sessions WHERE tenant_id = $1::uuid`, [tenantId]);
    await c.query(`DELETE FROM scoring_runs WHERE tenant_id = $1::uuid`, [tenantId]);

    // 3. Seats, candidates, master positions, programs.
    await c.query(`DELETE FROM critical_positions WHERE tenant_id = $1::uuid`, [tenantId]);
    await c.query(`DELETE FROM candidates WHERE tenant_id = $1::uuid`, [tenantId]);
    await c.query(`DELETE FROM positions WHERE tenant_id = $1::uuid`, [tenantId]);
    await c.query(`DELETE FROM program_templates WHERE tenant_id = $1::uuid`, [tenantId]);

    // 4. Other tenant-owned rows whose FK to tenants does not cascade.
    for (const table of ['agent_config_proposals', 'agent_recipes', 'agent_memories', 'agent_runs', 'agent_sessions',
      'qualified_employee_pool', 'job_family_matches', 'candidates_dupp', 'candidate_demo_states']) {
      if (await exists(c, table)) await c.query(`DELETE FROM ${table} WHERE tenant_id = $1::uuid`, [tenantId]);
    }

    // 5. Synced / uploaded data of the mapped Company IDs.
    let positionsKept = 0;
    if (ids.length > 0) {
      for (const table of ['sync_hav', 'sync_mcu']) {
        await c.query(`DELETE FROM ${table} WHERE ${NPK_KEY('npk')} IN (${PURGED_NPKS})`, [ids]);
      }
      for (const table of COMPANY_TABLES) {
        if (!(await exists(c, table))) continue;
        if (table === 'sync_positions') {
          // A master position another company's master list still points at
          // (a mapping moved between companies) stays; everything else goes.
          await c.query(
            `DELETE FROM sync_positions sp WHERE sp.company_id = ANY($1::text[])
               AND NOT EXISTS (SELECT 1 FROM positions p WHERE p.sync_position_id = sp.id)`,
            [ids],
          );
          positionsKept = await count(c, `SELECT count(*)::int n FROM sync_positions WHERE company_id = ANY($1::text[])`, [ids]);
          continue;
        }
        await c.query(`DELETE FROM ${table} WHERE company_id = ANY($1::text[])`, [ids]);
      }
    }

    // 6. Audit rows (FK), users' home tenant, then the tenant itself — the
    //    mapping, topic runs, match runs, placements and talent rows cascade.
    await c.query(`DELETE FROM audit_log WHERE tenant_id = $1::uuid`, [tenantId]);
    await c.query(`UPDATE users SET tenant_id = NULL WHERE tenant_id = $1::uuid`, [tenantId]);
    const del = await c.query(`DELETE FROM tenants WHERE id = $1::uuid AND NOT is_builtin`, [tenantId]);
    if (del.rowCount !== 1) throw new Error('tenant row not deleted');

    await c.query('COMMIT');
    return {
      ok: true,
      plan,
      jobProfileIds: docs.map((d: { id: number }) => d.id),
      jobProfileFiles: docs.map((d: { file_path: string }) => d.file_path).filter(Boolean),
      positionsKept,
    };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    console.error('[tenant] purge failed, rolled back:', err);
    return { ok: false, error: `Penghapusan dibatalkan, tidak ada data yang berubah: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    c.release();
  }
}
