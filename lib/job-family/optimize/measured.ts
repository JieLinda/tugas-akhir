// Judging a goal from MEASURED results — the half of the Job Family optimizer
// (Pengaturan → Optimasi Job Family) that decides whether a setting achieves
// what the user clicked, before anything is saved. Pure: no DB, no network.
//
// The measurements come from topic-service (POST /topics/trials), which runs
// the rebuild's own clustering code on the CURRENT corpus without persisting a
// run. Because the pipeline is deterministic, a setting measured here produces
// the same families when the map is rebuilt on the same corpus — so "the goal
// is met" is a measured fact about the next map, not a forecast. Everything in
// this file is about stating that fact honestly: which number the goal is
// judged by, what else got worse, and what cannot be judged without measuring
// again.

import type { BertopicConfig } from '@/lib/job-family/config';
import { normalizeJobFamilyConfig } from '@/lib/job-family/config';
import {
  compareToBaseline,
  scoreMetrics,
  type MetricDelta,
  type OptimizeGoal,
  type TopicMetrics,
} from './objective';

// ── What topic-service returns ────────────────────────────────────────

type TrialEcho = {
  /** `configKey(config)`, chosen by the web app and echoed back. */
  key: string;
  config: BertopicConfig;
  /** Why this config was tried (the candidate's reason), echoed back. */
  note: string;
};

/** One config measured on the current corpus. Per-document arrays are in job_profile_id order. */
export type TrialMeasurement = TrialEcho & {
  ok: true;
  topicCount: number;
  outlierCount: number;
  numDocuments: number;
  /** Size of each real family. */
  sizes: number[];
  /** c-TF-IDF keywords per family id. */
  keywords: Record<string, string[]>;
  /** Family id per document (-1 = outlier). Ids are frequency order: compare partitions, not ids. */
  membership: number[];
  /** Cosine to the document's own family centroid; null for outliers. */
  ownSimilarity: (number | null)[];
  /** Cosine to the nearest OTHER family centroid (for an outlier: the nearest family). */
  nearestSimilarity: (number | null)[];
  /** Placed by outlier re-homing rather than by clustering. */
  rehomed: boolean[];
};

export type TrialFailure = TrialEcho & { ok: false; error: string };

export type TrialResult = TrialMeasurement | TrialFailure;

// ── Config identity ───────────────────────────────────────────────────

/** A BERTopic config in the exact shape a save stores and a build receives. */
export function normalizeBertopic(config: Partial<BertopicConfig>): BertopicConfig {
  return normalizeJobFamilyConfig({ bertopic: config as BertopicConfig }).bertopic;
}

/** Stable identity of a config: same key ⇔ same parameters ⇔ same map on the same corpus. */
export function configKey(config: Partial<BertopicConfig>): string {
  const c = normalizeBertopic(config) as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(c).sort().map((k) => [k, c[k] ?? null]));
}

/** One parameter that differs, as a reviewer reads it. */
export type ParamChange = { key: string; from: string; to: string };

export function formatParamValue(v: unknown): string {
  if (v === null || v === undefined) return '(auto)';
  if (typeof v === 'boolean') return v ? 'aktif' : 'nonaktif';
  return String(v);
}

export function paramChanges(from: BertopicConfig, to: BertopicConfig): ParamChange[] {
  const a = from as unknown as Record<string, unknown>;
  const b = to as unknown as Record<string, unknown>;
  return Object.keys(b)
    .filter((k) => !Object.is(a[k], b[k]))
    .map((k) => ({ key: k, from: formatParamValue(a[k]), to: formatParamValue(b[k]) }));
}

// ── Metrics ───────────────────────────────────────────────────────────

/** Keywords per family compared by `labelOverlap` (the c-TF-IDF default top-N). */
const LABEL_KEYWORDS = 10;

export type MeasuredMetrics = {
  topicCount: number;
  numDocuments: number;
  outlierCount: number;
  /** 0–100, one decimal — the number the panel has always shown. */
  outlierPct: number;
  /** Real family sizes, largest first. */
  sizes: number[];
  /** Families with fewer than 3 members. */
  tinyCount: number;
  /** Largest family's share of the clustered documents, 0–1. */
  largestShare: number;
  medianSize: number;
  /** Coefficient of variation of family sizes (0 = all equal). */
  sizeCv: number;
  /**
   * Share of each family's top keywords that also appear among another
   * family's, averaged — a PROXY for how distinct the names are. Null when the
   * keywords are not known.
   */
  labelOverlap: number | null;
};

