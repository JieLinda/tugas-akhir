import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { candidateDemoStates, candidates, candidatesDupp } from '@/lib/db/schema';
import { decryptOrNull, ensureUnlocked } from '@/lib/crypto/key-store';
import { decryptCandidateRows } from '@/lib/candidate-crypto';
import { deriveHavQuadrant } from '@/lib/hav-quadrant-derive';
import { isDemoMode } from '@/lib/app-mode';
import {
  parseDemoPayload,
  presentCandidateRowForDemo,
  resolveDemoCopy,
  type DemoCandidateFields,
  type DemoRealValues,
} from './fields';

// Reads behind demo mode (drizzle/0093). Every demo-aware loader goes through
// presentForDemo(): it is the one place that knows a candidate is OFF unless
// switched on, and that a candidate with a dupp copy is shown as that copy.

function isMissingRelation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '42P01' || e?.cause?.code === '42P01';
}

let warnedMissing = false;
function warnMissingOnce(err: unknown) {
  if (warnedMissing) return;
  warnedMissing = true;
  console.warn('[demo] candidates_dupp / candidate_demo_states missing — apply drizzle/0093. Demo mode shows every candidate as OFF.', err);
}

/** The web app's HAV formula, as a string the copy compares against. */
export function demoFormulaOf(performanceGrade: string | null, behaviorRecommendation: string | null): string | null {
  const derived = deriveHavQuadrant({ performanceGrade, behaviorRecommendation });
  return derived.ok ? String(derived.quadrant) : null;
}

/** The candidates' real values for every field a demo copy can edit, decrypted. */
async function loadRealValues(ids: string[]): Promise<Map<string, DemoRealValues>> {
  const out = new Map<string, DemoRealValues>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: candidates.id,
      name: candidates.name,
      employeeId: candidates.employeeId,
      email: candidates.email,
      currentPosition: candidates.currentPosition,
      department: candidates.department,
      division: candidates.division,
      yearsExperience: candidates.yearsExperience,
      disciplineStatus: candidates.disciplineStatus,
      mcuStatus: candidates.mcuStatus,
      mcuNoteManual: candidates.mcuNoteManual,
      performanceGrade: candidates.performanceGrade,
      havQuadrant: candidates.havQuadrant,
      behaviorRecommendation: candidates.behaviorRecommendation,
      behaviorNotes: candidates.behaviorNotes,
      education: candidates.education,
      major: candidates.major,
    })
    .from(candidates)
    .where(inArray(candidates.id, ids));
  const s = (v: unknown) => (v == null ? null : String(v));
  for (const r of decryptCandidateRows(rows)) {
    out.set(r.id, {
      name: s(r.name),
      employeeId: s(r.employeeId),
      email: s(r.email),
      currentPosition: s(r.currentPosition),
      department: s(r.department),
      division: s(r.division),
      yearsExperience: s(r.yearsExperience),
      disciplineStatus: s(r.disciplineStatus),
      mcuStatus: s(r.mcuStatus),
      mcuNoteManual: s(r.mcuNoteManual),
      performanceGrade: s(r.performanceGrade),
      havQuadrant: s(r.havQuadrant),
      behaviorRecommendation: s(r.behaviorRecommendation),
      behaviorNotes: s(r.behaviorNotes),
      education: s(r.education),
      major: s(r.major),
    });
  }
  return out;
}

/**
 * Demo copies, decrypted and RESOLVED, for these candidates (every copy when
 * `ids` is omitted): each one is the fields edited in demo mode over the
 * candidate's real values as they stand now (`resolveDemoCopy`), with
 * `editedFields` set. Every reader — the row overlay, scoring pools, Talent
 * Pool, Talent Mapping, names — gets this merged view, so none of
 * them can read a stale snapshot of a field nobody edited.
 */
export async function loadDemoCopies(ids?: string[]): Promise<Map<string, DemoCandidateFields>> {
  const stored = await loadStoredDemoCopies(ids);
  if (stored.size === 0) return stored;
  const real = await loadRealValues(Array.from(stored.keys()));
  const out = new Map<string, DemoCandidateFields>();
  for (const [id, copy] of stored) {
    const values = real.get(id);
    // The candidate row is gone (CASCADE deletes the copy too, so this is a
    // race at most): nothing to merge with, keep the copy as stored.
    out.set(id, values ? resolveDemoCopy(copy, values, demoFormulaOf) : copy);
  }
  return out;
}

