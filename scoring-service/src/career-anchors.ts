// Similarity anchors for the CAREER aspect, derived from THREE independent
// estimators and recomputed whenever ANY of their inputs changes — the job-profile
// documents, the embedding model, the job-family clustering, or the recorded career
// history. See resolveFingerprint() for why all four have to be tracked.
//
// This is technical-anchors.ts's argument applied to the other corpus the engine
// measures against. Career stretches a document↔document cosine onto 0..1
// between a floor ("no closer than an unrelated job profile") and a ceiling
// ("effectively the same job"). Both are statements ABOUT A SPECIFIC CORPUS, so a
// hardcoded pair is wrong in the least detectable way possible: re-embed the JDs,
// add or remove documents, or switch the model and every cosine still computes —
// only the MEANING of the score shifts.
//
// ── ROUND 1 (drizzle/0066): stop hardcoding ──────────────────────────────
// The values used to fall back to literals chosen per embedding-model FAMILY —
// 0.45/0.85 for anything not E5 — which `.env.example` admitted were untuned. A
// census of this deployment (275 documents, 37,675 distinct pairs,
// nomic-embed-text-v2-moe) found both ends shifted low, so they were replaced by
// measured percentiles: p25 of arbitrary pairs (0.519) and p99 of each document's
// nearest genuine twin (0.998).
//
// ── ROUND 2 (drizzle/0068, this file): stop measuring the wrong thing ────
// Measuring beat guessing, but "p25 of arbitrary pairs" answers a question whose
// answer nobody can check. Calibrating against observable labels shows it lands
// far too low:
//
//   at cosine 0.519 — the floor it produced — the probability that two profiles
//   are even in the same JOB FAMILY is 10%.
//
// So sim' = 0 sat where 90% of pairs are unrelated, and everything above earned
// positive relevance: the median arbitrary pair (0.562) scored 0.09 and the
// 95th-percentile-of-noise pair (0.709) scored 0.39. Career multiplies sim' by
// years and ACCUMULATES, so a 12-year career of unrelated work banked ~4.7
// "effective relevant years" against a target of ~7.
//
// Measured consequence over 660 scored candidates in 8 real runs: candidates
// scored from real job-profile documents averaged 35.1, candidates scored through
// the competency fallback averaged 66.7, and 90 of the 104 candidates scoring
// >= 90 had fallback evidence. The criterion was reporting how much of a
// candidate's history LACKED a job profile, not how relevant that history was.
//
// THE FIX IS NOT A BETTER PERCENTILE. "Related" has to be defined against
// something observable, so three estimators answer the same question from
// different evidence and the resolved anchor is their MEDIAN:
//
//   corpus      — the round-1 method. Needs nothing but the vectors, so it is
//                 always available and is the reason this never returns nothing.
//   family      — the cosine at which P(same job family) crosses 50% / 95%,
//                 against the last COMPLETED topic run. Measured 0.671 / 0.858.
//                 PARTLY CIRCULAR: those families were clustered from these very
//                 vectors. That is precisely why it is one of three.
//   transitions — REVEALED PREFERENCE. The cosine distribution of internal moves
//                 people ACTUALLY MADE (`candidate_position_history`): p10 as the
//                 floor, p75 as the ceiling. The only NON-circular estimator —
//                 these are HR decisions that already happened, not a property of
//                 the embedding — and the smallest sample. Measured over 102
//                 observed moves: p10 0.633 | p50 0.828 | p75 0.892, against
//                 arbitrary pairs at p50 0.562. The old floor of 0.519 sat below
//                 the 10th percentile of moves that really happened.
//
// The three agree closely on the floor (0.519 / 0.671 / 0.633) and disagree more
// on the ceiling, which is expected — "definitely the same job" is rare and each
// estimator sees a different tail. Taking the median means no single estimator
// can move the scale alone, an unavailable one degrades gracefully, and a wrong
// one is outvoted. On this deployment it resolves to roughly 0.65 / 0.90.
//
// WHY THIS IS STILL NOT "per-run percentiles", which career deliberately refuses
// for its scale: those vary with who happens to be in the pool, an accident of
// the run. These vary only with the measuring instrument and with recorded
// history. Every run records the anchors AND the estimator breakdown it used in
// `runInfo.career.scale`, so a ranking finished before a re-baseline stays
// explainable — and visibly incomparable — afterwards.

import { query, vectorQuery } from "./db/postgres.js";
import { config } from "./config.js";
import { log } from "./llm.js";
import { censusSnapshotExists, storeCensusSnapshot } from "./run-trace.js";
import type {
  CareerCorpusCensusPayload,
  CareerFamilyCensusPayload,
  CareerTransitionsCensusPayload,
  CensusRef,
} from "./run-trace-types.js";

/** One estimate of the anchor pair, from one body of evidence. */
export type CareerAnchorEstimate = {
  source: "corpus" | "family" | "transitions";
  floor: number;
  ceil: number;
  /** Observations behind this estimate (pairs, labelled pairs, or moves). */
  sampleCount: number;
  /** What was measured, in the operator's language. */
  note: string;
};

export type CareerAnchors = {
  simFloor: number;
  simCeil: number;
  /**
   * env       — pinned by CAREER_SIM_FLOOR / _CEIL; nothing is computed.
   * measured  — median of the estimates in `estimates`.
   * fallback  — corpus too small or degenerate; config defaults, reported.
   */
  source: "env" | "measured" | "fallback";
  reason: string;
  /** Cross-pairs the corpus estimator ran over (0 when not measured). */
  sampleCount: number;
  docCount: number;
  /**
   * Every estimate that was available, not just the winning one. Empty for `env`
   * and `fallback`. Carried into `runInfo.career.scale` so the run-config panel
   * can show that three different questions were asked and where they agreed.
   */
  estimates: CareerAnchorEstimate[];
  /** Composite fingerprint of every input the estimators read (null when nothing was measured). */
  fingerprint?: string | null;
  /** The stored distributions behind the estimates (drizzle/0092), for the trace export. */
  census?: CensusRef[];
};

