// Demo-mode candidate copy ("dupp") — the fields the /candidates form shows,
// all of them editable in demo mode, stored in `candidates_dupp`.
// Client-safe: types and pure helpers only.

export type DemoTechnicalCompetency = {
  technicalId: string;
  technicalName: string;
  proficiencyName: string;
  currentProficiencyName: string;
  score: number;
  currentScore: number;
  gap: number;
  isManual?: boolean;
  sourceKey?: string;
};

export type DemoCandidateFields = {
  name: string;
  /** Kept as typed; identity and every NPK join keep using the REAL NPK. */
  employeeId: string | null;
  email: string | null;
  currentPosition: string | null;
  department: string | null;
  division: string | null;
  yearsExperience: string | null;
  disciplineStatus: string | null;
  mcuStatus: string | null;
  mcuNoteManual: string | null;
  performanceGrade: string | null;
  havQuadrant: string | null;
  behaviorRecommendation: string | null;
  behaviorNotes: string | null;
  education: string | null;
  major: string | null;
  /** Null: the demo copy keeps the candidate's real competencies. */
  technicalCompetencies: DemoTechnicalCompetency[] | null;
  /**
   * The fields the user actually CHANGED in demo mode. Only these come from the
   * copy; every other field is the candidate's real value as it stands now, so
   * a demo candidate is "edited fields + everything else live" rather than a
   * frozen snapshot of the form.
   *
   * Stored on every save since this was introduced. A payload written before
   * it has none, and `resolveDemoCopy` infers the set (see there). After
   * resolution this is always present.
   */
  editedFields?: DemoEditableField[];
  /**
   * 'formula' when the last HAV event in demo mode was a PA/BA edit or the
   * "Hitung kuadran HAV" button: the formula over the merged PA and behaviour
   * then outranks the candidate's real placement AND real upload, exactly as
   * `candidates.hav_auto_tier = 'formula'` does in real mode. A demo Talent
   * Mapping move edits the HAV, which outranks the pin (as a placement outranks
   * the tier); moving back to the automatic square un-edits it and leaves the
   * formula in force. Reload deletes the copy.
   * Mirrored in scoring-service/src/demo-overlay.ts.
   */
  havTier?: 'formula' | null;
};

/** Every field the demo edit form can change. */
export const DEMO_EDITABLE_FIELDS = [
  'name',
  'employeeId',
  'email',
  'currentPosition',
  'department',
  'division',
  'yearsExperience',
  'disciplineStatus',
  'mcuStatus',
  'mcuNoteManual',
  'performanceGrade',
  'havQuadrant',
  'behaviorRecommendation',
  'behaviorNotes',
  'education',
  'major',
  'technicalCompetencies',
] as const;

export type DemoEditableField = (typeof DEMO_EDITABLE_FIELDS)[number];

const EDITABLE_SET = new Set<string>(DEMO_EDITABLE_FIELDS);

export function isDemoEditableField(x: unknown): x is DemoEditableField {
  return typeof x === 'string' && EDITABLE_SET.has(x);
}

/** A list of field names from untrusted input (form, payload), valid ones only, deduped. */
export function parseDemoEditedFields(raw: unknown): DemoEditableField[] | null {
  if (!Array.isArray(raw)) return null;
  return Array.from(new Set(raw.filter(isDemoEditableField)));
}

/** The candidate's REAL values for the editable scalar fields. */
export type DemoRealValues = {
  [K in Exclude<DemoEditableField, 'technicalCompetencies'>]: string | null;
};

/**
 * Comparison form of a field value: how the form writes it, so a value the
 * user did not touch compares equal to the stored one. PA is padded to the six
 * slots the form always submits; HAV is canonical "1".."16"; masa kerja is a
 * number.
 */
export function demoComparable(field: DemoEditableField, value: unknown): string {
  if (value == null) return '';
  const text = String(value).trim();
  if (field === 'performanceGrade') {
    if (text === '') return '';
    const parts = text.split(',').map((p) => p.trim());
    while (parts.length < 6) parts.push('');
    return parts.join(',');
  }
  if (field === 'havQuadrant') {
    const match = text.match(/\d+/);
    const n = match ? parseInt(match[0], 10) : NaN;
    return n >= 1 && n <= 16 ? String(n) : '';
  }
  if (field === 'yearsExperience') {
    if (text === '') return '';
    const n = Number(text);
    return Number.isFinite(n) ? String(n) : text;
  }
  return text;
}

