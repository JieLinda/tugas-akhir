'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, UserCheck } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { cn } from '@/lib/utils';
import type { CandidateSuccessorSeat } from '@/lib/pulse-data';

/**
 * "Suksesor" tag on a candidate who has been picked for at least one seat.
 *
 * Violet, because that is the colour Position Management already gives its
 * "Suksesor terpilih" button — the two surfaces show the same `position_picks`
 * rows from opposite ends, and a reader moving between them should recognise
 * the fact by its colour before reading a word.
 *
 * The seats open on hover (and on focus, for the keyboard), and ALSO on tap:
 * a hover card never opens on a touch screen, and a tag whose details are
 * unreachable on a tablet reads as a tag with no details.
 *
 * `masked` follows the page's privacy toggle. The badge itself stays — it is
 * the thing the "Status suksesor" filter selects on, so hiding it while the
 * filter works would be incoherent — but which seat a person is being lined up
 * for is exactly the kind of detail the mask exists to keep off a passing
 * screen, and the page promises only name, position and department while it
 * is on.
 */
export function CandidateSuccessorBadge({
  seats,
  masked,
  className,
}: {
  seats: CandidateSuccessorSeat[] | undefined;
  masked: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!seats || seats.length === 0) return null;

  const label = seats.length === 1 ? 'Suksesor' : `Suksesor · ${seats.length} posisi`;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Dipilih sebagai suksesor untuk ${seats.length} posisi`}
          className={cn(
            'inline-flex items-center gap-1 rounded-md border border-violet-300/70 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700',
            'transition-colors hover:bg-violet-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
            'dark:border-violet-800/70 dark:bg-violet-500/15 dark:text-violet-300',
            className,
          )}
        >
          <UserCheck className="h-3 w-3" />
          {label}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0">
        <div className="border-b px-3.5 py-2.5">
          <p className="text-xs font-semibold">Dipilih sebagai suksesor</p>
          <p className="text-[11px] text-muted-foreground">
            {seats.length === 1 ? 'Untuk 1 posisi' : `Untuk ${seats.length} posisi`}
          </p>
        </div>

        {masked ? (
          <p className="px-3.5 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Nama posisinya disamarkan. Tekan <span className="font-medium text-foreground">Data disamarkan</span>{' '}
            di atas daftar untuk menampilkannya.
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto">
            {seats.map((seat) => (
              <li key={seat.positionId}>
                <Link
                  href={`/positions/${seat.positionId}`}
                  className="group flex items-start gap-2 px-3.5 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium leading-snug">
                      <span className="truncate">{seat.positionTitle}</span>
                      {seat.otherTenantName && (
                        <span className="shrink-0 rounded border px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {seat.otherTenantName}
                        </span>
                      )}
                    </p>
                    {seat.department && (
                      <p className="truncate text-[11px] text-muted-foreground">{seat.department}</p>
                    )}
                    <div className="mt-1 space-y-0.5">
                      {seat.picks.map((pick) => (
                        <p key={pick.programCode} className="text-[11px] text-muted-foreground">
                          {pick.programName} · suksesor ke-{pick.order}
                          {pick.readiness ? ` · ${pick.readiness}` : ''}
                        </p>
                      ))}
                    </div>
                  </div>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
