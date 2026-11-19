// ── Run lineage as a forest — the pure half ──────────────────────────────
//
// `getRunTreeAction` (lib/run-tree-actions.ts) reads the rows; this turns them
// into the forest. Split out so the structure — orphan roots, legacy modes,
// cycle safety — can be exercised without a database
// (tests/scoring/rerun-freeze.test.ts), and so nothing here is `use server`.

import { rerunSpec, type RerunMode } from './rerun-modes';

export type RunTreeNode = {
  runId: string;
  label: string | null;
  /** Label with the inherited base-run text stripped — see compactTreeLabel. */
  shortLabel: string;
  mode: RerunMode;
  /** True for a mode that can no longer be created; rendered "mode lama". */
  legacy: boolean;
  /** `scoring_runs.rerun_reason` — why this child exists. Null on roots and older runs. */
  reason: string | null;
  method: string;
  status: string;
  program: string | null;
  candidateCount: number;
  createdAt: string;
  completedAt: string | null;
  /** 0 for a root; +1 per generation. Capped for indentation, not for truth. */
  depth: number;
  /** True when this run declares a parent that no longer exists. */
  orphaned: boolean;
  /**
   * Why a run did not finish (FR-RR-12). Its `status` reads `failed` then: the
   * status column itself cannot hold that value, so the scoring service records
   * the failure in `run_info.failure` and the run keeps `in_progress`.
   */
  failure: { kind: 'error' | 'cancelled'; message: string; at: string | null } | null;
  /** Who started it (display name or email); null when unknown. */
  createdByName: string | null;
  /** Comparison candidates accepted into a "Tambah Kandidat Pembanding" child. */
  addedCount: number;
  /** Picks the server refused, kept on the run (FR-RR-10). */
  skippedCount: number;
  /** Badges (FR-RH-01). */
  badges: {
    /** Out-of-range candidates added on confirmation ("Di luar rentang grade"). */
    outOfRange: number;
    /** Some part of the frozen basis had to be read live ("Nilai hari ini"). */
    liveValues: boolean;
    /** Rows whose aspects are placeholders, not measurements ("Skor sementara"). */
    provisional: number;
    /** A forum decision references this run ("Ada keputusan forum"). */
    decisions: number;
  };
  children: RunTreeNode[];
};

export type RunTree = {
  roots: RunTreeNode[];
  totalRuns: number;
  /** Runs whose declared parent is gone — the tree shows them as roots. */
  orphanCount: number;
  /** Deepest generation present, for the UI to decide how far to indent. */
  maxDepth: number;
};

export type RunTreeRow = {
  runId: string;
  label: string | null;
  mode: string | null;
  reason?: string | null;
  method: string;
  status: string;
  program: string | null;
  candidateCount: number;
  createdAt: Date | string;
  completedAt: Date | string | null;
  parentRunId: string | null;
  /** `run_info.failure`, when the scoring service recorded one. */
  failure?: unknown;
  /** The status of the run's latest scoring session. */
  sessionStatus?: string | null;
  createdByName?: string | null;
  addedCount?: number | string | null;
  skippedCount?: number | string | null;
  outOfRangeCount?: number | string | null;
  /** Any of the frozen-basis sources said `live_fallback`. */
  liveValues?: boolean | null;
  provisionalCount?: number | string | null;
  decisionCount?: number | string | null;
};

/**
 * The status a reader should show. `scoring_runs.status` admits only draft /
 * in_progress / completed / archived, so a failure lives in `run_info.failure`
 * (or, for a run that failed before that was recorded, in its session) and a
 * run that failed would otherwise read "running" forever.
 */
export function displayRunStatus(r: Pick<RunTreeRow, 'status' | 'failure' | 'sessionStatus'>): string {
  if (r.status === 'completed' || r.status === 'archived') return r.status;
  if (r.failure || r.sessionStatus === 'failed') return 'failed';
  return r.status;
}