/** A corpus smaller than this cannot describe a distribution worth trusting. */
const MIN_DOCS = 30;

/** A floor/ceil band narrower than this carries no ranking information. */
const MIN_SPREAD = 0.05;

/**
 * At or above this cosine two documents are the SAME job — a re-upload, or two
 * profiles whose restructured text came out identical. They are excluded before
 * the ceiling is measured: this corpus has 46 such pairs across 37 documents,
 * enough to pin a max-based ceiling at exactly 1.0 and to reach p99 as well.
 */
const DUPLICATE_SIM = 0.999;

/**
 * Cap on documents entering the corpus census. The pair count is quadratic and
 * every pair is a real 768-dim cosine, so an uncapped census on a large corpus
 * would stall the scoring run that triggered it (275 docs = 75k pairs is
 * seconds; 4,000 docs = 16M pairs is not). The subset is chosen by `md5(id)`
 * rather than randomly so the same corpus always yields the same anchors — a
 * census that returned a slightly different band on every recompute would
 * reintroduce exactly the drift this module exists to remove.
 */
const MAX_CENSUS_DOCS = 1200;

/**
 * Minimum labelled pairs / observed moves before an estimator is trusted. The
 * family estimator reads thousands of pairs so it effectively never trips this;
 * `transitions` genuinely can, and a floor read off 8 moves would be noise
 * wearing the authority of ground truth.
 */
const MIN_FAMILY_PAIRS = 200;
const MIN_TRANSITIONS = 25;

const ENV_FLOOR = process.env.CAREER_SIM_FLOOR;
const ENV_CEIL = process.env.CAREER_SIM_CEIL;

/** Running-precision support before the family sweep may set an anchor. */
const FAMILY_MIN_SUPPORT = 30;

/**
 * Identity of the MEASUREMENT METHOD, not of the corpus. Part of the fingerprint,
 * and it has to be: the cached row is only reusable if it answers the same
 * question. When the estimator set changed from "p25 of arbitrary pairs" to
 * "median of three estimators", every stored row became an answer to a question
 * nobody is asking any more — but the corpus had not moved, so the fingerprint
 * still matched and the stale value was served forever. That defect is invisible
 * from the outside: the API returns 200, the run completes, the score is wrong.
 *
 * Bump this whenever what `measureCorpus` / `measureFamily` / `measureTransitions`
 * compute changes, or when an estimator is added or removed. A bump costs one
 * census on the next run and nothing else.
 */
const METHOD_VERSION = "v2-median-of-3";

/** The estimators' rules, recorded on every run's trace so the XLSX can restate them. */
export const CAREER_ANCHOR_PARAMS = {
  minDocs: MIN_DOCS,
  minSpread: MIN_SPREAD,
  duplicateSim: DUPLICATE_SIM,
  maxCensusDocs: MAX_CENSUS_DOCS,
  minFamilyPairs: MIN_FAMILY_PAIRS,
  minTransitions: MIN_TRANSITIONS,
  familyMinSupport: FAMILY_MIN_SUPPORT,
  corpusFloorPercentile: 0.25,
  corpusCeilPercentile: 0.99,
  familyFloorPrecision: 0.5,
  familyCeilPrecision: 0.95,
  transitionsFloorPercentile: 0.1,
  transitionsCeilPercentile: 0.75,
  methodVersion: METHOD_VERSION,
} as const;

/**
 * The parts of the composite fingerprint, so each census is stored under only
 * the inputs IT reads: the corpus census does not move when the Monday sync adds
 * a stint, and must not be re-stored every week because the composite did.
 */
type FingerprintParts = {
  corpus: string;
  model: string | null;
  topicRun: string | null;
  topicRows: string | null;
  history: string | null;
};

function censusFingerprints(p: FingerprintParts, limit: number) {
  const base = `${p.corpus}:${p.model ?? ""}`;
  return {
    corpus: `${base}:cap${limit}`,
    family: `${base}:t${p.topicRun ?? "none"}/${p.topicRows ?? "0"}`,
    transitions: `${base}:h${p.history ?? "none"}`,
  };
}

/**
 * Identity of every input the estimators read. A cached row is reusable only if
 * ALL of them are unchanged, because the cached numbers describe them jointly.
 *
 * FOUR components, and dropping any one produces a silent wrong answer rather
 * than a failure — the API still returns 200, the run still completes, the score
 * is just calibrated against something that no longer exists:
 *
 *   • the DOCUMENTS (`job_profile_id`, `content_hash`) — a re-embed with changed
 *     text, or an added/removed JD, must recompute.
 *   • the MODEL — the same documents in a different space have a different
 *     distribution.
 *   • the LABELS — the topic run behind `family` and the career history behind
 *     `transitions`. Both move WITHOUT the vectors moving: a re-clustering
 *     reassigns every topic id (this deployment has 8 completed topic runs
 *     already), and the Monday HR sync adds stints that change which internal
 *     moves exist. An earlier version of this module left them out and argued the
 *     estimators were "stable in aggregate". That argument is wrong in the way
 *     that matters: the failure is invisible, and the fix costs one aggregate
 *     query.
 *   • the METHOD — a cached value only answers the question the method asked.
 *     Omitting this is what made the first deploy of the three-estimator census
 *     keep serving the single-estimator numbers.
 *
 * What it still cannot see: a re-embed that produces DIFFERENT VECTORS from the
 * SAME text with the SAME model — a re-tuned embedding service, or a half-finished
 * earlier run. `content_hash` covers text+model only, and
 * `rebuildJobProfileEmbeddings` re-embeds everything unconditionally for exactly
 * that reason. So the eager refresh accepts `force`, and the rebuild passes it;
 * nothing else here could detect that case.
 */
