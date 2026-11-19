// App mode — "asli" (real, the default) or "demo". Client-safe constants and
// masking primitives shared by proxy.ts, the server helpers (lib/app-mode.ts),
// client components and exports, so every surface masks the same way.
//
// The mode is deliberately invisible: there is no toggle and no indicator
// anywhere in the UI. It is switched by a keyword on ANY page URL —
// `?mode=demo` / `?mode=asli` — which proxy.ts turns into a session cookie and
// strips from the address bar.

// A deployment can make demo the default (PULSE_DEFAULT_MODE=demo) and can
// lock it (PULSE_MODE_LOCKED=1) — see deploymentModeConfig below.

export type AppMode = 'real' | 'demo';

/**
 * Session cookie carrying the mode a browser switched to; absent means the
 * deployment's default (real/"asli" unless PULSE_DEFAULT_MODE says otherwise).
 * Values: 'demo' | 'real'. 'real' is only ever set on a demo-default
 * deployment, where "back to asli" cannot be expressed by deleting the cookie.
 */
export const APP_MODE_COOKIE = 'pulse_mode';
/** URL keyword that switches it, on any page. */
export const APP_MODE_PARAM = 'mode';

/**
 * Keyword value → mode. `demo` turns demo on; `asli` (or `real`/`normal`)
 * turns it off. Anything else is not a mode switch and is left alone.
 */
export function parseModeKeyword(value: string | null | undefined): AppMode | null {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'demo') return 'demo';
  if (v === 'asli' || v === 'real' || v === 'normal') return 'real';
  return null;
}

/**
 * Cookie value → mode. Only the exact values count; anything else (absent,
 * tampered, a stale casing) means the deployment default.
 */
export function appModeFromCookie(value: string | null | undefined, fallback: AppMode = 'real'): AppMode {
  if (value === 'demo') return 'demo';
  if (value === 'real') return 'real';
  return fallback;
}

/**
 * How THIS deployment treats the mode, from two runtime env vars (read on the
 * server and in proxy.ts — never in the browser):
 *
 *   PULSE_DEFAULT_MODE = demo | asli   mode for a browser that has not switched
 *                                      (default: asli). Accepts the same words
 *                                      as the URL keyword.
 *   PULSE_MODE_LOCKED  = 1 | true      ignore `?mode=` entirely: every browser
 *                                      is in the default mode, always. Without
 *                                      it, `?mode=asli` still reaches real mode
 *                                      on a demo-default deployment.
 *
 * Runtime, not build time (no NEXT_PUBLIC_ prefix), so one image serves both a
 * demo and a real deployment.
 */
export interface DeploymentModeConfig {
  defaultMode: AppMode;
  locked: boolean;
}

export function deploymentModeConfig(
  env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {},
): DeploymentModeConfig {
  const defaultMode = parseModeKeyword(env.PULSE_DEFAULT_MODE) ?? 'real';
  const locked = /^(1|true|yes|on)$/i.test((env.PULSE_MODE_LOCKED ?? '').trim());
  return { defaultMode, locked };
}

/**
 * The single rule both proxy.ts and the server read the mode by: a locked
 * deployment is always its default; otherwise the browser's switch, if any,
 * else the default.
 */
export function resolveAppMode(cookieValue: string | null | undefined, config: DeploymentModeConfig): AppMode {
  if (config.locked) return config.defaultMode;
  return appModeFromCookie(cookieValue, config.defaultMode);
}

// ── Masking (demo mode) ─────────────────────────────────────────────────
// Fixed-width marks, not length-preserving and not partial: a partial NPK
// ("00•••") or a code's length still narrows down who or what it is.
export const MASKED_NPK = '•••••';
export const MASKED_CODE = '•••';

/** An NPK / employee id as displayed in demo mode. Empty stays empty. */
export function maskNpk(value: string | number | null | undefined): string {
  return value == null || String(value).trim() === '' ? '' : MASKED_NPK;
}

/** A position or competency code as displayed in demo mode. Empty stays empty. */
export function maskCode(value: string | number | null | undefined): string {
  return value == null || String(value).trim() === '' ? '' : MASKED_CODE;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Mask every occurrence of the given identifiers inside free text (labels,
 * file names, narratives). Longest first so a code that contains another is
 * replaced whole. Numeric NPKs also match their zero-padded / unpadded forms,
 * because the app writes both ("370" and "00370" are one person).
 */
export function maskIdentifiersInText(
  text: string,
  identifiers: { npks?: Iterable<string | null | undefined>; codes?: Iterable<string | null | undefined> },
): string {
  if (!text) return text;
  const pairs: [string, string][] = [];
  for (const raw of identifiers.npks ?? []) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    pairs.push([v, MASKED_NPK]);
    if (/^\d+$/.test(v)) {
      const unpadded = v.replace(/^0+(?=\d)/, '');
      pairs.push([unpadded, MASKED_NPK]);
      if (unpadded.length < 5) pairs.push([unpadded.padStart(5, '0'), MASKED_NPK]);
    }
  }
  for (const raw of identifiers.codes ?? []) {
    const v = (raw ?? '').trim();
    if (v.length >= 2) pairs.push([v, MASKED_CODE]);
  }
  if (pairs.length === 0) return text;
  const unique = Array.from(new Map(pairs.map(([k, m]) => [k, m])).entries()).sort((a, b) => b[0].length - a[0].length);
  const byKey = new Map(unique);
  // Whole-token match: an NPK "370" must not eat the digits of "13702" or a year.
  const pattern = new RegExp(`(?<![A-Za-z0-9])(${unique.map(([k]) => escapeRegExp(k)).join('|')})(?![A-Za-z0-9])`, 'g');
  return text.replace(pattern, (m) => byKey.get(m) ?? m);
}
