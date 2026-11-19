// ── "Tambah Kandidat Pembanding": what a child run takes from its parent ──
//
// Pure, DB-free, and free of `server-only`, so the rules a child run is created
// under can be exercised directly (tests/scoring/rerun-freeze.test.ts) and read by
// the dialog for its pre-submit summary. `startRerunAction` in
// lib/scoring-engine.ts does the reads and the writes; every DECISION it makes
// about a re-run request lives here.
//
// Three decisions, one per export below:
//
//  1. Is this request allowed at all? (`validateRerunRequest`) — checked on the
//     server, never only in the dialog, because a guard that lives in the UI is
//     not a guard.
//  2. What is each picked person to the parent run? (`classifyRerunCandidates`)
//     — new to its pool (scored), already in its pool (carried, never re-scored),
//     or refused with a stated reason. Nobody disappears silently.
//  3. What does the child inherit beyond the aspect scores?
//     (`resolveFrozenBasis`) — the weights, active criteria, anchors and
//     reference date the parent actually ranked with.
//
// See "Re-run scoring — aturan desain" in CLAUDE.md for why each is frozen.

import type {
  FrozenPositionBasis,
  FrozenRunBasis,
  RerunCriterionKey,
  RunModelsRecord,
} from './rerun-modes';
import type { RunConfigSnapshot, RunRerunSnapshot } from './db/schema';
import { isCreatableRerunMode } from './rerun-modes';

const CRITERIA: RerunCriterionKey[] = [
  'technical',
  'career',
  'behavior',
  'performance',
  'hav',
  'education',
];

// ── 1. Validation ───────────────────────────────────────────────────────────

/** FR-RR-04: the reason is required and at most this long, on client and server. */
export const RERUN_REASON_MAX_LENGTH = 1000;

/** The parent run as the validator needs to see it. */
export type RerunParentFacts = {
  /** Null when the run does not exist in the CURRENT tenant. */
  tenantMatches: boolean;
  status: string;
  method: string;
  /** Rows in `scoring_run_pool_aspects` for the parent. */
  poolSnapshotRows: number;
};

/**
 * Every refusal is a sentence the user can act on. Returns null when the
 * request may proceed to classification.
 */
export function validateRerunRequest(input: {
  mode: unknown;
  reason: string | null | undefined;
  addedCandidateIds: unknown;
  parent: RerunParentFacts | null;
}): string | null {
  if (!isCreatableRerunMode(input.mode)) {
    return `Mode re-run "${String(input.mode)}" tidak dapat dibuat lagi. Satu-satunya re-run yang tersedia adalah "Tambah Kandidat Pembanding" (incremental_add). Untuk data atau konfigurasi terbaru, buat run baru dari wizard scoring.`;
  }
  const reason = (input.reason ?? '').trim();
  if (!reason) {
    return 'Alasan / permintaan forum wajib diisi — alasan itu yang menjelaskan mengapa run pembanding ini ada.';
  }
  if (reason.length > RERUN_REASON_MAX_LENGTH) {
    return `Alasan / permintaan forum paling panjang ${RERUN_REASON_MAX_LENGTH.toLocaleString('id-ID')} karakter (sekarang ${reason.length.toLocaleString('id-ID')}). Ringkas alasannya; rincian forum dapat dicatat di notulen.`;
  }
  const ids = Array.isArray(input.addedCandidateIds)
    ? input.addedCandidateIds.filter((x) => typeof x === 'string' && x.trim())
    : [];
  if (ids.length === 0) return 'Pilih minimal satu kandidat pembanding.';
  const p = input.parent;
  if (!p || !p.tenantMatches) return 'Run induk tidak ditemukan di Company ini.';
  if (p.status !== 'completed') {
    return 'Run induk belum selesai atau gagal — hanya run yang sudah selesai yang bisa diberi kandidat pembanding.';
  }
  if (p.method !== 'AHP_TOPSIS') {
    return 'Tambah Kandidat Pembanding hanya tersedia untuk run AHP + TOPSIS: hanya run itu yang menyimpan skor aspek kandidat lama untuk dibekukan.';
  }
  if (p.poolSnapshotRows === 0) {
    return 'Run induk tidak menyimpan snapshot aspek seluruh pool (dibuat sebelum fitur itu ada), sehingga kandidat lama tidak bisa dibekukan apa adanya. Buat run baru dari wizard scoring, lalu tambahkan kandidat pembanding ke run tersebut.';
  }
  return null;
}