async function resolveFingerprint(): Promise<{
  fingerprint: string;
  model: string | null;
  docs: number;
  parts: FingerprintParts;
} | null> {
  const rows = await vectorQuery<{
    fingerprint: string | null;
    model: string | null;
    docs: string;
  }>(
    `SELECT md5(string_agg(job_profile_id::text || ':' || COALESCE(content_hash, ''), ','
                           ORDER BY job_profile_id)) AS fingerprint,
            max(embedding_model) AS model,
            count(*) AS docs
     FROM job_profile_embed
     WHERE embedding IS NOT NULL`
  ).catch(() => []);
  const r = rows[0];
  if (!r || !r.fingerprint) return null;

  // `fingerprint` is varchar(200) (drizzle/0067, widened from 64 for exactly this
  // reason). md5 32 + model + labels ~40 + method 14 leaves room, but the model
  // name is the unbounded part — a HuggingFace-style path is 60 characters and
  // nothing stops a longer one. store() swallows write errors so a value that
  // overflowed would fail SILENTLY and re-census on every run, which is precisely
  // the failure drizzle/0067 was written about. Clamp instead of trusting the
  // arithmetic: truncating the tail costs nothing (the leading md5 already carries
  // the corpus identity) and cannot overflow.
  const labels = await labelParts();
  const composite = `${r.fingerprint}:${r.model ?? ""}:${formatLabelFingerprint(labels)}:${METHOD_VERSION}`;
  return {
    fingerprint: composite.length <= 200 ? composite : composite.slice(0, 200),
    model: r.model,
    docs: Number(r.docs),
    parts: {
      corpus: r.fingerprint,
      model: r.model,
      topicRun: labels?.topicRun ?? null,
      topicRows: labels?.topicRows ?? null,
      history: labels?.history ?? null,
    },
  };
}

/**
 * Identity of the two LABEL sources, in one round trip to the main database.
 *
 * The topic run's id is enough for `family`: a re-clustering is a new row, and a
 * new row means every assignment may have moved. The assignment count is carried
 * too so a partially-written run is not mistaken for the finished one.
 *
 * For `transitions` the material input is the ORDERED set of (candidate, position,
 * valid_from) — that is exactly what the move sequence is derived from — so it is
 * hashed rather than counted. A count alone would miss a corrected date, which
 * silently reorders somebody's career and changes which pairs are moves at all.
 *
 * On failure this returns a FIXED sentinel, never a random or time-based value.
 * A transient DB hiccup must degrade to "identity unchanged" — the previous
 * behaviour — and not to recomputing the census on every single run.
 */
async function labelParts(): Promise<{ topicRun: string; topicRows: string; history: string } | null> {
  const rows = await query<{
    topicRun: string | null;
    topicRows: string | null;
    history: string | null;
  }>(
    `WITH latest AS (
       -- MUST match measureFamily()'s own selection exactly. If the fingerprint
       -- names one run and the estimator reads another, a change in the run the
       -- estimator uses is invisible here and the stale calibration is served
       -- forever — the same class of bug METHOD_VERSION exists to prevent.
       SELECT r.id, count(*) AS n
         FROM job_family_topic_runs r
         JOIN job_family_topic_assignments x ON x.run_id = r.id AND x.topic_id >= 0
        WHERE r.status = 'completed'
        GROUP BY r.id, r.created_at
       HAVING count(*) >= $1
        ORDER BY r.created_at DESC
        LIMIT 1
     )
     SELECT (SELECT id::text FROM latest) AS "topicRun",
            (SELECT n::text FROM latest) AS "topicRows",
            -- One pass over candidate_position_history. ~2k rows here; if that
            -- table ever grows past ~100k this is the line to revisit, because it
            -- runs on every scoring run that has to check freshness.
            (SELECT md5(COALESCE(string_agg(
                      h.candidate_id::text || ':' || COALESCE(h.position_id, '') || ':' ||
                      COALESCE(h.valid_from::text, ''),
                      ',' ORDER BY h.candidate_id, h.valid_from, h.position_id), ''))
               FROM candidate_position_history h) AS "history"`,
    [MIN_DOCS]
  ).catch(() => [] as { topicRun: string | null; topicRows: string | null; history: string | null }[]);
  const r = rows[0];
  if (!r) return null;
  return { topicRun: r.topicRun ?? "none", topicRows: r.topicRows ?? "0", history: r.history ?? "none" };
}

/**
 * Short forms on purpose: 8 hex of a uuid and 16 of an md5 both keep collisions
 * far below anything reachable here, and the readable shape is worth keeping —
 * reading this string out of the database is how a mis-selected topic run was
 * actually caught. Byte-identical to the string this produced before the parts
 * were split out, so every stored calibration stays valid.
 */
function formatLabelFingerprint(p: { topicRun: string; topicRows: string; history: string } | null): string {
  if (!p) return "labels-unavailable";
  return `t${p.topicRun.slice(0, 8)}/${p.topicRows}/h${p.history.slice(0, 16)}`;
}

type CorpusMeasurement = {
  floor: number;
  ceil: number;
  arbitraryP50: number;
  bestP50: number;
  duplicatePairs: number;
  pairs: number;
  docs: number;
};

