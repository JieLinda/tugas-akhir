'use server';

import { revalidatePath } from 'next/cache';
import { getCandidateProfilesPage, getPositionManagementPage, parseCandidateSuccessorFilter, parsePositionBench, parsePositionFlag, parseReadinessBand, type CandidateSuccessorSeat, type PositionBenchCounts, type PositionFlagCounts } from '@/lib/pulse-data';
import type { CandidateProfile } from '@/lib/talent-data';
import type { PositionSummary } from '@/lib/talent-data';
import { requirePermission } from '@/lib/rbac';
import { demoScrub } from '@/lib/demo/names';

export async function refreshDashboardAction() {
  revalidatePath('/');
  revalidatePath('/candidates');
  revalidatePath('/positions');
}

// Demo mode: candidate names leave the server as initials (no-op otherwise).
export async function getFilteredCandidatesAction(
  ...args: Parameters<typeof getFilteredCandidatesActionImpl>
): ReturnType<typeof getFilteredCandidatesActionImpl> {
  return demoScrub(await getFilteredCandidatesActionImpl(...args));
}

async function getFilteredCandidatesActionImpl(formData: FormData): Promise<{
  candidates: CandidateProfile[];
  total: number;
  page: number;
  pageSize: number;
  successorSeats: Record<string, CandidateSuccessorSeat[]>;
}> {
  await requirePermission('candidates.view');
  const page = parseInt(formData.get('page') as string) || 1;
  const pageSize = parseInt(formData.get('pageSize') as string) || 8;
  const query = (formData.get('query') as string) || '';
  const sortBy = (formData.get('sortBy') as 'name' | 'department') || 'name';
  const department = (formData.get('department') as string) || '';
  const division = (formData.get('division') as string) || '';
  const level = (formData.get('level') as string) || '';
  const successor = parseCandidateSuccessorFilter(formData.get('successor'));

  // Demo mode only (ignored in real mode): list only ON or only OFF candidates.
  const demoStateRaw = formData.get('demoState');
  const demoState = demoStateRaw === 'on' || demoStateRaw === 'off' ? demoStateRaw : null;

  const result = await getCandidateProfilesPage(page, pageSize, query, sortBy, department, division, level, successor, demoState);
  return { ...result, page, pageSize };
}

// Demo mode: holder and successor names leave the server as initials.
export async function getFilteredPositionsAction(
  ...args: Parameters<typeof getFilteredPositionsActionImpl>
): ReturnType<typeof getFilteredPositionsActionImpl> {
  return demoScrub(await getFilteredPositionsActionImpl(...args));
}

async function getFilteredPositionsActionImpl(formData: FormData): Promise<{
  positions: PositionSummary[];
  total: number;
  page: number;
  pageSize: number;
  flagCounts: PositionFlagCounts;
  benchCounts: PositionBenchCounts;
}> {
  await requirePermission('positions.view');
  const page = parseInt(formData.get('page') as string) || 1;
  const pageSize = parseInt(formData.get('pageSize') as string) || 20;
  const query = (formData.get('query') as string) || '';
  const department = (formData.get('department') as string) || '';
  const division = (formData.get('division') as string) || '';
  const program = (formData.get('program') as string) || '';
  // Bench overview + dashboard drill-downs (/positions?bench=…, ?readiness=ready, ?band=…).
  const bench = parsePositionBench(formData.get('bench') ?? formData.get('readiness'));
  const band = parseReadinessBand(formData.get('band'));
  // Summary-line drill-down (no_jd / retiring / awaiting_pick).
  const flag = parsePositionFlag(formData.get('flag'));

  const result = await getPositionManagementPage(
    page,
    pageSize,
    query,
    department,
    division,
    program,
    bench,
    band,
    flag,
  );
  return { ...result, page, pageSize };
}