/**
 * The demo copy as every reader must see it: edited fields from the copy, all
 * other fields from the candidate's real record NOW, and `editedFields` always
 * set. `technicalCompetencies` stays null unless they were edited, which every
 * reader already reads as "keep the real competencies".
 *
 * A payload saved before `editedFields` existed was a snapshot of the whole
 * form, so its set is INFERRED: a field counts as edited when the copy differs
 * from the real value. HAV needs one more case, because the form showed the HAV
 * IN FORCE — for most people the formula over PA × behaviour — and a snapshot of
 * that would otherwise read as a deliberate HAV and freeze it, so a later PA
 * edit could never move it. A copied HAV equal to the real upload or to the
 * real formula is therefore not an edit. `formulaOf` is injected so the web app
 * and scoring-service each use their own formula.
 */
export function resolveDemoCopy(
  stored: DemoCandidateFields,
  real: DemoRealValues,
  formulaOf: (performanceGrade: string | null, behaviorRecommendation: string | null) => string | null,
): DemoCandidateFields {
  let edited: Set<DemoEditableField>;
  if (stored.editedFields) {
    edited = new Set(stored.editedFields);
  } else {
    edited = new Set();
    for (const { field } of DEMO_ROW_FIELDS) {
      if (field === 'havQuadrant') continue;
      if (demoComparable(field, stored[field]) !== demoComparable(field, real[field])) edited.add(field);
    }
    const copiedHav = demoComparable('havQuadrant', stored.havQuadrant);
    if (
      copiedHav !== '' &&
      copiedHav !== demoComparable('havQuadrant', real.havQuadrant) &&
      copiedHav !== demoComparable('havQuadrant', formulaOf(real.performanceGrade, real.behaviorRecommendation))
    ) {
      edited.add('havQuadrant');
    }
    if (stored.technicalCompetencies) edited.add('technicalCompetencies');
    if (stored.employeeId != null && demoComparable('employeeId', stored.employeeId) !== demoComparable('employeeId', real.employeeId)) {
      edited.add('employeeId');
    }
  }
  const pick = <K extends Exclude<DemoEditableField, 'technicalCompetencies'>>(field: K): string | null =>
    edited.has(field) ? (stored[field] as string | null) : real[field];
  return {
    name: pick('name') ?? stored.name,
    employeeId: pick('employeeId'),
    email: pick('email'),
    currentPosition: pick('currentPosition'),
    department: pick('department'),
    division: pick('division'),
    yearsExperience: pick('yearsExperience'),
    disciplineStatus: pick('disciplineStatus'),
    mcuStatus: pick('mcuStatus'),
    mcuNoteManual: pick('mcuNoteManual'),
    performanceGrade: pick('performanceGrade'),
    havQuadrant: pick('havQuadrant'),
    behaviorRecommendation: pick('behaviorRecommendation'),
    behaviorNotes: pick('behaviorNotes'),
    education: pick('education'),
    major: pick('major'),
    technicalCompetencies: edited.has('technicalCompetencies') ? stored.technicalCompetencies ?? [] : null,
    editedFields: DEMO_EDITABLE_FIELDS.filter((f) => edited.has(f)),
    // Kept beside a HAV edit, as `hav_auto_tier` is kept beside a placement:
    // the edit outranks it, and reverting the edit leaves the formula in force.
    havTier: stored.havTier === 'formula' ? 'formula' : null,
  };
}

/** True when this resolved copy edits `field`. */
export function demoEdits(copy: DemoCandidateFields | null | undefined, field: DemoEditableField): boolean {
  return Boolean(copy?.editedFields?.includes(field));
}