/**
 * ESTIMATOR 1 — corpus. Two distributions answering two different questions.
 *
 *  • ARBITRARY cross-document pairs → the floor. Career compares one target
 *    document against one stint document; there is no maximisation, so the
 *    relevant baseline is what an ordinary pair looks like. p25 of it, NOT the
 *    median: this distribution is not purely unrelated — 275 profiles of one
 *    company hold many genuinely related pairs, concentrated in its upper tail.
 *
 *  • BEST match per document, duplicates removed → the ceiling. What a genuine
 *    near-twin position actually scores.
 *
 * Known to sit low at the floor (see the header). Kept because it is the only
 * estimator that needs no labels at all, and a deployment with no topic run and
 * no recorded history still has to produce a number.
 *
 * `pairs` contains both (a,b) and (b,a). Symmetric duplication does not move a
 * percentile, and `best` groups by the left side, so neither result is affected.
 */
async function measureCorpus(limit: number): Promise<CorpusMeasurement | null> {
  const rows = await vectorQuery<Record<string, string | null>>(
    `WITH v AS (
       SELECT job_profile_id AS id, embedding
       FROM job_profile_embed
       WHERE embedding IS NOT NULL
       ORDER BY md5(job_profile_id::text)
       LIMIT $1
     ),
     pairs AS (
       SELECT a.id AS aid, 1 - (a.embedding <=> b.embedding) AS sim
       FROM v a JOIN v b ON b.id <> a.id
     ),
     genuine AS (SELECT aid, sim FROM pairs WHERE sim < $2),
     best AS (SELECT aid, max(sim) AS sim FROM genuine GROUP BY aid)
     SELECT
       (SELECT count(*) FROM v)                                              AS docs,
       (SELECT count(*) FROM pairs)                                          AS n_pairs,
       (SELECT count(*) FROM pairs WHERE sim >= $2)                          AS dup_pairs,
       (SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY sim) FROM pairs)  AS arb_p25,
       (SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY sim) FROM pairs)  AS arb_p50,
       (SELECT percentile_cont(0.50) WITHIN GROUP (ORDER BY sim) FROM best)   AS best_p50,
       (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY sim) FROM best)   AS best_p99`,
    [limit, DUPLICATE_SIM]
  ).catch(() => []);
  const r = rows[0];
  if (!r || r.arb_p25 == null || r.best_p99 == null) return null;
  return {
    floor: Number(r.arb_p25),
    ceil: Number(r.best_p99),
    arbitraryP50: Number(r.arb_p50 ?? 0),
    bestP50: Number(r.best_p50 ?? 0),
    duplicatePairs: Number(r.dup_pairs ?? 0),
    pairs: Number(r.n_pairs ?? 0),
    docs: Number(r.docs ?? 0),
  };
}

/**
 * ESTIMATOR 2 — family. The cosine at which a pair stops being noise, read off a
 * precision curve instead of a percentile.
 *
 * Sweeps the pairs in descending cosine and records where running precision
 * ("share of pairs so far that really are same-family") drops through 50% and
 * 95%. Those are the two statements the anchors are supposed to make: below the
 * floor, calling a pair related is wrong more often than right; at the ceiling,
 * it is essentially certain.
 *
 * Labels come from the last COMPLETED topic run — the same rule the Job Family
 * readers follow, because the newest row of ANY status lets one failed run close
 * the estimator permanently while good results sit right behind it.
 *
 * The topic assignments live in the MAIN database and the vectors in the vector
 * database, which need not be the same instance — so the labels are fetched and
 * passed in as arrays rather than joined across that boundary.
 */
