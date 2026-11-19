// Background runner — keeps a set of in-flight session IDs that are being
// processed. Each session is one AHP+TOPSIS computation. Multiple sessions can
// run in parallel, up to SCORING_MAX_CONCURRENT.

import { loadSession } from "./scoring-engine.js";
import { runAhpTopsisSession } from "./ahp-topsis-engine.js";
import { execute, query } from "./db/postgres.js";
import { config } from "./config.js";
import { log } from "./llm.js";

// sessionId → AbortController (signal to stop processing)
const inflight = new Map<string, AbortController>();

/**
 * Idempotent: if a session is already being processed, this is a no-op.
 * Returns true if processing was started, false if it was already running OR
 * the concurrency cap is full.
 *
 * A refused start is NOT a failure: the session stays 'running' in the database
 * with no worker on it, which is exactly what `sweepOrphanedSessions` looks for,
 * so the periodic sweep drains the queue as slots free. That is what turns
 * "start 50 runs at once" into "run them a few at a time" without a queue table.
 */
export function startSessionProcessing(sessionId: string): boolean {
  if (inflight.has(sessionId)) {
    log("start.skip", { sessionId, reason: "already running" });
    return false;
  }
  if (inflight.size >= config.maxConcurrentSessions) {
    log("start.queued", {
      sessionId,
      inflight: inflight.size,
      max: config.maxConcurrentSessions,
    });
    return false;
  }

  const controller = new AbortController();
  inflight.set(sessionId, controller);
  log("start.begin", { sessionId });

  // Run in the background — do NOT await this
  void processLoop(sessionId, controller.signal).catch((err) => {
    console.error(
      `[Scoring ${new Date().toISOString()}] processLoop fatal:`,
      err
    );
  });

  return true;
}

export function isProcessing(sessionId: string): boolean {
  return inflight.has(sessionId);
}

/** How many sessions are processing right now, and the cap. */
export function capacity(): { inflight: number; max: number; full: boolean } {
  return {
    inflight: inflight.size,
    max: config.maxConcurrentSessions,
    full: inflight.size >= config.maxConcurrentSessions,
  };
}

export async function cancelSessionProcessing(sessionId: string): Promise<{
  wasRunning: boolean;
  wasCancelled: boolean;
}> {
  const controller = inflight.get(sessionId);
  const wasRunning = !!controller;
  if (controller) {
    controller.abort();
    inflight.delete(sessionId);
  }
  // Best-effort DB update — mark the session as failed so the UI sees it
  // stopped, and likewise mark the placeholder scoring run.
  const session = await loadSession(sessionId);
  if (session && session.status === "running") {
    await execute(
      `UPDATE tournament_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    if (session.runId) {
      // Not `status = 'failed'`: scoring_runs_status_check admits only draft /
      // in_progress / completed / archived, so that UPDATE always threw.
      await recordRunFailure(session.runId, {
        kind: "cancelled",
        message: "Penilaian dibatalkan sebelum selesai.",
      }).catch((err) => log("cancel.recordFailureFailed", { sessionId, error: String(err) }));
    }
  }
  return { wasRunning, wasCancelled: true };
}

/**
 * Record WHY a run did not finish, on the run itself (FR-RR-12).
 *
 * The status column cannot say it — `scoring_runs_status_check` admits only
 * draft / in_progress / completed / archived — so a run that failed keeps
 * `in_progress` and carries `run_info.failure`; every reader turns that into
 * "Gagal" with the message. Never touches a completed run: that is a record
 * of an assessment and immutable (I-1). Its parent is never touched at all.
 */
export async function recordRunFailure(
  runId: string,
  failure: { kind: "error" | "cancelled"; message: string }
): Promise<void> {
  await execute(
    `UPDATE scoring_runs
        SET run_info = COALESCE(run_info, '{}'::jsonb) || jsonb_build_object('failure', $2::jsonb)
      WHERE id = $1 AND status <> 'completed'`,
    [runId, JSON.stringify({ ...failure, at: new Date().toISOString() })]
  );
}

export function listInflight(): string[] {
  return Array.from(inflight.keys());
}

/**
 * The message a session carrying any method but AHP+TOPSIS fails with. The LLM
 * "AI Tournament" (`scoring_method = 'sequential'`) was removed; a session the
 * old web app queued must fail with a reason instead of being scored by an
 * engine that no longer exists — or sitting 'running' for the sweeper forever.
 */
export const REMOVED_METHOD_MESSAGE =
  "Metode AI Tournament (LLM) sudah dihapus; sesi ini tidak dinilai. Mulai scoring baru dengan AHP + TOPSIS.";

async function processLoop(sessionId: string, signal: AbortSignal) {
  try {
    const session = await loadSession(sessionId);
    if (session && session.scoringMethod !== "ahp_topsis") {
      throw new Error(REMOVED_METHOD_MESSAGE);
    }
    const result = await runAhpTopsisSession(sessionId, signal);
    if (signal.aborted) {
      log("start.aborted", { sessionId });
      return;
    }
    log("start.ahpTopsisComplete", { sessionId, ...result });
  } catch (err) {
    console.error(
      `[Scoring ${new Date().toISOString()}] Session processing error:`,
      err
    );
    await execute(
      `UPDATE tournament_sessions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [sessionId]
    );
    // The session alone used to carry the failure; the run stayed `in_progress`
    // with no message, so the run tree showed it running forever (FR-RR-12).
    const failed = await loadSession(sessionId).catch(() => null);
    if (failed?.runId) {
      await recordRunFailure(failed.runId, {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      }).catch((e) => log("start.recordFailureFailed", { sessionId, error: String(e) }));
    }
  } finally {
    inflight.delete(sessionId);
  }
}

