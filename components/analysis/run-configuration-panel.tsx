'use client';

// "Konfigurasi Run" — everything that DECIDED an AHP+TOPSIS ranking, as opposed
// to what it produced: the pool and the filters that shaped it, the AHP pairwise
// matrix with the weights it yields and its consistency coefficients, the
// criteria that survived into the TOPSIS matrix, and the readiness thresholds
// the scores were cut on.
//
// Why a whole sub-tab: an AHP+TOPSIS result is only defensible in a succession
// review if the judgment behind it can be inspected — a weight vector nobody can
// trace back to a pairwise matrix (or a CR nobody checked) is just a number.
//
// Everything shown is the run's OWN frozen state (scoring_runs.config_snapshot,
// filter_summary, and the engine's runInfo), never the current governance
// config. Runs created before the snapshot column can only be reconstructed from
// governance; those are labelled "bukan konfigurasi run" wherever they appear,
// because a rule read today is not evidence of what produced this ranking.
//
// AHP+TOPSIS runs only: a legacy run of another method has no pairwise matrix
// and no per-criterion weights, so the tab is not mounted for those.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  Ban,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  Filter,
  Gauge,
  Info,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Scale,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  UserX,
  XCircle,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ahpInputCheck, randomConsistencyIndex, saatyLabel, type AhpInputCheck } from '@/lib/ahp';
import {
  getRunConfigurationAction,
  type RunConfiguration,
} from '@/lib/progress-running-actions';
import type { FilterCondition, FilterRule } from '@/lib/db/schema';
import { EMPTY_DATE, formatDateTime } from '@/lib/datetime';
import {
  CRITERIA as SNAP_CRITERIA,
  CRITERION_LABEL as SNAP_CRITERION_LABEL,
  DEPTH_SOURCE_LABEL,
  ORIGIN_LABEL as SNAP_ORIGIN_LABEL,
  REQUIRED_SOURCE_LABEL,
  WEIGHT_SOURCE_LABEL as SNAP_WEIGHT_SOURCE_LABEL,
  type Origin as SnapOrigin,
} from '@/lib/run-compare';
import { fmtNumber } from '@/lib/run-compare-format';
import { shortRunId } from '@/lib/run-history';
import { InfoHint } from '@/components/ui/info-hint';
import { OriginTag } from './run-compare/parts';
import {
  NOT_STORED,
  PHASE_LABEL,
  ReproducibilityNotice,
  SYNC_LABEL,
  SnapshotItem,
  SnapshotList,
  SnapshotPending,
  downloadSnapshot,
  phaseRank,
  useReproducibilityCheck,
  useRunSnapshot,
  useTraceExport,
} from './run-snapshot-panel';
import {
  AccentSection,
  KpiTile,
  SectionNav,
  SectionShellStyles,
  SubBlock,
  jumpToSection,
  type SectionNavItem,
} from './section-shell';

// Must match AHP_CRITERIA_ORDER in lib/db/schema.ts (kept local so this client
// component doesn't pull the Drizzle schema into the bundle) — same convention
// as components/governance/governance-ahp-editor.tsx.
const CRITERIA: { key: string; label: string; short: string }[] = [
  { key: 'technical', label: 'Technical Competency', short: 'Technical' },
  { key: 'career', label: 'Career Relevance', short: 'Career' },
  { key: 'behavior', label: 'Behavior Competency', short: 'Behavior' },
  { key: 'performance', label: 'Performance Appraisal', short: 'Performance' },
  { key: 'hav', label: 'HAV Mapping', short: 'HAV' },
  { key: 'education', label: 'Education', short: 'Education' },
];

const CRITERION_LABEL: Record<string, string> = Object.fromEntries(
  CRITERIA.map((c) => [c.key, c.label]),
);

const WEIGHT_COLORS = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-teal-500',
];

// Filter-rule vocabulary — mirrors components/governance/governance-types.ts.
const FIELD_LABELS: Record<string, string> = {
  disciplineStatus: 'Status Disiplin',
  mcuStatus: 'Status MCU',
  performanceGrade: 'Performance Appraisal',
  havQuadrant: 'HAV Quadrant',
  behaviorRecommendation: 'Behavior Recommendation',
  yearsExperience: 'Masa Kerja',
  education: 'Pendidikan',
};

const OPERATOR_LABELS: Record<string, string> = {
  eq: 'sama dengan',
  neq: 'tidak sama dengan',
  in: 'termasuk',
  notIn: 'tidak termasuk',
  gte: '≥',
  lte: '≤',
  gt: '>',
  lt: '<',
  notExpired: 'belum kadaluarsa',
  isExpired: 'sudah kadaluarsa',
};

/** Provenance of the program template shown — see RunConfigSource. */
const TEMPLATE_SOURCE_LABELS: Record<string, string> = {
  snapshot: 'Konfigurasi run (beku)',
  inherited: 'Konfigurasi run dasar (beku)',
  'live-fallback': 'Tata kelola saat ini — bukan konfigurasi run',
};

// 'criteria-weights' is a LEGACY value: the AHP engine used to derive its weights
// from the program's criteria list and no longer does (weights now come from the
// pairwise matrix, or from the system defaults when none is set). Runs finished
// before that change still carry it, so the label stays — flagged as history, not
// as something a new run can produce.
const WEIGHT_SOURCE_LABELS: Record<string, string> = {
  'ahp-matrix': 'Matriks perbandingan dari Governance',
  'criteria-weights': 'Diturunkan dari bobot "Kriteria & Bobot" program (aturan lama)',
  default: 'Bobot bawaan sistem (program tanpa matriks AHP)',
  // A derived run (tambah kandidat / kecualikan kandidat) re-ranks under the
  // matrix its BASE run used, not the one governance holds today — a derived run
  // exists to isolate one change, and the weights are not it.
  inherited: 'Diwarisi dari matriks run dasar (run turunan)',
  unknown: 'Tidak diketahui',
};

/** Provenance of the AHP config shown — see AhpConfigOrigin. */
const ORIGIN_LABELS: Record<string, string> = {
  run: 'Tercatat oleh engine saat run',
  snapshot: 'Dibekukan saat run dibuat',
  template: 'Direkonstruksi dari template program saat ini',
  unavailable: 'Tidak tersedia',
};

/** The weight source in two or three words, for the hero tile. */
const WEIGHT_SOURCE_SHORT: Record<string, string> = {
  'ahp-matrix': 'Matriks program',
  'criteria-weights': 'Bobot kriteria (aturan lama)',
  default: 'Bawaan sistem',
  inherited: 'Diwarisi run induk',
  unknown: 'Tidak diketahui',
};

/** One colour per engine phase on the duration bar, in execution order. */
const PHASE_COLORS = [
  'bg-sky-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-fuchsia-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-rose-400',
  'bg-slate-400',
];

/** Readiness band surfaces — the same hues the Kandidat tab paints its rows with. */
const READINESS_BAND: Record<string, string> = {
  Short: 'border-sky-200 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20',
  Medium: 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20',
  Long: 'border-lime-200 bg-lime-50/70 dark:border-lime-900/40 dark:bg-lime-950/20',
  'Not Ready': 'border-rose-200 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20',
};

/** A Saaty ratio as it is judged: 5, 1, or 1/5 — not 0.2. */
/**
 * `toFixed` that survives a run whose `run_info` predates a key: an older run
 * (or one written by an older engine) may lack a diagnostic, and a missing
 * number must read "—", never take the whole page down (NFR-RR-06).
 */
function fx(v: unknown, digits: number): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—';
}

function fmtRatio(v: number): string {
  // The shared Saaty label: "3", "1/3", or the value itself ("1,25") when it is
  // off the scale — never rounded into a judgment it is not. 1e-3 in log space
  // because older runs stored this matrix at 4 decimals (1/7 → 0.1429).
  return saatyLabel(v, 1e-3);
}

function pct(v: number | undefined | null): string {
  return `${((v ?? 0) * 100).toFixed(1)}%`;
}

function fmtDate(iso: string | null): string {
  const text = formatDateTime(iso);
  return text === EMPTY_DATE ? '—' : text;
}

/**
 * Where a run's similarity bounds came from. Rendered as a badge because the two
 * numbers alone do not say whether they were computed from the dictionary,
 * pinned by hand, or a stand-in used because the dictionary could not be
 * compared — and those three deserve very different trust.
 *
 * Wording is deliberately jargon-free: "anchor", "census" and "percentile" are
 * accurate to the implementation and meaningless to the HR reader this page is
 * for, who needs to know whether the number was measured or assumed.
 */
/**
 * A formula block. Rendered as preformatted text rather than prose because the
 * arithmetic IS the explanation — a reader defending a ranking needs to see the
 * operations, not a sentence describing them. Scrolls on its own so a long line
 * never forces the page sideways.
 */
/**
 * Literature behind the Career criterion, and — just as important — what has NO
 * literature behind it.
 *
 * WHY THIS IS ON THE PAGE. Career carries numbers an operator is entitled to
 * interrogate: a 4.3%/year decay, an IDF weight, a 0.25 breadth term, a 0.5 cap.
 * Some come from published work, some are measured from this deployment's own
 * data, and some are engineering choices made by testing alternatives here. Those
 * three have very different standing, and a panel that cited papers for all of
 * them would be worse than one that cited none — it would launder a judgement
 * call as a finding. So every row states its tier, and the `none` tier is
 * deliberately listed rather than omitted.
 */
type SourceTier = 'literature' | 'measured' | 'engineering';

type CareerCitation = {
  /** What in the computation this backs. */
  element: string;
  /** The form or value actually used. */
  applied: string;
  tier: SourceTier;
  /** Citation, or the census it was measured from, or the alternatives tested. */
  basis: string;
  links?: { label: string; url: string }[];
  /** Where the source and our use of it genuinely differ. Printed as a caveat. */
  caveat?: string;
};

const CAREER_CITATIONS: CareerCitation[] = [
  {
    element: 'Penyusutan pengalaman lama (recency)',
    applied: 'exp(−δ × tahun sejak berakhir), δ = 0,043/tahun',
    tier: 'literature',
    basis:
      'Bentuk peluruhan eksponensial dan lajunya diambil dari literatur depresiasi human capital. Dinerstein, Megalokonomou & Yannelis memperkirakan laju depresiasi keterampilan 4,3% per tahun (dan imbal hasil pengalaman 6,8%). Angka itu dikuatkan dari arah lain oleh de Grip & van Loo, yang mengukur hampir sepertiga keterampilan pendidikan tinggi sudah usang setelah 7 tahun — kalau dipasang ke bentuk eksponensial yang sama, itu ≈ 5,1%/tahun. Dua literatur yang berbeda mengurung 4–5%/tahun.',
    links: [
      {
        label: 'Dinerstein, Megalokonomou & Yannelis (2022), American Economic Review 112(11)',
        url: 'https://www.aeaweb.org/articles?id=10.1257/aer.20201571',
      },
      { label: 'versi kertas kerja NBER w27925 (PDF)', url: 'https://www.nber.org/papers/w27925' },
      {
        label: 'de Grip & van Loo (2002), The Economics of Skills Obsolescence: A Review',
        url: 'https://cris.maastrichtuniversity.nl/en/publications/the-economics-of-skills-obsolescence-a-review/',
      },
      {
        label: 'van Loo dkk., The Speed of Obsolescence — bukti sektor publik Belanda (PDF, akses terbuka)',
        url: 'https://files.eric.ed.gov/fulltext/ED504838.pdf',
      },
    ],
    caveat:
      'Kedua studi tidak meneliti kasus kita secara langsung. Yang pertama mengukur depresiasi dari waktu DI LUAR pekerjaan formal (guru di Yunani); yang kedua memakai penilaian diri lulusan pendidikan tinggi Belanda. Yang kita terapkan adalah "keterampilan meluruh saat orang bekerja di bidang LAIN". Jadi 4,3% dipakai sebagai jangkar orde besaran yang bisa dipertanggungjawabkan, bukan sebagai hasil replikasi.',
  },
  {
    element: 'Bobot kekhasan kompetensi (IDF)',
    applied: 'bobot(k) = ln(N ÷ df(k)), dijepit minimum 0,15',
    tier: 'literature',
    basis:
      'Inverse document frequency, dirumuskan Karen Spärck Jones (1972) dan diberi dasar teoretisnya oleh Robertson (2004). Argumennya persis masalah kita: istilah yang muncul di terlalu banyak dokumen tidak membedakan apa pun, sehingga harus diberi bobot lebih kecil. Literatur pencocokan CV–lowongan menyebutkan hal yang sama tentang uraian jabatan, yang "berbagi banyak bahasa profesional umum yang tidak diskriminatif".',
    links: [
      {
        label: 'Spärck Jones (1972), Journal of Documentation 28(1) — halaman arsip IDF',
        url: 'https://www.staff.city.ac.uk/~sbrp622/idf.html',
      },
      {
        label: 'Robertson (2004), Understanding inverse document frequency (PDF)',
        url: 'https://www.staff.city.ac.uk/~sbrp622/idfpapers/Robertson_idf_JDoc.pdf',
      },
    ],
  },
  {
    element: 'Pelandaian imbal hasil pengalaman (Mincer)',
    applied: 'x^(1/γ); TERSEDIA tapi γ = 1 (mati) secara bawaan',
    tier: 'literature',
    basis:
      'Teori human capital menyatakan imbal hasil pengalaman bersifat konkaf — itulah sebabnya fungsi pendapatan Mincer memasang pengalaman sebagai suku kuadratik, dan bentuk itu sudah difit pada ribuan dataset.',
    links: [
      {
        label: 'Polachek (2007), The Mincer Earnings Function and Its Applications, IZA DP 3181 (PDF)',
        url: 'https://docs.iza.org/dp3181.pdf',
      },
      {
        label: 'Lemieux, The "Mincer Equation" Thirty Years After (PDF)',
        url: 'https://economics.ubc.ca/wp-content/uploads/sites/38/2013/05/pdf_paper_thomas-lemieux-mincer-equation.pdf',
      },
    ],
    caveat:
      'DIMATIKAN secara bawaan justru karena diuji di sini dan memperburuk tujuannya: imbal hasil yang melandai menaikkan bagian TENGAH skala, dan di situlah karier yang panjang tapi tidak relevan berada. Jaraknya turun dari +39 poin pada γ=1 menjadi +24 pada γ=2. Bentuk Mincer tepat untuk memodelkan apa yang pengalaman HASILKAN, bukan untuk memutuskan apakah pengalaman itu RELEVAN. Punya sumber literatur tidak membuat sebuah bentuk otomatis benar untuk pertanyaan yang berbeda.',
  },
  {
    element: 'Tolok ukur dari perpindahan jabatan nyata',
    applied:
      'batas kemiripan dari persentil mutasi yang benar-benar terjadi; T_tahun dari median lama bekerja saat diangkat',
    tier: 'literature',
    basis:
      'Pendekatan revealed preference / occupational mobility network: kedekatan dua jabatan diukur dari seberapa sering orang benar-benar berpindah di antaranya, bukan dari kemiripan uraiannya. Moro dkk. (PNAS) membangun jaringan mobilitas antar-jabatan dengan cara ini; literatur jalur transisi berbasis keterampilan memakai logika yang sama.',
    links: [
      {
        label:
          'Moro dkk. (2019), Network-driven differences in mobility among automatable jobs, PNAS',
        url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6689632/',
      },
      {
        label: 'Skill-driven Recommendations for Job Transition Pathways (arXiv 2011.11801)',
        url: 'https://arxiv.org/pdf/2011.11801',
      },
    ],
  },
  {
    element: 'Kalibrasi batas kemiripan lewat kurva ketepatan',
    applied: 'batas bawah/atas = titik ketepatan 50% dan 95%',
    tier: 'literature',
    basis:
      'Bidangnya score calibration: mengubah skor mentah menjadi sesuatu yang bisa dibaca sebagai peluang. Dua metode bakunya Platt scaling (sigmoid) dan isotonic regression. Kita memakai gagasannya — kalibrasi terhadap label yang bisa diperiksa — tetapi mengambil dua titik ambang dari kurva ketepatan, bukan seluruh kurva sigmoidnya.',
    links: [
      {
        label: 'Lin, Lin & Weng, A Note on Platt’s Probabilistic Outputs for SVM (PDF, akses terbuka)',
        url: 'https://www.csie.ntu.edu.tw/~cjlin/papers/plattprob.pdf',
      },
      {
        label: 'Niculescu-Mizil & Caruana (2005), Predicting Good Probabilities (PDF)',
        url: 'https://www.cs.cornell.edu/~alexn/papers/calibration.icml05.crc.rev3.pdf',
      },
    ],
    caveat:
      'Sigmoid Platt di-fit pada korpus ini dan hasilnya p(serumpun) = sigmoid(28,86 × cos − 19,70), dengan titik 50% di cos 0,683 — nyaris sama dengan 0,672 yang dipakai. Sigmoidnya tidak dipakai karena terlalu tajam: pada cos 0,787 ia sudah menyatakan 95% serumpun, sehingga Quality Assurance Analyst terbaca setara Application Development.',
  },
  {
    element: 'Tolok ukur absolut, bukan dari sebaran peserta',
    applied: 'T_tahun tidak lagi median pool × 2',
    tier: 'literature',
    basis:
      'TOPSIS menetapkan titik ideal dan anti-ideal dari nilai EKSTREM alternatif yang ada, sehingga hasilnya bergantung pada siapa yang ikut dinilai. Reference Ideal Method (RIM) ada justru untuk kasus di mana itu keliru: ia membolehkan titik acuan ditetapkan di mana pun dalam rentang, bukan di ekstremnya. Perubahan T dari pool-relatif menjadi absolut adalah gagasan itu, diterapkan pada satu kriteria.',
    links: [
      {
        label: 'Cables, Lamata & Verdegay (2016), RIM — Reference Ideal Method, Information Sciences',
        url: 'https://www.sciencedirect.com/science/article/abs/pii/S0020025515009007',
      },
      {
        label: 'Hwang & Yoon (1981), Multiple Attribute Decision Making (TOPSIS asli)',
        url: 'https://link.springer.com/book/10.1007/978-3-642-48318-9',
      },
      {
        label: 'Ringkasan implementasi RIM (paket MCDM, akses terbuka)',
        url: 'https://rdrr.io/cran/MCDM/man/RIM.html',
      },
    ],
  },
  {
    element: 'Pembobotan kriteria & ambang konsistensi',
    applied: 'bobot AHP dari matriks pairwise; simpan ditolak bila CR > 0,1',
    tier: 'literature',
    basis:
      'Analytic Hierarchy Process. Ambang "CR 0,10 atau kurang dapat diterima" berasal langsung dari Saaty (1980) dan itulah angka yang dipakai editor pairwise di Tata Kelola.',
    links: [
      {
        label: 'Saaty — AHP dan teori pengukuran (PDF)',
        url: 'https://www.dse.univr.it/documenti/Seminario/documenti/documenti803241.pdf',
      },
    ],
  },
  {
    element: 'Pencocokan kompetensi satu-ke-satu',
    applied: 'penugasan Hungarian yang memaksimalkan total',
    tier: 'literature',
    basis:
      'Algoritma penugasan Kuhn–Munkres. Dipakai pada jalur cadangan career (dan pada kriteria technical) supaya setiap kompetensi acuan berpasangan dengan tepat satu kompetensi yang dimiliki, sebagai optimum global — bukan pencocokan rakus.',
    links: [
      {
        label: 'Kuhn (1955), The Hungarian method for the assignment problem',
        url: 'https://onlinelibrary.wiley.com/doi/10.1002/nav.3800020109',
      },
    ],
  },
  {
    element: 'Koreksi anisotropi vektor teks',
    applied: 'DIUJI, TIDAK DIPAKAI',
    tier: 'literature',
    basis:
      'Literatur anisotropi menjelaskan gejala korpus ini dengan tepat: seluruh vektor berbagi satu arah dominan yang mengkodekan ciri generik dokumen, sehingga jarak sudut antar dokumen mana pun tertekan ke pita sempit. Obatnya yang baku: whitening, BERT-flow, dan "all-but-the-top".',
    links: [
      {
        label: 'Su dkk. (2021), Whitening Sentence Representations (arXiv 2103.15316)',
        url: 'https://arxiv.org/abs/2103.15316',
      },
      {
        label: 'Semantics at an Angle: When Cosine Similarity Works Until It Doesn’t (arXiv)',
        url: 'https://arxiv.org/html/2504.16318v2',
      },
    ],
    caveat:
      'Diuji pada 275 dokumen di sini dan hasilnya lebih buruk: pita dinamis memang melebar hampir dua kali, tetapi kualitas peringkat turun (AUC 0,874 → 0,818 untuk all-but-top-1, dan makin buruk bila komponen dibuang lebih banyak). Sebabnya terukur: komponen teratas cuma 8,3% varians — korpus ini tidak anisotropik parah karena modelnya sudah dilatih kontrastif. Jadi rentang batas linear yang dipakai sekarang adalah aproksimasi murah dari whitening, dan di korpus ini justru yang lebih baik.',
  },
  {
    element: 'Batas bawah & atas kemiripan',
    applied: '0,633 – 0,892 (nilai tengah tiga cara pengukuran)',
    tier: 'measured',
    basis:
      'Diukur dari korpus dokumen job profile deployment ini: 275 dokumen / 37.675 pasangan untuk cara "corpus", 37.652 pasangan berlabel rumpun untuk "family", dan 102 mutasi jabatan nyata untuk "transitions". Tidak ada literatur yang bisa memberi angka ini — ia sifat korpus Anda, dan berubah kalau korpusnya berubah.',
  },
  {
    element: 'T_tahun per tingkat jabatan',
    applied: 'Staff 5,1 · Officer 6,7 · SPV 8,0 · Dept Head 9,25 · Div Head 15,9',
    tier: 'measured',
    basis:
      'Median lama bekerja dari 470 pengangkatan jabatan yang benar-benar terjadi di perusahaan ini. Cara pengukurannya dari literatur revealed preference di atas; angkanya milik data Anda.',
  },
  {
    element: 'Rasio satuan tahun efektif ↔ tahun mentah',
    applied: '0,398',
    tier: 'measured',
    basis:
      'Median dari (tahun efektif ÷ tahun terpasangkan) atas kandidat yang sudah dinilai di deployment ini. Dipakai untuk menerjemahkan syarat pengalaman job profile ke satuan yang benar.',
  },
  {
    element: 'Plafon jalur kompetensi',
    applied: '0,50 dari rentang penuh',
    tier: 'measured',
    basis:
      'Diturunkan dari daya pisah kedua jalur yang diukur di sini: cakupan kompetensi memisahkan rumpun jabatan pada AUC 0,743 sementara kemiripan dokumen 0,874, dan 5% pasangan jabatan yang tidak berhubungan pun berbagi ≥ 75% kompetensi. Separuh skala adalah yang paling banyak bisa dipikul argumen kompetensi.',
  },
  {
    element: 'Bentuk penggabungan dua sumbu',
    applied: 'kedalaman × (0,75 + 0,25 × keragaman); w = 0,25',
    tier: 'engineering',
    basis:
      'TIDAK ADA sumber literatur. Lima bentuk diuji pada run acuan — min(), rata-rata geometrik, dua tingkat pelandaian, dan bentuk perkalian ini — dan yang dipilih memberi jarak terlebar antara relevansi asli dan palsu (+22 poin, dibanding +2 untuk min() dan +16 untuk rata-rata geometrik). Nilai w = 0,25 adalah keputusan rekayasa, bukan temuan.',
  },
  {
    element: 'T_periode (keragaman penugasan)',
    applied: '2 stint efektif',
    tier: 'engineering',
    basis:
      'TIDAK ADA sumber literatur. Diturunkan dari 3 ke 2 karena pada 3, satu penugasan panjang di jabatan yang persis sama hanya mencapai 1,4 stint efektif dan mendapat skor 47 — menghukum profil yang justru paling pantas.',
  },
  {
    element: 'Jepitan bobot IDF minimum 0,15 dan guard monotonisitas',
    applied: 'bobot ≥ 0,15; T tingkat senior ≥ T tingkat junior',
    tier: 'engineering',
    basis:
      'TIDAK ADA sumber literatur. Keduanya penjaga: yang pertama supaya kompetensi hampir universal dilemahkan tetapi tidak dihapus (ia tetap syarat tertulis), yang kedua supaya tingkat jabatan senior yang catatan pengangkatannya tipis tidak berakhir lebih mudah daripada tingkat junior.',
  },
];

