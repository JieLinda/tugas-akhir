// Demo mode (drizzle/0093) as scoring-service sees it.
//
// A demo session (`tournament_sessions.is_demo`, `scoring_runs.is_demo`) scores
// each candidate's DEMO COPY — the `candidates_dupp` row the web app's demo-mode
// edit writes — instead of the real record. Who is in the pool (ON candidates
// only) was decided by the web app when it built the session; this module only
// substitutes values. Mirrors the web app's lib/demo/fields.ts (separate
// deployables share no lib/): keep the field list in step with it.
//
// The NPK is deliberately NOT substituted: rows feed NPK joins and incumbent
// pairing, which must keep meaning the real person.

import { query } from "./db/postgres.js";
import { formulaQuadrant } from "./hav-effective.js";

export type DemoTechnicalCompetency = {
  technicalId: string;
  technicalName: string;
  proficiencyName: string;
  currentProficiencyName: string;
  score: number;
  currentScore: number;
  gap: number;
};

export type DemoCopy = {
  name: string;
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
  /** Null: the copy keeps the candidate's real competencies. */
  technicalCompetencies: DemoTechnicalCompetency[] | null;
  /**
   * The fields actually edited in demo mode; only these come from the copy, the
   * rest is the candidate's real value now. Undefined on a payload written
   * before edited-field tracking (inferred by resolveDemoCopy); always set
   * after resolution. Mirrors lib/demo/fields.ts.
   */
  editedFields?: DemoEditableField[];
  /**
   * 'formula' when the last automatic HAV event in demo mode was a PA/BA edit or
   * "Hitung kuadran HAV": the formula over the merged PA/BA outranks the real
   * placement and the real upload. A demo HAV edit (Talent Mapping move)
   * outranks it in turn. Mirrors lib/demo/fields.ts.
   */
  havTier?: "formula" | null;
};

/** Every field the demo edit form can change — keep in step with lib/demo/fields.ts. */
export const DEMO_EDITABLE_FIELDS = [
  "name",
  "employeeId",
  "email",
  "currentPosition",
  "department",
  "division",
  "yearsExperience",
  "disciplineStatus",
  "mcuStatus",
  "mcuNoteManual",
  "performanceGrade",
  "havQuadrant",
  "behaviorRecommendation",
  "behaviorNotes",
  "education",
  "major",
  "technicalCompetencies",
] as const;

export type DemoEditableField = (typeof DEMO_EDITABLE_FIELDS)[number];

const EDITABLE_SET = new Set<string>(DEMO_EDITABLE_FIELDS);

/** The scalar fields the copy and the candidate row share (employeeId and competencies apart). */
const ROW_FIELDS = [
  "name",
  "email",
  "currentPosition",
  "department",
  "division",
  "yearsExperience",
  "disciplineStatus",
  "mcuStatus",
  "mcuNoteManual",
  "performanceGrade",
  "havQuadrant",
  "behaviorRecommendation",
  "behaviorNotes",
  "education",
  "major",
] as const;

type ScalarField = Exclude<DemoEditableField, "technicalCompetencies">;

/** The candidate's real values for the editable scalar fields. */
export type DemoRealValues = { [K in ScalarField]: string | null };

/** Same comparison form as lib/demo/fields.ts `demoComparable`. */
export function demoComparable(field: DemoEditableField, value: unknown): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (field === "performanceGrade") {
    if (text === "") return "";
    const parts = text.split(",").map((p) => p.trim());
    while (parts.length < 6) parts.push("");
    return parts.join(",");
  }
  if (field === "havQuadrant") {
    const match = text.match(/\d+/);
    const n = match ? parseInt(match[0], 10) : NaN;
    return n >= 1 && n <= 16 ? String(n) : "";
  }
  if (field === "yearsExperience") {
    if (text === "") return "";
    const n = Number(text);
    return Number.isFinite(n) ? String(n) : text;
  }
  return text;
}

/**
 * Mirror of lib/demo/fields.ts `resolveDemoCopy`: edited fields from the copy,
 * every other field from the candidate's real record now. Payloads written
 * before `editedFields` existed infer the set (a field differing from the real
 * value; a HAV equal to the real upload or the real formula is NOT an edit,
 * because the old form copied the HAV in force into the snapshot).
 */
