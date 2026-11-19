/**
 * The keys of `lib/scoring-prompts.json` that still have a reader, both in
 * scoring-service's AHP+TOPSIS engine:
 *
 *  • `ahp_education_grounded` — the Pendidikan criterion's grounded Gemini rubric
 *    (`educationSystemPrompt` in scoring-service/src/ahp-topsis-engine.ts).
 *  • `ahp_narrative_agent`    — the per-finalist insight writer
 *    (scoring-service/src/ahp-narrative.ts).
 *
 * Tata Kelola lists only these and a save writes only these: an install whose
 * locally edited JSON still holds a key of the removed AI Tournament would
 * otherwise keep offering a prompt nothing reads. Add a key here when the engine
 * gains a reader for it.
 *
 * Its own module because `lib/scoring-prompt-actions.ts` is `'use server'`,
 * which may export only async functions.
 */
export const ACTIVE_SCORING_PROMPT_KEYS = ['ahp_education_grounded', 'ahp_narrative_agent'] as const;

export type ActiveScoringPromptKey = (typeof ACTIVE_SCORING_PROMPT_KEYS)[number];

export function isActiveScoringPromptKey(key: string): key is ActiveScoringPromptKey {
  return (ACTIVE_SCORING_PROMPT_KEYS as readonly string[]).includes(key);
}