async function measureFamily(): Promise<{
  estimate: CareerAnchorEstimate | null;
  census: CareerFamilyCensusPayload | null;
}> {
  const none = { estimate: null, census: null };
  // The newest completed run THAT ACTUALLY HAS ASSIGNMENTS — not merely the newest
  // completed one. A run can be marked completed with zero rows (a crash between
  // the status write and the assignment write, or a config that clustered nothing),
  // and picking it makes this estimator silently vanish while a perfectly good
  // clustering sits one row behind. That is the same failure mode the readers in
  // lib/job-family-optimize-actions.ts avoid by refusing the newest row of ANY
  // status; this is one step further, because "completed" is not proof of content.
  const labels = await query<{ jobProfileId: number; topicId: number; runId: string }>(
    `SELECT a.job_profile_id AS "jobProfileId", a.topic_id AS "topicId", a.run_id::text AS "runId"
       FROM job_family_topic_assignments a
      WHERE a.topic_id >= 0
        AND a.run_id = (
              SELECT r.id
                FROM job_family_topic_runs r
                JOIN job_family_topic_assignments x ON x.run_id = r.id AND x.topic_id >= 0
               WHERE r.status = 'completed'
               GROUP BY r.id, r.created_at
              HAVING count(*) >= $1
               ORDER BY r.created_at DESC
               LIMIT 1)`,
    [MIN_DOCS]
  ).catch(() => []);
  if (labels.length < MIN_DOCS) return none;

  const ids = labels.map((l) => l.jobProfileId);
  const topics = labels.map((l) => l.topicId);

  // One row per ordered pair, carrying whether the two share a family. Ordered
  // rather than unordered because the percentile-free sweep below only needs a
  // monotone ordering, and (a,b)+(b,a) duplicates every pair symmetrically —
  // which changes no ratio.
  const rows = await vectorQuery<{ sim: string; same: boolean; a: number; b: number }>(
    `WITH lbl AS (
       SELECT * FROM unnest($1::int[], $2::int[]) AS t(pid, topic)
     ),
     v AS (
       SELECT e.job_profile_id AS id, e.embedding, l.topic
       FROM job_profile_embed e
       JOIN lbl l ON l.pid = e.job_profile_id
       WHERE e.embedding IS NOT NULL
     )
     SELECT (1 - (a.embedding <=> b.embedding))::text AS sim,
            (a.topic = b.topic) AS same,
            a.id AS a, b.id AS b
     FROM v a JOIN v b ON b.id > a.id
     WHERE 1 - (a.embedding <=> b.embedding) < $3
     ORDER BY sim DESC`,
    [ids, topics, DUPLICATE_SIM]
  ).catch(() => []);
  if (rows.length < MIN_FAMILY_PAIRS) return none;

  // `ORDER BY sim DESC` on a text cast does not sort numerically — sort here.
  // Array#sort is stable, so ties keep the SQL order; the census below stores the
  // pairs in exactly this order because the running precision at a tie depends
  // on it.
  const pairs = rows
    .map((r) => ({ sim: Number(r.sim), same: r.same, a: Number(r.a), b: Number(r.b) }))
    .filter((p) => Number.isFinite(p.sim))
    .sort((a, b) => b.sim - a.sim);

  const census: CareerFamilyCensusPayload = {
    topicRunId: labels[0]?.runId ?? null,
    topicRows: labels.length,
    minSupport: FAMILY_MIN_SUPPORT,
    duplicateSim: DUPLICATE_SIM,
    labels: labels.map((l) => [l.jobProfileId, l.topicId]),
    pairs: pairs.map((p) => [p.a, p.b, p.sim, p.same ? 1 : 0]),
  };

  // Walk down the ranking; the FIRST cosine at which precision falls through a
  // threshold is that threshold's anchor. A minimum support of 30 keeps the top
  // few pairs — where precision is 1/1 or 0/1 — from deciding the ceiling.
  let tp = 0;
  let seen = 0;
  let ceil: number | null = null;
  let floor: number | null = null;
  const positives = pairs.filter((p) => p.same).length;
  for (const p of pairs) {
    seen += 1;
    if (p.same) tp += 1;
    if (seen < FAMILY_MIN_SUPPORT) continue;
    const precision = tp / seen;
    if (ceil == null && precision < 0.95) ceil = p.sim;
    if (floor == null && precision < 0.5) {
      floor = p.sim;
      break;
    }
  }
  if (floor == null || ceil == null || !(ceil > floor)) return { estimate: null, census };

  return {
    census,
    estimate: {
      source: "family",
      floor,
      ceil,
      sampleCount: pairs.length,
      note:
        `Diukur dari kurva ketepatan terhadap ${new Set(topics).size} rumpun jabatan hasil pengelompokan terakhir yang berhasil: ` +
        `pada kemiripan ${floor.toFixed(3)} peluang dua jabatan benar-benar serumpun turun ke 50%, dan pada ${ceil.toFixed(3)} masih 95%. ` +
        `Dihitung atas ${pairs.length} pasangan berlabel (${positives} serumpun). ` +
        `Catatan: rumpun itu sendiri dibentuk dari vektor yang sama, jadi angka ini tidak sepenuhnya independen — karena itu ia hanya satu dari tiga.`,
    },
  };
}

/**
 * ESTIMATOR 3 — transitions. REVEALED PREFERENCE: what a career step actually
 * looks like, measured from steps that actually happened.
 *
 * The literature on occupational mobility networks measures the relatedness of
 * two jobs by how often people really move between them, rather than by how
 * similar their descriptions read. This deployment has that data — every
 * candidate's `candidate_position_history`, ordered by `valid_from`, is a
 * sequence of real internal moves — and it is the ONLY evidence here that is not
 * derived from the embedding it is being used to calibrate.
 *
 * p10 as the floor: a move below that cosine is one almost nobody makes, so a
 * stint that far from the target should not read as relevant experience. p75 as
 * the ceiling rather than the max: this sample is small, and one anomalous
 * lateral would otherwise set the top of the scale for everyone.
 *
 * Two resolution tiers — position code embedded in the JD file name, then exact
 * title — mirroring the highest-precision tiers of the engine's own matcher. The
 * looser tiers (embedding cosine, AI) are deliberately excluded: this estimator
 * exists to be trustworthy, and pairing a stint by cosine similarity and then
 * measuring that cosine would be circular in the one place circularity is not
 * already acknowledged.
 */
