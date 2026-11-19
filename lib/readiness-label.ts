// ── A ranked row's readiness label, from the RUN's own thresholds (FR-SN-04) ──
//
// Readiness thresholds live in lib/readiness-config.json and are editable
// forever (Tata Kelola → Kesiapan & Pensiun). A finished run's rows must keep
// the label they were given, or editing a threshold today silently re-labels
// every past assessment — "Short" on the day of the forum, "Medium" a week later,
// with nothing on the screen to say the rule moved rather than the person.
//
// So a row's label comes from, in order:
//   1. `stored`   — the label the engine wrote into the row when the run was
//                   computed (`analysis_results.details.readiness`);
//   2. `snapshot` — the run's own frozen thresholds (`config_snapshot.readiness`)
//                   applied to the row's score, for a row written without one;
//   3. `live_fallback` — today's thresholds, ONLY for a run that recorded
//                   neither, and labelled as such so a reader can say so.
//
// Pure and client-safe; lib/pulse-data.ts supplies the live reader.

export type ReadinessThresholdConfig = {
  thresholds: { minScore: number; level: string }[];
  defaultLevel: string;
};

export type ReadinessLabelSource = 'stored' | 'snapshot' | 'live_fallback';

/** A run's `config_snapshot.readiness`, or null when it holds nothing usable. */
export function parseReadinessConfig(raw: unknown): ReadinessThresholdConfig | null {
  const r = raw as { thresholds?: unknown; defaultLevel?: unknown } | null | undefined;
  if (!r || typeof r !== 'object' || !Array.isArray(r.thresholds)) return null;
  const thresholds = r.thresholds
    .map((t) => ({
      minScore: Number((t as { minScore?: unknown })?.minScore),
      level: String((t as { level?: unknown })?.level ?? ''),
    }))
    .filter((t) => Number.isFinite(t.minScore) && t.level.length > 0);
  if (thresholds.length === 0 || typeof r.defaultLevel !== 'string') return null;
  return { thresholds, defaultLevel: r.defaultLevel };
}

/** The walk the engine does: first threshold the score clears, else the default. */
export function readinessFromThresholds(cfg: ReadinessThresholdConfig, score: number): string {
  for (const t of cfg.thresholds) if (score >= t.minScore) return t.level;
  return cfg.defaultLevel;
}

export function readinessLabelForRow(input: {
  /** `details.readiness` as stored, if the row has one. */
  stored: unknown;
  /** The row's score on the 0..100 scale the thresholds use. */
  scorePct: number;
  /** The run's `config_snapshot.readiness`. */
  snapshot: unknown;
  /** Today's thresholds — used only when the run recorded nothing. */
  live: (scorePct: number) => string;
}): { level: string; source: ReadinessLabelSource } {
  if (typeof input.stored === 'string' && input.stored.length > 0) {
    return { level: input.stored, source: 'stored' };
  }
  const cfg = parseReadinessConfig(input.snapshot);
  if (cfg) return { level: readinessFromThresholds(cfg, input.scorePct), source: 'snapshot' };
  return { level: input.live(input.scorePct), source: 'live_fallback' };
}
