'use client';

// ── Shared shell for the dense analysis tabs ──
//
// The "Konfigurasi" and "Komparasi Versi" tabs of the position page both hold a
// long stack of sections that used to be plain bordered boxes of equal weight,
// each opening with a paragraph about itself. These pieces give them one visual
// grammar instead:
//
//  - AccentSection — a card with a coloured spine and icon, its explanation
//    behind a "?" (InfoHint) rather than printed under the title. The colour is
//    the section's identity, repeated on its chip in the SectionNav, so a reader
//    who jumps by chip lands on the same colour they clicked.
//  - KpiTile — a figure that answers one question, optionally a jump target.
//  - SectionNav — a sticky row of chips that follows the scroll (scroll-spy)
//    and jumps on click, so a page of nine sections is navigable without
//    scrolling past the eight you do not need.
//
// Full class strings only: Tailwind v4 emits classes it can see in source, so
// an interpolated `bg-${accent}-500` would silently render unstyled.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

export type Accent =
  | 'sky'
  | 'emerald'
  | 'rose'
  | 'violet'
  | 'amber'
  | 'teal'
  | 'slate'
  | 'indigo'
  | 'cyan'
  | 'fuchsia';

type AccentStyle = {
  /** The coloured spine on the section's left edge. */
  spine: string;
  /** Icon disc. */
  disc: string;
  /** Header wash. */
  wash: string;
  /** Number / small label colour. */
  text: string;
  /** Chip in SectionNav when it is the section in view. */
  chipOn: string;
  /** Chip dot. */
  dot: string;
  /** KPI tile surface. */
  tile: string;
  /** KPI tile value colour. */
  value: string;
};

