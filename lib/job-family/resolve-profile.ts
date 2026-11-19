import 'server-only';

import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { syncJobProfiles } from '@/lib/db/schema';
import { normalizeTitle } from '@/lib/job-family/match';

export type FamilySource = 'family-candidate' | 'family-position';

export type ResolvedJobProfile = {
  jobProfileId: number;
  source: FamilySource | 'title';
  positionName: string | null;
};

/**
 * Job Family pairing lookup (job_family_matches), tried incumbent-candidate
 * first, then linked-position, then a title fallback (exact then substring
 * against sync_job_profiles). Shared by every flow that needs "which job profile
 * does this position/person correspond to": the Position Management "Pilih dari
 * Job Profile" dialog, the Tambah/Edit Posisi form's live auto-suggest (keyed
 * off raw identifiers, since it runs BEFORE the critical_positions row exists),
 * and the run-scoring Job Family map (target position placement).
 *
 * Plain module (not 'use server') so it can be imported by several server-action
 * files without becoming a callable endpoint of its own.
 */
export async function resolveJobProfileIdentifier(input: {
  candidateId?: string | null;
  masterPositionId?: string | null;
  titleFallback?: string | null;
}): Promise<ResolvedJobProfile | null> {
  // 1. Incumbent pairing (candidate → job_family_matches.candidate_id).
  if (input.candidateId) {
    try {
      const r = await db.execute(sql`
        SELECT job_profile_id AS "jobProfileId", job_profile_name AS "jobProfileName"
        FROM job_family_matches
        WHERE candidate_id = ${input.candidateId}
        ORDER BY updated_at DESC NULLS LAST
        LIMIT 1
      `);
      const row = (r.rows as Array<{ jobProfileId: number | null; jobProfileName: string | null }>)[0];
      if (row?.jobProfileId != null) {
        return { jobProfileId: Number(row.jobProfileId), source: 'family-candidate', positionName: row.jobProfileName ?? null };
      }
    } catch {
      /* job_family_matches may not be migrated — fall through */
    }
  }

  // 2. Linked-position pairing (positions.position_id → job_family_matches.position_id).
  if (input.masterPositionId) {
    try {
      const r = await db.execute(sql`
        SELECT jfm.job_profile_id AS "jobProfileId", jfm.job_profile_name AS "jobProfileName"
        FROM positions p
        JOIN job_family_matches jfm ON jfm.position_id = p.position_id
        WHERE p.id = ${input.masterPositionId}
        ORDER BY jfm.updated_at DESC NULLS LAST
        LIMIT 1
      `);
      const row = (r.rows as Array<{ jobProfileId: number | null; jobProfileName: string | null }>)[0];
      if (row?.jobProfileId != null) {
        return { jobProfileId: Number(row.jobProfileId), source: 'family-position', positionName: row.jobProfileName ?? null };
      }
    } catch {
      /* job_family_matches may not be migrated — fall through */
    }
  }

  // 3. Title fallback (exact → substring).
  const title = input.titleFallback?.trim();
  if (!title) return null;

  const profiles = await db
    .select({ id: syncJobProfiles.id, positionName: syncJobProfiles.positionName })
    .from(syncJobProfiles)
    .where(and(eq(syncJobProfiles.status, 'completed'), isNotNull(syncJobProfiles.positionName)));

  const target = normalizeTitle(title);
  const exact = profiles.find((p) => p.positionName && normalizeTitle(p.positionName) === target);
  if (exact) return { jobProfileId: exact.id, source: 'title', positionName: exact.positionName };

  const substring = profiles
    .filter((p) => {
      if (!p.positionName) return false;
      const n = normalizeTitle(p.positionName);
      return n.includes(target) || target.includes(n);
    })
    .sort((a, b) => (b.positionName?.length ?? 0) - (a.positionName?.length ?? 0))[0];
  if (substring) return { jobProfileId: substring.id, source: 'title', positionName: substring.positionName };

  return null;
}
