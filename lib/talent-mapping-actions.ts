'use server';

import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { logAudit } from '@/lib/audit';
import { getCurrentUser } from '@/lib/auth';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { isDemoMode } from '@/lib/app-mode';
import { patchDemoCopy } from '@/lib/demo/write';
import {
  TALENT_MAPPING_JUSTIFICATION_MAX,
  TALENT_MAPPING_JUSTIFICATION_MIN,
  quadrantLabel,
  type TalentMappingAuditEntry,
  type TalentMappingMoveInput,
  type TalentMappingMoveResult,
} from '@/lib/talent-mapping';
import { getTalentMappingData, loadTalentMappingAudit } from '@/lib/talent-mapping-data';
import { getCandidateMappingStanding } from '@/lib/talent-pool-data';
import { getCurrentTenantId } from '@/lib/tenant';
import { demoScrub } from '@/lib/demo/names';

/**
 * Every page that shows a HAV, or decides with one, reads the quadrant this
 * action writes (lib/hav-effective.ts) — so all of them are revalidated, not
 * just the map.
 */
const HAV_READER_PATHS = ['/talent-pool/mapping', '/talent-pool', '/candidates', '/'];

const STALE_VIEW_MESSAGE =
  'Peta sudah berubah sejak halaman ini dimuat — kandidat ini dipindahkan pengguna lain, atau datanya (upload HAV, PA, BA) baru tersinkron. Peta terbaru sudah ditampilkan; ulangi bila masih perlu.';

/** Thrown inside the transaction when the placement row moved under us; rolls the move back. */
class StaleMapError extends Error {}

/**
 * Move one candidate on the HAV 16-box — the review loop's only write, and the
 * top tier of the HAV in force everywhere in the app.
 *
 * Every rule here is server-side because the page's drag-and-drop is a
 * convenience, not a guard:
 *   • `candidates.manage` (the page itself only needs `candidates.view`);
 *   • a justification is mandatory for EVERY move, including a move back onto
 *     the automatic square — the trail exists so each deviation, and each
 *     undoing of one, names its reason;
 *   • the candidate must be on the map right now: pass the Talent Pool's
 *     discipline rule, judged by the same evaluator the page uses;
 *   • the reviewer's view must be current (`expectedQuadrant`), and the write
 *     itself is conditional on the placement row being what was read — see the
 *     transaction below.
 *
 * Landing on the AUTOMATIC square (the HAV upload, else the formula) DELETES
 * the manual placement instead of storing one equal to it: the candidate then
 * follows the automatic answer again when it changes, which is what "kembalikan
 * ke otomatis" means. Anywhere else writes the placement.
 *
 * The placement write and its audit row commit in ONE transaction. A move that
 * is not on the trail must not exist, and a trail entry for a move that did not
 * happen would be worse.
 *
 * The placement is stamped with the DATABASE's now(), on insert and on update:
 * it stays in force only while it is newer than the last sync that changed the
 * automatic HAV (`candidates.hav_auto_changed_at`, also database-stamped), and
 * comparing a container clock against a database clock would let skew decide
 * which of two events came last.
 */
// Demo mode: the move is recorded with real data; the message and the refreshed map leave the server with initials.
export async function moveTalentMappingCandidateAction(
  ...args: Parameters<typeof moveTalentMappingCandidateActionImpl>
): ReturnType<typeof moveTalentMappingCandidateActionImpl> {
  return demoScrub(await moveTalentMappingCandidateActionImpl(...args));
}

