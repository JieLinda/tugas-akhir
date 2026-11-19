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
 * Diagnosis mutu pengelompokan job family — dan usulan perbaikannya.
 *
 * Modul MURNI (tanpa DB, tanpa LLM, tanpa Math.random), dan itu keputusan yang
 * sama dengan `objective.ts`: evaluasi Fase 0 dan Fase 3 menunjukkan model tidak
 * konsisten menalar arah parameter clustering — ia percaya diri menyarankan
 * "outlier banyak → naikkan min_cluster_size", yang justru MENAMBAH outlier.
 * Karena itu arah dan angkanya dihitung di sini; yang diserahkan kepada model
 * hanyalah memilih sasaran dari kalimat user dan merangkai penjelasannya.
 *
 * Yang membedakan berkas ini dari `space.ts`: `space.ts` menyusun kandidat yang
 * kemudian DIUKUR pada korpus sekarang (search.ts → topic-service). Di sini
 * tidak ada pengukuran sama sekali — seluruh temuan dibaca dari SATU run yang
 * sudah ada, sehingga "Periksa keadaan sekarang" menjawab "apa yang salah" dalam
 * hitungan detik. Run itu bisa basi setelah transformasi ulang; panel
 * menyatakannya lewat `getMapFreshnessAction`.
 *
 * ── Soal ambang outlier ─────────────────────────────────────────────────
 * Temuan paling berguna di modul ini adalah sebaran `altSimilarity` milik
 * dokumen outlier: kemiripan tiap outlier ke famili TERDEKATNYA. Angka itu
 * memisahkan dua hal yang selama ini tercampur menjadi satu kata "outlier":
 *
 *   • dokumen yang duduk tepat di pinggir sebuah famili (kemiripan tinggi) —
 *     ia gagal masuk karena aturan kepadatan HDBSCAN, bukan karena isinya asing;
 *   • dokumen yang memang tidak menyerupai apa pun (kemiripan rendah) — dan ini
 *     temuan, bukan cacat.
 *
 * Selama keduanya dilaporkan sebagai satu angka, satu-satunya pilihan yang
 * tersedia adalah "biarkan semua di luar" atau "paksa semua masuk". Dengan
 * sebarannya, ambang dapat DIPILIH dari data: `suggestOutlierThreshold` mencari
 * celah terlebar pada daftar kemiripan yang terurut, yaitu tempat paling jujur
 * untuk menarik garis antara kedua kelompok itu.
 */

import type { BertopicConfig } from '@/lib/job-family/config';
import type { OptimizeGoal } from './objective';

// ── Masukan ────────────────────────────────────────────────────────────

/**
 * Satu dokumen outlier beserta kedekatannya ke famili terdekat.
 *
 * Hanya `nearestSimilarity` yang dipakai perhitungan; sisanya keterangan bagi
 * pemanggil. Diagnosis berjalan atas agregat SE-RUN, dan pada cakupan itu nama
 * jabatan milik unit bisnis lain tidak boleh ikut terbaca — karena itu keduanya
 * boleh null, dan tidak ada satu pun keluaran diagnosis yang menyebut nama.
 */
export type OutlierPoint = {
  jobProfileId: number;
  positionName: string | null;
  /** Cosine ke famili terdekat (0..1); null bila run lama tidak merekamnya. */
  nearestSimilarity: number | null;
  nearestTopicId: number | null;
};

export type DiagnoseInput = {
  config: BertopicConfig;
  numDocuments: number;
  /** Ukuran tiap famili nyata (tanpa topik -1). */
  sizes: number[];
  outliers: OutlierPoint[];
  /** Sasaran jumlah famili bila user menyebutnya. */
  targetTopicCount?: number | null;
  /** `diagnostics.seedStability` run yang didiagnosis; absen pada run lama. */
  seedStability?: SeedStabilityInput | null;
};

export type SeedStabilityInput =
  | {
      publishedSeed: number;
      seeds: { seed: number; ari: number }[];
      ariMean: number;
      ariMin: number;
      unstableCount: number;
    }
  | { error: string };

/** ARI terendah lintas seed yang masih dianggap peta yang sama. */
export const SEED_ARI_STABLE = 0.9;
/** Di bawah ini peta lebih banyak ditentukan seed daripada data. */
export const SEED_ARI_UNSTABLE = 0.75;

// ── Keluaran ───────────────────────────────────────────────────────────

export type Severity = 'critical' | 'warning' | 'info' | 'ok';