/** Demo copies exactly as stored — no merge. For the write path only. */
async function loadStoredDemoCopies(ids?: string[]): Promise<Map<string, DemoCandidateFields>> {
  const out = new Map<string, DemoCandidateFields>();
  if (ids && ids.length === 0) return out;
  let rows: { candidateId: string; payload: string }[];
  try {
    rows = await db
      .select({ candidateId: candidatesDupp.candidateId, payload: candidatesDupp.payload })
      .from(candidatesDupp)
      .where(ids ? inArray(candidatesDupp.candidateId, ids) : undefined);
  } catch (err) {
    if (isMissingRelation(err)) {
      warnMissingOnce(err);
      return out;
    }
    throw err;
  }
  if (rows.length === 0) return out;
  await ensureUnlocked();
  for (const r of rows) {
    // A copy that cannot be opened (locked app) is skipped, not shown raw:
    // the candidate then reads as its real data rather than as ciphertext.
    const copy = parseDemoPayload(decryptOrNull(r.payload).value);
    if (copy) out.set(r.candidateId, copy);
  }
  return out;
}

/** Which of these candidates have a demo copy — ids only, nothing decrypted. */
export async function loadDemoCopiedIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  try {
    const rows = await db
      .select({ id: candidatesDupp.candidateId })
      .from(candidatesDupp)
      .where(inArray(candidatesDupp.candidateId, ids));
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    if (isMissingRelation(err)) {
      warnMissingOnce(err);
      return new Set();
    }
    throw err;
  }
}

/** Candidates switched ON in demo mode (all of them, or those among `ids`). */
export async function loadDemoOnIds(ids?: string[]): Promise<Set<string>> {
  if (ids && ids.length === 0) return new Set();
  try {
    const rows = await db
      .select({ id: candidateDemoStates.candidateId })
      .from(candidateDemoStates)
      .where(
        ids
          ? and(eq(candidateDemoStates.enabled, true), inArray(candidateDemoStates.candidateId, ids))
          : eq(candidateDemoStates.enabled, true),
      );
    return new Set(rows.map((r) => r.id));
  } catch (err) {
    if (isMissingRelation(err)) {
      warnMissingOnce(err);
      return new Set();
    }
    throw err;
  }
}

export type DemoPresentOptions = {
  /**
   * Drop OFF candidates — for every feature that must behave as if they had
   * been deleted (filtering, Talent Pool, Talent Mapping, scoring). The
   * /candidates pages keep them (marked) so they can be switched back on.
   */
  onlyOn: boolean;
};

/**
 * The demo view of decrypted candidate rows: OFF candidates removed when asked,
 * the dupp copy applied, photos removed. `idOf` reads a row's candidate id.
 */
export async function presentRowsForDemo<T extends object>(
  rows: T[],
  idOf: (row: T) => string,
  opts: DemoPresentOptions,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = Array.from(new Set(rows.map(idOf)));
  const [copies, on] = await Promise.all([loadDemoCopies(ids), opts.onlyOn ? loadDemoOnIds(ids) : Promise.resolve(null)]);
  const kept = on ? rows.filter((r) => on.has(idOf(r))) : rows;
  return kept.map((r) => presentCandidateRowForDemo(r, copies.get(idOf(r))));
}

/** presentRowsForDemo in demo mode; the rows untouched in real mode. */
export async function forCurrentMode<T extends object>(
  rows: T[],
  idOf: (row: T) => string,
  opts: DemoPresentOptions,
): Promise<T[]> {
  return (await isDemoMode()) ? presentRowsForDemo(rows, idOf, opts) : rows;
}

/** Demo-mode visibility of candidate ids: the ON subset in demo mode, all of them in real mode. */
export async function visibleCandidateIds(ids: string[]): Promise<string[]> {
  if (!(await isDemoMode())) return ids;
  const on = await loadDemoOnIds(ids);
  return ids.filter((id) => on.has(id));
}

/**
 * Demo-mode display names: candidate id → their demo copy's name, for the
 * loaders that name candidates without loading whole rows (decision records,
 * pick lists). Empty in real mode, so `names.get(id) ?? realName` is the whole
 * rule at each call site.
 */
export async function demoNamesFor(ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  if (!(await isDemoMode())) return new Map();
  const list = Array.from(new Set(Array.from(ids).filter((id): id is string => Boolean(id))));
  if (list.length === 0) return new Map();
  const copies = await loadDemoCopies(list);
  return new Map(Array.from(copies.entries()).map(([id, copy]) => [id, copy.name]));
}
