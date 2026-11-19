// The measured search behind each goal button of the Job Family optimizer.
// Pure: no DB, no network, no Math.random — the same measurements always lead
// to the same next round and the same answer.
//
// A search is a list of ROUNDS of trial results from topic-service. Round 0 is
// the setting in force, measured on the current corpus; every later round is
// planned here from what the earlier ones measured. The server keeps nothing
// between steps: it re-reads the rounds from topic-service and calls these
// functions again, so the browser only ever holds trial ids and cannot hand the
// server a measurement it did not make.
//
//   round 1   the candidates `candidatesFor` proposes for the goal, from the
//             measured baseline (not from the last map, which may describe a
//             corpus that no longer exists)
//   round 2+  continue from the candidate that moved furthest toward the goal
//             without reaching it, and try a milder version of any candidate
//             that reached the goal but made something else worse
//
// It stops as soon as a candidate meets the goal with nothing made worse, when
// a round has nothing new to try, or at the budget below. Every candidate stays
// inside space.ts's BOUNDS, so "not met" means "not reachable within the safe
// ranges on this corpus" — and is reported as exactly that.

import type { BertopicConfig } from '@/lib/job-family/config';
import { scoreMetrics, type MetricDelta, type OptimizeGoal } from './objective';
import { candidatesFor } from './space';
import {
  alreadyMet,
  configKey,
  goalVerdict,
  metricsOfTrial,
  normalizeBertopic,
  paramChanges,
  sideEffects,
  strictThresholdFor,
  toTopicMetrics,
  type GoalVerdict,
  type MeasuredMetrics,
  type ParamChange,
  type StrictThreshold,
  type TrialResult,
} from './measured';

export const SEARCH_LIMITS = {
  /** Candidate rounds after the baseline. */
  maxRounds: 3,
  maxPerRound: 6,
  /** Trials in total, the baseline included. */
  maxTrials: 16,
} as const;

/** One round of trial results, in the order they were requested. */
export type SearchRound = TrialResult[];

/** A config to measure next. `note` is the reason shown to the user. */
export type PlannedTrial = { key: string; config: BertopicConfig; note: string };

export type EvaluatedTrial = {
  key: string;
  config: BertopicConfig;
  reason: string;
  round: number;
  changes: ParamChange[];
  metrics: MeasuredMetrics;
  verdict: GoalVerdict;
  deltas: MetricDelta[];
  regressions: string[];
  score: number;
};

export type SearchEvaluation = {
  goal: OptimizeGoal;
  /** The setting in force when the search started. */
  base: BertopicConfig;
  baseline: MeasuredMetrics;
  /** strict_outliers only. */
  threshold: StrictThreshold | null;
  /** Set when the setting in force already meets the goal on this corpus. */
  alreadyMet: string | null;
  /** Every measured candidate, best first. */
  evaluated: EvaluatedTrial[];
  /** Candidates topic-service could not measure. */
  failed: { key: string; reason: string; error: string }[];
  /** The best candidate that meets the goal, or null. */
  best: EvaluatedTrial | null;
  /** When nothing meets the goal: the candidate that came closest. */
  closest: EvaluatedTrial | null;
};

/** Read the rounds measured so far. Throws when the baseline itself could not be measured. */
export function evaluateSearch(goal: OptimizeGoal, rounds: SearchRound[]): SearchEvaluation {
  const first = rounds[0]?.[0];
  if (!first) throw new Error('Pengaturan yang berlaku belum diukur.');
  if (!first.ok) throw new Error(`Pengaturan yang berlaku gagal diukur: ${first.error}`);
  const baseTrial = first;
  const base = normalizeBertopic(baseTrial.config);
  const baseline = metricsOfTrial(baseTrial);
  const threshold = goal === 'strict_outliers' ? strictThresholdFor(baseTrial, base) : null;
  const ctx = { goal, threshold: threshold?.value ?? null };
  const baseSubject = { metrics: baseline, trial: baseTrial };

  const evaluated: EvaluatedTrial[] = [];
  const failed: SearchEvaluation['failed'] = [];
  rounds.forEach((round, r) => {
    round.forEach((t, i) => {
      if (r === 0 && i === 0) return;
      if (!t.ok) {
        failed.push({ key: t.key, reason: t.note, error: t.error });
        return;
      }
      const metrics = metricsOfTrial(t);
      const { deltas, regressions } = sideEffects(goal, baseline, metrics);
      evaluated.push({
        key: t.key,
        config: normalizeBertopic(t.config),
        reason: t.note,
        round: r,
        changes: paramChanges(base, normalizeBertopic(t.config)),
        metrics,
        verdict: goalVerdict(ctx, baseSubject, { metrics, trial: t }),
        deltas,
        regressions,
        score: scoreMetrics(toTopicMetrics(metrics), { goal }),
      });
    });
  });
  evaluated.sort(compareCandidates);

  const best = evaluated.find((e) => e.verdict.met === true) ?? null;
  const closest = best
    ? null
    : ([...evaluated].sort(compareProgress).find((e) => e.verdict.progress > 0) ?? null);

  return {
    goal,
    base,
    baseline,
    threshold,
    alreadyMet: alreadyMet(ctx, baseSubject),
    evaluated,
    failed,
    best,
    closest,
  };
}

