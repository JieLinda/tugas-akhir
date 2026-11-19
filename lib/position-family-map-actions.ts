'use server';

// Job Family map for a scoring run: places the run's finalist candidates on the
// same BERTopic 2-D (UMAP) projection the Family Tree page draws, positioned by
// the job profile their CURRENT position is paired with (job_family_matches),
// and measures each one's distance to the TARGET position's job profile.
//
// Reads the newest COMPLETED topic run — the map is org-wide master data (job
// profiles are not tenant-scoped), exactly like lib/job-family-topics-actions.ts.

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  criticalPositions,
  jobFamilyMatches,
  jobFamilyTopicRuns,
  jobFamilyTopics,
  jobFamilyTopicAssignments,
} from '@/lib/db/schema';
import { requirePermission } from '@/lib/rbac';
import { resolveJobProfileIdentifier } from '@/lib/job-family/resolve-profile';
import { getCurrentTenantId } from '@/lib/tenant';

// ── Shapes ─────────────────────────────────────────────────────────

/** One job profile plotted on the map (a dot; radius ∝ incumbentCount). */
export type FamilyMapPoint = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  topicId: number;
  x: number;
  y: number;
  incumbentCount: number;
};

/** A job family (BERTopic topic) — legend entry + centroid label on the map. */
export type FamilyMapTopic = {
  topicId: number;
  label: string | null;
  generalTitle: string | null;
  size: number;
  incumbentCount: number;
  x: number | null;
  y: number | null;
};

/** The scored position's own job profile — the reference point on the map. */
export type FamilyMapTarget = {
  jobProfileId: number;
  positionName: string | null;
  /** How the pairing was found: incumbent, linked master position, or title. */
  source: 'family-candidate' | 'family-position' | 'title';
  topicId: number | null;
  topicLabel: string | null;
  x: number | null;
  y: number | null;
};

/** A finalist placed on the map, with its distance to the target. */
export type FamilyMapCandidate = {
  candidateId: string;
  jobProfileId: number;
  jobProfileName: string | null;
  divisionDepartment: string | null;
  /** Current position title recorded by the Job Family sync match. */
  candidatePosition: string | null;
  matchType: string; // filename | exact | embedding | ...
  /** Cosine similarity of the position↔profile pairing (embedding matches only). */
  matchSimilarity: number | null;
  topicId: number | null;
  topicLabel: string | null;
  x: number;
  y: number;
  /** Euclidean distance to the target in UMAP units (null if target unplaced). */
  distance: number | null;
  /** Same distance as 0..100 %, where 100 = identical spot (scaled by map diagonal). */
  proximity: number | null;
  /** True when the finalist sits in the target's job family. */
  sameFamily: boolean | null;
  /** Distance rank among the placed finalists (1 = closest). */
  distanceRank: number | null;
};

/** A finalist that could not be plotted, and why. */
export type FamilyMapUnplaced = {
  candidateId: string;
  /**
   *  • 'no-match'   — no job_family_matches row (job profile unidentified)
   *  • 'not-in-map' — matched, but that profile isn't in this topic run
   *  • 'no-coords'  — in the run, but the projection has no x/y for it
   */
  reason: 'no-match' | 'not-in-map' | 'no-coords';
  jobProfileName: string | null;
};

export type PositionFamilyMap = {
  /**
   *  • 'ok'             — map data available
   *  • 'no-run'         — no completed BERTopic run yet
   *  • 'schema-missing' — job family tables not migrated
   */
  status: 'ok' | 'no-run' | 'schema-missing';
  message: string | null;
  runId: string | null;
  runCompletedAt: string | null;
  numTopics: number;
  topics: FamilyMapTopic[];
  points: FamilyMapPoint[];
  target: FamilyMapTarget | null;
  candidates: FamilyMapCandidate[];
  unplaced: FamilyMapUnplaced[];
};

// ── Helpers ────────────────────────────────────────────────────────

