// ── A position's run history, read for people — the pure half ──
//
// Helpers the history page, the derived-run banner and the comparison links
// share: a short run number, the user-language warnings a "Tambah Kandidat
// Pembanding" child must show when part of what should have been frozen was
// read from today's state (I-3, I-6), and which runs the "Bandingkan dengan …"
// shortcuts point at (FR-RH-03). No database; lib/run-history-actions.ts reads.

import type { RunTreeNode } from './run-tree';

/** "#c0a1f2" — the last six hex digits of the run id, for people to say aloud. */
export function shortRunId(id: string): string {
  const hex = id.replace(/[^0-9a-f]/gi, '');
  return `#${hex.slice(-6).toLowerCase()}`;
}

/**
 * The "Komparasi Versi" tab of the position page — `?tab=` value. It was called
 * "Perbandingan Run" (`perbandingan-run`) until the tab was rebuilt; links that
 * still carry the old value are honoured through RESULT_TAB_ALIASES.
 */
export const RUN_COMPARE_TAB = 'komparasi-versi';

/**
 * `?tab=` values the position page used to write, mapped to what they are now.
 * Read by the page section when it parses the URL, so bookmarks, shared links
 * and the documentation's examples keep opening the right tab — and the URL is
 * rewritten to the current value as soon as it is mirrored back.
 */
export const RESULT_TAB_ALIASES: Readonly<Record<string, string>> = {
  'perbandingan-run': RUN_COMPARE_TAB,
};

/**
 * Where the comparison of A (pembanding) and B (yang dibandingkan) lives: the
 * "Komparasi Versi" tab of the position page, with B as the run open on it.
 * The pair is in the URL so a link reopens the same view (FR-CMP-11); the old
 * `/positions/[id]/compare?a=&b=` page redirects here.
 */
export function compareHref(positionId: string, aRunId: string, bRunId: string): string {
  const q = new URLSearchParams({ runId: bRunId, tab: RUN_COMPARE_TAB, a: aRunId, b: bRunId });
  return `/positions/${positionId}?${q.toString()}`;
}

export type DerivedRunWarning = {
  key:
    | 'weights_live'
    | 'anchors_live'
    | 'reference_date_derived'
    | 'basis_live'
    | 'basis_part_live'
    | 'basis_caveat'
    | 'models_changed'
    | 'carried_deleted'
    | 'basis_not_recorded';
  text: string;
};

const MODEL_LABEL: Record<string, string> = {
  embedding: 'embedding',
  education: 'model bahasa untuk pendidikan',
  mcu: 'model bahasa untuk MCU',
  narrative: 'model narasi',
};

const BASIS_PART_LABEL: Record<string, string> = {
  careerTarget: 'dokumen target karier',
  education: 'syarat pendidikan',
};

/**
 * Everything a child read from TODAY's state instead of from its parent, in
 * the words the banner prints (L-3). Empty when the child is frozen whole.
 * Reads `run_info.rerun` (written at completion) and falls back to the
 * snapshot's `rerun.frozen` (written at creation) for a child still running.
 */
export function derivedRunWarnings(input: { runInfo: unknown; configSnapshot: unknown }): DerivedRunWarning[] {
  const info = (input.runInfo ?? {}) as Record<string, any>;
  const snap = (input.configSnapshot ?? {}) as Record<string, any>;
  const rerun = (info.rerun ?? {}) as Record<string, any>;
  const frozen = (snap.rerun?.frozen ?? info.frozen ?? {}) as Record<string, any>;
  const out: DerivedRunWarning[] = [];

  const ahpSource = rerun.ahpSource ?? frozen.ahp?.source;
  if (ahpSource === 'live_fallback') {
    out.push({
      key: 'weights_live',
      text: 'Bobot dan kriteria aktif memakai nilai hari ini, karena run induk (run lama) tidak menyimpannya.',
    });
  }
  const anchorsSource = rerun.anchorsSource ?? snap.rerun?.anchorsSource ?? frozen.anchors?.source;
  if (anchorsSource === 'live_fallback') {
    out.push({
      key: 'anchors_live',
      text: 'Jangkar kalibrasi (L, U) dan target kedalaman karier memakai nilai hari ini, karena run induk tidak menyimpannya.',
    });
  }
  if (frozen.referenceDateSource === 'parent_completed_at') {
    out.push({
      key: 'reference_date_derived',
      text: 'Tanggal acuan peluruhan stint didekati dengan waktu selesai run induk, karena run induk tidak menyimpannya.',
    });
  }
  const basis = (rerun.positionBasis ?? info.positionBasisStatus ?? null) as Record<string, any> | null;
  if (basis) {
    if (basis.source === 'live_fallback') {
      out.push({
        key: 'basis_live',
        text: 'Basis posisi (job profile, acuan kompetensi, syarat pendidikan) untuk kandidat baru dibaca dari kondisi hari ini, karena run induk tidak menyimpannya.',
      });
    }
    const parts = Array.isArray(basis.liveParts) ? basis.liveParts.map(String) : [];
    if (basis.source !== 'live_fallback' && parts.length > 0) {
      out.push({
        key: 'basis_part_live',
        text: `Sebagian basis posisi dibaca dari kondisi hari ini: ${parts.map((p: string) => BASIS_PART_LABEL[p] ?? p).join(', ')}.`,
      });
    }
    for (const c of Array.isArray(basis.caveats) ? basis.caveats : []) {
      if (c && typeof c.message === 'string') out.push({ key: 'basis_caveat', text: c.message });
    }
  } else if (snap.rerun) {
    // A child that finished before the basis was recorded (or has not finished).
    out.push({
      key: 'basis_not_recorded',
      text: 'Run ini tidak mencatat basis posisi yang dipakai kandidat baru (dibuat sebelum basis posisi dibekukan, atau belum selesai).',
    });
  }
  const models = Array.isArray(rerun.modelsChanged) ? rerun.modelsChanged : [];
  if (models.length > 0) {
    out.push({
      key: 'models_changed',
      text: `Model berbeda dari run induk: ${models
        .map((m: any) => `${MODEL_LABEL[m.key] ?? m.key} ${m.parent ?? '—'} → ${m.current ?? '—'}`)
        .join('; ')}.`,
    });
  }
  const carried = Number(rerun.carriedDeleted ?? 0);
  if (Number.isFinite(carried) && carried > 0) {
    out.push({
      key: 'carried_deleted',
      text: `${carried} kandidat dibawa dari induk walaupun datanya kini dihapus atau kini menjadi pejabat, agar himpunan pembanding tetap sama dengan induk.`,
    });
  }
  return out;
}

