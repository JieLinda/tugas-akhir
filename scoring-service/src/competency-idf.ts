// Inverse-document-frequency weights for technical competencies, measured over
// the job-profile corpus.
//
// WHY. The career aspect's competency FALLBACK — used when a history stint has no
// job profile, so the incumbents' competencies stand in for the JD — scored
// coverage as an unweighted mean: Σ min(1, held/required) / M. Every required
// competency counted the same. Measured over this corpus, that is a large free
// gift to anybody senior, because the requirements are dominated by competencies
// that nearly every job profile lists:
//
//   SOFTWARE APPLICATION OPERATION   92.7% of 275 JDs
//   DOCUMENT ADMINISTRATION          64.0%
//   PRODUCT AND SERVICE KNOWLEDGE    62.9%
//   BUDGETING                        57.8%
//   PROJECT MANAGEMENT               50.5%
//   PERFORMANCE MANAGEMENT           50.2%
//   RISK MANAGEMENT                  46.9%
//
// Of the 15 competencies on IT Application Development Department Head, about 7
// are of that kind. So an unrelated manager covered ~45% of the requirements for
// being a manager at all, and the fallback then mapped that onto the document
// similarity scale where 45% coverage read as a genuinely related job.
//
// Measured effect of weighting by ln(N/df) instead, over all 275×274 profile
// pairs labelled by job family: the median coverage of an UNRELATED pair falls
// from 0.286 to 0.104 (2.75×), mean 0.328 → 0.173, and the separation improves
// (AUC 0.743 → 0.775). Rare, specific competencies are what actually distinguish
// one job from another; that is the same reason IDF exists in retrieval, and the
// resume-matching literature makes exactly this point about job descriptions
// sharing "substantial common professional language that carries little
// discriminative information".
//
// SCOPE — CAREER FALLBACK ONLY, and that limit is deliberate. The technical
// aspect asks a different question: "can this person do what the job states it
// needs?". There, a common competency being common does not make it optional —
// if the JD demands Budgeting and the candidate has no Budgeting, that is a real
// gap regardless of how many other jobs also want it. Down-weighting it would
// quietly excuse the gap. `matchCompetencySets` therefore takes the weights as an
// OPTIONAL argument and the technical call site does not pass them, so its
// numbers are unchanged to the bit.
//
// Identity is the same key the matcher uses — the kamus code when the name
// resolves to one, else the normalized name — because two spellings of one
// competency must not be counted as two different rare ones. That is also why df
// is computed AFTER code resolution rather than over raw strings.

import { query } from "./db/postgres.js";
import { log } from "./llm.js";
import { contentFingerprint, storeCensusSnapshot } from "./run-trace.js";
import type { CensusRef, CompetencyIdfCensusPayload } from "./run-trace-types.js";

/** Identity → IDF weight. Missing key means "never seen in the corpus". */
export type CompetencyIdf = {
  /** The stored document-frequency census behind these weights (drizzle/0092). */
  census?: CensusRef | null;
  /** ln(N / df) per identity key, already computed. */
  weightByKey: Map<string, number>;
  /** Profiles the census ran over. */
  docCount: number;
  /** Distinct competency identities found. */
  keyCount: number;
  /** Weight used for a competency the corpus has never seen. */
  unseenWeight: number;
  /** The most common competencies, for the diagnostics panel. */
  mostCommon: { name: string; documentFrequency: number; weight: number }[];
  reason: string;
};

/**
 * A competency the corpus has never listed cannot have its df measured. It gets
 * the largest weight the corpus actually DEMONSTRATES — never more.
 *
 * Required competencies normally come from job profiles, so an unseen name can
 * only arrive via the incumbent-derived reference set
 * (`sync_technical_competencies`), whose spellings drift from the dictionary. The
 * cap exists so that an UNMEASURED name — quite possibly just an extraction typo
 * — cannot outweigh every measured one and dominate the coverage mean. That would
 * invert the point of IDF: a data-quality artefact would become the strongest
 * signal.
 *
 * On this corpus the cap is not currently binding: 15 of 98 competencies appear in
 * exactly one profile, so the largest measured weight already IS ln(275/1) = 5.62
 * and an unseen name lands on the same value. The guard still belongs here — it
 * holds whenever the rarest real competency is less rare than that, which is the
 * normal case for a larger corpus.
 *
 * Weight 0 is not the alternative: that silently deletes a requirement.
 */
const UNSEEN_FALLBACK_DF = 1;

/**
 * Weights are clamped below at this value so a near-universal competency is
 * de-emphasised, never erased. At N=275, `SOFTWARE APPLICATION OPERATION`
 * (df 255) earns ln(275/255) = 0.075 — small enough that leaving it unclamped
 * would make coverage of it worth essentially nothing, which overstates the case:
 * it is still a stated requirement. The floor keeps every requirement audible.
 */
const MIN_WEIGHT = 0.15;

/** The weighting rule, recorded on every run's trace so the XLSX can restate it. */
export const COMPETENCY_IDF_PARAMS = { minWeight: MIN_WEIGHT, unseenFallbackDf: UNSEEN_FALLBACK_DF } as const;

let cached: { key: string; value: CompetencyIdf } | null = null;

/**
 * Census the corpus. `resolveCode` is the same resolver the engine primes from
 * `kamus_competency_match_cache`, passed in so this module never reaches for a
 * model — scoring must stay runnable with nothing reachable, because the orphan
 * sweeper restarts sessions unattended.
 *
 * `normalize` is passed in for the same reason `resolveCode` is: the matcher owns
 * the definition of competency identity, and a second copy of that normalization
 * here is exactly how two files drift into disagreeing about whether
 * "SHE Management" and "SHE MANAGEMENT" are one competency.
 */
