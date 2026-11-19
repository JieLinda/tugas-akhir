import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load THIS service's own .env regardless of the launch cwd (src/config.ts →
// ../.env = scoring-service/.env). A bare dotenv.config() resolves against
// process.cwd(), so launching from the repo root (or anywhere but
// scoring-service/) silently loaded NO env — leaving POSTGRES_URL and
// GEMINI_API_KEY on their fallbacks (wrong DB → runs don't persist; empty key →
// education reports "GEMINI_API_KEY tidak diset"). In Docker the file is absent
// (dockerignored) so this is a no-op and env_file values are used instead.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
  override: true,
});

// Cosine distributions differ sharply by model family, so anything expressed as
// an absolute similarity needs a family-appropriate default. E5 compresses
// everything upward (unrelated texts already sit near 0.75); Nomic spreads
// wider and lower. Both are overridable per deployment.
const EMBEDDING_MODEL_NAME =
  process.env.EMBEDDING_MODEL || "nomic-embed-text-v2-moe:latest";
const isE5 = (name: string) => /(^|\/)multilingual-e5|(^|\/)e5-/i.test(name);
const IS_E5_FAMILY = isE5(EMBEDDING_MODEL_NAME);

/**
 * A float that is genuinely optional: unset (or unparseable) stays null rather
 * than collapsing to a default. Used where "not configured" must be
 * distinguishable from a value, because something else — a corpus census —
 * supplies the answer when the operator has not pinned one.
 */
const optionalFloat = (raw: string | undefined): number | null => {
  if (raw == null || raw.trim() === "") return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : null;
};

/**
 * A fraction that must stay a fraction. A misconfigured value here would not
 * fail — it would quietly let a capped scale exceed its cap, or zero it — so the
 * clamp is the guard, and NaN falls back to the caller's default via `||` before
 * reaching this.
 */
const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

// The DOCUMENT model can differ from the primary one (the primary embeds short
// titles for the position↔profile matcher; documents are the restructured
// job-profile paragraphs in job_profile_embed). Career-relevance cosines are
// document↔document, so every anchor describing that distribution must follow
// THIS model, not the primary — otherwise a deployment running E5 for titles and
// Nomic for documents picks E5's high/compressed anchors for Nomic's wider,
// lower distribution and silently mis-scales every career score.
const DOCUMENT_EMBEDDING_MODEL_NAME =
  process.env.DOCUMENT_EMBEDDING_MODEL ||
  process.env.EMBEDDING_MODEL_JOB_FAMILY ||
  process.env.EMBEDDING_MODEL ||
  "nomic-embed-text-v2-moe:latest";
const IS_E5_DOCUMENT_FAMILY = isE5(DOCUMENT_EMBEDDING_MODEL_NAME);

// The main database. Resolved in the SAME order as the web app
// (lib/db/index.ts: DATABASE_URL, then POSTGRES_URL) because this service only
// works if it reads the rows the web app just wrote: `/api/scoring/start` looks
// the session up by id, and a service on another database answers 404 "Session
// not found" for every run while the orphan sweeper — sweeping the wrong
// database — never claims them either. The order used to be the reverse, so an
// environment carrying both names with different values split the two
// deployables silently. The chosen variable is recorded so startup, /health and
// that 404 can say which one was used.
const POSTGRES_URL_SOURCE: "DATABASE_URL" | "POSTGRES_URL" | "default" =
  process.env.DATABASE_URL
    ? "DATABASE_URL"
    : process.env.POSTGRES_URL
      ? "POSTGRES_URL"
      : "default";

