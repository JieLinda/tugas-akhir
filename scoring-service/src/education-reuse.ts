// Reusing a grounded education answer across runs of the same position.
//
// Education is the criterion whose inputs change least often — a degree and a
// major do not move between two scoring runs of one seat — yet it is the only
// one scored by a grounded model call, which costs tokens and search quota and
// is not reproducible: temperature 0 removes sampling noise, but Google Search
// results do not hold still. So two runs over identical data could disagree on
// education for no reason the data can explain, which undercuts the claim that
// AHP+TOPSIS is deterministic.
//
// Before calling the model for a candidate, the engine therefore looks at the
// LAST completed AHP+TOPSIS run of the same position. If that run asked the
// model about this candidate with IDENTICAL inputs, its answer is reused instead
// of asking again.
//
// "Identical inputs" means the whole question the model was asked, not only the
// two fields that motivated this: the candidate's education and major, the
// position's education requirement, AND the position title, job purpose and the
// responsibilities + success indicators the judgement is anchored on, plus the
// system prompt and the model settings. If any of those moved (a job profile
// re-extracted, the prompt edited in Tata Kelola, another Gemini model), the old
// answer replied to a different question and is not reused. The candidate's
// NAME is the one part of the prompt left out: it identifies, it is not evidence,
// and leaving it in would defeat reuse in demo mode, where names are masked.
//
// What is reused is the MODEL's answer (its two rubric numbers, reason, search
// queries and sources) — never the composed score. The level axis is decided by
// rule (`compareEducationLevel`) and is recomposed on every run, so a change to
// that rule still reaches every candidate.
//
// Only answers carry over. An exact match is a deterministic rule and is simply
// recomputed; a failed call ("tidak dinilai") is never reused, so a transient
// outage cannot be frozen into later runs.

import { createHash } from "node:crypto";
import { query } from "./db/postgres.js";
import { log } from "./llm.js";

/**
 * Bump whenever what the key covers changes, so a key computed under the old
 * definition can never equal one computed under the new.
 */
export const EDUCATION_INPUT_KEY_VERSION = 1;

/** Fixed stand-in for the candidate's name when the prompt is keyed. */
const KEY_NAME_PLACEHOLDER = "";

export type EducationPromptInput = {
  education: string | null;
  major: string | null;
  requirement: string | null;
  positionTitle: string;
  jobPurpose: string | null;
  responsibilityDetails: { responsibility: string; successIndicator: string | null }[];
};

/** The Gemini settings that change what an answer means. */
export type EducationModelSettings = {
  model: string;
  grounding: boolean;
  groundingTool: string;
  temperature: number;
  topP: number;
};

/**
 * The user prompt of the grounded education call, byte for byte. Lives here so
 * the text the model is sent and the text the reuse key is computed from are one
 * function and cannot drift apart.
 */
export function buildEducationUserPrompt(candidateName: string, input: EducationPromptInput): string {
  const educationText = `${input.education ?? "-"} | ${input.major ?? "-"}`;
  // The stated minimum education is only supporting context — the judgement is
  // driven by the responsibilities + success indicators below.
  const reqBlock = input.requirement
    ? `Syarat minimal pendidikan (konteks tambahan): ${input.requirement}\n`
    : "Syarat minimal pendidikan (konteks tambahan): (tidak dinyatakan eksplisit)\n";
  const purposeBlock =
    input.jobPurpose && input.jobPurpose.trim()
      ? `Tujuan Jabatan (job purpose): ${input.jobPurpose.trim()}\n`
      : "";
  const respBlock =
    input.responsibilityDetails.length > 0
      ? `Tanggung Jawab Utama & Indikator Keberhasilan:\n${input.responsibilityDetails
          .slice(0, 10)
          .map(
            (r, i) =>
              `${i + 1}. ${r.responsibility}${
                r.successIndicator ? `\n   → Indikator keberhasilan: ${r.successIndicator}` : ""
              }`,
          )
          .join("\n")}\n`
      : "";

  return `
Nilai apakah latar belakang pendidikan kandidat berikut SESUAI untuk mengerjakan tanggung jawab dan mencapai indikator keberhasilan posisi [${input.positionTitle}].
Gunakan Grounding with Google Search untuk memverifikasi kesesuaian JENJANG dan relevansi JURUSAN terhadap tanggung jawab & indikator keberhasilan di bawah, lalu kutip sumbernya di dalam "reason".

Kandidat: ${candidateName}
Pendidikan (jenjang | jurusan): ${educationText}
${reqBlock}${purposeBlock}${respBlock}
Pertanyaan kunci: apakah lulusan dengan jenjang & jurusan tersebut sesuai untuk mengerjakan tanggung jawab dan mencapai indikator keberhasilan di atas? Dasarkan penilaian pada tanggung jawab & indikator keberhasilan, bukan hanya syarat minimal pendidikan.

CATATAN PENTING soal "education_level": nilai ini TIDAK dipakai untuk menentukan
apakah jenjang kandidat memenuhi syarat minimal — itu sudah ditetapkan oleh aturan
tetap aplikasi di luar penilaian Anda. Jawablah "education_level" murni sebagai
penilaian RELEVANSI: seberapa sesuai KEDALAMAN/JENIS jenjang itu dengan tuntutan
tanggung jawab di atas. Kedua nilai yang Anda kembalikan akan digabung menjadi
satu sumbu relevansi.

Kembalikan HANYA JSON: {"education_level": <0-100>, "major_relevance": <0-100>, "reason": "..."}
  `.trim();
}