export function resolveDemoCopy(
  stored: DemoCopy & { employeeId?: string | null },
  real: DemoRealValues,
  formulaOf: (performanceGrade: string | null, behaviorRecommendation: string | null) => string | null,
): DemoCopy {
  let edited: Set<DemoEditableField>;
  if (stored.editedFields) {
    edited = new Set(stored.editedFields);
  } else {
    edited = new Set();
    for (const field of ROW_FIELDS) {
      if (field === "havQuadrant") continue;
      const value = (stored as Record<string, unknown>)[field];
      if (demoComparable(field, value) !== demoComparable(field, real[field])) edited.add(field);
    }
    const copiedHav = demoComparable("havQuadrant", stored.havQuadrant);
    if (
      copiedHav !== "" &&
      copiedHav !== demoComparable("havQuadrant", real.havQuadrant) &&
      copiedHav !== demoComparable("havQuadrant", formulaOf(real.performanceGrade, real.behaviorRecommendation))
    ) {
      edited.add("havQuadrant");
    }
    if (stored.technicalCompetencies) edited.add("technicalCompetencies");
    if (
      stored.employeeId != null &&
      demoComparable("employeeId", stored.employeeId) !== demoComparable("employeeId", real.employeeId)
    ) {
      edited.add("employeeId");
    }
  }
  const pick = (field: ScalarField): string | null =>
    edited.has(field) ? ((stored as Record<string, unknown>)[field] as string | null) ?? null : real[field];
  return {
    name: pick("name") ?? stored.name,
    currentPosition: pick("currentPosition"),
    department: pick("department"),
    division: pick("division"),
    yearsExperience: pick("yearsExperience"),
    disciplineStatus: pick("disciplineStatus"),
    mcuStatus: pick("mcuStatus"),
    mcuNoteManual: pick("mcuNoteManual"),
    performanceGrade: pick("performanceGrade"),
    havQuadrant: pick("havQuadrant"),
    behaviorRecommendation: pick("behaviorRecommendation"),
    behaviorNotes: pick("behaviorNotes"),
    education: pick("education"),
    major: pick("major"),
    technicalCompetencies: edited.has("technicalCompetencies") ? stored.technicalCompetencies ?? [] : null,
    editedFields: DEMO_EDITABLE_FIELDS.filter((f) => edited.has(f)),
    // Kept beside a HAV edit, as `hav_auto_tier` is kept beside a placement:
    // the edit outranks it, and reverting the edit leaves the formula in force.
    havTier: stored.havTier === "formula" ? "formula" : null,
  };
}

/** True when this resolved copy edits `field`. */
export function demoEdits(copy: DemoCopy | null | undefined, field: DemoEditableField): boolean {
  return Boolean(copy?.editedFields?.includes(field));
}

/** Ids whose demo copy EDITS the HAV — the only ones a real manual placement must not outrank. */
export function havEditedIds(copies: Map<string, DemoCopy>): Set<string> {
  return new Set(Array.from(copies.entries()).filter(([, c]) => demoEdits(c, "havQuadrant")).map(([id]) => id));
}

/**
 * Ids whose demo copy pinned the formula (a PA/BA edit or "Hitung kuadran HAV"
 * in demo mode) and does not EDIT the HAV — a demo HAV edit outranks the pin,
 * as a real placement outranks `hav_auto_tier`.
 */
export function havFormulaPinnedIds(copies: Map<string, DemoCopy>): Set<string> {
  return new Set(
    Array.from(copies.entries())
      .filter(([, c]) => c.havTier === "formula" && !demoEdits(c, "havQuadrant"))
      .map(([id]) => id),
  );
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}

function parseCopy(text: string | null): (DemoCopy & { employeeId: string | null; email: string | null }) | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    if (!v || typeof v.name !== "string") return null;
    return {
      name: v.name,
      employeeId: str(v.employeeId),
      // Not scored; parsed only so a pre-tracking payload infers its edits the
      // same way the web app does (lib/demo/fields.ts).
      email: str(v.email),
      currentPosition: str(v.currentPosition),
      department: str(v.department),
      division: str(v.division),
      yearsExperience: str(v.yearsExperience),
      disciplineStatus: str(v.disciplineStatus),
      mcuStatus: str(v.mcuStatus),
      mcuNoteManual: str(v.mcuNoteManual),
      performanceGrade: str(v.performanceGrade),
      havQuadrant: str(v.havQuadrant),
      behaviorRecommendation: str(v.behaviorRecommendation),
      behaviorNotes: str(v.behaviorNotes),
      education: str(v.education),
      major: str(v.major),
      technicalCompetencies: Array.isArray(v.technicalCompetencies)
        ? (v.technicalCompetencies as Record<string, unknown>[])
            .filter((c) => c && typeof c.technicalId === "string")
            .map((c) => ({
              technicalId: String(c.technicalId),
              technicalName: String(c.technicalName ?? ""),
              proficiencyName: String(c.proficiencyName ?? ""),
              currentProficiencyName: String(c.currentProficiencyName ?? ""),
              score: Number(c.score ?? 0) || 0,
              currentScore: Number(c.currentScore ?? 0) || 0,
              gap: Number(c.gap ?? 0) || 0,
            }))
        : null,
      editedFields: Array.isArray(v.editedFields)
        ? Array.from(new Set((v.editedFields as unknown[]).filter((f): f is DemoEditableField => typeof f === "string" && EDITABLE_SET.has(f))))
        : undefined,
      havTier: v.havTier === "formula" ? "formula" : null,
    };
  } catch {
    return null;
  }
}

