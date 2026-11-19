// Turn a job-family map's trace bundle into a workbook model — pure, so a test
// or a verification script can build one from a fixture and recalculate it.
//
// Every derived cell is a formula written WITHOUT a cached value, beside the
// number the library recorded and the number the map persisted; "Ringkasan"
// counts the mismatches per stage live. A run that stored no trace (built
// before drizzle/0094, or whose trace write failed) gets a short workbook that
// says so and lists what the map persisted, instead of pretending.

import type { JobFamilyTraceBundle } from './load';
import { BuildContext, SHEET } from './context';
import { SheetBuilder, type WorkbookModel } from '../run-trace/sheet';
import { buildDatabaseState, buildDocuments, buildParameters, buildVectors } from './sections/inputs';
import { buildCurve, buildGraph, buildKnn, buildLayout, buildSigmaSearch } from './sections/umap';
import {
  buildAncestors,
  buildClusters,
  buildCore,
  buildEuclid,
  buildLabels,
  buildMst,
  buildPoints,
  buildSelection,
  buildSingleLinkage,
  buildSoft,
  buildUnionFind,
} from './sections/hdbscan';
import { buildRehoming, buildTopicIds, fillFinalTopics } from './sections/topics';
import { buildCtfidf } from './sections/ctfidf';
import { buildFinal, buildProjection, buildReasons, buildRepresentatives } from './sections/results';
import { buildGeneralization, buildHierarchy, buildSeeds } from './sections/extras';
import { buildGuide, buildSummary } from './sections/summary';

/** Tab order: guide and summary first, then the pipeline in the order it runs. */
const ORDER: string[] = [
  SHEET.guide,
  SHEET.summary,
  SHEET.params,
  SHEET.db,
  SHEET.docs,
  SHEET.lines,
  SHEET.vec,
  SHEET.cos,
  SHEET.knn,
  SHEET.sigma,
  SHEET.graph,
  SHEET.curve,
  SHEET.layout,
  SHEET.euclid,
  SHEET.core,
  SHEET.mst,
  SHEET.uf,
  SHEET.sl,
  SHEET.points,
  SHEET.clusters,
  SHEET.select,
  SHEET.labels,
  SHEET.ancestors,
  SHEET.soft,
  SHEET.topics,
  SHEET.reduce,
  SHEET.rehome,
  SHEET.ctCounts,
  SHEET.ctVocab,
  SHEET.ctTopics,
  SHEET.reasons,
  SHEET.proj,
  SHEET.reps,
  SHEET.hier,
  SHEET.gen,
  SHEET.seeds,
  SHEET.result,
];

export function buildJobFamilyTraceWorkbook(b: JobFamilyTraceBundle): WorkbookModel {
  if (!b.trace) return degradedWorkbook(b);
  const ctx = new BuildContext(b);

  buildParameters(ctx);
  buildDatabaseState(ctx);
  buildDocuments(ctx);
  buildVectors(ctx);

  buildKnn(ctx);
  buildSigmaSearch(ctx);
  buildGraph(ctx);
  buildCurve(ctx);
  buildLayout(ctx);

  buildEuclid(ctx);
  buildCore(ctx);
  if (ctx.t.hdbscan.mst) {
    buildMst(ctx);
    buildUnionFind(ctx);
  }
  buildSingleLinkage(ctx);
  buildPoints(ctx);
  buildClusters(ctx);
  buildSelection(ctx);
  buildLabels(ctx);
  buildAncestors(ctx);
  buildSoft(ctx);

  buildTopicIds(ctx);
  buildRehoming(ctx);
  fillFinalTopics(ctx);

  buildCtfidf(ctx);

  buildReasons(ctx);
  buildProjection(ctx);
  buildRepresentatives(ctx);
  buildFinal(ctx);

  buildHierarchy(ctx);
  buildGeneralization(ctx);
  buildSeeds(ctx);

  buildSummary(ctx);
  buildGuide(ctx);

  const sheets = ORDER.filter((name) => ctx.sheets.has(name)).map((name) => ctx.sheets.get(name)!.toModel());
  // Any sheet a section added that the order list does not name goes last, so
  // nothing silently disappears.
  for (const [name, sheet] of ctx.sheets) if (!ORDER.includes(name)) sheets.push(sheet.toModel());
  return { sheets, names: ctx.names };
}

function degradedWorkbook(b: JobFamilyTraceBundle): WorkbookModel {
  const guide = new SheetBuilder(SHEET.guide, [34, 120]);
  guide.row(['TRACE PERHITUNGAN PETA JOB FAMILY — TIDAK TERSEDIA UNTUK RUN INI']);
  guide.row(['Run', b.run.id]);
  guide.row(['Alasan', b.traceStatus.reason ?? 'Jejak perhitungan tidak tersimpan.']);
  guide.row(['Yang bisa dilakukan', 'Bangun ulang peta dari halaman Job Family: run baru mencatat seluruh tahap (UMAP, HDBSCAN, c-TF-IDF) sehingga workbook lengkap dapat diunduh.']);
  guide.row(['Isi workbook ini', 'Hanya hasil yang disimpan peta (famili dan penempatan dokumen), tanpa rumus — angka antara tidak pernah dicatat.']);
  const res = new SheetBuilder(SHEET.result, [12, 34, 30, 10, 14, 14, 12, 14]);
  res.row(['HASIL TERSIMPAN (tanpa jejak)']);
  res.row(['ID job profile', 'Jabatan', 'Divisi / Departemen', 'Famili', 'Keanggotaan', 'Kemiripan centroid', 'Famili alternatif', 'Kemiripan alternatif']);
  for (const a of b.assignments) {
    res.row([a.jobProfileId, a.positionName ?? '', a.divisionDepartment ?? '', a.topicId, a.probability, a.centroidSimilarity, a.altTopicId, a.altSimilarity]);
  }
  res.blank();
  res.row(['Famili', 'Label', 'Ukuran', 'Judul umum', 'Kata kunci']);
  for (const t of b.topics) res.row([t.topicId, t.label ?? '', t.size, t.generalTitle ?? '', t.keywords.map((k) => k.word).join(', ')]);
  return { sheets: [guide.toModel(), res.toModel()], names: [] };
}
