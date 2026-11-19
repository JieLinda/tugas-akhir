import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { decryptCandidateRow } from '@/lib/candidate-crypto';
import { encryptIfEnabled, ensureUnlocked, LockedError } from '@/lib/crypto/key-store';
import { isDemoMode } from '@/lib/app-mode';
import { loadDemoCopies } from './store';
import { isDemoEditableField, type DemoCandidateFields, type DemoEditableField } from './fields';

// Writes that other features make in demo mode land HERE instead of in the real
// record: a Talent Mapping move. It is an edit of the candidate's demo copy,
// exactly like the /candidates edit.

/** Throw the neutral refusal for an action that only exists in real mode. */
export async function refuseInDemoMode(): Promise<void> {
  if (await isDemoMode()) throw new Error('Aksi ini tidak tersedia.');
}

/** A demo copy built from the candidate's real record, for a first demo edit made outside the form. */
async function freshCopy(candidateId: string): Promise<{ copy: DemoCandidateFields; tenantId: string } | null> {
  const [row] = await db
    .select()
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, candidateId), isNull(schema.candidates.deletedAt)))
    .limit(1);
  if (!row) return null;
  await ensureUnlocked();
  const c = decryptCandidateRow(row);
  return {
    tenantId: row.tenantId,
    copy: {
      name: c.name ?? '',
      employeeId: c.employeeId ?? null,
      email: c.email ?? null,
      currentPosition: c.currentPosition ?? null,
      department: c.department ?? null,
      division: c.division ?? null,
      yearsExperience: c.yearsExperience != null ? String(c.yearsExperience) : null,
      disciplineStatus: c.disciplineStatus ?? null,
      mcuStatus: c.mcuStatus ?? null,
      mcuNoteManual: c.mcuNoteManual ?? null,
      performanceGrade: c.performanceGrade ?? null,
      havQuadrant: c.havQuadrant ?? null,
      behaviorRecommendation: c.behaviorRecommendation ?? null,
      behaviorNotes: c.behaviorNotes ?? null,
      education: c.education ?? null,
      major: c.major ?? null,
      technicalCompetencies: null,
      editedFields: [],
    },
  };
}

/**
 * Apply `patch` to the candidate's demo copy (created from the real record when
 * there is none) and store it sealed. The candidate's ON/OFF state is left as
 * it is: these edits are made on candidates already in use.
 */
export async function patchDemoCopy(
  candidateId: string,
  patch: Partial<DemoCandidateFields>,
  actorId: string | null,
  /** Fields to hand back to the real record: no longer edited, read live again. */
  opts: { unedit?: DemoEditableField[] } = {},
): Promise<DemoCandidateFields> {
  const existing = (await loadDemoCopies([candidateId])).get(candidateId) ?? null;
  let tenantId: string;
  let base: DemoCandidateFields;
  if (existing) {
    const [row] = await db
      .select({ tenantId: schema.candidates.tenantId })
      .from(schema.candidates)
      .where(eq(schema.candidates.id, candidateId))
      .limit(1);
    if (!row) throw new Error('Kandidat tidak ditemukan.');
    tenantId = row.tenantId;
    base = existing;
  } else {
    const fresh = await freshCopy(candidateId);
    if (!fresh) throw new Error('Kandidat tidak ditemukan.');
    tenantId = fresh.tenantId;
    base = fresh.copy;
  }
  // The patched keys become edited; everything already edited stays edited.
  // Every other field keeps tracking the real record (lib/demo/fields.ts).
  const patched = (Object.keys(patch) as string[]).filter(isDemoEditableField);
  const next: DemoCandidateFields = {
    ...base,
    ...patch,
    editedFields: Array.from(new Set([...(base.editedFields ?? []), ...patched])).filter(
      (f) => !(opts.unedit ?? []).includes(f),
    ),
  };
  let sealed: string | null;
  try {
    sealed = await encryptIfEnabled(JSON.stringify(next));
  } catch (err) {
    if (err instanceof LockedError) throw new Error('Data tidak dapat disimpan: kunci enkripsi belum tersedia.');
    throw err;
  }
  await db
    .insert(schema.candidatesDupp)
    .values({ candidateId, tenantId, payload: sealed!, sealed: sealed!.startsWith('v1:'), updatedBy: actorId })
    .onConflictDoUpdate({
      target: schema.candidatesDupp.candidateId,
      set: { payload: sealed!, sealed: sealed!.startsWith('v1:'), updatedBy: actorId, updatedAt: sql`now()` },
    });
  return next;
}
