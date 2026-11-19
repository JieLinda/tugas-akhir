import { isNull } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';

/**
 * The single definition of "this candidate still counts".
 *
 * Candidates are soft-deleted (drizzle/0045_candidates_soft_delete.sql) because
 * their id is cascade-referenced by four tables and embedded without a foreign
 * key in `tournament_sessions`' jsonb pools, so a real DELETE quietly rewrites
 * finished scoring history.
 *
 * Nothing filters tombstones automatically. Drizzle `relations()` are declared
 * in this schema but never used — every query is an explicit select/join — so a
 * soft delete is invisible until a call site says so. This module exists so
 * that statement is spelled the same way everywhere and is greppable.
 *
 * THREE CATEGORIES OF READ SITE, and the third is the one that bites:
 *
 *  1. Pools and lists — MUST filter. A tombstoned person appearing in a
 *     scoring pool or the Kandidat table is the bug this feature is about.
 *
 *  2. History rendering — MUST NOT filter. `analysis_results`, `position_picks`
 *     and audit strings describe what happened at the time; hiding the person
 *     turns a finished ranking into a list with holes. (`analysis_results`
 *     mostly renders from its own `details` JSON blob and does not join
 *     candidates at all, so this is free in most places.)
 *
 *  3. Identity resolution — MUST filter, and must also break ties. Several
 *     queries resolve an NPK to a candidate with `LIMIT 1` and no ORDER BY
 *     (lib/pulse-data.ts, lib/position-family-map-actions.ts). Once a tombstone
 *     and a live row can share an NPK, "no ORDER BY" means the tombstone can
 *     win. Filtering is the fix; see LIVE_CANDIDATE_SQL for the raw-SQL sites.
 */

/** Drizzle predicate: candidate has not been soft-deleted. */
export function liveCandidate() {
  return isNull(schema.candidates.deletedAt);
}

/**
 * Raw-SQL fragment for the same rule, e.g.
 *   `LEFT JOIN candidates c ON ... ${liveCandidateSql('c')}`
 *
 * Takes the alias explicitly rather than assuming one: the candidate table is
 * aliased `c`, `cand` and unaliased across the raw SQL in this repo, and a
 * hardcoded alias would produce a query that runs and silently filters nothing.
 */
export function liveCandidateSql(alias: string): string {
  return ` AND ${alias}.deleted_at IS NULL`;
}

/** Bare predicate for a WHERE clause that has no other conditions. */
export const LIVE_CANDIDATE_SQL = 'deleted_at IS NULL';
