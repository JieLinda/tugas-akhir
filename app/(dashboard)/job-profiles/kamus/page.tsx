import { KamusPageClient } from '@/components/kamus-page-client';

export const metadata = {
  title: 'Kamus Kompetensi | PULSE Command Center',
  description: 'Kamus kompetensi teknis MPM — definisi dan 4 level proficiency per kompetensi.',
};

// Section "Kamus Kompetensi" of the Dokumen menu (gate + header in
// ../layout.tsx). Data is fetched client-side by KamusPageClient (see
// lib/kamus-actions.ts) so this page renders instantly instead of streaming
// ~90 records × 4 level paragraphs through SSR.
export default function KamusKompetensiPage() {
  return <KamusPageClient />;
}
