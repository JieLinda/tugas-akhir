/**
 * Display labels for the coded candidate attributes.
 *
 * The database stores machine values — `fit_with_note`, `SP_FIRST_LAST`,
 * `CLEAR` — and no screen should ever show them raw. These were previously
 * private helpers inside lib/pulse-data.ts, which meant every other page that
 * rendered the same columns either re-implemented them or printed the raw code.
 * They live here so there is exactly one answer to "how is MCU written".
 *
 * Deliberately NOT a client/server split: these are pure string maps with no
 * imports, so the Kandidat page (server-rendered via pulse-data) and the Talent
 * Pool card view (client component) can share them literally rather than by
 * copy.
 *
 * NOTE — two other copies exist and are intentionally left alone:
 * lib/scoring-engine.ts and scoring-service/src/scoring-engine.ts each have
 * their own `mcuLabel`/`disciplineLabel`. Those feed LLM prompt text during
 * scoring, so changing what they emit would change scoring output. Their
 * discipline maps are also narrower (they only know the lowercase
 * clear/warning/sanction forms and return "-" for 'CLEAR'), which is worth
 * fixing as its own change, not as a side effect of a display tidy-up.
 */

/** MCU status → human label. Unknown/absent reads as '-' (as on Kandidat). */
export function mcuLabel(value: string | null | undefined): string {
  switch (value) {
    case 'fit':
      return 'Fit';
    case 'fit_with_note':
      return 'Fit with note';
    case 'unfit':
      return 'Unfit';
    case 'expired':
      return 'Expired';
    default:
      return '-';
  }
}

/**
 * Disciplinary status → human label.
 *
 * Case-insensitive because the column carries both the synced uppercase codes
 * ('CLEAR', 'SP3') and older lowercase ones ('clear', 'warning'). Unrecognized
 * values fall through as the uppercased code rather than '-', so a new HR status
 * shows up as itself instead of silently reading as "no data".
 */
export function disciplineLabel(value: string | null | undefined): string {
  if (!value) return '-';
  const v = String(value).toUpperCase();
  switch (v) {
    case 'CLEAR':
      return 'Bersih';
    case 'ST':
      return 'ST (Surat Teguran)';
    case 'SP_FIRST_LAST':
      return 'SP Berat (First/Last)';
    case 'SP3':
      return 'SP 3';
    case 'ACTIVE_SP':
      return 'SP Aktif';
    case 'SP_UNDER_2_YEARS':
      return 'SP < 2 tahun';
    case 'WARNING':
      return 'Warning';
    case 'SANCTION':
      return 'Sanksi aktif';
    default:
      return v;
  }
}

/**
 * Behavior recommendation → human label.
 *
 * Stored SHOUTING ('READY WITH DEVELOPMENT'), which reads as an alarm in a
 * chip. Title-cased for display while keeping the wording exactly as stored —
 * these strings are an HR vocabulary, not free text, so they must stay
 * recognizable to whoever wrote them.
 */
export function behaviorLabel(value: string | null | undefined): string {
  if (!value || !value.trim()) return '-';
  return value
    .trim()
    .toLocaleLowerCase('id-ID')
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0]!.toLocaleUpperCase('id-ID') + w.slice(1) : w))
    .join(' ');
}

/** Field key → the label a human would call it, for "data belum terisi" copy. */
export const CANDIDATE_FIELD_LABEL: Record<string, string> = {
  disciplineStatus: 'Disiplin',
  mcuStatus: 'MCU',
  performanceGrade: 'PA',
  havQuadrant: 'HAV',
  behaviorRecommendation: 'Rekomendasi behavior',
  yearsExperience: 'Masa kerja',
  education: 'Pendidikan',
};

/** Human name for a rule's target field; falls back to the raw key. */
export function fieldLabel(field: string | null | undefined): string {
  if (!field) return 'ini';
  return CANDIDATE_FIELD_LABEL[field] ?? field;
}
