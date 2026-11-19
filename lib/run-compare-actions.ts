'use server';

// ── Server actions for the 1:1 run comparison and the reproducibility check ──
//
// Every action resolves the tenant itself and passes it to the loaders
// (lib/run-compare-data.ts), which read nothing outside it (NFR-RR-07). A pair
// on two positions is refused here, on the server (I-5, FR-CMP-01), whatever
// the page offered.

import { isDemoMode } from '@/lib/app-mode';
import { pseudonymizeIdentifiers } from '@/lib/demo/pseudonymize';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { requirePermission } from '@/lib/rbac';
import { getCurrentTenantId } from '@/lib/tenant';
import { listPositionRuns, loadRunRecord } from '@/lib/run-compare-data';
import { parseJson } from '@/lib/run-compare-config';
import { comparabilityError, compareRuns, replayRun, verifyRunReproducibility, type ReproducibilityResult, type RunConfigView } from '@/lib/run-compare';
import { explainComparison } from '@/lib/run-compare-explain';
import {
  toComparisonDto,
  toRunBreakdownDto,
  type ComparisonDto,
  type RunBreakdownDto,
} from '@/lib/run-compare-dto';
import { demoScrub } from '@/lib/demo/names';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunComparisonResult = { ok: true; comparison: ComparisonDto } | { ok: false; reason: string };

/**
 * Compare run A (pembanding) with run B (yang dibandingkan): same tenant, same
 * target position, any trees, legacy-mode runs included. LLM runs have no
 * decision matrix to compare per criterion, and say so.
 */
// Demo mode: names — in the ranking and inside the generated sentences — leave the server as initials.
export async function getRunComparisonAction(
  ...args: Parameters<typeof getRunComparisonActionImpl>
): ReturnType<typeof getRunComparisonActionImpl> {
  return demoScrub(await getRunComparisonActionImpl(...args));
}

async function getRunComparisonActionImpl(input: {
  aRunId: string;
  bRunId: string;
}): Promise<RunComparisonResult> {
  await requirePermission('positions.view');
  if (!UUID.test(input.aRunId ?? '') || !UUID.test(input.bRunId ?? '')) {
    return { ok: false, reason: 'Pilih dua run untuk dibandingkan.' };
  }
  const tenantId = await getCurrentTenantId();
  const [a, b] = await Promise.all([loadRunRecord(input.aRunId, tenantId), loadRunRecord(input.bRunId, tenantId)]);
  const refused = comparabilityError(a, b);
  if (refused || !a || !b) return { ok: false, reason: refused ?? 'Run tidak ditemukan di Company ini.' };
  const comparison = compareRuns(a, b);
  return { ok: true, comparison: toComparisonDto(comparison, explainComparison(comparison)) };
}

/** Runs of a position for the A/B pickers, with why a run cannot be picked. */
export async function listComparableRunsAction(positionId: string) {
  await requirePermission('positions.view');
  if (!UUID.test(positionId ?? '')) return [];
  const tenantId = await getCurrentTenantId();
  return listPositionRuns(positionId, tenantId);
}

/** "Periksa keterulangan" (NFR-RR-01): replay one run from its stored data. */
export async function verifyRunReproducibilityAction(runId: string): Promise<ReproducibilityResult> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return { verifiable: false, reason: 'Run tidak valid.' };
  const tenantId = await getCurrentTenantId();
  const run = await loadRunRecord(runId, tenantId);
  if (!run) return { verifiable: false, reason: 'Run tidak ditemukan di Company ini.' };
  return verifyRunReproducibility(run);
}

/** FR-SN-06: one run's TOPSIS per candidate, replayed from what it stored. */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getRunTopsisBreakdownAction(
  ...args: Parameters<typeof getRunTopsisBreakdownActionImpl>
): ReturnType<typeof getRunTopsisBreakdownActionImpl> {
  return demoScrub(await getRunTopsisBreakdownActionImpl(...args));
}

async function getRunTopsisBreakdownActionImpl(runId: string): Promise<RunBreakdownDto> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return { available: false, runId, reason: 'Run tidak valid.' };
  const tenantId = await getCurrentTenantId();
  const run = await loadRunRecord(runId, tenantId);
  if (!run) return { available: false, runId, reason: 'Run tidak ditemukan di Company ini.' };
  return toRunBreakdownDto(run, replayRun(run));
}