export type Finding = {
  code: string;
  severity: Severity;
  /** Satu kalimat, bahasa awam, tanpa nama parameter. */
  title: string;
  /** Angka yang mendasarinya — supaya temuan dapat diperiksa, bukan dipercaya. */
  evidence: string;
  /** Mengapa ini penting bagi pekerjaan user, bukan bagi algoritmanya. */
  soWhat: string;
};

export type ThresholdSuggestion = {
  /** Ambang yang disarankan (0..1), atau null bila sebarannya tidak mendukung. */
  threshold: number | null;
  /** Berapa outlier akan MASUK famili pada ambang itu. */
  wouldRehome: number;
  /** Berapa yang TETAP outlier — yang memang tidak dekat dengan apa pun. */
  wouldRemain: number;
  /** Kalimat siap pakai yang menerangkan pilihan itu. */
  rationale: string;
};

export type Diagnosis = {
  metrics: {
    topicCount: number;
    numDocuments: number;
    outlierCount: number;
    outlierPct: number;
    tinyCount: number;
    largestShare: number;
    medianSize: number;
  };
  findings: Finding[];
  /** Sasaran yang paling masuk akal bila user tidak menyebutkannya. */
  suggestedGoal: OptimizeGoal;
  outlierThreshold: ThresholdSuggestion;
};

// ── Diagnosis ──────────────────────────────────────────────────────────

/** ~1 famili per 12 dokumen, dibatasi 6..40 — taksiran yang sama dipakai objective.ts. */
export function healthyTopicCount(numDocuments: number): number {
  return Math.min(40, Math.max(6, Math.round(numDocuments / 12)));
}

