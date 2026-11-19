// LLM helpers — the OpenAI-compatible client the AHP+TOPSIS insight writer uses.
// Kept in sync manually because the service is standalone (no shared deps).

import { config } from "./config.js";

const LLM_BASE_URL = config.llm.baseUrl;
const LLM_API_KEY = config.llm.apiKey;
const LLM_MODEL = config.llm.model;

export function log(label: string, data?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  if (data) console.log(`[Scoring ${ts}] ${label}`, JSON.stringify(data, null, 2));
  else console.log(`[Scoring ${ts}] ${label}`);
}

export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  options?: { temperature?: number; seed?: number | null }
): Promise<string> {
  const url = `${LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`;
  log("callLLM.begin", {
    model: LLM_MODEL,
    url,
    preview: userPrompt.slice(0, 200),
  });
  const t0 = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.llmTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        // Deterministic decoding for reproducible scores across runs. `seed` is
        // honored by OpenAI-compatible servers (vLLM/OpenAI) that support it and
        // ignored otherwise; temperature 0 alone already removes most variance.
        // Callers (e.g. the narrative/insight agent) can override to trade
        // reproducibility for more varied, natural prose.
        temperature: options?.temperature ?? config.llm.temperature,
        top_p: 1,
        seed: options?.seed === undefined ? config.llm.seed : options.seed ?? undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `LLM call failed: ${response.status} ${response.statusText} - ${errText}`
      );
    }

    const json: any = await response.json();
    const content = json.choices?.[0]?.message?.content || "";
    log("callLLM.complete", {
      elapsedMs: Date.now() - t0,
      responseLength: content.length,
    });
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJson(content: string): any {
  try {
    return JSON.parse(content.trim());
  } catch {}

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first !== -1 && last !== -1) {
    try {
      return JSON.parse(content.slice(first, last + 1));
    } catch {}
  }

  throw new Error(`Failed to parse JSON from LLM output: ${content}`);
}
