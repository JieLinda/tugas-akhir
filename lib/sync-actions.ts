'use server';

import { requirePermission } from '@/lib/rbac';

import { and, count, desc, max, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import {
  syncCompanyTenantMap,
  syncEmployees,
  syncDivisions,
  syncDepartments,
  syncPositions,
  syncPositionHierarchy,
  syncEmployeePositions,
  syncTechnicalCompetencies,
  syncPerformanceAppraisals,
  syncDisciplinary,
  syncEducation,
  syncEmployeePersonal,
  syncJobProfiles,
  syncKamusKompetensi,
  candidates,
  tenants,
} from '@/lib/db/schema';
import { logAudit } from '@/lib/audit';
import { getCurrentTenantId } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { liveCandidate } from '@/lib/candidate-visibility';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_CODE, MASKED_NPK } from '@/lib/app-mode-shared';

// ── Types ─────────────────────────────────────────────────────

export type TenantStat = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  count: number;
};

export type StatModule = {
  count: number;
  lastSync: string | null;
  breakdown: TenantStat[];
};

type CompanyCount = { companyId: string | null; cnt: number };
type TenantCount = { tenantId: string | null; cnt: number };
type MappingRow = {
  companyId: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
};
type TenantRow = { id: string; name: string; slug: string };

function buildBreakdownFromCompany(
  byCompany: CompanyCount[],
  mappings: MappingRow[],
  tenantsList: TenantRow[],
): TenantStat[] {
  const tenantById = new Map(tenantsList.map((t) => [t.id, t]));
  const tenantIdByCompany = new Map(mappings.map((m) => [m.companyId, m.tenantId]));

  const counts = new Map<string, number>();
  for (const { companyId, cnt } of byCompany) {
    const tenantId = companyId ? tenantIdByCompany.get(companyId) ?? null : null;
    const key = tenantId ?? '__unmapped__';
    counts.set(key, (counts.get(key) ?? 0) + cnt);
  }

  const out: TenantStat[] = [];
  for (const [key, count] of counts) {
    if (key === '__unmapped__') {
      out.push({ tenantId: '__unmapped__', tenantName: 'Tanpa mapping', tenantSlug: '—', count });
    } else {
      const tenant = tenantById.get(key);
      out.push({
        tenantId: key,
        tenantName: tenant?.name ?? mappings.find((m) => m.tenantId === key)?.tenantName ?? 'Unknown',
        tenantSlug: tenant?.slug ?? mappings.find((m) => m.tenantId === key)?.tenantSlug ?? '—',
        count,
      });
    }
  }

  out.sort((a, b) => b.count - a.count);
  return out;
}

