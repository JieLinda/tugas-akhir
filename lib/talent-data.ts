import type { HavSource } from '@/lib/hav-effective';
import type { HavQuadrantSource } from '@/lib/run-score-breakdown';

export type ProgramCode = 'talent' | 'successor' | 'emergency';
export type ReadinessLevel = 'Short' | 'Medium' | 'Long' | 'Not Ready';
export type FilterStatus = 'qualified' | 'reject';

export type ProgramDefinition = {
  code: ProgramCode;
  name: string;
  description: string;
  targetQuadrants: number[];
  focus: string;
};

export type PrimaryFilterRule = {
  indicator: string;
  qualified: string;
  reject: string;
};

export type ScoreComponent = {
  name: string;
  maxValue: number;
  weight: number;
  source: string;
  threshold: string;
};

export type MasterPosition = {
  id: string;
  title: string;
  department: string | null;
  division: string | null;
  level?: string | null;
  description?: string | null;
  currentHolder?: {
    name: string;
    employeeId: string;
    since?: string | null;
  };
  /** Employees actively assigned to this position id. Frequently >1 for
   *  non-unique roles (SALESMAN, INSTRUCTOR, …), where `currentHolder` is only
   *  the first of several — the picker says so rather than implying it's the one. */
  activeHolderCount?: number;
};

/** One sitting incumbent, with what succession planning needs to know: how
 *  close they are to retiring, judged against their own level's threshold. */
export type PositionHolderInfo = {
  name: string;
  employeeId: string;
  /** Derived from the candidate's birth date; null when it has not synced. */
  age: number | null;
  /** Job level of the holder's grade ("MANAGER"), used to pick the threshold. */
  levelName: string | null;
  /** The threshold that applied — shown so the badge can explain itself. */
  retirementMinAge: number | null;
  retiringSoon: boolean;
};

export type PositionSummary = {
  id: string;
  title: string;
  department: string;
  division: string;
  level?: string;
  minGradeId?: string | null;
  maxGradeId?: string | null;
  status: 'active' | 'review' | 'draft';
  /** The one program this position is managed under — always a single entry
   *  since drizzle/0056; kept as an array for the consumers that render program
   *  chips. */
  programs: ProgramCode[];
  /** Raw program code as stored on the row (may be a custom, non-system code). */
  programCode: string;
  programTemplateId: string | null;
  /** Display name of the program template, falling back to the code. */
  programName: string;
  /** Scoring runs recorded against this position — 0 means its program can
   *  still be changed (see updatePositionAction). */
  runCount: number;
  /** Job profile this seat resolves to. Null means an AHP+TOPSIS run would score
   *  technical and career from the incumbents' competencies instead of the JD. */
  jobProfileId?: number | null;
  jobProfileName?: string | null;
  candidates: number;
  readyNow: number;
  readinessCoverage: number;
  description?: string;
  qualifications: {
    education: string;
    major: string;
    experience: string;
    jobFamily: string;
  };
  requiredCompetencies?: { technicalId: string; technicalName: string; targetProficiency?: string }[];
  currentHolder?: {
    name: string;
    employeeId: string;
    since?: string;
  };
  /**
   * Every active incumbent of this position, primary first. A non-unique role is
   * held by several people at once; `currentHolder` is the first of these and is
   * what the row's own columns carry.
   */
  holders?: PositionHolderInfo[];
  topCandidates?: {
    id: string;
    name: string;
    weightedScore: number;
    readiness: ReadinessLevel;
    rank: number;
  }[];
  scoringInProgress?: boolean;
  /** Metadata of the completed run whose results populate topCandidates. */
  latestRun?: {
    id: string;
    program: string | null;
    method: string;
    label: string | null;
    createdAt: string;
  } | null;
  /** Successors picked (position_picks) for this position, across programs. */
  chosenCandidates?: {
    pickId: string;
    candidateId: string;
    name: string;
    programCode: string;
    score: number | null;
    readiness: string | null;
    rank: number;
  }[];
};

export type PositionCandidate = {
  id: string;
  name: string;
  currentPosition: string;
  yearsOfService: number;
  havQuadrant: string | null;
  /**
   * On a ranked row: whether `havQuadrant` is the quadrant the run scored
   * (`run`), was never recorded by it (`not_recorded`, `havQuadrant` null), or
   * is sealed and unreadable (`locked`). Absent on rows that are not run results.
   * Display through `runHavText` (lib/analysis-utils.ts).
   */
  havQuadrantSource?: HavQuadrantSource;
  /**
   * @deprecated Not a measurement — do not display or export it. Both engines
   * write `min(95, max(30, weightedScore − 5))`, a placeholder from the
   * prototype's mock data, so it only restates the final score. It stays in the
   * type because every stored `analysis_results.details` carries it. The aspect
   * that measures fit to the job is career relevance, `scoreBreakdown.career`.
   */
  jobMatch: number;
  photoUrl: string | null;
  discipline: string;
  mcu: string;
  performance: string;
  behaviorRecommendation: string | null;
  behaviorNotes: string | null;
  primaryFilter: {
    discipline: FilterStatus;
    mcu: FilterStatus;
    performance: FilterStatus;
    hav: FilterStatus;
    behavior: FilterStatus;
    reason?: string;
  };
  scoreBreakdown: {
    technical: number;
    behavior: number;
    hav: number;
    performance: number;
    education: number;
    /** Career relevance — only produced by the AHP+TOPSIS method. */
    career?: number;
  };
  weightedScore: number;
  readiness: ReadinessLevel;
  constraint: string;
  strengths?: string[];
  weaknesses?: string[];
  recommendation?: string[];
};

