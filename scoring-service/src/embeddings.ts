// Sentence embeddings via Transformers.js (@xenova/transformers).
// Produces mean-pooled, L2-normalized sentence vectors — the semantic backbone
// of the AHP+TOPSIS technical & career-relevance scorers and the Job Family
// document embeddings.
//
// TWO models are supported and loaded independently (one extractor per model,
// cached per process):
//   • PRIMARY (config.embedding.model, Multilingual E5) — similarity paths:
//     AHP technical/career + position_name ↔ job-profile fuzzy match.
//   • DOCUMENT (config.embedding.documentEmbeddingModel, Nomic Embed) —
//     DOCUMENT embeddings for topic modelling: restructured job-profile
//     paragraphs and kamus-kompetensi documents (one unified model for both).
// Each family needs its own instruction prefix (E5 "query: "; Nomic task
// prefixes). Models download from the HF Hub on first use and cache on disk
// (EMBEDDING_CACHE_DIR, default ~/.cache).

import { config } from "./config.js";
import { log } from "./llm.js";

type Extractor = (
  texts: string[],
  opts: { pooling: "mean" | "none"; normalize: boolean }
) => Promise<{ dims: number[]; data: Float32Array }>;

// One lazily-loaded extractor per model name (shared across all callers).
const extractorPromises = new Map<string, Promise<Extractor>>();

async function getExtractorFor(model: string): Promise<Extractor> {
  let promise = extractorPromises.get(model);
  if (!promise) {
    promise = (async () => {
      const { pipeline, env } = await import("@xenova/transformers");
      if (config.embedding.cacheDir) {
        (env as any).cacheDir = config.embedding.cacheDir;
      }
      const quantized = config.embedding.quantized;
      log("embeddings.loading", { model, quantized });
      const t0 = Date.now();
      let p: unknown;
      try {
        p = await pipeline("feature-extraction", model, { quantized });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A missing model_quantized.onnx is the classic "this repo has no
        // quantized export" case (e.g. nomic-embed-text-v2-moe) — surface an
        // actionable hint instead of the raw 404.
        if (quantized && /model_quantized\.onnx/i.test(msg)) {
          throw new Error(
            `Model "${model}" tidak punya ONNX terkuantisasi (${msg}). ` +
              `Set EMBEDDING_QUANTIZED=false, atau pakai model 768-dim yang didukung ` +
              `Transformers.js (mis. nomic-ai/nomic-embed-text-v1.5) via DOCUMENT_EMBEDDING_MODEL.`,
          );
        }
        throw err;
      }
      log("embeddings.ready", { model, elapsedMs: Date.now() - t0 });
      return p as unknown as Extractor;
    })();
    // A failed load (e.g. no network on first download) must not poison the
    // cache — allow a retry on the next call.
    promise.catch(() => {
      extractorPromises.delete(model);
    });
    extractorPromises.set(model, promise);
  }
  return promise;
}

const EMBED_BATCH_SIZE = 32;

/**
 * How the text will be used — selects the model-family instruction prefix.
 * "raw" adds NO prefix: use it when the vector must be comparable to one the
 * web app produced via lib/job-family/embed.ts `embedViaService`, which posts
 * the text to the OpenAI-compatible endpoint verbatim. Prefixing one side of a
 * cosine comparison and not the other silently skews every similarity.
 */
export type EmbedKind = "query" | "document" | "clustering" | "raw";

/** Instruction prefix required by the model family for the given task. */
function prefixFor(model: string, kind: EmbedKind): string {
  if (kind === "raw") return "";
  // E5 uses "query: " on both sides of symmetric similarity (all kinds).
  if (/(^|\/)multilingual-e5|(^|\/)e5-/i.test(model)) return "query: ";
  // Nomic Embed task-instruction prefixes.
  if (/nomic-embed/i.test(model)) {
    if (kind === "document") return "search_document: ";
    if (kind === "clustering") return "clustering: ";
    return "search_query: ";
  }
  return "";
}

/**
 * The prefix convention a STORED vector was produced with, derived from the
 * `embedding_model` recorded alongside it. The web app writes job_profile_embed /
 * kamus_kompetensi_level_embed through two different paths:
 *   • source "multilingual" → POST /api/embed { model: "primary" } here, which
 *     applies this module's own prefix rule → "query: " for E5.
 *   • source "nomic-local" / "nomic-remote" → `embedViaService` posts the text
 *     verbatim to an OpenAI-compatible endpoint → NO prefix.
 * Reproducing that choice is what keeps an on-the-fly vector comparable to the
 * stored ones.
 */
export function storedVectorKind(embeddingModel: string | null | undefined): EmbedKind {
  const model = embeddingModel ?? "";
  return /(^|\/)multilingual-e5|(^|\/)e5-/i.test(model) ? "query" : "raw";
}

