// LLM insight writer for AHP+TOPSIS runs.
//
// WHY THIS EXISTS
// The AHP+TOPSIS ranking is deterministic and that is its whole value — but the
// narrative attached to it was six canned sentences keyed by aspect and cut at a
// threshold (buildNarrative() in ahp-topsis-engine.ts). Every candidate whose
// technical score fell below 60 received the identical line "Ikutkan
// pelatihan/sertifikasi teknis yang menutup gap kompetensi posisi target." — a
// sentence that names no competency, no position and no person, and is therefore
// unusable in a succession review. The numbers were defensible; the words were not.
//
// One call per finalist, bounded concurrency, a governance-editable guideline —
// and the evidence it is handed is what this engine computes: the Hungarian
// assignment knows which required competency is short and by how many levels,
// the career aspect knows which stints matched which job profile, education
// carries its own reasoning. That is what makes an insight specific instead of
// generic.
//
// NOT IN DEMO MODE. A demo-mode run never calls this writer (the engine skips
// it), so its finalists keep the deterministic narrative and no demo data is
// sent to a model to be written about. runInfo.narrative.disabledBy says so.
//
// WHAT IT MAY AND MAY NOT TOUCH
// Prose only: strengths, weaknesses, recommendations. It never sees a weight, never
// returns a number, and nothing it produces is read back into the aspect scores,
// the closeness coefficient, the rank or the readiness band. `justification` also
// stays deterministic — it states the method and the closeness coefficient, which
// is an audit statement, not commentary. A reader who wants to know how the
// ranking was produced must not be reading generated text.
//
// Failure is per-candidate and silent to the run: any candidate whose call fails,
// times out or comes back unparseable keeps the deterministic narrative, and the
// mix is reported in scoring_runs.run_info.narrative so a templated bullet is
// never mistaken for a written one.

import { callLLM, extractJson, log } from "./llm.js";
import { config } from "./config.js";
import { getPrompt } from "./prompts.js";
import type {
  AhpCriterionKey,
  CareerDetail,
  EducationEvaluation,
  TechnicalDetail,
} from "./ahp-topsis-engine.js";

/** The three arrays the dossier renders. Same shape buildNarrative() returns. */
export type AhpNarrativeEntry = {
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
};

export type AhpNarrativeInput = {
  rank: number;
  weightedScore: number;
  readiness: string;
  aspectScores: Record<AhpCriterionKey, number>;
  candidate: {
    id: string;
    name: string;
    currentPosition: string | null;
    gradeLevel: string | null;
    yearsExperience: number | null;
    education: string | null;
    major: string | null;
    behaviorRecommendation: string | null;
    behaviorNotes: string | null;
    havQuadrant: string | null;
    performanceGrade: string | null;
  };
  technical: TechnicalDetail | null;
  career: CareerDetail | null;
  education: EducationEvaluation | null;
};

export type AhpNarrativePosition = {
  title: string;
  department: string | null;
  division: string | null;
  /** critical_positions.experience — the seat's stated experience requirement. */
  experienceRequirement: string | null;
  /** Primary holder, when the seat has one. Names who currently does this work. */
  holderNames: string[];
  jobProfileName: string | null;
  jobPurpose: string | null;
  responsibilities: { responsibility: string; successIndicator: string | null }[];
  educationRequirement: string | null;
};

/**
 * The editable guideline. Deliberately explicit about the three UI headings it
 * feeds — the model cannot see the page, and prose written for "strengths" in the
 * abstract lands under "Keunggulan Kompetitif" next to a competency table, where a
 * generic line is visibly out of place.
 */
