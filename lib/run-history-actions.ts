'use server';

// ── A position's run history for the forum (L-1, L-3, FR-RH-04, FR-DEC-02) ──
//
// Every action resolves the tenant itself and reads nothing outside it
// (NFR-RR-07): a run, a position or a decision of another business unit is
// "not found", never shown.

import { sql } from 'drizzle-orm';
import { isDemoSql } from '@/lib/demo/run-mode';
import { db } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { demoNamesFor } from '@/lib/demo/store';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { rerunSpec } from '@/lib/rerun-modes';
import { startTournamentSessionAction, type ScoringDispatch } from '@/lib/scoring-engine';
import { getCurrentTenantId } from '@/lib/tenant';
import { derivedRunWarnings, shortRunId, type DerivedRunWarning } from '@/lib/run-history';
import { demoScrub } from '@/lib/demo/names';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseJson = (v: unknown): any => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};

// ── L-3: what a run is, relative to its lineage ─────────────────────────────

export type RunLineageSummary = {
  runId: string;
  shortId: string;
  positionId: string;
  status: string;
  method: string;
  /** "Tambah Kandidat Pembanding" child (the only creatable derived run). */
  isChild: boolean;
  legacy: boolean;
  modeLabel: string;
  reason: string | null;
  parent: { id: string; shortId: string; label: string | null } | null;
  /** The run declared a parent that is gone (FR-RH-02). */
  parentDeleted: boolean;
  root: { id: string; shortId: string; label: string | null } | null;
  /** Comparison candidates accepted, as the request recorded them. */
  added: { candidateId: string; name: string; existingPool: boolean; outOfRange: boolean; advisory: string[] }[];
  /** Candidates the server refused, with why (FR-RR-10). */
  skipped: { candidateId: string; name: string | null; message: string; rules: string[] }[];
  /** Parts read from today's state instead of the parent (I-3, I-6). */
  warnings: DerivedRunWarning[];
  /** Rows scored with placeholder aspects ("Skor sementara"). */
  provisionalCount: number;
  /** For a ROOT: the root run created before it (FR-RH-04 offers the comparison). */
  previousRoot: { id: string; shortId: string; label: string | null } | null;
};

// Demo mode: the added / skipped names leave the server as initials.
export async function getRunLineageSummaryAction(
  ...args: Parameters<typeof getRunLineageSummaryActionImpl>
): ReturnType<typeof getRunLineageSummaryActionImpl> {
  return demoScrub(await getRunLineageSummaryActionImpl(...args));
}

