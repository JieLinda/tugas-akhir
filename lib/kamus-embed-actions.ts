'use server';

// Server actions to embed the competency dictionary (sync_kamus_kompetensi)
// into pgvector (kamus_kompetensi_embed), with client-orchestrated batches so
// the Kamus Kompetensi page can render a live progress bar. Mirrors the
// job-profile rebuild flow (lib/job-family-actions.ts) but keyed by competency
// `code` and sourced from the kamus rows rather than restructured job profiles.
//
// Uses the same DOCUMENT-embedding model as job-family (embedViaService →
// OpenAI-compatible embedding API, e.g. Ollama). Everything that touches
// kamus_kompetensi_embed degrades gracefully when the pgvector extension /
// table (migration 0034) isn't present yet — callers get a clear flag instead
// of a 500.

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { vectorDb, ensureVectorDbSchema } from '@/lib/db/vector-db';
import { syncKamusKompetensi } from '@/lib/db/schema';
import { kamusKompetensiEmbed, kamusKompetensiLevelEmbed } from '@/lib/db/vector-schema';
import { requirePermission } from '@/lib/rbac';
import {
  embedViaService,
  hashContent,
  kamusDocument,
  kamusLevelDocuments,
  assertVectorDimensions,
  isSchemaMissing,
  isVectorDbUnreachable,
} from '@/lib/job-family/embed';
import type { EmbeddingSource } from '@/lib/job-family/config';
import { getJobFamilyConfig } from '@/lib/job-family-actions';

const PGVECTOR_MSG =
  'Tabel kamus_kompetensi_embed belum tersedia — jalankan migrasi drizzle/0034_kamus_kompetensi_embed.sql (butuh ekstensi pgvector).';
/** Distinct from PGVECTOR_MSG: the connection itself never succeeded, so
 *  telling the user to run a migration would send them down the wrong path. */
const PG_UNREACHABLE_MSG =
  'Database vector tidak dapat dihubungi — periksa VECTOR_DATABASE_URL dan pastikan instance pgvector berjalan.';

// ── Status ─────────────────────────────────────────────────────────

export type KamusEmbedStatus = {
  /** Fully usable: pgvector table present (embedding API always has a default). */
  ready: boolean;
  /** pgvector extension + kamus_kompetensi_embed table present. */
  extensionReady: boolean;
  /** The currently-selected embedding source has explicit env config (informational only — a default is always used otherwise). */
  serviceConfigured: boolean;
  /** Rows in sync_kamus_kompetensi (candidates to embed). */
  total: number;
  /** Rows already embedded in kamus_kompetensi_embed. */
  embedded: number;
  embeddingModel: string | null;
  error?: string;
};

/** Readiness + counts for the kamus-kompetensi pgvector store. */
export async function getKamusEmbedStatusAction(): Promise<KamusEmbedStatus> {
  await requirePermission('job_profiles.view');
  // embedViaService always has a working default per source, so this just
  // flags whether the currently-selected source has explicit env config.
  const config = await getJobFamilyConfig();
  const serviceConfigured =
    config.embedding.source === 'multilingual'
      ? Boolean(process.env.SCORING_SERVICE_URL)
      : config.embedding.source === 'nomic-remote'
        ? Boolean(process.env.EMBEDDING_API_BASE_REMOTE)
        : Boolean(process.env.EMBEDDING_API_BASE);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(syncKamusKompetensi);
  const total = totalRow?.count ?? 0;

  try {
    await ensureVectorDbSchema();
    const [row] = await vectorDb
      .select({
        count: sql<number>`count(*)::int`,
        model: sql<string | null>`max(${kamusKompetensiEmbed.embeddingModel})`,
      })
      .from(kamusKompetensiEmbed);
    return {
      ready: true,
      extensionReady: true,
      serviceConfigured,
      total,
      embedded: row?.count ?? 0,
      embeddingModel: row?.model ?? null,
    };
  } catch (err) {
    const unreachable = isVectorDbUnreachable(err);
    if (isSchemaMissing(err) || unreachable) {
      return {
        ready: false,
        extensionReady: false,
        serviceConfigured,
        total,
        embedded: 0,
        embeddingModel: null,
        error: unreachable ? PG_UNREACHABLE_MSG : PGVECTOR_MSG,
      };
    }
    throw err;
  }
}

