'use client';

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

type CollapsibleCardProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * The one line worth reading without opening the card — a count, a last-run
   * status. Rendered in the header in both states, so a collapsed card still
   * answers its most common question.
   */
  summary?: React.ReactNode;
  /** Right-aligned header controls; clicks here do not toggle the collapse. */
  headerExtra?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * Remember the open/closed choice per viewer under this key (localStorage).
   * `defaultOpen` still decides the first visit and any environment where
   * storage is unavailable.
   */
  storageKey?: string;
  /** Semantic tone for the header band and title icon — see CardAccent. */
  accent?: CardAccent;
  className?: string;
  children: React.ReactNode;
};

/**
 * Four semantic tones, not a palette: `primary` for the cards a visit is
 * usually for, `neutral` for read-mostly information, `caution` for settings
 * that change where data comes from, `danger` for the destructive card. Rendered
 * as a light tint on the header band plus the title icon — the body stays plain.
 */
export type CardAccent = 'primary' | 'neutral' | 'caution' | 'danger';

/** `header` tints only the card's header band; the body stays plain. */
export const CARD_ACCENT: Record<CardAccent, { header: string; icon: string }> = {
  primary: { header: 'bg-primary/[0.05] dark:bg-primary/10', icon: 'text-primary' },
  neutral: { header: 'bg-muted/50', icon: 'text-slate-500 dark:text-slate-400' },
  caution: { header: 'bg-amber-500/[0.06] dark:bg-amber-400/10', icon: 'text-amber-600 dark:text-amber-400' },
  danger: { header: 'bg-rose-500/[0.06] dark:bg-rose-400/10', icon: 'text-rose-600 dark:text-rose-400' },
};

/** Pulls a CardHeader up over the card's top padding so the tint spans edge to edge. */
export const ACCENT_HEADER_BAND = '-mt-6 rounded-t-xl border-b border-border/60 pt-5 pb-4';

/** Arbitrary-variant classes that colour only the title's leading icon, not its text. */
const ACCENT_ICON_CLASS: Record<CardAccent, string> = {
  primary: '[&>svg]:text-primary',
  neutral: '[&>svg]:text-slate-500 dark:[&>svg]:text-slate-400',
  caution: '[&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
  danger: '[&>svg]:text-rose-600 dark:[&>svg]:text-rose-400',
};

const STORAGE_PREFIX = 'pulse:collapsible:';

/**
 * A standard settings card whose header is a clickable trigger: clicking the
 * title/description toggles the body open or closed, while `headerExtra`
 * controls (e.g. "Muat ulang") stay interactive and never collapse the card.
 */
export function CollapsibleCard({
  title,
  description,
  summary,
  headerExtra,
  defaultOpen = true,
  storageKey,
  accent,
  className,
  children,
}: CollapsibleCardProps) {
  const tone = accent ? CARD_ACCENT[accent] : null;
  const [open, setOpen] = useState(defaultOpen);

  // Restore the viewer's last choice after mount (never during render, so
  // server and client markup agree). Storage can be absent or throw in a
  // private window; the default then simply stands.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const stored = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
      if (stored === '1') setOpen(true);
      else if (stored === '0') setOpen(false);
    } catch {
      /* storage unavailable */
    }
  }, [storageKey]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + storageKey, next ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <Collapsible open={open} onOpenChange={handleOpenChange}>
      <Card className={className}>
        <CardHeader
          className={cn(
            'flex flex-row items-center justify-between gap-2',
            tone && `${ACCENT_HEADER_BAND} ${tone.header}`,
          )}
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              aria-expanded={open}
              className="group -m-1 flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg p-1 text-left transition-colors hover:bg-muted/40"
            >
              <span className="min-w-0 flex-1">
                <CardTitle className={cn('flex flex-wrap items-center gap-2', tone && ACCENT_ICON_CLASS[accent!])}>
                  {title}
                  {summary && (
                    <span className="text-xs font-normal text-muted-foreground">{summary}</span>
                  )}
                </CardTitle>
              </span>
              <ChevronDown
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground',
                  open && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
          {/* The card's explanation sits behind a "?" BESIDE the trigger, not
              inside it: a button inside the trigger button would be invalid
              markup and would fold the card when it was only meant to explain
              it. */}
          {description && (
            <InfoHint title={typeof title === 'string' ? title : undefined} label="Penjelasan kartu" align="end">
              {description}
            </InfoHint>
          )}
          {headerExtra && <div className="flex shrink-0 items-center gap-2">{headerExtra}</div>}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
