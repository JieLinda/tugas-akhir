/**
 * The sixteen HAV quadrants and the 5-Box each one rolls up to.
 *
 * Q13 is STRONG. The methodology document's table never listed quadrants 13 and
 * 14, and this table used to fill both in as SOLID — an implementation guess,
 * recorded as such in scoring-service/src/scoring-engine.ts. HR's Talent Mapping
 * specification (2026-10) states the full matrix and settles it: Q13 (high PA,
 * low behavioural assessment) is STRONG, Q14 stays SOLID.
 *
 * This is the 5-Box CATEGORY only. The HAV aspect SCORE in AHP+TOPSIS reads its
 * own tier table (`HAV_GROUP_SCORES`, scoring-service), where Q13 is still in the
 * 60 tier; the two were never the same reading (Q8 is SOLID here and scores 80
 * there), and moving a scoring tier is a scoring-policy decision, not this one.
 */
export const HAV_QUADRANTS: { number: number; name: string; category: string }[] = [
  { number: 1, name: 'STAR', category: 'TOP' },
  { number: 2, name: 'FUTURE STAR', category: 'STRONG' },
  { number: 3, name: 'POTENTIAL CANDIDATE', category: 'STRONG' },
  { number: 4, name: 'FUTURE STAR', category: 'STRONG' },
  { number: 5, name: 'CANDIDATE', category: 'SOLID' },
  { number: 6, name: 'RAW DIAMOND', category: 'SOLID' },
  { number: 7, name: 'TOP PERFORMER', category: 'STRONG' },
  { number: 8, name: 'STRONG PERFORMER', category: 'SOLID' },
  { number: 9, name: 'CAREER PERSON', category: 'SOLID' },
  { number: 10, name: 'MOST UNFIT EMPLOYEE', category: 'BORDER' },
  { number: 11, name: 'UNFIT EMPLOYEE', category: 'BORDER' },
  { number: 12, name: 'PROBLEM EMPLOYEE', category: 'BORDER' },
  { number: 13, name: 'MAXIMAL CONTRIBUTOR', category: 'STRONG' },
  { number: 14, name: 'CONTRIBUTOR', category: 'SOLID' },
  { number: 15, name: 'MINIMAL CONTRIBUTOR', category: 'BORDER' },
  { number: 16, name: 'DEADWOOD', category: 'BOTTOM' },
];

/**
 * Reduce any stored HAV value to its canonical quadrant-number string
 * ("1".."16"). Handles plain numbers, numeric strings, and legacy descriptive
 * forms like "Kuadran #6" / "Kuadran 6". Returns '' when there is no valid 1–16
 * number, so the mixed data in `candidates.hav_quadrant` compares consistently.
 */
export function normalizeHavQuadrant(raw: number | string | null | undefined): string {
  if (raw == null) return '';
  const match = String(raw).match(/\d+/);
  if (!match) return '';
  const n = parseInt(match[0], 10);
  return n >= 1 && n <= 16 ? String(n) : '';
}

export function getHavQuadrantLabel(num: number | string | null | undefined): string {
  if (num == null) return '';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  const found = HAV_QUADRANTS.find((q) => q.number === n);
  return found ? `${found.name} · ${found.category}` : '';
}

export function getHavQuadrantCategory(num: number | string | null | undefined): string {
  if (num == null) return '';
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  return HAV_QUADRANTS.find((q) => q.number === n)?.category ?? '';
}

export function formatHavQuadrant(num: number | string | null | undefined): string {
  if (num == null || num === '') return '—';
  let n: number;
  if (typeof num === 'string') {
    const match = num.match(/\d+/);
    if (!match) return num;
    n = parseInt(match[0], 10);
  } else {
    n = num;
  }
  if (Number.isNaN(n)) return '—';
  const found = HAV_QUADRANTS.find((q) => q.number === n);
  return found ? `${n} ${found.name} (${found.category})` : `${n}`;
}
