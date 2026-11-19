/**
 * Job-family colours, shared by the cluster map and the exported report.
 *
 * A reader cross-references the two — "the orange family on the map" has to be
 * the orange one in the printout — so the palette and the index-based cycling
 * rule live here rather than being restated per surface. Colour follows a
 * family's ORDER in the run's topic list, not its topicId, so the same run
 * always paints the same way while a rebuilt run is free to renumber.
 */

/** Categorical, colourblind-safe. Cycled by a family's position in the run. */
export const FAMILY_PALETTE = [
  '#2563eb', '#f97316', '#16a34a', '#db2777', '#7c3aed', '#0891b2',
  '#ca8a04', '#dc2626', '#4f46e5', '#059669', '#d946ef', '#0d9488',
] as const;

/** Topic -1 — the outlier bucket, deliberately neutral. */
export const NOISE_COLOR = '#94a3b8';

/** Colour for a topic, given the run's topicId → display-order map. */
export function colorForTopic(topicId: number, order: Map<number, number>): string {
  if (topicId === -1) return NOISE_COLOR;
  const idx = order.get(topicId) ?? 0;
  return FAMILY_PALETTE[idx % FAMILY_PALETTE.length]!;
}

/** Display order (topicId → index) from the run's real families, noise excluded. */
export function familyOrder(topicIds: number[]): Map<number, number> {
  const m = new Map<number, number>();
  topicIds.filter((id) => id !== -1).forEach((id, i) => m.set(id, i));
  return m;
}