async function measureTransitions(): Promise<{
  estimate: CareerAnchorEstimate | null;
  census: CareerTransitionsCensusPayload | null;
}> {
  const moves = await query<{ fromId: number; toId: number }>(
    `WITH jp AS (
       SELECT id,
              upper(btrim(split_part(regexp_replace(file_name, '\\.[^.]*$', ''), ' ', 1))) AS code,
              upper(btrim(position_name)) AS pname
         FROM sync_job_profiles
        WHERE status = 'completed'
     ),
     resolved AS (
       SELECT h.candidate_id, h.valid_from,
              COALESCE(by_code.id, by_title.id) AS jpid
         FROM candidate_position_history h
         LEFT JOIN jp by_code  ON by_code.code = upper(btrim(h.position_id))
         LEFT JOIN jp by_title ON by_title.pname =
                   upper(btrim(COALESCE(h.internal_title, h.external_title)))
        WHERE h.valid_from IS NOT NULL
     ),
     seq AS (
       SELECT candidate_id, jpid,
              lag(jpid) OVER (PARTITION BY candidate_id ORDER BY valid_from) AS prev
         FROM resolved
        WHERE jpid IS NOT NULL
     )
     SELECT DISTINCT prev AS "fromId", jpid AS "toId"
       FROM seq
      WHERE prev IS NOT NULL AND prev <> jpid`
  ).catch(() => []);
  if (moves.length < MIN_TRANSITIONS) return { estimate: null, census: null };

  const from = moves.map((m) => m.fromId);
  const to = moves.map((m) => m.toId);

  // The per-move cosines, by the same expression the percentiles below are taken
  // over — kept as the census so the export can restate p10/p75 as
  // PERCENTILE.INC over these values. A side without a vector stays in the list
  // with a null sim, because the estimator's inner join drops exactly those.
  const simRows = await vectorQuery<{ a: number; b: number; sim: number | string | null }>(
    `WITH mv AS (
       SELECT * FROM unnest($1::int[], $2::int[]) WITH ORDINALITY AS t(a, b, ord)
     )
     SELECT mv.a, mv.b,
            CASE WHEN x.embedding IS NOT NULL AND y.embedding IS NOT NULL
                 THEN 1 - (x.embedding <=> y.embedding) END AS sim
       FROM mv
       LEFT JOIN job_profile_embed x ON x.job_profile_id = mv.a
       LEFT JOIN job_profile_embed y ON y.job_profile_id = mv.b
      ORDER BY mv.ord`,
    [from, to]
  ).catch(() => [] as { a: number; b: number; sim: number | string | null }[]);
  const census: CareerTransitionsCensusPayload = {
    duplicateSim: DUPLICATE_SIM,
    moves: simRows.map((r) => [Number(r.a), Number(r.b), r.sim == null ? null : Number(r.sim)]),
  };

  const rows = await vectorQuery<{ p10: string | null; p50: string | null; p75: string | null; n: string }>(
    `WITH mv AS (
       SELECT * FROM unnest($1::int[], $2::int[]) AS t(a, b)
     ),
     sims AS (
       SELECT 1 - (x.embedding <=> y.embedding) AS sim
         FROM mv
         JOIN job_profile_embed x ON x.job_profile_id = mv.a
         JOIN job_profile_embed y ON y.job_profile_id = mv.b
        WHERE x.embedding IS NOT NULL AND y.embedding IS NOT NULL
     ),
     genuine AS (SELECT sim FROM sims WHERE sim < $3)
     SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY sim) AS p10,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY sim) AS p50,
            percentile_cont(0.75) WITHIN GROUP (ORDER BY sim) AS p75,
            count(*) AS n
       FROM genuine`,
    [from, to, DUPLICATE_SIM]
  ).catch(() => []);
  const r = rows[0];
  const withCensus = (estimate: CareerAnchorEstimate | null) => ({
    estimate,
    census: census.moves.length > 0 ? census : null,
  });
  if (!r || r.p10 == null || r.p75 == null) return withCensus(null);
  const n = Number(r.n ?? 0);
  if (n < MIN_TRANSITIONS) return withCensus(null);
  const floor = Number(r.p10);
  const ceil = Number(r.p75);
  if (!(ceil > floor)) return withCensus(null);

  return withCensus({
    source: "transitions",
    floor,
    ceil,
    sampleCount: n,
    note:
      `Diukur dari ${n} perpindahan jabatan internal yang BENAR-BENAR terjadi (riwayat karir karyawan, kedua ujungnya punya job profile): ` +
      `persentil 10 = ${floor.toFixed(3)}, tengah = ${Number(r.p50 ?? 0).toFixed(3)}, persentil 75 = ${ceil.toFixed(3)}. ` +
      `Ini satu-satunya acuan yang tidak diturunkan dari kemiripan teks — isinya keputusan mutasi yang sudah pernah diambil.`,
  });
}

/**
 * The corpus estimator's raw material: every unordered pair (a < b) of the
 * md5-ordered, capped document set, by the same `v` CTE `measureCorpus` uses.
 * `measureCorpus` takes its percentiles over ordered pairs (a,b) AND (b,a); the
 * cosine is symmetric, so the export restores the ordered list by listing each
 * pair twice — which is what PERCENTILE.INC needs to equal percentile_cont here.
 */
async function measureCorpusCensus(limit: number, model: string | null): Promise<CareerCorpusCensusPayload | null> {
  const [docs, pairs] = await Promise.all([
    vectorQuery<{ id: number }>(
      `SELECT id FROM (
         SELECT job_profile_id AS id FROM job_profile_embed
          WHERE embedding IS NOT NULL
          ORDER BY md5(job_profile_id::text)
          LIMIT $1
       ) v ORDER BY id`,
      [limit]
    ),
    vectorQuery<{ a: number; b: number; sim: number | string }>(
      `WITH v AS (
         SELECT job_profile_id AS id, embedding
         FROM job_profile_embed
         WHERE embedding IS NOT NULL
         ORDER BY md5(job_profile_id::text)
         LIMIT $1
       )
       SELECT a.id AS a, b.id AS b, 1 - (a.embedding <=> b.embedding) AS sim
       FROM v a JOIN v b ON b.id > a.id
       ORDER BY a.id, b.id`,
      [limit]
    ),
  ]).catch((err) => {
    log("careerAnchors.corpusCensusFailed", { error: err instanceof Error ? err.message : String(err) });
    return [null, null] as const;
  });
  if (!docs || !pairs || pairs.length === 0) return null;
  return {
    model,
    limit,
    duplicateSim: DUPLICATE_SIM,
    docs: docs.map((d) => Number(d.id)),
    pairs: pairs.map((p) => [Number(p.a), Number(p.b), Number(p.sim)]),
  };
}

/**
 * Store the three census distributions behind a measured pair of anchors, each
 * under its own input fingerprint. `fresh` carries what this resolution already
 * measured (no second pass); anything missing is measured now — the back-fill
 * for calibrations cached before drizzle/0092. Never throws.
 */
