'use client';

// The A | B bar of the "Komparasi Versi" tab. It stays in view while the
// comparison scrolls (sticky), so switching what is compared never means
// scrolling back up: each slot is also a picker, B steps through its siblings —
// the gesture a root with many children needs — and the shortcuts set A to what
// a reader usually wants next to B. Under the slots, one line says how the two
// are related, because that decides what a difference between them can mean.

import { useMemo } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Download, GitBranch, Link2, Loader2, MessageSquareQuote } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { formatDateTime } from '@/lib/datetime';
import { rerunSpec } from '@/lib/rerun-modes';
import { runNeighbours, shortRunId } from '@/lib/run-history';
import type { RunTree, RunTreeNode } from '@/lib/run-tree';
import { lineageIndex, siblingStep } from '@/lib/run-lineage-layout';
import type { ComparisonDto } from '@/lib/run-compare-dto';
import { SIDE_STYLE, SideBadge, isComparableRun, notComparableReason, type PairSide } from './lineage-navigator';

/** What the run is, said by its place in the lineage: "run root", "turunan dari #…". */
const kindLabel = (n: RunTreeNode, parentId: string | null) => {
  const spec = rerunSpec(n.mode);
  if (spec.legacy) return `mode lama: ${spec.label}`;
  if (parentId) return `turunan dari ${shortRunId(parentId)}`;
  return n.orphaned ? 'induk dihapus' : 'run root';
};

const SLOT_SURFACE: Record<PairSide, string> = {
  a: 'bg-linear-to-br from-slate-500/12 via-slate-500/5 to-background hover:from-slate-500/18',
  b: 'bg-linear-to-br from-indigo-500/15 via-indigo-500/6 to-background hover:from-indigo-500/22',
};

