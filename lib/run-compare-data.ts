// ── Load a stored run into a `RunRecord` for the comparison (lib/run-compare.ts) ──
//
// Reads ONLY what the run stored — `scoring_runs` (config_snapshot, run_info,
// filter_summary), `scoring_run_pool_aspects`, `analysis_results`, plus the
// records humans added beside it (exclusion marks, forum decisions). Nothing
// is recomputed (FR-CMP-13), nothing reaches a model.
//
// A plain module, not 'use server': every function takes the tenant as an
// argument, which a server action must never accept from a client. The actions
// in lib/run-compare-actions.ts resolve the tenant themselves and call these.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { isDemoSql } from '@/lib/demo/run-mode';
import * as schema from '@/lib/db/schema';
import { isDemoMode } from '@/lib/app-mode';
import { maskNpk } from '@/lib/app-mode-shared';
import { forCurrentMode } from '@/lib/demo/store';
import { rerunSpec } from '@/lib/rerun-modes';
import { CRITERIA, type CriterionKey, type RunCandidate, type RunRecord } from '@/lib/run-compare';
import { configViewFrom, num, parseJson } from '@/lib/run-compare-config';

/**
 * NPK identity in SQL: numeric ids padded to 5 (`370` = `00370`), anything else
 * compared as written — LPAD would TRUNCATE a longer non-numeric id and fold
 * `MUL-2024-001` and `MUL-2999-999` into one `MUL-2`.
 */
const npk = (col: ReturnType<typeof sql>) =>
  sql`(CASE WHEN TRIM(${col}) ~ '^[0-9]+$' THEN LPAD(TRIM(${col}), 5, '0') ELSE TRIM(${col}) END)`;

const LEGACY_PREFIX = 'Mode lama: ';

