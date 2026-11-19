import 'server-only';

import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { decryptOrNull, ensureUnlocked } from '@/lib/crypto/key-store';
import { resolveEffectiveHav, type EffectiveHav, type HavSource } from '@/lib/hav-effective';
import { normalizeHavQuadrant } from '@/lib/hav-quadrant';
import { isDemoMode } from '@/lib/app-mode';
import { loadDemoCopies } from '@/lib/demo/store';
import { demoEdits } from '@/lib/demo/fields';

/**
 * Server half of the HAV in force (lib/hav-effective.ts): reads the Talent
 * Mapping placements and folds them into candidate rows.
 *
 * `withEffectiveHav` REPLACES `havQuadrant` on each row with the quadrant in
 * force, and keeps the Excel value under `uploadedHavQuadrant`. Replacing is the
 * point: the filter engine, the profile builders and every display already read
 * `havQuadrant`, so routing a loader through here is all it takes for that
 * reader to stop disagreeing with Talent Mapping — no reader has to learn a new
 * field to be correct, only to SHOW the source.
 *
 * Placements are looked up by candidate id alone, never by tenant. A scoring
 * pool may span business units, and a candidate belongs to exactly one tenant,
 * whose Talent Mapping is the only place their placement can have been made.
 */

/** Postgres "undefined_column", wherever the driver or Drizzle put it. */
function isUndefinedColumn(err: unknown): boolean {
  const code = (e: unknown) => (e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined);
  return code(err) === '42703' || code((err as { cause?: unknown } | null)?.cause) === '42703';
}

let warnedNoClock = false;

/**
 * Manual quadrants IN FORCE, by candidate id. A sealed value that will not open
 * is skipped and logged.
 *
 * "In force" is decided on TIME, here, in SQL: a placement counts only while it
 * is NEWER than `candidates.hav_auto_changed_at` — the last time a sync (HAV
 * upload, shared HAV.xlsx, or the candidate sync carrying a new PA/BA from
 * MSSQL) changed that person's automatic HAV. Whichever happened last wins. The
 * sync that moves the clock also deletes the older placement
 * (sync-service hav-supersede.ts); comparing here as well is what keeps every
 * reader right if a placement and a sync ever race. scoring-service
 * hav-placements.ts runs the same predicate — keep the two in step.
 */
export async function loadManualHavQuadrants(candidateIds: string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  await ensureUnlocked();
  const placements = schema.talentMappingPlacements;
  let rows: { candidateId: string; quadrant: string }[];
  try {
    rows = await db
      .select({ candidateId: placements.candidateId, quadrant: placements.quadrant })
      .from(placements)
      .innerJoin(schema.candidates, eq(schema.candidates.id, placements.candidateId))
      .where(
        and(
          inArray(placements.candidateId, ids),
          or(
            isNull(schema.candidates.havAutoChangedAt),
            gt(placements.updatedAt, schema.candidates.havAutoChangedAt),
          ),
        ),
      );
  } catch (err) {
    if (isUndefinedColumn(err)) {
      // drizzle/0080 not applied: no sync event was ever timestamped, so every
      // stored placement is in force — precedence alone, as before the clock.
      if (!warnedNoClock) {
        console.warn('[hav-placements] candidates.hav_auto_changed_at missing (drizzle/0080); comparing by precedence only');
        warnedNoClock = true;
      }
      try {
        rows = await db
          .select({ candidateId: placements.candidateId, quadrant: placements.quadrant })
          .from(placements)
          .where(inArray(placements.candidateId, ids));
      } catch (inner) {
        console.warn('[hav-placements] talent_mapping_placements unreadable; manual tier skipped:', inner);
        return out;
      }
    } else {
      // drizzle/0078 not applied yet: no placement can exist, so every reader
      // falls back to upload > formula exactly as if none had been made.
      // Logged, because a permanently missing table would otherwise look like
      // "no placements" forever.
      console.warn('[hav-placements] talent_mapping_placements unreadable; manual tier skipped:', err);
      return out;
    }
  }
  for (const row of rows) {
    const opened = decryptOrNull(row.quadrant).value;
    const canonical = normalizeHavQuadrant(opened);
    if (canonical) out.set(row.candidateId, Number(canonical));
    else console.warn(`[hav-placements] placement for candidate ${row.candidateId} could not be opened`);
  }
  return out;
}

