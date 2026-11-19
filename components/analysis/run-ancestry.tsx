'use client';

// ── "Silsilah run" — where the ranking on screen came from ────────────────
//
// A derived run looks exactly like a baseline run once it is open: same table,
// same scores, same readiness column. Nothing in the results area says the pool
// was narrowed by an exclusion, or that half of these people were carried over
// unscored from a run made three weeks ago. The run picker technically holds
// that information, but as a flat list of labels — by the third generation the
// labels are near-identical and the reader has stopped reading them.
//
// So the lineage sits ABOVE the ranking, as a chain the reader walks: root →
// … → the run they are looking at. Two deliberate choices:
//
//  • Every ancestor is CLICKABLE. The question this component provokes ("moved
//    relative to what?") is only answerable by opening the parent, so naming
//    the parent without reaching it just relocates the dead end. That is also
//    why a long chain collapses into a pill that EXPANDS rather than one that
//    explains itself in a tooltip — a tooltip would name the hidden runs and
//    still strand them.
//  • The sentence under the chain is `rerunSpec(mode).expectation` verbatim,
//    never a local paraphrase. The rerun dialog, the run tree, the run
//    configuration panel and this strip all answer "what may have moved this
//    ranking"; they used to each phrase it themselves and they did not agree.
//
// A baseline run renders nothing at all: it is not derived from anything, and a
// banner saying so on the majority of runs would train the reader to skip this
// strip on exactly the runs where it matters.

import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight,
  GitBranch,
  History,
  Info,
  MessageSquareQuote,
  Minimize2,
  MoreHorizontal,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RERUN_TONE, rerunSpec, type RerunMode } from '@/lib/rerun-modes';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/datetime';

/** One run on the way from the root down to the run currently open. */
type AncestryStep = {
  runId: string;
  shortLabel: string;
  mode: RerunMode;
  candidateCount: number;
  createdAt: string;
  /** `scoring_runs.rerun_reason`; null on roots and runs made before it existed. */
  reason?: string | null;
};

export type RunAncestryProps = {
  /** Root-first, ending with the run being displayed. */
  path: AncestryStep[];
  onSelect: (runId: string) => void;
  /** Other runs derived from the SAME parent as the current run. */
  siblings?: { runId: string; shortLabel: string; mode: RerunMode }[];
  className?: string;
};

/**
 * Chains longer than this collapse their middle. Four keeps the shape the
 * reader actually needs — the origin, the immediate parent, and the current run
 * — with one pill standing in for everything between.
 */
const COLLAPSE_ABOVE = 4;

type ChainItem =
  | { kind: 'run'; step: AncestryStep }
  | { kind: 'gap'; hidden: AncestryStep[] };

