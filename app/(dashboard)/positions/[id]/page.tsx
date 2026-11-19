import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DashboardHeader } from '@/components/dashboard-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoHint } from '@/components/ui/info-hint';
import { getPositionDetail, getGradeLevelsForTenant, getPositionIncumbentProfile , getIncumbentCandidateIds } from '@/lib/pulse-data';
import { getCurrentTenantId, TENANTS } from '@/lib/tenant';
import { getScoringRun, getScoringRunsForPosition } from '@/lib/scoring-engine';
import { listProgramTemplates, positionProgramTemplates } from '@/lib/programs';
import { listPositionPicks } from '@/lib/position-pick-actions';
import { getReadinessConfig } from '@/lib/readiness-config-actions';
import { requirePagePermission } from '@/lib/rbac';
import { type RunSummary } from '@/components/position-detail-tabs';
import { PositionRunSection } from '@/components/position-run-section';
import { LinkJobProfileDialog } from '@/components/link-job-profile-dialog';
import { ScoringThreadAnchor } from '@/components/activity-thread';
import { compactRunLabel } from '@/lib/activity-thread';
import { ArrowLeft, PlayCircle, Target } from 'lucide-react';
import { demoScrub } from '@/lib/demo/names';

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const POSITION_PROGRAM_HINT =
  'Program suksesi tempat posisi ini terdaftar. Satu posisi hanya bisa berada di satu program, dan program itu terkunci begitu posisi punya run scoring. Run lama yang dibuat di bawah program lain tetap memakai label programnya sendiri.';

