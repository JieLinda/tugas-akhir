// Restructure a synced Job Profile's extracted JSON (sync_job_profiles.extracted_data)
// into a single continuous document paragraph suitable for sentence embedding +
// BERTopic topic modelling. The paragraph is assembled from a user-editable
// template (Configuration page) with {{token}} placeholders substituted from the
// extracted data. Empty label lines are dropped so missing fields don't pollute
// the topic model.
//
// This is a pure, dependency-free module (usable from server actions and, if
// ever needed, the client for live preview).

/** Loose mirror of sync-service's ExtractedJobProfile — every field optional,
 *  since extracted_data is stored untyped (jsonb) and older rows may differ. */
export type ExtractedJobProfileData = {
  jobIdentity?: {
    positionName?: string | null;
    divisionDepartment?: string | null;
    directSupervisor?: string | null;
    subordinates?: string[] | null;
  } | null;
  organizationStructure?: { organizationChartSummary?: string | null } | null;
  jobSpecification?: {
    education?: string | null;
    experience?: string | null;
    gender?: string | null;
    skills?: string[] | null;
  } | null;
  behavioralCompetencies?: string[] | null;
  technicalCompetencies?:
    | ({ competency?: string; level?: string | number | null } | string)[]
    | null;
  authorities?: string[] | null;
  jobPurpose?: string | null;
  responsibilities?:
    | { responsibility?: string | null; successIndicator?: string | null }[]
    | null;
  workingRelationships?: {
    internal?: string[] | null;
    external?: string[] | null;
  } | null;
};

/** Default restructure template. Tokens are documented in TEMPLATE_TOKENS. */
export const DEFAULT_RESTRUCTURE_TEMPLATE = `Jabatan: {{positionName}}
Divisi/Departemen: {{divisionDepartment}}
Atasan Langsung: {{directSupervisor}}
Bawahan Langsung: {{subordinates}}
Tujuan Jabatan: {{jobPurpose}}
Kualifikasi Pendidikan: {{education}}
Pengalaman: {{experience}}
Keahlian: {{skills}}
Kompetensi Teknis: {{technicalCompetencies}}
Kompetensi Perilaku: {{behavioralCompetencies}}
Wewenang: {{authorities}}
Tanggung Jawab dan Indikator Keberhasilan:
{{responsibilities}}
Hubungan Kerja Internal: {{internalRelationships}}
Hubungan Kerja Eksternal: {{externalRelationships}}`;

/** The tokens the template understands, for the Configuration UI helper text. */
export const TEMPLATE_TOKENS = [
  'positionName',
  'divisionDepartment',
  'directSupervisor',
  'subordinates',
  'jobPurpose',
  'education',
  'experience',
  'skills',
  'technicalCompetencies',
  'behavioralCompetencies',
  'authorities',
  'responsibilities',
  'internalRelationships',
  'externalRelationships',
  'organizationChart',
] as const;

/**
 * Label baris kanonik tiap token.
 *
 * Ada supaya sebuah bagian dapat disusun ulang meskipun template yang BERLAKU
 * kebetulan tidak memuat barisnya. Tanpa ini, meminta "tonjolkan bagan
 * organisasi" pada instalasi yang templatenya tidak punya baris itu akan
 * menghasilkan template tanpa bagan organisasi — berhasil, senyap, dan salah.
 * `organizationChart` adalah kasus nyatanya: ia token sah, punya nilai, tampil
 * di UI Konfigurasi, tetapi tidak ada di DEFAULT_RESTRUCTURE_TEMPLATE.
 */
export const SECTION_LABELS: Record<(typeof TEMPLATE_TOKENS)[number], string> = {
  positionName: 'Jabatan',
  divisionDepartment: 'Divisi/Departemen',
  directSupervisor: 'Atasan Langsung',
  subordinates: 'Bawahan Langsung',
  jobPurpose: 'Tujuan Jabatan',
  education: 'Kualifikasi Pendidikan',
  experience: 'Pengalaman',
  skills: 'Keahlian',
  technicalCompetencies: 'Kompetensi Teknis',
  behavioralCompetencies: 'Kompetensi Perilaku',
  authorities: 'Wewenang',
  responsibilities: 'Tanggung Jawab dan Indikator Keberhasilan',
  internalRelationships: 'Hubungan Kerja Internal',
  externalRelationships: 'Hubungan Kerja Eksternal',
  organizationChart: 'Posisi dalam Struktur Organisasi',
};