function buildBreakdownFromTenant(
  byTenant: TenantCount[],
  tenantsList: TenantRow[],
): TenantStat[] {
  const tenantById = new Map(tenantsList.map((t) => [t.id, t]));
  const out: TenantStat[] = [];
  for (const { tenantId, cnt } of byTenant) {
    if (!tenantId) {
      out.push({ tenantId: '__unmapped__', tenantName: 'Tanpa mapping', tenantSlug: '—', count: cnt });
    } else {
      const tenant = tenantById.get(tenantId);
      out.push({
        tenantId,
        tenantName: tenant?.name ?? 'Unknown',
        tenantSlug: tenant?.slug ?? '—',
        count: cnt,
      });
    }
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

// ── Queries ───────────────────────────────────────────────────

export async function listCompanyTenantMappings() {
  const rows = await db
    .select({
      id: syncCompanyTenantMap.id,
      companyId: syncCompanyTenantMap.companyId,
      tenantId: syncCompanyTenantMap.tenantId,
      label: syncCompanyTenantMap.label,
      isActive: syncCompanyTenantMap.isActive,
      createdAt: syncCompanyTenantMap.createdAt,
      updatedAt: syncCompanyTenantMap.updatedAt,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
    })
    .from(syncCompanyTenantMap)
    .leftJoin(tenants, eq(syncCompanyTenantMap.tenantId, tenants.id))
    .orderBy(syncCompanyTenantMap.companyId);

  return rows;
}

// ── Create ────────────────────────────────────────────────────

export async function createCompanyTenantMappingAction(formData: FormData) {
  await requirePermission('sync.manage');
  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const companyId = (formData.get('companyId') as string | null)?.trim().toUpperCase();
  const tenantId  = (formData.get('tenantId')  as string | null)?.trim();
  const label     = (formData.get('label')     as string | null)?.trim() || null;

  if (!companyId) throw new Error('Company ID is required');
  if (!tenantId)  throw new Error('Company is required');

  const [row] = await db
    .insert(syncCompanyTenantMap)
    .values({ companyId, tenantId, label, isActive: true })
    .returning();

  await logAudit({
    tenantId: actorTenantId,
    actorId,
    entityType: 'sync_company_tenant_map',
    entityId: String(row.id),
    action: 'create',
    summary: `Mapped company ${companyId} → Company ${tenantId}`,
  });

  revalidatePath('/settings/sync');
}

// ── Update ────────────────────────────────────────────────────

export async function updateCompanyTenantMappingAction(formData: FormData) {
  await requirePermission('sync.manage');
  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const id       = Number(formData.get('id'));
  const companyId = (formData.get('companyId') as string | null)?.trim().toUpperCase();
  const tenantId  = (formData.get('tenantId')  as string | null)?.trim();
  const label     = (formData.get('label')     as string | null)?.trim() || null;
  const isActive  = formData.get('isActive') === 'true';

  if (!companyId) throw new Error('Company ID is required');
  if (!tenantId)  throw new Error('Company is required');

  await db
    .update(syncCompanyTenantMap)
    .set({ companyId, tenantId, label, isActive, updatedAt: new Date() })
    .where(eq(syncCompanyTenantMap.id, id));

  await logAudit({
    tenantId: actorTenantId,
    actorId,
    entityType: 'sync_company_tenant_map',
    entityId: String(id),
    action: 'update',
    summary: `Updated mapping id=${id}: ${companyId} → ${tenantId} (active=${isActive})`,
  });

  revalidatePath('/settings/sync');
}

// ── Delete ────────────────────────────────────────────────────

export async function deleteCompanyTenantMappingAction(formData: FormData) {
  await requirePermission('sync.manage');
  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const id = Number(formData.get('id'));

  await db
    .delete(syncCompanyTenantMap)
    .where(eq(syncCompanyTenantMap.id, id));

  await logAudit({
    tenantId: actorTenantId,
    actorId,
    entityType: 'sync_company_tenant_map',
    entityId: String(id),
    action: 'delete',
    summary: `Deleted sync mapping id=${id}`,
  });

  revalidatePath('/settings/sync');
}

// ── Toggle active ─────────────────────────────────────────────

export async function toggleCompanyTenantMappingAction(formData: FormData) {
  await requirePermission('sync.manage');
  const [actorTenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const id       = Number(formData.get('id'));
  const isActive = formData.get('isActive') === 'true';

  await db
    .update(syncCompanyTenantMap)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(syncCompanyTenantMap.id, id));

  await logAudit({
    tenantId: actorTenantId,
    actorId,
    entityType: 'sync_company_tenant_map',
    entityId: String(id),
    action: 'update',
    summary: `${isActive ? 'Activated' : 'Deactivated'} sync mapping id=${id}`,
  });

  revalidatePath('/settings/sync');
}

// ── Sync Statistics ───────────────────────────────────────────

export type SyncStats = {
  employees:    StatModule;
  divisions:    StatModule;
  departments:  StatModule;
  positions:    StatModule;
  hierarchy:    StatModule;
  employeePosition: StatModule;
  technicalCompetency: StatModule;
  performance:  StatModule;
  disciplinary: StatModule;
  education:    StatModule;
  /** Employee personal information — the birth dates candidate age comes from. */
  personal:     StatModule;
  candidates:   StatModule;
  jobProfiles:  StatModule;
  kamusKompetensi: StatModule;
};

export async function getSyncStats(): Promise<SyncStats> {
  const [
    empR, empByCompany,
    divR, divByCompany,
    deptR, deptByCompany,
    posR, posByCompany,
    posHierR, posHierByCompany,
    empPosR, empPosByCompany,
    techR, techByCompany,
    perfR, perfByCompany,
    discR, discByCompany,
    eduR, eduByCompany,
    persR, persByCompany,
    candR, candByTenant,
    jpR,
    kamusR,
    mappings,
    tenantsList,
  ] = await Promise.all([
    db.select({ cnt: count(), last: max(syncEmployees.syncedAt) }).from(syncEmployees),
    db.select({ companyId: syncEmployees.companyId, cnt: count() }).from(syncEmployees).groupBy(syncEmployees.companyId),
    db.select({ cnt: count(), last: max(syncDivisions.syncedAt) }).from(syncDivisions),
    db.select({ companyId: syncDivisions.companyId, cnt: count() }).from(syncDivisions).groupBy(syncDivisions.companyId),
    db.select({ cnt: count(), last: max(syncDepartments.syncedAt) }).from(syncDepartments),
    db.select({ companyId: syncDepartments.companyId, cnt: count() }).from(syncDepartments).groupBy(syncDepartments.companyId),
    db.select({ cnt: count(), last: max(syncPositions.syncedAt) }).from(syncPositions),
    db.select({ companyId: syncPositions.companyId, cnt: count() }).from(syncPositions).groupBy(syncPositions.companyId),
    db.select({ cnt: count(), last: max(syncPositionHierarchy.syncedAt) }).from(syncPositionHierarchy),
    db.select({ companyId: syncPositionHierarchy.companyId, cnt: count() }).from(syncPositionHierarchy).groupBy(syncPositionHierarchy.companyId),
    db.select({ cnt: count(), last: max(syncEmployeePositions.syncedAt) }).from(syncEmployeePositions),
    db.select({ companyId: syncEmployeePositions.companyId, cnt: count() }).from(syncEmployeePositions).groupBy(syncEmployeePositions.companyId),
    db.select({ cnt: count(), last: max(syncTechnicalCompetencies.syncedAt) }).from(syncTechnicalCompetencies),
    db.select({ companyId: syncTechnicalCompetencies.companyId, cnt: count() }).from(syncTechnicalCompetencies).groupBy(syncTechnicalCompetencies.companyId),
    db.select({ cnt: count(), last: max(syncPerformanceAppraisals.syncedAt) }).from(syncPerformanceAppraisals),
    db.select({ companyId: syncPerformanceAppraisals.companyId, cnt: count() }).from(syncPerformanceAppraisals).groupBy(syncPerformanceAppraisals.companyId),
    db.select({ cnt: count(), last: max(syncDisciplinary.syncedAt) }).from(syncDisciplinary),
    db.select({ companyId: syncDisciplinary.companyId, cnt: count() }).from(syncDisciplinary).groupBy(syncDisciplinary.companyId),
    db.select({ cnt: count(), last: max(syncEducation.syncedAt) }).from(syncEducation),
    db.select({ companyId: syncEducation.companyId, cnt: count() }).from(syncEducation).groupBy(syncEducation.companyId),
    db.select({ cnt: count(), last: max(syncEmployeePersonal.syncedAt) }).from(syncEmployeePersonal),
    db.select({ companyId: syncEmployeePersonal.companyId, cnt: count() }).from(syncEmployeePersonal).groupBy(syncEmployeePersonal.companyId),
    // Sync-status counters — tombstoned candidates are excluded on both halves,
    // otherwise the total and the per-tenant breakdown disagree with the list.
    db.select({ cnt: count() }).from(candidates).where(liveCandidate()),
    db.select({ tenantId: candidates.tenantId, cnt: count() }).from(candidates).where(liveCandidate()).groupBy(candidates.tenantId),
    db.select({ cnt: count(), last: max(syncJobProfiles.syncedAt) }).from(syncJobProfiles),
    db.select({ cnt: count(), last: max(syncKamusKompetensi.syncedAt) }).from(syncKamusKompetensi),
    db
      .select({
        companyId: syncCompanyTenantMap.companyId,
        tenantId: syncCompanyTenantMap.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
      })
      .from(syncCompanyTenantMap)
      .leftJoin(tenants, eq(syncCompanyTenantMap.tenantId, tenants.id)),
    db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants),
  ]);

  return {
    employees: {
      count: empR[0].cnt,
      lastSync: empR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(empByCompany, mappings, tenantsList),
    },
    divisions: {
      count: divR[0].cnt,
      lastSync: divR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(divByCompany, mappings, tenantsList),
    },
    departments: {
      count: deptR[0].cnt,
      lastSync: deptR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(deptByCompany, mappings, tenantsList),
    },
    positions: {
      count: posR[0].cnt,
      lastSync: posR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(posByCompany, mappings, tenantsList),
    },
    hierarchy: {
      count: posHierR[0].cnt,
      lastSync: posHierR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(posHierByCompany, mappings, tenantsList),
    },
    employeePosition: {
      count: empPosR[0].cnt,
      lastSync: empPosR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(empPosByCompany, mappings, tenantsList),
    },
    technicalCompetency: {
      count: techR[0].cnt,
      lastSync: techR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(techByCompany, mappings, tenantsList),
    },
    performance: {
      count: perfR[0].cnt,
      lastSync: perfR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(perfByCompany, mappings, tenantsList),
    },
    disciplinary: {
      count: discR[0].cnt,
      lastSync: discR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(discByCompany, mappings, tenantsList),
    },
    education: {
      count: eduR[0].cnt,
      lastSync: eduR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(eduByCompany, mappings, tenantsList),
    },
    personal: {
      count: persR[0].cnt,
      lastSync: persR[0].last?.toISOString() ?? null,
      breakdown: buildBreakdownFromCompany(persByCompany, mappings, tenantsList),
    },
    candidates: {
      count: candR[0].cnt,
      lastSync: null,
      breakdown: buildBreakdownFromTenant(candByTenant, tenantsList),
    },
    jobProfiles: {
      count: jpR[0].cnt,
      lastSync: jpR[0].last?.toISOString() ?? null,
      breakdown: [],
    },
    kamusKompetensi: {
      count: kamusR[0].cnt,
      lastSync: kamusR[0].last?.toISOString() ?? null,
      breakdown: [],
    },
  };
}

/**
 * Resolve one or more tenantIds to their mapped companyIds.
 * Returns an empty array if no mappings are found.
 */
export async function resolveCompanyIdsForTenants(
  tenantIds: string[],
): Promise<{ companyId: string; tenantId: string }[]> {
  if (tenantIds.length === 0) return [];
  return db
    .select({
      companyId: syncCompanyTenantMap.companyId,
      tenantId: syncCompanyTenantMap.tenantId,
    })
    .from(syncCompanyTenantMap)
    .where(inArray(syncCompanyTenantMap.tenantId, tenantIds));
}

// ── Sync audit trail (sync_runs) ──────────────────────────────────────────────

export type SyncRunRow = {
  id: string;
  jobKey: string;
  status: 'running' | 'success' | 'failed' | string;
  triggerSource: string;
  mode: string | null;
  actor: string | null;
  tenantIds: string[] | null;
  synced: number | null;
  total: number | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

/**
 * Reading the audit trail is tolerant of a missing table: migration 0044 may not
 * be applied yet, and the Sinkronisasi page must still render if it isn't.
 */
function isMissingSyncRunsTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /relation "?sync_runs"?\s+does not exist/i.test(msg);
}

function serializeRun(r: typeof schema.syncRuns.$inferSelect): SyncRunRow {
  return {
    id: r.id,
    jobKey: r.jobKey,
    status: r.status,
    triggerSource: r.triggerSource,
    mode: r.mode,
    actor: r.actor,
    tenantIds: r.tenantIds ?? null,
    synced: r.synced,
    total: r.total,
    message: r.message,
    error: r.error,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    durationMs: r.durationMs,
  };
}

/**
 * Most recent run per module, keyed by jobKey — drives the "terakhir sinkron"
 * line under each sync button.
 */
export async function getLatestSyncRunsAction(): Promise<Record<string, SyncRunRow>> {
  await requirePermission('sync.manage');
  try {
    // Typed query builder rather than raw SQL + DISTINCT ON: db.execute() on the
    // node-postgres driver returns pg's QueryResult (rows live on `.rows`, the
    // result itself is not iterable), and hand-mapping snake_case columns is an
    // easy place to get a column name silently wrong. This joins each job's max
    // started_at back to the row, and still uses the (job_key, started_at) index.
    const latest = db
      .select({
        jobKey: schema.syncRuns.jobKey,
        // Alias must NOT be 'started_at': Drizzle emits the subquery column
        // unqualified in the ON clause, so a name matching the real column makes
        // the join ambiguous ("column reference started_at is ambiguous").
        startedAt: max(schema.syncRuns.startedAt).as('latest_started_at'),
      })
      .from(schema.syncRuns)
      .groupBy(schema.syncRuns.jobKey)
      .as('latest');

    const rows = await db
      .select()
      .from(schema.syncRuns)
      .innerJoin(
        latest,
        and(
          eq(schema.syncRuns.jobKey, latest.jobKey),
          eq(schema.syncRuns.startedAt, latest.startedAt),
        ),
      );

    const out: Record<string, SyncRunRow> = {};
    for (const row of rows) {
      const run = serializeRun(row.sync_runs);
      out[run.jobKey] = run;
    }
    return out;
  } catch (err) {
    if (isMissingSyncRunsTable(err)) return {};
    throw err;
  }
}

/** Paginated history for the audit-trail table. */
export async function listSyncRunsAction(params: {
  page?: number;
  pageSize?: number;
  jobKey?: string;
  status?: string;
} = {}): Promise<{ runs: SyncRunRow[]; total: number; page: number; pageSize: number }> {
  await requirePermission('sync.manage');
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 25));

  try {
    const where = [];
    if (params.jobKey) where.push(eq(schema.syncRuns.jobKey, params.jobKey));
    if (params.status) where.push(eq(schema.syncRuns.status, params.status));
    const clause = where.length ? and(...where) : undefined;

    const [rows, totalRes] = await Promise.all([
      db
        .select()
        .from(schema.syncRuns)
        .where(clause)
        .orderBy(desc(schema.syncRuns.startedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: count() }).from(schema.syncRuns).where(clause),
    ]);

    return {
      runs: rows.map(serializeRun),
      total: totalRes[0]?.total ?? 0,
      page,
      pageSize,
    };
  } catch (err) {
    if (isMissingSyncRunsTable(err)) return { runs: [], total: 0, page, pageSize };
    throw err;
  }
}