export function diagnose(input: DiagnoseInput): Diagnosis {
  const { config, numDocuments, sizes, outliers } = input;
  const topicCount = sizes.length;
  const outlierCount = outliers.length;
  const outlierPct = numDocuments > 0 ? round1((outlierCount / numDocuments) * 100) : 0;
  const clustered = sizes.reduce((a, b) => a + b, 0);
  const tinyCount = sizes.filter((s) => s < 3).length;
  const largestShare = clustered > 0 ? Math.max(...sizes, 0) / clustered : 0;
  const target = input.targetTopicCount ?? healthyTopicCount(numDocuments);

  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // ── Kegagalan total: tidak ada famili sama sekali ──
  if (topicCount === 0) {
    push({
      code: 'no_topics',
      severity: 'critical',
      title: 'Tidak ada satu pun job family yang terbentuk.',
      evidence: `Seluruh ${numDocuments} dokumen masuk ke kelompok "tidak terkelompokkan".`,
      soWhat:
        'Peta job family kosong. Ini hampir selalu berarti syarat ukuran kelompok terlalu ' +
        'ketat untuk jumlah dokumen yang ada, bukan bahwa jabatan-jabatan ini benar-benar ' +
        'tidak mirip satu sama lain.',
    });
  }

  // ── Outlier ──
  if (topicCount > 0 && outlierPct >= 30) {
    push({
      code: 'outliers_high',
      severity: outlierPct >= 50 ? 'critical' : 'warning',
      title: `${outlierPct}% jabatan tidak masuk job family mana pun.`,
      evidence: `${outlierCount} dari ${numDocuments} dokumen berada di luar semua kelompok.`,
      soWhat:
        'Jabatan yang tidak masuk kelompok tidak muncul di Family Tree dan tidak ikut ' +
        'terbawa dalam analisis apa pun yang memakai job family. Sebagian besar dari ' +
        'mereka biasanya bukan jabatan aneh — hanya berada di pinggir kelompok.',
    });
  } else if (topicCount > 0 && outlierPct >= 12) {
    push({
      code: 'outliers_moderate',
      severity: 'info',
      title: `${outlierPct}% jabatan berada di luar job family.`,
      evidence: `${outlierCount} dari ${numDocuments} dokumen.`,
      soWhat:
        'Masih wajar, tetapi bisa ditekan lagi bila Anda ingin hampir setiap jabatan ' +
        'punya rumpun.',
    });
  } else if (topicCount > 0) {
    push({
      code: 'outliers_ok',
      severity: 'ok',
      title: `Hanya ${outlierPct}% jabatan yang di luar kelompok.`,
      evidence: `${outlierCount} dari ${numDocuments} dokumen.`,
      soWhat: 'Sebaran ini sehat; tidak ada yang perlu diperbaiki dari sisi outlier.',
    });
  }

  // ── Jumlah famili ──
  if (topicCount > 0 && topicCount > target * 1.6) {
    push({
      code: 'too_many_topics',
      severity: 'warning',
      title: `Job family terlalu banyak dan terlalu halus (${topicCount} kelompok).`,
      evidence: `Untuk ${numDocuments} dokumen, jumlah yang wajar sekitar ${target}.`,
      soWhat:
        'Kelompok yang terlalu banyak membuat rumpun jabatan kehilangan gunanya — dua ' +
        'jabatan yang orang anggap serumpun berakhir di dua job family berbeda.',
    });
  } else if (topicCount > 0 && topicCount < target * 0.5) {
    push({
      code: 'too_few_topics',
      severity: 'warning',
      title: `Job family terlalu sedikit (${topicCount} kelompok).`,
      evidence: `Untuk ${numDocuments} dokumen, jumlah yang wajar sekitar ${target}.`,
      soWhat:
        'Kelompok yang terlalu sedikit menyatukan pekerjaan yang sebenarnya berbeda, ' +
        'sehingga rumpunnya menjadi terlalu umum untuk dipakai mengambil keputusan.',
    });
  }

  // ── Famili raksasa ──
  if (largestShare > 0.45 && topicCount > 1) {
    push({
      code: 'dominant_family',
      severity: largestShare > 0.6 ? 'critical' : 'warning',
      title: `Satu job family menampung ${Math.round(largestShare * 100)}% jabatan.`,
      evidence: `Anggota terbesar: ${Math.max(...sizes)} dari ${clustered} dokumen yang terkelompokkan.`,
      soWhat:
        'Kelompok sebesar ini praktis berarti "lain-lain". Ia terlihat seperti hasil ' +
        'pengelompokan padahal tidak memisahkan apa pun.',
    });
  }

  // ── Famili kekecilan ──
  if (topicCount > 0 && tinyCount / topicCount > 0.3) {
    push({
      code: 'tiny_families',
      severity: 'warning',
      title: `${tinyCount} dari ${topicCount} job family hanya berisi 1–2 jabatan.`,
      evidence: `${Math.round((tinyCount / topicCount) * 100)}% kelompok beranggota di bawah 3.`,
      soWhat:
        'Rumpun beranggota dua orang jarang berarti sebagai job family; ia lebih sering ' +
        'merupakan pecahan dari rumpun yang lebih besar.',
    });
  }

  // ── Korpus terlalu kecil untuk parameternya ──
  if (numDocuments > 0 && config.minClusterSize > Math.max(2, numDocuments / 10)) {
    push({
      code: 'min_cluster_too_large',
      severity: 'warning',
      title: 'Syarat ukuran kelompok terlalu besar untuk jumlah dokumen yang ada.',
      evidence:
        `Ukuran minimum kelompok ${config.minClusterSize} terhadap ${numDocuments} dokumen ` +
        `(patokan wajar: maksimal ${Math.max(2, Math.round(numDocuments / 10))}).`,
      soWhat:
        'Kelompok yang lebih kecil dari batas itu langsung dibuang menjadi outlier, ' +
        'sehingga banyak rumpun yang sebenarnya nyata tidak pernah terbentuk.',
    });
  }

  // ── Penempatan ulang outlier yang belum dinyalakan ──
  if (outlierCount > 0 && !config.reduceOutliers) {
    push({
      code: 'reduce_outliers_off',
      severity: 'info',
      title: 'Penempatan ulang outlier belum dinyalakan.',
      evidence: `${outlierCount} dokumen dibiarkan di luar kelompok.`,
      soWhat:
        'Bila dinyalakan, jabatan yang berada di pinggir sebuah rumpun akan dimasukkan ke ' +
        'rumpun terdekatnya, tanpa mengubah bentuk kelompok yang sudah ada.',
    });
  }

  // ── Ambang nol pada penempatan ulang: nol outlier yang menyesatkan ──
  if (config.reduceOutliers && config.outlierThreshold <= 0) {
    push({
      code: 'threshold_zero',
      severity: 'info',
      title: 'Setiap outlier dipaksa masuk kelompok terdekat, sejauh apa pun jaraknya.',
      evidence: 'Ambang kemiripan penempatan ulang = 0.',
      soWhat:
        'Angka outlier memang menjadi nol, tetapi jabatan yang benar-benar tidak ' +
        'berhubungan dengan apa pun ikut dimasukkan ke rumpun yang salah — dan setelah ' +
        'masuk, tidak ada lagi tanda bahwa penempatannya meragukan.',
    });
  }

  // ── Ketergantungan pada seed UMAP ──
  // Seed tetap membuat peta dapat DIULANG, bukan KOKOH: seed lain atas korpus
  // yang sama bisa memberi pembagian lain. Run mengukurnya sendiri; temuan ini
  // hanya menyampaikannya, supaya pakar yang menilai peta tahu seberapa banyak
  // dari yang ia lihat adalah data dan seberapa banyak adalah seed.
  const st = input.seedStability;
  if (st && 'error' in st) {
    push({
      code: 'seed_stability_failed',
      severity: 'info',
      title: 'Uji ketergantungan peta pada seed gagal dijalankan.',
      evidence: st.error,
      soWhat:
        'Peta tetap sah dan dapat diulang dengan seed yang sama, tetapi tidak diketahui ' +
        'seberapa berbeda hasilnya bila seed lain dipakai.',
    });
  } else if (st && st.seeds.length > 0) {
    const evidence =
      `Seed ${st.publishedSeed} dibandingkan dengan ${st.seeds.map((s) => s.seed).join(', ')}: ` +
      `ARI rata-rata ${st.ariMean.toFixed(2)}, terendah ${st.ariMin.toFixed(2)} (1 = pembagian identik); ` +
      `${st.unstableCount} dari ${numDocuments} dokumen berganti sebagian besar rekan familinya.`;
    if (st.ariMin < SEED_ARI_UNSTABLE) {
      push({
        code: 'seed_unstable',
        severity: 'warning',
        title: 'Peta ini banyak ditentukan oleh seed acak, bukan hanya oleh data.',
        evidence,
        soWhat:
          'Peta dapat diulang persis dengan seed yang sama, tetapi seed lain atas korpus yang ' +
          'sama memberi pembagian famili yang cukup berbeda. Batas famili pada dokumen yang ' +
          'tidak stabil sebaiknya tidak dijadikan dasar keputusan tanpa telaah manual.',
      });
    } else if (st.ariMin < SEED_ARI_STABLE) {
      push({
        code: 'seed_moderate',
        severity: 'info',
        title: 'Sebagian kecil batas famili bergeser bila seed acak diganti.',
        evidence,
        soWhat:
          'Bentuk besar peta bertahan lintas seed; yang bergeser adalah dokumen di perbatasan ' +
          'antar-famili, yang memang paling layak ditelaah manual.',
      });
    } else {
      push({
        code: 'seed_stable',
        severity: 'ok',
        title: 'Peta bertahan bila seed acak diganti.',
        evidence,
        soWhat: 'Pembagian famili ini ditentukan oleh data, bukan oleh kebetulan seed.',
      });
    }
  }

  const outlierThreshold = suggestOutlierThreshold(outliers);

  return {
    metrics: {
      topicCount,
      numDocuments,
      outlierCount,
      outlierPct,
      tinyCount,
      largestShare: round2(largestShare),
      medianSize: median(sizes),
    },
    findings: findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    suggestedGoal: pickGoal({ topicCount, target, outlierPct, largestShare, tinyCount }),
    outlierThreshold,
  };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2, ok: 3 };

