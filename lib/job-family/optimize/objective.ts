// Reasoning core of the Job Family → Pengaturan optimizer panel:
// components/job-family/optimizer-panel.tsx → lib/job-family-optimize-actions.ts
// → here. Deterministic, no LLM.
//
// This lived at lib/agent/optimize/ until Agent Studio was deleted from main.
// The optimizer reasoning was first written as agent tooling, and three of the
// four files there turned out to be load-bearing for a live feature; they were
// moved so lib/agent/ could be deleted without taking the panel with it. The
// fourth, `ahp.ts`, was genuinely studio-only and went with the branch.
// Agent Studio: branch `parked/agent-studio`, docs/agent-studio-parked.md.

/**
 * Objective terukur untuk optimasi clustering job family (modul M10).
 *
 * Modul murni — tanpa DB, tanpa LLM — karena inilah bagian yang TIDAK boleh
 * diserahkan ke model: evaluasi Fase 0 dan Fase 3 sama-sama menunjukkan planner
 * tidak konsisten menalar "outlier tinggi → parameter mana yang digeser".
 * Penilaian baik/buruk sebuah hasil harus berupa angka yang dihitung, bukan
 * kesan yang dikarang.
 *
 * Aturan pelaporan yang ditegakkan di sini (dokumen rencana §M10): optimizer
 * wajib melaporkan APA YANG MEMBURUK, bukan hanya yang membaik. "Outlier turun
 * 31%→12%" yang menyembunyikan "jumlah famili 24→7" adalah laporan menyesatkan
 * — karena itu `compareToBaseline` mengembalikan regresi sebagai data kelas
 * satu, dan pemanggil meneruskannya sampai ke kartu jawaban.
 */

/**
 * Bentuk hasil yang diinginkan user, dinyatakan sebagai sasaran terukur.
 *
 * Daftarnya sengaja lebih panjang daripada jumlah "tuas" yang tersedia, karena
 * yang dipilah di sini adalah MAKSUD, bukan mekanisme. "Perbesar cluster" dan
 * "kurangi jumlah famili" bergerak ke arah yang mirip tetapi bukan hal yang
 * sama — yang pertama peduli pada ukuran anggota, yang kedua pada banyaknya
 * kelompok — dan menggabungkannya memaksa satu di antaranya dijawab dengan
 * parameter yang salah. Sasaran yang salah tidak pernah terlihat sebagai
 * kesalahan; ia hanya menghasilkan peta yang "kurang pas" tanpa sebab yang
 * dapat ditunjuk.
 */
export type OptimizeGoal =
  /** Outlier lebih sedikit, tanpa syarat khusus. */
  | 'reduce_outliers'
  /** Tidak ada outlier sama sekali — setiap jabatan wajib punya rumpun. */
  | 'no_outliers'
  /** Hanya jabatan yang benar-benar tidak berhubungan yang boleh jadi outlier. */
  | 'strict_outliers'
  /** Lebih banyak job family. */
  | 'more_topics'
  /** Lebih sedikit job family. */
  | 'fewer_topics'
  /** Anggota tiap job family lebih banyak. */
  | 'bigger_clusters'
  /** Anggota tiap job family lebih sedikit dan lebih homogen. */
  | 'smaller_clusters'
  /** Pecah satu famili raksasa yang menelan sebagian besar korpus. */
  | 'split_dominant'
  /** Hilangkan famili beranggota 1–2 jabatan. */
  | 'remove_tiny'
  /** Ratakan ukuran antar famili. */
  | 'balance_sizes'
  /** Perbaiki kata kunci & nama famili (tidak mengubah keanggotaan). */
  | 'cleaner_labels'
  /** Rapikan secara umum. */
  | 'balance';

/** Sasaran yang tidak mengubah keanggotaan dokumen, hanya penamaannya. */
export const LABEL_ONLY_GOALS: ReadonlySet<OptimizeGoal> = new Set<OptimizeGoal>(['cleaner_labels']);

/**
 * Seluruh sasaran, sebagai nilai runtime.
 *
 * Satu daftar, dipakai manifest tool (untuk mencetak pilihannya ke prompt) dan
 * handler (untuk memeriksa masukan). Sebelumnya keduanya mengetik ulang daftar
 * yang sama, dan yang terjadi adalah sasaran baru dikenali manifest tetapi
 * ditolak diam-diam oleh handler — permintaan diterima, hasilnya sasaran lain.
 */
export const OPTIMIZE_GOALS = [
  'reduce_outliers',
  'no_outliers',
  'strict_outliers',
  'more_topics',
  'fewer_topics',
  'bigger_clusters',
  'smaller_clusters',
  'split_dominant',
  'remove_tiny',
  'balance_sizes',
  'cleaner_labels',
  'balance',
] as const satisfies readonly OptimizeGoal[];

