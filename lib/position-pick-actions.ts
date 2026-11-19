'use server';

import { requirePermission } from '@/lib/rbac';

import { and, asc, eq, max, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { positionPicks, candidates, criticalPositions, scoringRuns } from '@/lib/db/schema';
import { isDemoMode } from '@/lib/app-mode';
import { picksOfCurrentMode, runsOfCurrentMode } from '@/lib/demo/run-mode';
import { getCurrentTenantId } from '@/lib/tenant';
import { liveCandidate } from '@/lib/candidate-visibility';
import { decryptCandidateValue } from '@/lib/candidate-crypto';
import { demoNamesFor } from '@/lib/demo/store';
import { ensureLocalUser } from '@/lib/pulse-data';
import { logAudit } from '@/lib/audit';

/** FR-DEC-01: a forum decision carries its justification, up to this length. */
const PICK_JUSTIFICATION_MAX = 2000;

function requireJustification(raw: unknown): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    throw new Error(
      'Justifikasi keputusan wajib diisi — tuliskan alasan forum memilih kandidat ini, terutama bila bukan peringkat teratas.',
    );
  }
  if (text.length > PICK_JUSTIFICATION_MAX) {
    throw new Error(`Justifikasi keputusan paling panjang ${PICK_JUSTIFICATION_MAX.toLocaleString('id-ID')} karakter.`);
  }
  return text;
}

