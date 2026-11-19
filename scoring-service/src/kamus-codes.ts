// Competency name → kamus code, for the AHP+TOPSIS competency matching.
//
// The kamus CODE is the identity a competency is matched by. A name that
// resolves to a code gets its level vectors and can pair exactly with any other
// name resolving to the same code; a name that resolves to nothing can only ever
// pair by literal string, and its column has no vector at all.
//
// Two sources, merged:
//
//   1. `sync_kamus_kompetensi` — the exact tier. A name identical to a kamus
//      name resolves for free, and this is recomputed every run so a kamus
//      re-sync takes effect immediately.
//   2. `kamus_competency_match_cache` — the non-exact tiers, decided by the WEB
//      APP (lib/kamus-name-match.ts) and merely read here. Resolution's last
//      tier needs an LLM, and scoring must stay runnable with no model
//      reachable: the orphan sweeper restarts sessions with nobody watching.
//      A row with code NULL is a real decision ("no kamus entry means this")
//      and is skipped here, since skipping and mapping-to-null are the same
//      thing for a lookup.
//
// A missing cache row is not an error. It degrades to the exact-only behaviour
// that existed before the resolver, which is why priming can be best-effort.

import { query } from "./db/postgres.js";

/** Canonical competency name for matching. MUST stay identical to
 *  `normalizeCompName` in lib/kamus-name-match.ts — it is the cache key. */
export function normalizeKamusName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type KamusCodeMap = {
  /** normalized name → kamus code. */
  byName: Map<string, string>;
  /** How many names the cache contributed beyond the exact tier. */
  resolvedByCache: number;
};

export async function loadKamusNameToCode(): Promise<KamusCodeMap> {
  const byName = new Map<string, string>();

  const kamus = await query<{ code: string; name: string }>(
    `SELECT code, name FROM sync_kamus_kompetensi
     WHERE code IS NOT NULL AND name IS NOT NULL`
  ).catch(() => [] as { code: string; name: string }[]);
  for (const r of kamus) {
    const key = normalizeKamusName(r.name);
    if (key && !byName.has(key)) byName.set(key, r.code);
  }

  const cached = await query<{ name_key: string; code: string | null }>(
    `SELECT name_key, code FROM kamus_competency_match_cache WHERE code IS NOT NULL`
  ).catch(() => [] as { name_key: string; code: string | null }[]);

  let resolvedByCache = 0;
  for (const r of cached) {
    if (!r.code || !r.name_key) continue;
    // An exact kamus name always wins over a cached decision about it — the
    // cache should not hold such a row at all, and if one is left over from an
    // older kamus it must not shadow the dictionary itself.
    if (byName.has(r.name_key)) continue;
    byName.set(r.name_key, r.code);
    resolvedByCache++;
  }

  return { byName, resolvedByCache };
}