/** Ukuran hasil satu run clustering, dihitung dari topik + penugasannya. */
export type TopicMetrics = {
  topicCount: number;
  /** Persen dokumen bertopik -1 (tidak masuk famili mana pun), 0–100. */
  outlierPct: number;
  numDocuments: number;
  /** Ukuran tiap topik (jumlah dokumen), tanpa topik -1. */
  sizes: number[];
};

export type ObjectiveContext = {
  goal: OptimizeGoal;
  /** Jumlah famili yang diinginkan user, bila disebut. */
  targetTopicCount?: number | null;
  /**
   * Ambang kemiripan untuk sasaran `strict_outliers`, dihitung dari sebaran
   * nyata run terakhir (`diagnose.suggestOutlierThreshold`) — bukan konstanta.
   * Korpus yang berbeda memisahkan diri pada nilai yang berbeda, dan angka
   * bawaan yang kebetulan cocok pada satu korpus akan salah pada korpus lain
   * tanpa memberi tanda apa pun.
   */
  outlierThreshold?: number | null;
};

/**
 * Skor 0–100, lebih tinggi lebih baik. Transparan dan monoton per komponen —
 * bukan model, supaya setiap angka pada laporan bisa dijelaskan dari rumusnya.
 */
export function scoreMetrics(m: TopicMetrics, ctx: ObjectiveContext): number {
  // ── Komponen ──
  // outlier: 0% → 1, ≥60% → 0. Di semua goal, outlier banyak itu buruk.
  const outlierScore = clamp01(1 - m.outlierPct / 60);

  // topicCount: kedekatan ke sasaran. Tanpa target eksplisit, rentang "sehat"
  // ditaksir dari ukuran korpus: ~1 famili per 12 dokumen, dibatasi 6..40.
  const target =
    ctx.targetTopicCount ?? Math.min(40, Math.max(6, Math.round(m.numDocuments / 12)));
  const countScore = m.topicCount <= 0 ? 0 : clamp01(1 - Math.abs(m.topicCount - target) / target);

  // fragmentasi: porsi famili beranggota < 3 — famili dua dokumen jarang berarti.
  const tiny = m.sizes.filter((s) => s < 3).length;
  const fragScore = m.sizes.length === 0 ? 0 : clamp01(1 - tiny / m.sizes.length);

  // dominasi: satu famili menelan korpus = pengelompokan gagal diam-diam.
  const largest = m.sizes.length ? Math.max(...m.sizes) : 0;
  const clustered = m.sizes.reduce((a, b) => a + b, 0);
  const domScore = clustered === 0 ? 0 : clamp01(1 - Math.max(0, largest / clustered - 0.3) / 0.7);

  // ── Bobot per goal ──
  //
  // Tiap sasaran memberi bobot terbesar pada ukuran yang MEMANG ia perjuangkan,
  // tetapi tidak pernah menolkan yang lain — itulah yang membuat sebuah
  // "perbaikan" tetap dapat kalah ketika ia merusak sisi lain. Sasaran yang
  // hanya memberi bobot pada satu ukuran akan selalu menemukan pemenang, dan
  // pemenang yang selalu ada bukan hasil optimasi, melainkan hasil pengukuran
  // yang tidak jujur.
  const base = WEIGHTS_BY_GOAL[ctx.goal] ?? WEIGHTS_BY_GOAL.balance;
  // Angka yang DISEBUT user menang atas bawaan sasarannya. Tanpa ini,
  // "kurangi outlier, jadikan sekitar 15 famili" akan menilai kandidat nyaris
  // hanya dari outliernya dan memilih hasil ber-40 famili — memenuhi kalimat
  // pertama sambil mengabaikan kalimat kedua.
  const w = ctx.targetTopicCount ? emphasizeCount(base) : base;

  return (
    Math.round(
      (outlierScore * w.outlier + countScore * w.count + fragScore * w.frag + domScore * w.dom) *
        1000,
    ) / 10
  );
}

type ScoreWeights = { outlier: number; count: number; frag: number; dom: number };

/** Naikkan bobot jumlah famili ke minimal 0,45, sisanya diskalakan proporsional. */
function emphasizeCount(w: ScoreWeights): ScoreWeights {
  const FLOOR = 0.45;
  if (w.count >= FLOOR) return w;
  const rest = 1 - FLOOR;
  const otherSum = w.outlier + w.frag + w.dom;
  if (otherSum <= 0) return { outlier: 0, count: 1, frag: 0, dom: 0 };
  const k = rest / otherSum;
  return { outlier: w.outlier * k, count: FLOOR, frag: w.frag * k, dom: w.dom * k };
}

