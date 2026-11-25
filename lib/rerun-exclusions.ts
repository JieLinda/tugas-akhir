// The one statement that copies a parent run's exclusion marks into a
// "Tambah Kandidat Pembanding" child (drizzle/0102). Used by startRerunAction
// (lib/scoring-engine.ts) inside the transaction that creates the child, and by
// scripts/verify-anchored-rerun.ts — one statement, so the check exercises what
// production runs.
//
// A mark is a forum decision about a PERSON ("resigned"); the child carries
// that person in its pool, so without the copy they reappeared unmarked —
// counted as ready, pickable without the extra confirmation. Same actor, time,
// reason and note; `inherited_from_run_id` names the run where the mark was
// ORIGINALLY made (the origin, not the immediate parent). Copied in SQL so
// `excluded_at` moves byte for byte. Returns one row per copied mark.

import { sql, type SQL } from 'drizzle-orm';

export function inheritExclusionsStatement(childRunId: string, parentRunId: string, tenantId: string): SQL {
  return sql`
    INSERT INTO scoring_run_exclusions
      (tenant_id, run_id, candidate_id, reason, note, excluded_by, excluded_at, inherited_from_run_id)
    SELECT tenant_id, ${childRunId}, candidate_id, reason, note, excluded_by, excluded_at,
           COALESCE(inherited_from_run_id, run_id)
      FROM scoring_run_exclusions
     WHERE run_id = ${parentRunId} AND tenant_id = ${tenantId}
    ON CONFLICT (run_id, candidate_id) DO NOTHING
    RETURNING candidate_id
  `;
}