// ── 2. Classification ───────────────────────────────────────────────────────

export type AddedClassification = 'new' | 'existing_pool';

export type SkipReason =
  | 'parent_finalist'
  | 'not_found'
  | 'soft_deleted'
  | 'incumbent'
  | 'rejected_rules'
  | 'outside_scope'
  | 'needs_confirmation';

export const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  parent_finalist: 'sudah menjadi finalis run induk — peringkatnya sudah tampil di sana',
  not_found: 'kandidat tidak ditemukan',
  soft_deleted: 'kandidat sudah dihapus dari daftar kandidat',
  incumbent: 'pejabat posisi ini tidak bisa menjadi kandidat suksesornya sendiri',
  rejected_rules: 'tidak memenuhi aturan filter run induk, sehingga tidak memenuhi syarat untuk run mana pun',
  outside_scope: 'berada di luar business unit yang dicakup run induk',
  needs_confirmation: 'di luar rentang grade run induk dan belum dikonfirmasi',
};

export type ClassifiedCandidate = {
  candidateId: string;
  name: string;
  classification: AddedClassification;
  /** Grade outside the parent's range, added on explicit confirmation ("Excluded"). */
  outOfRange: boolean;
  /** The range rules a confirmed out-of-range candidate violates. */
  excludedRules: string[];
  /** Advisory rules flagged ("Reconsidered", e.g. MCU fit-with-note): scored, flagged. */
  advisory: string[];
};

export type SkippedCandidate = {
  candidateId: string;
  name: string | null;
  reason: SkipReason;
  message: string;
  /** The rules behind a `rejected_rules` / `outside_scope` / `needs_confirmation` skip. */
  rules?: string[];
};

/**
 * How one NEW person (not in the parent's pool) fares against the PARENT's
 * rules, split by the categories of Tabel 2.4 because each has a different
 * consequence for a comparison run (FR-RR-05):
 *
 *  • `rejected` — a hard rule of the parent's frozen filter tree (discipline,
 *    PA, HAV, BA …): not eligible for ANY run, so never added. "X was refused
 *    because …" is itself the answer the forum needs.
 *  • `excluded` — the grade lies outside the parent's level range: eligible,
 *    but outside this seat's band. Added only on per-candidate confirmation,
 *    and then recorded in `filter_summary.forceIncluded`.
 *  • `outOfScope` — a business unit the parent run did not cover.
 *  • `advisory` — a rule marked advisory (MCU): "Reconsidered" — scored, and
 *    the confidence factor is computed as on any run.
 */
export type RuleVerdict = {
  rejected: string[];
  excluded: string[];
  outOfScope: string[];
  advisory: string[];
  /** At least one rejected rule failed on an EMPTY column, not on a value. */
  dataMissing: boolean;
};

export const EMPTY_RULE_VERDICT: RuleVerdict = {
  rejected: [],
  excluded: [],
  outOfScope: [],
  advisory: [],
  dataMissing: false,
};

/** What one picked person WILL be, decided once for the preview and the server alike. */
export type RerunCandidateVerdict =
  | ({ status: 'accepted' } & ClassifiedCandidate & { poolRank: number | null })
  | ({ status: 'skipped' } & SkippedCandidate);

/**
 * Sort each picked candidate into exactly one bucket (FR-RR-03, FR-RR-05).
 * This ONE function decides both what the dialog previews and what the server
 * does on submit — they are fed the same facts, so the two cannot disagree.
 * The order of the checks is the order of the reasons a reader wants first:
 *
 *  • not found / soft-deleted — the person cannot be scored at all;
 *  • incumbent of the seat — never a successor to themselves;
 *  • finalist of the parent — already has a row in the parent's ranking;
 *  • in the parent's pool below its cut — `existing_pool`: carried with the
 *    parent's aspects, never re-scored, given a result row. They cleared (or
 *    were force-included past) the parent's rules already, so no rule is
 *    re-evaluated for them;
 *  • otherwise a NEW person, judged against the parent's rules: out of the
 *    parent's business units → refused; a hard rule failed (Rejected) →
 *    refused with the rules; grade outside the range (Excluded) → added only
 *    when confirmed; advisory flags (Reconsidered) → added, flagged.
 */