export type CandidateProfile = {
  id: string;
  name: string;
  email?: string;
  employeeId: string;
  /**
   * Demo mode only (lib/demo/): whether the candidate is ON (takes part in
   * filtering, Talent Pool, Talent Mapping and scoring) and whether it is shown
   * as its demo copy. Absent in real mode.
   */
  demo?: { on: boolean; edited: boolean } | null;
  department: string;
  division: string;
  currentPosition: string;
  yearsOfService: number;
  /** ISO day string from the personal-info sync, e.g. "1990-12-06". */
  birthDate?: string | null;
  /** Derived from birthDate at read time — never stored (see lib/age.ts). */
  age?: number | null;
  education: string;
  major: string;
  jobFamily: string;
  /** Raw grade code as stored on the candidate (e.g. "5", "5A"). */
  grade?: string | null;
  /** Human-readable grade level derived from the grade (e.g. "Supervisor", "Manager"). */
  gradeLevel?: string | null;
  /**
   * The HAV quadrant IN FORCE (manual > upload > formula, lib/hav-effective.ts)
   * when the profile was built through `withEffectiveHav` — which every live
   * profile loader does.
   */
  havQuadrant: string | null;
  havSource?: HavSource;
  /** The HAV Excel value as stored ('' / null when none). */
  uploadedHavQuadrant?: string | null;
  photoUrl: string | null;
  disciplinaryStatus: string;
  mcuStatus: string;
  behaviorRecommendation: string | null;
  behaviorNotes: string | null;
  readiness: ReadinessLevel;
  programs: {
    code: ProgramCode;
    status: 'Qualified' | 'Not Qualified';
    note: string;
  }[];
  assessmentHistory: {
    period: string;
    technical: string;
    behavior: string;
    performance: string;
    readiness: ReadinessLevel;
  }[];
  technicalCompetencies?: {
    technicalId: string;
    technicalName: string;
    proficiencyName: string | null;
    score: number | null;
    currentProficiencyName: string | null;
    currentScore: number | null;
    gap: number | null;
    isManual?: boolean | null;
    sourceKey?: string | null;
  }[];
  /** Chronological list of position assignments for the candidate, oldest first. */
  positionHistory?: {
    positionId: string;
    internalTitle: string | null;
    externalTitle: string | null;
    gradeId: string | null;
    primaryPosition: boolean;
    validFrom: string | null;
    validTo: string | null;
  }[];
  /** Raw DB attribute values for edit form roundtrip (optional in mock data). */
  raw?: {
    employeeId?: string | null;
    disciplineStatus?: string | null;
    mcuStatus?: string | null;
    /** Medical note carried in by the sync — shown read-only, never edited. */
    mcuNote?: string | null;
    /** Medical note typed by a person here; the sync never overwrites it. */
    mcuNoteManual?: string | null;
    performanceGrade?: string | null;
    havQuadrant?: string | null;
    behaviorRecommendation?: string | null;
    behaviorNotes?: string | null;
    photoUrl?: string | null;
    education?: string | null;
    major?: string | null;
  };
};

/** Skinny candidate row for pickers (e.g. incumbent search) — avoids shipping
 *  full profiles (competencies/history) into pages that only need names. */
export type CandidateLookupItem = {
  id: string;
  name: string;
  employeeId: string;
  currentPosition: string;
  department: string | null;
  division: string | null;
};

export const appSummary = {
  name: 'Pulse Talent & Successor',
  subtitle: 'Sistem Penentuan Talent & Successor',
  description:
    'Otomasi penentuan kandidat talent pool, successor, dan emergency position berbasis primary filter, core score, dan audit trail.',
};

export const programCatalog: ProgramDefinition[] = [
  {
    code: 'talent',
    name: 'Talent Pool',
    description: 'Identifikasi karyawan berpotensi tinggi untuk pengembangan karir jangka panjang.',
    targetQuadrants: [1, 2, 3, 4, 7],
    focus: 'Pengembangan pipeline talent strategis.',
  },
  {
    code: 'successor',
    name: 'Critical Position',
    description: 'Kandidat pengganti posisi kritis dalam waktu dekat.',
    targetQuadrants: [1, 2, 3, 4, 7, 8, 13, 14],
    focus: 'Kesiapan pengganti pada posisi kritis.',
  },
  {
    code: 'emergency',
    name: 'Emergency Position',
    description: 'Kandidat darurat untuk posisi yang wajib segera terisi.',
    targetQuadrants: [1, 2, 3, 4, 7, 8],
    focus: 'Kontinjensi operasional dan business continuity.',
  },
];

