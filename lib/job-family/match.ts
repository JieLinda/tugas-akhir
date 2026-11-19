// Position-title ↔ job-profile matcher. Deterministic tier:
//   • exact normalized-title match
// Substring matching was intentionally removed (too loose). Fuzzy matching is
// handled separately by the embedding tier in the Sync report.

export type ProfileLite = {
  id: number;
  positionName: string;
  divisionDepartment?: string | null;
  /**
   * REQUIRED, not optional. The alias tier reads this and silently produces an
   * empty index when it is absent — a whole matching tier that looks wired up,
   * type-checks, and matches nothing. Making it required means a caller that
   * cannot supply one has to say so with an explicit `null`.
   */
  fileName: string | null;
};

export type MatchResult = {
  profile: ProfileLite;
  /**
   * 'exact'      — the position title equals the profile's extracted position_name.
   * 'file-alias' — it equals the TITLE WRITTEN IN THE PDF's FILE NAME instead.
   */
  matchType: 'exact' | 'file-alias';
};

/** Same normalization as findJobProfileForPosition: lowercase, collapse spaces. */
export function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Normalize a position/JD code for equality: uppercase, strip all whitespace. */
export function normalizeCode(value: string): string {
  return (value ?? '').toUpperCase().replace(/\s+/g, '').trim();
}

/**
 * Parse a sync_job_profiles.file_name of the shape
 *   "ACF0013001 JD-ACF-020 Operation Control Officer.pdf"
 * into its parts:
 *   code  → leading position code ("ACF0013001")  — matches a position_id
 *   jdNumber → the "JD-..." token if present       ("JD-ACF-020")
 *   title → the remaining words                    ("Operation Control Officer")
 * Any part is null when absent.
 */
export function parseJobProfileFileName(fileName: string): {
  code: string | null;
  jdNumber: string | null;
  title: string | null;
} {
  let base = (fileName ?? '').replace(/\.[^./\\]+$/, '').trim(); // drop extension
  if (!base) return { code: null, jdNumber: null, title: null };
  // "(Rev. 2)" / "(Rev.2)" is document versioning, not part of the job title —
  // leaving it in means the alias never equals any position title.
  base = base.replace(/\s*\(\s*rev\.?\s*\d+\s*\)\s*$/i, '').trim();
  const tokens = base.split(/\s+/);
  const code = tokens[0] ?? null;
  let idx = 1;
  let jdNumber: string | null = null;
  if (tokens[1] && /^JD-/i.test(tokens[1])) {
    jdNumber = tokens[1];
    idx = 2;
  } else if (/^JD$/i.test(tokens[1] ?? '') && /^-/.test(tokens[2] ?? '')) {
    // "JD -MSD-022" — one file in this corpus puts a space after JD, which used
    // to leave "-MSD-022" glued to the front of the title.
    jdNumber = `${tokens[1]}${tokens[2]}`;
    idx = 3;
  }
  const title = tokens.slice(idx).join(' ').trim() || null;
  return { code, jdNumber, title };
}

/**
 * Build a reusable matcher over a fixed set of profiles. Returns a function that
 * maps a position title to its best deterministic profile match (or null).
 */
export function buildDeterministicMatcher(
  profiles: ProfileLite[],
): (title: string) => MatchResult | null {
  const normed = profiles
    .filter((p) => p.positionName && p.positionName.trim().length > 0)
    .map((p) => ({ p, norm: normalizeTitle(p.positionName) }));

  // First-wins exact index (stable given the profiles' order).
  const exactMap = new Map<string, ProfileLite>();
  for (const { p, norm } of normed) {
    if (!exactMap.has(norm)) exactMap.set(norm, p);
  }

  // ── File-name alias index ────────────────────────────────────
  //
  // The title inside a PDF and the title in its FILE NAME routinely disagree,
  // and the file name is often the one naming the seat the document is FOR.
  // Three files here share one extracted `position_name` ("System Integrator
  // Analyst") while their names say System Integrator Analyst, System
  // Integrator Junior Analyst and Main Dealer Management System Business
  // Analyst — so two of those three seats could never match on content alone.
  // Measured on this corpus: 64 of 256 parsed file names carry a title that
  // differs from the extracted one.
  //
  // Two rules keep this from inventing matches:
  //
  //  1. An alias claimed by MORE THAN ONE profile is dropped entirely (15 here,
  //     e.g. "cashier"). A wrong JD is worse than no JD — it silently moves a
  //     candidate's technical and career aspect scores during AHP+TOPSIS, where
  //     nobody would look for the cause — so an ambiguous alias must fall
  //     through to the embedding/AI tiers that can weigh context, not guess.
  //  2. The alias index is consulted only AFTER the exact index, so nothing that
  //     matches today changes its answer.
  const aliasCount = new Map<string, number>();
  const aliasFirst = new Map<string, ProfileLite>();
  for (const p of profiles) {
    if (!p.fileName) continue;
    const alias = parseJobProfileFileName(p.fileName).title;
    if (!alias) continue;
    const norm = normalizeTitle(alias);
    if (!norm) continue;
    aliasCount.set(norm, (aliasCount.get(norm) ?? 0) + 1);
    if (!aliasFirst.has(norm)) aliasFirst.set(norm, p);
  }
  const aliasMap = new Map<string, ProfileLite>();
  for (const [norm, count] of aliasCount) {
    if (count !== 1) continue; // ambiguous — see rule 1
    aliasMap.set(norm, aliasFirst.get(norm)!);
  }

  return (title: string): MatchResult | null => {
    const target = normalizeTitle(title ?? '');
    if (!target) return null;
    const exact = exactMap.get(target);
    if (exact) return { profile: exact, matchType: 'exact' };
    const alias = aliasMap.get(target);
    return alias ? { profile: alias, matchType: 'file-alias' } : null;
  };
}
