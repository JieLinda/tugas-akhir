/**
 * Demo mode — replace candidate names with their initials inside any data.
 *
 * Applied to DATA, not to the screen: lib/demo-names.ts runs it on what a page,
 * a server action or an API route is about to send to the browser, so it does
 * not matter where a name came from — the candidates table, a ranking snapshot
 * written months ago, a live scoring session, a sentence the server built
 * ("X naik 2 tingkat"), a model's narrative — nor which component renders it,
 * nor whether that page's own "Data disamarkan" toggle is on or off. Nothing is
 * written back: the database keeps the real names.
 *
 * How a name is recognised, from most to least certain:
 *   1. BY ID — an object that is a candidate (`id` is a candidate id) or points
 *      at one (`candidateId` / `candidate_id`) has its name field replaced with
 *      THAT candidate's initials. This keeps namesakes ("Budi Santoso" twice)
 *      apart and still catches a snapshot holding a name from before a rename.
 *      The same object's `email` (usually the name itself) is masked and its
 *      `photoUrl` dropped — a face next to initials undoes the initials.
 *   2. EVERY MULTI-WORD NAME, anywhere — any string is matched against every
 *      candidate's name, case- and punctuation-insensitively, on whole words.
 *   3. SINGLE-WORD NAMES — a string that IS a one-word name is always replaced;
 *      inside prose a lone word is only replaced when it is the full name of a
 *      candidate THIS payload refers to by id, written with a capital. A global
 *      rule would rewrite ordinary words that happen to be somebody's name.
 *   4. NAME PARTS IN A CANDIDATE'S OWN ROW — inside a candidate-shaped object
 *      (its narrative, strengths, notes) every capitalised word of THAT
 *      candidate's name becomes their initials too, because a narrative about
 *      Budi Santoso says "Budi" far more often than the full name.
 *
 * Pure (no database, no environment) so tests/demo-mode/name-scrub.test.ts can
 * pin it.
 */

import { DEMO_MASK } from '@/lib/demo/text-mask';

export type DemoNameEntry = {
  id: string;
  /** The name in force — the initials are derived from it. */
  name: string;
  /**
   * Other names the same person goes by in stored data — in demo mode, the
   * real name of a candidate whose demo copy renamed them. Matched like the
   * name, to the same initials.
   */
  aliases?: readonly string[];
  initials: string;
};

export type DemoNameIndex = {
  /** candidate id → initials */
  byId: ReadonlyMap<string, string>;
  /** candidate id → every normalized word of their names (name in force and aliases) */
  wordsById: ReadonlyMap<string, readonly string[]>;
  /** candidate id → those of their names that are a single word (rule 3) */
  oneWordNamesById: ReadonlyMap<string, readonly string[]>;
  /**
   * normalized name → initials of the FIRST candidate carrying it. Matching by
   * name alone cannot tell namesakes apart; the id path above does.
   */
  byName: ReadonlyMap<string, string>;
  /** First normalized word of every multi-word name, to skip hopeless windows fast. */
  firstWords: ReadonlySet<string>;
  /** Longest name, in words — the widest window worth trying. */
  maxWords: number;
  /** Normalized strings never read as a name (business units). */
  stop: ReadonlySet<string>;
};

/** Keys that hold a person's name on a candidate-shaped object. */
const NAME_KEYS = new Set(['name', 'candidateName', 'candidate_name', 'fullName', 'full_name']);

/** Keys that point a row at a candidate. */
const CANDIDATE_ID_KEYS = ['candidateId', 'candidate_id'] as const;

/** Keys on a candidate-shaped object that identify the person without naming them. */
const EMAIL_KEYS = new Set(['email']);
const PHOTO_KEYS = new Set(['photoUrl', 'photo_url']);

/** A name part shorter than this is never matched on its own ("M.", "Ir", "H"). */
const MIN_PART_LETTERS = 3;

/**
 * Fields that describe a seat or an organisation, not a person. Single name
 * words (rules 3 and 4) are not applied inside them — a branch or a title can
 * share a word with somebody's name ("Cabang Sentosa") — while whole multi-word
 * names still are.
 */
const STRUCTURAL_KEYS = new Set([
  'currentPosition',
  'current_position',
  'position',
  'positionTitle',
  'positionName',
  'title',
  'internalTitle',
  'externalTitle',
  'department',
  'division',
  'jobFamily',
  'education',
  'major',
  'tenantName',
  'companyName',
]);

function normalizeWord(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}

/**
 * The form names are compared in: degrees after the first comma dropped, every
 * word reduced to its letters and digits, uppercased, single-spaced.
 * "Budi  Santoso, S.Kom." and "BUDI SANTOSO" are the same name here.
 */
