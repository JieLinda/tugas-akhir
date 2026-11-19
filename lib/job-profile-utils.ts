// Helpers for reading job-profile `extractedData` (client-safe, no server deps).
//
// The OCR extraction's technicalCompetencies changed shape:
//   old: ["Kompetensi A", "Kompetensi B"]
//   new: [{ competency: "Kompetensi A", level: 3 }]   // 1=Basic 2=Intermediate 3=Advanced 4=Expert
// Profiles extracted before the prompt change still hold the old shape, so all
// consumers parse through here and accept both.

export type JobProfileTechComp = {
  technicalName: string;
  /** Human-readable target level (e.g. "Advanced"), when the profile has one. */
  targetProficiency?: string;
};

export const PROFICIENCY_LEVEL_LABELS: Record<number, string> = {
  1: 'Basic',
  2: 'Intermediate',
  3: 'Advanced',
  4: 'Expert',
};

/** Normalize a raw level value ("3", 3, "3 = Advanced", "Advanced") to a label. */
export function proficiencyLabel(level: unknown): string | undefined {
  if (level == null) return undefined;
  const raw = String(level).trim();
  if (!raw) return undefined;
  const num = raw.match(/[1-4]/);
  if (num) return PROFICIENCY_LEVEL_LABELS[parseInt(num[0], 10)];
  const known = Object.values(PROFICIENCY_LEVEL_LABELS).find(
    (l) => l.toLowerCase() === raw.toLowerCase(),
  );
  return known ?? raw;
}

export type ParsedDivisionDepartment = {
  division: string | null;
  department: string | null;
};

// jobIdentity.divisionDepartment is one free-text field in the source PDF,
// following a loose "<Divisi> - <Department>" convention (hyphen or en-dash),
// e.g. "ACF - Tax Department" → division "ACF", department "Tax Department".
// Many rows have no separator at all — just a division CODE ("BOD", "ACF",
// "Digital") or just a department/office NAME ("Corporate Secretary"). There
// is no reliable way to disambiguate those without a separator, so we use a
// shape heuristic: a single token (no internal whitespace) reads as a
// division code; a phrase containing the word "Division" is a division full
// name; anything else (a multi-word phrase) reads as a department/office name.
const DIVISION_DEPARTMENT_SEP_RE = /\s+[-–]\s+/;
const DIVISION_WORD_RE = /\bdivision\b/i;

/**
 * Parse a job profile's jobIdentity.divisionDepartment free-text field into
 * its division and department parts (see the pattern notes above). Either
 * side can come back null when it can't be determined.
 */
export function parseDivisionDepartment(value: string | null | undefined): ParsedDivisionDepartment {
  const raw = (value ?? '').trim();
  if (!raw) return { division: null, department: null };

  const sepMatch = raw.match(DIVISION_DEPARTMENT_SEP_RE);
  if (sepMatch && sepMatch.index != null) {
    const division = raw.slice(0, sepMatch.index).trim();
    const department = raw.slice(sepMatch.index + sepMatch[0].length).trim();
    return { division: division || null, department: department || null };
  }

  if (DIVISION_WORD_RE.test(raw) || !/\s/.test(raw)) {
    // Explicitly named as a division, or a single code-like token (no spaces).
    return { division: raw, department: null };
  }

  // Multi-word phrase with no separator and no "Division" — read as a
  // department/office name (e.g. "Corporate Secretary").
  return { division: null, department: raw };
}

/** Parse extractedData.technicalCompetencies in either the old or new shape. */
export function parseJobProfileTechnicalCompetencies(raw: unknown): JobProfileTechComp[] {
  if (!Array.isArray(raw)) return [];
  const out: JobProfileTechComp[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (name) out.push({ technicalName: name });
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      const name = String(obj.competency ?? obj.name ?? obj.technicalName ?? '').trim();
      if (!name) continue;
      const target = proficiencyLabel(obj.level ?? obj.targetProficiency);
      out.push(target ? { technicalName: name, targetProficiency: target } : { technicalName: name });
    }
  }
  return out;
}
