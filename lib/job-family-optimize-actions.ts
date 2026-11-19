'use server';

/**
 * Optimasi pengelompokan job family — server side of the button panel on
 * Pengaturan Job Family (components/job-family/optimizer-panel.tsx).
 *
 * No LLM anywhere. Four questions, one action each:
 *
 *   • Does the map still describe the corpus?       getMapFreshnessAction
 *   • What is wrong with the map now?               proposeOptimizationAction
 *   • Which setting achieves goal X on THIS corpus? start/stepOptimizationSearchAction
 *   • Did the rebuilt map do what was measured?     getOptimizationVerificationAction
 *
 * and one write, applyMeasuredOptimizationAction, which only accepts a setting
 * that topic-service MEASURED to meet the goal on the corpus that is embedded
 * now. It used to apply a setting predicted from the last map; that map can
 * describe a corpus that no longer exists, and a prediction is not a result.
 *
 * The search keeps no state here. The browser holds only trial ids; every step
 * re-reads the measurements from topic-service and re-runs the deterministic
 * planner (lib/job-family/optimize/search.ts), so the browser can never hand
 * the server a measurement topic-service did not make, and a restart of the web
 * app loses nothing.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, lte, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  jobFamilyOptimizationExpectations,
  jobFamilyTopicRuns,
  jobFamilyTopics,
  type JobFamilyRunDiagnostics,
} from '@/lib/db/schema';
import { getCurrentUser } from '@/lib/auth';
import { getJobFamilyConfig, saveBertopicConfigAction } from '@/lib/job-family-actions';
import {
  getLatestCompletedTopicRunAction,
  getLatestTopicRunAction,
  getRunQualityInputAction,
  getTopicRunStatusAction,
} from '@/lib/job-family-topics-actions';
import type { BertopicConfig } from '@/lib/job-family/config';
import { readCorpusSnapshot } from '@/lib/job-family/corpus';
import { classifyFreshness, type FreshnessState } from '@/lib/job-family/optimize/freshness';
import { diagnose, type Finding, type OutlierPoint, type ThresholdSuggestion } from '@/lib/job-family/optimize/diagnose';
import {
  configKey,
  metricsFromSizes,
  normalizeBertopic,
  verifyRun,
  type Expectation,
  type GoalVerdict,
  type MeasuredMetrics,
  type ParamChange,
  type StrictThreshold,
  type TrialResult,
} from '@/lib/job-family/optimize/measured';
import { OPTIMIZE_GOALS, type OptimizeGoal } from '@/lib/job-family/optimize/objective';
import {
  SEARCH_LIMITS,
  baselineTrial,
  evaluateSearch,
  planNextRound,
  type EvaluatedTrial,
  type PlannedTrial,
  type SearchRound,
} from '@/lib/job-family/optimize/search';
import { visibleJobProfileIds } from '@/lib/job-profile-tenant-scope';
import { requirePermission } from '@/lib/rbac';

// ── Is the map current? ────────────────────────────────────────────────

export type MapFreshness = {
  state: FreshnessState | 'no_run' | 'unavailable';
  reasons: string[];
  run: { runId: string; completedAt: string | null; documents: number; scope: 'global' | 'tenant' } | null;
  corpus: { documents: number; lastEmbeddedAt: string | null } | null;
  /** The parameters in force differ from the ones the map was built with. */
  configChanged: boolean;
};

type RunRow = {
  id: string;
  tenantId: string | null;
  config: Partial<BertopicConfig> | null;
  numDocuments: number;
  createdAt: string;
  completedAt: string | null;
  diagnostics: JobFamilyRunDiagnostics | null;
};