export type RunShiftResult =
  | { kind: 'root' }
  | {
      kind: 'compared';
      against: 'parent' | 'root';
      baseRunId: string;
      /** The root is the parent itself — "vs root" would repeat "vs induk". */
      rootIsParent: boolean;
      comparison: ComparisonDto;
    }
  | {
      kind: 'unavailable';
      against: 'parent' | 'root';
      baseRunId: string | null;
      rootIsParent: boolean;
      reason: string;
    };

/**
 * "Selisih Peringkat" on a run page: the same comparison as the full page,
 * against the run's parent (default) or its root. A root has nothing to show;
 * a run whose parent is gone, or a pair the engine cannot replay (legacy runs
 * without a pool snapshot), says why instead.
 */
// Demo mode: names — in the ranking and inside the generated sentences — leave the server as initials.
export async function getRunShiftAction(
  ...args: Parameters<typeof getRunShiftActionImpl>
): ReturnType<typeof getRunShiftActionImpl> {
  return demoScrub(await getRunShiftActionImpl(...args));
}

async function getRunShiftActionImpl(runId: string, against: 'parent' | 'root'): Promise<RunShiftResult> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return { kind: 'root' };
  const tenantId = await getCurrentTenantId();
  const run = await loadRunRecord(runId, tenantId);
  if (!run) return { kind: 'root' };
  const isDerived = run.lineage.length > 1 || run.rerunMode !== 'baseline' || Boolean(run.parentRunId);
  if (!isDerived) return { kind: 'root' };
  const parentId = run.lineage.length > 1 ? run.lineage[run.lineage.length - 2]! : null;
  const rootId = run.lineage.length > 1 ? run.lineage[0]! : null;
  const rootIsParent = parentId != null && parentId === rootId;
  const baseRunId = against === 'root' ? rootId : parentId;
  if (!baseRunId) {
    return {
      kind: 'unavailable',
      against,
      baseRunId: null,
      rootIsParent,
      reason: 'Run induk sudah dihapus, jadi tidak ada run untuk dibandingkan.',
    };
  }
  const base = await loadRunRecord(baseRunId, tenantId);
  if (!base) {
    return { kind: 'unavailable', against, baseRunId, rootIsParent, reason: 'Run pembanding tidak ditemukan di Company ini.' };
  }
  const comparison = compareRuns(base, run);
  if (!comparison.structured) {
    return {
      kind: 'unavailable',
      against,
      baseRunId,
      rootIsParent,
      reason: comparison.unavailableReason ?? 'Pasangan run ini tidak dapat dihitung ulang dari data tersimpan.',
    };
  }
  return {
    kind: 'compared',
    against,
    baseRunId,
    rootIsParent,
    comparison: toComparisonDto(comparison, explainComparison(comparison)),
  };
}


// ── L-5: the run's snapshot, readable (FR-SN-02) and raw (FR-SN-03) ─────────

export type RunSnapshotView = {
  runId: string;
  identity: {
    positionTitle: string | null;
    programName: string | null;
    tenantName: string | null;
    kind: string;
    parentRunId: string | null;
    rootRunId: string | null;
    createdByName: string | null;
    createdAt: string;
    completedAt: string | null;
    reason: string | null;
    timings: { phase: string; ms: number }[];
    totalMs: number | null;
  };
  candidates: {
    poolSize: number;
    poolSource: string;
    evaluated: number | null;
    qualified: number | null;
    disqualified: { name: string; reasons: string[] }[];
    forceIncluded: { name: string; source: string; reasons: string[] }[];
    added: { name: string; classification: string; outOfRange: boolean }[];
    skipped: { name: string | null; message: string }[];
    carriedDeleted: number | null;
  };
  config: RunConfigView;
  /** Nominal (before redistribution) and effective (after, Pers. 2.12) weights. */
  effectiveWeights: Record<string, number> | null;
  /** The stored blobs as they are, for the JSON download (FR-SN-03). */
  raw: { configSnapshot: unknown; runInfo: unknown; filterSummary: unknown };
};

// Demo mode: names in the snapshot (and in its JSON download) leave the server as initials.
export async function getRunSnapshotAction(
  ...args: Parameters<typeof getRunSnapshotActionImpl>
): ReturnType<typeof getRunSnapshotActionImpl> {
  return demoScrub(await getRunSnapshotActionImpl(...args));
}

