import { config, SOURCE_SYNC_OFF_MESSAGE } from "../config.js";
import { Router, type Request, type Response } from "express";
import { syncEmployees } from "../services/employee-sync.js";
import { syncPerformance } from "../services/performance-sync.js";
import { syncAllDisciplinary, syncDisciplinaryForEmployee } from "../services/disciplinary-sync.js";
import { syncAllEducation, syncEducationForEmployee } from "../services/education-sync.js";
import {
  syncAllEmployeePersonal,
  syncEmployeePersonalForEmployee,
} from "../services/employee-personal-sync.js";
import { populateCandidates } from "../services/candidate-populate.js";
import { query as pgQuery } from "../db/postgres.js";
import { npkKeySql } from "../services/npk.js";
import { syncDivisions, syncDepartments, syncOrgStructure } from "../services/org-sync.js";
import {
  syncJobProfiles,
  reextractJobProfile,
  retryFailedJobProfiles,
  applyOrphanedTenantSidecars,
} from "../services/job-profile-sync.js";
import { syncKamusKompetensi } from "../services/kamus-sync.js";
import { syncHav } from "../services/hav-sync.js";
import { syncMcu } from "../services/mcu-sync.js";
import { refreshCandidateTechnicalCompetencies } from "../services/candidate-technical.js";
import { syncGradeLevels } from "../services/grade-sync.js";
import { syncBehaviorCompetencies } from "../services/behavior-sync.js";
import {
  populatePositions,
  syncEmployeePositions,
  syncPositionBundle,
  syncPositionHierarchy,
  syncPositionMaster,
  syncTechnicalCompetencyMappings,
} from "../services/position-sync.js";
import { cleanAllSyncData } from "../services/clean-sync.js";
import { ingestUploadedExcelForRoute } from "../services/excel-ingest.js";
import { finishRun, startRun } from "../services/sync-audit.js";
import {
  parseTenantIds,
  resolveMappingsForTenants,
  type CompanyTenantMapping,
} from "../services/sync-helpers.js";
import type { SyncAllResult, SyncResult } from "../types.js";

export const syncRouter = Router() as ReturnType<typeof Router>;


async function getCompanyFilter(req: Request, res: Response): Promise<CompanyTenantMapping[] | null | "__invalid__"> {
  const tenantIds = parseTenantIds(req.query.tenantId);
  if (tenantIds.length === 0) return null;
  const mappings = await resolveMappingsForTenants(tenantIds);
  if (mappings.length === 0) {
    res.status(400).json({
      success: false,
      message: `No active company→tenant mapping found for tenantId(s): ${tenantIds.join(", ")}`,
    });
    return "__invalid__";
  }
  return mappings;
}

/**
 * Uploaded-workbook short circuit, called first by every sync route that has an
 * Excel spec. Returns true when it has already answered the request.
 *
 * Semantics, and why they differ between the two callers:
 *  • `?uploadsOnly=1` (what the upload tile sends) — the uploaded file is the
 *    ONLY acceptable source. A failure is reported as a failure, because the
 *    user is standing there watching the file they just picked; falling back to
 *    MSSQL and reporting success would tell them their file imported when it
 *    did not.
 *  • Everything else (manual "sync now", cron) — an uploaded file still wins,
 *    since someone put it there deliberately, but a FAILED ingest falls through
 *    to MSSQL/REST rather than answering with the failure. Otherwise one
 *    malformed workbook left on disk would silently disable that source's
 *    scheduled sync every week until a human noticed.
 */