export function classifyRerunCandidates(input: {
  pickedIds: string[];
  parentPool: { candidateId: string; isFinalist: boolean; poolRank?: number }[];
  /** Every picked id that exists, live or tombstoned. */
  candidates: Map<string, { name: string | null; deleted: boolean; isIncumbent: boolean }>;
  /** Rule verdicts for people NOT in the parent's pool. Missing = no rule failed. */
  verdicts: Map<string, RuleVerdict>;
  /** Out-of-range candidates the user explicitly confirmed. */
  confirmedOutOfRange: Set<string>;
}): { verdicts: RerunCandidateVerdict[]; accepted: ClassifiedCandidate[]; skipped: SkippedCandidate[] } {
  const pool = new Map(input.parentPool.map((r) => [r.candidateId, r]));
  const seen = new Set<string>();
  const verdicts: RerunCandidateVerdict[] = [];
  const skip = (candidateId: string, name: string | null, reason: SkipReason, rules?: string[]) => {
    const detail = rules && rules.length > 0 ? `: ${rules.join('; ')}` : '';
    verdicts.push({
      status: 'skipped',
      candidateId,
      name,
      reason,
      message: `${SKIP_REASON_LABEL[reason]}${detail}`,
      ...(rules && rules.length > 0 ? { rules } : {}),
    });
  };

  for (const raw of input.pickedIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const c = input.candidates.get(id);
    if (!c) {
      skip(id, null, 'not_found');
      continue;
    }
    if (c.deleted) {
      skip(id, c.name, 'soft_deleted');
      continue;
    }
    if (c.isIncumbent) {
      skip(id, c.name, 'incumbent');
      continue;
    }
    const inPool = pool.get(id);
    if (inPool?.isFinalist) {
      skip(id, c.name, 'parent_finalist');
      continue;
    }
    if (inPool) {
      verdicts.push({
        status: 'accepted',
        candidateId: id,
        name: c.name ?? '',
        classification: 'existing_pool',
        outOfRange: false,
        excludedRules: [],
        advisory: [],
        poolRank: inPool.poolRank ?? null,
      });
      continue;
    }
    const v = input.verdicts.get(id) ?? EMPTY_RULE_VERDICT;
    if (v.outOfScope.length > 0) {
      skip(id, c.name, 'outside_scope', v.outOfScope);
      continue;
    }
    if (v.rejected.length > 0) {
      skip(id, c.name, 'rejected_rules', v.rejected);
      continue;
    }
    if (v.excluded.length > 0 && !input.confirmedOutOfRange.has(id)) {
      skip(id, c.name, 'needs_confirmation', v.excluded);
      continue;
    }
    verdicts.push({
      status: 'accepted',
      candidateId: id,
      name: c.name ?? '',
      classification: 'new',
      outOfRange: v.excluded.length > 0,
      excludedRules: [...v.excluded],
      advisory: [...v.advisory],
      poolRank: null,
    });
  }

  const accepted: ClassifiedCandidate[] = [];
  const skipped: SkippedCandidate[] = [];
  for (const v of verdicts) {
    if (v.status === 'accepted') {
      const { status: _s, poolRank: _p, ...rest } = v;
      accepted.push(rest);
    } else {
      const { status: _s, ...rest } = v;
      skipped.push(rest);
    }
  }
  return { verdicts, accepted, skipped };
}

/** The refusal when classification left nobody to add. */
export function nothingLeftToAddMessage(skipped: SkippedCandidate[]): string {
  const detail = skipped
    .map((s) => `${s.name ?? s.candidateId}: ${s.message}`)
    .join('; ');
  return `Tidak ada kandidat pembanding yang bisa ditambahkan${detail ? ` — ${detail}` : ''}.`;
}

/**
 * The child's "N besar" (FR-RR-09): the PARENT's own finalist count, never
 * grown by the number of comparison candidates. Growing it surfaced candidates
 * nobody asked about just because a quota went up (the parent's N+1…N+k). The
 * child's list is instead the union of its own top N, every parent finalist
 * and every comparison candidate — the engine appends the latter two below the
 * cut, wherever they land.
 */
export function childFinalistTarget(parentFinalistCount: number, poolSize: number): number {
  return Math.max(1, Math.min(poolSize, parentFinalistCount));
}

