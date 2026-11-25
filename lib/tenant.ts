import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  /** Built-in companies (Mulia / MSO / ERRO) can never be removed. */
  isBuiltin: boolean;
  /** Set on a removed company; only `listAllTenants` returns those. */
  deletedAt?: string | null;
};

/**
 * The three companies every install starts with — matches the DB seed values
 * and drizzle/0100's `is_builtin` rows. Since companies can be added from the
 * header dropdown, this is NOT the tenant list: read `listTenants()` (live) or
 * `listAllTenants()` (incl. removed, for naming history). It remains the
 * fallback when the tenants table cannot be read with drizzle/0100's columns,
 * and the list scripts outside a request use.
 */
export const BUILTIN_TENANTS: TenantInfo[] = [
  { id: '10000000-0000-0000-0000-000000000001', slug: 'mulia', name: 'Mulia', isBuiltin: true },
  { id: '10000000-0000-0000-0000-000000000002', slug: 'mso', name: 'MSO', isBuiltin: true },
  { id: '10000000-0000-0000-0000-000000000003', slug: 'erro', name: 'ERRO', isBuiltin: true },
];

export { TENANT_NAME_MAX_LENGTH, TENANT_ID_PREFIX } from '@/lib/tenant-shared';

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  is_builtin: boolean;
  deleted_at: string | null;
};

/**
 * All tenant rows, built-ins first then by creation. One read per request
 * (React `cache`). A database without drizzle/0100 falls back to the built-ins
 * so the app keeps working — logged, never silent.
 */
const readTenantRows = cache(async (): Promise<TenantInfo[]> => {
  try {
    const res = await db.execute(sql`
      SELECT id::text AS id, slug, name, is_builtin, deleted_at::text AS deleted_at
        FROM tenants
       ORDER BY is_builtin DESC, created_at ASC, id ASC
    `);
    const rows = (res.rows as TenantRow[]).map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      isBuiltin: r.is_builtin === true,
      deletedAt: r.deleted_at,
    }));
    return rows.length > 0 ? rows : BUILTIN_TENANTS;
  } catch (error) {
    console.error(
      '[tenant] cannot read tenants (is drizzle/0100 applied?); using the built-in list:',
      error instanceof Error ? error.message : error,
    );
    return BUILTIN_TENANTS;
  }
});

/** Live companies — the dropdown, and every "is this a valid tenant id" check. */
export async function listTenants(): Promise<TenantInfo[]> {
  return (await readTenantRows()).filter((t) => !t.deletedAt);
}

/**
 * Every company including removed ones — for turning a stored tenant id into a
 * name (audit rows, old runs), which must keep working after a removal.
 */
export async function listAllTenants(): Promise<TenantInfo[]> {
  return readTenantRows();
}

/** id → name over every company, removed ones included. */
export async function tenantNameMap(): Promise<Map<string, string>> {
  return new Map((await listAllTenants()).map((t) => [t.id, t.name]));
}

/** The set of live tenant ids, for validating a caller-supplied id. */
export async function liveTenantIdSet(): Promise<Set<string>> {
  return new Set((await listTenants()).map((t) => t.id));
}

const TENANT_COOKIE = 'pulse_tenant';

/** Get current tenant from cookie. Falls back to the first live tenant. */
export async function getCurrentTenant(): Promise<TenantInfo> {
  const cookieStore = await cookies();
  const slug = cookieStore.get(TENANT_COOKIE)?.value;
  const tenants = await listTenants();
  return tenants.find((t) => t.slug === slug) ?? tenants[0] ?? BUILTIN_TENANTS[0]!;
}

/** Get current tenant ID (shorthand) */
export async function getCurrentTenantId(): Promise<string> {
  const tenant = await getCurrentTenant();
  return tenant.id;
}