/** A run with its stored config and diagnostics; diagnostics null before drizzle/0062. */
async function readRun(runId: string): Promise<RunRow | null> {
  const [r] = await db
    .select({
      id: jobFamilyTopicRuns.id,
      tenantId: jobFamilyTopicRuns.tenantId,
      config: jobFamilyTopicRuns.config,
      numDocuments: jobFamilyTopicRuns.numDocuments,
      createdAt: jobFamilyTopicRuns.createdAt,
      completedAt: jobFamilyTopicRuns.completedAt,
    })
    .from(jobFamilyTopicRuns)
    .where(eq(jobFamilyTopicRuns.id, runId))
    .limit(1);
  if (!r) return null;
  let diagnostics: JobFamilyRunDiagnostics | null = null;
  try {
    const res = await db.execute(sql`SELECT diagnostics FROM job_family_topic_runs WHERE id = ${runId}::uuid`);
    const rows = (res as unknown as { rows?: { diagnostics?: unknown }[] }).rows ?? (res as unknown as { diagnostics?: unknown }[]);
    diagnostics = (rows[0]?.diagnostics as JobFamilyRunDiagnostics | null) ?? null;
  } catch {
    // Column absent (drizzle/0062 not applied): the run simply has no fingerprint.
  }
  const iso = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString());
  return {
    id: r.id,
    tenantId: r.tenantId ?? null,
    config: (r.config as Partial<BertopicConfig> | null) ?? null,
    numDocuments: r.numDocuments ?? 0,
    createdAt: iso(r.createdAt)!,
    completedAt: iso(r.completedAt),
    diagnostics,
  };
}

/**
 * Does the map this panel reads (the last completed run visible here) still
 * describe the corpus that is embedded now, and was it built with the
 * parameters in force?
 */
export async function getMapFreshnessAction(): Promise<MapFreshness> {
  await requirePermission('job_profiles.view');
  const summary = await getLatestCompletedTopicRunAction();
  if (!summary) {
    return { state: 'no_run', reasons: [], run: null, corpus: null, configChanged: false };
  }
  const run = await readRun(summary.runId);
  if (!run) return { state: 'no_run', reasons: [], run: null, corpus: null, configChanged: false };

  const ids = run.tenantId ? Array.from(await visibleJobProfileIds(run.tenantId)) : null;
  const [corpus, cfg] = await Promise.all([readCorpusSnapshot(ids), getJobFamilyConfig()]);
  const runInfo = {
    runId: run.id,
    completedAt: run.completedAt,
    documents: run.diagnostics?.corpus?.documents ?? run.numDocuments,
    scope: run.tenantId ? ('tenant' as const) : ('global' as const),
  };
  const configChanged = run.config != null && configKey(run.config) !== configKey(cfg.bertopic);
  if (!corpus) {
    return { state: 'unavailable', reasons: [], run: runInfo, corpus: null, configChanged };
  }
  const { state, reasons } = classifyFreshness(
    {
      fingerprint: run.diagnostics?.corpus?.fingerprint ?? null,
      documents: runInfo.documents,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
    },
    corpus,
  );
  return {
    state,
    reasons,
    run: runInfo,
    corpus: { documents: corpus.documents, lastEmbeddedAt: corpus.lastEmbeddedAt },
    configChanged,
  };
}

// ── Diagnosis of the map as it stands ──────────────────────────────────

export type OptimizationProposal = {
  runId: string;
  /** The goal that fits the worst problem found. */
  goal: OptimizeGoal;
  metrics: {
    topicCount: number;
    numDocuments: number;
    outlierCount: number;
    outlierPct: number;
    tinyCount: number;
    largestShare: number;
    medianSize: number;
  };
  findings: Finding[];
  outlierThreshold: ThresholdSuggestion;
  /** Run lebih baru yang GAGAL — angka di atas berarti bukan dari percobaan terakhir user. */
  failedNewerRun: { runId: string; error: string | null; createdAt: string } | null;
};

/**
 * Read what is wrong with the last completed map, and which goal fits it.
 *
 * This reads the MAP, not the corpus: it is the "what does the map look like"
 * question, and `getMapFreshnessAction` says whether that map still describes
 * what is embedded. It no longer proposes parameter changes — a change is only
 * offered after it has been measured (`startOptimizationSearchAction`).
 */
