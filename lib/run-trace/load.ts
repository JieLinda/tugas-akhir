import 'server-only';

// Everything the "Unduh trace perhitungan (XLSX)" workbook is built from, read
// for ONE run in ONE tenant. Like the run comparison's loader it reads only what
// the run stored — scoring_runs (config_snapshot, run_info, filter_summary), the
// pool snapshot, the listed results, the two trace stages (drizzle/0092) and the
// census distributions the trace points at. Nothing is recomputed and nothing
// reaches a model: the workbook RE-DERIVES the numbers with Excel formulas, and
// it can only be trusted to do that if its inputs are the run's own.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isDemoSql } from '@/lib/demo/run-mode';
import { isDemoMode } from '@/lib/app-mode';
import { loadDemoCopies } from '@/lib/demo/store';
import { pseudonymizeIdentifiers } from '@/lib/demo/pseudonymize';
import * as schema from '@/lib/db/schema';
import { decryptOrNull, ensureUnlocked } from '@/lib/crypto/key-store';
import { decryptCandidateRows } from '@/lib/candidate-crypto';
import { rerunSpec } from '@/lib/rerun-modes';
import type {
  CensusKind,
  CensusPayloadByKind,
  CensusRef,
  EngineTrace,
  PoolTrace,
} from '../../scoring-service/src/run-trace-types';
import { demoInitialsById, demoScrub } from '@/lib/demo/names';

export type TraceStageStatus = {
  /** A row exists for this stage. */
  stored: boolean;
  /** It could be opened and parsed. */
  readable: boolean;
  sealed: boolean;
  bytes: number | null;
  /** Why it is missing or unreadable, in the operator's language. */
  reason: string | null;
};

