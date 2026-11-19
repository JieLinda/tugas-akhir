import { redirect } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { listProgramTemplates, positionProgramTemplates } from '@/lib/programs';
import { getPositionManagementList, getGradeLevelsForTenant } from '@/lib/pulse-data';
import { getCurrentTenantId, TENANTS } from '@/lib/tenant';
import { ScoringWizard } from '@/components/scoring/scoring-wizard';
import { requirePagePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

export const dynamic = 'force-dynamic';

export default async function NewScoringPage({
  searchParams,
}: {
  searchParams?: Promise<{ positionId?: string; sessionId?: string }>;
}) {
  await requirePagePermission('scoring.run');
  const tenantId = await getCurrentTenantId();
  const [templates, positionsRaw, gradeLevels] = await Promise.all([
    listProgramTemplates(tenantId),
    getPositionManagementList(),
    getGradeLevelsForTenant(tenantId),
  ]);
  // Demo mode: holder names leave the server as initials (no-op otherwise).
  const positions = await demoScrub(positionsRaw);

  if (positions.length === 0) {
    redirect('/positions?empty=1');
  }

  const params = (await searchParams) ?? {};
  const initialPositionId = params.positionId ?? positions[0]!.id;
  const sessionId = params.sessionId ?? undefined;

  return (
    <div className="flex flex-col gap-6 pb-8">
      <DashboardHeader
        title="Penilaian Talent"
        info="Jalankan penilaian otomatis untuk menentukan peringkat kandidat terbaik: pilih program dan posisi sasaran, lalu sistem menyaring kandidat dan memeringkatnya dengan AHP + TOPSIS."
      />
      <div className="px-6">
          <ScoringWizard
            templates={positionProgramTemplates(templates).map((t) => ({
              id: t.id,
              code: t.code,
              name: t.name,
              description: t.description,
              filterRulesCount: t.filterRules.length,
              defaultCriteriaCount: t.defaultCriteria.length,
              isSystem: t.isSystem,
              targetFinalists: t.targetFinalists,
            }))}
            positions={positions.map((p) => ({
              id: p.id,
              title: p.title,
              department: p.department,
              level: p.level ?? '-',
              minGradeId: p.minGradeId ?? null,
              maxGradeId: p.maxGradeId ?? null,
              holderName: p.currentHolder?.name ?? null,
              holderEmployeeId: p.currentHolder?.employeeId ?? null,
              programTemplateId: p.programTemplateId,
              programCode: p.programCode,
              programName: p.programName,
            }))}
            gradeLevels={gradeLevels}
            initialPositionId={initialPositionId}
            positionPreselected={Boolean(params.positionId)}
            sessionId={sessionId}
            tenants={TENANTS.map((t) => ({ id: t.id, name: t.name }))}
            currentTenantId={tenantId}
          />
      </div>
    </div>
  );
}
