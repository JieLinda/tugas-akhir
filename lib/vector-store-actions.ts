'use server';

// Vector-store dispatcher for the Job Family Configuration section.
// Reports pgvector readiness and collection counts. Embedding itself runs from
// the batched Transformasi panels (lib/job-family-actions.ts, lib/kamus-embed-actions.ts).

import { sql } from 'drizzle-orm';
import { vectorDb, ensureVectorDbSchema } from '@/lib/db/vector-db';
import { jobProfileEmbed, kamusKompetensiEmbed } from '@/lib/db/vector-schema';
import { requirePermission } from '@/lib/rbac';
import { isSchemaMissing, isVectorDbUnreachable } from '@/lib/job-family/embed';
import { getJobFamilyConfig } from '@/lib/job-family-actions';

export type VectorStoreStatus = {
  pgvector: {
    /** Fully usable: pgvector table present (every embedding source has a default). */
    ready: boolean;
    /** pgvector extension + *_embed tables present. */
    extensionReady: boolean;
    /** The currently-selected embedding source has explicit env config (informational only). */
    serviceConfigured: boolean;
    embeddingModel: string | null;
    jobProfilesCount: number;
    kamusCount: number;
    error?: string;
  };
};

const PG_MIGRATION_MSG =
  'Ekstensi pgvector belum aktif — pastikan container vector-db berjalan.';
/** Distinct from PG_MIGRATION_MSG: here we never even reached the database, so
 *  pointing the user at a migration would send them down the wrong path. */
const PG_UNREACHABLE_MSG =
  'Database vector tidak dapat dihubungi — periksa VECTOR_DATABASE_URL dan pastikan instance pgvector berjalan.';

// ── Status ────────────────────────────────────────────────────────

async function getPgvectorStatus(): Promise<VectorStoreStatus['pgvector']> {
  // embedViaService always has a working default per source, so this just
  // flags whether the currently-selected source has explicit env config.
  const config = await getJobFamilyConfig();
  const serviceConfigured =
    config.embedding.source === 'multilingual'
      ? Boolean(process.env.SCORING_SERVICE_URL)
      : config.embedding.source === 'nomic-remote'
        ? Boolean(process.env.EMBEDDING_API_BASE_REMOTE)
        : Boolean(process.env.EMBEDDING_API_BASE || process.env.LLM_BASE_URL);
  try {
    await ensureVectorDbSchema();
    const [jp] = await vectorDb
      .select({
        count: sql<number>`count(*)::int`,
        model: sql<string | null>`max(${jobProfileEmbed.embeddingModel})`,
      })
      .from(jobProfileEmbed);

    let kamusCount = 0;
    try {
      const [kk] = await vectorDb
        .select({ count: sql<number>`count(*)::int` })
        .from(kamusKompetensiEmbed);
      kamusCount = kk?.count ?? 0;
    } catch (err) {
      if (!isSchemaMissing(err)) throw err;
    }

    return {
      ready: true,
      extensionReady: true,
      serviceConfigured,
      embeddingModel: jp?.model ?? config.embedding.model ?? null,
      jobProfilesCount: jp?.count ?? 0,
      kamusCount,
    };
  } catch (err) {
    const unreachable = isVectorDbUnreachable(err);
    if (isSchemaMissing(err) || unreachable) {
      return {
        ready: false,
        extensionReady: false,
        serviceConfigured,
        embeddingModel: null,
        jobProfilesCount: 0,
        kamusCount: 0,
        error: unreachable ? PG_UNREACHABLE_MSG : PG_MIGRATION_MSG,
      };
    }
    throw err;
  }
}

/** Vector-store readiness + counts for pgvector. */
export async function getVectorStoreStatusAction(): Promise<VectorStoreStatus> {
  await requirePermission('job_profiles.view');
  const pgvector = await getPgvectorStatus();
  return { pgvector };
}