async function ensureCareerCensus(
  fp: { parts: FingerprintParts; model: string | null; docs: number },
  fresh: { family?: CareerFamilyCensusPayload | null; transitions?: CareerTransitionsCensusPayload | null }
): Promise<CensusRef[]> {
  const limit = Math.min(fp.docs, MAX_CENSUS_DOCS);
  const keys = censusFingerprints(fp.parts, limit);
  const refs: CensusRef[] = [];
  // For each census: already stored → reference it; store unreadable (null) →
  // neither measure nor reference; absent → measure, store, and reference only
  // what the store accepted.
  const keep = (ref: CensusRef | null) => {
    if (ref) refs.push(ref);
  };
  try {
    const corpusStored = await censusSnapshotExists("career_corpus", keys.corpus);
    if (corpusStored) {
      refs.push({ kind: "career_corpus", fingerprint: keys.corpus.slice(0, 200) });
    } else if (corpusStored === false) {
      const corpus = await measureCorpusCensus(limit, fp.model);
      if (corpus) keep(await storeCensusSnapshot("career_corpus", keys.corpus, corpus, corpus.pairs.length));
    }

    const familyStored = await censusSnapshotExists("career_family", keys.family);
    if (familyStored) {
      refs.push({ kind: "career_family", fingerprint: keys.family.slice(0, 200) });
    } else if (familyStored === false) {
      const family = fresh.family !== undefined ? fresh.family : (await measureFamily().catch(() => null))?.census ?? null;
      if (family) keep(await storeCensusSnapshot("career_family", keys.family, family, family.pairs.length));
    }

    const transitionsStored = await censusSnapshotExists("career_transitions", keys.transitions);
    if (transitionsStored) {
      refs.push({ kind: "career_transitions", fingerprint: keys.transitions.slice(0, 200) });
    } else if (transitionsStored === false) {
      const transitions =
        fresh.transitions !== undefined
          ? fresh.transitions
          : (await measureTransitions().catch(() => null))?.census ?? null;
      if (transitions) {
        keep(await storeCensusSnapshot("career_transitions", keys.transitions, transitions, transitions.moves.length));
      }
    }
  } catch (err) {
    log("careerAnchors.censusFailed", { error: err instanceof Error ? err.message : String(err) });
  }
  return refs;
}

/** Median of an unsorted numeric array. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

async function readStored(): Promise<{
  fingerprint: string;
  simFloor: number;
  simCeil: number;
  n: number;
  docs: number;
  estimates: CareerAnchorEstimate[];
} | null> {
  const rows = await query<{
    fingerprint: string;
    sim_floor: number;
    sim_ceil: number;
    sample_count: number;
    doc_count: number;
    estimators: { estimates?: CareerAnchorEstimate[] } | null;
  }>(
    `SELECT fingerprint, sim_floor, sim_ceil, sample_count, doc_count, estimators
     FROM job_profile_similarity_calibration WHERE singleton = TRUE`
  ).catch(() => []);
  const r = rows[0];
  return r
    ? {
        fingerprint: r.fingerprint,
        simFloor: Number(r.sim_floor),
        simCeil: Number(r.sim_ceil),
        n: Number(r.sample_count),
        docs: Number(r.doc_count),
        estimates: Array.isArray(r.estimators?.estimates) ? r.estimators!.estimates! : [],
      }
    : null;
}

async function store(
  fingerprint: string,
  model: string | null,
  m: CorpusMeasurement,
  floor: number,
  ceil: number,
  estimates: CareerAnchorEstimate[]
): Promise<void> {
  await query(
    `INSERT INTO job_profile_similarity_calibration
       (singleton, fingerprint, embedding_model, sim_floor, sim_ceil, sample_count,
        doc_count, arbitrary_p50, best_p50, duplicate_pairs, estimators,
        estimator_sources, computed_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     ON CONFLICT (singleton) DO UPDATE SET
       fingerprint = EXCLUDED.fingerprint,
       embedding_model = EXCLUDED.embedding_model,
       sim_floor = EXCLUDED.sim_floor,
       sim_ceil = EXCLUDED.sim_ceil,
       sample_count = EXCLUDED.sample_count,
       doc_count = EXCLUDED.doc_count,
       arbitrary_p50 = EXCLUDED.arbitrary_p50,
       best_p50 = EXCLUDED.best_p50,
       duplicate_pairs = EXCLUDED.duplicate_pairs,
       estimators = EXCLUDED.estimators,
       estimator_sources = EXCLUDED.estimator_sources,
       computed_at = NOW()`,
    [
      fingerprint,
      model,
      floor,
      ceil,
      m.pairs,
      m.docs,
      m.arbitraryP50,
      m.bestP50,
      m.duplicatePairs,
      JSON.stringify({ estimates, combine: "median" }),
      estimates.map((e) => e.source).join(","),
    ]
  ).catch((err) => {
    // A pending migration must not fail a scoring run — the measurement still
    // stands for this run, it just is not cached for the next one.
    log("careerAnchors.storeFailed", { error: String(err) });
  });
}

function fallback(reason: string): CareerAnchors {
  return {
    simFloor: config.ahpTopsis.career.simFloor,
    simCeil: config.ahpTopsis.career.simCeil,
    source: "fallback",
    reason,
    sampleCount: 0,
    docCount: 0,
    estimates: [],
  };
}

/**
 * Resolve the anchors for one run. Precedence mirrors the technical aspect:
 *
 *   1. env pin — an operator who set CAREER_SIM_FLOOR/_CEIL means it, and
 *      nothing here should quietly overrule them.
 *   2. stored calibration whose fingerprint matches every current input.
 *   3. a fresh census across all three estimators, persisted for next time.
 *   4. the config defaults, reported as such.
 *
 * `force` skips step 2 only. It exists for the one change no fingerprint can
 * see: a re-embed that produces different VECTORS from the same text with the
 * same model. `rebuildJobProfileEmbeddings` re-embeds unconditionally for exactly
 * that reason, so the rebuild passes force and the anchors follow. It never skips
 * the env pin — an operator's pin outranks a rebuild.
 */