/**
 * Re-dispatch every 'running' session that no worker is currently processing.
 *
 * The normal dispatch path is the web app's fire-and-forget `POST /start`; when
 * that POST is lost (service busy at boot, network blip) the session would sit
 * 'running' forever with nothing on it — the reason a restart "fixed" scoring
 * (resume ran at boot). Running this on a timer makes the service self-heal so a
 * single start stays ready to score.
 *
 * `graceMs` skips sessions touched within that window (`updated_at`), so the
 * sweep never races the normal /start dispatch nor grabs one that's actively
 * processing but quiet between progress ticks. `startSessionProcessing` is
 * idempotent (in-flight sessions are skipped), so this is safe to call often.
 */
export async function sweepOrphanedSessions(graceMs = 0): Promise<number> {
  const sessions = await query<{ id: string }>(
    `SELECT id FROM tournament_sessions
      WHERE status = 'running'
        AND updated_at < NOW() - (INTERVAL '1 millisecond' * $1::bigint)`,
    [graceMs]
  );
  let started = 0;
  for (const row of sessions) {
    if (inflight.has(row.id)) continue;
    if (startSessionProcessing(row.id)) started += 1;
  }
  if (started > 0) log("sweep.resumed", { started, candidates: sessions.length });
  return started;
}

/**
 * On startup, resume any sessions left 'running' by a previous process. At boot
 * `inflight` is empty, so every such session is genuinely orphaned — no grace
 * needed. Also exposed via `POST /api/scoring/_resume`.
 */
export async function resumeInterruptedSessions() {
  const started = await sweepOrphanedSessions(0);
  log("resume.check", { started });
}

// ── Periodic orphan sweeper ────────────────────────────────────────
let sweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start the background sweeper (idempotent). Recovers lost-dispatch runs
 *  without a restart. `unref` so it never keeps the process alive on its own. */
export function startOrphanSweeper(intervalMs: number, graceMs: number): void {
  if (sweepTimer || intervalMs <= 0) return;
  sweepTimer = setInterval(() => {
    sweepOrphanedSessions(graceMs).catch((err) =>
      console.error(
        `[Scoring ${new Date().toISOString()}] orphan sweep failed:`,
        err
      )
    );
  }, intervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export function stopOrphanSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
