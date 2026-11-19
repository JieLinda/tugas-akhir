'use server';

// Server actions for Job Family topic modeling (BERTopic):
//  • startTopicRunAction     — create a run row + kick off the Python topic-service
//  • getTopicRunStatusAction — cheap poll of a run's status + phase progress
//  • getLatestTopicRunAction — the newest run (drives the Family Tree page state)
//  • getTopicResultsAction   — topics + assignments + hierarchy for a completed run
//
// Mirrors the scoring flow: the web app owns the run row, POSTs the runId to the
// standalone service (fire-and-forget, best-effort), and then polls Postgres for
// progress/results — the service mutates the same rows as it processes.
//
// SCOPE: a run is either GLOBAL (tenant_id NULL — clusters every embedded job
// profile, which is what all pre-existing runs are) or scoped to one tenant's
// documents. Readers prefer the active tenant's newest run and fall back to the
// newest global one, so a business unit with too few documents to cluster on its
// own still sees a family tree.

import { and, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { vectorDb, ensureVectorDbSchema } from '@/lib/db/vector-db';
import {
  jobFamilyTopicRuns,
  jobFamilyTopics,
  jobFamilyTopicAssignments,
  jobFamilyMatches,
  syncJobProfiles,
} from '@/lib/db/schema';
import type { JobFamilyRunDiagnostics } from '@/lib/db/schema';
import { jobProfileEmbed } from '@/lib/db/vector-schema';
import { requirePermission } from '@/lib/rbac';
import {
  getJobFamilyConfig,
  ensureActiveConfigVersionId,
  ensureSandboxConfigVersionId,
} from '@/lib/job-family-actions';
import { isSchemaMissing } from '@/lib/job-family/embed';
import { DEFAULT_JOB_FAMILY_CONFIG } from '@/lib/job-family/config';
import type { BertopicConfig, JobFamilyConfig } from '@/lib/job-family/config';
import { TENANTS, getCurrentTenantId } from '@/lib/tenant';
import { visibleJobProfileIds } from '@/lib/job-profile-tenant-scope';
import {
  classifyOutlier,
  type OutlierBlockedBy,
  type OutlierIsolation,
} from '@/lib/job-family/optimize/diagnose';
import { demoScrub } from '@/lib/demo/names';
import { demoMaskJobProfileExcerpts } from '@/lib/demo/content';

// ── Shared shapes ──────────────────────────────────────────────────

export type TopicProgress = {
  phase: string;
  done?: number;
  total?: number;
  message?: string;
};

export type TopicRunSummary = {
  runId: string;
  status: string; // pending | processing | completed | failed
  /** null = global run over the whole corpus; else the tenant it was scoped to. */
  tenantId: string | null;
  tenantName: string | null;
  progress: TopicProgress | null;
  numDocuments: number;
  numTopics: number;
  embeddingModel: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type TopicKeyword = { word: string; score: number };

/** A candidate/employee currently matched to (holding a role in) a job profile. */
export type Incumbent = {
  candidateId: string;
  candidateName: string | null;
  candidatePosition: string | null;
  tenantId: string | null;
  tenantName: string | null;
  companyId: string | null;
  matchType: string; // filename | exact | embedding
  similarity: number | null; // embedding matches only
  jobProfileId: number;
};

/**
 * Why a job profile document belongs to its family (hybrid explanation from the
 * topic-service): the family keywords found in this document, its closeness to
 * the family centroid, and the nearest alternative family. Empty/null on runs
 * produced before the enrichment (migration 0039).
 */
export type MemberReason = {
  matchedKeywords: TopicKeyword[];
  centroidSimilarity: number | null;
  altTopicId: number | null;
  altTopicLabel: string | null;
  /** LLM-paraphrased title of the alternative (nearest) family; null on old runs. */
  altTopicGeneralTitle: string | null;
  altSimilarity: number | null;
};

/** Inline job-profile summary shown when a member is expanded (no extra fetch). */
export type MemberProfileSummary = {
  jobPurpose: string | null;
  responsibilities: string[];
  competencies: string[];
};

/** One job profile inside a topic, with its incumbents and a document snippet. */
export type TopicMember = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  documentSnippet: string | null;
  probability: number | null;
  x: number | null;
  y: number | null;
  incumbents: Incumbent[];
  /** Hybrid "why it's in this family" explanation. */
  reason: MemberReason;
  /** Inline profile summary (tujuan jabatan, tanggung jawab, kompetensi). */
  summary: MemberProfileSummary;
};

export type LabeledCount = { name: string; count: number };

export type TopicResult = {
  topicId: number;
  label: string | null;
  keywords: TopicKeyword[];
  size: number;
  representativeDocIds: number[];
  x: number | null;
  y: number | null;
  /** Generalized topic title/description for this cluster (null on older runs). */
  generalTitle: string | null;
  generalDescription: string | null;
  // ── Enriched detail ──
  members: TopicMember[];
  incumbentCount: number;
  divisions: LabeledCount[]; // division/department breakdown within the topic
  tenantCounts: LabeledCount[]; // incumbents per business unit
};

export type TopicAssignment = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  topicId: number;
  probability: number | null;
  x: number | null;
  y: number | null;
  incumbentCount: number;
  /** Cosine to its OWN family centroid (768-dim). null for outliers — they have none. */
  centroidSimilarity: number | null;
  /** Nearest OTHER family. On an outlier (topicId -1) this is its nearest family, period. */
  altTopicId: number | null;
  /**
   * Cosine to `altTopicId`.
   *
   * For an outlier this single number is what separates "sits just outside a
   * family" from "resembles nothing here" — and it is the same measure
   * `outlierThreshold` is compared against, so a threshold can be chosen from
   * the observed distribution instead of guessed.
   */
  altSimilarity: number | null;
};

export type HierarchyLinkRow = {
  parentId: string | null;
  parentName: string | null;
  childLeftId: string | null;
  childLeftName: string | null;
  childRightId: string | null;
  childRightName: string | null;
  distance: number | null;
  // ── Generalized "topic recognition" for this internal (sub-family) node ──
  /** Generalized title for the parent node (null on older runs → use parentName). */
  parentTitle?: string | null;
  parentDescription?: string | null;
  /** Aggregated c-TF-IDF keywords for the parent node's subtree. */
  parentKeywords?: TopicKeyword[] | null;
};

export type TopicResults = {
  run: TopicRunSummary | null;
  topics: TopicResult[];
  assignments: TopicAssignment[];
  hierarchy: { linkage: HierarchyLinkRow[] } | null;
  /**
   * What the post-clustering steps actually did (null on runs made before the
   * column existed). A run reads `completed` even when outlier re-homing or
   * topic reduction silently did nothing — this is where that shows.
   */
  diagnostics?: JobFamilyRunDiagnostics | null;
};

// ── Helpers ────────────────────────────────────────────────────────

function toSummary(r: typeof jobFamilyTopicRuns.$inferSelect): TopicRunSummary {
  return {
    runId: r.id,
    status: r.status,
    tenantId: r.tenantId ?? null,
    tenantName: r.tenantId ? (TENANTS.find((t) => t.id === r.tenantId)?.name ?? null) : null,
    progress: (r.progress as TopicProgress | null) ?? null,
    numDocuments: r.numDocuments ?? 0,
    numTopics: r.numTopics ?? 0,
    embeddingModel: r.embeddingModel ?? null,
    error: r.error ?? null,
    createdAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt)).toISOString(),
    completedAt: r.completedAt
      ? (r.completedAt instanceof Date ? r.completedAt : new Date(r.completedAt)).toISOString()
      : null,
  };
}

/**
 * How many embedded documents a run would see. `tenantId` null = the whole
 * corpus (global run).
 *
 * The tenant filter is applied with an id list rather than a join because
 * job_profile_embed can live in a SEPARATE database (VECTOR_DATABASE_URL) from
 * job_profile_tenants — the two are not joinable in SQL.
 */
async function countEmbedded(tenantId: string | null): Promise<number | null> {
  // null = pgvector / job_profile_embed not present yet.
  try {
    await ensureVectorDbSchema();
    if (tenantId === null) {
      const [agg] = await vectorDb
        .select({ count: sql<number>`count(*)::int` })
        .from(jobProfileEmbed);
      return agg?.count ?? 0;
    }
    const allowed = await visibleJobProfileIds(tenantId);
    if (allowed.size === 0) return 0;
    const [agg] = await vectorDb
      .select({ count: sql<number>`count(*)::int` })
      .from(jobProfileEmbed)
      .where(inArray(jobProfileEmbed.jobProfileId, Array.from(allowed)));
    return agg?.count ?? 0;
  } catch (err) {
    if (isSchemaMissing(err)) return null;
    throw err;
  }
}

