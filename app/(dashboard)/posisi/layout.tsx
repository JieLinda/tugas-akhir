import type { Metadata } from 'next';
import { requirePagePermission } from '@/lib/rbac';
import { PositionHubChrome } from '@/components/job-profiles/hub-chrome';

// The "Posisi" menu (Data Referensi): the Job Family map with its settings page.
// It used to be a section of the old "Profil Job" menu and keeps its permission —
// job_profiles.* is one RBAC bundle covering documents, job families and the
// dictionary. Struktur Posisi, its former second section, was deleted (2026-11);
// `/posisi`, `/posisi/struktur` and the old /job-profiles/job-family and
// /job-profiles/struktur URLs all redirect to the map (next.config.mjs).
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Posisi | PULSE Command Center',
  description: 'Peta job family.',
};

export default async function PositionHubLayout({ children }: { children: React.ReactNode }) {
  await requirePagePermission('job_profiles.view');

  // A fragment, not a wrapper div — see app/(dashboard)/job-profiles/layout.tsx.
  return (
    <>
      <PositionHubChrome />
      {children}
    </>
  );
}
