// Shared config shape + defaults for Job Family Discovery. Plain module (no
// 'use server') so both the server actions and the client Configuration editor
// can import the type and defaults. Persisted as JSON at lib/job-family-config.json
// (mirrors the readiness-config / scoring-prompts convention).

import { DEFAULT_RESTRUCTURE_TEMPLATE } from './restructure';

/**
 * Which embedding backend produces DOCUMENT vectors:
 *   'multilingual' → Xenova/multilingual-e5-base via scoring-service (Transformers.js)
 *   'nomic-local'  → Nomic via a local, OpenAI-compatible endpoint (EMBEDDING_API_BASE)
 *   'nomic-remote' → Nomic via a remote/hosted endpoint (EMBEDDING_API_BASE_REMOTE)
 */
export type EmbeddingSource = 'multilingual' | 'nomic-local' | 'nomic-remote';

export type JobFamilyConfig = {
  /** Template used to restructure extracted job-profile JSON into a paragraph. */
  restructureTemplate: string;
  /**
   * Per-profile restructure template overrides, keyed by job profile id (as a
   * string, since it's persisted as JSON). When a profile has a non-empty
   * override it wins over `restructureTemplate` everywhere a document is built
   * for that profile — live preview, single-profile embed, and the global
   * rebuild — so a global rebuild never clobbers a custom-restructured profile.
   */
  restructureOverrides: Record<string, string>;
  /** Sentence-embedding parameters. */
  embedding: {
    /** Which backend produces the vectors — see EmbeddingSource. */
    source: EmbeddingSource;
    /** Display/audit label of the model producing vectors. */
    model: string;
    /**
     * Vector dimensionality. No longer fixed at 768: the next full re-embed
     * recreates the pgvector collection at this dimension (drop + recreate in
     * lib/db/vector-db.ts), so the model's actual output and this value must
     * agree or the rebuild reports a dimension mismatch.
     */
    dimensions: number;
    /** How many paragraphs are sent to /api/embed per request during rebuild. */
    batchSize: number;
  };
  /** BERTopic pipeline parameters. EVERY field here is consumed by the
   *  topic-service pipeline (topic-service/app/pipeline.py) on the next Family
   *  Tree rebuild — there are no display-only fields. */
  bertopic: BertopicConfig;
};

export type StopwordLang = 'indonesian' | 'english' | 'none';
export type OutlierStrategy = 'embeddings' | 'c-tf-idf' | 'distributions' | 'probabilities';
export type UmapMetric = 'cosine' | 'euclidean' | 'manhattan';
export type ClusterSelectionMethod = 'eom' | 'leaf';

export type BertopicConfig = {
  // ── UMAP (dimensionality reduction) ──
  /** Balance local vs global structure. ↑ = more global, ↓ = more local clusters. */
  nNeighbors: number;
  /** Target dimensions HDBSCAN clusters on. Typ. 5–10. */
  nComponents: number;
  /** How tightly points pack (0 = tightest — best for clustering). */
  minDist: number;
  /** Distance metric for UMAP (also reused for the 2-D projection). */
  metric: UmapMetric;
  // ── HDBSCAN (clustering) ──
  /** Smallest allowed job family. ↑ = fewer/larger families, more outliers. */
  minClusterSize: number;
  /** Conservativeness / noise. null = auto (= minClusterSize). ↑ = more outliers. */
  minSamples: number | null;
  /** 'eom' (fewer broad clusters) vs 'leaf' (more fine-grained clusters). */
  clusterSelectionMethod: ClusterSelectionMethod;
  /** Merge clusters closer than this distance. 0 = off. ↑ = fewer families. */
  clusterSelectionEpsilon: number;
  // ── Tokenization (CountVectorizer) ──
  /** Smallest word n-gram kept (1 = single words). */
  nGramMin: number;
  /** Largest word n-gram kept (2 = also bi-grams / phrases). */
  nGramMax: number;
  /** Ignore terms in fewer than this many documents (int). ↑ = drops rare terms. */
  minDf: number;
  /** Ignore terms in more than this fraction of documents (0–1). ↓ = drops common terms. */
  maxDf: number;
  /** Stopword list removed before c-TF-IDF (job profiles are Indonesian). */
  stopwords: StopwordLang;
  // ── c-TF-IDF (keyword extraction) ──
  /** Keywords kept per topic. */
  topNWords: number;
  /** Down-weight words frequent across ALL topics (cleaner labels). */
  reduceFrequentWords: boolean;
  /** BM25 weighting in c-TF-IDF — sturdier keywords on small/imbalanced corpora. */
  bm25Weighting: boolean;
  // ── Topic model ──
  /** Reduce to at most this many topics after clustering. null = no reduction. */
  nrTopics: number | null;
  /** Reassign outliers (topic -1) to their nearest topic after clustering. */
  reduceOutliers: boolean;
  /**
   * HOW an outlier's nearest family is measured when `reduceOutliers` is on.
   *
   * 'embeddings' is the default and the only one that measures the same thing
   * the map itself is built from — cosine to each family's centroid in the
   * original vector space, the very number the manual-mapping popup shows. The
   * others rank by keyword overlap instead, which can seat a document in a
   * family it shares vocabulary with while sitting far away on the map.
   * 'probabilities' additionally requires `calculateProbabilities`.
   */
  outlierStrategy: OutlierStrategy;
  /**
   * Minimum similarity (0..1) before an outlier may be moved into a family.
   * Anything below stays an outlier.
   *
   * This is what separates "no outliers" from "no outliers worth trusting". At
   * 0 every outlier is forced into whichever family is nearest, however far
   * that is — the count reaches zero by hiding genuinely unrelated documents
   * inside families they do not belong to. Raise it and the documents left at
   * -1 are exactly those close to nothing, which is a finding rather than a
   * defect.
   */
  outlierThreshold: number;
  /**
   * Retry whatever is still an outlier with the remaining strategies, in order,
   * at the SAME threshold. Widens how many angles are tried; never lowers the
   * bar.
   */
  outlierCascade: boolean;
  /** Compute per-document topic probabilities (slower; drives membership %). */
  calculateProbabilities: boolean;
  /** MMR keyword diversity 0–1 (0/null = off; ↑ = less redundant keywords). */
  diversity: number | null;
  /** Fixed seed → reproducible runs over unchanged data. */
  randomState: number;
};

