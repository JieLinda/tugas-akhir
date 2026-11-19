import 'server-only';

// Everything one job-family map's calculation-trace workbook is built from:
// the run row, its persisted families and assignments (what the map shows), the
// trace topic-service recorded while building it, the job profiles' raw
// extracted data, and the state of the database NOW — so the workbook can say
// both how the map was computed and whether it still describes what is embedded.
//
// Pure reads. Tenant scope: a run is readable from a business unit when it is
// global (tenant_id NULL) or that unit's own run — the same rule as the map.

import { gunzipSync } from 'node:zlib';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { vectorDb } from '@/lib/db/vector-db';
import {
  jobFamilyTopicAssignments,
  jobFamilyTopicRuns,
  jobFamilyTopics,
  jobFamilyTopicTraces,
  syncJobProfiles,
  type JobFamilyRunDiagnostics,
} from '@/lib/db/schema';
import { jobProfileEmbed } from '@/lib/db/vector-schema';
import { readCorpusSnapshot } from '@/lib/job-family/corpus';
import { hashExtracted, isSchemaMissing } from '@/lib/job-family/embed';
import type { JobFamilyConfig } from '@/lib/job-family/config';
import type { JobFamilyTrace } from './types';

export type TraceKeyword = { word: string; score: number };

export type JobFamilyTraceBundle = {
  run: {
    id: string;
    tenantId: string | null;
    status: string;
    createdAt: string;
    completedAt: string | null;
    numDocuments: number;
    numTopics: number;
    embeddingModel: string | null;
    configId: string | null;
    config: Record<string, unknown> | null;
    diagnostics: (JobFamilyRunDiagnostics & { trace?: { stored: boolean; bytes?: number; version?: number; error?: string } }) | null;
  };
  topics: {
    topicId: number;
    label: string | null;
    keywords: TraceKeyword[];
    size: number;
    representativeDocIds: number[];
    x: number | null;
    y: number | null;
    generalTitle: string | null;
    generalDescription: string | null;
  }[];
  /** In job_profile_id order — the order the pipeline clustered in. */
  assignments: {
    jobProfileId: number;
    positionName: string | null;
    divisionDepartment: string | null;
    topicId: number;
    probability: number | null;
    x: number | null;
    y: number | null;
    matchedKeywords: TraceKeyword[];
    centroidSimilarity: number | null;
    altTopicId: number | null;
    altSimilarity: number | null;
  }[];
  trace: JobFamilyTrace | null;
  traceStatus: { stored: boolean; reason: string | null; bytes: number | null; version: number | null };
  /** Raw source rows of the corpus documents (sync_job_profiles), by id. */
  profiles: Map<
    number,
    {
      fileName: string;
      jobProfileNumber: string | null;
      positionName: string | null;
      divisionDepartment: string | null;
      status: string;
      extractedData: unknown;
      extractedHash: string;
      syncedAt: string | null;
      processedAt: string | null;
    }
  >;
  /** The database as it is while the workbook is built. */
  now: {
    config: JobFamilyConfig;
    corpus: { fingerprint: string; documents: number; lastEmbeddedAt: string | null } | null;
    embeddingModels: { model: string | null; count: number }[];
    profileStatus: { status: string; count: number }[];
    /** Current stored document + embed provenance per id in the run's corpus. */
    embedded: Map<number, { docMd5: string; embMd5: string; embeddedAt: string | null }>;
  };
  tenantName: string | null;
  generatedAt: string;
};

