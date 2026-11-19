import 'dotenv/config';

import { createHash } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { db, pool } from '../lib/db';
import * as schema from '../lib/db/schema';
import {
  candidateProfiles,
  mockPositions,
  positionCandidates,
  scoringComponents,
  type CandidateProfile,
} from '../lib/talent-data';
import { systemProgramTemplates } from '../lib/program-defaults';
import { decryptCandidateRows, encryptCandidateRow } from '../lib/candidate-crypto';

const SEED_USER_ID = deterministicUuid('seed-user');
const DEFAULT_ASSESSMENT_VALID_UNTIL = '2028-12-31';
const TALENT_POOL_BORDERLINE_HAV = new Set(['Kuadran #8', 'Kuadran #13', 'Kuadran #14']);

const TENANTS = [
  { id: '10000000-0000-0000-0000-000000000001', slug: 'mulia', name: 'Mulia' },
  { id: '10000000-0000-0000-0000-000000000002', slug: 'mso', name: 'MSO' },
  { id: '10000000-0000-0000-0000-000000000003', slug: 'erro', name: 'ERRO' },
] as const;

type SeedCandidate = {
  mockId: string;
  name: string;
  email: string;
  employeeId: string;
  currentPosition: string;
  department: string;
  division: string;
  yearsExperience: number;
  havQuadrant: string | null;
  disciplineStatus: 'clear' | 'warning' | 'sanction';
  mcuStatus: 'fit' | 'fit_with_note' | 'unfit' | 'expired';
  performanceGrade: string | null;
  behaviorReviewStatus: 'pass' | 'review' | 'fail';
  assessmentValidity: string | null;
  education: string | null;
  major: string | null;
};