/**
 * Sasaran yang paling masuk akal bila user hanya bilang "perbaiki".
 *
 * Urutannya adalah urutan kerusakan: kelompok yang tidak terbentuk mengalahkan
 * segalanya, lalu famili raksasa (pengelompokan yang gagal diam-diam), lalu
 * outlier, baru jumlah famili. Memperbaiki jumlah famili di atas peta yang
 * separuh isinya outlier hanya memindahkan masalah.
 */
function pickGoal(m: {
  topicCount: number;
  target: number;
  outlierPct: number;
  largestShare: number;
  tinyCount: number;
}): OptimizeGoal {
  // Nol famili berarti TIDAK ADA rumpun untuk menampung siapa pun, sehingga
  // menyalakan penempatan ulang outlier tidak bisa menolong: pustaka mengiris
  // daftar topik nyata menjadi kosong dan mengembalikan seluruh dokumen apa
  // adanya. Yang harus turun adalah syarat ukuran rumpunnya — itulah yang
  // dikerjakan smaller_clusters, dan itu pula yang disebut temuan `no_topics`.
  if (m.topicCount === 0) return 'smaller_clusters';
  if (m.largestShare > 0.6) return 'split_dominant';
  if (m.outlierPct >= 30) return 'strict_outliers';
  if (m.topicCount > m.target * 1.6) return 'fewer_topics';
  if (m.topicCount < m.target * 0.5) return 'more_topics';
  if (m.tinyCount / Math.max(1, m.topicCount) > 0.3) return 'remove_tiny';
  if (m.outlierPct >= 12) return 'reduce_outliers';
  return 'balance';
}

