// Gemini client for the AHP+TOPSIS *education* aspect — the one criterion that
// needs external, citable evidence (does this degree/major actually fit the
// role's field?). It calls the Gemini `generateContent` REST endpoint WITH
// "Grounding with Google Search" so the model's reasoning is backed by real web
// sources, which we persist for gap analysis.
//
// Determinism: temperature 0 + topP 0 remove the sampling randomness that makes
// plain LLM scoring vary run-to-run. Gemini does NOT allow the google_search
// tool together with responseSchema / responseMimeType=application/json, so we
// can't use its native structured-output mode while grounding; instead the
// caller supplies a strict rubric system prompt that demands JSON-only, and we
// validate + retry here until the JSON parses (or give up and let the caller
// fall back to the deterministic BERT scorer).

import { config } from "./config.js";
import { log } from "./llm.js";

export type GroundingSource = { title: string; uri: string };

export type GeminiGroundedResult = {
  text: string;
  searchQueries: string[];
  sources: GroundingSource[];
};

export function geminiConfigured(): boolean {
  return Boolean(config.gemini.apiKey);
}

/**
 * One grounded Gemini call. Returns the raw text plus the grounding metadata
 * (search queries + web sources). Throws on transport/HTTP errors so the caller
 * can decide whether to retry or fall back.
 */
export async function callGeminiGrounded(
  systemPrompt: string,
  userPrompt: string,
  options: {
    /**
     * Force grounding off for this call (default: the configured value). Used by
     * the structured-output repair pass — grounding and `responseSchema` are
     * mutually exclusive, so JSON mode is only available with grounding off.
     */
    grounding?: boolean;
    /**
     * Gemini `responseSchema`. Only honored when grounding is off; switches the
     * call to native structured output (`responseMimeType: application/json`),
     * which cannot return prose.
     */
    responseSchema?: Record<string, unknown>;
  } = {}
): Promise<GeminiGroundedResult> {
  const { apiKey, model, baseUrl, groundingTool, enableGrounding, temperature, topP, timeoutMs } =
    config.gemini;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const url = `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${apiKey}`;

  const grounded = options.grounding ?? enableGrounding;
  const generationConfig: Record<string, unknown> = {
    // Greedy decoding — no creativity/randomness. Reproducible across runs.
    temperature,
    topP,
  };
  if (!grounded && options.responseSchema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = options.responseSchema;
  }

  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig,
  };
  // Grounding tool is mutually exclusive with responseSchema, so we only send
  // the tool and rely on the prompt + parser for JSON shape.
  if (grounded) {
    body.tools = [{ [groundingTool]: {} }];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini call failed: ${res.status} ${res.statusText} - ${errText}`);
    }
    const json: any = await res.json();
    const candidate = json?.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? [])
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();

    const gm = candidate?.groundingMetadata ?? {};
    const searchQueries: string[] = Array.isArray(gm.webSearchQueries)
      ? gm.webSearchQueries.filter((q: unknown): q is string => typeof q === "string")
      : [];
    const sources: GroundingSource[] = Array.isArray(gm.groundingChunks)
      ? gm.groundingChunks
          .map((c: any) => ({
            title: String(c?.web?.title ?? "").trim(),
            uri: String(c?.web?.uri ?? "").trim(),
          }))
          .filter((s: GroundingSource) => s.uri.length > 0)
      : [];

    log("gemini.complete", {
      model,
      elapsedMs: Date.now() - t0,
      grounded,
      structured: Boolean(!grounded && options.responseSchema),
      finishReason: candidate?.finishReason ?? null,
      sources: sources.length,
      textLength: text.length,
    });
    return { text, searchQueries, sources };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Every balanced `{...}` object in the text, outermost-first, string-aware so
 * braces inside quoted values don't break the scan.
 *
 * Naive first-`{`-to-last-`}` slicing breaks on the real-world output of a
 * grounded call: the model often writes an analysis paragraph and only THEN the
 * JSON (or emits several fenced blocks), so the naive slice spans prose and
 * fails to parse. Returning every candidate lets the caller pick the one that
 * actually satisfies the contract.
 */
export function extractJsonObjects(content: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          out.push(content.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return out;
}

export type EducationLlmJson = {
  education_level: number;
  major_relevance: number;
  reason: string;
};

/**
 * Parse + validate the strict education JSON contract:
 *   { "education_level": <0-100>, "major_relevance": <0-100>, "reason": "..." }
 * Throws when the shape/types are wrong so the caller retries the prompt.
 */
export function parseEducationJson(content: string): EducationLlmJson {
  const slices = extractJsonObjects(content);
  if (slices.length === 0) {
    throw new Error(
      `No JSON object found in Gemini output (${content.length} chars, likely prose instead of JSON)`
    );
  }

  // Try every balanced object; the last one wins when several parse, because a
  // model that reasons first and answers last puts the verdict at the end.
  let lastError = "no candidate object matched the contract";
  for (let i = slices.length - 1; i >= 0; i--) {
    let obj: any;
    try {
      obj = JSON.parse(slices[i]!);
    } catch (err) {
      lastError = `Invalid JSON: ${String(err)}`;
      continue;
    }
    const level = Number(obj?.education_level);
    const major = Number(obj?.major_relevance);
    const reason = obj?.reason;
    if (!Number.isFinite(level) || !Number.isFinite(major)) {
      lastError = "education_level / major_relevance must be numbers";
      continue;
    }
    if (typeof reason !== "string" || reason.trim().length === 0) {
      lastError = "reason must be a non-empty string";
      continue;
    }
    return {
      education_level: Math.max(0, Math.min(100, Math.round(level))),
      major_relevance: Math.max(0, Math.min(100, Math.round(major))),
      reason: reason.trim(),
    };
  }
  throw new Error(lastError);
}

/**
 * `responseSchema` for the education contract — used by the structured-output
 * repair pass (grounding off), where the API itself guarantees the shape.
 */
export const EDUCATION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    education_level: { type: "number" },
    major_relevance: { type: "number" },
    reason: { type: "string" },
  },
  required: ["education_level", "major_relevance", "reason"],
};