async function moveTalentMappingCandidateActionImpl(
  input: TalentMappingMoveInput,
): Promise<TalentMappingMoveResult> {
  await requirePermission('candidates.manage');
  const [tenantId, actorId, sessionUser] = await Promise.all([
    getCurrentTenantId(),
    ensureLocalUser(),
    getCurrentUser().catch(() => null),
  ]);

  const justification = (input.justification ?? '').trim();
  if (justification.length < TALENT_MAPPING_JUSTIFICATION_MIN) {
    return {
      ok: false,
      message: `Alasan justifikasi wajib diisi, minimal ${TALENT_MAPPING_JUSTIFICATION_MIN} karakter.`,
      data: null,
    };
  }
  if (justification.length > TALENT_MAPPING_JUSTIFICATION_MAX) {
    return {
      ok: false,
      message: `Alasan justifikasi maksimal ${TALENT_MAPPING_JUSTIFICATION_MAX} karakter.`,
      data: null,
    };
  }
  const target = input.target === 'auto' ? 'auto' : Number(input.target);
  if (target !== 'auto' && !(Number.isInteger(target) && target >= 1 && target <= 16)) {
    return { ok: false, message: 'Kuadran tujuan tidak valid.', data: null };
  }

  // On the map = passes the Talent Pool's discipline rule. A candidate who does
  // not could still be placed by a forged request, and would then carry a HAV
  // decided on a page that never showed them.
  const standing = await getCandidateMappingStanding(input.candidateId);
  if (!standing) {
    return {
      ok: false,
      message:
        'Kandidat ini tidak ada di peta Talent Mapping (tidak lolos aturan Disiplin Talent Pool), sehingga HAV-nya tidak dapat diubah di sini. Peta terbaru sudah dimuat.',
      data: await getTalentMappingData(),
    };
  }
  // Demo mode: the NPK is never shown, not even as a fallback name.
  const demo = await isDemoMode();
  const candidateName = standing.name || (demo ? 'Kandidat' : standing.employeeId) || 'Kandidat';
  const hav = standing.effectiveHav;
  const automatic = hav.automatic;

  if (demo) {
    // Demo mode never writes the real record: a move is an edit of the
    // candidate's demo copy (candidates_dupp) — its HAV — not a placement, an
    // audit row or a HAV history entry. The automatic square UN-EDITS the
    // copy's HAV, so the HAV is resolved again from the merged record (real
    // upload, else the formula over the copy's PA and behaviour) — exactly what
    // an unedited demo candidate shows.
    if ((input.expectedQuadrant ?? null) !== (hav.quadrant ?? null)) {
      return { ok: false, message: STALE_VIEW_MESSAGE, data: await getTalentMappingData() };
    }
    const quadrant = target === 'auto' ? null : (target as number);
    if (quadrant != null && quadrant === hav.quadrant) {
      return { ok: false, message: `${candidateName} sudah berada di ${quadrantLabel(quadrant)}.`, data: null };
    }
    if (quadrant == null) await patchDemoCopy(standing.id, {}, actorId, { unedit: ['havQuadrant'] });
    else await patchDemoCopy(standing.id, { havQuadrant: String(quadrant) }, actorId);
    revalidatePath('/talent-pool');
    revalidatePath('/talent-pool/mapping');
    revalidatePath('/candidates');
    return {
      ok: true,
      message: quadrant == null ? `${candidateName} kembali mengikuti HAV otomatis.` : `${candidateName} dipindahkan ke ${quadrantLabel(quadrant)}.`,
      data: await getTalentMappingData(),
    };
  }

  const [existing] = await db
    .select({
      id: schema.talentMappingPlacements.id,
      version: sql<string>`${schema.talentMappingPlacements.updatedAt}::text`,
    })
    .from(schema.talentMappingPlacements)
    .where(
      and(
        eq(schema.talentMappingPlacements.tenantId, tenantId),
        eq(schema.talentMappingPlacements.candidateId, standing.id),
      ),
    )
    .limit(1);
  const currentQuadrant = hav.quadrant;

  if ((input.expectedQuadrant ?? null) !== (currentQuadrant ?? null)) {
    return { ok: false, message: STALE_VIEW_MESSAGE, data: await getTalentMappingData() };
  }

  const revert = target === 'auto' || target === automatic.quadrant;
  const newQuadrant = revert ? automatic.quadrant : (target as number);
  if (revert && !existing) {
    return { ok: false, message: `${candidateName} sudah mengikuti HAV otomatis.`, data: null };
  }
  if (!revert && newQuadrant === currentQuadrant) {
    return { ok: false, message: `${candidateName} sudah berada di ${quadrantLabel(newQuadrant)}.`, data: null };
  }

  // The SSO login is this deployment's username (users.email is the unique
  // identity). Snapshotted onto the row so "who" survives the user row.
  const username = sessionUser?.email?.trim().toLowerCase() || null;

  const stored = {
    from: currentQuadrant != null ? String(currentQuadrant) : null,
    to: newQuadrant != null ? String(newQuadrant) : null,
    baseline: automatic.quadrant != null ? String(automatic.quadrant) : null,
    why: justification,
  };

  // Every write below is CONDITIONAL on the placement row being exactly what was
  // read above — its database-written `updated_at` (compared as text, at full
  // precision) is the version token, since every write moves it to the
  // writing transaction's `now()`. The `expectedQuadrant` check alone runs
  // before this transaction, and two submissions racing each other could both
  // pass it; this is what makes the second one lose instead of silently
  // overwriting the first.
  const placements = schema.talentMappingPlacements;
  const unchanged = existing
    ? and(eq(placements.id, existing.id), sql`${placements.updatedAt}::text = ${existing.version}`)
    : undefined;
  try {
    await db.transaction(async (tx) => {
      let written: { id: string }[];
      if (revert) {
        written = await tx.delete(placements).where(unchanged).returning({ id: placements.id });
      } else if (existing) {
        written = await tx
          .update(placements)
          .set({
            quadrant: stored.to!,
            baselineQuadrant: stored.baseline,
            baselineSource: automatic.source,
            justification: stored.why,
            placedBy: actorId,
            placedByUsername: username,
            updatedAt: sql`now()`,
          })
          .where(unchanged)
          .returning({ id: placements.id });
      } else {
        // Nobody had placed them when we read; DO NOTHING (zero rows) means
        // somebody has since.
        written = await tx
          .insert(placements)
          .values({
            tenantId,
            candidateId: standing.id,
            quadrant: stored.to!,
            baselineQuadrant: stored.baseline,
            baselineSource: automatic.source,
            justification: stored.why,
            placedBy: actorId,
            placedByUsername: username,
          })
          .onConflictDoNothing({ target: [placements.tenantId, placements.candidateId] })
          .returning({ id: placements.id });
      }
      if (written.length !== 1) throw new StaleMapError();

      await tx.insert(schema.talentAuditLogs).values({
        tenantId,
        // varchar(20) — the uuid below is the authoritative link; the NPK is for
        // a human reading the table.
        employeeId: (standing.employeeId ?? '').slice(0, 20),
        candidateId: standing.id,
        mappingKind: 'hav16',
        action: revert ? 'revert_to_automatic' : 'manual_place',
        oldQuadrant: stored.from,
        newQuadrant: stored.to,
        baselineQuadrant: stored.baseline,
        baselineSource: automatic.source,
        justificationReason: stored.why,
        changedByUserId: actorId,
        changedByUsername: username,
      });
    });
  } catch (err) {
    if (err instanceof StaleMapError) {
      return { ok: false, message: STALE_VIEW_MESSAGE, data: await getTalentMappingData() };
    }
    throw err;
  }

  // App-level trail (Tata Kelola → Riwayat Perubahan). Names the person, as
  // every candidate audit summary does, but NOT the square or the reason —
  // those two live in the talent trail.
  await logAudit({
    tenantId,
    actorId,
    entityType: 'talent_mapping',
    entityId: standing.id,
    action: 'update',
    summary: revert
      ? `Talent Mapping: penempatan manual "${candidateName}" dikembalikan ke HAV otomatis.`
      : `Talent Mapping: "${candidateName}" dipindahkan manual (kuadran & alasan tercatat di riwayat Talent Mapping).`,
  });

  for (const path of HAV_READER_PATHS) revalidatePath(path);

  // The HAV rules now judge the new square, so say what that did to membership.
  const wasInPool = standing.inTalentPool;
  const willBeInPool = newQuadrant != null && standing.poolQuadrants.includes(newQuadrant);
  const poolNote =
    wasInPool && !willBeInPool
      ? ' Dengan kuadran ini kandidat keluar dari daftar Lolos Talent Pool (aturan HAV), tetapi tetap tampil di peta.'
      : !wasInPool && willBeInPool
        ? ' Dengan kuadran ini kandidat kini lolos Talent Pool.'
        : '';
  return {
    ok: true,
    message:
      (revert
        ? newQuadrant != null
          ? `${candidateName} kembali mengikuti HAV otomatis: ${quadrantLabel(newQuadrant)}.`
          : `${candidateName} kembali mengikuti HAV otomatis — belum terpetakan sampai upload HAV atau data PA/BA-nya ada.`
        : `${candidateName} dipindahkan ke ${quadrantLabel(newQuadrant)}. Perpindahan tercatat di riwayat beserta alasannya; ` +
          `penempatan ini berlaku sampai ada sync yang mengubah HAV otomatisnya (upload HAV, atau PA/BA baru).`) +
      poolNote,
    data: await getTalentMappingData(),
  };
}

/**
 * One candidate's full move history. The page loads only the newest moves of
 * the whole unit up front, so a candidate's older entries come from here.
 */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getTalentMappingCandidateHistoryAction(
  ...args: Parameters<typeof getTalentMappingCandidateHistoryActionImpl>
): ReturnType<typeof getTalentMappingCandidateHistoryActionImpl> {
  return demoScrub(await getTalentMappingCandidateHistoryActionImpl(...args));
}

async function getTalentMappingCandidateHistoryActionImpl(
  candidateId: string,
): Promise<TalentMappingAuditEntry[]> {
  await requirePermission('candidates.view');
  const tenantId = await getCurrentTenantId();
  const { entries } = await loadTalentMappingAudit(tenantId, { candidateId, limit: 500 });
  return entries;
}

/** Re-read the map without moving anyone — the page's "Muat ulang". */
// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function refreshTalentMappingAction(
  ...args: Parameters<typeof refreshTalentMappingActionImpl>
): ReturnType<typeof refreshTalentMappingActionImpl> {
  return demoScrub(await refreshTalentMappingActionImpl(...args));
}

async function refreshTalentMappingActionImpl() {
  await requirePermission('candidates.view');
  return getTalentMappingData();
}