/**
 * True when an error means the topic-modeling tables (migration 0037) aren't
 * present yet — distinct from isSchemaMissing, which covers the pgvector/embed
 * tables (0031/0034/0035). Walks the Drizzle cause chain like isSchemaMissing.
 */
function isTopicSchemaMissing(err: unknown): boolean {
  let cur: unknown = err;
  const parts: string[] = [];
  for (let depth = 0; cur && depth < 5; depth++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? (cur.cause as unknown) : undefined;
  }
  const msg = parts.join('\n');
  return /relation "?(job_family_topic_runs|job_family_topics|job_family_topic_assignments)"?\s+does not exist/i.test(
    msg,
  );
}

const TOPIC_SCHEMA_MSG =
  'Tabel topic modeling belum tersedia. Jalankan migrasi: tsx scripts/apply-sql.ts drizzle/0037_job_family_topics.sql';

// ── Start a run ────────────────────────────────────────────────────

export type StartTopicRunResult = {
  ok: boolean;
  runId: string | null;
  message: string;
};

/**
 * Create a topic-modeling run and hand it to the Python topic-service. The run
 * row persists regardless of whether the service accepts it, so the UI always
 * has something to poll; a failed handoff is recorded as status='failed'.
 *
 * @param scope 'global' clusters every embedded job profile (the default, and
 *   what every run before tenant scoping was). 'tenant' clusters only the active
 *   tenant's documents — meaningful once that business unit has its own job
 *   profile folder, and a poor idea while it has a handful of documents, since
 *   HDBSCAN will bucket most of them as outliers.
 * @param opts.configOverride BERTopic parameters for THIS RUN ONLY, merged over
 *   the active config. This is the Agent Studio sandbox path (M9): parameter
 *   experiments must never touch the active config, because that config is
 *   shared by every user of the tenant. Unknown keys and wrongly-typed values
 *   are dropped (with the run proceeding on the rest) rather than rejected —
 *   an LLM-composed override with one bad key should not kill the whole run.
 *   The run row still records the exact config used, as a NON-active version.
 */
export async function startTopicRunAction(
  scope: 'global' | 'tenant' = 'global',
  opts?: { configOverride?: Record<string, unknown> },
): Promise<StartTopicRunResult> {
  await requirePermission('job_profiles.manage');

  const tenantId = scope === 'tenant' ? await getCurrentTenantId() : null;
  const tenantName = tenantId ? (TENANTS.find((t) => t.id === tenantId)?.name ?? 'Company ini') : null;

  const embedded = await countEmbedded(tenantId);
  if (embedded === null) {
    return {
      ok: false,
      runId: null,
      message:
        'Ekstensi pgvector / tabel job_profile_embed belum tersedia. Install pgvector lalu jalankan migrasi drizzle/0031 & drizzle/0037.',
    };
  }
  if (embedded < 2) {
    return {
      ok: false,
      runId: null,
      message: tenantId
        ? `Dokumen job profile milik ${tenantName} belum cukup untuk clustering (${embedded}). ` +
          'Petakan folder dokumen unit ini di Governance → Pemetaan Folder Job Profile, ' +
          'atau jalankan run global.'
        : 'Belum ada cukup dokumen ter-embed untuk clustering. Buka Configuration → Bangun Ulang Embedding terlebih dahulu.',
    };
  }

  const activeConfig: JobFamilyConfig = await getJobFamilyConfig();
  const override = sanitizeBertopicOverride(opts?.configOverride);
  const config: JobFamilyConfig = override
    ? { ...activeConfig, bertopic: { ...activeConfig.bertopic, ...override } }
    : activeConfig;

  // Record which config VERSION this run executes with (null if table absent).
  // An override run records a NON-active version: the run must point at the
  // config it actually used, but activating it would silently swap everyone's
  // configuration — the exact thing the sandbox exists to prevent.
  const configId = override
    ? await ensureSandboxConfigVersionId(config)
    : await ensureActiveConfigVersionId(config);

  // Create the run row (source of truth the service mutates + the UI polls).
  let runId: string;
  try {
    const [run] = await db
      .insert(jobFamilyTopicRuns)
      .values({
        tenantId,
        status: 'pending',
        config: config.bertopic,
        configId: configId ?? null,
        numDocuments: embedded,
        progress: { phase: 'pending', message: 'Menunggu topic-service...' },
      })
      .returning({ id: jobFamilyTopicRuns.id });
    runId = run!.id;
  } catch (err) {
    if (isTopicSchemaMissing(err)) {
      return { ok: false, runId: null, message: TOPIC_SCHEMA_MSG };
    }
    throw err;
  }

  // Hand off to the Python service (best-effort; returns 202 immediately).
  const base = process.env.TOPIC_SERVICE_URL;
  if (!base) {
    await markRunFailed(runId, 'TOPIC_SERVICE_URL tidak dikonfigurasi.');
    return {
      ok: false,
      runId,
      message: 'TOPIC_SERVICE_URL tidak dikonfigurasi. Set env pada web app.',
    };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/topics/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, config: config.bertopic }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const msg = `topic-service menolak permintaan (HTTP ${res.status}). ${body}`.trim();
      await markRunFailed(runId, msg);
      return { ok: false, runId, message: msg };
    }
  } catch (err) {
    const msg = `topic-service tidak dapat dihubungi di ${base} (${
      err instanceof Error ? err.message : String(err)
    }). Pastikan service berjalan.`;
    await markRunFailed(runId, msg);
    return { ok: false, runId, message: msg };
  }

  return {
    ok: true,
    runId,
    message:
      `Run ${tenantId ? `khusus ${tenantName}` : 'global'}${override ? ' (parameter percobaan)' : ''} ` +
      `dimulai untuk ${embedded} dokumen. Memantau progres...`,
  };
}

/**
 * Saring override BERTopic dari luar: hanya key yang dikenal, hanya nilai yang
 * tipenya cocok dengan default-nya. Yang tidak lolos DIBUANG, bukan ditolak —
 * override susunan LLM dengan satu key salah tidak boleh menggagalkan seluruh
 * run percobaan. Field nullable (minSamples, nrTopics, diversity) menerima null.
 */
function sanitizeBertopicOverride(
  raw: Record<string, unknown> | undefined,
): Partial<BertopicConfig> | null {
  if (!raw || typeof raw !== 'object') return null;
  const defaults = DEFAULT_JOB_FAMILY_CONFIG.bertopic as unknown as Record<string, unknown>;
  const NULLABLE = new Set(['minSamples', 'nrTopics', 'diversity']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(key in defaults)) continue;
    if (value === null) {
      if (NULLABLE.has(key)) out[key] = null;
      continue;
    }
    const ref = defaults[key];
    // Default bernilai null (minSamples, nrTopics, diversity) adalah numerik.
    const expected = ref === null ? 'number' : typeof ref;
    if (typeof value !== expected) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as Partial<BertopicConfig>) : null;
}