const AHP_NARRATIVE_PROMPT_DEFAULT = `Anda adalah talent advisor senior yang menulis catatan suksesi untuk MANAJEMEN, berdasarkan hasil penilaian AHP + TOPSIS yang SUDAH selesai dihitung.

Skor, peringkat dan kesiapan kandidat sudah final dan TIDAK boleh Anda ubah, tawar, atau perdebatkan. Tugas Anda satu-satunya: menjelaskan APA ARTINYA bagi keputusan suksesi, dengan bukti yang ada di data.

Anda menulis tiga bagian yang akan tampil apa adanya pada dosier kandidat:
1. "Keunggulan Kompetitif" (strengths) — modal nyata yang kandidat ini bawa ke JABATAN TARGET. Sebut kompetensi, jabatan, kuadran, atau tren yang menjadi buktinya, lalu jelaskan mengapa hal itu penting bagi tanggung jawab jabatan tersebut. Bukan "skor teknis tinggi", tetapi kemampuan apa yang membuat tanggung jawab mana jadi lebih aman.
2. "Kebutuhan Pengembangan" (weaknesses) — kesenjangan NYATA terhadap tuntutan jabatan, beserta AKIBATNYA bila dibiarkan. Sebut nama kompetensi yang kurang dan selisih levelnya, atau pengalaman yang belum pernah dijalani, lalu kaitkan ke tugas yang akan terganggu.
3. "Arahan Langkah Suksesi & Penugasan" (recommendations) — tiap butir HARUS dapat dieksekusi dan berisi tiga hal: TINDAKAN konkret (penugasan, rotasi, proyek, mentoring, pelatihan/sertifikasi bernama), HASIL yang ditagih, dan RENTANG WAKTU. Sertakan satu butir berupa arahan keputusan: siap diangkat sekarang / kembangkan lalu tinjau ulang dalam X bulan / belum sesuai untuk jabatan ini. Penugasan harus masuk akal dengan lingkup jabatan target dan unit kerjanya.

ATURAN:
- WAJIB berpijak pada data yang diberikan. Sebut nama kompetensi, jabatan, atau angka persis seperti tertulis. Dilarang mengarang proyek, sertifikasi internal, nama orang, atau pengalaman yang tidak tercantum.
- JANGAN menarasikan ulang skor ("Technical 62, Behavior 50"). Angka boleh dipakai sebagai bukti singkat, tetapi kalimatnya harus tentang konsekuensi bagi jabatan, bukan tentang nilainya.
- JANGAN membandingkan dengan kandidat lain, jangan menyebut peringkat sebagai alasan, dan jangan menulis "kandidat terbaik". Peringkat sudah ditentukan oleh perhitungan.
- Bila sebuah aspek tidak punya data (ditandai "tidak tersedia"), sebut keterbatasannya pada Kebutuhan Pengembangan sebagai hal yang perlu dilengkapi — jangan menyimpulkan kandidat lemah pada aspek itu.
- KHUSUS Performance Appraisal: periode bertanda "(default)" dan keterangan "TIDAK ADA nilai PA tersimpan" berarti kinerja DIBACA memenuhi standar (C). Itu bukan temuan. JANGAN menulis kinerja tidak konsisten, menurun, atau bermasalah atas dasar itu, dan JANGAN mengutip skor aspek Performance Appraisal sebagai buktinya — skor rendah pada aspek ini adalah konsekuensi aritmetika dari nilai C, bukan pengukuran prestasi. Yang boleh dinilai hanya pola dari nilai yang BENAR-BENAR tercatat.
- Setiap butir 1-2 kalimat, spesifik, tanpa basa-basi pembuka. Bahasa Indonesia profesional.
- Jumlah butir menyesuaikan kekayaan data: Keunggulan 2-4, Kebutuhan 2-4, Arahan 3-5.`;

const CRITERION_LABEL_ID: Record<AhpCriterionKey, string> = {
  technical: "Kompetensi teknis",
  career: "Relevansi jejak karier",
  behavior: "Asesmen behavior",
  performance: "Performance appraisal",
  hav: "Pemetaan HAV",
  education: "Latar pendidikan",
};

/** Q-group wording used across the app, kept identical so labels don't diverge. */
function havGroupLabel(quadrant: string | null): string {
  if (!quadrant) return "tidak tersedia";
  if (quadrant === "1") return "Highly Recommended (Q1)";
  const n = parseInt(quadrant.replace(/\D/g, ""), 10);
  if ([2, 3, 4, 7, 8].includes(n)) return "Recommended";
  if ([5, 6, 9, 13, 14].includes(n)) return "Belum Bisa Direkomendasikan";
  if ([10, 11, 12, 15].includes(n)) return "Not Recommended";
  if (n === 16) return "Bottom (Q16)";
  return "tidak diketahui";
}

/**
 * PA history as text. An empty semester reads as C, because that is exactly what
 * scorePerformanceAspect() scored — presenting it as missing would have the note
 * arguing from an absence the number never had.
 */
