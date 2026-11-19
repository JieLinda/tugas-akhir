// Does the job family map still describe the corpus that is embedded now? Pure.
//
// Every reader of the map — the map page, the optimizer's diagnosis, scoring's
// career anchors — reads the last completed run. After a transformation
// (re-embed) that run describes documents or vectors that may no longer exist,
// and nothing about its numbers says so. A run records the corpus it clustered
// (`diagnostics.corpus.fingerprint`, written by topic-service); comparing that
// with the corpus now (lib/job-family/corpus.ts) answers the question exactly.
// Runs built before the fingerprint existed are judged from the document count
// and the last embed time, and say that they were.

import { formatDateTime } from '@/lib/datetime';

export type CorpusSnapshot = {
  fingerprint: string;
  documents: number;
  /** Newest `job_profile_embed.updated_at`, ISO; null when nothing is embedded. */
  lastEmbeddedAt: string | null;
};

export type RunCorpus = {
  /** null on runs built before topic-service recorded it. */
  fingerprint: string | null;
  documents: number;
  createdAt: string;
  completedAt: string | null;
};

export type FreshnessState = 'fresh' | 'stale' | 'unverifiable';

export function classifyFreshness(
  run: RunCorpus,
  corpus: CorpusSnapshot,
): { state: FreshnessState; reasons: string[] } {
  const reasons: string[] = [];
  if (run.documents !== corpus.documents) {
    reasons.push(`Peta dibangun dari ${run.documents} dokumen; yang ter-embed sekarang ${corpus.documents}.`);
  }

  if (run.fingerprint) {
    if (run.fingerprint === corpus.fingerprint) return { state: 'fresh', reasons: [] };
    if (reasons.length === 0) {
      reasons.push(
        `Isi atau vektor dokumen berubah sejak peta dibangun (jumlahnya tetap ${corpus.documents}).`,
      );
    }
    return { state: 'stale', reasons };
  }

  const builtAt = run.completedAt ?? run.createdAt;
  if (corpus.lastEmbeddedAt && Date.parse(corpus.lastEmbeddedAt) > Date.parse(builtAt)) {
    reasons.push(
      `Ada dokumen yang ditransformasi ulang sesudah peta dibangun (terakhir ${formatDateTime(corpus.lastEmbeddedAt)}).`,
    );
  }
  if (reasons.length > 0) return { state: 'stale', reasons };
  return {
    state: 'unverifiable',
    reasons: [
      'Peta ini dibangun sebelum sidik korpus dicatat. Jumlah dokumennya sama dan tidak ada yang ' +
        'ditransformasi ulang sesudahnya, jadi kemungkinan besar masih sesuai — bangun ulang sekali ' +
        'agar dapat dipastikan.',
    ],
  };
}
