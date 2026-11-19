import 'server-only';

/**
 * Resolve a free-text competency name onto a kamus-kompetensi CODE.
 *
 * WHY THIS EXISTS. The technical aspect pairs a position's required
 * competencies against a candidate's held competencies. Both sides are free
 * text, and until now "the same competency" meant "the same normalized string".
 * That is wrong in one direction that matters: the required side is extracted
 * from job-profile PDFs by an LLM, so it says "Business Process Analyst" where
 * the kamus and the HR sync both say "BUSINESS PROCESS ANALYSIS".
 *
 * The damage is not a cosmetic mismatch. A required competency that resolves to
 * no kamus code has no level vector, so EVERY cell in its column is 0 — and
 * Hungarian maximises, so the candidate competency that should have filled that
 * column is spent on whichever other column scores above zero. In the reported
 * run this paired a candidate's BUSINESS PROCESS ANALYSIS with the position's
 * "Budgeting".
 *
 * THE FIX is to make the kamus CODE the identity, not the string. Once both
 * sides resolve to TC 012 they are the same competency by construction, the
 * pairing is exact, and the level vectors come back.
 *
 * Three tiers, in order, mirroring the job-profile matcher (lib/job-family/ai-match.ts):
 *
 *  1. EXACT — normalized name equals a kamus name. Free, and never cached.
 *  2. FUZZY — deterministic token match, accepted only when UNIQUE. Catches
 *     extraction typos, plurals and suffix variants without a model.
 *  3. AI — a SPELLING corrector, not an interpreter. It picks from the WHOLE
 *     kamus (90 entries fit in one prompt, so unlike a shortlist there is no
 *     chance of the right answer being cut off) and may only say yes when the
 *     two names carry the SAME keywords, differing by typo, inflection, word
 *     order or punctuation. Adding, dropping or substituting a meaningful word
 *     — "Learning & Development" vs "…MANAGEMENT", "Product & Service
 *     Management" vs "…KNOWLEDGE" — must be answered "none", as must expanding
 *     an abbreviation it would have to guess at ("SHE Management"). Cached per
 *     normalized name, rejections included.
 *
 * Two properties are load-bearing and match the job-profile tier's reasoning:
 *
 *  • **A code outside the kamus is rejected on parse.** The model arbitrates
 *    between known entries; it never invents one.
 *  • **"None" is a first-class answer.** "Leadership", "Communication" and
 *    "Problem Solving" are genuinely not technical-dictionary competencies. A
 *    wrong code is worse than no code: it would silently make one competency
 *    stand in for another inside the technical score, where nobody would look.
 */

import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