function readFailure(raw: unknown, sessionStatus: string | null | undefined): RunTreeNode['failure'] {
  const f = raw as { kind?: unknown; message?: unknown; at?: unknown } | null | undefined;
  if (f && typeof f === 'object' && typeof f.message === 'string') {
    return {
      kind: f.kind === 'cancelled' ? 'cancelled' : 'error',
      message: f.message,
      at: typeof f.at === 'string' ? f.at : null,
    };
  }
  if (sessionStatus === 'failed') {
    return {
      kind: 'error',
      message: 'Penilaian berhenti sebelum selesai; pesan galatnya tidak tercatat pada run ini (run dibuat sebelum kegagalan dicatat).',
      at: null,
    };
  }
  return null;
}

const toCount = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Strip the inherited base-run text from a derived run's label.
 *
 * `buildDerivedRunLabel` composes "<delta> — <core of base label> — <timestamp>"
 * because, without a structural edge, repeating the base run's name was the only
 * way to say what a run came from. In a tree the parent is literally the row
 * above, so that repetition is pure noise — and it is what makes every node in a
 * three-deep chain look the same at a glance.
 */
export function compactTreeLabel(label: string | null, mode: RerunMode): string {
  const spec = rerunSpec(mode);
  if (!label) return spec.label;
  const first = label.split('—')[0]?.trim();
  if (first && first.length > 0 && first.length <= 60) return first;
  return label.length > 60 ? `${label.slice(0, 57)}…` : label;
}

/**
 * Rows → forest. Every row becomes exactly one node: an unknown or legacy
 * `rerun_mode` resolves through `rerunSpec()` rather than being dropped, a
 * parent outside `rows` makes an orphan root, and a cycle (impossible through
 * the FK, possible through a manual UPDATE) terminates.
 */
export function buildRunForest(rows: RunTreeRow[]): RunTree {
  const byId = new Map<string, RunTreeNode>();
  for (const r of rows) {
    const spec = rerunSpec(r.mode);
    byId.set(r.runId, {
      runId: r.runId,
      label: r.label,
      shortLabel: compactTreeLabel(r.label, spec.mode),
      mode: spec.mode,
      legacy: spec.legacy,
      reason: r.reason?.trim() ? r.reason.trim() : null,
      method: r.method,
      status: displayRunStatus(r),
      program: r.program,
      candidateCount: Number(r.candidateCount ?? 0),
      createdAt: new Date(r.createdAt).toISOString(),
      completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      depth: 0,
      orphaned: false,
      failure:
        r.status === 'completed' || r.status === 'archived' ? null : readFailure(r.failure, r.sessionStatus),
      createdByName: r.createdByName ?? null,
      addedCount: toCount(r.addedCount),
      skippedCount: toCount(r.skippedCount),
      badges: {
        outOfRange: toCount(r.outOfRangeCount),
        liveValues: Boolean(r.liveValues),
        provisional: toCount(r.provisionalCount),
        decisions: toCount(r.decisionCount),
      },
      children: [],
    });
  }

  const roots: RunTreeNode[] = [];
  let orphanCount = 0;
  for (const r of rows) {
    const node = byId.get(r.runId)!;
    // A parent outside these rows is as absent as a deleted one — the FK cannot
    // express tenant scope, and pretending otherwise would hide the break.
    const parent = r.parentRunId ? byId.get(r.parentRunId) : null;
    // Two ways to lose a parent: it is outside these rows (another tenant), or
    // it was deleted — and then the FK's ON DELETE SET NULL has already blanked
    // `parent_run_id`, so the only trace left is a DERIVED mode on a run with no
    // parent. Without this second test such a child rendered as an ordinary
    // root with nothing to say its lineage was cut.
    const parentDeleted = !r.parentRunId && node.mode !== 'baseline';
    if ((r.parentRunId && !parent) || parentDeleted) {
      node.orphaned = true;
      orphanCount += 1;
    }
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  // Depth is assigned by walk, not stored: `seen` makes a cycle terminate.
  let maxDepth = 0;
  const seen = new Set<string>();
  const walk = (node: RunTreeNode, depth: number) => {
    if (seen.has(node.runId)) return;
    seen.add(node.runId);
    node.depth = depth;
    if (depth > maxDepth) maxDepth = depth;
    node.children.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const c of node.children) walk(c, depth + 1);
  };
  // Newest lineage first: a position's most recent line of work is the one the
  // reader came for, while its children stay oldest-first so a chain reads down.
  roots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const r of roots) walk(r, 0);

  return { roots, totalRuns: rows.length, orphanCount, maxDepth };
}
