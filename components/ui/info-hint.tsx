'use client';

import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { CircleAlert, CircleHelp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * The circled "?" (or "!") that holds what a page, tab or section is FOR.
 *
 * Every screen used to open with a paragraph explaining itself — under the page
 * title, under each tab, under each section heading — and the paragraphs were
 * read once and then pushed the actual content down on every visit after. The
 * explanation is still one gesture away: this icon sits beside the heading it
 * explains and shows the text on hover.
 *
 * Hover alone would lock out touch screens and keyboards, so the icon is also a
 * button: a click (tap, Enter, Space) PINS the panel open until the next click,
 * Escape, or a click elsewhere. Hover opens with a short delay so a pointer
 * crossing the icon does not flash a panel, and the panel stays open while the
 * pointer travels into it, so a link inside it can be clicked.
 *
 *  - `kind="help"` (?, default) — what this is and how to read it.
 *  - `kind="note"` (!, amber) — a caveat worth knowing before acting.
 *
 * Use it only for explanation. A status, a warning about THIS data, or an empty
 * state stays visible on the page — hiding those behind an icon would hide the
 * finding, not the instructions.
 */
export function InfoHint({
  children,
  title,
  kind = 'help',
  label,
  side = 'bottom',
  align = 'start',
  size = 'sm',
  className,
  contentClassName,
  icon: CustomIcon,
}: {
  /** Replaces the "?"/"!" glyph — for a row of hints that each name their topic by icon. */
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: ReactNode;
  /** Bold first line of the panel; also names the button for screen readers. */
  title?: ReactNode;
  kind?: 'help' | 'note';
  /** Accessible name when `title` is not plain text. */
  label?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** `xs` for table headers and chips, `sm` for section headings, `md` for page titles. */
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);

  const hoverOpen = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setOpen(true), 90);
  }, []);
  const hoverClose = useCallback(() => {
    clear();
    if (pinned.current) return;
    timer.current = setTimeout(() => setOpen(false), 160);
  }, []);

  const onOpenChange = (next: boolean) => {
    // Radix reports Escape and outside clicks here; both end a pin too.
    if (!next) pinned.current = false;
    setOpen(next);
  };

  const Icon = CustomIcon ?? (kind === 'note' ? CircleAlert : CircleHelp);
  const accessible = label ?? (typeof title === 'string' ? `Penjelasan: ${title}` : 'Penjelasan');
  const box = size === 'xs' ? 'h-4 w-4' : size === 'md' ? 'h-6 w-6' : 'h-5 w-5';
  const glyph = size === 'xs' ? 'h-3 w-3' : size === 'md' ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5';

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={accessible}
          onPointerEnter={(e) => e.pointerType === 'mouse' && hoverOpen()}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hoverClose()}
          onClick={(e) => {
            // A hint often sits inside something clickable (a card, a row, a
            // tab). It explains that thing; it must not also activate it.
            e.stopPropagation();
            // Take the toggle over from Radix: a hover already opened it, so the
            // click should keep it open (pin), not close it under the pointer.
            e.preventDefault();
            clear();
            if (open && pinned.current) {
              pinned.current = false;
              setOpen(false);
            } else {
              pinned.current = true;
              setOpen(true);
            }
          }}
          className={cn(
            'group/hint inline-flex shrink-0 cursor-help items-center justify-center rounded-full align-middle transition-all duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1',
            kind === 'note'
              ? 'text-amber-500/80 hover:bg-amber-500/12 hover:text-amber-600 data-[state=open]:bg-amber-500/15 data-[state=open]:text-amber-600 dark:text-amber-400/80 dark:hover:text-amber-300'
              : 'text-muted-foreground/55 hover:bg-primary/10 hover:text-primary data-[state=open]:bg-primary/12 data-[state=open]:text-primary',
            box,
            className,
          )}
        >
          <Icon className={cn(glyph, 'transition-transform duration-200 group-hover/hint:scale-110')} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerEnter={(e) => e.pointerType === 'mouse' && clear()}
        onPointerLeave={(e) => e.pointerType === 'mouse' && hoverClose()}
        className={cn(
          'w-[min(24rem,calc(100vw-2rem))] p-0 text-xs leading-relaxed shadow-lg',
          kind === 'note' ? 'border-amber-500/40' : 'border-primary/25',
          contentClassName,
        )}
      >
        <div
          className={cn(
            'rounded-t-md border-b px-3.5 py-2',
            kind === 'note'
              ? 'border-amber-500/25 bg-amber-500/8'
              : 'border-primary/15 bg-linear-to-r from-primary/10 via-primary/5 to-transparent',
            !title && 'hidden',
          )}
        >
          <p className="flex items-center gap-1.5 text-[12px] font-semibold leading-snug text-foreground">
            <Icon
              className={cn('h-3.5 w-3.5 shrink-0', kind === 'note' ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}
              aria-hidden
            />
            {title}
          </p>
        </div>
        <div className="space-y-2 px-3.5 py-2.5 text-muted-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
