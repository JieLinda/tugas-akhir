'use server';

import { requirePermission } from '@/lib/rbac';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type {
  DisciplineStatus,
  McuStatus,
} from '@/lib/db/schema';
import { ensureLocalUser } from '@/lib/pulse-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { DISCIPLINE_VALUES, MCU_VALUES, PERFORMANCE_VALUES } from '@/lib/candidate-values';
import { refuseInDemoMode } from '@/lib/demo/write';
import { logAudit } from '@/lib/audit';
import {
  decryptCandidateRow,
  decryptCandidateValue,
  encryptCandidateRow,
} from '@/lib/candidate-crypto';
import { demoScrub } from '@/lib/demo/names';
import { getCurrentUser } from '@/lib/auth';
import { ensureUnlocked } from '@/lib/crypto/key-store';
import { paBaChanged } from '@/lib/hav-effective';
import { deriveHavQuadrant } from '@/lib/hav-quadrant-derive';
import { currentEffectiveHav, recordFormulaHavEvent, type HavFormulaEventInput } from '@/lib/hav-formula-event';
import { HAV_GAP_LABEL } from '@/lib/talent-mapping';

const FIELD_LABELS: Record<string, string> = {
  name: 'Nama lengkap',
  employeeId: 'ID Karyawan',
  currentPosition: 'Posisi saat ini',
  yearsExperience: 'Masa kerja',
  department: 'Departemen',
  division: 'Divisi',
  education: 'Pendidikan',
  major: 'Jurusan',
  havQuadrant: 'HAV Quadrant',
  behaviorRecommendation: 'Behavior Recommendation',
  title: 'Nama posisi',
  holderName: 'Nama pejabat',
  jobFamily: 'Job Family',
  minGradeId: 'Rentang level suksesor',
  maxGradeId: 'Rentang level suksesor',
  programTemplateId: 'Program suksesi',
};

function requireString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${FIELD_LABELS[key] || key} wajib diisi.`);
  }
  return value.trim();
}

function optionalString(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** years_experience is stored as encrypted text; write its numeric form as a string. */
function yearsToString(value: number | null): string | null {
  return value == null ? null : String(value);
}

function parseYearsExperience(formData: FormData, key: string) {
  const rawValue = optionalString(formData, key);
  if (!rawValue) return null;

  const parsed = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid number field: ${key}`);
  }

  return parsed;
}

function parseInteger(formData: FormData, key: string, opts: { min?: number; max?: number } = {}) {
  const raw = optionalString(formData, key);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  if (opts.min !== undefined && parsed < opts.min) return null;
  if (opts.max !== undefined && parsed > opts.max) return null;
  return parsed;
}

function parseEnum<T extends string>(formData: FormData, key: string, allowed: readonly T[]): T | null {
  const raw = optionalString(formData, key);
  if (!raw) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}


function readCandidateAttributes(formData: FormData) {
  const employeeId = optionalString(formData, 'employeeId');
  const disciplineStatus = parseEnum(formData, 'disciplineStatus', DISCIPLINE_VALUES);
  const mcuStatus = parseEnum(formData, 'mcuStatus', MCU_VALUES);
  // Cleared to NULL when the field is emptied, unlike disciplineStatus/mcuStatus
  // which keep their previous value: those are NOT NULL enums where "not chosen"
  // cannot be expressed, while an emptied note genuinely means "there is no note".
  const mcuNoteManualRaw = optionalString(formData, 'mcuNoteManual');
  const mcuNoteManual = mcuNoteManualRaw || null;
  const performanceGrade = optionalString(formData, 'performanceGrade');
  const havQuadrantRaw = (formData.get('havQuadrant') as string | null)?.trim();
  const havQuadrant = havQuadrantRaw ? havQuadrantRaw : null;
  const behaviorRecommendationRaw = optionalString(formData, 'behaviorRecommendation');
  const behaviorRecommendation = behaviorRecommendationRaw || null;
  const behaviorNotesRaw = optionalString(formData, 'behaviorNotes');
  const behaviorNotes = behaviorNotesRaw || null;
  const education = optionalString(formData, 'education');
  const major = optionalString(formData, 'major');
  return {
    employeeId,
    disciplineStatus,
    mcuStatus,
    mcuNoteManual,
    performanceGrade,
    havQuadrant,
    behaviorRecommendation,
    behaviorNotes,
    education,
    major,
  };
}

function normalizeError(err: unknown): never {
  const pgErr = err && typeof err === 'object' && 'cause' in err ? (err as any).cause : err;
  if (pgErr && typeof pgErr === 'object' && pgErr.code === '23505') {
    const msg = String(pgErr.detail ?? '');
    if (msg.includes('employee_id') || msg.includes('idx_candidates_tenant_employee_id')) {
      throw new Error('NPK sudah terdaftar.');
    }
    throw new Error('Data sudah ada di database.');
  }
  throw err instanceof Error ? err : new Error(String(err));
}

/**
 * The identity form of an NPK.
 *
 * Every join in this app resolves a person through `LPAD(employee_id, 5, '0')`,
 * so `123` and `00123` are one human even though the unique index
 * `(tenant_id, employee_id)` sees two distinct strings. Comparing raw strings
 * would miss exactly the collision that breaks those joins.
 *
 * Only numeric NPKs are padded: `LPAD` *truncates* anything longer than 5
 * characters, so padding a non-numeric id would make `MUL-2024-001` and
 * `MUL-2999-999` compare equal (both `MUL-2`).
 */
function npkIdentity(value: string): string {
  const trimmed = value.trim();
  return /^\d+$/.test(trimmed) ? trimmed.padStart(5, '0') : trimmed;
}

/**
 * The NPK is the candidate's identity, not one of their attributes, so
 * `updateCandidateAction` never writes it — but it must not silently DISCARD a
 * changed one either, which is what it used to do. The form renders "ID
 * Karyawan" as a required editable field, so retyping it reported "Kandidat
 * berhasil diperbarui" over a value that never moved; a user who typed an NPK
 * that already belongs to somebody else read that as the collision being
 * handled, when nothing had been checked at all.
 *
 * Throws when the submitted NPK differs from the stored one, with the two cases
 * distinguished because they mean different things to the user: the NPK is
 * already taken (fix the input) versus the NPK is free but identity is frozen
 * here (delete the candidate and let the sync recreate them).
 */
