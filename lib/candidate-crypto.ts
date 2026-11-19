import { decryptOrNull, encryptIfEnabled } from '@/lib/crypto/key-store';

/**
 * At-rest encryption for the candidates table.
 *
 * Every candidate column except id / tenant_id / employee_id (plus the
 * created/updated/deleted metadata) is sealed with the app's AES-256-GCM data
 * key, so a raw database read shows "v1:…" ciphertext instead of the person's
 * data. This module is the WEB app's single encrypt/decrypt chokepoint for
 * candidate rows; sync-service has its own write-side copy
 * (sync-service/src/services/crypto.ts) and scoring-service its read-side copy
 * (scoring-service/src/services/crypto.ts), because each deployable is built
 * independently with no shared lib/.
 *
 * The contract is the self-describing wire format in lib/crypto/envelope.ts:
 * values not in the "v1:" format pass through decryption unchanged. That keeps
 * pre-encryption rows readable and lets scripts/encrypt-candidates.ts backfill
 * existing rows in place.
 *
 * IMPORTANT — because these values are opaque to SQL, no query may match,
 * search, sort, or DISTINCT over them in the database. Every one of those
 * (candidate search, ORDER BY name, grade-range filtering, filter-facet value
 * lists) must fetch rows, decrypt via decryptCandidateRow(s), then operate in
 * the application layer.
 */

/** Every candidate key (snake_case and camelCase) whose value is encrypted. */
export const CANDIDATE_ENCRYPTED_KEYS = new Set<string>([
  'name',
  'email',
  'current_position',
  'currentPosition',
  'department',
  'division',
  'years_experience',
  'yearsExperience',
  'photo_url',
  'photoUrl',
  'grade',
  'discipline_status',
  'disciplineStatus',
  'mcu_status',
  'mcuStatus',
  // Medical prose about a named person — the most sensitive text this app
  // stores. Both the synced note and the hand-entered one.
  'mcu_note',
  'mcuNote',
  'mcu_note_manual',
  'mcuNoteManual',
  'performance_grade',
  'performanceGrade',
  'hav_quadrant',
  'havQuadrant',
  'behavior_recommendation',
  'behaviorRecommendation',
  'behavior_notes',
  'behaviorNotes',
  'education',
  'major',
  'birth_date',
  'birthDate',
]);

const YEARS_KEYS = new Set<string>(['years_experience', 'yearsExperience']);

/** Encrypt one value for storage. Never throws while encryption is initialised. */
export async function encryptCandidateValue(
  plaintext: string | number | null | undefined,
): Promise<string | null> {
  if (plaintext == null || plaintext === '') return null;
  return encryptIfEnabled(String(plaintext));
}

/**
 * Decrypt one value for display. Plaintext passes through; sealed values that
 * cannot be decrypted (locked app, wrong key, corruption) become null so the
 * UI degrades instead of showing ciphertext.
 */
export function decryptCandidateValue(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return decryptOrNull(value).value;
}

/** Encrypt every encrypted field present on a candidate-shaped row (mutates a copy). */
export async function encryptCandidateRow<T extends object>(row: T): Promise<T> {
  const out = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    if (!CANDIDATE_ENCRYPTED_KEYS.has(key)) continue;
    if (value == null) {
      out[key] = value;
      continue;
    }
    out[key] = await encryptCandidateValue(value as string | number);
  }
  return out as T;
}

/**
 * Decrypt every encrypted field present on a candidate-shaped row. `years_*`
 * values are coerced back to numbers when the decrypted value is numeric, so
 * consumers that treat years of service as an integer keep working unchanged.
 */
export function decryptCandidateRow<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    if (!CANDIDATE_ENCRYPTED_KEYS.has(key)) continue;
    if (value == null) {
      out[key] = value;
      continue;
    }
    const decrypted = decryptCandidateValue(value as string);
    if (YEARS_KEYS.has(key)) {
      const num = decrypted != null ? Number(decrypted) : null;
      out[key] = num != null && !Number.isNaN(num) ? num : decrypted;
    } else {
      out[key] = decrypted;
    }
  }
  return out as T;
}

export function decryptCandidateRows<T extends object>(rows: T[]): T[] {
  return rows.map((r) => decryptCandidateRow(r));
}

/**
 * Decrypt the person-scoped fields of a stored PositionCandidate snapshot
 * (analysis_results.details). Runs finalized by a pre-decryption or locked
 * scoring-service can carry "v1:" ciphertext — or null — for name, position,
 * years, HAV quadrant and behavior fields; this restores them for display.
 * Plaintext values pass through untouched, and the AHP `ahpTopsis`/`runInfo`
 * sub-blobs are left alone. Returns a new object; null in, null out.
 */
export function decryptCandidateDetailsSnapshot<T extends object | null>(
  parsed: T,
): T {
  if (parsed == null) return parsed;
  const out = { ...parsed } as Record<string, unknown>;
  for (const key of [
    'name',
    'currentPosition',
    'havQuadrant',
    'behaviorRecommendation',
    'behaviorNotes',
  ] as const) {
    const value = out[key];
    if (value == null || typeof value !== 'string') continue;
    const decrypted = decryptCandidateValue(value);
    if (decrypted != null) out[key] = decrypted;
  }
  const years = out.yearsOfService;
  if (typeof years === 'string') {
    const decrypted = decryptCandidateValue(years);
    const num = decrypted != null ? Number(decrypted) : NaN;
    out.yearsOfService = !Number.isNaN(num) ? num : years;
  }
  return out as T;
}