export const primaryFilterRules: PrimaryFilterRule[] = [
  {
    indicator: 'Disciplinary',
    qualified: 'Tidak pernah SP/ST, atau ST, atau SP1/SP2 tidak aktif >= 2 tahun.',
    reject: 'SP1/SP2 aktif, SP1/SP2 tidak aktif < 2 tahun, pernah SP3, atau SP kesalahan berat.',
  },
  {
    indicator: 'MCU',
    qualified: 'Fit atau Fit with note.',
    reject: 'Unfit.',
  },
  {
    indicator: 'Performance Appraisal',
    qualified: 'Successor min PA A/B, Talent min PA B dalam 3 tahun terakhir.',
    reject: 'Ada grade D atau E dalam 3 tahun terakhir.',
  },
  {
    indicator: 'HAV Mapping',
    qualified: 'Kuadran sesuai program target.',
    reject: 'Di luar kuadran yang ditetapkan program.',
  },
  {
    indicator: 'Behavior Competency / Potential Review',
    qualified: 'Sangat Disarankan, Disarankan, atau Disarankan dengan Pengembangan.',
    reject: 'Tidak Disarankan atau score assessment = 0.',
  },
];

export const scoringComponents: ScoreComponent[] = [
  {
    name: 'Technical Competency Mapping',
    maxValue: 4,
    weight: 25,
    source: 'EDP',
    threshold: 'Strength >= 85%, Ready min 60%, Development min 50%',
  },
  {
    name: 'Behavior Competency Assessment',
    maxValue: 4,
    weight: 40,
    source: 'EDP',
    threshold: 'Semua efektif >= 3 atau min 75% efektif tanpa nilai 1',
  },
  {
    name: 'HAV Mapping',
    maxValue: 2,
    weight: 20,
    source: 'EDP',
    threshold: 'Kuadran Top & Strong sesuai program',
  },
  {
    name: 'Performance Appraisal',
    maxValue: 5,
    weight: 10,
    source: 'EDP',
    threshold: 'A = 5, B = 4, C = 3, C- = 2, D/E = 0',
  },
  {
    name: 'Employee Profile - Pendidikan',
    maxValue: 4,
    weight: 5,
    source: 'Orange, MY Tok',
    threshold: 'Jurusan dan jenjang sesuai atau di atas standar',
  },
];

export const readinessThresholds = [
  { level: 'Short' as const, scoreRange: '>= 80%', eta: '0 - 1 tahun', note: 'Score tinggi dan tidak ada constraint.' },
  { level: 'Medium' as const, scoreRange: '65% - 79%', eta: '2 - 3 tahun', note: 'Score sedang atau masih ada constraint.' },
  { level: 'Long' as const, scoreRange: '50% - 64%', eta: '3 - 5 tahun', note: 'Masih banyak gap dan pengembangan.' },
  { level: 'Not Ready' as const, scoreRange: '< 50% / gagal primary filter', eta: '> 5 tahun', note: 'Belum memenuhi syarat wajib.' },
];

export const dashboardStats = [
  { label: 'Positions', value: '18', note: '100% active position coverage' },
  { label: 'Kandidat dinilai', value: '126', note: '3 program berjalan bersamaan' },
  { label: 'Readiness Short', value: '24', note: '19% kandidat siap 0 - 1 tahun' },
  { label: 'Keputusan teraudit', value: '100%', note: 'Seluruh perubahan kandidat tercatat' },
];

export const programSummary = [
  { code: 'talent' as const, candidates: 54, qualified: 39, notQualified: 15, topReadiness: 'Medium', departments: 7 },
  { code: 'successor' as const, candidates: 46, qualified: 31, notQualified: 15, topReadiness: 'Short', departments: 6 },
  { code: 'emergency' as const, candidates: 26, qualified: 17, notQualified: 9, topReadiness: 'Short', departments: 4 },
];

export const readinessDistribution = [
  { level: 'Short' as const, count: 24, percentage: 19 },
  { level: 'Medium' as const, count: 43, percentage: 34 },
  { level: 'Long' as const, count: 28, percentage: 22 },
  { level: 'Not Ready' as const, count: 31, percentage: 25 },
];