export async function resolveCompetencyIdf(
  resolveCode: (name: string) => string | null,
  normalize: (name: string) => string
): Promise<CompetencyIdf> {
  const rows = await query<{ id: number; competencies: unknown }>(
    `SELECT id, (extracted_data::jsonb)->'technicalCompetencies' AS competencies
       FROM sync_job_profiles
      WHERE status = 'completed' AND extracted_data IS NOT NULL`
  ).catch(() => [] as { id: number; competencies: unknown }[]);

  // df is over PROFILES, not occurrences — a profile listing one competency
  // twice (a real artefact in this corpus) must count once, or it would look
  // commoner than it is.
  const dfByKey = new Map<string, number>();
  const nameByKey = new Map<string, string>();
  let docCount = 0;
  const docs: CompetencyIdfCensusPayload["docs"] = [];

  for (const row of rows) {
    const list = Array.isArray(row.competencies) ? row.competencies : [];
    const seen = new Set<string>();
    docs.push({ id: Number(row.id), keys: [] });
    for (const item of list) {
      const raw =
        typeof item === "string"
          ? item
          : ((item as { competency?: string; name?: string } | null)?.competency ??
            (item as { name?: string } | null)?.name ??
            "");
      const name = String(raw ?? "").trim();
      if (!name) continue;
      const norm = normalize(name);
      if (!norm) continue;
      const code = resolveCode(name);
      const key = code ? `C:${code}` : `N:${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      docs[docs.length - 1]!.keys.push(key);
      dfByKey.set(key, (dfByKey.get(key) ?? 0) + 1);
      if (!nameByKey.has(key)) nameByKey.set(key, norm);
    }
    // A profile whose technicalCompetencies is empty still counts toward N: it
    // is a job that asks for none of them, which is information about how common
    // each one is. Excluding such profiles would inflate every df.
    docCount += 1;
  }

  const N = Math.max(1, docCount);
  const weightByKey = new Map<string, number>();
  let maxObserved = 0;
  for (const [key, df] of dfByKey) {
    const w = Math.max(MIN_WEIGHT, Math.log(N / Math.max(1, df)));
    weightByKey.set(key, w);
    if (w > maxObserved) maxObserved = w;
  }
  // Cap the unseen weight at the most specific weight the corpus demonstrates.
  const unseenWeight =
    maxObserved > 0 ? maxObserved : Math.max(MIN_WEIGHT, Math.log(N / UNSEEN_FALLBACK_DF));

  const mostCommon = [...dfByKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([key, df]) => ({
      name: nameByKey.get(key) ?? key,
      documentFrequency: df,
      weight: Number((weightByKey.get(key) ?? MIN_WEIGHT).toFixed(3)),
    }));

  const censusPayload: CompetencyIdfCensusPayload = {
    docCount,
    minWeight: MIN_WEIGHT,
    unseenFallbackDf: UNSEEN_FALLBACK_DF,
    unseenWeight,
    docs,
    keys: [...dfByKey.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, df]) => ({ key, name: nameByKey.get(key) ?? key, df, weight: weightByKey.get(key)! })),
  };
  const census =
    docCount > 0
      ? await storeCensusSnapshot(
          "competency_idf",
          `jd:${docCount}:${contentFingerprint(censusPayload)}`,
          censusPayload,
          censusPayload.keys.length
        ).catch(() => null)
      : null;

  const value: CompetencyIdf = {
    census,
    weightByKey,
    docCount,
    keyCount: dfByKey.size,
    unseenWeight,
    mostCommon,
    reason:
      docCount === 0
        ? "Tidak ada dokumen job profile yang bisa dibaca — semua kompetensi diberi bobot sama."
        : `Bobot kekhasan dihitung dari ${docCount} dokumen job profile (${dfByKey.size} kompetensi berbeda): ` +
          `kompetensi yang diminta hampir semua jabatan bernilai kecil, yang diminta sedikit jabatan bernilai besar. ` +
          `Contoh paling umum: ${mostCommon
            .slice(0, 3)
            .map((m) => `${m.name} (${m.documentFrequency}/${docCount}, bobot ${m.weight})`)
            .join("; ")}.`,
  };

  log("competencyIdf.measured", {
    docs: docCount,
    keys: dfByKey.size,
    top: mostCommon.slice(0, 3).map((m) => `${m.name}=${m.documentFrequency}`),
  });
  return value;
}

/**
 * Cached wrapper. The census is one query plus a pass over ~275 small JSON
 * arrays, but a run scores every stint of every candidate and would otherwise
 * repeat it. Keyed by profile count so an ingested batch of new JDs invalidates
 * it — a coarse key on purpose: df moves slowly, and a stale weight is a
 * rounding difference, not a wrong answer, whereas a per-run census that has to
 * be exact would be one more thing that can fail a run.
 */
export async function resolveCompetencyIdfCached(
  resolveCode: (name: string) => string | null,
  normalize: (name: string) => string
): Promise<CompetencyIdf> {
  const countRows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM sync_job_profiles WHERE status = 'completed'`
  ).catch(() => [] as { n: string }[]);
  const key = `jd:${countRows[0]?.n ?? "?"}`;
  if (cached && cached.key === key) return cached.value;
  const value = await resolveCompetencyIdf(resolveCode, normalize);
  cached = { key, value };
  return value;
}

/** Test seam — drops the module cache. */
export function resetCompetencyIdfCache(): void {
  cached = null;
}