async function embedWithApi(
  texts: string[],
  opts?: { model?: string; kind?: EmbedKind }
): Promise<number[][]> {
  const model = opts?.model ?? config.embedding.model;
  const kind = opts?.kind ?? "query";
  const prefix = prefixFor(model, kind);
  const baseUrl = config.embedding.baseUrl.replace(/\/+$/, "");

  const endpoint = baseUrl.endsWith("/v1")
    ? `${baseUrl}/embeddings`
    : `${baseUrl}/api/embed`;

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts
      .slice(start, start + EMBED_BATCH_SIZE)
      .map((t) => prefix + (t && t.trim() ? t.trim() : "-"));

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.embedding.apiKey) {
      headers["Authorization"] = `Bearer ${config.embedding.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: batch }),
      });
    } catch (err) {
      throw new Error(
        `Layanan embedding API gagal dihubungi di ${endpoint} (${
          err instanceof Error ? err.message : String(err)
        }). Pastikan server embedding (${config.embedding.provider}) berjalan, atau gunakan EMBEDDING_PROVIDER=transformers.`
      );
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Layanan embedding (${endpoint}) HTTP ${res.status}: ${errBody}`);
    }

    const data = (await res.json()) as any;
    if (Array.isArray(data.embeddings)) {
      vectors.push(...data.embeddings);
    } else if (Array.isArray(data.data)) {
      const sorted = data.data.sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0));
      vectors.push(...sorted.map((item: any) => item.embedding));
    } else {
      throw new Error(`Respon embedding dari ${endpoint} tidak memiliki format yang dikenali.`);
    }
  }

  return vectors;
}

/**
 * Embed texts into mean-pooled, normalized sentence vectors.
 * Returns one vector per input text (same order). Defaults to the PRIMARY
 * model + "query" prefix; pass opts to select the job-family model or a
 * different task prefix.
 */
export async function embedTexts(
  texts: string[],
  opts?: { model?: string; kind?: EmbedKind }
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const provider = config.embedding.provider.toLowerCase();
  if (provider === "ollama" || provider === "openai" || provider === "api") {
    return embedWithApi(texts, opts);
  }

  const model = opts?.model ?? config.embedding.model;
  const kind = opts?.kind ?? "query";
  const extractor = await getExtractorFor(model);
  const prefix = prefixFor(model, kind);

  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH_SIZE) {
    const batch = texts
      .slice(start, start + EMBED_BATCH_SIZE)
      .map((t) => prefix + (t && t.trim() ? t.trim() : "-"));
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    const [n, d] = output.dims as [number, number];
    for (let i = 0; i < n; i++) {
      vectors.push(Array.from(output.data.slice(i * d, (i + 1) * d)));
    }
  }
  return vectors;
}

/**
 * Raw, unpooled per-token vectors from the PRIMARY model. Transformers.js only —
 * an OpenAI-compatible endpoint returns pooled vectors and cannot serve this.
 */
export async function embedTextsRaw(texts: string[]): Promise<number[][][]> {
  if (texts.length === 0) return [];
  const provider = config.embedding.provider.toLowerCase();
  if (provider !== "transformers") {
    throw new Error(
      `Vektor per-token hanya tersedia lewat EMBEDDING_PROVIDER=transformers (saat ini "${config.embedding.provider}").`
    );
  }
  const model = config.embedding.model;
  const extractor = await getExtractorFor(model);
  const prefix = prefixFor(model, "query");

  const results: number[][][] = [];
  for (const text of texts) {
    const input = prefix + (text && text.trim() ? text.trim() : "-");
    const output = await extractor([input], { pooling: "none", normalize: false });
    const [, seqLen, d] = output.dims as [number, number, number];
    const tokens: number[][] = [];
    for (let j = 0; j < seqLen; j++) {
      const offset = j * d;
      tokens.push(Array.from(output.data.slice(offset, offset + d)));
    }
    results.push(tokens);
  }
  return results;
}

/** Cosine similarity. Vectors from embedTexts are normalized → plain dot. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Dimensi vektor a dan b harus sama!");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;

    dot += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  
  // Mencegah error Division by Zero jika ada vektor bernilai 0 semua
  if (magnitude === 0) return 0; 

  return dot / magnitude;
}

/** Map a cosine similarity (≈ -1..1 in theory, ~0..1 in practice) to 0-100. */
export function similarityToScore(sim: number): number {
  return Math.round(Math.max(0, Math.min(1, sim)) * 100);
}

/**
 * Build an N×N pairwise cosine-similarity matrix from precomputed vectors —
 * matrix[i][j] = cosineSimilarity(vectors[i], vectors[j]). Row/column count
 * tracks vectors.length (fully dynamic). Symmetric, so each pair is computed
 * once and mirrored rather than twice.
 */
export function buildSimilarityMatrix(vectors: number[][]): number[][] {
  const n = vectors.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i]![i] = cosineSimilarity(vectors[i]!, vectors[i]!);
    for (let j = i + 1; j < n; j++) {
      const sim = cosineSimilarity(vectors[i]!, vectors[j]!);
      matrix[i]![j] = sim;
      matrix[j]![i] = sim;
    }
  }
  return matrix;
}

/**
 * Embed texts and build their pairwise cosine-similarity matrix in one call.
 * matrix[i][j] is the similarity between texts[i] and texts[j]; row/column
 * count equals texts.length, so the matrix shape is entirely input-driven.
 */
export async function buildPairwiseSimilarityMatrix(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors = await embedTexts(texts);
  return buildSimilarityMatrix(vectors);
}
