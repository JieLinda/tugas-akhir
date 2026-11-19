'use server';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getCurrentTenantId } from '@/lib/tenant';
import { getLookupTechnicalCompetencies } from '@/lib/pulse-data';
import { revalidatePath } from 'next/cache';
import { logAudit } from '@/lib/audit';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { liveCandidate } from '@/lib/candidate-visibility';
import { decryptCandidateRows } from '@/lib/candidate-crypto';

// Helper from candidate-form-dialog.tsx
function getProficiencyFromScore(score?: number | null): string {
  if (score === 4) return 'Expert';
  if (score === 3) return 'Advanced';
  if (score === 2) return 'Intermediate';
  if (score === 1) return 'Basic';
  return 'Not Assessed';
}

// Seeds randomized competency scores across every candidate in the tenant, and
// that data feeds AHP/TOPSIS scoring — so it must never be callable by a plain
// viewer. It currently has no UI caller, but exporting it from a 'use server'
// file publishes it as an RPC endpoint regardless.
export async function populateDummyCompetenciesAction() {
  await requirePermission('candidates.manage');
  const [tenantId, actorId] = await Promise.all([getCurrentTenantId(), ensureLocalUser()]);

  console.log(`Populating dummy competencies for tenant: ${tenantId}`);

  const masterCompetencies = await getLookupTechnicalCompetencies();
  if (masterCompetencies.length === 0) {
    throw new Error('No master technical competencies found. Please run sync first.');
  }

  const existingCandidateCompetencies = await db
    .select({ candidateId: schema.candidateTechnicalCompetencies.candidateId })
    .from(schema.candidateTechnicalCompetencies)
    .where(eq(schema.candidateTechnicalCompetencies.isManual, true)); // Only consider manual ones for existing

  const candidatesWithManualCompetencies = new Set(existingCandidateCompetencies.map((c) => c.candidateId));

  const candidatesWithoutManualCompetencies = decryptCandidateRows(
    await db
      .select({ id: schema.candidates.id, name: schema.candidates.name })
      .from(schema.candidates)
      // Tombstones are skipped: this seeds competency rows that feed AHP/TOPSIS.
      .where(and(eq(schema.candidates.tenantId, tenantId), liveCandidate())),
  ).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const candidatesToAddCompetencies = candidatesWithoutManualCompetencies.filter(
    (c) => !candidatesWithManualCompetencies.has(c.id)
  );

  if (candidatesToAddCompetencies.length === 0) {
    console.log('No candidates found without manual technical competencies to populate.');
    return { success: true, message: 'No candidates to populate.', count: 0 };
  }

  console.log(`Found ${candidatesToAddCompetencies.length} candidates to populate.`);

  const newCompetencies: (typeof schema.candidateTechnicalCompetencies.$inferInsert)[] = [];

  for (const candidate of candidatesToAddCompetencies) {
    // Pick 2-3 random competencies for each candidate
    const numCompetencies = Math.floor(Math.random() * 2) + 2; // 2 or 3
    const shuffled = [...masterCompetencies].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, numCompetencies);

    for (const comp of selected) {
      const currentScore = Math.floor(Math.random() * 4) + 1; // 1-4
      const targetScore = Math.floor(Math.random() * 4) + 1; // 1-4
      const gap = currentScore - targetScore;

      newCompetencies.push({
        candidateId: candidate.id,
        technicalId: comp.technicalId,
        technicalName: comp.technicalName,
        proficiencyName: getProficiencyFromScore(targetScore),
        currentProficiencyName: getProficiencyFromScore(currentScore),
        score: targetScore,
        currentScore: currentScore,
        gap: gap,
        isManual: true, // Mark as manual so it's not overwritten by sync
        sourceKey: `manual_${candidate.id}_${comp.technicalId}`, // Unique source key for manual data
      });
    }
  }

  if (newCompetencies.length > 0) {
    console.log(`Inserting ${newCompetencies.length} new dummy technical competencies...`);
    await db.insert(schema.candidateTechnicalCompetencies).values(newCompetencies);
    console.log('Dummy competencies populated successfully!');

    await logAudit({
        tenantId,
        actorId,
        entityType: 'candidate_technical_competency',
        action: 'seed',
        summary: `Populated ${newCompetencies.length} dummy technical competencies for ${candidatesToAddCompetencies.length} candidates.`,
    });
    revalidatePath('/candidates');
    revalidatePath('/positions'); // Might affect scoring readiness
    return { success: true, message: `Populated ${newCompetencies.length} dummy competencies for ${candidatesToAddCompetencies.length} candidates.`, count: newCompetencies.length };

  } else {
    console.log('No new dummy competencies to insert.');
    return { success: true, message: 'No new dummy competencies to insert.', count: 0 };
  }
}