// ── 3. The frozen basis ─────────────────────────────────────────────────────

function finiteNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function readWeights(v: unknown): Record<RerunCriterionKey, number> | null {
  if (!v || typeof v !== 'object') return null;
  const out = {} as Record<RerunCriterionKey, number>;
  for (const k of CRITERIA) {
    const n = finiteNumber((v as Record<string, unknown>)[k]);
    if (n == null) return null;
    out[k] = n;
  }
  return out;
}

function readPairwise(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length !== CRITERIA.length) return null;
  const rows = v.map((r) =>
    Array.isArray(r) && r.length === CRITERIA.length ? r.map(finiteNumber) : null,
  );
  if (rows.some((r) => !r || r.some((x) => x == null))) return null;
  return rows as number[][];
}

function readDropped(v: unknown): { key: RerunCriterionKey; reason: string }[] | null {
  if (!Array.isArray(v)) return null;
  const out: { key: RerunCriterionKey; reason: string }[] = [];
  for (const d of v) {
    const key = (d as { key?: unknown })?.key;
    if (typeof key !== 'string' || !(CRITERIA as string[]).includes(key)) return null;
    out.push({ key: key as RerunCriterionKey, reason: String((d as { reason?: unknown }).reason ?? '') });
  }
  return out;
}

function readAnchor(
  floor: unknown,
  ceil: unknown,
  source: unknown,
): { simFloor: number; simCeil: number; source: string } | null {
  const f = finiteNumber(floor);
  const c = finiteNumber(ceil);
  if (f == null || c == null || !(c > f)) return null;
  return { simFloor: f, simCeil: c, source: typeof source === 'string' ? source : 'unknown' };
}

/**
 * What a child inherits from `parent`, beyond the aspect scores.
 *
 * Reads, in order: the parent's own `run_info.frozen` (every AHP run records it
 * from this change on, at full precision — and a child records the values it
 * inherited, so a grandchild gets the ROOT's); else the fields an older parent
 * recorded for display (`run_info.ahp`, `.technical`, `.career`), which are the
 * same numbers, the anchors rounded to 4 decimals. A part neither holds is null
 * with `source: 'live_fallback'`, and the scoring service fills it live and
 * records what it used.
 *
 * Takes ONLY the parent's stored record — no governance read, no live config —
 * which is the whole guarantee: editing the program's matrix, its filter rules
 * or the corpus between the parent and the child cannot reach this function.
 */