export const havHeatmap = [
  { quadrant: 1, employees: 12 }, { quadrant: 2, employees: 10 }, { quadrant: 3, employees: 8 }, { quadrant: 4, employees: 11 },
  { quadrant: 5, employees: 5 }, { quadrant: 6, employees: 3 }, { quadrant: 7, employees: 14 }, { quadrant: 8, employees: 9 },
  { quadrant: 9, employees: 4 }, { quadrant: 10, employees: 2 }, { quadrant: 11, employees: 3 }, { quadrant: 12, employees: 1 },
  { quadrant: 13, employees: 7 }, { quadrant: 14, employees: 6 },
];

export const kpiTargets = [
  { metric: 'Waktu proses penentuan talent', baseline: '5 - 7 hari kerja', target: '< 1 hari', current: '2,4 jam' },
  { metric: 'Akurasi data multiple sumber', baseline: '60 - 70%', target: '> 99%', current: '99,2%' },
  { metric: 'Coverage posisi kritis', baseline: 'Tidak terstandar', target: '100%', current: '100%' },
  { metric: 'Audit trail keputusan', baseline: 'Tidak ada', target: '100%', current: '100%' },
];

export const integrationHealth = [
  { system: 'EDP', data: 'Assessment, PA, HAV, behavior competency', syncMode: 'Harian + on-demand', successRate: '98,7%', status: 'Sehat' },
  { system: 'Orange', data: 'Disipliner, MCU, pendidikan', syncMode: 'Harian + on-demand', successRate: '97,9%', status: 'Sehat' },
  { system: 'MY Tok', data: 'Job profile, standar kualifikasi', syncMode: 'Mingguan + on-demand', successRate: '96,8%', status: 'Perlu review minor' },
];

export const reportsCatalog = [
  { name: 'Laporan Talent Pool', scope: 'Kandidat lolos per departemen/divisi', format: 'Excel, PDF', schedule: 'Bulanan' },
  { name: 'Laporan Succession Plan', scope: 'Successor per posisi kritis beserta readiness', format: 'Excel, PDF', schedule: 'Bulanan' },
  { name: 'Laporan Emergency Position', scope: 'Kandidat siap darurat per posisi', format: 'Excel, PDF', schedule: 'Tahunan / ad-hoc' },
];

export const roleAccessMatrix = [
  { role: 'HR Admin / Super Admin', access: 'Konfigurasi kriteria, manajemen user, akses semua data, ekspor laporan.' },
  { role: 'HR Analyst', access: 'Input atau update data, lihat seluruh kandidat, generate laporan.' },
  { role: 'Departemen Head', access: 'Lihat kandidat pada departemennya saja, tanpa ubah data.' },
  { role: 'Viewer / Read Only', access: 'Lihat dashboard dan laporan yang dibagikan tanpa detail data.' },
];

export const auditTrail = [
  { time: '22 Mei 2026 08:10', actor: 'HR Analyst', action: 'Sync data Orange selesai', detail: '122 record pendidikan dan 126 record MCU tervalidasi.' },
  { time: '22 Mei 2026 08:35', actor: 'System', action: 'Primary filter dihitung ulang', detail: 'Posisi Head of Engineering - 6 kandidat, 1 reject karena MCU.' },
  { time: '22 Mei 2026 08:42', actor: 'HR Manager', action: 'Perubahan bobot disetujui', detail: 'Behavior competency tetap 40%, tidak ada perubahan formula.' },
  { time: '22 Mei 2026 09:05', actor: 'Departemen Head', action: 'Laporan Succession Plan diunduh', detail: 'Ruang lingkup Divisi IT, format PDF.' },
];

export const criteriaChangeLog = [
  { version: 'v1.0', changedBy: 'HR Division', change: 'Bobot awal PRD ditetapkan 25/40/20/10/5.', effectiveDate: 'Mei 2026' },
  { version: 'v1.1', changedBy: 'EDP Team Lead', change: 'Validitas assessment dikunci maksimal 5 tahun untuk next level sama.', effectiveDate: 'Juni 2026' },
];

