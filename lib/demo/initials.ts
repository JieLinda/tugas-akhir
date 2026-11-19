/**
 * Demo mode — unique initials for candidate names.
 *
 * The rule HR stated, in order:
 *   1. take the first LETTER of every word of the name ("Budi Santoso" → BS);
 *   2. no two candidates may end up with the same initials, so a later
 *      candidate whose initials exactly match an earlier one's takes the SECOND
 *      letter of their last word as their last initial ("Bambang Sutrisno" → BU).
 * The rule stops at the second letter; the same step is simply continued —
 * third letter, fourth, … — and when every letter of the last word is already
 * taken the plain initials are numbered (BS2, BS3 …). Without that tail the
 * guarantee "never the same initials twice" would not hold for a third
 * "B… S…" candidate.
 *
 * "Earlier" is decided by the caller's order. lib/demo-names.ts passes every
 * candidate of every business unit — live and tombstoned — oldest first
 * (created_at, then id), so a new candidate never changes the initials of
 * anybody already shown, and a ranking that mixes business units can still
 * not show one pair of initials twice.
 *
 * Pure: no database, no environment, so it is pinned by
 * tests/demo-mode/initials.test.ts.
 */

export type InitialsInput = {
  /** Stable identity (the candidate id). Duplicate keys keep their first answer. */
  key: string;
  name: string | null | undefined;
};

const LETTER = /\p{L}/u;

/**
 * The words of a name as arrays of uppercase letters.
 *
 * Academic degrees follow a comma in Indonesian names ("Budi Santoso, S.Kom.")
 * and are not part of the name, so everything after the first comma is ignored.
 * Characters that are not letters (".", "'", "-", digits) are not initials: "M.
 * Rizki" is M R, "Ma'ruf" is one word.
 */
export function nameLetterWords(name: string | null | undefined): string[][] {
  if (!name) return [];
  const core = name.split(',')[0] ?? '';
  return core
    .normalize('NFC')
    .split(/\s+/)
    .map((word) =>
      Array.from(word)
        .filter((ch) => LETTER.test(ch))
        .map((ch) => ch.toLocaleUpperCase('id-ID')),
    )
    .filter((letters) => letters.length > 0);
}

/** Plain initials: the first letter of every word. Empty when the name has no letters. */
export function plainInitials(name: string | null | undefined): string {
  return nameLetterWords(name)
    .map((letters) => letters[0])
    .join('');
}

/** The initials `name` gets given the set already handed out. */
export function nextUniqueInitials(name: string | null | undefined, used: ReadonlySet<string>): string | null {
  const parts = nameLetterWords(name);
  if (parts.length === 0) return null;
  const head = parts
    .slice(0, -1)
    .map((letters) => letters[0])
    .join('');
  const last = parts[parts.length - 1]!;
  // Letter 1 is the plain initials; letter 2 is HR's rule; 3.. continue it.
  for (const letter of last) {
    const candidate = head + letter;
    if (!used.has(candidate)) return candidate;
  }
  const plain = head + last[0];
  for (let n = 2; ; n++) {
    const candidate = `${plain}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Initials for every entry, unique across the whole list, decided in list
 * order. Entries whose name has no letters get none (there is nothing to hide).
 */
export function assignUniqueInitials(entries: Iterable<InitialsInput>): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const { key, name } of entries) {
    if (out.has(key)) continue;
    const initials = nextUniqueInitials(name, used);
    if (!initials) continue;
    used.add(initials);
    out.set(key, initials);
  }
  return out;
}
