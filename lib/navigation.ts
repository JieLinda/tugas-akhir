import type { Permission } from '@/lib/rbac';

/**
 * The single source of truth for the app's menus.
 *
 * Three places used to write route labels independently — the sidebar's
 * `navSections`, `DETOUR_LABELS` in lib/activity-thread.ts and each page's
 * `DashboardHeader title=` — and they had drifted ("Job Family" /
 * "Konfigurasi Job Family" / "Peta" for one feature). Anything that needs the
 * label, href or permission of a top-level route reads it from here; the
 * sidebar only adds icons on top.
 *
 * Client-safe on purpose: no `server-only`, and the only rbac dependency is the
 * erased `Permission` type, so `components/sidebar-nav.tsx` ('use client') and
 * server layouts can both import it.
 */

export type NavItem = {
  href: string;
  label: string;
  /** RBAC permission that reveals the entry; `null` = every signed-in user. */
  permission: Permission | null;
  /** Override the default active rule (exact match, or a path-segment prefix). */
  match?: (pathname: string) => boolean;
};

export type NavGroup = {
  id: 'workflow' | 'reference' | 'admin';
  label: string;
  items: readonly NavItem[];
};

/** One section of a hub page: the strip label plus the header it puts up. */
export type HubSection = {
  href: string;
  label: string;
  title: string;
  /** What the section is for — rendered behind the header's "?" hint, never as a paragraph. */
  description: string;
  /** The hub root: active only on the exact path, or it would shadow siblings. */
  exact?: boolean;
  /**
   * A sub-page of another section: owns its header title and route label but
   * gets no pill in the strip — the strip highlights the nearest visible
   * ancestor instead. This is how a section keeps a settings page without
   * growing the menu.
   */
  hidden?: boolean;
};

/** The two highlighted entries above the grouped menu. */
export const SCORING_CTA: NavItem = {
  href: '/scoring/new',
  label: 'Mulai Scoring',
  permission: 'scoring.run',
};

export const TALENT_POOL_CTA: NavItem = {
  href: '/talent-pool',
  label: 'Talent Pool',
  permission: 'candidates.view',
};

/**
 * Talent Pool menu — the pool, then its continuation, the HAV 16-box map of the
 * same candidates. One sidebar entry (the CTA above, whose prefix match keeps it
 * lit on both), two sections rendered as a strip under each page's own header:
 * unlike the Dokumen and Posisi hubs, the pages keep their DashboardHeader
 * because each carries its own header actions (the data-mask toggle).
 */
export const TALENT_POOL_HUB: { root: string; sections: readonly HubSection[] } = {
  root: '/talent-pool',
  sections: [
    {
      href: '/talent-pool',
      label: 'Talent Pool',
      title: 'Talent Pool',
      description:
        'Gambaran terima/tolak kandidat aktif atas aturan filter lengkap program Talent Pool — aturan bisa diubah, dihapus, atau dinonaktifkan.',
      exact: true,
    },
    {
      href: '/talent-pool/mapping',
      label: 'Talent Mapping',
      title: 'Talent Mapping',
      description:
        'Peta 16-box HAV semua kandidat yang lolos aturan Disiplin Talent Pool — HAV dari upload, rumus PA × BA, atau penempatan manual berjustifikasi; yang terbaru menang.',
    },
  ],
};

/**
 * Grouped by cadence, not by data model: the first group is the daily HR loop
 * (position → scoring → review → pick), the second is data that scoring reads
 * but people rarely edit, the third is administration. The `hr` role sees the
 * first two groups whole and none of the third.
 *
 * Two entries used to exist and are deliberately absent: Agent Studio
 * (/studio) and Talent Matrix 5-Box (/talent). Both were throwaway prototypes,
 * deleted from main and kept on branches `parked/agent-studio` and
 * `parked/talent-5box` — see docs/agent-studio-parked.md and
 * docs/talent-5box-parked.md before re-adding either.
 *
 * Talent Mapping (the HAV 16-box, /talent-pool/mapping) is not a menu row
 * either: it is the second section of the Talent Pool entry, TALENT_POOL_HUB.
 */
export const SIDEBAR_GROUPS: readonly NavGroup[] = [
  {
    id: 'workflow',
    label: 'Alur Kerja',
    items: [
      { href: '/', label: 'Beranda', permission: null },
      { href: '/positions', label: 'Mesin Penilaian', permission: 'positions.view' },
      
    ],
  },
  {
    id: 'reference',
    label: 'Data Referensi',
    // Kandidat (the succession pool's records), then two menus over ONE
    // permission bundle (job_profiles.*): the documents
    // themselves, then what is built from them — how positions group into job
    // families and how they hang together in the org structure. Dokumen comes
    // first because it is the input: the Job Family map is clustered from the
    // job profiles extracted there.
    items: [
      { href: '/candidates', label: 'Kandidat', permission: 'candidates.view' },
      { href: '/job-profiles', label: 'Dokumen', permission: 'job_profiles.view' },
      { href: '/posisi', label: 'Posisi', permission: 'job_profiles.view' },
    ],
  },
  {
    id: 'admin',
    label: 'Administrasi',
    items: [
      { href: '/governance', label: 'Tata Kelola', permission: 'governance.manage' },
      { href: '/settings/sync', label: 'Tambah Data', permission: 'sync.manage' },
      // { href: '/settings/users', label: 'Pengguna & Akses', permission: 'users.manage' },
    ],
  },
];

export type Hub = { root: string; sections: readonly HubSection[] };

