// Resolve a config file that the WEB APP owns and this service only reads
// (lib/scoring-prompts.json, lib/readiness-config.json).
//
// The two deployments lay the repo out differently:
//   • repo checkout — scoring-service/src/… → ../../lib/<file>
//   • docker image  — the build context is ./scoring-service, so the repo root
//     is NOT in the image. Those files are bind-mounted to /app/lib/<file>
//     (see docker-compose.yml), which the old ../../lib path missed entirely,
//     silently falling back to the hardcoded prompts forever.
//
// So: try an explicit env override first, then every layout we know about.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * First existing candidate path for `lib/<fileName>`, or null when the file is
 * absent everywhere (callers fall back to their built-in defaults).
 *
 * @param envOverride absolute path from an env var, checked before the defaults.
 */
export function resolveSharedConfigPath(
  fileName: string,
  envOverride?: string | null,
): string | null {
  const candidates = [
    envOverride?.trim() || null,
    // Docker: repo `lib/` mounted next to the service's WORKDIR (/app/lib).
    join(__dirname, "..", "lib", fileName),
    // Repo checkout: scoring-service/src → repo root.
    join(__dirname, "..", "..", "lib", fileName),
    // Fallback: process cwd (e.g. started from the repo root).
    join(process.cwd(), "lib", fileName),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    try {
      if (existsSync(path)) return path;
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  return null;
}