export function normalizeName(name: string): string {
  const core = name.split(',')[0] ?? '';
  return core
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean)
    .join(' ');
}

/**
 * @param neverMatch strings that must never be read AS a name even when some
 *   candidate is called that — the business-unit names, above all: a candidate
 *   named "Mulia" must not turn every "Mulia" label into "M". Such a candidate
 *   is still replaced through the id path; only matching by text skips it.
 */
export function buildDemoNameIndex(
  entries: Iterable<DemoNameEntry>,
  options: { neverMatch?: Iterable<string> } = {},
): DemoNameIndex {
  const stop = new Set(Array.from(options.neverMatch ?? [], normalizeName).filter(Boolean));
  const byId = new Map<string, string>();
  const wordsById = new Map<string, string[]>();
  const oneWordNamesById = new Map<string, string[]>();
  const byName = new Map<string, string>();
  const firstWords = new Set<string>();
  let maxWords = 1;
  for (const { id, name, aliases, initials } of entries) {
    byId.set(id, initials);
    const words = new Set<string>();
    const oneWord = new Set<string>();
    for (const each of [name, ...(aliases ?? [])]) {
      const key = normalizeName(each);
      if (!key) continue;
      const parts = key.split(' ');
      for (const part of parts) words.add(part);
      if (parts.length === 1) oneWord.add(key);
      if (stop.has(key)) continue;
      if (!byName.has(key)) byName.set(key, initials);
      if (parts.length > 1) firstWords.add(parts[0]!);
      if (parts.length > maxWords) maxWords = parts.length;
    }
    if (words.size > 0) wordsById.set(id, Array.from(words));
    if (oneWord.size > 0) oneWordNamesById.set(id, Array.from(oneWord));
  }
  return { byId, wordsById, oneWordNamesById, byName, firstWords, maxWords, stop };
}

/**
 * Extra single words to replace inside one part of a payload (rules 3 and 4),
 * as a chain so a nested candidate's words override the enclosing scope's
 * without copying it for every row.
 */
type Scope = { words: ReadonlyMap<string, string>; parent: Scope | null };

function lookup(scope: Scope | null, word: string): string | undefined {
  for (let s = scope; s; s = s.parent) {
    const hit = s.words.get(word);
    if (hit) return hit;
  }
  return undefined;
}

type Token = {
  /** normalized core ('' for pure punctuation, which never matches a name) */
  core: string;
  /** offsets of the first and one-past-last letter/digit — punctuation around a name is kept */
  start: number;
  end: number;
  /** The token is written with a capital (Budi, BUDI) — required for single-word matches in prose. */
  capitalised: boolean;
};

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const UPPER = /\p{Lu}/u;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const raw = match[0];
    const offset = match.index ?? 0;
    const first = raw.search(LETTER_OR_DIGIT);
    if (first < 0) {
      tokens.push({ core: '', start: offset, end: offset + raw.length, capitalised: false });
      continue;
    }
    let last = raw.length - 1;
    while (last > first && !LETTER_OR_DIGIT.test(raw[last]!)) last--;
    tokens.push({
      core: normalizeWord(raw),
      start: offset + first,
      end: offset + last + 1,
      capitalised: UPPER.test(raw[first]!),
    });
  }
  return tokens;
}

/** Cheap pre-check: nothing shorter than two characters or without a letter can hold a name. */
function mayHoldName(text: string): boolean {
  return text.length >= 2 && /\p{L}/u.test(text);
}

function scrubText(text: string, index: DemoNameIndex, scope: Scope | null): string {
  if (!mayHoldName(text)) return text;
  if (index.byName.size === 0 && !scope) return text;
  const tokens = tokenize(text);
  if (tokens.length === 0) return text;

  // The whole string is one name — a one-word name is always replaced here.
  const cores = tokens.filter((t) => t.core);
  const whole = cores.map((t) => t.core).join(' ');
  const wholeHit = whole ? index.byName.get(whole) ?? (cores.length === 1 ? lookup(scope, whole) : undefined) : undefined;
  if (wholeHit) {
    return text.slice(0, cores[0]!.start) + wholeHit + text.slice(cores[cores.length - 1]!.end);
  }

  let out = '';
  let cursor = 0;
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i]!;
    let matched = 0;
    let initials: string | undefined;
    if (head.core && index.firstWords.has(head.core)) {
      // Longest name first, so "Budi Santoso Wijaya" wins over "Budi Santoso".
      for (let width = Math.min(index.maxWords, tokens.length - i); width >= 2; width--) {
        const window = tokens.slice(i, i + width);
        if (window.some((t) => !t.core)) continue;
        const hit = index.byName.get(window.map((t) => t.core).join(' '));
        if (hit) {
          matched = width;
          initials = hit;
          break;
        }
      }
    }
    if (!matched && head.core && head.capitalised && scope) {
      const hit = lookup(scope, head.core);
      if (hit) {
        matched = 1;
        initials = hit;
      }
    }
    if (matched && initials) {
      const tail = tokens[i + matched - 1]!;
      out += text.slice(cursor, head.start) + initials;
      cursor = tail.end;
      i += matched;
    } else {
      i += 1;
    }
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