export async function resolveCareerAnchors(force = false): Promise<CareerAnchors> {
  if (ENV_FLOOR != null && ENV_CEIL != null) {
    const f = parseFloat(ENV_FLOOR);
    const c = parseFloat(ENV_CEIL);
    if (Number.isFinite(f) && Number.isFinite(c) && c > f) {
      return {
        simFloor: f,
        simCeil: c,
        source: "env",
        reason: `Batas bawah dan batas atas ditetapkan manual lewat CAREER_SIM_FLOOR/CAREER_SIM_CEIL (${f}–${c}); tidak ada pengukuran yang dijalankan.`,
        sampleCount: 0,
        docCount: 0,
        estimates: [],
      };
    }
  }

  const fp = await resolveFingerprint();
  if (!fp) {
    return fallback(
      'Dokumen job profile belum diproses menjadi data pembanding, atau tidak terbaca — memakai batas bawaan. Jalankan "Bangun Ulang Embedding" pada Job Family.'
    );
  }
  if (fp.docs < MIN_DOCS) {
    return fallback(
      `Hanya ${fp.docs} dokumen job profile yang sudah diproses (minimum ${MIN_DOCS}) — terlalu sedikit untuk menggambarkan sebaran, memakai batas bawaan.`
    );
  }

  const stored = force ? null : await readStored();
  if (stored && stored.fingerprint === fp.fingerprint && stored.simCeil > stored.simFloor) {
    return {
      simFloor: stored.simFloor,
      simCeil: stored.simCeil,
      source: "measured",
      reason:
        `Kedua batas adalah nilai TENGAH dari ${stored.estimates.length || 1} cara pengukuran yang berbeda ` +
        `(${stored.estimates.map((e) => e.source).join(", ") || "corpus"}), dihitung atas ${stored.docs} dokumen job profile ` +
        `dan dipakai ulang karena SELURUH bahan pengukurannya belum berubah sejak perhitungan terakhir: isi dokumen job profile, ` +
        `model teks yang dipakai, hasil pengelompokan rumpun jabatan, dan riwayat jabatan karyawan. ` +
        `Begitu salah satu berubah, kedua batas dihitung ulang otomatis pada run berikutnya.`,
      sampleCount: stored.n,
      docCount: stored.docs,
      estimates: stored.estimates,
      fingerprint: fp.fingerprint,
      census: await ensureCareerCensus(fp, {}),
    };
  }

  const limit = Math.min(fp.docs, MAX_CENSUS_DOCS);
  const corpus = await measureCorpus(limit);
  if (!corpus) {
    return fallback(
      "Perbandingan kemiripan antar-dokumen job profile gagal dijalankan — memakai batas bawaan."
    );
  }

  // The two label-based estimators are independent of each other and of the
  // corpus one; a failure in either must degrade the median, never the run.
  const [familyM, transitionsM] = await Promise.all([
    measureFamily().catch(() => ({ estimate: null, census: null })),
    measureTransitions().catch(() => ({ estimate: null, census: null })),
  ]);
  const family = familyM.estimate;
  const transitions = transitionsM.estimate;

  const estimates: CareerAnchorEstimate[] = [
    {
      source: "corpus",
      floor: corpus.floor,
      ceil: corpus.ceil,
      sampleCount: corpus.pairs,
      note:
        `Batas bawah = persentil 25 kemiripan antar-dokumen sembarang (median ${corpus.arbitraryP50.toFixed(3)}); ` +
        `batas atas = persentil 99 kemiripan kembar terdekat tiap dokumen setelah ${corpus.duplicatePairs} pasangan duplikat dibuang ` +
        `(median kembar ${corpus.bestP50.toFixed(3)}). Dihitung atas ${corpus.docs} dokumen / ${corpus.pairs} pasangan. ` +
        `Cara ini tidak butuh label apa pun, tapi cenderung menaruh batas bawah terlalu rendah — karena itu ia hanya satu dari tiga.`,
    },
  ];
  if (family) estimates.push(family);
  if (transitions) estimates.push(transitions);

  const floor = median(estimates.map((e) => e.floor));
  const ceil = median(estimates.map((e) => e.ceil));

  if (!(ceil - floor >= MIN_SPREAD)) {
    return fallback(
      `Jarak antara batas bawah dan batas atas terlalu sempit (${floor.toFixed(4)}–${ceil.toFixed(4)}) untuk membedakan apa pun — memakai batas bawaan.`
    );
  }

  await store(fp.fingerprint, fp.model, corpus, floor, ceil, estimates);
  log("careerAnchors.recomputed", {
    floor: Number(floor.toFixed(4)),
    ceil: Number(ceil.toFixed(4)),
    estimators: estimates.map((e) => ({
      source: e.source,
      floor: Number(e.floor.toFixed(4)),
      ceil: Number(e.ceil.toFixed(4)),
      n: e.sampleCount,
    })),
    docs: corpus.docs,
    model: fp.model,
  });

  const sampled =
    limit < fp.docs
      ? ` Diambil ${limit} dari ${fp.docs} dokumen (batas sensus, dipilih tetap lewat md5 agar hasilnya selalu sama).`
      : "";
  const missing = [
    family ? null : "rumpun jabatan",
    transitions ? null : "perpindahan nyata",
  ].filter(Boolean);

  return {
    simFloor: floor,
    simCeil: ceil,
    source: "measured",
    reason:
      `Kedua batas adalah nilai TENGAH dari ${estimates.length} cara pengukuran yang berbeda: ` +
      estimates
        .map((e) => `${e.source} (${e.floor.toFixed(3)}–${e.ceil.toFixed(3)}, ${e.sampleCount} data)`)
        .join("; ") +
      `. Nilai tengah dipakai agar satu cara pengukuran tidak bisa menggeser skala sendirian.` +
      (missing.length
        ? ` Belum tersedia: ${missing.join(" dan ")} — begitu ada, keduanya ikut diperhitungkan otomatis.`
        : "") +
      sampled,
    sampleCount: corpus.pairs,
    docCount: corpus.docs,
    estimates,
    fingerprint: fp.fingerprint,
    census: await ensureCareerCensus(fp, { family: familyM.census, transitions: transitionsM.census }),
  };
}
