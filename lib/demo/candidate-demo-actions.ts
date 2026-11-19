'use server';

// Demo-mode candidate actions — they replace Edit / Delete on the /candidates
// pages while `?mode=demo` is on (lib/app-mode.ts). NONE of them writes the
// `candidates` table:
//
//   edit    → every field the form shows (NPK and HAV included, which real mode
//             keeps read-only) is upserted as the candidate's demo copy in
//             `candidates_dupp`, and the candidate is switched ON — editing a
//             candidate is choosing to use them, and an edited candidate could
//             otherwise only come back on through Reload, which discards the edit.
//   turnoff → the candidate disappears from filtering, Talent Pool, Talent
//             Mapping and scoring, as if deleted. The demo copy is kept.
//   reload  → the demo copy is deleted (the real data shows again) and the
//             candidate is switched ON.
//
// Every candidate starts OFF in demo mode (no row in candidate_demo_states).

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { requirePermission } from '@/lib/rbac';
import { getCurrentTenantId } from '@/lib/tenant';
import { ensureLocalUser } from '@/lib/pulse-data';
import { encryptIfEnabled, LockedError } from '@/lib/crypto/key-store';
import { isDemoMode } from '@/lib/app-mode';
import { DISCIPLINE_VALUES, MCU_VALUES } from '@/lib/candidate-values';
import { loadDemoCopies } from './store';
import { decryptCandidateValue } from '@/lib/candidate-crypto';
import { paBaChanged } from '@/lib/hav-effective';
import { deriveHavQuadrant } from '@/lib/hav-quadrant-derive';
import { HAV_GAP_LABEL } from '@/lib/talent-mapping';
import {
  DEMO_EDITABLE_FIELDS,
  parseDemoEditedFields,
  type DemoCandidateFields,
  type DemoTechnicalCompetency,
} from './fields';

/** Outside demo mode these actions do not exist; the message says nothing about modes. */
async function assertDemoMode(): Promise<void> {
  if (!(await isDemoMode())) throw new Error('Aksi ini tidak tersedia.');
}

function revalidateDemoPaths() {
  revalidatePath('/');
  revalidatePath('/candidates');
  revalidatePath('/candidates/[id]', 'page');
  revalidatePath('/talent-pool');
  revalidatePath('/talent-pool/mapping');
  revalidatePath('/positions');
}

/** Live candidates of the current business unit among `ids` — the same scope the real edit has. */
async function scopedCandidates(ids: string[]): Promise<{ id: string; tenantId: string; employeeId: string | null }[]> {
  if (ids.length === 0) return [];
  const tenantId = await getCurrentTenantId();
  return db
    .select({ id: schema.candidates.id, tenantId: schema.candidates.tenantId, employeeId: schema.candidates.employeeId })
    .from(schema.candidates)
    .where(
      and(
        inArray(schema.candidates.id, ids),
        eq(schema.candidates.tenantId, tenantId),
        isNull(schema.candidates.deletedAt),
      ),
    );
}

/** The candidate's REAL PA and behaviour, decrypted — what a first demo edit is compared against. */
async function realPaBa(id: string): Promise<{ performanceGrade: string | null; behaviorRecommendation: string | null }> {
  const [real] = await db
    .select({
      performanceGrade: schema.candidates.performanceGrade,
      behaviorRecommendation: schema.candidates.behaviorRecommendation,
    })
    .from(schema.candidates)
    .where(eq(schema.candidates.id, id))
    .limit(1);
  return {
    performanceGrade: decryptCandidateValue(real?.performanceGrade),
    behaviorRecommendation: decryptCandidateValue(real?.behaviorRecommendation),
  };
}

async function setDemoState(rows: { id: string; tenantId: string }[], enabled: boolean, actorId: string | null) {
  if (rows.length === 0) return;
  await db
    .insert(schema.candidateDemoStates)
    .values(rows.map((r) => ({ candidateId: r.id, tenantId: r.tenantId, enabled, updatedBy: actorId })))
    .onConflictDoUpdate({
      target: schema.candidateDemoStates.candidateId,
      set: { enabled, updatedBy: actorId, updatedAt: sql`now()` },
    });
}

