import 'server-only';

import { and, eq, lte, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { decryptOrNull, encryptIfEnabled, ensureUnlocked } from '@/lib/crypto/key-store';
import { HAV_SOURCE_LABEL, resolveEffectiveHav, type EffectiveHav } from '@/lib/hav-effective';
import { loadHavFormulaPins, loadManualHavQuadrants } from '@/lib/hav-placements';
import { normalizeHavQuadrant } from '@/lib/hav-quadrant';

/**
 * The web app's own HAV EVENTS (docs/talent-mapping.md § "Perubahan PA/BA dan
 * tier formula"): a PA or behaviour edit on the Kandidat form, and the
 * "Hitung kuadran HAV" button. Each puts the FORMULA in force for that
 * candidate — over an older Talent Mapping placement AND an older HAV upload —
 * until the next placement or a differing HAV upload:
 *
 *   - `candidates.hav_auto_tier = 'formula'` (drizzle/0098) makes the formula
 *     outrank the upload for every reader (lib/hav-effective.ts);
 *   - `candidates.hav_auto_changed_at = now()` makes every placement made
 *     before it stop applying (the readers' clock predicate), and the placement
 *     row is deleted here, in the same transaction, like a sync supersedes one;
 *   - a 'hav16' trail row says what happened, sealed like the rest.
 *
 * The sync-side twin is sync-service hav-supersede.ts (PA/BA uploads and MSSQL
 * syncs). Every timestamp is the database's `now()`, because placements are
 * stamped by the database and the two are compared.
 */

export type HavFormulaOrigin = 'candidate_edit' | 'hav_formula';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

let shapeCache: { clock: boolean; tier: boolean } | null = null;

/** Whether drizzle/0080 and 0098 are applied. Checked OUTSIDE the transaction: a failed column would abort it. */
async function schemaShape(): Promise<{ clock: boolean; tier: boolean }> {
  if (shapeCache?.clock && shapeCache.tier) return shapeCache;
  const result = await db.execute(sql`
    SELECT
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'candidates' AND column_name = 'hav_auto_changed_at') AS clock,
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'candidates' AND column_name = 'hav_auto_tier') AS tier`);
  const row = (result as unknown as { rows: { clock: boolean; tier: boolean }[] }).rows?.[0];
  shapeCache = { clock: Boolean(row?.clock), tier: Boolean(row?.tier) };
  if (!shapeCache.tier) {
    console.warn('[hav-formula-event] candidates.hav_auto_tier missing (drizzle/0098 not applied); a PA/BA edit cannot outrank an upload');
  }
  return shapeCache;
}

/**
 * The HAV in force for one candidate RIGHT NOW, from already-decrypted inputs:
 * what a reader sees before the event. Read before the write.
 */
export async function currentEffectiveHav(input: {
  candidateId: string;
  uploadedQuadrant: string | null;
  performanceGrade: string | null;
  behaviorRecommendation: string | null;
}): Promise<EffectiveHav> {
  await ensureUnlocked();
  const [manual, pins] = await Promise.all([
    loadManualHavQuadrants([input.candidateId]),
    loadHavFormulaPins([input.candidateId]),
  ]);
  return resolveEffectiveHav({
    manualQuadrant: manual.get(input.candidateId) ?? null,
    uploadedQuadrant: input.uploadedQuadrant,
    performanceGrade: input.performanceGrade,
    behaviorRecommendation: input.behaviorRecommendation,
    automaticTier: pins.has(input.candidateId) ? 'formula' : null,
  });
}

export type HavFormulaEventInput = {
  candidateId: string;
  tenantId: string;
  employeeId: string | null;
  origin: HavFormulaOrigin;
  /** The HAV in force before the event (currentEffectiveHav). */
  before: EffectiveHav;
  /** The formula's quadrant over the NEW PA and behaviour (must be computable). */
  formulaQuadrant: number;
  actorId: string | null;
  username: string | null;
};

function describe(input: HavFormulaEventInput, displaced: number | null | 'unreadable'): string {
  const head =
    input.origin === 'hav_formula'
      ? 'Tombol "Hitung kuadran HAV" di Kandidat menempatkan HAV menurut rumus PA × BA'
      : 'PA/BA kandidat ini diubah di halaman Kandidat, sehingga HAV ditempatkan ulang menurut rumus PA × BA';
  const was =
    input.before.quadrant != null
      ? `Q${input.before.quadrant} (${HAV_SOURCE_LABEL[input.before.source]})`
      : 'belum ada';
  const line = `${head}: ${was} → Q${input.formulaQuadrant} (${HAV_SOURCE_LABEL.formula}).`;
  if (displaced == null) return line;
  const label = displaced === 'unreadable' ? '(tidak terbaca)' : `Q${displaced}`;
  return `${line} Perubahan ini terjadi SETELAH penempatan manual ${label}, dan menurut aturan urutan waktu yang terbaru yang berlaku — penempatan manual itu digantikan.`;
}

/**
 * Record the event inside the caller's transaction, so it commits or rolls back
 * with the PA/BA write that caused it. Returns whether a placement was displaced.
 *
 * Logged when the HAV a reader sees moves, a placement is displaced, or the
 * button was pressed (an explicit act, worth a line even when nothing moved).
 */
export async function recordFormulaHavEvent(tx: Tx, input: HavFormulaEventInput): Promise<{ superseded: boolean }> {
  const shape = await schemaShape();
  if (!shape.clock) return { superseded: false };

  // Sealed before any row is touched: a locked app refuses here, and the
  // transaction then rolls the PA/BA edit back rather than leaving it unlogged.
  const [sealedOld, sealedNew] = await Promise.all([
    encryptIfEnabled(input.before.quadrant != null ? String(input.before.quadrant) : null),
    encryptIfEnabled(String(input.formulaQuadrant)),
  ]);

  await tx
    .update(schema.candidates)
    .set({
      havAutoChangedAt: sql`now()`,
      havAutoChangeSource: input.origin,
      ...(shape.tier ? { havAutoTier: 'formula' as const } : {}),
    })
    .where(eq(schema.candidates.id, input.candidateId));

  // `<=` is the exact complement of the readers' strict `>`.
  const placements = schema.talentMappingPlacements;
  const removed = await tx
    .delete(placements)
    .where(and(eq(placements.candidateId, input.candidateId), lte(placements.updatedAt, sql`now()`)))
    .returning({ quadrant: placements.quadrant });
  const displacedSealed = removed[0]?.quadrant ?? null;
  const displacedOpen =
    displacedSealed != null ? normalizeHavQuadrant(decryptOrNull(displacedSealed).value) : null;
  const displaced: number | null | 'unreadable' =
    displacedSealed == null ? null : displacedOpen ? Number(displacedOpen) : 'unreadable';

  const visible =
    input.before.quadrant !== input.formulaQuadrant || input.before.source !== 'formula';
  if (displaced == null && !visible && input.origin !== 'hav_formula') return { superseded: false };

  const why = await encryptIfEnabled(describe(input, displaced));
  await tx.insert(schema.talentAuditLogs).values({
    tenantId: input.tenantId,
    employeeId: (input.employeeId ?? '').slice(0, 20),
    candidateId: input.candidateId,
    mappingKind: 'hav16',
    action: displaced != null ? 'superseded_by_formula' : 'formula_applied',
    oldQuadrant: displacedSealed ?? sealedOld,
    newQuadrant: sealedNew,
    baselineQuadrant: sealedNew,
    baselineSource: 'formula',
    justificationReason: why,
    changedByUserId: input.actorId,
    changedByUsername: input.username,
  });
  return { superseded: displaced != null };
}