/** The position, but only when it belongs to the reader's tenant (NFR-RR-07). */
async function positionInTenant(positionId: string, tenantId: string) {
  const [row] = await db
    .select({ id: criticalPositions.id })
    .from(criticalPositions)
    .where(and(eq(criticalPositions.id, positionId), eq(criticalPositions.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new Error('Posisi tidak ditemukan di Company ini.');
  return row;
}

/** A pick, but only when its position belongs to the reader's tenant. */
async function pickInTenant(pickId: string, tenantId: string) {
  const [row] = await db
    .select({
      id: positionPicks.id,
      positionId: positionPicks.positionId,
      candidateId: positionPicks.candidateId,
      programCode: positionPicks.programCode,
      notes: positionPicks.notes,
      runId: positionPicks.runId,
    })
    .from(positionPicks)
    .innerJoin(criticalPositions, eq(criticalPositions.id, positionPicks.positionId))
    .where(and(eq(positionPicks.id, pickId), eq(criticalPositions.tenantId, tenantId), await picksOfCurrentMode()))
    .limit(1);
  if (!row) throw new Error('Pick tidak ditemukan.');
  return row;
}

/**
 * NPK identity, the way CLAUDE.md defines it: numeric ids padded to five,
 * non-numeric ids compared as written (LPAD would TRUNCATE them).
 */
const npkSql = (col: ReturnType<typeof sql>) =>
  sql`CASE WHEN TRIM(${col}) ~ '^[0-9]+$' THEN LPAD(TRIM(${col}), 5, '0') ELSE UPPER(TRIM(${col})) END`;

/** FR-DEC-03: is this candidate a sitting incumbent of the position? */
async function isIncumbentOf(positionId: string, candidateId: string): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1
      FROM candidates c
      JOIN critical_positions cp ON cp.id = ${positionId}
     WHERE c.id = ${candidateId}
       AND c.employee_id IS NOT NULL AND TRIM(c.employee_id) <> ''
       AND (
         (cp.holder_employee_id IS NOT NULL
           AND ${npkSql(sql`cp.holder_employee_id`)} = ${npkSql(sql`c.employee_id`)})
         OR EXISTS (
           SELECT 1 FROM critical_position_holders h
            WHERE h.position_id = cp.id
              AND ${npkSql(sql`h.employee_id`)} = ${npkSql(sql`c.employee_id`)}
         )
       )
     LIMIT 1
  `);
  return (res.rows as unknown[]).length > 0;
}

export type PositionPick = {
  id: string;
  positionId: string;
  candidateId: string;
  candidateName: string;
  /** The candidate behind this pick has since been soft-deleted. */
  candidateDeleted: boolean;
  programCode: string;
  notes: string | null;
  score: number | null;
  readiness: string | null;
  runId: string | null;
  rank: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listPositionPicks(positionId: string): Promise<PositionPick[]> {
  // Callable from a client like every export of a 'use server' file, so the
  // tenant is checked here rather than trusted from the page (NFR-RR-07).
  await requirePermission('positions.view');
  const tenantId = await getCurrentTenantId();
  const [inTenant] = await db
    .select({ id: criticalPositions.id })
    .from(criticalPositions)
    .where(and(eq(criticalPositions.id, positionId), eq(criticalPositions.tenantId, tenantId)))
    .limit(1);
  if (!inTenant) return [];
  const rows = await db
    .select({
      id: positionPicks.id,
      positionId: positionPicks.positionId,
      candidateId: positionPicks.candidateId,
      programCode: positionPicks.programCode,
      notes: positionPicks.notes,
      score: positionPicks.score,
      readiness: positionPicks.readiness,
      runId: positionPicks.runId,
      rank: positionPicks.rank,
      createdBy: positionPicks.createdBy,
      createdAt: positionPicks.createdAt,
      updatedAt: positionPicks.updatedAt,
      candidateName: candidates.name,
      // Projected, not filtered on: the pick stays in the list (the decision it
      // records still happened), but the UI needs to be able to mark it.
      candidateDeletedAt: candidates.deletedAt,
    })
    .from(positionPicks)
    // History rendering: candidates is joined only to label a pick that was
    // already made, so soft-deleted candidates are DELIBERATELY not filtered —
    // filtering here would blank the name on an existing successor row.
    .leftJoin(candidates, eq(positionPicks.candidateId, candidates.id))
    .where(and(eq(positionPicks.positionId, positionId), await picksOfCurrentMode()))
    .orderBy(asc(positionPicks.programCode), asc(positionPicks.rank));

  // Demo mode names each candidate by their demo copy (lib/demo/).
  const demoNames = await demoNamesFor(rows.map((r) => r.candidateId));
  return rows.map((r) => ({
    id: r.id,
    positionId: r.positionId,
    candidateId: r.candidateId,
    candidateName: demoNames.get(r.candidateId) ?? decryptCandidateValue(r.candidateName) ?? 'Kandidat',
    candidateDeleted: r.candidateDeletedAt != null,
    programCode: r.programCode,
    notes: r.notes,
    score: r.score,
    readiness: r.readiness,
    runId: r.runId,
    rank: r.rank,
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function savePositionPickAction(formData: FormData) {
  await requirePermission('analysis.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const positionId = String(formData.get('positionId') ?? '');
  const candidateId = String(formData.get('candidateId') ?? '');
  const programCode = String(formData.get('programCode') ?? '');
  const scoreStr = (formData.get('score') as string | null)?.trim();
  const score = scoreStr ? parseInt(scoreStr, 10) : null;
  const readiness = (formData.get('readiness') as string | null)?.trim() || null;
  const runId = (formData.get('runId') as string | null)?.trim() || null;

  if (!positionId || !candidateId || !programCode) {
    throw new Error('positionId, candidateId, dan programCode wajib diisi.');
  }
  // FR-DEC-01: a decision without its reason cannot later be explained.
  const notes = requireJustification(formData.get('notes'));
  await positionInTenant(positionId, tenantId);
  // FR-DEC-03: the scoring pool already excludes incumbents, but this action is
  // callable directly — the rule has to hold here too.
  if (await isIncumbentOf(positionId, candidateId)) {
    throw new Error('Kandidat ini pejabat posisi tersebut dan tidak dapat dipilih sebagai suksesor jabatannya sendiri.');
  }
  // The run the decision was made from must be a finished run of THIS position.
  if (runId) {
    const [run] = await db
      .select({ id: scoringRuns.id, status: scoringRuns.status })
      .from(scoringRuns)
      .where(
        and(
          eq(scoringRuns.id, runId),
          eq(scoringRuns.positionId, positionId),
          eq(scoringRuns.tenantId, tenantId),
          // A decision is made from a run of the current mode (drizzle/0093).
          await runsOfCurrentMode(),
        ),
      )
      .limit(1);
    if (!run) throw new Error('Run dasar keputusan tidak ditemukan pada posisi ini.');
  }

  // This form is submitted from finished analysis output, which is history and
  // therefore correctly UNFILTERED — so it can still offer a candidate who has
  // been soft-deleted since the run. Writing that person into position_picks
  // would put a tombstone into a live succession plan, so the write side has to
  // re-check liveness even though the read side does not.
  const live = await db
    .select({ id: candidates.id })
    .from(candidates)
    .where(and(eq(candidates.id, candidateId), liveCandidate()))
    .limit(1);
  if (!live[0]) {
    throw new Error('Kandidat sudah dihapus dan tidak dapat dijadikan suksesor.');
  }

  // Determine next rank for this program (appended to end)
  const maxRankRow = await db
    .select({ max: max(positionPicks.rank) })
    .from(positionPicks)
    .where(
      and(eq(positionPicks.positionId, positionId), eq(positionPicks.programCode, programCode), await picksOfCurrentMode()),
    );
  const nextRank = (maxRankRow[0]?.max ?? -1) + 1;
  const isDemo = await isDemoMode();

  await db
    .insert(positionPicks)
    .values({
      positionId,
      candidateId,
      programCode,
      notes,
      score,
      readiness,
      runId: runId ?? undefined,
      rank: nextRank,
      // Demo-mode decisions are kept apart: they never count in real mode, and the
      // flag is part of the unique key so a demo pick can never upsert a real one.
      isDemo,
      createdBy: actorId,
    })
    .onConflictDoUpdate({
      target: [positionPicks.positionId, positionPicks.programCode, positionPicks.candidateId, positionPicks.isDemo],
      set: {
        notes,
        score,
        readiness,
        runId: runId ?? undefined,
        updatedAt: new Date(),
      },
    });

  // Name lookup for the audit string only — DELIBERATELY unfiltered by
  // deleted_at so the log line reads with a name rather than a raw uuid.
  const candidate = await db
    .select({ name: candidates.name })
    .from(candidates)
    .where(eq(candidates.id, candidateId))
    .limit(1);

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position_pick',
    entityId: positionId,
    action: 'update',
    summary: `Kandidat "${decryptCandidateValue(candidate[0]?.name) ?? candidateId}" ditambahkan ke suksesor program ${programCode}${runId ? ` (dasar: run ${runId})` : ''}. Justifikasi: ${notes}`.slice(0, 500),
    diff: { runId, candidateId, programCode, justification: notes },
  });

  revalidatePath(`/positions/${positionId}`);
}

export async function deletePositionPickAction(formData: FormData) {
  await requirePermission('analysis.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  const pickId = String(formData.get('pickId') ?? '');

  if (!pickId) {
    throw new Error('pickId wajib diisi.');
  }

  const existing = await db
    .select({
      id: positionPicks.id,
      positionId: positionPicks.positionId,
      candidateName: candidates.name,
      programCode: positionPicks.programCode,
      notes: positionPicks.notes,
    })
    .from(positionPicks)
    .innerJoin(criticalPositions, eq(criticalPositions.id, positionPicks.positionId))
    // Same as above: the name is only used in the delete audit summary, so the
    // deleted_at filter is DELIBERATELY omitted.
    .leftJoin(candidates, eq(positionPicks.candidateId, candidates.id))
    .where(and(eq(positionPicks.id, pickId), eq(criticalPositions.tenantId, tenantId), await picksOfCurrentMode()))
    .limit(1);

  if (!existing[0]) {
    throw new Error('Pick tidak ditemukan.');
  }

  await db.delete(positionPicks).where(eq(positionPicks.id, pickId));

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position_pick',
    entityId: existing[0].positionId,
    action: 'delete',
    summary: `Suksesor "${decryptCandidateValue(existing[0].candidateName) ?? '-'}" (program ${existing[0].programCode}) dihapus`,
    // The justification the decision carried is kept in the trail it leaves.
    diff: { removedJustification: existing[0].notes ?? null },
  });

  revalidatePath(`/positions/${existing[0].positionId}`);
}

export async function reorderPicksAction(input: {
  positionId: string;
  pickId: string;
  direction: 'up' | 'down';
}) {
  await requirePermission('analysis.manage');
  const { positionId, pickId, direction } = input;
  await ensureLocalUser();
  await positionInTenant(positionId, await getCurrentTenantId());

  // Get all picks for this position, ordered by program + rank
  const allPicks = await db
    .select({
      id: positionPicks.id,
      programCode: positionPicks.programCode,
      rank: positionPicks.rank,
    })
    .from(positionPicks)
    .where(and(eq(positionPicks.positionId, positionId), await picksOfCurrentMode()))
    .orderBy(asc(positionPicks.programCode), asc(positionPicks.rank));

  // Find current pick and its position within its program
  const currentIdx = allPicks.findIndex((p) => p.id === pickId);
  if (currentIdx === -1) {
    throw new Error('Pick tidak ditemukan.');
  }
  const current = allPicks[currentIdx]!;
  const currentProgram = current.programCode;

  // Find siblings in the same program (in order)
  const programIndices = allPicks
    .map((p, i) => (p.programCode === currentProgram ? i : -1))
    .filter((i) => i !== -1);
  const positionInProgram = programIndices.indexOf(currentIdx);

  if (direction === 'up' && positionInProgram === 0) return; // already at top
  if (direction === 'down' && positionInProgram === programIndices.length - 1) return; // already at bottom

  const swapIdxInAll = direction === 'up'
    ? programIndices[positionInProgram - 1]!
    : programIndices[positionInProgram + 1]!;
  const other = allPicks[swapIdxInAll]!;

  // Swap ranks. Use a temp sentinel to avoid unique constraint conflicts.
  const tempRank = -1;
  await db
    .update(positionPicks)
    .set({ rank: tempRank, updatedAt: new Date() })
    .where(eq(positionPicks.id, current.id));
  await db
    .update(positionPicks)
    .set({ rank: current.rank, updatedAt: new Date() })
    .where(eq(positionPicks.id, other.id));
  await db
    .update(positionPicks)
    .set({ rank: other.rank, updatedAt: new Date() })
    .where(eq(positionPicks.id, current.id));

  revalidatePath(`/positions/${positionId}`);
}

/**
 * Change a decision's justification (FR-DEC-01). It may be corrected, never
 * emptied, and every change is in the audit trail with the old and new text
 * and who made it (NFR-RR-08) — the justification is the forum's record.
 */
export async function updatePickNotesAction(pickId: string, notes: string) {
  await requirePermission('analysis.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);
  const justification = requireJustification(notes);
  const existing = await pickInTenant(pickId, tenantId);
  if ((existing.notes ?? '') === justification) return;
  await db
    .update(positionPicks)
    .set({ notes: justification, updatedAt: new Date() })
    .where(eq(positionPicks.id, pickId));

  await logAudit({
    demoScoped: true,
    tenantId,
    actorId,
    entityType: 'position_pick',
    entityId: existing.positionId,
    action: 'update',
    summary: `Justifikasi keputusan suksesor (program ${existing.programCode}) diubah.`,
    diff: { pickId, before: existing.notes ?? null, after: justification },
  });

  revalidatePath('/positions', 'layout');
}
