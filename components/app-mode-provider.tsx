'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { maskCode, maskNpk, type AppMode } from '@/lib/app-mode-shared';
import { setClientAppMode } from '@/lib/app-mode-client';

// The mode as client components see it: provided once by the dashboard layout
// from the session cookie (lib/app-mode.ts). Renders nothing itself — demo mode
// has no indicator by design.

const AppModeContext = createContext<AppMode>('real');

export function AppModeProvider({ mode, children }: { mode: AppMode; children: ReactNode }) {
  // Pure helpers (exporters, copy-text builders) read the mode from here; set
  // during render so it is in place before any handler can run. Browser only.
  setClientAppMode(mode);
  return <AppModeContext.Provider value={mode}>{children}</AppModeContext.Provider>;
}

export function useAppMode(): AppMode {
  return useContext(AppModeContext);
}

export function useIsDemoMode(): boolean {
  return useContext(AppModeContext) === 'demo';
}

/**
 * Display helpers bound to the current mode: identity in real mode, masked in
 * demo mode. Components call these where they print an NPK or a code.
 */
export function useIdentifierDisplay() {
  const demo = useIsDemoMode();
  return {
    demo,
    npk: (value: string | number | null | undefined) => (demo ? maskNpk(value) : value == null ? '' : String(value)),
    code: (value: string | number | null | undefined) => (demo ? maskCode(value) : value == null ? '' : String(value)),
  };
}