export const mockPositions: PositionSummary[] = [
  {
    id: 'head-engineering',
    title: 'Head of Engineering',
    department: 'Technology',
    division: 'IT Division',
    level: 'Senior Management',
    status: 'active',
    programs: ['successor'],
    programCode: 'successor',
    programTemplateId: null,
    programName: 'Critical Position',
    runCount: 0,
    candidates: 6,
    readyNow: 2,
    readinessCoverage: 83,
    assessmentFreshness: '92% data <= 5 tahun',
    description: 'Posisi kritis yang membutuhkan successor dan kandidat emergency untuk kontinuitas delivery teknologi.',
    qualifications: {
      education: 'S1 Teknik Informatika atau relevan',
      major: 'Teknologi, Computer Science',
      experience: 'Min. 10 tahun dan 3 tahun memimpin tim lintas fungsi',
      jobFamily: 'Engineering Leadership',
    },
    currentHolder: { name: 'Ahmad Wirawan', employeeId: 'EMP-0150', since: 'March 2019' },
  },
  {
    id: 'vp-operations',
    title: 'VP of Operations',
    department: 'Operations',
    division: 'Operations Division',
    level: 'Executive',
    status: 'review',
    programs: ['successor'],
    programCode: 'successor',
    programTemplateId: null,
    programName: 'Critical Position',
    runCount: 0,
    candidates: 4,
    readyNow: 1,
    readinessCoverage: 68,
    assessmentFreshness: '88% data <= 5 tahun',
    description: 'Posisi eksekutif dengan fokus efisiensi operasional dan kesiapan pengganti jangka pendek.',
    qualifications: {
      education: 'S1 Industri / Operasi / Bisnis',
      major: 'Industrial Engineering atau setara',
      experience: 'Min. 12 tahun operasional dan transformasi proses',
      jobFamily: 'Operational Excellence',
    },
    currentHolder: { name: 'Siti Rahayu Dewi', employeeId: 'EMP-0081', since: 'July 2021' },
  },
  {
    id: 'finance-director',
    title: 'Finance Director',
    department: 'Finance',
    division: 'Finance Division',
    level: 'Director',
    status: 'active',
    programs: ['successor'],
    programCode: 'successor',
    programTemplateId: null,
    programName: 'Critical Position',
    runCount: 0,
    candidates: 5,
    readyNow: 2,
    readinessCoverage: 86,
    assessmentFreshness: '95% data <= 5 tahun',
    description: 'Posisi direktur untuk kesinambungan pengendalian finansial dan kepemimpinan fungsi keuangan.',
    qualifications: {
      education: 'S1 / S2 Akuntansi atau Keuangan',
      major: 'Finance, Accounting',
      experience: 'Min. 10 tahun di fungsi finance dan governance',
      jobFamily: 'Finance Leadership',
    },
    currentHolder: { name: 'Hendro Kusuma', employeeId: 'EMP-0063', since: 'January 2020' },
  },
  {
    id: 'plant-manager',
    title: 'Plant Manager',
    department: 'Manufacturing',
    division: 'Operations Division',
    level: 'Manager',
    status: 'draft',
    programs: ['emergency'],
    programCode: 'emergency',
    programTemplateId: null,
    programName: 'Emergency Position',
    runCount: 0,
    candidates: 3,
    readyNow: 0,
    readinessCoverage: 52,
    assessmentFreshness: '76% data <= 5 tahun',
    description: 'Masih dalam review untuk penetapan kandidat talent dan emergency di area manufaktur.',
    qualifications: {
      education: 'S1 Teknik Industri / Mesin',
      major: 'Industrial, Mechanical Engineering',
      experience: 'Min. 8 tahun manufaktur dan continuous improvement',
      jobFamily: 'Plant Operations',
    },
    currentHolder: { name: 'Dwi Prasetya', employeeId: 'EMP-0112', since: 'October 2022' },
  },
];

