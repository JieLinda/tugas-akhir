import 'server-only';

import { cookies } from 'next/headers';
import { APP_MODE_COOKIE, deploymentModeConfig, resolveAppMode, type AppMode } from './app-mode-shared';

export type { AppMode } from './app-mode-shared';

/**
 * The current app mode: the session cookie proxy.ts sets from the `?mode=`
 * keyword, else this deployment's default (PULSE_DEFAULT_MODE, "asli" unless
 * set), and always the default when PULSE_MODE_LOCKED is on.
 *
 * Outside a request (scripts, cron) there are no cookies and the answer is
 * "real" whatever the deployment default — demo mode only ever exists for a
 * browser, and a script must never silently read demo copies or write
 * `is_demo` rows because of how the web container was configured.
 */
export async function getAppMode(): Promise<AppMode> {
  let cookieValue: string | undefined;
  try {
    const store = await cookies();
    cookieValue = store.get(APP_MODE_COOKIE)?.value;
  } catch {
    return 'real';
  }
  return resolveAppMode(cookieValue, deploymentModeConfig());
}

export async function isDemoMode(): Promise<boolean> {
  return (await getAppMode()) === 'demo';
}
