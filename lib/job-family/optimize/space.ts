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
 * Ruang parameter + arah pencarian untuk optimasi BERTopic (modul M10).
 *
 * Di sinilah "penalaran arah" tinggal — sebagai kode, bukan sebagai harapan
 * pada LLM. Arahnya BUKAN dugaan: tiap baris diturunkan dari semantik parameter
 * yang terdokumentasi di `lib/job-family/config.ts` (dan perilaku HDBSCAN yang
 * mendasarinya):
 *
 *   minClusterSize ↑  → famili lebih sedikit & besar, outlier BERTAMBAH
 *   minSamples     ↑  → lebih konservatif, outlier BERTAMBAH (null = ikut minClusterSize)
 *   epsilon        ↑  → cluster berdekatan digabung, famili & outlier BERKURANG
 *   method 'leaf'     → famili lebih banyak & halus (kebalikan 'eom')
 *   reduceOutliers    → dokumen -1 dipindah ke topik terdekat (langsung menekan outlier)
 *   nrTopics          → pemangkasan jumlah topik setelah clustering
 *
 * Catatan yang membuat rencana lama ("outlier tinggi → naikkan minClusterSize")
 * dikoreksi di sini: MENAIKKAN minClusterSize justru MENAMBAH outlier. Salah
 * arah semacam inilah alasan modul ini deterministik.
 *
 * Modul murni: tanpa DB, tanpa LLM, tanpa Math.random — kandidat yang sama
 * untuk keadaan yang sama, supaya hasil optimasi dapat direproduksi.
 */

import type { BertopicConfig } from '@/lib/job-family/config';
import type { ObjectiveContext, TopicMetrics } from './objective';

export type CandidatePatch = {
  /** Perubahan di atas config aktif — bentuk yang sama dengan configOverride. */
  patch: Partial<BertopicConfig>;
  /** Alasan satu kalimat; ikut ke laporan percobaan. */
  reason: string;
};

/** Pagar keras — kandidat di luar rentang ini tidak pernah diusulkan. */
const BOUNDS = {
  minClusterSize: { min: 2, max: 15 },
  minSamples: { min: 1, max: 10 },
  clusterSelectionEpsilon: { min: 0, max: 0.6 },
  nNeighbors: { min: 5, max: 30 },
  nComponents: { min: 2, max: 12 },
  outlierThreshold: { min: 0, max: 0.9 },
  minDf: { min: 1, max: 10 },
  maxDf: { min: 0.3, max: 1 },
} as const;

/**
 * Susun daftar kandidat terurut untuk satu sesi optimasi.
 *
 * Strategi coordinate descent kasar: tiap kandidat menggeser SATU gagasan
 * (satu–dua parameter yang bekerja searah), diurutkan dari yang paling mungkin
 * memperbaiki sasaran. Bukan grid penuh — tiap kandidat DIUKUR dengan
 * pengelompokan sungguhan pada korpus sekarang (topic-service /topics/trials,
 * dipanggil search.ts), jadi anggarannya kecil dan urutan yang cerdas lebih
 * berharga daripada cakupan yang lebar.
 */
