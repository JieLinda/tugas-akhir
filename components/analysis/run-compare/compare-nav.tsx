'use client';

// "Bandingkan …" anywhere on the position page opens the "Komparasi Versi"
// tab in place: the run history's Silsilah ticks and shortcuts, the derived-run
// banner, the Selisih Peringkat panel. The page provides `openComparison`; a
// CompareLink is still a real link to the same place (compareHref), so opening
// it in a new tab, copying it, or rendering it outside the page all work — only
// a plain click is turned into the in-page switch.

import { createContext, useContext, type ComponentProps } from 'react';
import Link from 'next/link';
import { compareHref } from '@/lib/run-history';

type RunCompareNav = { openComparison: (aRunId: string, bRunId: string) => void };

const RunCompareNavContext = createContext<RunCompareNav | null>(null);

export const RunCompareNavProvider = RunCompareNavContext.Provider;

export function useRunCompareNav(): RunCompareNav | null {
  return useContext(RunCompareNavContext);
}

export function CompareLink({
  positionId,
  a,
  b,
  onClick,
  ...rest
}: Omit<ComponentProps<typeof Link>, 'href'> & { positionId: string; a: string; b: string }) {
  const nav = useRunCompareNav();
  return (
    <Link
      {...rest}
      href={compareHref(positionId, a, b)}
      onClick={(e) => {
        onClick?.(e);
        if (!nav || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        nav.openComparison(a, b);
      }}
    />
  );
}
