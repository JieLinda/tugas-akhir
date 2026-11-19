import 'server-only';

// The corpus the job family map is built from, as one comparable value.
//
// topic-service clusters the rows of `job_profile_embed` that have a vector, in
// job_profile_id order. `readCorpusSnapshot` fingerprints exactly that input
// with the formula topic-service uses (`db.corpus_fingerprint`): md5 over
// "job_profile_id:md5(document):md5(vector text)", rows joined by ",". Both
// sides let Postgres hash each row, so the two values can only differ when the
// input does. A run stores the fingerprint it clustered
// (`diagnostics.corpus`), an optimizer measurement carries the one it measured,
// and comparing either with this one says whether it still describes what is
// embedded now.

import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { vectorDb } from '@/lib/db/vector-db';
import { isSchemaMissing } from '@/lib/job-family/embed';
import type { CorpusSnapshot } from '@/lib/job-family/optimize/freshness';

type SnapshotRow = {
  fingerprint: string | null;
  documents: number | string | null;
  last_embedded_at: Date | string | null;
};

/**
 * Fingerprint, size and newest embed time of the corpus — the whole one, or a
 * tenant's slice when `jobProfileIds` is given (as a tenant-scoped run reads
 * it). Null when the vector table does not exist.
 */
export async function readCorpusSnapshot(
  jobProfileIds: number[] | null = null,
): Promise<CorpusSnapshot | null> {
  if (jobProfileIds && jobProfileIds.length === 0) {
    return { fingerprint: createHash('md5').update('').digest('hex'), documents: 0, lastEmbeddedAt: null };
  }
  const scope = jobProfileIds
    ? sql`AND job_profile_id = ANY(ARRAY[${sql.join(
        jobProfileIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::int[])`
    : sql``;
  try {
    const res = await vectorDb.execute(sql`
      SELECT md5(coalesce(string_agg(
               job_profile_id::text || ':' || md5(coalesce(document, '')) || ':' || md5(embedding::text),
               ',' ORDER BY job_profile_id), '')) AS fingerprint,
             count(*)::int AS documents,
             max(updated_at) AS last_embedded_at
        FROM job_profile_embed
       WHERE embedding IS NOT NULL ${scope}
    `);
    const rows =
      (res as unknown as { rows?: SnapshotRow[] }).rows ?? (res as unknown as SnapshotRow[]);
    const row = rows[0];
    const last = row?.last_embedded_at ?? null;
    return {
      fingerprint: row?.fingerprint ?? createHash('md5').update('').digest('hex'),
      documents: Number(row?.documents ?? 0),
      lastEmbeddedAt: last == null ? null : last instanceof Date ? last.toISOString() : new Date(last).toISOString(),
    };
  } catch (err) {
    if (isSchemaMissing(err)) return null;
    throw err;
  }
}