async function markRunFailed(runId: string, error: string): Promise<void> {
  await db
    .update(jobFamilyTopicRuns)
    .set({
      status: 'failed',
      error,
      progress: { phase: 'failed', message: error.slice(0, 500) },
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(eq(jobFamilyTopicRuns.id, runId));
}

// ── Poll / read ────────────────────────────────────────────────────

/**
 * Bentuk uuid, diperiksa SEBELUM menyentuh basis data.
 *
 * Postgres menolak uuid cacat dengan galat tipe, yang lalu diterjemahkan
 * `describeStepError` menjadi "sepertinya sebuah nama terkirim di tempat id" —
 * keterangan yang menyesatkan ketika penyebab sebenarnya adalah id yang benar
 * tetapi salah SALIN. Itu bukan kemungkinan teoretis: id run dicetak ke prompt
 * planner pada blok KONDISI SAAT INI, dan menyalin 36 karakter heksadesimal
 * dengan tangan adalah hal yang model memang sesekali gagal lakukan.
 */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

export async function getTopicRunStatusAction(runId: string): Promise<TopicRunSummary | null> {
  await requirePermission('job_profiles.view');
  // Tidak ditemukan, bukan galat: pemanggil sudah punya jalur "run tidak ada",
  // dan itu jawaban yang benar untuk id yang tidak mungkin cocok dengan apa pun.
  if (!isUuid(runId)) return null;
  try {
    const tenantId = await getCurrentTenantId();
    // Same visibility rule as getLatestTopicRunAction: a run id belonging to
    // another business unit reads as "not found" rather than leaking its results.
    const [r] = await db
      .select()
      .from(jobFamilyTopicRuns)
      .where(
        and(
          eq(jobFamilyTopicRuns.id, runId),
          or(isNull(jobFamilyTopicRuns.tenantId), eq(jobFamilyTopicRuns.tenantId, tenantId)),
        ),
      )
      .limit(1);
    return r ? toSummary(r) : null;
  } catch (err) {
    if (isTopicSchemaMissing(err)) return null;
    throw err;
  }
}

/**
 * The newest run VISIBLE TO THE ACTIVE TENANT — the Family Tree page's entry
 * point. Visible = scoped to this tenant, or global. Runs belonging to another
 * business unit are excluded so switching tenant switches the family tree.
 *
 * Note this returns the newest of the two kinds rather than preferring a
 * tenant-scoped one outright: a stale tenant run should not shadow a global
 * rebuild that ran afterwards.
 */
export async function getLatestTopicRunAction(): Promise<TopicRunSummary | null> {
  await requirePermission('job_profiles.view');
  try {
    const tenantId = await getCurrentTenantId();
    const [r] = await db
      .select()
      .from(jobFamilyTopicRuns)
      .where(or(isNull(jobFamilyTopicRuns.tenantId), eq(jobFamilyTopicRuns.tenantId, tenantId)))
      .orderBy(desc(jobFamilyTopicRuns.createdAt))
      .limit(1);
    return r ? toSummary(r) : null;
  } catch (err) {
    // Table absent (migration 0037 not applied) → treat as "no runs yet" so the
    // page still renders; the build action then surfaces the migration hint.
    if (isSchemaMissing(err) || isTopicSchemaMissing(err)) return null;
    throw err;
  }
}

/** Full results (topics + assignments + hierarchy) for a run — used once completed. */
// Demo mode: member summaries / snippets keep three words per point, and incumbents' names become initials.
export async function getTopicResultsAction(
  ...args: Parameters<typeof getTopicResultsActionImpl>
): ReturnType<typeof getTopicResultsActionImpl> {
  return demoScrub(await demoMaskJobProfileExcerpts(await getTopicResultsActionImpl(...args)));
}

async function getTopicResultsActionImpl(runId: string): Promise<TopicResults> {
  await requirePermission('job_profiles.view');
  if (!isUuid(runId)) {
    return { run: null, topics: [], assignments: [], hierarchy: null, diagnostics: null };
  }

  const run = await getTopicRunStatusAction(runId);
  if (!run) return { run: null, topics: [], assignments: [], hierarchy: null, diagnostics: null };

  const tenantId = await getCurrentTenantId();

  const [topicRows, allAssignRows, runRow] = await Promise.all([
    db
      .select()
      .from(jobFamilyTopics)
      .where(eq(jobFamilyTopics.runId, runId))
      .orderBy(desc(jobFamilyTopics.size)),
    db
      .select()
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, runId)),
    db
      .select({ hierarchy: jobFamilyTopicRuns.hierarchy })
      .from(jobFamilyTopicRuns)
      .where(eq(jobFamilyTopicRuns.id, runId))
      .limit(1),
  ]);

  // A GLOBAL run clusters every document, so its stored assignments span all
  // business units. What gets DISPLAYED is narrowed to the documents the active
  // tenant owns — the clustering itself stays global (that is what makes the
  // families meaningful), only the view is scoped. A tenant-scoped run is
  // already narrow, so this filter is a no-op for it.
  const visibleIds = await visibleJobProfileIds(tenantId);
  const assignRows = allAssignRows.filter((a) => visibleIds.has(a.jobProfileId));

  // ── Enrichment: document snippets + incumbents per job profile ──
  const jpIds = Array.from(new Set(assignRows.map((a) => a.jobProfileId)));

  const [docRows, matchRows, profileRows] = await Promise.all([
    jpIds.length
      ? vectorDb
          .select({ jobProfileId: jobProfileEmbed.jobProfileId, document: jobProfileEmbed.document })
          .from(jobProfileEmbed)
          .where(inArray(jobProfileEmbed.jobProfileId, jpIds))
      : Promise.resolve([] as { jobProfileId: number; document: string }[]),
    jpIds.length
      ? db
          .select({
            candidateId: jobFamilyMatches.candidateId,
            candidateName: jobFamilyMatches.candidateName,
            candidatePosition: jobFamilyMatches.candidatePosition,
            tenantId: jobFamilyMatches.tenantId,
            companyId: jobFamilyMatches.companyId,
            matchType: jobFamilyMatches.matchType,
            similarity: jobFamilyMatches.similarity,
            jobProfileId: jobFamilyMatches.jobProfileId,
          })
          .from(jobFamilyMatches)
          // Incumbents are candidates, and a candidate belongs to exactly one
          // business unit — so the people shown against a job profile are the
          // active tenant's, never another unit's. (Cross-tenant talent search
          // lives in scoring, which reads this table without the filter.)
          .where(
            and(
              inArray(jobFamilyMatches.jobProfileId, jpIds),
              eq(jobFamilyMatches.tenantId, tenantId),
            ),
          )
      : Promise.resolve([] as any[]),
    jpIds.length
      ? db
          .select({
            id: syncJobProfiles.id,
            jobPurpose: syncJobProfiles.jobPurpose,
            extractedData: syncJobProfiles.extractedData,
          })
          .from(syncJobProfiles)
          .where(inArray(syncJobProfiles.id, jpIds))
      : Promise.resolve([] as { id: number; jobPurpose: string | null; extractedData: any }[]),
  ]);

  const snippetByJp = new Map<number, string>();
  for (const d of docRows) {
    const s = snippet(d.document);
    if (s) snippetByJp.set(d.jobProfileId, s);
  }

  // Inline profile summary (tujuan jabatan, tanggung jawab, kompetensi) — loaded
  // upfront so expanding a member in the tree needs no extra round trip.
  const summaryByJp = new Map<number, MemberProfileSummary>();
  for (const p of profileRows) {
    summaryByJp.set(p.id, profileSummaryFrom(p.jobPurpose ?? null, p.extractedData));
  }

  // topic_id → label / paraphrased title, to resolve each member's nearest
  // alternative family. The paraphrase wins in the UI; the raw keyword label is
  // the fallback for runs produced before the generalization step existed.
  const labelByTopic = new Map<number, string | null>();
  const generalTitleByTopic = new Map<number, string | null>();
  for (const t of topicRows) {
    labelByTopic.set(t.topicId, t.label ?? null);
    generalTitleByTopic.set(t.topicId, t.generalTitle ?? null);
  }

  const tenantName = (id: string | null): string | null =>
    id ? (TENANTS.find((t) => t.id === id)?.name ?? null) : null;

  const incumbentsByJp = new Map<number, Incumbent[]>();
  for (const m of matchRows) {
    const list = incumbentsByJp.get(m.jobProfileId) ?? [];
    list.push({
      candidateId: m.candidateId,
      candidateName: m.candidateName ?? null,
      candidatePosition: m.candidatePosition ?? null,
      tenantId: m.tenantId ?? null,
      tenantName: tenantName(m.tenantId ?? null),
      companyId: m.companyId ?? null,
      matchType: m.matchType,
      similarity: m.similarity ?? null,
      jobProfileId: m.jobProfileId,
    });
    incumbentsByJp.set(m.jobProfileId, list);
  }

  const topics: TopicResult[] = topicRows.flatMap((t) => {
    const memberAssigns = assignRows.filter((a) => a.topicId === t.topicId);
    // A family with no document the active tenant owns is dropped rather than
    // listed empty — an empty card reads as "this family has no jobs", which is
    // false; it simply has none of ours.
    if (memberAssigns.length === 0) return [];
    const members: TopicMember[] = memberAssigns
      .map((a) => {
        const altTopicId = a.altTopicId ?? null;
        return {
          jobProfileId: a.jobProfileId,
          positionName: a.positionName ?? null,
          divisionDepartment: a.divisionDepartment ?? null,
          documentSnippet: snippetByJp.get(a.jobProfileId) ?? null,
          probability: a.probability ?? null,
          x: a.x ?? null,
          y: a.y ?? null,
          incumbents: incumbentsByJp.get(a.jobProfileId) ?? [],
          reason: {
            matchedKeywords: (a.matchedKeywords as TopicKeyword[] | null) ?? [],
            centroidSimilarity: a.centroidSimilarity ?? null,
            altTopicId,
            altTopicLabel: altTopicId != null ? labelByTopic.get(altTopicId) ?? null : null,
            altTopicGeneralTitle:
              altTopicId != null ? generalTitleByTopic.get(altTopicId) ?? null : null,
            altSimilarity: a.altSimilarity ?? null,
          },
          summary:
            summaryByJp.get(a.jobProfileId) ??
            ({ jobPurpose: null, responsibilities: [], competencies: [] } as MemberProfileSummary),
        };
      })
      .sort((m1, m2) => (m2.probability ?? 0) - (m1.probability ?? 0));

    const allIncumbents = members.flatMap((m) => m.incumbents);
    return [{
      topicId: t.topicId,
      label: t.label ?? null,
      keywords: (t.keywords as TopicKeyword[] | null) ?? [],
      // The VISIBLE member count, not the run's stored cluster size: on a global
      // run those differ, and a card reading "42 jabatan" above 3 listed rows is
      // worse than a smaller honest number. The run-level total stays on
      // TopicRunSummary.numDocuments.
      size: members.length,
      representativeDocIds: ((t.representativeDocIds as number[] | null) ?? []).filter((id) =>
        visibleIds.has(id),
      ),
      x: t.x ?? null,
      y: t.y ?? null,
      generalTitle: t.generalTitle ?? null,
      generalDescription: t.generalDescription ?? null,
      members,
      incumbentCount: allIncumbents.length,
      divisions: topCounts(members.map((m) => m.divisionDepartment), 6),
      tenantCounts: topCounts(
        allIncumbents.map((i) => i.tenantName ?? i.companyId ?? i.tenantId),
        6,
      ),
    }];
  });

  const assignments: TopicAssignment[] = assignRows.map((a) => ({
    jobProfileId: a.jobProfileId,
    positionName: a.positionName ?? null,
    divisionDepartment: a.divisionDepartment ?? null,
    topicId: a.topicId,
    probability: a.probability ?? null,
    x: a.x ?? null,
    y: a.y ?? null,
    incumbentCount: incumbentsByJp.get(a.jobProfileId)?.length ?? 0,
    centroidSimilarity: a.centroidSimilarity ?? null,
    altTopicId: a.altTopicId ?? null,
    altSimilarity: a.altSimilarity ?? null,
  }));

  const hierarchy =
    (runRow[0]?.hierarchy as { linkage: HierarchyLinkRow[] } | null) ?? null;

  return { run, topics, assignments, hierarchy, diagnostics: await readRunDiagnostics(runId) };
}