async function assertNpkUnchanged(candidateId: string, tenantId: string, submitted: string) {
  const [current] = await db
    .select({ employeeId: schema.candidates.employeeId })
    .from(schema.candidates)
    .where(and(eq(schema.candidates.id, candidateId), eq(schema.candidates.tenantId, tenantId)))
    .limit(1);

  if (!current) throw new Error('Kandidat tidak ditemukan.');
  if (npkIdentity(current.employeeId ?? '') === npkIdentity(submitted)) return;

  const trimmed = submitted.trim();
  // Tombstoned rows count as taken: the unique index is deliberately TOTAL, so
  // reusing a deleted person's NPK is exactly what stops the sync bringing them
  // back under their own uuid.
  const clash = await db.execute(sql`
    SELECT name, (deleted_at IS NOT NULL) AS "isDeleted"
    FROM candidates
    WHERE tenant_id = ${tenantId}
      AND id <> ${candidateId}
      AND (
        employee_id = ${trimmed}
        OR (
          employee_id ~ '^[0-9]+$' AND ${trimmed} ~ '^[0-9]+$'
          AND LPAD(employee_id, 5, '0') = LPAD(${trimmed}, 5, '0')
        )
      )
    LIMIT 1
  `);

  const owner = (clash.rows as { name: string | null; isDeleted: boolean }[])[0];
  if (owner) {
    const ownerName = decryptCandidateValue(owner.name);
    const who = ownerName ? ` (${ownerName}${owner.isDeleted ? ', sudah dihapus' : ''})` : '';
    throw new Error(
      `NPK ${trimmed} sudah terdaftar untuk kandidat lain${who}. NPK harus unik — perubahan tidak disimpan.`,
    );
  }

  throw new Error(
    `NPK tidak dapat diubah di sini (${current.employeeId} → ${trimmed}). NPK adalah identitas kandidat: ia separuh kunci unik yang dipakai sinkronisasi dan setiap relasi data karyawan. Untuk memperbaiki NPK yang salah, hapus kandidat ini lalu jalankan sinkronisasi.`,
  );
}

function revalidateCandidatePaths() {
  revalidatePath('/');
  revalidatePath('/candidates');
  // Revalidate the candidate detail route too, otherwise edits made from a
  // candidate's detail page (e.g. removing a technical competency) succeed in
  // the DB but the page keeps serving stale cached data — looking like the
  // change "didn't work".
  revalidatePath('/candidates/[id]', 'page');
  revalidatePath('/positions');
}

async function saveCandidateTechnicalCompetencies(candidateId: string, jsonStr: string | null) {
  if (!jsonStr) return;
  const list = JSON.parse(jsonStr) as {
    technicalId: string;
    technicalName: string;
    proficiencyName: string;
    currentProficiencyName: string;
    score: number;
    currentScore: number;
    gap: number;
    isManual?: boolean;
    sourceKey?: string;
  }[];

  // De-duplicate by sourceKey: the (candidate_id, source_key) unique index means
  // two rows sharing a source_key (e.g. a synced item and a manual_<id> that
  // collide) would make the INSERT throw *after* the DELETE already ran, wiping
  // competencies. Keeping the last occurrence per key keeps the insert valid.
  const bySourceKey = new Map<string, (typeof list)[number] & { sourceKey: string }>();
  for (const tc of list) {
    const sourceKey = tc.sourceKey ?? `manual_${tc.technicalId}`;
    bySourceKey.set(sourceKey, { ...tc, sourceKey });
  }

  // Do the delete + re-insert atomically so a mid-operation failure can never
  // leave the candidate with a partially-written competency set.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.candidateTechnicalCompetencies)
      .where(eq(schema.candidateTechnicalCompetencies.candidateId, candidateId));

    if (bySourceKey.size === 0) return;

    const values = Array.from(bySourceKey.values()).map((tc) => ({
      candidateId,
      technicalId: tc.technicalId,
      technicalName: tc.technicalName,
      proficiencyName: tc.proficiencyName,
      currentProficiencyName: tc.currentProficiencyName,
      score: tc.score,
      currentScore: tc.currentScore,
      gap: tc.gap,
      isManual: tc.isManual ?? true,
      sourceKey: tc.sourceKey,
      syncedAt: new Date(),
    }));

    await tx.insert(schema.candidateTechnicalCompetencies).values(values);
  });
}