export type RunNeighbours = {
  parentId: string | null;
  rootId: string | null;
  /** The comparable run created just before this one on the same position. */
  previousId: string | null;
};

function flatten(nodes: RunTreeNode[], parent: RunTreeNode | null, root: RunTreeNode | null, out: Map<string, { node: RunTreeNode; parent: RunTreeNode | null; root: RunTreeNode }>) {
  for (const n of nodes) {
    const r = root ?? n;
    out.set(n.runId, { node: n, parent, root: r });
    flatten(n.children, n, r, out);
  }
}

const comparable = (n: RunTreeNode) => n.method === 'AHP_TOPSIS' && n.status === 'completed';

/**
 * The runs the three "Bandingkan dengan …" shortcuts open against `runId`
 * (FR-RH-03): its parent, its root (when that is not the parent too), and the
 * comparable run created immediately before it — in time, on the same
 * position, from any tree.
 */
export function runNeighbours(roots: RunTreeNode[], runId: string): RunNeighbours {
  const all = new Map<string, { node: RunTreeNode; parent: RunTreeNode | null; root: RunTreeNode }>();
  flatten(roots, null, null, all);
  const me = all.get(runId);
  if (!me) return { parentId: null, rootId: null, previousId: null };
  const parentId = me.parent && comparable(me.parent) ? me.parent.runId : null;
  const rootId =
    me.root.runId !== runId && me.root.runId !== me.parent?.runId && comparable(me.root) ? me.root.runId : null;
  const earlier = [...all.values()]
    .map((x) => x.node)
    .filter((n) => n.runId !== runId && comparable(n) && n.createdAt < me.node.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { parentId, rootId, previousId: earlier[0]?.runId ?? null };
}

/**
 * The pair the "Komparasi Versi" tab opens on when the URL names none: the
 * run open on the page as B (or, when that one cannot be compared, the newest
 * run that can) against what the shortcuts would offer first — its parent,
 * else its root, else the run before it. A position whose only comparable run
 * is the oldest one compares it with the next. Fewer than two → null.
 */
export function defaultComparePair(
  roots: RunTreeNode[],
  openRunId: string | null,
): { a: string; b: string } | null {
  const all = new Map<string, { node: RunTreeNode; parent: RunTreeNode | null; root: RunTreeNode }>();
  flatten(roots, null, null, all);
  const eligible = [...all.values()].map((x) => x.node).filter(comparable);
  if (eligible.length < 2) return null;
  const newestFirst = [...eligible].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const open = openRunId && all.has(openRunId) && comparable(all.get(openRunId)!.node) ? openRunId : newestFirst[0].runId;
  const nb = runNeighbours(roots, open);
  const a = nb.parentId ?? nb.rootId ?? nb.previousId;
  if (a) return { a, b: open };
  // The open run is the oldest comparable one: it becomes A, the run after it B.
  const openAt = all.get(open)!.node.createdAt;
  const after = newestFirst.filter((n) => n.createdAt > openAt).at(-1);
  return after ? { a: open, b: after.runId } : null;
}

/** The A | B pair of the "Komparasi Versi" tab; either slot may be empty. */
export type ComparePair = { a: string | null; b: string | null };

/**
 * The next pair after picking `id` for `side`. Picking the run already in the
 * other slot swaps them — A and B can never be equal — and a B picked while A
 * is empty gets the neighbour the shortcuts would offer first.
 */
export function nextPair(
  pair: ComparePair,
  side: 'a' | 'b',
  id: string,
  fillA: (b: string) => string | null,
): ComparePair {
  if (side === 'b') {
    if (id === pair.b) return pair;
    const next = id === pair.a ? { a: pair.b, b: id } : { a: pair.a, b: id };
    return next.a ? next : { a: fillA(id), b: id };
  }
  if (id === pair.a) return pair;
  return id === pair.b ? { a: id, b: pair.a } : { a: id, b: pair.b };
}