export function metricsFromSizes(
  sizes: number[],
  numDocuments: number,
  keywords?: Record<string, string[]> | string[][] | null,
): MeasuredMetrics {
  const sorted = [...sizes].sort((a, b) => b - a);
  const clustered = sorted.reduce((a, b) => a + b, 0);
  const outlierCount = Math.max(0, numDocuments - clustered);
  const mean = sorted.length ? clustered / sorted.length : 0;
  const variance = sorted.length
    ? sorted.reduce((acc, s) => acc + (s - mean) ** 2, 0) / sorted.length
    : 0;
  return {
    topicCount: sorted.length,
    numDocuments,
    outlierCount,
    outlierPct: numDocuments > 0 ? round1((outlierCount / numDocuments) * 100) : 0,
    sizes: sorted,
    tinyCount: sorted.filter((s) => s < 3).length,
    largestShare: clustered > 0 ? round2(sorted[0]! / clustered) : 0,
    medianSize: median(sorted),
    sizeCv: sorted.length > 1 && mean > 0 ? round2(Math.sqrt(variance) / mean) : 0,
    labelOverlap: keywords ? labelOverlap(Array.isArray(keywords) ? keywords : Object.values(keywords)) : null,
  };
}

export function metricsOfTrial(t: TrialMeasurement): MeasuredMetrics {
  return metricsFromSizes(t.sizes, t.numDocuments, t.keywords);
}

/** The shape `objective.ts` scores and compares. */
export function toTopicMetrics(m: MeasuredMetrics): TopicMetrics {
  return { topicCount: m.topicCount, outlierPct: m.outlierPct, numDocuments: m.numDocuments, sizes: m.sizes };
}

function labelOverlap(families: string[][]): number {
  const tops = families.map((words) => words.slice(0, LABEL_KEYWORDS)).filter((w) => w.length > 0);
  if (tops.length < 2) return 0;
  const seenIn = new Map<string, number>();
  for (const words of tops) for (const w of new Set(words)) seenIn.set(w, (seenIn.get(w) ?? 0) + 1);
  const shares = tops.map((words) => {
    const unique = [...new Set(words)];
    return unique.filter((w) => (seenIn.get(w) ?? 0) > 1).length / unique.length;
  });
  return round2(shares.reduce((a, b) => a + b, 0) / shares.length);
}

// ── Partitions ────────────────────────────────────────────────────────

/**
 * How many documents sit in a different family in `b` than in `a`. Families
 * are matched by majority (each family of `a` maps to the family of `b` that
 * holds most of its members), so renumbering alone moves nobody.
 */
export function movedDocuments(a: number[], b: number[]): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  const counts = new Map<number, Map<number, number>>();
  a.forEach((la, i) => {
    const row = counts.get(la) ?? new Map<number, number>();
    row.set(b[i]!, (row.get(b[i]!) ?? 0) + 1);
    counts.set(la, row);
  });
  const majority = new Map<number, number>();
  for (const [la, row] of counts) {
    let best = -Infinity;
    let at = la;
    for (const [lb, n] of [...row.entries()].sort((x, y) => x[0] - y[0])) {
      if (n > best) {
        best = n;
        at = lb;
      }
    }
    majority.set(la, at);
  }
  return a.filter((la, i) => majority.get(la) !== b[i]).length;
}

// ── strict_outliers: the similarity bar ──────────────────────────────

export type StrictThreshold = {
  value: number;
  /** data = the widest gap in this corpus; config = the bar in force; default = 0.45. */
  source: 'data' | 'config' | 'default';
  rationale: string;
};

/** Below this the "widest gap" is rounding, not a boundary (as in diagnose.ts). */
const MIN_GAP = 0.04;
const GAP_RANGE = { lo: 0.25, hi: 0.8 } as const;
export const DEFAULT_STRICT_THRESHOLD = 0.45;