// ── Batched embed with live progress (client-orchestrated) ─────────
//
// A plan (build documents + diff stored hashes, held server-side) plus one
// action per batch, so the client can drive a progress bar and surface the
// *actual* embedding error instead of a bare "gagal" count. Sessions live
// in-process (this is a long-lived Next server) and are pruned after 30 minutes.

type KamusLevelDoc = { level: number; document: string; hash: string };
type KamusEmbedItem = {
  code: string;
  name: string;
  document: string;
  hash: string;
  /** Cumulative level documents (levels 1..4) for kamus_kompetensi_level_embed. */
  levelDocs: KamusLevelDoc[];
};

type KamusEmbedSession = {
  batches: KamusEmbedItem[][];
  model: string;
  source: EmbeddingSource;
  /** Target vector dimension the collection was ensured at. */
  dimensions: number;
  total: number;
  skipped: number;
  embedded: number;
  failed: number;
  createdAt: number;
};

const sessions = new Map<string, KamusEmbedSession>();

function pruneSessions() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [key, s] of sessions) if (s.createdAt < cutoff) sessions.delete(key);
}

function finalMessage(session: KamusEmbedSession): string {
  return session.failed === 0
    ? `Berhasil: ${session.embedded} kompetensi di-embed, ${session.skipped} dilewati (tidak berubah).`
    : `Selesai dengan ${session.failed} gagal: ${session.embedded} di-embed, ${session.skipped} dilewati.`;
}

export type KamusEmbedPlan = {
  ok: boolean;
  pgvectorReady: boolean;
  sessionId: string | null;
  total: number;
  toEmbed: number;
  skipped: number;
  batchCount: number;
  batchSize: number;
  message: string;
};

/**
 * Plan an embed run: build one document per competency, diff against stored
 * content hashes, and stash the batches to embed in a server-side session.
 * Returns counts + a sessionId the client feeds to processKamusEmbedBatchAction.
 */