export async function createCandidateAction(formData: FormData) {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const [createdBy, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const name = requireString(formData, 'name');
    const employeeId = requireString(formData, 'employeeId');
    const currentPosition = requireString(formData, 'currentPosition');
    const department = requireString(formData, 'department');
    const division = requireString(formData, 'division');
    const education = requireString(formData, 'education');
    const major = requireString(formData, 'major');
    const havQuadrant = requireString(formData, 'havQuadrant');
    const behaviorRecommendation = requireString(formData, 'behaviorRecommendation');
    const yearsExpRaw = requireString(formData, 'yearsExperience');
    const yearsExpNum = Number.parseInt(yearsExpRaw, 10);
    if (Number.isNaN(yearsExpNum) || yearsExpNum < 0) {
      throw new Error('Masa kerja tidak valid.');
    }

    const disciplineStatus = parseEnum(formData, 'disciplineStatus', DISCIPLINE_VALUES);
    const mcuStatus = parseEnum(formData, 'mcuStatus', MCU_VALUES);
    // Both columns are NOT NULL and encrypted, so a missing value has nowhere
    // honest to go: NULL violates the constraint (a raw database error), the
    // column default would be PLAINTEXT in an encrypted column, and assuming
    // "CLEAR" would qualify somebody on a hard filter nobody recorded. The update
    // path keeps the stored value instead; a new candidate has none to keep.
    if (!disciplineStatus) throw new Error('Status disiplin wajib dipilih.');
    if (!mcuStatus) throw new Error('Status MCU wajib dipilih.');
    const mcuNoteManual = optionalString(formData, 'mcuNoteManual') || null;
    const performanceGrade = optionalString(formData, 'performanceGrade');
    const behaviorNotes = optionalString(formData, 'behaviorNotes');

    const [inserted] = await db
      .insert(schema.candidates)
      .values(
        await encryptCandidateRow({
          name,
          employeeId,
          email: optionalString(formData, 'email'),
          currentPosition,
          department,
          division,
          yearsExperience: yearsToString(yearsExpNum),
          disciplineStatus,
          mcuStatus,
          mcuNoteManual,
          performanceGrade,
          havQuadrant,
          behaviorRecommendation,
          behaviorNotes,
          education,
          major,
          tenantId,
          createdBy,
        }),
      )
      .returning({ id: schema.candidates.id });

    const techCompRaw = formData.get('technicalCompetencies') as string | null;
    await saveCandidateTechnicalCompetencies(inserted!.id, techCompRaw);

    await logAudit({
      tenantId,
      actorId: createdBy,
      entityType: 'candidate',
      entityId: inserted!.id,
      action: 'create',
      summary: `Karyawan "${name}" ditambahkan.`,
    });

    revalidateCandidatePaths();
  } catch (err) {
    normalizeError(err);
  }
}

export async function updateCandidateAction(formData: FormData) {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const id = requireString(formData, 'id');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
    const name = requireString(formData, 'name');
    const attributes = readCandidateAttributes(formData);

    // Validate identity BEFORE writing anything, so a rejected NPK change never
    // leaves the other fields half-applied. An absent field (the candidate
    // detail page's form does not submit one) means "no change", not "blank it".
    if (attributes.employeeId) {
      await assertNpkUnchanged(id, tenantId, attributes.employeeId);
    }

    // HAV events of this save (docs/talent-mapping.md § "Perubahan PA/BA dan
    // tier formula"): a CHANGED PA or behaviour, or the "Hitung kuadran HAV"
    // button (`recomputeHav`), puts the formula over the NEW PA/BA in force —
    // over an older placement and an older upload. Decided, and the button's
    // refusal raised, BEFORE anything is written.
    const recompute = formData.get('recomputeHav') === '1';
    await ensureUnlocked();
    const [prior] = await db
      .select({
        employeeId: schema.candidates.employeeId,
        havQuadrant: schema.candidates.havQuadrant,
        performanceGrade: schema.candidates.performanceGrade,
        behaviorRecommendation: schema.candidates.behaviorRecommendation,
      })
      .from(schema.candidates)
      .where(and(eq(schema.candidates.id, id), eq(schema.candidates.tenantId, tenantId)))
      .limit(1);
    if (!prior) throw new Error('Kandidat tidak ditemukan.');
    const priorOpen = {
      havQuadrant: decryptCandidateValue(prior.havQuadrant),
      performanceGrade: decryptCandidateValue(prior.performanceGrade),
      behaviorRecommendation: decryptCandidateValue(prior.behaviorRecommendation),
    };
    const formula = deriveHavQuadrant({
      performanceGrade: attributes.performanceGrade,
      behaviorRecommendation: attributes.behaviorRecommendation,
    });
    if (recompute && !formula.ok) {
      throw new Error(
        `Kuadran HAV tidak dapat dihitung: ${formula.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}.`,
      );
    }
    const paBaEdited = paBaChanged(priorOpen, attributes);
    let havEvent: HavFormulaEventInput | null = null;
    if (formula.ok && (recompute || paBaEdited)) {
      const sessionUser = await getCurrentUser().catch(() => null);
      havEvent = {
        candidateId: id,
        tenantId,
        employeeId: prior.employeeId,
        // The button names itself even when PA/BA changed in the same save:
        // it is the more explicit of the two acts.
        origin: recompute ? 'hav_formula' : 'candidate_edit',
        before: await currentEffectiveHav({ candidateId: id, uploadedQuadrant: priorOpen.havQuadrant, performanceGrade: priorOpen.performanceGrade, behaviorRecommendation: priorOpen.behaviorRecommendation }),
        formulaQuadrant: formula.quadrant,
        actorId,
        username: sessionUser?.email?.trim().toLowerCase() || null,
      };
    }

    const candidateRow = await encryptCandidateRow({
          name,
          email: optionalString(formData, 'email'),
          currentPosition: optionalString(formData, 'currentPosition'),
          department: optionalString(formData, 'department'),
          division: optionalString(formData, 'division'),
          yearsExperience: yearsToString(parseYearsExperience(formData, 'yearsExperience')),
          // Nullable attribute columns are set directly (including null) so an
          // edit can actually change OR clear them. (The create action keeps the
          // null-filter so DB defaults apply for brand-new rows.)
          //
          // employeeId is deliberately NOT here. The NPK is the candidate's
          // identity: it is half of the unique key the sync upserts on, and every
          // join in the app resolves a person through LPAD(employee_id, 5, '0').
          // Editing it re-points all of that at a different human while the row's
          // uuid — and therefore its scoring history — stays put. Previously this
          // action could even blank it, since optionalString returns null for an
          // empty field. Correcting a genuinely wrong NPK now means deleting the
          // candidate and letting the sync recreate them.
          performanceGrade: attributes.performanceGrade,
          // Nullable and human-owned: emptying the field really does clear it.
          // `mcuNote` (the synced copy) is NOT written here — the sync owns it.
          mcuNoteManual: attributes.mcuNoteManual,
          // havQuadrant is deliberately NOT written. The column holds the HAV
          // Excel value, which the candidate sync overwrites every run — an edit
          // here vanished at the next sync. The HAV in force is moved by events
          // (lib/hav-effective.ts): a Talent Mapping placement, a HAV upload, or
          // — from this form — a PA/BA change or "Hitung kuadran HAV", which pin
          // the formula (recordFormulaHavEvent below), never a typed quadrant.
          behaviorRecommendation: attributes.behaviorRecommendation,
          behaviorNotes: attributes.behaviorNotes,
          education: attributes.education,
          major: attributes.major,
          // disciplineStatus / mcuStatus are NOT NULL — only overwrite when a
          // valid value was chosen, otherwise leave the existing value intact.
          ...(attributes.disciplineStatus ? { disciplineStatus: attributes.disciplineStatus } : {}),
          ...(attributes.mcuStatus ? { mcuStatus: attributes.mcuStatus } : {}),
          updatedAt: new Date(),
        });
    let havSuperseded = false;
    await db.transaction(async (tx) => {
      await tx
        .update(schema.candidates)
        .set(candidateRow)
        // Tenant scope is load-bearing, not decorative: without it any user with
        // candidates.manage in one business unit could edit a candidate in
        // another just by knowing the uuid.
        .where(and(eq(schema.candidates.id, id), eq(schema.candidates.tenantId, tenantId)));
      if (havEvent) havSuperseded = (await recordFormulaHavEvent(tx, havEvent)).superseded;
    });

    const techCompRaw = formData.get('technicalCompetencies') as string | null;
    await saveCandidateTechnicalCompetencies(id, techCompRaw);

    await logAudit({
      tenantId,
      actorId,
      entityType: 'candidate',
      entityId: id,
      action: 'update',
      summary:
        `Karyawan "${name}" diperbarui.` +
        (havEvent
          ? havEvent.origin === 'hav_formula'
            ? ' HAV dihitung ulang menurut rumus PA × BA'
            : ' PA/BA berubah, HAV ditempatkan ulang menurut rumus PA × BA'
          : '') +
        (havEvent && havSuperseded ? ' (penempatan manual Talent Mapping digantikan).' : havEvent ? '.' : ''),
    });

    revalidateCandidatePaths();
    if (havEvent) {
      revalidatePath('/talent-pool');
      revalidatePath('/talent-pool/mapping');
    }
  } catch (err) {
    normalizeError(err);
  }
}

