import express from "express";
import { config } from "./config.js";
import { scoringRouter } from "./routes.js";
import { embedRouter } from "./embed-routes.js";
import { closePool, describeDatabaseTarget } from "./db/postgres.js";
import {
  resumeInterruptedSessions,
  startOrphanSweeper,
  stopOrphanSweeper,
} from "./runner.js";
import { log } from "./llm.js";

const app = express();
// Job-family restructured paragraphs can be sizeable in batches — allow more
// headroom than the default scoring payloads.
app.use(express.json({ limit: "8mb" }));

// Health check
app.get("/health", (_req, res) =>
  res.json({ status: "ok", database: describeDatabaseTarget() }),
);

// Routes
app.use("/api/scoring", scoringRouter);
app.use("/api/embed", embedRouter);

// Boot
const server = app.listen(config.port, () => {
  log("server.listening", { port: config.port, database: describeDatabaseTarget() });
  if (config.postgresUrlConflict) {
    console.warn(
      "[Scoring] DATABASE_URL and POSTGRES_URL are both set and DIFFER; using DATABASE_URL " +
        "(same order as the web app). If sessions answer 404 'Session not found', remove the stale one.",
    );
  } else if (config.postgresUrlSource === "default") {
    console.warn(
      "[Scoring] Neither DATABASE_URL nor POSTGRES_URL is set; using the built-in localhost default. " +
        "Every session the web app creates elsewhere will answer 404 'Session not found'.",
    );
  }
  // On startup, resume any sessions that were 'running' when the service
  // was last shut down.
  resumeInterruptedSessions().catch((err) => {
    console.error("[Scoring] resumeInterruptedSessions failed:", err);
  });
  // Then keep re-picking up orphaned 'running' sessions on a timer, so a run
  // whose fire-and-forget /start POST was lost recovers WITHOUT a restart —
  // one start keeps the service ready to score.
  if (config.orphanSweep.intervalMs > 0) {
    startOrphanSweeper(config.orphanSweep.intervalMs, config.orphanSweep.graceMs);
    log("server.orphanSweeper", {
      intervalMs: config.orphanSweep.intervalMs,
      graceMs: config.orphanSweep.graceMs,
    });
  }
});

// Graceful shutdown
async function shutdown(signal: string) {
  log("server.shutdown", { signal });
  stopOrphanSweeper();
  // Stop accepting new HTTP requests
  server.close();
  // In-flight sessions will be resumed on the next service start because
  // their status is still 'running' in the DB. We intentionally do not
  // wait for them to finish.
  await closePool();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