export const config = {
  port: parseInt(process.env.PORT || "8002"),
  postgresUrl:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    "postgresql://postgres:postgres@localhost:5432/pulse",
  postgresUrlSource: POSTGRES_URL_SOURCE,
  /** Both names set to DIFFERENT values — worth a loud warning at boot. */
  postgresUrlConflict: Boolean(
    process.env.DATABASE_URL &&
      process.env.POSTGRES_URL &&
      process.env.DATABASE_URL !== process.env.POSTGRES_URL,
  ),
  vectorPostgresUrl:
    process.env.VECTOR_DATABASE_URL ||
    process.env.VECTOR_POSTGRES_URL ||
    process.env.POSTGRES_URL ||
    "postgresql://postgres:postgres@localhost:5433/pulse_vectors",
  // Master-key file for unwrapping the candidate-encryption DEK. Same contract
  // as the web app's PULSE_MASTER_KEY_FILE — default secrets/master.key, which
  // Docker mounts ro into this container.
  masterKeyFile: process.env.PULSE_MASTER_KEY_FILE || "secrets/master.key",
  masterKeyInline: process.env.PULSE_MASTER_KEY || "",
  llm: {
    baseUrl: process.env.LLM_BASE_URL || "http://localhost:8001/v1",
    apiKey: process.env.LLM_API_KEY || "not-needed",
    model: process.env.LLM_MODEL || "default",
    // Deterministic by default so scoring is reproducible across runs: greedy
    // decoding (temperature 0) plus a fixed seed. Both are env-overridable.
    temperature: parseFloat(process.env.LLM_TEMPERATURE || "0"),
    seed: parseInt(process.env.LLM_SEED || "42", 10),
    // The AHP+TOPSIS insight writer (strengths, weaknesses, recommendations)
    // should NOT be deterministic — flat temperature-0 prose reads templated
    // and repeats across candidates. Use a higher temperature there for varied,
    // natural writing. Only affects wording, never the numeric scores.
    insightTemperature: parseFloat(process.env.LLM_INSIGHT_TEMPERATURE || "0.7"),
  },
  // HTTP timeout for LLM calls (each call can be 30-60s for large candidate
  // lists; allow generous headroom)
  llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "120000"),
  // AHP+TOPSIS insight notes are written per finalist (one LLM call each); this
  // caps how many of those narrative calls run in parallel.
  insightLlmConcurrency: Math.max(1, parseInt(process.env.INSIGHT_LLM_CONCURRENCY || "3", 10)),
  // Whether AHP+TOPSIS finalists get an LLM-written insight note instead of the
  // deterministic aspect templates. Off = every candidate falls back to
  // buildNarrative(). A DEMO-mode run never calls the writer regardless. The
  // RANKING is unaffected either way: the agent writes prose and nothing it
  // returns is read back into a score.
  ahpNarrativeLlm: (process.env.AHP_NARRATIVE_LLM ?? "true") !== "false",
  // ── Concurrent sessions ──
  // How many scoring sessions may be PROCESSING at once. Everything above the
  // cap stays 'running' in the database with no worker, and the orphan sweeper
  // below picks it up as slots free — so a queue needs no extra machinery.
  //
  // The cap exists because dispatch is per-session and unbounded: bulk-adding
  // positions with auto-scoring starts dozens of runs in one go, and each AHP
  // run fans out into embedding and LLM calls of its own. Without a cap they all
  // start at once and every one of them gets slower.
  maxConcurrentSessions: Math.max(1, parseInt(process.env.SCORING_MAX_CONCURRENT || "2", 10)),
  // ── Orphaned-session sweeper ──
  // A scoring run is dispatched by the web app via a best-effort, fire-and-forget
  // POST /start. When that POST is lost (service momentarily busy, network blip),
  // the session sits 'running' with no worker on it — and previously only a
  // service RESTART would re-pick it up (resumeInterruptedSessions runs at boot).
  // This sweeper re-dispatches such orphans periodically, so ONE start keeps the
  // service ready to score without restarts. Set interval to 0 to disable.
  orphanSweep: {
    intervalMs: Math.max(0, parseInt(process.env.ORPHAN_SWEEP_INTERVAL_MS || "10000", 10)),
    // Skip sessions touched within this window so the sweep doesn't race the
    // normal /start dispatch or grab one that's mid-processing between ticks.
    graceMs: Math.max(0, parseInt(process.env.ORPHAN_SWEEP_GRACE_MS || "15000", 10)),
  },
  // ── AHP + TOPSIS method ──
  embedding: {
    // PRIMARY model — Nomic Embed Text v2 MoE served over an OpenAI-compatible
    // endpoint (Ollama by default), 768-dim. This is deliberately the SAME model
    // and the SAME transport the web app's Job Family rebuild uses
    // (lib/job-family/embed.ts), because every vector this service compares
    // against — job_profile_embed, kamus_kompetensi_level_embed — was produced
    // there. A different model would put the two sides in different spaces and
    // make every cosine meaningless.
    //
    // Set EMBEDDING_PROVIDER=transformers + EMBEDDING_MODEL=Xenova/multilingual-e5-base
    // to go back to the in-process Transformers.js E5 path (no server needed,
    // model downloaded from the HF Hub on first use).
    model: EMBEDDING_MODEL_NAME,
    // Transport: "openai"/"ollama"/"api" → OpenAI-compatible /v1/embeddings;
    // "transformers" → in-process ONNX via @xenova/transformers.
    provider: process.env.EMBEDDING_PROVIDER || "openai",
    // OpenAI-compatible base URL. EMBEDDING_API_BASE is the name the web app
    // uses; EMBEDDING_BASE_URL is kept for existing scoring-service .env files.
    baseUrl:
      process.env.EMBEDDING_API_BASE ||
      process.env.EMBEDDING_BASE_URL ||
      "http://localhost:11434/v1",
    // Bearer token for hosted gateways (local Ollama needs none).
    apiKey: process.env.EMBEDDING_API_KEY || "",
    // DOCUMENT embedding model — used ONLY for DOCUMENT embeddings fed to topic
    // modelling: the restructured job-profile paragraphs AND the kamus-kompetensi
    // documents. Defaults to the primary model so both sides stay in one space.
    documentEmbeddingModel: DOCUMENT_EMBEDDING_MODEL_NAME,
    // Load quantized (int8) ONNX weights — smaller/faster, and the variant most
    // HF Transformers.js repos ship. Only relevant to the transformers provider.
    // Set EMBEDDING_QUANTIZED=false when a repo only provides the full-precision
    // onnx/model.onnx (no model_quantized.onnx) — e.g. nomic-embed-text-v2-moe.
    quantized: (process.env.EMBEDDING_QUANTIZED ?? "true") !== "false",
    cacheDir: process.env.EMBEDDING_CACHE_DIR || "",
  },
  ahpTopsis: {
    // Parallel LLM calls for the education-aspect scorer (one call per
    // candidate against the job profile's responsibilities).
    educationLlmConcurrency: Math.max(
      1,
      parseInt(process.env.EDUCATION_LLM_CONCURRENCY || "4")
    ),
    // REMOVED — EDUCATION_EXACT_MATCH_SCORE no longer has any effect.
    //
    // It used to give every exact match one flat score. The tiered rule replaced
    // it (higher=100, equal=80, lower=50, in ahp-topsis-engine.ts) but the knob
    // was left as an unreachable `??` fallback, which made the code look like it
    // still had a flat path and left operators setting a value that did nothing.
    // The tier table is now the only rule. Stored scores that match no tier come
    // from runs made before the change; lib/education-tier.ts explains those
    // without rewriting them, since the stored score is what fed TOPSIS.
    // Retry the grounded Gemini education call this many times when its JSON is
    // missing/invalid before falling back to the deterministic BERT scorer.
    educationMaxRetries: Math.max(
      0,
      parseInt(process.env.EDUCATION_LLM_MAX_RETRIES || "2")
    ),
    // Reuse the last run's grounded education answer for a candidate whose
    // model inputs are identical (education-reuse.ts). On by default; set
    // AHP_EDUCATION_REUSE=false to ask the model for every candidate again.
    educationReuse: (process.env.AHP_EDUCATION_REUSE ?? "true") !== "false",
    // ── Technical competency: semantic-similarity scale (FALLBACK ONLY) ──
    //
    // These are no longer the operating values. The anchors are DERIVED from the
    // kamus embedding corpus and recomputed whenever it changes
    // (technical-anchors.ts, table kamus_similarity_calibration), because they
    // describe one corpus: a re-embed, an added competency or a model switch
    // moves that distribution while every cosine keeps computing, so a fixed
    // number goes wrong without anything failing.
    //
    // What survives here: the values used when the corpus is absent, too small
    // (<20 competencies) or degenerate. Setting TECHNICAL_SIM_FLOOR *and*
    // TECHNICAL_SIM_CEIL still PINS the anchors and skips the census entirely —
    // an operator who pins them means it.
    //
    // The census that produced the numbers below is kept as documentation of
    // where a plausible answer sits:
    // A raw cosine between two kamus-kompetensi level documents is NOT a
    // percentage. Every competency in the dictionary has some OTHER competency
    // sitting close to it, and Hungarian MAXIMISES, so the number that matters
    // is not the average cross-competency similarity (0.571) but the best WRONG
    // pairing available. Measured over the full census of this deployment's
    // dictionary — 90 competencies × 4 levels = 360 vectors,
    // nomic-embed-text-v2-moe, all 128160 cross-code pairs:
    //
    //   best-wrong-match per row:  p05 0.674 | p25 0.723 | p50 0.758 | p95 0.859
    //   most similar DISTINCT pair in the whole dictionary: 0.892
    //
    // Feeding that straight into a 0..100 criterion scored a completely wrong
    // pairing at 72–86 points, which is what made technical read far too high.
    //
    // The anchors are read off that census, so each one has a meaning:
    //   simFloor 0.72 — p25 of the best-wrong-match distribution. At or below
    //                   it, "the most similar competency in the dictionary" is
    //                   no evidence of coverage at all.
    //   simCeil  0.89 — the observed MAXIMUM over every distinct pair
    //                   (MARKETING COMMUNICATION ↔ MARKETING STRATEGY, 0.8905).
    //                   Only a genuine near-synonym earns full credit.
    // Mid-scale then lands where inspection says it should:
    //   SALES MGMT (DEALER) ↔ (RETAILER) 0.882 → 0.95
    //   LOGISTIC ↔ SUPPLY CHAIN          0.847 → 0.75
    //   BRAND MGMT ↔ MARKETING STRATEGY  0.799 → 0.47
    //   median best-wrong                0.758 → 0.22
    //
    // FIXED anchors, never per-run percentiles — the same reason career uses
    // fixed ones: a technical score has to mean the same thing across runs and
    // across positions. They follow the DOCUMENT model, because that is the
    // model that embedded kamus_kompetensi_level_embed.
    //
    // The E5 values are SCALED ESTIMATES, not measured — E5 compresses
    // everything upward, so a deployment that switches family must re-run the
    // census rather than trust them.
    technical: {
      simFloor: parseFloat(
        process.env.TECHNICAL_SIM_FLOOR || (IS_E5_DOCUMENT_FAMILY ? "0.88" : "0.72")
      ),
      simCeil: parseFloat(
        process.env.TECHNICAL_SIM_CEIL || (IS_E5_DOCUMENT_FAMILY ? "0.96" : "0.89")
      ),
    },
    // ── Career-relevance competency fallback ──
    // A history stint with no job profile is scored by matching the stint
    // position's INCUMBENT competencies against the target's required set (the
    // same Hungarian matcher the technical aspect uses). That produces a
    // coverage ratio in 0..1, which lives on a different scale than the document
    // cosine similarities (compressed and high). It is therefore mapped onto the
    // similarity range actually observed in THIS run — p5..p95 of the
    // document-matched stints.
    careerFallback: {
      // Anchors for the fallback band. Unset means "use the run's measured
      // scale", so coverage 0 maps to the floor (sim' 0) by construction and the
      // fallback shares one band with the document path. A value here is an
      // operator PIN and wins, same contract as CAREER_SIM_FLOOR/_CEIL.
      anchorLoPinned: optionalFloat(process.env.CAREER_FALLBACK_ANCHOR_LO),
      anchorHiPinned: optionalFloat(process.env.CAREER_FALLBACK_ANCHOR_HI),
      // ── The cap: how much relevance FULL competency coverage may assert ──
      //
      // The fallback used to map coverage onto [p5, p95] of THIS RUN's
      // document-matched similarities. The intent was documented ("a fallback
      // measurement must not out-score a real document match") and the
      // implementation contradicted it: p95 of ~36 stints IS very nearly the
      // maximum, so coverage 1.0 landed on the best document cosine in the run.
      // On the IT Application Development Department Head run that band was
      // [0.563, 0.949] and 0.949 is exactly the cosine of the target's own
      // "IT Application Development Analyst" JD. Full competency coverage bought
      // the claim "this IS the job".
      //
      // It is now an ABSOLUTE fraction of the measured band — coverage 1.0 reaches
      // floor + cap × (ceil − floor), i.e. sim' = cap and no further — which makes
      // the stated intent actually hold, and makes it hold identically in every
      // run instead of following whatever the run's own sample happened to be.
      //
      // 0.50 is measured, not chosen for roundness. The fallback signal is
      // genuinely weaker than the document one (AUC 0.743 vs 0.874 at separating
      // job families) and 5% of UNRELATED job pairs share >= 75% of their
      // competencies, so half the scale is the most a competency argument can
      // honestly carry. At 0.50 the four support-only candidates who tied at 100
      // on the reference run land at 41-58 while both genuine app-dev candidates
      // stay at 92-100.
      // Unparseable -> the default, never 0: a typo must not silently switch the
      // whole competency fallback off.
      cap: clamp01(optionalFloat(process.env.CAREER_FALLBACK_CAP) ?? 0.5),
      // Weight each required competency by ln(N/df) over the job-profile corpus
      // instead of counting them all equally (competency-idf.ts). Measured: the
      // median coverage of an unrelated job pair falls 0.286 → 0.104. Off only as
      // an escape hatch if a corpus is so small that df is meaningless.
      useIdf: (process.env.CAREER_FALLBACK_IDF ?? "1") !== "0",
    },
    // ── Career relevance: similarity scale + experience depth ──
    career: {
      // A raw cosine is NOT a percentage, so every stint similarity is stretched
      // onto 0..1 between a floor ("no closer than an arbitrary other job
      // profile") and a ceiling ("effectively the same job"). Fixed within and
      // across runs — never per-run percentiles — so a Career score means the
      // same thing in every run and for every position.
      //
      // THESE ARE THE LAST-RESORT FALLBACK ONLY. The live values are MEASURED
      // from `job_profile_embed` by career-anchors.ts (drizzle/0066) and
      // recomputed whenever that corpus changes; these constants apply only when
      // the corpus is missing, too small, or degenerate — and every run reports
      // which of the three it used in `runInfo.career.scale.source`.
      //
      // They used to BE the live values, chosen by model family and never
      // measured. On this deployment's corpus that was wrong at both ends: 0.45
      // sits below the 5th percentile of arbitrary document pairs (so the median
      // UNRELATED pair still scored 0.28 relevance), and 0.85 sits below the
      // median document's genuine twin at 0.905 (so over half the corpus
      // saturated at 1.0). Kept as a fallback rather than deleted because a
      // deployment whose JDs are not embedded yet still has to produce a number.
      simFloor: parseFloat(
        process.env.CAREER_SIM_FLOOR || (IS_E5_DOCUMENT_FAMILY ? "0.75" : "0.45")
      ),
      simCeil: parseFloat(
        process.env.CAREER_SIM_CEIL || (IS_E5_DOCUMENT_FAMILY ? "0.95" : "0.85")
      ),
      // ── Depth: how much RELEVANT experience counts as "enough" ──
      // Career relevance accumulates effective relevant experience — Σ(sim×years)
      // and Σ(sim) — instead of averaging it, so a thin history cannot score like
      // a deep one just because its few stints happened to match.
      //
      // T IS NOW ABSOLUTE. It used to be median-of-pool × 2, and that made career
      // the only pool-relative quantity among the six aspects — a design the
      // MCDM literature has a name for the problem of (TOPSIS/VIKOR anchor on the
      // extremes of whoever showed up; the Reference Ideal Method exists because
      // that is often wrong). The failure mode is not subtle and it was measured:
      //
      //   LEARNING & DEVELOPMENT DEPARTMENT HEAD, 27 candidates, pool average
      //   relevance 0.168 — i.e. almost nobody in it had relevant experience. The
      //   pool median therefore collapsed and T came out 2.06 years / 1.0 stints,
      //   the latter hitting the clamp floor, so ONE stint saturated that whole
      //   axis. Average career score: 33.1. Against a fixed 8 years / 3 stints
      //   the same candidates score 11.3.
      //
      // So the weaker the pool, the more generous the yardstick: 1.4x inflation
      // on a normal pool, 3x on a bad one, and always in the direction that makes
      // a hopeless bench look viable. Which is exactly the complaint. An absolute
      // T also makes two runs of the same program comparable, which a pool-derived
      // one never was.
      //
      // 8 years is the saturation point, NOT an eligibility minimum. Where a job
      // profile states its own requirement ("Min 5 tahun sebagai Application
      // Developer" — parseable on 182 of 275 profiles) that number is a FLOOR to
      // clear, not the point deserving 100, so it is multiplied by
      // `statedExperienceMultiplier`.
      //
      // WHERE THE DEFAULT COMES FROM. It used to be a hardcoded 8, chosen in a
      // simulation because it behaved well — not a provenance. It is now MEASURED
      // per seniority band from the appointment record (career-depth-anchors.ts):
      // how many years of service the people actually appointed to a job at that
      // level had behind them. Department Head/Manager comes out at 9.2 years over
      // 37 appointments; Division Head/GM at 15.6. `fixedTargetYears` is only the
      // last resort when that census produces nothing.
      fixedTargetYears: parseFloat(process.env.CAREER_DEPTH_TARGET_YEARS || "8"),
      // Where T_years comes from when the target JD states no usable minimum —
      // "Fresh graduate" (78 of 275 profiles), unparseable text (23 more), or no
      // job profile at all.
      //   measured  — median years-before-appointment for the target's level,
      //               from candidate_position_history. Revealed preference, the
      //               same kind of evidence the `transitions` similarity anchor
      //               uses, and it needs no JD.
      //   constant  — fixedTargetYears above, for a deployment with no usable
      //               appointment history.
      defaultSource: (process.env.CAREER_DEPTH_DEFAULT_SOURCE || "measured") === "constant"
        ? ("constant" as const)
        : ("measured" as const),
      // How a JD's stated minimum is turned into a saturation target.
      //   scaled  — stated × statedExperienceMultiplier. The multiplier exists
      //             because the two are NOT the same unit: a JD means raw calendar
      //             years in one named role, while effectiveYears discounts every
      //             year by relevance and recency (measured median ratio 0.398 on
      //             this deployment). So the honest translation of "5 years" is
      //             ~12.6 effective years, and ×1 implements ~40% of the document.
      //   direct  — stated as-is, no multiplier. Faithful to the NUMBER but not to
      //             the requirement, for the reason above. Measured cost on the
      //             reference run: separation between genuine and spurious
      //             relevance falls from 40 points to 9, and support-only
      //             candidates return to scoring 82.
      //   ignore  — never read the JD; always use `defaultSource`.
      statedMode: (() => {
        const v = (process.env.CAREER_DEPTH_STATED_MODE || "scaled").toLowerCase();
        return v === "direct" || v === "ignore" ? (v as "direct" | "ignore") : ("scaled" as const);
      })(),
      // 2 rather than 3: measured, the rows axis at 3 punishes the very profile
      // this criterion should reward — a decade in the exact target job as ONE
      // assignment reached only 1.4 effective stints and scored 47. See
      // `breadthWeight` for why it stopped being a hard min() as well.
      fixedTargetRows: parseFloat(process.env.CAREER_DEPTH_TARGET_ROWS || "2"),
      // A JD's stated minimum × this = the saturation target.
      //
      // 1 means "the requirement as written IS the full-score point". That is the
      // literal reading of the job profile, and it is now the default because the
      // ×2 it replaced was a judgement this codebase made on the JD's behalf: a
      // seat asking for 3 years had its bar silently set at 6.
      //
      // The cost is real and belongs next to the knob: at ×1 everyone who clears
      // the stated minimum saturates the YEARS axis, so among qualified
      // candidates that axis stops discriminating and the ranking leans on
      // breadth (`breadthWeight`) and on the five other aspects. Raise this back
      // toward 2 to spread qualified candidates out again.
      // A JD's stated minimum × this = the saturation target, under statedMode
      // "scaled". 2.0 is not a round number picked for comfort — three independent
      // measurements on this deployment agree on roughly that factor for a
      // Department Head seat whose JD states 5 years:
      //   unit conversion     5 ÷ 0.398 (median effective/raw ratio) = 12.6
      //   separation optimum  T = 10 maximises genuine-vs-spurious (45 points)
      //   revealed preference real Dept Head appointees had median 9.2 years
      // ×2 lands at 10, inside that range. Set it to 1 together with
      // CAREER_DEPTH_STATED_MODE=direct if you want the JD's literal number.
      statedExperienceMultiplier: parseFloat(
        process.env.CAREER_DEPTH_STATED_MULTIPLIER || "1"
      ),
      // Whether a JD may only RAISE the bar, never lower it below
      // `fixedTargetYears`.
      //
      // This used to be welded to the multiplier — the JD was read only when
      // `stated × multiplier > fixedTargetYears` — which made the multiplier do
      // two unrelated jobs at once, and turned "stop doubling" into "ignore the
      // JD almost everywhere": measured on this corpus, 179 profiles state a
      // parseable requirement, and at ×1 exactly 2 of them exceed 8 years. The
      // other 177 seats would silently have used the house default while the UI
      // reported a JD-derived target.
      //
      // Off (the default) means the JD's number is used as written, up or down,
      // clamped only by min/maxTargetYears. On restores the old "never easier
      // than the house standard" behaviour.
      statedExperienceOnlyAboveFixed:
        (process.env.CAREER_DEPTH_STATED_ONLY_ABOVE_FIXED ?? "0") !== "0",
      // Read the target's own stated experience requirement at all. Off falls
      // back to the fixed targets for every position.
      useStatedExperience: (process.env.CAREER_DEPTH_USE_STATED ?? "1") !== "0",
      // Clamps so a JD stating something absurd cannot produce an absurd target.
      minTargetYears: parseFloat(process.env.CAREER_DEPTH_MIN_TARGET_YEARS || "3"),
      maxTargetYears: parseFloat(process.env.CAREER_DEPTH_MAX_TARGET_YEARS || "20"),
      minTargetRows: parseFloat(process.env.CAREER_DEPTH_MIN_TARGET_ROWS || "1"),
      maxTargetRows: parseFloat(process.env.CAREER_DEPTH_MAX_TARGET_ROWS || "8"),
      // ── Shape: how the two axes combine ──
      //
      // Was `min(depthYears, depthRows)`. The docstring justified it as "many
      // brief stints are capped by years, one long stint by rows", but the second
      // half is a bug dressed as a feature: one long stint in the EXACT target
      // job is the strongest evidence this criterion can receive, and min() threw
      // it away. Measured on the reference run, a candidate with 10.6 years as an
      // IT Application Development Analyst scored 47 while support-only
      // candidates scored 100.
      //
      // Now depthYears carries the score and breadth only MODULATES it:
      //   score = depthYears × (1 − breadthWeight + breadthWeight × depthRows)
      // so a single deep relevant stint keeps 75% of full marks instead of 47%,
      // while breadth still adds a real 25%. Of five shapes measured against the
      // reference run, this gave the widest separation between genuine and
      // spurious relevance (+22 points, versus +2 for min() and +16 for a
      // geometric mean).
      breadthWeight: clamp01(optionalFloat(process.env.CAREER_DEPTH_BREADTH_WEIGHT) ?? 0.25),
      // ── Concavity (Mincer form) — AVAILABLE, DEFAULT OFF ──
      //
      // Human-capital theory says returns to experience are concave: the Mincer
      // earnings function has been fitted with a quadratic experience term on
      // thousands of datasets for exactly that reason, and `min(1, x)` is instead
      // linear-then-cliff. Setting this above 1 applies x^(1/γ), which is concave
      // and still reaches exactly 1 at T.
      //
      // It defaults to 1 (linear) because it was measured and it made THIS
      // objective worse. Diminishing returns lift the middle of the scale, and
      // the middle is precisely where irrelevant-but-long careers sit: the
      // separation between genuine and spurious relevance fell from +39 at γ=1 to
      // +30 at γ=1.5 and +24 at γ=2, and the corpus average rose from 29 to 42.
      // The Mincer shape is right for modelling what experience EARNS; it is
      // wrong for deciding whether experience is RELEVANT. Kept configurable
      // rather than deleted so the choice stays visible and re-testable.
      concavity: Math.max(1, optionalFloat(process.env.CAREER_DEPTH_CONCAVITY) ?? 1),
      // ── Recency (human-capital depreciation) ──
      //
      // Relevance decays once you stop doing the work: exp(−δ × years since the
      // stint ended), δ per year. Nothing decayed before — a stint that ended in
      // 2006 counted exactly as much as the one the candidate is in now, and
      // `CareerPair.isCurrent` was recorded but never reached the score.
      //
      // 0.043 is NOT a tuned constant. Source: Dinerstein, Megalokonomou &
      // Yannelis, "Human Capital Depreciation and Returns to Experience",
      // American Economic Review 112(11), 2022 (NBER w27925), which estimates
      // skill depreciation at 4.3%/year. Corroborated from another direction by
      // de Grip & van Loo (2002): "almost a third of tertiary skills obsolete
      // after 7 years" fits the same exponential at ~5.1%/year, so two separate
      // literatures bracket 4-5%/year.
      //
      // LIMIT OF APPLICABILITY, do not drop it: neither study measured OUR case.
      // The first measures depreciation from time OUT of formal employment
      // (teachers in Greece); the second is graduate self-assessment. We apply it
      // to "skills decay while working in a DIFFERENT field". Order-of-magnitude
      // anchor, not a replication — which is why this stays configurable.
      // Full citations with links: Career section of the Run Configuration tab.
      //
      // Measured effect here: widens the genuine-versus-spurious separation from
      // +34 to +39, because the candidates whose only relevance is old are exactly
      // the ones it demotes. 0 disables it.
      recencyDecayPerYear: Math.max(
        0,
        optionalFloat(process.env.CAREER_RECENCY_DECAY) ?? 0.043
      ),
    },
  },
  // ── Gemini (education aspect: grounded, deterministic) ──
  // The education criterion is scored by Gemini WITH "Grounding with Google
  // Search" so its rationale cites verifiable sources (needed for gap
  // analysis). Determinism is enforced via temperature 0 + topP 0 + a fixed
  // rubric system prompt; JSON is validated and the call retried on failure.
  // NOTE: Gemini cannot combine the google_search tool with responseSchema /
  // responseMimeType=application/json, so structured output is enforced by the
  // prompt + parser rather than the API's native structured-output mode.
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    baseUrl:
      process.env.GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta",
    // Grounding tool name: "google_search" for Gemini 2.x, "google_search_retrieval"
    // for legacy 1.5 models.
    groundingTool: process.env.GEMINI_GROUNDING_TOOL || "google_search",
    enableGrounding: (process.env.GEMINI_ENABLE_GROUNDING ?? "true") !== "false",
    temperature: parseFloat(process.env.GEMINI_TEMPERATURE || "0"),
    topP: parseFloat(process.env.GEMINI_TOP_P || "0"),
    timeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS || "60000"),
  },
} as const;
