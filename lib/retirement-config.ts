import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * When an incumbent counts as "retiring soon", per job level.
 *
 * A succession plan is only urgent relative to how long the person in the seat
 * will still be in it, and that horizon is not the same at every level: a
 * Manager at 51 is a different planning problem from a General Manager at 51,
 * because the levels retire on different schedules.
 *
 * Editable in governance (Tata Kelola → Readiness) rather than hardcoded — the
 * numbers below are MPM's current defaults, not a law of nature, and the one
 * thing certain about a retirement age is that HR changes it.
 *
 * Read with `readFileSync` on purpose, like `lib/readiness-config.json`: an
 * import would be inlined at build time and an edit would need a redeploy.
 */
export type RetirementConfig = {
  /** Level name (as stored in sync_grade_levels, uppercase) → minimum age. */
  byLevel: Record<string, number>;
  /** Applied to a level the map does not mention. */
  defaultMinAge: number;
};

export const DEFAULT_RETIREMENT_CONFIG: RetirementConfig = {
  byLevel: {
    STAFF: 50,
    SUPERVISOR: 50,
    MANAGER: 50,
    'GENERAL MANAGER': 55,
    DIRECTOR: 55,
    'PRESIDENT DIRECTOR': 55,
  },
  defaultMinAge: 55,
};

export const RETIREMENT_CONFIG_PATH = join(process.cwd(), 'lib', 'retirement-config.json');

function normalizeConfig(raw: unknown): RetirementConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_RETIREMENT_CONFIG;
  const obj = raw as Partial<RetirementConfig>;
  const byLevel: Record<string, number> = {};
  for (const [level, age] of Object.entries(obj.byLevel ?? {})) {
    const n = Number(age);
    if (level.trim() && Number.isFinite(n) && n > 0 && n < 120) byLevel[level.trim().toUpperCase()] = Math.round(n);
  }
  const fallback = Number(obj.defaultMinAge);
  return {
    byLevel: Object.keys(byLevel).length > 0 ? byLevel : DEFAULT_RETIREMENT_CONFIG.byLevel,
    defaultMinAge:
      Number.isFinite(fallback) && fallback > 0 && fallback < 120
        ? Math.round(fallback)
        : DEFAULT_RETIREMENT_CONFIG.defaultMinAge,
  };
}

/** Synchronous read for the render path; falls back to the defaults above. */
export function readRetirementConfig(): RetirementConfig {
  try {
    return normalizeConfig(JSON.parse(readFileSync(RETIREMENT_CONFIG_PATH, 'utf-8')));
  } catch {
    return DEFAULT_RETIREMENT_CONFIG;
  }
}

export { normalizeConfig as normalizeRetirementConfig };

/** Minimum age at which a holder of this level counts as retiring soon. */
export function retirementMinAgeFor(
  levelName: string | null | undefined,
  config: RetirementConfig,
): number {
  if (!levelName) return config.defaultMinAge;
  return config.byLevel[levelName.trim().toUpperCase()] ?? config.defaultMinAge;
}

/**
 * True when this incumbent is at or past their level's threshold.
 *
 * `null` age (no birth date synced yet) is NOT "retiring soon" — an unknown is
 * not a finding, and flagging it would put an amber badge on half the org for a
 * reason that has nothing to do with anybody's age.
 */
export function isRetiringSoon(
  age: number | null | undefined,
  levelName: string | null | undefined,
  config: RetirementConfig,
): boolean {
  if (age == null) return false;
  return age >= retirementMinAgeFor(levelName, config);
}