/**
 * Fingerprint of everything the model reads for one candidate, minus the name:
 * the system prompt, the user prompt (education, major, requirement, title, job
 * purpose, responsibilities and indicators) and the model settings. Two equal
 * keys mean the model was asked the same question.
 */
export function educationInputKey(
  systemPrompt: string,
  input: EducationPromptInput,
  settings: EducationModelSettings,
): string {
  const payload = JSON.stringify({
    v: EDUCATION_INPUT_KEY_VERSION,
    system: systemPrompt,
    user: buildEducationUserPrompt(KEY_NAME_PLACEHOLDER, input),
    model: settings.model,
    grounding: settings.grounding,
    groundingTool: settings.grounding ? settings.groundingTool : null,
    temperature: settings.temperature,
    topP: settings.topP,
  });
  return createHash("sha256").update(payload).digest("hex");
}

/** Where a reused answer came from. Stored on the evaluation it produced. */
export type EducationReuseProvenance = {
  /** The run the answer was copied from (the last run of the position). */
  runId: string;
  /** The run in which the model actually answered — earlier, if that run reused too. */
  answeredInRunId: string;
  /** When that run completed (ISO), null when it recorded no completion time. */
  answeredAt: string | null;
};

export type ReusableEducationAnswer = {
  inputKey: string;
  source: "llm-grounded" | "llm-structured";
  educationLevel: number;
  majorRelevance: number;
  reason: string | null;
  searchQueries: string[];
  sources: { title: string; uri: string }[];
  provenance: EducationReuseProvenance;
};

export type EducationReuseSource = {
  runId: string;
  completedAt: string | null;
  /** Candidate id → the model answer that run holds for them. */
  answers: Map<string, ReusableEducationAnswer>;
};

function parseJson(value: unknown): any {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The reusable answers in a run's `scoring_run_pool_aspects` rows (every scored
 * candidate, finalist or not). Pure, so it is tested without a database.
 *
 * A row qualifies only when its evaluation came from the model AND recorded the
 * key it was asked under: an exact match needs no model, a failure is not an
 * answer, and an evaluation from before keys existed cannot prove what it was
 * asked — so it is asked again once, after which the next run can reuse it.
 */
export function reusableAnswersFromPoolRows(
  runId: string,
  completedAt: string | null,
  rows: { candidateId: string; details: unknown }[],
): Map<string, ReusableEducationAnswer> {
  const out = new Map<string, ReusableEducationAnswer>();
  for (const row of rows) {
    const e = parseJson(row.details)?.educationEval;
    if (!e || (e.source !== "llm-grounded" && e.source !== "llm-structured")) continue;
    if (typeof e.inputKey !== "string" || e.inputKey.length === 0) continue;
    if (!finite(e.educationLevel) || !finite(e.majorRelevance)) continue;
    const prior = e.reusedFrom;
    out.set(row.candidateId, {
      inputKey: e.inputKey,
      source: e.source,
      educationLevel: e.educationLevel,
      majorRelevance: e.majorRelevance,
      reason: typeof e.reason === "string" ? e.reason : null,
      searchQueries: Array.isArray(e.searchQueries) ? e.searchQueries : [],
      sources: Array.isArray(e.sources) ? e.sources : [],
      provenance: {
        runId,
        // A chain of reuses still names the run in which the model really spoke.
        answeredInRunId:
          prior && typeof prior.answeredInRunId === "string" ? prior.answeredInRunId : runId,
        answeredAt:
          prior && typeof prior.answeredInRunId === "string"
            ? (typeof prior.answeredAt === "string" ? prior.answeredAt : null)
            : completedAt,
      },
    });
  }
  return out;
}

/**
 * The answer to reuse for one candidate, or null to ask the model. Equal keys
 * are the whole test: the key already covers every input the model reads.
 */
export function reusableAnswerFor(
  source: EducationReuseSource | null,
  candidateId: string,
  inputKey: string,
): ReusableEducationAnswer | null {
  const hit = source?.answers.get(candidateId);
  return hit && hit.inputKey === inputKey ? hit : null;
}

/**
 * The last completed AHP+TOPSIS run of this position — same demo/real mode, the
 * run being scored excluded — with its reusable answers. Null when there is no
 * such run or it cannot be read; reuse is an optimisation, so a failed read
 * costs model calls, never a scoring run.
 */
export async function loadEducationReuseSource(
  positionId: string,
  isDemo: boolean,
  currentRunId: string | null,
): Promise<EducationReuseSource | null> {
  try {
    const runs = await query<{ id: string; completedAt: Date | string | null }>(
      `SELECT id, completed_at AS "completedAt"
         FROM scoring_runs
        WHERE position_id = $1
          AND method = 'AHP_TOPSIS'
          AND status = 'completed'
          AND is_demo = $2
          AND ($3::uuid IS NULL OR id <> $3::uuid)
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [positionId, isDemo, currentRunId],
    );
    const run = runs[0];
    if (!run) return null;
    const completedAt =
      run.completedAt == null
        ? null
        : run.completedAt instanceof Date
          ? run.completedAt.toISOString()
          : String(run.completedAt);
    const rows = await query<{ candidateId: string; details: unknown }>(
      `SELECT candidate_id AS "candidateId", details
         FROM scoring_run_pool_aspects
        WHERE run_id = $1`,
      [run.id],
    );
    return {
      runId: run.id,
      completedAt,
      answers: reusableAnswersFromPoolRows(run.id, completedAt, rows),
    };
  } catch (err) {
    // Logged, not swallowed: a read that fails every time would otherwise look
    // exactly like "nothing to reuse" and quietly cost every call forever.
    log("ahpTopsis.educationReuseLoadFailed", {
      positionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
