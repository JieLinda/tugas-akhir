import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { decryptCandidateValue } from '@/lib/candidate-crypto';
import { ensureUnlocked } from '@/lib/crypto/key-store';
import { isDemoMode } from '@/lib/app-mode';
import { assignUniqueInitials } from '@/lib/demo/initials';
import {
  buildDemoNameIndex,
  scrubNamesDeep,
  scrubNamesInText,
  type DemoNameIndex,
  type ScrubOptions,
} from '@/lib/demo/name-scrub';
import { loadDemoCopies } from '@/lib/demo/store';
import { TENANTS } from '@/lib/tenant';

/**
 * Demo mode — candidate names become unique initials in everything the server
 * sends to a browser.
 *
 * `demoScrub(value)` is THE function: call it on a page's props, a server
 * action's return value or an API route's JSON, and in demo mode every
 * candidate name inside — a `name` field, a ranking snapshot, a live scoring
 * session's stages, a label, a narrative — comes back as that candidate's
 * initials. In real mode it returns its argument untouched and costs one cookie
 * read. It never writes anything, which is also why it may only run on the way
 * OUT: a write fed by a scrubbed value would store initials.
 *
 * The initials are those of the name IN FORCE in demo mode — the demo copy's
 * (`candidates_dupp`) when the candidate has one, else the real name — whether
 * that name was stored in a copy or is read live, and whether the candidate is
 * ON or OFF. The real name stays recognised too (a run finished before the copy
 * was edited still holds it), and maps to the same initials.
 *
 * Initials are unique across EVERY candidate row — all business units, live and
 * tombstoned, ON and OFF — assigned oldest first (created_at, NPK, id), so a
 * candidate keeps the same initials on every page and a pool that spans units
 * cannot show one pair twice. The index is rebuilt only when `candidates` or
 * `candidates_dupp` changes (row count, newest timestamps), not per request:
 * building it decrypts every name.
 */

type CacheEntry = { fingerprint: string; index: DemoNameIndex };

type CacheState = {
  entry: CacheEntry | null;
  /** When the fingerprint was last confirmed — one page calls this several times. */
  checkedAt: number;
  building: { fingerprint: string; promise: Promise<CacheEntry> } | null;
};

/**
 * A fingerprint confirmed this recently is trusted without another query —
 * long enough to share one check between the loaders of a single request, short
 * enough that a candidate added or renamed a moment ago is never shown
 * unscrubbed for more than a second. The check is two aggregates and only ever
 * runs in demo mode.
 */
const FINGERPRINT_TTL_MS = 1_000;

// On globalThis for the same reason lib/db and the key store are: Next.js dev
// HMR would otherwise drop the cache on every edit.
const globalForDemo = globalThis as unknown as { __pulseDemoNames?: CacheState };
const cache: CacheState =
  globalForDemo.__pulseDemoNames ??
  (globalForDemo.__pulseDemoNames = { entry: null, checkedAt: 0, building: null });

/** Business-unit names must never be read as somebody's name. */
const NEVER_MATCH = TENANTS.flatMap((tenant) => [tenant.name, tenant.slug]);

async function currentFingerprint(): Promise<string> {
  const res = await db.execute(sql`
    SELECT count(*)::int AS n,
           max(created_at)::text AS created,
           max(updated_at)::text AS updated
    FROM candidates
  `);
  const row = (res.rows as Array<{ n: number; created: string | null; updated: string | null }>)[0];
  let copies = '';
  try {
    const dupp = await db.execute(sql`SELECT count(*)::int AS n, max(updated_at)::text AS updated FROM candidates_dupp`);
    const d = (dupp.rows as Array<{ n: number; updated: string | null }>)[0];
    copies = `${d?.n ?? 0}|${d?.updated ?? ''}`;
  } catch {
    // drizzle/0093 not applied: no copies, nothing to fingerprint.
  }
  return `${row?.n ?? 0}|${row?.created ?? ''}|${row?.updated ?? ''}|${copies}`;
}

async function buildIndex(fingerprint: string): Promise<CacheEntry> {
  // Names are encrypted; a cold process must unwrap the key before reading them.
  await ensureUnlocked();
  const [res, copies] = await Promise.all([
    db.execute(sql`
      SELECT id::text AS id, name
      FROM candidates
      ORDER BY created_at ASC, employee_id ASC, id ASC
    `),
    loadDemoCopies(),
  ]);
  const people = (res.rows as Array<{ id: string; name: string | null }>).flatMap((row) => {
    const real = decryptCandidateValue(row.name);
    const shown = copies.get(row.id)?.name?.trim() || real;
    if (!shown) return [];
    return [{ id: row.id, name: shown, aliases: real && real !== shown ? [real] : [] }];
  });
  const initials = assignUniqueInitials(people.map((p) => ({ key: p.id, name: p.name })));
  const index = buildDemoNameIndex(
    people.flatMap((p) => {
      const value = initials.get(p.id);
      return value ? [{ id: p.id, name: p.name, aliases: p.aliases, initials: value }] : [];
    }),
    { neverMatch: NEVER_MATCH },
  );
  return { fingerprint, index };
}

/** The current name → initials index, rebuilt only when the candidates or their copies changed. */
export async function getDemoNameIndex(): Promise<DemoNameIndex> {
  if (cache.entry && Date.now() - cache.checkedAt < FINGERPRINT_TTL_MS) return cache.entry.index;
  const fingerprint = await currentFingerprint();
  if (cache.entry?.fingerprint === fingerprint) {
    cache.checkedAt = Date.now();
    return cache.entry.index;
  }
  if (cache.building?.fingerprint !== fingerprint) {
    const promise = buildIndex(fingerprint);
    cache.building = { fingerprint, promise };
    promise
      .then((entry) => {
        cache.entry = entry;
        cache.checkedAt = Date.now();
      })
      .catch(() => undefined)
      .finally(() => {
        if (cache.building?.promise === promise) cache.building = null;
      });
  }
  return (await cache.building!.promise).index;
}

/**
 * Candidate names → initials inside `value`, in demo mode.
 *
 * Fails CLOSED: if the index cannot be built (database or key trouble) the
 * error propagates rather than sending real names in the mode whose point is
 * not to.
 */
export async function demoScrub<T>(value: T, options?: ScrubOptions): Promise<T> {
  if (!(await isDemoMode())) return value;
  return scrubNamesDeep(value, await getDemoNameIndex(), options);
}

/** Same as {@link demoScrub} for one string. */
export async function demoScrubText(text: string): Promise<string> {
  if (!(await isDemoMode())) return text;
  return scrubNamesInText(text, await getDemoNameIndex());
}

/** candidate id → initials, in demo mode; null in real mode (for loaders that search or sort on it). */
export async function demoInitialsById(): Promise<ReadonlyMap<string, string> | null> {
  if (!(await isDemoMode())) return null;
  return (await getDemoNameIndex()).byId;
}