function text(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function parseCompetencies(raw: string | null): DemoTechnicalCompetency[] | null {
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return null;
    return list
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object' && typeof (c as { technicalId?: unknown }).technicalId === 'string')
      .map((c) => ({
        technicalId: String(c.technicalId),
        technicalName: String(c.technicalName ?? ''),
        proficiencyName: String(c.proficiencyName ?? ''),
        currentProficiencyName: String(c.currentProficiencyName ?? ''),
        score: Number(c.score ?? 0) || 0,
        currentScore: Number(c.currentScore ?? 0) || 0,
        gap: Number(c.gap ?? 0) || 0,
        isManual: c.isManual === true,
        sourceKey: typeof c.sourceKey === 'string' ? c.sourceKey : undefined,
      }));
  } catch {
    return null;
  }
}

/**
 * Edit in demo mode: upsert the candidate's demo copy and switch them ON.
 * Field rules mirror the real form where they protect meaning (a discipline or
 * MCU value the filters cannot read is refused) and drop the ones that only
 * protect identity, because nothing here touches the real record.
 */
export async function saveDemoCandidateAction(formData: FormData): Promise<void> {
  await requirePermission('candidates.manage');
  await assertDemoMode();
  const id = text(formData, 'id');
  if (!id) throw new Error('Kandidat tidak ditemukan.');
  const [row] = await scopedCandidates([id]);
  if (!row) throw new Error('Kandidat tidak ditemukan.');

  const name = text(formData, 'name');
  if (!name) throw new Error('Nama wajib diisi.');
  const yearsRaw = text(formData, 'yearsExperience');
  if (yearsRaw != null && !(Number.isFinite(Number(yearsRaw)) && Number(yearsRaw) >= 0)) {
    throw new Error('Masa kerja tidak valid.');
  }
  const discipline = text(formData, 'disciplineStatus');
  if (discipline != null && !(DISCIPLINE_VALUES as readonly string[]).includes(discipline)) {
    throw new Error('Status disiplin tidak valid.');
  }
  const mcu = text(formData, 'mcuStatus');
  if (mcu != null && !(MCU_VALUES as readonly string[]).includes(mcu)) {
    throw new Error('Status MCU tidak valid.');
  }

  // The NPK field is shown masked in demo mode, so an empty field means "keep
  // what this copy already has" (or the real NPK on a first edit).
  const previous = (await loadDemoCopies([id])).get(id) ?? null;

  // Which fields this save CHANGED. The form compares what it submits with
  // what it showed on opening and sends the names (`editedFields`); everything
  // edited before stays edited (Reload is how a field goes back to the real
  // value). Only these are read from the copy — the rest keeps following the
  // real record — so an untouched HAV is still derived from an edited PA or
  // behaviour, and a later sync still reaches the fields nobody edited. A
  // client that sends no list (an old tab) is treated as editing every field,
  // which is what a save meant before this existed.
  const submittedEdits = parseDemoEditedFields(
    (() => {
      const raw = formData.get('editedFields');
      if (typeof raw !== 'string') return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        return null;
      }
    })(),
  );
  let editedFields = Array.from(
    new Set([...(previous?.editedFields ?? []), ...(submittedEdits ?? DEMO_EDITABLE_FIELDS)]),
  );

  // HAV events, as in real mode (lib/hav-formula-event.ts): a CHANGED PA or
  // behaviour, or "Hitung kuadran HAV" (`recomputeHav`), pins the formula on the
  // copy (`havTier`) over the real placement and the real upload. The button
  // also hands the HAV back (un-edits it), so the formula is what shows; a PA/BA
  // change does too, unless this same save typed a HAV — that edit is the
  // deliberate answer and outranks the pin.
  const recompute = formData.get('recomputeHav') === '1';
  const nextPa = text(formData, 'performanceGrade');
  const nextBa = text(formData, 'behaviorRecommendation');
  const formula = deriveHavQuadrant({ performanceGrade: nextPa, behaviorRecommendation: nextBa });
  if (recompute && !formula.ok) {
    throw new Error(`Kuadran HAV tidak dapat dihitung: ${formula.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}.`);
  }
  const priorPaBa = previous
    ? { performanceGrade: previous.performanceGrade, behaviorRecommendation: previous.behaviorRecommendation }
    : await realPaBa(row.id);
  const pinFormula =
    formula.ok && (recompute || paBaChanged(priorPaBa, { performanceGrade: nextPa, behaviorRecommendation: nextBa }));
  if (pinFormula && (recompute || !(submittedEdits ?? []).includes('havQuadrant'))) {
    editedFields = editedFields.filter((f) => f !== 'havQuadrant');
  }

  const payload: DemoCandidateFields = {
    name,
    employeeId: text(formData, 'employeeId') ?? previous?.employeeId ?? row.employeeId,
    email: text(formData, 'email'),
    currentPosition: text(formData, 'currentPosition'),
    department: text(formData, 'department'),
    division: text(formData, 'division'),
    yearsExperience: yearsRaw,
    disciplineStatus: discipline,
    mcuStatus: mcu,
    mcuNoteManual: text(formData, 'mcuNoteManual'),
    performanceGrade: text(formData, 'performanceGrade'),
    havQuadrant: text(formData, 'havQuadrant'),
    behaviorRecommendation: text(formData, 'behaviorRecommendation'),
    behaviorNotes: text(formData, 'behaviorNotes'),
    education: text(formData, 'education'),
    major: text(formData, 'major'),
    technicalCompetencies: parseCompetencies(typeof formData.get('technicalCompetencies') === 'string' ? (formData.get('technicalCompetencies') as string) : null),
    editedFields,
    havTier: pinFormula ? 'formula' : previous?.havTier ?? null,
  };

  let sealed: string | null;
  try {
    sealed = await encryptIfEnabled(JSON.stringify(payload));
  } catch (err) {
    if (err instanceof LockedError) throw new Error('Data tidak dapat disimpan: kunci enkripsi belum tersedia.');
    throw err;
  }
  const actorId = await ensureLocalUser().catch(() => null);
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.candidatesDupp)
      .values({ candidateId: row.id, tenantId: row.tenantId, payload: sealed!, sealed: sealed!.startsWith('v1:'), updatedBy: actorId })
      .onConflictDoUpdate({
        target: schema.candidatesDupp.candidateId,
        set: { payload: sealed!, sealed: sealed!.startsWith('v1:'), updatedBy: actorId, updatedAt: sql`now()` },
      });
    await tx
      .insert(schema.candidateDemoStates)
      .values({ candidateId: row.id, tenantId: row.tenantId, enabled: true, updatedBy: actorId })
      .onConflictDoUpdate({
        target: schema.candidateDemoStates.candidateId,
        set: { enabled: true, updatedBy: actorId, updatedAt: sql`now()` },
      });
  });
  revalidateDemoPaths();
}

