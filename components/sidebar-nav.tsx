'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  Briefcase,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  PlayCircle,
  RefreshCw,
  FileText,
  UserCog,
  Trophy,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TenantSwitcher } from '@/components/tenant-switcher';
import type { TenantOption } from '@/lib/tenant-shared';
import { useState } from 'react';
import { ScrollArea } from './ui/scroll-area';
import {
  SIDEBAR_GROUPS,
  SCORING_CTA,
  TALENT_POOL_CTA,
  isNavItemActive,
  type NavItem,
} from '@/lib/navigation';

// Menu structure (groups, labels, hrefs, permissions) lives in lib/navigation.ts
// so the sidebar, page headers and the activity-thread labels read one source.
// Icons stay here: the registry must remain a plain data module that server
// code can import, and lucide components are the one thing it would drag in.
// Keyed by href; a registry item with no entry falls back to FileText so a new
// menu can never render without an icon.
const NAV_ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/positions': Briefcase,
  '/candidates': Users,
  '/job-profiles': FileText,
  '/posisi': Network,
  '/governance': Settings,
  '/settings/sync': RefreshCw,
  '/settings/users': UserCog,
};

export function SidebarNav({
  tenantSlug,
  tenants,
  permissions = [],
}: {
  tenantSlug: string;
  /** Live companies for the header dropdown (lib/tenant.ts: listTenants). */
  tenants: TenantOption[];
  /** Current user's RBAC permissions — nav items outside them are hidden. */
  permissions?: string[];
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const allowed = new Set(permissions);
  const canSee = (item: NavItem) => item.permission === null || allowed.has(item.permission);
  const canScore = canSee(SCORING_CTA);
  const canSeeTalentPool = canSee(TALENT_POOL_CTA);
  const talentPoolActive = isNavItemActive(TALENT_POOL_CTA, pathname);
  const visibleGroups = SIDEBAR_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(canSee),
  })).filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        'relative z-30 flex flex-col border-r border-sidebar-border/70 bg-sidebar/92 text-sidebar-foreground shadow-[12px_0_34px_-28px_rgba(15,23,42,0.7)] backdrop-blur-xl transition-all duration-300',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo. Fixed h-18 with no vertical padding clipped the two-line brand
          block — the subtitle wraps at this width. Taller + py gives it room. */}
      <div
        className={cn(
          'flex h-20 shrink-0 items-center border-b border-sidebar-border/70',
          collapsed ? 'justify-center px-2' : 'px-4 py-3',
        )}
      >
        <Link href="/" className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_12px_24px_-12px_rgba(234,88,12,0.8)]">
            <Zap className="h-4 w-4" />
          </div>
          {!collapsed && (
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm font-semibold leading-none tracking-tight">PULSE</p>
              <p className="text-[11px] leading-snug text-sidebar-foreground/70">
                Leadership &amp; Successor Excellence
              </p>
            </div>
          )}
        </Link>
      </div>

      {/* Tenant switcher */}
      {!collapsed && (
        <div className="shrink-0 border-b border-sidebar-border/70 px-2.5 py-2.5">
          <TenantSwitcher
            currentSlug={tenantSlug}
            tenants={tenants}
            canManage={allowed.has('sync.manage')}
          />
        </div>
      )}

      {/* Highlighted block: the two entry points that carry the daily workflow.
          Mulai Scoring is the primary ACTION; Talent Pool is a destination, so
          it gets equal prominence but a distinct tone — two identical primary
          fills would compete, and only one of them starts anything. Talent Pool
          also carries an active state (a destination can be the current page,
          which is never true of the scoring CTA). */}
      {(canScore || canSeeTalentPool) && (
      <div className={cn('shrink-0 space-y-2 border-b border-sidebar-border/70 p-2.5', collapsed && 'px-1.5')}>
        {canScore && (collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={SCORING_CTA.href}
                className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform hover:scale-[1.02]"
                aria-label={SCORING_CTA.label}
              >
                <PlayCircle className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{SCORING_CTA.label}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href={SCORING_CTA.href}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground  transition-transform hover:scale-[1.01]"
          >
            <PlayCircle className="h-4 w-4" />
            <span>{SCORING_CTA.label}</span>
          </Link>
        ))}

        {canSeeTalentPool && (collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={TALENT_POOL_CTA.href}
                aria-label={TALENT_POOL_CTA.label}
                aria-current={talentPoolActive ? 'page' : undefined}
                className={cn(
                  'flex h-10 w-full items-center justify-center rounded-lg border transition-transform hover:scale-[1.02]',
                  talentPoolActive
                    ? 'border-emerald-400 bg-emerald-500 text-white'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                )}
              >
                <Trophy className="h-5 w-5" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{TALENT_POOL_CTA.label}</TooltipContent>
          </Tooltip>
        ) : (
          <Link
            href={TALENT_POOL_CTA.href}
            aria-current={talentPoolActive ? 'page' : undefined}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-semibold transition-transform hover:scale-[1.01]',
              talentPoolActive
                ? 'border-emerald-400 bg-emerald-500 text-white'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300',
            )}
          >
            <Trophy className="h-4 w-4" />
            <span>{TALENT_POOL_CTA.label}</span>
          </Link>
        ))}
      </div>
      )}

      {/* Nav items.
          ScrollArea must be the flex child that carries `flex-1 min-h-0`: its
          Root is only `relative` and the viewport is `size-full`, so without a
          bounded height it resolves to auto and never overflows — which is why
          wrapping it in a flex-1 <nav> produced no scrollbar. `min-h-0` is the
          other half: flex items default to min-height:auto and refuse to shrink
          below their content. */}
      <ScrollArea className="min-h-0 flex-1">
        <nav className="space-y-4 p-2.5">
          {visibleGroups.map((group) => (
            <div key={group.id} className="space-y-1.5">
              {!collapsed && (
                <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = isNavItemActive(item, pathname);
                  const Icon = NAV_ICONS[item.href] ?? FileText;

                  const linkContent = (
                    <Link
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border-transparent px-3 py-2.5 text-sm font-semibold transition-all',
                        isActive
                          ? 'border-primary bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_12px_24px_-18px_rgba(15,23,42,0.55)]'
                          : 'text-sidebar-foreground/68 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <Tooltip key={item.href}>
                        <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    );
                  }

                  return <div key={item.href}>{linkContent}</div>;
                })}
              </div>
            </div>
          ))}
        </nav>
      </ScrollArea>

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-sidebar-border/70 p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>
    </aside>
  );
}