/** A run as the comparison sees it, or null when it is not in `tenantId`. */
export async function loadRunRecord(runId: string, tenantId: string): Promise<RunRecord | null> {
  const runRes = await db.execute(sql`
    SELECT sr.id::text AS id, sr.position_id::text AS "positionId", sr.tenant_id::text AS "tenantId",
           sr.label, sr.method, sr.status, sr.created_at AS "createdAt", sr.completed_at AS "completedAt",
           sr.parent_run_id::text AS "parentRunId", sr.rerun_mode AS "rerunMode",
           to_jsonb(sr)->>'rerun_reason' AS "rerunReason",
           sr.config_snapshot AS "configSnapshot", sr.run_info AS "runInfo", sr.filter_summary AS "filterSummary",
           COALESCE(u.name, u.email) AS "createdByName"
      FROM scoring_runs sr
      LEFT JOIN users u ON u.id = sr.created_by
     WHERE sr.id = ${runId} AND sr.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
     LIMIT 1
  `);
  const run = (runRes.rows as any[])[0];
  if (!run) return null;

  // Lineage, root → this, tenant-scoped.
  const chainRes = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_run_id, 0 AS depth FROM scoring_runs WHERE id = ${runId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT p.id, p.parent_run_id, c.depth + 1
        FROM scoring_runs p JOIN chain c ON p.id = c.parent_run_id
       WHERE p.tenant_id = ${tenantId} AND c.depth < 200
    )
    SELECT id::text AS id FROM chain ORDER BY depth DESC
  `);
  const lineage = (chainRes.rows as { id: string }[]).map((r) => r.id);

  const [poolRows, resultRows, exclusions, picks] = await Promise.all([
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
    db
      .select({
        candidateId: schema.scoringRunExclusions.candidateId,
        reason: schema.scoringRunExclusions.reason,
        note: schema.scoringRunExclusions.note,
      })
      .from(schema.scoringRunExclusions)
      .where(and(eq(schema.scoringRunExclusions.runId, runId), eq(schema.scoringRunExclusions.tenantId, tenantId))),
    db
      .select({
        candidateId: schema.positionPicks.candidateId,
        notes: schema.positionPicks.notes,
        programCode: schema.positionPicks.programCode,
      })
      .from(schema.positionPicks)
      .where(eq(schema.positionPicks.runId, runId)),
  ]);

  const resultById = new Map(resultRows.map((r) => [r.candidateId, r]));
  const ids = [...new Set([...poolRows.map((r) => r.candidateId), ...resultRows.map((r) => r.candidateId)])];
  const candRows = ids.length
    ? await db
        .select({
          id: schema.candidates.id,
          name: schema.candidates.name,
          tenantId: schema.candidates.tenantId,
          employeeId: schema.candidates.employeeId,
          deletedAt: schema.candidates.deletedAt,
        })
        .from(schema.candidates)
        .where(inArray(schema.candidates.id, ids))
    : [];
  // Demo mode names each candidate by their demo copy (lib/demo/); no NPK leaves.
  const demoView = await isDemoMode();
  const shownCandRows = demoView
    ? (await forCurrentMode(candRows, (c) => c.id, { onlyOn: false })).map((c) => ({ ...c, employeeId: maskNpk(c.employeeId) || null }))
    : candRows;
  const candById = new Map(shownCandRows.map((c) => [c.id, c]));
  // Business-unit names from the table, not lib/tenant.ts (server-only), so the
  // reproducibility script can load runs outside Next.
  const tenantRows = await db.select({ id: schema.tenants.id, name: schema.tenants.name }).from(schema.tenants);
  const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]));

  // Who holds the position NOW, for "kini pejabat" in the membership reasons.
  const holderRes = ids.length
    ? await db.execute(sql`
        SELECT c.id::text AS id FROM candidates c
          JOIN critical_positions cp ON cp.id = ${run.positionId}
         WHERE c.id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})
           AND c.employee_id IS NOT NULL AND TRIM(c.employee_id) <> ''
           AND (${npk(sql`cp.holder_employee_id`)} = ${npk(sql`c.employee_id`)}
             OR EXISTS (SELECT 1 FROM critical_position_holders h
                         WHERE h.position_id = cp.id
                           AND ${npk(sql`h.employee_id`)} = ${npk(sql`c.employee_id`)}))
      `)
    : { rows: [] };
  const incumbentsNow = new Set((holderRes.rows as { id: string }[]).map((r) => r.id));

  const rerun = parseJson(run.configSnapshot)?.rerun ?? null;
  const addedById = new Map<string, any>(
    Array.isArray(rerun?.added) ? rerun.added.map((a: any) => [a.candidateId, a]) : [],
  );
  const exclusionById = new Map(exclusions.map((e) => [e.candidateId, e]));
  const pickById = new Map(picks.map((p) => [p.candidateId, p]));
  const toCandidate = (input: {
    candidateId: string;
    aspects: Record<CriterionKey, number>;
    storedCloseness: number;
    fullCloseness: number | null;
    storedRank: number;
    isFinalist: boolean;
    provisional: boolean;
  }): RunCandidate => {
    const res = resultById.get(input.candidateId);
    const det = parseJson(res?.details);
    const ahp = det?.ahpTopsis ?? null;
    const added = addedById.get(input.candidateId);
    const cand = candById.get(input.candidateId);
    const excl = exclusionById.get(input.candidateId);
    const pick = pickById.get(input.candidateId);
    return {
      candidateId: input.candidateId,
      name: cand?.name ?? det?.name ?? 'Kandidat',
      unit: cand ? tenantName.get(cand.tenantId) ?? null : null,
      aspects: input.aspects,
      storedCloseness: input.storedCloseness,
      fullCloseness: input.fullCloseness,
      storedRank: input.storedRank,
      isFinalist: input.isFinalist,
      listed: Boolean(res),
      readiness: typeof det?.readiness === 'string' ? det.readiness : null,
      provisional: input.provisional || ahp?.provisional === true,
      markers: {
        comparison: Boolean(added) || ahp?.rerunMarkers?.comparison === true,
        existingPool: added?.classification === 'existing_pool' || ahp?.rerunSource === 'existing_pool',
        newlyScored: added?.classification === 'new' || ahp?.rerunSource === 'new',
        enteredTopN: ahp?.rerunMarkers?.enteredTopN === true,
        leftTopN: ahp?.rerunMarkers?.leftTopN === true,
        outOfRange: added?.outOfRange === true,
      },
      excluded: excl ? { reason: excl.reason, note: excl.note } : null,
      decision: pick ? { notes: pick.notes, programCode: pick.programCode } : null,
    };
  };

  const readAspects = (raw: any): Record<CriterionKey, number> => {
    const a = parseJson(raw) ?? {};
    return Object.fromEntries(CRITERIA.map((k) => [k, num(a[k]) ?? 0])) as Record<CriterionKey, number>;
  };

  let pool: RunCandidate[];
  let poolSource: RunRecord['poolSource'];
  if (poolRows.length > 0) {
    poolSource = 'pool_snapshot';
    pool = poolRows.map((r) => {
      const details = parseJson(r.details) ?? {};
      return toCandidate({
        candidateId: r.candidateId,
        aspects: readAspects(r.aspects),
        storedCloseness: Number(r.closeness),
        fullCloseness: num(details?.topsis?.closeness),
        storedRank: Number(r.poolRank),
        isFinalist: Boolean(r.isFinalist),
        provisional: details?.provisional === true,
      });
    });
  } else if (resultRows.length > 0) {
    // A run without a pool snapshot (an old run): its listed
    // rows only. Comparable on ranks and scores; not replayable.
    poolSource = 'finalists_only';
    pool = resultRows.map((r) => {
      const det = parseJson(r.details) ?? {};
      return toCandidate({
        candidateId: r.candidateId,
        aspects: readAspects(det.scoreBreakdown),
        storedCloseness: Number(r.finalScore),
        fullCloseness: null,
        storedRank: Number(r.rank),
        isFinalist: !(det?.ahpTopsis?.belowFinalistCut === true),
        provisional: det?.ahpTopsis?.provisional === true,
      });
    });
  } else {
    poolSource = 'none';
    pool = [];
  }
  pool.sort((x, y) => x.storedRank - y.storedRank);

  const fs = parseJson(run.filterSummary) ?? {};
  const disqualified = new Map<string, string[]>(
    Array.isArray(fs.disqualified)
      ? fs.disqualified.map((d: any) => [String(d.candidateId), Array.isArray(d.reasons) ? d.reasons.map(String) : []])
      : [],
  );
  const spec = rerunSpec(run.rerunMode);
  const isChild = Boolean(run.parentRunId) || spec.mode !== 'baseline';
  return {
    id: run.id,
    positionId: run.positionId,
    tenantId: run.tenantId,
    label: run.label,
    method: run.method,
    status: run.status,
    createdAt: new Date(run.createdAt).toISOString(),
    completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
    createdByName: run.createdByName ?? null,
    parentRunId: run.parentRunId,
    rerunMode: spec.mode,
    rerunReason: run.rerunReason ?? null,
    legacy: spec.legacy,
    modeLabel: spec.legacy ? `${LEGACY_PREFIX}${spec.label}` : spec.label,
    lineage,
    config: configViewFrom({
      isChild,
      configSnapshot: parseJson(run.configSnapshot),
      runInfo: parseJson(run.runInfo),
      filterSummary: fs,
      finalistCount: poolSource === 'pool_snapshot' ? pool.filter((c) => c.isFinalist).length : null,
    }),
    pool,
    poolSource,
    disqualified,
    deletedNow: new Set(candRows.filter((c) => c.deletedAt != null).map((c) => c.id)),
    incumbentsNow,
  };
}

/** Runs of one position, newest first, for the A/B pickers (FR-RH-03, FR-CMP-01). */
export async function listPositionRuns(positionId: string, tenantId: string) {
  const res = await db.execute(sql`
    SELECT sr.id::text AS id, sr.label, sr.method, sr.status, sr.rerun_mode AS "rerunMode",
           sr.parent_run_id::text AS "parentRunId", sr.created_at AS "createdAt",
           sr.completed_at AS "completedAt",
           EXISTS (SELECT 1 FROM scoring_run_pool_aspects p WHERE p.run_id = sr.id) AS "hasPool"
      FROM scoring_runs sr
      JOIN critical_positions cp ON cp.id = sr.position_id
     WHERE sr.position_id = ${positionId} AND cp.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
     ORDER BY sr.created_at DESC
  `);
  return (res.rows as any[]).map((r) => {
    const spec = rerunSpec(r.rerunMode);
    const comparable = r.method === 'AHP_TOPSIS' && r.status === 'completed';
    return {
      id: r.id as string,
      label: (r.label as string | null) ?? null,
      method: r.method as string,
      status: r.status as string,
      mode: spec.mode,
      modeLabel: spec.legacy ? `${LEGACY_PREFIX}${spec.label}` : spec.label,
      legacy: spec.legacy,
      parentRunId: (r.parentRunId as string | null) ?? null,
      createdAt: new Date(r.createdAt).toISOString(),
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      hasPool: Boolean(r.hasPool),
      comparable,
      notComparableReason: comparable
        ? null
        : r.method !== 'AHP_TOPSIS'
          ? 'Run ini bukan AHP + TOPSIS, jadi tidak punya matriks keputusan per kriteria untuk dibandingkan secara terstruktur.'
          : 'Run belum selesai.',
    };
  });
}