export function resolveFrozenBasis(input: {
  parent: {
    id: string;
    completedAt: Date | string | null;
    createdAt: Date | string;
    runInfo: unknown;
  };
  rootRunId: string;
}): FrozenRunBasis {
  const info = (input.parent.runInfo ?? {}) as Record<string, any>;
  const own = (info.frozen ?? null) as Partial<FrozenRunBasis> | null;

  // Reference date: the parent's own record, else when it finished computing
  // (the aspects are scored moments before completion; `created_at` can be hours
  // earlier on a queued run).
  const ownRef =
    typeof own?.referenceDate === 'string' && !Number.isNaN(Date.parse(own.referenceDate))
      ? own.referenceDate
      : null;
  const fallbackRef = new Date(input.parent.completedAt ?? input.parent.createdAt).toISOString();

  // AHP. The weights are the eigenvector itself — never re-derived from the
  // stored matrix, which is rounded to 4 decimals and would move every
  // closeness coefficient by ~1e-5.
  const ahpInfo = (own?.ahp ?? info.ahp ?? {}) as Record<string, any>;
  const weights = readWeights(ahpInfo.weights);
  const dropped = readDropped(ahpInfo.droppedCriteria);
  const active =
    Array.isArray(ahpInfo.activeCriteria) &&
    ahpInfo.activeCriteria.every((k: unknown) => (CRITERIA as unknown[]).includes(k))
      ? (ahpInfo.activeCriteria as RerunCriterionKey[])
      : dropped
        ? CRITERIA.filter((k) => !dropped.some((d) => d.key === k))
        : null;
  const ahpComplete = weights != null && dropped != null && active != null;

  // Anchors.
  const ownAnchors = (own?.anchors ?? null) as FrozenRunBasis['anchors'] | null;
  const technical =
    ownAnchors?.technical ??
    readAnchor(info.technical?.simFloor, info.technical?.simCeil, info.technical?.simAnchorSource);
  const career =
    ownAnchors?.career ??
    readAnchor(info.career?.scale?.simFloor, info.career?.scale?.simCeil, info.career?.scale?.source);
  const depthYears = finiteNumber(ownAnchors?.depth?.targetYears ?? info.career?.depth?.targetYears);
  const depthRows = finiteNumber(ownAnchors?.depth?.targetRows ?? info.career?.depth?.targetRows);
  const depth =
    depthYears != null && depthYears > 0 && depthRows != null && depthRows > 0
      ? { targetYears: depthYears, targetRows: depthRows }
      : null;

  // CR / λmax / CI: the parent's own full-precision figures when it recorded
  // them in `frozen`, else the 4-decimal ones it showed in `run_info.ahp`.
  const ownConsistency = (own?.ahp as Record<string, any> | undefined)?.consistency;
  const consistency =
    ownConsistency &&
    [ownConsistency.cr, ownConsistency.lambdaMax, ownConsistency.ci].every((x) => finiteNumber(x) != null)
      ? { cr: Number(ownConsistency.cr), lambdaMax: Number(ownConsistency.lambdaMax), ci: Number(ownConsistency.ci) }
      : finiteNumber(info.ahp?.consistencyRatio) != null &&
          finiteNumber(info.ahp?.lambdaMax) != null &&
          finiteNumber(info.ahp?.consistencyIndex) != null
        ? {
            cr: Number(info.ahp.consistencyRatio),
            lambdaMax: Number(info.ahp.lambdaMax),
            ci: Number(info.ahp.consistencyIndex),
          }
        : null;

  return {
    version: 1,
    rootRunId: input.rootRunId,
    parentRunId: input.parent.id,
    referenceDate: ownRef ?? fallbackRef,
    referenceDateSource: ownRef ? 'parent_frozen' : 'parent_completed_at',
    ahp: {
      weights: ahpComplete ? weights : null,
      pairwise: readPairwise(ahpInfo.pairwise),
      activeCriteria: ahpComplete ? active : null,
      droppedCriteria: ahpComplete ? dropped : null,
      weightSource: typeof ahpInfo.weightSource === 'string' ? ahpInfo.weightSource : null,
      source: ahpComplete ? 'parent' : 'live_fallback',
      consistency,
    },
    anchors: {
      technical,
      career,
      depth,
      source: technical && career ? 'parent' : 'live_fallback',
    },
    // The parent's position basis, passed through untouched — only the scoring
    // service interprets it. Null on a parent from before it was recorded.
    positionBasis: readPositionBasis(own?.positionBasis),
    models: readModels(own?.models ?? info.models),
  };
}

function readPositionBasis(v: unknown): FrozenPositionBasis | null {
  const b = v as Record<string, unknown> | null | undefined;
  if (!b || typeof b !== 'object' || b.version !== 1 || typeof b.resolvedByRunId !== 'string') return null;
  return b as unknown as FrozenPositionBasis;
}

function readModels(v: unknown): RunModelsRecord | null {
  const m = v as Record<string, any> | null | undefined;
  if (!m || typeof m !== 'object' || !m.embedding || !m.narrative) return null;
  return m as RunModelsRecord;
}

// ── 4. The child's config snapshot ──────────────────────────────────────────

/**
 * A child's `config_snapshot`: the parent's frozen copy — program, filter tree,
 * finalist target, readiness thresholds — plus the `rerun` block. Nothing is
 * re-read from governance, so a filter rule or AHP matrix edited after the
 * parent cannot reach the child. Only a parent created before the snapshot
 * column existed has nothing to inherit; then the parent's OWN program is
 * captured live (`liveCapture`) and labelled `live`.
 */
export function deriveChildSnapshot(
  parentSnapshot: RunConfigSnapshot | null | undefined,
  parentRunId: string,
  liveCapture: () => RunConfigSnapshot,
  rerun: RunRerunSnapshot,
  now: Date = new Date(),
): RunConfigSnapshot {
  if (parentSnapshot?.template) {
    return {
      ...parentSnapshot,
      capturedAt: now.toISOString(),
      templateSource: 'inherited',
      inheritedFrom: parentRunId,
      rerun,
    };
  }
  const live = liveCapture();
  return { ...live, readiness: parentSnapshot?.readiness ?? live.readiness, rerun };
}
