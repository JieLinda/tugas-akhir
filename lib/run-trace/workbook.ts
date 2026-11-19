// The calculation-trace workbook of one AHP + TOPSIS run — pure: a RunTraceBundle
// in, a WorkbookModel out (lib/run-trace/xlsx.ts renders it).
//
// Built in DEPENDENCY order (a formula can only point at a cell that already
// has a row number) and laid out in READING order (raw data first, ranking last).

import { BuildContext, SHEET } from './context';
import type { RunTraceBundle } from './load';
import type { WorkbookModel } from './sheet';
import { buildParameters } from './sections/parameters';
import { buildAnchors } from './sections/anchors';
import { buildLabels } from './sections/labels';
import { buildTechnical, collectTechnicalLabels } from './sections/technical';
import { buildCareer, collectCareerLabels } from './sections/career';
import { buildAspects } from './sections/aspects';
import { buildAhp, buildTopsis } from './sections/ranking';
import { buildPool } from './sections/pool';
import { buildGuide, buildSummary } from './sections/summary';

const READING_ORDER: string[] = [
  SHEET.guide,
  SHEET.summary,
  SHEET.params,
  SHEET.pool,
  SHEET.techRequired,
  SHEET.labels,
  SHEET.techHeld,
  SHEET.techPairs,
  SHEET.techCells,
  SHEET.techCand,
  SHEET.careerStints,
  'Pengganti - Pemegang',
  'Pengganti - Gabungan',
  'Pengganti - Pasangan',
  SHEET.careerFallback,
  SHEET.careerTarget,
  SHEET.careerCand,
  SHEET.behavior,
  SHEET.pa,
  SHEET.hav,
  SHEET.education,
  SHEET.ahp,
  SHEET.topsis,
  SHEET.techAnchors,
  SHEET.censusKamus,
  SHEET.careerAnchors,
  SHEET.censusCorpus,
  SHEET.censusBest,
  SHEET.censusFamily,
  SHEET.censusMoves,
  SHEET.censusDepth,
  SHEET.idf,
  SHEET.idfDocs,
];

export function buildTraceWorkbook(bundle: RunTraceBundle): WorkbookModel {
  const ctx = new BuildContext(bundle);
  if (!bundle.engineTraceStatus.readable) {
    ctx.gaps.push(
      `Jejak engine tidak tersedia (${bundle.engineTraceStatus.reason ?? 'tidak tercatat'}). Lembar aspek memakai rincian tersimpan yang ada (sebagian dibulatkan); langkah yang butuh jejak ditandai sebagai masukan.`,
    );
  }

  buildParameters(ctx);
  buildAnchors(ctx);
  const labels = new Map<string, number | null>();
  collectTechnicalLabels(ctx, labels);
  collectCareerLabels(ctx, labels);
  const labelIndex = buildLabels(ctx, labels);
  buildTechnical(ctx, labelIndex);
  buildCareer(ctx, labelIndex);
  buildAspects(ctx);
  buildAhp(ctx);
  buildTopsis(ctx);
  buildPool(ctx);
  buildSummary(ctx);
  buildGuide(ctx);

  const byName = ctx.sheets;
  const ordered = READING_ORDER.map((n) => byName.get(n.slice(0, 31))).filter((x): x is NonNullable<typeof x> => Boolean(x));
  for (const s of byName.values()) if (!ordered.includes(s)) ordered.push(s);
  return { sheets: ordered.map((s) => s.toModel()), names: ctx.names };
}
