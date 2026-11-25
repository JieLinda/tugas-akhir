import type { NextFunction, Request, Response } from "express";
import { config, SOURCE_SYNC_OFF_MESSAGE } from "../config.js";
import { EXCEL_SOURCES } from "../services/excel-sources.js";
import { uploadedExcelPath } from "../services/excel-ingest.js";

/**
 * With SOURCE_SYNC_ENABLED=false, refuse every sync request that would contact
 * a source system, with one clear message instead of a connection failure deep
 * inside a job. The connection layer refuses too (db/mssql.ts, services/token.ts),
 * so this is the readable answer, not the only lock.
 *
 * Still served: uploads and what they feed — an Excel route WITH an uploaded
 * workbook waiting (tryExcelUpload ingests it and never reaches MSSQL), HAV /
 * MCU / kamus / job profiles (their shared folders are blanked while off, so
 * they read the upload store only), the candidate sync (Postgres only), and
 * job-profile re-extraction.
 */
const ALWAYS_SOURCE = new Set([
  "/divisions",
  "/departments",
  "/org",
  "/personal",
  "/positions/all",
  "/all",
  "/all/background",
  "/_test-connection",
]);
/** Per-employee REST pulls: /disciplinary/:npk, /education/:npk, /personal/:npk. */
const PER_EMPLOYEE = /^\/(disciplinary|education|personal)\/[^/]+$/;
const EXCEL_ROUTES = new Map(EXCEL_SOURCES.map((s) => [`/${s.syncRoute}`, s]));

export function sourceSyncGuard() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (config.sourceSyncEnabled || req.method !== "POST") return next();
    const path = req.path.replace(/\/+$/, "") || "/";
    const spec = EXCEL_ROUTES.get(path);
    const refuse =
      ALWAYS_SOURCE.has(path) || PER_EMPLOYEE.test(path) || (spec !== undefined && uploadedExcelPath(spec) === null);
    if (!refuse) return next();
    return res.status(409).json({ success: false, synced: 0, total: 0, message: SOURCE_SYNC_OFF_MESSAGE, sourceSync: false });
  };
}