/**
 * The bar for "only genuinely unrelated positions stay outside", picked from
 * the baseline measurement. The points are every document HDBSCAN could not
 * cluster — those still outside AND those the current setting already
 * re-homed — because a setting that forces everything in would otherwise hide
 * exactly the distribution the bar is read from.
 */
export function strictThresholdFor(baseline: TrialMeasurement, base: BertopicConfig): StrictThreshold {
  const sims: number[] = [];
  baseline.membership.forEach((tid, i) => {
    const s = tid === -1 ? baseline.nearestSimilarity[i] : baseline.rehomed[i] ? baseline.ownSimilarity[i] : null;
    if (typeof s === 'number' && Number.isFinite(s)) sims.push(s);
  });
  sims.sort((x, y) => x - y);

  let bestGap = 0;
  let bestAt: number | null = null;
  for (let i = 1; i < sims.length; i++) {
    const mid = (sims[i - 1]! + sims[i]!) / 2;
    if (mid < GAP_RANGE.lo || mid > GAP_RANGE.hi) continue;
    const gap = sims[i]! - sims[i - 1]!;
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = round2(mid);
    }
  }

  if (bestAt != null && bestGap >= MIN_GAP) {
    const above = sims.filter((s) => s >= bestAt!).length;
    return {
      value: bestAt,
      source: 'data',
      rationale:
        `Dari ${sims.length} jabatan yang tidak dikelompokkan HDBSCAN, ${above} punya kemiripan ` +
        `≥ ${bestAt} ke rumpun terdekatnya dan ${sims.length - above} di bawahnya. Celah terlebar ` +
        `sebaran itu ada di ${bestAt}, jadi di situlah garis "dekat" dan "asing" ditarik.`,
    };
  }
  const why =
    sims.length === 0
      ? 'Tidak ada jabatan yang gagal dikelompokkan pada korpus ini, jadi tidak ada sebaran untuk dibaca.'
      : `Kemiripan ${sims.length} jabatan yang tidak dikelompokkan menyebar rata, tanpa batas alami.`;
  if (base.reduceOutliers && base.outlierThreshold > 0) {
    return {
      value: base.outlierThreshold,
      source: 'config',
      rationale: `${why} Dipakai ambang yang sedang berlaku, ${base.outlierThreshold}.`,
    };
  }
  return {
    value: DEFAULT_STRICT_THRESHOLD,
    source: 'default',
    rationale: `${why} Dipakai ambang cadangan ${DEFAULT_STRICT_THRESHOLD}.`,
  };
}

/** Near = an outlier within the bar of some family; forced = re-homed into a family below the bar. */
export function strictCounts(t: TrialMeasurement, threshold: number): { near: number; forced: number } {
  let near = 0;
  let forced = 0;
  t.membership.forEach((tid, i) => {
    const nearest = t.nearestSimilarity[i];
    const own = t.ownSimilarity[i];
    if (tid === -1 && typeof nearest === 'number' && nearest >= threshold) near++;
    if (t.rehomed[i] && typeof own === 'number' && own < threshold) forced++;
  });
  return { near, forced };
}

// ── Goals ─────────────────────────────────────────────────────────────

/** What a verdict is judged on: the metrics, plus per-document data when it was measured. */
export type Subject = { metrics: MeasuredMetrics; trial?: TrialMeasurement | null };

export type GoalVerdict = {
  /** null = cannot be judged from what is known (needs a fresh measurement). */
  met: boolean | null;
  /** The goal's own number, before → after, in the user's terms. */
  summary: string;
  /** Larger = closer to the goal. Used to choose when nothing meets it. */
  progress: number;
};

export type GoalContext = { goal: OptimizeGoal; threshold: number | null };

/** compareToBaseline's tolerance for the outlier share, in percentage points. */
const OUTLIER_TOLERANCE_PP = 0.5;
/** No family is "giant" at or below this share of the clustered documents (scoreMetrics' knee). */
const DOMINANT_SHARE = 0.3;

const share = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Is the goal met by `cand`, measured against `base` on the same corpus?
 *
 * Each goal is judged by the one number it is about, with a definition a
 * reader can check: "Kurangi outlier" means the outlier share fell by more
 * than the half-point compareToBaseline treats as noise; "Nol outlier" means
 * zero; "Lebih banyak famili" means more families; and so on. What ELSE moved
 * is reported separately (`sideEffects`), never folded into this answer.
 */