async function tryExcelUpload(
  req: Request,
  res: Response,
  syncRoute: string,
  afterIngest?: FollowUp,
): Promise<boolean> {
  const uploadsOnly = req.query?.uploadsOnly === "1" || req.query?.uploadsOnly === "true";
  const result = await ingestUploadedExcelForRoute(syncRoute, { uploadsOnly });
  if (!result) return false;

  if (!result.success && !uploadsOnly) {
    console.warn(
      `[API] ${syncRoute}: uploaded workbook could not be ingested (${result.message}); ` +
        `falling back to the live source. The file is kept for inspection.`,
    );
    return false;
  }

  // Internal: which companies the workbook wrote. Not part of the response.
  const companyIds = result.companyIds ?? null;
  delete result.companyIds;

  if (result.success && afterIngest) {
    // The workbook is committed; a failure of the follow-up is reported beside
    // it, never as the upload having failed.
    try {
      const follow = await afterIngest({ companyIds });
      // No prefix here: chainSteps marks each failing step itself, and a lone
      // step's failure message already says it failed.
      result.message += ` — ${follow.message}`;
    } catch (err) {
      console.error(`[API] ${syncRoute}: follow-up after upload failed:`, err);
      result.message += ` — Sinkronisasi kandidat setelah upload gagal: ${String(err)}`;
    }
  }

  res.json(result);
  return true;
}


// ── Every upload takes effect immediately ─────────────────────────────────
// An upload lands in a sync_* table; the company-scoped tables every page and
// scoring-service read (positions, candidates + their position history, and
// candidate_technical_competencies) are DERIVED from those. Without these
// follow-ups an uploaded workbook only showed after the next Monday full sync.
// Each one runs only after the workbook is committed, and a failure is reported
// beside the import, never as the import having failed (tryExcelUpload).
//
// What reads what (so each upload re-derives exactly what it feeds):
//   positions  ← sync_positions + sync_employee_positions + sync_employees (dept/division)
//   candidates ← sync_employees + sync_employee_positions + sync_positions (title)
//                + PA, BA, disciplinary, education, HAV, MCU, personal
//   candidate_technical_competencies ← sync_technical_competencies, per live candidate
// Hierarchy and grade levels need nothing: no derived table reads the first,
// and the web reads sync_grade_levels directly.
/**
 * What an upload changed: the Company IDs its rows were written for, or null
 * when the source has no company column (or it is unknown) — then every mapped
 * company is re-derived, as before.
 */
type UploadScope = { companyIds: string[] | null };

/**
 * The Company IDs that employ an NPK written to sync_mcu at or after `since`
 * (a database timestamp taken before the MCU run). MCU rows have no company
 * column; matching by normalised NPK (npk.ts) is how the candidate sync joins
 * them, so this re-derives exactly the companies the upload can have changed.
 */
async function companiesOfMcuSince(since: Date): Promise<string[]> {
  const rows = await pgQuery<{ company_id: string }>(
    `SELECT DISTINCT e.company_id
       FROM sync_mcu m
       JOIN sync_employees e ON ${npkKeySql("e.employee_id")} = ${npkKeySql("m.npk")}
      WHERE m.synced_at >= $1 AND e.company_id IS NOT NULL`,
    [since],
  );
  return rows.map((r) => r.company_id);
}
type FollowUp = (scope: UploadScope) => Promise<SyncResult>;

function chainSteps(...steps: Array<(scope: UploadScope) => Promise<SyncResult>>): FollowUp {
  return async (scope) => {
    // Nothing written (every row was older than what is stored): nothing to re-derive.
    if (scope.companyIds && scope.companyIds.length === 0) {
      return { success: true, synced: 0, total: 0, message: "Tidak ada baris yang berubah; kandidat tidak disinkron ulang." };
    }
    const results: SyncResult[] = [];
    for (const step of steps) results.push(await step(scope));
    return {
      success: results.every((r) => r.success),
      synced: results.reduce((n, r) => n + r.synced, 0),
      total: results.reduce((n, r) => n + r.total, 0),
      message: results.map((r) => (r.success ? r.message : `GAGAL: ${r.message}`)).join(" · "),
    };
  };
}