export const ACCENT: Record<Accent, AccentStyle> = {
  sky: {
    spine: 'bg-sky-500',
    disc: 'bg-sky-500/12 text-sky-600 ring-sky-500/25 dark:text-sky-300',
    wash: 'from-sky-500/[0.07]',
    text: 'text-sky-700 dark:text-sky-300',
    chipOn: 'border-sky-500/40 bg-sky-500/12 text-sky-800 shadow-sm shadow-sky-500/10 dark:text-sky-200',
    dot: 'bg-sky-500',
    tile: 'border-sky-200/70 from-sky-500/10 hover:border-sky-400/60 dark:border-sky-900/50',
    value: 'text-sky-900 dark:text-sky-100',
  },
  emerald: {
    spine: 'bg-emerald-500',
    disc: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/25 dark:text-emerald-300',
    wash: 'from-emerald-500/[0.07]',
    text: 'text-emerald-700 dark:text-emerald-300',
    chipOn: 'border-emerald-500/40 bg-emerald-500/12 text-emerald-800 shadow-sm shadow-emerald-500/10 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    tile: 'border-emerald-200/70 from-emerald-500/10 hover:border-emerald-400/60 dark:border-emerald-900/50',
    value: 'text-emerald-900 dark:text-emerald-100',
  },
  rose: {
    spine: 'bg-rose-500',
    disc: 'bg-rose-500/12 text-rose-600 ring-rose-500/25 dark:text-rose-300',
    wash: 'from-rose-500/[0.07]',
    text: 'text-rose-700 dark:text-rose-300',
    chipOn: 'border-rose-500/40 bg-rose-500/12 text-rose-800 shadow-sm shadow-rose-500/10 dark:text-rose-200',
    dot: 'bg-rose-500',
    tile: 'border-rose-200/70 from-rose-500/10 hover:border-rose-400/60 dark:border-rose-900/50',
    value: 'text-rose-900 dark:text-rose-100',
  },
  violet: {
    spine: 'bg-violet-500',
    disc: 'bg-violet-500/12 text-violet-600 ring-violet-500/25 dark:text-violet-300',
    wash: 'from-violet-500/[0.07]',
    text: 'text-violet-700 dark:text-violet-300',
    chipOn: 'border-violet-500/40 bg-violet-500/12 text-violet-800 shadow-sm shadow-violet-500/10 dark:text-violet-200',
    dot: 'bg-violet-500',
    tile: 'border-violet-200/70 from-violet-500/10 hover:border-violet-400/60 dark:border-violet-900/50',
    value: 'text-violet-900 dark:text-violet-100',
  },
  amber: {
    spine: 'bg-amber-500',
    disc: 'bg-amber-500/14 text-amber-600 ring-amber-500/25 dark:text-amber-300',
    wash: 'from-amber-500/[0.08]',
    text: 'text-amber-700 dark:text-amber-300',
    chipOn: 'border-amber-500/45 bg-amber-500/14 text-amber-900 shadow-sm shadow-amber-500/10 dark:text-amber-200',
    dot: 'bg-amber-500',
    tile: 'border-amber-200/70 from-amber-500/10 hover:border-amber-400/60 dark:border-amber-900/50',
    value: 'text-amber-900 dark:text-amber-100',
  },
  teal: {
    spine: 'bg-teal-500',
    disc: 'bg-teal-500/12 text-teal-600 ring-teal-500/25 dark:text-teal-300',
    wash: 'from-teal-500/[0.07]',
    text: 'text-teal-700 dark:text-teal-300',
    chipOn: 'border-teal-500/40 bg-teal-500/12 text-teal-800 shadow-sm shadow-teal-500/10 dark:text-teal-200',
    dot: 'bg-teal-500',
    tile: 'border-teal-200/70 from-teal-500/10 hover:border-teal-400/60 dark:border-teal-900/50',
    value: 'text-teal-900 dark:text-teal-100',
  },
  slate: {
    spine: 'bg-slate-400 dark:bg-slate-500',
    disc: 'bg-slate-500/12 text-slate-600 ring-slate-500/25 dark:text-slate-300',
    wash: 'from-slate-500/[0.06]',
    text: 'text-slate-600 dark:text-slate-300',
    chipOn: 'border-slate-500/40 bg-slate-500/12 text-slate-800 shadow-sm dark:text-slate-100',
    dot: 'bg-slate-500',
    tile: 'border-slate-200/80 from-slate-500/8 hover:border-slate-400/60 dark:border-slate-800',
    value: 'text-slate-900 dark:text-slate-100',
  },
  indigo: {
    spine: 'bg-indigo-500',
    disc: 'bg-indigo-500/12 text-indigo-600 ring-indigo-500/25 dark:text-indigo-300',
    wash: 'from-indigo-500/[0.07]',
    text: 'text-indigo-700 dark:text-indigo-300',
    chipOn: 'border-indigo-500/40 bg-indigo-500/12 text-indigo-800 shadow-sm shadow-indigo-500/10 dark:text-indigo-200',
    dot: 'bg-indigo-500',
    tile: 'border-indigo-200/70 from-indigo-500/10 hover:border-indigo-400/60 dark:border-indigo-900/50',
    value: 'text-indigo-900 dark:text-indigo-100',
  },
  cyan: {
    spine: 'bg-cyan-500',
    disc: 'bg-cyan-500/12 text-cyan-600 ring-cyan-500/25 dark:text-cyan-300',
    wash: 'from-cyan-500/[0.07]',
    text: 'text-cyan-700 dark:text-cyan-300',
    chipOn: 'border-cyan-500/40 bg-cyan-500/12 text-cyan-800 shadow-sm shadow-cyan-500/10 dark:text-cyan-200',
    dot: 'bg-cyan-500',
    tile: 'border-cyan-200/70 from-cyan-500/10 hover:border-cyan-400/60 dark:border-cyan-900/50',
    value: 'text-cyan-900 dark:text-cyan-100',
  },
  fuchsia: {
    spine: 'bg-fuchsia-500',
    disc: 'bg-fuchsia-500/12 text-fuchsia-600 ring-fuchsia-500/25 dark:text-fuchsia-300',
    wash: 'from-fuchsia-500/[0.07]',
    text: 'text-fuchsia-700 dark:text-fuchsia-300',
    chipOn: 'border-fuchsia-500/40 bg-fuchsia-500/12 text-fuchsia-800 shadow-sm shadow-fuchsia-500/10 dark:text-fuchsia-200',
    dot: 'bg-fuchsia-500',
    tile: 'border-fuchsia-200/70 from-fuchsia-500/10 hover:border-fuchsia-400/60 dark:border-fuchsia-900/50',
    value: 'text-fuchsia-900 dark:text-fuchsia-100',
  },
};