export function goalVerdict(ctx: GoalContext, base: Subject, cand: Subject): GoalVerdict {
  const b = base.metrics;
  const c = cand.metrics;
  switch (ctx.goal) {
    case 'reduce_outliers':
      return {
        met: b.outlierPct - c.outlierPct > OUTLIER_TOLERANCE_PP,
        summary: `Outlier ${b.outlierPct}% → ${c.outlierPct}% (${b.outlierCount} → ${c.outlierCount} jabatan)`,
        progress: b.outlierCount - c.outlierCount,
      };
    case 'no_outliers':
      return {
        met: c.outlierCount === 0,
        summary: `Outlier ${b.outlierCount} → ${c.outlierCount} jabatan`,
        progress: -c.outlierCount,
      };
    case 'strict_outliers': {
      if (!cand.trial || ctx.threshold == null) {
        return { met: null, summary: 'Butuh pengukuran per dokumen untuk dinilai.', progress: 0 };
      }
      const { near, forced } = strictCounts(cand.trial, ctx.threshold);
      return {
        met: near === 0 && forced === 0,
        summary:
          `Pada ambang ${ctx.threshold}: ${near} jabatan yang dekat sebuah rumpun masih di luar, ` +
          `${forced} jabatan yang jauh dipaksa masuk (outlier ${c.outlierCount} jabatan)`,
        progress: -(near + forced),
      };
    }
    case 'more_topics':
      return {
        met: c.topicCount > b.topicCount,
        summary: `Famili ${b.topicCount} → ${c.topicCount}`,
        progress: c.topicCount - b.topicCount,
      };
    case 'fewer_topics':
      return {
        met: c.topicCount > 0 && c.topicCount < b.topicCount,
        summary: `Famili ${b.topicCount} → ${c.topicCount}`,
        progress: c.topicCount > 0 ? b.topicCount - c.topicCount : -b.topicCount,
      };
    case 'bigger_clusters':
      return {
        met: c.topicCount > 0 && c.medianSize > b.medianSize,
        summary: `Median anggota per famili ${b.medianSize} → ${c.medianSize}`,
        progress: c.medianSize - b.medianSize,
      };
    case 'smaller_clusters':
      // With no family at all there is no median to shrink: the goal is that
      // families form (it is what diagnose suggests for "no families").
      if (b.topicCount === 0) {
        return {
          met: c.topicCount > 0,
          summary: `Famili terbentuk ${b.topicCount} → ${c.topicCount}`,
          progress: c.topicCount,
        };
      }
      return {
        met: c.topicCount > 0 && c.medianSize < b.medianSize,
        summary: `Median anggota per famili ${b.medianSize} → ${c.medianSize}`,
        progress: c.topicCount > 0 ? b.medianSize - c.medianSize : -b.medianSize,
      };
    case 'split_dominant':
      return {
        met: c.topicCount > 1 && b.largestShare - c.largestShare > 0.02,
        summary: `Famili terbesar ${share(b.largestShare)} → ${share(c.largestShare)} dari jabatan yang terkelompok`,
        progress: b.largestShare - c.largestShare,
      };
    case 'remove_tiny':
      return {
        met: c.topicCount > 0 && c.tinyCount === 0,
        summary: `Famili beranggota < 3: ${b.tinyCount} → ${c.tinyCount}`,
        progress: -c.tinyCount,
      };
    case 'balance_sizes':
      return {
        met: c.topicCount > 1 && c.sizeCv <= b.sizeCv * 0.9,
        summary: `Ketimpangan ukuran famili (koefisien variasi) ${b.sizeCv} → ${c.sizeCv}`,
        progress: b.sizeCv - c.sizeCv,
      };
    case 'cleaner_labels': {
      if (!base.trial || !cand.trial || b.labelOverlap == null || c.labelOverlap == null) {
        return { met: null, summary: 'Butuh pengukuran per dokumen untuk dinilai.', progress: 0 };
      }
      const moved = movedDocuments(base.trial.membership, cand.trial.membership);
      if (moved > 0) {
        return {
          met: false,
          summary: `Keanggotaan berubah (${moved} jabatan pindah famili) — sasaran ini hanya boleh mengubah nama`,
          progress: -1 - moved / Math.max(1, c.numDocuments),
        };
      }
      return {
        met: c.labelOverlap < b.labelOverlap - 0.02,
        summary:
          `Kata kunci yang dipakai bersama antarfamili ${share(b.labelOverlap)} → ${share(c.labelOverlap)} ` +
          '(proksi kejelasan nama; keanggotaan tidak berubah)',
        progress: b.labelOverlap - c.labelOverlap,
      };
    }
    case 'balance': {
      const sb = scoreMetrics(toTopicMetrics(b), { goal: 'balance' });
      const sc = scoreMetrics(toTopicMetrics(c), { goal: 'balance' });
      const clean = sideEffects('balance', b, c).regressions.length === 0;
      return {
        met: sc - sb >= 1 && clean,
        summary: `Skor mutu keseluruhan ${sb} → ${sc}${clean ? '' : ' (ada ukuran yang memburuk)'}`,
        progress: sc - sb,
      };
    }
  }
}

