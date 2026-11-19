import 'server-only';

import { and, desc, eq, ilike, sql, count } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { AuditAction } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/app-mode';

export type AuditEntry = {
  tenantId: string;
  actorId: string | null;
  entityType: string;
  entityId?: string | null;
  action: AuditAction;
  summary?: string;
  diff?: Record<string, unknown> | null;
  /**
   * The write only ever touches mode-scoped rows (runs, sessions, picks and
   * their marks carry `is_demo`, drizzle/0093). In demo mode such a write is a
   * demo action, and the shared trail — which real mode reads — does not take
   * it; demo rows keep their own actor and reason where the feature records
   * one. Writes to shared state (governance, sync, settings) never set this, so
   * they are audited in either mode.
   */
  demoScoped?: boolean;
};

/** Insert a single audit log row. Best-effort: failures are logged and swallowed. */
export async function logAudit(entry: AuditEntry): Promise<void> {
  if (entry.demoScoped && (await isDemoMode())) return;
  try {
    await db.insert(schema.auditLog).values({
      tenantId: entry.tenantId,
      actorId: entry.actorId,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      action: entry.action,
      summary: entry.summary?.slice(0, 500),
      diff: entry.diff ?? null,
    });
  } catch (error) {
    console.error('logAudit failed:', error);
  }
}

export type AuditFilters = {
  entityType?: string;
  action?: AuditAction;
  limit?: number;
};

export type AuditLogPageParams = {
  page?: number;
  pageSize?: number;
  fromDate?: string;
  toDate?: string;
  entityType?: string;
  action?: string;
  search?: string;
};

export type AuditLogPageResult = {
  entries: {
    id: string;
    actorName: string;
    entityType: string;
    entityId: string | null;
    action: string;
    summary: string | null;
    createdAt: string;
  }[];
  total: number;
  page: number;
  pageSize: number;
};

const baseAuditSelect = {
  id: schema.auditLog.id,
  actorName: schema.users.name,
  entityType: schema.auditLog.entityType,
  entityId: schema.auditLog.entityId,
  action: schema.auditLog.action,
  summary: schema.auditLog.summary,
  createdAt: schema.auditLog.createdAt,
};

/** The calendar day (YYYY-MM-DD) from a date string, or null if unparseable. */
function dayKey(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? match[0] : null;
}

/** Shift a YYYY-MM-DD key by whole days, staying in calendar space. */
function shiftDay(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// audit_log.created_at is `timestamp` WITHOUT time zone — a wall-clock value, not
// an instant. Two bugs came out of comparing it against a JS Date:
//
//  1. No end-of-day. `<= '2026-07-29'` means `<= 2026-07-29 00:00:00`, so every
//     entry actually made during the 29th was dropped and you had to pick the
//     30th to see them. Fixed by using an exclusive next-midnight bound, which
//     is correct regardless of the time-of-day on a row.
//  2. Time-zone skew. The picker yields local midnight and the client sent
//     toISOString(), so in WIB the 29th became 2026-07-28T17:00:00Z — pushing
//     the boundary into the previous day. Fixed by passing plain calendar days
//     and casting to ::timestamp here, so no offset conversion ever happens.
function buildAuditWhereClause(tenantId: string, params: AuditLogPageParams) {
  const conditions = [eq(schema.auditLog.tenantId, tenantId)];
  if (params.entityType) conditions.push(eq(schema.auditLog.entityType, params.entityType));
  if (params.action) conditions.push(eq(schema.auditLog.action, params.action));

  let from = params.fromDate ? dayKey(params.fromDate) : null;
  let to = params.toDate ? dayKey(params.toDate) : null;
  // An inverted range means the user (or a stale client) crossed the bounds;
  // swapping reads it as the range they meant, where honouring it literally
  // would silently return zero rows. YYYY-MM-DD compares correctly as text.
  if (from && to && from > to) [from, to] = [to, from];

  if (from) {
    conditions.push(sql`${schema.auditLog.createdAt} >= ${`${from} 00:00:00`}::timestamp`);
  }
  if (to) {
    conditions.push(sql`${schema.auditLog.createdAt} < ${`${shiftDay(to, 1)} 00:00:00`}::timestamp`);
  }

  // ilike, not like: summaries mix casing ("Scoring", "posisi", NPK codes),
  // and a search box that misses "scoring" for "Scoring" reads as broken.
  if (params.search?.trim()) conditions.push(ilike(schema.auditLog.summary, `%${params.search.trim()}%`));
  return conditions;
}

export async function listAuditLogPage(tenantId: string, params: AuditLogPageParams = {}): Promise<AuditLogPageResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const where = buildAuditWhereClause(tenantId, params);

  const [rows, totalResult] = await Promise.all([
    db
      .select(baseAuditSelect)
      .from(schema.auditLog)
      .leftJoin(schema.users, eq(schema.auditLog.actorId, schema.users.id))
      .where(and(...where))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(schema.auditLog)
      .where(and(...where)),
  ]);

  const total = totalResult[0]?.total ?? 0;

  return {
    entries: rows.map((r) => ({
      id: r.id,
      actorName: r.actorName ?? 'Sistem',
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      summary: r.summary,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}

export async function listAuditLog(tenantId: string, filters: AuditFilters = {}) {
  const where = [eq(schema.auditLog.tenantId, tenantId)];
  if (filters.entityType) where.push(eq(schema.auditLog.entityType, filters.entityType));
  if (filters.action) where.push(eq(schema.auditLog.action, filters.action));

  return db
    .select({
      id: schema.auditLog.id,
      actorId: schema.auditLog.actorId,
      actorName: schema.users.name,
      entityType: schema.auditLog.entityType,
      entityId: schema.auditLog.entityId,
      action: schema.auditLog.action,
      summary: schema.auditLog.summary,
      diff: schema.auditLog.diff,
      createdAt: schema.auditLog.createdAt,
    })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.auditLog.actorId, schema.users.id))
    .where(and(...where))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(filters.limit ?? 200);
}
