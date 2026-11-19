// Shared state of one job-family trace workbook build: the bundle, decoded
// arrays, the defined-name registry, the checks the summary counts, and the
// cell positions each stage exposes to the next.

import type { JobFamilyTraceBundle } from './load';
import { flat, matrix, type JobFamilyTrace } from './types';
import { SheetBuilder, a1, colName, q } from '../run-trace/sheet';

/** Sheet names — one place, so cross-sheet formulas cannot drift from the tabs. */
export const SHEET = {
  guide: 'Panduan',
  summary: 'Ringkasan',
  params: 'Parameter',
  db: 'Kondisi Database',
  docs: 'Dokumen',
  lines: 'Dokumen - Baris',
  vec: 'Vektor',
  cos: 'Jarak Cosine',
  knn: 'UMAP - kNN',
  sigma: 'UMAP - Pencarian Sigma',
  graph: 'UMAP - Graf',
  curve: 'UMAP - Kurva a b',
  layout: 'UMAP - Koordinat',
  euclid: 'Jarak Euclid',
  core: 'HDBSCAN - Inti',
  mst: 'HDBSCAN - MST',
  uf: 'HDBSCAN - Union-Find',
  sl: 'HDBSCAN - Single Linkage',
  points: 'HDBSCAN - Titik',
  clusters: 'HDBSCAN - Klaster',
  select: 'HDBSCAN - Seleksi',
  labels: 'HDBSCAN - Label',
  ancestors: 'HDBSCAN - Leluhur',
  soft: 'HDBSCAN - Keanggotaan',
  topics: 'BERTopic - Topik',
  reduce: 'BERTopic - Reduksi',
  rehome: 'Outlier - Penempatan',
  ctCounts: 'c-TF-IDF - Hitungan',
  ctVocab: 'c-TF-IDF - Kosakata',
  ctTopics: 'c-TF-IDF - Kata Kunci',
  reasons: 'Alasan Dokumen',
  proj: 'Proyeksi 2D',
  reps: 'Representatif',
  hier: 'Hirarki',
  gen: 'Generalisasi',
  seeds: 'Stabilitas Seed',
  result: 'Hasil Akhir',
} as const;

export type Check = {
  /** Stage label shown on the summary sheet. */
  label: string;
  /** Range of Δ cells (formula − recorded) — numbers, or the text "BEDA". */
  range: string;
  tolerance: number;
  note: string;
};

/** Header rows above the first document on every one-row-per-document sheet. */
export const DOC_HEAD = 3;
/** Row of document i (1-based) on a one-row-per-document sheet. */
export const docRow = (i: number) => DOC_HEAD + i;

export class BuildContext {
  readonly b: JobFamilyTraceBundle;
  readonly t: JobFamilyTrace;
  readonly sheets = new Map<string, SheetBuilder>();
  readonly names: { name: string; ref: string; comment?: string }[] = [];
  readonly checks: Check[] = [];
  readonly gaps: string[] = [];

  /** Documents in run order (job_profile_id ascending) — the order everything is indexed by. */
  readonly N: number;
  /** Vector dimension. */
  readonly D: number;
  readonly vectors: number[][];
  /** Final family per document (after topic reduction and outlier re-homing). */
  readonly finalTopics: number[];
  /** Real family ids in ascending order (no -1). */
  readonly topicIds: number[];

