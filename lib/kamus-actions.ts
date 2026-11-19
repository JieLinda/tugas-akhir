'use server';

import { asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { syncKamusKompetensi } from '@/lib/db/schema';
import { requirePermission } from '@/lib/rbac';
import { demoMaskKamus } from '@/lib/demo/content';

export type KamusRecordRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  levelBasic: string | null;
  levelIntermediate: string | null;
  levelAdvance: string | null;
  levelMastery: string | null;
  sourceFile: string | null;
  syncedAt: string;
};

/**
 * Full competency dictionary — loaded client-side (after paint) rather than in
 * the page's SSR render, since each record carries a description + four level
 * paragraphs and shipping all of them in the RSC stream made the page heavy.
 */
// Demo mode: every description keeps its first and last 20% of words.
export async function listKamusCompetencies(
  ...args: Parameters<typeof listKamusCompetenciesImpl>
): ReturnType<typeof listKamusCompetenciesImpl> {
  return demoMaskKamus(await listKamusCompetenciesImpl(...args));
}

async function listKamusCompetenciesImpl(): Promise<KamusRecordRow[]> {
  await requirePermission('job_profiles.view');
  const rows = await db
    .select({
      id: syncKamusKompetensi.id,
      code: syncKamusKompetensi.code,
      name: syncKamusKompetensi.name,
      description: syncKamusKompetensi.description,
      levelBasic: syncKamusKompetensi.levelBasic,
      levelIntermediate: syncKamusKompetensi.levelIntermediate,
      levelAdvance: syncKamusKompetensi.levelAdvance,
      levelMastery: syncKamusKompetensi.levelMastery,
      sourceFile: syncKamusKompetensi.sourceFile,
      syncedAt: syncKamusKompetensi.syncedAt,
    })
    .from(syncKamusKompetensi)
    .orderBy(asc(syncKamusKompetensi.code));

  return rows.map((r) => ({ ...r, syncedAt: r.syncedAt.toISOString() }));
}
