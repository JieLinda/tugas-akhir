// Reference matrices for the AHP input tests. Row/column order is
// AHP_CRITERIA_ORDER: technical, career, behavior, performance, hav, education.

/** Acuan A — every cell on the Saaty scale: what the pairwise tab DISPLAYED on
 *  run 622af32e ("uji AHP"). w = 0.1593 / 0.3366 / 0.2253 / 0.0930 / 0.1392 /
 *  0.0465, λmax = 6.6930, CR = 0.1118 (rejected). */
export const REF_A: number[][] = [
  [1, 1 / 2, 1 / 2, 3, 1, 3],
  [2, 1, 4, 5, 1, 5],
  [2, 1 / 4, 1, 3, 2, 6],
  [1 / 3, 1 / 5, 1 / 3, 1, 2, 2],
  [1, 1, 1 / 2, 1 / 2, 1, 4],
  [1 / 3, 1 / 5, 1 / 6, 1 / 2, 1 / 4, 1],
];

/** Acuan B — what run 622af32e actually STORED and scored with: A except
 *  career–hav = 1.25 and behavior–hav = 1.5. w = 0.1588 / 0.3481 / 0.2140 /
 *  0.0926 / 0.1402 / 0.0463, CR = 0.0995 (accepted). */
export const REF_B: number[][] = (() => {
  const m = REF_A.map((r) => [...r]);
  m[1]![4] = 1.25;
  m[4]![1] = 1 / 1.25;
  m[2]![4] = 1.5;
  m[4]![2] = 1 / 1.5;
  return m;
})();

/** The editor's labels, in AHP_CRITERIA_ORDER (governance-ahp-editor.tsx CRITERIA). */
export const EDITOR_LABELS = [
  'Technical Competency',
  'Career Relevance',
  'Behavior Competency',
  'Performance Appraisal',
  'HAV Mapping',
  'Education',
] as const;

/** "2" → 2, "1/2" → 0.5, "1,25" → 1.25 (off-scale values are shown as decimals); null when not a ratio. */
export function parseRatioText(text: string): number | null {
  const t = text.replace(/\s+/g, '').replace(',', '.');
  const frac = /^1\/(\d+(?:\.\d+)?)$/.exec(t);
  if (frac) return 1 / Number(frac[1]);
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}