/**
 * The current setting already does what was asked on this corpus — said
 * instead of searching, because "change nothing" is the right answer and a
 * search would only find a different way to the same place.
 */
export function alreadyMet(ctx: GoalContext, base: Subject): string | null {
  const b = base.metrics;
  switch (ctx.goal) {
    case 'reduce_outliers':
      return b.outlierCount === 0
        ? 'Tidak ada outlier yang bisa dikurangi: pengaturan sekarang sudah menempatkan setiap jabatan pada korpus ini.'
        : null;
    case 'no_outliers':
      return b.outlierCount === 0 ? 'Pengaturan sekarang sudah menghasilkan nol outlier pada korpus ini.' : null;
    case 'strict_outliers': {
      if (!base.trial || ctx.threshold == null) return null;
      const { near, forced } = strictCounts(base.trial, ctx.threshold);
      return near === 0 && forced === 0
        ? `Pengaturan sekarang sudah memenuhinya pada ambang ${ctx.threshold}: tidak ada jabatan yang dekat ` +
            'sebuah rumpun tertinggal di luar, dan tidak ada jabatan yang jauh dipaksa masuk.'
        : null;
    }
    case 'remove_tiny':
      return b.topicCount > 0 && b.tinyCount === 0
        ? 'Tidak ada famili beranggota kurang dari 3 dengan pengaturan sekarang.'
        : null;
    case 'split_dominant':
      return b.topicCount > 0 && b.largestShare <= DOMINANT_SHARE
        ? `Tidak ada famili raksasa: yang terbesar memuat ${share(b.largestShare)} jabatan yang terkelompok.`
        : null;
    case 'cleaner_labels':
      return b.topicCount > 1 && b.labelOverlap === 0
        ? 'Menurut ukuran yang dipakai di sini (proksi), kata kunci tiap famili sudah tidak dipakai bersama ' +
            'famili lain, jadi tidak ada yang bisa diperjelas.'
        : null;
    default:
      return null;
  }
}

/**
 * Metrics a goal moves BY DEFINITION, so moving them is not a side effect: more
 * families is the point of "Lebih banyak famili", and fewer outliers would be
 * the failure of "Sisakan yang benar-benar asing" when the current setting
 * forces everything in.
 */
const INHERENT: Partial<Record<OptimizeGoal, readonly string[]>> = {
  strict_outliers: ['Outlier'],
  more_topics: ['Jumlah famili'],
  fewer_topics: ['Jumlah famili'],
  bigger_clusters: ['Jumlah famili'],
  smaller_clusters: ['Jumlah famili'],
  split_dominant: ['Jumlah famili'],
  remove_tiny: ['Jumlah famili'],
};

/** Every measure before → after, and the ones that got worse without the goal asking for it. */
export function sideEffects(
  goal: OptimizeGoal,
  base: MeasuredMetrics,
  cand: MeasuredMetrics,
): { deltas: MetricDelta[]; regressions: string[] } {
  const deltas = compareToBaseline(toTopicMetrics(base), toTopicMetrics(cand), { goal });
  const inherent = new Set(INHERENT[goal] ?? []);
  const regressions = deltas
    .filter((d) => d.direction === 'worse' && !inherent.has(d.metric))
    .map((d) => `${d.metric} memburuk: ${d.from} → ${d.to}`);
  return { deltas, regressions };
}

