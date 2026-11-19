/**
 * Activity thread — a session-local record of the scoring work done on one
 * position.
 *
 * This exists because the database cannot answer the two questions users
 * actually have. `scoring_runs` records that four runs exist on a position, but
 * not that *this* person just produced the last three, nor that run C is run B
 * plus three candidates while run D went back to the full pool. Every re-run
 * lands in Riwayat Scoring as another row with a long label, and after a detour
 * into Tata Kelola getting back to the run you were reading costs three
 * navigations plus remembering which row it was.
 *
 * So the thread records the *lineage as it happened*: which runs this session
 * produced, what each one changed relative to its base, and which one is on
 * screen — with a one-click way back to any of them from anywhere in the app.
 *
 * A thread ends when:
 *   1. a successor is saved   — the assessment reached its point
 *   2. another position opens — one thread at a time, the old one is archived
 *   3. manual dismiss         — the pill's close button
 *   4. staleness              — untouched for IDLE_MS, or the tenant changed
 *
 * Deliberately NOT an end trigger: clicking a sidebar menu item. Peeking at
 * Tata Kelola mid-assessment is a detour, and the pill offers the way back.
 */

import { EMPTY_DATE, formatDateTime } from '@/lib/datetime';
import { routeLabel } from '@/lib/navigation';

/** How a run came to be — drives its badge and its place in the lineage. */
export type ThreadRunOrigin =
  /** Produced by the scoring wizard from scratch. */
  | 'baseline'
  /** Re-run over the base run's finalists plus newly added candidates. */
  | 'added'
  /** Re-run over the base run's full pool plus newly added candidates. */
  | 'fullpool'
  /** Re-ranked over the base run's scored pool MINUS excluded candidates. */
  | 'reranked'
  /** Opened from Riwayat Scoring; not produced in this session. */
  | 'opened';

export type ThreadRun = {
  runId: string;
  origin: ThreadRunOrigin;
  /** Short delta label, e.g. "+3 kandidat" — the thing Riwayat Scoring buries. */
  label: string;
  method?: string | null;
  candidateCount?: number | null;
  /** Run this one was derived from. Drives the lineage indent in the pill. */
  baseRunId?: string | null;
  at: number;
};

/** Where the wizard is while it is still producing a run. */
export type WizardStage = 'configure' | 'processing';

export type ActivityThread = {
  /** `position:<positionId>` — stable, so reviving an archived thread is trivial. */
  id: string;
  positionId: string;
  positionLabel: string;
  /** Secondary line, e.g. "IT Application Development · IT". */
  meta?: string;
  /** Runs produced in this session, oldest first (capped at RUN_LIMIT). */
  runs: ThreadRun[];
  /**
   * A run opened from Riwayat Scoring that this session did not produce. Kept
   * as a single slot rather than appended, so browsing old runs cannot bury the
   * ones the user just made.
   */
  viewing: ThreadRun | null;
  /** The run currently on screen — may live in `runs` or be `viewing`. */
  currentRunId: string | null;
  /** Set while the wizard is mid-run, so the user can get back to it. */
  wizard: { stage: WizardStage; href: string } | null;
  status: 'active' | 'completed';
  outcome?: { label: string; href?: string };
  startedAt: number;
  updatedAt: number;
};

/** The list page every thread hangs off. */
export const POSITIONS_ROOT = { label: 'Posisi', href: '/positions' };

/** Routes that count as "inside" the assessment; anything else is a detour. */
export function ownsRoute(pathname: string): boolean {
  return (
    pathname === '/positions' ||
    pathname.startsWith('/positions/') ||
    pathname.startsWith('/scoring') ||
    pathname.startsWith('/analysis')
  );
}

/**
 * Label for a page that can appear as a detour — read from the navigation
 * registry so the pill and the sidebar can never disagree about a name.
 */
export function detourLabel(pathname: string): string {
  return routeLabel(pathname) ?? 'Halaman lain';
}

const METHOD_LABELS: Record<string, string> = {
  AHP_TOPSIS: 'AHP+TOPSIS',
};

/** Compact method label — the pill has far less room than Riwayat Scoring. */
export function shortMethodLabel(method?: string | null): string | null {
  if (!method) return null;
  return METHOD_LABELS[method] ?? METHOD_LABELS[method.toUpperCase()] ?? method;
}

/**
 * Riwayat Scoring stores long human labels like
 * `Re-scoring (+3 kandidat) — Run awal — 2026-07-31 14:31`, which the table then
 * truncates. The pill keeps only the delta — the part that actually tells one
 * run apart from another.
 */
export function compactRunLabel(
  label: string | null | undefined,
  createdAt?: string | null,
): string {
  const raw = (label ?? '').trim();

  const added = raw.match(/^Re-scoring\s*\(\+(\d+)\s*kandidat\)/i);
  if (added) return `+${added[1]} kandidat`;

  const fullPool = raw.match(/^Run pool penuh\s*\(\+(\d+)\s*kandidat\)/i);
  if (fullPool) return `Pool penuh +${fullPool[1]}`;

  // Custom label: keep the leading segment, dropping the " — base — timestamp"
  // tail the re-run actions append.
  if (raw) {
    const head = raw.split(' — ')[0]!.trim();
    return head.length > 42 ? `${head.slice(0, 41)}…` : head;
  }

  // Unlabelled run — fall back to its date. Formatted rather than sliced off
  // the ISO string: slicing reads UTC fields, so an 11:04 WIB run rendered as
  // 04:04. `formatDateTime` pins both zone and calendar, so the server and the
  // client still cannot disagree.
  const stamp = formatDateTime(createdAt);
  return stamp === EMPTY_DATE ? 'Run' : `Run ${stamp}`;
}

/** Threads untouched for this long are dropped on next load. */
export const IDLE_MS = 8 * 60 * 60 * 1000;

/** How many finished/superseded threads stay resumable from the pill. */
export const ARCHIVE_LIMIT = 5;

/** Runs kept per thread. Older ones drop off the front — the newest work is the point. */
export const RUN_LIMIT = 6;

/**
 * v3: the thread shape changed from a generic navigation breadcrumb to this
 * run-lineage record, so older payloads cannot be migrated meaningfully.
 * Threads are ephemeral (see IDLE_MS), so dropping them once costs nothing.
 */
export const THREAD_STORAGE_KEY = 'pulse:activity-thread:v3';

export function threadId(positionId: string) {
  return `position:${positionId}`;
}