function deterministicUuid(input: string) {
  const hash = createHash('sha256').update(`pulse-seed:${input}`).digest('hex').slice(0, 32).split('');
  hash[12] = '5';
  hash[16] = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);

  const value = hash.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20, 32)}`;
}

function normalizeEmail(value: string) {
  return `${value.toLowerCase().replace(/[^a-z0-9]+/g, '.')}`.replace(/^\.+|\.+$/g, '') + '@pulse.local';
}

function mapDiscipline(text: string | undefined): 'clear' | 'warning' | 'sanction' {
  if (!text) return 'clear';
  const lower = text.toLowerCase();
  if (lower.includes('sp1') || lower.includes('sp2') || lower.includes('sp3') || lower.includes('sanksi')) return 'sanction';
  if (lower.includes('st ') || lower.includes('warning')) return 'warning';
  return 'clear';
}

function mapMcu(text: string | undefined): 'fit' | 'fit_with_note' | 'unfit' | 'expired' {
  if (!text) return 'fit';
  const lower = text.toLowerCase();
  if (lower.includes('unfit')) return 'unfit';
  if (lower.includes('note')) return 'fit_with_note';
  if (lower.includes('expired') || lower.includes('belum')) return 'expired';
  return 'fit';
}

function mapPerformanceFromHistory(profile: CandidateProfile): string | null {
  const latest = profile.assessmentHistory?.[0]?.performance;
  if (!latest) return null;
  const upper = latest.trim().toUpperCase();
  if (['A', 'B', 'C', 'D', 'E'].includes(upper)) return upper;
  return null;
}

function mapBehaviorFromHistory(profile: CandidateProfile): 'pass' | 'review' | 'fail' {
  const latest = profile.assessmentHistory?.[0]?.behavior?.toLowerCase() ?? '';
  if (latest.includes('tidak') || latest.includes('score 0')) return 'fail';
  if (latest.includes('disarankan dengan pengembangan') || latest.includes('75%')) return 'review';
  return 'pass';
}

function parseAssessmentValidityToISO(text: string | undefined | null): string | null {
  if (!text) return null;
  // "Valid sampai Februari 2031" → 2031-02-01
  const match = text.match(/sampai\s+([A-Za-z]+)\s+(\d{4})/i);
  if (!match) return null;
  const monthMap: Record<string, number> = {
    januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
    juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  };
  const month = monthMap[match[1]!.toLowerCase()];
  const year = Number.parseInt(match[2]!, 10);
  if (!month || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function normalizeSeedCandidate(candidate: SeedCandidate): SeedCandidate {
  const hasStrongCoreProfile =
    candidate.disciplineStatus === 'clear' &&
    ['fit', 'fit_with_note'].includes(candidate.mcuStatus) &&
    ['pass', 'review'].includes(candidate.behaviorReviewStatus) &&
    ['A', 'B'].includes(candidate.performanceGrade ?? '');

  return {
    ...candidate,
    assessmentValidity: candidate.assessmentValidity ?? DEFAULT_ASSESSMENT_VALID_UNTIL,
    havQuadrant:
      hasStrongCoreProfile && candidate.havQuadrant !== null && TALENT_POOL_BORDERLINE_HAV.has(candidate.havQuadrant)
        ? 'Kuadran #7'
        : candidate.havQuadrant,
  };
}

function formatDateOnly(value: Date | string | null): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function buildSeedCandidates(): SeedCandidate[] {
  const byId = new Map<string, SeedCandidate>();

  for (const profile of candidateProfiles) {
    byId.set(profile.id, {
      mockId: profile.id,
      name: profile.name,
      email: normalizeEmail(profile.employeeId || profile.name),
      employeeId: profile.employeeId,
      currentPosition: profile.currentPosition,
      department: profile.department,
      division: profile.division,
      yearsExperience: profile.yearsOfService,
      havQuadrant: profile.havQuadrant ?? null,
      disciplineStatus: mapDiscipline(profile.disciplinaryStatus),
      mcuStatus: mapMcu(profile.mcuStatus),
      performanceGrade: mapPerformanceFromHistory(profile),
      behaviorReviewStatus: mapBehaviorFromHistory(profile),
      assessmentValidity: parseAssessmentValidityToISO(profile.assessmentValidity),
      education: profile.education ?? null,
      major: profile.major ?? null,
    });
  }

  for (const position of mockPositions) {
    for (const candidate of positionCandidates[position.id] ?? []) {
      if (byId.has(candidate.id)) continue;
      // Synthetic candidates not present in candidateProfiles
      byId.set(candidate.id, {
        mockId: candidate.id,
        name: candidate.name,
        email: normalizeEmail(candidate.id),
        employeeId: candidate.id,
        currentPosition: candidate.currentPosition,
        department: position.department,
        division: position.division,
        yearsExperience: candidate.yearsOfService,
        havQuadrant: candidate.havQuadrant ?? null,
        disciplineStatus: candidate.primaryFilter?.discipline === 'reject' ? 'warning' : 'clear',
        mcuStatus: candidate.primaryFilter?.mcu === 'reject' ? 'unfit' : 'fit',
        performanceGrade:
          !candidate.performance || candidate.performance === '-'
            ? 'B'
            : candidate.performance.trim().toUpperCase().charAt(0),
        behaviorReviewStatus: candidate.primaryFilter?.behavior === 'reject' ? 'fail' : 'pass',
        assessmentValidity: null,
        education: null,
        major: null,
      });
    }
  }

  return [...byId.values()].map(normalizeSeedCandidate);
}

function getScoreValue(componentName: string, candidate: (typeof positionCandidates)[string][number]) {
  switch (componentName) {
    case 'Technical Competency Mapping':
      return candidate.scoreBreakdown.technical;
    case 'Behavior Competency Assessment':
      return candidate.scoreBreakdown.behavior;
    case 'HAV Mapping':
      return candidate.scoreBreakdown.hav;
    case 'Performance Appraisal':
      return candidate.scoreBreakdown.performance;
    case 'Employee Profile - Pendidikan':
      return candidate.scoreBreakdown.education;
    default:
      return 0;
  }
}

/**
 * Ensure the three system program templates exist for every tenant.
 * Idempotent: skips templates that already exist (matched by tenant_id + code).
 */
async function seedProgramTemplatesForAllTenants() {
  for (const tenant of TENANTS) {
    const existing = await db
      .select({ code: schema.programTemplates.code })
      .from(schema.programTemplates)
      .where(eq(schema.programTemplates.tenantId, tenant.id));
    const existingCodes = new Set(existing.map((r) => r.code));

    const toInsert = systemProgramTemplates
      .filter((tpl) => !existingCodes.has(tpl.code))
      .map((tpl) => ({
        id: deterministicUuid(`program-template:${tenant.id}:${tpl.code}`),
        tenantId: tenant.id,
        code: tpl.code,
        name: tpl.name,
        description: tpl.description,
        filterRules: tpl.filterRules as unknown as object,
        defaultCriteria: tpl.defaultCriteria as unknown as object,
        defaultMethod: tpl.defaultMethod,
        targetFinalists: tpl.targetFinalists,
        isSystem: true,
        createdBy: SEED_USER_ID,
      }));

    if (toInsert.length > 0) {
      await db.insert(schema.programTemplates).values(toInsert);
      console.log(`  → tenant ${tenant.slug}: inserted ${toInsert.length} program template(s).`);
    }
  }
}

async function repairSeededCandidateFilterData(tenantId: string) {
  const sourceCandidates = buildSeedCandidates();
  const sourceByEmployeeId = new Map(sourceCandidates.map((candidate) => [candidate.employeeId, candidate]));
  const sourceByEmail = new Map(sourceCandidates.map((candidate) => [candidate.email, candidate]));
  const sourceByName = new Map(sourceCandidates.map((candidate) => [candidate.name, candidate]));

  const rows = decryptCandidateRows(
    await db
      .select({
        id: schema.candidates.id,
        employeeId: schema.candidates.employeeId,
        email: schema.candidates.email,
        name: schema.candidates.name,
        yearsExperience: schema.candidates.yearsExperience,
        disciplineStatus: schema.candidates.disciplineStatus,
        mcuStatus: schema.candidates.mcuStatus,
        performanceGrade: schema.candidates.performanceGrade,
        havQuadrant: schema.candidates.havQuadrant,
        education: schema.candidates.education,
        major: schema.candidates.major,
      })
      .from(schema.candidates)
      .where(eq(schema.candidates.tenantId, tenantId)),
  );

  let updated = 0;
  for (const row of rows) {
    const sourceCandidate =
      (row.employeeId ? sourceByEmployeeId.get(row.employeeId) : undefined) ??
      (row.email ? sourceByEmail.get(row.email) : undefined) ??
      sourceByName.get(row.name);

    if (!sourceCandidate) continue;

    const shouldUpdate =
      Number(row.yearsExperience) !== sourceCandidate.yearsExperience ||
      row.disciplineStatus !== sourceCandidate.disciplineStatus ||
      row.mcuStatus !== sourceCandidate.mcuStatus ||
      row.performanceGrade !== sourceCandidate.performanceGrade ||
      row.havQuadrant !== sourceCandidate.havQuadrant ||
      row.education !== sourceCandidate.education ||
      row.major !== sourceCandidate.major;

    if (!shouldUpdate) continue;

    await db
      .update(schema.candidates)
      .set(
        await encryptCandidateRow({
          yearsExperience: String(sourceCandidate.yearsExperience),
          disciplineStatus: sourceCandidate.disciplineStatus,
          mcuStatus: sourceCandidate.mcuStatus,
          performanceGrade: sourceCandidate.performanceGrade,
          havQuadrant: sourceCandidate.havQuadrant,
          education: sourceCandidate.education,
          major: sourceCandidate.major,
        }),
      )
      .where(eq(schema.candidates.id, row.id));

    updated += 1;
  }

  if (updated > 0) {
    console.log(`  → repaired ${updated} seeded candidate record(s) for filter readiness.`);
  }
}

async function main() {
  console.log('PULSE seeder starting…');

  // 1. Tenants — idempotent
  await db
    .insert(schema.tenants)
    .values(TENANTS.map((t) => ({ id: t.id, slug: t.slug, name: t.name })))
    .onConflictDoNothing();
  console.log(`✓ Tenants ensured (${TENANTS.length}).`);

  const defaultTenantId = TENANTS[0]!.id;

  // 2. Seed user
  await db
    .insert(schema.users)
    .values({
      id: SEED_USER_ID,
      email: 'system@pulse.local',
      name: 'PULSE System Seeder',
      tenantId: defaultTenantId,
    })
    .onConflictDoNothing({ target: schema.users.email });
  console.log('✓ Seeder user ensured.');

  // 3. Program templates per tenant — always check, additive
  await seedProgramTemplatesForAllTenants();
  console.log('✓ Program templates ensured.');

  // Repair existing seeded candidates so the default filters produce a realistic majority pass rate.
  await repairSeededCandidateFilterData(defaultTenantId);

  // 4. Sample positions / candidates / criteria / runs.
  //    Skipped if the default tenant already has any position (avoids polluting live data).
  const samplePositionCount = await db
    .select({ total: count() })
    .from(schema.criticalPositions)
    .where(eq(schema.criticalPositions.tenantId, defaultTenantId))
    .then((rows) => Number(rows[0]?.total ?? 0));

  if (samplePositionCount > 0) {
    console.log(`ℹ Default tenant already has ${samplePositionCount} position(s). Skipping sample-data seed.`);
    return;
  }

  console.log('Seeding sample positions, candidates, criteria, runs…');

  const seedCandidates = buildSeedCandidates();

  const positionIdByMockId = new Map(
    mockPositions.map((position) => [position.id, deterministicUuid(`position:${position.id}`)])
  );
  const candidateIdByMockId = new Map(
    seedCandidates.map((candidate) => [candidate.mockId, deterministicUuid(`candidate:${candidate.mockId}`)])
  );

  const successorTemplateId = deterministicUuid(`program-template:${defaultTenantId}:successor`);

  await db.transaction(async (tx) => {
    await tx.insert(schema.criticalPositions).values(
      mockPositions.map((position) => {
        // A position belongs to exactly one program now; the mock rows list
        // several, so the first one wins and the others would be added as
        // separate positions in the app.
        const programCode = position.programs[0] ?? 'successor';
        return {
          id: positionIdByMockId.get(position.id)!,
          tenantId: defaultTenantId,
          title: position.title,
          department: position.department,
          division: position.division,
          status: position.status,
          programCode,
          programTemplateId: deterministicUuid(`program-template:${defaultTenantId}:${programCode}`),
          holderName: position.currentHolder?.name,
          holderEmployeeId: position.currentHolder?.employeeId,
          createdBy: SEED_USER_ID,
        };
      })
    );

    await tx.insert(schema.candidates).values(
      await Promise.all(
        seedCandidates.map(async (candidate) =>
          encryptCandidateRow({
            id: candidateIdByMockId.get(candidate.mockId)!,
            tenantId: defaultTenantId,
            employeeId: candidate.employeeId,
            name: candidate.name,
            email: candidate.email,
            currentPosition: candidate.currentPosition,
            department: candidate.department,
            division: candidate.division,
            yearsExperience: String(candidate.yearsExperience),
            disciplineStatus: candidate.disciplineStatus,
            mcuStatus: candidate.mcuStatus,
            performanceGrade: candidate.performanceGrade,
            havQuadrant: candidate.havQuadrant,
            education: candidate.education,
            major: candidate.major,
            createdBy: SEED_USER_ID,
          }),
        ),
      ),
    );

    await tx.insert(schema.criteria).values(
      mockPositions.flatMap((position) =>
        scoringComponents.map((component) => ({
          id: deterministicUuid(`criteria:${position.id}:${component.name}`),
          positionId: positionIdByMockId.get(position.id)!,
          name: component.name,
          description: `${component.source} | ${component.threshold}`,
          weight: component.weight.toFixed(2),
          type: 'benefit' as const,
          category: 'score' as const,
          sourceTemplateId: successorTemplateId,
        }))
      )
    );

    const scoringRunIds = new Map<string, string>();
    for (const position of mockPositions) {
      scoringRunIds.set(position.id, deterministicUuid(`scoring-run:${position.id}`));
    }

    await tx.insert(schema.scoringRuns).values(
      mockPositions.map((position) => ({
        id: scoringRunIds.get(position.id)!,
        positionId: positionIdByMockId.get(position.id)!,
        tenantId: defaultTenantId,
        programTemplateId: successorTemplateId,
        program: 'successor',
        method: 'SAW',
        label: 'Initial Seed Scoring (Successor)',
        status: 'completed' as const,
        candidateCount: (positionCandidates[position.id] ?? []).length,
        filterSummary: {
          qualified: (positionCandidates[position.id] ?? []).length,
          disqualified: [],
          overrides: [],
        },
        createdBy: SEED_USER_ID,
        completedAt: new Date(),
      }))
    );

    await tx.insert(schema.analysisResults).values(
      mockPositions.flatMap((position) => {
        const ranked = [...(positionCandidates[position.id] ?? [])].sort(
          (left, right) => right.weightedScore - left.weightedScore
        );

        return ranked.map((candidate, index) => ({
          id: deterministicUuid(`analysis:${position.id}:${candidate.id}`),
          runId: scoringRunIds.get(position.id)!,
          positionId: positionIdByMockId.get(position.id)!,
          candidateId: candidateIdByMockId.get(candidate.id)!,
          method: 'SAW',
          finalScore: (candidate.weightedScore / 100).toFixed(6),
          rank: index + 1,
          details: JSON.stringify(candidate),
          calculatedBy: SEED_USER_ID,
        }));
      })
    );

    await tx.insert(schema.auditLog).values({
      tenantId: defaultTenantId,
      actorId: SEED_USER_ID,
      entityType: 'tenant',
      entityId: defaultTenantId,
      action: 'seed' as const,
      summary: `Sample data seeded: ${mockPositions.length} positions, ${seedCandidates.length} candidates.`,
      diff: {
        positions: mockPositions.length,
        candidates: seedCandidates.length,
        criteria: mockPositions.length * scoringComponents.length,
      },
    });
  });

  console.log(
    `✓ Sample data seeded: ${mockPositions.length} positions, ${seedCandidates.length} candidates, ${mockPositions.length * scoringComponents.length} criteria.`
  );

  await repairSeededCandidateFilterData(defaultTenantId);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
