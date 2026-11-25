import { Router, type Request, type Response } from "express";
import { reloadMssqlSettings, testConnection } from "../db/mssql.js";
import { describeConnections, type SourceKey } from "../services/db-settings.js";

/**
 * Operational endpoints that are not syncs.
 *
 * Every path here starts with "_" so the audit middleware can skip it — without
 * that, opening the settings page or testing a connection would write rows into
 * `sync_runs` and pollute the history the Sinkronisasi page shows.
 *
 * SECURITY NOTE, because this service has NO authentication of any kind:
 * everything here is either read-only-and-secret-free, idempotent, or verified
 * against material already in the database.
 *   • _db-settings never returns a password (see describeConnections).
 *   • _reload-db-config takes no parameters; the worst an unauthenticated caller
 *     achieves is bouncing a connection pool, which self-heals on the next query.
 *   • _test-connection tests the SAVED settings; it accepts no credentials.
 * The settings themselves are written by the WEB APP straight to Postgres, where
 * `requirePermission('sync.manage')` applies — there is deliberately no write
 * endpoint here.
 */
export const adminRouter = Router() as ReturnType<typeof Router>;

function parseSource(raw: unknown): SourceKey | null {
  return raw === "MPMDS" || raw === "MPMHRGA" ? raw : null;
}

adminRouter.get("/_db-settings", async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, connections: await describeConnections() });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

adminRouter.post("/_reload-db-config", async (_req: Request, res: Response) => {
  try {
    await reloadMssqlSettings();
    res.json({ success: true, message: "Konfigurasi database sumber dimuat ulang." });
  } catch (err) {
    res.status(500).json({ success: false, message: String(err) });
  }
});

adminRouter.post("/_test-connection", async (req: Request, res: Response) => {
  const source = parseSource(req.query.source);
  if (!source) {
    return res
      .status(400)
      .json({ success: false, message: "Parameter source harus MPMDS atau MPMHRGA." });
  }
  try {
    // Always re-read before testing: the operator's save landed in Postgres a
    // moment ago and a cached snapshot would test the previous settings — the
    // one answer a test button must never give.
    await reloadMssqlSettings();
    const result = await testConnection(source);
    return res.status(result.ok ? 200 : 200).json({ success: result.ok, ...result });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});
