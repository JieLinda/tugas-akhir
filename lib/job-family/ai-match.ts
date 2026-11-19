import 'server-only';

/**
 * Last-resort job-profile matching tier: ask an LLM to pick the right JD for a
 * position title the deterministic tiers could not place.
 *
 * The three tiers above this one are exact by construction — a position code in
 * a file name, an identical title, a >98% cosine. What is left over is the long
 * tail they cannot express: abbreviations ("SPV ADM GUDANG"), reordered words,
 * local spellings, and titles written from the org chart rather than from the
 * JD. A human reading the shortlist resolves most of those in seconds, which is
 * exactly the judgement this tier borrows.
 *
 * Two properties keep it honest:
 *
 *  • **It can only choose from a shortlist.** The model never sees the whole
 *    catalogue and never invents an id — it picks one of the ids handed to it,
 *    or none. The shortlist comes from the embedding ranking, so the model is
 *    arbitrating between plausible options rather than searching.
 *
 *  • **"None" is a valid, encouraged answer.** A wrong JD is worse than no JD:
 *    it silently changes a candidate's technical and career scores during
 *    AHP+TOPSIS scoring, where nobody would think to look for it. The prompt
 *    says so, and a decision below MIN_CONFIDENCE is discarded here as well.
 */

export type AiShortlistProfile = {
  id: number;
  positionName: string;
  divisionDepartment: string | null;
  /** First lines of the JD's stated purpose — the strongest disambiguator. */
  jobPurpose: string | null;
  /** Cosine similarity from the embedding ranking, when available. */
  similarity: number | null;
};

export type AiMatchRequest = {
  /** The position title to place. */
  title: string;
  /** Divisions/departments observed for people holding this title. */
  departments: string[];
  shortlist: AiShortlistProfile[];
};

export type AiMatchDecision = {
  /** Chosen job profile, or null when none of the options is the same role. */
  jobProfileId: number | null;
  /** Model's own 0..1 confidence. */
  confidence: number;
  /** One-sentence Indonesian justification, shown in the match detail dialog. */
  reason: string;
};

/** Below this the answer is treated as "no match" regardless of what was picked. */
export const AI_MATCH_MIN_CONFIDENCE = 0.7;

/** Options handed to the model per title. Enough to contain the right answer,
 *  few enough that it compares them properly. */
export const AI_MATCH_SHORTLIST_SIZE = 10;

function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || '').replace(/\/+$/, ''),
    model: process.env.LLM_MODEL || '',
    apiKey: process.env.LLM_API_KEY || 'not-needed',
  };
}

/** True when the app has an LLM endpoint configured for this tier. */
export function aiMatchConfigured(): boolean {
  const { baseUrl, model } = llmConfig();
  return Boolean(baseUrl && model);
}

export function aiMatchModelName(): string {
  return llmConfig().model;
}

const SYSTEM_PROMPT = `Anda adalah analis SDM senior yang memasangkan JABATAN (posisi pada struktur organisasi) dengan DOKUMEN JOB PROFILE / JD yang tepat.

Tugas Anda: dari daftar kandidat JD yang diberikan, pilih SATU yang mendeskripsikan pekerjaan yang SAMA dengan jabatan tersebut — atau nyatakan tidak ada yang cocok.

ATURAN KEPUTUSAN (urut kepentingan):
1. FUNGSI harus sama. Bidang kerja yang berbeda tidak pernah cocok walau kata-katanya mirip (Finance ≠ HR, Sales ≠ Service, Produksi ≠ Purchasing).
2. TINGKAT/LEVEL harus sama. Head ≠ Section Head ≠ Supervisor ≠ Officer ≠ Staff ≠ Admin. Jabatan "Supervisor Gudang" TIDAK cocok dengan JD "Head of Warehouse".
3. Singkatan, urutan kata, ejaan lokal, dan campuran Indonesia–Inggris WAJAR dan boleh dianggap sama bila fungsinya identik. Contoh: "SPV ADM GUDANG" = "Supervisor Administrasi Gudang"; "KA. BENGKEL" = "Kepala Bengkel"; "MRKT" = "Marketing"; "Adm" = "Administrasi"; "Ass." = "Assistant".
4. Cakupan area/cabang/produk yang berbeda pada fungsi dan level yang sama masih boleh cocok bila JD tidak spesifik ke area tersebut (mis. "Sales Supervisor Area 3" dengan JD "Sales Supervisor").
5. Gunakan "Divisi/Departemen" dan "Tujuan jabatan" pada tiap opsi untuk membedakan JD yang namanya mirip. Bila dua opsi sama-sama masuk akal, pilih yang divisi/departemennya paling sesuai dengan konteks jabatan.
6. Nilai kemiripan (embedding) hanyalah petunjuk urutan — BUKAN bukti. Opsi dengan kemiripan tertinggi sering salah level; periksa sendiri fungsi dan levelnya.

JAWAB "TIDAK ADA" (jobProfileId = null) BILA:
- tidak ada opsi yang fungsinya sama, ATAU
- opsi terdekat berbeda level/tanggung jawab, ATAU
- Anda ragu.
Memasangkan JD yang salah LEBIH BURUK daripada tidak memasangkan sama sekali: JD dipakai menilai kompetensi teknis dan relevansi karier kandidat, sehingga pasangan yang salah menghasilkan penilaian yang salah tanpa ada yang menyadarinya.

FORMAT JAWABAN — hanya JSON, tanpa penjelasan lain, tanpa markdown:
{"jobProfileId": <angka id dari daftar atau null>, "confidence": <0..1>, "reason": "<satu kalimat bahasa Indonesia>"}

"confidence" adalah keyakinan Anda bahwa pasangan itu benar: 0.9+ bila nama dan level praktis identik, 0.7-0.9 bila yakin setelah menimbang singkatan/urutan kata, di bawah 0.7 bila menebak (dan pada kasus itu jawab null).
"reason" menyebut alasan konkret (kesamaan fungsi, level, divisi), bukan mengulang nama saja. Bila null, jelaskan apa yang membuat semua opsi tidak cocok.`;

