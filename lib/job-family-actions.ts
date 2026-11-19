'use server';

// Server actions for Job Family Discovery:
//  • config read, and one save action per part (global template, one profile's
//    template, BERTopic parameters, embedding settings) — see saveConfigPart
//  • restructure preview
//  • rebuild: restructure every completed job profile, embed via scoring-service,
//    upsert into job_profile_embed, and drop vectors whose source document is gone
//  • stats + document listing for the Family Tree page
//
// Everything that touches job_profile_embed degrades gracefully when the
// pgvector extension / table isn't present yet (the migration can't run until
// pgvector is installed on the Postgres server) — callers get a clear flag
// instead of a 500.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { vectorDb, ensureVectorDbSchema, getVectorColumnDimension } from '@/lib/db/vector-db';
import { syncJobProfiles, jobFamilyTopicConfigs } from '@/lib/db/schema';
import { jobProfileEmbed } from '@/lib/db/vector-schema';
import { requirePermission } from '@/lib/rbac';
import {
  restructureJobProfile,
  type ExtractedJobProfileData,
} from '@/lib/job-family/restructure';
import {
  normalizeJobFamilyConfig,
  sanitizeBertopicPatch,
  sanitizeEmbeddingPatch,
  type BertopicConfig,
  type EmbeddingSource,
  type JobFamilyConfig,
} from '@/lib/job-family/config';
import { hasSectionToken } from '@/lib/job-family/template-editor';
import { configKey } from '@/lib/job-family/optimize/measured';
import {
  embedViaService,
  hashContent,
  hashExtracted,
  assertVectorDimensions,
  isSchemaMissing,
  isVectorDbUnreachable,
} from '@/lib/job-family/embed';
import { getCurrentTenantId } from '@/lib/tenant';
import { jobProfileVisibleTo, visibleJobProfileIds } from '@/lib/job-profile-tenant-scope';
import { demoMaskJobProfile } from '@/lib/demo/content';

const CONFIG_PATH = join(process.cwd(), 'lib', 'job-family-config.json');

// ── Config ────────────────────────────────────────────────────────

/** A stored config in today's exact shape (see normalizeJobFamilyConfig). */
function mergeConfig(parsed: Partial<JobFamilyConfig> | null | undefined): JobFamilyConfig {
  return normalizeJobFamilyConfig(parsed);
}

/**
 * The restructure template to use for one profile: its per-profile override when
 * present and non-empty, otherwise the global template. Used everywhere a
 * document is built for embedding so preview / single-embed / global rebuild all
 * agree on a profile's content.
 */
function templateForProfile(config: JobFamilyConfig, jobProfileId: number): string {
  const override = config.restructureOverrides?.[String(jobProfileId)];
  return override && override.trim() ? override : config.restructureTemplate;
}

function configHash(config: JobFamilyConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

/** True when the error means job_family_topic_configs isn't present (migration 0038). */
function isConfigTableMissing(err: unknown): boolean {
  let cur: unknown = err;
  const parts: string[] = [];
  for (let depth = 0; cur && depth < 5; depth++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? (cur.cause as unknown) : undefined;
  }
  return /relation "?job_family_topic_configs"?\s+does not exist/i.test(parts.join('\n'));
}

async function readConfigFile(): Promise<Partial<JobFamilyConfig> | null> {
  try {
    return JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) as Partial<JobFamilyConfig>;
  } catch {
    return null;
  }
}

/** The active config params from DB, or null if the table is absent / no active row. */
async function readActiveConfigParams(): Promise<Partial<JobFamilyConfig> | null> {
  try {
    const [row] = await db
      .select({ params: jobFamilyTopicConfigs.params })
      .from(jobFamilyTopicConfigs)
      .where(eq(jobFamilyTopicConfigs.isActive, true))
      .orderBy(desc(jobFamilyTopicConfigs.createdAt))
      .limit(1);
    return row ? ((row.params as Partial<JobFamilyConfig>) ?? null) : null;
  } catch (err) {
    if (isConfigTableMissing(err)) return null;
    throw err;
  }
}

/**
 * Active config: DB (job_family_topic_configs) is the source of truth; falls back
 * to the legacy JSON file, then defaults. Always merged over defaults so new
 * fields appear even for older stored configs.
 */
export async function getJobFamilyConfig(): Promise<JobFamilyConfig> {
  await requirePermission('job_profiles.view');
  const dbParams = await readActiveConfigParams();
  if (dbParams) return mergeConfig(dbParams);
  return mergeConfig(await readConfigFile());
}