/**
 * True when the error means the job-family topic tables aren't present yet
 * (migration 0037) or pgvector/embed tables are missing — the map then degrades
 * to an explanatory empty state instead of blowing up the whole tab.
 */
function isMissingRelation(err: unknown): boolean {
  let cur: unknown = err;
  const parts: string[] = [];
  for (let depth = 0; cur && depth < 5; depth++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? (cur.cause as unknown) : undefined;
  }
  return /relation "?[a-z_]+"?\s+does not exist/i.test(parts.join('\n'));
}

function empty(status: PositionFamilyMap['status'], message: string | null): PositionFamilyMap {
  return {
    status,
    message,
    runId: null,
    runCompletedAt: null,
    numTopics: 0,
    topics: [],
    points: [],
    target: null,
    candidates: [],
    unplaced: [],
  };
}

// ── Action ─────────────────────────────────────────────────────────

/**
 * Build the Job Family map for one scoring run.
 *
 * @param positionId   critical_positions.id being scored (the target role)
 * @param candidateIds the run's finalists, already in rank order
 */
export async function getPositionFamilyMapAction(
  positionId: string,
  candidateIds: string[],
): Promise<PositionFamilyMap> {
  // Part of the job_profiles.* package (the Dokumen and Posisi menus), not
  // positions.*: the payload is topic-run and job-profile data plus map
  // coordinates, keyed by candidate id — it carries no position or candidate
  // detail of its own.
  await requirePermission('job_profiles.view');

  try {
    // ── Newest COMPLETED topic run (the map everyone else sees) ──
    const [run] = await db
      .select({
        id: jobFamilyTopicRuns.id,
        numTopics: jobFamilyTopicRuns.numTopics,
        completedAt: jobFamilyTopicRuns.completedAt,
      })
      .from(jobFamilyTopicRuns)
      .where(eq(jobFamilyTopicRuns.status, 'completed'))
      .orderBy(desc(jobFamilyTopicRuns.completedAt), desc(jobFamilyTopicRuns.createdAt))
      .limit(1);

    if (!run) {
      return empty(
        'no-run',
        'Belum ada hasil topic modelling yang selesai. Buka menu Posisi → Job Family lalu jalankan langkah 3 (Bangun Peta).',
      );
    }

    const [topicRows, assignRows] = await Promise.all([
      db
        .select({
          topicId: jobFamilyTopics.topicId,
          label: jobFamilyTopics.label,
          generalTitle: jobFamilyTopics.generalTitle,
          size: jobFamilyTopics.size,
          x: jobFamilyTopics.x,
          y: jobFamilyTopics.y,
        })
        .from(jobFamilyTopics)
        .where(eq(jobFamilyTopics.runId, run.id))
        .orderBy(desc(jobFamilyTopics.size)),
      db
        .select({
          jobProfileId: jobFamilyTopicAssignments.jobProfileId,
          positionName: jobFamilyTopicAssignments.positionName,
          divisionDepartment: jobFamilyTopicAssignments.divisionDepartment,
          topicId: jobFamilyTopicAssignments.topicId,
          x: jobFamilyTopicAssignments.x,
          y: jobFamilyTopicAssignments.y,
        })
        .from(jobFamilyTopicAssignments)
        .where(eq(jobFamilyTopicAssignments.runId, run.id)),
    ]);

    // ── Incumbents per job profile (drives the dot size, same as Family Tree) ──
    const jpIds = Array.from(new Set(assignRows.map((a) => a.jobProfileId)));
    const incumbentRows = jpIds.length
      ? await db
          .select({ jobProfileId: jobFamilyMatches.jobProfileId })
          .from(jobFamilyMatches)
          .where(inArray(jobFamilyMatches.jobProfileId, jpIds))
      : [];
    const incumbentsByJp = new Map<number, number>();
    for (const r of incumbentRows) {
      incumbentsByJp.set(r.jobProfileId, (incumbentsByJp.get(r.jobProfileId) ?? 0) + 1);
    }

    const assignByJp = new Map(assignRows.map((a) => [a.jobProfileId, a]));
    const labelByTopic = new Map<number, string | null>();
    const topicIncumbents = new Map<number, number>();
    for (const t of topicRows) labelByTopic.set(t.topicId, t.generalTitle ?? t.label ?? null);
    for (const a of assignRows) {
      topicIncumbents.set(
        a.topicId,
        (topicIncumbents.get(a.topicId) ?? 0) + (incumbentsByJp.get(a.jobProfileId) ?? 0),
      );
    }

    const points: FamilyMapPoint[] = assignRows
      .filter((a) => a.x != null && a.y != null)
      .map((a) => ({
        jobProfileId: a.jobProfileId,
        positionName: a.positionName ?? null,
        divisionDepartment: a.divisionDepartment ?? null,
        topicId: a.topicId,
        x: a.x!,
        y: a.y!,
        incumbentCount: incumbentsByJp.get(a.jobProfileId) ?? 0,
      }));

    const topics: FamilyMapTopic[] = topicRows.map((t) => ({
      topicId: t.topicId,
      label: t.label ?? null,
      generalTitle: t.generalTitle ?? null,
      size: t.size ?? 0,
      incumbentCount: topicIncumbents.get(t.topicId) ?? 0,
      x: t.x ?? null,
      y: t.y ?? null,
    }));

    // ── Target position → its job profile → its spot on the map ──
    const tenantId = await getCurrentTenantId();
    const [cp] = await db
      .select({
        title: criticalPositions.title,
        masterPositionId: criticalPositions.positionId,
        holderEmployeeId: criticalPositions.holderEmployeeId,
      })
      .from(criticalPositions)
      .where(and(eq(criticalPositions.id, positionId), eq(criticalPositions.tenantId, tenantId)))
      .limit(1);

    let target: FamilyMapTarget | null = null;
    if (cp) {
      // The holder's candidate row is what carries the job_family_matches pairing.
      const holderCandidateId = cp.holderEmployeeId
        ? await findCandidateIdByEmployeeId(cp.holderEmployeeId, tenantId)
        : null;
      const resolved = await resolveJobProfileIdentifier({
        candidateId: holderCandidateId,
        masterPositionId: cp.masterPositionId,
        titleFallback: cp.title,
      });
      if (resolved) {
        const a = assignByJp.get(resolved.jobProfileId);
        target = {
          jobProfileId: resolved.jobProfileId,
          positionName: a?.positionName ?? resolved.positionName,
          source: resolved.source,
          topicId: a?.topicId ?? null,
          topicLabel: a ? (labelByTopic.get(a.topicId) ?? null) : null,
          x: a?.x ?? null,
          y: a?.y ?? null,
        };
      }
    }

    // ── Finalists → their current position's job profile → map coords ──
    const ids = Array.from(new Set(candidateIds.filter(Boolean)));
    const matchRows = ids.length
      ? await db
          .select({
            candidateId: jobFamilyMatches.candidateId,
            jobProfileId: jobFamilyMatches.jobProfileId,
            jobProfileName: jobFamilyMatches.jobProfileName,
            candidatePosition: jobFamilyMatches.candidatePosition,
            matchType: jobFamilyMatches.matchType,
            similarity: jobFamilyMatches.similarity,
          })
          .from(jobFamilyMatches)
          .where(inArray(jobFamilyMatches.candidateId, ids))
      : [];
    const matchByCandidate = new Map(matchRows.map((m) => [m.candidateId, m]));

    // Normaliser for the 0..100 % proximity readout: the map's own diagonal, so
    // the number means "how close relative to the whole job-family landscape".
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const diagonal =
      points.length > 1
        ? Math.hypot(
            Math.max(...xs) - Math.min(...xs),
            Math.max(...ys) - Math.min(...ys),
          ) || 1
        : 1;

    const placed: FamilyMapCandidate[] = [];
    const unplaced: FamilyMapUnplaced[] = [];

    for (const candidateId of ids) {
      const match = matchByCandidate.get(candidateId);
      if (!match) {
        unplaced.push({ candidateId, reason: 'no-match', jobProfileName: null });
        continue;
      }
      const a = assignByJp.get(match.jobProfileId);
      if (!a) {
        unplaced.push({
          candidateId,
          reason: 'not-in-map',
          jobProfileName: match.jobProfileName ?? null,
        });
        continue;
      }
      if (a.x == null || a.y == null) {
        unplaced.push({
          candidateId,
          reason: 'no-coords',
          jobProfileName: match.jobProfileName ?? a.positionName ?? null,
        });
        continue;
      }

      const hasTargetCoords = target?.x != null && target?.y != null;
      const distance = hasTargetCoords ? Math.hypot(a.x - target!.x!, a.y - target!.y!) : null;

      placed.push({
        candidateId,
        jobProfileId: match.jobProfileId,
        jobProfileName: match.jobProfileName ?? a.positionName ?? null,
        divisionDepartment: a.divisionDepartment ?? null,
        candidatePosition: match.candidatePosition ?? null,
        matchType: match.matchType,
        matchSimilarity: match.similarity ?? null,
        topicId: a.topicId,
        topicLabel: labelByTopic.get(a.topicId) ?? null,
        x: a.x,
        y: a.y,
        distance,
        proximity:
          distance == null ? null : Math.max(0, Math.min(100, (1 - distance / diagonal) * 100)),
        sameFamily: target?.topicId == null ? null : a.topicId === target.topicId,
        distanceRank: null,
      });
    }

    // Closest-first rank, so the UI can call out "kandidat terdekat".
    const ranked = placed.filter((c) => c.distance != null).sort((a, b) => a.distance! - b.distance!);
    ranked.forEach((c, i) => {
      c.distanceRank = i + 1;
    });

    return {
      status: 'ok',
      message: null,
      runId: run.id,
      runCompletedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      numTopics: run.numTopics ?? topicRows.filter((t) => t.topicId !== -1).length,
      topics,
      points,
      target,
      candidates: placed,
      unplaced,
    };
  } catch (err) {
    if (isMissingRelation(err)) {
      return empty(
        'schema-missing',
        'Tabel Job Family belum tersedia. Jalankan migrasi drizzle/0031 & drizzle/0037 terlebih dahulu.',
      );
    }
    throw err;
  }
}

