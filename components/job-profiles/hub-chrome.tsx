'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, FileText, FolderTree, Link2, type LucideIcon } from 'lucide-react';
import { DashboardHeader } from '@/components/dashboard-header';
import {
  JOB_PROFILES_HUB,
  POSITION_HUB,
  activeHubSection,
  isHubSectionActive,
  type Hub,
} from '@/lib/navigation';
import { cn } from '@/lib/utils';

/**
 * Icon + accent per section, keyed by href like the sidebar's icon map. Kept
 * out of lib/navigation.ts on purpose (the registry stays icon-free and
 * client-safe). Full class strings, never interpolated — Tailwind v4 only
 * emits classes it can see in source.
 */
const SECTION_STYLE: Record<
  string,
  { icon: LucideIcon; active: string; idle: string; dot: string }
> = {
  '/job-profiles': {
    icon: FileText,
    active:
      'bg-sky-500/12 text-sky-800 ring-1 ring-sky-500/30 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/30',
    idle: 'text-sky-700/80 hover:bg-sky-500/8 hover:text-sky-800 dark:text-sky-300/80 dark:hover:text-sky-200',
    dot: 'bg-sky-500',
  },
  '/job-profiles/match': {
    icon: Link2,
    active:
      'bg-emerald-500/12 text-emerald-800 ring-1 ring-emerald-500/30 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-400/30',
    idle: 'text-emerald-700/80 hover:bg-emerald-500/8 hover:text-emerald-800 dark:text-emerald-300/80 dark:hover:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  '/job-profiles/kamus': {
    icon: BookOpen,
    active:
      'bg-amber-500/14 text-amber-800 ring-1 ring-amber-500/35 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30',
    idle: 'text-amber-700/80 hover:bg-amber-500/8 hover:text-amber-800 dark:text-amber-300/80 dark:hover:text-amber-200',
    dot: 'bg-amber-500',
  },
  '/posisi/job-family': {
    icon: FolderTree,
    active:
      'bg-rose-500/12 text-rose-800 ring-1 ring-rose-500/30 dark:bg-rose-400/15 dark:text-rose-200 dark:ring-rose-400/30',
    idle: 'text-rose-700/80 hover:bg-rose-500/8 hover:text-rose-800 dark:text-rose-300/80 dark:hover:text-rose-200',
    dot: 'bg-rose-500',
  },
};

const FALLBACK_STYLE = {
  icon: FileText,
  active: 'bg-background text-foreground ring-1 ring-border/60 shadow-sm',
  idle: 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
  dot: 'bg-muted-foreground',
};

/**
 * Header + section strip for a hub menu (Dokumen, Posisi). Rendered by the hub
 * layout, so a server component cannot know the pathname — this is the one
 * client piece that reads it and picks the section's title and explanation
 * from the registry. Section pages render only their content underneath.
 * Sections marked `hidden` (sub-pages such as Pengaturan Job Family) own the
 * header but get no pill; their parent's pill stays lit. A hub with a single
 * visible section (Posisi, since Struktur Posisi was deleted) gets no strip at
 * all — one pill is a tab row with nothing to switch to.
 */
function HubChrome({ hub, label }: { hub: Hub; label: string }) {
  const pathname = usePathname();
  const active = activeHubSection(pathname, hub) ?? hub.sections[0];
  const visible = hub.sections.filter((section) => !section.hidden);

  return (
    <>
      <DashboardHeader title={active.title} info={active.description} />
      {visible.length > 1 && (
      <div className="relative z-10 shrink-0 border-b border-border/60 bg-background/70 px-6 py-2 backdrop-blur-xl">
        <nav
          aria-label={label}
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-slate-100/80 p-1 dark:bg-slate-950/40"
        >
          {visible.map((section) => {
              const isActive = isHubSectionActive(section, pathname, hub);
              const style = SECTION_STYLE[section.href] ?? FALLBACK_STYLE;
              const Icon = style.icon;
              return (
                <Link
                  key={section.href}
                  href={section.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors',
                    isActive ? style.active : style.idle,
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {section.label}
                  {isActive && (
                    <span aria-hidden className={cn('ml-0.5 h-1.5 w-1.5 rounded-full', style.dot)} />
                  )}
                </Link>
              );
            })}
        </nav>
      </div>
      )}
    </>
  );
}

/** Dokumen menu: Dokumen Job Profile · Job Profile Match · Kamus Kompetensi. */
export function JobProfilesHubChrome() {
  return <HubChrome hub={JOB_PROFILES_HUB} label="Seksi Dokumen" />;
}

/** Posisi menu: the Job Family map (and its hidden settings page) — header only, no strip. */
export function PositionHubChrome() {
  return <HubChrome hub={POSITION_HUB} label="Seksi Posisi" />;
}