  // Cross-sheet layout, filled in as sheets are built.
  /** First column (0-based) of the vector components on Vektor. */
  vecCol0 = 0;
  /** Column (0-based) of ‖x‖ on Vektor. */
  normCol = 0;
  /** UMAP kNN: first column of the membership block (w_ij, j = 1..k). */
  knnWCol0 = 0;
  /** Iteration columns the σ bisection sheet writes (≤ 64). */
  sigmaIters = 64;
  /** UMAP kNN column layout, for the bisection and graph sheets. */
  knnLayout: { k: number; DC: number; RHO: number; SIG: number; W0: number } | null = null;
  /** HDBSCAN row ranges: single-linkage steps, condensed cluster rows, selection rows. */
  slRows: { first: number; last: number } | null = null;
  clRows: { first: number; last: number } | null = null;
  seRows: { first: number; last: number } | null = null;
  /** Condensed-tree cluster ids (excluding the root), ascending. */
  clusterIds: number[] = [];
  /** Ancestors sheet: matrix rows and the "related" / split-lambda block starts. */
  ancLayout: { first: number; last: number; REL0: number; SPL0: number } | null = null;
  /** HDBSCAN - Label: hard probability (formula) column. */
  hardProbCol = 0;
  /** HDBSCAN - Keanggotaan: per-document membership (formula) column, −1 when absent. */
  probPerDocCol = -1;
  /** BERTopic - Topik: topic before outlier re-homing (formula) column. */
  beforeRehomeCol = 0;
  /** Outlier sheet: per document index, the cells holding each step's proposal (formula). */
  rehomeRefs = new Map<number, string[]>();
  /** Outlier sheet: raw topic centroid block (first component column, norm column, row per topic id). */
  rehomeCentroid: { C0: number; NORM: number; rowOf: Map<number, number> } | null = null;
  /** c-TF-IDF: per topic row index (topicOrder position), the triplet rows on the counts sheet. */
  ctTopicRows = new Map<number, { first: number; last: number }>();
  /** c-TF-IDF: (topic row index, term index) → triplet row. */
  ctCell = new Map<string, number>();
  /** c-TF-IDF - Kosakata: first row of the vocabulary and the dense weight block start (real topics). */
  vocabFirst = 0;
  denseCol0 = -1;
  /** c-TF-IDF - Kata Kunci: per topic id, rows of its keywords (k = 1..). */
  kwRows = new Map<number, number[]>();
  /** c-TF-IDF - Kata Kunci: label (formula) cell per topic id. */
  labelCell = new Map<number, string>();
  /** c-TF-IDF - Kata Kunci: the keyword rows (topic, k, word, score, …, members). */
  kwBlock: { first: number; last: number } | null = null;
  /** Hasil Akhir / Representatif: rows the generalization sheet reads sizes from. */
  topicSizeCell = new Map<number, string>();
  /** Reduced coordinates: first column on UMAP - Koordinat. */
  coordCol0 = 0;
  /** Core distance (formula) column on HDBSCAN - Inti. */
  coreCol = 0;
  /** Per point on HDBSCAN - Titik: fall-out cluster and lambda columns. */
  ptClusterCol = 0;
  ptLambdaCol = 0;
  /** HDBSCAN - Label: hdbscan label (formula) column. */
  labelCol = 0;
  /** BERTopic - Topik: fit-time topic (formula) per document column, and the final topic column. */
  fitTopicCol = 0;
  finalTopicCol = 0;
  /** HDBSCAN - Keanggotaan: probability (row max, formula) column. */
  probCol = 0;
  /** Seleksi: cluster ids range and the columns the soft membership reads. */
  selectRows: { id: number; row: number }[] = [];
  /** Per hdbscan label l (0..K-1), the cluster id it is (sorted selected ids). */
  selectedIds: number[] = [];
  /** c-TF-IDF: per (topicRow, termIdx) the row of its triplet on the counts sheet. */
  tripletRow = new Map<string, number>();
  /** c-TF-IDF: weight column on the counts sheet. */
  ctWeightCol = 0;
  /** Reasons: own centroid similarity (formula) column. */
  ownSimCol = 0;
  altSimCol = 0;
  altIdCol = 0;

  constructor(b: JobFamilyTraceBundle) {
    if (!b.trace) throw new Error('trace required');
    this.b = b;
    this.t = b.trace;
    this.vectors = matrix(b.trace.corpus.vectors);
    this.N = this.vectors.length;
    this.D = this.vectors[0]?.length ?? 0;
    this.finalTopics = b.trace.topicsFinal;
    this.topicIds = Array.from(new Set(this.finalTopics.filter((t) => t !== -1))).sort((x, y) => x - y);
  }

  sheet(name: string, widths: number[] = []): SheetBuilder {
    const s = new SheetBuilder(name, widths);
    this.sheets.set(s.name, s);
    return s;
  }

  /** Register a defined name for a single cell (col 0-based, row 1-based). */
  name(name: string, sheet: string, col: number, row: number, comment?: string): string {
    this.names.push({ name, ref: `${q(sheet)}!${a1(col, row, true)}`, comment });
    return name;
  }

  /** Register a defined name for a range. */
  nameRange(name: string, sheet: string, col1: number, row1: number, col2: number, row2: number): string {
    this.names.push({ name, ref: `${q(sheet)}!${a1(col1, row1, true)}:${a1(col2, row2, true)}` });
    return name;
  }

  check(label: string, sheet: string, col1: number, row1: number, col2: number, row2: number, tolerance: number, note: string): void {
    if (row2 < row1 || col2 < col1) return;
    this.checks.push({
      label,
      range: `${q(sheet)}!$${colName(col1)}$${row1}:$${colName(col2)}$${row2}`,
      tolerance,
      note,
    });
  }

  /** Display title of document i (0-based). */
  title(i: number): string {
    const m = this.t.corpus.meta[i];
    return m?.positionName ?? `Dokumen ${i + 1}`;
  }

  /** The persisted assignment of document i (0-based), by job profile id. */
  persisted(i: number) {
    const id = this.t.corpus.meta[i]?.jobProfileId;
    return this.b.assignments.find((a) => a.jobProfileId === id) ?? null;
  }

  /** A packed array of the trace, flat. */
  flat = flat;
  matrix = matrix;
}

/** Vector-component range of document i (1-based) on a sheet, as an absolute reference. */
export function rowRange(sheet: string, col0: number, ncols: number, row: number): string {
  return `${q(sheet)}!$${colName(col0)}$${row}:$${colName(col0 + ncols - 1)}$${row}`;
}

/** A single cell on another sheet. */
export function cell(sheet: string, col: number, row: number, abs = true): string {
  return `${q(sheet)}!${a1(col, row, abs)}`;
}