/** Replace candidate names inside one string (rules 2 and 3; no payload context). */
export function scrubNamesInText(text: string, index: DemoNameIndex): string {
  return scrubText(text, index, null);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function candidateIdOf(row: Record<string, unknown>, index: DemoNameIndex): string | null {
  for (const key of CANDIDATE_ID_KEYS) {
    const value = row[key];
    if (typeof value === 'string' && index.byId.has(value)) return value;
  }
  const id = row.id;
  return typeof id === 'string' && index.byId.has(id) ? id : null;
}

/** Candidate ids an object tree refers to (rule 3 needs them before the walk). */
function referencedCandidates(value: unknown, index: DemoNameIndex, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) referencedCandidates(item, index, into);
    return;
  }
  if (!isPlainObject(value)) return;
  const id = candidateIdOf(value, index);
  if (id) into.add(id);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') referencedCandidates(child, index, into);
  }
}

function usablePart(word: string, index: DemoNameIndex): boolean {
  return word.length >= MIN_PART_LETTERS && /\p{L}/u.test(word) && !index.stop.has(word);
}

export type ScrubOptions = {
  /**
   * Candidates the payload is ABOUT although no object in it carries their id —
   * a chat transcript about one run is the case: prose that says "Budi" with
   * nothing to anchor it. Every capitalised part of these candidates' names is
   * replaced anywhere in the payload (rule 4 widened to the whole payload); when
   * two of them share a part, the first listed wins — a demo must not show the
   * name, even if it cannot be sure whose initials belong there.
   */
  contextCandidateIds?: Iterable<string>;
};

/**
 * Deep copy of `value` with every candidate name replaced by initials. Only
 * plain objects and arrays are walked; Dates and other instances pass through
 * untouched. The input is never mutated (it may be a cached object).
 */
export function scrubNamesDeep<T>(value: T, index: DemoNameIndex, options: ScrubOptions = {}): T {
  if (index.byId.size === 0 && index.byName.size === 0) return value;

  // Rule 3: one-word full names of the candidates this payload refers to.
  const referenced = new Set<string>();
  referencedCandidates(value, index, referenced);
  const payloadWords = new Map<string, string>();
  for (const id of options.contextCandidateIds ?? []) {
    const initials = index.byId.get(id);
    if (!initials) continue;
    for (const word of index.wordsById.get(id) ?? []) {
      if (usablePart(word, index) && !payloadWords.has(word)) payloadWords.set(word, initials);
    }
  }
  for (const id of referenced) {
    for (const word of index.oneWordNamesById.get(id) ?? []) {
      if (usablePart(word, index) && !payloadWords.has(word)) payloadWords.set(word, index.byId.get(id)!);
    }
  }
  const root: Scope | null = payloadWords.size > 0 ? { words: payloadWords, parent: null } : null;

  const walk = (item: unknown, scope: Scope | null): unknown => {
    if (typeof item === 'string') return scrubText(item, index, scope);
    if (Array.isArray(item)) return item.map((child) => walk(child, scope));
    if (!isPlainObject(item)) return item;

    const candidateId = candidateIdOf(item, index);
    let inner = scope;
    if (candidateId) {
      // Rule 4: inside this candidate's own row, the parts of their name.
      const initials = index.byId.get(candidateId)!;
      const own = new Map<string, string>();
      for (const word of index.wordsById.get(candidateId) ?? []) {
        if (usablePart(word, index)) own.set(word, initials);
      }
      if (own.size > 0) inner = { words: own, parent: scope };
    }

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(item)) {
      if (candidateId && typeof child === 'string' && child.trim()) {
        if (NAME_KEYS.has(key)) {
          out[key] = index.byId.get(candidateId)!;
          continue;
        }
        if (EMAIL_KEYS.has(key)) {
          out[key] = DEMO_MASK;
          continue;
        }
        if (PHOTO_KEYS.has(key)) {
          out[key] = null;
          continue;
        }
      }
      out[key] = walk(child, STRUCTURAL_KEYS.has(key) ? null : inner);
    }
    return out;
  };
  return walk(value, root) as T;
}