function performanceLine(grade: string | null): string {
  const year = new Date().getFullYear();
  const parts = (grade ?? "").split(",").map((p) => p.trim());
  const anyRecorded = parts.some((p) => p !== "");
  const rendered = parts
    .slice(0, 6)
    .map((p, idx) => {
      const label = `${year - 1 - Math.floor(idx / 2)} S${idx % 2 === 0 ? 2 : 1}`;
      return `${label}: ${p || "C"}${p ? "" : " (default)"}`;
    })
    .join(", ");
  if (!anyRecorded) {
    // Spelled out because the first live run did the opposite: the model read the
    // defaulted PA as "inkonsistensi pencapaian target kinerja" and cited the
    // aspect score (33 — which IS the all-C default) as the evidence for it.
    return (
      "TIDAK ADA nilai PA tersimpan untuk kandidat ini. Seluruh periode dibaca sebagai C " +
      "(memenuhi standar) — ini BUKAN bukti kinerja buruk, menurun, atau tidak konsisten. " +
      `Rincian: ${rendered}`
    );
  }
  return rendered;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * The competency table, weakest first.
 *
 * Weakest-first and capped at eight: an unmet requirement explains a rocky first
 * quarter, while the twentieth comfortably-met one explains nothing and costs
 * prompt budget. `unmatched` entries are listed explicitly rather than omitted —
 * "the candidate has nothing resembling this requirement" is the strongest signal
 * in the whole block, and silence would read as a pass.
 */
function technicalBlock(detail: TechnicalDetail | null): string {
  if (!detail || detail.pairs.length === 0) {
    return "  • tidak tersedia (posisi tidak punya acuan kompetensi yang dapat dipakai)";
  }
  const sorted = [...detail.pairs].sort((a, b) => a.value - b.value).slice(0, 8);
  const lines = sorted.map((p) => {
    const req = `${p.required.name} (dituntut level ${p.required.level})`;
    if (p.matchType === "unmatched" || !p.candidate) {
      return `  • ${req} — TIDAK ADA padanan pada kompetensi kandidat`;
    }
    const gap = p.required.level - p.candidate.level;
    const gapText =
      gap > 0 ? `kurang ${gap} level` : gap < 0 ? `melebihi ${Math.abs(gap)} level` : "sesuai level";
    const via = p.matchType === "semantic" ? ", padanan semantik" : "";
    return `  • ${req} — dimiliki "${p.candidate.name}" level ${p.candidate.level} (${gapText}${via})`;
  });
  const met = detail.pairs.filter((p) => p.matchType !== "unmatched").length;
  lines.push(
    `  • ringkasan: ${met}/${detail.requiredCount} kompetensi wajib punya padanan; kandidat mencatat ${detail.candidateCount} kompetensi` +
      (detail.surplusCandidates.length > 0
        ? `, ${detail.surplusCandidates.length} di antaranya di luar daftar tuntutan`
        : "")
  );
  if (detail.requiredSource !== "profile") {
    lines.push(
      `  • CATATAN: acuan kompetensi bukan dari job profile jabatan, melainkan ${detail.requiredSource}` +
        `${detail.requiredSourceDetail ? ` (${detail.requiredSourceDetail})` : ""}`
    );
  }
  return lines.join("\n");
}

/**
 * Where the experience yardstick came from, in words. The raw enum leaks into the
 * narrative otherwise, and `pool` in particular needs saying out loud: it means
 * the score was measured against whoever else happened to be in that run, so it
 * is not comparable with a later one. Only historical runs can carry it.
 */
function targetSourceLabel(source: CareerDetail["targetSource"]): string {
  switch (source) {
    case "jd":
      return "dari syarat pengalaman di job profile jabatan sasaran";
    case "fixed":
      return "standar tetap, sama untuk setiap run";
    case "inherited":
      return "diwarisi dari run dasar";
    case "pool":
      return "aturan lama: diturunkan dari isi pool run itu, sehingga tidak sebanding dengan run setelahnya";
    default:
      return source;
  }
}

/**
 * Career: how much RELEVANT experience accumulated, and against what yardstick.
 * The binding axis matters for the recommendation — someone short on relevant
 * years needs time in a relevant seat, someone short on breadth needs a different
 * assignment, and those are different development plans.
 */
function careerBlock(detail: CareerDetail | null): string {
  if (!detail) return "  • tidak tersedia";
  const lines = [
    `  • pengalaman relevan terakumulasi: ${detail.effectiveYears.toFixed(1)} tahun efektif dari ${detail.totalYears.toFixed(1)} tahun total masa kerja` +
      `, ${detail.effectiveRows.toFixed(1)} penugasan efektif`,
    `  • target pembanding: ${detail.targetYears.toFixed(1)} tahun / ${detail.targetRows.toFixed(1)} penugasan (${targetSourceLabel(detail.targetSource)})` +
      `; yang paling menekan skor adalah sisi ${detail.binding === "years" ? "lama waktu di bidang relevan" : "keragaman penugasan"}`,
  ];
  const scored = detail.pairs
    .filter((p) => p.similarity != null)
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  for (const p of scored.slice(0, 5)) {
    // The recency factor is named only when it actually cost something. Printing
    // "penyusutan 100%" on every current stint would bury the cases that matter.
    const decayed = p.recencyFactor < 0.95;
    lines.push(
      `  • ${p.title}${p.isCurrent ? " (sekarang)" : ""} — ${p.years.toFixed(1)} th, relevansi ${(
        (p.similarity ?? 0) * 100
      ).toFixed(0)}%` +
        (p.jobProfileName ? ` terhadap "${truncate(p.jobProfileName, 60)}"` : "") +
        (p.basis === "incumbent_competency"
          ? " (dinilai dari kompetensi pejabat, bukan dokumen job profile — berbobot lebih rendah)"
          : "") +
        (decayed
          ? `, dihitung ${(p.recencyFactor * 100).toFixed(0)}% karena penugasan ini sudah lama berakhir`
          : "")
    );
  }
  if (detail.unmatchedCount > 0) {
    lines.push(
      `  • ${detail.unmatchedCount} penugasan (${detail.unscoredYears.toFixed(1)} th) tidak dapat dinilai relevansinya — job profile-nya tidak ditemukan`
    );
  }
  return lines.join("\n");
}

function educationBlock(candidate: AhpNarrativeInput["candidate"], evaluation: EducationEvaluation | null): string {
  const base = `  • ${candidate.education ?? "tidak tersedia"}${candidate.major ? ` — ${candidate.major}` : ""}`;
  if (!evaluation) return base;
  const lines = [base];
  if (evaluation.source === "none") {
    lines.push(`  • belum dinilai relevansinya (${truncate(evaluation.reason ?? "alasan tidak dicatat", 160)})`);
  } else if (evaluation.reason) {
    lines.push(`  • penilaian relevansi: ${truncate(evaluation.reason, 400)}`);
  }
  return lines.join("\n");
}

function buildUserPrompt(position: AhpNarrativePosition, input: AhpNarrativeInput): string {
  const c = input.candidate;
  const aspects = (Object.keys(CRITERION_LABEL_ID) as AhpCriterionKey[])
    .map((k) => `${CRITERION_LABEL_ID[k]} ${input.aspectScores[k] ?? 0}`)
    .join(" · ");

  const responsibilities = position.responsibilities.length
    ? position.responsibilities
        .slice(0, 10)
        .map(
          (r) =>
            `  • ${truncate(r.responsibility, 260)}` +
            (r.successIndicator ? `\n    indikator keberhasilan: ${truncate(r.successIndicator, 200)}` : "")
        )
        .join("\n")
    : "  • job profile jabatan ini tidak ditemukan — tanggung jawab resmi tidak tersedia";

  return [
    "=== JABATAN TARGET ===",
    `${position.title}${position.department ? ` — ${position.department}` : ""}${
      position.division ? ` / ${position.division}` : ""
    }`,
    position.holderNames.length ? `Pejabat aktif saat ini: ${position.holderNames.join(", ")}` : "",
    position.experienceRequirement ? `Syarat pengalaman: ${position.experienceRequirement}` : "",
    position.jobProfileName ? `Job profile acuan: ${position.jobProfileName}` : "",
    position.jobPurpose ? `Tujuan jabatan: ${truncate(position.jobPurpose, 600)}` : "",
    position.educationRequirement ? `Syarat pendidikan: ${position.educationRequirement}` : "",
    "",
    "TANGGUNG JAWAB JABATAN:",
    responsibilities,
    "",
    "=== KANDIDAT ===",
    `${c.name} — ${c.currentPosition ?? "-"}${c.gradeLevel ? ` (${c.gradeLevel})` : ""}`,
    `Masa kerja: ${c.yearsExperience != null ? `${c.yearsExperience} tahun` : "tidak diketahui"}`,
    "",
    "HASIL PENILAIAN (FINAL — konteks saja, jangan dinilai ulang):",
    `  • Peringkat #${input.rank} · skor akhir ${input.weightedScore}/100 · kesiapan ${input.readiness}`,
    `  • Skor per aspek: ${aspects}`,
    "",
    "BUKTI — KOMPETENSI TEKNIS (dituntut vs dimiliki, terlemah lebih dulu):",
    technicalBlock(input.technical),
    "",
    "BUKTI — JEJAK KARIER:",
    careerBlock(input.career),
    "",
    "BUKTI — PENDIDIKAN:",
    educationBlock(c, input.education),
    "",
    "BUKTI — PERILAKU & KINERJA:",
    `  • Rekomendasi behavior: ${c.behaviorRecommendation ?? "tidak tersedia"}${
      c.behaviorNotes ? ` — ${truncate(c.behaviorNotes, 300)}` : ""
    }`,
    `  • Kuadran HAV: ${c.havQuadrant ? `Q${c.havQuadrant}` : "tidak tersedia"} (${havGroupLabel(c.havQuadrant)})`,
    `  • Riwayat PA: ${performanceLine(c.performanceGrade)}`,
    "",
    "Tulis catatan untuk kandidat DI ATAS. Balas HANYA JSON:",
    '{"strengths":["…"],"weaknesses":["…"],"recommendations":["…"]}',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => String(v ?? "").replace(/\s+/g, " ").trim())
    .filter((v) => v.length > 0)
    .slice(0, max);
}

/**
 * One call per finalist at bounded concurrency.
 *
 * Per-candidate rather than one call for the whole list: each candidate gets the
 * model's full attention on their own competency gaps, and a truncated reply costs
 * one narrative instead of all of them. Concurrency is INSIGHT_LLM_CONCURRENCY.
 *
 * Returns only the candidates that produced usable output; the caller keeps the
 * deterministic narrative for everyone else.
 */
export async function runAhpNarrativeAgent(
  position: AhpNarrativePosition,
  inputs: AhpNarrativeInput[],
  options?: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<Map<string, AhpNarrativeEntry>> {
  const written = new Map<string, AhpNarrativeEntry>();
  if (!config.ahpNarrativeLlm || inputs.length === 0) return written;

  const guideline = getPrompt("ahp_narrative_agent", AHP_NARRATIVE_PROMPT_DEFAULT);
  let done = 0;

  const writeOne = async (input: AhpNarrativeInput): Promise<void> => {
    const userPrompt = buildUserPrompt(position, input);

    const attempt = async (extra: string): Promise<AhpNarrativeEntry | null> => {
      const raw = await callLLM(guideline, `${userPrompt}${extra}`, {
        // Varied, natural prose — the opposite of what the aspect scorers need.
        // Never affects a number: nothing here is read back into the ranking.
        temperature: config.llm.insightTemperature,
        seed: null,
      });
      const parsed = extractJson(raw);
      const obj = Array.isArray(parsed?.candidates) ? parsed.candidates[0] : parsed;
      if (!obj || typeof obj !== "object") return null;
      const entry: AhpNarrativeEntry = {
        strengths: toStringArray(obj.strengths, 5),
        weaknesses: toStringArray(obj.weaknesses, 5),
        recommendations: toStringArray(obj.recommendations, 6),
      };
      // A reply with no recommendations is not a partial success: the succession
      // directive is the section the committee acts on, so fall back rather than
      // publish two thirds of a note.
      if (entry.recommendations.length === 0) return null;
      return entry;
    };

    try {
      let entry: AhpNarrativeEntry | null = null;
      try {
        entry = await attempt("");
      } catch {
        entry = await attempt(
          "\n\nPENTING: Balas HANYA objek JSON dengan field strengths, weaknesses, recommendations. Tanpa teks di luar JSON."
        );
      }
      if (entry) written.set(input.candidate.id, entry);
      else log("ahpNarrative.unusable", { candidate: input.candidate.name });
    } catch (err) {
      log("ahpNarrative.failed", {
        candidate: input.candidate.name,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      done += 1;
      options?.onProgress?.(done, inputs.length);
    }
  };

  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(config.insightLlmConcurrency, inputs.length) },
    async () => {
      while (cursor < inputs.length) {
        // An aborted session stops dispatching, but never fails the run: the
        // ranking is already computed and valid without any of this.
        if (options?.signal?.aborted) return;
        const item = inputs[cursor++]!;
        await writeOne(item);
      }
    }
  );
  await Promise.all(workers);

  log("ahpNarrative.complete", { requested: inputs.length, written: written.size });
  return written;
}

export { AHP_NARRATIVE_PROMPT_DEFAULT };