/** The web app's HAV formula as scoring-service computes it, as a comparable string. */
function serviceFormulaOf(performanceGrade: string | null, behaviorRecommendation: string | null): string | null {
  const q = formulaQuadrant({ performanceGrade, behaviorRecommendation });
  return q == null ? null : String(q);
}

/**
 * Demo copies, RESOLVED against each candidate's real record now
 * (resolveDemoCopy): the scorers see edited fields from the copy and every
 * other field live. A copy that cannot be parsed is skipped.
 */
export async function loadDemoCopies(ids: string[]): Promise<Map<string, DemoCopy>> {
  const out = new Map<string, DemoCopy>();
  if (ids.length === 0) return out;
  const rows = await query<{ candidateId: string; payload: string } & Record<string, unknown>>(
    `SELECT d.candidate_id::text AS "candidateId", d.payload,
            c.name, c.employee_id AS "employeeId", c.email, c.current_position AS "currentPosition",
            c.department, c.division, c.years_experience AS "yearsExperience",
            c.discipline_status AS "disciplineStatus", c.mcu_status AS "mcuStatus",
            c.mcu_note_manual AS "mcuNoteManual", c.performance_grade AS "performanceGrade",
            c.hav_quadrant AS "havQuadrant", c.behavior_recommendation AS "behaviorRecommendation",
            c.behavior_notes AS "behaviorNotes", c.education, c.major
       FROM candidates_dupp d
       JOIN candidates c ON c.id = d.candidate_id
      WHERE d.candidate_id = ANY($1::uuid[])`,
    [ids],
  );
  for (const r of rows) {
    const copy = parseCopy(r.payload ?? null);
    if (!copy) continue;
    const real = {} as DemoRealValues;
    for (const field of [...ROW_FIELDS, "employeeId"] as ScalarField[]) {
      const raw = r[field];
      real[field] = raw == null ? null : String(raw);
    }
    out.set(r.candidateId, resolveDemoCopy(copy, real, serviceFormulaOf));
  }
  return out;
}

/**
 * Candidates switched ON in demo mode among `ids` (candidate_demo_states, no
 * row = off). A demo session's pool was built from ON candidates, but a session
 * can start long after that — queued behind SCORING_MAX_CONCURRENT, resumed by
 * the orphan sweeper — and a candidate switched off meanwhile must not be
 * scored: OFF means "as if deleted", so they are dropped at hydration exactly
 * like a tombstone.
 */
export async function loadDemoOnIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await query<{ id: string }>(
    `SELECT candidate_id::text AS id FROM candidate_demo_states WHERE enabled AND candidate_id = ANY($1::uuid[])`,
    [ids],
  );
  return new Set(rows.map((r) => r.id));
}

/**
 * An engine candidate row with its demo copy's values. Only keys the
 * row already carries are replaced, so each loader keeps its own shape.
 * `yearsExperience` stays numeric where the row holds a number.
 */
export function overlayDemoCopy<T extends object>(row: T, copy: DemoCopy | undefined): T {
  if (!copy) return row;
  const out = { ...row } as Record<string, unknown>;
  // Only the EDITED fields (a resolved copy carries the list); the row already
  // holds the real value of every other one. A copy without the list (never
  // resolved) is applied whole, as before.
  const edited = copy.editedFields ? new Set<string>(copy.editedFields) : null;
  const set = (key: keyof DemoCopy, value: unknown) => {
    if (edited && !edited.has(key)) return;
    if (key in out) out[key] = value;
  };
  set("name", copy.name);
  set("currentPosition", copy.currentPosition);
  set("department", copy.department);
  set("division", copy.division);
  if ("yearsExperience" in out && (!edited || edited.has("yearsExperience"))) {
    const n = copy.yearsExperience == null || copy.yearsExperience === "" ? null : Number(copy.yearsExperience);
    out.yearsExperience = typeof out.yearsExperience === "string" ? copy.yearsExperience : Number.isFinite(n as number) ? n : null;
  }
  set("disciplineStatus", copy.disciplineStatus);
  set("mcuStatus", copy.mcuStatus);
  set("mcuNoteManual", copy.mcuNoteManual);
  set("performanceGrade", copy.performanceGrade);
  set("havQuadrant", copy.havQuadrant);
  set("behaviorRecommendation", copy.behaviorRecommendation);
  set("behaviorNotes", copy.behaviorNotes);
  set("education", copy.education);
  set("major", copy.major);
  return out as T;
}
