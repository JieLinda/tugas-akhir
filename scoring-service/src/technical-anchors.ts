// Similarity anchors for the technical aspect, derived from the kamus embedding
// corpus and refreshed whenever that corpus changes.
//
// WHY THIS IS NOT A CONSTANT. A raw cosine is not a percentage, so semantic
// pairs are stretched onto 0..1 between a floor ("no closer than an arbitrary
// other competency in this dictionary") and a ceiling ("effectively the same
// competency"). Both are statements ABOUT A SPECIFIC CORPUS. Re-embedding the
// kamus, adding or removing competencies, or switching the embedding model
// moves the distribution those statements describe — and nothing fails when it
// does. Every cosine still computes; only the meaning of the score shifts. A
// hardcoded anchor is therefore wrong in the least detectable way possible.
//
// HOW "WHENEVER" IS MADE EXACT. Rather than hooking every path that can touch
// the kamus — the embed rebuild, the sync job, a manual DB edit — the corpus
// fingerprints itself: a hash over (code, level, content_hash) of every embedded
// row plus the model name. Any change moves the hash, and the next scoring run
// recomputes. A kamus edit that leaves the VECTORS alone correctly changes
// nothing, because the anchors describe vectors, not text.
//
// WHY THIS IS NOT "per-run percentiles", which the career aspect deliberately
// refuses: those vary with who happens to be in the pool, an accident of the
// run. These vary only with the measuring instrument. And every run records the
// anchors it used in `runInfo.technical`, so a ranking finished before a
// re-embed stays explainable afterwards.

import { query, vectorQuery } from "./db/postgres.js";
import { config } from "./config.js";
import { log } from "./llm.js";
import { censusSnapshotExists, storeCensusSnapshot } from "./run-trace.js";
import type { CensusRef, TechnicalCensusPayload } from "./run-trace-types.js";

export type TechnicalAnchors = {
  simFloor: number;
  simCeil: number;
  /**
   * env       — pinned by TECHNICAL_SIM_FLOOR / _CEIL; nothing is computed.
   * measured  — derived from the current corpus.
   * fallback  — corpus too small or degenerate; hardcoded defaults, reported.
   */
  source: "env" | "measured" | "fallback";
  reason: string;
  sampleCount: number;
  codeCount: number;
  /** Corpus fingerprint the measurement describes (null when nothing was measured). */
  fingerprint?: string | null;
  /** The stored census distribution behind a measured pair (drizzle/0092), for the trace export. */
  census?: CensusRef | null;
};

/** A corpus smaller than this cannot describe a distribution worth trusting. */
const MIN_CODES = 20;

/** A floor/ceil band narrower than this carries no ranking information. */
const MIN_SPREAD = 0.02;

/** The census rule, recorded on every run's trace so the XLSX can restate it. */
export const TECHNICAL_ANCHOR_PARAMS = {
  minCodes: MIN_CODES,
  minSpread: MIN_SPREAD,
  floorPercentile: 0.25,
  ceilPercentile: 0.99,
} as const;

/**
 * The census DISTRIBUTION behind a fingerprint — per (code, level) row, its best
 * similarity to a row of a different code, and which row that was. Same pairs
 * and the same max as `measure()` (DISTINCT ON … ORDER BY sim DESC picks exactly
 * the row `max()` returns), so PERCENTILE.INC over these values in the export is
 * Postgres' percentile_cont over `best.sim`.
 *
 * Measured once per fingerprint and stored (insert-if-absent): a fingerprint
 * names the corpus, so the distribution never changes under it. Calibrations
 * cached before drizzle/0092 get their census back-filled the first time a run
 * reads them. Best-effort — a failure leaves the run's anchors as they are and
 * the export says the distribution was not recorded.
 */