/** Map a heterogeneous list (strings or objects) to a clean string list. */
function asStringList(raw: any, pick: (item: any) => unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const v = typeof item === 'string' ? item : pick(item);
    const s = v == null ? '' : String(v).trim();
    if (s) out.push(s);
  }
  return out;
}

/**
 * Compact inline summary from a job profile's extracted_data: purpose, top
 * responsibilities, and technical competencies — the fields shown when a member
 * is expanded in the Family Tree (loaded upfront, so no extra fetch on expand).
 */
function profileSummaryFrom(jobPurpose: string | null, extractedData: any): MemberProfileSummary {
  const ed = extractedData ?? {};
  const purpose =
    (jobPurpose && jobPurpose.trim()) ||
    (typeof ed.jobPurpose === 'string' ? ed.jobPurpose.trim() : '') ||
    null;
  const responsibilities = asStringList(
    ed.responsibilities,
    (r) => r?.responsibility ?? r?.name ?? '',
  ).slice(0, 5);
  const competencies = asStringList(
    ed.technicalCompetencies,
    (c) => c?.competency ?? c?.name ?? c?.technicalName ?? '',
  ).slice(0, 8);
  return { jobPurpose: purpose, responsibilities, competencies };
}

/** First ~220 chars of a document as a clean single-line snippet. */
function snippet(doc: string | null, n = 220): string | null {
  if (!doc) return null;
  const clean = doc.replace(/\s+/g, ' ').trim();
  return clean.length > n ? `${clean.slice(0, n)}…` : clean;
}

/** Count non-empty labels, descending, top-N. */
function topCounts(values: (string | null)[], topN = 6): LabeledCount[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const name = v?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

/**
 * `job_family_topic_runs.diagnostics` — null bila kolomnya belum ada.
 *
 * Dibaca dengan kuerinya SENDIRI, bukan ikut di dalam select yang lain, dan itu
 * yang penting: kolom ini lahir dari migrasi 0062, sedangkan tiga pembaca di
 * berkas ini memerlukannya. Bila ia ikut dalam select utama, satu deployment
 * yang belum bermigrasi kehilangan SELURUH pembacaan hasil clustering — peta,
 * daftar famili, diagnosis — demi satu bidang tambahan yang tidak ada yang
 * benar-benar butuh. Terpisah begini, yang hilang hanyalah catatan mutunya.
 */
async function readRunDiagnostics(runId: string): Promise<JobFamilyRunDiagnostics | null> {
  if (!isUuid(runId)) return null;
  try {
    const rows = await db.execute(
      sql`SELECT diagnostics FROM job_family_topic_runs WHERE id = ${runId}::uuid LIMIT 1`,
    );
    const row = (rows as unknown as { rows?: { diagnostics?: unknown }[] }).rows?.[0] ??
      (rows as unknown as { diagnostics?: unknown }[])[0];
    return (row?.diagnostics as JobFamilyRunDiagnostics | null) ?? null;
  } catch {
    // Kolom belum ada (migrasi 0062 belum dijalankan) → tidak ada catatan mutu,
    // dan itu bukan kegagalan: sisa laporannya tetap lengkap.
    return null;
  }
}

/**
 * Run TERAKHIR YANG SELESAI, bukan run terakhir.
 *
 * Bedanya menentukan. `getLatestTopicRunAction` mengembalikan baris terbaru
 * apa pun statusnya, sehingga SATU run gagal — percobaan yang ditolak, layanan
 * yang sedang mati, atau run yang berhasil tetapi tertandai gagal karena kolom
 * yang belum ada — membuat setiap pembacaan hasil mentok selamanya, padahal ada
 * hasil bagus tepat di belakangnya. Prasyarat `topic_run_available` yang dilihat
 * planner justru sudah menyaring status 'completed' (`state/snapshot.ts`), jadi
 * memakai yang tidak tersaring di sisi eksekusi berarti planner diberi tahu
 * pekerjaan itu mungkin, lalu langkahnya mati saat dijalankan.
 */
export async function getLatestCompletedTopicRunAction(): Promise<TopicRunSummary | null> {
  await requirePermission('job_profiles.view');
  try {
    const tenantId = await getCurrentTenantId();
    const [r] = await db
      .select()
      .from(jobFamilyTopicRuns)
      .where(
        and(
          eq(jobFamilyTopicRuns.status, 'completed'),
          or(isNull(jobFamilyTopicRuns.tenantId), eq(jobFamilyTopicRuns.tenantId, tenantId)),
        ),
      )
      .orderBy(desc(jobFamilyTopicRuns.createdAt))
      .limit(1);
    return r ? toSummary(r) : null;
  } catch (err) {
    if (isTopicSchemaMissing(err)) return null;
    throw err;
  }
}

// ── Mengapa sebuah dokumen tetap menjadi outlier ────────────────────

/** Satu famili beserta kedekatannya ke dokumen yang sedang dijelaskan. */
export type NearestFamily = {
  topicId: number;
  label: string | null;
  generalTitle: string | null;
  /** Cosine dokumen ke centroid famili ini, ruang embedding asli (0..1). */
  similarity: number;
};

/**
 * Mengapa pipeline meninggalkan dokumen ini di luar.
 *
 * Dua sumbu yang sengaja dipisah, karena selama ini tercampur menjadi satu kata
 * "outlier" dan menutupi perbedaan yang paling penting bagi pembacanya:
 *
 *   blockedBy   — MEKANISME yang menahannya. Ini soal pengaturan, dan hampir
 *                 selalu dapat diubah.
 *   isolation   — SEBERAPA ASING isinya sesungguhnya. Ini soal dokumennya, dan
 *                 tidak berubah oleh pengaturan apa pun.
 *
 * Sebuah jabatan yang `blockedBy: 'rehoming_off'` tetapi `isolation: 'fringe'`
 * bukan jabatan aneh — ia hanya belum dipersilakan masuk. Sebuah jabatan yang
 * `isolation: 'isolated'` memang tidak menyerupai apa pun, dan memaksanya masuk
 * hanya memindahkan masalahnya ke dalam famili yang salah.
 */
// Tipe klasifikasinya TIDAK diteruskan dari sini. Berkas ini `'use server'`, dan
// transformasi server-action memperlakukan bentuk `export type { A, B }` sebagai
// ekspor runtime — yang lalu gagal dibangun karena tipe tidak ada saat runtime.
// Pemakai mengimpornya langsung dari lib/job-family/optimize/diagnose.ts.

export type OutlierExplanation = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  nearest: NearestFamily | null;
  runnerUp: NearestFamily | null;
  /** Selisih kemiripan famili terdekat dan kedua; kecil = terjepit di antaranya. */
  margin: number | null;
  blockedBy: OutlierBlockedBy;
  isolation: OutlierIsolation;
  /** Ambang terkecil yang akan memasukkannya (= kemiripan terdekatnya). */
  entersAtThreshold: number | null;
};

