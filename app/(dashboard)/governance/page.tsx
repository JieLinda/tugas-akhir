import { DashboardHeader } from '@/components/dashboard-header';
import {
  getCandidateFilterValues,
  listProgramTemplates,
  positionProgramTemplates,
} from '@/lib/programs';
import { listAuditLogPage } from '@/lib/audit';
import { getCurrentTenantId } from '@/lib/tenant';
import { getScoringPrompts } from '@/lib/scoring-prompt-actions';
import { getReadinessConfig } from '@/lib/readiness-config-actions';
import { getRetirementConfigAction } from '@/lib/retirement-config-actions';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { GovernanceClient } from '@/components/governance/governance-client';
import { parseGovernanceTab } from '@/components/governance/governance-types';
import { requirePagePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

export const dynamic = 'force-dynamic';

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requirePagePermission('governance.manage');
  // Deep link from the dashboard, e.g. /governance?tab=programs.
  const initialTab = parseGovernanceTab((await searchParams).tab);
  const tenantId = await getCurrentTenantId();
  const [templates, auditPage, gradeLevels, scoringPrompts, readinessConfig, retirementConfig, fieldValues] = await Promise.all([
    listProgramTemplates(tenantId),
    listAuditLogPage(tenantId, { page: 1, pageSize: 50 }),
    db
      .select()
      .from(schema.syncGradeLevels)
      .orderBy(asc(schema.syncGradeLevels.companyId), asc(schema.syncGradeLevels.levelId), asc(schema.syncGradeLevels.gradeId)),
    getScoringPrompts(),
    getReadinessConfig(),
    getRetirementConfigAction(),
    getCandidateFilterValues(tenantId),
  ]);

  // Program Penilaian lists only the programs that actually score a position.
  // Talent Pool is in NON_POSITION_PROGRAM_CODES: no run is ever started under
  // it, so everything this editor configures — the AHP matrix, the finalist
  // target, rule enforcement — has no reader for that program, and its one
  // live setting (the eligibility rules) is now edited on the Talent Pool page
  // itself, beside the list those rules produce. Listing it here offered a second surface where most controls did
  // nothing and two of them contradicted the first. The template is still
  // seeded and still editable — just from the page that shows its effect.
  const editableTemplates = positionProgramTemplates(templates);
  // Demo mode: names inside audit summaries leave the server as initials.
  // Templates and filter values are NOT scrubbed — this page saves them back,
  // and neither holds a name.
  const shown = await demoScrub({ auditEntries: auditPage.entries });

  return (
    <>
      <DashboardHeader
        title="Tata Kelola"
        info="Aturan main penilaian suksesi: program penilaian, instruksi & model AI, ambang kesiapan & pensiun, serta riwayat perubahan. Berlaku untuk run berikutnya; run yang sudah selesai menyimpan aturannya sendiri."
      />
      <div className="flex-1 overflow-auto p-6">
        <GovernanceClient
          initialTab={initialTab}
          templates={editableTemplates.map((t) => ({
            id: t.id,
            code: t.code,
            name: t.name,
            description: t.description,
            targetFinalists: t.targetFinalists,
            defaultMethod: t.defaultMethod,
            filterRules: t.filterRules,
            filterTree: t.filterTree,
            defaultCriteria: t.defaultCriteria,
            enforceFilterRules: t.enforceFilterRules,
            ahpConfig: t.ahpConfig,
            isSystem: t.isSystem,
            createdAt: t.createdAt.toISOString(),
            updatedAt: t.updatedAt.toISOString(),
          }))}
          auditLog={shown.auditEntries}
          auditTotal={auditPage.total}
          gradeLevels={gradeLevels.map((g) => ({
            companyId: g.companyId,
            levelId: g.levelId,
            levelName: g.levelName,
            gradeId: g.gradeId,
          }))}
          scoringPrompts={scoringPrompts}
          readinessConfig={readinessConfig}
          retirementConfig={retirementConfig}
          fieldValues={fieldValues}
        />
      </div>
    </>
  );
}