/**
 * Soft delete. The row is tombstoned, never removed.
 *
 * A real DELETE cascades into analysis_results, position_picks and
 * job_family_matches, and leaves the candidate's
 * uuid dangling inside tournament_sessions' jsonb pools — so deleting one
 * person silently edits every finished ranking they appeared in.
 *
 * mode 'manual' means the weekly sync will NOT bring them back: this is a
 * deliberate "this person does not belong in the pool", unlike the bulk clear
 * in lib/candidate-lifecycle-actions.ts which exists precisely to be re-imported.
 */
export async function deleteCandidateAction(formData: FormData) {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const id = requireString(formData, 'id');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const [removed] = await db
      .update(schema.candidates)
      .set({
        deletedAt: new Date(),
        deletedBy: actorId,
        deletedMode: 'manual',
        updatedAt: new Date(),
      })
      // Same missing-tenant-scope defect as the update path: without it a hard
      // delete was possible across business units.
      .where(
        and(
          eq(schema.candidates.id, id),
          eq(schema.candidates.tenantId, tenantId),
          isNull(schema.candidates.deletedAt),
        ),
      )
      .returning({ name: schema.candidates.name });

    if (!removed) {
      // Either the wrong tenant, or already deleted. Both are no-ops rather
      // than errors — re-submitting a delete should not blow up.
      revalidateCandidatePaths();
      return;
    }

    await logAudit({
      tenantId,
      actorId,
      entityType: 'candidate',
      entityId: id,
      action: 'delete',
      summary: `Karyawan "${decryptCandidateValue(removed.name)}" dihapus (data historis dipertahankan).`,
    });

    revalidateCandidatePaths();
  } catch (err) {
    normalizeError(err);
  }
}

/**
 * Undo a soft delete. Without this, "delete" is a one-way door for a row that
 * still physically exists — which is the worst of both worlds.
 */
export async function restoreCandidateAction(formData: FormData) {
  // Demo mode never writes the real record (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('candidates.manage');
    const id = requireString(formData, 'id');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    const [restored] = await db
      .update(schema.candidates)
      .set({ deletedAt: null, deletedBy: null, deletedMode: null, updatedAt: new Date() })
      .where(and(eq(schema.candidates.id, id), eq(schema.candidates.tenantId, tenantId)))
      .returning({ name: schema.candidates.name });

    if (!restored) return;

    await logAudit({
      tenantId,
      actorId,
      entityType: 'candidate',
      entityId: id,
      action: 'update',
      summary: `Karyawan "${decryptCandidateValue(restored.name)}" dipulihkan.`,
    });

    revalidateCandidatePaths();
  } catch (err) {
    normalizeError(err);
  }
}

// ── Employee_id-based lookups for the position form's auto-fill (Tambah/Edit
// Posisi) — resolves the incumbent/position pairing through
// sync_employee_positions relations instead of guessing by matching
// `candidates.current_position` against a master position's title string.

export type ResolvedHolder = {
  holderName: string;
  holderEmployeeId: string;
  candidateId: string | null;
};

/**
 * Resolve the ACTIVE incumbent (valid_to > today) of a tenant's master
 * position (positions.id) via sync_positions/sync_employee_positions.
 * Prefers an incumbent who is also a tenant candidate (needed downstream for
 * competency/job-profile matching); falls back to a non-candidate employee
 * (shown as-is) when no candidate holds it. Returns null when the position
 * has no resolvable sync link or no active incumbent.
 */
// Demo mode: holder names leave the server as initials (position writes are refused in demo mode).
export async function resolveHolderForPositionAction(
  ...args: Parameters<typeof resolveHolderForPositionActionImpl>
): ReturnType<typeof resolveHolderForPositionActionImpl> {
  return demoScrub(await resolveHolderForPositionActionImpl(...args));
}