export const positionCandidates: Record<string, PositionCandidate[]> = {
  'head-engineering': [
    {
      id: 'EMP-1001',
      name: 'Budi Santoso',
      currentPosition: 'Senior Engineering Manager',
      yearsOfService: 12,
      havQuadrant: "1",
      jobMatch: 94,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'A, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'qualified',
        performance: 'qualified',
        hav: 'qualified',
        behavior: 'qualified',
      },
      scoreBreakdown: { technical: 4, behavior: 4, hav: 2, performance: 5, education: 4 },
      weightedScore: 91,
      readiness: 'Short',
      constraint: 'Tidak ada constraint mayor.',
    },
    {
      id: 'EMP-1002',
      name: 'Rina Purnama',
      currentPosition: 'Engineering Manager',
      yearsOfService: 9,
      havQuadrant: "3",
      jobMatch: 88,
      discipline: 'ST tidak aktif > 2 tahun',
      mcu: 'Fit with note',
      performance: 'B, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'qualified',
        performance: 'qualified',
        hav: 'qualified',
        behavior: 'qualified',
      },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 4, education: 3 },
      weightedScore: 77,
      readiness: 'Medium',
      constraint: 'Perlu penguatan strategic leadership.',
    },
    {
      id: 'EMP-1003',
      name: 'Dimas Pratama',
      currentPosition: 'Lead Architect',
      yearsOfService: 11,
      havQuadrant: "7",
      jobMatch: 86,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, B, C',
      behaviorRecommendation: 'READY WITH DEVELOPMENT',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'qualified',
        performance: 'qualified',
        hav: 'qualified',
        behavior: 'qualified',
      },
      scoreBreakdown: { technical: 4, behavior: 2, hav: 2, performance: 4, education: 3 },
      weightedScore: 72,
      readiness: 'Medium',
      constraint: 'Behavior competency belum konsisten di semua area.',
    },
    {
      id: 'EMP-1004',
      name: 'Maya Sari',
      currentPosition: 'Principal Engineer',
      yearsOfService: 7,
      havQuadrant: "8",
      jobMatch: 81,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, C, C',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'qualified',
        performance: 'qualified',
        hav: 'qualified',
        behavior: 'qualified',
      },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 1, performance: 3, education: 3 },
      weightedScore: 65,
      readiness: 'Medium',
      constraint: 'Masih perlu exposure lintas fungsi.',
    },
    {
      id: 'EMP-1005',
      name: 'Eko Wibowo',
      currentPosition: 'DevOps Manager',
      yearsOfService: 10,
      havQuadrant: "2",
      jobMatch: 83,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Unfit',
      performance: 'A, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'reject',
        performance: 'qualified',
        hav: 'qualified',
        behavior: 'qualified',
        reason: 'MCU Unfit - otomatis Not Qualified.',
      },
      scoreBreakdown: { technical: 0, behavior: 0, hav: 0, performance: 0, education: 0 },
      weightedScore: 0,
      readiness: 'Not Ready',
      constraint: 'Terhenti di primary filter MCU.',
    },
    {
      id: 'EMP-1006',
      name: 'Nita Handayani',
      currentPosition: 'QA Lead',
      yearsOfService: 8,
      havQuadrant: "10",
      jobMatch: 73,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, B, C',
      behaviorRecommendation: 'NOT READY',
      behaviorNotes: null,
      primaryFilter: {
        discipline: 'qualified',
        mcu: 'qualified',
        performance: 'qualified',
        hav: 'reject',
        behavior: 'reject',
        reason: 'Kuadran HAV tidak sesuai successor dan behavior tidak direkomendasikan.',
      },
      scoreBreakdown: { technical: 0, behavior: 0, hav: 0, performance: 0, education: 0 },
      weightedScore: 0,
      readiness: 'Not Ready',
      constraint: 'Gagal kuadran HAV dan review behavior.',
    },
  ],
  'vp-operations': [
    {
      id: 'EMP-2001',
      name: 'Siti Rahayu',
      currentPosition: 'Operations Manager',
      yearsOfService: 10,
      havQuadrant: "1",
      jobMatch: 90,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'A, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 5, education: 3 },
      weightedScore: 80,
      readiness: 'Short',
      constraint: 'Succession short-term dengan kebutuhan coaching exposure regional.',
    },
    {
      id: 'EMP-2002',
      name: 'Yusuf Prabowo',
      currentPosition: 'Head of Supply Chain',
      yearsOfService: 13,
      havQuadrant: "13",
      jobMatch: 87,
      discipline: 'SP2 tidak aktif > 2 tahun',
      mcu: 'Fit',
      performance: 'B, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 4, education: 2 },
      weightedScore: 74,
      readiness: 'Medium',
      constraint: 'Perlu penyelarasan jenjang pendidikan dengan target role.',
    },
    {
      id: 'EMP-2003',
      name: 'Rizky Saputra',
      currentPosition: 'Plant Superintendent',
      yearsOfService: 7,
      havQuadrant: "4",
      jobMatch: 76,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'C, B, C',
      behaviorRecommendation: 'READY WITH DEVELOPMENT',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 2, behavior: 2, hav: 2, performance: 3, education: 3 },
      weightedScore: 63,
      readiness: 'Long',
      constraint: 'Butuh penguatan strategic execution dan governance.',
    },
    {
      id: 'EMP-2004',
      name: 'Andi Setiawan',
      currentPosition: 'Operations Excellence Lead',
      yearsOfService: 6,
      havQuadrant: "14",
      jobMatch: 81,
      discipline: 'SP1 aktif',
      mcu: 'Fit',
      performance: 'B, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'reject', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified', reason: 'SP1 aktif membuat kandidat gugur.' },
      scoreBreakdown: { technical: 0, behavior: 0, hav: 0, performance: 0, education: 0 },
      weightedScore: 0,
      readiness: 'Not Ready',
      constraint: 'Gagal disciplinary filter.',
    },
  ],
  'finance-director': [
    {
      id: 'EMP-3001',
      name: 'Ahmad Wijaya',
      currentPosition: 'Finance Manager',
      yearsOfService: 14,
      havQuadrant: "2",
      jobMatch: 93,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'A, A, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 4, behavior: 4, hav: 2, performance: 5, education: 4 },
      weightedScore: 92,
      readiness: 'Short',
      constraint: 'Siap successor dan masuk talent pool strategis.',
    },
    {
      id: 'EMP-3002',
      name: 'Lina Marlina',
      currentPosition: 'Financial Controller',
      yearsOfService: 11,
      havQuadrant: "7",
      jobMatch: 89,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit with note',
      performance: 'B, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 4, education: 4 },
      weightedScore: 79,
      readiness: 'Medium',
      constraint: 'Perlu eksposur investor relation dan corporate finance.',
    },
    {
      id: 'EMP-3003',
      name: 'Dewi Kusuma',
      currentPosition: 'Senior FP&A Manager',
      yearsOfService: 8,
      havQuadrant: "4",
      jobMatch: 85,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, C, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 4, education: 3 },
      weightedScore: 76,
      readiness: 'Medium',
      constraint: 'Perlu exposure regulasi dan audit committee.',
    },
    {
      id: 'EMP-3004',
      name: 'Bagas Mahendra',
      currentPosition: 'Tax Manager',
      yearsOfService: 9,
      havQuadrant: "5",
      jobMatch: 74,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'D, B, C',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'reject', hav: 'reject', behavior: 'qualified', reason: 'Grade D dalam 3 tahun terakhir dan HAV di luar target.' },
      scoreBreakdown: { technical: 0, behavior: 0, hav: 0, performance: 0, education: 0 },
      weightedScore: 0,
      readiness: 'Not Ready',
      constraint: 'Gagal PA dan HAV mapping.',
    },
    {
      id: 'EMP-3005',
      name: 'Nadia Putri',
      currentPosition: 'Treasury Lead',
      yearsOfService: 6,
      havQuadrant: "8",
      jobMatch: 78,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, C, C',
      behaviorRecommendation: 'READY WITH DEVELOPMENT',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 2, behavior: 2, hav: 1, performance: 3, education: 3 },
      weightedScore: 61,
      readiness: 'Long',
      constraint: 'Perlu penguatan managerial breadth dan people leadership.',
    },
  ],
  'plant-manager': [
    {
      id: 'EMP-4001',
      name: 'Taufik Hidayat',
      currentPosition: 'Production Superintendent',
      yearsOfService: 9,
      havQuadrant: "3",
      jobMatch: 84,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'B, B, B',
      behaviorRecommendation: 'READY',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 3, hav: 2, performance: 4, education: 3 },
      weightedScore: 77,
      readiness: 'Medium',
      constraint: 'Belum ada emergency coverage kedua.',
    },
    {
      id: 'EMP-4002',
      name: 'Indra Kurniawan',
      currentPosition: 'Maintenance Lead',
      yearsOfService: 7,
      havQuadrant: "8",
      jobMatch: 80,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit with note',
      performance: 'C, B, B',
      behaviorRecommendation: 'READY WITH DEVELOPMENT',
      behaviorNotes: null,
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'qualified', behavior: 'qualified' },
      scoreBreakdown: { technical: 3, behavior: 2, hav: 1, performance: 3, education: 3 },
      weightedScore: 66,
      readiness: 'Medium',
      constraint: 'Butuh penguatan operational governance.',
    },
    {
      id: 'EMP-4003',
      name: 'Rahmat Gunawan',
      currentPosition: 'Lean Coordinator',
      yearsOfService: 4,
      havQuadrant: "6",
      jobMatch: 69,
      discipline: 'Tidak ada SP/ST',
      mcu: 'Fit',
      performance: 'C, C, B',
      behaviorReview: 'Score 0',
      primaryFilter: { discipline: 'qualified', mcu: 'qualified', performance: 'qualified', hav: 'reject', behavior: 'reject', reason: 'Belum ada assessment center dan kuadran tidak sesuai.' },
      scoreBreakdown: { technical: 0, behavior: 0, hav: 0, performance: 0, education: 0 },
      weightedScore: 0,
      readiness: 'Not Ready',
      constraint: 'Belum memiliki assessment valid untuk program ini.',
    },
  ],
};