/** Inline text[] literal — the convention used across lib/*-actions.ts. */
function pgTextArray(values: string[]) {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

export type KamusEntry = { code: string; name: string };

export type KamusResolution = {
  code: string | null;
  tier: 'exact' | 'fuzzy' | 'ai';
  confidence: number | null;
  reason: string | null;
};

/**
 * Below this the AI answer is treated as "no match" regardless of what it picked.
 *
 * 0.9, not the job-profile tier's 0.7, because this tier is deliberately NOT
 * allowed to interpret. Its whole remit is spotting that two strings are the
 * same name spelled differently — a typo, a plural, a reordering. The prompt
 * says that anything below 0.9 means the model is reasoning rather than reading,
 * and this threshold is what makes that instruction binding instead of advisory.
 */
export const KAMUS_AI_MIN_CONFIDENCE = 0.9;

/**
 * Canonical competency name for matching. MUST stay identical to
 * `normalizeCompName` in scoring-service/src/ahp-topsis-engine.ts (and
 * `normalizeKamusName` in scoring-service/src/kamus-codes.ts) — it is the cache
 * key those services look rows up by, so a divergence here silently misses
 * every cached decision. sync-service keeps
 * the same body as `normalizeCompetencyName` in
 * sync-service/src/services/job-profile-competencies.ts.
 */
export function normalizeCompName(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Tier 2: deterministic token match ──────────────────────────────

/**
 * Do two tokens denote the same word, allowing for a typo or an inflection?
 *
 * They must share a prefix of at least 5 characters and each leave at most 3
 * characters unmatched. That is deliberately narrow:
 *
 *   ANALYST   ~ ANALYSIS    prefix 6, leftovers "T" / "IS"      → same
 *   RELATION  ~ RELATIONS   prefix 8, leftovers ""  / "S"       → same
 *   ASSET     ~ ASSETS      prefix 5, leftovers ""  / "S"       → same
 *   RETAIL    ~ RETAILER    prefix 6, leftovers ""  / "ER"      → same
 *   MANAGEMENT~ MANAGER     prefix 6, leftovers "MENT"/"R"      → DIFFERENT
 *   RECRUIT   ~ RECRUITMENT prefix 7, leftovers ""  / "MENT"    → DIFFERENT
 *
 * The last two are the point: a rule loose enough to fold MANAGEMENT into
 * MANAGER would start merging competencies that are genuinely distinct. Names
 * this rule refuses simply fall through to the AI tier, which can weigh them.
 */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= 5 && a.length - i <= 3 && b.length - i <= 3;
}

/**
 * Deterministic tier: same token count, every token pairing off by `sameWord`,
 * and exactly ONE kamus entry satisfying that. Uniqueness is what makes it safe
 * to auto-accept — two plausible entries means the name is genuinely ambiguous
 * and belongs to the tier that can reason about it.
 */
export function fuzzyResolve(nameKey: string, kamus: KamusEntry[]): string | null {
  const queryTokens = nameKey.split(' ').filter(Boolean);
  if (queryTokens.length === 0) return null;

  const hits: string[] = [];
  for (const entry of kamus) {
    const entryTokens = normalizeCompName(entry.name).split(' ').filter(Boolean);
    if (entryTokens.length !== queryTokens.length) continue;
    if (queryTokens.every((t, i) => sameWord(t, entryTokens[i]!))) hits.push(entry.code);
  }
  // Distinct codes only: the same code listed twice is not an ambiguity.
  const unique = Array.from(new Set(hits));
  return unique.length === 1 ? unique[0]! : null;
}

// ── Tier 3: AI arbitration over the whole kamus ────────────────────

function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL || '',
    apiKey: process.env.LLM_API_KEY || 'not-needed',
  };
}

/** True when the app has an LLM endpoint configured for this tier. */
export function kamusAiConfigured(): boolean {
  const { baseUrl, model } = llmConfig();
  return Boolean(baseUrl && model);
}