// ── After the rebuild ─────────────────────────────────────────────────

/** What was measured and saved when a setting was applied (job_family_optimization_expectations). */
export type Expectation = {
  goal: OptimizeGoal;
  threshold: number | null;
  corpusFingerprint: string;
  corpusDocuments: number;
  baseline: MeasuredMetrics;
  predicted: MeasuredMetrics;
  verdict: GoalVerdict;
  regressions: string[];
};

export type Verification = {
  /** Was the map built from the corpus the setting was measured on? */
  corpus: 'same' | 'changed' | 'unknown';
  /** Same corpus and the map matches the measurement exactly; null when the corpus differs. */
  reproduced: boolean | null;
  /** Goal met on the BUILT map; null when only a new measurement can say. */
  goalMet: boolean | null;
  summary: string;
  regressions: string[];
  /** Where the built map differs from the measurement. */
  mismatches: string[];
};

/**
 * Judge a finished run against what was measured when its setting was applied.
 *
 * On the same corpus a deterministic pipeline must reproduce the measurement,
 * so the check is exact: same families, same sizes, same outliers. Anything
 * else is reported as a mismatch rather than smoothed over. On a different
 * corpus the measured verdict no longer applies; the goals that are absolute
 * (zero outliers, no tiny families) are still judged on the map itself, and
 * the relative ones say they need measuring again.
 */
export function verifyRun(
  exp: Expectation,
  run: { fingerprint: string | null; metrics: MeasuredMetrics },
): Verification {
  const actual = run.metrics;
  const corpus =
    run.fingerprint == null ? 'unknown' : run.fingerprint === exp.corpusFingerprint ? 'same' : 'changed';

  const mismatches: string[] = [];
  const p = exp.predicted;
  if (p.topicCount !== actual.topicCount) mismatches.push(`Famili: terukur ${p.topicCount}, terbangun ${actual.topicCount}`);
  if (p.outlierCount !== actual.outlierCount) {
    mismatches.push(`Outlier: terukur ${p.outlierCount}, terbangun ${actual.outlierCount} jabatan`);
  }
  if (p.topicCount === actual.topicCount && p.sizes.join(',') !== actual.sizes.join(',')) {
    mismatches.push(`Ukuran famili: terukur ${p.sizes.join(', ')}; terbangun ${actual.sizes.join(', ')}`);
  }

  const { regressions: liveRegressions } = sideEffects(exp.goal, exp.baseline, actual);

  if (corpus === 'same') {
    if (mismatches.length === 0) {
      return {
        corpus,
        reproduced: true,
        goalMet: exp.verdict.met,
        summary: exp.verdict.summary,
        regressions: exp.regressions,
        mismatches,
      };
    }
    const v = goalVerdict({ goal: exp.goal, threshold: exp.threshold }, { metrics: exp.baseline }, { metrics: actual });
    return { corpus, reproduced: false, goalMet: v.met, summary: v.summary, regressions: liveRegressions, mismatches };
  }

  // A different corpus: only the absolute goals can be judged from the map alone.
  if (exp.goal === 'no_outliers') {
    return {
      corpus,
      reproduced: null,
      goalMet: actual.outlierCount === 0,
      summary: `Outlier pada peta baru: ${actual.outlierCount} jabatan`,
      regressions: [],
      mismatches,
    };
  }
  if (exp.goal === 'remove_tiny') {
    return {
      corpus,
      reproduced: null,
      goalMet: actual.topicCount > 0 && actual.tinyCount === 0,
      summary: `Famili beranggota < 3 pada peta baru: ${actual.tinyCount}`,
      regressions: [],
      mismatches,
    };
  }
  return {
    corpus,
    reproduced: null,
    goalMet: null,
    summary:
      'Korpus berubah antara pengukuran dan pembangunan peta, jadi pembandingnya tidak lagi sebanding. ' +
      'Ukur ulang sasaran ini untuk menilai peta yang baru.',
    regressions: [],
    mismatches,
  };
}

// ── util ──────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
