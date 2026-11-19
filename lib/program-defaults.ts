import type { DefaultCriterion, FilterRule } from '@/lib/db/schema';

/**
 * Default succession-program templates that every tenant ships with.
 *
 * Filter rules use candidate attribute fields (see `candidates` table).
 * Default criteria seed new positions when scoring runs against this template.
 *
 * Programs share most rules but tune thresholds; e.g. Talent Pool requires
 * minimum performance grade B while Successor requires A or B in the last
 * 3 years.
 */

export type SystemProgramCode = 'talent' | 'successor' | 'emergency';

export type SystemProgramTemplate = {
  code: SystemProgramCode;
  name: string;
  description: string;
  defaultMethod: 'SAW';
  targetFinalists: number;
  filterRules: FilterRule[];
  defaultCriteria: DefaultCriterion[];
};

/**
 * The aspects every system program assesses — descriptive only. No weights: AHP
 * is the only place a weight is configured. A number here would be a second
 * answer to the same question with nothing forcing the two to agree — which is
 * exactly what this list used to be.
 */
const BASE_CRITERIA: DefaultCriterion[] = [
  {
    name: 'Technical Competency Mapping',
    description: 'Pemetaan kompetensi teknis dari EDP. Strength ≥ 85%, Ready min 60%.',
    type: 'benefit',
    maxValue: 100,
    source: 'EDP',
  },
  {
    name: 'Behavior Competency Assessment',
    description: 'Asesmen kompetensi perilaku. Semua efektif ≥ 3 atau min 75% efektif.',
    type: 'benefit',
    maxValue: 100,
    source: 'EDP',
  },
  {
    name: 'HAV Mapping',
    description: 'Kuadran HAV. Skor lebih tinggi untuk kuadran Top & Strong.',
    type: 'benefit',
    maxValue: 100,
    source: 'EDP',
  },
  {
    name: 'Performance Appraisal',
    description: 'Nilai PA: A=100, B=80, C=60, D=20.',
    type: 'benefit',
    maxValue: 100,
    source: 'EDP',
  },
  {
    name: 'Employee Profile - Pendidikan',
    description: 'Kesesuaian jenjang dan jurusan pendidikan.',
    type: 'benefit',
    maxValue: 100,
    source: 'Orange / MY Tok',
  },
];

// Baseline eligibility filters mirroring the methodology document's business
// rules: CLEAR/ST discipline qualified (active SP, SP<2yr, SP3, SP First/Last
// rejected), not in HAV quadrant 16 (Bottom), and behavior above the bottom
// three categories. Performance Appraisal is gated per-program below (on the
// latest grade), so there is no PA rule here.
//
// MCU is in this list but is ADVISORY — it flags, it does not disqualify.
// See the rule itself for why.
const COMMON_HARD_FILTERS: FilterRule[] = [
  {
    field: 'disciplineStatus',
    // Sync writes uppercase canonical values; the filter engine compares with
    // strict equality, so these must match the stored casing.
    operator: 'in',
    value: ['CLEAR', 'ST'],
    label: 'Disiplin',
    message: 'Terdapat sanksi disiplin (SP aktif / SP < 2 tahun / SP3 / SP First-Last).',
  },
  {
    // ADVISORY, not hard. A medical finding does not make somebody less
    // qualified for the job, so the rule flags the candidate instead of
    // removing them before they are ever scored. The rule is kept rather than
    // deleted so the value domain stays visible and a tenant that genuinely
    // wants a knockout can flip the severity back in governance.
    field: 'mcuStatus',
    operator: 'in',
    value: ['fit', 'fit_with_note'],
    label: 'MCU',
    message: 'Status MCU tidak Fit.',
    severity: 'advisory',
  },
  {
    field: 'havQuadrant',
    operator: 'notIn',
    value: ['16'],
    label: 'HAV Quadrant',
    message: 'Berada pada kuadran 16 (Bottom).',
  },
  {
    field: 'behaviorRecommendation',
    operator: 'notIn',
    value: ['NOT READY', 'VERY LOW', 'BELUM ADA POTENSI'],
    label: 'Behavior Recommendation',
    message: 'Rekomendasi behavior berada pada kategori terbawah (NOT READY / VERY LOW / BELUM ADA POTENSI).',
  },
];

export const systemProgramTemplates: SystemProgramTemplate[] = [
  {
    code: 'talent',
    name: 'Talent Pool',
    description:
      'Identifikasi karyawan berpotensi tinggi untuk pengembangan karir jangka panjang (0–5 tahun).',
    targetFinalists: 10,
    defaultMethod: 'SAW',
    filterRules: [
      ...COMMON_HARD_FILTERS,
      {
        field: 'performanceGrade',
        operator: 'in',
        value: ['A', 'B'],
        label: 'Performance Appraisal',
        message: 'Talent Pool memerlukan PA min B dalam 3 tahun terakhir.',
      },
      {
        field: 'havQuadrant',
        operator: 'in',
        value: ['1', '2', '3', '4', '7'],
        label: 'HAV Quadrant',
        message: 'HAV di luar kuadran target Talent Pool (1, 2, 3, 4, 7).',
      },
    ],
    defaultCriteria: BASE_CRITERIA,
  },
  {
    code: 'successor',
    // Display name only — the CODE stays 'successor' because it is written into
    // critical_positions.program_code, scoring_runs.program and
    // position_picks.program_code, including on finished runs.
    name: 'Critical Position',
    description: 'Kandidat pengganti posisi kritis dalam waktu dekat (0–2 tahun).',
    targetFinalists: 10,
    defaultMethod: 'SAW',
    filterRules: [
      ...COMMON_HARD_FILTERS,
      {
        field: 'performanceGrade',
        operator: 'in',
        value: ['A', 'B'],
        label: 'Performance Appraisal',
        message: 'Successor memerlukan PA A/B dalam 3 tahun terakhir.',
      },
      {
        field: 'havQuadrant',
        operator: 'in',
        value: ['1', '2', '3', '4', '7', '8', '13', '14'],
        label: 'HAV Quadrant',
        message: 'HAV di luar kuadran target Successor.',
      },
      {
        field: 'yearsExperience',
        operator: 'gte',
        value: 5,
        label: 'Masa Kerja',
        message: 'Successor memerlukan masa kerja minimum 5 tahun.',
      },
    ],
    defaultCriteria: BASE_CRITERIA,
  },
  {
    code: 'emergency',
    name: 'Emergency Position',
    description: 'Kandidat darurat untuk posisi yang wajib segera terisi (immediate).',
    targetFinalists: 10,
    defaultMethod: 'SAW',
    filterRules: [
      ...COMMON_HARD_FILTERS,
      {
        field: 'performanceGrade',
        operator: 'in',
        value: ['A', 'B', 'C'],
        label: 'Performance Appraisal',
        message: 'Emergency memerlukan minimum PA C.',
      },
      {
        field: 'havQuadrant',
        operator: 'in',
        value: ['1', '2', '3', '4', '7', '8'],
        label: 'HAV Quadrant',
        message: 'HAV di luar kuadran emergency-ready.',
      },
    ],
    // Emergency does not assess education at all — somebody stepping in today is
    // judged on what they can do, not what they studied. That used to be written
    // as weight 0, which is how a criterion was excluded before weights left
    // this list; it is now simply absent, because under AHP weighting a listed
    // criterion always carries its share.
    //
    // Emergency's OTHER emphases (performance up, technical up) were weights and
    // now belong in this program's AHP matrix, not here.
    defaultCriteria: BASE_CRITERIA.filter((c) => c.name !== 'Employee Profile - Pendidikan'),
  },
];
