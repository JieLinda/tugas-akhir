'use client';

// ── "Silsilah Run" — the run history as the tree it actually is (L-1) ──────
//
// A position accumulates runs the way a document accumulates drafts: a root,
// "Tambah Kandidat Pembanding" children on top of it, new roots when the data
// or the configuration changed. Each node says what it is without opening it
// (FR-RH-01): a short number, when and by whom, what kind of run, whether it
// finished, why it exists, how many comparison candidates it added, and the
// badges a forum needs to see before trusting it. Any two comparable nodes can
// be ticked and compared (FR-RH-03); the selected run also gets the three
// shortcuts — against its parent, its root, and the run just before it. Both
// open the "Komparasi Versi" tab of the same page (CompareLink), where the
// full navigator takes over; the ticks stay as they were.
//
// The tree is fetched UNFILTERED by design (see lib/run-tree-actions.ts), so a
// node the list's date/program filter is hiding is dimmed rather than removed —
// a lineage with holes in it would look like a bug.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  ChevronRight,
  Gavel,
  GitBranch,
  GitCompare,
  History,
  Link2Off,
  Loader2,
  MessageSquareQuote,
  Ruler,
  Timer,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RERUN_TONE, rerunSpec } from '@/lib/rerun-modes';
import type { RunTree as RunTreeData, RunTreeNode } from '@/lib/run-tree-actions';
import { formatDateTime } from '@/lib/datetime';
import { runNeighbours, shortRunId } from '@/lib/run-history';
import { CompareLink } from '@/components/analysis/run-compare/compare-nav';

export type RunTreeProps = {
  /** null while loading. */
  tree: RunTreeData | null;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
  /** Needed for the comparison links. */
  positionId: string;
  /** Runs the picker's date/program filter is currently hiding. */
  filteredOutIds?: Set<string>;
  className?: string;
};

/** Indent stops growing past this depth; the real generation is shown instead. */
const MAX_INDENT_DEPTH = 4;
const INDENT_PX = 18;

const comparable = (n: RunTreeNode) => n.method === 'AHP_TOPSIS' && n.status === 'completed';
const notComparableReason = (n: RunTreeNode) =>
  n.method !== 'AHP_TOPSIS'
    ? 'Run ini bukan AHP + TOPSIS, jadi tidak punya matriks keputusan per kriteria untuk dibandingkan secara terstruktur.'
    : n.status === 'failed'
      ? 'Run ini gagal, jadi tidak punya hasil untuk dibandingkan.'
      : 'Run ini belum selesai.';

/** Every node id on the path from a root down to `target`, inclusive. */
function pathToNode(roots: RunTreeNode[], target: string | null): Set<string> {
  const out = new Set<string>();
  if (!target) return out;
  const walk = (node: RunTreeNode, trail: string[]): boolean => {
    const next = [...trail, node.runId];
    if (node.runId === target) {
      next.forEach((id) => out.add(id));
      return true;
    }
    return node.children.some((c) => walk(c, next));
  };
  roots.some((r) => walk(r, []));
  return out;
}

