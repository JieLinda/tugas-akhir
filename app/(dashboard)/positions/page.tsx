import { PositionsPageClient } from '@/components/positions-page-client';
import { getPositionManagementPage, getCandidateLookup, getMasterPositions, getGradeLevelsForTenant, getLookupDepartments, getLookupDivisions, parsePositionBench, parsePositionFlag, parseReadinessBand } from '@/lib/pulse-data';
import { listProgramTemplates, positionProgramTemplates } from '@/lib/programs';
import { getCurrentTenantId } from '@/lib/tenant';
import { requirePagePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

export default async function PositionsPage({
  searchParams,
}: {
  searchParams: Promise<{ bench?: string; readiness?: string; band?: string; flag?: string }>;
}) {
  await requirePagePermission('positions.view');
  // Dashboard drill-downs land here pre-filtered (?readiness=ready, ?band=…),
  // and the bench overview on this page uses ?bench= for the same reason.
  const resolvedSearchParams = await searchParams;
  const bench = parsePositionBench(resolvedSearchParams.bench ?? resolvedSearchParams.readiness);
  const band = parseReadinessBand(resolvedSearchParams.band);
  // The summary lines above the table are drill-downs too, and go through the
  // URL for the same reason the dashboard ones do: a filtered list has to
  // survive a refresh and be sendable to someone else.
  const flag = parsePositionFlag(resolvedSearchParams.flag);

  const tenantId = await getCurrentTenantId();
  const templates = await listProgramTemplates(tenantId);
  // Talent Pool filters candidates and has its own menu, so it is not offered as
  // a position program — see NON_POSITION_PROGRAM_CODES.
  const selectableTemplates = positionProgramTemplates(templates);
  const availablePrograms = Array.from(new Set(
    selectableTemplates.map((t) => t.code).filter(Boolean) as string[]
  ));
  // Program code → display name (e.g. "emergency" → "Emergency Position").
  // Built from ALL templates, not just the selectable ones: a position filed
  // under a program that is no longer offered must still render its real name.
  const programLabels = Object.fromEntries(
    templates.filter((t) => t.code).map((t) => [t.code as string, t.name]),
  ) as Record<string, string>;

  const [{ positions, total, flagCounts, benchCounts }, candidates, masterPositions, gradeLevels, departments, divisions] = await Promise.all([
    getPositionManagementPage(1, 20, '', '', '', '', bench, band, flag),
    // Skinny lookup (id/name/position) — the full-profile loader made this
    // page's SSR payload huge and slow; the position form only needs names.
    getCandidateLookup(),
    getMasterPositions(),
    getGradeLevelsForTenant(tenantId),
    getLookupDepartments(),
    getLookupDivisions(),
  ]);

  // Demo mode: holder, successor and candidate names leave the server as
  // initials (no-op otherwise). Position writes are refused in demo mode, so no
  // form can save them back.
  const shown = await demoScrub({ positions, candidates, masterPositions });

  return (
    <PositionsPageClient
      initialPositions={shown.positions}
      initialTotal={total}
      initialCandidates={shown.candidates}
      masterPositions={shown.masterPositions}
      gradeLevels={gradeLevels}
      masterDepartments={departments}
      masterDivisions={divisions}
      availablePrograms={availablePrograms}
      programLabels={programLabels}
      programs={selectableTemplates.map((t) => ({ id: t.id, code: t.code, name: t.name }))}
      initialBench={bench}
      initialBand={band}
      initialFlag={flag}
      initialFlagCounts={flagCounts}
      initialBenchCounts={benchCounts}
    />
  );
}