async function resolveHolderForPositionActionImpl(
  masterPositionId: string,
): Promise<ResolvedHolder | null> {
  await requirePermission('positions.manage');
  const tenantId = await getCurrentTenantId();

  const res = await db.execute(sql`
    SELECT
      sep.employee_id AS "employeeId",
      COALESCE(se.display_name, se.internal_title) AS "empName",
      c.id::text AS "candidateId",
      c.name AS "candidateName",
      c.employee_id AS "candidateEmployeeId"
    FROM positions p
    JOIN sync_positions sp ON sp.id = p.sync_position_id
    JOIN sync_employee_positions sep
      ON sep.company_id = sp.company_id AND sep.position_id = sp.position_id
     AND sep.valid_to > CURRENT_DATE
    LEFT JOIN sync_employees se
      ON se.company_id = sep.company_id AND LPAD(se.employee_id, 5, '0') = sep.employee_id
    -- A tombstoned candidate must not be resolved as the incumbent, and must not
    -- win the ORDER BY tiebreak below either; getMasterPositions() in
    -- lib/pulse-data.ts filters the same join the same way, so both still label
    -- the same holder.
    LEFT JOIN candidates c
      ON LPAD(c.employee_id, 5, '0') = sep.employee_id AND c.tenant_id = ${tenantId}
     AND c.deleted_at IS NULL
    WHERE p.id = ${masterPositionId} AND p.tenant_id = ${tenantId}
    -- employee_id is the deterministic tiebreak: non-unique roles (SALESMAN,
    -- INSTRUCTOR, …) have several equally-ranked active holders, and this must
    -- resolve to the same one getMasterPositions() labelled in the picker.
    ORDER BY (c.id IS NOT NULL) DESC, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST, sep.employee_id ASC
    LIMIT 1
  `);

  const row = (res.rows as Array<{
    employeeId: string;
    empName: string | null;
    candidateId: string | null;
    candidateName: string | null;
    candidateEmployeeId: string | null;
  }>)[0];
  if (!row) return null;

  return {
    holderName: decryptCandidateValue(row.candidateName) ?? row.empName ?? '',
    // sync_employee_positions ids are 5-digit zero-padded ("00682"); drop the
    // leading 0 to match the 4-digit form used by candidates/sync_employees.
    holderEmployeeId: row.candidateEmployeeId ?? row.employeeId.replace(/^0/, ''),
    candidateId: row.candidateId,
  };
}

/**
 * Resolve EVERY active incumbent of a master position, not just the one the
 * picker labels.
 *
 * Non-unique roles (SALESMAN, INSTRUCTOR, branch supervisors…) genuinely have
 * several holders, and all of them are people this position would need to
 * replace — and none of them may sit in their own successor pool. The order is
 * the same one `resolveHolderForPositionAction` uses to choose its single row,
 * so the first entry here is that same person and stays the primary holder.
 */
// Demo mode: holder names leave the server as initials (position writes are refused in demo mode).
export async function resolveHoldersForPositionAction(
  ...args: Parameters<typeof resolveHoldersForPositionActionImpl>
): ReturnType<typeof resolveHoldersForPositionActionImpl> {
  return demoScrub(await resolveHoldersForPositionActionImpl(...args));
}

async function resolveHoldersForPositionActionImpl(
  masterPositionId: string,
): Promise<ResolvedHolder[]> {
  await requirePermission('positions.manage');
  const tenantId = await getCurrentTenantId();

  const res = await db.execute(sql`
    SELECT DISTINCT ON (sep.employee_id)
      sep.employee_id AS "employeeId",
      COALESCE(se.display_name, se.internal_title) AS "empName",
      c.id::text AS "candidateId",
      c.name AS "candidateName",
      c.employee_id AS "candidateEmployeeId",
      sep.primary_position AS "primaryPosition",
      sep.valid_from AS "validFrom"
    FROM positions p
    JOIN sync_positions sp ON sp.id = p.sync_position_id
    JOIN sync_employee_positions sep
      ON sep.company_id = sp.company_id AND sep.position_id = sp.position_id
     AND sep.valid_to > CURRENT_DATE
    LEFT JOIN sync_employees se
      ON se.company_id = sep.company_id AND LPAD(se.employee_id, 5, '0') = sep.employee_id
    LEFT JOIN candidates c
      ON LPAD(c.employee_id, 5, '0') = sep.employee_id AND c.tenant_id = ${tenantId}
     AND c.deleted_at IS NULL
    WHERE p.id = ${masterPositionId} AND p.tenant_id = ${tenantId}
    -- DISTINCT ON collapses an employee holding the same seat over several
    -- assignment rows; the inner ordering keeps their candidate-backed row.
    ORDER BY sep.employee_id, (c.id IS NOT NULL) DESC, sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
  `);

  const rows = res.rows as Array<{
    employeeId: string;
    empName: string | null;
    candidateId: string | null;
    candidateName: string | null;
    candidateEmployeeId: string | null;
    primaryPosition: boolean | null;
    validFrom: Date | null;
  }>;

  return rows
    // Same precedence as the single-holder resolver, applied after the fact
    // because DISTINCT ON dictates the SQL ordering.
    .sort((a, b) => {
      const byCandidate = Number(Boolean(b.candidateId)) - Number(Boolean(a.candidateId));
      if (byCandidate !== 0) return byCandidate;
      const byPrimary = Number(Boolean(b.primaryPosition)) - Number(Boolean(a.primaryPosition));
      if (byPrimary !== 0) return byPrimary;
      const aFrom = a.validFrom ? new Date(a.validFrom).getTime() : 0;
      const bFrom = b.validFrom ? new Date(b.validFrom).getTime() : 0;
      if (aFrom !== bFrom) return bFrom - aFrom;
      return a.employeeId.localeCompare(b.employeeId);
    })
    .map((row) => ({
      holderName: decryptCandidateValue(row.candidateName) ?? row.empName ?? '',
      holderEmployeeId: row.candidateEmployeeId ?? row.employeeId.replace(/^0/, ''),
      candidateId: row.candidateId,
    }));
}

export type ResolvedPosition = {
  masterPositionId: string | null;
  title: string;
};