let warnedNoTier = false;

/**
 * Candidates whose last HAV event was a PA/BA change — an edit on the Kandidat
 * form, a PA/BA workbook or MSSQL sync that changed their PA/BA, or the
 * "Hitung kuadran HAV" button: `candidates.hav_auto_tier = 'formula'`
 * (drizzle/0098). For them the formula outranks an older upload (see
 * lib/hav-effective.ts). scoring-service hav-placements.ts reads the same
 * column. Before the migration nobody is pinned and the static order applies.
 */
export async function loadHavFormulaPins(candidateIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(candidateIds.filter(Boolean)));
  const out = new Set<string>();
  if (ids.length === 0) return out;
  try {
    const rows = await db
      .select({ id: schema.candidates.id })
      .from(schema.candidates)
      .where(and(inArray(schema.candidates.id, ids), eq(schema.candidates.havAutoTier, 'formula')));
    for (const row of rows) out.add(row.id);
  } catch (err) {
    if (!warnedNoTier) {
      console.warn('[hav-placements] candidates.hav_auto_tier unreadable (drizzle/0098?); static HAV order only:', err);
      warnedNoTier = true;
    }
  }
  return out;
}

type HavInputRow = {
  id: string;
  havQuadrant: string | null;
  performanceGrade: string | null;
  behaviorRecommendation: string | null;
};

export type WithEffectiveHav<T> = Omit<T, 'havQuadrant'> & {
  /** The quadrant IN FORCE as "1".."16" (manual > upload > formula, formula pinned by a PA/BA change), or null. */
  havQuadrant: string | null;
  havSource: HavSource;
  /** The HAV Excel value as stored, canonicalized — '' when there is none. */
  uploadedHavQuadrant: string;
  effectiveHav: EffectiveHav;
};

/**
 * Fold the HAV in force into already-DECRYPTED candidate rows. One query for
 * the placements, however many rows.
 */
export async function withEffectiveHav<T extends HavInputRow>(
  rows: T[],
  manual?: Map<string, number>,
): Promise<WithEffectiveHav<T>[]> {
  const ids = rows.map((r) => r.id);
  let [placements, pins] = await Promise.all([
    manual ? Promise.resolve(manual) : loadManualHavQuadrants(ids),
    loadHavFormulaPins(ids),
  ]);
  // Demo mode: the rows arrive already overlaid (presentCandidateRowForDemo):
  // edited fields from the demo copy, the rest live. A HAV EDITED in demo mode
  // is the answer — a real manual placement must not outrank it. A HAV nobody
  // edited is resolved as usual (placement › upload › formula), with the
  // formula reading the merged PA and behaviour, so editing PA alone moves the
  // HAV the way it would for a real candidate.
  if (rows.length > 0 && (await isDemoMode())) {
    // A demo PA/BA edit or "Hitung kuadran HAV" pins the formula on the copy
    // (`havTier`), over the real placement and the real upload; a demo HAV
    // edit outranks a real formula pin, because the edit is the answer.
    const copies = await loadDemoCopies(ids);
    const havEdited = Array.from(copies.entries()).filter(([, c]) => demoEdits(c, 'havQuadrant'));
    const formulaPinned = Array.from(copies.entries()).filter(
      ([, c]) => c.havTier === 'formula' && !demoEdits(c, 'havQuadrant'),
    );
    if (havEdited.length > 0 || formulaPinned.length > 0) {
      placements = new Map(placements);
      pins = new Set(pins);
      for (const [id] of havEdited) {
        placements.delete(id);
        pins.delete(id);
      }
      for (const [id] of formulaPinned) {
        placements.delete(id);
        pins.add(id);
      }
    }
  }
  return rows.map((row) => {
    const effectiveHav = resolveEffectiveHav({
      manualQuadrant: placements.get(row.id) ?? null,
      uploadedQuadrant: row.havQuadrant,
      performanceGrade: row.performanceGrade,
      behaviorRecommendation: row.behaviorRecommendation,
      automaticTier: pins.has(row.id) ? 'formula' : null,
    });
    return {
      ...row,
      havQuadrant: effectiveHav.quadrant != null ? String(effectiveHav.quadrant) : null,
      havSource: effectiveHav.source,
      uploadedHavQuadrant: normalizeHavQuadrant(row.havQuadrant),
      effectiveHav,
    };
  });
}