export async function startKamusEmbedAction(): Promise<KamusEmbedPlan> {
  await requirePermission('job_profiles.manage');
  pruneSessions();

  const config = await getJobFamilyConfig();
  const model = config.embedding.model;
  const source = config.embedding.source;
  const batchSize = Math.max(1, Math.min(256, config.embedding.batchSize || 32));
  const dimensions = config.embedding.dimensions > 0 ? Math.floor(config.embedding.dimensions) : 768;

  const rows = await db
    .select({
      code: syncKamusKompetensi.code,
      name: syncKamusKompetensi.name,
      description: syncKamusKompetensi.description,
      levelBasic: syncKamusKompetensi.levelBasic,
      levelIntermediate: syncKamusKompetensi.levelIntermediate,
      levelAdvance: syncKamusKompetensi.levelAdvance,
      levelMastery: syncKamusKompetensi.levelMastery,
    })
    .from(syncKamusKompetensi);

  const prepared: KamusEmbedItem[] = rows
    .filter((r) => r.code && r.name)
    .map((r) => {
      const document = kamusDocument(r);
      const levelDocs = kamusLevelDocuments(r).map((d) => ({
        level: d.level,
        document: d.document,
        hash: hashContent(d.document, model),
      }));
      return { code: r.code, name: r.name, document, hash: hashContent(document, model), levelDocs };
    })
    .filter((p) => p.document.length > 0);

  // Existing hashes so unchanged competencies are skipped. A competency is only
  // skipped when BOTH its full-document embedding AND all four per-level
  // embeddings are present and unchanged — so an existing deployment (full docs
  // already embedded, level table empty) still re-embeds once to backfill the
  // new kamus_kompetensi_level_embed rows.
  let existingFull = new Map<string, string | null>();
  let existingLevel = new Map<string, string | null>();
  let recreated = false;
  try {
    const ensured = await ensureVectorDbSchema(dimensions);
    recreated = ensured.recreated;
    const ex = await vectorDb
      .select({ code: kamusKompetensiEmbed.code, contentHash: kamusKompetensiEmbed.contentHash })
      .from(kamusKompetensiEmbed);
    existingFull = new Map(ex.map((r) => [r.code, r.contentHash]));
    const exLevel = await vectorDb
      .select({
        code: kamusKompetensiLevelEmbed.code,
        level: kamusKompetensiLevelEmbed.level,
        contentHash: kamusKompetensiLevelEmbed.contentHash,
      })
      .from(kamusKompetensiLevelEmbed);
    existingLevel = new Map(exLevel.map((r) => [`${r.code}:${r.level}`, r.contentHash]));
  } catch (err) {
    if (isSchemaMissing(err)) {
      return {
        ok: false,
        pgvectorReady: false,
        sessionId: null,
        total: rows.length,
        toEmbed: 0,
        skipped: 0,
        batchCount: 0,
        batchSize,
        message: PGVECTOR_MSG,
      };
    }
    throw err;
  }

  const toEmbed = prepared.filter((p) => {
    if (existingFull.get(p.code) !== p.hash) return true;
    return p.levelDocs.some((d) => existingLevel.get(`${p.code}:${d.level}`) !== d.hash);
  });
  const skipped = rows.length - toEmbed.length;

  const batches: KamusEmbedItem[][] = [];
  for (let i = 0; i < toEmbed.length; i += batchSize) batches.push(toEmbed.slice(i, i + batchSize));

  const sessionId = randomUUID();
  sessions.set(sessionId, {
    batches,
    model,
    source,
    dimensions,
    total: rows.length,
    skipped,
    embedded: 0,
    failed: 0,
    createdAt: Date.now(),
  });

  return {
    ok: true,
    pgvectorReady: true,
    sessionId,
    total: rows.length,
    toEmbed: toEmbed.length,
    skipped,
    batchCount: batches.length,
    batchSize,
    message:
      (recreated ? `Koleksi vektor dibuat ulang pada ${dimensions} dimensi. ` : '') +
      (toEmbed.length === 0
        ? `Semua ${rows.length} kompetensi sudah terkini — tidak ada yang perlu di-embed (${skipped} dilewati).`
        : `Siap meng-embed ${toEmbed.length} kompetensi dalam ${batches.length} batch (${skipped} dilewati).`),
  };
}

export type KamusEmbedBatchProgress = {
  ok: boolean;
  done: boolean;
  pgvectorReady: boolean;
  batchIndex: number;
  batchCount: number;
  embedded: number;
  skipped: number;
  failed: number;
  total: number;
  error: string | null;
  message: string;
};

/**
 * Embed + upsert one batch of a planned run into kamus_kompetensi_embed. On a
 * batch failure the actual error message is returned (not swallowed) so the
 * client can show the cause.
 */