async function getRunLineageSummaryActionImpl(runId: string): Promise<RunLineageSummary | null> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return null;
  const tenantId = await getCurrentTenantId();
  const res = await db.execute(sql`
    SELECT sr.id::text AS id, sr.position_id::text AS "positionId", sr.status, sr.method,
           sr.parent_run_id::text AS "parentRunId", sr.rerun_mode AS "rerunMode",
           to_jsonb(sr)->>'rerun_reason' AS reason, sr.created_at AS "createdAt",
           sr.config_snapshot AS "configSnapshot", sr.run_info AS "runInfo",
           p.id::text AS "pId", p.label AS "pLabel"
      FROM scoring_runs sr
      LEFT JOIN scoring_runs p ON p.id = sr.parent_run_id AND p.tenant_id = sr.tenant_id
     WHERE sr.id = ${runId} AND sr.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
     LIMIT 1
  `);
  const run = (res.rows as any[])[0];
  if (!run) return null;
  const spec = rerunSpec(run.rerunMode);
  const snap = parseJson(run.configSnapshot);
  const info = parseJson(run.runInfo);
  const rerun = snap?.rerun ?? null;

  const chain = await db.execute(sql`
    WITH RECURSIVE chain AS (
      SELECT id, parent_run_id, label, 0 AS depth FROM scoring_runs WHERE id = ${runId} AND tenant_id = ${tenantId}
      UNION ALL
      SELECT p.id, p.parent_run_id, p.label, c.depth + 1
        FROM scoring_runs p JOIN chain c ON p.id = c.parent_run_id
       WHERE p.tenant_id = ${tenantId} AND c.depth < 200
    )
    SELECT id::text AS id, label FROM chain ORDER BY depth DESC LIMIT 1
  `);
  const top = (chain.rows as { id: string; label: string | null }[])[0] ?? null;
  const isRoot = !run.parentRunId && spec.mode === 'baseline';

  let previousRoot: RunLineageSummary['previousRoot'] = null;
  if (isRoot) {
    const prev = await db.execute(sql`
      SELECT id::text AS id, label FROM scoring_runs sr
       WHERE position_id = ${run.positionId} AND tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
         AND parent_run_id IS NULL AND COALESCE(rerun_mode, 'baseline') = 'baseline'
         AND method = 'AHP_TOPSIS' AND status = 'completed'
         AND created_at < ${run.createdAt} AND id <> ${runId}
       ORDER BY created_at DESC LIMIT 1
    `);
    const p = (prev.rows as { id: string; label: string | null }[])[0];
    previousRoot = p ? { id: p.id, shortId: shortRunId(p.id), label: p.label } : null;
  }

  const provisional = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM scoring_run_pool_aspects
     WHERE run_id = ${runId} AND (details->>'provisional')::boolean IS TRUE
  `);

  return {
    runId: run.id,
    shortId: shortRunId(run.id),
    positionId: run.positionId,
    status: run.status,
    method: run.method,
    isChild: spec.mode === 'incremental_add' && Boolean(run.parentRunId || rerun),
    legacy: spec.legacy,
    modeLabel: spec.legacy ? `Mode lama: ${spec.label}` : spec.label,
    reason: run.reason?.trim() ? run.reason.trim() : null,
    parent: run.pId ? { id: run.pId, shortId: shortRunId(run.pId), label: run.pLabel ?? null } : null,
    parentDeleted: !run.pId && spec.mode !== 'baseline',
    root: top && top.id !== runId ? { id: top.id, shortId: shortRunId(top.id), label: top.label } : null,
    added: Array.isArray(rerun?.added)
      ? rerun.added.map((a: any) => ({
          candidateId: String(a.candidateId),
          name: String(a.name ?? 'Kandidat'),
          existingPool: a.classification === 'existing_pool',
          outOfRange: a.outOfRange === true,
          advisory: Array.isArray(a.advisory) ? a.advisory.map(String) : [],
        }))
      : [],
    skipped: Array.isArray(rerun?.skipped)
      ? rerun.skipped.map((s: any) => ({
          candidateId: String(s.candidateId),
          name: s.name ?? null,
          message: String(s.message ?? s.reason ?? ''),
          rules: Array.isArray(s.rules) ? s.rules.map(String) : [],
        }))
      : [],
    warnings: spec.mode === 'incremental_add' ? derivedRunWarnings({ runInfo: info, configSnapshot: snap }) : [],
    provisionalCount: Number((provisional.rows as any[])[0]?.n ?? 0),
    previousRoot,
  };
}

// ── FR-RH-04: a new root under today's data and configuration ───────────────

export type NewRootRunResult = {
  runId: string;
  dispatch: ScoringDispatch;
  previousRootId: string | null;
};

/**
 * "Penilaian baru": one new AHP+TOPSIS ROOT for the position under the
 * governance configuration and the data in force today. It never touches an
 * existing run (I-1). The pool's business units follow the position's last
 * root, so the new root differs from it in data and configuration — what the
 * forum asked about — and not in who was eligible to be looked at.
 */
export async function startNewRootRunAction(input: { positionId: string }): Promise<NewRootRunResult> {
  await requirePermission('scoring.run');
  const positionId = String(input.positionId ?? '');
  if (!UUID.test(positionId)) throw new Error('Posisi tidak valid.');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const posRes = await db.execute(sql`
    SELECT id::text AS id, title, program_template_id::text AS "programTemplateId"
      FROM critical_positions WHERE id = ${positionId} AND tenant_id = ${tenantId} LIMIT 1
  `);
  const pos = (posRes.rows as any[])[0];
  if (!pos) throw new Error('Posisi tidak ditemukan di Company ini.');
  // Two runs writing into one position's history at once would make the loser
  // look failed — the same rule "Scoring Ulang" follows.
  const busy = await db.execute(sql`
    SELECT 1 FROM tournament_sessions ts
     WHERE position_id = ${positionId} AND status IN ('running', 'finalizing') AND ${await isDemoSql('ts')} LIMIT 1
  `);
  if ((busy.rows as unknown[]).length > 0) {
    throw new Error('Posisi ini masih memiliki penilaian yang sedang berjalan. Tunggu sampai selesai, lalu mulai penilaian baru.');
  }
  const prevRes = await db.execute(sql`
    SELECT id::text AS id, filter_summary->'includedTenantIds' AS units FROM scoring_runs sr
     WHERE position_id = ${positionId} AND tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
       AND parent_run_id IS NULL AND COALESCE(rerun_mode, 'baseline') = 'baseline'
       AND method = 'AHP_TOPSIS' AND status = 'completed'
     ORDER BY created_at DESC LIMIT 1
  `);
  const prev = (prevRes.rows as any[])[0] ?? null;
  const units = Array.isArray(parseJson(prev?.units)) ? (parseJson(prev.units) as unknown[]).map(String) : [tenantId];
  const begun = await startTournamentSessionAction({
    positionId,
    programTemplateId: pos.programTemplateId ?? null,
    label: null,
    includedTenantIds: units,
  });
  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position',
    entityId: positionId,
    action: 'update',
    summary: `Penilaian baru (run root ${shortRunId(begun.runId)}) dengan data dan konfigurasi hari ini untuk posisi ${pos.title}${
      prev ? `; root sebelumnya ${shortRunId(prev.id)}` : ''
    }.`,
  });
  return { runId: begun.runId, dispatch: begun.dispatch, previousRootId: prev?.id ?? null };
}

// ── FR-DEC-02: the system's recommendation beside the forum's decision ─────

export type DecisionSummary = {
  runs: {
    run: { id: string; shortId: string; label: string | null; createdAt: string; method: string; modeLabel: string };
    /** Ranks 1..N of that run, in its stored order. */
    recommendation: { rank: number; candidateId: string; name: string; score: number }[];
    decisions: {
      pickId: string;
      candidateId: string;
      name: string;
      candidateDeleted: boolean;
      programCode: string;
      /** The candidate's rank in that run (whole pool), null when the run never ranked them. */
      rankInRun: number | null;
      justification: string | null;
      decidedBy: string | null;
      decidedAt: string;
    }[];
  }[];
  /** Decisions whose run was deleted (`run_id` set null) — still decisions. */
  unlinked: { pickId: string; name: string; programCode: string; justification: string | null; decidedAt: string }[];
};

// Demo mode: recommended and chosen names leave the server as initials.
export async function getDecisionSummaryAction(
  ...args: Parameters<typeof getDecisionSummaryActionImpl>
): ReturnType<typeof getDecisionSummaryActionImpl> {
  return demoScrub(await getDecisionSummaryActionImpl(...args));
}

async function getDecisionSummaryActionImpl(positionId: string): Promise<DecisionSummary> {
  await requirePermission('positions.view');
  if (!UUID.test(positionId ?? '')) return { runs: [], unlinked: [] };
  const tenantId = await getCurrentTenantId();
  const pickRes = await db.execute(sql`
    SELECT pp.id::text AS id, pp.candidate_id::text AS "candidateId", pp.program_code AS "programCode",
           pp.notes, pp.run_id::text AS "runId", pp.updated_at AS "decidedAt",
           COALESCE(u.name, u.email) AS "decidedBy", c.name AS "candidateName", c.deleted_at AS "deletedAt"
      FROM position_picks pp
      JOIN critical_positions cp ON cp.id = pp.position_id AND cp.tenant_id = ${tenantId}
      LEFT JOIN candidates c ON c.id = pp.candidate_id
      LEFT JOIN users u ON u.id = pp.created_by
     WHERE pp.position_id = ${positionId} AND ${await isDemoSql('pp')}
     ORDER BY pp.program_code, pp.rank
  `);
  const picks = pickRes.rows as any[];
  // Demo mode names each candidate by their demo copy (lib/demo/).
  const demoNames = await demoNamesFor(picks.map((p) => p.candidateId));
  const runIds = [...new Set(picks.map((p) => p.runId).filter(Boolean))] as string[];
  if (runIds.length === 0) {
    return {
      runs: [],
      unlinked: picks.map((p) => ({
        pickId: p.id,
        name: demoNames.get(p.candidateId) ?? (p.candidateName || 'Kandidat'),
        programCode: p.programCode,
        justification: p.notes ?? null,
        decidedAt: new Date(p.decidedAt).toISOString(),
      })),
    };
  }
  const idList = sql.join(runIds.map((id) => sql`${id}::uuid`), sql`, `);
  const runRes = await db.execute(sql`
    SELECT id::text AS id, label, created_at AS "createdAt", method, rerun_mode AS "rerunMode",
           COALESCE((SELECT COUNT(*) FROM scoring_run_pool_aspects p WHERE p.run_id = sr.id AND p.is_finalist), 0)::int AS finalists
      FROM scoring_runs sr WHERE sr.id IN (${idList}) AND sr.tenant_id = ${tenantId}
  `);
  const resultRes = await db.execute(sql`
    SELECT ar.run_id::text AS "runId", ar.candidate_id::text AS "candidateId",
           COALESCE(ar.manual_rank, ar.rank) AS rank, ar.final_score AS score, c.name
      FROM analysis_results ar
      JOIN scoring_runs sr ON sr.id = ar.run_id AND sr.tenant_id = ${tenantId}
      LEFT JOIN candidates c ON c.id = ar.candidate_id
     WHERE ar.run_id IN (${idList})
     ORDER BY ar.run_id, COALESCE(ar.manual_rank, ar.rank)
  `);
  const poolRes = await db.execute(sql`
    SELECT p.run_id::text AS "runId", p.candidate_id::text AS "candidateId", p.pool_rank AS rank
      FROM scoring_run_pool_aspects p
      JOIN scoring_runs sr ON sr.id = p.run_id AND sr.tenant_id = ${tenantId}
     WHERE p.run_id IN (${idList})
  `);
  const poolRank = new Map((poolRes.rows as any[]).map((r) => [`${r.runId}:${r.candidateId}`, Number(r.rank)]));
  const results = resultRes.rows as any[];
  const demoResultNames = await demoNamesFor(results.map((x) => x.candidateId));
  const runs = (runRes.rows as any[])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((r) => {
      const spec = rerunSpec(r.rerunMode);
      const rows = results.filter((x) => x.runId === r.id);
      const n = Number(r.finalists) > 0 ? Number(r.finalists) : rows.length;
      const listedRank = new Map(rows.map((x) => [x.candidateId as string, Number(x.rank)]));
      return {
        run: {
          id: r.id,
          shortId: shortRunId(r.id),
          label: r.label ?? null,
          createdAt: new Date(r.createdAt).toISOString(),
          method: r.method,
          modeLabel: spec.legacy ? `Mode lama: ${spec.label}` : spec.label,
        },
        recommendation: rows
          .filter((x) => Number(x.rank) <= n)
          .map((x) => ({
            rank: Number(x.rank),
            candidateId: x.candidateId,
            name: demoResultNames.get(x.candidateId) ?? (x.name || 'Kandidat'),
            score: Number(x.score),
          })),
        decisions: picks
          .filter((p) => p.runId === r.id)
          .map((p) => ({
            pickId: p.id,
            candidateId: p.candidateId,
            name: demoNames.get(p.candidateId) ?? (p.candidateName || 'Kandidat'),
            candidateDeleted: p.deletedAt != null,
            programCode: p.programCode,
            rankInRun: listedRank.get(p.candidateId) ?? poolRank.get(`${r.id}:${p.candidateId}`) ?? null,
            justification: p.notes ?? null,
            decidedBy: p.decidedBy ?? null,
            decidedAt: new Date(p.decidedAt).toISOString(),
          })),
      };
    });
  return {
    runs,
    unlinked: picks
      .filter((p) => !p.runId)
      .map((p) => ({
        pickId: p.id,
        name: demoNames.get(p.candidateId) ?? (p.candidateName || 'Kandidat'),
        programCode: p.programCode,
        justification: p.notes ?? null,
        decidedAt: new Date(p.decidedAt).toISOString(),
      })),
  };
}

// ── FR-RR-11: where a running run is, in stages a forum understands ─────────

export type RunProgress = {
  state: 'running' | 'completed' | 'failed';
  failure: string | null;
  /** The engine's own phase name (`load`, `technical` … `topsis`, `narrative`, `persist`). */
  phase: string | null;
  done: number;
  total: number;
  /** Comparison candidates being scored new on a "Tambah Kandidat Pembanding" child. */
  newCandidates: number | null;
};

export async function getRunProgressAction(runId: string): Promise<RunProgress | null> {
  await requirePermission('positions.view');
  if (!UUID.test(runId ?? '')) return null;
  const tenantId = await getCurrentTenantId();
  const res = await db.execute(sql`
    SELECT sr.status, sr.run_info -> 'failure' AS failure, ts.status AS "sessionStatus",
           ts.final_ranked -> 'ahpProgress' AS progress, sr.config_snapshot -> 'rerun' -> 'added' AS added
      FROM scoring_runs sr
      LEFT JOIN LATERAL (
        SELECT status, final_ranked FROM tournament_sessions
         WHERE run_id = sr.id ORDER BY created_at DESC LIMIT 1
      ) ts ON TRUE
     WHERE sr.id = ${runId} AND sr.tenant_id = ${tenantId} AND ${await isDemoSql('sr')}
     LIMIT 1
  `);
  const r = (res.rows as any[])[0];
  if (!r) return null;
  const failure = parseJson(r.failure);
  const progress = parseJson(r.progress);
  const added = parseJson(r.added);
  const state: RunProgress['state'] =
    r.status === 'completed' ? 'completed' : failure || r.sessionStatus === 'failed' ? 'failed' : 'running';
  return {
    state,
    failure: typeof failure?.message === 'string' ? failure.message : null,
    phase: typeof progress?.phase === 'string' ? progress.phase : null,
    done: Number(progress?.done ?? 0) || 0,
    total: Number(progress?.total ?? 0) || 0,
    newCandidates: Array.isArray(added) ? added.filter((a: any) => a?.classification === 'new').length : null,
  };
}