/**
 * Pilih ambang dari SEBARAN kemiripan outlier, bukan dari angka bulat yang enak
 * dibaca.
 *
 * Caranya: urutkan kemiripan tiap outlier ke famili terdekatnya, lalu cari
 * CELAH terlebar di antara dua nilai berurutan. Celah itu adalah tempat data
 * memisahkan dirinya sendiri — di atasnya sekelompok dokumen yang jelas dekat
 * dengan sesuatu, di bawahnya sekelompok yang jelas tidak. Ambang ditaruh di
 * tengah celah.
 *
 * Dua pengaman:
 *   • celah dicari hanya pada rentang 0,25–0,80. Di luar itu pemisahan tidak
 *     bermakna: di bawah 0,25 semuanya jauh, di atas 0,80 semuanya dekat.
 *   • bila celah terlebar terlalu tipis (< 0,04), sebaran itu memang menerus —
 *     tidak ada dua kelompok untuk dipisahkan, dan mengarang garis di tengah
 *     data yang rata akan terbaca sebagai temuan padahal hanya pembulatan.
 *     Dalam hal itu kembaliannya null, dan asisten mengatakan apa adanya.
 */
export function suggestOutlierThreshold(outliers: OutlierPoint[]): ThresholdSuggestion {
  const sims = outliers
    .map((o) => o.nearestSimilarity)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (sims.length === 0) {
    return {
      threshold: null,
      wouldRehome: 0,
      wouldRemain: outliers.length,
      rationale:
        outliers.length === 0
          ? 'Tidak ada dokumen outlier pada run ini, jadi tidak ada ambang yang perlu dipilih.'
          : 'Run ini tidak merekam kemiripan tiap outlier ke famili terdekatnya (run versi lama). ' +
            'Bangun ulang peta sekali lagi agar ambang dapat dipilih dari datanya sendiri.',
    };
  }

  const LO = 0.25;
  const HI = 0.8;
  const MIN_GAP = 0.04;

  let bestGap = 0;
  let bestAt: number | null = null;
  for (let i = 1; i < sims.length; i++) {
    const lo = sims[i - 1]!;
    const hi = sims[i]!;
    const mid = (lo + hi) / 2;
    if (mid < LO || mid > HI) continue;
    const gap = hi - lo;
    if (gap > bestGap) {
      bestGap = gap;
      bestAt = round2(mid);
    }
  }

  if (bestAt == null || bestGap < MIN_GAP) {
    const p25 = round2(quantile(sims, 0.25));
    return {
      threshold: null,
      wouldRehome: 0,
      wouldRemain: outliers.length,
      rationale:
        `Kemiripan ${sims.length} dokumen outlier ke famili terdekatnya menyebar rata ` +
        `(${round2(sims[0]!)}–${round2(sims[sims.length - 1]!)}), tanpa batas alami di antaranya. ` +
        'Tidak ada dua kelompok yang bisa dipisahkan di sini, jadi ambang apa pun akan ' +
        `memotong di tengah data yang menerus. Bila tetap ingin dicoba, ${p25} memisahkan ` +
        'seperempat yang paling jauh.',
    };
  }

  const remain = sims.filter((v) => v < bestAt!).length;
  const rehome = sims.length - remain;
  return {
    threshold: bestAt,
    wouldRehome: rehome,
    wouldRemain: remain,
    rationale:
      `Dari ${sims.length} dokumen outlier, ${rehome} punya kemiripan di atas ${bestAt} ke ` +
      `famili terdekatnya — mereka duduk di pinggir sebuah rumpun, bukan asing dari semuanya. ` +
      `Sisanya ${remain} berada di bawah ambang itu dan memang tidak menyerupai rumpun mana pun. ` +
      `Celah terlebar pada sebaran ini ada tepat di ${bestAt}, jadi di situlah garis paling jujur ditarik.`,
  };
}

// ── Klasifikasi satu outlier ───────────────────────────────────────────