/**
 * Resolve a candidate's CURRENT active position via sync_employee_positions
 * (employee_id → position_id), joined back to the tenant's `positions` master
 * row for a stable id (feeds the job-profile pairing lookup) — instead of
 * guessing by matching the position title string. Department/division are
 * left to the caller (candidates.department/division is already accurate).
 */
export async function resolvePositionForCandidateAction(
  candidateId: string,
): Promise<ResolvedPosition | null> {
  await requirePermission('positions.manage');

  const res = await db.execute(sql`
    SELECT
      p.id::text AS "masterPositionId",
      COALESCE(sp.internal_title, sp.external_title) AS "title"
    FROM candidates c
    JOIN sync_company_tenant_map sctm
      ON sctm.tenant_id = c.tenant_id AND sctm.is_active = true
    JOIN sync_employee_positions sep
      ON sep.company_id = sctm.company_id AND sep.employee_id = LPAD(c.employee_id, 5, '0')
     AND sep.valid_to > CURRENT_DATE
    JOIN sync_positions sp
      ON sp.company_id = sep.company_id AND sp.position_id = sep.position_id
    LEFT JOIN positions p
      ON p.tenant_id = c.tenant_id AND p.sync_position_id = sp.id
    -- Auto-fill only resolves a live candidate; a tombstone has no current position.
    WHERE c.id = ${candidateId} AND c.deleted_at IS NULL
    ORDER BY sep.primary_position DESC NULLS LAST, sep.valid_from DESC NULLS LAST
    LIMIT 1
  `);

  const row = (res.rows as Array<{ masterPositionId: string | null; title: string | null }>)[0];
  if (!row || !row.title) return null;

  return { masterPositionId: row.masterPositionId, title: row.title };
}

export type PositionEnrichment = {
  gradeId: string | null;
  posLevelNo: number | null;
  summary: string | null;
  supervisorTitle: string | null;
  subordinateCount: number;
};

/**
 * Read-only context for a tenant's master position, sourced from
 * sync_positions (grade/level/summary) and sync_position_hierarchy (direct
 * supervisor's title + subordinate count) — the same relations already used
 * for candidate enrichment in the Job Family Sync page. Purely informational:
 * critical_positions has no columns for these, so nothing here is persisted;
 * it just helps confirm the right position was picked while filling
 * "Detail posisi jabatan".
 */
export async function getPositionEnrichmentAction(
  masterPositionId: string,
): Promise<PositionEnrichment | null> {
  await requirePermission('positions.manage');
  const tenantId = await getCurrentTenantId();

  const base = await db.execute(sql`
    SELECT sp.company_id AS "companyId", sp.position_id AS "syncPositionId",
           sp.grade_id AS "gradeId", sp.pos_level_no AS "posLevelNo", sp.summary AS "summary"
    FROM positions p
    JOIN sync_positions sp ON sp.id = p.sync_position_id
    WHERE p.id = ${masterPositionId} AND p.tenant_id = ${tenantId}
    LIMIT 1
  `);
  const row = (base.rows as Array<{
    companyId: string;
    syncPositionId: string;
    gradeId: string | null;
    posLevelNo: number | null;
    summary: string | null;
  }>)[0];
  if (!row) return null;

  const [supRes, subRes] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(psp.internal_title, psp.external_title) AS "supervisorTitle"
      FROM sync_position_hierarchy sph
      LEFT JOIN sync_positions psp
        ON psp.company_id = ${row.companyId} AND psp.position_id = sph.parent_position_id
      WHERE sph.company_id = ${row.companyId} AND sph.position_id = ${row.syncPositionId}
        AND sph.valid_to > CURRENT_DATE
      LIMIT 1
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS n
      FROM sync_position_hierarchy sph
      WHERE sph.company_id = ${row.companyId} AND sph.parent_position_id = ${row.syncPositionId}
        AND sph.valid_to > CURRENT_DATE
    `),
  ]);

  return {
    gradeId: row.gradeId,
    posLevelNo: row.posLevelNo,
    summary: row.summary,
    supervisorTitle: (supRes.rows as any[])[0]?.supervisorTitle ?? null,
    subordinateCount: Number((subRes.rows as any[])[0]?.n ?? 0),
  };
}

/**
 * Resolve the succession program a position is being filed under.
 *
 * A position belongs to exactly one program (drizzle/0056), so this is a
 * required field on the form. The template is re-read from the tenant's own
 * templates rather than trusted from the client, and its code is denormalized
 * onto the row so the position keeps its label if the template is later deleted.
 */
async function resolveProgramForPosition(
  formData: FormData,
  tenantId: string,
): Promise<{ programTemplateId: string; programCode: string; programName: string }> {
  const programTemplateId = requireString(formData, 'programTemplateId');
  const [template] = await db
    .select({
      id: schema.programTemplates.id,
      code: schema.programTemplates.code,
      name: schema.programTemplates.name,
    })
    .from(schema.programTemplates)
    .where(
      and(
        eq(schema.programTemplates.id, programTemplateId),
        eq(schema.programTemplates.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!template) {
    throw new Error('Program suksesi tidak ditemukan untuk business unit ini.');
  }
  return { programTemplateId: template.id, programCode: template.code, programName: template.name };
}

/**
 * Block adding the same seat to the same program twice.
 *
 * The seat is identified the way the form defines it — incumbent first (a
 * position row IS "the seat this person holds"), falling back to title +
 * department when there is no employee id — so two different holders of an
 * identically titled job stay two positions.
 */
async function assertPositionNotDuplicated(params: {
  tenantId: string;
  title: string;
  department: string | null;
  holderEmployeeId: string | null;
  programCode: string;
  programName: string;
  excludeId?: string;
}) {
  const identity = params.holderEmployeeId
    ? eq(schema.criticalPositions.holderEmployeeId, params.holderEmployeeId)
    : and(
        eq(schema.criticalPositions.title, params.title),
        params.department
          ? eq(schema.criticalPositions.department, params.department)
          : isNull(schema.criticalPositions.department),
      );

  const clashes = await db
    .select({ id: schema.criticalPositions.id })
    .from(schema.criticalPositions)
    .where(
      and(
        eq(schema.criticalPositions.tenantId, params.tenantId),
        eq(schema.criticalPositions.programCode, params.programCode),
        identity,
      ),
    );

  if (clashes.some((row) => row.id !== params.excludeId)) {
    throw new Error(
      `Posisi "${params.title}" sudah terdaftar pada program ${params.programName}. Pilih program lain, atau buka posisi yang sudah ada.`,
    );
  }
}

export type PositionHolderInput = { name: string; employeeId: string };

/**
 * Read the incumbent list the form submits.
 *
 * A position can be held by several people at once, so the form sends a
 * `holders` JSON array. The legacy `holderName`/`holderEmployeeId` pair is the
 * FIRST entry — kept on the row because a good number of readers join on it —
 * and is used as the fallback here so an older caller (or the agent tool, which
 * knows one incumbent) still produces a valid single-holder position.
 */
function parseHolders(formData: FormData): PositionHolderInput[] {
  const raw = formData.get('holders');
  const out: PositionHolderInput[] = [];
  const seen = new Set<string>();

  const push = (name: unknown, employeeId: unknown) => {
    const nameStr = typeof name === 'string' ? name.trim() : '';
    const idStr = typeof employeeId === 'string' ? employeeId.trim() : '';
    if (!nameStr && !idStr) return;
    // Two rows for the same NPK are the same person; an entry with no NPK is
    // keyed by name so a hand-typed holder is not silently dropped.
    const key = idStr ? `id:${idStr}` : `name:${nameStr.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ name: nameStr, employeeId: idStr });
  };

  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            push((item as Record<string, unknown>).name, (item as Record<string, unknown>).employeeId);
          }
        }
      }
    } catch {
      // Malformed payload falls through to the single-holder fields below.
    }
  }

  if (out.length === 0) {
    push(formData.get('holderName'), formData.get('holderEmployeeId'));
  }
  return out;
}