function Slot({
  side,
  value,
  nodes,
  parentOf,
  onChange,
}: {
  side: PairSide;
  value: string | null;
  nodes: RunTreeNode[];
  parentOf: (id: string) => string | null;
  onChange: (id: string) => void;
}) {
  const node = nodes.find((n) => n.runId === value) ?? null;
  return (
    // '' rather than undefined while the slot is empty: the Select stays
    // controlled for its whole life instead of switching mid-way, which React
    // warns about the moment the default pair arrives.
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger
        aria-label={`Run ${side.toUpperCase()} — ${SIDE_STYLE[side].name.toLowerCase()}`}
        className={cn(
          'h-auto min-h-14 w-full min-w-0 items-center gap-2.5 rounded-xl border-2 py-2 text-left shadow-xs transition-all duration-200 hover:shadow-md [&>svg:last-child]:opacity-60',
          value ? cn(SIDE_STYLE[side].ring, SLOT_SURFACE[side]) : 'border-dashed',
        )}
      >
        <SideBadge side={side} className="h-8 min-w-8 rounded-lg text-sm shadow-sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] text-muted-foreground">
            <span className={cn('font-bold uppercase tracking-wider', SIDE_STYLE[side].text)}>{SIDE_STYLE[side].name}</span>
            {node && <> · {kindLabel(node, parentOf(node.runId))}</>}
          </span>
          {node ? (
            <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
              <span className="font-mono font-bold">{shortRunId(node.runId)}</span>
              <span className="truncate font-semibold">{node.shortLabel}</span>
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">Pilih run</span>
          )}
          {node && (
            <span className="block truncate text-[10px] text-muted-foreground">
              {formatDateTime(node.createdAt)} · {node.candidateCount} kandidat
            </span>
          )}
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-80 max-w-[min(92vw,42rem)]">
        {nodes.map((n) => {
          const ok = isComparableRun(n);
          return (
            <SelectItem key={n.runId} value={n.runId} disabled={!ok} className="text-xs">
              <span className="font-mono">{shortRunId(n.runId)}</span> · {n.shortLabel} · {formatDateTime(n.createdAt)} ·{' '}
              {kindLabel(n, parentOf(n.runId))}
              {!ok ? ` — ${notComparableReason(n)}` : ''}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export function PairBar({
  tree,
  a,
  b,
  openRunId,
  dto,
  loading,
  onPick,
  onSwap,
  onSetA,
  exporting,
  onExport,
}: {
  tree: RunTree | null;
  a: string | null;
  b: string | null;
  openRunId: string | null;
  dto: ComparisonDto | null;
  loading: boolean;
  onPick: (side: PairSide, runId: string) => void;
  onSwap: () => void;
  onSetA: (runId: string) => void;
  exporting: boolean;
  onExport: () => void;
}) {
  const roots = useMemo(() => tree?.roots ?? [], [tree]);
  const index = useMemo(() => lineageIndex(roots), [roots]);
  // Newest first, as the old picker listed them.
  const nodes = useMemo(
    () => [...index.values()].map((x) => x.node).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    [index],
  );
  const parentOf = (id: string) => index.get(id)?.parentId ?? null;
  const step = useMemo(() => siblingStep(roots, b, isComparableRun, index), [roots, b, index]);
  const nb = useMemo(() => (b ? runNeighbours(roots, b) : null), [roots, b]);
  const bIsRoot = b ? index.get(b)?.parentId == null : false;
  const openComparable = openRunId ? (index.get(openRunId) ? isComparableRun(index.get(openRunId)!.node) : false) : false;

  const shortcut = (label: string, target: string | null, title: string) => (
    <Button
      key={label}
      type="button"
      size="sm"
      variant="outline"
      className="h-7 rounded-full px-2.5 text-[11px] transition-colors hover:border-slate-500/50 hover:bg-slate-500/10"
      disabled={!target || target === a}
      title={target ? title : `${title} — tidak tersedia untuk run B ini.`}
      onClick={() => target && onSetA(target)}
    >
      {label}
    </Button>
  );

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Tautan perbandingan disalin.');
    } catch {
      toast.error('Tautan tidak dapat disalin. Salin dari bilah alamat peramban.');
    }
  }

  return (
    <div className="sticky top-0 z-30 space-y-2 rounded-2xl border bg-background/95 p-2.5 shadow-md shadow-slate-900/5 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="grid items-center gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="min-w-0">
          <Slot side="a" value={a} nodes={nodes} parentOf={parentOf} onChange={(id) => onPick('a', id)} />
        </div>
        {/* The swap: a round control with "vs" under it — the one gesture that
            reads the comparison the other way round. */}
        <div className="flex items-center justify-center gap-2 lg:flex-col lg:gap-0.5">
          <button
            type="button"
            onClick={onSwap}
            disabled={!a || !b}
            aria-label="Tukar A dan B"
            title="Tukar A dan B"
            className="group flex h-9 w-9 items-center justify-center rounded-full border-2 bg-background text-muted-foreground shadow-sm transition-all duration-300 hover:border-indigo-500/60 hover:text-indigo-600 hover:shadow-md disabled:opacity-40 dark:hover:text-indigo-300"
          >
            <ArrowLeftRight className="h-4 w-4 transition-transform duration-500 group-hover:rotate-180" />
          </button>
          <span className="text-[9px] font-black uppercase tracking-[0.25em] text-muted-foreground/70">vs</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <Slot side="b" value={b} nodes={nodes} parentOf={parentOf} onChange={(id) => onPick('b', id)} />
          </div>
          {/* Step B through its siblings: one root, many children, one click each. */}
          <div className="flex shrink-0 flex-col items-center">
            <div className="flex items-center gap-0.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={!step.prev}
                onClick={() => step.prev && onPick('b', step.prev)}
                aria-label="B ke saudara sebelumnya"
                title={bIsRoot ? 'B ke run root sebelumnya (di atasnya pada silsilah)' : 'B ke saudara sebelumnya (turunan lain dari induk yang sama)'}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={!step.next}
                onClick={() => step.next && onPick('b', step.next)}
                aria-label="B ke saudara berikutnya"
                title={bIsRoot ? 'B ke run root berikutnya (di bawahnya pada silsilah)' : 'B ke saudara berikutnya (turunan lain dari induk yang sama)'}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <span className="mt-0.5 text-[10px] tabular-nums text-muted-foreground" aria-live="polite">
              {step.position > 0 ? `${bIsRoot ? 'root' : 'saudara'} ${step.position}/${step.total}` : '—'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2">
        {/* How A and B are related — read before any number below. */}
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {loading && !dto ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Membandingkan dari data tersimpan…
            </span>
          ) : dto ? (
            <>
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 px-2 py-0.5 font-semibold text-indigo-800 dark:text-indigo-200">
                <GitBranch className="h-3 w-3" aria-hidden />
                {dto.relationText}
              </span>
              {dto.b.rerunReason && (
                <span className="inline-flex min-w-0 items-center gap-1 text-muted-foreground" title={dto.b.rerunReason}>
                  <MessageSquareQuote className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="font-medium text-foreground">Alasan run B:</span>
                  <span className="truncate">{dto.b.rerunReason}</span>
                </span>
              )}
              {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-label="Memuat" />}
            </>
          ) : (
            <span className="text-muted-foreground">Pilih dua run untuk dibandingkan.</span>
          )}
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">Jadikan A:</span>
          {shortcut('Induk B', nb?.parentId ?? null, 'A = induk langsung B')}
          {shortcut('Root B', nb?.rootId ?? null, 'A = root pohon B')}
          {shortcut('Run sebelumnya', nb?.previousId ?? null, 'A = run yang dapat dibandingkan, dibuat tepat sebelum B')}
          {openRunId && openComparable && openRunId !== b && (
            <Button type="button" size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[11px]" onClick={() => onPick('b', openRunId)}>
              B = run yang sedang dibuka
            </Button>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 rounded-full px-2.5 text-[11px]" onClick={copyLink} disabled={!a || !b}>
            <Link2 className="h-3.5 w-3.5" /> Salin tautan
          </Button>
          <Button type="button" size="sm" className="h-7 gap-1 rounded-full px-3 text-[11px] shadow-sm" onClick={onExport} disabled={!dto || exporting}>
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Ekspor XLSX
          </Button>
        </span>
      </div>
    </div>
  );
}
