// The app mode as PURE client-side helpers see it — text builders and file
// exporters that run inside event handlers and so cannot call a hook
// (`useIdentifierDisplay` in components/app-mode-provider.tsx is the hook).
//
// AppModeProvider sets it while rendering in the browser. It is never set on
// the server: a module-level value there would be shared by every request, so
// server code reads the mode from the request instead (lib/app-mode.ts) and
// always sees 'real' here.

import { maskCode, maskNpk, type AppMode } from '@/lib/app-mode-shared';

let clientMode: AppMode = 'real';

export function setClientAppMode(mode: AppMode): void {
  if (typeof window !== 'undefined') clientMode = mode;
}

/** Display helpers for the current page's mode: identity in real mode, masked in demo mode. */
export function clientIdentifierDisplay() {
  const demo = clientMode === 'demo';
  return {
    demo,
    npk: (value: string | number | null | undefined) => (demo ? maskNpk(value) : value == null ? '' : String(value)),
    code: (value: string | number | null | undefined) => (demo ? maskCode(value) : value == null ? '' : String(value)),
  };
}
