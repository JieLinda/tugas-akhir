import type { NextFunction, Request, Response } from "express";
import { finishRun, startRun, type TriggerSource } from "../services/sync-audit.js";

/**
 * Records one `sync_runs` row per POST through /api/sync/*.
 *
 * Sits at the HTTP layer on purpose: it is the single path every UI and API
 * trigger takes, so all modules are covered by one piece of code that cannot
 * fall out of sync as services are added. It captures the outcome by wrapping
 * res.json — sync handlers all reply with a SyncResult-shaped body.
 */
export function auditSyncRuns() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "POST") return next();

    // '/employees' -> 'employees'; '/upload/hav' -> 'upload:hav'
    const jobKey = req.path.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\//g, ":") || "unknown";

    // Background full-sync returns immediately and keeps working, so its row
    // would be closed while the work continues — let it record itself instead.
    if (jobKey === "all:background") return next();

    // Operational endpoints (routes/admin.ts) are not syncs. Auditing them would
    // fill the Sinkronisasi page's run history with rows for reading settings
    // or bouncing a connection pool, burying the actual sync runs the
    // page exists to show. The "_" prefix is the convention that marks them.
    if (jobKey.startsWith("_")) return next();

    const actorHeader = req.get("x-pulse-actor");
    const triggerSource: TriggerSource = actorHeader ? "ui" : "api";
    const tenantIdsRaw = typeof req.query.tenantId === "string" ? req.query.tenantId : null;
    const mode = typeof req.query.mode === "string" ? req.query.mode : null;

    const runId = await startRun({
      jobKey,
      triggerSource,
      mode,
      tenantIds: tenantIdsRaw ? tenantIdsRaw.split(",").filter(Boolean) : null,
      actor: actorHeader ?? null,
    });

    let settled = false;
    const originalJson = res.json.bind(res);

    res.json = ((body: unknown) => {
      if (!settled) {
        settled = true;
        const b = (body ?? {}) as {
          success?: boolean;
          synced?: number;
          total?: number;
          message?: string;
        };
        // HTTP status is the tiebreaker: a handler can reply 500 with a body
        // that has no `success` field at all.
        const ok = res.statusCode < 400 && b.success !== false;
        // Finish the audit row BEFORE the response goes out. The UI refreshes
        // its "terakhir dijalankan" data the moment this call resolves, so a
        // fire-and-forget write here would race that refetch and the user would
        // be shown the PREVIOUS run. `.finally` so a failed audit write still
        // delivers the sync result.
        finishRun(runId, {
          status: ok ? "success" : "failed",
          synced: typeof b.synced === "number" ? b.synced : null,
          total: typeof b.total === "number" ? b.total : null,
          message: b.message ?? null,
          error: ok ? null : b.message ?? `HTTP ${res.statusCode}`,
        }).finally(() => originalJson(body as never));
        // Express's own res.json returns the Response; callers use it only to
        // end the handler, never to observe that the bytes were written.
        return res;
      }
      return originalJson(body as never);
    }) as Response["json"];

    // Aborted connection / handler that never replies would otherwise leave the
    // row 'running' until the next service restart.
    res.on("close", () => {
      if (!settled) {
        settled = true;
        void finishRun(runId, {
          status: "failed",
          error: "Koneksi terputus sebelum sinkronisasi mengirim hasil",
        });
      }
    });

    next();
  };
}