/**
 * Mekanisme yang menahan sebuah dokumen di luar. Soal PENGATURAN — hampir selalu
 * dapat diubah.
 */
export type OutlierBlockedBy = 'rehoming_off' | 'below_threshold' | 'rehoming_failed';

/**
 * Seberapa asing isinya sesungguhnya. Soal DOKUMEN — tidak berubah oleh
 * pengaturan apa pun.
 */
export type OutlierIsolation = 'fringe' | 'between' | 'distant' | 'isolated';

/**
 * Ambang klasifikasi keterasingan.
 *
 * Angka-angka ini menggambarkan korpus job profile berbahasa Indonesia yang
 * embeddingnya memampat ke pita sempit (dokumen di sini lazimnya berjarak
 * 0,6–0,9 satu sama lain), jadi 0,55 BUKAN "setengah mirip" melainkan sudah
 * cukup dekat untuk disebut pinggiran. Dinyatakan sebagai konstanta bernama
 * supaya dapat dikoreksi bila korpusnya berubah, alih-alih tersebar sebagai
 * angka telanjang di tengah percabangan.
 */
export const ISOLATION_BANDS = {
  /** ≥ ini: jelas menempel pada sebuah famili. */
  fringe: 0.55,
  /** ≥ ini (dan < fringe): menyerupai sesuatu, tetapi jauh. */
  distant: 0.35,
  /** Selisih ke famili kedua di bawah ini: terjepit, tak ada yang menariknya. */
  betweenMargin: 0.03,
  /** Di bawah ini "terjepit" tidak lagi bermakna — semuanya sama-sama jauh. */
  betweenFloor: 0.4,
} as const;

/**
 * Mengapa sebuah dokumen tetap outlier — dua sumbu, dipisah dengan sengaja.
 *
 * Selama keduanya dilaporkan sebagai satu kata "outlier", perbedaan yang paling
 * penting bagi pembacanya tertutup: sebuah jabatan yang tertahan hanya karena
 * penempatan ulang belum dinyalakan (`rehoming_off`) tetapi sesungguhnya duduk
 * di pinggir sebuah famili (`fringe`) bukan jabatan aneh — ia hanya belum
 * dipersilakan masuk. Sedangkan `isolated` memang tidak menyerupai apa pun, dan
 * memaksanya masuk hanya memindahkan persoalannya ke dalam famili yang salah.
 */
export function classifyOutlier(input: {
  /** Cosine ke famili terdekat; null bila vektornya tidak terbaca. */
  nearestSimilarity: number | null;
  /** Selisih kemiripan famili terdekat dan kedua. */
  margin: number | null;
  /** Pengaturan yang BERLAKU pada run itu — bukan yang berlaku sekarang. */
  reduceOutliers: boolean;
  threshold: number | null;
}): { blockedBy: OutlierBlockedBy; isolation: OutlierIsolation } {
  const { nearestSimilarity: sim, margin, reduceOutliers, threshold } = input;

  let blockedBy: OutlierBlockedBy;
  if (!reduceOutliers) {
    blockedBy = 'rehoming_off';
  } else if (threshold != null && threshold > 0 && sim != null && sim < threshold) {
    blockedBy = 'below_threshold';
  } else {
    // Penempatan ulang aktif dan, menurut kemiripan embedding, dokumen ini LAYAK
    // pindah — tetapi tidak pindah. Sebabnya hampir selalu satu dari dua: strategi
    // yang dipakai mengukur pada skala lain (kecocokan kata, bukan kedekatan
    // makna), atau dokumennya tidak menyisakan satu pun kata yang dikenali
    // kosakata sehingga tidak ada yang dapat dibandingkan sama sekali.
    blockedBy = 'rehoming_failed';
  }

  let isolation: OutlierIsolation;
  if (sim == null) {
    isolation = 'isolated';
  } else if (
    margin != null &&
    margin < ISOLATION_BANDS.betweenMargin &&
    sim >= ISOLATION_BANDS.betweenFloor
  ) {
    isolation = 'between';
  } else if (sim >= ISOLATION_BANDS.fringe) {
    isolation = 'fringe';
  } else if (sim >= ISOLATION_BANDS.distant) {
    isolation = 'distant';
  } else {
    isolation = 'isolated';
  }

  return { blockedBy, isolation };
}

// ── util ───────────────────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round(((s[mid - 1]! + s[mid]!) / 2) * 10) / 10;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
