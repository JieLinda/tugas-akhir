import 'server-only';

import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { isDemoMode } from '@/lib/app-mode';
import { MASKED_NPK } from '@/lib/app-mode-shared';
import { loadDemoCopies, loadDemoOnIds } from '@/lib/demo/store';
import { demoEdits } from '@/lib/demo/fields';
import { formatDate, toDayKey } from '@/lib/datetime';
import type { HavDeriveResult } from '@/lib/hav-quadrant-derive';
import { splitPerformanceSlots } from '@/lib/hav-quadrant-derive';
import {
  TALENT_MAPPING_AUDIT_PAGE,
  mergeBehaviorHistory,
  parseQuadrant,
  type TalentMappingAuditEntry,
  type TalentMappingBehaviorEntry,
  type TalentMappingPaOutsideWindow,
  type TalentMappingCandidate,
  type TalentMappingData,
  type TalentMappingFormula,
  type TalentMappingLastSync,
  type TalentMappingPlacementInfo,
} from '@/lib/talent-mapping';
import type { HavAutoChangeOrigin } from '@/lib/db/schema';
import { getTalentMappingPopulation } from '@/lib/talent-pool-data';
import { getCurrentTenantId } from '@/lib/tenant';

/**
 * Talent Mapping — the read side. See lib/talent-mapping.ts for the vocabulary
 * and docs/talent-mapping.md for the feature.
 *
 * Population and pool standing come from `getTalentMappingPopulation()`: the
 * map holds everyone the Talent Pool's DISCIPLINE rule admits, and the full
 * Talent Pool verdict rides along as information — see there for why the map
 * is not the "Lolos" list. Every candidate's square is the HAV IN FORCE from
 * lib/hav-effective.ts — a hand placement only while it is newer than the last
 * sync that changed the automatic answer, else upload › formula. Both are the
 * values the rest of the app reads, so this page shows what scoring uses rather
 * than a second opinion beside it.
 */

/**
 * The sync clock of every candidate in a business unit (drizzle/0080). Degrades
 * to "no clock" when the column does not exist yet — the readers then fall back
 * to precedence too, so the page and the HAV it shows stay consistent.
 */
async function loadAutomaticChangeClocks(
  tenantId: string,
): Promise<Map<string, { at: Date; origin: HavAutoChangeOrigin | null }>> {
  const out = new Map<string, { at: Date; origin: HavAutoChangeOrigin | null }>();
  try {
    const rows = await db
      .select({
        id: schema.candidates.id,
        at: schema.candidates.havAutoChangedAt,
        origin: schema.candidates.havAutoChangeSource,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.tenantId, tenantId));
    for (const row of rows) {
      if (row.at) out.set(row.id, { at: row.at, origin: row.origin ?? null });
    }
  } catch (err) {
    console.warn('[talent-mapping] sync clocks unreadable (drizzle/0080?); shown as none:', err);
  }
  return out;
}

/** The formula's answer, in the page's shape. */
export function formulaForPage(derived: HavDeriveResult): TalentMappingFormula {
  if (!derived.ok) return { ok: false, gaps: derived.gaps };
  return {
    ok: true,
    quadrant: derived.quadrant,
    competencyBand: derived.competencyBand,
    performanceBand: derived.performanceBand,
    performance: derived.performance,
  };
}

/**
 * What a reviewer needs beside a candidate the formula cannot place: their
 * behavioural-assessment history and, when the formula's PA window is empty or
 * a newer year exists, the PA on record outside it.
 *
 * Joined exactly the way candidate-populate builds the candidate row — the
 * tenant's companies through sync_company_tenant_map, the NPK through
 * `LPAD(employee_id, 5, '0')` (sync tables store it padded, candidates do not) —
 * so these rows describe the same person the formula's inputs came from. Read
 * from the sync tables because the candidate row keeps only the latest BA,
 * undated, and only the window's six PA slots. Tombstones are excluded: this is
 * the map's population, a list.
 *
 * Every query degrades to "nothing on record" on failure (a missing
 * drizzle/0081 table most likely); the page must not go down for context.
 */