async function getRunSnapshotActionImpl(runId: string): Promise<RunSnapshotView | null> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return null;
  const tenantId = await getCurrentTenantId();
  const run = await loadRunRecord(runId, tenantId);
  if (!run) return null;
  const res = await db.execute(sql`
    SELECT sr.config_snapshot AS "configSnapshot", sr.run_info AS "runInfo", sr.filter_summary AS "filterSummary",
           cp.title AS "positionTitle", t.name AS "tenantName"
      FROM scoring_runs sr
      LEFT JOIN critical_positions cp ON cp.id = sr.position_id
      LEFT JOIN tenants t ON t.id = sr.tenant_id
     WHERE sr.id = ${runId} AND sr.tenant_id = ${tenantId}
     LIMIT 1
  `);
  const row = (res.rows as any[])[0] ?? {};
  const snap = parseJson(row.configSnapshot);
  const info = parseJson(row.runInfo) ?? {};
  const fs = parseJson(row.filterSummary) ?? {};
  const phases = info?.timings?.phasesMs && typeof info.timings.phasesMs === 'object' ? info.timings.phasesMs : {};
  const replay = replayRun(run);
  return {
    runId,
    identity: {
      positionTitle: row.positionTitle ?? null,
      programName: snap?.template?.name ?? null,
      tenantName: row.tenantName ?? null,
      kind: run.lineage.length > 1 || run.rerunMode !== 'baseline' ? run.modeLabel : 'Run root',
      parentRunId: run.parentRunId,
      rootRunId: run.lineage.length > 1 ? run.lineage[0]! : null,
      createdByName: run.createdByName,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      reason: run.rerunReason,
      timings: Object.entries(phases)
        .map(([phase, ms]) => ({ phase, ms: Number(ms) }))
        .filter((t) => Number.isFinite(t.ms)),
      totalMs: Number.isFinite(Number(info?.timings?.totalMs)) && Number(info?.timings?.totalMs) > 0 ? Number(info.timings.totalMs) : null,
    },
    candidates: {
      poolSize: run.pool.length,
      poolSource: run.poolSource,
      evaluated: Number.isFinite(Number(fs.totalEvaluated)) ? Number(fs.totalEvaluated) : null,
      qualified: Number.isFinite(Number(fs.qualifiedCount)) ? Number(fs.qualifiedCount) : null,
      disqualified: Array.isArray(fs.disqualified)
        ? fs.disqualified.map((d: any) => ({ name: String(d.name ?? 'Kandidat'), reasons: Array.isArray(d.reasons) ? d.reasons.map(String) : [] }))
        : [],
      forceIncluded: Array.isArray(fs.forceIncluded)
        ? fs.forceIncluded.map((f: any) => ({
            name: String(f.name ?? 'Kandidat'),
            source: f.source === 'added' ? 'Kandidat pembanding' : 'Finalis run induk',
            reasons: Array.isArray(f.reasons) ? f.reasons.map(String) : [],
          }))
        : [],
      added: Array.isArray(snap?.rerun?.added)
        ? snap.rerun.added.map((a: any) => ({
            name: String(a.name ?? 'Kandidat'),
            classification: a.classification === 'existing_pool' ? 'Sudah ada di pool induk' : 'Dinilai baru',
            outOfRange: a.outOfRange === true,
          }))
        : [],
      skipped: Array.isArray(snap?.rerun?.skipped)
        ? snap.rerun.skipped.map((s: any) => ({ name: s.name ?? null, message: String(s.message ?? s.reason ?? '') }))
        : [],
      carriedDeleted: Number.isFinite(Number(info?.rerun?.carriedDeleted)) ? Number(info.rerun.carriedDeleted) : null,
    },
    config: run.config,
    effectiveWeights: replay.available ? (replay.effectiveWeights as Record<string, number>) : null,
    // Demo mode: the downloadable blobs carry pseudonyms for every NPK and code
    // (lib/demo/pseudonymize.ts), the same ones the trace workbook would use.
    raw: (await isDemoMode())
      ? pseudonymizeIdentifiers({ configSnapshot: snap, runInfo: info, filterSummary: fs }).value
      : { configSnapshot: snap, runInfo: info, filterSummary: fs },
  };
}