export function candidatesFor(
  base: BertopicConfig,
  metrics: TopicMetrics,
  ctx: ObjectiveContext,
): CandidatePatch[] {
  const out: CandidatePatch[] = [];
  const push = (patch: Partial<BertopicConfig>, reason: string) => {
    const cleaned = withinBounds(patch);
    if (!cleaned) return;
    // Kandidat yang identik dengan config dasar tidak berarti apa-apa.
    if (Object.entries(cleaned).every(([k, v]) => (base as Record<string, unknown>)[k] === v)) return;
    out.push({ patch: cleaned, reason });
  };

  switch (ctx.goal) {
    case 'reduce_outliers': {
      if (!base.reduceOutliers) {
        push(
          { reduceOutliers: true },
          'Memindahkan dokumen outlier ke topik terdekat — jalur paling langsung menekan outlier.',
        );
      }
      push(
        { minSamples: 1, reduceOutliers: base.reduceOutliers },
        'minSamples terendah membuat HDBSCAN paling longgar menerima dokumen ke cluster.',
      );
      push(
        { clusterSelectionEpsilon: round2(base.clusterSelectionEpsilon + 0.15) },
        'Menaikkan epsilon menggabungkan cluster berdekatan sehingga lebih sedikit dokumen tersisa di luar.',
      );
      push(
        { minClusterSize: base.minClusterSize - 2, minSamples: 1 },
        'Famili minimum lebih kecil + minSamples longgar menampung kelompok kecil yang tadinya outlier.',
      );
      break;
    }
    case 'fewer_topics': {
      push(
        { minClusterSize: base.minClusterSize + 3 },
        'Famili minimum lebih besar menggabungkan kelompok kecil.',
      );
      push(
        { clusterSelectionEpsilon: round2(base.clusterSelectionEpsilon + 0.2) },
        'Epsilon lebih besar melebur cluster yang berdekatan.',
      );
      if (ctx.targetTopicCount) {
        push(
          { nrTopics: ctx.targetTopicCount },
          `Memangkas langsung ke ${ctx.targetTopicCount} topik setelah clustering.`,
        );
      }
      if (base.clusterSelectionMethod !== 'eom') {
        push({ clusterSelectionMethod: 'eom' }, "Metode 'eom' menghasilkan cluster lebih luas.");
      }
      break;
    }
    case 'more_topics': {
      push(
        { minClusterSize: base.minClusterSize - 2, minSamples: 1 },
        'Famili minimum lebih kecil membiarkan kelompok halus berdiri sendiri.',
      );
      if (base.clusterSelectionMethod !== 'leaf') {
        push(
          { clusterSelectionMethod: 'leaf', minSamples: 1 },
          "Metode 'leaf' memilih cluster daun yang lebih halus.",
        );
      }
      push(
        { nNeighbors: base.nNeighbors - 5 },
        'nNeighbors lebih kecil menonjolkan struktur lokal sehingga topik kecil terlihat.',
      );
      break;
    }
    case 'no_outliers': {
      // Satu-satunya cara benar-benar menihilkan outlier: nyalakan penempatan
      // ulang DAN turunkan ambangnya ke 0, supaya tidak ada dokumen yang
      // tertolak karena terlalu jauh. Cascade menambah sudut pandang bagi
      // dokumen yang gagal ditempatkan oleh ukuran pertama.
      push(
        {
          reduceOutliers: true,
          outlierStrategy: 'embeddings',
          outlierThreshold: 0,
          outlierCascade: true,
        },
        'Setiap jabatan dimasukkan ke rumpun terdekatnya tanpa syarat kemiripan minimum — ' +
          'inilah satu-satunya pengaturan yang benar-benar menihilkan outlier.',
      );
      // Menempatkan ulang bekerja lebih baik bila yang tersisa sedikit, jadi
      // longgarkan juga pembentukan clusternya.
      push(
        { minSamples: 1, reduceOutliers: true, outlierThreshold: 0, outlierCascade: true },
        'Selain menempatkan ulang, HDBSCAN dibuat paling longgar menerima dokumen sejak awal ' +
          'sehingga lebih sedikit yang perlu dipaksakan belakangan.',
      );
      break;
    }
    case 'strict_outliers': {
      // Inti sasaran ini: menempatkan ulang, TETAPI dengan syarat kemiripan —
      // sehingga yang tersisa di luar adalah tepat dokumen yang tidak dekat
      // dengan apa pun. Ambangnya diisi pemanggil dari sebaran nyata
      // (diagnose.suggestOutlierThreshold); nilai di sini hanyalah cadangan
      // bila sebarannya tidak memberi batas alami.
      const th = round2(ctx.outlierThreshold ?? 0.45);
      // Cascade sengaja TIDAK dinyalakan: ambang di atas 0 dipilih dari sebaran
      // kemiripan embedding, sedangkan strategi lain mengukur pada skala yang
      // berbeda — memakai ulang angkanya di sana akan mengubah ketatnya
      // penyaringan tanpa ada yang memintanya. (Pipeline juga menolak melintasi
      // skala pada ambang > 0, jadi menyalakannya di sini hanya akan menjadi
      // parameter yang tampak aktif dan tidak berpengaruh.)
      push(
        {
          reduceOutliers: true,
          outlierStrategy: 'embeddings',
          outlierThreshold: th,
          outlierCascade: false,
        },
        `Jabatan yang kemiripannya ke rumpun terdekat di atas ${th} dimasukkan; ` +
          'yang di bawahnya dibiarkan di luar karena memang tidak menyerupai rumpun mana pun.',
      );
      push(
        { minSamples: 1, reduceOutliers: true, outlierThreshold: th, outlierCascade: false },
        'Sama, ditambah HDBSCAN yang lebih longgar sejak awal agar lebih sedikit jabatan ' +
          'pinggiran yang perlu ditempatkan ulang.',
      );
      break;
    }
    case 'bigger_clusters': {
      push(
        { minClusterSize: base.minClusterSize + 3, reduceOutliers: true },
        'Ukuran minimum rumpun dinaikkan sehingga kelompok kecil melebur ke yang besar; ' +
          'penempatan ulang dinyalakan karena menaikkan ambang ini selalu menambah outlier.',
      );
      push(
        { clusterSelectionEpsilon: round2(base.clusterSelectionEpsilon + 0.2), minSamples: 1 },
        'Rumpun yang berdekatan digabung, sehingga anggotanya bertambah tanpa membuang siapa pun.',
      );
      if (base.clusterSelectionMethod !== 'eom') {
        push({ clusterSelectionMethod: 'eom' }, "Metode 'eom' memilih rumpun yang lebih luas.");
      }
      break;
    }
    case 'smaller_clusters': {
      push(
        { minClusterSize: Math.max(2, base.minClusterSize - 2), minSamples: 1 },
        'Ukuran minimum rumpun diturunkan sehingga kelompok kecil boleh berdiri sendiri.',
      );
      if (base.clusterSelectionMethod !== 'leaf') {
        push(
          { clusterSelectionMethod: 'leaf', minSamples: 1 },
          "Metode 'leaf' memilih rumpun daun — hasilnya lebih halus dan anggotanya lebih seragam.",
        );
      }
      push(
        { nNeighbors: base.nNeighbors - 5, minSamples: 1 },
        'Struktur lokal lebih ditonjolkan sehingga perbedaan halus antar jabatan terlihat.',
      );
      break;
    }
    case 'split_dominant': {
      // Famili raksasa hampir selalu berarti pemilihan rumpun terlalu luas:
      // 'leaf' memecah tepat pada titik itu. Epsilon justru diturunkan ke nol —
      // penggabungan adalah penyebabnya, bukan obatnya.
      if (base.clusterSelectionMethod !== 'leaf') {
        push(
          { clusterSelectionMethod: 'leaf', minSamples: 1 },
          "Metode 'leaf' memecah rumpun besar menjadi bagian-bagian yang lebih seragam, " +
            'yang persis dibutuhkan saat satu famili menelan sebagian besar jabatan.',
        );
      }
      if (base.clusterSelectionEpsilon > 0) {
        push(
          { clusterSelectionEpsilon: 0 },
          'Penggabungan rumpun berdekatan dimatikan — penggabungan itulah yang membentuk ' +
            'famili raksasa.',
        );
      }
      push(
        { nComponents: Math.min(10, base.nComponents + 3), minSamples: 1 },
        'Ruang perbandingan diperluas sehingga jabatan yang kini menumpuk jadi satu ' +
          'punya lebih banyak ruang untuk terpisah.',
      );
      break;
    }
    case 'remove_tiny': {
      push(
        { minClusterSize: base.minClusterSize + 2, reduceOutliers: true, outlierCascade: true },
        'Rumpun beranggota 1–2 jabatan tidak lagi diakui sebagai famili; anggotanya ' +
          'ditempatkan ulang ke rumpun terdekat alih-alih dibuang menjadi outlier.',
      );
      push(
        {
          clusterSelectionEpsilon: round2(base.clusterSelectionEpsilon + 0.15),
          reduceOutliers: true,
        },
        'Rumpun kecil yang berdekatan dilebur menjadi satu rumpun yang berarti.',
      );
      if (base.clusterSelectionMethod !== 'eom') {
        push(
          { clusterSelectionMethod: 'eom' },
          "Metode 'eom' lebih jarang melahirkan rumpun remah.",
        );
      }
      break;
    }
    case 'balance_sizes': {
      push(
        { clusterSelectionMethod: 'leaf', minSamples: 1, reduceOutliers: true },
        "Metode 'leaf' memberi ukuran rumpun yang jauh lebih seragam daripada 'eom', " +
          'yang cenderung menghasilkan satu rumpun besar dan banyak rumpun kecil.',
      );
      push(
        {
          minClusterSize: Math.max(3, Math.round(metrics.numDocuments / 40)),
          minSamples: 1,
          reduceOutliers: true,
        },
        'Ukuran minimum rumpun disetel ke sekitar 1/40 korpus — cukup besar untuk menghapus ' +
          'remah, cukup kecil untuk tidak melahirkan satu rumpun raksasa.',
      );
      break;
    }
    case 'cleaner_labels': {
      // Tidak satu pun parameter di sini menyentuh keanggotaan dokumen; semuanya
      // bekerja setelah rumpun terbentuk. Itulah gunanya sasaran terpisah:
      // permintaan "namanya kurang jelas" tidak boleh dijawab dengan mengubah
      // pengelompokannya.
      if (!base.reduceFrequentWords) {
        push(
          { reduceFrequentWords: true },
          'Kata yang muncul di hampir semua rumpun ditekan bobotnya, sehingga nama famili ' +
            'memakai kata yang benar-benar membedakannya.',
        );
      }
      if (!base.bm25Weighting) {
        push(
          { bm25Weighting: true },
          'Pembobotan BM25 lebih tahan pada rumpun kecil, sehingga kata kuncinya tidak ' +
            'didominasi satu dokumen yang panjang.',
        );
      }
      push(
        { minDf: Math.min(5, base.minDf + 1), maxDf: 0.85 },
        'Kata yang terlalu langka dan kata yang muncul di mana-mana sama-sama dibuang — ' +
          'keduanya tidak menjelaskan apa pun tentang rumpunnya.',
      );
      if (base.nGramMax < 3) {
        push(
          { nGramMax: base.nGramMax + 1 },
          'Frasa yang lebih panjang boleh menjadi kata kunci, sehingga nama famili terbaca ' +
            'sebagai istilah pekerjaan, bukan potongan kata.',
        );
      }
      break;
    }
    case 'balance': {
      if (!base.reduceOutliers) {
        push({ reduceOutliers: true }, 'Menekan outlier tanpa mengubah bentuk cluster.');
      }
      // Arah jumlah famili dipilih dari keadaan: kejauhan di atas target → gabung;
      // di bawah → pecah. Inilah "membaca keadaan lalu memilih arah" versi kode.
      const target =
        ctx.targetTopicCount ??
        Math.min(40, Math.max(6, Math.round(metrics.numDocuments / 12)));
      if (metrics.topicCount > target * 1.4) {
        push(
          { minClusterSize: base.minClusterSize + 2 },
          `Famili (${metrics.topicCount}) jauh di atas taksiran sehat (${target}) — gabungkan.`,
        );
      } else if (metrics.topicCount < target * 0.6) {
        push(
          { minClusterSize: base.minClusterSize - 2, minSamples: 1 },
          `Famili (${metrics.topicCount}) jauh di bawah taksiran sehat (${target}) — pecah.`,
        );
      }
      push(
        { clusterSelectionEpsilon: round2(base.clusterSelectionEpsilon + 0.1), minSamples: 1 },
        'Kombinasi epsilon naik + minSamples longgar merapikan pinggiran cluster.',
      );
      break;
    }
  }

  return out;
}

/** Terapkan pagar rentang; kembalikan null bila tak ada yang tersisa. */
function withinBounds(patch: Partial<BertopicConfig>): Partial<BertopicConfig> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (typeof value === 'number' && key in BOUNDS) {
      const b = BOUNDS[key as keyof typeof BOUNDS];
      out[key] = Math.max(b.min, Math.min(b.max, value));
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? (out as Partial<BertopicConfig>) : null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