// PA / BA: the candidate sync records the HAV event under "pa_ba_upload", so the
// HAV formula follows the uploaded PA/BA (docs/talent-mapping.md).
// Each candidate / position step re-derives only the companies the upload
// wrote (scope.companyIds). The technical-competency refresh stays global: it
// is a pure function of the sync_* tables and records no history, so running it
// wider changes nothing.
const scoped = (scope: UploadScope) => (scope.companyIds ? { companyIds: scope.companyIds } : {});
const populateAfterPaBaUpload = chainSteps(
  (scope) => populateCandidates(null, { havOrigin: "pa_ba_upload", ...scoped(scope) }),
  () => refreshCandidateTechnicalCompetencies(),
);
// Data that feeds candidates only.
const populateCandidatesAfterUpload = chainSteps(
  (scope) => populateCandidates(null, scoped(scope)),
  () => refreshCandidateTechnicalCompetencies(),
);
// Data that feeds positions AND candidates (titles, current position, history).
const populatePositionsAfterUpload = chainSteps(
  (scope) => populatePositions(scope.companyIds),
  (scope) => populateCandidates(null, scoped(scope)),
  () => refreshCandidateTechnicalCompetencies(),
);

// ── DB MPMDS: Org structure (divisions + departments) ───────────

syncRouter.post("/divisions", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncDivisions(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Divisions sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/departments", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncDepartments(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Departments sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/org", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncOrgStructure(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Org sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── DB MPMDS: Employees ──────────────────────────────────────────

syncRouter.post("/employees", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "employees", populatePositionsAfterUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncEmployees(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Employee sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── DB MPMHRGA: Position Mapping ───────────────────────────────────

syncRouter.post("/positions/master", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "positions/master", populatePositionsAfterUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncPositionMaster(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Position master sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/positions/hierarchy", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "positions/hierarchy")) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncPositionHierarchy(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Position hierarchy sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/positions/employees", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "positions/employees", populatePositionsAfterUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncEmployeePositions(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Employee-position sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/positions/competencies", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "positions/competencies", () => refreshCandidateTechnicalCompetencies())) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncTechnicalCompetencyMappings(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Technical competency sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/positions/all", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncPositionBundle(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Position bundle sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── DB MPMHRGA: Performance Appraisal ──────────────────────────────

syncRouter.post("/performance", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "performance", populateAfterPaBaUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncPerformance(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Performance sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── API: Disciplinary ────────────────────────────────────────

syncRouter.post("/disciplinary", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "disciplinary", populateCandidatesAfterUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncAllDisciplinary(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Disciplinary sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/disciplinary/:employeeId", async (req: Request, res: Response) => {
  const companyId = (req.query.companyId as string) || "MPM2";
  const employeeId = req.params.employeeId as string;
  try {
    const result = await syncDisciplinaryForEmployee(companyId, employeeId);
    res.json(result);
  } catch (err) {
    console.error(`[API] Disciplinary sync failed for ${employeeId}:`, err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── API: Education ───────────────────────────────────────────

syncRouter.post("/education", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "education", populateCandidatesAfterUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncAllEducation(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Education sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/education/:employeeId", async (req: Request, res: Response) => {
  const companyId = (req.query.companyId as string) || "MPM2";
  const employeeId = req.params.employeeId as string;
  try {
    const result = await syncEducationForEmployee(companyId, employeeId);
    res.json(result);
  } catch (err) {
    console.error(`[API] Education sync failed for ${employeeId}:`, err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── API: Employee personal information (birth date → candidate age) ──

syncRouter.post("/personal", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncAllEmployeePersonal(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Personal information sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/personal/:employeeId", async (req: Request, res: Response) => {
  const companyId = (req.query.companyId as string) || "MPM2";
  const employeeId = req.params.employeeId as string;
  try {
    const result = await syncEmployeePersonalForEmployee(companyId, employeeId);
    res.json(result);
  } catch (err) {
    console.error(`[API] Personal information sync failed for ${employeeId}:`, err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Candidates ───────────────────────────────────────────────

// ?mode=rebuild re-derives the child tables (position history, sync-derived
// technical competencies) from scratch instead of upserting additively. Candidate
// rows themselves are always upserted — never deleted — because they cascade to
// analysis_results / position_picks.
syncRouter.post("/candidates", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  const mode =
    req.body?.mode === "rebuild" || req.query?.mode === "rebuild" ? "rebuild" : "upsert";
  try {
    const result = await populateCandidates(filter?.map((m) => m.tenantId) ?? null, { mode });
    res.json(result);
  } catch (err) {
    console.error("[API] Candidate population failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Job Profiles (SharePoint + LLM) ──────────────────────────

syncRouter.post("/job-profiles", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  // force=true re-runs the LLM extraction for unchanged files too (rows are
  // updated in place — nothing deleted). Accepts body {force:true} or ?force=true.
  const force = req.body?.force === true || req.query?.force === "true";
  // Set by the Sinkronisasi page right after an upload: process ONLY what was
  // just uploaded, never rescan the shared folder. The scheduled job omits it.
  const uploadsOnly = req.query?.uploadsOnly === "1" || req.query?.uploadsOnly === "true";
  try {
    const result = await syncJobProfiles(
      filter?.map((m) => m.tenantSlug).filter((s): s is string => !!s) ?? null,
      { force, uploadsOnly },
    );
    res.json(result);
  } catch (err) {
    console.error("[API] Job profile sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

/**
 * Re-read ONE job profile whose extraction a human judged wrong.
 *
 * Separate from `POST /job-profiles?force=true`, which re-reads the entire
 * corpus: that is one vision-model call per document, so it is the wrong tool
 * for fixing a single bad read. Tenant-agnostic because the target is addressed
 * by id — the row already exists and its tenant assignments are untouched.
 */
syncRouter.post("/job-profiles/:id/reextract", async (req: Request, res: Response) => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: "Id job profile tidak valid." });
  }
  try {
    const result = await reextractJobProfile(id);
    // 404 for a PDF that is no longer on disk: the caller has to act (re-upload),
    // and reporting it as a 500 would send them looking for a server fault.
    if (!result.success && result.missingFile) return res.status(404).json(result);
    if (!result.success) return res.status(500).json(result);
    res.json(result);
  } catch (err) {
    console.error(`[API] Job profile re-extract failed for #${id}:`, err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

/**
 * Re-read EVERY job profile whose last extraction failed.
 *
 * Responds as soon as the batch is queued, not when it finishes: each file is a
 * multi-page vision call, so awaiting the whole run would hold the request open
 * for minutes and time out mid-batch with the work still going. Progress is
 * readable from `sync_job_profiles.queued_at`, which the Job Profiles page
 * already polls.
 */
syncRouter.post("/job-profiles/retry-failed", async (_req: Request, res: Response) => {
  try {
    const result = await retryFailedJobProfiles();
    // 409, not an error: a second click while the first batch is still draining
    // is a no-op the caller should be told about, not a failure.
    if (result.alreadyRunning) return res.status(409).json({ success: false, ...result });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[API] Job profile retry-failed gagal:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

/**
 * Recover tenant mappings for documents ingested without their sidecar.
 *
 * Underscore-prefixed so audit-sync.ts skips it: this repairs data, it is not a
 * sync run and must not appear in the run history as one. Cheap and idempotent —
 * no extraction, one INSERT per tenant, and a no-op once sidecars are consumed.
 */
syncRouter.post("/_job-profiles/recover-tenants", async (_req: Request, res: Response) => {
  try {
    const result = await applyOrphanedTenantSidecars();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[API] recover-tenants gagal:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Kamus Kompetensi Teknis (competency dictionary PDF) ──────

syncRouter.post("/kamus-kompetensi", async (req: Request, res: Response) => {
  // Tenant-agnostic (one dictionary for all). force=true re-parses unchanged
  // files too; rows are upserted by competency code — nothing is deleted.
  const force = req.body?.force === true || req.query?.force === "true";
  const uploadsOnly = req.query?.uploadsOnly === "1" || req.query?.uploadsOnly === "true";
  try {
    const result = await syncKamusKompetensi({ force, uploadsOnly });
    res.json(result);
  } catch (err) {
    console.error("[API] Kamus kompetensi sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── HAV quadrant (Excel from the shared folder) ─────
//
// Tenant-agnostic like the kamus sync: syncHav() reads every workbook in
// LOCAL_HAV_FOLDER and upserts by employee ID, so there is no company filter to
// apply. Previously CLI-only (`npm run cli -- hav`) with no HTTP entry point,
// which left the Sinkronisasi page unable to trigger it.
syncRouter.post("/hav", async (req: Request, res: Response) => {
  const uploadsOnly = req.query?.uploadsOnly === "1" || req.query?.uploadsOnly === "true";
  try {
    const result = await syncHav({ uploadsOnly });
    res.json(result);
  } catch (err) {
    console.error("[API] HAV sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── MCU medical status (Excel from the shared folder) ─────

syncRouter.post("/mcu", async (req: Request, res: Response) => {
  const uploadsOnly = req.query?.uploadsOnly === "1" || req.query?.uploadsOnly === "true";
  try {
    // The database's clock, so the rows this run stamps (synced_at = NOW()) are
    // exactly the ones at or after it.
    const startedAt = (await pgQuery<{ now: Date }>("SELECT now() AS now"))[0]!.now;
    const result = await syncMcu({ uploadsOnly });
    // MCU reaches candidates only through the candidate sync (mcu_status,
    // mcu_note), so run it now rather than waiting for Monday. Like the Excel
    // follow-ups, a failure is reported beside the import.
    if (result.success && result.synced > 0) {
      try {
        // MCU rows carry no company: re-derive the companies that employ the
        // NPKs this run wrote, not every company.
        const follow = await populateCandidatesAfterUpload({ companyIds: await companiesOfMcuSince(startedAt) });
        result.message += ` — ${follow.message}`;
      } catch (err) {
        console.error("[API] MCU follow-up candidate sync failed:", err);
        result.message += ` — Sinkronisasi kandidat setelah MCU gagal: ${String(err)}`;
      }
    }
    res.json(result);
  } catch (err) {
    console.error("[API] MCU sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Grade Levels (MPMHRGA Behaviour Competency Master) ─────

syncRouter.post("/grade-levels", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "grade-levels")) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncGradeLevels(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Grade level sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// ── Behavior Competencies (latest assessment per employee) ─────

syncRouter.post("/behavior-competencies", async (req: Request, res: Response) => {
  if (await tryExcelUpload(req, res, "behavior-competencies", populateAfterPaBaUpload)) return;
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  try {
    const result = await syncBehaviorCompetencies(filter?.map((m) => m.companyId) ?? null);
    res.json(result);
  } catch (err) {
    console.error("[API] Behavior competency sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

// The Talent 5-Box (Stage 1) jobs used to live here: talent-mapping, rtc,
// assessment-center and a talent-staging build, all four called from
// runFullSync — so they ran on the Monday 01:00 cron. The /talent feature they
// fed was a throwaway prototype and is deleted from main; it lives on branch
// `parked/talent-5box` (see docs/talent-5box-parked.md, which lists the exact
// endpoints, CLI commands and SyncAllResult keys removed here).
//
// Their six tables still exist in the database with their last contents.

// ── Full sync ────────────────────────────────────────────────

export async function runFullSync(companyIds: string[] | null = null, tenantIds: string[] | null = null, tenantSlugs: string[] | null = null): Promise<SyncAllResult> {
  if (!config.sourceSyncEnabled) throw new Error(SOURCE_SYNC_OFF_MESSAGE);
  const employees = await syncEmployees(companyIds);
  const { divisions, departments } = await syncOrgStructure(companyIds);
  const {
    positionMaster,
    positionHierarchy,
    employeePositions,
    technicalCompetencies,
    positionsPopulated,
  } = await syncPositionBundle(companyIds);
  const performance = await syncPerformance(companyIds);
  const disciplinary = await syncAllDisciplinary(companyIds);
  const education = await syncAllEducation(companyIds);
  // Before candidates: the birth date it writes is copied onto candidate rows
  // by populateCandidates below.
  const personal = await syncAllEmployeePersonal(companyIds);
  // Before candidates too, for the same reason: populateCandidates copies the
  // behavioural assessment onto candidate rows, and it is half of the HAV
  // formula. Run after it (as it used to), a BA change from MSSQL reached the
  // candidates — and the HAV in force — only on the NEXT run, a week late, and
  // a hand placement made in that week would then be displaced by data that had
  // arrived before it (docs/talent-mapping.md § Urutan waktu).
  const behaviorCompetencies = await syncBehaviorCompetencies(companyIds);
  const candidates = await populateCandidates(tenantIds);
  const jobProfiles = await syncJobProfiles(tenantSlugs);
  const gradeLevels = await syncGradeLevels(companyIds);
  return {
    divisions,
    departments,
    employees,
    positionMaster,
    positionHierarchy,
    employeePositions,
    technicalCompetencies,
    positionsPopulated,
    performance,
    disciplinary,
    education,
    personal,
    candidates,
    jobProfiles,
    gradeLevels,
    behaviorCompetencies,
  };
}

syncRouter.post("/all", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  const clean = req.query.clean === "true";

  if (clean) {
    console.log("[API] Cleaning all sync data before full sync...");
    const cleanResult = await cleanAllSyncData();
    if (cleanResult.errors.length) {
      console.warn(`[API] Clean had errors on: ${cleanResult.errors.join(", ")}`);
    } else {
      console.log(`[API] Clean complete (${cleanResult.deleted} rows removed)`);
    }
  }

  try {
    const companyIds = filter?.map((m) => m.companyId) ?? null;
    const tenantIds = filter?.map((m) => m.tenantId) ?? null;
    const tenantSlugs = filter?.map((m) => m.tenantSlug).filter((s): s is string => !!s) ?? null;
    const result = await runFullSync(companyIds, tenantIds, tenantSlugs);
    res.json(result);
  } catch (err) {
    console.error("[API] Full sync failed:", err);
    res.status(500).json({ success: false, message: String(err) });
  }
});

syncRouter.post("/all/background", async (req: Request, res: Response) => {
  const filter = await getCompanyFilter(req, res);
  if (filter === "__invalid__") return;
  const companyIds = filter?.map((m) => m.companyId) ?? null;
  const tenantIds = filter?.map((m) => m.tenantId) ?? null;
  const tenantSlugs = filter?.map((m) => m.tenantSlug).filter((s): s is string => !!s) ?? null;
  // Records its own run: the middleware skips 'all:background' because the
  // response returns immediately while the work keeps going.
  const actor = req.get("x-pulse-actor");
  const runId = await startRun({
    jobKey: "all",
    triggerSource: actor ? "ui" : "api",
    tenantIds,
    companyIds,
    actor: actor ?? null,
  });

  // Fire and forget
  runFullSync(companyIds, tenantIds, tenantSlugs)
    .then(async (r) => {
      console.log("[API] Background full sync done:", JSON.stringify(r));
      await finishRun(runId, {
        status: "success",
        synced: r.candidates?.synced ?? null,
        message: `Background full sync: emp=${r.employees.synced} cands=${r.candidates.synced} jp=${r.jobProfiles.synced}`,
      });
    })
    .catch(async (err) => {
      console.error("[API] Background full sync failed:", err);
      await finishRun(runId, { status: "failed", error: String(err) });
    });

  res.json({ status: "started", message: "Full sync running in background" });
});