/**
 * Grup bagian — kosakata setingkat yang dipakai orang.
 *
 * Orang tidak meminta "abaikan directSupervisor, subordinates, dan
 * organizationChart"; ia meminta "abaikan struktur organisasi". Tanpa bentuk
 * kolektif, satu-satunya cara menyampaikan maksud itu adalah mengarang satu
 * nama tunggal — yang persis dilakukan planner ketika ia mengirim
 * `organizationalStructure` dan seluruh langkahnya mati.
 */
export const SECTION_GROUPS = {
  informasi_administratif: ['positionName', 'divisionDepartment'],
  struktur_organisasi: ['directSupervisor', 'subordinates', 'organizationChart'],
  kualifikasi: ['education', 'experience', 'skills'],
  kompetensi: ['technicalCompetencies', 'behavioralCompetencies'],
  substansi_jabatan: ['jobPurpose', 'responsibilities', 'authorities'],
  hubungan_kerja: ['internalRelationships', 'externalRelationships'],
} as const satisfies Record<string, readonly (typeof TEMPLATE_TOKENS)[number][]>;

export const SECTION_GROUP_IDS = Object.keys(SECTION_GROUPS) as (keyof typeof SECTION_GROUPS)[];

/** Kosakata yang boleh disebut: token satuan ATAU id grup. */
export const SECTION_VOCABULARY = [...TEMPLATE_TOKENS, ...SECTION_GROUP_IDS] as const;

/**
 * Sinonim bebas → kosakata sah. Bukan jalur utama (skema tool sudah menutup
 * kosakatanya), melainkan jaring pengaman bagi rencana lama, resep tersimpan,
 * dan sebutan yang wajar dalam dua bahasa.
 */
const SECTION_ALIASES: Record<string, readonly string[]> = {
  organizationalstructure: ['struktur_organisasi'],
  organizationstructure: ['struktur_organisasi'],
  strukturorganisasi: ['struktur_organisasi'],
  organizationchartsummary: ['organizationChart'],
  bagansorganisasi: ['organizationChart'],
  baganorganisasi: ['organizationChart'],
  administrative: ['informasi_administratif'],
  administrativeinfo: ['informasi_administratif'],
  informasiadministratif: ['informasi_administratif'],
  identity: ['informasi_administratif'],
  jobidentity: ['informasi_administratif'],
  qualification: ['kualifikasi'],
  qualifications: ['kualifikasi'],
  jobspecification: ['kualifikasi'],
  competencies: ['kompetensi'],
  kompetensi_teknis: ['technicalCompetencies'],
  kompetensiteknis: ['technicalCompetencies'],
  kompetensiperilaku: ['behavioralCompetencies'],
  responsibility: ['responsibilities'],
  tanggungjawab: ['responsibilities'],
  accountabilities: ['responsibilities'],
  authority: ['authorities'],
  wewenang: ['authorities'],
  purpose: ['jobPurpose'],
  tujuanjabatan: ['jobPurpose'],
  workingrelationships: ['hubungan_kerja'],
  hubungankerja: ['hubungan_kerja'],
  relationships: ['hubungan_kerja'],
  supervisor: ['directSupervisor'],
  atasan: ['directSupervisor'],
  bawahan: ['subordinates'],
  pendidikan: ['education'],
  pengalaman: ['experience'],
  keahlian: ['skills'],
};

/**
 * Terjemahkan sebutan bagian (token, id grup, atau sinonim) menjadi daftar
 * token kanonik. Urutan penyebutan dipertahankan dan duplikat dibuang, karena
 * urutan adalah semantik di sini: bagian yang ditonjolkan naik ke awal
 * paragraf, tempat yang paling berpengaruh pada embedding kalimat.
 */
