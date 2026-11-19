'use client';

// ── The lineage navigator of the "Komparasi Versi" tab ──────────────────
//
// Every run of the position as a node-link tree, generations as columns, and
// two slots the reader fills by pointing: A (pembanding) and B (yang
// dibandingkan). Clicking a card makes it B; the small A button makes it A.
// Picking the run already in the other slot swaps them, so no gesture can
// leave A and B equal. The connectors between A and B are drawn heavier, so
// "how are these two related" is answered by the drawing before any sentence.
//
// Built for a root with many "Tambah Kandidat Pembanding" children — the shape
// a forum produces by asking "what about X?" once per meeting: each child is a
// row (lib/run-lineage-layout.ts explains why rows and not columns), subtrees
// fold, "Lipat cabang lain" keeps only the branches holding A and B, and the
// container scrolls itself — never the page — to keep the picked runs in view.
// Runs that cannot be compared (not AHP+TOPSIS, failed, still running) stay in
// the drawing, because a lineage with holes reads as a bug, but cannot be
// picked, and say why.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  Gavel,
  GitBranch,
  Loader2,
  Maximize2,
  Minimize2,
  Ruler,
  Shrink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import { formatDateTime } from '@/lib/datetime';
import { shortRunId } from '@/lib/run-history';
import { RERUN_TONE, rerunSpec } from '@/lib/rerun-modes';
import type { RunTree, RunTreeNode } from '@/lib/run-tree';
import {
  LINEAGE_DIMS,
  ancestry,
  collapseAllExcept,
  columnX,
  generationLabel,
  layoutLineage,
  lineageIndex,
  lineagePath,
  type LineageLayoutNode,
} from '@/lib/run-lineage-layout';

const D = LINEAGE_DIMS;
/** Above this many runs the navigator opens with only the branches in use unfolded. */
const AUTO_FOLD_ABOVE = 30;
const HEADER_H = 26;

export const isComparableRun = (n: Pick<RunTreeNode, 'method' | 'status'>) =>
  n.method === 'AHP_TOPSIS' && n.status === 'completed';

export function notComparableReason(n: RunTreeNode): string {
  if (n.method !== 'AHP_TOPSIS')
    return 'Run ini bukan AHP + TOPSIS, jadi tidak punya matriks keputusan per kriteria untuk dibandingkan secara terstruktur.';
  if (n.status === 'failed') return 'Run ini gagal, jadi tidak punya hasil untuk dibandingkan.';
  return 'Run ini belum selesai.';
}

export type PairSide = 'a' | 'b';

/** The A and B marks, shared with the pair bar so both read the same. */
export const SIDE_STYLE: Record<PairSide, { badge: string; ring: string; soft: string; text: string; name: string }> = {
  a: {
    badge: 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900',
    ring: 'border-slate-700 dark:border-slate-300',
    soft: 'bg-slate-100 dark:bg-slate-800/70',
    text: 'text-slate-800 dark:text-slate-100',
    name: 'Pembanding',
  },
  b: {
    badge: 'bg-indigo-600 text-white dark:bg-indigo-400 dark:text-indigo-950',
    ring: 'border-indigo-600 dark:border-indigo-400',
    soft: 'bg-indigo-50 dark:bg-indigo-950/50',
    text: 'text-indigo-900 dark:text-indigo-100',
    name: 'Yang dibandingkan',
  },
};

export function SideBadge({ side, className }: { side: PairSide; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] font-bold leading-none',
        SIDE_STYLE[side].badge,
        className,
      )}
    >
      {side.toUpperCase()}
    </span>
  );
}

