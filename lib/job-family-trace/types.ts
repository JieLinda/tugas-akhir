// The calculation trace of a job-family map build as topic-service stores it
// (topic-service/app/trace.py, TRACE_VERSION 1) — a TypeScript mirror plus the
// decoders the workbook builder needs. Pure and client-safe.
//
// Arrays the pipeline holds in float32 travel as base64 little-endian float32
// and come back as the exact double of each float32, so a value written into
// the workbook is precisely the number the library computed with.

export type PackedArray = { dtype: 'f32' | 'f64'; shape: number[]; b64: string };

export type UmapTrace = {
  params: {
    nNeighbors: number;
    nComponents: number;
    minDist: number;
    spread: number;
    metric: string;
    localConnectivity: number;
    setOpMixRatio: number;
    learningRate: number;
    repulsionStrength: number;
    negativeSampleRate: number;
    init: string;
    randomState: number | null;
    nEpochsConfigured: number | null;
    nEpochsUsed?: number;
    a: number;
    b: number;
    disconnectionDistance: number | null;
  };
  exactKnn: boolean;
  knnIndices: number[][];
  knnDists: PackedArray;
  sigmas: PackedArray;
  rhos: PackedArray;
  graph?: { rows: number[]; cols: number[]; vals: PackedArray; max: number };
  graphKept?: { rows: number[]; cols: number[]; vals: PackedArray };
  embedding: PackedArray;
  checks: Record<string, number | string | boolean>;
  n: number;
};

export type HdbscanTrace = {
  params: {
    minClusterSize: number;
    minSamplesConfigured: number | null;
    minSamplesEffective: number;
    clusterSelectionMethod: string;
    clusterSelectionEpsilon: number;
    allowSingleCluster: boolean;
    alpha: number;
    metric: string;
    algorithm: string;
    approxMinSpanTree: boolean;
    leafSize: number;
    maxClusterSize: number;
    matchReferenceImplementation: boolean;
  };
  core: PackedArray;
  mst: { a: number[]; b: number[]; w: PackedArray } | null;
  singleLinkage: { left: number[]; right: number[]; dist: PackedArray; size: number[] };
  condensed: { parent: number[]; child: number[]; lambda: (number | null)[]; size: number[] };
  stability: Record<string, number | null>;
  selected: number[];
  labels: number[];
  probabilities: PackedArray;
  exemplars: number[][];
  soft: PackedArray | null;
  checks: Record<string, number | string | boolean>;
};

export type CtfidfTrace = {
  topicOrder: number[];
  vocabulary: string[];
  counts: { row: number[]; col: number[]; val: number[] };
  weights: PackedArray;
  idf: PackedArray;
  avgNrSamples: number;
  params: {
    reduceFrequentWords: boolean;
    bm25Weighting: boolean;
    topNWords: number;
    language: string;
    ngramRange: number[];
    minDf: number;
    maxDf: number;
    lowercase: boolean;
    tokenPattern: string;
    stopWordsCount: number | string | null;
    representationModel: string | null;
  };
  keywords: Record<string, [string, number][]>;
  checks: Record<string, number | string | boolean>;
};

export type RehomingStep = {
  strategy: string;
  threshold: number;
  outlierIdx: number[];
  proposed: number[];
  topicIds: number[] | null;
  similarity: PackedArray | null;
  error?: string;
};

export type GeneralizeNode = {
  node: string;
  kind: 'leaf' | 'internal';
  children?: string[];
  leafTopics: number[];
  keywords: [string, number][];
  representatives: string[];
  title: string;
  description: string | null;
  fromModel: boolean;
};

export type CorpusMeta = {
  jobProfileId: number;
  positionName: string | null;
  divisionDepartment: string | null;
  embeddingModel: string | null;
  docMd5: string | null;
  embMd5: string | null;
  embedSource: string | null;
  embedDimensions: number | null;
  embedTemplate: string | null;
  extractedHash: string | null;
  embeddedAt: string | null;
};

export type JobFamilyTrace = {
  version: number;
  config: Record<string, unknown>;
  effective: Record<string, unknown>;
  corpus: {
    documents: string[];
    meta: CorpusMeta[];
    vectors: PackedArray;
    fingerprint: string;
    embeddingModel: string | null;
    tenantId: string | null;
  };
  umap: UmapTrace;
  hdbscan: HdbscanTrace;
  mappingFit: { mappings: number[][] };
  topicsFit: number[];
  probabilities: PackedArray | null;
  topicEmbeddingsFit: { embeddings: PackedArray; outliersRow: number } | null;
  mappingReduced?: { mappings: number[][] };
  topicsReduced?: number[];
  topicEmbeddingsReduced?: { embeddings: PackedArray; outliersRow: number } | null;
  rehoming?: RehomingStep[];
  topicsFinal: number[];
  noiseBeforeRehoming: boolean[];
  probPerDoc: (number | null)[];
  ctfidf: CtfidfTrace;
  presence: boolean[][];
  projection2d: Partial<UmapTrace> & { coords: PackedArray };
  topicsOut: { topicId: number; label: string; size: number; x: number | null; y: number | null; representativeIdx: number[] }[];
  hierarchy: { distance: PackedArray; linkage: PackedArray; uniquified: boolean } | { error: string } | null;
  hierarchyRows: unknown;
  generalize: GeneralizeNode[] | null;
  seedStability?: {
    publishedSeed: number;
    seeds: { seed: number; ari: number; topicCount: number; outlierCount: number }[];
    ariMean: number;
    ariMin: number;
    meanAgreement: number | null;
    agreementThreshold: number;
    unstableCount: number;
    unstableIdx: number[];
    unstableAgreement: number[];
    partitions: { seed: number; topics: number[] }[];
  };
  reproducibility?: { randomState: number; documentOrder: string; versions: Record<string, string | null> } | null;
};

// ── decoding ───────────────────────────────────────────────────────────

function bytesOf(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Flat values of a packed array, each the exact double of what was stored. */
export function flat(p: PackedArray | null | undefined): number[] {
  if (!p) return [];
  const bytes = bytesOf(p.b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const step = p.dtype === 'f32' ? 4 : 8;
  const n = Math.floor(bytes.byteLength / step);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = p.dtype === 'f32' ? view.getFloat32(i * 4, true) : view.getFloat64(i * 8, true);
  return out;
}

/** A packed 2-D array as rows. */
export function matrix(p: PackedArray | null | undefined): number[][] {
  if (!p) return [];
  const v = flat(p);
  const [rows, cols] = [p.shape[0] ?? 0, p.shape[1] ?? 1];
  const out: number[][] = [];
  for (let r = 0; r < rows; r++) out.push(v.slice(r * cols, (r + 1) * cols));
  return out;
}
