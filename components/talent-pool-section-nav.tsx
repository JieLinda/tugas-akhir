'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid2x2, Trophy, type LucideIcon } from 'lucide-react';

import { TALENT_POOL_HUB, isHubSectionActive } from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Icon + accent per section, keyed by href like the Dokumen/Posisi strips. Full
 * class strings, never interpolated — Tailwind v4 only emits classes it can see
 * in source.
 */
const SECTION_STYLE: Record<string, { icon: LucideIcon; active: string; idle: string; dot: string }> = {
  '/talent-pool': {
    icon: Trophy,
    active:
      'bg-emerald-500/12 text-emerald-800 ring-1 ring-emerald-500/30 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/30',
    idle: 'text-emerald-700/80 hover:bg-emerald-500/8 hover:text-emerald-800 dark:text-emerald-300/80 dark:hover:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  '/talent-pool/mapping': {
    icon: Grid2x2,
    active:
      'bg-indigo-500/12 text-indigo-800 ring-1 ring-indigo-500/30 dark:bg-indigo-400/15 dark:text-indigo-200 dark:ring-indigo-400/30',
    idle: 'text-indigo-700/80 hover:bg-indigo-500/8 hover:text-indigo-800 dark:text-indigo-300/80 dark:hover:text-indigo-200',
    dot: 'bg-indigo-500',
  },
};

const FALLBACK_STYLE = {
  icon: Trophy,
  active: 'bg-background text-foreground ring-1 ring-border/60 shadow-sm',
  idle: 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
  dot: 'bg-muted-foreground',
};

/**
 * The Talent Pool menu's two sections — the pool, then the 16-box map — as a
 * strip under each page's own header. Left to right is the reading order, not a
 * funnel: the map takes everyone the pool's DISCIPLINE rule admits (not only
 * its "Lolos" list) and shows the pool verdict beside each person.
 */
export function TalentPoolSectionNav() {
  const pathname = usePathname();
  return (
    <div className="relative z-10 shrink-0 border-b border-border/60 bg-background/70 px-6 py-3 backdrop-blur-xl">
      <nav
        aria-label="Seksi Talent Pool"
        className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-slate-100/80 p-1 dark:bg-slate-950/40"
      >
        {TALENT_POOL_HUB.sections
          .filter((section) => !section.hidden)
          .map((section) => {
            const isActive = isHubSectionActive(section, pathname, TALENT_POOL_HUB);
            const style = SECTION_STYLE[section.href] ?? FALLBACK_STYLE;
            const Icon = style.icon;
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors',
                  isActive ? style.active : style.idle,
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {section.label}
                {isActive && <span aria-hidden className={cn('ml-0.5 h-1.5 w-1.5 rounded-full', style.dot)} />}
              </Link>
            );
          })}
      </nav>
    </div>
  );
}
