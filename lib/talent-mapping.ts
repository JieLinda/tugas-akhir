/**
 * Talent Mapping — shared vocabulary for the server loader, the server actions
 * and the page. Client-safe on purpose (no `server-only`, no db): the page needs
 * the same constants the action validates against, and two copies would drift.
 *
 * WHAT THE FEATURE IS
 * -------------------
 * Where a candidate's HAV quadrant is CONSOLIDATED. Every live candidate who
 * passes the Talent Pool's DISCIPLINE rule is placed on the 16-box at the
 * quadrant in force — the HAV Excel upload, else the formula (PA × behavioural
 * assessment) — and a reviewer may move them by hand. Between a hand placement
 * and a sync, whichever happened LAST wins: a placement stands until a sync
 * (HAV upload any day, shared HAV.xlsx, or the candidate sync carrying a new
 * PA/BA from MSSQL) changes their automatic HAV after it. That one value
 * (lib/hav-effective.ts) is what the eligibility rules, both scoring engines,
 * the candidate profile and Beranda read. The Talent Pool verdict (full rules)
 * is shown per person as information, never as a filter. Every event — manual
 * and sync — is recorded in `talent_audit_logs`. See docs/talent-mapping.md.
 */

import type {
  FilterRule,
  HavAutoChangeOrigin,
  TalentMappingAuditAction,
  TalentMappingBaselineSource,
} from '@/lib/db/schema';
import type { HavSource } from '@/lib/hav-effective';
import { HAV_QUADRANTS } from '@/lib/hav-quadrant';
import {
  talentBoxFromQuadrant,
  type HavBand,
  type HavDeriveGap,
  type PerformanceReading,
} from '@/lib/hav-quadrant-derive';
import type { FailedRule } from '@/lib/programs';

/** Where a candidate's square on the map comes from — the HAV in force's source. */
export type TalentMappingSource = HavSource;

/**
 * Bounds on the justification. The floor is there because the trail exists to
 * answer "why", and "ok" or "-" answers nothing; the ceiling only keeps one
 * entry from becoming a document.
 */
export const TALENT_MAPPING_JUSTIFICATION_MIN = 10;
export const TALENT_MAPPING_JUSTIFICATION_MAX = 1000;

export type TalentMappingFormula =
  | {
      ok: true;
      quadrant: number;
      competencyBand: HavBand;
      performanceBand: HavBand;
      /** Which semesters decided the PA band; null for a bare token input. */
      performance: PerformanceReading | null;
    }
  | { ok: false; gaps: HavDeriveGap[] };

/** One behavioural-assessment result, as the sync recorded it. */
export type TalentMappingBehaviorEntry = {
  /** The recommendation category, verbatim (e.g. "READY"); null when the source row carries none. */
  label: string | null;
  /** `YYYY-MM-DD` of the assessment (WIB), or null when the source row has no date. */
  date: string | null;
  /** The assessor's remark, verbatim, when there is one. */
  note: string | null;
};

/** How many assessments the work queue and the candidate dialog show. Mirrors sync-service BEHAVIOR_HISTORY_DEPTH. */
export const TALENT_MAPPING_BA_HISTORY_DEPTH = 3;

/**
 * The newest PA year on record OUTSIDE the formula's three-year window — either
 * newer than it (this year's appraisal, not yet counted) or older (the window is
 * empty and this is the last grade anyone recorded). Context for a hand
 * placement only: the formula never reads it.
 */
export type TalentMappingPaOutsideWindow = { year: number; s1: string | null; s2: string | null };

/**
 * A candidate's assessment history, newest first and at most `depth` entries:
 * the dated history rows (drizzle/0081) with the CURRENT sync row merged in.
 *
 * The current row joins because it is the one the HAV formula reads and the one
 * an Excel upload writes — a history table that missed it would show yesterday's
 * BA above today's. On the same date the current row wins. An entry with neither
 * a category nor a date says nothing and is dropped; undated entries sort last.
 * Pure, so the merge is pinned by tests/talent-mapping/behavior-history.test.ts.
 */
export function mergeBehaviorHistory(
  current: TalentMappingBehaviorEntry | null,
  history: TalentMappingBehaviorEntry[],
  depth: number = TALENT_MAPPING_BA_HISTORY_DEPTH,
): TalentMappingBehaviorEntry[] {
  const informative = (e: TalentMappingBehaviorEntry | null): e is TalentMappingBehaviorEntry =>
    e != null && (Boolean(e.label?.trim()) || Boolean(e.date));
  const out: TalentMappingBehaviorEntry[] = [];
  const seenDates = new Set<string>();
  for (const entry of [current, ...history]) {
    if (!informative(entry)) continue;
    if (entry.date) {
      if (seenDates.has(entry.date)) continue;
      seenDates.add(entry.date);
    }
    out.push({ label: entry.label?.trim() || null, date: entry.date, note: entry.note?.trim() || null });
  }
  // Newest first; ISO day keys sort as strings. Undated entries keep their
  // relative order at the end.
  out.sort((a, b) => (a.date && b.date ? b.date.localeCompare(a.date) : a.date ? -1 : b.date ? 1 : 0));
  return out.slice(0, Math.max(0, depth));
}