export const DEFAULT_JOB_FAMILY_CONFIG: JobFamilyConfig = {
  restructureTemplate: DEFAULT_RESTRUCTURE_TEMPLATE,
  restructureOverrides: {},
  embedding: {
    // DOCUMENT embeddings (job-profile paragraphs AND kamus-kompetensi), 768-dim.
    // Defaults to the local Nomic endpoint (EMBEDDING_API_BASE); switch source to
    // 'multilingual' or 'nomic-remote' via the Configuration page.
    source: 'nomic-local',
    model: process.env.EMBEDDING_MODEL || 'nomic-embed-text-v2-moe:latest',
    dimensions: 768,
    batchSize: 32,
  },
  bertopic: {
    // UMAP
    nNeighbors: 15,
    nComponents: 5,
    minDist: 0.0,
    metric: 'cosine',
    // HDBSCAN
    minClusterSize: 5,
    minSamples: null,
    clusterSelectionMethod: 'eom',
    clusterSelectionEpsilon: 0.0,
    // Tokenization
    nGramMin: 1,
    nGramMax: 2,
    minDf: 1,
    maxDf: 1.0,
    stopwords: 'indonesian',
    // c-TF-IDF
    topNWords: 10,
    reduceFrequentWords: true,
    bm25Weighting: false,
    // Topic model
    nrTopics: null,
    reduceOutliers: false,
    outlierStrategy: 'embeddings',
    outlierThreshold: 0,
    outlierCascade: false,
    calculateProbabilities: true,
    diversity: null,
    randomState: 42,
  },
};

// ── Validating one part before it is saved ────────────────────────

const BERTOPIC_KEYS = new Set(Object.keys(DEFAULT_JOB_FAMILY_CONFIG.bertopic));
const NULLABLE_BERTOPIC_KEYS = new Set(['minSamples', 'nrTopics', 'diversity']);

/**
 * Filter a BERTopic patch against the real config shape. Unknown keys and
 * wrongly-typed values are dropped and REPORTED: a patch half of which silently
 * disappeared reads to the user as "applied".
 */
export function sanitizeBertopicPatch(raw: Record<string, unknown> | null | undefined): {
  clean: Partial<BertopicConfig>;
  ignored: string[];
} {
  const defaults = DEFAULT_JOB_FAMILY_CONFIG.bertopic as unknown as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  const ignored: string[] = [];

  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!BERTOPIC_KEYS.has(key)) {
      ignored.push(`${key} (bukan parameter BERTopic)`);
      continue;
    }
    if (value === null) {
      if (NULLABLE_BERTOPIC_KEYS.has(key)) clean[key] = null;
      else ignored.push(`${key} (tidak boleh kosong)`);
      continue;
    }
    const ref = defaults[key];
    const expected = ref === null ? 'number' : typeof ref;
    if (typeof value !== expected) {
      ignored.push(`${key} (harus ${expected}, diterima ${typeof value})`);
      continue;
    }
    if (expected === 'number' && !Number.isFinite(value)) {
      ignored.push(`${key} (bukan angka)`);
      continue;
    }
    clean[key] = value;
  }
  return { clean: clean as Partial<BertopicConfig>, ignored };
}

const EMBEDDING_SOURCES = new Set<string>(['multilingual', 'nomic-local', 'nomic-remote']);

/** Same contract as sanitizeBertopicPatch, for the embedding settings. */
export function sanitizeEmbeddingPatch(raw: Record<string, unknown> | null | undefined): {
  clean: Partial<JobFamilyConfig['embedding']>;
  ignored: string[];
} {
  const clean: Record<string, unknown> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (key === 'source') {
      if (typeof value === 'string' && EMBEDDING_SOURCES.has(value)) clean[key] = value;
      else ignored.push(`source (sumber tidak dikenal)`);
    } else if (key === 'model') {
      if (typeof value === 'string' && value.trim()) clean[key] = value.trim();
      else ignored.push('model (tidak boleh kosong)');
    } else if (key === 'dimensions' || key === 'batchSize') {
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) clean[key] = value;
      else ignored.push(`${key} (harus bilangan bulat positif)`);
    } else {
      ignored.push(`${key} (bukan pengaturan embedding)`);
    }
  }
  return { clean: clean as Partial<JobFamilyConfig['embedding']>, ignored };
}

