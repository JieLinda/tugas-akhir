import express, { type Request, type Response } from "express";
import { z } from "zod";
import {
  startSessionProcessing,
  isProcessing,
  cancelSessionProcessing,
  capacity,
  listInflight,
  resumeInterruptedSessions,
  REMOVED_METHOD_MESSAGE,
} from "./runner.js";
import { loadSession, reloadReadinessConfig } from "./scoring-engine.js";
import { runAhpTopsisSession } from "./ahp-topsis-engine.js";
import { reloadPrompts } from "./prompts.js";
import { log } from "./llm.js";
import { describeDatabaseTarget } from "./db/postgres.js";

export const scoringRouter = express.Router() as ReturnType<typeof express.Router>;

const startSchema = z.object({
  sessionId: z.string().uuid(),
});

/**
 * Start (or resume) processing a scoring session (AHP+TOPSIS).
 * Idempotent: if the session is already running, returns 200 with
 * `alreadyRunning: true`. Otherwise kicks off a background loop and
 * returns immediately.
 */
scoringRouter.post("/start", async (req: Request, res: Response) => {
  const parse = startSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid request", details: parse.error.flatten() });
  }
  const { sessionId } = parse.data;

  const session = await loadSession(sessionId);
  if (!session) {
    // The web app calls this only AFTER committing the session row, so on the
    // start path a miss means this service is reading a different database.
    // Say which one (no credentials) so the caller can compare it with its own.
    const database = describeDatabaseTarget();
    log("route.start.sessionNotFound", { sessionId, database });
    return res.status(404).json({ error: "Session not found", sessionId, database });
  }
  if (session.status === "completed") {
    return res.status(200).json({
      sessionId,
      accepted: true,
      alreadyComplete: true,
    });
  }
  if (session.status === "failed") {
    return res.status(409).json({
      error: "Session already failed",
      sessionId,
    });
  }

  const started = startSessionProcessing(sessionId);
  const cap = capacity();
  // Refused because the cap is full ≠ already running: the session is queued and
  // the orphan sweeper will start it. Saying so keeps the caller honest about
  // what "accepted" means for a bulk dispatch.
  const queued = !started && !isProcessing(sessionId);
  log("route.start", { sessionId, started, queued, ...cap });

  res.json({
    sessionId,
    accepted: true,
    alreadyRunning: !started && !queued,
    queued,
    capacity: cap,
  });
});

/**
 * Read current state of a session (for UI polling).
 */
scoringRouter.get("/:sessionId/status", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  const session = await loadSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    id: session.id,
    status: session.status,
    scoringMethod: session.scoringMethod,
    currentPoolSize: session.currentPool.length,
    targetFinalists: session.targetFinalists,
    totalCandidates: session.currentPool.length + session.pendingPool.length,
    updatedAt: session.updatedAt,
    inFlight: isProcessing(sessionId),
    ahpProgress: (session.finalRanked as any)?.ahpProgress ?? null,
  });
});

/**
 * Cancel a running session. The session is marked as 'failed' and the
 * placeholder scoring run (if any) is also marked as failed.
 */
scoringRouter.post("/:sessionId/cancel", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  const session = await loadSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }
  if (session.status === "completed") {
    return res.status(409).json({ error: "Session already completed" });
  }

  const result = await cancelSessionProcessing(sessionId);
  res.json({ sessionId, ...result });
});

/**
 * Manually (re)run the engine for a session — used when the service restarted
 * mid-run and the web app's polling gave up. AHP+TOPSIS is single-pass and
 * idempotent, so re-running it completes the session. Usually the runner does
 * this automatically.
 */
scoringRouter.post("/:sessionId/finalize", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId);
  try {
    const session = await loadSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found", sessionId });
    }
    if (session.scoringMethod !== "ahp_topsis") {
      return res.status(409).json({ error: REMOVED_METHOD_MESSAGE, sessionId });
    }
    const result = await runAhpTopsisSession(sessionId);
    res.json({ sessionId, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Finalize failed",
      sessionId,
    });
  }
});

/**
 * List all in-flight session IDs (for debugging).
 */
scoringRouter.get("/_inflight", (_req: Request, res: Response) => {
  res.json({ inflight: listInflight() });
});

/**
 * Manually trigger resume of interrupted sessions (for debugging).
 */
scoringRouter.post("/_resume", async (_req: Request, res: Response) => {
  await resumeInterruptedSessions();
  res.json({ ok: true });
});

/**
 * Reload scoring prompts from the JSON file without restarting the service.
 */
scoringRouter.post("/_reload-prompts", (_req: Request, res: Response) => {
  reloadPrompts();
  res.json({ ok: true });
});

/**
 * Reload readiness thresholds from the JSON file without restarting the service.
 */
scoringRouter.post("/_reload-readiness", (_req: Request, res: Response) => {
  reloadReadinessConfig();
  res.json({ ok: true });
});