export type RunTraceBundle = {
  run: {
    id: string;
    positionId: string;
    tenantId: string;
    label: string | null;
    method: string;
    status: string;
    createdAt: string;
    completedAt: string | null;
    createdByName: string | null;
    parentRunId: string | null;
    rerunMode: string;
    rerunModeLabel: string;
    rerunReason: string | null;
    positionTitle: string | null;
    tenantName: string | null;
    programName: string | null;
  };
  configSnapshot: any | null;
  runInfo: any | null;
  filterSummary: any | null;
  candidates: Map<string, { name: string; employeeId: string | null; unit: string | null; deleted: boolean }>;
  pool: {
    candidateId: string;
    poolRank: number;
    closeness: number;
    isFinalist: boolean;
    aspects: Record<string, number>;
    details: any;
  }[];
  results: { candidateId: string; rank: number; finalScore: number; details: any }[];
  engineTrace: EngineTrace | null;
  engineTraceStatus: TraceStageStatus;
  poolTrace: PoolTrace | null;
  poolTraceStatus: TraceStageStatus;
  census: Partial<{ [K in CensusKind]: { fingerprint: string; createdAt: string; payload: CensusPayloadByKind[K] } }>;
  /** Census refs the trace names but the table does not hold (never measured, or 0092 missing). */
  censusMissing: CensusRef[];
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

const isMissingRelation = (err: unknown) =>
  Boolean(err && typeof err === 'object' && ((err as { code?: string }).code === '42P01' || /does not exist/i.test(String((err as Error).message))));

async function readTraceStage(
  runId: string,
  tenantId: string,
  stage: 'pool' | 'engine',
): Promise<{ trace: any | null; status: TraceStageStatus }> {
  let row: { payload: string; sealed: boolean; byteSize: number } | undefined;
  try {
    [row] = await db
      .select({
        payload: schema.scoringRunTraces.payload,
        sealed: schema.scoringRunTraces.sealed,
        byteSize: schema.scoringRunTraces.byteSize,
      })
      .from(schema.scoringRunTraces)
      .where(
        and(
          eq(schema.scoringRunTraces.runId, runId),
          eq(schema.scoringRunTraces.tenantId, tenantId),
          eq(schema.scoringRunTraces.stage, stage),
        ),
      )
      .limit(1);
  } catch (err) {
    return {
      trace: null,
      status: {
        stored: false,
        readable: false,
        sealed: false,
        bytes: null,
        reason: isMissingRelation(err)
          ? 'Tabel jejak belum ada di database ini (drizzle/0092 belum diterapkan).'
          : `Jejak tidak dapat dibaca: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  if (!row) {
    return {
      trace: null,
      status: {
        stored: false,
        readable: false,
        sealed: false,
        bytes: null,
        reason:
          stage === 'engine'
            ? 'Run ini tidak menyimpan jejak engine — dihitung sebelum penyimpanan jejak ada, atau kunci enkripsi scoring-service terkunci saat run selesai (lihat run_info.trace).'
            : 'Run ini tidak menyimpan jejak pembentukan pool — run turunan (pool-nya pool induk + kandidat pembanding), atau dibuat sebelum penyimpanan jejak ada.',
      },
    };
  }
  const opened = decryptOrNull(row.payload);
  if (opened.locked || opened.error || !opened.value) {
    return {
      trace: null,
      status: {
        stored: true,
        readable: false,
        sealed: row.sealed,
        bytes: row.byteSize,
        reason: opened.locked
          ? 'Jejak tersimpan terenkripsi dan kunci data aplikasi sedang terkunci.'
          : `Jejak tersimpan tetapi gagal dibuka: ${opened.error ?? 'isi kosong'}`,
      },
    };
  }
  const trace = parseJson(opened.value);
  const okShape = trace && trace.stage === stage;
  return {
    trace: okShape ? trace : null,
    status: {
      stored: true,
      readable: Boolean(okShape),
      sealed: row.sealed,
      bytes: row.byteSize,
      reason: okShape ? null : 'Isi jejak tidak dikenali.',
    },
  };
}

function censusRefsOf(trace: EngineTrace | null): CensusRef[] {
  if (!trace) return [];
  const refs: CensusRef[] = [];
  if (trace.technical?.census) refs.push(trace.technical.census);
  for (const r of trace.career?.census ?? []) refs.push(r);
  if (trace.career?.depth?.census) refs.push(trace.career.depth.census);
  if (trace.career?.idf?.census) refs.push(trace.career.idf.census);
  return refs;
}

/** The bundle for `runId`, or null when the run is not in `tenantId`. */
export async function loadRunTraceBundle(runId: string, tenantId: string): Promise<RunTraceBundle | null> {
  const bundle = await loadRunTraceBundleRaw(runId, tenantId);
  return bundle && (await isDemoMode()) ? presentTraceBundleForDemo(bundle) : bundle;
}

/**
 * A demo run's trace as demo mode exports it: candidates named by their demo
 * copies, and every NPK and code replaced by a stable pseudonym
 * (lib/demo/pseudonymize.ts) — not the screen's fixed mark, because the
 * workbook's formulas join and compare on these values.
 */
async function presentTraceBundleForDemo(bundle: RunTraceBundle): Promise<RunTraceBundle> {
  const [copies, initials] = await Promise.all([
    loadDemoCopies(Array.from(bundle.candidates.keys())),
    demoInitialsById(),
  ]);
  // Every candidate is named by their unique initials (lib/demo/names.ts) —
  // set by id so namesakes stay apart; unique, so a formula that joins on the
  // name still finds exactly one row. Names elsewhere in the bundle (snapshot
  // lists, narratives) go through the same scrub.
  const named = Object.fromEntries(
    Array.from(bundle.candidates.entries()).map(([id, c]) => [
      id,
      { ...c, name: initials?.get(id) ?? copies.get(id)?.name ?? c.name },
    ]),
  );
  const { value } = pseudonymizeIdentifiers(await demoScrub({ ...bundle, candidates: named }));
  return { ...value, candidates: new Map(Object.entries(value.candidates)) } as RunTraceBundle;
}

async function loadRunTraceBundleRaw(runId: string, tenantId: string): Promise<RunTraceBundle | null> {
  const runRes = await db.execute(sql`
    SELECT sr.id::text AS id, sr.position_id::text AS "positionId", sr.tenant_id::text AS "tenantId",
           sr.label, sr.method, sr.status, sr.created_at AS "createdAt", sr.completed_at AS "completedAt",
           sr.parent_run_id::text AS "parentRunId", sr.rerun_mode AS "rerunMode",
           to_jsonb(sr)->>'rerun_reason' AS "rerunReason",
           sr.config_snapshot AS "configSnapshot", sr.run_info AS "runInfo", sr.filter_summary AS "filterSummary",
           COALESCE(u.name, u.email) AS "createdByName",
           cp.title AS "positionTitle", t.name AS "tenantName"
      FROM scoring_runs sr
      LEFT JOIN users u ON u.id = sr.created_by
      LEFT JOIN critical_positions cp ON cp.id = sr.position_id
      LEFT JOIN tenants t ON t.id = sr.tenant_id
     WHERE sr.id = ${runId} AND sr.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
     LIMIT 1
  `);
  const run = (runRes.rows as any[])[0];
  if (!run) return null;
  await ensureUnlocked().catch(() => false);

  const configSnapshot = parseJson(run.configSnapshot);
  let runInfo = parseJson(run.runInfo);
  if (!runInfo) {
    // Older runs kept their diagnostics only on the session (see run_info's doc).
    const s = await db.execute(sql`
      SELECT final_ranked->'runInfo' AS "runInfo" FROM tournament_sessions
       WHERE run_id = ${runId} AND final_ranked ? 'runInfo'
       ORDER BY updated_at DESC LIMIT 1
    `);
    runInfo = parseJson((s.rows as any[])[0]?.runInfo) ?? null;
  }

  const [poolRows, resultRows, engine, pool] = await Promise.all([
    db
      .select({
        candidateId: schema.scoringRunPoolAspects.candidateId,
        poolRank: schema.scoringRunPoolAspects.poolRank,
        closeness: schema.scoringRunPoolAspects.closeness,
        isFinalist: schema.scoringRunPoolAspects.isFinalist,
        aspects: schema.scoringRunPoolAspects.aspects,
        details: schema.scoringRunPoolAspects.details,
      })
      .from(schema.scoringRunPoolAspects)
      .where(eq(schema.scoringRunPoolAspects.runId, runId)),
    db
      .select({
        candidateId: schema.analysisResults.candidateId,
        rank: schema.analysisResults.rank,
        finalScore: schema.analysisResults.finalScore,
        details: schema.analysisResults.details,
      })
      .from(schema.analysisResults)
      .where(eq(schema.analysisResults.runId, runId)),
    readTraceStage(runId, tenantId, 'engine'),
    readTraceStage(runId, tenantId, 'pool'),
  ]);

  const engineTrace = engine.trace as EngineTrace | null;
  const poolTrace = pool.trace as PoolTrace | null;

  // Everyone the run (or its trace) names, decrypted once.
  const ids = new Set<string>([...poolRows.map((r) => r.candidateId), ...resultRows.map((r) => r.candidateId)]);
  for (const id of Object.keys(engineTrace?.candidates ?? {})) ids.add(id);
  for (const g of poolTrace?.gate ?? []) ids.add(g.candidateId);
  const idList = [...ids];
  const candRows = idList.length
    ? decryptCandidateRows(
        await db
          .select({
            id: schema.candidates.id,
            name: schema.candidates.name,
            tenantId: schema.candidates.tenantId,
            employeeId: schema.candidates.employeeId,
            deletedAt: schema.candidates.deletedAt,
          })
          .from(schema.candidates)
          .where(inArray(schema.candidates.id, idList)),
      )
    : [];
  const tenantRows = await db.select({ id: schema.tenants.id, name: schema.tenants.name }).from(schema.tenants);
  const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]));
  const candidates = new Map(
    candRows.map((c) => [
      c.id,
      {
        name: c.name ?? 'Kandidat',
        employeeId: c.employeeId ?? null,
        unit: tenantName.get(c.tenantId) ?? null,
        deleted: c.deletedAt != null,
      },
    ]),
  );

  // Census distributions the trace points at — shared rows, no candidate data.
  const census: RunTraceBundle['census'] = {};
  const censusMissing: CensusRef[] = [];
  const refs = censusRefsOf(engineTrace);
  if (refs.length > 0) {
    try {
      const rows = await db
        .select({
          kind: schema.scoringCensusSnapshots.kind,
          fingerprint: schema.scoringCensusSnapshots.fingerprint,
          payload: schema.scoringCensusSnapshots.payload,
          createdAt: schema.scoringCensusSnapshots.createdAt,
        })
        .from(schema.scoringCensusSnapshots)
        .where(inArray(schema.scoringCensusSnapshots.fingerprint, refs.map((r) => r.fingerprint)));
      for (const ref of refs) {
        const hit = rows.find((r) => r.kind === ref.kind && r.fingerprint === ref.fingerprint);
        if (hit) {
          (census as any)[ref.kind] = {
            fingerprint: hit.fingerprint,
            createdAt: new Date(hit.createdAt).toISOString(),
            payload: parseJson(hit.payload),
          };
        } else {
          censusMissing.push(ref);
        }
      }
    } catch {
      censusMissing.push(...refs);
    }
  }

  const spec = rerunSpec(run.rerunMode);
  return {
    run: {
      id: run.id,
      positionId: run.positionId,
      tenantId: run.tenantId,
      label: run.label ?? null,
      method: run.method,
      status: run.status,
      createdAt: new Date(run.createdAt).toISOString(),
      completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
      createdByName: run.createdByName ?? null,
      parentRunId: run.parentRunId ?? null,
      rerunMode: spec.mode,
      rerunModeLabel: spec.legacy ? `Mode lama: ${spec.label}` : spec.label,
      rerunReason: run.rerunReason ?? null,
      positionTitle: run.positionTitle ?? null,
      tenantName: run.tenantName ?? null,
      programName: configSnapshot?.template?.name ?? null,
    },
    configSnapshot,
    runInfo,
    filterSummary: parseJson(run.filterSummary),
    candidates,
    pool: poolRows.map((r) => ({
      candidateId: r.candidateId,
      poolRank: Number(r.poolRank),
      closeness: Number(r.closeness),
      isFinalist: Boolean(r.isFinalist),
      aspects: (parseJson(r.aspects) ?? {}) as Record<string, number>,
      details: parseJson(r.details) ?? {},
    })),
    results: resultRows.map((r) => ({
      candidateId: r.candidateId,
      rank: Number(r.rank),
      finalScore: Number(r.finalScore),
      details: parseJson(r.details) ?? {},
    })),
    engineTrace,
    engineTraceStatus: engine.status,
    poolTrace,
    poolTraceStatus: pool.status,
    census,
    censusMissing,
    generatedAt: new Date().toISOString(),
  };
}