export async function processKamusEmbedBatchAction(
  sessionId: string,
  batchIndex: number,
): Promise<KamusEmbedBatchProgress> {
  await requirePermission('job_profiles.manage');

  const session = sessions.get(sessionId);
  if (!session) {
    return {
      ok: false,
      done: true,
      pgvectorReady: true,
      batchIndex,
      batchCount: 0,
      embedded: 0,
      skipped: 0,
      failed: 0,
      total: 0,
      error: 'Sesi embedding kedaluwarsa atau tidak ditemukan. Mulai ulang.',
      message: 'Sesi embedding tidak ditemukan.',
    };
  }

  const batch = session.batches[batchIndex];
  const batchCount = session.batches.length;

  // Out-of-range index → treat as a no-op completion.
  if (!batch) {
    sessions.delete(sessionId);
    return {
      ok: session.failed === 0,
      done: true,
      pgvectorReady: true,
      batchIndex,
      batchCount,
      embedded: session.embedded,
      skipped: session.skipped,
      failed: session.failed,
      total: session.total,
      error: null,
      message: finalMessage(session),
    };
  }

  let error: string | null = null;
  try {
    // One embed call per batch covers every text: each competency contributes
    // its full document plus its 4 cumulative level documents. Flatten, embed,
    // then slice the vectors back out per competency.
    const texts: string[] = [];
    for (const b of batch) {
      texts.push(b.document);
      for (const d of b.levelDocs) texts.push(d.document);
    }
    const vectors = await embedViaService(texts, session.model, session.source);
    assertVectorDimensions(vectors, session.dimensions, session.model);

    let cursor = 0;
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]!;
      const fullVector = vectors[cursor++]!;
      await vectorDb
        .insert(kamusKompetensiEmbed)
        .values({
          code: b.code,
          name: b.name,
          document: b.document,
          embedding: fullVector,
          embeddingModel: session.model,
          contentHash: b.hash,
        })
        .onConflictDoUpdate({
          target: kamusKompetensiEmbed.code,
          set: {
            name: b.name,
            document: b.document,
            embedding: fullVector,
            embeddingModel: session.model,
            contentHash: b.hash,
            updatedAt: new Date(),
          },
        });

      for (const d of b.levelDocs) {
        const levelVector = vectors[cursor++]!;
        await vectorDb
          .insert(kamusKompetensiLevelEmbed)
          .values({
            code: b.code,
            name: b.name,
            level: d.level,
            document: d.document,
            embedding: levelVector,
            embeddingModel: session.model,
            contentHash: d.hash,
          })
          .onConflictDoUpdate({
            target: [kamusKompetensiLevelEmbed.code, kamusKompetensiLevelEmbed.level],
            set: {
              name: b.name,
              document: d.document,
              embedding: levelVector,
              embeddingModel: session.model,
              contentHash: d.hash,
              updatedAt: new Date(),
            },
          });
      }
      session.embedded += 1;
    }
  } catch (err) {
    if (isSchemaMissing(err)) {
      sessions.delete(sessionId);
      return {
        ok: false,
        done: true,
        pgvectorReady: false,
        batchIndex,
        batchCount,
        embedded: session.embedded,
        skipped: session.skipped,
        failed: session.failed,
        total: session.total,
        error: PGVECTOR_MSG,
        message: PGVECTOR_MSG,
      };
    }
    session.failed += batch.length;
    error = err instanceof Error ? err.message : String(err);
  }

  const done = batchIndex >= batchCount - 1;
  if (done) {
    sessions.delete(sessionId);
    revalidatePath('/job-profiles/kamus');
  }

  // A finished re-embed changes the corpus the technical similarity anchors are
  // derived from, so ask the scoring service to recalibrate now. Best-effort:
  // the anchors carry a corpus fingerprint and a scoring run recomputes them by
  // itself when it sees a mismatch, so this only makes the refresh immediate.
  if (done && error === null) await refreshTechnicalAnchors();

  return {
    ok: error === null,
    done,
    pgvectorReady: true,
    batchIndex,
    batchCount,
    embedded: session.embedded,
    skipped: session.skipped,
    failed: session.failed,
    total: session.total,
    error,
    message: done
      ? finalMessage(session)
      : error
        ? `Batch ${batchIndex + 1}/${batchCount} gagal: ${error}`
        : `Batch ${batchIndex + 1}/${batchCount} selesai — ${session.embedded} di-embed.`,
  };
}

/**
 * Nudge scoring-service to recalibrate the technical similarity anchors after a
 * kamus re-embed. Deliberately silent on failure — correctness does not depend
 * on it (the fingerprint check in the engine is what guarantees freshness), and
 * an embed run must not report failure because a scoring service was down.
 */
async function refreshTechnicalAnchors(): Promise<void> {
  const url = process.env.SCORING_SERVICE_URL;
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    await fetch(`${url.replace(/\/+$/, '')}/api/embed/technical-anchors/refresh`, {
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    // Ignored on purpose — see above.
  } finally {
    clearTimeout(timeout);
  }
}

/** Discard a planned embed session (e.g. the client aborted after an error). */
export async function cancelKamusEmbedAction(sessionId: string): Promise<void> {
  await requirePermission('job_profiles.manage');
  sessions.delete(sessionId);
}