export type OutlierReport = {
  runId: string;
  /** Outlier yang terlihat oleh unit bisnis aktif — yang dijelaskan satu per satu. */
  outliers: OutlierExplanation[];
  /** Outlier se-run; berbeda dari panjang daftar di atas pada run global. */
  totalOutliersInRun: number;
  /** Pengaturan penempatan ulang yang BERLAKU pada run ini, bukan yang sekarang. */
  settings: {
    reduceOutliers: boolean;
    strategy: string | null;
    threshold: number | null;
    cascade: boolean;
  };
  /** Apa yang benar-benar dikerjakan langkah penempatan ulang pada run ini. */
  reduction: JobFamilyRunDiagnostics['outlierReduction'] | null;
};

/**
 * Alasan per dokumen, dihitung sekali untuk SELURUH outlier sebuah run.
 *
 * Sengaja bukan `getOutlierClusterDistancesAction` yang dipanggil berulang:
 * fungsi itu memuat vektor setiap anggota setiap famili pada TIAP panggilan, jadi
 * menjelaskan tujuh belas outlier akan membaca seluruh korpus tujuh belas kali.
 * Di sini centroid dibangun satu kali, lalu tiap outlier hanya sebuah perkalian
 * titik terhadapnya.
 *
 * Cakupannya sengaja PER TENANT, kebalikan dari `getRunQualityInputAction` yang
 * se-run. Bedanya bukan inkonsistensi melainkan konsekuensi: yang ini menyebut
 * NAMA JABATAN, dan nama milik unit bisnis lain tidak boleh terbaca dari sini.
 * Yang se-run hanya mengembalikan angka, sehingga aman dipakai menyetel
 * parameter yang memang berlaku global.
 */
export async function getOutlierExplanationsAction(
  runId?: string,
): Promise<OutlierReport | null> {
  await requirePermission('job_profiles.view');

  const run = runId
    ? await getTopicRunStatusAction(runId)
    : await getLatestCompletedTopicRunAction();
  if (!run) return null;

  const [assignRows, topicRows, runRow] = await Promise.all([
    db
      .select({
        jobProfileId: jobFamilyTopicAssignments.jobProfileId,
        positionName: jobFamilyTopicAssignments.positionName,
        divisionDepartment: jobFamilyTopicAssignments.divisionDepartment,
        topicId: jobFamilyTopicAssignments.topicId,
      })
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, run.runId)),
    db
      .select({
        topicId: jobFamilyTopics.topicId,
        label: jobFamilyTopics.label,
        generalTitle: jobFamilyTopics.generalTitle,
      })
      .from(jobFamilyTopics)
      .where(and(eq(jobFamilyTopics.runId, run.runId), ne(jobFamilyTopics.topicId, -1))),
    db
      .select({ config: jobFamilyTopicRuns.config })
      .from(jobFamilyTopicRuns)
      .where(eq(jobFamilyTopicRuns.id, run.runId))
      .limit(1),
  ]);
  const runDiagnostics = await readRunDiagnostics(run.runId);

  const allOutliers = assignRows.filter((a) => a.topicId === -1);
  const visibleIds = await visibleJobProfileIds(await getCurrentTenantId());
  const mine = allOutliers.filter((a) => visibleIds.has(a.jobProfileId));

  const cfg = (runRow[0]?.config ?? {}) as Partial<BertopicConfig>;
  const reduction = runDiagnostics?.outlierReduction ?? null;
  const settings = {
    reduceOutliers: Boolean(cfg.reduceOutliers),
    strategy: reduction?.strategy ?? cfg.outlierStrategy ?? null,
    threshold: reduction?.threshold ?? cfg.outlierThreshold ?? null,
    cascade: Boolean(reduction?.cascadeApplied ?? cfg.outlierCascade),
  };

  const empty: OutlierReport = {
    runId: run.runId,
    outliers: [],
    totalOutliersInRun: allOutliers.length,
    settings,
    reduction,
  };
  if (mine.length === 0 || topicRows.length === 0) return empty;

  // Satu kali baca: vektor tiap anggota famili nyata + vektor tiap outlier milik
  // unit bisnis ini.
  const memberIdsByTopic = new Map<number, number[]>();
  for (const a of assignRows) {
    if (a.topicId === -1) continue;
    const list = memberIdsByTopic.get(a.topicId) ?? [];
    list.push(a.jobProfileId);
    memberIdsByTopic.set(a.topicId, list);
  }
  const needed = Array.from(
    new Set([...assignRows.filter((a) => a.topicId !== -1).map((a) => a.jobProfileId), ...mine.map((a) => a.jobProfileId)]),
  );
  const embRows = needed.length
    ? await vectorDb
        .select({ jobProfileId: jobProfileEmbed.jobProfileId, embedding: jobProfileEmbed.embedding })
        .from(jobProfileEmbed)
        .where(inArray(jobProfileEmbed.jobProfileId, needed))
    : [];
  const vecByJp = new Map<number, number[]>();
  for (const r of embRows) {
    const raw = r.embedding as unknown;
    if (typeof raw !== 'string') continue;
    try {
      const v = parseVectorString(raw);
      if (v.length > 0) vecByJp.set(r.jobProfileId, v);
    } catch {
      // Vektor tak terbaca → dokumen ini tidak dapat dibandingkan; ditandai di bawah.
    }
  }

  const meta = new Map(topicRows.map((t) => [t.topicId, t]));
  const centroids = new Map<number, number[]>();
  for (const [topicId, members] of memberIdsByTopic) {
    const vecs = members.map((id) => vecByJp.get(id)).filter((v): v is number[] => v != null);
    if (vecs.length === 0) continue;
    const c = new Array<number>(vecs[0]!.length).fill(0);
    for (const v of vecs) for (let i = 0; i < v.length; i++) c[i]! += v[i]!;
    for (let i = 0; i < c.length; i++) c[i] = c[i]! / vecs.length;
    centroids.set(topicId, c);
  }

  const outliers: OutlierExplanation[] = mine.map((a) => {
    const vec = vecByJp.get(a.jobProfileId) ?? null;
    const ranked: NearestFamily[] = [];
    if (vec) {
      for (const [topicId, centroid] of centroids) {
        const sim = cosineBetween(vec, centroid);
        if (sim == null) continue;
        const t = meta.get(topicId);
        ranked.push({
          topicId,
          label: t?.label ?? null,
          generalTitle: t?.generalTitle ?? null,
          similarity: Math.round(sim * 1000) / 1000,
        });
      }
      ranked.sort((x, y) => y.similarity - x.similarity);
    }

    const nearest = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    const margin =
      nearest && runnerUp ? Math.round((nearest.similarity - runnerUp.similarity) * 1000) / 1000 : null;

    // Klasifikasinya tinggal di modul murni bersama sisa penalaran clustering —
    // dapat diuji tanpa basis data, dan ambangnya bernama alih-alih tersebar
    // sebagai angka telanjang di tengah percabangan.
    const { blockedBy, isolation } = classifyOutlier({
      nearestSimilarity: nearest?.similarity ?? null,
      margin,
      reduceOutliers: settings.reduceOutliers,
      threshold: settings.threshold,
    });

    return {
      jobProfileId: a.jobProfileId,
      positionName: a.positionName ?? null,
      divisionDepartment: a.divisionDepartment ?? null,
      nearest,
      runnerUp,
      margin,
      blockedBy,
      isolation,
      entersAtThreshold: nearest ? nearest.similarity : null,
    };
  });

  // Yang paling dekat lebih dulu: itulah yang paling mudah ditolong.
  outliers.sort((x, y) => (y.nearest?.similarity ?? -1) - (x.nearest?.similarity ?? -1));

  return { ...empty, outliers };
}

