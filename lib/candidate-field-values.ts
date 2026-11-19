import type { ComboboxOption } from '@/components/ui/combobox';
import type { CandidateAttributeField } from '@/lib/db/schema';
import { HAV_QUADRANTS } from '@/lib/hav-quadrant';

/**
 * Canonical "real" value domains for each candidate attribute a program filter
 * rule can target. These mirror the exact strings the app reads/writes — the
 * same options the candidate edit form offers and the values the sync-service
 * persists — so the governance filter editor can present a picker instead of a
 * blind free-text box (where a wrong case like `clear` vs `CLEAR` silently makes
 * the rule never match).
 *
 * Client-safe: no server-only imports.
 */

/** Which value control the filter editor renders for a field. */
export type FieldInputKind = 'enum' | 'text' | 'numeric';

export const FIELD_INPUT_KIND: Record<CandidateAttributeField, FieldInputKind> = {
  disciplineStatus: 'enum',
  mcuStatus: 'enum',
  performanceGrade: 'enum',
  havQuadrant: 'enum',
  behaviorRecommendation: 'enum',
  education: 'text',
  yearsExperience: 'numeric',
};

/**
 * Curated domain values with friendly labels. Keys are the canonical STORED
 * values (do not lowercase them). `enum` fields are fully described here;
 * `text` fields list the recognized categories as suggestions but still allow
 * free entry. Numeric fields (`yearsExperience`) have no option list.
 */
export const FIELD_VALUE_OPTIONS: Partial<Record<CandidateAttributeField, ComboboxOption[]>> = {
  disciplineStatus: [
    { value: 'CLEAR', label: 'Clear' },
    { value: 'ST', label: 'ST (Surat Teguran)' },
    { value: 'ACTIVE_SP', label: 'Active SP' },
    { value: 'SP_UNDER_2_YEARS', label: 'SP < 2 Years' },
    { value: 'SP3', label: 'SP3' },
    { value: 'SP_FIRST_LAST', label: 'SP First/Last' },
    { value: 'WARNING', label: 'Warning' },
    { value: 'SANCTION', label: 'Sanction' },
  ],
  mcuStatus: [
    { value: 'fit', label: 'Fit' },
    { value: 'fit_with_note', label: 'Fit dengan catatan' },
    { value: 'unfit', label: 'Unfit' },
    { value: 'expired', label: 'Kadaluarsa' },
  ],
  performanceGrade: [
    { value: 'A', label: 'A' },
    { value: 'B', label: 'B' },
    { value: 'C', label: 'C' },
    { value: 'D', label: 'D' },
    { value: 'E', label: 'E' },
  ],
  havQuadrant: HAV_QUADRANTS.map((q) => ({
    value: String(q.number),
    label: `${q.number} · ${q.name} (${q.category})`,
  })),
  // Full behavior ordinal ranking (best → worst) — the complete DVP_MASTER_REKOMENDASI
  // set the sync writes verbatim, in the order the AHP+TOPSIS behavior scorer ranks
  // them. Any unlisted HR-master string still merges in from live DB values at render.
  behaviorRecommendation: [
    'VERY HIGH',
    'STRENGTH',
    'HIGH',
    'READY',
    'MIDDLE HIGH',
    'PENGEMBANGAN JANGKA PENDEK',
    'READY WITH DEVELOPMENT',
    'POTENSI',
    'NEED DEVELOPMENT (9 MONTHS – 2 YEARS)',
    'MIDDLE LOW',
    'FOCUS ON OPTIMIZATION IN CURRENT POSITION',
    'LOW',
    'BELUM ADA POTENSI',
    'VERY LOW',
    'NOT READY',
  ].map((v) => ({ value: v, label: v })),
};

/**
 * Merge the curated option list for a field with the distinct values actually
 * present in this tenant's candidate data. Curated options come first (they
 * carry friendly labels); any real DB value not already covered is appended
 * verbatim so genuine data drift (legacy casing, unlisted HR strings) is still
 * selectable. Falls back to whichever list is available.
 */
export function mergeFieldOptions(
  field: CandidateAttributeField,
  dbValues: string[] | undefined,
): ComboboxOption[] {
  const curated = FIELD_VALUE_OPTIONS[field] ?? [];
  const seen = new Set(curated.map((o) => o.value));
  const extra: ComboboxOption[] = [];
  for (const raw of dbValues ?? []) {
    if (raw == null || raw === '' || seen.has(raw)) continue;
    seen.add(raw);
    extra.push({ value: raw, label: raw });
  }
  return [...curated, ...extra];
}
