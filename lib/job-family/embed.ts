// Shared Job Family embedding helpers. Plain module (no 'use server') so the
// pgvector rebuild (lib/job-family-actions.ts), the ChromaDB sync
// (lib/chroma-actions.ts), and the unified vector-store dispatcher
// (lib/vector-store-actions.ts) all use one source of truth for:
//   • embedViaService — DOCUMENT vectors from one of 3 sources (see EmbeddingSource)
//   • hashContent     — content hash used to skip unchanged rows on rebuild
//   • kamusDocument   — one searchable document per competency-dictionary row
//   • isSchemaMissing — detect "pgvector / *_embed table not present yet"
//   • isVectorDbUnreachable — detect "can't even connect to the vector DB"

import { createHash } from 'node:crypto';
import type { EmbeddingSource } from './config';

/**
 * Embed DOCUMENTS from one of three configured sources:
 *   'multilingual' → scoring-service's Transformers.js pipeline (Multilingual E5) —
 *                     the only source not reachable via an OpenAI-compatible endpoint.
 *   'nomic-local'  → OpenAI-compatible endpoint at EMBEDDING_API_BASE (default:
 *                     http://localhost:11434/v1, a local Ollama).
 *   'nomic-remote' → OpenAI-compatible endpoint at EMBEDDING_API_BASE_REMOTE (default:
 *                     https://models.mpm-motor.com/v1, a hosted gateway).
 *
 * `modelName` (from the Job Family Configuration dropdown) selects which model
 * produces the vectors when the source's *_MODEL env var isn't set.
 */
