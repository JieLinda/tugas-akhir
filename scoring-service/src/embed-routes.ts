// Generic sentence-embedding endpoint. Exposes the same multilingual-e5 model
// (Transformers.js) the AHP+TOPSIS engine uses, so other services (e.g. the web
// app's Job Family Discovery feature) can obtain vectors without shipping their
// own embedding stack. Reuses the process-wide extractor singleton in
// embeddings.ts — the model loads once and is shared across all callers.

import express, { type Request, type Response } from "express";
import { z } from "zod";
import { embedTexts } from "./embeddings.js";
import { config } from "./config.js";
import { log } from "./llm.js";

import { resolveTechnicalAnchors } from "./technical-anchors.js";
import { resolveCareerAnchors } from "./career-anchors.js";

export const embedRouter = express.Router() as ReturnType<typeof express.Router>;

const embedSchema = z.object({
  texts: z.array(z.string()).min(1).max(256),
  // Which configured model to use:
  //   "primary"  → config.embedding.model (Multilingual E5) — similarity paths
  //                (position_name ↔ job-profile match). Default.
  //   "document" → config.embedding.documentEmbeddingModel (Nomic) — DOCUMENT
  //                embeddings, shared by job-profile paragraphs AND
  //                kamus-kompetensi documents.
  model: z.enum(["primary", "document"]).optional(),
  // Explicit model name (must be one of the env-configured models — see GET
  // /api/embed/models). Lets the Job Family Configuration dropdown pick which
  // configured model actually produces the vectors. Unknown names fall back to
  // the document model (logged) rather than failing the request.
  modelName: z.string().optional(),
  // Instruction-prefix task; when omitted, inferred from the model choice.
  kind: z.enum(["query", "document", "clustering"]).optional(),
});

/** Default instruction-prefix task for a model family. */
function defaultKindFor(model: string): "query" | "clustering" {
  return /nomic-embed/i.test(model) ? "clustering" : "query";
}

/** The set of models the operator configured via env. */
function configuredModels(): { name: string; role: "primary" | "document"; label: string }[] {
  const list = [
    {
      name: config.embedding.model,
      role: "primary" as const,
      label: "Primary — similarity (E5)",
    },
    {
      name: config.embedding.documentEmbeddingModel,
      role: "document" as const,
      label: "Document — topic modelling",
    },
  ];
  // Both env slots can resolve to the same default → dedup by name.
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true)));
}

/**
 * GET /api/embed/models
 * Lists the env-configured embedding models so the web Configuration page can
 * offer them in a dropdown. Returns: { models: [{name, role, label}], default }.
 */
embedRouter.get("/models", (_req: Request, res: Response) => {
  res.json({
    models: configuredModels(),
    default: config.embedding.documentEmbeddingModel,
  });
});

/**
 * POST /api/embed
 * Body: { texts: string[], model?: "primary"|"document", kind?: ... }
 * Returns: { vectors: number[][], model: string, dims: number }
 * Vectors are mean-pooled and L2-normalized (cosine = dot product).
 */
embedRouter.post("/", async (req: Request, res: Response) => {
  const parse = embedSchema.safeParse(req.body);
  if (!parse.success) {
    return res
      .status(400)
      .json({ error: "Invalid request", details: parse.error.flatten() });
  }

  const configured = new Set(configuredModels().map((m) => m.name));
  let modelName: string;
  if (parse.data.modelName && configured.has(parse.data.modelName)) {
    // Explicit, env-configured model chosen in the Configuration dropdown.
    modelName = parse.data.modelName;
  } else {
    // Fall back to the model-key resolution (document embeddings when an
    // unknown explicit name was requested, so a stale config can't 500 a rebuild).
    const modelKey =
      parse.data.model ?? (parse.data.modelName ? "document" : "primary");
    modelName =
      modelKey === "document"
        ? config.embedding.documentEmbeddingModel
        : config.embedding.model;
    if (parse.data.modelName && !configured.has(parse.data.modelName)) {
      log("embed.unknownModelName", {
        requested: parse.data.modelName,
        fallback: modelName,
      });
    }
  }
  // Task prefix: caller override, else inferred from the resolved model family.
  const kind = parse.data.kind ?? defaultKindFor(modelName);

  const t0 = Date.now();
  try {
    const vectors = await embedTexts(parse.data.texts, { model: modelName, kind });
    log("embed.ok", {
      model: modelName,
      kind,
      count: vectors.length,
      dims: vectors[0]?.length ?? 0,
      elapsedMs: Date.now() - t0,
    });
    res.json({
      vectors,
      model: modelName,
      dims: vectors[0]?.length ?? 0,
    });
  } catch (err) {
    log("embed.failed", { error: String(err) });
    res.status(500).json({
      error: err instanceof Error ? err.message : "Embedding failed",
    });
  }
});

// ── Technical similarity anchors ────────────────────────────────
//
// The anchors are derived from the kamus embedding corpus, and the corpus
// fingerprint makes a scoring run recompute them by itself whenever that corpus
// changes. This endpoint only makes the refresh EAGER: the web app calls it the
// moment a kamus re-embed finishes, so the new anchors are visible immediately
// rather than at the next scoring run, and so an operator sees what the rebuild
// did to the scale. Safe to call at any time — it is the same idempotent
// resolve the engine performs, and a no-op when nothing changed.
embedRouter.post("/technical-anchors/refresh", async (_req, res) => {
  try {
    const anchors = await resolveTechnicalAnchors();
    res.json({ ok: true, ...anchors });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── Career similarity anchors ───────────────────────────────────
//
// Same contract as above, for the other corpus: the job-profile documents in
// `job_profile_embed`. The web app calls this when a job-profile embedding
// rebuild finishes, so an operator sees immediately what the rebuild did to the
// Career scale instead of discovering it in the next scoring run.
//
// `?force=1` bypasses the cached calibration. It exists for the one change no
// fingerprint can detect: a re-embed that produces DIFFERENT VECTORS from the
// SAME text with the SAME model — a re-tuned embedding service, or a
// half-finished earlier run. `content_hash` covers text+model only, which is
// precisely why `rebuildJobProfileEmbeddings` re-embeds every document
// unconditionally instead of trusting it; the anchors have to make the same
// assumption, or a rebuild that fixed the vectors would leave the scale
// describing the ones it replaced. The rebuild therefore passes force=1.
//
// Without it this stays idempotent and a genuine no-op when nothing moved.
embedRouter.post("/career-anchors/refresh", async (req, res) => {
  try {
    const force = req.query.force === "1" || req.query.force === "true";
    const anchors = await resolveCareerAnchors(force);
    res.json({ ok: true, forced: force, ...anchors });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});