function StepPill({
  step,
  current,
  onSelect,
}: {
  step: AncestryStep;
  current: boolean;
  onSelect: (runId: string) => void;
}) {
  const spec = rerunSpec(step.mode);
  const tone = RERUN_TONE[spec.tone];

  const body = (
    <>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
      <span className="max-w-[11rem] truncate">{step.shortLabel || spec.label}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {step.candidateCount} kand.
      </span>
    </>
  );

  const shared =
    'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-none transition-colors';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {current ? (
          <span
            aria-current="step"
            className={cn(
              shared,
              'cursor-default border-primary/50 bg-primary/5 font-semibold text-foreground ring-1 ring-primary/20',
              'dark:border-primary/50 dark:bg-primary/10 dark:ring-primary/25',
            )}
          >
            {body}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelect(step.runId)}
            className={cn(
              shared,
              'cursor-pointer border-border/60 bg-background text-muted-foreground',
              'hover:border-border hover:bg-muted/60 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              'dark:border-border/50 dark:bg-background/40 dark:hover:bg-muted/30',
            )}
          >
            {body}
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs font-medium">{step.shortLabel || spec.label}</p>
        <p className="mt-0.5 text-[11px] opacity-80">
          {spec.label} &middot; {step.candidateCount} kandidat dinilai &middot;{' '}
          {formatDateTime(step.createdAt)}
        </p>
        <p className="mt-1 text-[11px] opacity-80">
          {current ? 'Run yang sedang dibuka.' : 'Klik untuk membuka peringkat run ini.'}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function GapPill({ hidden, onExpand }: { hidden: AncestryStep[]; onExpand: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onExpand}
          aria-expanded={false}
          aria-label={`Tampilkan ${hidden.length} run di antaranya`}
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-dashed px-2 py-1 text-[11px] leading-none transition-colors',
            'border-border/70 bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            'dark:border-border/60 dark:bg-muted/20 dark:hover:bg-muted/40',
          )}
        >
          <MoreHorizontal className="h-3 w-3 shrink-0" aria-hidden />
          {`+${hidden.length} run`}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-[11px]">
          {hidden.length} run di antara run awal dan run ini disembunyikan agar rantainya
          tetap terbaca. Klik untuk menampilkan sekaligus membukanya.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function SiblingsPopover({
  siblings,
  onSelect,
}: {
  siblings: NonNullable<RunAncestryProps['siblings']>;
  onSelect: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium leading-none transition-colors',
            'border-border/60 bg-background text-muted-foreground',
            'hover:border-border hover:bg-muted/60 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
            'dark:border-border/50 dark:bg-background/40 dark:hover:bg-muted/30',
          )}
        >
          <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
          cabang lain ({siblings.length})
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-80 p-3">
        <p className="text-xs font-semibold">Cabang lain dari run dasar yang sama</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Run berikut berangkat dari run dasar yang sama dengan run ini, tetapi memakai
          perubahan yang berbeda — jadi peringkatnya bukan versi lama maupun versi baru dari
          yang sedang Anda baca, melainkan jawaban atas pertanyaan lain.
        </p>
        <ul className="mt-2 space-y-1">
          {siblings.map((s) => {
            const spec = rerunSpec(s.mode);
            const tone = RERUN_TONE[spec.tone];
            return (
              <li key={s.runId}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onSelect(s.runId);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                    'border-transparent hover:border-border/60 hover:bg-muted/60',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                    'dark:hover:bg-muted/30',
                  )}
                >
                  <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[11px]">
                    {s.shortLabel || spec.label}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-1.5 py-px text-[9px] font-semibold',
                      tone.chip,
                    )}
                  >
                    {spec.chip}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function RunAncestry({ path, onSelect, siblings, className }: RunAncestryProps) {
  const [expanded, setExpanded] = useState(false);
  const currentId = path.length > 0 ? path[path.length - 1].runId : null;

  // Opening a different run resets the chain to its compact shape: the expansion
  // was a decision about the previous lineage, not a standing preference.
  useEffect(() => {
    setExpanded(false);
  }, [currentId]);

  const items = useMemo<ChainItem[]>(() => {
    if (path.length <= COLLAPSE_ABOVE || expanded)
      return path.map((step) => ({ kind: 'run', step }));
    return [
      { kind: 'run', step: path[0] },
      { kind: 'gap', hidden: path.slice(1, path.length - 2) },
      { kind: 'run', step: path[path.length - 2] },
      { kind: 'run', step: path[path.length - 1] },
    ];
  }, [path, expanded]);

  // Hooks first, then the early return: a baseline run has no story to tell.
  if (path.length <= 1) return null;

  const current = path[path.length - 1];
  const spec = rerunSpec(current.mode);
  const collapsible = path.length > COLLAPSE_ABOVE;

  return (
    <div
      className={cn(
        'rounded-lg border border-border/60 bg-muted/30 px-3 py-2',
        'dark:border-border/50 dark:bg-muted/15',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <GitBranch className="h-3 w-3" aria-hidden />
          Silsilah
        </span>

        <ol
          aria-label="Silsilah run, dari run awal sampai run yang sedang dibuka"
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:thin]"
        >
          {items.map((item, idx) => (
            <li
              key={item.kind === 'gap' ? `gap-${idx}` : item.step.runId}
              className="flex shrink-0 items-center gap-1.5"
            >
              {idx > 0 && (
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" aria-hidden />
              )}
              {item.kind === 'gap' ? (
                <GapPill hidden={item.hidden} onExpand={() => setExpanded(true)} />
              ) : (
                <StepPill
                  step={item.step}
                  current={item.step.runId === current.runId}
                  onSelect={onSelect}
                />
              )}
            </li>
          ))}
        </ol>

        {collapsible && expanded && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className={cn(
              'inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-1.5 py-1 text-[10px] leading-none transition-colors',
              'border-border/60 bg-background text-muted-foreground',
              'hover:border-border hover:bg-muted/60 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              'dark:border-border/50 dark:bg-background/40 dark:hover:bg-muted/30',
            )}
          >
            <Minimize2 className="h-3 w-3 shrink-0" aria-hidden />
            ringkas
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <p className="flex min-w-0 items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            <span className="font-medium text-foreground/80">{spec.label}.</span>{' '}
            {spec.legacy && (
              <span className="mr-1 inline-flex items-center gap-0.5 rounded border border-slate-400/50 bg-slate-400/10 px-1 py-px align-middle text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                <History className="h-2.5 w-2.5" aria-hidden />
                mode lama
              </span>
            )}
            {spec.expectation}
            {current.reason && (
              <span className="mt-1 flex items-start gap-1 italic text-foreground/80">
                <MessageSquareQuote className="mt-px h-3 w-3 shrink-0 not-italic" aria-hidden />
                <span>
                  <span className="not-italic font-medium">Alasan / permintaan forum:</span>{' '}
                  {current.reason}
                </span>
              </span>
            )}
          </span>
        </p>

        {siblings && siblings.length >= 2 && (
          <SiblingsPopover siblings={siblings} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
