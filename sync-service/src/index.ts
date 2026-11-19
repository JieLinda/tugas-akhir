import express from "express";
import { config } from "./config.js";
import { syncRouter } from "./routes/sync.js";
import { uploadRouter } from "./routes/upload.js";
import { adminRouter } from "./routes/admin.js";
import { auditSyncRuns } from "./middleware/audit-sync.js";
import { markInterruptedRuns } from "./services/sync-audit.js";
import { startScheduler, stopScheduler } from "./scheduler.js";
import {
  applyOrphanedTenantSidecars,
  resumeQueuedJobProfiles,
} from "./services/job-profile-sync.js";
import { closePools } from "./db/mssql.js";
import { closePool } from "./db/postgres.js";

const app = express();
app.use(express.json());

// ── Routes ──────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));
// Audit first so it wraps res.json for BOTH the upload and sync routers.
app.use("/api/sync", auditSyncRuns());
// Mounted before syncRouter: /upload/* carries a raw binary body and must not be
// touched by the JSON body parser or mistaken for a sync trigger path.
app.use("/api/sync/upload", uploadRouter);
// Operational endpoints (_unlock, _reload-db-config, ...). Their "_" prefix is
// what audit-sync.ts skips on, so they never appear in the sync run history.
app.use("/api/sync", adminRouter);
app.use("/api/sync", syncRouter);

// ── Start ───────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`[SERVER] Pulse Sync Service running on port ${config.port}`);
  // A crash mid-sync leaves 'running' rows with no writer; close them so the UI
  // never shows a phantom in-progress sync.
  void markInterruptedRuns();
  // The same crash leaves the job-profile QUEUE full, and nothing used to pick
  // it up: `syncJobProfiles` only runs from the cron, the CLI or an HTTP call,
  // so killing the service mid-extraction stranded every remaining file and a
  // restart did nothing about it. This is the counterpart of scoring-service's
  // `resumeInterruptedSessions`, which that side has always had.
  // BEFORE the resume, and unconditionally: a document ingested without its
  // tenant sidecar is owned by nobody and therefore visible to EVERY business
  // unit, so closing that gap is not something to gate behind a resume flag.
  // No-op when every sidecar has already been consumed.
  void applyOrphanedTenantSidecars().catch((err) =>
    console.error("[SERVER] applyOrphanedTenantSidecars failed:", err),
  );
  if (config.jobProfileResumeOnBoot) {
    void resumeQueuedJobProfiles()
      .then((r) => {
        if (r.queued > 0 || r.missing > 0) {
          console.log(`[SERVER] Job profile: ${r.message}`);
        }
      })
      .catch((err) => console.error("[SERVER] resumeQueuedJobProfiles failed:", err));
  }
  startScheduler();
});

// ── Graceful shutdown ───────────────────────────────────────
async function shutdown() {
  console.log("[SERVER] Shutting down...");
  stopScheduler();
  server.close();
  await closePools();
  await closePool();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