export default async function PositionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    runId?: string;
    program?: string;
    dateFrom?: string;
    dateTo?: string;
    /** Result tab to open, e.g. `komparasi-versi` (the old `perbandingan-run` still works). */
    tab?: string;
    /** The pair the "Komparasi Versi" tab opens on (FR-CMP-11). */
    a?: string;
    b?: string;
  }>;
}) {
  // Also covers /analysis, which is a redirect stub into this route.
  await requirePagePermission('positions.view');
  const { id } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedRunRaw = resolvedSearchParams.runId ? await getScoringRun(resolvedSearchParams.runId) : null;

  // Default date filter to the current year (not the current month, which made
  // runs from earlier months look deleted). The user can widen/narrow via the
  // date pickers.
  const currentYear = new Date().getFullYear();
  const defaultDateFrom = `${currentYear}-01-01`;
  const defaultDateTo = `${currentYear}-12-31`;
  const dateFrom = resolvedSearchParams.dateFrom ?? defaultDateFrom;
  const dateTo = resolvedSearchParams.dateTo ?? defaultDateTo;

  const [detailRaw, scoringRunsRaw, picksRaw, programTemplates, readinessConfig, gradeLevels, incumbentRaw] = await Promise.all([
    getPositionDetail(id),
    getScoringRunsForPosition(id, {
      program: resolvedSearchParams.program ?? null,
      dateFrom,
      dateTo,
    }),
    listPositionPicks(id),
    listProgramTemplates(),
    getReadinessConfig(),
    getGradeLevelsForTenant(await getCurrentTenantId()),
    getPositionIncumbentProfile(id),
  ]);
  // Demo mode: holder, successor and candidate names — rendered right here and
  // handed to the client below — leave the server as initials (no-op otherwise).
  const { detail, scoringRuns, picks, incumbent, requestedRun } = await demoScrub({
    detail: detailRaw,
    scoringRuns: scoringRunsRaw,
    picks: picksRaw,
    incumbent: incumbentRaw,
    requestedRun: requestedRunRaw,
  });
  if (!detail) {
    notFound();
  }
  const { position } = detail;
  // Run history can only hold position programs, so the filter offers only those
  // (Talent Pool never targets a position — see NON_POSITION_PROGRAM_CODES).
  const availablePrograms = positionProgramTemplates(programTemplates)
    .map((t) => t.code)
    .filter(Boolean) as string[];
  // Program code → display name (e.g. "emergency" → "Emergency Position")
  const programLabels = Object.fromEntries(
    programTemplates.filter((t) => t.code).map((t) => [t.code as string, t.name]),
  ) as Record<string, string>;
  const selectedRun =
    (requestedRun && requestedRun.positionId === id ? requestedRun : null) ??
    scoringRuns.find((run) => run.id === resolvedSearchParams.runId) ??
    scoringRuns[0] ??
    null;
  // The heavy per-run data (ranked dossiers) and tenant-wide candidate profiles
  // are loaded client-side by <PositionRunSection> so this server render stays
  // small/fast — a large run no longer risks an nginx ERR_CONNECTION_RESET.
  const scoringEnabled = isUuid(id);
  // Every sitting incumbent, not just the primary: none of them may be added to
  // their own successor list.
  // Incumbents as CANDIDATE IDS, resolved from the real NPKs on the server:
  // demo mode masks every NPK the client receives, so it cannot compare them.
  const incumbentCandidateIds = scoringEnabled ? await getIncumbentCandidateIds(id) : [];
  const excludeEmployeeIds = (
    position.holders?.length
      ? position.holders.map((h) => h.employeeId)
      : [position.currentHolder?.employeeId]
  ).filter((id): id is string => Boolean(id));

  const runs: RunSummary[] = scoringRuns.map((run) => ({
    id: run.id,
    positionId: run.positionId,
    method: run.method,
    program: run.program,
    label: run.label,
    status: run.status,
    candidateCount: run.candidateCount,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    filterSummary: run.filterSummary as RunSummary['filterSummary'],
    failure: run.failure,
  }));

  const selectedRunSummary: RunSummary | null = selectedRun
    ? {
        id: selectedRun.id,
        positionId: selectedRun.positionId,
        method: selectedRun.method,
        program: selectedRun.program,
        label: selectedRun.label,
        status: selectedRun.status,
        candidateCount: selectedRun.candidateCount,
        createdAt: selectedRun.createdAt.toISOString(),
        completedAt: selectedRun.completedAt?.toISOString() ?? null,
        filterSummary: selectedRun.filterSummary as RunSummary['filterSummary'],
        failure: selectedRun.failure,
      }
    : null;

  // The run the user deliberately opened, as opposed to the newest one this page
  // falls back to. `scoringRuns` is date/program filtered, so a run reached by
  // direct link may only exist in `selectedRun`.
  const runOnScreen = resolvedSearchParams.runId
    ? (scoringRuns.find((r) => r.id === resolvedSearchParams.runId) ??
      (selectedRun?.id === resolvedSearchParams.runId ? selectedRun : null))
    : null;

  const jobQualificationSlot = (
    <Card className="border-indigo-200/70 bg-linear-to-br from-indigo-500/6 via-card to-card dark:border-indigo-900/60 dark:from-indigo-500/10">
      <CardHeader className="border-b border-indigo-200/60 dark:border-indigo-900/50">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-1.5 text-base">
            Job qualification & aturan posisi
            <InfoHint title="Job qualification & aturan posisi">
              Digunakan untuk % match kandidat versus target role. Pendidikan, pengalaman, job family, dan kompetensi
              teknis diambil dari job profile yang ditautkan lewat &ldquo;Pilih dari Job Profile&rdquo;.
            </InfoHint>
          </CardTitle>
          <LinkJobProfileDialog
            positionId={id}
            currentEducation={position.qualifications.education === '-' ? null : position.qualifications.education}
            currentExperience={position.qualifications.experience === '-' ? null : position.qualifications.experience}
            currentJobFamily={position.qualifications.jobFamily === '-' ? null : position.qualifications.jobFamily}
            currentCompetencies={position.requiredCompetencies}
          />
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3 xl:grid-cols-3">
        <div className="rounded-xl border border-indigo-200/50 bg-white/60 p-4 dark:border-indigo-900/40 dark:bg-slate-950/40">
          <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Pendidikan</p>
          <p className="mt-1 text-sm text-muted-foreground">{position.qualifications.education}</p>
        </div>
        <div className="rounded-xl border border-emerald-200/50 bg-white/60 p-4 dark:border-emerald-900/40 dark:bg-slate-950/40">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Pengalaman</p>
          <p className="mt-1 text-sm text-muted-foreground">{position.qualifications.experience}</p>
        </div>
        <div className="rounded-xl border border-amber-200/50 bg-white/60 p-4 dark:border-amber-900/40 dark:bg-slate-950/40">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Job family</p>
          <p className="mt-1 text-sm text-muted-foreground">{position.qualifications.jobFamily}</p>
        </div>
      </CardContent>
      {position.requiredCompetencies && position.requiredCompetencies.length > 0 && (
        <div className="border-t border-indigo-200/60 dark:border-indigo-900/50 px-6 py-3">
          <p className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 mb-2">
            Kompetensi Teknis yang Dibutuhkan ({position.requiredCompetencies.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {position.requiredCompetencies.map((comp) => (
              <span
                key={comp.technicalId}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200/50 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300"
              >
                {comp.technicalName}
                {comp.targetProficiency && (
                  <span className="text-[10px] opacity-70 ml-0.5">({comp.targetProficiency})</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );

  return (
    <>
      {/* Opens (or re-focuses) the assessment thread for this position. Only an
          explicit ?runId= counts as "the run the user opened" — this page falls
          back to the newest run on its own, and recording that as a deliberate
          choice would put a run in the pill the user never asked for. */}
      <ScoringThreadAnchor
        positionId={id}
        positionLabel={position.title}
        meta={`${position.department} · ${position.division}`}
        viewingRunId={runOnScreen?.id}
        viewingRunLabel={
          runOnScreen
            ? compactRunLabel(runOnScreen.label, runOnScreen.createdAt.toISOString())
            : undefined
        }
        viewingRunMethod={runOnScreen?.method}
        viewingRunCandidateCount={runOnScreen?.candidateCount}
      />
      <DashboardHeader
        title={position.title}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
              <Target className="h-3 w-3" />
              {position.programName}
              <InfoHint size="xs" title="Program posisi">
                {POSITION_PROGRAM_HINT}
              </InfoHint>
            </span>
            <span>
              {position.department} · {position.division}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/positions">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Kembali
              </Link>
            </Button>
            {scoringEnabled && (
              <Button asChild size="sm">
                <Link href={`/scoring/new?positionId=${id}`}>
                  <PlayCircle className="mr-1 h-4 w-4" />
                  Mulai Scoring
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full space-y-6 p-6">
          {position.currentHolder && (
            <Card className="border-amber-500/30 bg-linear-to-r from-amber-500/5 via-card to-card py-4">
              <CardContent>
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      {(position.holders?.length ?? 0) > 1
                        ? `Pejabat saat ini (${position.holders!.length} orang, akan digantikan)`
                        : 'Pejabat saat ini (akan digantikan)'}
                    </p>
                    <p className="mt-1 text-lg font-semibold">{position.currentHolder.name}</p>
                    <p className="text-sm text-muted-foreground">{position.currentHolder.employeeId}</p>
                    {/* A non-unique role is held by several people at once; all of
                        them are excluded from this position's candidate pool. */}
                    {(position.holders?.length ?? 0) > 1 && (
                      <ul className="mt-2 space-y-0.5">
                        {position.holders!.slice(1).map((holder, idx) => (
                          <li key={`${holder.employeeId || holder.name}-${idx}`} className="text-sm text-muted-foreground">
                            {holder.name || '—'}
                            {holder.employeeId ? ` · ${holder.employeeId}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {selectedRun ? (
            <PositionRunSection
              positionId={id}
              positionTitle={position.title}
              position={position}
              positionDepartment={position.department ?? null}
              runs={runs}
              availablePrograms={availablePrograms}
              selectedRunId={selectedRun.id}
              selectedRun={selectedRunSummary}
              readinessCoverage={position.readinessCoverage}
              picks={picks}
              readinessConfig={readinessConfig}
              programLabels={programLabels}
              defaultProgram={resolvedSearchParams.program ?? ''}
              defaultDateFrom={dateFrom}
              defaultDateTo={dateTo}
              tenants={TENANTS.map((t) => ({ id: t.id, name: t.name }))}
              gradeLevels={gradeLevels.map((g) => ({ gradeId: g.gradeId, levelName: g.levelName }))}
              excludeEmployeeIds={excludeEmployeeIds}
              incumbentCandidateIds={incumbentCandidateIds}
              incumbent={incumbent}
              jobQualificationSlot={jobQualificationSlot}
              initialTab={resolvedSearchParams.tab ?? null}
              initialComparePair={{
                a: isUuid(resolvedSearchParams.a ?? '') ? resolvedSearchParams.a! : null,
                b: isUuid(resolvedSearchParams.b ?? '') ? resolvedSearchParams.b! : null,
              }}
            />
          ) : (
            <>
              <Card className="border-amber-200/70 bg-linear-to-br from-amber-500/8 via-card to-card dark:border-amber-900/60 dark:from-amber-500/12">
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  Belum ada scoring untuk posisi ini. Jalankan scoring terlebih dahulu agar data kandidat, core score, dan readiness muncul.
                </CardContent>
              </Card>
              {jobQualificationSlot}
            </>
          )}
        </div>
      </div>
    </>
  );
}