async function loadAssessmentContext(
  tenantId: string,
  referenceYear: number,
): Promise<{
  behavior: Map<string, TalentMappingBehaviorEntry[]>;
  paOutsideWindow: Map<string, TalentMappingPaOutsideWindow>;
}> {
  type BaRow = { candidateId: string; label: string | null; note: string | null; at: string | Date | null };
  const rowsOf = <T,>(result: unknown) => ((result as { rows?: T[] }).rows ?? []) as T[];
  const settle = async <T,>(label: string, run: () => Promise<unknown>): Promise<T[]> => {
    try {
      return rowsOf<T>(await run());
    } catch (err) {
      console.warn(`[talent-mapping] ${label} unreadable; shown as none:`, err);
      return [];
    }
  };

  const windowNewest = referenceYear - 1;
  const windowOldest = referenceYear - 3;
  const [currentRows, historyRows, paRows] = await Promise.all([
    settle<BaRow>('current BA', () =>
      db.execute(sql`
        SELECT c.id AS "candidateId", b.rekomendasi_name AS label, b.keterangan AS note, b.tgl_pelaksanaan AS at
          FROM candidates c
          JOIN sync_company_tenant_map m ON m.tenant_id = c.tenant_id AND m.is_active = true
          JOIN sync_behavior_competencies b
            ON b.company_id = m.company_id AND b.employee_id = LPAD(c.employee_id, 5, '0')
         WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL`),
    ),
    settle<BaRow>('BA history (drizzle/0081)', () =>
      db.execute(sql`
        SELECT c.id AS "candidateId", h.rekomendasi_name AS label, h.keterangan AS note, h.tgl_pelaksanaan AS at
          FROM candidates c
          JOIN sync_company_tenant_map m ON m.tenant_id = c.tenant_id AND m.is_active = true
          JOIN sync_behavior_competency_history h
            ON h.company_id = m.company_id AND h.employee_id = LPAD(c.employee_id, 5, '0')
         WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL
         ORDER BY h.rank`),
    ),
    // MAX per year, like candidate-populate's slot derivation, so this reads a
    // year the way the formula would if the window ever reached it.
    settle<{ candidateId: string; year: number; s1: string | null; s2: string | null }>('PA outside window', () =>
      db.execute(sql`
        WITH per_year AS (
          SELECT c.id AS candidate_id, p.tahun, MAX(p.s1) AS s1, MAX(p.s2) AS s2
            FROM candidates c
            JOIN sync_company_tenant_map m ON m.tenant_id = c.tenant_id AND m.is_active = true
            JOIN sync_performance_appraisals p
              ON p.company_id = m.company_id AND p.employee_id = LPAD(c.employee_id, 5, '0')
           WHERE c.tenant_id = ${tenantId} AND c.deleted_at IS NULL
             AND (p.tahun > ${windowNewest} OR p.tahun < ${windowOldest})
             AND (NULLIF(btrim(p.s1), '') IS NOT NULL OR NULLIF(btrim(p.s2), '') IS NOT NULL)
           GROUP BY c.id, p.tahun
        )
        SELECT DISTINCT ON (candidate_id) candidate_id AS "candidateId", tahun AS year, s1, s2
          FROM per_year
         ORDER BY candidate_id, tahun DESC`),
    ),
  ]);

  const toEntry = (r: BaRow): TalentMappingBehaviorEntry => ({
    label: r.label,
    date: toDayKey(r.at),
    note: r.note,
  });
  const current = new Map(currentRows.map((r) => [r.candidateId, toEntry(r)]));
  const history = new Map<string, TalentMappingBehaviorEntry[]>();
  for (const r of historyRows) {
    const list = history.get(r.candidateId) ?? [];
    list.push(toEntry(r));
    history.set(r.candidateId, list);
  }
  const behavior = new Map<string, TalentMappingBehaviorEntry[]>();
  for (const id of new Set([...current.keys(), ...history.keys()])) {
    const merged = mergeBehaviorHistory(current.get(id) ?? null, history.get(id) ?? []);
    if (merged.length > 0) behavior.set(id, merged);
  }

  const paOutsideWindow = new Map<string, TalentMappingPaOutsideWindow>();
  for (const r of paRows) {
    paOutsideWindow.set(r.candidateId, {
      year: Number(r.year),
      s1: r.s1?.trim() || null,
      s2: r.s2?.trim() || null,
    });
  }
  return { behavior, paOutsideWindow };
}

/** The current WIB year — `performance_grade` slots count back from it. */
function currentReferenceYear(): number {
  return parseInt(formatDate(new Date()).slice(0, 4), 10);
}

/**
 * Audit rows ('hav16') for a business unit, newest first, optionally for one
 * candidate. Candidate names are resolved WITHOUT the tombstone filter: this is
 * history rendering (the "must not filter" category in
 * lib/candidate-visibility.ts), and a move made before somebody was deleted
 * still happened.
 */