/** Replace a position's holder set. The first entry is the primary. */
async function writePositionHolders(
  tx: typeof db,
  positionId: string,
  holders: PositionHolderInput[],
): Promise<void> {
  await tx.execute(sql`DELETE FROM critical_position_holders WHERE position_id = ${positionId}`);
  for (const [index, holder] of holders.entries()) {
    // No employee id means nothing downstream can match the person (pool
    // exclusion, job-profile suggestion), so only named-with-NPK holders are
    // recorded here — the primary still shows by name on the row itself.
    if (!holder.employeeId) continue;
    await tx.execute(sql`
      INSERT INTO critical_position_holders (position_id, employee_id, name, is_primary)
      VALUES (${positionId}, ${holder.employeeId}, ${holder.name || null}, ${index === 0})
      ON CONFLICT (position_id, employee_id) DO UPDATE SET
        name = EXCLUDED.name,
        is_primary = EXCLUDED.is_primary
    `);
  }
}

export async function createPositionAction(formData: FormData) {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('positions.manage');
    const [createdBy, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
    const title = requireString(formData, 'title');
    const holderName = requireString(formData, 'holderName');
    const education = requireString(formData, 'education');
    const jobFamily = requireString(formData, 'jobFamily');
    const minGradeId = requireString(formData, 'minGradeId');
    const maxGradeId = requireString(formData, 'maxGradeId');
    const program = await resolveProgramForPosition(formData, tenantId);
    const department = optionalString(formData, 'department');
    const holders = parseHolders(formData);
    // The primary holder is the first of the set — the one the row itself
    // carries, and the one every existing join still resolves.
    const holderEmployeeId = holders[0]?.employeeId || optionalString(formData, 'holderEmployeeId');

    await assertPositionNotDuplicated({
      tenantId,
      title,
      department,
      holderEmployeeId,
      programCode: program.programCode,
      programName: program.programName,
    });

    const competenciesRaw = formData.get('competencies') as string | null;
    const competenciesParsed = competenciesRaw
      ? (JSON.parse(competenciesRaw) as (string | { technicalName: string; targetProficiency?: string })[])
      : undefined;
    const requiredCompetencies = competenciesParsed && competenciesParsed.length > 0
      ? competenciesParsed
          .map((item) =>
            typeof item === 'string'
              ? { technicalId: item, technicalName: item }
              : {
                  technicalId: item.technicalName,
                  technicalName: item.technicalName,
                  ...(item.targetProficiency ? { targetProficiency: item.targetProficiency } : {}),
                },
          )
          .filter((c) => c.technicalName)
      : undefined;

    const [inserted] = await db
      .insert(schema.criticalPositions)
      .values({
        title,
        department,
        division: optionalString(formData, 'division'),
        status: 'active',
        programTemplateId: program.programTemplateId,
        programCode: program.programCode,
        holderName: holders[0]?.name || holderName,
        holderEmployeeId,
        education,
        experience: optionalString(formData, 'experience'),
        jobFamily,
        minGradeId,
        maxGradeId,
        requiredCompetencies: requiredCompetencies as unknown as object | undefined,
        tenantId,
        createdBy,
      })
      .returning({ id: schema.criticalPositions.id });

    await writePositionHolders(db, inserted!.id, holders);

    await logAudit({
      tenantId,
      actorId: createdBy,
      entityType: 'position',
      entityId: inserted!.id,
      action: 'create',
      summary:
        `Posisi "${title}" dibuat pada program ${program.programName}` +
        (holders.length > 1 ? ` dengan ${holders.length} pejabat.` : '.'),
    });

    revalidateCandidatePaths();
  } catch (err) {
    normalizeError(err);
  }
}

