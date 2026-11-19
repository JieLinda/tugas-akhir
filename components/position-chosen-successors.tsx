'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { PositionSummary } from '@/lib/talent-data';

type Chosen = NonNullable<PositionSummary['chosenCandidates']>[number];

function readinessTone(readiness: string | null) {
  switch (readiness) {
    case 'Short':
      return 'border-emerald-200 bg-emerald-500/10 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-500/15 dark:text-emerald-300';
    case 'Medium':
      return 'border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-900/60 dark:bg-amber-500/15 dark:text-amber-300';
    case 'Long':
      return 'border-sky-200 bg-sky-500/10 text-sky-700 dark:border-sky-900/60 dark:bg-sky-500/15 dark:text-sky-300';
    default:
      return 'border-slate-200 bg-slate-500/10 text-slate-700 dark:border-slate-800 dark:bg-slate-500/15 dark:text-slate-300';
  }
}

export function ChosenSuccessorsButton({
  positionId,
  positionTitle,
  chosen,
  programLabel,
  className,
}: {
  positionId: string;
  positionTitle: string;
  chosen: Chosen[];
  programLabel: (code: string) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [programFilter, setProgramFilter] = useState<string>('all');

  if (chosen.length === 0) return null;

  // Distinct programs (in first-seen order) + per-program counts.
  const programCodes: string[] = [];
  const countByProgram = new Map<string, number>();
  for (const c of chosen) {
    if (!countByProgram.has(c.programCode)) programCodes.push(c.programCode);
    countByProgram.set(c.programCode, (countByProgram.get(c.programCode) ?? 0) + 1);
  }

  const activeFilter = programFilter !== 'all' && countByProgram.has(programFilter) ? programFilter : 'all';
  const visible = activeFilter === 'all' ? chosen : chosen.filter((c) => c.programCode === activeFilter);

  // Group the visible picks by program, preserving (program, rank) order.
  const byProgram = new Map<string, Chosen[]>();
  for (const c of visible) {
    const bucket = byProgram.get(c.programCode) ?? [];
    bucket.push(c);
    byProgram.set(c.programCode, bucket);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setProgramFilter('all');
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-7 gap-1.5 border-violet-200/70 bg-violet-500/5 px-2 text-[11px] font-semibold text-violet-700 hover:bg-violet-500/10 dark:border-violet-900/60 dark:text-violet-300',
            className,
          )}
        >
          <Users className="h-3.5 w-3.5" />
          Suksesor terpilih ({chosen.length})
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Suksesor Terpilih</DialogTitle>
          <DialogDescription className="line-clamp-2">{positionTitle}</DialogDescription>
        </DialogHeader>

        {/* Program filter chips — show only picks of the chosen program */}
        {programCodes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setProgramFilter('all')}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                activeFilter === 'all'
                  ? 'border-violet-400 bg-violet-500/10 text-violet-700 dark:border-violet-700 dark:text-violet-300'
                  : 'border-slate-200/70 text-muted-foreground hover:bg-muted/50 dark:border-slate-800',
              )}
            >
              Semua ({chosen.length})
            </button>
            {programCodes.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setProgramFilter(code)}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors',
                  activeFilter === code
                    ? 'border-violet-400 bg-violet-500/10 text-violet-700 dark:border-violet-700 dark:text-violet-300'
                    : 'border-slate-200/70 text-muted-foreground hover:bg-muted/50 dark:border-slate-800',
                )}
              >
                {programLabel(code)} ({countByProgram.get(code)})
              </button>
            ))}
          </div>
        )}

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {Array.from(byProgram.entries()).map(([program, picks]) => (
            <div key={program} className="space-y-2">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {programLabel(program)}
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {picks.length}
                </Badge>
              </div>
              <div className="space-y-1.5">
                {picks.map((p) => (
                  <div
                    key={p.pickId}
                    className="flex items-center gap-2.5 rounded-lg border border-slate-200/70 p-2.5 dark:border-slate-800"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-[11px] font-bold tabular-nums text-violet-700 dark:text-violet-300">
                      {p.rank + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    {p.readiness && (
                      <Badge variant="outline" className={cn('text-[10px] font-normal', readinessTone(p.readiness))}>
                        {p.readiness}
                      </Badge>
                    )}
                    {p.score != null && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                        {p.score}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t pt-3">
          <Button asChild variant="outline" size="sm">
            <Link href={`/positions/${positionId}`}>Buka detail posisi</Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