export function resolveSections(input: readonly string[]): {
  tokens: string[];
  unknown: string[];
} {
  const known = new Set<string>(TEMPLATE_TOKENS);
  const out: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();

  const push = (t: string) => {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  for (const raw of input) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    if (known.has(value)) {
      push(value);
      continue;
    }
    if (value in SECTION_GROUPS) {
      for (const t of SECTION_GROUPS[value as keyof typeof SECTION_GROUPS]) push(t);
      continue;
    }
    const key = value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const alias = SECTION_ALIASES[key] ?? SECTION_ALIASES[key.replace(/_/g, '')];
    if (alias) {
      for (const a of alias) {
        if (a in SECTION_GROUPS) {
          for (const t of SECTION_GROUPS[a as keyof typeof SECTION_GROUPS]) push(t);
        } else {
          push(a);
        }
      }
      continue;
    }
    unknown.push(value);
  }
  return { tokens: out, unknown };
}

function joinList(list: unknown, sep = ', '): string {
  if (!Array.isArray(list)) return '';
  return list
    .map((v) => (typeof v === 'string' ? v : String(v ?? '')))
    .map((s) => s.trim())
    .filter(Boolean)
    .join(sep);
}

function formatTechnical(list: ExtractedJobProfileData['technicalCompetencies']): string {
  if (!Array.isArray(list)) return '';
  return list
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const name = String(item?.competency ?? '').trim();
      if (!name) return '';
      const level =
        item?.level === null || item?.level === undefined || item?.level === ''
          ? ''
          : ` (level ${item.level})`;
      return `${name}${level}`;
    })
    .filter(Boolean)
    .join(', ');
}

function formatResponsibilities(
  list: ExtractedJobProfileData['responsibilities'],
): string {
  if (!Array.isArray(list)) return '';
  return list
    .map((r) => {
      const resp = String(r?.responsibility ?? '').trim();
      if (!resp) return '';
      const ind = String(r?.successIndicator ?? '').trim();
      return ind ? `- ${resp} (Indikator: ${ind})` : `- ${resp}`;
    })
    .filter(Boolean)
    .join('\n');
}

/** Build the {{token}} → value map from the extracted data. */
function buildTokenValues(data: ExtractedJobProfileData): Record<string, string> {
  const id = data.jobIdentity ?? {};
  const spec = data.jobSpecification ?? {};
  const rel = data.workingRelationships ?? {};
  return {
    positionName: (id.positionName ?? '').trim(),
    divisionDepartment: (id.divisionDepartment ?? '').trim(),
    directSupervisor: (id.directSupervisor ?? '').trim(),
    subordinates: joinList(id.subordinates),
    jobPurpose: (data.jobPurpose ?? '').trim(),
    education: (spec.education ?? '').trim(),
    experience: (spec.experience ?? '').trim(),
    skills: joinList(spec.skills),
    technicalCompetencies: formatTechnical(data.technicalCompetencies),
    behavioralCompetencies: joinList(data.behavioralCompetencies),
    authorities: joinList(data.authorities),
    responsibilities: formatResponsibilities(data.responsibilities),
    internalRelationships: joinList(rel.internal),
    externalRelationships: joinList(rel.external),
    organizationChart: (
      data.organizationStructure?.organizationChartSummary ?? ''
    ).trim(),
  };
}

/**
 * The {{token}} → value map a document is built from — exported for the map's
 * calculation trace (lib/job-family-trace/), which shows each raw field beside
 * the document line it became.
 */
export function tokenValuesOf(data: ExtractedJobProfileData | null | undefined): Record<string, string> {
  return buildTokenValues(data ?? {});
}

/**
 * Restructure extracted job-profile data into a continuous paragraph using the
 * given template. Tokens resolving to empty drop their whole line (so a missing
 * "Atasan Langsung" doesn't leave a dangling label), and runs of blank lines are
 * collapsed. Returns a trimmed string.
 */
export function restructureJobProfile(
  data: ExtractedJobProfileData | null | undefined,
  template: string = DEFAULT_RESTRUCTURE_TEMPLATE,
): string {
  const values = buildTokenValues(data ?? {});

  // Substitute every {{token}}; unknown tokens resolve to ''.
  const substituted = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : '',
  );

  const lines = substituted.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    // Drop "Label:" lines whose value came out empty (label ends with ':' and
    // nothing follows). Keep genuinely blank lines for paragraph spacing.
    if (/\S/.test(line) && /:\s*$/.test(line)) continue;
    kept.push(line.replace(/\s+$/, ''));
  }

  return kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