function buildUserPrompt(req: AiMatchRequest): string {
  const options = req.shortlist
    .map((p, index) => {
      const lines = [
        `${index + 1}. id=${p.id} | nama JD: "${p.positionName}"`,
        `   Divisi/Departemen: ${p.divisionDepartment?.trim() || '(tidak tercantum)'}`,
      ];
      if (p.similarity != null) {
        lines.push(`   Kemiripan embedding: ${(p.similarity * 100).toFixed(1)}%`);
      }
      const purpose = p.jobPurpose?.replace(/\s+/g, ' ').trim();
      if (purpose) lines.push(`   Tujuan jabatan: ${purpose.slice(0, 300)}`);
      return lines.join('\n');
    })
    .join('\n');

  const departments = req.departments.filter(Boolean).slice(0, 6);

  return [
    `JABATAN YANG DICARIKAN JD:`,
    `Nama jabatan: "${req.title}"`,
    departments.length > 0
      ? `Divisi/Departemen pemangku jabatan ini: ${departments.join('; ')}`
      : `Divisi/Departemen pemangku jabatan ini: (tidak diketahui)`,
    ``,
    `DAFTAR KANDIDAT JD (hanya boleh memilih salah satu id di bawah, atau null):`,
    options,
    ``,
    `Jawab dengan JSON sesuai format.`,
  ].join('\n');
}

/** Pull the first JSON object out of a reply that may be fenced or prefixed. */
function parseDecision(raw: string, allowedIds: Set<number>): AiMatchDecision | null {
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
  const rawId = obj.jobProfileId;
  const id =
    rawId == null || rawId === 'null'
      ? null
      : Number.isFinite(Number(rawId))
        ? Number(rawId)
        : null;

  // A model that answers with an id outside the shortlist has not chosen from
  // the options — treat that as no answer rather than trusting the number.
  if (id != null && !allowedIds.has(id)) return null;

  const confidence = Number.isFinite(Number(obj.confidence)) ? Number(obj.confidence) : 0;
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';

  return {
    jobProfileId: id,
    confidence: Math.max(0, Math.min(1, confidence)),
    reason: reason.slice(0, 500),
  };
}

async function callLlm(body: Record<string, unknown>, signal: AbortSignal): Promise<string | null> {
  const { baseUrl, apiKey } = llmConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? null;
}

/**
 * One decision for one title. Returns null when the model is unreachable or
 * answered unusably — the caller treats that as "tier unavailable", never as
 * "no match", so an outage cannot quietly unmatch anybody.
 */
export async function aiMatchTitle(
  req: AiMatchRequest,
  opts?: { timeoutMs?: number },
): Promise<AiMatchDecision | null> {
  if (!aiMatchConfigured() || req.shortlist.length === 0) return null;

  const { model } = llmConfig();
  const allowedIds = new Set(req.shortlist.map((p) => p.id));
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(req) },
  ];
  // temperature 0: this is a classification, and the answer is cached — two runs
  // disagreeing about the same title would show up as the report reshuffling
  // itself between page loads.
  const base = { model, messages, temperature: 0, max_tokens: 400 };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 30_000);
  try {
    // Ask for JSON mode first; servers that reject the field get a plain retry
    // (the prompt already demands bare JSON, so the parse path is the same).
    let content = await callLlm(
      { ...base, response_format: { type: 'json_object' } },
      controller.signal,
    );
    if (content == null) content = await callLlm(base, controller.signal);
    if (!content) return null;
    return parseDecision(content, allowedIds);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve many titles with a small concurrency pool.
 *
 * Returns one entry per input title (a null decision means "no answer for this
 * one"), plus `available`: false when the transport itself looks dead, so the
 * caller can report a degraded tier instead of a run where the AI "found
 * nothing".
 */
export async function aiMatchTitles(
  requests: AiMatchRequest[],
  opts?: { concurrency?: number; timeoutMs?: number },
): Promise<{ available: boolean; decisions: Map<string, AiMatchDecision> }> {
  const decisions = new Map<string, AiMatchDecision>();
  if (!aiMatchConfigured()) return { available: false, decisions };
  if (requests.length === 0) return { available: true, decisions };

  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  let cursor = 0;
  let answered = 0;
  let attempted = 0;

  async function worker() {
    while (cursor < requests.length) {
      const index = cursor++;
      const req = requests[index]!;
      attempted++;
      const decision = await aiMatchTitle(req, { timeoutMs: opts?.timeoutMs });
      if (decision) {
        answered++;
        decisions.set(req.title, decision);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));

  // Every single call failing is an outage, not a catalogue with no answers.
  const available = answered > 0 || attempted === 0;
  return { available, decisions };
}
