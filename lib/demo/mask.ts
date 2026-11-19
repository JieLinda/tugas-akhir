// Demo-mode masking of data that leaves the server — pure and client-safe.
//
// Demo mode shows no NPK, no position code, no competency code and no photo
// ANYWHERE. Where a whole family of screens is fed by one shape, the shape is
// masked at the server instead of at each screen, so a screen that is added
// later cannot leak by forgetting to call a helper. Identity never travels in
// these fields on the client (candidate uuids do that), so masking them breaks
// no selection or comparison — the profile's own NPK even falls back to a uuid
// prefix when the record has none, which is why nothing could rely on it.

import { MASKED_CODE, MASKED_NPK } from '@/lib/app-mode-shared';
import type { CandidateProfile } from '@/lib/talent-data';
import { parseJobProfileFileName } from '@/lib/job-family/match';

export function maskProfileForDemo(profile: CandidateProfile): CandidateProfile {
  const p = profile as CandidateProfile & {
    photoUrl?: string | null;
    raw?: Record<string, unknown> | null;
    positionHistory?: Array<Record<string, unknown>>;
    technicalCompetencies?: Array<{ technicalName: string; technicalId: string } & Record<string, unknown>>;
  };
  return {
    ...p,
    employeeId: MASKED_NPK,
    photoUrl: null,
    raw: p.raw ? { ...p.raw, employeeId: MASKED_NPK, photoUrl: null } : p.raw,
    // positionId is only ever shown as a title fallback and used as a list key.
    positionHistory: p.positionHistory?.map((h) => ({ ...h, positionId: MASKED_CODE })),
    // An unnamed competency used to print its kamus code instead.
    technicalCompetencies: p.technicalCompetencies?.map((tc) => ({
      ...tc,
      technicalName: tc.technicalName && tc.technicalName !== tc.technicalId ? tc.technicalName : MASKED_CODE,
    })),
  } as CandidateProfile;
}

/**
 * A job-profile file name as demo mode shows it. Files are named
 * "<position code> <JD number> <title>.pdf" (lib/job-family/match.ts), so the
 * code and the JD number are masked and the title kept — that is what tells a
 * reader which job it is. A name that does not follow the pattern is masked
 * whole, because there is no telling where a code sits in it.
 */
export function maskJobProfileFileName(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const { code, jdNumber, title } = parseJobProfileFileName(fileName);
  if (!title) return MASKED_CODE;
  return [code ? MASKED_CODE : null, jdNumber ? MASKED_CODE : null, title].filter(Boolean).join(' ');
}