function parseJson(v: unknown): any {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

const iso = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

const isMissingRelation = (err: unknown) =>
  Boolean(
    err &&
      typeof err === 'object' &&
      ((err as { code?: string }).code === '42P01' || /does not exist/i.test(String((err as Error).message))),
  );

async function readTrace(runId: string): Promise<{ trace: JobFamilyTrace | null; status: JobFamilyTraceBundle['traceStatus'] }> {
  try {
    const [row] = await db
      .select({ payload: jobFamilyTopicTraces.payload, version: jobFamilyTopicTraces.formatVersion, bytes: jobFamilyTopicTraces.byteSize })
      .from(jobFamilyTopicTraces)
      .where(eq(jobFamilyTopicTraces.runId, runId))
      .limit(1);
    if (!row) {
      return { trace: null, status: { stored: false, reason: 'Run ini tidak menyimpan jejak perhitungan (dibuat sebelum jejak dicatat, atau penyimpanannya gagal).', bytes: null, version: null } };
    }
    const json = gunzipSync(Buffer.from(row.payload)).toString('utf8');
    return { trace: JSON.parse(json) as JobFamilyTrace, status: { stored: true, reason: null, bytes: row.bytes, version: row.version } };
  } catch (err) {
    return {
      trace: null,
      status: {
        stored: false,
        reason: isMissingRelation(err)
          ? 'Tabel jejak belum ada (drizzle/0094 belum diterapkan).'
          : `Jejak tidak dapat dibaca: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300),
        bytes: null,
        version: null,
      },
    };
  }
}

export async function loadJobFamilyTraceBundle(
  runId: string,
  tenantId: string,
  config: JobFamilyConfig,
  tenantName: string | null,
): Promise<JobFamilyTraceBundle | null> {
  const [run] = await db.select().from(jobFamilyTopicRuns).where(eq(jobFamilyTopicRuns.id, runId)).limit(1);
  if (!run) return null;
  if (run.tenantId !== null && run.tenantId !== tenantId) return null;

  const [topicRows, assignRows, traced] = await Promise.all([
    db.select().from(jobFamilyTopics).where(eq(jobFamilyTopics.runId, runId)).orderBy(asc(jobFamilyTopics.topicId)),
    db
      .select()
      .from(jobFamilyTopicAssignments)
      .where(eq(jobFamilyTopicAssignments.runId, runId))
      .orderBy(asc(jobFamilyTopicAssignments.jobProfileId)),
    readTrace(runId),
  ]);

  const kw = (v: unknown): TraceKeyword[] =>
    Array.isArray(parseJson(v))
      ? (parseJson(v) as any[]).map((k) => ({ word: String(k?.word ?? ''), score: Number(k?.score ?? 0) }))
      : [];

  const ids = traced.trace
    ? traced.trace.corpus.meta.map((m) => m.jobProfileId)
    : assignRows.map((a) => a.jobProfileId);

  const profileRows = ids.length
    ? await db
        .select({
          id: syncJobProfiles.id,
          fileName: syncJobProfiles.fileName,
          jobProfileNumber: syncJobProfiles.jobProfileNumber,
          positionName: syncJobProfiles.positionName,
          divisionDepartment: syncJobProfiles.divisionDepartment,
          status: syncJobProfiles.status,
          extractedData: syncJobProfiles.extractedData,
          syncedAt: syncJobProfiles.syncedAt,
          processedAt: syncJobProfiles.processedAt,
        })
        .from(syncJobProfiles)
        .where(inArray(syncJobProfiles.id, ids))
    : [];
  const profiles: JobFamilyTraceBundle['profiles'] = new Map(
    profileRows.map((p) => [
      p.id,
      {
        fileName: p.fileName,
        jobProfileNumber: p.jobProfileNumber,
        positionName: p.positionName,
        divisionDepartment: p.divisionDepartment,
        status: p.status,
        extractedData: p.extractedData,
        extractedHash: hashExtracted(p.extractedData),
        syncedAt: iso(p.syncedAt),
        processedAt: iso(p.processedAt),
      },
    ]),
  );

  // The database now: corpus fingerprint (same formula the run recorded), the
  // models the stored vectors came from, how many profiles are in each state,
  // and each corpus document's current hashes — so a document re-embedded
  // since the run is named, not just counted.
  const statusRows = await db
    .select({ status: syncJobProfiles.status, count: sql<number>`count(*)::int` })
    .from(syncJobProfiles)
    .groupBy(syncJobProfiles.status);
  let corpusNow: JobFamilyTraceBundle['now']['corpus'] = null;
  let models: { model: string | null; count: number }[] = [];
  const embedded: JobFamilyTraceBundle['now']['embedded'] = new Map();
  try {
    corpusNow = await readCorpusSnapshot(run.tenantId === null ? null : ids);
    models = (
      await vectorDb
        .select({ model: jobProfileEmbed.embeddingModel, count: sql<number>`count(*)::int` })
        .from(jobProfileEmbed)
        .groupBy(jobProfileEmbed.embeddingModel)
    ).map((m) => ({ model: m.model, count: Number(m.count) }));
    if (ids.length) {
      const res = await vectorDb.execute(sql`
        SELECT job_profile_id AS id, md5(coalesce(document, '')) AS doc, md5(embedding::text) AS emb, updated_at
          FROM job_profile_embed
         WHERE embedding IS NOT NULL
           AND job_profile_id = ANY(ARRAY[${sql.join(ids.map((id) => sql`${id}`), sql`, `)}]::int[])
      `);
      const rows = ((res as unknown as { rows?: any[] }).rows ?? (res as unknown as any[])) as any[];
      for (const r of rows) embedded.set(Number(r.id), { docMd5: r.doc, embMd5: r.emb, embeddedAt: iso(r.updated_at) });
    }
  } catch (err) {
    if (!isSchemaMissing(err)) throw err;
  }

  return {
    run: {
      id: run.id,
      tenantId: run.tenantId,
      status: run.status,
      createdAt: iso(run.createdAt)!,
      completedAt: iso(run.completedAt),
      numDocuments: run.numDocuments,
      numTopics: run.numTopics,
      embeddingModel: run.embeddingModel,
      configId: run.configId,
      config: (parseJson(run.config) as Record<string, unknown> | null) ?? null,
      diagnostics: (parseJson(run.diagnostics) as JobFamilyTraceBundle['run']['diagnostics']) ?? null,
    },
    topics: topicRows.map((t) => ({
      topicId: t.topicId,
      label: t.label,
      keywords: kw(t.keywords),
      size: t.size,
      representativeDocIds: Array.isArray(parseJson(t.representativeDocIds)) ? (parseJson(t.representativeDocIds) as number[]).map(Number) : [],
      x: t.x,
      y: t.y,
      generalTitle: t.generalTitle,
      generalDescription: t.generalDescription,
    })),
    assignments: assignRows.map((a) => ({
      jobProfileId: a.jobProfileId,
      positionName: a.positionName,
      divisionDepartment: a.divisionDepartment,
      topicId: a.topicId,
      probability: a.probability,
      x: a.x,
      y: a.y,
      matchedKeywords: kw(a.matchedKeywords),
      centroidSimilarity: a.centroidSimilarity,
      altTopicId: a.altTopicId,
      altSimilarity: a.altSimilarity,
    })),
    trace: traced.trace,
    traceStatus: traced.status,
    profiles,
    now: {
      config,
      corpus: corpusNow,
      embeddingModels: models,
      profileStatus: statusRows.map((r) => ({ status: r.status, count: Number(r.count) })),
      embedded,
    },
    tenantName,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * What the export button on Pengaturan Job Family says about the run it would
 * export: which run, when it finished, and whether it stored a trace (a run
 * built before drizzle/0094 exports a short workbook that says so).
 */
export async function latestRunTraceSummary(
  tenantId: string,
): Promise<{ runId: string; completedAt: string | null; traceStored: boolean } | null> {
  const runId = await latestCompletedRunId(tenantId);
  if (!runId) return null;
  const [run] = await db
    .select({ completedAt: jobFamilyTopicRuns.completedAt })
    .from(jobFamilyTopicRuns)
    .where(eq(jobFamilyTopicRuns.id, runId))
    .limit(1);
  let traceStored = false;
  try {
    const [t] = await db
      .select({ runId: jobFamilyTopicTraces.runId })
      .from(jobFamilyTopicTraces)
      .where(eq(jobFamilyTopicTraces.runId, runId))
      .limit(1);
    traceStored = Boolean(t);
  } catch (err) {
    if (!isMissingRelation(err)) throw err;
  }
  return { runId, completedAt: iso(run?.completedAt), traceStored };
}

/** The run the map shows for a business unit: the newest COMPLETED run, global or its own. */
export async function latestCompletedRunId(tenantId: string): Promise<string | null> {
  try {
    const [r] = await db
      .select({ id: jobFamilyTopicRuns.id })
      .from(jobFamilyTopicRuns)
      .where(
        and(
          eq(jobFamilyTopicRuns.status, 'completed'),
          sql`(${jobFamilyTopicRuns.tenantId} IS NULL OR ${jobFamilyTopicRuns.tenantId} = ${tenantId})`,
        ),
      )
      .orderBy(sql`${jobFamilyTopicRuns.createdAt} DESC`)
      .limit(1);
    return r?.id ?? null;
  } catch (err) {
    if (isMissingRelation(err)) return null;
    throw err;
  }
}