export async function loadTalentMappingAudit(
  tenantId: string,
  opts: { candidateId?: string; limit?: number } = {},
): Promise<{ entries: TalentMappingAuditEntry[]; total: number }> {
  const where = and(
    eq(schema.talentAuditLogs.tenantId, tenantId),
    eq(schema.talentAuditLogs.mappingKind, 'hav16'),
    opts.candidateId ? eq(schema.talentAuditLogs.candidateId, opts.candidateId) : undefined,
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: schema.talentAuditLogs.id,
        candidateId: schema.talentAuditLogs.candidateId,
        employeeId: schema.talentAuditLogs.employeeId,
        action: schema.talentAuditLogs.action,
        oldQuadrant: schema.talentAuditLogs.oldQuadrant,
        newQuadrant: schema.talentAuditLogs.newQuadrant,
        baselineQuadrant: schema.talentAuditLogs.baselineQuadrant,
        baselineSource: schema.talentAuditLogs.baselineSource,
        justification: schema.talentAuditLogs.justificationReason,
        changedByUsername: schema.talentAuditLogs.changedByUsername,
        changedByName: schema.users.name,
        timestamp: schema.talentAuditLogs.timestamp,
      })
      .from(schema.talentAuditLogs)
      .leftJoin(schema.users, eq(schema.talentAuditLogs.changedByUserId, schema.users.id))
      .where(where)
      .orderBy(desc(schema.talentAuditLogs.timestamp))
      .limit(opts.limit ?? TALENT_MAPPING_AUDIT_PAGE),
    db.select({ total: count() }).from(schema.talentAuditLogs).where(where),
  ]);

  const candidateIds = Array.from(
    new Set(rows.map((r) => r.candidateId).filter((id): id is string => Boolean(id))),
  );
  const nameRows = candidateIds.length
    ? await db
        .select({ id: schema.candidates.id, name: schema.candidates.name })
        .from(schema.candidates)
        .where(inArray(schema.candidates.id, candidateIds))
    : [];
  const nameById = new Map(nameRows.map((r) => [r.id, r.name || null]));
  // Demo mode: the history of an OFF candidate is not shown (OFF = as if
  // deleted from Talent Mapping), names are the demo copy's, and no NPK.
  const demo = await isDemoMode();
  const demoOn = demo ? await loadDemoOnIds(candidateIds) : null;
  if (demo) {
    const copies = await loadDemoCopies(candidateIds);
    for (const [id, copy] of copies) nameById.set(id, copy.name);
  }

  const entries = rows.map((r): TalentMappingAuditEntry => {
    return {
      id: r.id,
      candidateId: r.candidateId,
      employeeId: demo ? MASKED_NPK : r.employeeId,
      candidateName: r.candidateId ? (nameById.get(r.candidateId) ?? null) : null,
      action: r.action ?? null,
      fromQuadrant: parseQuadrant(r.oldQuadrant),
      toQuadrant: parseQuadrant(r.newQuadrant),
      baselineQuadrant: parseQuadrant(r.baselineQuadrant),
      baselineSource: r.baselineSource ?? null,
      justification: r.justification ?? null,
      changedByName: r.changedByName ?? null,
      changedByUsername: r.changedByUsername ?? null,
      timestamp: r.timestamp.toISOString(),
    };
  });

  if (demoOn) {
    const shown = entries.filter((e) => e.candidateId != null && demoOn.has(e.candidateId));
    return { entries: shown, total: shown.length };
  }
  return { entries, total: Number(total) };
}

