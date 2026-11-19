/**
 * Read/write side of `job_family_title_embed` — the persistent cache of TITLE
 * embeddings behind the Job Profile Match report.
 *
 * Why this exists (measured on the live deployment, 280 job profiles / 340
 * candidates / 644 current position titles):
 *
 *   database phase (3 queries)          ~350 ms
 *   embedding phase (742 texts, remote)  ~20 s   ← the whole page's cost
 *
 * The embedding source here is `nomic-remote`, a hosted gateway: 200 texts take
 * 5.2s, and `embedTitles` chunked 742 texts into four SEQUENTIAL calls. There
 * was already an in-process Map, but a Map is per-process — every restart,
 * deploy and additional worker re-paid the twenty seconds, and this page is not
 * one anybody keeps warm.
 *
 * A vector is a pure function of (source, model, exact text), so nothing here
 * needs invalidating: a model or source change lands on different rows. See the
 * table comment in `lib/db/schema.ts` for why this caches vectors rather than
 * match decisions, and why the payload is Float32 bytea.
 *
 * Every failure path degrades to "cache miss" rather than throwing. A missing
 * table (migration not yet applied) must not take the report down — it just
 * costs what the report already cost before this existed. Unlike the drizzle/0067
 * trap, a permanently failing write here is not silent: it is logged once.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { jobFamilyTitleEmbed } from '@/lib/db/schema';

/** md5 of the EXACT text — the bytes the model was given, not a normalized form. */
export function titleTextHash(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

/** Little-endian Float32 array. */
export function encodeVector(vec: number[]): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i]!, i * 4);
  return buf;
}

export function decodeVector(buf: Buffer): number[] {
  const n = buf.length >> 2;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/**
 * Round a freshly-embedded vector through the same Float32 encoding the cache
 * stores, so a run comparing a fresh vector against a cached one is comparing
 * like with like. Without this, the same title could land on either side of the
 * 0.98 threshold depending on whether this process had already embedded it —
 * a report that reshuffles between page loads, which is exactly what the AI
 * tier's decision cache exists to prevent on its own side.
 */
export function quantizeVector(vec: number[]): number[] {
  return decodeVector(encodeVector(vec));
}

let writeFailureLogged = false;

/** Cached vectors for `texts`, keyed by the exact text. Missing = cache miss. */
export async function loadTitleVectors(
  source: string,
  model: string,
  texts: string[],
): Promise<Map<string, number[]>> {
  const found = new Map<string, number[]>();
  if (texts.length === 0) return found;

  const byHash = new Map<string, string>();
  for (const t of texts) byHash.set(titleTextHash(t), t);

  try {
    const rows = await db
      .select({ textHash: jobFamilyTitleEmbed.textHash, embedding: jobFamilyTitleEmbed.embedding })
      .from(jobFamilyTitleEmbed)
      .where(
        and(
          eq(jobFamilyTitleEmbed.source, source),
          eq(jobFamilyTitleEmbed.model, model),
          inArray(jobFamilyTitleEmbed.textHash, Array.from(byHash.keys())),
        ),
      );
    for (const row of rows) {
      const text = byHash.get(row.textHash);
      if (!text || !row.embedding) continue;
      found.set(text, decodeVector(row.embedding));
    }
  } catch (err) {
    // Table absent (pre-0070) or a transient failure: fall back to embedding
    // everything, which is what this page did before the cache existed.
    console.error('[JOB-FAMILY] title vector cache read skipped:', err);
    return new Map();
  }

  return found;
}

/** Statement size cap: ~200 rows x 3KB is one 600KB INSERT, measured at 265ms. */
const WRITE_CHUNK = 200;

/** Persist freshly-embedded vectors. Best-effort; never throws. */
export async function saveTitleVectors(
  source: string,
  model: string,
  entries: Array<{ text: string; vector: number[] }>,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
      const chunk = entries.slice(i, i + WRITE_CHUNK);
      await db
        .insert(jobFamilyTitleEmbed)
        .values(
          chunk.map((e) => ({
            source,
            model,
            textHash: titleTextHash(e.text),
            text: e.text,
            dims: e.vector.length,
            embedding: encodeVector(e.vector),
          })),
        )
        // DO NOTHING, not DO UPDATE: the row is a pure function of its own key,
        // so an existing row is already the right answer. Two concurrent report
        // loads racing on the same title is the normal case, not a conflict.
        .onConflictDoNothing({
          target: [jobFamilyTitleEmbed.source, jobFamilyTitleEmbed.model, jobFamilyTitleEmbed.textHash],
        });
    }
  } catch (err) {
    if (!writeFailureLogged) {
      writeFailureLogged = true;
      console.error(
        '[JOB-FAMILY] title vector cache write failed — the match report will keep re-embedding every run until this is fixed:',
        err,
      );
    }
  }
}