// One lock for every write of the ACTIVE config. A save is read-modify-write
// (read the version in force, replace one part, insert the result as the new
// active version), and two saves of different parts racing without it would
// both start from the same version, so the second would quietly put back the
// part the first had just changed.
const CONFIG_WRITE_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('job_family_topic_configs'))`;

type ConfigTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Make `merged` the active version, reusing the active row when identical. Caller holds the lock. */
async function activateConfigVersion(tx: ConfigTx, merged: JobFamilyConfig): Promise<string | null> {
  const hash = configHash(merged);
  const [active] = await tx
    .select({ id: jobFamilyTopicConfigs.id, contentHash: jobFamilyTopicConfigs.contentHash })
    .from(jobFamilyTopicConfigs)
    .where(eq(jobFamilyTopicConfigs.isActive, true))
    .orderBy(desc(jobFamilyTopicConfigs.createdAt))
    .limit(1);
  if (active && active.contentHash === hash) return active.id;

  await tx
    .update(jobFamilyTopicConfigs)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(jobFamilyTopicConfigs.isActive, true));
  const [ins] = await tx
    .insert(jobFamilyTopicConfigs)
    .values({ name: 'active', params: merged, contentHash: hash, isActive: true })
    .returning({ id: jobFamilyTopicConfigs.id });
  return ins?.id ?? null;
}

/**
 * Ensure a DB config VERSION exists matching `config` and return its id (used by
 * a run to record which version it executed with). Versioned: if the active
 * row's hash differs, insert a new active row and deactivate the previous one.
 * Returns null when the table is absent (pre-0038) so callers can degrade.
 */
export async function ensureActiveConfigVersionId(config: JobFamilyConfig): Promise<string | null> {
  // May insert a new active config row and deactivate the previous one — a
  // write, so it takes .manage like its caller (startTopicRunAction).
  await requirePermission('job_profiles.manage');
  const merged = mergeConfig(config);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(CONFIG_WRITE_LOCK);
      return activateConfigVersion(tx, merged);
    });
  } catch (err) {
    if (isConfigTableMissing(err)) return null;
    throw err;
  }
}

/**
 * Simpan sebuah config sebagai VERSI TANPA mengaktifkannya — untuk run
 * percobaan (sandbox) Agent Studio yang memakai parameter berbeda dari config
 * aktif. Run tetap tercatat menunjuk versi yang benar-benar dipakainya, tetapi
 * pengguna lain dan run berikutnya tidak terpengaruh sama sekali.
 *
 * Dibedakan dari ensureActiveConfigVersionId dengan sengaja: fungsi itu
 * MENGAKTIFKAN versi baru (menonaktifkan yang lama), dan memakainya untuk run
 * percobaan berarti setiap eksperimen diam-diam mengganti konfigurasi semua
 * orang — persis yang ingin dicegah sandbox.
 */
export async function ensureSandboxConfigVersionId(
  config: JobFamilyConfig,
): Promise<string | null> {
  await requirePermission('job_profiles.manage');
  const merged = mergeConfig(config);
  const hash = configHash(merged);
  try {
    // Versi identik (aktif maupun tidak) dipakai ulang — run percobaan yang
    // sama dua kali tidak perlu dua baris.
    const [existing] = await db
      .select({ id: jobFamilyTopicConfigs.id })
      .from(jobFamilyTopicConfigs)
      .where(eq(jobFamilyTopicConfigs.contentHash, hash))
      .limit(1);
    if (existing) return existing.id;

    const [ins] = await db
      .insert(jobFamilyTopicConfigs)
      .values({ name: 'sandbox', params: merged, contentHash: hash, isActive: false })
      .returning({ id: jobFamilyTopicConfigs.id });
    return ins?.id ?? null;
  } catch (err) {
    if (isConfigTableMissing(err)) return null;
    throw err;
  }
}

/**
 * Save ONE part of the config: read the version in force, let `change` replace
 * its part, and make the result the new active version. Callers check
 * permission first.
 *
 * Each control on the settings pages owns exactly one part: the global
 * template, one profile's template, the BERTopic parameters, or the embedding
 * settings. They used to send the whole config object instead, so every save
 * also wrote every OTHER part as it stood in that browser tab. Unsaved edits
 * from another section went live with it, and a page loaded before somebody
 * else's save put their change back. Reading the current version here, under
 * the write lock, is what limits a save to the part it names.
 */
async function saveConfigPart(
  change: (current: JobFamilyConfig) => JobFamilyConfig,
): Promise<JobFamilyConfig> {
  let saved: JobFamilyConfig;
  try {
    saved = await db.transaction(async (tx) => {
      await tx.execute(CONFIG_WRITE_LOCK);
      const [row] = await tx
        .select({ params: jobFamilyTopicConfigs.params })
        .from(jobFamilyTopicConfigs)
        .where(eq(jobFamilyTopicConfigs.isActive, true))
        .orderBy(desc(jobFamilyTopicConfigs.createdAt))
        .limit(1);
      const current = mergeConfig(
        row ? (row.params as Partial<JobFamilyConfig>) : await readConfigFile(),
      );
      const next = mergeConfig(change(current));
      await activateConfigVersion(tx, next);
      return next;
    });
  } catch (err) {
    if (!isConfigTableMissing(err)) throw err;
    // Before drizzle/0038 the JSON file is the only store.
    saved = mergeConfig(change(mergeConfig(await readConfigFile())));
    await writeFile(CONFIG_PATH, JSON.stringify(saved, null, 2), 'utf-8');
  }
  revalidatePath('/posisi/job-family');
  return saved;
}

/** A template that names no section would restructure every profile into nothing. */
function assertHasSection(template: string, what: string): void {
  if (!hasSectionToken(template)) {
    throw new Error(
      `${what} harus memuat minimal satu token bagian, misalnya {{positionName}}.`,
    );
  }
}

/** Save the global restructure template. Nothing else in the config is touched. */
export async function saveRestructureTemplateAction(template: string): Promise<JobFamilyConfig> {
  await requirePermission('job_profiles.manage');
  if (typeof template !== 'string') throw new Error('Template tidak valid.');
  assertHasSection(template, 'Template global');
  return saveConfigPart((c) => ({ ...c, restructureTemplate: template }));
}

/**
 * Save ONE profile's own template, or remove it (`template` null or blank) so
 * the profile follows the global template again. Other profiles' templates and
 * every other part of the config are untouched.
 */
export async function saveRestructureOverrideAction(
  jobProfileId: number,
  template: string | null,
): Promise<JobFamilyConfig> {
  await requirePermission('job_profiles.manage');
  if (!Number.isInteger(jobProfileId) || jobProfileId <= 0) {
    throw new Error('Job profile tidak valid.');
  }
  const text = typeof template === 'string' && template.trim() ? template : null;
  if (text !== null) assertHasSection(text, 'Template khusus');
  const key = String(jobProfileId);
  return saveConfigPart((c) => {
    const overrides = { ...c.restructureOverrides };
    if (text === null) delete overrides[key];
    else overrides[key] = text;
    return { ...c, restructureOverrides: overrides };
  });
}

/**
 * Save BERTopic parameters: the keys in `patch` replace the saved values, keys
 * not in it keep theirs. The settings card sends every key, the optimizer the
 * whole setting it measured. A key that is unknown or of the wrong type refuses
 * the whole save rather than storing the rest.
 *
 * `expectBertopic` refuses the save unless the parameters in force are exactly
 * these, checked under the write lock. The optimizer passes the setting its
 * measurement started from: applying a measured change on top of parameters
 * somebody changed since would store a combination nobody measured.
 */
export async function saveBertopicConfigAction(
  patch: Record<string, unknown>,
  opts?: { expectBertopic?: Partial<BertopicConfig> },
): Promise<JobFamilyConfig> {
  await requirePermission('job_profiles.manage');
  const { clean, ignored } = sanitizeBertopicPatch(patch);
  if (ignored.length) throw new Error(`Parameter tidak valid: ${ignored.join(', ')}.`);
  const expected = opts?.expectBertopic ? configKey(opts.expectBertopic) : null;
  return saveConfigPart((c) => {
    if (expected !== null && configKey(c.bertopic) !== expected) {
      throw new Error(
        'Parameter BERTopic sudah diubah sejak pengukuran dimulai. Ukur ulang agar hasilnya ' +
          'sesuai pengaturan yang berlaku sekarang.',
      );
    }
    return { ...c, bertopic: { ...c.bertopic, ...clean } };
  });
}

/** Save the embedding settings (Settings → Sinkronisasi, embedding tab). Same contract as the BERTopic save. */
export async function saveEmbeddingConfigAction(
  patch: Record<string, unknown>,
): Promise<JobFamilyConfig> {
  await requirePermission('job_profiles.manage');
  const { clean, ignored } = sanitizeEmbeddingPatch(patch);
  if (ignored.length) throw new Error(`Pengaturan embedding tidak valid: ${ignored.join(', ')}.`);
  return saveConfigPart((c) => ({ ...c, embedding: { ...c.embedding, ...clean } }));
}

// ── Available embedding models (the 3 configured sources) ─────────

export type EmbeddingModelOption = {
  source: EmbeddingSource;
  name: string;
  label: string;
  /** False when the source's required env config looks absent — offered anyway, but flagged. */
  configured: boolean;
};

/**
 * The 3 embedding sources embedViaService can produce vectors from, for the
 * Job Family Configuration model dropdown. "multilingual" is only listed when
 * scoring-service actually reports a primary model (it needs a live round-trip
 * since that model isn't reachable via env alone); the two Nomic sources are
 * always listed since they only need env vars to resolve their model name.
 */
export async function getEmbeddingModelsAction(): Promise<EmbeddingModelOption[]> {
  await requirePermission('job_profiles.view');
  const options: EmbeddingModelOption[] = [];

  const scoringBase = process.env.SCORING_SERVICE_URL;
  if (scoringBase) {
    try {
      const res = await fetch(`${scoringBase.replace(/\/$/, '')}/api/embed/models`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          models?: { name: string; role: 'primary' | 'document' }[];
        };
        const primary = data.models?.find((m) => m.role === 'primary');
        if (primary) {
          options.push({
            source: 'multilingual',
            name: primary.name,
            label: `Multilingual E5 — ${primary.name}`,
            configured: true,
          });
        }
      }
    } catch {
      // scoring-service unreachable — skip this option, the other two still work.
    }
  }

  options.push({
    source: 'nomic-remote',
    name: process.env.EMBEDDING_MODEL || 'ollama/nomic-embed-text-v2-moe:latest',
    label: 'Nomic — API server (eksternal)',
    configured: Boolean(process.env.EMBEDDING_MODEL),
  });

  return options;
}

// ── pgvector availability ─────────────────────────────────────────

const PGVECTOR_MSG =
  'Ekstensi pgvector / tabel job_profile_embed belum tersedia. Install pgvector di server PostgreSQL lalu jalankan migrasi drizzle/0031_job_family_embeddings.sql.';

// ── Restructure preview ───────────────────────────────────────────

export type RestructurePreview = {
  jobProfileId: number;
  positionName: string | null;
  document: string;
};

/**
 * Restructure one completed job profile (the given id, or the first available)
 * with the current or a supplied template — powers the Configuration live
 * preview.
 */
export async function previewRestructureAction(input?: {
  jobProfileId?: number;
  template?: string;
}): Promise<RestructurePreview | null> {
  await requirePermission('job_profiles.view');
  const template = input?.template ?? (await getJobFamilyConfig()).restructureTemplate;
  const tenantId = await getCurrentTenantId();

  // The implicit "first completed profile" must come from this tenant's own
  // documents, or the preview shows another business unit's job description.
  const rows = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(
      input?.jobProfileId
        ? and(eq(syncJobProfiles.id, input.jobProfileId), jobProfileVisibleTo(tenantId))
        : and(
            eq(syncJobProfiles.status, 'completed'),
            isNotNull(syncJobProfiles.extractedData),
            jobProfileVisibleTo(tenantId),
          ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    jobProfileId: row.id,
    positionName: row.positionName,
    document: restructureJobProfile(
      row.extractedData as ExtractedJobProfileData | null,
      template,
    ),
  };
}

// ── Job profile selector + live-preview sample ────────────────────

export type JobProfileOption = {
  id: number;
  positionName: string | null;
  divisionDepartment: string | null;
};

/** Lightweight list of restructurable profiles (completed + extracted) for the
 *  Configuration "job profile spesifik" selector. Excludes extractedData.
 *  Tenant-scoped: the selector should only offer documents this business unit
 *  actually owns. */
export async function listJobProfileOptionsAction(): Promise<JobProfileOption[]> {
  await requirePermission('job_profiles.view');
  const tenantId = await getCurrentTenantId();
  return db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
    })
    .from(syncJobProfiles)
    .where(
      and(
        eq(syncJobProfiles.status, 'completed'),
        isNotNull(syncJobProfiles.extractedData),
        jobProfileVisibleTo(tenantId),
      ),
    )
    .orderBy(syncJobProfiles.positionName);
}

export type RestructureSample = {
  id: number;
  positionName: string | null;
  divisionDepartment: string | null;
  extractedData: ExtractedJobProfileData | null;
};

/**
 * Raw extracted data for one profile (the given id, or the first completed one),
 * so the Configuration editor can render the restructure preview live on the
 * client as the template is edited — no server round-trip per keystroke.
 */
// Demo mode: the preview shows the same named sections as the job profile view, three words per point. Preview only — the template holds structure, and the corpus rebuild reads the database itself.
export async function getRestructureSampleAction(
  ...args: Parameters<typeof getRestructureSampleActionImpl>
): ReturnType<typeof getRestructureSampleActionImpl> {
  return demoMaskJobProfile(await getRestructureSampleActionImpl(...args));
}

async function getRestructureSampleActionImpl(
  jobProfileId?: number,
): Promise<RestructureSample | null> {
  await requirePermission('job_profiles.view');
  const tenantId = await getCurrentTenantId();
  const rows = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(
      jobProfileId
        ? and(eq(syncJobProfiles.id, jobProfileId), jobProfileVisibleTo(tenantId))
        : and(
            eq(syncJobProfiles.status, 'completed'),
            isNotNull(syncJobProfiles.extractedData),
            jobProfileVisibleTo(tenantId),
          ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    positionName: row.positionName,
    divisionDepartment: row.divisionDepartment,
    extractedData: row.extractedData as ExtractedJobProfileData | null,
  };
}

// ── Rebuild ───────────────────────────────────────────────────────

export type RebuildResult = {
  ok: boolean;
  pgvectorReady: boolean;
  totalProfiles: number;
  embedded: number;
  skipped: number;
  failed: number;
  /** Orphan vectors deleted because their source document no longer exists. */
  removed: number;
  message: string;
};

/** What every rebuild path counts as "the source": the documents that must exist
 *  in job_profile_embed once the run finishes. A profile that drops out of this
 *  set (deleted from the share folder and from sync_job_profiles, or knocked back
 *  out of `completed` / stripped of extractedData by a re-extraction) is exactly
 *  what pruneOrphanEmbeddings deletes. */
function sourceProfileWhere() {
  return and(eq(syncJobProfiles.status, 'completed'), isNotNull(syncJobProfiles.extractedData));
}

/**
 * Delete the job_profile_embed rows whose job profile is no longer in the
 * source set, so the corpus mirrors what the sync actually holds. Returns how
 * many were removed.
 *
 * Orphans are computed in JS from the ids we already read and deleted by
 * `IN (…)`, never by joining sync_job_profiles: job_profile_embed lives behind
 * VECTOR_DATABASE_URL, which need not be the same instance as the app database
 * that owns sync_job_profiles. The orphan list is normally tiny, the id list is
 * not — so this is also the cheaper of the two directions.
 *
 * Guard: an EMPTY source set prunes nothing. A rebuild that reads zero profiles
 * is far more likely to be a broken or mid-run sync than a genuinely emptied
 * corpus, and wiping every vector would silently break scoring for everyone.
 */
async function pruneOrphanEmbeddings(
  embeddedIds: Iterable<number>,
  sourceIds: Set<number>,
): Promise<number> {
  if (sourceIds.size === 0) return 0;
  const orphans = [...embeddedIds].filter((id) => !sourceIds.has(id));
  if (orphans.length === 0) return 0;
  await vectorDb.delete(jobProfileEmbed).where(inArray(jobProfileEmbed.jobProfileId, orphans));
  return orphans.length;
}

/** One wording for every rebuild path (single-shot, batched, agent tool). */
function rebuildSummary(counts: {
  embedded: number;
  skipped: number;
  failed: number;
  removed: number;
  onlyChanged: boolean;
}): string {
  const bits = [`${counts.embedded} di-embed`];
  if (counts.skipped > 0) {
    bits.push(
      `${counts.skipped} dilewati (${counts.onlyChanged ? 'tidak berubah' : 'dokumen kosong'})`,
    );
  }
  if (counts.removed > 0) bits.push(`${counts.removed} embedding usang dihapus`);
  const detail = bits.join(', ');
  return counts.failed === 0
    ? `Berhasil: ${detail}.`
    : `Selesai dengan ${counts.failed} gagal: ${detail}.`;
}

export async function rebuildJobProfileEmbeddingsAction(): Promise<RebuildResult> {
  await requirePermission('job_profiles.manage');
  const config = await getJobFamilyConfig();
  const model = config.embedding.model;
  const source = config.embedding.source;
  const batchSize = Math.max(1, Math.min(256, config.embedding.batchSize || 32));
  const dimensions = config.embedding.dimensions > 0 ? Math.floor(config.embedding.dimensions) : 768;

  const profiles = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(sourceProfileWhere());

  // Ids already in the corpus — the input to the orphan prune below.
  let embeddedIds: number[] = [];
  let recreated = false;
  try {
    const ensured = await ensureVectorDbSchema(dimensions);
    recreated = ensured.recreated;
    const rows = await vectorDb
      .select({ jobProfileId: jobProfileEmbed.jobProfileId })
      .from(jobProfileEmbed);
    embeddedIds = rows.map((r) => r.jobProfileId);
  } catch (err) {
    if (isSchemaMissing(err)) {
      return {
        ok: false,
        pgvectorReady: false,
        totalProfiles: profiles.length,
        embedded: 0,
        skipped: 0,
        failed: 0,
        removed: 0,
        message:
          'Ekstensi pgvector / tabel job_profile_embed belum tersedia. Install pgvector di server PostgreSQL lalu jalankan migrasi drizzle/0031_job_family_embeddings.sql.',
      };
    }
    throw err;
  }

  const removed = await pruneOrphanEmbeddings(embeddedIds, new Set(profiles.map((p) => p.id)));

  // Restructure every profile — all of them get re-embedded.
  const prepared = profiles.map((p) => {
    const template = templateForProfile(config, p.id);
    const document = restructureJobProfile(p.extractedData as ExtractedJobProfileData | null, template);
    return {
      id: p.id,
      positionName: p.positionName,
      divisionDepartment: p.divisionDepartment,
      document,
      hash: hashContent(document, model),
      template,
      extractedHash: hashExtracted(p.extractedData),
    };
  });

  // Only a profile that restructures to nothing is skipped — there is no
  // document to send to the embedding service.
  const toEmbed = prepared.filter((p) => p.document.length > 0);
  const skipped = prepared.length - toEmbed.length;

  let embedded = 0;
  let failed = 0;

  for (let start = 0; start < toEmbed.length; start += batchSize) {
    const batch = toEmbed.slice(start, start + batchSize);
    try {
      const vectors = await embedViaService(batch.map((b) => b.document), model, source);
      assertVectorDimensions(vectors, dimensions, model);
      for (let i = 0; i < batch.length; i++) {
        const b = batch[i]!;
        const vector = vectors[i]!;
        await vectorDb
          .insert(jobProfileEmbed)
          .values({
            jobProfileId: b.id,
            positionName: b.positionName,
            divisionDepartment: b.divisionDepartment,
            document: b.document,
            embedding: vector,
            embeddingModel: model,
            contentHash: b.hash,
            embedTemplate: b.template,
            embedSource: source,
            embedDimensions: vector.length,
            extractedHash: b.extractedHash,
          })
          .onConflictDoUpdate({
            target: jobProfileEmbed.jobProfileId,
            set: {
              positionName: b.positionName,
              divisionDepartment: b.divisionDepartment,
              document: b.document,
              embedding: vector,
              embeddingModel: model,
              contentHash: b.hash,
              embedTemplate: b.template,
              embedSource: source,
              embedDimensions: vector.length,
              extractedHash: b.extractedHash,
              updatedAt: new Date(),
            },
          });
        embedded += 1;
      }
    } catch (err) {
      if (isSchemaMissing(err)) {
        return {
          ok: false,
          pgvectorReady: false,
          totalProfiles: profiles.length,
          embedded,
          skipped,
          failed,
          removed,
          message:
            'Ekstensi pgvector / tabel job_profile_embed belum tersedia. Install pgvector di server PostgreSQL lalu jalankan migrasi drizzle/0031_job_family_embeddings.sql.',
        };
      }
      failed += batch.length;
    }
  }

  revalidatePath('/posisi/job-family');
  return {
    ok: failed === 0,
    pgvectorReady: true,
    totalProfiles: prepared.length,
    embedded,
    skipped,
    failed,
    removed,
    message:
      (recreated
        ? `Koleksi vektor dibuat ulang pada ${dimensions} dimensi. `
        : '') + rebuildSummary({ embedded, skipped, failed, removed, onlyChanged: false }),
  };
}

// ── Rebuild with live progress (client-orchestrated batches) ──────
//
// The single-shot rebuild above can't report progress and swallows batch
// errors. This variant splits the work into a plan (restructure + diff, held
// server-side) plus one action per batch, so the client can drive a progress
// bar and, crucially, surface the *actual* embedding error instead of a bare
// "gagal" count. Sessions live in-process (this is a long-lived Next server)
// and are pruned after 30 minutes.

type RebuildItem = {
  id: number;
  positionName: string | null;
  divisionDepartment: string | null;
  document: string;
  hash: string;
  /** The template the document was restructured with (recorded on the vector). */
  template: string;
  /** hashExtracted() of the extracted data the document came from. */
  extractedHash: string;
};

type RebuildSession = {
  batches: RebuildItem[][];
  model: string;
  source: EmbeddingSource;
  /** Target vector dimension the collection was ensured at. */
  dimensions: number;
  total: number;
  skipped: number;
  embedded: number;
  failed: number;
  /** Orphans already deleted during planning — carried so the final message can report them. */
  removed: number;
  onlyChanged: boolean;
  createdAt: number;
};

const rebuildSessions = new Map<string, RebuildSession>();

function pruneRebuildSessions() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [key, session] of rebuildSessions) {
    if (session.createdAt < cutoff) rebuildSessions.delete(key);
  }
}

export type RebuildPlan = {
  ok: boolean;
  pgvectorReady: boolean;
  sessionId: string | null;
  total: number;
  toEmbed: number;
  skipped: number;
  /** Orphan vectors already deleted while planning — the prune is not deferred to the batches. */
  removed: number;
  batchCount: number;
  batchSize: number;
  message: string;
};

/**
 * Plan a rebuild: prune vectors whose source document is gone, restructure every
 * completed profile, and stash the batches to embed in a server-side session.
 * Returns counts + a sessionId the client feeds to processRebuildBatchAction.
 *
 * Every profile is queued by default — see rebuildJobProfileEmbeddingsAction for
 * why the content hash no longer gates a rebuild. `onlyChanged: true` restores
 * the incremental behaviour for callers that want a cheap top-up (the agent
 * tool's declared input); no UI button passes it.
 *
 * The prune runs here, once, rather than per batch: it is decided entirely by
 * the source query, so a later batch failure doesn't make an already-orphaned
 * vector worth keeping.
 *
 * Global for the same reason as rebuildJobProfileEmbeddingsAction: the embedding
 * corpus is shared with cross-tenant scoring.
 */
export async function startRebuildAction(
  options?: { onlyChanged?: boolean },
): Promise<RebuildPlan> {
  await requirePermission('job_profiles.manage');
  pruneRebuildSessions();

  const onlyChanged = options?.onlyChanged === true;
  const config = await getJobFamilyConfig();
  const model = config.embedding.model;
  const source = config.embedding.source;
  const batchSize = Math.max(1, Math.min(256, config.embedding.batchSize || 32));
  const dimensions = config.embedding.dimensions > 0 ? Math.floor(config.embedding.dimensions) : 768;

  const profiles = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(sourceProfileWhere());

  const existing = new Map<number, string | null>();
  let recreated = false;
  try {
    const ensured = await ensureVectorDbSchema(dimensions);
    recreated = ensured.recreated;
    const rows = await vectorDb
      .select({ jobProfileId: jobProfileEmbed.jobProfileId, contentHash: jobProfileEmbed.contentHash })
      .from(jobProfileEmbed);
    for (const r of rows) existing.set(r.jobProfileId, r.contentHash);
  } catch (err) {
    if (isSchemaMissing(err)) {
      return {
        ok: false,
        pgvectorReady: false,
        sessionId: null,
        total: profiles.length,
        toEmbed: 0,
        skipped: 0,
        removed: 0,
        batchCount: 0,
        batchSize,
        message: PGVECTOR_MSG,
      };
    }
    throw err;
  }

  const removed = await pruneOrphanEmbeddings(
    existing.keys(),
    new Set(profiles.map((p) => p.id)),
  );

  const prepared: RebuildItem[] = profiles.map((p) => {
    const template = templateForProfile(config, p.id);
    const document = restructureJobProfile(p.extractedData as ExtractedJobProfileData | null, template);
    return {
      id: p.id,
      positionName: p.positionName,
      divisionDepartment: p.divisionDepartment,
      document,
      hash: hashContent(document, model),
      template,
      extractedHash: hashExtracted(p.extractedData),
    };
  });

  const toEmbed = prepared.filter(
    (p) => p.document.length > 0 && (!onlyChanged || existing.get(p.id) !== p.hash),
  );
  const skipped = prepared.length - toEmbed.length;

  const batches: RebuildItem[][] = [];
  for (let i = 0; i < toEmbed.length; i += batchSize) {
    batches.push(toEmbed.slice(i, i + batchSize));
  }

  const sessionId = randomUUID();
  rebuildSessions.set(sessionId, {
    batches,
    model,
    source,
    dimensions,
    total: prepared.length,
    skipped,
    embedded: 0,
    failed: 0,
    removed,
    onlyChanged,
    createdAt: Date.now(),
  });

  const removedNote = removed > 0 ? ` ${removed} embedding usang dihapus.` : '';
  const recreatedNote = recreated
    ? ` Koleksi vektor dibuat ulang pada ${dimensions} dimensi.`
    : '';
  return {
    ok: true,
    pgvectorReady: true,
    sessionId,
    total: prepared.length,
    toEmbed: toEmbed.length,
    skipped,
    removed,
    batchCount: batches.length,
    batchSize,
    message:
      toEmbed.length === 0
        ? `Tidak ada dokumen untuk di-embed (${prepared.length} profil, ${skipped} dilewati).${removedNote}${recreatedNote}`
        : `Siap meng-embed ulang ${toEmbed.length} dari ${prepared.length} dokumen dalam ${batches.length} batch.${removedNote}${recreatedNote}`,
  };
}

export type RebuildBatchProgress = {
  ok: boolean;
  done: boolean;
  pgvectorReady: boolean;
  batchIndex: number;
  batchCount: number;
  embedded: number;
  skipped: number;
  failed: number;
  /** Orphans deleted by this run's planning step, echoed so the UI can show it throughout. */
  removed: number;
  total: number;
  error: string | null;
  message: string;
};

/**
 * Embed + upsert one batch of a planned rebuild. On a batch failure the actual
 * error message is returned (not swallowed) so the client can show the cause.
 */
export async function processRebuildBatchAction(
  sessionId: string,
  batchIndex: number,
): Promise<RebuildBatchProgress> {
  await requirePermission('job_profiles.manage');

  const session = rebuildSessions.get(sessionId);
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
      removed: 0,
      total: 0,
      error: 'Sesi rebuild kedaluwarsa atau tidak ditemukan. Mulai ulang.',
      message: 'Sesi rebuild tidak ditemukan.',
    };
  }

  const batch = session.batches[batchIndex];
  const batchCount = session.batches.length;

  // Out-of-range index → treat as a no-op completion.
  if (!batch) {
    rebuildSessions.delete(sessionId);
    return {
      ok: session.failed === 0,
      done: true,
      pgvectorReady: true,
      batchIndex,
      batchCount,
      embedded: session.embedded,
      skipped: session.skipped,
      failed: session.failed,
      removed: session.removed,
      total: session.total,
      error: null,
      message: finalRebuildMessage(session),
    };
  }

  let error: string | null = null;
  try {
    const vectors = await embedViaService(batch.map((b) => b.document), session.model, session.source);
    assertVectorDimensions(vectors, session.dimensions, session.model);
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i]!;
      const vector = vectors[i]!;
      await vectorDb
        .insert(jobProfileEmbed)
        .values({
          jobProfileId: b.id,
          positionName: b.positionName,
          divisionDepartment: b.divisionDepartment,
          document: b.document,
          embedding: vector,
          embeddingModel: session.model,
          contentHash: b.hash,
          embedTemplate: b.template,
          embedSource: session.source,
          embedDimensions: vector.length,
          extractedHash: b.extractedHash,
        })
        .onConflictDoUpdate({
          target: jobProfileEmbed.jobProfileId,
          set: {
            positionName: b.positionName,
            divisionDepartment: b.divisionDepartment,
            document: b.document,
            embedding: vector,
            embeddingModel: session.model,
            contentHash: b.hash,
            embedTemplate: b.template,
            embedSource: session.source,
            embedDimensions: vector.length,
            extractedHash: b.extractedHash,
            updatedAt: new Date(),
          },
        });
      session.embedded += 1;
    }
  } catch (err) {
    if (isSchemaMissing(err)) {
      rebuildSessions.delete(sessionId);
      return {
        ok: false,
        done: true,
        pgvectorReady: false,
        batchIndex,
        batchCount,
        embedded: session.embedded,
        skipped: session.skipped,
        failed: session.failed,
        removed: session.removed,
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
    rebuildSessions.delete(sessionId);
    revalidatePath('/posisi/job-family');
    // A finished rebuild changes the corpus the CAREER similarity anchors are
    // measured from, so ask the scoring service to recalibrate now. Best-effort:
    // the anchors carry a corpus fingerprint and a scoring run recomputes them
    // by itself on mismatch, so this only makes the refresh immediate — and lets
    // an operator see what the rebuild did to the Career scale.
    if (error === null) await refreshCareerAnchors();
  }

  return {
    ok: error === null,
    done,
    pgvectorReady: true,
    batchIndex,
    batchCount,
    embedded: session.embedded,
    skipped: session.skipped,
    failed: session.failed,
    removed: session.removed,
    total: session.total,
    error,
    message: done
      ? finalRebuildMessage(session)
      : error
        ? `Batch ${batchIndex + 1}/${batchCount} gagal: ${error}`
        : `Batch ${batchIndex + 1}/${batchCount} selesai — ${session.embedded} di-embed.`,
  };
}

/** Discard a planned rebuild session (e.g. the client aborted after an error). */
export async function cancelRebuildAction(sessionId: string): Promise<void> {
  await requirePermission('job_profiles.manage');
  rebuildSessions.delete(sessionId);
}

/**
 * Recalibrate the CAREER similarity anchors after a job-profile re-embed.
 *
 * `force=1` is not optional here, and this is the one place correctness DOES
 * depend on the call. The anchors' fingerprint keys on `content_hash`, which
 * covers document text and model name only — and this rebuild deliberately
 * re-embeds every document even when that hash is unchanged, precisely because a
 * changed embedding source or a half-finished earlier run leaves stale vectors
 * that look up-to-date. In exactly that case the fingerprint does not move, so
 * without force the refresh is a no-op and the scale keeps describing the vectors
 * this rebuild just replaced.
 *
 * Still silent on failure: a rebuild must not report failure because a scoring
 * service was down, and the next census (whenever any tracked input does move)
 * recovers. Mirrors refreshTechnicalAnchors() in lib/kamus-embed-actions.ts.
 */
async function refreshCareerAnchors(): Promise<void> {
  const url = process.env.SCORING_SERVICE_URL;
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    await fetch(`${url.replace(/\/+$/, '')}/api/embed/career-anchors/refresh?force=1`, {
      method: 'POST',
      signal: controller.signal,
    });
  } catch {
    // Ignored on purpose — see above.
  } finally {
    clearTimeout(timeout);
  }
}

function finalRebuildMessage(session: RebuildSession): string {
  return rebuildSummary({
    embedded: session.embedded,
    skipped: session.skipped,
    failed: session.failed,
    removed: session.removed,
    onlyChanged: session.onlyChanged,
  });
}

// ── Single-profile restructure + embed ────────────────────────────

export type SingleEmbedResult = {
  ok: boolean;
  pgvectorReady: boolean;
  message: string;
};

/**
 * Restructure ONE profile (using its per-profile override or the global
 * template) and upsert its embedding into job_profile_embed. Powers the
 * "Restrukturisasi & embed profil ini" button in Configuration → job profile
 * spesifik. Independent of the batched rebuild session machinery.
 *
 * Source-aware in the same sense as the full rebuild, scoped to this one id: if
 * the profile is gone from sync_job_profiles, its vector is deleted instead of
 * the caller getting a bare "tidak ditemukan" while the stale vector keeps
 * feeding clustering and scoring.
 */
export async function embedSingleJobProfileAction(
  jobProfileId: number,
): Promise<SingleEmbedResult> {
  await requirePermission('job_profiles.manage');
  const config = await getJobFamilyConfig();
  const model = config.embedding.model;
  const source = config.embedding.source;

  const [row] = await db
    .select({
      id: syncJobProfiles.id,
      positionName: syncJobProfiles.positionName,
      divisionDepartment: syncJobProfiles.divisionDepartment,
      extractedData: syncJobProfiles.extractedData,
    })
    .from(syncJobProfiles)
    .where(eq(syncJobProfiles.id, jobProfileId))
    .limit(1);

  if (!row) {
    try {
      await ensureVectorDbSchema();
      await vectorDb
        .delete(jobProfileEmbed)
        .where(eq(jobProfileEmbed.jobProfileId, jobProfileId));
    } catch (err) {
      if (!isSchemaMissing(err)) throw err;
    }
    return {
      ok: false,
      pgvectorReady: true,
      message: 'Job profile tidak ditemukan di sumber — embedding-nya sudah dihapus.',
    };
  }

  const template = templateForProfile(config, row.id);
  const document = restructureJobProfile(row.extractedData as ExtractedJobProfileData | null, template);
  const extractedHash = hashExtracted(row.extractedData);
  if (!document) {
    return {
      ok: false,
      pgvectorReady: true,
      message: 'Dokumen hasil restrukturisasi kosong — tidak ada yang di-embed.',
    };
  }

  try {
    await ensureVectorDbSchema();
    const storedDim = await getVectorColumnDimension('job_profile_embed');
    const configuredDim =
      config.embedding.dimensions > 0 ? Math.floor(config.embedding.dimensions) : 768;
    if (storedDim !== null && storedDim > 0 && storedDim !== configuredDim) {
      return {
        ok: false,
        pgvectorReady: true,
        message:
          `Kolom vektor tersimpan ${storedDim} dimensi, tetapi konfigurasi menetapkan ${configuredDim} dimensi. ` +
          `Tekan 'Bangun Ulang Job Profile' untuk membuat ulang koleksi vektor — penyematan satu profil tidak cukup.`,
      };
    }
    const [vector] = await embedViaService([document], model, source);
    assertVectorDimensions([vector], configuredDim, model);
    await vectorDb
      .insert(jobProfileEmbed)
      .values({
        jobProfileId: row.id,
        positionName: row.positionName,
        divisionDepartment: row.divisionDepartment,
        document,
        embedding: vector,
        embeddingModel: model,
        contentHash: hashContent(document, model),
        embedTemplate: template,
        embedSource: source,
        embedDimensions: vector.length,
        extractedHash,
      })
      .onConflictDoUpdate({
        target: jobProfileEmbed.jobProfileId,
        set: {
          positionName: row.positionName,
          divisionDepartment: row.divisionDepartment,
          document,
          embedding: vector,
          embeddingModel: model,
          contentHash: hashContent(document, model),
          embedTemplate: template,
          embedSource: source,
          embedDimensions: vector.length,
          extractedHash,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    if (isSchemaMissing(err)) {
      return { ok: false, pgvectorReady: false, message: PGVECTOR_MSG };
    }
    return {
      ok: false,
      pgvectorReady: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  revalidatePath('/posisi/job-family');
  return {
    ok: true,
    pgvectorReady: true,
    message: `Profil "${row.positionName ?? `#${row.id}`}" berhasil di-embed.`,
  };
}

// ── Stats + documents (Family Tree) ───────────────────────────────

export type JobFamilyStats = {
  pgvectorReady: boolean;
  completedProfiles: number;
  embeddedCount: number;
  pendingCount: number;
  embeddingModel: string | null;
  lastUpdated: string | null;
  /** Configured vector dimension — the space the corpus was embedded into. */
  embeddingDimensions: number | null;
  /** Documents in the corpus overall — embeddedCount is this tenant's slice. */
  embeddedCountAllTenants: number;
};

/**
 * Corpus health for the Configuration page. Counts are the ACTIVE TENANT's
 * documents (so "0 dokumen" correctly tells a business unit it has none of its
 * own), with the org-wide total alongside it so the page can explain that
 * scoring still runs against the full corpus.
 */
export async function getJobFamilyStats(): Promise<JobFamilyStats> {
  await requirePermission('job_profiles.view');
  const tenantId = await getCurrentTenantId();
  const config = await getJobFamilyConfig();
  const embeddingDimensions = config.embedding.dimensions > 0 ? Math.floor(config.embedding.dimensions) : 768;

  const [{ count: completedProfiles }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(syncJobProfiles)
    .where(
      and(
        eq(syncJobProfiles.status, 'completed'),
        isNotNull(syncJobProfiles.extractedData),
        jobProfileVisibleTo(tenantId),
      ),
    );

  try {
    await ensureVectorDbSchema();
    const [agg] = await vectorDb
      .select({
        count: sql<number>`count(*)::int`,
        model: sql<string | null>`max(${jobProfileEmbed.embeddingModel})`,
        lastUpdated: sql<string | null>`max(${jobProfileEmbed.updatedAt})`,
      })
      .from(jobProfileEmbed);

    // Ownership and vectors can live in different databases (VECTOR_DATABASE_URL),
    // so the tenant slice is intersected in memory rather than joined.
    const visible = await visibleJobProfileIds(tenantId);
    const embeddedRows = await vectorDb
      .select({ jobProfileId: jobProfileEmbed.jobProfileId })
      .from(jobProfileEmbed);
    const embeddedCount = embeddedRows.filter((r) => visible.has(r.jobProfileId)).length;
    return {
      pgvectorReady: true,
      completedProfiles: completedProfiles ?? 0,
      embeddedCount,
      pendingCount: Math.max(0, (completedProfiles ?? 0) - embeddedCount),
      embeddingModel: agg?.model ?? null,
      lastUpdated: agg?.lastUpdated ? new Date(agg.lastUpdated).toISOString() : null,
      embeddingDimensions,
      embeddedCountAllTenants: agg?.count ?? 0,
    };
  } catch (err) {
    // A vector DB that is unreachable (VECTOR_DATABASE_URL pointing at a port
    // with nothing on it, container not started) is reported the same way as a
    // missing migration: "belum siap". Rethrowing instead took the whole page
    // down, because this is the one loader the Konfigurasi page can't .catch()
    // — it reads stats.pgvectorReady directly.
    if (isSchemaMissing(err) || isVectorDbUnreachable(err)) {
      return {
        pgvectorReady: false,
        completedProfiles: completedProfiles ?? 0,
        embeddedCount: 0,
        pendingCount: completedProfiles ?? 0,
        embeddingModel: null,
        lastUpdated: null,
        embeddingDimensions,
        embeddedCountAllTenants: 0,
      };
    }
    throw err;
  }
}

export type JobFamilyDocument = {
  id: number;
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  document: string;
};

/** Embedded documents VISIBLE TO THE ACTIVE TENANT, for the Family Tree page
 *  (no vectors — those stay in DB). */
export async function listJobFamilyDocuments(limit = 200): Promise<JobFamilyDocument[]> {
  await requirePermission('job_profiles.view');
  try {
    await ensureVectorDbSchema();
    const tenantId = await getCurrentTenantId();
    const visible = await visibleJobProfileIds(tenantId);
    if (visible.size === 0) return [];
    // Filtered after the fetch, not with inArray: the visible set can be the
    // whole corpus, and a 275-element IN list per page load is worse than one
    // pass over the rows we already have.
    const rows = await vectorDb
      .select({
        id: jobProfileEmbed.id,
        jobProfileId: jobProfileEmbed.jobProfileId,
        positionName: jobProfileEmbed.positionName,
        divisionDepartment: jobProfileEmbed.divisionDepartment,
        document: jobProfileEmbed.document,
      })
      .from(jobProfileEmbed)
      .orderBy(jobProfileEmbed.positionName);
    return rows.filter((r) => visible.has(r.jobProfileId)).slice(0, limit);
  } catch (err) {
    if (isSchemaMissing(err) || isVectorDbUnreachable(err)) return [];
    throw err;
  }
}
