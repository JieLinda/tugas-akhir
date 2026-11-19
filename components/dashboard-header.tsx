'use client';

import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { Separator } from '@/components/ui/separator';
import { InfoHint } from '@/components/ui/info-hint';

interface DashboardHeaderProps {
  title: string;
  /**
   * What the page is FOR. Rendered behind a "?" beside the title, never as a
   * paragraph: it was read once and then pushed every page down on every visit
   * after.
   */
  info?: React.ReactNode;
  /**
   * A short factual subtitle that is part of what the page shows — the
   * department of the person on a profile, the program a position belongs to.
   * Not an explanation; explanations go in `info`.
   */
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function DashboardHeader({ title, info, description, actions }: DashboardHeaderProps) {
  const authEnabled = process.env.NEXT_PUBLIC_DISABLE_AUTH === 'false';

  // `shrink-0` is load-bearing: every page renders this header as a child of a
  // `flex flex-col` wrapper, so without it the header is a shrinkable flex item
  // and a wrapped subtitle overflows straight past the bottom border.
  //
  // items-start, not items-center: once the left block is taller than the
  // actions, centring pushes it out of the padded box.
  return (
    <header className="relative z-20 flex min-h-16 shrink-0 flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-border/70 bg-background/88 px-6 py-3.5 shadow-[0_1px_0_rgba(15,23,42,0.03),0_18px_36px_-32px_rgba(15,23,42,0.45)] backdrop-blur-xl">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-[10px] font-bold uppercase leading-none tracking-[0.22em] text-primary/75">
            PULSE COMMAND CENTER
          </p>
          <h1 className="flex items-center gap-2 text-xl font-bold leading-tight tracking-tight text-foreground">
            <span className="min-w-0 break-words">{title}</span>
            {info ? (
              <InfoHint title={title} size="md" align="start">
                {info}
              </InfoHint>
            ) : null}
          </h1>
          {description && (
            <div className="max-w-5xl text-sm leading-snug text-muted-foreground">{description}</div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-center">
        {actions}
        <ThemeToggle />
        {authEnabled && (
          <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <UserMenu />
          </>
        )}
      </div>
    </header>
  );
}