const SYSTEM_PROMPT = `Anda adalah korektor penulisan nama kompetensi. Anda BUKAN penafsir makna.

Tugas Anda HANYA satu: menentukan apakah sebuah nama kompetensi dan sebuah entri kamus adalah NAMA YANG SAMA yang ditulis berbeda. Bukan apakah keduanya "mirip", "berkaitan", "satu bidang", atau "kira-kira sama maksudnya".

UJI YANG DIPAKAI — bayangkan seorang manusia membandingkan kedua nama kata per kata. Kedua nama dianggap sama HANYA bila HIMPUNAN KATA KUNCI PENYUSUNNYA SAMA, dan perbedaannya semata-mata pada:
  a. salah ketik / huruf tertukar / huruf berulang  — "DocuPment" = "Document"; "KNOWLEDGELEDGE" = "KNOWLEDGE"; "Hukum Bendah" = "Hukum Benda"
  b. bentuk jamak / tunggal / akhiran               — "Industrial Relation" = "INDUSTRIAL RELATIONS"; "Asset" = "ASSETS"; "Technique" = "TECHNIQUES"; "Analyst" = "ANALYSIS"
  c. urutan kata                                     — "Selection & Recruitment Management" = "RECRUITMENT & SELECTION MANAGEMENT"
  d. tanda baca, kurung, spasi, huruf besar/kecil    — "(Two) Wheel" = "2 (TWO) WHEEL"

DILARANG KERAS — semua ini WAJIB dijawab null:
  • MENAMBAH atau MENGHILANGKAN kata bermakna.
    "Learning & Development" BUKAN "LEARNING & DEVELOPMENT MANAGEMENT" — ada kata MANAGEMENT yang tidak ada di sisi lain. Jawab null.
    "Software Application" BUKAN "SOFTWARE APPLICATION OPERATION". Jawab null.
    "Marketing Communication Management" BUKAN "MARKETING COMMUNICATION". Jawab null.
    "System Information (MIS)" BUKAN "MANAGEMENT INFORMATION SYSTEM (MIS)" — ada kata MANAGEMENT yang tidak ada di sisi lain. Jawab null.
  • MENGGANTI sebuah kata dengan kata lain, walau maknanya berdekatan.
    "Product & Service Management" BUKAN "PRODUCT & SERVICE KNOWLEDGE". Jawab null.
    "2 (Two) Wheels Service Knowledge" BUKAN "2 (TWO) WHEEL SERVICE TECHNIQUES". Jawab null.
  • MENERJEMAHKAN, MEMANJANGKAN SINGKATAN, atau menyimpulkan dari konteks/bidang kerja.
    "SHE Management", "2W Vehicle Engineering", "SHC Management" — Anda TIDAK BOLEH menebak kepanjangannya. Jawab null.
  • Memakai pengetahuan Anda sendiri tentang dunia HR atau otomotif untuk menyimpulkan dua istilah itu "pada praktiknya sama". Jawab null.
  • Nama yang jelas bukan kompetensi teknis dalam kamus — "Leadership", "Communication", "Problem Solving", "Coaching", "Target Setting & Monitoring". Jawab null.

Bila Anda perlu BERPIKIR untuk membenarkan sebuah pasangan, itu tandanya pasangan tersebut TIDAK memenuhi syarat. Yang benar hanya yang terlihat langsung sebagai penulisan berbeda dari nama yang sama.

Tidak memetakan TIDAK merugikan: nama yang tidak dipetakan akan ditandai "tidak dapat diukur" dan dikeluarkan dari perhitungan secara jujur. Sebaliknya kode yang salah membuat SATU KOMPETENSI DIPERLAKUKAN SEBAGAI KOMPETENSI LAIN saat menilai kandidat, dan tidak ada yang akan menyadarinya. Karena itu bila ragu sedikit pun — jawab null.

FORMAT JAWABAN — hanya JSON, tanpa penjelasan lain, tanpa markdown:
{"code": "<kode dari daftar atau null>", "confidence": <0..1>, "reason": "<satu kalimat bahasa Indonesia>"}

"confidence": 0.9+ hanya bila perbedaannya murni salah ketik/jamak/urutan kata. Di bawah 0.9 berarti Anda sedang menafsirkan — dan pada kasus itu jawab null.
"reason" menyebut perbedaan penulisan yang Anda temukan (mis. "hanya beda bentuk jamak"), atau kata mana yang tidak punya pasangan sehingga dijawab null.`;

function buildUserPrompt(name: string, kamus: KamusEntry[]): string {
  const options = kamus.map((k) => `${k.code} | ${k.name}`).join('\n');
  return [
    `NAMA KOMPETENSI YANG DIPETAKAN: "${name}"`,
    ``,
    `KAMUS KOMPETENSI RESMI (hanya boleh memilih salah satu kode di bawah, atau null):`,
    options,
    ``,
    `Jawab dengan JSON sesuai format.`,
  ].join('\n');
}

type AiDecision = { code: string | null; confidence: number; reason: string };

/** Pull the first JSON object out of a reply that may be fenced or prefixed. */
function parseDecision(raw: string, allowedCodes: Set<string>): AiDecision | null {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
  const rawCode = obj.code;
  const code =
    rawCode == null || rawCode === 'null' || rawCode === ''
      ? null
      : String(rawCode).trim().toUpperCase();

  // A code outside the kamus is not a choice from the options — treat it as no
  // answer rather than trusting a string the model composed.
  if (code != null && !allowedCodes.has(code)) return null;

  const confidence = Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : 0;
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';

  return {
    code,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason: reason.slice(0, 500),
  };
}

async function callLlm(body: Record<string, unknown>, signal: AbortSignal): Promise<string | null> {
  const { baseUrl, apiKey } = llmConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content ?? null;
}

/**
 * One decision for one name. Returns null when the model is unreachable or
 * answered unusably — the caller treats that as "tier unavailable", never as
 * "no match", so an outage cannot quietly unmap every competency and change
 * scores.
 */