/** Candidate row column ↔ demo field, in both naming styles rows arrive in. */
export const DEMO_ROW_FIELDS: { field: Exclude<DemoEditableField, 'technicalCompetencies' | 'employeeId'>; camel: string; snake: string }[] = [
  { field: 'name', camel: 'name', snake: 'name' },
  { field: 'email', camel: 'email', snake: 'email' },
  { field: 'currentPosition', camel: 'currentPosition', snake: 'current_position' },
  { field: 'department', camel: 'department', snake: 'department' },
  { field: 'division', camel: 'division', snake: 'division' },
  { field: 'yearsExperience', camel: 'yearsExperience', snake: 'years_experience' },
  { field: 'disciplineStatus', camel: 'disciplineStatus', snake: 'discipline_status' },
  { field: 'mcuStatus', camel: 'mcuStatus', snake: 'mcu_status' },
  { field: 'mcuNoteManual', camel: 'mcuNoteManual', snake: 'mcu_note_manual' },
  { field: 'performanceGrade', camel: 'performanceGrade', snake: 'performance_grade' },
  { field: 'havQuadrant', camel: 'havQuadrant', snake: 'hav_quadrant' },
  { field: 'behaviorRecommendation', camel: 'behaviorRecommendation', snake: 'behavior_recommendation' },
  { field: 'behaviorNotes', camel: 'behaviorNotes', snake: 'behavior_notes' },
  { field: 'education', camel: 'education', snake: 'education' },
  { field: 'major', camel: 'major', snake: 'major' },
];

/**
 * A candidate row as demo mode presents it: the dupp copy's values
 * over the real ones (only the keys the row actually carries, in the naming it
 * uses), and NO photo — demo mode shows no profile photos anywhere, and doing
 * it here means no component can render one by accident.
 *
 * `employeeId` is deliberately NOT replaced: rows feed joins (LPAD(employee_id))
 * and incumbent exclusion, which must keep meaning the real person. Every NPK
 * display is masked in demo mode regardless (lib/app-mode-shared.ts).
 */
export function presentCandidateRowForDemo<T extends object>(row: T, copy: DemoCandidateFields | null | undefined): T {
  const out = { ...row } as Record<string, unknown>;
  if (copy) {
    // Only the EDITED fields: the rest of the row already holds the real value
    // the copy would carry (resolveDemoCopy), and writing it again would undo
    // anything a loader derived on the row first — the HAV in force, above all.
    // A copy that never went through resolveDemoCopy (no `editedFields`) is
    // applied whole, as before.
    const edited = copy.editedFields ? new Set<string>(copy.editedFields) : null;
    for (const { field, camel, snake } of DEMO_ROW_FIELDS) {
      if (edited && !edited.has(field)) continue;
      const value = copy[field];
      if (camel in out) out[camel] = value;
      if (snake !== camel && snake in out) out[snake] = value;
    }
  }
  if ('photoUrl' in out) out.photoUrl = null;
  if ('photo_url' in out) out.photo_url = null;
  return out as T;
}

export function parseDemoPayload(text: string | null): DemoCandidateFields | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<DemoCandidateFields>;
    if (!v || typeof v !== 'object' || typeof v.name !== 'string') return null;
    const s = (x: unknown) => (typeof x === 'string' ? x : x == null ? null : String(x));
    return {
      name: v.name,
      employeeId: s(v.employeeId),
      email: s(v.email),
      currentPosition: s(v.currentPosition),
      department: s(v.department),
      division: s(v.division),
      yearsExperience: s(v.yearsExperience),
      disciplineStatus: s(v.disciplineStatus),
      mcuStatus: s(v.mcuStatus),
      mcuNoteManual: s(v.mcuNoteManual),
      performanceGrade: s(v.performanceGrade),
      havQuadrant: s(v.havQuadrant),
      behaviorRecommendation: s(v.behaviorRecommendation),
      behaviorNotes: s(v.behaviorNotes),
      education: s(v.education),
      major: s(v.major),
      technicalCompetencies: Array.isArray(v.technicalCompetencies) ? (v.technicalCompetencies as DemoTechnicalCompetency[]) : null,
      // Absent on payloads written before edited-field tracking: left undefined
      // so resolveDemoCopy knows to infer the set.
      editedFields: parseDemoEditedFields((v as { editedFields?: unknown }).editedFields) ?? undefined,
      havTier: (v as { havTier?: unknown }).havTier === 'formula' ? 'formula' : null,
    };
  } catch {
    return null;
  }
}