export async function proposeOptimizationAction(input?: { runId?: string }): Promise<OptimizationProposal> {
  await requirePermission('job_profiles.view');

  // Tanpa runId: run terakhir YANG SELESAI. Satu run gagal tidak boleh menutup
  // diagnosis, karena hasil yang masih dipakai seluruh aplikasi ada di belakangnya.
  const summary = input?.runId
    ? await getTopicRunStatusAction(String(input.runId))
    : await getLatestCompletedTopicRunAction();

  if (!summary) {
    const newest = await getLatestTopicRunAction();
    throw new Error(
      newest
        ? `Belum ada run pengelompokan yang selesai. Run terakhir berstatus "${newest.status}"` +
          (newest.error ? `: ${newest.error}` : '') +
          '. Bangun ulang peta job family lebih dulu.'
        : 'Belum ada run pengelompokan job family. Bangun peta terlebih dahulu.',
    );
  }
  if (summary.status !== 'completed') {
    throw new Error(`Run ini berstatus "${summary.status}", belum ada hasil yang bisa dinilai.`);
  }

  const [cfg, quality, newest] = await Promise.all([
    getJobFamilyConfig(),
    getRunQualityInputAction(summary.runId),
    getLatestTopicRunAction(),
  ]);
  if (!quality) throw new Error('Hasil run tidak ditemukan.');

  // Angka diambil SE-RUN, bukan dari pandangan unit bisnis aktif: parameter yang
  // disetel mengubah pengelompokan seluruh korpus, jadi menilainya dari potongan
  // yang kebetulan terlihat menghasilkan saran yang benar untuk potongan itu dan
  // salah untuk yang sesungguhnya diubah.
  const sizes = quality.sizes;
  const outliers: OutlierPoint[] = quality.outlierSimilarities.map((sim, i) => ({
    jobProfileId: i,
    positionName: null,
    nearestSimilarity: sim,
    nearestTopicId: null,
  }));
  const numDocuments = quality.numDocuments || sizes.reduce((a, b) => a + b, 0) + outliers.length;
  if (numDocuments === 0) {
    throw new Error('Run ini tidak memuat dokumen apa pun, jadi tidak ada yang bisa dinilai.');
  }

  const dx = diagnose({
    config: cfg.bertopic,
    numDocuments,
    sizes,
    outliers,
    seedStability: quality.diagnostics?.seedStability ?? null,
  });
  return {
    runId: summary.runId,
    goal: dx.suggestedGoal,
    metrics: dx.metrics,
    findings: dx.findings,
    outlierThreshold: dx.outlierThreshold,
    failedNewerRun:
      newest && newest.status === 'failed' && newest.runId !== summary.runId
        ? { runId: newest.runId, error: newest.error, createdAt: newest.createdAt }
        : null,
  };
}

// ── topic-service trials ───────────────────────────────────────────────

type TrialBatch = {
  trialId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  done: number;
  total: number;
  corpus: { fingerprint: string; documents: number } | null;
  results: TrialResult[];
  error: string | null;
};

function topicServiceBase(): string {
  const base = process.env.TOPIC_SERVICE_URL;
  if (!base) throw new Error('TOPIC_SERVICE_URL tidak dikonfigurasi. Set env pada web app.');
  return base.replace(/\/$/, '');
}

async function detailOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    /* not JSON */
  }
  return text.slice(0, 300);
}