async function ensureTechnicalCensus(
  fingerprint: string,
  model: string | null,
  codes: number
): Promise<CensusRef | null> {
  const stored = await censusSnapshotExists("technical_kamus", fingerprint);
  if (stored === null) return null; // store unreadable: neither measure nor reference
  if (stored) return { kind: "technical_kamus", fingerprint: fingerprint.slice(0, 200) };
  const rows = await vectorQuery<{
    code: string;
    level: number | string;
    bestCode: string | null;
    bestLevel: number | string | null;
    sim: number | string;
  }>(
    `WITH pairs AS (
       SELECT a.code, a.level, b.code AS bcode, b.level AS blevel,
              1 - (a.embedding <=> b.embedding) AS sim
       FROM kamus_kompetensi_level_embed a
       JOIN kamus_kompetensi_level_embed b ON b.code <> a.code
       WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
     )
     SELECT DISTINCT ON (code, level)
            code, level, bcode AS "bestCode", blevel AS "bestLevel", sim
     FROM pairs
     ORDER BY code, level, sim DESC, bcode, blevel`
  ).catch((err) => {
    log("technicalAnchors.censusFailed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (!rows || rows.length === 0) return null;
  const payload: TechnicalCensusPayload = {
    model,
    codes,
    rows: rows.map((r) => ({
      code: r.code,
      level: Number(r.level),
      sim: Number(r.sim),
      bestCode: r.bestCode ?? null,
      bestLevel: r.bestLevel == null ? null : Number(r.bestLevel),
    })),
  };
  return storeCensusSnapshot("technical_kamus", fingerprint, payload, payload.rows.length);
}

const ENV_FLOOR = process.env.TECHNICAL_SIM_FLOOR;
const ENV_CEIL = process.env.TECHNICAL_SIM_CEIL;

/**
 * Hash of the embedded corpus. Cheap (one aggregate over ~360 rows) and exact:
 * it changes if any row's content hash changes, if rows appear or disappear, or
 * if the embedding model changes.
 */
async function corpusFingerprint(): Promise<{
  fingerprint: string;
  model: string | null;
  rows: number;
  codes: number;
} | null> {
  const rows = await vectorQuery<{
    fingerprint: string | null;
    model: string | null;
    rows: string;
    codes: string;
  }>(
    `SELECT md5(string_agg(code || ':' || level || ':' || COALESCE(content_hash, ''), ','
                           ORDER BY code, level)) AS fingerprint,
            max(embedding_model) AS model,
            count(*) AS rows,
            count(DISTINCT code) AS codes
     FROM kamus_kompetensi_level_embed
     WHERE embedding IS NOT NULL`
  ).catch(() => []);
  const r = rows[0];
  if (!r || !r.fingerprint) return null;
  return {
    // The model is part of the identity: the same documents embedded by a
    // different model occupy a different space with a different distribution.
    fingerprint: `${r.fingerprint}:${r.model ?? ""}`,
    model: r.model,
    rows: Number(r.rows),
    codes: Number(r.codes),
  };
}

/**
 * The census. For every embedded (code, level) row, the best similarity to any
 * row of a DIFFERENT code — that is the number that matters, because Hungarian
 * maximises and will always reach for the best wrong match available. The
 * anchors are percentiles of that per-row distribution rather than of all pairs:
 * ~360 samples instead of ~128k skewed ones, so p99 means something.
 */
async function measure(): Promise<{
  floor: number;
  ceil: number;
  p50: number;
  p95: number;
  n: number;
} | null> {
  const rows = await vectorQuery<{
    p25: string | null;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    n: string;
  }>(
    `WITH best AS (
       SELECT a.code, a.level, max(1 - (a.embedding <=> b.embedding)) AS sim
       FROM kamus_kompetensi_level_embed a
       JOIN kamus_kompetensi_level_embed b ON b.code <> a.code
       WHERE a.embedding IS NOT NULL AND b.embedding IS NOT NULL
       GROUP BY a.code, a.level
     )
     SELECT percentile_cont(0.25) WITHIN GROUP (ORDER BY sim) AS p25,
            percentile_cont(0.50) WITHIN GROUP (ORDER BY sim) AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY sim) AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY sim) AS p99,
            count(*) AS n
     FROM best`
  ).catch(() => []);
  const r = rows[0];
  if (!r || r.p25 == null || r.p99 == null) return null;
  return {
    floor: Number(r.p25),
    // p99, NOT the maximum: the max is a single point, so one near-duplicate
    // competency added to the kamus would pull the ceiling to ~0.99 and compress
    // every semantic score. On the corpus this was designed against they agree
    // (0.8905 vs 0.8917), so robustness costs nothing here.
    ceil: Number(r.p99),
    p50: Number(r.p50 ?? 0),
    p95: Number(r.p95 ?? 0),
    n: Number(r.n),
  };
}

async function readStored(): Promise<
  { fingerprint: string; simFloor: number; simCeil: number; n: number; codes: number } | null
> {
  const rows = await query<{
    fingerprint: string;
    sim_floor: number;
    sim_ceil: number;
    sample_count: number;
    code_count: number;
  }>(
    `SELECT fingerprint, sim_floor, sim_ceil, sample_count, code_count
     FROM kamus_similarity_calibration WHERE singleton = TRUE`
  ).catch(() => []);
  const r = rows[0];
  return r
    ? {
        fingerprint: r.fingerprint,
        simFloor: Number(r.sim_floor),
        simCeil: Number(r.sim_ceil),
        n: Number(r.sample_count),
        codes: Number(r.code_count),
      }
    : null;
}

async function store(
  fingerprint: string,
  model: string | null,
  m: { floor: number; ceil: number; p50: number; p95: number; n: number },
  codes: number
): Promise<void> {
  await query(
    `INSERT INTO kamus_similarity_calibration
       (singleton, fingerprint, embedding_model, sim_floor, sim_ceil, sample_count, code_count, p50, p95, computed_at)
     VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (singleton) DO UPDATE SET
       fingerprint = EXCLUDED.fingerprint,
       embedding_model = EXCLUDED.embedding_model,
       sim_floor = EXCLUDED.sim_floor,
       sim_ceil = EXCLUDED.sim_ceil,
       sample_count = EXCLUDED.sample_count,
       code_count = EXCLUDED.code_count,
       p50 = EXCLUDED.p50,
       p95 = EXCLUDED.p95,
       computed_at = NOW()`,
    [fingerprint, model, m.floor, m.ceil, m.n, codes, m.p50, m.p95]
  ).catch((err) => {
    // A pending migration must not fail a scoring run — the measurement still
    // stands for this run, it just is not cached for the next one.
    log("technicalAnchors.storeFailed", { error: String(err) });
  });
}

function fallback(reason: string): TechnicalAnchors {
  return {
    simFloor: config.ahpTopsis.technical.simFloor,
    simCeil: config.ahpTopsis.technical.simCeil,
    source: "fallback",
    reason,
    sampleCount: 0,
    codeCount: 0,
  };
}

/**
 * The kamus level-embedding corpus fingerprint, for a run to RECORD which
 * dictionary its technical scores were measured against (FR-SN-01, FR-RR-07 d).
 * Null when the corpus is empty or unreadable.
 */
export async function kamusCorpusFingerprint(): Promise<{
  fingerprint: string;
  codes: number;
  model: string | null;
} | null> {
  const fp = await corpusFingerprint();
  return fp ? { fingerprint: fp.fingerprint, codes: fp.codes, model: fp.model } : null;
}

/**
 * Resolve the anchors for one run. Precedence:
 *
 *   1. env pin — an operator who set TECHNICAL_SIM_FLOOR/_CEIL means it, and
 *      nothing here should quietly overrule them.
 *   2. stored calibration whose fingerprint matches the current corpus.
 *   3. a fresh census, persisted for next time.
 *   4. the hardcoded defaults, reported as such.
 */
export async function resolveTechnicalAnchors(): Promise<TechnicalAnchors> {
  if (ENV_FLOOR != null && ENV_CEIL != null) {
    const f = parseFloat(ENV_FLOOR);
    const c = parseFloat(ENV_CEIL);
    if (Number.isFinite(f) && Number.isFinite(c) && c > f) {
      return {
        simFloor: f,
        simCeil: c,
        source: "env",
        reason: `Batas bawah dan batas atas ditetapkan manual lewat TECHNICAL_SIM_FLOOR/TECHNICAL_SIM_CEIL (${f}–${c}); perbandingan isi kamus tidak dijalankan.`,
        sampleCount: 0,
        codeCount: 0,
      };
    }
  }

  const fp = await corpusFingerprint();
  if (!fp) {
    return fallback(
      "Isi kamus belum diproses menjadi data pembanding, atau tidak terbaca — memakai batas bawaan. Jalankan proses embedding kamus kompetensi."
    );
  }
  if (fp.codes < MIN_CODES) {
    return fallback(
      `Kamus hanya berisi ${fp.codes} kompetensi yang sudah diproses (minimum ${MIN_CODES}) — terlalu sedikit untuk menggambarkan sebaran, memakai batas bawaan.`
    );
  }

  const stored = await readStored();
  if (stored && stored.fingerprint === fp.fingerprint && stored.simCeil > stored.simFloor) {
    return {
      simFloor: stored.simFloor,
      simCeil: stored.simCeil,
      source: "measured",
      reason: `Kedua batas dihitung dengan membandingkan ${stored.codes} kompetensi kamus satu sama lain (${stored.n} titik pembanding), memakai isi kamus yang berlaku sekarang.`,
      sampleCount: stored.n,
      codeCount: stored.codes,
      fingerprint: fp.fingerprint,
      census: await ensureTechnicalCensus(fp.fingerprint, fp.model, fp.codes).catch(() => null),
    };
  }

  const m = await measure();
  if (!m || !(m.ceil - m.floor >= MIN_SPREAD)) {
    return fallback(
      m
        ? `Jarak antara batas bawah dan batas atas terlalu sempit (${m.floor.toFixed(4)}–${m.ceil.toFixed(4)}) untuk membedakan apa pun — memakai batas bawaan.`
        : "Perbandingan kemiripan antar-kompetensi kamus gagal dijalankan — memakai batas bawaan."
    );
  }

  await store(fp.fingerprint, fp.model, m, fp.codes);
  log("technicalAnchors.recomputed", {
    floor: Number(m.floor.toFixed(4)),
    ceil: Number(m.ceil.toFixed(4)),
    codes: fp.codes,
    model: fp.model,
  });

  return {
    simFloor: m.floor,
    simCeil: m.ceil,
    source: "measured",
    reason:
      stored == null
        ? `Kedua batas dihitung pertama kali dengan membandingkan ${fp.codes} kompetensi kamus satu sama lain (${m.n} titik pembanding).`
        : `Isi kamus berubah sejak perhitungan terakhir — kedua batas dihitung ulang dengan membandingkan ${fp.codes} kompetensi kamus satu sama lain (${m.n} titik pembanding).`,
    sampleCount: m.n,
    codeCount: fp.codes,
    fingerprint: fp.fingerprint,
    census: await ensureTechnicalCensus(fp.fingerprint, fp.model, fp.codes).catch(() => null),
  };
}