async function aiResolveOne(
  name: string,
  kamus: KamusEntry[],
  timeoutMs: number,
): Promise<AiDecision | null> {
  if (!kamusAiConfigured() || kamus.length === 0) return null;
  const { model } = llmConfig();
  const allowed = new Set(kamus.map((k) => k.code.toUpperCase()));
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(name, kamus) },
  ];
  // temperature 0: a classification whose answer is cached. Two runs disagreeing
  // about one name would move a competency between columns between runs.
  const base = { model, messages, temperature: 0, max_tokens: 300 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let content = await callLlm(
      { ...base, response_format: { type: 'json_object' } },
      controller.signal,
    );
    if (content == null) content = await callLlm(base, controller.signal);
    if (!content) return null;
    return parseDecision(content, allowed);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Orchestration ──────────────────────────────────────────────────

export type ResolveReport = {
  /** name_key → resolution, for every input name. */
  resolved: Map<string, KamusResolution>;
  exactCount: number;
  fuzzyCount: number;
  aiCount: number;
  /** Resolved to a real "no kamus entry means this". */
  noneCount: number;
  /** Names the AI tier could not answer for (unreachable/unusable reply). */
  unresolvedCount: number;
  /** FALSE when the LLM transport looks dead — a banner, not "AI found nothing". */
  aiAvailable: boolean;
  /** Set when the cache table is missing; tiers 1–2 still ran, nothing persisted. */
  migrationNeeded?: string;
};

async function loadKamus(): Promise<KamusEntry[]> {
  const res = await db.execute(sql`
    SELECT code, name FROM sync_kamus_kompetensi
    WHERE code IS NOT NULL AND name IS NOT NULL
    ORDER BY code ASC
  `);
  return (res.rows as any[]).map((r) => ({ code: String(r.code), name: String(r.name) }));
}

/**
 * The resolver degrades to exact-only when its table is absent (migration not
 * run yet) rather than failing the caller — scoring primes through this path,
 * and a pending migration must not block a scoring run. The message is explicit
 * so the settings panel says what to do instead of showing a raw PG error.
 */
export const MIGRATION_MSG =
  'Tabel kamus_competency_match_cache belum ada — jalankan migrasi drizzle/0063_kamus_competency_match_cache.sql (pnpm db:migrate).';

function isMissingTable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /relation "?kamus_competency_match_cache"? does not exist/i.test(msg);
}

async function loadCache(keys: string[]): Promise<Map<string, KamusResolution>> {
  const out = new Map<string, KamusResolution>();
  if (keys.length === 0) return out;
  const res = await db.execute(sql`
    SELECT name_key, code, tier, confidence, reason
    FROM kamus_competency_match_cache
    WHERE name_key = ANY(${pgTextArray(keys)})
  `);
  for (const r of res.rows as any[]) {
    out.set(r.name_key, {
      code: r.code,
      tier: r.tier === 'fuzzy' ? 'fuzzy' : 'ai',
      confidence: r.confidence,
      reason: r.reason,
    });
  }
  return out;
}

