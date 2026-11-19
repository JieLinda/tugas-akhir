/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH || '',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyClientMaxBodySize: '50mb',
  },
  output: 'standalone',
  // Menu consolidation kept the old URLs alive (bookmarks, chat links, docs).
  // These run before the filesystem routes and before the auth gate, carry the
  // incoming query string through unchanged, and are basePath-aware. 307, not
  // 308: browsers cache a permanent redirect and the IA may move again.
  //
  // "Profil Job" was split into two menus: Dokumen (/job-profiles, /match,
  // /kamus) and Posisi (/posisi/job-family). The old Job Family URLs land on
  // their new home in ONE hop, deep links (?runId=&topicId=&family=) included,
  // since the query is carried. Struktur Posisi was deleted (2026-11): its URL
  // and every legacy URL that led to it land on the Job Family map instead of
  // a 404, so old bookmarks and chat links still go somewhere in the same menu.
  async redirects() {
    return [
      { source: '/posisi', destination: '/posisi/job-family', permanent: false },
      { source: '/job-profiles/job-family', destination: '/posisi/job-family', permanent: false },
      {
        source: '/job-profiles/job-family/:path*',
        destination: '/posisi/job-family/:path*',
        permanent: false,
      },
      { source: '/posisi/struktur', destination: '/posisi/job-family', permanent: false },
      { source: '/job-profiles/struktur', destination: '/posisi/job-family', permanent: false },
      { source: '/kamus-kompetensi', destination: '/job-profiles/kamus', permanent: false },
      { source: '/family-configuration', destination: '/posisi/job-family', permanent: false },
      { source: '/family-tree', destination: '/posisi/job-family', permanent: false },
      { source: '/settings/roles', destination: '/settings/users?tab=roles', permanent: false },
      {
        source: '/job-profiles',
        has: [{ type: 'query', key: 'tab', value: 'match' }],
        destination: '/job-profiles/match',
        permanent: false,
      },
      {
        source: '/job-profiles',
        has: [{ type: 'query', key: 'tab', value: 'hierarchy' }],
        destination: '/posisi/job-family',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
