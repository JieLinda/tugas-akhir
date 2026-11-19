'use server';

// ── Run lineage as a TREE ────────────────────────────────────────────────
//
// A position accumulates runs the way a document accumulates drafts: one
// baseline, then reruns on top of it, then reruns on top of THOSE. The run
// picker showed that as a flat list ordered by time, with the derivation smuggled
// into the label ("Re-ranking (−1 kandidat) — Critical Position — IT APPLICATION
// DEVELOPM…"), which stops being readable at about the third generation and is
// already at 25 runs on one position here.
//
// This reads the real edge (`scoring_runs.parent_run_id`, drizzle/0069) and
// returns a forest. Three deliberate properties:
//
//  • UNFILTERED by date or program. The run picker's filters are server-side and
//    default to the current calendar year, so a January rerun of a December base
//    would render as an orphan — the tree would invent a break that does not
//    exist. Filtering a tree by a predicate its parents may fail is a different
//    feature; this one shows the structure.
//  • Tenant-scoped through `critical_positions`, matching the lineage query it
//    replaces rather than `getScoringRunsForPosition`, which filters by position
//    only.
//  • Orphans are roots. A parent that was deleted (the FK is ON DELETE SET NULL)
//    or a run that predates the column both surface at depth 0, the first marked
//    so the reader knows the break is real.

import { requirePermission } from '@/lib/rbac';
import { getCurrentTenantId } from '@/lib/tenant';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { isDemoSql } from '@/lib/demo/run-mode';
import { buildRunForest, type RunTree, type RunTreeRow } from '@/lib/run-tree';
import { demoScrub } from '@/lib/demo/names';

export type { RunTree, RunTreeNode } from '@/lib/run-tree';

// Demo mode: names inside reasons and labels leave the server as initials.
export async function getRunTreeAction(
  ...args: Parameters<typeof getRunTreeActionImpl>
): ReturnType<typeof getRunTreeActionImpl> {
  return demoScrub(await getRunTreeActionImpl(...args));
}

async function getRunTreeActionImpl(positionId: string): Promise<RunTree> {
  await requirePermission('positions.view');
  const tenantId = await getCurrentTenantId();

  // `rerun_reason` is read through to_jsonb so the tree still renders on a
  // database where drizzle/0086 has not been applied yet — it is display-only
  // here, and a missing column must not take the whole lineage down.
  const result = await db.execute(sql`
    SELECT sr.id::text          AS "runId",
           sr.label             AS "label",
           sr.rerun_mode        AS "mode",
           to_jsonb(sr)->>'rerun_reason' AS "reason",
           sr.method            AS "method",
           sr.status            AS "status",
           sr.program           AS "program",
           sr.candidate_count   AS "candidateCount",
           sr.created_at        AS "createdAt",
           sr.completed_at      AS "completedAt",
           sr.parent_run_id::text AS "parentRunId",
           sr.run_info -> 'failure' AS "failure",
           (SELECT ts.status FROM tournament_sessions ts
             WHERE ts.run_id = sr.id ORDER BY ts.updated_at DESC LIMIT 1) AS "sessionStatus",
           COALESCE(u.name, u.email) AS "createdByName",
           COALESCE(jsonb_array_length(
             CASE WHEN jsonb_typeof(sr.config_snapshot #> '{rerun,added}') = 'array'
                  THEN sr.config_snapshot #> '{rerun,added}' END), 0) AS "addedCount",
           COALESCE(jsonb_array_length(
             CASE WHEN jsonb_typeof(sr.config_snapshot #> '{rerun,skipped}') = 'array'
                  THEN sr.config_snapshot #> '{rerun,skipped}' END), 0) AS "skippedCount",
           (SELECT count(*) FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(sr.config_snapshot #> '{rerun,added}') = 'array'
                   THEN sr.config_snapshot #> '{rerun,added}' ELSE '[]'::jsonb END) a
             WHERE (a ->> 'outOfRange')::boolean IS TRUE) AS "outOfRangeCount",
           (sr.run_info #>> '{rerun,ahpSource}' = 'live_fallback'
             OR sr.run_info #>> '{rerun,anchorsSource}' = 'live_fallback'
             OR sr.run_info #>> '{positionBasisStatus,source}' = 'live_fallback'
             OR sr.run_info #>> '{readiness,source}' = 'live_fallback') AS "liveValues",
           COALESCE((sr.run_info #>> '{provisional,count}')::int, 0) AS "provisionalCount",
           (SELECT count(*) FROM position_picks pp WHERE pp.run_id = sr.id) AS "decisionCount"
      FROM scoring_runs sr
      JOIN critical_positions cp ON cp.id = sr.position_id
      LEFT JOIN users u ON u.id = sr.created_by
     WHERE sr.position_id = ${positionId}
       AND cp.tenant_id = ${tenantId}
       AND ${await isDemoSql('sr')}
     ORDER BY sr.created_at ASC
  `);
  // House convention for db.execute across this repo (see progress-running-actions).
  return buildRunForest(result.rows as unknown as RunTreeRow[]);
}