function tierBadge(tier: SourceTier): { label: string; className: string } {
  if (tier === 'literature')
    return {
      label: 'dari literatur',
      className:
        'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  if (tier === 'measured')
    return {
      label: 'diukur dari data Anda',
      className: 'border-primary/40 bg-primary/10 text-primary',
    };
  return {
    label: 'keputusan rekayasa',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  };
}

/** Literature + provenance table for the Career criterion. */
function CareerCitations() {
  const counts = {
    literature: CAREER_CITATIONS.filter((c) => c.tier === 'literature').length,
    measured: CAREER_CITATIONS.filter((c) => c.tier === 'measured').length,
    engineering: CAREER_CITATIONS.filter((c) => c.tier === 'engineering').length,
  };
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-[10px] font-bold text-foreground">
        Dasar setiap rumus dan angka pada kriteria Career
      </p>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {counts.literature} unsur punya dasar literatur, {counts.measured} diukur dari data
        deployment ini, dan {counts.engineering}{' '}
        <span className="font-medium text-foreground">tidak punya dasar literatur sama sekali</span>{' '}
        — yang terakhir tetap dicantumkan, karena mencantumkan kutipan untuk semuanya akan
        menyamarkan keputusan rekayasa sebagai temuan penelitian.
      </p>
      <div className="space-y-2">
        {CAREER_CITATIONS.map((c) => {
          const b = tierBadge(c.tier);
          return (
            <div key={c.element} className="rounded-md border border-dashed px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold text-foreground">{c.element}</span>
                <Badge variant="outline" className={cn('text-[9px]', b.className)}>
                  {b.label}
                </Badge>
              </div>
              <p className="mt-1 font-mono text-[10px] wrap-break-word text-foreground/80">
                {c.applied}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{c.basis}</p>
              {c.links && c.links.length > 0 && (
                <ul className="mt-1 ml-3 list-disc space-y-0.5">
                  {c.links.map((l) => (
                    <li key={l.url} className="text-[10px] leading-relaxed">
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 wrap-break-word hover:no-underline"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {c.caveat && (
                <p className="mt-1 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                  <span className="font-semibold">Batas keberlakuan:</span> {c.caveat}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Cara membaca ketiga label ini.</span>{' '}
        &ldquo;Dari literatur&rdquo; berarti BENTUK rumusnya (dan kadang nilainya) diambil dari
        penelitian yang dipublikasikan — tetapi tidak berarti penelitian itu meneliti kasus kita,
        jadi bacalah batas keberlakuannya. &ldquo;Diukur dari data Anda&rdquo; berarti angkanya sifat
        korpus dan riwayat deployment ini, akan berubah ketika datanya berubah, dan tidak ada
        literatur yang bisa memberikannya. &ldquo;Keputusan rekayasa&rdquo; berarti dipilih dengan
        menguji beberapa alternatif di sini; ia dapat diperdebatkan, dan angka pembandingnya
        dicantumkan supaya bisa diperdebatkan dengan data.
      </p>
    </div>
  );
}

function Formula({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-200/70 bg-slate-950/[0.035] p-3 font-mono text-[10px] leading-relaxed text-foreground/90 dark:border-slate-800 dark:bg-slate-50/[0.04]">
      {children}
    </pre>
  );
}

/** A labelled paragraph inside a criterion panel. */
function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-l-2 border-indigo-300/70 pl-2.5 dark:border-indigo-800">
      <p className="text-[10px] font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * Colour per criterion — the same hue the Kandidat tab's breakdown chips use
 * for it (position-detail-tabs.tsx CRITERION_CHIPS), so "teal is career" holds
 * across the page.
 */
const CRITERION_TONE: Record<string, { dot: string; bar: string; open: string }> = {
  technical: { dot: 'bg-sky-500', bar: 'bg-sky-500', open: 'data-[state=open]:border-sky-300 dark:data-[state=open]:border-sky-800' },
  career: { dot: 'bg-teal-500', bar: 'bg-teal-500', open: 'data-[state=open]:border-teal-300 dark:data-[state=open]:border-teal-800' },
  behavior: { dot: 'bg-fuchsia-500', bar: 'bg-fuchsia-500', open: 'data-[state=open]:border-fuchsia-300 dark:data-[state=open]:border-fuchsia-800' },
  performance: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', open: 'data-[state=open]:border-emerald-300 dark:data-[state=open]:border-emerald-800' },
  hav: { dot: 'bg-violet-500', bar: 'bg-violet-500', open: 'data-[state=open]:border-violet-300 dark:data-[state=open]:border-violet-800' },
  education: { dot: 'bg-amber-500', bar: 'bg-amber-500', open: 'data-[state=open]:border-amber-300 dark:data-[state=open]:border-amber-800' },
};

/** One criterion's dropdown: weight on the trigger, explanation inside. */
function CriterionItem({
  value,
  label,
  weight,
  dropped,
  children,
}: {
  value: string;
  label: string;
  weight?: number;
  dropped?: string | null;
  children: React.ReactNode;
}) {
  const tone = CRITERION_TONE[value] ?? { dot: 'bg-slate-400', bar: 'bg-slate-400', open: '' };
  return (
    <AccordionItem
      value={value}
      className={cn(
        'rounded-xl border bg-background/60 px-3 transition-all duration-200 hover:shadow-sm data-[state=open]:bg-card data-[state=open]:shadow-md',
        tone.open,
      )}
    >
      <AccordionTrigger className="py-2.5 hover:no-underline">
        <span className="flex flex-1 flex-wrap items-center gap-2 pr-2 text-left">
          <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background', tone.dot)} />
          <span className="text-[12px] font-bold">{label}</span>
          {dropped ? (
            <Badge
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400"
            >
              Dikeluarkan dari perhitungan
            </Badge>
          ) : weight != null ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-muted sm:inline-block">
                <span className={cn('block h-full rounded-full', tone.bar)} style={{ width: `${Math.round(weight * 100)}%` }} />
              </span>
              <Badge variant="outline" className="text-[10px] tabular-nums">
                bobot {(weight * 100).toFixed(1)}%
              </Badge>
            </span>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3">
        {dropped && (
          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
            Kriteria ini tidak dapat dinilai untuk satu pun kandidat pada run ini, sehingga
            dikeluarkan dari perhitungan dan bobotnya dibagikan ke kriteria lain. Alasan: {dropped}
          </p>
        )}
        {children}
      </AccordionContent>
    </AccordionItem>
  );
}

function anchorSourceLabel(source?: 'env' | 'measured' | 'fallback'): string {
  if (source === 'env') return 'Ditetapkan manual';
  if (source === 'measured') return 'Dihitung dari isi kamus';
  if (source === 'fallback') return 'Nilai cadangan';
  return 'Sumber tidak tercatat';
}

/** Which tier supplied the position's required-competency list. */
function requiredSourceLabel(source?: string): string {
  switch (source) {
    case 'profile':
      return 'dokumen job profile posisi';
    case 'critical_position':
      return 'daftar kompetensi yang diisi pada posisi';
    case 'incumbent':
      return 'kompetensi pemegang jabatan saat ini';
    case 'position_aggregate':
      return 'gabungan kompetensi seluruh pemegang jabatan';
    case 'none':
      return 'tidak ada acuan';
    default:
      return 'tidak tercatat';
  }
}

/** Where the career experience target came from. */
function depthSourceLabel(source?: 'pool' | 'fixed' | 'inherited'): string {
  if (source === 'pool') return 'sebaran kandidat run ini';
  if (source === 'fixed') return 'nilai tetap dari konfigurasi';
  if (source === 'inherited') return 'mengikuti run dasar';
  return 'tidak tercatat';
}

/** Short badge form of the same thing, for the T-derivation header. */
type DepthSource = 'jd' | 'measured' | 'fixed' | 'inherited' | 'pool';

function depthSourceBadge(source?: DepthSource): string {
  if (source === 'pool') return 'Aturan lama: dihitung dari pool run ini';
  if (source === 'jd') return 'Dari syarat job profile';
  if (source === 'measured') return 'Diukur dari pengangkatan nyata';
  if (source === 'fixed') return 'Angka tetap konfigurasi';
  if (source === 'inherited') return 'Diwarisi run dasar';
  return 'Sumber tidak tercatat';
}

/**
 * `pool` is the amber one on purpose, and now for a stronger reason than when it
 * was the normal case: it can only appear on a run finished before the yardstick
 * became absolute, and a pool-derived T shrank exactly when the bench was weak —
 * so those scores read higher than a later run's for the same person. Every other
 * source keeps runs comparable, hence emerald.
 */
function depthSourceTone(source?: DepthSource): string {
  if (source === 'pool')
    return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  // `fixed` is the amber one among the current sources: it is the only value in
  // the whole career criterion that is NOT derived from data, so it should read
  // as "this deployment has not got enough history yet", not as a house standard.
  if (source === 'fixed')
    return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  if (source === 'jd' || source === 'measured' || source === 'inherited')
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

/**
 * The three anchor estimators, named for a reader rather than by their enum. The
 * labels carry their own trust ordering on purpose: `transitions` is the only one
 * that does not measure the embedding with the embedding.
 */
function anchorEstimatorLabel(source: 'corpus' | 'family' | 'transitions'): string {
  if (source === 'corpus') return 'Sebaran dokumen sembarang';
  if (source === 'family') return 'Kurva ketepatan rumpun jabatan';
  if (source === 'transitions') return 'Perpindahan jabatan nyata';
  return source;
}

function anchorTone(source?: 'env' | 'measured' | 'fallback'): string {
  if (source === 'measured')
    return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  if (source === 'fallback')
    return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-muted-foreground/30 bg-muted text-muted-foreground';
}

function KeyVal({
  label,
  value,
  origin,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Where the value came from (I-3), when the snapshot says. */
  origin?: SnapOrigin;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'group/kv rounded-xl border bg-background/60 px-3 py-2 transition-colors duration-200 hover:border-foreground/15 hover:bg-muted/30',
        className,
      )}
    >
      <p className="flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {origin ? <OriginTag origin={origin} /> : null}
      </p>
      <div className="mt-0.5 text-xs font-medium break-words">{value}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'good' | 'warn' | 'info' | 'accent';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-linear-to-br to-card p-3 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
        tone === 'default' && 'from-slate-500/6',
        tone === 'good' && 'border-emerald-200/70 from-emerald-500/10 dark:border-emerald-900/50',
        tone === 'warn' && 'border-rose-200/70 from-rose-500/10 dark:border-rose-900/50',
        tone === 'info' && 'border-sky-200/70 from-sky-500/10 dark:border-sky-900/50',
        tone === 'accent' && 'border-amber-200/70 from-amber-500/12 dark:border-amber-900/50',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The arrow between two funnel steps — horizontal on wide screens only. */
function FunnelArrow() {
  return (
    <span aria-hidden className="hidden items-center justify-center text-muted-foreground/50 lg:flex">
      <ChevronRight className="h-5 w-5" />
    </span>
  );
}

/** One leaf eligibility rule, written the way governance authored it. */
function RuleLine({ rule }: { rule: FilterRule }) {
  const value = Array.isArray(rule.value) ? rule.value.join(', ') : rule.value;
  const needsValue = rule.operator !== 'isExpired' && rule.operator !== 'notExpired';
  // A rule frozen while switched off took no part in this run's filtering; it
  // is shown (it was in the configuration) but never as if it had applied.
  const off = rule.enabled === false;
  return (
    <div className={`rounded-md border bg-background px-2.5 py-1.5 ${off ? 'border-dashed opacity-60' : ''}`}>
      <p className="text-[11px]">
        <span className="font-semibold">{FIELD_LABELS[rule.field] ?? rule.field}</span>{' '}
        <span className="text-muted-foreground">
          {OPERATOR_LABELS[rule.operator] ?? rule.operator}
        </span>{' '}
        {needsValue && value != null && value !== '' && (
          <span className="font-mono font-medium">{String(value)}</span>
        )}{' '}
        {off && (
          <span className="rounded border border-dashed px-1 py-px text-[9px] font-semibold uppercase text-muted-foreground">
            nonaktif — tidak diterapkan
          </span>
        )}{' '}
        {rule.severity === 'advisory' && (
          <span className="rounded border border-amber-300 bg-amber-50 px-1 py-px text-[9px] font-semibold text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
            hanya menandai
          </span>
        )}
      </p>
      {rule.message && (
        <p className="text-[10px] italic text-muted-foreground">
          {/* An advisory rule never disqualified anyone, so "Gagal:" would
              misdescribe what this run did with it. */}
          {rule.severity === 'advisory' ? 'Ditandai: ' : 'Gagal: '}
          {rule.message}
        </p>
      )}
    </div>
  );
}

/** Recursive AND/OR tree — the eligibility condition exactly as configured. */
function FilterNode({ node }: { node: FilterCondition }) {
  if (node.kind === 'rule') return <RuleLine rule={node.rule} />;
  if (node.children.length === 0)
    return <p className="text-[11px] italic text-muted-foreground">(kosong)</p>;
  return (
    <div className="space-y-1.5">
      {node.children.map((child, i) => (
        <div key={i} className="space-y-1.5">
          {i > 0 && (
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider"
              >
                {node.op === 'and' ? 'DAN' : 'ATAU'}
              </Badge>
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
          {child.kind === 'group' ? (
            <div className="rounded-lg border border-dashed bg-muted/20 p-2">
              <FilterNode node={child} />
            </div>
          ) : (
            <FilterNode node={child} />
          )}
        </div>
      ))}
    </div>
  );
}

export function RunConfigurationPanel({ runId }: { runId: string }) {
  const [config, setConfig] = useState<RunConfiguration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showDisqualified, setShowDisqualified] = useState(false);
  const [showFlagged, setShowFlagged] = useState(false);
  // The matrix as judged (Saaty, 1/5) or as stored (full-precision decimals).
  const [matrixView, setMatrixView] = useState<'saaty' | 'decimal'>('saaty');
  // The run's snapshot (FR-SN-01) is read beside the configuration and its
  // items are placed in the section each belongs to. Called before the early
  // returns below, as hooks must be.
  const snap = useRunSnapshot(runId);
  const reproCheck = useReproducibilityCheck(runId);
  const traceExport = useTraceExport(runId);

  useEffect(() => {
    let active = true;
    setConfig(null);
    setError(null);
    getRunConfigurationAction(runId)
      .then((data) => {
        if (!active) return;
        if (!data) setError('Konfigurasi run tidak ditemukan.');
        else setConfig(data);
      })
      .catch((err) => {
        console.error('getRunConfiguration failed', err);
        if (active) setError('Konfigurasi run tidak dapat dimuat.');
      });
    return () => {
      active = false;
    };
  }, [runId, reloadKey]);

  // Consistency coefficients, recomputed from the same constants the engine
  // used so the check can be read as a formula rather than a bare verdict.
  const consistency = useMemo(() => {
    if (!config) return null;
    const n = config.ahp.criteriaOrder.length || CRITERIA.length;
    return {
      n,
      lambdaMax: config.ahp.lambdaMax,
      ci: config.ahp.consistencyIndex,
      ri: randomConsistencyIndex(n),
      cr: config.ahp.consistencyRatio,
      ok: !config.ahp.inconsistent,
    };
  }, [config]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-500" />
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Coba lagi
        </Button>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Memuat konfigurasi run…
      </div>
    );
  }

  const { run, origin, template, pool, ahp, ahpRun, runInfo, readiness, readinessFromSnapshot } =
    config;
  const order = ahp.criteriaOrder.length ? ahp.criteriaOrder : CRITERIA.map((c) => c.key);
  /**
   * Why a criterion was left out of the TOPSIS matrix, or null when it counted.
   * Read from the run's own record, not inferred: a criterion can be dropped
   * because nobody could be scored on it, and the weight it would have carried
   * is then redistributed — so its dropdown must say so rather than showing a
   * weight the ranking never used.
   */
  const droppedReason = (key: string) =>
    ahpRun?.droppedCriteria?.find((d) => d.key === key)?.reason ?? null;
  const hasMatrix = ahp.pairwise.length > 0;
  const dropped = ahpRun?.droppedCriteria ?? [];
  const encryptionGap = runInfo?.encryption ?? null;
  const narrativeInfo = runInfo?.narrative ?? null;
  // Defaults to 2, NOT to today's config: every run that predates this field was
  // scored with the stated requirement doubled, and reading it as ×1 would
  // relabel those runs' arithmetic with a rule they never used.
  const statedMult = runInfo?.career?.depth?.statedExperienceMultiplier ?? 2;
  // Only worth a line when some bullet on this run is canned: an all-LLM run needs
  // no disclaimer, and a run from before the agent existed has nothing to report.
  // Not for a demo run: its template narrative is intended, not a fallback, and
  // demo mode carries no indicator on the page.
  const narrativeFallback =
    narrativeInfo && narrativeInfo.templateFallback > 0 && narrativeInfo.disabledBy !== 'demo'
      ? narrativeInfo
      : null;
  const effectiveWeights = ahpRun?.effectiveWeights ?? null;
  // Effective weights only differ from the priority vector when a criterion was
  // dropped — showing an identical second column otherwise is just noise.
  const showEffective = Boolean(effectiveWeights) && dropped.length > 0;

  const snapCfg = snap ? snap.config : null;
  // Input check of the matrix this run used (docs/ahp-input-sync.md §8): the
  // engine's own flag when it recorded one, else the same validateAhpPairwise
  // run here, labelled as checked at display time.
  const ahpInfo = (runInfo as { ahp?: { inputCheck?: AhpInputCheck; pairwisePrecision?: string; weightSource?: string } } | null)?.ahp;
  const recordedCheck = ahpInfo?.inputCheck ?? null;
  const inputCheck: AhpInputCheck | null = hasMatrix
    ? recordedCheck ??
      ahpInputCheck(
        ahp.pairwise,
        ahpInfo?.weightSource === 'default' || ahpInfo?.weightSource === 'inherited' ? ahpInfo.weightSource : 'ahp-matrix',
        order,
        ahpInfo?.pairwisePrecision === 'full' ? 1e-6 : 1e-3,
      )
    : null;
  const depthSource =
    (snap?.raw as { runInfo?: { career?: { depth?: { source?: string } } } } | undefined)?.runInfo?.career?.depth
      ?.source ?? null;
  const scored = pool.scoredCandidates ?? pool.qualifiedCount;
  const finalists = pool.finalists ?? run.candidateCount;
  const sortedTimings = snap ? [...snap.identity.timings].sort((x, y) => phaseRank(x.phase) - phaseRank(y.phase)) : [];
  const timingTotal = sortedTimings.reduce((s, t) => s + t.ms, 0);
  // The snapshot's own copy of the weight source, shown beside the engine's only
  // when the two disagree — they are two readings of one fact, and printing an
  // identical second line would be noise, not information.
  const snapWeightSource = snapCfg?.weightSource ?? null;
  const weightSourceDiffers = snapWeightSource != null && snapWeightSource !== ahp.weightSource;
  const nominalTotal = snapCfg?.weights ? SNAP_CRITERIA.reduce((s, k) => s + (snapCfg.weights?.[k] ?? 0), 0) || 1 : 1;

  const navItems: SectionNavItem[] = [
    { id: 'cfg-identitas', label: 'Identitas', accent: 'sky' },
    { id: 'cfg-kandidat', label: 'Kandidat', accent: 'emerald', count: scored },
    { id: 'cfg-aturan', label: 'Aturan filter', accent: 'rose', count: template?.ruleCount ?? null },
    { id: 'cfg-bobot', label: 'Bobot AHP', accent: 'violet' },
    { id: 'cfg-kesiapan', label: 'Kesiapan', accent: 'amber' },
    { id: 'cfg-basis', label: 'Basis & parameter', accent: 'teal' },
    { id: 'cfg-versi', label: 'Data & model', accent: 'slate' },
    ...(runInfo ? [{ id: 'cfg-rumus', label: 'Cara dinilai', accent: 'indigo' as const }] : []),
  ];

  return (
    <div className="space-y-4">
      <SectionShellStyles />

      {/* ── Hero: which run, how it was computed, and the five numbers a
          reviewer asks about first. Every tile jumps to the section that
          explains it. ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border border-indigo-200/70 bg-linear-to-br from-indigo-500/12 via-violet-500/6 to-card p-4 shadow-sm dark:border-indigo-900/60 dark:from-indigo-500/18 dark:via-violet-500/8">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/15" />
        <span aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-violet-400/15 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 dark:bg-indigo-500">
            <SlidersHorizontal className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-indigo-700/80 dark:text-indigo-300/80">
              Konfigurasi run
              <InfoHint title="Konfigurasi run" size="xs">
                <p>
                  Semua yang <strong>menentukan</strong> peringkat run ini — pool dan aturan filter yang membentuknya,
                  matriks AHP beserta bobot dan uji konsistensinya, kriteria yang masuk matriks TOPSIS, ambang kesiapan,
                  basis posisi, versi data, dan model — bukan hasilnya.
                </p>
                <p>
                  Yang ditampilkan adalah konfigurasi yang <strong>dibekukan saat run dibuat</strong>, beserta asal setiap
                  nilainya. Tidak ada butir yang dibaca dari tata kelola hari ini; butir yang tidak disimpan run lama
                  tertulis &ldquo;{NOT_STORED}&rdquo;.
                </p>
              </InfoHint>
            </p>
            <h2 className="mt-0.5 text-base font-bold leading-snug">
              <span className="mr-2 font-mono text-indigo-700 dark:text-indigo-300">{shortRunId(run.runId)}</span>
              <span className="break-words">{run.label ?? 'Tanpa label'}</span>
            </h2>
          </div>
        </div>
        {/* Badges on the left, the three actions on the right — a row of their
            own, so a long run label keeps the full width above them. */}
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
              <Badge className="border-violet-500/30 bg-violet-500/15 text-[10px] text-violet-700 dark:text-violet-300">
                AHP + TOPSIS
              </Badge>
              <Badge variant="outline" className="bg-background/60 text-[10px] capitalize">
                {run.status}
              </Badge>
              {snap && (
                <Badge variant="outline" className="bg-background/60 text-[10px]">
                  {snap.identity.kind}
                </Badge>
              )}
              {template && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    template.source === 'live-fallback'
                      ? 'border-amber-300/70 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      : 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                  )}
                >
                  <Lock className="mr-1 h-3 w-3" aria-hidden />
                  {TEMPLATE_SOURCE_LABELS[template.source] ?? template.source}
                </Badge>
              )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-background/70 text-xs backdrop-blur"
              disabled={!snap || reproCheck.checking}
              onClick={reproCheck.check}
            >
              {reproCheck.checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Periksa keterulangan
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-background/70 text-xs backdrop-blur"
              disabled={!snap}
              onClick={() => snap && downloadSnapshot(snap)}
            >
              <Download className="h-3.5 w-3.5" />
              Unduh snapshot (JSON)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 bg-background/70 text-xs backdrop-blur"
              disabled={traceExport.exporting}
              title="Workbook berisi setiap angka antara data mentah kandidat dan peringkat akhir, lengkap dengan rumus Excel yang hidup — untuk verifikasi dan penelusuran manual."
              onClick={traceExport.run}
            >
              {traceExport.exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
              {traceExport.exporting ? 'Menyusun trace…' : 'Unduh trace perhitungan (XLSX)'}
            </Button>
          </div>
        </div>

        <div className="relative mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <KpiTile
            label="Kandidat dinilai"
            value={scored}
            sub={`${pool.qualifiedCount} lolos filter · ${pool.totalEvaluated} dievaluasi`}
            accent="emerald"
            icon={Filter}
            onClick={() => jumpToSection('cfg-kandidat')}
          />
          <KpiTile
            label="Finalis (N)"
            value={finalists}
            sub={pool.targetFinalists != null ? `Target ${pool.targetFinalists} finalis` : 'Target tidak tercatat'}
            accent="amber"
            icon={Target}
            onClick={() => jumpToSection('cfg-kesiapan')}
          />
          <KpiTile
            label="Konsistensi AHP"
            value={consistency ? `CR ${fx(consistency.cr, 4)}` : '—'}
            sub={consistency ? (consistency.ok ? 'Konsisten — bobot layak' : 'Tidak konsisten — tinjau bobot') : undefined}
            accent={consistency && !consistency.ok ? 'rose' : 'violet'}
            icon={Gauge}
            onClick={() => jumpToSection('cfg-bobot')}
          />
          <KpiTile
            label="Sumber bobot"
            value={<span className="text-sm">{WEIGHT_SOURCE_SHORT[ahp.weightSource] ?? ahp.weightSource}</span>}
            sub={ORIGIN_LABELS[ahp.origin] ?? ahp.origin}
            accent="violet"
            icon={Scale}
            onClick={() => jumpToSection('cfg-bobot')}
          />
          <KpiTile
            label="Tanggal acuan"
            value={<span className="text-sm">{snapCfg?.referenceDate ? fmtDate(snapCfg.referenceDate) : '—'}</span>}
            sub={snapCfg ? SNAP_ORIGIN_LABEL[snapCfg.referenceDateOrigin] : 'Memuat snapshot…'}
            accent="teal"
            icon={CalendarClock}
            onClick={() => jumpToSection('cfg-basis')}
          />
        </div>
      </div>

      {traceExport.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
          <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
          <span>{traceExport.error}</span>
        </p>
      )}

      {reproCheck.repro && <ReproducibilityNotice repro={reproCheck.repro} />}

      {/* The one banner that invalidates everything below it: an older run that
          could not read the then-encrypted candidate columns, so four aspects are placeholders
          rather than measurements. Placed first because reading the pairwise
          matrix of a run whose inputs were unreadable is time wasted. */}
      {encryptionGap && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-300/70 bg-rose-50/60 p-3 text-[12px] leading-relaxed dark:border-rose-900/60 dark:bg-rose-950/25">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <div className="space-y-1">
            <p className="font-medium text-rose-800 dark:text-rose-200">
              Data kandidat terenkripsi tidak terbaca saat run ini berjalan (
              {encryptionGap.unreadableCandidates}/{encryptionGap.totalCandidates} kandidat)
            </p>
            <p className="text-rose-700/90 dark:text-rose-300/90">
              Scoring service tidak dapat membuka master key ({encryptionGap.masterKeyFile}), sehingga kolom
              pendidikan, jurusan, rekomendasi behavior, kuadran HAV dan grade performance terbaca kosong.
              Aspek <b>{encryptionGap.affectedAspects.join(', ')}</b> pada run ini adalah nilai default
              (behavior 0, education 0, HAV 40, performance 33) — bukan hasil pengukuran. Peringkatnya efektif
              hanya ditentukan technical dan career. Jalankan scoring ulang untuk mendapatkan peringkat yang
              terukur.
            </p>
          </div>
        </div>
      )}

      {narrativeFallback && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200/70 bg-amber-50/40 p-2.5 text-[11px] leading-relaxed dark:border-amber-900/50 dark:bg-amber-950/20">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {narrativeFallback.llmEnabled ? (
              <>
                Insight suksesi {narrativeFallback.templateFallback} dari{' '}
                {narrativeFallback.templateFallback + narrativeFallback.llmWritten} finalis pada run ini
                memakai <b>teks template per aspek</b>, bukan tulisan LLM — panggilan penulisnya gagal
                atau balasannya tidak terpakai.
              </>
            ) : (
              <>
                Insight suksesi pada run ini seluruhnya memakai <b>teks template per aspek</b> karena
                penulis LLM dimatikan (<code>AHP_NARRATIVE_LLM=false</code>).
              </>
            )}{' '}
            Keunggulan Kompetitif, Kebutuhan Pengembangan dan Arahan Langkah Suksesi pada dosier finalis
            tersebut bersifat umum per aspek dan tidak menyebut kompetensi atau penugasan spesifik.
            Peringkat dan skor tidak terpengaruh.
          </span>
        </div>
      )}

      <SectionNav items={navItems} label="Bagian konfigurasi run" />

      {/* ── 1. Identitas & asal run ─────────────────────────────── */}
      <AccentSection
        id="cfg-identitas"
        number={1}
        accent="sky"
        icon={Layers}
        title="Identitas & asal run"
        info="Identitas run dan asal angkanya: siapa membuatnya, kapan, dari run mana ia diturunkan, dan berapa lama tiap tahap perhitungannya."
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <KeyVal label="Label run" value={run.label ?? '—'} />
          <KeyVal label="Posisi target" value={run.positionTitle} />
          <KeyVal
            label="Program"
            value={template?.name ?? run.program ?? '—'}
            origin={snapCfg?.filter.origin}
          />
          <KeyVal label="Business unit" value={snap ? (snap.identity.tenantName ?? NOT_STORED) : '…'} />
          <KeyVal
            label="Jenis run"
            value={
              <>
                <span className="font-mono">{shortRunId(run.runId)}</span>
                {snap ? ` · ${snap.identity.kind}` : ''}
              </>
            }
          />
          <KeyVal
            label="Induk · root"
            value={
              snap ? (
                <>
                  {snap.identity.parentRunId ? <span className="font-mono">{shortRunId(snap.identity.parentRunId)}</span> : '—'} ·{' '}
                  {snap.identity.rootRunId ? <span className="font-mono">{shortRunId(snap.identity.rootRunId)}</span> : 'run ini sendiri'}
                </>
              ) : (
                '…'
              )
            }
          />
          <KeyVal label="Pembuat" value={snap ? (snap.identity.createdByName ?? NOT_STORED) : '…'} />
          <KeyVal label="Mulai" value={fmtDate(run.createdAt)} />
          <KeyVal label="Selesai" value={snap && !snap.identity.completedAt && !run.completedAt ? 'belum selesai' : fmtDate(run.completedAt)} />
          <KeyVal
            label="Mode eksekusi"
            value={run.sessionMethod === 'ahp_topsis' ? 'Perhitungan deterministik (satu tahap)' : (run.sessionMethod ?? '—')}
          />
          <KeyVal className="sm:col-span-2" label="Alasan" value={snap ? (snap.identity.reason ?? '—') : '…'} />
        </div>

        {/* Where the time went, phase by phase, drawn to scale. Every number
            the old one-line list printed is still printed in the legend. */}
        <SubBlock title="Durasi per tahap" tone="muted">
          {!snap ? (
            <SnapshotPending view={snap} />
          ) : sortedTimings.length === 0 ? (
            <p className="text-xs text-muted-foreground">{NOT_STORED}</p>
          ) : (
            <>
              <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Proporsi durasi tiap tahap">
                {sortedTimings.map((t, i) => (
                  <span
                    key={t.phase}
                    className={cn('h-full transition-all duration-700', PHASE_COLORS[i % PHASE_COLORS.length])}
                    style={{ width: `${timingTotal > 0 ? Math.max(0.6, (t.ms / timingTotal) * 100) : 0}%` }}
                    title={`${PHASE_LABEL[t.phase] ?? t.phase} ${t.ms} ms`}
                  />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                {sortedTimings.map((t, i) => (
                  <li key={t.phase} className="inline-flex items-center gap-1.5">
                    <span aria-hidden className={cn('h-2 w-2 rounded-full', PHASE_COLORS[i % PHASE_COLORS.length])} />
                    <span className="text-muted-foreground">{PHASE_LABEL[t.phase] ?? t.phase}</span>
                    <span className="font-semibold tabular-nums">{t.ms.toLocaleString('id-ID')} ms</span>
                  </li>
                ))}
                {snap.identity.totalMs != null && (
                  <li className="ml-auto font-semibold tabular-nums">
                    Total {snap.identity.totalMs.toLocaleString('id-ID')} ms
                  </li>
                )}
              </ul>
            </>
          )}
        </SubBlock>

        {origin.kind !== 'full' && (
          <div className="flex items-start gap-2 rounded-xl border border-sky-200/70 bg-sky-50/50 p-3 text-[11px] leading-relaxed dark:border-sky-900/50 dark:bg-sky-950/20">
            <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
            <span>
              {origin.kind === 'exclude' ? (
                <>
                  <span className="mr-1 rounded border border-slate-400/50 bg-slate-400/10 px-1 py-px text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                    mode lama
                  </span>
                  Run ini adalah <strong>peringkat ulang setelah pengecualian</strong> dari run{' '}
                  <span className="font-medium">{origin.baseRunLabel ?? origin.baseRunId}</span>.
                  {origin.exclude?.reusedCandidates ?? 0} kandidat memakai nilai technical,
                  career dan education dari run dasar
                  {(origin.exclude?.recomputedCandidates ?? 0) > 0 &&
                    `, ${origin.exclude?.recomputedCandidates} kandidat dinilai ulang karena tidak punya snapshot`}
                  {' '}— behavior, performance dan HAV tetap dibaca ulang dari data kandidat saat ini,
                  dan yang dihitung ulang hanya TOPSIS, dengan {origin.exclude?.excludedCount ?? 0} kandidat
                  dikeluarkan dari himpunan alternatif.
                  {/* The three cheap aspects being live is deliberate (it keeps
                      those columns consistent across the re-ranked pool), but on
                      the default matrix they carry 65% of the weight, so a
                      carried-over candidate can move for a reason that is not the
                      exclusion. Said out loud only when it actually happened. */}
                  {(origin.freshness?.changedCandidates ?? 0) > 0 && (
                    <>
                      {' '}
                      <strong className="text-amber-700 dark:text-amber-300">
                        {origin.freshness!.changedCandidates} kandidat lama nilainya berubah sejak
                        run dasar
                      </strong>{' '}
                      (behavior {origin.freshness!.byAspect.behavior}, performance{' '}
                      {origin.freshness!.byAspect.performance}, HAV {origin.freshness!.byAspect.hav}),
                      jadi sebagian pergeseran berasal dari data HR yang diperbarui.
                    </>
                  )}
                </>
              ) : origin.rerun ? (
                <>
                  Run ini adalah <strong>Tambah Kandidat Pembanding</strong> atas run{' '}
                  <span className="font-medium">{origin.baseRunLabel ?? origin.baseRunId}</span>
                  {origin.rerun.rootRunId !== origin.rerun.parentRunId && ' (root lineage tetap tercatat)'}.
                  Run induk dibekukan apa adanya — keenam skor aspek dan data mentah kandidat lama,
                  bobot AHP setelah pembagian ulang ({origin.rerun.frozen?.ahp?.source === 'parent' ? 'dari run induk' : 'run induk tidak mencatatnya, diambil dari nilai saat run ini dihitung'}),
                  kriteria aktif, aturan filter, jangkar kalibrasi ({origin.rerun.anchorsSource === 'parent' ? 'dari run induk' : 'run induk tidak mencatatnya — nilai live dipakai dan dicatat'}),
                  dan tanggal acuan {formatDateTime(origin.rerun.frozen?.referenceDate)}. Hanya{' '}
                  {origin.rerun.added.filter((a) => a.classification === 'new').length} kandidat
                  yang belum ada di pool induk dinilai, dengan data per{' '}
                  {formatDateTime(origin.rerun.dataPulledAt)}
                  {origin.rerun.added.some((a) => a.classification === 'existing_pool') &&
                    `; ${origin.rerun.added.filter((a) => a.classification === 'existing_pool').length} kandidat dari pool induk ditampilkan tanpa dinilai ulang`}
                  .
                  <span className="mt-1 block">
                    <strong>Alasan / permintaan forum:</strong> {origin.rerun.reason}
                  </span>
                  {origin.rerun.skipped.length > 0 && (
                    <span className="mt-1 block text-muted-foreground">
                      Tidak ditambahkan:{' '}
                      {origin.rerun.skipped
                        .map((x) => `${x.name ?? x.candidateId} (${x.message})`)
                        .join('; ')}
                      .
                    </span>
                  )}
                  {(origin.freshness?.changedCandidates ?? 0) > 0 && (
                    <span className="mt-1 block text-amber-700 dark:text-amber-300">
                      {origin.freshness!.reason}
                    </span>
                  )}
                </>
              ) : (
                <>
                  {/* An incremental run created before the full freeze: same mode,
                      but weights, active criteria, anchors and reference date
                      were still read live, so it is labelled rather than
                      presented as the current rule. */}
                  <span className="mr-1 rounded border border-slate-400/50 bg-slate-400/10 px-1 py-px text-[9px] font-semibold text-slate-600 dark:text-slate-300">
                    sebelum pembekuan penuh
                  </span>
                  Run ini adalah <strong>penambahan kandidat</strong> atas run{' '}
                  <span className="font-medium">{origin.baseRunLabel ?? origin.baseRunId}</span>:{' '}
                  {origin.augment?.computedCandidates ?? 0} kandidat dinilai baru,{' '}
                  {origin.augment?.reusedCandidates ?? 0} kandidat memakai nilai aspek run dasar, lalu
                  TOPSIS dihitung ulang atas gabungannya.
                  {/* Which alternative set the re-rank ran over decides whether this
                      ranking is comparable to its base at all — TOPSIS is
                      set-relative, so a truncated set reorders untouched
                      candidates on its own. Absent on runs finished before this
                      was recorded. */}
                  {origin.augment?.poolSource === 'finalists_only' && (
                    <>
                      {' '}
                      <strong className="text-amber-700 dark:text-amber-300">
                        Himpunan alternatifnya hanya finalis run dasar
                      </strong>{' '}
                      (run dasar tidak menyimpan snapshot aspek seluruh pool), jadi peringkat
                      kandidat lama bisa bergeser karena penyempitan himpunan itu — bukan karena
                      kandidat yang ditambahkan.
                    </>
                  )}
                  {origin.augment?.poolSource === 'pool_snapshot' && (
                    <>
                      {' '}
                      Himpunan alternatifnya adalah seluruh kandidat yang dinilai run dasar, sama
                      seperti run dasar, sehingga kedua peringkat setara untuk dibandingkan.
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}
      </AccentSection>

      {/* ── 2. Himpunan kandidat ─────────────────────────────────── */}
      <AccentSection
        id="cfg-kandidat"
        number={2}
        accent="emerald"
        icon={Users}
        title="Himpunan kandidat"
        info="Urutan penyaringan yang membentuk pool yang dinilai, dari gerbang awal sampai finalis. Angka di sini tercatat saat run dijalankan."
      >
        {/* The funnel, left to right, as the engine applies it. */}
        <div className="grid items-stretch gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
          <Stat label="Lolos gerbang awal" value={pool.totalEvaluated} hint="Setelah rentang level & incumbent" />
          <FunnelArrow />
          <Stat
            label="Lolos filter program"
            value={pool.qualifiedCount}
            hint={`${pool.disqualifiedCount} kandidat gugur`}
            tone="good"
          />
          <FunnelArrow />
          <Stat label="Dinilai (TOPSIS)" value={scored} hint="Masuk matriks keputusan" tone="info" />
          <FunnelArrow />
          <Stat
            label="Finalis"
            value={finalists}
            hint={pool.targetFinalists != null ? `Target ${pool.targetFinalists} finalis` : undefined}
            tone="accent"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <KeyVal
            label="Rentang level (grade)"
            origin={snapCfg?.filter.origin}
            value={
              pool.minGradeName || pool.maxGradeName ? (
                <>
                  {pool.minGradeName ?? '—'} – {pool.maxGradeName ?? '—'}
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                    ({pool.minGradeId ?? '—'}…{pool.maxGradeId ?? '—'})
                  </span>
                </>
              ) : (
                'Tanpa batas level'
              )
            }
          />
          <KeyVal
            label="Business unit pool"
            value={
              <span className="inline-flex flex-wrap items-center gap-1">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                {pool.businessUnits.map((bu) => (
                  <Badge key={bu.id} variant="secondary" className="text-[10px]">
                    {bu.name}
                  </Badge>
                ))}
              </span>
            }
          />
          <KeyVal
            label="Incumbent (dikecualikan)"
            value={
              pool.incumbent ? (
                <span className="inline-flex items-center gap-1">
                  <UserX className="h-3 w-3 text-muted-foreground" />
                  {pool.incumbent.name ?? '—'}
                  {pool.incumbent.employeeId && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      ({pool.incumbent.employeeId})
                    </span>
                  )}
                </span>
              ) : (
                'Posisi tanpa pemegang tercatat'
              )
            }
          />
        </div>

        {/* The candidate-set items of the snapshot (FR-SN-01 §2). */}
        {!snap ? (
          <SnapshotPending view={snap} />
        ) : (
          <SnapshotList>
            <SnapshotItem label="Anggota pool">
              {snap.candidates.poolSize} kandidat{' '}
              {snap.candidates.poolSource === 'pool_snapshot'
                ? '(skor aspek seluruh pool tersimpan)'
                : '(hanya finalis tersimpan)'}
            </SnapshotItem>
            <SnapshotItem label="Hasil penyaringan">
              {snap.candidates.evaluated != null
                ? `${snap.candidates.evaluated} dievaluasi, ${snap.candidates.qualified ?? '—'} lolos, ${snap.candidates.disqualified.length} gugur`
                : NOT_STORED}
              {snap.candidates.disqualified.length > 0 && pool.disqualified.length === 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-[11px] text-primary">Alasan per karyawan</summary>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                    {snap.candidates.disqualified.map((d, i) => (
                      <li key={i}>
                        {d.name}: {d.reasons.join('; ')}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </SnapshotItem>
            <SnapshotItem label="Masuk walau gagal aturan">
              {snap.candidates.forceIncluded.length > 0
                ? snap.candidates.forceIncluded
                    .map((f) => `${f.name} (${f.source}${f.reasons.length ? `: ${f.reasons.join('; ')}` : ''})`)
                    .join(' · ')
                : '—'}
            </SnapshotItem>
            <SnapshotItem label="Kandidat tambahan">
              {snap.candidates.added.length > 0
                ? snap.candidates.added
                    .map((a) => `${a.name} (${a.classification}${a.outOfRange ? ', di luar rentang grade' : ''})`)
                    .join(' · ')
                : '—'}
            </SnapshotItem>
            <SnapshotItem label="Ditolak">
              {snap.candidates.skipped.length > 0
                ? snap.candidates.skipped.map((s) => `${s.name ?? 'Kandidat'} (${s.message})`).join(' · ')
                : '—'}
            </SnapshotItem>
            <SnapshotItem label="Dibawa dari induk (data kini dihapus / kini pejabat)">
              {snap.candidates.carriedDeleted != null ? `${snap.candidates.carriedDeleted} kandidat` : '—'}
            </SnapshotItem>
            <SnapshotItem label="Skala TOPSIS (pembagi dan titik ideal)">
              {snap.config.topsis.mode === 'anchored'
                ? `Skala run induk${snap.config.topsis.source === 'parent_pool' ? ' (diturunkan dari pool tersimpannya)' : ''} — kecocokan kandidat lama sama persis dengan di run induk, kandidat pembanding disisipkan.`
                : snap.config.topsis.recorded || !snap.config.weights
                  ? 'Dihitung dari pool run ini.'
                  : 'Dihitung dari pool run ini (run dibuat sebelum skala TOPSIS dicatat).'}
              {snap.candidates.topsisClamped && snap.candidates.topsisClamped.length > 0 && (
                <>
                  {' '}Di luar rentang run induk, sehingga dihitung pada ujung rentang itu (di atas
                  nilai terbaik → setara terbaik; di bawah nilai terendah → setara terendah):{' '}
                  {snap.candidates.topsisClamped
                    .map((c) => {
                      const label = (ks: string[]) => ks.map((k) => CRITERION_LABEL[k] ?? k).join(', ');
                      const parts =
                        c.above || c.below
                          ? [
                              c.above?.length ? `di atas: ${label(c.above)}` : null,
                              c.below?.length ? `di bawah: ${label(c.below)}` : null,
                            ].filter(Boolean)
                          : [label(c.criteria)];
                      return `${c.name} (${parts.join('; ')})`;
                    })
                    .join(' · ')}
                  .
                </>
              )}
            </SnapshotItem>
          </SnapshotList>
        )}

        {/* A derived run inherits the base run's grade range and business units
            but starts from an already-filtered pool, so it records no
            disqualifications of its own — say so instead of showing an empty
            list that reads as "nobody was filtered out". */}
        {origin.kind !== 'full' && (
          <p className="flex items-start gap-1.5 rounded-lg bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-px h-3 w-3 shrink-0" />
            Run turunan: penyaringan program dijalankan pada run dasar
            {origin.baseRunLabel ? ` (${origin.baseRunLabel})` : ''}, bukan di sini. Rentang level dan
            business unit di atas diwarisi dari run dasar, dan daftar kandidat gugur filter ada pada
            run dasar tersebut.
          </p>
        )}

        {/* Who actually failed, and on which rule */}
        {pool.disqualified.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-rose-200/70 dark:border-rose-900/50">
            <button
              type="button"
              onClick={() => setShowDisqualified((v) => !v)}
              aria-expanded={showDisqualified}
              className="flex w-full items-center justify-between gap-2 bg-rose-500/5 px-3 py-2 text-left transition-colors hover:bg-rose-500/10"
            >
              <span className="inline-flex items-center gap-2 text-xs font-semibold">
                <Ban className="h-3.5 w-3.5 text-rose-500" />
                Kandidat Gugur Filter
                <span className="rounded-full bg-rose-500/15 px-1.5 text-[10px] tabular-nums text-rose-700 dark:text-rose-300">
                  {pool.disqualified.length}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-300',
                  showDisqualified && 'rotate-180',
                )}
              />
            </button>
            {showDisqualified && (
              <div className="max-h-72 divide-y overflow-y-auto border-t animate-in fade-in-0 duration-200">
                {pool.disqualified.map((d) => (
                  <div key={d.candidateId} className="px-3 py-2">
                    <p className="text-xs font-medium">{d.name}</p>
                    {d.reasons.length > 0 ? (
                      <ul className="mt-0.5 space-y-0.5">
                        {d.reasons.map((r, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground">
                            • {r}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] italic text-muted-foreground">
                        Alasan tidak tercatat.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Advisory rules: reported, never acted on. These candidates WERE
            scored — that is the difference from the list above, and it is the
            whole reason the two are rendered separately. */}
        {pool.flagged.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-amber-200/70 dark:border-amber-900/50">
            <button
              type="button"
              onClick={() => setShowFlagged((v) => !v)}
              aria-expanded={showFlagged}
              className="flex w-full items-center justify-between gap-2 bg-amber-500/5 px-3 py-2 text-left transition-colors hover:bg-amber-500/10"
            >
              <span className="inline-flex items-center gap-2 text-xs font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                Kandidat Ditandai — tetap dinilai
                <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] tabular-nums text-amber-800 dark:text-amber-300">
                  {pool.flagged.length}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform duration-300',
                  showFlagged && 'rotate-180',
                )}
              />
            </button>
            {showFlagged && (
              <div className="max-h-72 divide-y overflow-y-auto border-t animate-in fade-in-0 duration-200">
                <p className="bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                  Aturan bertanda &ldquo;hanya menandai&rdquo; tidak menggugurkan siapa pun.
                  Orang-orang ini ikut dinilai dan masuk peringkat; temuannya dicatat di sini
                  supaya tidak hilang.
                </p>
                {pool.flagged.map((f) => (
                  <div key={f.candidateId} className="px-3 py-2">
                    <p className="text-xs font-medium">{f.name}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {f.rules.map((r, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground">
                          • {r.label}
                          {r.message ? `: ${r.message}` : ''}
                          {r.dataMissing && ' (data belum terisi)'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </AccentSection>

      {/* ── 3. Aturan filter ─────────────────────────────────────── */}
      <AccentSection
        id="cfg-aturan"
        number={3}
        accent="rose"
        icon={Filter}
        title={`Aturan filter${template ? ` — ${template.name}` : ''}`}
        info="Aturan filter program yang membentuk pool, persis seperti tersusun saat run dibuat: kelompok DAN/ATAU, aturan yang menggugurkan, dan aturan yang hanya menandai."
        aside={
          <>
            {template && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px]',
                  template.source === 'live-fallback'
                    ? 'border-amber-300/70 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                )}
              >
                {TEMPLATE_SOURCE_LABELS[template.source] ?? template.source}
              </Badge>
            )}
            {template && (
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px]',
                  template.enforceFilterRules
                    ? 'border-rose-300/70 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-slate-300/70 text-muted-foreground',
                )}
              >
                {template.enforceFilterRules === null
                  ? 'Penegakan aturan tidak tercatat'
                  : template.enforceFilterRules
                    ? 'Hard filter — kandidat gagal tidak dinilai'
                    : 'Tidak ditegakkan — hanya referensi'}
              </Badge>
            )}
            {snapCfg && <OriginTag origin={snapCfg.filter.origin} />}
          </>
        }
      >
        {!template ? (
          <p className="text-[11px] text-muted-foreground">
            Run ini dijalankan tanpa template program, sehingga tidak ada aturan filter.
          </p>
        ) : template.filterTree === null ? (
          // "Not recorded" is not "no rules": never render an empty tree for it.
          <p className="text-[11px] text-muted-foreground">
            Aturan filter tidak tersimpan pada snapshot run ini, sehingga tidak dapat ditampilkan.
          </p>
        ) : template.ruleCount === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Program ini tidak mendefinisikan aturan filter.
          </p>
        ) : (
          <div className="rounded-xl border bg-muted/20 p-3">
            <FilterNode node={template.filterTree} />
          </div>
        )}

        {template && template.source !== 'live-fallback' && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Lock className="mt-px h-3 w-3 shrink-0" />
            {template.source === 'inherited' ? (
              <>
                Salinan beku dari run dasar
                {origin.baseRunLabel ? ` (${origin.baseRunLabel})` : ''} — di sanalah aturan ini
                benar-benar diterapkan. Perubahan template di Tata Kelola setelah itu tidak
                mengubah tampilan ini.
              </>
            ) : (
              <>
                Dibekukan saat run dibuat{template.capturedAt ? ` (${fmtDate(template.capturedAt)})` : ''} —
                inilah aturan yang benar-benar dipakai menyaring pool. Perubahan template di Tata
                Kelola setelahnya tidak mengubah tampilan ini.
              </>
            )}
          </p>
        )}

        {template?.source === 'live-fallback' && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-500/8 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>
              Run ini dibuat sebelum konfigurasi ikut dibekukan, jadi aturan di atas dibaca dari
              template program <strong>saat ini</strong>
              {template.editedAfterRun
                ? ` — dan template itu memang sudah disimpan ulang setelah run selesai (${fmtDate(template.updatedAt)}), jadi hampir pasti berbeda dari yang berlaku waktu itu.`
                : ' dan bisa berbeda dari yang berlaku ketika run dijalankan.'}{' '}
              Daftar kandidat gugur di bagian Himpunan kandidat tetap hasil run yang sebenarnya.
            </span>
          </p>
        )}

        {/* The snapshot's flat rendering of the same rules, with its origin
            (FR-SN-01 §3) — kept one click away rather than printed twice. */}
        {snapCfg && (
          <details className="group rounded-xl border bg-background/60 px-3 py-2 text-xs">
            <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-muted-foreground transition-colors hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform duration-200 group-open:rotate-0" />
              Daftar ringkas aturan tersimpan ({snapCfg.filter.ruleLabels.length}) dan rentang grade
            </summary>
            <SnapshotList className="mt-2">
              <SnapshotItem label="Aturan filter" origin={snapCfg.filter.origin}>
                {snapCfg.filter.ruleLabels.length > 0 ? (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {snapCfg.filter.ruleLabels.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  NOT_STORED
                )}
              </SnapshotItem>
              <SnapshotItem label="Rentang grade" origin={snapCfg.filter.origin}>
                {snapCfg.gradeRange.min || snapCfg.gradeRange.max
                  ? `${snapCfg.gradeRange.min ?? '…'}–${snapCfg.gradeRange.max ?? '…'}`
                  : 'Tanpa batas grade'}
              </SnapshotItem>
            </SnapshotList>
          </details>
        )}
      </AccentSection>

      {/* ── 4. Pembobotan (AHP) ──────────────────────────────────── */}
      <AccentSection
        id="cfg-bobot"
        number={4}
        accent="violet"
        icon={Scale}
        title="Pembobotan (AHP)"
        info={
          <>
            <p>
              Matriks perbandingan berpasangan pada skala Saaty, dibaca per baris: nilai a<sub>ij</sub> = seberapa
              penting kriteria baris dibanding kriteria kolom. Matriks bersifat resiprokal (a<sub>ji</sub> = 1/a
              <sub>ij</sub>) dan diagonalnya selalu 1.
            </p>
            <p>
              Vektor prioritas adalah rata-rata geometrik tiap baris matriks, dinormalisasi hingga totalnya 100%.
              Uji konsistensi memeriksa apakah penilaian berpasangan saling masuk akal; bobot baru layak dipakai bila
              CR ≤ 0,1.
            </p>
          </>
        }
        aside={
          <>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                ahp.origin === 'run' || ahp.origin === 'snapshot'
                  ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : ahp.origin === 'template'
                    ? 'border-amber-300/70 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'border-slate-300/70 text-muted-foreground',
              )}
            >
              {ORIGIN_LABELS[ahp.origin] ?? ahp.origin}
            </Badge>
            {snapCfg && <OriginTag origin={snapCfg.weightsOrigin} />}
          </>
        }
      >
        {/* Where the weights came from — the line a reviewer reads first. */}
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl border border-violet-200/60 bg-violet-500/5 px-3 py-2 text-xs dark:border-violet-900/50">
          <span className="font-semibold text-violet-800 dark:text-violet-200">Sumber bobot</span>
          <span className="inline-flex min-w-0 flex-1 items-center gap-1.5">
            <span>{WEIGHT_SOURCE_LABELS[ahp.weightSource] ?? ahp.weightSource}</span>
            <InfoHint size="xs" kind="note" title="Matriks yang tidak konsisten">
              Matriks dengan CR &gt; 0,1 ditolak saat disimpan di tata kelola, sehingga run selalu memakai matriks
              tersimpan yang konsisten atau bobot bawaan sistem.
            </InfoHint>
          </span>
          {weightSourceDiffers && snapCfg && (
            <span className="w-full text-[11px] text-muted-foreground">
              Tercatat pada snapshot: {SNAP_WEIGHT_SOURCE_LABEL[snapWeightSource!] ?? snapWeightSource}
            </span>
          )}
          <span className="w-full text-[11px] leading-relaxed text-muted-foreground">
            {ahp.origin === 'run' &&
              'Matriks ini dicatat oleh engine pada saat perhitungan — persis yang dipakai merangking.'}
            {ahp.origin === 'snapshot' &&
              'Matriks ini dibekukan bersama run saat dibuat; engine run ini tidak mencatatnya sendiri (run lama).'}
            {ahp.origin === 'template' &&
              'Matriks ini dibaca dari template program SAAT INI karena run tidak mencatat maupun membekukannya (run lama) — bisa berbeda dari yang benar-benar dipakai.'}
          </span>
        </div>

        {/* Side by side only where the 6×6 matrix fits beside the weights;
            below that it stacks, so no column scrolls out of sight. */}
        <div className="grid gap-3 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Pairwise matrix */}
          <SubBlock
            title="Matriks perbandingan berpasangan"
            aside={
              hasMatrix && snapCfg?.pairwise ? (
                <div role="group" aria-label="Format angka matriks" className="inline-flex rounded-lg border p-0.5 text-[10px] font-semibold">
                  {(['saaty', 'decimal'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={matrixView === m}
                      onClick={() => setMatrixView(m)}
                      className={cn(
                        'rounded-md px-2 py-0.5 transition-colors',
                        matrixView === m ? 'bg-violet-600 text-white dark:bg-violet-500' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {m === 'saaty' ? 'Skala Saaty' : 'Desimal tersimpan'}
                    </button>
                  ))}
                </div>
              ) : null
            }
          >
            {!hasMatrix && !snapCfg?.pairwise ? (
              <p className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
                Matriks perbandingan tidak tercatat pada run ini, tidak ikut dibekukan, dan tidak bisa
                direkonstruksi dari template program (template dihapus, atau bobot AHP-nya dikosongkan).
                Bobot yang dipakai run tetap ditampilkan di samping.
              </p>
            ) : matrixView === 'decimal' || !hasMatrix ? (
              <div className="overflow-x-auto">
                <table className="text-[11px]">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th />
                      {SNAP_CRITERIA.map((k) => (
                        <th key={k} className="px-1.5 py-1 font-medium">
                          {SNAP_CRITERION_LABEL[k]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SNAP_CRITERIA.map((row, i) => (
                      <tr key={row} className="border-t border-border/50">
                        <th className="pr-2 text-left font-medium text-muted-foreground">{SNAP_CRITERION_LABEL[row]}</th>
                        {SNAP_CRITERIA.map((col, j) => {
                          const v = snapCfg?.pairwise?.[i]?.[j];
                          return (
                            <td key={col} className={cn('px-1.5 py-1 text-center font-mono tabular-nums', i === j && 'bg-muted/50 text-muted-foreground')}>
                              {v == null ? '—' : fmtNumber(v, v === Math.round(v) ? 0 : 3)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[520px] text-[11px]">
                  <thead>
                    <tr>
                      <th className="p-1.5 text-left font-medium text-muted-foreground">Kriteria</th>
                      {order.map((k) => (
                        <th key={k} className="p-1.5 text-center font-medium text-muted-foreground">
                          {CRITERIA.find((c) => c.key === k)?.short ?? k}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((rowKey, i) => (
                      <tr key={rowKey} className="border-t">
                        <td className="whitespace-nowrap p-1.5 font-medium">{CRITERION_LABEL[rowKey] ?? rowKey}</td>
                        {order.map((colKey, j) => {
                          const v = ahp.pairwise[i]?.[j] ?? 0;
                          return (
                            <td
                              key={colKey}
                              className={cn(
                                'p-1.5 text-center font-mono tabular-nums transition-colors',
                                i === j && 'bg-muted/50 text-muted-foreground',
                                i !== j && v > 1 && 'bg-emerald-500/8 font-semibold text-emerald-700 dark:text-emerald-400',
                                i !== j && v < 1 && 'bg-rose-500/5 text-rose-700 dark:text-rose-400',
                              )}
                            >
                              {fmtRatio(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          
            {hasMatrix && matrixView === 'saaty' && (
              <p className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/30" /> baris lebih penting
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/25" /> kolom lebih penting
                </span>
              </p>
            )}
          </SubBlock>

          {/* Priority weights — the engine's bars, with the snapshot's precise
              nominal and effective values and status beside each. */}
          <SubBlock
            title="Bobot per kriteria"
            aside={snapCfg ? <OriginTag origin={snapCfg.criteriaOrigin} /> : null}
          >
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="w-36 shrink-0">Kriteria</span>
              <span className="flex-1" />
              <span className="w-14 shrink-0 text-right">Bobot</span>
              {showEffective && <span className="w-20 shrink-0 text-right">Efektif</span>}
            </div>
            <div className="space-y-2">
              {order.map((k, idx) => {
                const w = ahp.weights[k] ?? 0;
                const eff = effectiveWeights?.[k];
                const isDropped = dropped.some((d) => d.key === k);
                const snapDropped = snapCfg?.droppedCriteria.find((d) => d.key === k);
                const snapNominal = snapCfg?.weights ? (snapCfg.weights[k as keyof typeof snapCfg.weights] ?? 0) / nominalTotal : null;
                const snapEff = snap?.effectiveWeights?.[k] ?? null;
                return (
                  <div key={k} className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn('w-36 shrink-0 truncate text-xs font-medium', isDropped && 'text-muted-foreground line-through')}>
                        {CRITERION_LABEL[k] ?? k}
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all duration-700 ease-out',
                            isDropped ? 'bg-slate-400' : WEIGHT_COLORS[idx % WEIGHT_COLORS.length],
                          )}
                          style={{ width: `${Math.round(w * 100)}%` }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right text-xs font-bold tabular-nums">{pct(w)}</span>
                      {showEffective && (
                        <span
                          className={cn(
                            'w-20 shrink-0 text-right text-[11px] tabular-nums',
                            isDropped ? 'text-muted-foreground' : 'font-semibold text-emerald-700 dark:text-emerald-400',
                          )}
                          title="Bobot efektif setelah kriteria yang tidak bisa dinilai dikeluarkan"
                        >
                          → {pct(eff)}
                        </span>
                      )}
                    </div>
                    {snapCfg && (
                      <p className="pl-38 text-[10px] text-muted-foreground">
                        {snapCfg.weights ? (
                          <>
                            Nominal <span className="font-mono">{fmtNumber(snapNominal ?? 0, 6)}</span>
                            {' · '}Efektif (Pers. 2.12){' '}
                            <span className="font-mono">{snapEff == null ? '—' : fmtNumber(snapEff, 6)}</span>
                            {' · '}
                          </>
                        ) : null}
                        <span className={cn(snapDropped && 'font-semibold text-amber-700 dark:text-amber-300')}>
                          {snapDropped ? `Dibuang: ${snapDropped.reason || 'tidak ada kandidat yang dapat dinilai'}` : 'Aktif'}
                        </span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {snapCfg && !snapCfg.weights && (
              <p className="text-[10px] text-muted-foreground">Bobot presisi penuh: {NOT_STORED}</p>
            )}
          </SubBlock>
        </div>

        {effectiveWeights && dropped.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-amber-200/70 bg-amber-50/40 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
            <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
              {dropped.length} kriteria dikeluarkan dari matriks TOPSIS — bobotnya dibagi ulang ke
              kriteria yang tersisa (kolom Efektif), bukan dibiarkan bernilai nol.
            </p>
            <ul className="space-y-1">
              {dropped.map((d) => (
                <li key={d.key} className="text-[10px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {CRITERION_LABEL[d.key] ?? d.key}:
                  </span>{' '}
                  {d.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ahpRun?.activeCriteria && (
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span>Kriteria aktif dalam TOPSIS ({ahpRun.activeCriteria.length}):</span>
            {ahpRun.activeCriteria.map((k) => (
              <span key={k} className="rounded-full border border-violet-300/60 bg-violet-500/8 px-2 py-0.5 text-[10px] font-medium text-violet-800 dark:border-violet-800 dark:text-violet-200">
                {CRITERION_LABEL[k] ?? k}
              </span>
            ))}
            <span>— semuanya diperlakukan sebagai kriteria <em>benefit</em> (makin tinggi makin baik).</span>
          </p>
        )}

        {/* Consistency */}
        <SubBlock
          title="Koefisien kelayakan bobot (konsistensi AHP)"
          info="Uji apakah penilaian berpasangan saling masuk akal. Bobot baru layak dipakai bila CR ≤ 0,1."
          aside={
            <>
              {consistency && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] font-semibold',
                    consistency.ok
                      ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'border-rose-300/70 bg-rose-500/10 text-rose-700 dark:text-rose-300',
                  )}
                >
                  {consistency.ok ? 'Konsisten — bobot layak' : 'TIDAK konsisten — bobot perlu ditinjau'}
                </Badge>
              )}
              {snapCfg && <OriginTag origin={snapCfg.weightsOrigin} />}
            </>
          }
        >
          {consistency && (
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Stat label="n (kriteria)" value={consistency.n} />
              <Stat
                label="λ maks"
                value={consistency.lambdaMax != null ? consistency.lambdaMax.toFixed(4) : '—'}
                hint="Eigenvalue maksimum"
              />
              <Stat
                label="CI"
                value={consistency.ci != null ? consistency.ci.toFixed(4) : '—'}
                hint="(λmaks − n) / (n − 1)"
              />
              <Stat label="RI" value={fx(consistency.ri, 2)} hint="Random Index Saaty" />
              <Stat
                label="CR"
                value={fx(consistency.cr, 4)}
                hint="CI / RI · ambang 0,1"
                tone={consistency.ok ? 'good' : 'warn'}
              />
            </div>
          )}
          {snapCfg && (
            <p className="text-[10px] text-muted-foreground">
              Tercatat pada snapshot:{' '}
              {snapCfg.consistency
                ? `CR ${fmtNumber(snapCfg.consistency.cr, 4)} · λmaks ${fmtNumber(snapCfg.consistency.lambdaMax, 4)} · CI ${fmtNumber(snapCfg.consistency.ci, 4)}`
                : NOT_STORED}
            </p>
          )}
          {consistency && !consistency.ok && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-rose-700 dark:text-rose-400">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              CR &gt; 0,1 berarti perbandingan berpasangan saling bertentangan (mis. A &gt; B, B &gt; C,
              tetapi C &gt; A). Peringkat tetap dihitung, namun bobotnya sebaiknya diperbaiki di
              Governance — atau pakai mode "Sederhana" yang selalu konsisten.
            </p>
          )}
        </SubBlock>

        {/* Program criteria as frozen with the run. Shown ONLY for runs old enough
            to have been weighted from them (weightSource = criteria-weights);
            newer runs read their weights from the matrix or the system defaults,
            where this list would be a misleading thing to print. */}
        {template && template.defaultCriteria === null && ahp.weightSource === 'criteria-weights' && (
          <p className="text-[10px] text-muted-foreground">
            Daftar kriteria &amp; bobot program — sumber bobot AHP run ini (aturan lama) — tidak tersimpan pada
            snapshot run ini.
          </p>
        )}
        {template && template.defaultCriteria && template.defaultCriteria.length > 0 && ahp.weightSource === 'criteria-weights' && (
          <SubBlock title={`Kriteria & Bobot Program (${template.name}) — sumber bobot AHP run ini (aturan lama)`} tone="muted">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[360px] text-[11px]">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Kriteria</th>
                    <th className="py-1 pr-2 font-medium">Bobot</th>
                    <th className="py-1 pr-2 font-medium">Tipe</th>
                    <th className="py-1 font-medium">Nilai Maks</th>
                  </tr>
                </thead>
                <tbody>
                  {template.defaultCriteria.map((c, i) => (
                    <tr key={`${c.name}-${i}`} className="border-b border-border/40 last:border-0">
                      <td className="py-1 pr-2 font-medium">{c.name}</td>
                      <td className="py-1 pr-2 font-mono tabular-nums">{c.weight ?? '—'}</td>
                      <td className="py-1 pr-2">{c.type === 'cost' ? 'cost' : 'benefit'}</td>
                      <td className="py-1 font-mono tabular-nums">{c.maxValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SubBlock>
        )}
      </AccentSection>

      {/* ── 5. Kesiapan & penyajian ──────────────────────────────── */}
      <AccentSection
        id="cfg-kesiapan"
        number={5}
        accent="amber"
        icon={Target}
        title="Kesiapan & penyajian"
        info="Skor akhir (closeness × 100) dipetakan ke tingkat kesiapan dengan ambang di bawah ini, dan N kandidat teratas menjadi finalis."
        aside={
          <>
            <Badge
              variant="outline"
              className={cn(
                'text-[10px]',
                readinessFromSnapshot
                  ? 'border-emerald-300/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-amber-300/70 bg-amber-500/10 text-amber-700 dark:text-amber-300',
              )}
            >
              {readinessFromSnapshot ? 'Konfigurasi run (beku)' : 'Konfigurasi saat ini'}
            </Badge>
            {snapCfg && <OriginTag origin={snapCfg.readinessOrigin} />}
          </>
        }
      >
        <div className="grid gap-2">
          {[...readiness.thresholds]
            .sort((a, b) => b.minScore - a.minScore)
            .map((t) => (
              <div
                key={t.level}
                className={cn(
                  'grid items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2 text-[11px] transition-transform duration-200 hover:translate-x-0.5 sm:grid-cols-[8rem_6rem_9rem_1fr]',
                  READINESS_BAND[t.level] ?? 'border-slate-200 bg-muted/20 dark:border-slate-800',
                )}
              >
                <span className="text-xs font-bold">{t.level}</span>
                <span className="font-mono font-semibold tabular-nums">≥ {t.minScore}</span>
                <span>{t.eta || '—'}</span>
                <span className="text-muted-foreground">{t.description || '—'}</span>
              </div>
            ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Di bawah ambang terendah: <strong>{readiness.defaultLevel}</strong>.{' '}
          {readinessFromSnapshot
            ? 'Ambang ini dibekukan bersama run, jadi tetap seperti saat run dijalankan meskipun Tata Kelola diubah setelahnya.'
            : 'Run ini dibuat sebelum ambang ikut dibekukan, jadi nilainya dibaca dari konfigurasi Tata Kelola saat ini dan bisa berbeda dari yang berlaku waktu itu.'}
        </p>
        {snapCfg && (
          <SnapshotList>
            <SnapshotItem label="Ambang readiness (Tabel 2.2)" origin={snapCfg.readinessOrigin}>
              {snapCfg.readiness
                ? snapCfg.readiness.thresholds.map((t) => `${t.level} ≥ ${t.minScore}`).join(' · ')
                : NOT_STORED}
            </SnapshotItem>
            <SnapshotItem label="Jumlah finalis (N)">
              {snapCfg.finalistCount ?? NOT_STORED}
              {pool.targetFinalists != null && (
                <span className="text-muted-foreground"> · target {pool.targetFinalists}</span>
              )}
            </SnapshotItem>
          </SnapshotList>
        )}
      </AccentSection>

      {/* ── 6. Basis posisi & parameter ──────────────────────────── */}
      <AccentSection
        id="cfg-basis"
        number={6}
        accent="teal"
        icon={Anchor}
        title="Basis posisi & parameter"
        info="Terhadap apa kandidat diukur (job profile, acuan kompetensi, syarat pendidikan, dokumen target karier) dan angka acuan skala penilaiannya. Pada run turunan, semua ini diwarisi dari run induk sebagai nilai, bukan dibaca ulang."
      >
        {!snap ? (
          <SnapshotPending view={snap} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            <SubBlock title="Basis posisi">
              <SnapshotList>
                {snapCfg!.positionBasis ? (
                  <>
                    <SnapshotItem label="Job profile target" origin={snapCfg!.positionBasis.origin}>
                      {snapCfg!.positionBasis.jobProfileName ?? 'Tanpa job profile'}
                      {snapCfg!.positionBasis.contentHash && (
                        <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                          #{snapCfg!.positionBasis.contentHash.slice(0, 10)}
                        </span>
                      )}
                    </SnapshotItem>
                    <SnapshotItem label="Acuan kompetensi" origin={snapCfg!.positionBasis.origin}>
                      {snapCfg!.positionBasis.requiredCount} kompetensi · dari{' '}
                      {snapCfg!.positionBasis.requiredSource
                        ? REQUIRED_SOURCE_LABEL[snapCfg!.positionBasis.requiredSource] ?? snapCfg!.positionBasis.requiredSource
                        : '—'}
                    </SnapshotItem>
                    <SnapshotItem label="Syarat pendidikan" origin={snapCfg!.positionBasis.origin}>
                      {snapCfg!.positionBasis.educationSource === 'incumbent'
                        ? 'Dari pendidikan pejabat (tidak ditampilkan)'
                        : snapCfg!.positionBasis.educationRequirement ?? '—'}
                    </SnapshotItem>
                    <SnapshotItem label="Dokumen target karier" origin={snapCfg!.positionBasis.origin}>
                      {snapCfg!.positionBasis.careerTarget ?? '—'}
                    </SnapshotItem>
                    <SnapshotItem label="Versi kamus kompetensi" origin={snapCfg!.positionBasis.origin}>
                      {snapCfg!.positionBasis.kamusFingerprint ? (
                        <span className="font-mono">{snapCfg!.positionBasis.kamusFingerprint.slice(0, 12)}</span>
                      ) : (
                        NOT_STORED
                      )}
                    </SnapshotItem>
                  </>
                ) : (
                  <SnapshotItem label="Basis posisi" origin="not_recorded">
                    {NOT_STORED}
                  </SnapshotItem>
                )}
              </SnapshotList>
            </SubBlock>
            <SubBlock title="Parameter dan jangkar">
              <SnapshotList>
                <SnapshotItem label="Jangkar Kompetensi Teknis (L, U)" origin={snapCfg!.anchors.origin}>
                  {snapCfg!.anchors.technical
                    ? `L ${fmtNumber(snapCfg!.anchors.technical.simFloor, 4)} · U ${fmtNumber(snapCfg!.anchors.technical.simCeil, 4)}`
                    : NOT_STORED}
                </SnapshotItem>
                <SnapshotItem label="Jangkar Relevansi Karier (L, U)" origin={snapCfg!.anchors.origin}>
                  {snapCfg!.anchors.career
                    ? `L ${fmtNumber(snapCfg!.anchors.career.simFloor, 4)} · U ${fmtNumber(snapCfg!.anchors.career.simCeil, 4)}`
                    : NOT_STORED}
                </SnapshotItem>
                <SnapshotItem label="Target kedalaman karier" origin={snapCfg!.anchors.origin}>
                  {snapCfg!.anchors.depth
                    ? `T_tahun ${fmtNumber(snapCfg!.anchors.depth.targetYears, 2)}${depthSource ? ` (${DEPTH_SOURCE_LABEL[depthSource] ?? depthSource})` : ''} · T_stint ${fmtNumber(snapCfg!.anchors.depth.targetRows, 2)}`
                    : NOT_STORED}
                </SnapshotItem>
                <SnapshotItem label="Tanggal acuan peluruhan (Pers. 2.5)" origin={snapCfg!.referenceDateOrigin}>
                  {snapCfg!.referenceDate ? formatDateTime(snapCfg!.referenceDate) : NOT_STORED}
                </SnapshotItem>
              </SnapshotList>
            </SubBlock>
          </div>
        )}
      </AccentSection>

      {/* ── 7. Versi data & model ────────────────────────────────── */}
      <AccentSection
        id="cfg-versi"
        number={7}
        accent="slate"
        icon={Database}
        title="Versi data & model"
        info="Versi data HR dan korpus yang dibaca run ini, serta model embedding dan model bahasa yang dipakai — untuk menjawab apakah dua run membaca data dan model yang sama."
      >
        {!snap ? (
          <SnapshotPending view={snap} />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            <SubBlock title="Versi data">
              {snapCfg!.dataVersions ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(snapCfg!.dataVersions.lastSyncByJob).length === 0 ? (
                      <span className="text-xs text-muted-foreground">Sinkronisasi terakhir: {NOT_STORED}</span>
                    ) : (
                      Object.entries(snapCfg!.dataVersions.lastSyncByJob).map(([job, at]) => (
                        <span
                          key={job}
                          className="inline-flex items-center gap-1 rounded-lg border bg-background/70 px-2 py-1 text-[11px]"
                        >
                          <RefreshCw className="h-3 w-3 text-slate-500" aria-hidden />
                          <span className="font-medium">{SYNC_LABEL[job] ?? job}</span>
                          <span className="text-muted-foreground">{at ? formatDateTime(at) : 'belum pernah'}</span>
                        </span>
                      ))
                    )}
                  </div>
                  <SnapshotList>
                    <SnapshotItem label="Korpus job profile">
                      {snapCfg!.dataVersions.jobProfileCorpus.documents} dokumen ·{' '}
                      <span className="font-mono">{(snapCfg!.dataVersions.jobProfileCorpus.fingerprint ?? '—').slice(0, 12)}</span>
                    </SnapshotItem>
                    <SnapshotItem label="Kamus kompetensi">
                      <span className="font-mono">{(snapCfg!.dataVersions.kamus.fingerprint ?? '—').slice(0, 12)}</span>
                      {snapCfg!.dataVersions.kamus.codes != null && ` · ${snapCfg!.dataVersions.kamus.codes} kode`}
                    </SnapshotItem>
                  </SnapshotList>
                </div>
              ) : (
                <SnapshotList>
                  <SnapshotItem label="Versi data" origin="not_recorded">
                    {NOT_STORED}
                  </SnapshotItem>
                </SnapshotList>
              )}
            </SubBlock>
            <SubBlock title="Model">
              <SnapshotList>
                {snapCfg!.models ? (
                  <>
                    <SnapshotItem label="Embedding">
                      {snapCfg!.models.embedding.documentModel ?? snapCfg!.models.embedding.model}
                    </SnapshotItem>
                    <SnapshotItem label="Model bahasa — pendidikan">{snapCfg!.models.education.model ?? '—'}</SnapshotItem>
                    <SnapshotItem label="Model narasi">
                      {snapCfg!.models.narrative.enabled
                        ? snapCfg!.models.narrative.model ?? '—'
                        : 'Nonaktif (narasi templat)'}
                    </SnapshotItem>
                  </>
                ) : (
                  <SnapshotItem label="Model" origin="not_recorded">
                    {NOT_STORED}
                  </SnapshotItem>
                )}
              </SnapshotList>
            </SubBlock>
          </div>
        )}
      </AccentSection>

      {/* ── 8. Cara setiap kriteria dinilai ──────────────────────── */}
      {runInfo && (
        <AccentSection
          id="cfg-rumus"
          number={8}
          accent="indigo"
          icon={Sigma}
          title="Cara setiap kriteria dinilai"
          info="Sumber acuan dan penyesuaian tiap kriteria — data yang dipakai, rumusnya, dan penyesuaian yang dilakukan ketika datanya tidak lengkap. Buka satu kriteria untuk melihat rinciannya."
        >
          {/* The six aspect scores are only half the story; how they become one
              ordering is the other half, and it is the same for every criterion.
              Stated once here so each dropdown can stay about its own scoring. */}
          <div className="space-y-2 rounded-xl border border-indigo-200/60 bg-indigo-500/[0.03] p-3 dark:border-indigo-900/50">
            <p className="text-[11px] font-bold">Bagaimana keenam nilai menjadi satu peringkat</p>
            <Formula>{`Setiap kandidat memperoleh 6 nilai kriteria, masing-masing 0-100.
Peringkat akhir dihitung dengan TOPSIS berbobot AHP:

  1. Tiap kolom kriteria dinormalisasi
         r(i,j)  =  x(i,j)  ÷  √( Σ x(i,j)² )

  2. Dikalikan bobot AHP kriteria tersebut
         v(i,j)  =  w(j)  ×  r(i,j)

  3. Titik terbaik dan terburuk diambil dari kumpulan kandidat
         A+(j)  =  nilai tertinggi pada kolom j
         A−(j)  =  nilai terendah  pada kolom j

  4. Jarak tiap kandidat ke kedua titik itu
         d+  =  √( Σ ( v(i,j) − A+(j) )² )
         d−  =  √( Σ ( v(i,j) − A−(j) )² )

  5. Nilai kedekatan — inilah dasar urutan peringkat
         C  =  d−  ÷  ( d+ + d− )

Kriteria yang tidak dapat dinilai untuk satu pun kandidat
dikeluarkan, dan bobotnya dibagikan ke kriteria yang tersisa.`}</Formula>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Karena titik terbaik dan terburuk diambil dari kumpulan kandidat pada run ini, nilai
              kedekatan <span className="font-mono">C</span> bersifat relatif terhadap peserta run.
              Nilai per kriteria di bawah pada dasarnya absolut — tetap berarti sama meski
              pesertanya berganti — dengan{' '}
              <span className="font-medium text-foreground">satu pengecualian</span>: target
              pengalaman pada kriteria Career diturunkan dari median peserta run, sehingga skor
              Career ikut bergantung pada siapa saja yang ikut. Lihat rinciannya pada kriteria
              tersebut.
            </p>
          </div>

          <Accordion type="single" collapsible className="space-y-2">
            {/* ── 1. Technical ───────────────────────────────────── */}
            <CriterionItem
              value="technical"
              label="Technical Competency"
              weight={ahp.weights.technical}
              dropped={droppedReason('technical')}
            >
              <Note title="Data yang dipakai">
                Daftar kompetensi yang dituntut posisi ({runInfo.technical.requiredCount}{' '}
                kompetensi, diambil dari {requiredSourceLabel(runInfo.technical.requiredSource)}),
                dibandingkan dengan daftar kompetensi yang dimiliki kandidat beserta levelnya.
              </Note>
              <Note title="Sebelum dihitung">
                Nama kompetensi kedua sisi dicocokkan dulu ke kamus kompetensi — lewat nama yang
                sama persis, lalu pencocokan kata otomatis, lalu pemeriksaan penulisan. Kompetensi
                yang identitasnya sama dipasangkan lebih dulu; sisanya baru dipasangkan berdasarkan
                kemiripan makna, satu lawan satu.
              </Note>

              {runInfo.technical.simFloor != null && runInfo.technical.simCeil != null ? (
                <>
                  <Formula>{`Setiap kompetensi yang dituntut posisi dipasangkan dengan satu
kompetensi kandidat, lalu tiap pasangan dinilai:

    nilai pasangan  =  kemiripan  ×  faktor level


KEMIRIPAN                                        hasil 0.00 – 1.00

    nama kompetensi sama   →  1.00
    nama berbeda           →  ( m − b ) ÷ ( a − b )
                              hasil di luar 0.00–1.00 dipotong

        m  = kemiripan makna teks kedua kompetensi
        b  = batas bawah  = ${fx(runInfo.technical.simFloor, 4)}
        a  = batas atas   = ${fx(runInfo.technical.simCeil, 4)}


FAKTOR LEVEL          k = level kandidat,  t = level yang dituntut
                      (1 Basic · 2 Intermediate · 3 Advance · 4 Mastery)

    k ≥ t  dan nama sama     →  1 + 0.75 × ( k − t ) ÷ 3
                                maksimum 1.75
    k ≥ t  dan nama berbeda  →  1.00
    k < t                    →  1 − ( t − k ) ÷ 4
    k tidak terbaca          →  1.00        ← "netral"


SKOR TECHNICAL                                   rentang 0..100

    skor  =  min( jumlah nilai seluruh pasangan ÷ M , 1 )  ×  100

           Nilai per pasangan bisa 1,75, jadi jumlah÷M mentah bisa
           di atas 1 — agregatnya DIJENUHKAN pada 1. Surplusnya
           kompensatoris: boleh menutup kekurangan level di
           kompetensi lain, tidak boleh melampaui "memenuhi semua".

        M = jumlah kompetensi yang dapat dinilai${
                    runInfo.technical.effectiveRequiredCount != null
                      ? ` = ${runInfo.technical.effectiveRequiredCount}`
                      : ''
                  }`}</Formula>

                  <div className="space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-foreground">
                      Dari mana batas bawah {fx(runInfo.technical.simFloor, 4)} dan batas atas{' '}
                      {fx(runInfo.technical.simCeil, 4)} berasal
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', anchorTone(runInfo.technical.simAnchorSource))}
                      >
                        {anchorSourceLabel(runInfo.technical.simAnchorSource)}
                      </Badge>
                    </p>
                    <p className="text-[10px] leading-relaxed text-muted-foreground">
                      Nilai kemiripan makna teks tidak bisa dibaca langsung sebagai persentase. Pada
                      kamus kompetensi ini, dua kompetensi yang <em>sama sekali berbeda</em> pun
                      tetap terlihat cukup mirip. Karena itu kedua batas dihitung dengan
                      membandingkan setiap kompetensi di kamus terhadap seluruh kompetensi lainnya:
                    </p>
                    <ul className="ml-3 list-disc space-y-1 text-[10px] leading-relaxed text-muted-foreground">
                      <li>
                        <span className="font-medium text-foreground">
                          Batas bawah {fx(runInfo.technical.simFloor, 4)}
                        </span>{' '}
                        — sebagian besar pasangan kompetensi yang berbeda berada di sekitar angka
                        ini, jadi kemiripan sebesar itu bukan bukti kesamaan dan dihitung 0.
                      </li>
                      <li>
                        <span className="font-medium text-foreground">
                          Batas atas {fx(runInfo.technical.simCeil, 4)}
                        </span>{' '}
                        — hanya pasangan yang praktis bermakna sama yang mencapainya, jadi dari
                        titik itu ke atas dihitung penuh (1.00).
                      </li>
                    </ul>
                  </div>

                  {runInfo.technical.simScaleReason && (
                    <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                      <span className="font-semibold text-foreground">Catatan sumber:</span>{' '}
                      {runInfo.technical.simScaleReason}
                    </p>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-dashed p-2.5">
                      <p className="text-[10px] font-semibold text-foreground">
                        Mengapa tidak dihitung dari kandidat yang ikut run ini
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Kalau kedua batas diambil dari sebaran kandidat yang kebetulan ikut dalam
                        satu run, angkanya berubah setiap kali pesertanya berubah — itu sifat
                        run-nya, bukan sifat alat ukurnya. Kandidat yang sama bisa mendapat nilai
                        berbeda hanya karena pesaingnya berganti.
                      </p>
                    </div>
                    <div className="rounded-md border border-dashed p-2.5">
                      <p className="text-[10px] font-semibold text-foreground">
                        Mengapa dihitung ulang setiap kamus berubah
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Perbandingan menyeluruh atas isi kamus itu sendiri yang menjadi alat
                        ukurnya. Kalau kamus berubah — diproses ulang, ditambah, dikurangi, atau
                        berganti model teks — kedua batas lama menggambarkan sebaran yang sudah
                        tidak ada. Mempertahankannya bukan menjaga kesebandingan, hanya membekukan
                        angka yang keliru. Karena itu run ini menyimpan batasnya sendiri.
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="rounded-md border border-dashed px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  Run ini selesai sebelum rincian skala kemiripan mulai dicatat, sehingga kedua
                  batas yang dipakainya tidak diketahui.
                </p>
              )}

              {(runInfo.technical.levelUnknownPairs ?? 0) > 0 &&
                (() => {
                  const unknown = runInfo.technical.levelUnknownPairs ?? 0;
                  const divisor =
                    runInfo.technical.effectiveRequiredCount ?? runInfo.technical.requiredCount;
                  // Worst case: every unreadable level is in fact three levels
                  // short, where the factor would be 0.25 — so 0.75 of that
                  // pair's value is credit the score may not have earned.
                  const maxPoints = divisor > 0 ? (unknown * 0.75 * 100) / divisor : 0;
                  return (
                    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                        Level kandidat yang belum diasesmen — arti &ldquo;netral&rdquo;
                      </p>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {unknown} dari {divisor} pasangan
                        </span>{' '}
                        memakai <span className="font-mono">faktor level = 1.00</span>. Itulah yang
                        dimaksud netral: faktornya tidak menambah dan tidak mengurangi apa pun,
                        sehingga nilai pasangan sepenuhnya ditentukan kemiripannya saja. Ini terjadi
                        ketika level kompetensi kandidat tercatat kosong,{' '}
                        <span className="font-mono">#N/A</span>, atau{' '}
                        <span className="font-mono">NOT ASSESSED</span> — selisih level tidak dapat
                        dihitung, dan menganggapnya level 1 akan melaporkan kekurangan yang tidak
                        pernah dinyatakan datanya.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-75 text-[10px]">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="py-1 text-left font-semibold">
                                Seandainya level diketahui
                              </th>
                              <th className="py-1 text-right font-semibold">Faktor</th>
                              <th className="py-1 text-right font-semibold">Nilai pasangan</th>
                            </tr>
                          </thead>
                          <tbody className="text-muted-foreground">
                            {[
                              ['memenuhi atau melebihi tuntutan', '1.00', 'sama seperti sekarang'],
                              ['kurang 1 level', '0.75', 'turun 25%'],
                              ['kurang 2 level', '0.50', 'turun 50%'],
                              ['kurang 3 level', '0.25', 'turun 75%'],
                            ].map(([a, b, c]) => (
                              <tr key={a} className="border-b border-dashed last:border-0">
                                <td className="py-1">{a}</td>
                                <td className="py-1 text-right font-mono">{b}</td>
                                <td className="py-1 text-right">{c}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="rounded-md bg-background/60 px-2.5 py-2 text-[10px] leading-relaxed">
                        <span className="font-semibold">Sebesar apa pengaruhnya ke skor:</span>{' '}
                        paling banyak{' '}
                        <span className="font-mono font-semibold">
                          {unknown} × 0.75 ÷ {divisor} × 100 = {maxPoints.toFixed(1)} poin
                        </span>
                        . Artinya skor Technical run ini paling jauh {maxPoints.toFixed(1)} poin
                        lebih tinggi dibanding seandainya {unknown} pasangan itu ternyata semuanya
                        tertinggal tiga level — dan sama sekali tidak berbeda seandainya semuanya
                        ternyata sudah memenuhi tuntutan.
                      </p>
                    </div>
                  );
                })()}

              {(runInfo.technical.unmeasurableRequired ?? 0) > 0 && (
                <Note title={`${runInfo.technical.unmeasurableRequired} kompetensi tidak dapat dinilai`}>
                  Tidak ada padanannya di kamus kompetensi dan tidak ada kandidat yang memilikinya.
                  Kompetensi seperti ini pasti bernilai 0 untuk semua orang, jadi dikeluarkan dari
                  pembagi (M) supaya kekurangan kamus tidak menekan skor semua kandidat.
                  {runInfo.technical.unmeasurableNames?.length ? (
                    <span className="text-foreground/80">
                      {' '}
                      Yang dikeluarkan: {runInfo.technical.unmeasurableNames.join(', ')}.
                    </span>
                  ) : null}
                </Note>
              )}
              {(runInfo.technical.kamusResolvedByCache ?? 0) > 0 && (
                <Note
                  title={`${runInfo.technical.kamusResolvedByCache} nama kompetensi dicocokkan ke kamus`}
                >
                  Penulisannya tidak persis sama — misalnya salah ketik, bentuk jamak, atau urutan
                  kata berbeda. Tanpa pencocokan ini, kompetensi tersebut tidak akan berpasangan
                  dengan kompetensi kandidat yang sebenarnya sama.
                </Note>
              )}
              {runInfo.technical.requiredSourceDetail && (
                <Note title="Asal daftar kompetensi">{runInfo.technical.requiredSourceDetail}</Note>
              )}
            </CriterionItem>

            {/* ── 2. Career ──────────────────────────────────────── */}
            <CriterionItem
              value="career"
              label="Career Relevance"
              weight={ahp.weights.career}
              dropped={droppedReason('career')}
            >
              <Note title="Data yang dipakai">
                Seluruh riwayat jabatan kandidat ditambah jabatan yang dipegang sekarang, beserta
                lama menjabat masing-masing. Job profile posisi sasaran:{' '}
                <span className="text-foreground/80">
                  {runInfo.career.targetJobProfileName ?? runInfo.jobProfileMatched ?? 'tidak ditemukan'}
                </span>
                .
              </Note>
              <Note title="Sebelum dihitung">
                Lama tiap periode jabatan dihitung sebagai jumlah bulan penuh dibagi 12 — sisa hari
                yang belum genap sebulan dibuang. Setiap jabatan lampau dicarikan dokumen job
                profile-nya secara berurutan: kode posisi pada nama berkas, lalu pasangan Job
                Family, lalu judul yang sama persis, lalu kemiripan judul di atas 0.98.
              </Note>
              <Formula>{`Untuk tiap periode jabatan i:

    s(i)  =  ( m(i) − b )  ÷  ( a − b )       dipotong ke 0.00–1.00

        m(i) = kemiripan dokumen job profile jabatan tersebut
               dengan job profile posisi sasaran
        b  = batas bawah${
          runInfo.career.scale ? `  = ${fx(runInfo.career.scale.simFloor, 4)}` : ''
        }
        a  = batas atas ${
          runInfo.career.scale ? ` = ${fx(runInfo.career.scale.simCeil, 4)}` : ''
        }


PENYUSUTAN karena usia pengalaman${
          runInfo.career.depth?.recencyDecayPerYear != null &&
          runInfo.career.depth.recencyDecayPerYear > 0
            ? `

    r(i)  =  exp( − ${runInfo.career.depth.recencyDecayPerYear} × tahun sejak periode i BERAKHIR )

        periode yang masih berjalan  →  r(i) = 1  (tidak menyusut)`
            : `

    TIDAK diterapkan pada run ini — periode yang berakhir puluhan tahun lalu
    dihitung sama besar dengan periode yang sedang dijalani.`
        }


AKUMULASI — bukan rata-rata

    tahun efektif    =  Σ  s(i) × lama_tahun(i) × r(i)
    periode efektif  =  Σ  s(i) × r(i)


KEJENUHAN terhadap target pengalaman

    capaian_tahun    =  min( 1 ,  tahun efektif    ÷  T_tahun${
          runInfo.career.depth ? `  =  ${fx(runInfo.career.depth.targetYears, 2)}` : ''
        } )
    capaian_periode  =  min( 1 ,  periode efektif  ÷  T_periode${
          runInfo.career.depth ? `  =  ${fx(runInfo.career.depth.targetRows, 2)}` : ''
        } )
${
  runInfo.career.depth?.breadthWeight != null
    ? `
PENGGABUNGAN — kedalaman memikul, keragaman memodulasi

    w  =  ${fx(runInfo.career.depth.breadthWeight, 2)}

    skor Career  =  capaian_tahun × ( ${fx(1 - runInfo.career.depth.breadthWeight, 2)} + ${fx(runInfo.career.depth.breadthWeight, 2)} × capaian_periode )  ×  100`
    : `
PENGGABUNGAN — ATURAN LAMA

    skor Career  =  min( capaian_tahun , capaian_periode )  ×  100`
}`}</Formula>

              {/* ── Which RULE VERSION produced this run ─────────────
                  Career's rules changed in five places at once, and each one
                  moved scores in the same direction (down, for irrelevant
                  history). A reader comparing two runs therefore needs to know
                  which set applied — and none of the five is visible in the
                  numbers themselves. Each row is detected from a field whose
                  ABSENCE is the marker for the old rule, never from a date. */}
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-[10px] font-bold text-foreground">
                  Aturan yang berlaku pada run ini
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-140 text-[10px]">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="py-1 text-left font-semibold">Hal</th>
                        <th className="py-1 text-left font-semibold">Run ini</th>
                        <th className="py-1 text-left font-semibold">Artinya</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      {(
                        [
                          [
                            'Batas skala kemiripan',
                            (runInfo.career.scale?.estimates?.length ?? 0) > 0,
                            `diukur dengan ${runInfo.career.scale?.estimates?.length} cara, diambil nilai tengah`,
                            'satu cara saja (persentil pasangan sembarang)',
                            'Batas bawah aturan lama jatuh di titik yang hanya 10% pasangannya benar-benar berkerabat, jadi riwayat tak berhubungan tetap mendapat relevansi positif.',
                          ],
                          [
                            'Tolok ukur pengalaman (T)',
                            runInfo.career.depth != null && runInfo.career.depth.source !== 'pool',
                            `absolut — ${runInfo.career.depth?.source === 'jd' ? 'dari syarat job profile' : runInfo.career.depth?.source === 'measured' ? 'diukur dari pengangkatan nyata' : runInfo.career.depth?.source === 'fixed' ? 'angka tetap konfigurasi' : 'diwarisi run dasar'}`,
                            'median pool run ini × 2',
                            'Penggaris aturan lama menyusut tepat ketika bench-nya paling lemah, sehingga pool yang lemah menghasilkan skor lebih tinggi (1,4–3×).',
                          ],
                          [
                            'Penggabungan dua sumbu',
                            runInfo.career.depth?.breadthWeight != null,
                            'kedalaman × (0,75 + 0,25 × keragaman)',
                            'min(kedalaman, keragaman)',
                            'min() menahan satu penugasan panjang di jabatan yang persis sama oleh jumlah penugasannya sendiri — membuang bukti terkuat kriteria ini.',
                          ],
                          [
                            'Penyusutan usia pengalaman',
                            (runInfo.career.depth?.recencyDecayPerYear ?? 0) > 0,
                            `exp(−${runInfo.career.depth?.recencyDecayPerYear} × tahun sejak berakhir)`,
                            'tidak ada penyusutan',
                            'Tanpa penyusutan, penugasan yang berakhir puluhan tahun lalu dihitung sama besar dengan yang sedang dijalani.',
                          ],
                          [
                            'Jalur kompetensi (tanpa job profile)',
                            runInfo.career.calibration == null ||
                              runInfo.career.calibration.cap != null,
                            runInfo.career.calibration == null
                              ? 'tidak dipakai pada run ini'
                              : `plafon ${((runInfo.career.calibration.cap ?? 0) * 100).toFixed(0)}% dari rentang penuh${runInfo.career.calibration.idfWeighted ? ', cakupan dibobot kekhasan' : ''}`,
                            'rentang p5–p95 dokumen run ini sendiri',
                            'Batas atas aturan lama praktis sama dengan kecocokan dokumen TERBAIK di run itu, jadi cakupan kompetensi 100% berarti "ini persis pekerjaan yang sama".',
                          ],
                        ] as [string, boolean, string, string, string][]
                      ).map(([hal, current, nowText, oldText, why]) => (
                        <tr key={hal} className="border-b border-dashed last:border-0">
                          <td className="py-1.5 pr-2 align-top font-medium text-foreground">{hal}</td>
                          <td className="py-1.5 pr-2 align-top">
                            <Badge
                              variant="outline"
                              className={cn(
                                'mb-1 text-[9px]',
                                current
                                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              )}
                            >
                              {current ? 'aturan berlaku' : 'aturan lama'}
                            </Badge>
                            <p className="wrap-break-word">{current ? nowText : oldText}</p>
                          </td>
                          <td className="py-1.5 align-top wrap-break-word">{why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Kenapa ini ditampilkan.</span>{' '}
                  Kelima hal di atas berubah dan semuanya menggeser skor ke arah yang sama — turun,
                  untuk riwayat yang tidak relevan. Run yang sudah selesai{' '}
                  <span className="font-medium text-foreground">tidak pernah dihitung ulang</span>:
                  sebuah peringkat adalah catatan penilaian pada tanggal tertentu, jadi ia menyimpan
                  aturannya sendiri dan tetap dapat dijelaskan. Konsekuensinya, run dengan badge
                  &ldquo;aturan lama&rdquo; di baris mana pun{' '}
                  <span className="font-medium text-foreground">tidak sebanding langsung</span>{' '}
                  dengan run yang seluruh barisnya &ldquo;aturan berlaku&rdquo;. Untuk
                  membandingkannya, jalankan Scoring Ulang pada program yang sama.
                </p>
              </div>

              {/* Where b and a come from. The same disclosure the Technical
                  aspect makes, because the same two misreadings are available
                  here: "they are constants" and "they moved, so runs are not
                  comparable" — both wrong, in opposite directions. */}
              {runInfo.career.scale ? (
                <div className="space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2 text-[10px] font-semibold text-foreground">
                    Dari mana batas bawah {fx(runInfo.career.scale.simFloor, 4)} dan batas atas{' '}
                    {fx(runInfo.career.scale.simCeil, 4)} berasal
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', anchorTone(runInfo.career.scale.source))}
                    >
                      {anchorSourceLabel(runInfo.career.scale.source)}
                    </Badge>
                  </p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Kemiripan dokumen tidak bisa dibaca sebagai persentase. Dua job profile yang{' '}
                    <em>sama sekali tidak berhubungan</em> pun tetap terlihat cukup mirip, karena
                    keduanya dokumen jabatan dengan struktur dan istilah yang sama. Karena itu kedua
                    batas harus DIUKUR
                    {runInfo.career.scale.docCount
                      ? ` (${runInfo.career.scale.docCount} dokumen, ${runInfo.career.scale.sampleCount?.toLocaleString('id-ID')} pasangan)`
                      : ''}
                    .
                  </p>

                  {/* ── The three estimators ──────────────────────────
                      Absent on runs anchored by the arbitrary-pair census alone,
                      and that absence is worth stating: its floor sat where only
                      10% of pairs are genuinely related, so those runs handed out
                      relevance for being a job description at all. */}
                  {runInfo.career.scale.estimates && runInfo.career.scale.estimates.length > 0 ? (
                    <div className="space-y-1.5">
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        Diukur dengan{' '}
                        <span className="font-medium text-foreground">
                          {runInfo.career.scale.estimates.length} cara yang saling bebas
                        </span>
                        , lalu diambil nilai TENGAH-nya — supaya satu cara pengukuran tidak bisa
                        menggeser skala sendirian, satu cara yang tidak tersedia tidak mematikan
                        perhitungan, dan satu cara yang keliru kalah suara.
                      </p>
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-105 text-[10px]">
                          <thead>
                            <tr className="border-b text-muted-foreground">
                              <th className="py-1 text-left font-semibold">Cara pengukuran</th>
                              <th className="py-1 text-right font-semibold">Batas bawah</th>
                              <th className="py-1 text-right font-semibold">Batas atas</th>
                              <th className="py-1 text-right font-semibold">Data</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runInfo.career.scale.estimates.map((e) => (
                              <tr key={e.source} className="border-b border-dashed last:border-0">
                                <td className="py-1 pr-2 align-top">
                                  <span className="font-medium text-foreground">
                                    {anchorEstimatorLabel(e.source)}
                                  </span>
                                  <p className="mt-0.5 wrap-break-word text-muted-foreground">
                                    {e.note}
                                  </p>
                                </td>
                                <td className="py-1 text-right align-top font-mono text-foreground">
                                  {fx(e.floor, 4)}
                                </td>
                                <td className="py-1 text-right align-top font-mono text-foreground">
                                  {fx(e.ceil, 4)}
                                </td>
                                <td className="py-1 text-right align-top text-muted-foreground">
                                  {e.sampleCount.toLocaleString('id-ID')}
                                </td>
                              </tr>
                            ))}
                            <tr className="bg-primary/10 font-medium text-foreground">
                              <td className="py-1 pr-2">Nilai tengah — yang dipakai</td>
                              <td className="py-1 text-right font-mono">
                                {fx(runInfo.career.scale.simFloor, 4)}
                              </td>
                              <td className="py-1 text-right font-mono">
                                {fx(runInfo.career.scale.simCeil, 4)}
                              </td>
                              <td className="py-1 text-right">—</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                      {runInfo.career.scale.estimates.some((e) => e.source === 'transitions') ? (
                        <p className="rounded-md bg-emerald-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                          <span className="font-semibold">Yang paling bisa dipercaya</span> di antara
                          ketiganya adalah &ldquo;perpindahan nyata&rdquo;: ia dihitung dari mutasi
                          jabatan yang benar-benar pernah terjadi di perusahaan ini, bukan dari
                          kemiripan teks. Dua cara lainnya masih memakai vektor yang sedang
                          dikalibrasi, jadi sedikit berputar pada dirinya sendiri.
                        </p>
                      ) : (
                        <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                          Acuan &ldquo;perpindahan nyata&rdquo; belum tersedia pada run ini — perlu
                          cukup banyak mutasi internal yang kedua ujungnya punya job profile. Begitu
                          ada, ia ikut diperhitungkan otomatis.
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                      <span className="font-semibold">Aturan lama.</span> Kedua batas run ini berasal
                      dari satu cara saja: persentil 25 kemiripan antar dokumen sembarang sebagai
                      batas bawah, dan persentil 99 kemiripan &ldquo;kembar terdekat&rdquo; sebagai
                      batas atas. Setelah dikalibrasi terhadap label yang bisa diperiksa, batas bawah
                      itu ternyata jatuh di titik yang <em>hanya 10%</em> pasangannya benar-benar
                      berkerabat — artinya nilai nol pada skala relevansi berada di tempat yang 90%
                      isinya tidak berhubungan, dan semua di atasnya mendapat relevansi positif.
                      Skor Career run ini karena itu lebih tinggi daripada run yang dijalankan setelah
                      perbaikan, dan keduanya tidak sebanding.
                    </p>
                  )}
                  <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Catatan sumber:</span>{' '}
                    {runInfo.career.scale.reason}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-md border border-dashed p-2.5">
                      <p className="text-[10px] font-semibold text-foreground">
                        Mengapa tidak dihitung dari kandidat yang ikut run ini
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Kalau kedua batas diambil dari sebaran peserta satu run, angkanya berubah
                        setiap kali pesertanya berubah — itu sifat run-nya, bukan sifat alat ukurnya.
                        Kandidat yang sama bisa mendapat skor Career berbeda hanya karena pesaingnya
                        berganti. Target pengalaman di atas kini mengikuti aturan yang sama; dulu ia
                        satu-satunya besaran yang dihitung dari peserta run, dan itu sudah diperbaiki.
                      </p>
                    </div>
                    <div className="rounded-md border border-dashed p-2.5">
                      <p className="text-[10px] font-semibold text-foreground">
                        Kapan kedua batas ini dihitung ulang dengan sendirinya
                      </p>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Alat ukurnya adalah data itu sendiri, jadi kalau datanya berubah, kedua batas
                        lama menggambarkan sebaran yang sudah tidak ada — mempertahankannya bukan
                        menjaga kesebandingan, hanya membekukan angka yang keliru. Karena itu sistem
                        memeriksa <span className="font-medium text-foreground">empat</span> hal
                        sebelum memakai ulang hasil perhitungan sebelumnya, dan menghitung ulang
                        otomatis begitu salah satunya berubah:
                      </p>
                      <ul className="mt-1 ml-3 list-disc space-y-0.5 text-[10px] leading-relaxed text-muted-foreground">
                        <li>
                          <span className="font-medium text-foreground">Isi dokumen job profile</span>{' '}
                          — ada dokumen ditambah, dihapus, atau teksnya berubah.
                        </li>
                        <li>
                          <span className="font-medium text-foreground">Model teks</span> yang dipakai
                          membuat pembanding — dokumen yang sama pada model berbeda menempati ruang
                          yang berbeda.
                        </li>
                        <li>
                          <span className="font-medium text-foreground">Hasil pengelompokan rumpun
                          jabatan</span> — dipakai acuan &ldquo;kurva ketepatan rumpun jabatan&rdquo;.
                          Setiap kali Job Family dikelompokkan ulang, seluruh nomor rumpunnya berganti.
                        </li>
                        <li>
                          <span className="font-medium text-foreground">Riwayat jabatan karyawan</span>{' '}
                          — dipakai acuan &ldquo;perpindahan jabatan nyata&rdquo;. Sinkronisasi HR
                          mingguan bisa menambah penugasan atau memperbaiki tanggalnya, dan tanggal
                          yang berubah mengubah urutan karier seseorang sehingga mengubah pula
                          pasangan mana yang terhitung sebagai perpindahan.
                        </li>
                      </ul>
                      <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                        Satu perubahan yang <span className="font-medium text-foreground">tidak
                        bisa</span> dideteksi otomatis: pembanding dibangun ulang dan menghasilkan
                        angka berbeda padahal teks dan modelnya sama — misalnya layanan
                        pembuat pembanding disetel ulang, atau proses sebelumnya berhenti di tengah.
                        Karena itu tombol &ldquo;Bangun Ulang Embedding&rdquo; pada Job Family
                        memaksa perhitungan ulang, tidak menunggu terdeteksi.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  Run ini selesai sebelum rincian skala kemiripan Career mulai dicatat, sehingga
                  kedua batas yang dipakainya tidak diketahui.
                </p>
              )}

              <Note title="Mengapa diakumulasi, bukan dirata-rata">
                Dengan rata-rata tertimbang, lama menjabat saling meniadakan: satu periode enam
                bulan yang relevan bernilai sama dengan karier dua puluh tahun yang sama
                relevannya — riwayat yang tipis malah diuntungkan karena tidak punya periode lemah
                yang mengencerkan nilainya. Karena itu pengalaman relevan diakumulasi pada dua
                sumbu, bukan dirata-rata.
              </Note>
              {runInfo.career.depth?.breadthWeight != null ? (
                <Note title="Kedalaman menentukan, keragaman hanya memodulasi">
                  Skor ={' '}
                  <span className="font-mono">
                    capaian_tahun × ({fx(1 - runInfo.career.depth.breadthWeight, 2)} +{' '}
                    {fx(runInfo.career.depth.breadthWeight, 2)} × capaian_periode)
                  </span>
                  . Sebelumnya dipakai <span className="font-mono">min()</span> dari dua sumbu,
                  dengan alasan &ldquo;satu periode panjang tertahan oleh sumbu jumlah periode&rdquo;
                  — dan justru itu masalahnya: satu penugasan panjang <em>di jabatan sasaran itu
                  sendiri</em> adalah bukti terkuat yang bisa diterima kriteria ini, lalu{' '}
                  <span className="font-mono">min()</span> membuangnya. Terukur pada run nyata:
                  kandidat dengan 10,6 tahun sebagai IT Application Development Analyst mendapat 47,
                  sementara kandidat yang seluruh riwayatnya IT support mendapat 100. Dengan bentuk
                  perkalian ini, satu penugasan relevan yang dalam tetap memperoleh{' '}
                  {fx((1 - runInfo.career.depth.breadthWeight) * 100, 0)}% nilai penuh, dan
                  keragaman penugasan masih menambah{' '}
                  {fx(runInfo.career.depth.breadthWeight * 100, 0)}%.
                </Note>
              ) : (
                <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                  <span className="font-semibold">Aturan lama.</span> Run ini memakai{' '}
                  <span className="font-mono">min()</span> dari kedua sumbu, sehingga satu penugasan
                  panjang di jabatan yang persis sama tertahan oleh jumlah penugasannya sendiri.
                  Aturan itu sudah diganti bentuk perkalian, jadi skor Career run ini tidak sebanding
                  langsung dengan run yang lebih baru.
                </p>
              )}
              {runInfo.career.depth?.recencyDecayPerYear != null &&
              runInfo.career.depth.recencyDecayPerYear > 0 ? (
                <Note title="Pengalaman lama menyusut">
                  Kontribusi setiap penugasan dikali{' '}
                  <span className="font-mono">
                    exp(−{runInfo.career.depth.recencyDecayPerYear} × tahun sejak penugasan berakhir)
                  </span>
                  , dan penugasan yang masih berjalan tidak menyusut. Angka{' '}
                  {fx(runInfo.career.depth.recencyDecayPerYear * 100, 1)}% per tahun adalah laju
                  penyusutan keterampilan dari literatur human capital, bukan angka yang disetel
                  sendiri. Sebelum ini tidak ada penyusutan sama sekali: penugasan yang berakhir dua
                  puluh tahun lalu dihitung sama besar dengan yang sedang dijalani sekarang.
                </Note>
              ) : null}
              {/* ── Where T_tahun and T_periode came from ─────────────
                  The formula above names them without deriving them, which is
                  the one number in Career a reader cannot reconstruct from the
                  page. It USED to be the only pool-relative quantity among the
                  six aspects; it is now absolute, and this block's main job is to
                  tell a reader which of the two a given run used, because that
                  decides whether its scores compare with anything. */}
              {runInfo.career.depth ? (
                <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold text-foreground">
                    Dari mana T_tahun {fx(runInfo.career.depth.targetYears, 2)} dan T_periode{' '}
                    {fx(runInfo.career.depth.targetRows, 2)} berasal
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', depthSourceTone(runInfo.career.depth.source))}
                    >
                      {depthSourceBadge(runInfo.career.depth.source)}
                    </Badge>
                  </p>

                  {runInfo.career.depth.source === 'pool' ? (
                    <>
                      <Formula>{`T diturunkan dari POOL run ini — bukan dari konfigurasi:

    T_tahun    =  batasi( median( tahun efektif seluruh kandidat )   × 2 , 0.5 , 20 )
    T_periode  =  batasi( median( periode efektif seluruh kandidat ) × 2 , 1   , 8  )


ANGKA RUN INI      pool ${runInfo.career.depth.poolSize} kandidat yang dinilai

    median tahun efektif    =  ${fx(runInfo.career.depth.medianEffectiveYears, 3)}
    median periode efektif  =  ${fx(runInfo.career.depth.medianEffectiveRows, 3)}

    T_tahun    =  ${fx(runInfo.career.depth.medianEffectiveYears, 3)}  × 2  =  ${fx(runInfo.career.depth.targetYears, 2)}
    T_periode  =  ${fx(runInfo.career.depth.medianEffectiveRows, 3)}  × 2  =  ${fx(runInfo.career.depth.targetRows, 2)}`}</Formula>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">Alasan yang dipakai dulu.</span>{' '}
                        &ldquo;Pengalaman relevan yang cukup&rdquo; dianggap hanya berarti sesuatu
                        relatif terhadap orang yang benar-benar bersaing untuk posisi ini. Pengali 2
                        dipakai supaya kandidat median berada di{' '}
                        <span className="font-mono">0,50</span> pada masing-masing sumbu dan seluruh
                        rentang 0–100 tetap terpakai.
                      </p>
                      <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                        <span className="font-semibold">Mengapa aturan ini diganti.</span> Alasan di
                        atas punya akibat yang fatal: penggaris menyusut tepat ketika bench-nya paling
                        lemah, sehingga pool yang tidak punya siapa-siapa justru menghasilkan skor
                        yang bagus. Terukur pada run yang masih tersimpan — sebuah pool Learning &amp;
                        Development dengan relevansi rata-rata 0,168 (praktis tidak ada yang punya
                        pengalaman relevan) menghasilkan T = 2,06 tahun / 1,0 periode; angka kedua
                        menyentuh batas bawah, sehingga <em>satu</em> periode saja sudah menjenuhkan
                        sumbu itu. Rata-rata skornya 33,1; dengan target tetap 8 tahun / 2 periode,
                        orang yang sama mendapat 11,3. Inflasinya 1,4× pada pool normal dan 3× pada
                        pool buruk, selalu ke arah membuat bench yang lemah tampak layak.
                      </p>
                      <p className="rounded-md bg-background/60 px-2.5 py-2 text-[10px] leading-relaxed">
                        <span className="font-semibold">Artinya untuk run ini:</span> skor Career di
                        sini diukur terhadap peserta run ini sendiri, jadi{' '}
                        <em>tidak sebanding</em> dengan run yang dijalankan setelah penggaris menjadi
                        absolut. Angkanya tetap sah sebagai catatan penilaian pada tanggal itu —
                        run yang sudah selesai tidak pernah diubah — tetapi jangan dibandingkan
                        langsung.
                      </p>
                    </>
                  ) : (
                    <>
                      <Formula>{`T bersifat ABSOLUT pada run ini — tidak diturunkan dari peserta run.

    T_tahun    =  ${fx(runInfo.career.depth.targetYears, 2)}
    T_periode  =  ${fx(runInfo.career.depth.targetRows, 2)}
${
  runInfo.career.depth.source === 'jd' && runInfo.career.depth.statedExperienceText
    ? `
Diambil dari syarat pengalaman yang tertulis di job profile jabatan sasaran:

    "${runInfo.career.depth.statedExperienceText}"
      -> ${(runInfo.career.depth.statedExperienceYears ?? 0).toFixed(1)} tahun${statedMult === 1 ? '  (apa adanya)' : `  × ${statedMult}`}  =  ${fx(runInfo.career.depth.targetYears, 2)} tahun
`
    : ''
}
Median pool yang terukur (DIAGNOSTIK saja, tidak dipakai menghitung):

    median tahun efektif    =  ${fx(runInfo.career.depth.medianEffectiveYears, 3)}
    median periode efektif  =  ${fx(runInfo.career.depth.medianEffectiveRows, 3)}
    ukuran pool             =  ${runInfo.career.depth.poolSize} kandidat`}</Formula>
                      {/* Every branch names WHICH condition applied. The version
                          this replaced said "tidak menyebut syarat ... ATAU
                          syaratnya setelah dikali 2 masih di bawah standar" — one
                          sentence for two different findings, with the multiplier
                          hardcoded. An operator read a correctly-detected 5-year
                          requirement as undetected because of it. */}
                      <p className="text-[10px] leading-relaxed text-muted-foreground">
                        {runInfo.career.depth.source === 'inherited' ? (
                          'Run ini menambahkan atau mengurangi kandidat di atas run sebelumnya. Kandidat yang dibawa dari run dasar sudah dinilai dengan penggaris run itu, sehingga memakai penggaris baru akan membuat dua paruh peringkat tidak sebanding.'
                        ) : runInfo.career.depth.source === 'jd' ? (
                          <>
                            Job profile jabatan sasaran{' '}
                            <span className="font-medium text-foreground">menyebut</span> syarat
                            pengalaman, dan angka itulah yang dipakai
                            {runInfo.career.depth.statedMode === 'direct'
                              ? ' langsung tanpa pengali.'
                              : ` × ${runInfo.career.depth.statedMultiplier ?? 2}.`}{' '}
                            {runInfo.career.depth.statedMode === 'direct'
                              ? 'Perlu diketahui: syarat di job profile berarti tahun kalender MENTAH di satu jabatan tertentu, sedangkan sumbu yang dibandingkan adalah "tahun efektif" — tiap tahun sudah dipotong oleh seberapa dekat pekerjaannya dan seberapa lama berakhirnya. Rasio tengah terukur di deployment ini 0,398, jadi memakai angka job profile apa adanya berarti memakai kira-kira 40% dari yang sebenarnya dimaksud dokumen.'
                              : 'Dikali karena syarat tertulis adalah batas MINIMAL untuk dianggap layak, bukan titik yang pantas mendapat nilai penuh — dan karena satuannya berbeda: syarat job profile adalah tahun kalender mentah, sedangkan sumbu ini "tahun efektif" yang sudah dipotong relevansi dan usia pengalaman.'}
                          </>
                        ) : runInfo.career.depth.source === 'measured' ? (
                          <>
                            {runInfo.career.depth.statedIgnoredReason === 'mode-ignore'
                              ? 'Syarat pengalaman di job profile sengaja tidak dibaca pada konfigurasi ini. '
                              : 'Job profile jabatan sasaran tidak menyebut syarat pengalaman dalam tahun yang bisa dibaca — entah tertulis "Fresh graduate", tertulis dalam bentuk lain, atau jabatan ini memang belum punya dokumen job profile. '}
                            Karena itu tolok ukurnya{' '}
                            <span className="font-medium text-foreground">diukur</span>, bukan
                            dikarang: median lama bekerja orang-orang yang{' '}
                            <span className="font-medium text-foreground">
                              benar-benar pernah diangkat
                            </span>{' '}
                            ke jabatan setingkat ini.
                          </>
                        ) : (
                          <>
                            Job profile jabatan sasaran tidak menyebut syarat pengalaman yang bisa
                            dibaca, DAN catatan pengangkatan nyata belum bisa diukur — jadi dipakai
                            angka tetap dari konfigurasi. Ini{' '}
                            <span className="font-medium text-foreground">
                              satu-satunya angka di kriteria career yang tidak diturunkan dari data
                            </span>
                            . Begitu riwayat jabatan karyawan terisi cukup, ia digantikan otomatis
                            oleh median pengangkatan nyata per tingkat jabatan.
                          </>
                        )}
                      </p>
                      {/* The number itself, and where it came from. Only printed
                          when a census actually backed it — never as prose that
                          could be mistaken for a house standard. */}
                      {runInfo.career.depth.measured && (
                        <div className="rounded-md border border-dashed px-2.5 py-2 text-[10px] leading-relaxed">
                          <p className="font-semibold text-foreground">
                            Tolok ukur terukur untuk tingkat{' '}
                            {runInfo.career.depth.levelLabel ?? '—'}:{' '}
                            {runInfo.career.depth.measured.years} tahun
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {runInfo.career.depth.measured.basis === 'level'
                              ? `Median lama bekerja dari ${runInfo.career.depth.measured.sampleCount} pengangkatan nyata ke jabatan setingkat ini.`
                              : runInfo.career.depth.measured.basis === 'monotonic'
                                ? `Tingkat ini belum punya cukup catatan pengangkatan sendiri, jadi dipakai angka tingkat di bawahnya yang paling menuntut — supaya jabatan yang lebih senior tidak justru jadi lebih mudah daripada yang lebih junior.`
                                : `Median seluruh tingkat jabatan (${runInfo.career.depth.measured.sampleCount} pengangkatan), dipakai karena tingkat ini belum punya catatan pengangkatan sendiri yang cukup.`}
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {runInfo.career.depth.measured.reason}
                          </p>
                          <p className="mt-1 rounded-md bg-muted/40 px-2 py-1.5 text-muted-foreground">
                            <span className="font-medium text-foreground">
                              Kenapa pengangkatan nyata, bukan angka di job profile.
                            </span>{' '}
                            Terukur di korpus ini, job profile menyebut angka yang{' '}
                            <span className="font-medium text-foreground">3–7× lebih rendah</span>{' '}
                            daripada pengalaman orang yang benar-benar diangkat: Department Head
                            menuntut 3 tahun di dokumen sementara yang diangkat rata-rata sudah
                            bekerja 9,2 tahun. Angka di dokumen adalah ambang kelayakan yang
                            ditulis di template, bukan gambaran siapa yang benar-benar dipilih.
                          </p>
                        </div>
                      )}
                      <p className="rounded-md bg-emerald-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-emerald-700 dark:text-emerald-300">
                        Karena T tidak diambil dari peserta run, skor Career pada run ini sebanding
                        langsung dengan run lain yang juga memakai penggaris absolut. Median pool
                        tetap diukur dan ditampilkan di atas karena
                        &ldquo;median pengalaman relevan bench ini hanya{' '}
                        {fx(runInfo.career.depth.medianEffectiveRows, 2)} periode efektif&rdquo;
                        adalah kalimat paling berguna tentang bench yang skornya jelek — ia hanya
                        tidak lagi menentukan skalanya.
                      </p>
                    </>
                  )}

                  <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Catatan sumber:</span>{' '}
                    {runInfo.career.depth.reason}
                  </p>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-75 text-[10px]">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-1 text-left font-semibold">Kapan T diambil dari mana</th>
                          <th className="py-1 text-left font-semibold">Nilai T</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {[
                          ['Run inkremental (tambah kandidat / peringkat ulang)', 'diwarisi dari run dasar', 'inherited'],
                          [
                            statedMult === 1
                              ? 'Job profile sasaran menyebut syarat pengalaman yang bisa dibaca'
                              : `Job profile sasaran menyebut syarat pengalaman, dan × ${statedMult} melebihi standar`,
                            statedMult === 1
                              ? 'syarat tertulis apa adanya, dijepit 3–20 th'
                              : `syarat tertulis × ${statedMult}, dijepit 3–20 th`,
                            'jd',
                          ],
                          [
                            'Job profile tidak menyebut syarat yang bisa dibaca, tapi catatan pengangkatan nyata cukup',
                            'median lama bekerja yang benar-benar diangkat ke tingkat ini',
                            'measured',
                          ],
                          ['Keduanya tidak tersedia — jalan terakhir', 'standar tetap: 8 tahun / 2 periode', 'fixed'],
                          ['Run sebelum penggaris menjadi absolut', 'aturan lama: median pool × 2', 'pool'],
                        ].map(([kondisi, nilai, src]) => (
                          <tr
                            key={src}
                            className={cn(
                              'border-b border-dashed last:border-0',
                              runInfo.career.depth!.source === src &&
                                'bg-primary/10 font-medium text-foreground'
                            )}
                          >
                            <td className="py-1">{kondisi}</td>
                            <td className="py-1">{nilai}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  Run ini selesai sebelum target pengalaman (T_tahun / T_periode) mulai dicatat,
                  sehingga asal kedua angka itu tidak diketahui.
                </p>
              )}
              {/* ── The incumbent-competency fallback, in full ─────────
                  Previously one paragraph. It is the path that scores stints on
                  a deployment where most positions have no JD, so "scored from
                  the incumbents instead" was carrying a whole mechanism — with
                  its own divisor, its own bonus rule, and a deliberate clip that
                  makes it behave differently from the Technical criterion using
                  the identical matcher. A reader who assumed the two agree would
                  be wrong, and could not have found out from the numbers. */}
              <Note title="Kalau jabatan lampau tidak punya job profile">
                Periode itu tetap dinilai, bukan dilewati: kompetensi para pemegang jabatan tersebut
                dibandingkan dengan daftar kompetensi posisi sasaran memakai pencocokan yang sama
                dengan kriteria Technical — identity diselesaikan lebih dulu, Hungarian untuk
                sisanya. Yang dibandingkan tetap jabatan lawan jabatan, jadi ia mengukur hal yang
                sama dengan jalur dokumen dan bukan menduplikasi Technical. Periode yang tetap tidak
                dapat dinilai menyumbang 0 ke kedua akumulasi — cakupan data yang buruk memang
                menurunkan skor, bukan disembunyikan dengan mengeluarkannya dari pembagi.
              </Note>

              <Formula>{`JALUR PENGGANTI, per periode jabatan tanpa dokumen

  1. Pilih pemegang jabatan dengan kode posisi periode ini
       · dibatasi ke perusahaan periode tsb; kalau perusahaan itu tak punya
         catatan kode tersebut, dilebarkan ke semua perusahaan
       · kandidat yang sedang dinilai SELALU dikeluarkan
       · ada yang aktif   →  SEMUA pemegang aktif dipakai
         tidak ada aktif  →  HANYA SATU, yang paling akhir berhenti

  2. Gabungkan kompetensi mereka  →  level TERTINGGI per nama
       (bukan dijumlah, bukan dirata-rata)

  3. Cocokkan ke acuan posisi sasaran${
           runInfo.career.calibration?.idfWeighted
             ? `

         cakupan  =  Σ ( bobot(k) × nilai sel(k) )  ÷  Σ bobot(k)

         bobot(k)   =  ln( N ÷ df(k) )     "bobot kekhasan" (IDF)
                       N     = jumlah dokumen job profile
                       df(k) = berapa dokumen yang meminta kompetensi k
                       dijepit ke minimum 0,15 — kompetensi yang hampir
                       universal DILEMAHKAN, tidak dihapus`
             : `

         cakupan  =  Σ nilai sel  ÷  M      (tanpa bobot kekhasan)`
         }

         nilai sel  =  sim′  ×  faktor_level
         M          =  jumlah kompetensi ACUAN POSISI SASARAN${
           runInfo.career.fallbackRequiredCount != null
             ? `  =  ${runInfo.career.fallbackRequiredCount}`
             : ''
         }
                      dikurangi kolom yang tak dapat diukur

  4. Setarakan ke skala dokumen   cakupan dijepit ke 0–1 lebih dulu

         m(i)  =  lo  +  cakupan × ( hi − lo )${
           runInfo.career.calibration
             ? `
                  lo = ${fx(runInfo.career.calibration.lo, 4)}   hi = ${fx(runInfo.career.calibration.hi, 4)}${
                 runInfo.career.calibration.cap != null
                   ? `

         hi BUKAN batas atas skala penuh:
                  hi  =  lo + ${fx(runInfo.career.calibration.cap, 2)} × ( batas_atas − lo )
                  → cakupan 100% berhenti di sim′ ${fx(runInfo.career.calibration.cap, 2)}, bukan 1,00`
                   : ''
               }`
             : ''
         }

  5. Masuk ke rumus yang sama dengan periode ber-dokumen
         s(i) → tahun efektif & periode efektif`}</Formula>

              {/* The cap and the IDF census are both invisible in the numbers
                  themselves — a reader sees a coverage figure and a similarity and
                  cannot tell that one was weighted and the other ceilinged. Both
                  changed what this path is worth, so both have to be stated. */}
              {runInfo.career.calibration?.cap != null ? (
                <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="text-[10px] font-bold text-foreground">
                    Plafon jalur ini: cakupan kompetensi 100% berhenti di sim′{' '}
                    {fx(runInfo.career.calibration.cap, 2)}
                  </p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Bukti dari kompetensi orang yang kebetulan menduduki sebuah jabatan lebih lemah
                    daripada dokumen job profile yang benar-benar ada, dan itu terukur: cakupan
                    kompetensi membedakan rumpun jabatan jauh lebih buruk daripada kemiripan dokumen
                    (AUC 0,743 lawan 0,874), dan{' '}
                    <span className="font-medium text-foreground">
                      5% pasangan jabatan yang TIDAK berhubungan pun berbagi ≥ 75% kompetensi
                    </span>
                    . Jadi separuh skala adalah paling banyak yang bisa dipikul argumen kompetensi
                    secara jujur.
                  </p>
                  <p className="rounded-md bg-background/60 px-2.5 py-2 text-[10px] leading-relaxed">
                    <span className="font-semibold">Aturan lama yang diganti.</span> Rentangnya dulu
                    diambil dari p5–p95 kemiripan dokumen run itu sendiri. Niatnya sudah benar dan
                    tertulis — &ldquo;pengukuran pengganti tidak boleh mengalahkan kecocokan dokumen
                    yang sungguhan&rdquo; — tetapi implementasinya justru sebaliknya, karena p95 dari
                    beberapa puluh periode praktis sama dengan maksimumnya. Pada run IT Application
                    Development Department Head rentangnya keluar [0,563 , 0,949], dan 0,949 tepat
                    kemiripan jabatan itu terhadap dokumen{' '}
                    <em>IT Application Development Analyst</em>-nya sendiri. Cakupan kompetensi penuh
                    membeli klaim &ldquo;ini MEMANG pekerjaan itu&rdquo;. Terukur pada 660 kandidat:
                    yang dinilai dari dokumen asli rata-rata 35,1, yang dinilai lewat jalur ini 66,7
                    — dan 90 dari 104 kandidat berskor ≥ 90 mengandung bukti jalur ini.
                  </p>
                </div>
              ) : runInfo.career.calibration ? (
                <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
                  <span className="font-semibold">Aturan lama.</span> Run ini menyetarakan cakupan ke
                  p5–p95 kemiripan dokumen run ini sendiri, dan p95 dari beberapa puluh periode
                  praktis sama dengan kecocokan dokumen TERBAIK di run itu — sehingga cakupan
                  kompetensi 100% bernilai sama dengan &ldquo;ini persis pekerjaan yang sama&rdquo;.
                  Kandidat yang riwayatnya banyak dinilai lewat jalur ini mendapat skor Career yang
                  terlalu tinggi pada run ini.
                </p>
              ) : null}

              {runInfo.career.idf && (
                <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-[10px] font-bold text-foreground">
                    Bobot kekhasan kompetensi (IDF) — dari mana angkanya
                  </p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Diukur atas {runInfo.career.idf.docCount} dokumen job profile,{' '}
                    {runInfo.career.idf.keyCount} kompetensi berbeda. Tanpa pembobotan ini, rata-rata
                    cakupan didominasi kompetensi yang diminta hampir semua jabatan — sehingga{' '}
                    <span className="font-medium text-foreground">
                      siapa pun yang manajer otomatis menutup ~45% syarat jabatan apa pun
                    </span>
                    , lalu angka itu disetarakan ke skala dokumen dan terbaca sebagai jabatan yang
                    benar-benar berkerabat.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-90 text-[10px]">
                      <thead>
                        <tr className="border-b text-muted-foreground">
                          <th className="py-1 text-left font-semibold">
                            Kompetensi paling umum di korpus
                          </th>
                          <th className="py-1 text-right font-semibold">Diminta oleh</th>
                          <th className="py-1 text-right font-semibold">Bobot</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {runInfo.career.idf.mostCommon.map((m) => (
                          <tr key={m.name} className="border-b border-dashed last:border-0">
                            <td className="py-1 pr-2 wrap-break-word">{m.name}</td>
                            <td className="py-1 text-right whitespace-nowrap">
                              {m.documentFrequency}/{runInfo.career.idf!.docCount} (
                              {Math.round((m.documentFrequency / runInfo.career.idf!.docCount) * 100)}
                              %)
                            </td>
                            <td className="py-1 text-right font-mono">{fx(m.weight, 3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Bobot dijepit ke minimum 0,15: kompetensi yang hampir universal{' '}
                    <span className="font-medium text-foreground">dilemahkan, bukan dihapus</span> —
                    ia tetap syarat yang tertulis. Kompetensi yang tidak pernah muncul di korpus
                    memakai bobot tertinggi yang korpus itu sendiri tunjukkan, tidak lebih, supaya
                    satu nama yang cuma salah tulis tidak bisa mendominasi seluruh rata-rata.
                  </p>
                  <p className="rounded-md bg-background/60 px-2.5 py-2 text-[10px] leading-relaxed">
                    <span className="font-semibold">Hanya untuk jalur ini, bukan untuk Technical.</span>{' '}
                    Di kriteria Technical pertanyaannya &ldquo;bisakah orang ini mengerjakan apa yang
                    diminta jabatan&rdquo; — di sana kompetensi yang umum tetap wajib, dan
                    melemahkannya berarti memaafkan kesenjangan yang nyata. Di sini pertanyaannya
                    &ldquo;apakah ini jenis pekerjaan yang sama&rdquo;, dan kompetensi yang diminta
                    93% dokumen tidak bisa menjawabnya. Karena itu bobot ini parameter opsional dan
                    Technical tidak mengirimkannya — angkanya tidak berubah sedikit pun.
                  </p>
                </div>
              )}

              {runInfo.career.fallbackRequiredCount != null && (
                <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">Acuan run ini:</span>{' '}
                  {runInfo.career.fallbackRequiredCount} kompetensi, diambil dari{' '}
                  {requiredSourceLabel(runInfo.career.fallbackRequiredSource)}.
                  {runInfo.career.coverage && (
                    <>
                      {' '}
                      {runInfo.career.coverage.fallbackStints} periode jabatan dinilai lewat jalur
                      ini ({fx(runInfo.career.coverage.fallbackYears, 1)} tahun), dibanding{' '}
                      {runInfo.career.coverage.documentStints} periode yang punya dokumen.
                    </>
                  )}
                </p>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-75 text-[10px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-semibold">Yang sering disalahpahami</th>
                      <th className="py-1 text-left font-semibold">Aturan sebenarnya</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    {[
                      [
                        'Pemegang jabatan punya kompetensi jauh lebih banyak daripada yang diminta',
                        'Tidak ada bonus. Penugasan satu-ke-satu, kolomnya hanya M — kelebihan cuma memberi pilihan lebih baik per kolom.',
                      ],
                      [
                        'Kompetensi yang diminta tidak tertutup',
                        'Bukan hukuman tersendiri: kolom itu bernilai 0, jadi cakupan turun sebanding. Tidak ada suku penalti.',
                      ],
                      [
                        'Kompetensi acuan yang tidak dapat dipetakan',
                        'Dikeluarkan dari pembagi (M mengecil), bukan dihitung nol yang ditanggung semua kandidat.',
                      ],
                      [
                        'Level melebihi yang diminta',
                        'Satu-satunya bonus yang ada — dan hanya untuk pasangan identik: 1 + 0,75 × (c − r) ÷ 3, maksimal 1,75. Pasangan semantic dibatasi 1,00.',
                      ],
                      [
                        'Bonus 1,75 itu bisa membuat skor lewat 100',
                        'Tidak. Nilai per pasangan bisa 1,75, tetapi cakupan agregat dijepit ke 0–1 di kedua kriteria — di Technical skornya berhenti di 100, di Career cakupan penuh berhenti di hi. Surplusnya kompensatoris: menutup kekurangan level di kompetensi lain, bukan melampaui "memenuhi semua". Run yang selesai sebelum pembatasan ini masih menyimpan skor di atas 100 dan tidak ditulis ulang.',
                      ],
                      [
                        'Banyaknya pemegang jabatan yang ditemukan',
                        'Tidak menaikkan nilai dengan sendirinya — mereka digabung dengan level tertinggi per nama, jadi satu orang bercakupan penuh sama dengan lima orang bercakupan penuh.',
                      ],
                      [
                        'Banyaknya periode jabatan yang berhasil dinilai',
                        'Berpengaruh, lewat sumbu riwayat: tiap periode terskor menambah sim′-nya. Tapi skor akhir adalah yang terkecil dari dua sumbu, jadi banyak periode pendek tetap tertahan sumbu durasi.',
                      ],
                    ].map(([salah, benar]) => (
                      <tr key={salah} className="border-b border-dashed last:border-0">
                        <td className="py-1 pr-3 align-top">{salah}</td>
                        <td className="py-1 align-top">{benar}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="rounded-md bg-muted/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-foreground">Nilai ini tidak bergantung pada kandidat.</span>{' '}
                Ia perbandingan posisi lawan posisi, di-cache per (kode jabatan, perusahaan), jadi
                dua kandidat dengan periode jabatan yang sama mendapat s(i) yang sama — kecuali
                melalui pengecualian diri: kandidat tidak boleh menjadi acuan bagi jabatan yang ia
                pegang sendiri, karena itu akan mencocokkannya dengan asesmennya sendiri dan memberi
                nilai ~1,0 untuk jabatan yang tidak kita ketahui apa-apa.
              </p>
              {runInfo.career.message && (
                <Note title="Catatan run ini">{runInfo.career.message}</Note>
              )}

              <CareerCitations />
            </CriterionItem>

            {/* ── 3. Behavior ────────────────────────────────────── */}
            <CriterionItem
              value="behavior"
              label="Behavior Competency"
              weight={ahp.weights.behavior}
              dropped={droppedReason('behavior')}
            >
              <Note title="Data yang dipakai">
                Satu label rekomendasi dari hasil asesmen behavior kandidat. Tidak ada model bahasa
                yang terlibat — aturannya deterministik, sehingga run yang diulang dengan data yang
                sama pasti menghasilkan angka yang sama.
              </Note>
              <Note title="Sebelum dihitung">
                Label diseragamkan lebih dulu: huruf besar semua, spasi berlebih dirapikan, dan
                tanda hubung panjang disamakan. Pencocokan ke daftar kategori dicoba berurutan —
                sama persis, lalu kategori terpanjang yang terkandung di dalam label, lalu kategori
                terpendek yang memuat label tersebut. Urutan ini penting supaya
                &ldquo;VERY HIGH&rdquo; tidak tertangkap sebagai &ldquo;HIGH&rdquo;.
              </Note>
              <Formula>{`Kategori dinilai BERPASANGAN — dua kategori berbagi satu nilai:

    nilai ordinal  6 … 0
    skor Behavior  =  nilai ordinal  ×  100  ÷  6`}</Formula>
              <div className="overflow-x-auto">
                <table className="w-full min-w-75 text-[10px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-semibold">Kategori rekomendasi</th>
                      <th className="py-1 text-right font-semibold">Nilai</th>
                      <th className="py-1 text-right font-semibold">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    {[
                      ['VERY HIGH · STRENGTH', '6', '100'],
                      ['HIGH · READY', '5', '83'],
                      ['MIDDLE HIGH · PENGEMBANGAN JANGKA PENDEK', '4', '67'],
                      ['READY WITH DEVELOPMENT · POTENSI', '3', '50'],
                      ['NEED DEVELOPMENT (9 BULAN–2 TAHUN) · MIDDLE LOW', '2', '33'],
                      ['FOCUS ON OPTIMIZATION IN CURRENT POSITION · LOW', '1', '17'],
                      ['BELUM ADA POTENSI · VERY LOW · NOT READY', '0', '0'],
                    ].map(([a, b, c]) => (
                      <tr key={a} className="border-b border-dashed last:border-0">
                        <td className="py-1">{a}</td>
                        <td className="py-1 text-right font-mono">{b}</td>
                        <td className="py-1 text-right font-mono">{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note title="Kalau asesmennya tidak ada atau tidak dikenali">
                Skornya 0. Berbeda dengan level kompetensi yang tidak terbaca pada kriteria
                Technical, di sini tidak ada perlakuan netral: kriteria ini menilai bukti positif
                dari sebuah asesmen, dan tanpa asesmen memang tidak ada bukti yang bisa diperingkat.
              </Note>
            </CriterionItem>

            {/* ── 4. Performance Appraisal ───────────────────────── */}
            <CriterionItem
              value="performance"
              label="Performance Appraisal"
              weight={ahp.weights.performance}
              dropped={droppedReason('performance')}
            >
              <Note title="Data yang dipakai">
                Daftar nilai PA kandidat per semester, terbaru di urutan pertama.
              </Note>
              <Note title="Sebelum dihitung">
                Sumbernya satu CSV <b>enam slot semester</b>, terbaru di urutan pertama:
                tahun−1 Sem 2 · tahun−1 Sem 1 · tahun−2 Sem 2 · tahun−2 Sem 1 · tahun−3 Sem 2 ·
                tahun−3 Sem 1. Jendelanya <b>tiga tahun kalender sebelum tahun berjalan</b> — tahun
                berjalan selalu dikecualikan, jadi nilai semester ini belum ikut terhitung.
                <br />
                Tiap huruf diubah menjadi angka — A=4, B=3, C=2, D=1, E=0. Slot yang kosong atau
                tidak dikenali <b>dibaca sebagai C</b>, bukan diabaikan: mengabaikan akan
                mengecilkan pembagi, sementara membaca sebagai C memasukkan periode itu dengan nilai
                tengah. Karena itu kandidat tanpa data PA sama sekali mendapat <b>33</b>, bukan 0 dan
                bukan 50.
              </Note>
              <Formula>{`TOPSIS dengan JANGKAR ABSOLUT atas enam periode,
bobot periode terdegradasi ke belakang.

BOBOT PERIODE — semakin lama semakin kecil

    Preferensi kebaruan 0,8^k diubah menjadi matriks
    perbandingan berpasangan yang konsisten sempurna, lalu
    diambil vektor prioritas AHP-nya (CR = 0):

        periode 1 (terbaru)  27,1%      periode 4   13,9%
        periode 2            21,7%      periode 5   11,1%
        periode 3            17,3%      periode 6    8,9%

    Semester terbaru bernilai ~3x yang tertua. Bila
    periodenya lebih sedikit, bobot dinormalisasi ulang atas
    slot yang ada.


DUA JANGKAR TETAP  — bukan diambil dari kandidat lain

    ideal      = semua A  →  4
    anti-ideal = semua D  →  1


JARAK KE MASING-MASING JANGKAR

    D⁺  =  √( Σ w(k) × ( x(k) − 4 )² )       jarak ke "semua A"
    D⁻  =  √( Σ w(k) × ( x(k) − 1 )² )       jarak ke "semua D"


KEDEKATAN → SKOR

    CC  =  D⁻  ÷  ( D⁺ + D⁻ )        bila keduanya 0 → 0,5
    skor Performance  =  bulat( CC × 100 )


CONTOH TERVERIFIKASI

    A,A,A,A,A,A → 100      C,C,C,C,C,C →  33
    B,B,B,B,B,B →  67      D,D,D,D,D,D →   0
    (semua kosong) → 33     E,E,E,E,E,E →  20
    A,C,C,C,C,C →  51      C,C,C,C,C,A →  41
    A,B,B,C,C,C →  61      A,A,B,B,C,C →  70`}</Formula>
              <Note title="Mengapa bobot periode didegradasi, dan apa akibatnya">
                Jangkarnya tetap, bukan diambil dari sebaran peserta run — karena itu{' '}
                <b>skor PA sebanding antar-run</b>, berbeda dari skor akhir TOPSIS yang bergantung
                pada siapa saja yang ikut.
                <br />
                Periode lama <b>didegradasi bobotnya dengan sengaja</b>: semester tiga tahun lalu
                adalah bukti yang lebih lemah tentang kemampuan sekarang dibanding semester terakhir.
                Konsekuensinya <em>urutan</em> nilai berpengaruh —{' '}
                <span className="font-mono">A,C,C,C,C,C</span> mendapat 51 sementara{' '}
                <span className="font-mono">C,C,C,C,C,A</span> mendapat 41. Itu bacaan yang
                dimaksudkan, bukan efek samping: yang pertama membaik belakangan, yang kedua menurun.
                <br />
                Perlu diketahui: pada kandidat yang nilainya <b>seragam di keenam periode</b>, bobot
                tidak berpengaruh sama sekali — kedua jarak berskala √(Σw) = 1 sehingga
                kedekatannya identik untuk pembobotan apa pun. Pada data saat ini 94% kandidat berada
                dalam kondisi itu, jadi degradasi bobot hanya membedakan 6% sisanya — tepat pada
                kandidat yang rekam jejaknya memang bergerak.
              </Note>
              <Note title="Anomali nyata: E dinilai lebih tinggi daripada D">
                Nilai E dipetakan ke 0, yang berada <b>di bawah</b> jangkar negatif D = 1. Jaraknya
                ke &ldquo;semua D&rdquo; karena itu bukan nol, sehingga rekam jejak{' '}
                <span className="font-mono">semua E</span> mendapat <b>20</b> sementara{' '}
                <span className="font-mono">semua D</span> mendapat <b>0</b>. Ini konsekuensi
                pemilihan jangkar pada dokumen metodologi, bukan penilaian atas kandidatnya — dan
                disampaikan di sini karena tidak dapat disimpulkan dari angkanya.
              </Note>
              <Note title="Mengapa titik acuannya tetap">
                Berbeda dengan TOPSIS peringkat akhir, titik terbaik dan terburuk di sini tidak
                diambil dari kandidat lain melainkan dipatok pada &ldquo;semua A&rdquo; dan
                &ldquo;semua D&rdquo;. Akibatnya nilai PA seseorang tidak berubah hanya karena
                pesaingnya berganti, sehingga sebanding antar-run dan antar-posisi.
              </Note>
            </CriterionItem>

            {/* ── 5. HAV ─────────────────────────────────────────── */}
            <CriterionItem
              value="hav"
              label="HAV Mapping"
              weight={ahp.weights.hav}
              dropped={droppedReason('hav')}
            >
              <Note title="Data yang dipakai">
                Nomor kuadran HAV kandidat (1–16). Tidak ada perhitungan kemiripan maupun model
                bahasa — hanya pemetaan tabel.
              </Note>
              <Note title="Sebelum dihitung">
                Angka diambil dari teks kuadran dengan membuang seluruh karakter non-angka, sehingga
                penulisan seperti &ldquo;Kuadran 7&rdquo; maupun &ldquo;7&rdquo; sama-sama terbaca.
              </Note>
              <div className="overflow-x-auto">
                <table className="w-full min-w-75 text-[10px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1 text-left font-semibold">Kuadran</th>
                      <th className="py-1 text-left font-semibold">Tingkat</th>
                      <th className="py-1 text-right font-semibold">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="text-muted-foreground">
                    {[
                      ['1', 'Highly Recommended', '100'],
                      ['2, 3, 4, 7, 8', 'Recommended', '80'],
                      ['5, 6, 9, 13, 14', 'Solid / belum bisa direkomendasikan', '60'],
                      ['10, 11, 12, 15', 'Tidak direkomendasikan', '40'],
                      ['16', 'Bottom', '20'],
                      ['kosong / tidak terbaca', '—', '40'],
                    ].map(([a, b, c]) => (
                      <tr key={a} className="border-b border-dashed last:border-0">
                        <td className="py-1 font-mono">{a}</td>
                        <td className="py-1">{b}</td>
                        <td className="py-1 text-right font-mono">{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note title="Mengapa data kosong bernilai 40, bukan 20">
                Kuadran 16 adalah penilaian nyata bahwa seseorang berada di posisi terbawah. Tidak
                adanya data bukan penilaian apa pun. Menyamakan keduanya berarti menuduh kandidat
                yang datanya belum masuk, jadi data kosong ditempatkan pada tingkat
                &ldquo;tidak direkomendasikan&rdquo; — rendah, tetapi tidak terbawah.
              </Note>
            </CriterionItem>

            {/* ── 6. Education ───────────────────────────────────── */}
            <CriterionItem
              value="education"
              label="Education"
              weight={ahp.weights.education}
              dropped={droppedReason('education')}
            >
              <Note title="Data yang dipakai">
                Jenjang dan jurusan pendidikan kandidat, dibandingkan dengan syarat pendidikan pada
                job profile serta daftar tanggung jawab dan indikator keberhasilan posisi.
              </Note>
              <Note title="Sebelum dihitung">
                Kedua teks dipecah menjadi kata, kata umum seperti &ldquo;minimal&rdquo;,
                &ldquo;jurusan&rdquo;, dan &ldquo;sederajat&rdquo; dibuang, lalu jenjang dipetakan
                ke peringkat baku: SD 1 · SMP 2 · SMA/SMK 3 · D1 4 · D2 5 · D3 6 ·{' '}
                <b>D4 = S1 = 8</b> · S2 9 · S3 10. D4 sengaja disetarakan S1 karena keduanya KKNI
                level 6. Sinonim dilipat ke peringkat yang sama — termasuk ejaan bahasa Inggris yang
                dipakai sumber HR (&ldquo;Senior High School&rdquo;, &ldquo;Bachelor Degree&rdquo;)
                dan penulisan &ldquo;S-1&rdquo;.
                <br />
                Untuk jurusan, syarat dipecah menjadi daftar jurusan yang diterima (dipisah
                &ldquo;/&rdquo;, koma, &ldquo;atau&rdquo;), keterangan dalam tanda kurung dibuang
                karena itu preferensi, dan ejaan Inggris–Indonesia disetarakan
                (management=manajemen, accounting=akuntansi, dan seterusnya).
              </Note>
              <Formula>{`SUMBU JENJANG — SELALU aturan tetap, di kedua jalur

    jenjang kandidat lebih tinggi dari syarat   →  100
    jenjang setara                              →   80
    jenjang lebih rendah                        →   50
    tidak ada jenjang dikenali di kedua sisi    →  sumbu DIBUANG


JALUR 1 — jurusan juga cocok persis (tanpa model bahasa)

    skor Education  =  sumbu jenjang

    Cocok persis jurusan = SELURUH kata dari salah satu jurusan
    yang diterima ada pada jurusan kandidat. Satu kata yang sama
    saja TIDAK cukup.


JALUR 2 — jurusan tidak cocok persis

    Relevansi dinilai Gemini dengan Grounding Google Search,
    suhu 0, rubrik tetap. Model ditanya jenjang dan jurusan
    secara TERPISAH, lalu kedua jawabannya diakumulasikan
    menjadi SATU sumbu:

        sumbu relevansi = ( jawaban jenjang + jawaban jurusan ) ÷ 2

        skor Education  =  ( sumbu jenjang + sumbu relevansi ) ÷ 2

    Bila sumbu jenjang dibuang → skor = sumbu relevansi saja.


JALUR 3 — tidak dapat dinilai                   →    0
    Kandidat tanpa data pendidikan, Gemini belum dikonfigurasi,
    atau seluruh percobaan gagal validasi. Ditandai
    "tidak dinilai", bukan disamarkan sebagai nilai rendah.`}</Formula>
              <Note title="Mengapa kesesuaian jenjang tidak pernah ditentukan model">
                Jenjang adalah perbandingan tangga peringkat atas data yang sudah dinormalkan
                aplikasi — tidak ada yang perlu ditaksir model. Sebelumnya perbandingan itu hanya
                dijalankan di dalam pemeriksaan cocok-persis, sehingga kandidat yang dialihkan ke
                grounding jenjangnya dinilai model. Akibatnya aturan &ldquo;di atas syarat minimal
                dihargai lebih tinggi daripada sekadar setara&rdquo; hanya berlaku di satu jalur,
                dan yang menentukan aturan itu berlaku atau tidak justru hal yang tak berhubungan:
                kecocokan <em>jurusan</em>. Sekarang sumbu jenjang dihitung sama di kedua jalur, dan
                jawaban model tentang jenjang masuk ke sumbu relevansi sebagai bukti pendukung —
                bukan sebagai sumbunya sendiri.
                <br />
                Konsekuensinya dapat diperiksa: pada relevansi yang sama, jenjang lebih tinggi
                selalu menghasilkan skor lebih besar. Relevansi 60 dengan jenjang lebih tinggi ={' '}
                <span className="font-mono">(100+60)÷2 = 80</span>; dengan jenjang setara ={' '}
                <span className="font-mono">(80+60)÷2 = 70</span>.
              </Note>
              <Note title="Mengapa tidak ada cadangan berbasis kemiripan teks">
                Sengaja tidak disediakan. Pengukuran kemiripan teks memberi nilai tinggi pada
                jurusan yang sebenarnya tidak relevan, karena istilah akademik antarbidang saling
                mirip. Lebih baik menyatakan tidak dapat dinilai daripada mengeluarkan angka yang
                terlihat wajar tetapi keliru.
              </Note>
              <Note title="Jawaban model dipakai ulang bila masukannya identik">
                Sebelum memanggil model untuk seorang kandidat, mesin memeriksa run AHP + TOPSIS
                terakhir posisi ini. Bila model sudah ditanya hal yang <b>persis sama</b> tentang
                kandidat itu — jenjang dan jurusan, syarat pendidikan, judul posisi, tujuan jabatan,
                tanggung jawab beserta indikatornya, prompt, dan pengaturan model — jawabannya dipakai
                ulang tanpa memanggil model lagi. Masukan yang sama dengan begitu selalu menghasilkan
                skor yang sama, dan token grounding tidak terpakai untuk pertanyaan yang sudah
                terjawab. Sumbu jenjang tetap dihitung ulang dengan aturan run ini; hasil
                &ldquo;tidak dinilai&rdquo; tidak pernah dipakai ulang.
                <br />
                {(() => {
                  const reuse = runInfo?.education?.reuse;
                  if (!reuse) return <><b>Run ini:</b> selesai sebelum pemakaian ulang dicatat.</>;
                  if (!reuse.enabled)
                    return <><b>Run ini:</b> pemakaian ulang dimatikan (AHP_EDUCATION_REUSE=false); model ditanya untuk setiap kandidat.</>;
                  if (reuse.eligible === 0)
                    return <><b>Run ini:</b> tidak ada kandidat yang memerlukan model (semua cocok persis atau tanpa data pendidikan).</>;
                  if (!reuse.fromRunId)
                    return <><b>Run ini:</b> belum ada run sebelumnya pada posisi ini yang bisa dipakai ulang; model dipanggil untuk {reuse.modelCalls} dari {reuse.eligible} kandidat.</>;
                  return (
                    <>
                      <b>Run ini:</b> {reuse.reused} dari {reuse.eligible} kandidat yang memerlukan
                      model memakai ulang jawaban run{' '}
                      <span className="font-mono">{reuse.fromRunId.slice(0, 8)}</span>
                      {reuse.fromCompletedAt ? ` (${formatDateTime(reuse.fromCompletedAt)})` : ''};
                      model dipanggil untuk {reuse.modelCalls} kandidat.
                    </>
                  );
                })()}
              </Note>
              <Note title="Dasar penilaiannya bukan syarat minimal">
                Yang dinilai adalah apakah pendidikan kandidat memadai untuk mengerjakan tanggung
                jawab dan mencapai indikator keberhasilan posisi. Syarat minimal pendidikan pada job
                profile hanya konteks tambahan, bukan patokan utama.
              </Note>
            </CriterionItem>
          </Accordion>
        </AccentSection>
      )}
    </div>
  );
}