/** Turnoff: the candidates vanish from filtering, Talent Pool, Talent Mapping and scoring. Copies are kept. */
export async function turnOffDemoCandidatesAction(ids: string[]): Promise<{ changed: number }> {
  await requirePermission('candidates.manage');
  await assertDemoMode();
  const rows = await scopedCandidates(Array.from(new Set(ids)));
  const actorId = await ensureLocalUser().catch(() => null);
  await setDemoState(rows, false, actorId);
  revalidateDemoPaths();
  return { changed: rows.length };
}

/** Reload: back to the real data (demo copy deleted) and ON. */
export async function reloadDemoCandidatesAction(ids: string[]): Promise<{ changed: number }> {
  await requirePermission('candidates.manage');
  await assertDemoMode();
  const rows = await scopedCandidates(Array.from(new Set(ids)));
  if (rows.length === 0) return { changed: 0 };
  const actorId = await ensureLocalUser().catch(() => null);
  await db.transaction(async (tx) => {
    await tx.delete(schema.candidatesDupp).where(inArray(schema.candidatesDupp.candidateId, rows.map((r) => r.id)));
    await tx
      .insert(schema.candidateDemoStates)
      .values(rows.map((r) => ({ candidateId: r.id, tenantId: r.tenantId, enabled: true, updatedBy: actorId })))
      .onConflictDoUpdate({
        target: schema.candidateDemoStates.candidateId,
        set: { enabled: true, updatedBy: actorId, updatedAt: sql`now()` },
      });
  });
  revalidateDemoPaths();
  return { changed: rows.length };
}