export type TalentMappingPlacementInfo = {
  quadrant: number;
  /** The automatic answer (upload, else formula) this placement overrode; null = none. */
  baselineQuadrant: number | null;
  baselineSource: TalentMappingBaselineSource;
  /** Null only when the sealed value could not be opened. */
  justification: string | null;
  placedByName: string | null;
  placedByUsername: string | null;
  /** ISO instant. */
  placedAt: string;
};

export type TalentMappingCandidate = {
  id: string;
  name: string;
  employeeId: string;
  currentPosition: string;
  department: string;
  division: string;
  grade: string | null;
  /**
   * The six PA semester slots, newest first, blanks kept as null — the exact
   * slots the formula read, so the page can point at the ones that decided it.
   */
  performanceSlots: (string | null)[];
  behaviorRecommendation: string | null;
  /**
   * Up to TALENT_MAPPING_BA_HISTORY_DEPTH behavioural assessments, newest first
   * (mergeBehaviorHistory). Empty = nothing on record. The newest is normally the
   * value `behaviorRecommendation` holds, i.e. what the formula reads.
   */
  behaviorHistory: TalentMappingBehaviorEntry[];
  /** See TalentMappingPaOutsideWindow; null when there is none. */
  paOutsideWindow: TalentMappingPaOutsideWindow | null;
  /** The HAV Excel value (candidates.hav_quadrant), or null. */
  uploadedHavQuadrant: number | null;
  formula: TalentMappingFormula;
  /** What applies without a manual placement: the upload, else the formula. */
  automatic: { quadrant: number | null; source: TalentMappingBaselineSource };
  /**
   * When a SYNC last changed `automatic` (ISO instant), and which one — the clock
   * a placement is ordered against. Null = no sync has changed it since the clock
   * existed (drizzle/0080), so any placement made stands.
   */
  automaticChangedAt: string | null;
  automaticChangeOrigin: HavAutoChangeOrigin | null;
  placement: TalentMappingPlacementInfo | null;
  /** The quadrant IN FORCE — what every reader of HAV in the app uses. */
  quadrant: number | null;
  source: TalentMappingSource;
  /**
   * A manual placement made against an automatic answer that has since moved
   * (the formula after a PA/BA change, or the rules themselves): the decision
   * stands, but no longer for the reason it was made.
   */
  baselineDrifted: boolean;
  /** Clears every Talent Pool rule with the quadrant in force — information, not a filter. */
  inTalentPool: boolean;
  /** Quadrants 1..16 under which they would clear every Talent Pool rule. */
  poolQuadrants: number[];
  /** Why they are outside the Talent Pool, when they are. */
  poolFailedRules: FailedRule[];
};

export type TalentMappingAuditEntry = {
  id: string;
  candidateId: string | null;
  employeeId: string;
  /** Resolved including tombstoned candidates — history must not have holes. */
  candidateName: string | null;
  action: TalentMappingAuditAction | null;
  fromQuadrant: number | null;
  toQuadrant: number | null;
  /** The automatic answer at the time of the move. */
  baselineQuadrant: number | null;
  baselineSource: TalentMappingBaselineSource | null;
  justification: string | null;
  changedByName: string | null;
  changedByUsername: string | null;
  /** ISO instant. */
  timestamp: string;
  /** A sealed value on this row could not be opened (locked app or wrong key). */
  unreadable: boolean;
};

export type TalentMappingCounts = {
  /** Candidates on the map: live, and passing the Talent Pool's discipline rule. */
  population: number;
  /** Of those, clearing every rule with the quadrant in force — the Talent Pool's "Lolos". */
  inTalentPool: number;
  /** On a square at all. */
  placed: number;
  manual: number;
  upload: number;
  formula: number;
  /** Nothing places them: no upload, the formula cannot, nobody has. */
  unplaced: number;
  /** Manual placements made against an automatic answer that has since moved. */
  drifted: number;
  /**
   * Manual placements kept for candidates who are not on the map now (they no
   * longer pass the discipline rule). Still IN FORCE everywhere else — the HAV in
   * force is per candidate, not per page — and counted so that is visible.
   */
  offMapPlacements: number;
  /** Candidates whose automatic HAV a sync has changed at least once (they carry a clock). */
  syncChanged: number;
};

