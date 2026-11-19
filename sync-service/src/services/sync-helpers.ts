import { query as pgQuery } from "../db/postgres.js";

export type CompanyTenantMapping = {
  companyId: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
};

/**
 * Parse a comma-separated list of tenantIds from a query string.
 * Returns an empty array if the input is missing or empty.
 */
export function parseTenantIds(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve one or more tenantIds to their active company→tenant mappings.
 * Returns an empty array if no active mappings are found.
 */
export async function resolveMappingsForTenants(
  tenantIds: string[],
): Promise<CompanyTenantMapping[]> {
  if (tenantIds.length === 0) return [];
  const placeholders = tenantIds.map((_, i) => `$${i + 1}`).join(",");
  const rows = await pgQuery<CompanyTenantMapping>(
    `SELECT m.company_id AS "companyId",
            m.tenant_id  AS "tenantId",
            t.name       AS "tenantName",
            t.slug       AS "tenantSlug"
       FROM sync_company_tenant_map m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.is_active = true
        AND m.tenant_id IN (${placeholders})`,
    tenantIds,
  );
  return rows;
}

type FilterOptions = {
  /**
   * Placeholder dialect: `mssql` emits `@pN` (node-mssql named params),
   * `pg` emits `$N` (node-postgres positional params). Default `mssql`.
   */
  dialect?: "mssql" | "pg";
  /**
   * For `pg` only: number of positional parameters already used by the
   * surrounding query (or by an earlier fragment), so `$N` numbering
   * continues instead of colliding.
   */
  offset?: number;
};

function buildPlaceholders(count: number, opts?: FilterOptions): string {
  const dialect = opts?.dialect ?? "mssql";
  const offset = opts?.offset ?? 0;
  return Array.from({ length: count }, (_, i) =>
    dialect === "pg" ? `$${offset + i + 1}` : `@p${offset + i + 1}`,
  ).join(",");
}

/**
 * Build a SQL `IN (...)` fragment and matching parameter array for a
 * company-id filter that can be appended to an existing WHERE clause.
 *
 * Returns `{ sql, params }` where `sql` is either the empty string (no
 * filter) or an ` AND <column> IN (...)` fragment, and `params` is the
 * list of company ids matching the placeholders. Pass
 * `{ dialect: "pg" }` for queries executed against Postgres.
 *
 * The caller is responsible for interpolating the parameters into
 * the surrounding query in the correct order.
 */
export function buildCompanyIdFilter(
  column: string,
  companyIds: string[] | null | undefined,
  opts?: FilterOptions,
): { sql: string; params: unknown[] } {
  if (!companyIds || companyIds.length === 0) {
    return { sql: "", params: [] };
  }
  return {
    sql: ` AND ${column} IN (${buildPlaceholders(companyIds.length, opts)})`,
    params: companyIds,
  };
}

/**
 * Like `buildCompanyIdFilter` but returns a standalone `WHERE` clause
 * (with leading `WHERE`) for queries that have no other predicates.
 */
export function buildCompanyIdWhere(
  column: string,
  companyIds: string[] | null | undefined,
  opts?: FilterOptions,
): { sql: string; params: unknown[] } {
  if (!companyIds || companyIds.length === 0) {
    return { sql: "", params: [] };
  }
  return {
    sql: ` WHERE ${column} IN (${buildPlaceholders(companyIds.length, opts)})`,
    params: companyIds,
  };
}