// ── Draft and saved config ────────────────────────────────────────
//
// The settings pages edit a DRAFT and save it one part at a time: the global
// template, one profile's template, the BERTopic parameters, the embedding
// settings. The server does the merge (saveConfigPart in
// lib/job-family-actions.ts); these helpers are the client half of that rule.

function sameFlat(a: object, b: object): boolean {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (!Object.is(x[k], y[k])) return false;
  return true;
}

/** A profile's own template, or '' when it follows the global one. */
export function overrideOf(config: JobFamilyConfig, jobProfileId: string): string {
  const v = config.restructureOverrides[jobProfileId];
  return v && v.trim() ? v : '';
}

export function isTemplateDirty(draft: JobFamilyConfig, saved: JobFamilyConfig): boolean {
  return draft.restructureTemplate !== saved.restructureTemplate;
}

export function isOverrideDirty(
  draft: JobFamilyConfig,
  saved: JobFamilyConfig,
  jobProfileId: string,
): boolean {
  return overrideOf(draft, jobProfileId) !== overrideOf(saved, jobProfileId);
}

export function isBertopicDirty(draft: JobFamilyConfig, saved: JobFamilyConfig): boolean {
  return !sameFlat(draft.bertopic, saved.bertopic);
}

/**
 * Carry a draft over to a newly saved config. A part the user had not edited
 * (draft equal to the old saved value) takes the new saved value; a part they
 * had edited keeps the edit. Applied after every save, so saving one part never
 * discards an unsaved edit to another, and a value somebody else saved in the
 * meantime shows up instead of reading as the user's own unsaved change.
 * Per-profile templates are carried over one profile at a time.
 */
export function rebaseConfigDraft(
  draft: JobFamilyConfig,
  before: JobFamilyConfig,
  after: JobFamilyConfig,
): JobFamilyConfig {
  const overrides: Record<string, string> = {};
  const ids = new Set([
    ...Object.keys(draft.restructureOverrides),
    ...Object.keys(before.restructureOverrides),
    ...Object.keys(after.restructureOverrides),
  ]);
  for (const id of ids) {
    const mine = overrideOf(draft, id);
    const value = mine === overrideOf(before, id) ? overrideOf(after, id) : mine;
    if (value) overrides[id] = value;
  }
  return {
    restructureTemplate:
      draft.restructureTemplate === before.restructureTemplate
        ? after.restructureTemplate
        : draft.restructureTemplate,
    restructureOverrides: overrides,
    embedding: sameFlat(draft.embedding, before.embedding) ? after.embedding : draft.embedding,
    bertopic: sameFlat(draft.bertopic, before.bertopic) ? after.bertopic : draft.bertopic,
  };
}

/**
 * Apply an edit to ONE profile's own template. The first edit starts it from the
 * global template as it stands in `config`; the global template itself is never
 * written. (It used to be: relabelling a section of a profile that had no own
 * template also relabelled it in the global template.)
 */
export function editProfileTemplate(
  config: JobFamilyConfig,
  jobProfileId: string,
  fn: (template: string) => string,
): JobFamilyConfig {
  const base = overrideOf(config, jobProfileId) || config.restructureTemplate;
  return {
    ...config,
    restructureOverrides: { ...config.restructureOverrides, [jobProfileId]: fn(base) },
  };
}

/** `defaults`' keys only, each taken from `stored` when present there. */
function withKnownKeys<T extends object>(defaults: T, stored: unknown): T {
  const src = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  const out = { ...defaults } as Record<string, unknown>;
  for (const key of Object.keys(defaults)) if (key in src) out[key] = src[key];
  return out as T;
}

/**
 * A stored config (DB row or the legacy JSON file) in today's exact shape:
 * missing fields come from the defaults, and retired ones are DROPPED. Stored
 * configs still carry `bertopic.minTopicSize` and `bertopic.language`, which
 * nothing reads; kept, they would ride along in every draft and the per-part
 * saves would refuse them as unknown parameters.
 */
export function normalizeJobFamilyConfig(
  stored: Partial<JobFamilyConfig> | null | undefined,
): JobFamilyConfig {
  const p = stored ?? {};
  return {
    restructureTemplate:
      typeof p.restructureTemplate === 'string'
        ? p.restructureTemplate
        : DEFAULT_JOB_FAMILY_CONFIG.restructureTemplate,
    restructureOverrides:
      p.restructureOverrides && typeof p.restructureOverrides === 'object'
        ? p.restructureOverrides
        : {},
    embedding: withKnownKeys(DEFAULT_JOB_FAMILY_CONFIG.embedding, p.embedding),
    bertopic: withKnownKeys(DEFAULT_JOB_FAMILY_CONFIG.bertopic, p.bertopic),
  };
}