function NodeCard({
  laid,
  isA,
  isB,
  onPath,
  isOpenRun,
  onPick,
  onToggle,
}: {
  laid: LineageLayoutNode;
  isA: boolean;
  isB: boolean;
  onPath: boolean;
  isOpenRun: boolean;
  onPick: (side: PairSide, runId: string) => void;
  onToggle: (runId: string) => void;
}) {
  const n = laid.node;
  const spec = rerunSpec(n.mode);
  const tone = RERUN_TONE[spec.tone];
  const sid = shortRunId(n.runId);
  const canCompare = isComparableRun(n);
  const running = n.status === 'in_progress' || n.status === 'finalizing';
  const failed = n.status === 'failed';
  const hasChildren = n.children.length > 0;
  const collapsed = hasChildren && laid.shownChildren === 0;
  const side: PairSide | null = isB ? 'b' : isA ? 'a' : null;
  const reason = canCompare ? null : notComparableReason(n);
  const status = failed
    ? n.failure?.kind === 'cancelled'
      ? 'Dibatalkan'
      : 'Gagal'
    : running
      ? 'Berjalan'
      : n.method !== 'AHP_TOPSIS'
        ? 'Bukan AHP + TOPSIS'
        : null;

  const describe = `Run ${sid}, ${n.shortLabel}, ${formatDateTime(n.createdAt)}, ${n.candidateCount} kandidat`;

  return (
    <div
      data-run-id={n.runId}
      className={cn(
        'relative flex rounded-lg border bg-card text-left shadow-xs transition-colors',
        side ? cn('border-2', SIDE_STYLE[side].ring, SIDE_STYLE[side].soft) : onPath ? 'border-indigo-300 dark:border-indigo-800' : 'border-slate-200 dark:border-slate-800',
        !canCompare && 'border-dashed',
      )}
      style={{ width: D.nodeW, height: D.nodeH }}
      title={reason ?? undefined}
    >
      {/* The two slots. Both are always offered, so "which one am I setting"
          is answered by the button, not by a mode the reader has to remember. */}
      <div className="flex shrink-0 flex-col justify-center gap-1 border-r border-inherit px-1">
        {(['a', 'b'] as const).map((s) => {
          const on = s === 'a' ? isA : isB;
          return (
            <button
              key={s}
              type="button"
              disabled={!canCompare}
              aria-pressed={on}
              aria-label={`Jadikan run ${sid} sebagai ${s.toUpperCase()} (${SIDE_STYLE[s].name.toLowerCase()})`}
              title={canCompare ? `Jadikan ${s.toUpperCase()} — ${SIDE_STYLE[s].name.toLowerCase()}` : reason ?? undefined}
              onClick={() => onPick(s, n.runId)}
              className={cn(
                'flex h-[19px] w-[19px] items-center justify-center rounded text-[10px] font-bold leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-30',
                on
                  ? SIDE_STYLE[s].badge
                  : 'border border-slate-300 text-slate-500 hover:border-slate-500 hover:text-slate-800 dark:border-slate-600 dark:text-slate-400 dark:hover:text-slate-100',
              )}
            >
              {s.toUpperCase()}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={!canCompare}
        onClick={() => onPick('b', n.runId)}
        aria-pressed={isB}
        aria-label={`${describe}. ${canCompare ? 'Jadikan B.' : reason}`}
        className={cn(
          'flex min-w-0 flex-1 flex-col justify-center gap-0.5 rounded-r-lg px-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
          canCompare ? 'hover:bg-muted/50' : 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', tone.dot, running && 'animate-pulse')} aria-hidden />
          {laid.depth === 0 && !n.orphaned && (
            <span className="shrink-0 rounded bg-slate-200 px-1 text-[9px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              Root
            </span>
          )}
          {n.legacy && (
            <span
              className="shrink-0 rounded bg-slate-200 px-1 text-[9px] font-bold uppercase tracking-wide text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              title={`Dibuat dengan mode "${spec.label}", yang tidak lagi tersedia. Hasilnya tetap utuh dan dapat dibandingkan.`}
            >
              Mode lama
            </span>
          )}
          <span className={cn('truncate text-[12px]', side || isOpenRun ? 'font-semibold' : 'font-medium')}>{n.shortLabel}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {isOpenRun && (
              <span title="Run yang sedang dibuka di halaman ini" className="inline-flex items-center text-primary">
                <Eye className="h-3 w-3" aria-hidden />
                <span className="sr-only">sedang dibuka</span>
              </span>
            )}
            <span className="font-mono text-[10px] text-muted-foreground">{sid}</span>
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="shrink-0">{formatDateTime(n.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{n.candidateCount} kandidat</span>
          {n.addedCount > 0 && (
            <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">+{n.addedCount}</span>
          )}
          {n.badges.outOfRange > 0 && (
            <span className="inline-flex shrink-0 items-center text-orange-700 dark:text-orange-300" title="Ada kandidat pembanding di luar rentang grade">
              <Ruler className="h-2.5 w-2.5" aria-hidden />
              <span className="sr-only">di luar rentang grade</span>
            </span>
          )}
          {n.badges.decisions > 0 && (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-emerald-700 dark:text-emerald-400"
              title={`${n.badges.decisions} keputusan forum merujuk run ini`}
            >
              <Gavel className="h-2.5 w-2.5" aria-hidden />
              {n.badges.decisions}
              <span className="sr-only">keputusan forum</span>
            </span>
          )}
          {status && (
            <span
              className={cn(
                'ml-auto inline-flex shrink-0 items-center gap-0.5 rounded border px-1 text-[9px] font-semibold',
                failed
                  ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : running
                    ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-slate-400/50 text-slate-600 dark:text-slate-300',
              )}
            >
              {failed && <AlertTriangle className="h-2.5 w-2.5" aria-hidden />}
              {running && <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />}
              {status}
            </span>
          )}
        </span>
      </button>

      {hasChildren && (
        <button
          type="button"
          onClick={() => onToggle(n.runId)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Buka ${laid.hiddenDescendants} turunan run ${sid}` : `Lipat turunan run ${sid}`}
          title={collapsed ? `Buka ${laid.hiddenDescendants} turunan` : 'Lipat turunan'}
          className={cn(
            'absolute top-1/2 z-10 flex h-5 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-[10px] font-bold shadow-xs transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-primary',
            collapsed ? '-right-6 min-w-9 px-1.5 text-primary' : '-right-2.5 w-5 text-muted-foreground',
          )}
        >
          {collapsed ? `+${laid.hiddenDescendants}` : '−'}
        </button>
      )}
    </div>
  );
}

export function LineageNavigator({
  tree,
  a,
  b,
  openRunId,
  onPick,
  className,
}: {
  /** null while loading. */
  tree: RunTree | null;
  a: string | null;
  b: string | null;
  /** The run open on the page — marked, never selected implicitly. */
  openRunId: string | null;
  onPick: (side: PairSide, runId: string) => void;
  className?: string;
}) {
  const roots = useMemo(() => tree?.roots ?? [], [tree]);
  const index = useMemo(() => lineageIndex(roots), [roots]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [tall, setTall] = useState(false);
  const initialised = useRef(false);

  // A very large forest opens folded down to the branches in use; a normal one
  // opens whole. Decided once, on the first tree — a refetch must not undo the
  // reader's own folding.
  useEffect(() => {
    if (!tree || initialised.current) return;
    initialised.current = true;
    if (tree.totalRuns > AUTO_FOLD_ABOVE) setCollapsed(collapseAllExcept(tree.roots, [a, b, openRunId]));
  }, [tree, a, b, openRunId]);

  // A picked run is never left inside a folded branch.
  useEffect(() => {
    const reveal = [a, b].filter((x): x is string => Boolean(x) && index.has(x!));
    if (reveal.length === 0) return;
    setCollapsed((prev) => {
      let next: Set<string> | null = null;
      for (const id of reveal)
        for (const up of ancestry(index, id).slice(1))
          if (prev.has(up)) {
            next ??= new Set(prev);
            next.delete(up);
          }
      return next ?? prev;
    });
  }, [a, b, index]);

  const path = useMemo(() => lineagePath(roots, a, b, index), [roots, a, b, index]);
  const layout = useMemo(() => layoutLineage(roots, { collapsed, highlight: path }), [roots, collapsed, path]);
  const comparableCount = useMemo(
    () => [...index.values()].filter((x) => isComparableRun(x.node)).length,
    [index],
  );

  // Keep B, then A, in view by scrolling the navigator — and only the
  // navigator. scrollIntoView would also scroll the page, yanking the reader
  // away from the table they were stepping B through.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Both A and B when they fit in the box together — the path between them is
  // the point of the drawing — else B, the run being studied.
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const at = (id: string | null) => (id ? layout.nodes.find((n) => n.node.runId === id) ?? null : null);
    const nb = at(b);
    const na = at(a);
    const shown = [nb, na].filter((n): n is LineageLayoutNode => Boolean(n));
    if (shown.length === 0) return;
    const M = 10;
    const fit = (lo: number, hi: number, view: number) => hi - lo + 2 * M <= view;
    const span = (sel: LineageLayoutNode[], axis: 'y' | 'x') => {
      const size = axis === 'y' ? D.nodeH : D.nodeW + 28;
      return [Math.min(...sel.map((n) => n[axis])), Math.max(...sel.map((n) => n[axis] + size))] as const;
    };
    const viewH = box.clientHeight - HEADER_H;
    let [top, bottom] = span(shown, 'y');
    if (!fit(top, bottom, viewH) && nb) [top, bottom] = span([nb], 'y');
    if (top - M < box.scrollTop) box.scrollTop = Math.max(0, top - M);
    else if (bottom + M > box.scrollTop + viewH) box.scrollTop = bottom + M - viewH;
    let [left, right] = span(shown, 'x');
    if (!fit(left, right, box.clientWidth) && nb) [left, right] = span([nb], 'x');
    if (left - M < box.scrollLeft) box.scrollLeft = Math.max(0, left - M);
    else if (right + M > box.scrollLeft + box.clientWidth) box.scrollLeft = right + M - box.clientWidth;
    // Only when the PAIR changes (or the tree first arrives) — folding a branch
    // elsewhere must not yank the view back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, tree !== null]);

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!tree) {
    return (
      <div className={cn('rounded-xl border bg-card p-4', className)}>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Menyusun silsilah run…
        </p>
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 w-60 animate-pulse rounded-lg bg-muted/60" style={{ marginLeft: i * 40 }} />
          ))}
        </div>
      </div>
    );
  }

  const foldedCount = collapsed.size;
  const generations = Math.max(1, layout.columns);

  return (
    <section className={cn('overflow-hidden rounded-2xl border border-indigo-200/60 bg-card shadow-sm dark:border-indigo-900/50', className)} aria-label="Silsilah run">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-linear-to-r from-indigo-500/8 to-transparent px-4 py-2.5">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <GitBranch className="h-4 w-4 text-indigo-600 dark:text-indigo-400" aria-hidden />
          Silsilah run
          <InfoHint title="Memilih dari silsilah">
            <p>
              Klik kartu untuk menjadikannya <strong>B</strong>; tombol <strong>A</strong> pada kartu menjadikannya
              pembanding. Memilih run yang sudah ada di posisi lain menukar keduanya. Jalur A–B digambar tebal.
            </p>
            <p>
              Run selain AHP + TOPSIS, run gagal, dan run yang masih berjalan bergaris putus-putus dan tidak dapat dipilih;
              arahkan kursor untuk melihat alasannya. &ldquo;Lipat cabang lain&rdquo; menyisakan cabang yang memuat A dan B.
            </p>
          </InfoHint>
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {tree.totalRuns} run · {tree.roots.length} pohon · {tree.maxDepth + 1} generasi · {comparableCount} dapat dibandingkan
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(collapseAllExcept(roots, [a, b]))}
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            title="Tampilkan hanya cabang yang memuat A dan B"
          >
            <Shrink className="h-3 w-3" aria-hidden />
            Lipat cabang lain
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            disabled={foldedCount === 0}
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ChevronsUpDown className="h-3 w-3" aria-hidden />
            Buka semua
          </button>
          <button
            type="button"
            onClick={() => setTall((v) => !v)}
            aria-pressed={tall}
            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {tall ? <Minimize2 className="h-3 w-3" aria-hidden /> : <Maximize2 className="h-3 w-3" aria-hidden />}
            {tall ? 'Perkecil' : 'Perbesar'}
          </button>
        </div>
      </div>

      {tree.roots.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">
          Belum ada run untuk posisi ini. Jalankan scoring untuk membuat run root pertama.
        </p>
      ) : (
        <div
          ref={scrollRef}
          className="relative overflow-auto overscroll-contain"
          style={{ maxHeight: tall ? '46rem' : '28rem' }}
        >
          {/* Generation captions stay on top while the rows scroll under them. */}
          <div
            className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur-sm"
            style={{ width: Math.max(layout.width, 1), height: HEADER_H }}
          >
            {Array.from({ length: generations }, (_, d) => (
              <span
                key={d}
                className="absolute top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                style={{ left: columnX(d) + 4 }}
              >
                {generationLabel(d)}
              </span>
            ))}
          </div>

          <div className="relative" style={{ width: layout.width, height: layout.height }}>
            <svg
              className="pointer-events-none absolute inset-0"
              width={layout.width}
              height={layout.height}
              aria-hidden
            >
              {/* A line between two trees: separate roots are separate lines of work. */}
              {layout.trees.slice(1).map((t) => (
                <line
                  key={t.rootId}
                  x1={4}
                  x2={layout.width - 4}
                  y1={t.top - D.treeGap / 2}
                  y2={t.top - D.treeGap / 2}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeDasharray="4 4"
                />
              ))}
              {layout.edges
                .filter((e) => !e.highlighted)
                .map((e) => (
                  <path key={e.childId} d={e.d} fill="none" strokeWidth={1.5} className="stroke-slate-300 dark:stroke-slate-700" />
                ))}
              {layout.edges
                .filter((e) => e.highlighted)
                .map((e) => (
                  <path key={e.childId} d={e.d} fill="none" strokeWidth={3} strokeLinecap="round" className="stroke-indigo-500 dark:stroke-indigo-400" />
                ))}
            </svg>

            {/* A parent's card sticks to the top of its column while its own
                children scroll past — a root with twelve children stays in
                view all the way down to the twelfth. The wrapper spans exactly
                the parent's subtree, so the card lets go where the next
                sibling begins. */}
            {layout.nodes.map((laid) => (
              <div
                key={laid.node.runId}
                className="pointer-events-none absolute"
                style={{ left: laid.x, top: laid.y, width: D.nodeW, height: laid.subtreeBottom - laid.y }}
              >
                <div
                  className={cn('pointer-events-auto', laid.shownChildren > 0 && 'sticky z-10')}
                  style={laid.shownChildren > 0 ? { top: HEADER_H + 6 } : undefined}
                >
                  <NodeCard
                    laid={laid}
                    isA={laid.node.runId === a}
                    isB={laid.node.runId === b}
                    onPath={path.nodes.has(laid.node.runId)}
                    isOpenRun={laid.node.runId === openRunId}
                    onPick={onPick}
                    onToggle={toggle}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <SideBadge side="a" /> pembanding
        </span>
        <span className="inline-flex items-center gap-1">
          <SideBadge side="b" /> yang dibandingkan
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="22" height="6" aria-hidden>
            <line x1="1" y1="3" x2="21" y2="3" strokeWidth={3} strokeLinecap="round" className="stroke-indigo-500" />
          </svg>
          jalur A–B
        </span>
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3 w-3 text-primary" aria-hidden /> run yang sedang dibuka
        </span>
        <span className="inline-flex items-center gap-1">
          <Gavel className="h-3 w-3 text-emerald-700 dark:text-emerald-400" aria-hidden /> ada keputusan forum
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-5 rounded border border-dashed border-slate-400" aria-hidden /> tidak dapat dibandingkan
        </span>
        {foldedCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1">
            <ChevronsDownUp className="h-3 w-3" aria-hidden /> {foldedCount} cabang dilipat
          </span>
        )}
      </div>
    </section>
  );
}