// ── Bahan diagnosis mutu run ────────────────────────────────────────

export type RunQualityInput = {
  runId: string;
  /** Dokumen yang masuk run — SELURUH korpus, bukan porsi tenant. */
  numDocuments: number;
  /** Ukuran tiap famili nyata (tanpa topik -1), se-run. */
  sizes: number[];
  /** Kemiripan tiap outlier ke famili terdekatnya; null pada run pra-0039. */
  outlierSimilarities: (number | null)[];
  diagnostics: JobFamilyRunDiagnostics | null;
};

/**
 * Angka mentah untuk menilai mutu sebuah run — sengaja TIDAK disaring per tenant.
 *
 * `getTopicResultsAction` menyaring ke dokumen milik unit bisnis aktif, dan itu
 * benar untuk MENAMPILKAN: kartu famili yang menyebut "42 jabatan" di atas tiga
 * baris yang terlihat adalah kebohongan kecil. Tetapi untuk MENDIAGNOSIS ia
 * salah, karena yang didiagnosis adalah pengelompokan yang berlaku global:
 * parameter yang disetel mengubah clustering seluruh korpus, dan famili yang
 * tampak "hanya beranggota dua" bagi satu unit bisnis bisa beranggota tiga puluh
 * pada kenyataannya. Menyarankan "naikkan ukuran minimum rumpun untuk membuang
 * famili kekecilan" atas dasar potongan pandangan itu adalah saran yang salah,
 * dan salahnya tidak akan pernah terlihat sebagai kesalahan.
 *
 * Yang dikembalikan hanya AGREGAT — jumlah, ukuran, dan sebaran kemiripan. Tidak
 * ada nama jabatan, tidak ada id dokumen, sehingga cakupan tenant tidak dilanggar
 * oleh apa pun yang dapat dibaca dari sini.
 */
export async function getRunQualityInputAction(runId: string): Promise<RunQualityInput | null> {
  await requirePermission('job_profiles.view');
  if (!isUuid(runId)) return null;

  const [runRow] = await db
    .select({ numDocuments: jobFamilyTopicRuns.numDocuments })
    .from(jobFamilyTopicRuns)
    .where(eq(jobFamilyTopicRuns.id, runId))
    .limit(1);
  if (!runRow) return null;

  const [topicRows, outlierRows] = await Promise.all([
    db
      .select({ topicId: jobFamilyTopics.topicId, size: jobFamilyTopics.size })
      .from(jobFamilyTopics)
      .where(and(eq(jobFamilyTopics.runId, runId), ne(jobFamilyTopics.topicId, -1))),
    db
      .select({ altSimilarity: jobFamilyTopicAssignments.altSimilarity })
      .from(jobFamilyTopicAssignments)
      .where(
        and(
          eq(jobFamilyTopicAssignments.runId, runId),
          eq(jobFamilyTopicAssignments.topicId, -1),
        ),
      ),
  ]);

  return {
    runId,
    numDocuments: runRow.numDocuments ?? 0,
    sizes: topicRows.map((t) => t.size),
    outlierSimilarities: outlierRows.map((r) => r.altSimilarity ?? null),
    diagnostics: await readRunDiagnostics(runId),
  };
}

// ── Position Distance Search (Family Tree feature) ──────────────────
//
// "Bandingkan 2 Profil Jabatan": how close are two job profiles — and, the part
// a bare cosine cannot answer, is that number CLOSE for this corpus? Sentence
// embeddings compress everything into a narrow band (job-profile documents here
// sit roughly 0.6–0.9 apart), so a fixed threshold reads almost every pair as
// "very similar" and the metric stops discriminating. The comparison is
// therefore ranked against each profile's OWN neighbourhood: where the other
// one places among all documents on the map, and what a median neighbour looks
// like. Everything else (family, incumbents, competencies) comes from the run
// payload the caller already holds — only the neighbourhood needs vectors.

/** One document in a profile's neighbourhood. */
export type NeighborProfile = {
  jobProfileId: number;
  positionName: string | null;
  /** Cosine to the profile whose neighbourhood this is (0..1). */
  similarity: number;
};

/** One side of the comparison, enriched from the run payload + the corpus. */
export type ComparedProfile = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  topicId: number;
  topicLabel: string | null;
  topicGeneralTitle: string | null;
  x: number | null;
  y: number | null;
  /** Membership strength in its own family (0..1); null on pre-0039 runs. */
  probability: number | null;
  incumbentCount: number;
  /** People currently matched to this profile (active tenant only). */
  incumbentNames: string[];
  jobPurpose: string | null;
  responsibilities: string[];
  competencies: string[];
  /** Rank of the OTHER profile among this one's neighbours (1 = nearest). */
  rankOfOther: number | null;
  /** How many other documents that rank was computed against. */
  neighborCount: number;
  /** Median cosine to the rest of the corpus — what "normal" looks like here. */
  medianSimilarity: number | null;
  /** Nearest other documents, the compared one excluded. */
  nearest: NeighborProfile[];
};

export type PositionDistanceResult = {
  pos1: ComparedProfile;
  pos2: ComparedProfile;
  /** Euclidean distance in 2D UMAP space (scatter plot). */
  umap2dDistance: number | null;
  /** Diagonal of the plotted area — the scale the distance above is read against. */
  umap2dSpan: number | null;
  /** Cosine similarity in embedding space (0..1, 1=identical). */
  cosineSimilarity: number | null;
  /** Share of the other documents that are LESS similar than this pair (0..100). */
  similarityPercentile: number | null;
  /** Both documents landed in the same job family. */
  sameFamily: boolean;
  /** Keywords carried by both families. */
  commonKeywords: TopicKeyword[];
  /** Keywords only one side's family carries — where the two diverge. */
  keywordsOnly1: TopicKeyword[];
  keywordsOnly2: TopicKeyword[];
  /** Technical competencies both job profiles demand. */
  sharedCompetencies: string[];
  competenciesOnly1: string[];
  competenciesOnly2: string[];
};

/** Fold a free-text term for set comparison: case, punctuation, spacing. */
function foldTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Every other document on the map, by cosine to `jobProfileId`, nearest first.
 * Ranked in Postgres via pgvector rather than by pulling several hundred vectors
 * into this process — which is what lets the panel afford a whole distribution
 * instead of a single pair.
 */
async function neighborhoodOf(
  jobProfileId: number,
  poolIds: number[],
): Promise<NeighborProfile[]> {
  const ids = poolIds.filter((id) => Number.isInteger(id) && id !== jobProfileId);
  if (ids.length === 0) return [];
  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  const res = await vectorDb.execute<{ jp: number; name: string | null; sim: number }>(sql`
    WITH src AS (
      SELECT embedding
        FROM job_profile_embed
       WHERE job_profile_id = ${jobProfileId}
         AND embedding IS NOT NULL
       LIMIT 1
    )
    SELECT e.job_profile_id AS jp,
           e.position_name  AS name,
           1 - (e.embedding <=> src.embedding) AS sim
      FROM job_profile_embed e CROSS JOIN src
     WHERE e.embedding IS NOT NULL
       AND e.job_profile_id <> ${jobProfileId}
       AND e.job_profile_id IN (${idList})
     ORDER BY sim DESC
  `);
  return (res.rows as Array<{ jp: number | string; name: string | null; sim: number | string }>)
    .map((r) => ({
      jobProfileId: Number(r.jp),
      positionName: r.name ?? null,
      similarity: Number(r.sim),
    }))
    .filter((n) => Number.isFinite(n.similarity));
}