/** The rule that decides who is on the map, as the page explains it. */
export type TalentMappingGateInfo = {
  /** Switched-on discipline rules of the Talent Pool (normally exactly one). */
  rules: { label: string; message: string; operator: FilterRule['operator']; value: FilterRule['value'] }[];
  /** Discipline rules present but switched off. */
  disabledCount: number;
  /** Live candidates the discipline rule keeps off the map. */
  excluded: number;
  /** Live candidates of the business unit, before the gate. */
  evaluated: number;
};

/** The most recent sync that changed anybody's automatic HAV among the candidates on the map. */
export type TalentMappingLastSync = {
  /** ISO instant. */
  at: string;
  origin: HavAutoChangeOrigin | null;
};

/** "Sync Kandidat" etc. — the page's name for each origin. */
export const HAV_CHANGE_ORIGIN_LABEL: Record<HavAutoChangeOrigin, string> = {
  hav_upload: 'Upload HAV',
  hav_folder: 'Sync HAV (folder bersama)',
  candidate_sync: 'Sync Kandidat (PA/BA berubah)',
  pa_ba_upload: 'Upload PA/BA',
  candidate_edit: 'Edit PA/BA di Kandidat',
  hav_formula: 'Hitung kuadran HAV',
};

export type TalentMappingData = {
  program: { name: string; ruleCount: number; disabledRuleCount: number; havRuleCount: number } | null;
  gate: TalentMappingGateInfo;
  /** Null when no sync has changed an automatic HAV since the clock existed. */
  lastSync: TalentMappingLastSync | null;
  /**
   * The calendar year the PA slots count back from: slot 0 is `paReferenceYear − 1`
   * S2. `performance_grade` is rebuilt by every candidate sync relative to the
   * date it ran, so this is the current WIB year.
   */
  paReferenceYear: number;
  candidates: TalentMappingCandidate[];
  counts: TalentMappingCounts;
  /** Newest events (manual and sync) in this business unit, capped at TALENT_MAPPING_AUDIT_PAGE. */
  audit: TalentMappingAuditEntry[];
  /** Every 'hav16' event ever recorded for this business unit. */
  auditTotal: number;
};

/** How many audit rows the page loads up front; a candidate's own history is fetched in full. */
export const TALENT_MAPPING_AUDIT_PAGE = 200;

export type TalentMappingMoveInput = {
  candidateId: string;
  /** 1..16, or 'auto' to drop the manual placement and follow the upload/formula again. */
  target: number | 'auto';
  justification: string;
  /**
   * The square the reviewer saw the candidate in (null = not on a square). The
   * action refuses when the server's answer differs — two reviewers moving one
   * person at once would otherwise both "succeed" and the second would silently
   * overwrite the first.
   */
  expectedQuadrant: number | null;
};

export type TalentMappingMoveResult = {
  ok: boolean;
  message: string;
  /** The map after the action — also returned on a stale-view refusal, so the page catches up. */
  data: TalentMappingData | null;
};

/** "2025 S2" for a performance slot, counted back from the reference year. */
export function paSlotLabel(slot: number, referenceYear: number): string {
  const year = referenceYear - 1 - Math.floor(slot / 2);
  return `${year} ${slot % 2 === 0 ? 'S2' : 'S1'}`;
}

/** Which trail rows a sync wrote, as opposed to a reviewer. */
export function isSyncAuditAction(action: TalentMappingAuditAction | null): boolean {
  return action === 'superseded_by_upload' || action === 'superseded_by_sync' || action === 'automatic_changed';
}

/** Why the formula could not place a candidate, in the words the page uses. */
export const HAV_GAP_LABEL: Record<HavDeriveGap, string> = {
  'performance-missing': 'PA belum ada (3 tahun terakhir kosong)',
  'competency-missing': 'Behavioral Assessment kosong',
  'competency-unrecognized': 'Kategori Behavioral Assessment tidak dikenali',
};

/** Parse a stored/decrypted quadrant into 1..16, or null. */
export function parseQuadrant(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value).replace(/\D/g, ''), 10);
  return Number.isInteger(n) && n >= 1 && n <= 16 ? n : null;
}

/** Quadrant name from the one vocabulary every surface renders. */
export function quadrantName(quadrant: number | null | undefined): string {
  if (quadrant == null) return '';
  return HAV_QUADRANTS.find((q) => q.number === quadrant)?.name ?? `Q${quadrant}`;
}

/**
 * "Q6 · RAW DIAMOND (SOLID)" — the one spelling of a square, used by the page
 * AND by the action's messages, so a toast cannot name a square differently
 * from the grid it describes.
 */
export function quadrantLabel(quadrant: number | null | undefined): string {
  if (quadrant == null) return 'Belum terpetakan';
  const box = talentBoxFromQuadrant(quadrant);
  return `Q${quadrant} · ${quadrantName(quadrant)}${box ? ` (${box})` : ''}`;
}