/** Ring a section briefly after a jump, so the eye finds where it landed. */
export function flashElement(el: HTMLElement | null) {
  if (!el) return;
  el.classList.remove('section-shell-flash');
  // Restart the animation when the same section is jumped to twice in a row.
  void el.offsetWidth;
  el.classList.add('section-shell-flash');
  window.setTimeout(() => el.classList.remove('section-shell-flash'), 1600);
}

export function jumpToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  flashElement(el);
}

/**
 * A titled section with a coloured spine. `info` is the section's explanation —
 * shown behind a "?" beside the title, never as a paragraph under it.
 * `collapsible` adds a fold control to the header for the longest sections;
 * folded content stays mounted so nothing inside it loses its state.
 */
export function AccentSection({
  id,
  accent,
  icon: Icon,
  title,
  number,
  info,
  infoTitle,
  aside,
  children,
  className,
  bodyClassName,
  collapsible = false,
  defaultOpen = true,
}: {
  id?: string;
  accent: Accent;
  icon: LucideIcon;
  title: ReactNode;
  number?: number | string;
  info?: ReactNode;
  infoTitle?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const a = ACCENT[accent];
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      id={id}
      className={cn(
        'group/section relative scroll-mt-20 overflow-hidden rounded-2xl border bg-card shadow-xs transition-shadow duration-300 hover:shadow-md',
        'animate-in fade-in-0 slide-in-from-bottom-1 duration-500',
        className,
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', a.spine)} />
      <header
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 bg-linear-to-r to-transparent py-3 pl-5 pr-4',
          a.wash,
          open && 'border-b border-border/60',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-300 group-hover/section:scale-105',
            a.disc,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-bold tracking-tight">
          {number != null && (
            <span className={cn('font-mono text-[11px] font-bold tabular-nums', a.text)}>{number}</span>
          )}
          <span className="min-w-0">{title}</span>
          {info ? (
            <InfoHint title={infoTitle ?? (typeof title === 'string' ? title : undefined)}>{info}</InfoHint>
          ) : null}
        </h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {aside}
          {collapsible && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Lipat seksi' : 'Buka seksi'}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', !open && '-rotate-90')} />
            </button>
          )}
        </div>
      </header>
      <div className={cn('space-y-3 py-4 pl-5 pr-4', !open && 'hidden', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A small titled block inside a section — a sub-heading with optional hint. */
export function SubBlock({
  title,
  info,
  aside,
  children,
  className,
  tone = 'plain',
}: {
  title: ReactNode;
  info?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: 'plain' | 'muted';
}) {
  return (
    <div className={cn('space-y-2 rounded-xl border p-3', tone === 'muted' && 'bg-muted/25', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {title}
          {info ? (
            <InfoHint size="xs" title={typeof title === 'string' ? title : undefined}>
              {info}
            </InfoHint>
          ) : null}
        </p>
        {aside && <div className="ml-auto flex flex-wrap items-center gap-1.5">{aside}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * One figure. A tile with `onClick` is a jump to the section that explains it
 * — rendered as a button, with the lift that says so.
 */
export function KpiTile({
  label,
  value,
  sub,
  accent = 'slate',
  icon: Icon,
  onClick,
  info,
  emphasis = false,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  accent?: Accent;
  icon?: LucideIcon;
  onClick?: () => void;
  info?: ReactNode;
  emphasis?: boolean;
  className?: string;
}) {
  const a = ACCENT[accent];
  const body = (
    <>
      <span aria-hidden className={cn('absolute -right-6 -top-6 h-16 w-16 rounded-full opacity-40 blur-2xl', a.dot)} />
      <span className="relative flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className={cn('h-3.5 w-3.5', a.text)} aria-hidden />}
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span
        className={cn(
          'relative mt-1 block font-bold leading-tight tabular-nums',
          emphasis ? 'text-2xl' : 'text-lg',
          a.value,
        )}
      >
        {value}
      </span>
      {sub && <span className="relative mt-1 block text-[11px] leading-snug text-muted-foreground">{sub}</span>}
    </>
  );
  const shell = cn(
    'relative block min-w-0 overflow-hidden rounded-xl border bg-linear-to-br to-card p-3.5 text-left transition-all duration-300',
    a.tile,
    className,
  );
  return (
    <div className="relative min-w-0">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            shell,
            'w-full hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          )}
        >
          {body}
        </button>
      ) : (
        <div className={shell}>{body}</div>
      )}
      {info ? (
        <span className="absolute right-2 top-2">
          <InfoHint size="xs" title={typeof label === 'string' ? label : undefined} align="end">
            {info}
          </InfoHint>
        </span>
      ) : null}
    </div>
  );
}

export type SectionNavItem = { id: string; label: string; accent: Accent; count?: number | null };

/**
 * Sticky chips that follow the scroll. The section marked is the last one
 * whose top has passed just below the nav — what the reader is reading, not
 * the one still trailing off the top. Scroll events are captured at the window
 * so this works inside the page's own scrolling container; a click scrolls to
 * the section and rings it.
 */
export function SectionNav({
  items,
  label,
  className,
  trailing,
}: {
  items: SectionNavItem[];
  label: string;
  className?: string;
  trailing?: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null);
  const navRef = useRef<HTMLElement>(null);
  const ids = items.map((i) => i.id).join('|');

  useEffect(() => {
    const order = ids.split('|').filter(Boolean);
    let raf = 0;
    const compute = () => {
      raf = 0;
      const navBottom = navRef.current?.getBoundingClientRect().bottom ?? 0;
      // A jump leaves its target scroll-margin (scroll-mt-20) below the
      // container top, i.e. a little under the nav — the line sits past that.
      const line = navBottom + 56;
      let current: string | null = null;
      for (const id of order) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= line) current = id;
        else break;
      }
      setActive(current ?? order[0] ?? null);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    compute();
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ids]);

  const go = useCallback((id: string) => {
    setActive(id);
    jumpToSection(id);
  }, []);

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        'sticky top-0 z-20 -mx-1 flex items-center gap-2 rounded-2xl border bg-background/90 px-2 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/75',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const on = item.id === active;
          const a = ACCENT[item.accent];
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => go(item.id)}
              aria-current={on ? 'true' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-all duration-200',
                on ? a.chipOn : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full transition-transform', a.dot, on && 'scale-125')} />
              {item.label}
              {item.count != null && item.count > 0 && (
                <span className="rounded-full bg-foreground/8 px-1.5 text-[10px] tabular-nums">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-1.5">{trailing}</div>}
    </nav>
  );
}

/** The ring a jump leaves on its target — plain <style>, like ask-ai-context. */
export function SectionShellStyles() {
  return (
    <style>{`
      .section-shell-flash { animation: sectionShellFlash 1.6s ease-out; }
      @keyframes sectionShellFlash {
        0%, 35% { box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 45%, transparent); }
        100%    { box-shadow: 0 0 0 3px color-mix(in oklch, var(--primary) 0%, transparent); }
      }
    `}</style>
  );
}