function countDescendants(node: RunTreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

function flatten(nodes: RunTreeNode[], out: Map<string, RunTreeNode> = new Map()): Map<string, RunTreeNode> {
  for (const n of nodes) {
    out.set(n.runId, n);
    flatten(n.children, out);
  }
  return out;
}

function Chip({
  className,
  icon: Icon,
  children,
  hint,
}: {
  className: string;
  icon?: typeof History;
  children: React.ReactNode;
  hint?: string;
}) {
  const chip = (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 rounded border px-1 py-px text-[9px] font-semibold',
        className,
      )}
    >
      {Icon && <Icon className="h-2.5 w-2.5" />}
      {children}
    </span>
  );
  if (!hint) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>
        <p className="max-w-72">{hint}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function TreeNode({
  node,
  selectedRunId,
  onSelect,
  onPath,
  expanded,
  toggle,
  filteredOutIds,
  isLast,
  picked,
  togglePick,
}: {
  node: RunTreeNode;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
  onPath: Set<string>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  filteredOutIds?: Set<string>;
  isLast: boolean;
  picked: string[];
  togglePick: (id: string) => void;
}) {
  const spec = rerunSpec(node.mode);
  const tone = RERUN_TONE[spec.tone];
  const isSelected = node.runId === selectedRunId;
  const isAncestor = onPath.has(node.runId) && !isSelected;
  const dimmed = filteredOutIds?.has(node.runId) ?? false;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.runId);
  const indent = Math.min(node.depth, MAX_INDENT_DEPTH) * INDENT_PX;
  const running = node.status === 'in_progress' || node.status === 'finalizing';
  const failed = node.status === 'failed';
  const [reasonOpen, setReasonOpen] = useState(false);
  const canCompare = comparable(node);
  const pickedAs = picked.indexOf(node.runId);
  const sid = shortRunId(node.runId);

  return (
    <li className="relative">
      <div className="flex items-stretch">
        {node.depth > 0 && (
          <span aria-hidden className="relative shrink-0" style={{ width: indent }}>
            {/* Vertical rail of the parent generation + the elbow into this row.
                Drawn with borders rather than padding so a deep chain reads as a
                structure instead of as inconsistent margins. */}
            <span
              className={cn(
                'absolute left-2 top-0 border-l',
                isAncestor || isSelected ? tone.line : 'border-slate-200 dark:border-slate-800',
                isLast ? 'h-[18px]' : 'h-full',
              )}
            />
            <span
              className={cn(
                'absolute left-2 top-[18px] w-[10px] border-t',
                isAncestor || isSelected ? tone.line : 'border-slate-200 dark:border-slate-800',
              )}
            />
          </span>
        )}

        <div
          className={cn(
            'group my-0.5 flex min-w-0 flex-1 items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
            isSelected ? cn('ring-1 ring-inset', tone.chip) : 'border-transparent hover:bg-muted/60',
            pickedAs >= 0 && !isSelected && 'border-primary/40 bg-primary/5',
            dimmed && !isSelected && 'opacity-45',
          )}
        >
          {/* Compare tick: a native checkbox, so keyboard and screen readers get it for free. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="mt-0.5 inline-flex shrink-0">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  checked={pickedAs >= 0}
                  disabled={!canCompare}
                  onChange={() => togglePick(node.runId)}
                  aria-label={`Pilih run ${sid} untuk dibandingkan`}
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="max-w-64">
                {canCompare
                  ? pickedAs >= 0
                    ? 'Dipilih untuk dibandingkan. Hapus centang untuk membatalkan.'
                    : 'Centang dua run untuk membandingkannya.'
                  : notComparableReason(node)}
              </p>
            </TooltipContent>
          </Tooltip>

          {hasChildren ? (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-label={isOpen ? `Tutup turunan run ${sid}` : `Buka turunan run ${sid}`}
              onClick={() => toggle(node.runId)}
              className="mt-px shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-90')} />
            </button>
          ) : (
            <span className="w-[18px] shrink-0" />
          )}

          <button
            type="button"
            onClick={() => onSelect(node.runId)}
            className="min-w-0 flex-1 rounded text-left focus-visible:outline-2 focus-visible:outline-primary"
            aria-current={isSelected ? 'true' : undefined}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot, running && 'animate-pulse')} />
              <span className={cn('truncate text-[12px]', isSelected && 'font-semibold')}>{node.shortLabel}</span>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{sid}</span>
              {node.legacy ? (
                <Chip
                  className="border-slate-400/50 bg-slate-400/10 text-slate-600 dark:text-slate-300"
                  icon={History}
                  hint={`Dibuat dengan mode "${spec.label}", yang tidak lagi tersedia. Hasilnya tetap utuh, dapat dibuka dan dibandingkan. ${spec.expectation}`}
                >
                  Mode lama: {spec.label}
                </Chip>
              ) : (
                <Chip className={tone.chip}>{spec.mode === 'baseline' ? 'Run root' : spec.label}</Chip>
              )}
              {running && (
                <Chip className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" icon={Loader2}>
                  Berjalan
                </Chip>
              )}
              {failed && (
                <Chip className="border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300" icon={AlertTriangle}>
                  {node.failure?.kind === 'cancelled' ? 'Dibatalkan' : 'Gagal'}
                </Chip>
              )}
            </span>

            <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground">
              <span>{formatDateTime(node.createdAt)}</span>
              {node.createdByName && (
                <>
                  <span>·</span>
                  <span>oleh {node.createdByName}</span>
                </>
              )}
              <span>·</span>
              <span>{node.candidateCount} kandidat</span>
              {node.addedCount > 0 && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                    <UserPlus className="h-2.5 w-2.5" />+{node.addedCount} kandidat pembanding
                  </span>
                </>
              )}
              {node.skippedCount > 0 && (
                <>
                  <span>·</span>
                  <span>{node.skippedCount} ditolak</span>
                </>
              )}
              {node.depth > MAX_INDENT_DEPTH && (
                <>
                  <span>·</span>
                  <span className="font-mono">gen {node.depth}</span>
                </>
              )}
              {dimmed && <span title="Di luar filter tanggal / program pada daftar.">· di luar filter</span>}
              {hasChildren && !isOpen && (
                <span className="rounded bg-muted px-1 font-medium">{countDescendants(node)} turunan</span>
              )}
            </span>
          </button>
        </div>
      </div>

      {/* Badges, failure and reason sit under the row so they wrap without
          squeezing the label. */}
      <div style={{ marginLeft: indent + 52 }} className="space-y-0.5 pb-1 pr-2">
        {(node.orphaned ||
          node.badges.outOfRange > 0 ||
          node.badges.liveValues ||
          node.badges.provisional > 0 ||
          node.badges.decisions > 0) && (
          <div className="flex flex-wrap items-center gap-1">
            {node.orphaned && (
              <Chip
                className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                icon={Link2Off}
                hint="Run ini diturunkan dari run yang sudah dihapus. Ia ditampilkan di tingkat atas, tetapi bukan run root; hasilnya sendiri tetap utuh."
              >
                Induk dihapus
              </Chip>
            )}
            {node.badges.outOfRange > 0 && (
              <Chip
                className="border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-300"
                icon={Ruler}
                hint="Kandidat pembanding di luar rentang grade posisi target, ditambahkan setelah konfirmasi."
              >
                Di luar rentang grade ({node.badges.outOfRange})
              </Chip>
            )}
            {node.badges.liveValues && (
              <Chip
                className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                icon={Timer}
                hint="Sebagian yang seharusnya dibekukan dari run induk dibaca dari kondisi hari ini, karena run induk (run lama) tidak menyimpannya. Rinciannya ada di kepala run."
              >
                Nilai hari ini
              </Chip>
            )}
            {node.badges.provisional > 0 && (
              <Chip
                className="border-violet-500/50 bg-violet-500/10 text-violet-700 dark:text-violet-300"
                hint="Sebagian aspek kandidat tidak dapat dibaca saat penilaian (data terenkripsi terkunci), sehingga skornya sementara."
              >
                Skor sementara ({node.badges.provisional})
              </Chip>
            )}
            {node.badges.decisions > 0 && (
              <Chip
                className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                icon={Gavel}
                hint="Ada keputusan forum (suksesor terpilih) yang merujuk run ini."
              >
                Ada keputusan forum ({node.badges.decisions})
              </Chip>
            )}
          </div>
        )}
        {failed && node.failure && (
          <p className="flex items-start gap-1 text-[10px] leading-snug text-rose-700 dark:text-rose-300">
            <AlertTriangle className="mt-px h-2.5 w-2.5 shrink-0" />
            <span>
              {node.failure.message} Run induknya tidak berubah.
            </span>
          </p>
        )}
        {node.reason && (
          <p className="flex items-start gap-1 text-[10px] italic text-muted-foreground">
            <MessageSquareQuote className="mt-px h-2.5 w-2.5 shrink-0 not-italic" />
            <span className={cn(!reasonOpen && 'line-clamp-1')}>Alasan: {node.reason}</span>
            {node.reason.length > 80 && (
              <button
                type="button"
                onClick={() => setReasonOpen((v) => !v)}
                className="shrink-0 not-italic font-semibold text-primary hover:underline"
              >
                {reasonOpen ? 'ringkas' : 'selengkapnya'}
              </button>
            )}
          </p>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul>
          {node.children.map((child, i) => (
            <TreeNode
              key={child.runId}
              node={child}
              selectedRunId={selectedRunId}
              onSelect={onSelect}
              onPath={onPath}
              expanded={expanded}
              toggle={toggle}
              filteredOutIds={filteredOutIds}
              isLast={i === node.children.length - 1}
              picked={picked}
              togglePick={togglePick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function RunTree({ tree, selectedRunId, onSelect, positionId, filteredOutIds, className }: RunTreeProps) {
  const onPath = useMemo(() => pathToNode(tree?.roots ?? [], selectedRunId), [tree, selectedRunId]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string[]>([]);
  const byId = useMemo(() => flatten(tree?.roots ?? []), [tree]);

  // Open the path to the selected run plus the newest root, and leave untouched
  // branches closed. Re-runs when the selection changes so following a link into
  // a deep node never lands on a collapsed ancestor.
  useEffect(() => {
    if (!tree) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      onPath.forEach((id) => next.add(id));
      if (tree.roots[0]) next.add(tree.roots[0].runId);
      return next;
    });
  }, [tree, onPath]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      // Never collapse an ancestor of the selected run out from under it.
      if (next.has(id) && onPath.has(id) && id !== selectedRunId) return prev;
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // At most two: ticking a third drops the oldest pick.
  const togglePick = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2)));

  // A = the earlier run (pembanding), B = the later one (yang dibandingkan).
  const pair = useMemo(() => {
    if (picked.length !== 2) return null;
    const [x, y] = picked.map((id) => byId.get(id)).filter(Boolean) as RunTreeNode[];
    if (!x || !y) return null;
    return x.createdAt <= y.createdAt ? { a: x, b: y } : { a: y, b: x };
  }, [picked, byId]);

  const neighbours = useMemo(
    () => (tree && selectedRunId ? runNeighbours(tree.roots, selectedRunId) : null),
    [tree, selectedRunId],
  );
  const selectedNode = selectedRunId ? byId.get(selectedRunId) ?? null : null;

  if (tree === null) {
    return (
      <div className={cn('space-y-2 p-3', className)}>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Menyusun silsilah run…
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-muted/60" style={{ marginLeft: i * INDENT_PX }} />
        ))}
      </div>
    );
  }

  if (tree.roots.length === 0) {
    return (
      <div className={cn('p-6 text-center text-[11px] text-muted-foreground', className)}>
        Belum ada run untuk posisi ini. Jalankan scoring untuk membuat run root pertama.
      </div>
    );
  }

  const shortcut = (label: string, targetId: string | null, missing: string) =>
    targetId && selectedRunId ? (
      <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]">
        <CompareLink positionId={positionId} a={targetId} b={selectedRunId}>
          <GitCompare className="h-3 w-3" />
          {label}
        </CompareLink>
      </Button>
    ) : (
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled title={missing}>
        <GitCompare className="h-3 w-3" />
        {label}
      </Button>
    );

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1 font-semibold text-foreground">
          <GitBranch className="h-3 w-3" />
          Silsilah Run
        </span>
        <span>
          {tree.totalRuns} run · {tree.roots.length} pohon
          {tree.maxDepth > 0 && ` · ${tree.maxDepth + 1} generasi`}
        </span>
        {tree.orphanCount > 0 && (
          <span className="text-amber-700 dark:text-amber-300">· {tree.orphanCount} induknya dihapus</span>
        )}
        <span className="ml-auto">Lengkap — tidak mengikuti filter tanggal / program.</span>
      </div>

      {/* FR-RH-03: compare the selected run with its parent, root, or the run before it. */}
      {selectedNode && comparable(selectedNode) && neighbours && (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
          <span className="text-[10px] font-semibold text-muted-foreground">
            Run {shortRunId(selectedNode.runId)}:
          </span>
          {shortcut('Bandingkan dengan induk', neighbours.parentId, 'Run ini tidak punya induk yang dapat dibandingkan.')}
          {shortcut('Bandingkan dengan root', neighbours.rootId, 'Root run ini adalah dirinya sendiri atau induk langsungnya.')}
          {shortcut(
            'Bandingkan dengan run sebelumnya',
            neighbours.previousId,
            'Tidak ada run AHP + TOPSIS yang selesai sebelum run ini.',
          )}
        </div>
      )}

      {/* Two ticked → "Bandingkan". */}
      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2 text-[11px]">
          <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
          {pair ? (
            <>
              <span>
                A <span className="font-mono">{shortRunId(pair.a.runId)}</span> (pembanding) dan B{' '}
                <span className="font-mono">{shortRunId(pair.b.runId)}</span> (yang dibandingkan)
              </span>
              <Button asChild size="sm" className="h-7 gap-1 px-3 text-[11px]">
                <CompareLink positionId={positionId} a={pair.a.runId} b={pair.b.runId}>
                  <GitCompare className="h-3 w-3" />
                  Bandingkan
                </CompareLink>
              </Button>
              <span className="text-[10px] text-muted-foreground">terbuka di tab Komparasi Versi</span>
            </>
          ) : (
            <span>1 run dipilih — centang satu run lagi untuk membandingkan.</span>
          )}
          <button type="button" onClick={() => setPicked([])} className="ml-auto font-semibold text-muted-foreground hover:text-foreground">
            Batal
          </button>
        </div>
      )}

      <ul className="max-h-[32rem] overflow-y-auto px-2 py-1">
        {tree.roots.map((root, i) => (
          <TreeNode
            key={root.runId}
            node={root}
            selectedRunId={selectedRunId}
            onSelect={onSelect}
            onPath={onPath}
            expanded={expanded}
            toggle={toggle}
            filteredOutIds={filteredOutIds}
            isLast={i === tree.roots.length - 1}
            picked={picked}
            togglePick={togglePick}
          />
        ))}
      </ul>
    </div>
  );
}