export async function embedViaService(
  texts: string[],
  modelName?: string,
  source: EmbeddingSource = 'nomic-local',
): Promise<number[][]> {
  if (texts.length === 0) return [];

  if (source === 'multilingual') {
    return embedViaScoringService(texts);
  }

  const isRemote = source === 'nomic-remote';

  const apiBase = (
    (isRemote ? process.env.EMBEDDING_API_BASE_REMOTE : process.env.EMBEDDING_API_BASE) ||
    process.env.LLM_BASE_URL ||
    (isRemote ? 'https://models.mpm-motor.com/v1' : 'http://localhost:11434/v1')
  ).replace(/\/$/, '');

  const apiKey =
    (isRemote ? process.env.EMBEDDING_API_KEY_REMOTE : process.env.EMBEDDING_API_KEY) ||
    process.env.LLM_API_KEY ||
    '';

  const model =
    (isRemote ? process.env.EMBEDDING_MODEL_REMOTE : process.env.EMBEDDING_MODEL) ||
    modelName ||
    (isRemote ? 'ollama/nomic-embed-text-v2-moe:latest' : 'nomic-embed-text-v2-moe:latest');

  const endpoint = `${apiBase}/embeddings`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        input: texts,
        model,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Layanan embedding (${endpoint}) gagal (HTTP ${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as {
      data: Array<{ index: number; embedding: number[] }>;
    };

    if (!data || !Array.isArray(data.data)) {
      throw new Error('Respon embedding OpenAI tidak valid.');
    }

    const sorted = data.data.slice().sort((a, b) => a.index - b.index);
    const vectors = sorted.map((d) => d.embedding);

    if (vectors.length !== texts.length) {
      throw new Error('Respon embedding tidak valid (jumlah vektor tidak cocok).');
    }

    return vectors;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const causeStr =
      err instanceof Error && err.cause
        ? ` (${(err.cause as Error).message || String(err.cause)})`
        : '';
    throw new Error(
      `Gagal terhubung ke layanan embedding di ${endpoint}: ${detail}${causeStr}`,
    );
  }
}

/**
 * Embed DOCUMENTS via scoring-service's Transformers.js pipeline using its
 * PRIMARY model (Multilingual E5) — the only way to reach that model, since
 * (unlike Nomic) it isn't served behind an OpenAI-compatible endpoint.
 */
async function embedViaScoringService(texts: string[]): Promise<number[][]> {
  const base = process.env.SCORING_SERVICE_URL;
  if (!base) {
    throw new Error(
      'SCORING_SERVICE_URL tidak dikonfigurasi (dibutuhkan untuk model Multilingual E5).',
    );
  }
  const endpoint = `${base.replace(/\/$/, '')}/api/embed`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, model: 'primary' }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Layanan embedding (${endpoint}) gagal (HTTP ${res.status}): ${body}`);
    }
    const data = (await res.json()) as { vectors: number[][] };
    if (!Array.isArray(data.vectors) || data.vectors.length !== texts.length) {
      throw new Error('Respon embedding tidak valid (jumlah vektor tidak cocok).');
    }
    return data.vectors;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const causeStr =
      err instanceof Error && err.cause
        ? ` (${(err.cause as Error).message || String(err.cause)})`
        : '';
    throw new Error(
      `Gagal terhubung ke layanan embedding di ${endpoint}: ${detail}${causeStr}`,
    );
  }
}

/**
 * sha256 of a job profile's extracted data as stored (the parsed jsonb,
 * re-serialised). Recorded beside a vector (job_profile_embed.extracted_hash)
 * so a later reader can tell whether the source data still is what the vector
 * was restructured from; computed the same way on both sides, so only equality
 * is meaningful, never the value itself.
 */
export function hashExtracted(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data ?? null)).digest('hex');
}

/** Hash of (model + document) — lets a rebuild skip rows whose content is unchanged. */
export function hashContent(document: string, model: string): string {
  return createHash('sha256').update(`${model}\n${document}`).digest('hex');
}

/**
 * Guard that every returned vector matches the configured dimension, before any
 * row touches a pgvector table whose column was (re)created at that dimension.
 * Catches a model that actually outputs a different length than the config
 * claims — otherwise the failure surfaces per-row as an opaque pgvector error
 * and the whole rebuild reports hundreds of individual "gagal".
 */
export function assertVectorDimensions(
  vectors: number[][],
  expected: number,
  context: string,
): void {
  for (const v of vectors) {
    if (v.length !== expected) {
      throw new Error(
        `Model embedding mengembalikan vektor ${v.length} dimensi, tetapi konfigurasi menetapkan ${expected} dimensi (${context}). ` +
          `Samakan keduanya atau ubah 'Dimensi Vektor', lalu tekan 'Bangun Ulang Job Profile'.`,
      );
    }
  }
}

/** Build one searchable document from a competency-dictionary row. */
export function kamusDocument(r: {
  code: string;
  name: string;
  description: string | null;
  levelBasic: string | null;
  levelIntermediate: string | null;
  levelAdvance: string | null;
  levelMastery: string | null;
}): string {
  const parts = [
    `${r.code} — ${r.name}`,
    r.description?.trim(),
    r.levelBasic?.trim() && `Basic: ${r.levelBasic.trim()}`,
    r.levelIntermediate?.trim() && `Intermediate: ${r.levelIntermediate.trim()}`,
    r.levelAdvance?.trim() && `Advance: ${r.levelAdvance.trim()}`,
    r.levelMastery?.trim() && `Mastery: ${r.levelMastery.trim()}`,
  ].filter(Boolean);
  return parts.join('\n');
}

/** Human labels for the four proficiency levels, in ascending order. */
export const KAMUS_LEVEL_LABELS = ['Basic', 'Intermediate', 'Advance', 'Mastery'] as const;

/**
 * Build the four CUMULATIVE level documents for a competency-dictionary row —
 * one per proficiency level 1..4, where level L's document holds the name,
 * description, and the descriptors for levels 1 through L. This is the text the
 * AHP technical matcher embeds to represent a competency HELD/REQUIRED at level
 * L (a level-3 holder is described by Basic+Intermediate+Advance together).
 *
 * Always returns 4 entries so (code, level) rows stay complete; when a level's
 * descriptor text is missing the cumulative document simply carries the lower
 * levels it does have.
 */
export function kamusLevelDocuments(r: {
  code: string;
  name: string;
  description: string | null;
  levelBasic: string | null;
  levelIntermediate: string | null;
  levelAdvance: string | null;
  levelMastery: string | null;
}): { level: number; document: string }[] {
  const header = `${r.code} — ${r.name}`;
  const desc = r.description?.trim();
  const levelTexts = [
    r.levelBasic?.trim(),
    r.levelIntermediate?.trim(),
    r.levelAdvance?.trim(),
    r.levelMastery?.trim(),
  ];

  const out: { level: number; document: string }[] = [];
  for (let level = 1; level <= 4; level++) {
    const parts = [header, desc];
    for (let i = 0; i < level; i++) {
      const txt = levelTexts[i];
      if (txt) parts.push(`${KAMUS_LEVEL_LABELS[i]}: ${txt}`);
    }
    out.push({ level, document: parts.filter(Boolean).join('\n') });
  }
  return out;
}

/**
 * True when an error means a not-yet-migrated Job Family dependency is absent:
 * the pgvector extension, an `*_embed` table, or a `job_family_topic*` table
 * (BERTopic runs/results). Lets read paths degrade to an empty state instead of
 * crashing the page when the relevant migration hasn't been applied yet.
 */
/** Driver-level codes that all mean "this connection never became usable". */
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED', // nothing listening on that host:port
  'ENOTFOUND', // host doesn't resolve
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '3D000', // invalid_catalog_name — the database itself doesn't exist
  '57P03', // cannot_connect_now — server still starting up
]);

/**
 * True when the vector DB can't be reached at all: wrong host/port, server
 * down, bad credentials, or a database that doesn't exist. Distinct from
 * `isSchemaMissing`, which means "connected fine, the migration just hasn't run
 * yet" — both should let a read path degrade to an empty/not-ready state rather
 * than take a page down.
 *
 * Matching is on driver codes, not message text, because `pg` reports a refused
 * connection as an AggregateError whose OWN message is empty, wrapping one
 * sub-error per resolved address (::1 and 127.0.0.1 for localhost). That empty
 * message is why an unhandled one reaches the browser as the unhelpful "An
 * error occurred in the Server Components render but no message was provided".
 */
export function isVectorDbUnreachable(err: unknown): boolean {
  // Breadth-first over both `cause` (how Drizzle wraps driver errors) and
  // `errors` (how AggregateError holds the per-address failures).
  const queue: unknown[] = [err];
  for (let visited = 0; queue.length > 0 && visited < 20; visited++) {
    const cur = queue.shift();
    if (!cur) continue;
    const code = (cur as { code?: unknown }).code;
    if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return true;
    if (cur instanceof Error) {
      // Pool.connect()'s own timeout carries no code, only this message.
      if (/timeout exceeded when trying to connect|Connection terminated/i.test(cur.message)) return true;
      if (cur.cause) queue.push(cur.cause);
      const subErrors = (cur as AggregateError).errors;
      if (Array.isArray(subErrors)) queue.push(...subErrors);
    }
  }
  return false;
}

export function isSchemaMissing(err: unknown): boolean {
  // Drizzle wraps the driver error ("Failed query: …") and puts the real
  // Postgres message on `err.cause`, so walk the whole cause chain.
  let cur: unknown = err;
  const parts: string[] = [];
  for (let depth = 0; cur && depth < 5; depth++) {
    parts.push(cur instanceof Error ? cur.message : String(cur));
    cur = cur instanceof Error ? (cur.cause as unknown) : undefined;
  }
  const msg = parts.join('\n');
  return (
    /relation "?(job_profile_embed|kamus_kompetensi_embed|kamus_kompetensi_level_embed|job_family_topic\w*)"?\s+does not exist/i.test(msg) ||
    /type "?vector"?\s+does not exist/i.test(msg) ||
    /extension "?vector"?\s+is not available/i.test(msg)
  );
}