/** Employee id → candidate id within a tenant (zero-padded, as elsewhere). */
async function findCandidateIdByEmployeeId(
  employeeId: string,
  tenantId: string,
): Promise<string | null> {
  // LPAD both sides: employee ids arrive with inconsistent leading zeros.
  //
  // Tombstones are PREFERRED AGAINST, not excluded. This resolves the incumbent
  // of an already-finished run's map: returning null for a soft-deleted holder
  // would make resolveJobProfileIdentifier fall through to position/title
  // matching, silently moving target.x/y and rewriting distance / proximity /
  // sameFamily / distanceRank for every finalist of a completed run — the same
  // history-with-holes failure the finalists' own lookup avoids by staying
  // unfiltered above. Requiring a live row also buys nothing:
  // idx_candidates_tenant_employee_id is a TOTAL unique index on
  // (tenant_id, employee_id) that drizzle/0045 keeps total, so a tombstone and a
  // live row cannot share one NPK.
  //
  // Ties are still reachable because LPAD collapses '682' and '0682', which that
  // index treats as distinct rows — hence the ORDER BY the LIMIT 1 was missing:
  // live row first, then the NPK spelled exactly as asked, then id so the pick
  // is deterministic either way.
  const r = await db.execute(sql`
    SELECT id::text AS "id"
    FROM candidates
    WHERE LPAD(employee_id, 5, '0') = LPAD(${employeeId}, 5, '0')
      AND tenant_id = ${tenantId}
    ORDER BY (deleted_at IS NULL) DESC, (employee_id = ${employeeId}) DESC, id
    LIMIT 1
  `);
  const row = (r.rows as Array<{ id: string }>)[0];
  return row?.id ?? null;
}