export async function updatePositionAction(formData: FormData) {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('positions.manage');
    const id = requireString(formData, 'id');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);
    const title = requireString(formData, 'title');

    const minGradeIdRaw = optionalString(formData, 'minGradeId');
    const maxGradeIdRaw = optionalString(formData, 'maxGradeId');
    const department = optionalString(formData, 'department');
    const holders = parseHolders(formData);
    const holderEmployeeId = holders[0]?.employeeId || optionalString(formData, 'holderEmployeeId');

    const [existing] = await db
      .select({
        programCode: schema.criticalPositions.programCode,
        programTemplateId: schema.criticalPositions.programTemplateId,
      })
      .from(schema.criticalPositions)
      .where(and(eq(schema.criticalPositions.id, id), eq(schema.criticalPositions.tenantId, tenantId)))
      .limit(1);
    if (!existing) throw new Error('Posisi tidak ditemukan.');

    // The program is only editable while the position has never been scored: a
    // finished run is an assessment made under one program's rules, and moving
    // the row afterwards would relabel that history instead of recording a new
    // decision. Scoring the seat under another program means adding it again.
    const requestedTemplateId = optionalString(formData, 'programTemplateId');
    let program: { programTemplateId: string; programCode: string; programName: string } | null = null;
    if (requestedTemplateId && requestedTemplateId !== existing.programTemplateId) {
      const [{ runs } = { runs: 0 }] = await db
        .select({ runs: sql<number>`count(*)::int` })
        .from(schema.scoringRuns)
        // Only a REAL run is an assessment on record; a demo run (drizzle/0093)
        // must never lock a real position's program.
        .where(and(eq(schema.scoringRuns.positionId, id), eq(schema.scoringRuns.isDemo, false)));
      if (runs > 0) {
        throw new Error(
          'Program tidak dapat diubah karena posisi ini sudah pernah di-scoring. Tambahkan posisi baru dengan program yang diinginkan.',
        );
      }
      program = await resolveProgramForPosition(formData, tenantId);
      await assertPositionNotDuplicated({
        tenantId,
        title,
        department,
        holderEmployeeId,
        programCode: program.programCode,
        programName: program.programName,
        excludeId: id,
      });
    }

    await db
      .update(schema.criticalPositions)
      .set({
        title,
        department,
        division: optionalString(formData, 'division'),
        status: 'active',
        ...(program
          ? { programTemplateId: program.programTemplateId, programCode: program.programCode }
          : {}),
        holderName: holders[0]?.name || optionalString(formData, 'holderName'),
        holderEmployeeId,
        minGradeId: minGradeIdRaw || null,
        maxGradeId: maxGradeIdRaw || null,
        updatedAt: new Date(),
      })
      .where(eq(schema.criticalPositions.id, id));

    await writePositionHolders(db, id, holders);

    await logAudit({
      tenantId,
      actorId,
      entityType: 'position',
      entityId: id,
      action: 'update',
      summary: program
        ? `Posisi "${title}" diperbarui, program dipindah ke ${program.programName}.`
        : `Posisi "${title}" diperbarui.`,
    });

    revalidateCandidatePaths();
    revalidatePath(`/positions/${id}`);
  } catch (err) {
    normalizeError(err);
  }
}

export async function updatePositionQualificationsAction(formData: FormData) {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  await requirePermission('positions.manage');
  const id = requireString(formData, 'id');
  const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

  const competenciesRaw = formData.get('competencies') as string | null;
  const competencies = competenciesRaw ? JSON.parse(competenciesRaw) : undefined;

  await db
    .update(schema.criticalPositions)
    .set({
      education: optionalString(formData, 'education'),
      experience: optionalString(formData, 'experience'),
      jobFamily: optionalString(formData, 'jobFamily'),
      ...(competencies !== undefined ? { requiredCompetencies: competencies as unknown as object } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.criticalPositions.id, id));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'position',
    entityId: id,
    action: 'update',
    summary: `Kualifikasi posisi diperbarui dari job profile${competencies?.length ? ` (${competencies.length} kompetensi).` : '.'}`,
  });

  revalidateCandidatePaths();
  revalidatePath(`/positions/${id}`);
}

export async function deletePositionAction(formData: FormData) {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  try {
    await requirePermission('positions.manage');
    const id = requireString(formData, 'id');
    const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

    await db.delete(schema.criticalPositions).where(eq(schema.criticalPositions.id, id));

    await logAudit({
      tenantId,
      actorId,
      entityType: 'position',
      entityId: id,
      action: 'delete',
      summary: `Posisi dihapus.`,
    });

    revalidateCandidatePaths();
    revalidatePath(`/positions/${id}`);
  } catch (err) {
    normalizeError(err);
  }
}

export async function listTechnicalCompetenciesAction(): Promise<{ technicalId: string; technicalName: string }[]> {
  await requirePermission('candidates.view');
  const rows = await db
    .select({
      technicalId: schema.syncTechnicalCompetencies.technicalId,
      technicalName: schema.syncTechnicalCompetencies.technicalName,
    })
    .from(schema.syncTechnicalCompetencies)
    .where(eq(schema.syncTechnicalCompetencies.isActive, true));

  const seen = new Set<string>();
  const distinct = rows
    .map((r) => ({ technicalId: r.technicalId, technicalName: r.technicalName ?? r.technicalId }))
    .filter((r) => {
      const key = `${r.technicalId}:${r.technicalName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  distinct.sort((a, b) => a.technicalName.localeCompare(b.technicalName));
  return distinct;
}

export async function updatePositionCompetenciesAction(formData: FormData) {
  // Positions are real records: demo mode never writes them (lib/demo/).
  await refuseInDemoMode();
  await requirePermission('positions.manage');
  const id = requireString(formData, 'id');
  const competenciesRaw = formData.get('competencies') as string | null;
  const [actorId, tenantId] = await Promise.all([ensureLocalUser(), getCurrentTenantId()]);

  const competencies: { technicalId: string; technicalName: string; targetProficiency?: string }[] =
    competenciesRaw ? JSON.parse(competenciesRaw) : [];

  await db
    .update(schema.criticalPositions)
    .set({
      requiredCompetencies: competencies as unknown as object,
      updatedAt: new Date(),
    })
    .where(eq(schema.criticalPositions.id, id));

  await logAudit({
    tenantId,
    actorId,
    entityType: 'position',
    entityId: id,
    action: 'update',
    summary: `${competencies.length} kompetensi teknis diperbarui untuk posisi.`,
  });

  revalidateCandidatePaths();
  revalidatePath(`/positions/${id}`);
}
