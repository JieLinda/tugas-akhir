import { getJobProfilesAction } from '@/lib/job-profile-actions';
import { listTenants } from '@/lib/tenant';
import {
  JobProfileDocumentsClient,
  type JobProfileRow,
} from '@/components/job-profiles/job-profile-documents-client';

export const metadata = {
  title: 'Job Profile | PULSE Command Center',
  description: 'Daftar dokumen Job Profile hasil ekstraksi AI OCR Vision.',
};

// Section "Dokumen Job Profile" of the Dokumen menu. Permission gate, header and
// the section strip live in ./layout.tsx. The legacy `?tab=match|hierarchy` deep
// links are redirected by next.config.mjs (`hierarchy` to the Job Family map,
// since Struktur Posisi was deleted), so this page no longer reads searchParams.
export default async function JobProfilesRoute() {
  const rawProfiles = await getJobProfilesAction();

  // Map to enforce typed structures suitable for Client components
  const profiles: JobProfileRow[] = rawProfiles.map((p) => ({
    id: p.id,
    fileName: p.fileName,
    filePath: p.filePath,
    sourceFolder: p.sourceFolder,
    fileHash: p.fileHash,
    jobProfileNumber: p.jobProfileNumber,
    positionName: p.positionName,
    divisionDepartment: p.divisionDepartment,
    supervisor: p.supervisor,
    jobPurpose: p.jobPurpose,
    extractedData: p.extractedData,
    // raw_text is intentionally not loaded (huge OCR dump, never rendered)
    rawText: null,
    status: p.status,
    errorMessage: p.errorMessage,
    syncedAt: p.syncedAt, // serialized safe Date / timestamps by next-server automatically
    processedAt: p.processedAt,
    queuedAt: p.queuedAt,
    unmapped: p.unmapped,
    tenantIds: p.tenantIds,
  }));

  return (
    <JobProfileDocumentsClient
      initialProfiles={profiles}
      tenants={(await listTenants()).map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
