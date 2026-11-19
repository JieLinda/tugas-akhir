'use client';

// 5-Box names, colours and blurbs for the HAV 16-quadrant rollup on Beranda and
// for the Talent Mapping 16-box (components/talent-mapping/*).
//
// Read by components/dashboard-page-client.tsx and the Talent Mapping page,
// paired with `talentBoxFromQuadrant` in lib/hav-quadrant-derive.ts, which
// derives the box from PA × behavioural competency. One palette for both, so a
// box reads the same colour on Beranda as on the map. See docs/hav-16-kuadran.md
// and docs/talent-mapping.md.
//
// This lived at components/talent/box-meta.ts until the Talent Matrix 5-Box
// prototype was deleted from main. That feature and this rollup are two
// different readings that happen to share five names and a palette — the rollup
// never touched talent_data_staging, so only the "see more" link to /talent was
// downstream of it. Moved here so components/talent/ could be deleted without
// taking the dashboard panel with it. `boxForLevels()`, which mapped numeric
// perf/potential LEVELS to a box, went with the branch: it was Talent-Matrix-only.
// Talent Matrix: branch `parked/talent-5box`, docs/talent-5box-parked.md.

import type { TalentBox } from '@/lib/db/schema';

export const BOX_META: Record<
  TalentBox | 'NONE',
  { label: string; blurb: string; cell: string; chip: string; border: string; ring: string; dot: string }
> = {
  TOP: {
    label: 'TOP',
    blurb: 'Kinerja & potensi tinggi — siap promosi/suksesi',
    cell: 'bg-emerald-500/10',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    border: 'border-emerald-500/40',
    ring: 'ring-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  STRONG: {
    label: 'STRONG',
    blurb: 'Satu sumbu tinggi, satu sedang — kandidat pengembangan',
    cell: 'bg-teal-500/10',
    chip: 'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
    border: 'border-teal-500/40',
    ring: 'ring-teal-500/40',
    dot: 'bg-teal-500',
  },
  SOLID: {
    label: 'SOLID',
    blurb: 'Kinerja & potensi sedang — tulang punggung organisasi',
    cell: 'bg-amber-500/10',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    border: 'border-amber-500/40',
    ring: 'ring-amber-500/40',
    dot: 'bg-amber-500',
  },
  BORDER: {
    label: 'BORDER',
    blurb: 'Satu sumbu rendah — perlu intervensi pengembangan',
    cell: 'bg-orange-500/10',
    chip: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
    border: 'border-orange-500/40',
    ring: 'ring-orange-500/40',
    dot: 'bg-orange-500',
  },
  BOTTOM: {
    label: 'BOTTOM',
    blurb: 'Kinerja & potensi rendah — butuh pembinaan',
    cell: 'bg-rose-500/10',
    chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
    border: 'border-rose-500/40',
    ring: 'ring-rose-500/40',
    dot: 'bg-rose-500',
  },
  NONE: {
    label: 'N/A',
    blurb: 'Belum ada data (skor tidak dapat dihitung)',
    cell: 'bg-muted/40',
    chip: 'bg-muted text-muted-foreground border-border',
    border: 'border-border',
    ring: 'ring-muted-foreground/40',
    dot: 'bg-muted-foreground',
  },
};