async function startTrials(trials: PlannedTrial[]): Promise<string> {
  const base = topicServiceBase();
  let res: Response;
  try {
    res = await fetch(`${base}/topics/trials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ configs: trials.map((t) => ({ key: t.key, config: t.config, note: t.note })) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(
      `topic-service tidak dapat dihubungi di ${base} (${err instanceof Error ? err.message : String(err)}). ` +
        'Pastikan service berjalan.',
    );
  }
  if (res.status === 409) throw new Error(await detailOf(res));
  if (res.status === 404) {
    throw new Error('topic-service belum mendukung pengukuran (versi lama). Perbarui topic-service.');
  }
  if (!res.ok) throw new Error(`topic-service menolak pengukuran (HTTP ${res.status}). ${await detailOf(res)}`.trim());
  const body = (await res.json()) as { trialId?: string };
  if (!body.trialId) throw new Error('topic-service tidak mengembalikan id pengukuran.');
  return body.trialId;
}

/** A batch as topic-service holds it; null when it has expired or the service restarted. */
async function readTrials(trialId: string): Promise<TrialBatch | null> {
  const base = topicServiceBase();
  let res: Response;
  try {
    res = await fetch(`${base}/topics/trials/${encodeURIComponent(trialId)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(
      `topic-service tidak dapat dihubungi di ${base} (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`topic-service gagal membaca pengukuran (HTTP ${res.status}). ${await detailOf(res)}`.trim());
  return (await res.json()) as TrialBatch;
}

// ── The measured search ────────────────────────────────────────────────

/** All the browser holds between steps. */
export type OptimizationSearchHandle = { goal: OptimizeGoal; trialIds: string[] };

export type SearchRunning = {
  status: 'running';
  handle: OptimizationSearchHandle;
  /** 0 = measuring the setting in force. */
  round: number;
  done: number;
  total: number;
  message: string;
};

export type SearchDone = {
  status: 'done';
  handle: OptimizationSearchHandle;
  goal: OptimizeGoal;
  /** cleaner_labels: membership must not change, only names. */
  labelsOnly: boolean;
  corpus: { fingerprint: string; documents: number };
  baseline: MeasuredMetrics;
  threshold: StrictThreshold | null;
  outcome: 'already_met' | 'met' | 'met_with_regressions' | 'not_met';
  alreadyMet: string | null;
  /** The setting to apply: met the goal when measured. */
  chosen: EvaluatedTrial | null;
  /** Nothing met the goal: the one that came closest, NOT offered for applying. */
  closest: EvaluatedTrial | null;
  tried: EvaluatedTrial[];
  failed: { key: string; reason: string; error: string }[];
  trials: number;
  rounds: number;
};

export type SearchFailed = { status: 'failed'; message: string };

export type SearchStep = SearchRunning | SearchDone | SearchFailed;

const TRIAL_ID = /^[0-9a-f]{32}$/;

function validHandle(h: unknown): h is OptimizationSearchHandle {
  if (!h || typeof h !== 'object') return false;
  const x = h as OptimizationSearchHandle;
  return (
    OPTIMIZE_GOALS.includes(x.goal) &&
    Array.isArray(x.trialIds) &&
    x.trialIds.length >= 1 &&
    x.trialIds.length <= 1 + SEARCH_LIMITS.maxRounds &&
    x.trialIds.every((id) => typeof id === 'string' && TRIAL_ID.test(id))
  );
}

/** Read every round back from topic-service; a string is the reason it cannot be used. */
async function readRounds(
  handle: OptimizationSearchHandle,
): Promise<{ batches: TrialBatch[]; corpus: { fingerprint: string; documents: number } | null } | string> {
  const batches = await Promise.all(handle.trialIds.map((id) => readTrials(id)));
  if (batches.some((b) => b == null)) {
    return 'Hasil pengukuran sudah kedaluwarsa atau topic-service dimulai ulang. Ukur ulang.';
  }
  const ok = batches as TrialBatch[];
  const stopped = ok.find((b) => b.status === 'failed' || b.status === 'cancelled');
  if (stopped) return stopped.error ?? 'Pengukuran gagal.';
  const prints = new Set(ok.map((b) => b.corpus?.fingerprint).filter(Boolean));
  if (prints.size > 1) {
    return 'Korpus berubah di tengah pengukuran (ada transformasi yang selesai). Ukur ulang.';
  }
  return { batches: ok, corpus: ok.find((b) => b.corpus)?.corpus ?? null };
}

function goalOf(input: unknown): OptimizeGoal {
  if (typeof input === 'string' && (OPTIMIZE_GOALS as readonly string[]).includes(input)) {
    return input as OptimizeGoal;
  }
  throw new Error('Sasaran optimasi tidak dikenal.');
}

/**
 * Start measuring `goal`: first the setting in force, on the corpus embedded
 * now. Writes nothing. Poll `stepOptimizationSearchAction` with the handle.
 */
export async function startOptimizationSearchAction(input: { goal: OptimizeGoal }): Promise<SearchStep> {
  await requirePermission('job_profiles.view');
  const goal = goalOf(input?.goal);
  try {
    const cfg = await getJobFamilyConfig();
    const trialId = await startTrials([baselineTrial(cfg.bertopic)]);
    return {
      status: 'running',
      handle: { goal, trialIds: [trialId] },
      round: 0,
      done: 0,
      total: 1,
      message: 'Mengukur pengaturan yang berlaku pada korpus sekarang…',
    };
  } catch (err) {
    return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Advance a search: report progress while topic-service measures, plan and
 * start the next round when one finishes, or return the answer.
 */
export async function stepOptimizationSearchAction(handle: OptimizationSearchHandle): Promise<SearchStep> {
  await requirePermission('job_profiles.view');
  if (!validHandle(handle)) return { status: 'failed', message: 'Pengukuran tidak dikenal. Mulai ulang.' };
  try {
    const read = await readRounds(handle);
    if (typeof read === 'string') return { status: 'failed', message: read };
    const { batches, corpus } = read;

    const last = batches[batches.length - 1]!;
    const round = batches.length - 1;
    if (last.status !== 'completed') {
      return {
        status: 'running',
        handle,
        round,
        done: last.done,
        total: last.total,
        message:
          round === 0
            ? 'Mengukur pengaturan yang berlaku pada korpus sekarang…'
            : `Putaran ${round}: mengukur ${last.total} kandidat pada korpus sekarang (${last.done}/${last.total})…`,
      };
    }

    const rounds: SearchRound[] = batches.map((b) => b.results);
    const baselineKey = rounds[0]?.[0]?.key;
    const cfg = await getJobFamilyConfig();
    if (baselineKey !== configKey(cfg.bertopic)) {
      return {
        status: 'failed',
        message:
          'Parameter BERTopic diubah selama pengukuran. Ukur ulang agar hasilnya sesuai pengaturan yang berlaku.',
      };
    }

    const plan = planNextRound(handle.goal, rounds);
    if (plan.length > 0) {
      const trialId = await startTrials(plan);
      return {
        status: 'running',
        handle: { ...handle, trialIds: [...handle.trialIds, trialId] },
        round: round + 1,
        done: 0,
        total: plan.length,
        message: `Putaran ${round + 1}: mengukur ${plan.length} kandidat pada korpus sekarang…`,
      };
    }

    const ev = evaluateSearch(handle.goal, rounds);
    const outcome: SearchDone['outcome'] = ev.alreadyMet
      ? 'already_met'
      : ev.best
        ? ev.best.regressions.length === 0
          ? 'met'
          : 'met_with_regressions'
        : 'not_met';
    return {
      status: 'done',
      handle,
      goal: handle.goal,
      labelsOnly: handle.goal === 'cleaner_labels',
      corpus: corpus ?? { fingerprint: '', documents: ev.baseline.numDocuments },
      baseline: ev.baseline,
      threshold: ev.threshold,
      outcome,
      alreadyMet: ev.alreadyMet,
      chosen: ev.alreadyMet ? null : ev.best,
      closest: ev.alreadyMet ? null : ev.closest,
      tried: ev.evaluated,
      failed: ev.failed,
      trials: rounds.reduce((n, r) => n + r.length, 0),
      rounds: rounds.length - 1,
    };
  } catch (err) {
    return { status: 'failed', message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Applying a measured setting ────────────────────────────────────────

export type ApplyMeasuredResult = {
  changed: ParamChange[];
  message: string;
  /** False when the measurement could not be recorded (drizzle/0090 missing). */
  expectationSaved: boolean;
};

function configHash(config: Partial<BertopicConfig>): string {
  return createHash('sha256').update(configKey(config)).digest('hex');
}

/**
 * Save a setting the search MEASURED to meet its goal — nothing else.
 *
 * Refused when the setting did not meet the goal, when the corpus is no longer
 * the one it was measured on, or when the parameters in force changed since the
 * measurement started (checked under the config write lock). Those are exactly
 * the cases in which "this meets the goal" would stop being a measured fact.
 *
 * CAKUPANNYA GLOBAL — konfigurasi Job Family tunggal untuk semua unit bisnis;
 * panel menyatakannya di samping tombol.
 */
export async function applyMeasuredOptimizationAction(input: {
  handle: OptimizationSearchHandle;
  key: string;
}): Promise<ApplyMeasuredResult> {
  await requirePermission('job_profiles.manage');
  if (!validHandle(input?.handle)) throw new Error('Pengukuran tidak dikenal. Ukur ulang.');
  const read = await readRounds(input.handle);
  if (typeof read === 'string') throw new Error(read);
  if (read.batches.some((b) => b.status !== 'completed')) throw new Error('Pengukuran belum selesai.');

  const ev = evaluateSearch(input.handle.goal, read.batches.map((b) => b.results));
  const cand = ev.evaluated.find((e) => e.key === input.key);
  if (!cand) throw new Error('Pilihan ini tidak ada dalam hasil pengukuran.');
  if (cand.verdict.met !== true) {
    throw new Error('Pilihan ini tidak mencapai sasaran menurut pengukuran, jadi tidak diterapkan.');
  }

  const measuredOn = read.corpus;
  const now = await readCorpusSnapshot(null);
  if (!measuredOn || !now) throw new Error('Korpus job profile tidak dapat dibaca.');
  if (now.fingerprint !== measuredOn.fingerprint) {
    throw new Error(
      `Korpus berubah sejak diukur (${measuredOn.documents} dokumen saat diukur, ${now.documents} sekarang, ` +
        'atau isinya ditransformasi ulang). Ukur ulang sebelum menerapkan.',
    );
  }

  await saveBertopicConfigAction(cand.config as unknown as Record<string, unknown>, {
    expectBertopic: ev.base,
  });

  let expectationSaved = true;
  try {
    const user = await getCurrentUser().catch(() => null);
    await db.insert(jobFamilyOptimizationExpectations).values({
      goal: input.handle.goal,
      configHash: configHash(cand.config),
      bertopic: cand.config,
      corpusFingerprint: measuredOn.fingerprint,
      corpusDocuments: measuredOn.documents,
      threshold: ev.threshold?.value ?? null,
      baseline: ev.baseline,
      predicted: cand.metrics,
      verdict: cand.verdict,
      regressions: cand.regressions,
      createdBy: user && user.id !== 'system-local-user' ? (user.name || user.email || null) : null,
    });
  } catch (err) {
    // The setting is saved; only the check after the rebuild loses its reference.
    expectationSaved = false;
    console.warn(
      '[job-family-optimize] measurement not recorded (apply drizzle/0090_job_family_optimization_expectations.sql):',
      err instanceof Error ? err.message : err,
    );
  }

  return {
    changed: cand.changes,
    expectationSaved,
    message: `${cand.changes.length} parameter diperbarui sesuai pengukuran. Peta belum berubah sampai dibangun ulang.`,
  };
}

// ── After the rebuild ──────────────────────────────────────────────────

export type OptimizationVerification = {
  runId: string;
  goal: OptimizeGoal;
  appliedAt: string;
  appliedBy: string | null;
  corpus: 'same' | 'changed' | 'unknown';
  reproduced: boolean | null;
  goalMet: boolean | null;
  summary: string;
  regressions: string[];
  mismatches: string[];
  /** The verdict as measured before applying. */
  measured: GoalVerdict;
  predicted: MeasuredMetrics;
  actual: MeasuredMetrics;
};

/**
 * Compare a finished map with the measurement behind the setting it was built
 * with. Null when the run was not built with a setting the optimizer applied
 * (or drizzle/0090 is missing), or when it is a single business unit's run —
 * the optimizer measures the global corpus.
 */
export async function getOptimizationVerificationAction(
  runId?: string,
): Promise<OptimizationVerification | null> {
  await requirePermission('job_profiles.view');
  const id = runId ?? (await getLatestCompletedTopicRunAction())?.runId;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const run = await readRun(id);
  if (!run || run.tenantId || !run.config) return null;

  let exp: typeof jobFamilyOptimizationExpectations.$inferSelect | undefined;
  try {
    [exp] = await db
      .select()
      .from(jobFamilyOptimizationExpectations)
      .where(
        and(
          eq(jobFamilyOptimizationExpectations.configHash, configHash(normalizeBertopic(run.config))),
          lte(jobFamilyOptimizationExpectations.createdAt, new Date(run.createdAt)),
        ),
      )
      .orderBy(desc(jobFamilyOptimizationExpectations.createdAt))
      .limit(1);
  } catch {
    return null; // table absent (drizzle/0090 not applied)
  }
  if (!exp) return null;

  const topics = await db
    .select({ size: jobFamilyTopics.size, keywords: jobFamilyTopics.keywords })
    .from(jobFamilyTopics)
    .where(and(eq(jobFamilyTopics.runId, run.id), ne(jobFamilyTopics.topicId, -1)));
  const actual = metricsFromSizes(
    topics.map((t) => t.size),
    run.numDocuments,
    topics.map((t) =>
      Array.isArray(t.keywords) ? (t.keywords as { word?: unknown }[]).map((k) => String(k.word ?? '')) : [],
    ),
  );

  const expectation: Expectation = {
    goal: exp.goal as OptimizeGoal,
    threshold: exp.threshold,
    corpusFingerprint: exp.corpusFingerprint,
    corpusDocuments: exp.corpusDocuments,
    baseline: exp.baseline as MeasuredMetrics,
    predicted: exp.predicted as MeasuredMetrics,
    verdict: exp.verdict as GoalVerdict,
    regressions: (exp.regressions as string[]) ?? [],
  };
  const v = verifyRun(expectation, { fingerprint: run.diagnostics?.corpus?.fingerprint ?? null, metrics: actual });
  return {
    runId: run.id,
    goal: expectation.goal,
    appliedAt: exp.createdAt instanceof Date ? exp.createdAt.toISOString() : String(exp.createdAt),
    appliedBy: exp.createdBy ?? null,
    ...v,
    measured: expectation.verdict,
    predicted: expectation.predicted,
    actual,
  };
}