/**
 * Best first: meets the goal, then fewest regressions, then furthest toward
 * the goal, then the overall quality score, then the smallest change. The key
 * breaks exact ties so the order never depends on arrival order.
 */
function compareCandidates(a: EvaluatedTrial, b: EvaluatedTrial): number {
  return (
    Number(b.verdict.met === true) - Number(a.verdict.met === true) ||
    a.regressions.length - b.regressions.length ||
    b.verdict.progress - a.verdict.progress ||
    b.score - a.score ||
    a.changes.length - b.changes.length ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

function compareProgress(a: EvaluatedTrial, b: EvaluatedTrial): number {
  return (
    b.verdict.progress - a.verdict.progress ||
    a.regressions.length - b.regressions.length ||
    b.score - a.score ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

/** True when the search has its answer: the goal met with nothing made worse. */
export function isSettled(ev: SearchEvaluation): boolean {
  return ev.alreadyMet != null || ev.evaluated.some((e) => e.verdict.met === true && e.regressions.length === 0);
}

/** The next round to measure, or [] when the search is finished. */
export function planNextRound(goal: OptimizeGoal, rounds: SearchRound[]): PlannedTrial[] {
  const ev = evaluateSearch(goal, rounds);
  const doneRounds = rounds.length - 1;
  if (isSettled(ev) || doneRounds >= SEARCH_LIMITS.maxRounds) return [];
  const measured = rounds.reduce((n, r) => n + r.length, 0);
  const budget = Math.min(SEARCH_LIMITS.maxPerRound, SEARCH_LIMITS.maxTrials - measured);
  if (budget <= 0) return [];

  const tried = new Set(rounds.flat().map((t) => t.key));
  const planned: PlannedTrial[] = [];
  const add = (config: Partial<BertopicConfig>, note: string) => {
    const normalized = normalizeBertopic(config);
    const key = configKey(normalized);
    if (tried.has(key)) return;
    tried.add(key);
    planned.push({ key, config: normalized, note });
  };
  const objective = { goal, targetTopicCount: null, outlierThreshold: ev.threshold?.value ?? null };

  if (doneRounds === 0) {
    for (const c of candidatesFor(ev.base, toTopicMetrics(ev.baseline), objective)) {
      add({ ...ev.base, ...c.patch }, c.reason);
    }
    return planned.slice(0, budget);
  }

  const frontier = frontierFor(ev.evaluated, doneRounds + 1);
  if (frontier) {
    for (const c of candidatesFor(frontier.config, toTopicMetrics(frontier.metrics), objective)) {
      add({ ...frontier.config, ...c.patch }, `${c.reason} Dilanjutkan dari percobaan yang paling mendekati sasaran.`);
    }
  }
  for (const e of ev.evaluated) {
    if (e.verdict.met !== true || e.regressions.length === 0) continue;
    const mild = midpoint(ev.base, e.config);
    if (mild) {
      add(
        mild,
        'Versi yang lebih lunak dari pilihan yang mencapai sasaran tetapi memperburuk ukuran lain: ' +
          'tiap angka yang berubah digeser separuh jalan saja.',
      );
    }
  }
  return planned.slice(0, budget);
}

/**
 * The candidate round `round` continues from: the one that moved furthest
 * toward the goal without reaching it, among the rounds before it, skipping
 * the ones earlier rounds already continued from. Replayed from the start each
 * time, because the server keeps no state between steps.
 */
function frontierFor(evaluated: EvaluatedTrial[], round: number): EvaluatedTrial | null {
  const used = new Set<string>();
  let current: EvaluatedTrial | null = null;
  for (let r = 2; r <= round; r++) {
    const pool = evaluated
      .filter((e) => e.round < r && e.verdict.met !== true && e.verdict.progress >= 0 && !used.has(e.key))
      .sort(compareProgress);
    current = pool[0] ?? null;
    if (current) used.add(current.key);
  }
  return current;
}

const INTEGER_KEYS = new Set([
  'nNeighbors',
  'nComponents',
  'minClusterSize',
  'minSamples',
  'nGramMin',
  'nGramMax',
  'minDf',
  'topNWords',
  'nrTopics',
  'randomState',
]);

/**
 * `to` with every changed number moved only halfway from `from`; other changes
 * (switches, methods) are kept. Null when no number can move halfway.
 */
function midpoint(from: BertopicConfig, to: BertopicConfig): BertopicConfig | null {
  const a = from as unknown as Record<string, unknown>;
  const out = { ...(to as unknown as Record<string, unknown>) };
  let moved = false;
  for (const [k, v] of Object.entries(out)) {
    const start = a[k];
    if (typeof v !== 'number' || typeof start !== 'number' || v === start) continue;
    const half = INTEGER_KEYS.has(k) ? Math.round((start + v) / 2) : Math.round(((start + v) / 2) * 100) / 100;
    if (half === start || half === v) continue;
    out[k] = half;
    moved = true;
  }
  return moved ? (out as unknown as BertopicConfig) : null;
}

/** Round 0: the setting in force. */
export function baselineTrial(base: BertopicConfig): PlannedTrial {
  const config = normalizeBertopic(base);
  return { key: configKey(config), config, note: 'Pengaturan yang berlaku sekarang.' };
}