/**
 * Dokumen — the job-profile documents and the two things read straight off
 * them: which position each document belongs to (Job Profile Match) and the
 * competency dictionary the documents cite (Kamus Kompetensi). One sidebar
 * entry, three sections, each its own route with its own server-side data
 * loading.
 *
 * This menu used to be "Profil Job" with five sections; Job Family (and the
 * since-deleted Struktur Posisi) moved to their own menu, POSITION_HUB below. Legacy URLs
 * (`/kamus-kompetensi`, `/family-configuration`, `/family-tree`,
 * `/job-profiles/job-family`, `/job-profiles/struktur`, `/job-profiles?tab=…`)
 * are redirected by `redirects()` in next.config.mjs.
 */
export const JOB_PROFILES_HUB: Hub = {
  root: '/job-profiles',
  sections: [
    {
      href: '/job-profiles',
      label: 'Dokumen Job Profile',
      title: 'Dokumen Job Profile',
      description:
        'Katalog profil jabatan (job description) hasil sinkronisasi dokumen PDF yang dibaca AI (OCR Vision): telusuri isi tiap dokumen, periksa hasil ekstraksinya, dan tetapkan unit bisnis pemiliknya.',
      exact: true,
    },
    {
      href: '/job-profiles/match',
      label: 'Job Profile Match',
      title: 'Job Profile Match',
      description:
        'Cocokkan posisi aktif kandidat dengan job profile berdasarkan kode nama file, nama posisi, kemiripan embedding, dan AI — untuk menemukan celah cakupan job profile. Pemetaan yang disimpan di sini dipakai fitur lain (saran job profile posisi, peta Job Family, penilaian karier).',
    },
    {
      href: '/job-profiles/kamus',
      label: 'Kamus Kompetensi',
      title: 'Kamus Kompetensi Teknis',
      description:
        'Kamus kompetensi teknis (TC) hasil sinkronisasi PDF — definisi dan tuntutan tiap level proficiency. Nama kompetensi di job profile dan data HR dicocokkan ke kode kamus ini sebelum dinilai.',
    },
  ],
};

/**
 * Posisi — how positions group into job families, clustered from the job
 * profiles in Dokumen. ONE visible section: the Job Family map, plus its
 * hidden settings page. It used to have a second, Struktur Posisi (the synced
 * org chart), which was deleted (2026-11, by request); with a single visible
 * section the hub renders no section strip (hub-chrome.tsx). `/posisi`, the old
 * `/posisi/struktur` and its legacy URLs redirect to the map (next.config.mjs),
 * so the sidebar entry's prefix match keeps it lit, the settings page included.
 */
export const POSITION_HUB: Hub = {
  root: '/posisi',
  sections: [
    {
      href: '/posisi/job-family',
      label: 'Job Family',
      title: 'Peta Job Family',
      description:
        'Pengelompokan job profile menjadi rumpun jabatan (job family) hasil clustering BERTopic — bangun peta, telusuri anggota tiap family, dan tinjau outlier. Dibangun dari dokumen di menu Dokumen.',
    },
    {
      href: '/posisi/job-family/pengaturan',
      label: 'Pengaturan Job Family',
      title: 'Pengaturan Job Family',
      description:
        'Template restrukturisasi dokumen dan parameter pipeline BERTopic yang dipakai saat peta job family dibangun ulang. Halaman ini mengubah pengaturan, bukan petanya — peta berubah setelah dibangun ulang dari halaman Peta Job Family. Berlaku global untuk semua Company.',
      hidden: true,
    },
  ],
};

function pathMatches(href: string, pathname: string, exact = false): boolean {
  if (href === '/' || exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.match ? item.match(pathname) : pathMatches(item.href, pathname);
}

/** The section owning `pathname` — longest prefix wins, so a hidden sub-page beats its parent. */
export function activeHubSection(pathname: string, hub: Hub = JOB_PROFILES_HUB): HubSection | undefined {
  let best: HubSection | undefined;
  for (const s of hub.sections) {
    if (!pathMatches(s.href, pathname, s.exact)) continue;
    if (!best || s.href.length > best.href.length) best = s;
  }
  return best;
}

/** Whether a strip pill lights up for `pathname`: its own path, or a hidden sub-page under it. */
export function isHubSectionActive(
  section: HubSection,
  pathname: string,
  hub: Hub = JOB_PROFILES_HUB,
): boolean {
  const active = activeHubSection(pathname, hub);
  if (!active) return false;
  if (active.href === section.href) return true;
  return active.hidden === true && !section.exact && pathMatches(section.href, active.href);
}

/**
 * Human label for a route, longest matching prefix wins. Sidebar entries are
 * consulted before hub sections so a tie on the hub root resolves to the menu
 * name ("Dokumen") rather than the section name ("Dokumen Job Profile"). `null`
 * when nothing in the registry owns the path.
 */
export function routeLabel(pathname: string): string | null {
  if (pathname === '/') return 'Beranda';
  const candidates: ReadonlyArray<{ href: string; label: string }> = [
    ...SIDEBAR_GROUPS.flatMap((g) => g.items),
    SCORING_CTA,
    TALENT_POOL_CTA,
    ...TALENT_POOL_HUB.sections,
    ...JOB_PROFILES_HUB.sections,
    ...POSITION_HUB.sections,
  ];
  let best: { href: string; label: string } | null = null;
  for (const c of candidates) {
    if (c.href === '/') continue;
    if (!pathMatches(c.href, pathname)) continue;
    if (!best || c.href.length > best.href.length) best = c;
  }
  return best?.label ?? null;
}