async function writeCache(
  key: string,
  name: string,
  res: { code: string | null; tier: 'fuzzy' | 'ai'; confidence: number | null; reason: string | null },
  model: string | null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO kamus_competency_match_cache (name_key, name, code, tier, confidence, reason, model)
    VALUES (${key}, ${name}, ${res.code}, ${res.tier}, ${res.confidence}, ${res.reason}, ${model})
    ON CONFLICT (name_key) DO UPDATE SET
      name = EXCLUDED.name, code = EXCLUDED.code, tier = EXCLUDED.tier,
      confidence = EXCLUDED.confidence, reason = EXCLUDED.reason,
      model = EXCLUDED.model, updated_at = NOW()
  `);
}

/**
 * Resolve a batch of competency names to kamus codes, filling the cache for
 * anything not already decided.
 *
 * Exact matches never touch the cache — they are free to recompute and caching
 * them would only create rows that go stale when the kamus is re-synced.
 */
export async function resolveCompetencyNames(
  names: string[],
  opts?: { concurrency?: number; timeoutMs?: number; skipAi?: boolean; maxAi?: number },
): Promise<ResolveReport> {
  const kamus = await loadKamus();
  const byNorm = new Map<string, string>();
  for (const k of kamus) {
    const key = normalizeCompName(k.name);
    if (key && !byNorm.has(key)) byNorm.set(key, k.code);
  }

  // Distinct normalized names, keeping one original spelling for display.
  const originals = new Map<string, string>();
  for (const n of names) {
    const key = normalizeCompName(n ?? '');
    if (key && !originals.has(key)) originals.set(key, n);
  }

  const resolved = new Map<string, KamusResolution>();
  const report: ResolveReport = {
    resolved,
    exactCount: 0,
    fuzzyCount: 0,
    aiCount: 0,
    noneCount: 0,
    unresolvedCount: 0,
    aiAvailable: true,
  };

  // Tier 1 — exact.
  const pending: string[] = [];
  for (const key of originals.keys()) {
    const code = byNorm.get(key);
    if (code) {
      resolved.set(key, { code, tier: 'exact', confidence: 1, reason: null });
      report.exactCount++;
    } else {
      pending.push(key);
    }
  }
  if (pending.length === 0) return report;

  // Cached decisions (fuzzy and ai alike) short-circuit everything below.
  let cached: Map<string, KamusResolution>;
  try {
    cached = await loadCache(pending);
  } catch (err) {
    if (!isMissingTable(err)) throw err;
    // Exact matches already resolved above and still stand; the rest simply
    // stay pending until the migration is run.
    report.migrationNeeded = MIGRATION_MSG;
    report.unresolvedCount += pending.length;
    return report;
  }
  const stillPending: string[] = [];
  for (const key of pending) {
    const hit = cached.get(key);
    if (hit) {
      resolved.set(key, hit);
      if (hit.tier === 'fuzzy') report.fuzzyCount++;
      else report.aiCount++;
      if (!hit.code) report.noneCount++;
    } else {
      stillPending.push(key);
    }
  }
  if (stillPending.length === 0) return report;

  // Tier 2 — deterministic. Cached so the services can read one table rather
  // than each re-implementing the token rule.
  const forAi: string[] = [];
  for (const key of stillPending) {
    const code = fuzzyResolve(key, kamus);
    if (code) {
      const res = {
        code,
        tier: 'fuzzy' as const,
        confidence: 1,
        reason: 'Kecocokan token deterministik (unik di kamus).',
      };
      resolved.set(key, res);
      report.fuzzyCount++;
      await writeCache(key, originals.get(key)!, res, null);
    } else {
      forAi.push(key);
    }
  }
  if (forAi.length === 0 || opts?.skipAi) {
    report.unresolvedCount += forAi.length;
    return report;
  }

  if (!kamusAiConfigured()) {
    report.aiAvailable = false;
    report.unresolvedCount += forAi.length;
    return report;
  }

  // A cold start can hold up whatever is waiting on this (a scoring run
  // dispatch), so the caller may cap how many names the AI tier handles per
  // invocation. The remainder is REPORTED, never silently dropped — it is
  // simply still pending, and the next call or the manual action finishes it.
  if (opts?.maxAi != null && forAi.length > opts.maxAi) {
    report.unresolvedCount += forAi.length - opts.maxAi;
    forAi.length = opts.maxAi;
  }
  if (forAi.length === 0) return report;

  // Tier 3 — AI, with a small concurrency pool.
  const { model } = llmConfig();
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  let cursor = 0;
  let answered = 0;

  const worker = async () => {
    while (cursor < forAi.length) {
      const key = forAi[cursor++]!;
      const original = originals.get(key)!;
      const decision = await aiResolveOne(original, kamus, timeoutMs);
      if (!decision) {
        report.unresolvedCount++;
        continue;
      }
      answered++;
      // Below the confidence floor the pick is discarded, but the ANSWER is
      // still "none" and is cached: a name the model was unsure about would
      // otherwise cost a call on every run forever.
      const accepted = decision.code && decision.confidence >= KAMUS_AI_MIN_CONFIDENCE;
      const res = {
        code: accepted ? decision.code : null,
        tier: 'ai' as const,
        confidence: decision.confidence,
        reason: accepted
          ? decision.reason
          : decision.code
            ? `Keyakinan ${decision.confidence.toFixed(2)} di bawah ambang ${KAMUS_AI_MIN_CONFIDENCE} — tidak dipetakan. ${decision.reason}`
            : decision.reason,
      };
      resolved.set(key, res);
      report.aiCount++;
      if (!res.code) report.noneCount++;
      await writeCache(key, original, res, model);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, forAi.length) }, worker));

  // Every call failing is an outage, not a kamus with no answers.
  if (answered === 0) report.aiAvailable = false;
  return report;
}
