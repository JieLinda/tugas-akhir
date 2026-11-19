// What a save may do with a submitted AHP matrix (docs/ahp-input-sync.md §7).
// Pure, so both save paths and the new-session gate are testable without a
// database; the server actions only fetch the stored value and act on this.

import type { AhpConfig } from '@/lib/db/schema';
import { AHP_CRITERIA_ORDER } from '@/lib/db/schema';
import { describeAhpValidation, samePairwise, validateAhpPairwise, type AhpValidation } from '@/lib/ahp';
import { AHP_SHORT_LABELS } from '@/lib/ahp-input';

export type AhpSaveDecision =
  | { kind: 'clear' }
  | { kind: 'keep_unchanged' }
  | { kind: 'store'; pairwise: number[][] }
  | { kind: 'reject'; message: string; validation: AhpValidation | null };

function shapeOf(raw: unknown): number[][] | null {
  const pairwise = (raw as AhpConfig | null)?.pairwise;
  return Array.isArray(pairwise) ? (pairwise as number[][]) : null;
}

/**
 * @param submitted  what the client sent (null = turn custom weights off)
 * @param stored     program_templates.ahp_config as read from the DATABASE —
 *                   never a flag from the client
 * @param allowUnchanged  the program-level save ("Simpan program") always sends
 *   the matrix along with name/filters/prompt; when it is byte-identical to the
 *   stored one it is left as it is, so a program holding an older off-scale
 *   matrix can still save unrelated edits. The AHP save button passes false:
 *   pressing "Simpan Bobot AHP" asks for this matrix to be accepted, so it is
 *   always validated.
 */
export function decideAhpSave(
  submitted: AhpConfig | null,
  stored: AhpConfig | null | undefined,
  { allowUnchanged }: { allowUnchanged: boolean },
): AhpSaveDecision {
  if (submitted === null) return { kind: 'clear' };
  const pairwise = shapeOf(submitted);
  if (allowUnchanged && pairwise && samePairwise(pairwise, shapeOf(stored ?? null))) {
    return { kind: 'keep_unchanged' };
  }
  const validation = validateAhpPairwise(pairwise, { n: AHP_CRITERIA_ORDER.length });
  if (!validation.ok) {
    return { kind: 'reject', message: describeAhpValidation(validation, AHP_SHORT_LABELS), validation };
  }
  return { kind: 'store', pairwise: pairwise! };
}

/**
 * The new-session gate: a scoring session may not START from a program whose
 * stored matrix fails validation. A program with no matrix uses the system
 * defaults (built from a weight vector, never an expert input) and passes.
 * Returns null when the session may start, otherwise the message to show.
 */
export function ahpSessionGateError(stored: AhpConfig | null | undefined, programName: string): string | null {
  const pairwise = shapeOf(stored ?? null);
  if (!pairwise) return null;
  const validation = validateAhpPairwise(pairwise, { n: AHP_CRITERIA_ORDER.length });
  if (validation.ok) return null;
  return (
    `Bobot AHP program "${programName}" belum valid: ${describeAhpValidation(validation, AHP_SHORT_LABELS)} ` +
    'Buka Tata Kelola → Program Penilaian → Bobot AHP, lalu tekan "Bulatkan ke skala Saaty" atau isi ulang ' +
    'perbandingan berpasangannya hingga konsisten, simpan, dan mulai penilaian lagi.'
  );
}
