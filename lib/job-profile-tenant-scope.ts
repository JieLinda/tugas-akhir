import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { syncJobProfiles } from '@/lib/db/schema';

/**
 * Tenant scoping for job profile DOCUMENTS.
 *
 * Ownership lives in `job_profile_tenants` (many-to-many), assigned directly —
 * either chosen at upload time (Sinkronisasi → Job Profile) or set on the Job
 * Profiles page. The visibility rule is deliberately permissive at the edges:
 *
 *   visible(profile, tenant) =
 *        the profile has a row for this tenant                  -- assigned to us
 *     OR the profile has no rows at all                         -- unassigned
 *
 * The second clause is what makes a newly-synced document work before anyone
 * has assigned it: it stays visible to everyone instead of silently vanishing.
 * The UI flags those documents so the assignment gets filled in — see
 * `isUnassigned`.
 *
 * WHAT THIS DOES NOT COVER: scoring. `scoring-service` compares candidates
 * against the job-profile corpus without any tenant predicate, on purpose, so a
 * cross-tenant scoring run scores every candidate on the same basis. Applying
 * this scope there would leave out-of-tenant candidates with no career/technical
 * evidence, which the AHP+TOPSIS engine handles by dropping the criterion and
 * redistributing its weight — i.e. it would quietly change rankings rather than
 * fail. Keep the two apart.
 */

/**
 * Drizzle predicate: job profiles visible to `tenantId`.
 * Use inside `.where(...)` on a query whose FROM includes `sync_job_profiles`.
 */
export function jobProfileVisibleTo(tenantId: string): SQL {
  return sql`(
    EXISTS (
      SELECT 1 FROM job_profile_tenants jpt
       WHERE jpt.job_profile_id = ${syncJobProfiles.id}
         AND jpt.tenant_id = ${tenantId}::uuid
    )
    OR NOT EXISTS (
      SELECT 1 FROM job_profile_tenants jpt
       WHERE jpt.job_profile_id = ${syncJobProfiles.id}
    )
  )`;
}

/**
 * The same rule as raw SQL, for callers that build their own statements (the
 * job-family queries and the topic-service payload) and cannot use the Drizzle
 * column reference above. `alias` is the table alias holding `id`.
 */
export function jobProfileVisibleToSql(alias: string, tenantParam: string): string {
  return `(
    EXISTS (SELECT 1 FROM job_profile_tenants jpt
             WHERE jpt.job_profile_id = ${alias}.id AND jpt.tenant_id = ${tenantParam}::uuid)
    OR NOT EXISTS (SELECT 1 FROM job_profile_tenants jpt
                    WHERE jpt.job_profile_id = ${alias}.id)
  )`;
}

/** Job profile ids visible to a tenant — for filtering result sets in memory. */
export async function visibleJobProfileIds(tenantId: string): Promise<Set<number>> {
  const res = await db.execute<{ id: number }>(sql`
    SELECT id
      FROM sync_job_profiles
     WHERE ${jobProfileVisibleTo(tenantId)}
  `);
  return new Set((res.rows as Array<{ id: number }>).map((r) => Number(r.id)));
}

/**
 * Owning tenant ids for a set of documents, for badges/pickers on the Job
 * Profiles page. Documents absent from the result have no rows → unassigned.
 */
export async function getJobProfileOwnership(
  jobProfileIds: number[]
): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (jobProfileIds.length === 0) return out;

  const ids = jobProfileIds.map((n) => Number(n));
  const res = await db.execute<{ job_profile_id: number; tenant_id: string }>(sql`
    SELECT job_profile_id, tenant_id::text AS tenant_id
      FROM job_profile_tenants
     WHERE job_profile_id = ANY(ARRAY[${sql.join(ids.map((n) => sql`${n}`), sql`, `)}]::int[])
  `);

  for (const r of res.rows as Array<{ job_profile_id: number; tenant_id: string }>) {
    const id = Number(r.job_profile_id);
    const list = out.get(id) ?? [];
    list.push(r.tenant_id);
    out.set(id, list);
  }
  return out;
}

/** A document with no ownership rows: nobody has assigned it to a tenant yet. */
export function isUnassigned(tenantIds: string[] | undefined): boolean {
  return !tenantIds || tenantIds.length === 0;
}