export const candidateProfiles: CandidateProfile[] = [
  {
    id: 'EMP-1001',
    name: 'Budi Santoso',
    employeeId: 'EMP-1001',
    department: 'Technology',
    division: 'IT Division',
    currentPosition: 'Senior Engineering Manager',
    yearsOfService: 12,
    education: 'S2 Teknologi Informasi',
    major: 'Computer Science',
    jobFamily: 'Engineering Leadership',
    havQuadrant: "1",
    disciplinaryStatus: 'Bersih - tidak ada SP/ST',
    mcuStatus: 'Fit',
    behaviorRecommendation: 'READY',
      behaviorNotes: null,
    behaviorNotes: null,
    readiness: 'Short',
    programs: [
      { code: 'talent', status: 'Qualified', note: 'Masuk kuadran target dan score > 80%.' },
      { code: 'successor', status: 'Qualified', note: 'Top candidate untuk Head of Engineering.' },
      { code: 'emergency', status: 'Qualified', note: 'Tidak ada constraint untuk emergency back-up.' },
    ],
    assessmentHistory: [
      { period: '2026', technical: 'Strength 90%', behavior: 'Semua efektif >= 3', performance: 'A', readiness: 'Short' },
      { period: '2025', technical: 'Ready 78%', behavior: '75% efektif', performance: 'B', readiness: 'Medium' },
    ],
  },
  {
    id: 'EMP-1002',
    name: 'Rina Purnama',
    employeeId: 'EMP-1002',
    department: 'Technology',
    division: 'IT Division',
    currentPosition: 'Engineering Manager',
    yearsOfService: 9,
    education: 'S1 Teknik Informatika',
    major: 'Software Engineering',
    jobFamily: 'Engineering Management',
    havQuadrant: "3",
    disciplinaryStatus: 'ST tidak aktif > 2 tahun',
    mcuStatus: 'Fit with note',
    behaviorRecommendation: 'READY',
      behaviorNotes: null,
    behaviorNotes: null,
    readiness: 'Medium',
    programs: [
      { code: 'talent', status: 'Qualified', note: 'Layak talent pool untuk pengembangan ke next level.' },
      { code: 'successor', status: 'Qualified', note: 'Qualified, namun masih ada gap strategic leadership.' },
      { code: 'emergency', status: 'Qualified', note: 'Bisa menjadi back-up dengan development plan.' },
    ],
    assessmentHistory: [
      { period: '2026', technical: 'Ready 74%', behavior: 'Disarankan', performance: 'B', readiness: 'Medium' },
      { period: '2025', technical: 'Ready with Development 62%', behavior: 'Disarankan', performance: 'B', readiness: 'Long' },
    ],
  },
  {
    id: 'EMP-2001',
    name: 'Siti Rahayu',
    employeeId: 'EMP-2001',
    department: 'Operations',
    division: 'Operations Division',
    currentPosition: 'Operations Manager',
    yearsOfService: 10,
    education: 'S1 Teknik Industri',
    major: 'Industrial Engineering',
    jobFamily: 'Operational Excellence',
    havQuadrant: "1",
    disciplinaryStatus: 'Bersih - tidak ada SP/ST',
    mcuStatus: 'Fit',
    behaviorRecommendation: 'READY',
      behaviorNotes: null,
    behaviorNotes: null,
    readiness: 'Short',
    programs: [
      { code: 'talent', status: 'Qualified', note: 'Masuk talent pool operasi.' },
      { code: 'successor', status: 'Qualified', note: 'Top successor untuk VP of Operations.' },
      { code: 'emergency', status: 'Qualified', note: 'Memenuhi kuadran dan performance.' },
    ],
    assessmentHistory: [
      { period: '2026', technical: 'Ready 80%', behavior: 'Disarankan', performance: 'A', readiness: 'Short' },
      { period: '2025', technical: 'Ready 71%', behavior: 'Disarankan', performance: 'B', readiness: 'Medium' },
    ],
  },
  {
    id: 'EMP-3001',
    name: 'Ahmad Wijaya',
    employeeId: 'EMP-3001',
    department: 'Finance',
    division: 'Finance Division',
    currentPosition: 'Finance Manager',
    yearsOfService: 14,
    education: 'S2 Keuangan',
    major: 'Finance',
    jobFamily: 'Finance Leadership',
    havQuadrant: "2",
    disciplinaryStatus: 'Bersih - tidak ada SP/ST',
    mcuStatus: 'Fit',
    behaviorRecommendation: 'READY',
      behaviorNotes: null,
    behaviorNotes: null,
    readiness: 'Short',
    programs: [
      { code: 'talent', status: 'Qualified', note: 'Direkomendasikan untuk pipeline direktur dan CFO track.' },
      { code: 'successor', status: 'Qualified', note: 'Short readiness untuk Finance Director.' },
      { code: 'emergency', status: 'Qualified', note: 'Dapat dipakai sebagai emergency cover level direktur.' },
    ],
    assessmentHistory: [
      { period: '2026', technical: 'Strength 91%', behavior: 'Semua efektif >= 3', performance: 'A', readiness: 'Short' },
      { period: '2025', technical: 'Strength 86%', behavior: 'Disarankan', performance: 'A', readiness: 'Short' },
    ],
  },
  {
    id: 'EMP-4003',
    name: 'Rahmat Gunawan',
    employeeId: 'EMP-4003',
    department: 'Manufacturing',
    division: 'Operations Division',
    currentPosition: 'Lean Coordinator',
    yearsOfService: 4,
    education: 'S1 Teknik Industri',
    major: 'Industrial Engineering',
    jobFamily: 'Plant Operations',
    havQuadrant: "6",
    disciplinaryStatus: 'Bersih - tidak ada SP/ST',
    mcuStatus: 'Fit',
    behaviorRecommendation: 'READY',
      behaviorNotes: null,
    behaviorNotes: null,
    readiness: 'Not Ready',
    programs: [
      { code: 'talent', status: 'Not Qualified', note: 'Score assessment = 0 dan HAV belum sesuai.' },
      { code: 'successor', status: 'Not Qualified', note: 'Belum memenuhi primary filter behavior dan HAV.' },
      { code: 'emergency', status: 'Not Qualified', note: 'Belum dapat dipakai untuk emergency position.' },
    ],
    assessmentHistory: [
      { period: '2026', technical: 'Tidak ada assessment', behavior: 'Score 0', performance: 'C', readiness: 'Not Ready' },
    ],
  },
];
