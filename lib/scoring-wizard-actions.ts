'use server';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { liveCandidate } from '@/lib/candidate-visibility';
import { getProgramTemplate, loadFilterableCandidates, syncTemplateCriteriaToPosition } from '@/lib/programs';
import { getCurrentTenantId, liveTenantIdSet, tenantNameMap } from '@/lib/tenant';
import { requirePermission } from '@/lib/rbac';
import { isDemoMode } from '@/lib/app-mode';
import { forCurrentMode, visibleCandidateIds } from '@/lib/demo/store';
import { getIncumbentCandidateIds } from '@/lib/pulse-data';
import { demoScrub } from '@/lib/demo/names';

export type FilterPreviewRow = {
  candidateId: string;
  name: string;
  employeeId: string | null;
  currentPosition: string | null;
  department: string | null;
  /** Owning business unit (tenant) — for cross-tenant pools. */
  tenantId: string | null;
  businessUnit: string | null;
  /**
   * Whether this candidate sits in the position the preview was asked for —
   * decided on the server by candidate id, because in demo mode no NPK leaves
   * the server and the client's NPK comparison would match nobody. Absent when
   * no position was given.
   */
  incumbent?: boolean;
};

/**
 * Resolve the set of business units to draw candidates from: always the current
 * tenant, plus any valid extra tenant IDs. De-duplicated, current tenant first.
 */
async function resolveIncludedTenantIds(extra?: string[]): Promise<string[]> {
  const current = await getCurrentTenantId();
  const valid = await liveTenantIdSet();
  return Array.from(
    new Set([current, ...(extra ?? []).filter((id) => valid.has(id))]),
  );
}

// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function previewProgramFilterAction(
  ...args: Parameters<typeof previewProgramFilterActionImpl>
): ReturnType<typeof previewProgramFilterActionImpl> {
  return demoScrub(await previewProgramFilterActionImpl(...args));
}

async function previewProgramFilterActionImpl(input: {
  programTemplateId: string;
  includedTenantIds?: string[];
  /** The seat being scored: lets each row say whether it is that seat's incumbent. */
  positionId?: string;
}): Promise<FilterPreviewRow[]> {
  await requirePermission('scoring.run');
  const template = await getProgramTemplate(input.programTemplateId);
  if (!template) throw new Error('Template program tidak ditemukan.');

  const tenantIds = await resolveIncludedTenantIds(input.includedTenantIds);
  const pool = await loadFilterableCandidates(tenantIds);

  // Build a quick map for joining displayable info (across all included units).
  const candidateRows = await db
    .select({
      id: schema.candidates.id,
      employeeId: schema.candidates.employeeId,
      currentPosition: schema.candidates.currentPosition,
      department: schema.candidates.department,
      tenantId: schema.candidates.tenantId,
    })
    .from(schema.candidates)
    // Same live-only rule as the pool this map decorates, so the lookup can
    // never re-introduce someone loadFilterableCandidates already dropped.
    .where(and(inArray(schema.candidates.tenantId, tenantIds), liveCandidate()));
  // Demo mode shows each candidate's demo copy (lib/demo/), like the pool this decorates.
  const lookup = new Map(
    (await forCurrentMode(candidateRows, (r) => r.id, { onlyOn: false })).map((r) => [r.id, r]),
  );
  const demo = await isDemoMode();
  const tenantNames = await tenantNameMap();
  const incumbents = input.positionId ? new Set(await getIncumbentCandidateIds(input.positionId)) : null;

  return pool.map((d) => {
    const meta = lookup.get(d.id);
    return {
      candidateId: d.id,
      name: d.name,
      // Demo mode: no NPK leaves the server (incumbency is `incumbent` instead).
      employeeId: demo ? null : meta?.employeeId ?? null,
      currentPosition: meta?.currentPosition ?? null,
      department: meta?.department ?? null,
      tenantId: meta?.tenantId ?? null,
      businessUnit: meta?.tenantId ? tenantNames.get(meta.tenantId) ?? null : null,
      ...(incumbents ? { incumbent: incumbents.has(d.id) } : {}),
    };
  });
}

export type MatrixMeta = {
  criteriaCount: number;
  candidates: {
    id: string;
    name: string;
    currentPosition: string | null;
    department: string | null;
  }[];
};

// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function prepareMatrixAction(
  ...args: Parameters<typeof prepareMatrixActionImpl>
): ReturnType<typeof prepareMatrixActionImpl> {
  return demoScrub(await prepareMatrixActionImpl(...args));
}

async function prepareMatrixActionImpl(input: {
  positionId: string;
  programTemplateId: string;
  candidateIds: string[];
  includedTenantIds?: string[];
}): Promise<MatrixMeta> {
  // Writes criteria rows via syncTemplateCriteriaToPosition — a mutation, so it
  // needs the same permission as starting the run it prepares.
  await requirePermission('scoring.run');
  // Ensure criteria exist for this position (idempotent: skipped if any present)
  await syncTemplateCriteriaToPosition(input.positionId, input.programTemplateId);

  const tenantIds = await resolveIncludedTenantIds(input.includedTenantIds);
  const criteriaRows = await db
    .select({ id: schema.criteria.id })
    .from(schema.criteria)
    .where(
      and(
        eq(schema.criteria.positionId, input.positionId),
        eq(schema.criteria.category, 'score'),
      ),
    );

  const candidateRows = input.candidateIds.length === 0
    ? []
    : await db
        .select({
          id: schema.candidates.id,
          name: schema.candidates.name,
          currentPosition: schema.candidates.currentPosition,
          department: schema.candidates.department,
        })
        .from(schema.candidates)
        .where(
          and(
            inArray(schema.candidates.tenantId, tenantIds),
            inArray(schema.candidates.id, input.candidateIds),
            // candidateIds come from the wizard's client state, which may have
            // been assembled before a delete — re-check rather than trust it.
            liveCandidate(),
          ),
        );

  // Ordered by name here, after demo mode has applied the demo copies.
  const sorted = (await forCurrentMode(candidateRows, (r) => r.id, { onlyOn: false })).sort((a, b) =>
    (a.name ?? '').localeCompare(b.name ?? ''),
  );

  return {
    criteriaCount: criteriaRows.length,
    candidates: sorted,
  };
}

/**
 * Count candidates whose grade (e.g. "5A", "4B") falls within the given
 * numeric range. The grade is taken from `candidates.grade` directly so the
 * preview matches the filter applied during the actual scoring run
 * (see `buildPoolFromCandidateIds` in scoring-engine.ts).
 *
 * Letters after the number (e.g. "5A" → 5) are stripped; candidates with
 * no parseable grade are excluded from the filtered count.
 */
export async function previewGradeFilterCountAction(input: {
  minGradeId?: string | null;
  maxGradeId?: string | null;
  includedTenantIds?: string[];
}): Promise<{ total: number; filtered: number; gradeFiltered: number }> {
  await requirePermission('scoring.run');
  const tenantIds = await resolveIncludedTenantIds(input.includedTenantIds);

  const liveRows = await db
    .select({ id: schema.candidates.id, grade: schema.candidates.grade })
    .from(schema.candidates)
    // `total`, `filtered` and `gradeFiltered` are all derived from this one
    // array, so filtering here keeps the three numbers consistent.
    .where(and(inArray(schema.candidates.tenantId, tenantIds), liveCandidate()));
  // Demo mode counts only the candidates switched ON — the only ones a run takes.
  const visible = new Set(await visibleCandidateIds(liveRows.map((c) => c.id)));
  const allCandidates = liveRows.filter((c) => visible.has(c.id));

  if (allCandidates.length === 0) return { total: 0, filtered: 0, gradeFiltered: 0 };

  const minNum = input.minGradeId ? parseInt(input.minGradeId, 10) : null;
  const maxNum = input.maxGradeId ? parseInt(input.maxGradeId, 10) : null;

  let gradeFiltered = 0;
  for (const c of allCandidates) {
    if (!c.grade) {
      gradeFiltered++;
      continue;
    }
    const m = c.grade.match(/\d+/);
    if (!m) {
      gradeFiltered++;
      continue;
    }
    const num = parseInt(m[0], 10);
    if (Number.isNaN(num)) {
      gradeFiltered++;
      continue;
    }
    if (minNum !== null && num < minNum) { gradeFiltered++; continue; }
    if (maxNum !== null && num > maxNum) { gradeFiltered++; continue; }
  }

  return {
    total: allCandidates.length,
    filtered: allCandidates.length - gradeFiltered,
    gradeFiltered,
  };
}