/** Everything the Talent Mapping page renders, for the active business unit. */
export async function getTalentMappingData(): Promise<TalentMappingData> {
  const tenantId = await getCurrentTenantId();
  const referenceYear = currentReferenceYear();

  const [population, placementRows, audit, clocks, context] = await Promise.all([
    getTalentMappingPopulation(),
    db
      .select({
        candidateId: schema.talentMappingPlacements.candidateId,
        quadrant: schema.talentMappingPlacements.quadrant,
        baselineQuadrant: schema.talentMappingPlacements.baselineQuadrant,
        baselineSource: schema.talentMappingPlacements.baselineSource,
        justification: schema.talentMappingPlacements.justification,
        placedByUsername: schema.talentMappingPlacements.placedByUsername,
        placedByName: schema.users.name,
        updatedAt: schema.talentMappingPlacements.updatedAt,
      })
      .from(schema.talentMappingPlacements)
      .leftJoin(schema.users, eq(schema.talentMappingPlacements.placedBy, schema.users.id))
      .where(eq(schema.talentMappingPlacements.tenantId, tenantId)),
    loadTalentMappingAudit(tenantId),
    loadAutomaticChangeClocks(tenantId),
    loadAssessmentContext(tenantId, referenceYear),
  ]);

  // The placement's DETAIL (who, why, against what). Whether a placement is in
  // force was already decided upstream: the population rows carry the HAV in
  // force, computed by the same loader every other reader uses.
  const placementByCandidate = new Map<string, TalentMappingPlacementInfo>();
  for (const row of placementRows) {
    const quadrant = parseQuadrant(row.quadrant);
    if (quadrant == null) continue;
    placementByCandidate.set(row.candidateId, {
      quadrant,
      baselineQuadrant: parseQuadrant(row.baselineQuadrant),
      baselineSource: row.baselineSource,
      justification: row.justification,
      placedByName: row.placedByName ?? null,
      placedByUsername: row.placedByUsername ?? null,
      placedAt: row.updatedAt.toISOString(),
    });
  }

  // Demo mode: a behavioural assessment EDITED in demo mode is the candidate's
  // BA, and the dated sync history beside it describes the real one — showing
  // it would put the real assessment next to the edited value the formula
  // reads. Those rows show the edited value alone (an empty history renders the
  // candidate row's BA, undated). Unedited candidates keep their real history.
  const baEdited = new Set<string>();
  if (await isDemoMode()) {
    const copies = await loadDemoCopies(population.candidates.map((c) => c.id));
    for (const [id, copy] of copies) {
      if (demoEdits(copy, 'behaviorRecommendation')) baEdited.add(id);
    }
  }

  const onMap = new Set(population.candidates.map((c) => c.id));
  let offMapPlacements = 0;
  for (const candidateId of placementByCandidate.keys()) {
    if (!onMap.has(candidateId)) offMapPlacements += 1;
  }

  const candidates = population.candidates.map((c): TalentMappingCandidate => {
    const hav = c.effectiveHav;
    // A placement the loader could not open never reached `hav.manual`; showing
    // its detail as though it were in force would contradict the square.
    const placement = hav.manual != null ? (placementByCandidate.get(c.id) ?? null) : null;
    const automatic = { quadrant: hav.automatic.quadrant, source: hav.automatic.source };
    const clock = clocks.get(c.id) ?? null;
    return {
      id: c.id,
      name: c.name,
      employeeId: c.employeeId,
      currentPosition: c.currentPosition,
      department: c.department,
      division: c.division,
      grade: c.grade,
      performanceSlots: splitPerformanceSlots(c.performanceGrade),
      behaviorRecommendation: c.behaviorRecommendation,
      behaviorHistory: baEdited.has(c.id) ? [] : context.behavior.get(c.id) ?? [],
      paOutsideWindow: context.paOutsideWindow.get(c.id) ?? null,
      uploadedHavQuadrant: hav.uploaded,
      formula: formulaForPage(hav.formula),
      automatic,
      automaticChangedAt: clock ? clock.at.toISOString() : null,
      automaticChangeOrigin: clock?.origin ?? null,
      placement,
      quadrant: hav.quadrant,
      source: hav.source,
      baselineDrifted:
        placement != null &&
        (placement.baselineQuadrant !== automatic.quadrant || placement.baselineSource !== automatic.source),
      inTalentPool: c.inTalentPool,
      poolQuadrants: c.poolQuadrants,
      poolFailedRules: c.failedRules,
    };
  });

  const by = (pred: (c: TalentMappingCandidate) => boolean) => candidates.filter(pred).length;

  // The newest sync event among the people on the map. Not a run summary: a
  // candidate sync commits in batches, so one run leaves several clocks.
  let lastSync: TalentMappingLastSync | null = null;
  for (const c of candidates) {
    if (c.automaticChangedAt && (!lastSync || c.automaticChangedAt > lastSync.at)) {
      lastSync = { at: c.automaticChangedAt, origin: c.automaticChangeOrigin };
    }
  }

  return {
    program: population.program,
    gate: population.gate,
    lastSync,
    paReferenceYear: referenceYear,
    candidates,
    counts: {
      population: candidates.length,
      inTalentPool: by((c) => c.inTalentPool),
      placed: by((c) => c.quadrant != null),
      manual: by((c) => c.source === 'manual'),
      upload: by((c) => c.source === 'upload'),
      formula: by((c) => c.source === 'formula'),
      unplaced: by((c) => c.source === 'none'),
      drifted: by((c) => c.baselineDrifted),
      offMapPlacements,
      syncChanged: by((c) => c.automaticChangedAt != null),
    },
    audit: audit.entries,
    auditTotal: audit.total,
  };
}