/**
 * Untruncated facets for one job profile. `profileSummaryFrom` caps its lists
 * (5 responsibilities, 8 competencies) because it feeds a card; an overlap
 * computed against a capped list would understate what two roles share.
 */
function fullFacets(
  jobPurpose: string | null,
  extractedData: any,
): { jobPurpose: string | null; responsibilities: string[]; competencies: string[] } {
  const ed = extractedData ?? {};
  const purpose =
    (jobPurpose && jobPurpose.trim()) ||
    (typeof ed.jobPurpose === 'string' ? ed.jobPurpose.trim() : '') ||
    null;
  return {
    jobPurpose: purpose,
    responsibilities: asStringList(ed.responsibilities, (r) => r?.responsibility ?? r?.name ?? ''),
    competencies: asStringList(
      ed.technicalCompetencies,
      (c) => c?.competency ?? c?.name ?? c?.technicalName ?? '',
    ),
  };
}

/** Terms in `a` that no term in `b` matches, original casing preserved. */
function onlyIn(a: string[], b: string[]): string[] {
  const other = new Set(b.map(foldTerm).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of a) {
    const key = foldTerm(term);
    if (!key || other.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** Terms present on both sides, taking side A's casing. */
function sharedBetween(a: string[], b: string[]): string[] {
  const other = new Set(b.map(foldTerm).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of a) {
    const key = foldTerm(term);
    if (!key || !other.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * Compare two job profiles: embedding closeness read against each one's own
 * neighbourhood, their positions on the 2-D map, the families they landed in,
 * and what their job descriptions actually share.
 */
// Demo mode: purpose / responsibilities keep three words per point and incumbents' names become initials.
export async function getPositionDistanceAction(
  ...args: Parameters<typeof getPositionDistanceActionImpl>
): ReturnType<typeof getPositionDistanceActionImpl> {
  return demoScrub(await demoMaskJobProfileExcerpts(await getPositionDistanceActionImpl(...args)));
}

async function getPositionDistanceActionImpl(
  jobProfileId1: number,
  jobProfileId2: number,
  assignments: TopicAssignment[],
  topicResults: TopicResult[],
): Promise<PositionDistanceResult | null> {
  await requirePermission('job_profiles.view');

  const a1 = assignments.find((a) => a.jobProfileId === jobProfileId1);
  const a2 = assignments.find((a) => a.jobProfileId === jobProfileId2);
  if (!a1 || !a2) return null;

  const t1 = topicResults.find((t) => t.topicId === a1.topicId) ?? null;
  const t2 = topicResults.find((t) => t.topicId === a2.topicId) ?? null;

  // The neighbourhood pool is exactly what the map shows. Ranking against
  // documents the user cannot see would produce a position they cannot check.
  const poolIds = Array.from(
    new Set(assignments.map((a) => Number(a.jobProfileId)).filter((id) => Number.isInteger(id))),
  );

  const [nb1, nb2, profileRows] = await Promise.all([
    neighborhoodOf(jobProfileId1, poolIds).catch(() => [] as NeighborProfile[]),
    neighborhoodOf(jobProfileId2, poolIds).catch(() => [] as NeighborProfile[]),
    db
      .select({
        id: syncJobProfiles.id,
        jobPurpose: syncJobProfiles.jobPurpose,
        extractedData: syncJobProfiles.extractedData,
      })
      .from(syncJobProfiles)
      .where(inArray(syncJobProfiles.id, [jobProfileId1, jobProfileId2])),
  ]);

  const facetsById = new Map(
    profileRows.map((p) => [p.id, fullFacets(p.jobPurpose ?? null, p.extractedData)]),
  );
  const emptyFacets = {
    jobPurpose: null,
    responsibilities: [] as string[],
    competencies: [] as string[],
  };
  const f1 = facetsById.get(jobProfileId1) ?? emptyFacets;
  const f2 = facetsById.get(jobProfileId2) ?? emptyFacets;

  // Either direction answers the same question; take whichever side resolved.
  const cosineSim =
    nb1.find((n) => n.jobProfileId === jobProfileId2)?.similarity ??
    nb2.find((n) => n.jobProfileId === jobProfileId1)?.similarity ??
    null;

  // Rank of the other profile, and the share of the remaining documents it beat.
  const rankIn = (list: NeighborProfile[], otherId: number): number | null => {
    const i = list.findIndex((n) => n.jobProfileId === otherId);
    return i < 0 ? null : i + 1;
  };
  const rank1 = rankIn(nb1, jobProfileId2);
  const rank2 = rankIn(nb2, jobProfileId1);
  const pctFor = (rank: number | null, count: number): number | null =>
    rank == null || count < 2 ? null : ((count - rank) / (count - 1)) * 100;
  const pcts = [pctFor(rank1, nb1.length), pctFor(rank2, nb2.length)].filter(
    (v): v is number => v != null,
  );
  const similarityPercentile = pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null;

  // 2-D map distance, plus the diagonal of the plotted area so the raw number
  // can be read as a fraction of the map rather than an unanchored figure.
  let umap2d: number | null = null;
  if (a1.x != null && a1.y != null && a2.x != null && a2.y != null) {
    umap2d = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  }
  const xs = assignments.map((a) => a.x).filter((v): v is number => v != null);
  const ys = assignments.map((a) => a.y).filter((v): v is number => v != null);
  const umap2dSpan =
    xs.length > 1 && ys.length > 1
      ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      : null;

  // Family keywords: shared vocabulary, and what each side carries alone.
  const kw1 = t1?.keywords ?? [];
  const kw2 = t2?.keywords ?? [];
  const words1 = new Set(kw1.map((k) => k.word));
  const words2 = new Set(kw2.map((k) => k.word));
  const commonKeywords = kw1
    .filter((k) => words2.has(k.word))
    .sort((x, y) => y.score - x.score)
    .slice(0, 8);
  const keywordsOnly1 = kw1.filter((k) => !words2.has(k.word)).slice(0, 6);
  const keywordsOnly2 = kw2.filter((k) => !words1.has(k.word)).slice(0, 6);

  const memberOf = (t: TopicResult | null, jpId: number) =>
    t?.members.find((m) => m.jobProfileId === jpId) ?? null;
  const m1 = memberOf(t1, jobProfileId1);
  const m2 = memberOf(t2, jobProfileId2);

  const side = (
    a: TopicAssignment,
    t: TopicResult | null,
    m: TopicMember | null,
    facets: { jobPurpose: string | null; responsibilities: string[]; competencies: string[] },
    neighbors: NeighborProfile[],
    otherId: number,
    rankOfOther: number | null,
  ): ComparedProfile => ({
    jobProfileId: a.jobProfileId,
    positionName: a.positionName,
    divisionDepartment: a.divisionDepartment,
    topicId: a.topicId,
    topicLabel: t?.label ?? null,
    topicGeneralTitle: t?.generalTitle ?? null,
    x: a.x,
    y: a.y,
    probability: a.probability ?? m?.probability ?? null,
    incumbentCount: a.incumbentCount,
    incumbentNames: (m?.incumbents ?? [])
      .map((i) => i.candidateName)
      .filter((n): n is string => Boolean(n && n.trim())),
    jobPurpose: facets.jobPurpose ?? m?.summary.jobPurpose ?? null,
    responsibilities: facets.responsibilities.length
      ? facets.responsibilities
      : m?.summary.responsibilities ?? [],
    competencies: facets.competencies.length ? facets.competencies : m?.summary.competencies ?? [],
    rankOfOther,
    neighborCount: neighbors.length,
    medianSimilarity: medianOf(neighbors.map((n) => n.similarity)),
    nearest: neighbors.filter((n) => n.jobProfileId !== otherId).slice(0, 4),
  });

  return {
    pos1: side(a1, t1, m1, f1, nb1, jobProfileId2, rank1),
    pos2: side(a2, t2, m2, f2, nb2, jobProfileId1, rank2),
    umap2dDistance: umap2d,
    umap2dSpan,
    cosineSimilarity: cosineSim,
    similarityPercentile,
    sameFamily: a1.topicId === a2.topicId && a1.topicId !== -1,
    commonKeywords,
    keywordsOnly1,
    keywordsOnly2,
    sharedCompetencies: sharedBetween(f1.competencies, f2.competencies),
    competenciesOnly1: onlyIn(f1.competencies, f2.competencies),
    competenciesOnly2: onlyIn(f2.competencies, f1.competencies),
  };
}

// ── Manual mapping: add an outlier into an existing cluster ─────────
//
// The topic-service decides the clusters once per run; these actions let a
// human override one decision — mapping an outlier (topic -1) into a real
// family. The write mutates the run's assignment row (topic, centroid
// similarity, next-nearest alternative), so a rebuild of the map restores the
// algorithm's original answer. Distances are computed the same way the
// topic-service computed them: cosine of the document embedding against the
// cluster's MEAN member embedding, plus the 2-D UMAP distance to the cluster's
// stored centroid.

export type ClusterDistance = {
  topicId: number;
  label: string | null;
  generalTitle: string | null;
  /** Member count across the whole run (not tenant-filtered). */
  size: number;
  /** Cosine of the outlier's embedding to this cluster's member-embedding centroid (0..1). */
  cosineSimilarity: number | null;
  /** Euclidean distance in 2-D UMAP space from the outlier point to the cluster centroid. */
  umap2dDistance: number | null;
};

function parseVectorString(s: string): number[] {
  // pgvector text format: "[a,b,c,...]"
  return s
    .replace(/[\[\]]/g, '')
    .split(',')
    .map((x) => parseFloat(x.trim()));
}

function cosineBetween(a: number[] | null, b: number[] | null): number | null {
  if (!a || !b || a.length !== b.length || a.length === 0) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return null;
  return dot / Math.sqrt(na * nb);
}

/**
 * Shared math behind the manual-mapping popup and the assign action: the
 * outlier's embedding against each real cluster's mean member embedding
 * (cosine), plus the 2-D UMAP distance to each cluster's stored centroid.
 * Sorted nearest first; clusters without an embedding fall to the bottom.
 * Returns null when the profile isn't an outlier of this run.
 */
async function computeClusterDistances(
  runId: string,
  jobProfileId: number,
): Promise<ClusterDistance[] | null> {
  const [assignRows, topicRows] = await Promise.all([
    db
      .select({
        topicId: jobFamilyTopicAssignments.topicId,
        jobProfileId: jobFamilyTopicAssignments.jobProfileId,
        x: jobFamilyTopicAssignments.x,
        y: jobFamilyTopicAssignments.y,
      })
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, runId)),
    db
      .select({
        topicId: jobFamilyTopics.topicId,
        label: jobFamilyTopics.label,
        generalTitle: jobFamilyTopics.generalTitle,
        x: jobFamilyTopics.x,
        y: jobFamilyTopics.y,
      })
      .from(jobFamilyTopics)
      .where(and(eq(jobFamilyTopics.runId, runId), ne(jobFamilyTopics.topicId, -1))),
  ]);

  const outlier = assignRows.find((a) => a.jobProfileId === jobProfileId);
  if (!outlier || outlier.topicId !== -1) return null;

  // One round trip for every vector we need: the outlier doc + all members of
  // every real cluster (embeddings live behind VECTOR_DATABASE_URL).
  const allIds = Array.from(new Set(assignRows.filter((a) => a.topicId !== -1).map((a) => a.jobProfileId)));
  const embRows = allIds.length
    ? await vectorDb
        .select({ jobProfileId: jobProfileEmbed.jobProfileId, embedding: jobProfileEmbed.embedding })
        .from(jobProfileEmbed)
        .where(inArray(jobProfileEmbed.jobProfileId, allIds))
    : [];
  const embByJp = new Map<number, number[]>();
  for (const r of embRows) {
    try {
      const raw = r.embedding as unknown;
      if (typeof raw !== 'string') continue;
      const v = parseVectorString(raw);
      if (v.length > 0) embByJp.set(r.jobProfileId, v);
    } catch {
      // Unparsable vector → treated as missing (cosine falls back to null).
    }
  }
  const docVec = embByJp.get(jobProfileId) ?? null;

  const memberIdsByTopic = new Map<number, number[]>();
  for (const a of assignRows) {
    if (a.topicId === -1) continue;
    const list = memberIdsByTopic.get(a.topicId) ?? [];
    list.push(a.jobProfileId);
    memberIdsByTopic.set(a.topicId, list);
  }

  return topicRows
    .map((t) => {
      const members = memberIdsByTopic.get(t.topicId) ?? [];
      let centroid: number[] | null = null;
      const vecs = members
        .map((id) => embByJp.get(id))
        .filter((v): v is number[] => v != null && v.length > 0);
      if (vecs.length > 0) {
        centroid = new Array<number>(vecs[0]!.length).fill(0);
        for (const v of vecs) for (let i = 0; i < v.length; i++) centroid[i]! += v[i]!;
        for (let i = 0; i < centroid.length; i++) centroid[i] = centroid[i]! / vecs.length;
      }
      const umap2d =
        outlier.x != null && outlier.y != null && t.x != null && t.y != null
          ? Math.hypot(t.x - outlier.x, t.y - outlier.y)
          : null;
      return {
        topicId: t.topicId,
        label: t.label ?? null,
        generalTitle: t.generalTitle ?? null,
        size: members.length,
        cosineSimilarity: cosineBetween(docVec, centroid),
        umap2dDistance: umap2d,
      };
    })
    .sort((a, b) => (b.cosineSimilarity ?? -1) - (a.cosineSimilarity ?? -1));
}

/** Distances from one outlier job profile to every real cluster, nearest first. */
export async function getOutlierClusterDistancesAction(
  runId: string,
  jobProfileId: number,
): Promise<ClusterDistance[] | null> {
  await requirePermission('job_profiles.view');
  return computeClusterDistances(runId, jobProfileId);
}

export type AssignOutlierResult = { ok: boolean; message: string; topicId?: number };

/**
 * Manually move an outlier job profile into an existing cluster of the run.
 * Rewrites the assignment row: new topic, centroid similarity to the target,
 * and the next-nearest cluster as the new alternative. A map rebuild restores
 * the algorithm's original answer (this is an override, not a re-clustering).
 */
export async function assignOutlierToClusterAction(
  runId: string,
  jobProfileId: number,
  topicId: number,
): Promise<AssignOutlierResult> {
  await requirePermission('job_profiles.manage');

  const [assignRows, targetRows] = await Promise.all([
    db
      .select()
      .from(jobFamilyTopicAssignments)
      .where(
        and(
          eq(jobFamilyTopicAssignments.runId, runId),
          eq(jobFamilyTopicAssignments.jobProfileId, jobProfileId),
        ),
      )
      .limit(1),
    db
      .select({ topicId: jobFamilyTopics.topicId })
      .from(jobFamilyTopics)
      .where(and(eq(jobFamilyTopics.runId, runId), eq(jobFamilyTopics.topicId, topicId)))
      .limit(1),
  ]);

  const row = assignRows[0];
  if (!row) return { ok: false, message: 'Dokumen tidak ditemukan pada run ini.' };
  if (row.topicId !== -1) {
    return { ok: false, message: 'Hanya dokumen outlier yang dapat dipetakan manual.' };
  }
  if (!targetRows[0]) return { ok: false, message: 'Cluster tujuan tidak ditemukan pada run ini.' };

  // On a global run one unit must not be able to move another unit's document.
  const tenantId = await getCurrentTenantId();
  const visibleIds = await visibleJobProfileIds(tenantId);
  if (!visibleIds.has(jobProfileId)) {
    return { ok: false, message: 'Dokumen ini bukan milik unit bisnis Anda.' };
  }

  const distances = await computeClusterDistances(runId, jobProfileId);
  const target = distances?.find((d) => d.topicId === topicId) ?? null;
  const alt =
    distances?.find((d) => d.topicId !== topicId && d.cosineSimilarity != null) ?? null;

  await db
    .update(jobFamilyTopicAssignments)
    .set({
      topicId,
      probability: null,
      matchedKeywords: sql`'[]'::jsonb`,
      centroidSimilarity: target?.cosineSimilarity ?? null,
      altTopicId: alt?.topicId ?? null,
      altSimilarity: alt?.cosineSimilarity ?? null,
    })
    .where(
      and(
        eq(jobFamilyTopicAssignments.runId, runId),
        eq(jobFamilyTopicAssignments.jobProfileId, jobProfileId),
      ),
    );

  revalidatePath('/posisi/job-family');
  return { ok: true, message: 'Dokumen dipetakan manual ke cluster tujuan.', topicId };
}
