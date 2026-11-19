// Shared state of one workbook build: the run bundle, the defined-name registry,
// the cross-sheet cells each stage exposes to the next, and the list of checks
// the summary sheet counts mismatches over.

import type { RunTraceBundle } from './load';
import type { EngineTrace } from '../../scoring-service/src/run-trace-types';
import { SheetBuilder, q, a1 } from './sheet';

export const CRITERIA = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'] as const;
export type Criterion = (typeof CRITERIA)[number];

export const CRITERION_LABEL: Record<Criterion, string> = {
  technical: 'Kompetensi Teknis',
  career: 'Relevansi Karier',
  behavior: 'Behavior',
  performance: 'Performance Appraisal',
  hav: 'HAV',
  education: 'Pendidikan',
};

/** Sheet names — one place, so cross-sheet formulas cannot drift from the tabs. */
export const SHEET = {
  guide: 'Panduan',
  summary: 'Ringkasan',
  params: 'Parameter',
  pool: 'Pool & Filter',
  techRequired: 'Teknis - Acuan',
  labels: 'Label Level',
  techHeld: 'Teknis - Dimiliki',
  techPairs: 'Teknis - Pasangan',
  techCells: 'Teknis - Sel Hungarian',
  techCand: 'Teknis - Kandidat',
  careerStints: 'Karier - Stint',
  careerFallback: 'Karier - Pengganti',
  careerTarget: 'Karier - Target T',
  careerCand: 'Karier - Kandidat',
  behavior: 'Behavior',
  pa: 'PA',
  hav: 'HAV',
  education: 'Pendidikan',
  ahp: 'AHP',
  topsis: 'TOPSIS',
  techAnchors: 'Jangkar Teknis',
  censusKamus: 'Sensus Kamus',
  careerAnchors: 'Jangkar Karier',
  censusCorpus: 'Sensus Korpus JP',
  censusBest: 'Korpus - Terbaik',
  censusFamily: 'Sensus Rumpun',
  censusMoves: 'Sensus Mutasi',
  censusDepth: 'Sensus Pengangkatan',
  idf: 'IDF',
  idfDocs: 'IDF - Dokumen',
} as const;

export type Check = {
  /** Stage label shown on the summary sheet. */
  label: string;
  /** Range of Δ cells (formula − stored). */
  range: string;
  tolerance: number;
  note: string;
};

export class BuildContext {
  readonly b: RunTraceBundle;
  readonly t: EngineTrace | null;
  readonly sheets = new Map<string, SheetBuilder>();
  readonly names: { name: string; ref: string; comment?: string }[] = [];
  readonly checks: Check[] = [];
  /** Per candidate, the cell holding each aspect's RECOMPUTED score (xref). */
  readonly aspectCell = new Map<string, Partial<Record<Criterion, string>>>();
  /** Candidate ids in the engine's decision-matrix order. */
  readonly order: string[];
  /** Notes for the guide sheet: what this run did not record. */
  readonly gaps: string[] = [];
  /** Cell holding the measured T_tahun for the target's seniority band (Sensus Pengangkatan). */
  depthMeasuredRef: string | null = null;
  /** Readiness thresholds as Parameter cells, in the order the engine walks them. */
  readinessRows: { minRef: string; levelRef: string; level: string }[] = [];

  constructor(b: RunTraceBundle) {
    this.b = b;
    this.t = b.engineTrace;
    const fromTrace = b.engineTrace?.topsis?.rowIds ?? [];
    const poolIds = [...b.pool].sort((x, y) => x.candidateId.localeCompare(y.candidateId)).map((p) => p.candidateId);
    // The engine loads candidates ORDER BY id, which is also its matrix order.
    this.order = fromTrace.length > 0 ? fromTrace : poolIds.length > 0 ? poolIds : b.results.map((r) => r.candidateId);
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

  hasName(name: string): boolean {
    return this.names.some((n) => n.name === name);
  }

  candName(id: string): string {
    return this.b.candidates.get(id)?.name ?? 'Kandidat';
  }

  candNpk(id: string): string {
    return this.b.candidates.get(id)?.employeeId ?? '';
  }

  setAspectCell(id: string, k: Criterion, ref: string): void {
    const m = this.aspectCell.get(id) ?? {};
    m[k] = ref;
    this.aspectCell.set(id, m);
  }

  /** The six stored aspect scores TOPSIS used, per candidate. */
  storedAspects(id: string): Record<Criterion, number> | null {
    const fromTrace = this.t?.candidates?.[id]?.aspects;
    if (fromTrace) return fromTrace as Record<Criterion, number>;
    const p = this.b.pool.find((x) => x.candidateId === id);
    if (p) return p.aspects as Record<Criterion, number>;
    const r = this.b.results.find((x) => x.candidateId === id);
    const sb = r?.details?.scoreBreakdown;
    return sb ? (sb as Record<Criterion, number>) : null;
  }

  poolRow(id: string) {
    return this.b.pool.find((x) => x.candidateId === id) ?? null;
  }
}