const WEIGHTS_BY_GOAL: Record<OptimizeGoal, ScoreWeights> = {
  // Outlier adalah pokoknya; sisanya penjaga agar penurunan outlier tidak
  // dibayar dengan satu famili raksasa.
  reduce_outliers: { outlier: 0.5, count: 0.2, frag: 0.15, dom: 0.15 },
  // Menuntut nol outlier paling mudah dicapai dengan meleburkan segalanya,
  // jadi dominasi ditimbang lebih berat daripada pada reduce_outliers.
  no_outliers: { outlier: 0.55, count: 0.15, frag: 0.1, dom: 0.2 },
  // Sisa outlier di sini DIHARAPKAN ada, jadi bobotnya justru diturunkan:
  // yang dinilai adalah mutu famili yang terbentuk, bukan seberapa kosong
  // keranjang outliernya.
  strict_outliers: { outlier: 0.3, count: 0.3, frag: 0.2, dom: 0.2 },
  more_topics: { outlier: 0.25, count: 0.45, frag: 0.15, dom: 0.15 },
  fewer_topics: { outlier: 0.25, count: 0.45, frag: 0.15, dom: 0.15 },
  // "Lebih besar" gagal bila caranya adalah membuat satu famili menelan
  // semuanya — karena itu dominasi ditimbang setara dengan jumlah famili.
  bigger_clusters: { outlier: 0.25, count: 0.35, frag: 0.15, dom: 0.25 },
  // "Lebih halus" gagal bila hasilnya remah-remah dua dokumen.
  smaller_clusters: { outlier: 0.2, count: 0.35, frag: 0.3, dom: 0.15 },
  split_dominant: { outlier: 0.2, count: 0.2, frag: 0.15, dom: 0.45 },
  remove_tiny: { outlier: 0.2, count: 0.2, frag: 0.45, dom: 0.15 },
  balance_sizes: { outlier: 0.2, count: 0.2, frag: 0.3, dom: 0.3 },
  // Keanggotaan tidak berubah, jadi keempat ukuran hanya berperan sebagai
  // penjaga: yang harus terjadi adalah TIDAK ADA yang bergeser.
  cleaner_labels: { outlier: 0.25, count: 0.25, frag: 0.25, dom: 0.25 },
  balance: { outlier: 0.35, count: 0.3, frag: 0.175, dom: 0.175 },
};

export type MetricDelta = {
  metric: string;
  from: string;
  to: string;
  direction: 'better' | 'worse' | 'same';
};

/**
 * Bandingkan kandidat terhadap baseline pada SEMUA ukuran — bukan hanya yang
 * dioptimalkan. `worse` di sinilah yang membedakan laporan jujur dari laporan
 * penjualan.
 */
export function compareToBaseline(
  baseline: TopicMetrics,
  candidate: TopicMetrics,
  ctx: ObjectiveContext,
): MetricDelta[] {
  const deltas: MetricDelta[] = [];

  deltas.push(
    delta(
      'Outlier',
      `${baseline.outlierPct}%`,
      `${candidate.outlierPct}%`,
      // Turun = membaik; toleransi 0,5 poin supaya derau tidak dilaporkan.
      sign(baseline.outlierPct - candidate.outlierPct, 0.5),
    ),
  );

  const target =
    ctx.targetTopicCount ?? Math.min(40, Math.max(6, Math.round(baseline.numDocuments / 12)));
  const baseDist = Math.abs(baseline.topicCount - target);
  const candDist = Math.abs(candidate.topicCount - target);
  deltas.push(
    delta(
      'Jumlah famili',
      `${baseline.topicCount}`,
      `${candidate.topicCount}`,
      sign(baseDist - candDist, 0),
    ),
  );

  const tinyShare = (m: TopicMetrics) =>
    m.sizes.length === 0 ? 1 : m.sizes.filter((s) => s < 3).length / m.sizes.length;
  deltas.push(
    delta(
      'Famili kekecilan (<3 dokumen)',
      `${Math.round(tinyShare(baseline) * 100)}%`,
      `${Math.round(tinyShare(candidate) * 100)}%`,
      sign(tinyShare(baseline) - tinyShare(candidate), 0.02),
    ),
  );

  const domShare = (m: TopicMetrics) => {
    const clustered = m.sizes.reduce((a, b) => a + b, 0);
    return clustered === 0 ? 1 : Math.max(...m.sizes, 0) / clustered;
  };
  deltas.push(
    delta(
      'Dominasi famili terbesar',
      `${Math.round(domShare(baseline) * 100)}%`,
      `${Math.round(domShare(candidate) * 100)}%`,
      sign(domShare(baseline) - domShare(candidate), 0.02),
    ),
  );

  return deltas;
}

export function regressionsOf(deltas: MetricDelta[]): string[] {
  return deltas
    .filter((d) => d.direction === 'worse')
    .map((d) => `${d.metric} memburuk: ${d.from} → ${d.to}`);
}

function delta(
  metric: string,
  from: string,
  to: string,
  direction: MetricDelta['direction'],
): MetricDelta {
  return { metric, from, to, direction };
}

function sign(improvement: number, tolerance: number): MetricDelta['direction'] {
  if (improvement > tolerance) return 'better';
  if (improvement < -tolerance) return 'worse';
  return 'same';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
