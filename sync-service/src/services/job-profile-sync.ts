/**
 * Job Profile Sync — reads PDFs from a shared folder (Windows UNC or a Linux/mac
 * mounted path such as /mnt/share), extracts text, processes with an LLM, and
 * upserts structured data into the sync_job_profiles PostgreSQL table.
 *
 * Folder structure at LOCAL_PDF_FOLDER — every subfolder is scanned and its name
 * recorded as `source_folder` (display metadata only — see below):
 *   <LOCAL_PDF_FOLDER>/
 *     SomeJobProfile.pdf              ← root-level PDFs are picked up
 *     Mulia/                          ← any subfolder is scanned too
 *       AnotherJobProfile.pdf
 *
 * WHICH BUSINESS UNIT a document belongs to is NEVER inferred from the folder
 * name (that guesswork was wrong before: the folder called "mulia" holds
 * positions from every BU). It is assigned directly into `job_profile_tenants`:
 *   - an uploaded PDF carries its tenant choice as a `<path>.tenants.json`
 *     sidecar written by the upload route, applied here right after the
 *     document is ingested (see applyPendingTenantSidecar below);
 *   - a document scanned from the shared folder has no such moment, so it
 *     starts with NO ownership row and is visible to every tenant until an
 *     admin assigns it on the Job Profile page (lib/job-profile-tenant-actions.ts).
 * There used to be an intermediate admin-editable folder→tenant table
 * (job_profile_folder_map); it was removed because every real folder mapped
 * 1:1 to a tenant of the same name, so it only added a registration step for an
 * answer that was already known — see docs/job-profile-tenant-scope.md.
 *
 * On Windows LOCAL_PDF_FOLDER is typically a UNC path (\\server\share\...); on
 * Linux point it at the mounted CIFS path (e.g. /mnt/jobprofiles). Share
 * connect/credential handling lives in ./network-share.ts and is skipped
 * entirely off Windows.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { config } from "../config.js";
import { execute, query } from "../db/postgres.js";
import { extractJobProfile } from "./llm-processor.js";
import {
  loadKamusNameKeys,
  reconcileCompetencies,
  summarizeWarnings,
} from "./job-profile-competencies.js";
import { ensureNetworkShareAccess, assertPathAccessible } from "./network-share.js";
import {
  UPLOAD_SUBDIR,
  discardUploaded,
  discardSummary,
  hasPdfsDirectlyIn,
  listSubfolders,
  mergePdfSources,
  uploadPath,
} from "./upload-store.js";
import type { ExtractedJobProfile, SyncResult } from "../types.js";

const execFileAsync = promisify(execFile);

// ── PDF conversion (platform-aware) ───────────────────────────

async function convertPdfToImages(pdfPath: string, outDir: string, outPrefix: string): Promise<void> {
  if (process.platform === "darwin" || process.platform === "win32") {
    const { default: poppler } = await import("pdf-poppler");
    await poppler.convert(pdfPath, {
      format: "png",
      out_dir: outDir,
      out_prefix: outPrefix,
      page: null,
      // Match the Linux branch's 300 DPI. Without this pdf-poppler renders at
      // its own much lower default, and the competency LEVEL column — one small
      // digit per row — is the first thing to stop being legible. The result is
      // not a failure but a quietly worse extraction, on developer machines
      // only, which is the hardest kind of difference to notice.
      scale: 2048,
    } as Parameters<typeof poppler.convert>[1]);
  } else {
    await execFileAsync("pdftoppm", [
      "-png",
      "-r", "300",
      pdfPath,
      join(outDir, outPrefix),
    ]);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Tenant ownership ─────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Read a `<pdfPath>.tenants.json` sidecar left by the upload route (see
 * routes/upload.ts) and consume it (delete on read, success or not) — a
 * malformed or already-processed sidecar must not be retried forever.
 * Returns null when there is nothing to apply.
 */
function takeTenantSidecar(pdfPath: string): string[] | null {
  const sidecarPath = `${pdfPath}.tenants.json`;
  if (!existsSync(sidecarPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(sidecarPath, "utf-8")) as { tenantIds?: unknown };
    if (!Array.isArray(parsed.tenantIds)) return null;
    const ids = parsed.tenantIds.filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  } finally {
    try {
      unlinkSync(sidecarPath);
    } catch {
      // Already gone, or a permissions hiccup — nothing to act on either way.
    }
  }
}

/**
 * Apply an upload's chosen tenant(s) to the document it just became.
 *
 * Only uploaded files ever carry a sidecar (the shared-folder scan path has no
 * upload-time moment to choose a tenant at all), so this is a no-op for every
 * other file. Best-effort: an invalid tenant id fails its own INSERT (the
 * foreign key does the validating) without blocking the sync or the other ids
 * in the same sidecar.
 */
async function applyPendingTenantSidecar(pdfPath: string, jobProfileId: number): Promise<void> {
  const tenantIds = takeTenantSidecar(pdfPath);
  if (!tenantIds) return;
  let applied = 0;
  for (const tenantId of tenantIds) {
    try {
      await execute(
        `INSERT INTO job_profile_tenants (job_profile_id, tenant_id, source)
         VALUES ($1, $2::uuid, 'manual')
         ON CONFLICT (job_profile_id, tenant_id) DO NOTHING`,
        [jobProfileId, tenantId]
      );
      applied++;
    } catch (err) {
      console.error(
        `[JOB-PROFILE]   Tenant ${tenantId} tidak diterapkan ke job_profile ${jobProfileId}:`,
        (err as Error).message
      );
    }
  }
  if (applied > 0) {
    console.log(`[JOB-PROFILE]   -> dipetakan ke ${applied} tenant dari pilihan saat unggah`);
  }
}

// ── Extraction retries ───────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run the vision extraction with bounded retries.
 *
 * Deliberately NOT classified by error message. Everything `extractJobProfile`
 * throws is worth another attempt — a transport error (timeout, 429, 5xx) and a
 * format error ("LLM did not return valid JSON", a JSON.parse throw) alike, the
 * latter because a vision model failing to close its fences is stochastic and
 * usually succeeds on the next pass. Matching on error strings would be a
 * guess that silently stops retrying the moment a gateway rewords a message.
 *
 * What is genuinely not retryable — a PDF that converts to zero pages, a file
 * that is gone — throws BEFORE this is reached, so it costs one attempt, not
 * `attempts`.
 *
 * Returns the attempt count so a row that only succeeded on the third try can
 * say so: silently recovering from a flaky model hides that it is flaky.
 */
async function extractWithRetries(
  images: string[],
  fileName: string,
): Promise<{ extracted: ExtractedJobProfile; attempts: number }> {
  const maxAttempts = config.jobProfileExtractAttempts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Attempt 1 at temperature 0 so a normal extraction stays reproducible;
    // later attempts nudge it, because re-sending identical images to a
    // deterministic model returns the identical malformed JSON. Every failure
    // observed on this deployment so far is a JSON.parse error, so a retry that
    // cannot differ from its predecessor would be pure cost.
    const temperature = attempt === 1 ? 0 : Math.min(0.2 * (attempt - 1), 0.6);
    try {
      const extracted = await extractJobProfile(images, { temperature });
      if (attempt > 1) {
        console.log(`[JOB-PROFILE]   ↻ ${fileName} berhasil pada percobaan ke-${attempt}`);
      }
      return { extracted, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts) break;
      // Exponential, with jitter: a batch that fails together must not retry
      // together and hit the gateway with the same thundering herd.
      const base = config.jobProfileExtractBackoffMs * 2 ** (attempt - 1);
      const wait = Math.round(base * (0.5 + Math.random()));
      console.warn(
        `[JOB-PROFILE]   ⚠ ${fileName} percobaan ${attempt}/${maxAttempts} (t=${temperature}) gagal ` +
          `(${(err as Error).message.slice(0, 160)}), ulangi dalam ${wait}ms`,
      );
      await sleep(wait);
    }
  }
  throw new Error(
    `gagal setelah ${maxAttempts} percobaan — ${(lastErr as Error)?.message ?? String(lastErr)}`,
  );
}

// ── Extraction queue ─────────────────────────────────────────
//
// `status` is the state of the extracted CONTENT; `queued_at` is whether the
// file is waiting for (re)extraction. They are separate columns on purpose:
// nine call sites select job profiles with `status = 'completed'`, so marking a
// whole batch 'pending' up front would empty the job-profile corpus for the
// length of the run — silently, because every one of those readers would simply
// find nothing. A file keeps serving its previous extraction right up until the
// new one replaces it.

type ExistingProfile = { id: number; fileHash: string | null; status: string };

/** Current row for each path, in one query rather than one per file. */
async function loadExistingProfiles(paths: string[]): Promise<Map<string, ExistingProfile>> {
  const out = new Map<string, ExistingProfile>();
  if (paths.length === 0) return out;
  const rows = await query<{ id: number; file_path: string; file_hash: string | null; status: string }>(
    `SELECT id, file_path, file_hash, status FROM sync_job_profiles WHERE file_path = ANY($1::text[])`,
    [paths],
  );
  for (const row of rows) {
    out.set(row.file_path, { id: row.id, fileHash: row.file_hash, status: row.status });
  }
  return out;
}

/**
 * Mark files as waiting for extraction.
 *
 * One statement for new and existing files alike: a file nobody has ingested yet
 * has no row to show on the page, so it is INSERTed as 'pending' (it was never
 * part of the completed corpus, so nothing can regress); a file being re-read
 * keeps its status and its extracted data untouched and only gains `queued_at`.
 */
async function enqueueForExtraction(
  files: { name: string; fullPath: string; sourceFolder: string; hash: string }[],
): Promise<void> {
  if (files.length === 0) return;
  await execute(
    `INSERT INTO sync_job_profiles (file_name, file_path, source_folder, file_hash, status, queued_at)
     SELECT fn, fp, sf, fh, 'pending', NOW()
       FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[]) AS t(fn, fp, sf, fh)
     ON CONFLICT (file_path) DO UPDATE SET queued_at = NOW()`,
    [
      files.map((f) => f.name),
      files.map((f) => f.fullPath),
      files.map((f) => f.sourceFolder),
      files.map((f) => f.hash),
    ],
  );
}

/** Drop files out of the queue without touching their extracted content. */
async function dequeue(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await execute(
    `UPDATE sync_job_profiles SET queued_at = NULL
      WHERE file_path = ANY($1::text[]) AND queued_at IS NOT NULL`,
    [paths],
  );
}

/** Self-healing reset: a run killed mid-extraction leaves rows queued forever. */
async function clearEntireQueue(): Promise<void> {
  await execute(`UPDATE sync_job_profiles SET queued_at = NULL WHERE queued_at IS NOT NULL`);
}

// ── Main sync function ───────────────────────────────────────

/**
 * Every PDF found under the base folder (at the root or in any subfolder) is
 * ingested. The containing folder name is recorded as `source_folder` (display
 * metadata only). Tenant ownership, when there is any to apply, comes from an
 * upload's `.tenants.json` sidecar — see applyPendingTenantSidecar().
 *
 * @param _tenantSlugs Ignored. Kept so existing callers (runFullSync, the HTTP
 *   route) keep compiling. Ingestion is deliberately unfiltered: restricting the
 *   SCAN by tenant would leave the other tenants' PDFs permanently unread, and
 *   ownership isn't a property of the scan anyway — it's assigned directly, per
 *   document, independently of when or whether it gets (re)ingested.
 */
export async function syncJobProfiles(
  _tenantSlugs: string[] | null = null,
  options: { force?: boolean; uploadsOnly?: boolean } = {},
): Promise<SyncResult> {
  // uploadsOnly: triggered from the Sinkronisasi page right after an upload, so
  // the shared folder is ignored entirely — see kamus-sync for the rationale.
  const uploadsOnly = options.uploadsOnly === true;
  const basePath = uploadsOnly ? null : config.localPdfFolder;
  const uploadBase = uploadPath(UPLOAD_SUBDIR.jobProfiles);
  // No hard failure when LOCAL_PDF_FOLDER is unset: uploaded PDFs alone are a
  // valid source, which is what the upload store exists for.
  if (!basePath && listSubfolders(uploadBase).length === 0 && !hasPdfsDirectlyIn(uploadBase)) {
    return {
      success: false,
      message: uploadsOnly
        ? "Belum ada job profile yang diunggah"
        : "LOCAL_PDF_FOLDER belum diatur dan belum ada job profile yang diunggah",
      synced: 0,
      total: 0,
    };
  }

  const force = options.force === true;
  const filterDesc = force ? " [force reprocess]" : "";

  let totalFiles = 0;
  let syncedFiles = 0;
  // Uploaded PDFs that were ingested successfully; deleted once the run ends so
  // the upload store stays a hand-off buffer rather than a growing library.
  const consumedUploads: string[] = [];
  // Best-effort: an unreachable share must not stop uploaded PDFs from syncing.
  const disconnectShare = basePath
    ? await ensureNetworkShareAccess(basePath).catch(() => null)
    : null;

  try {
    let shareBase: string | null = null;
    if (basePath) {
      try {
        assertPathAccessible(basePath, "LOCAL_PDF_FOLDER");
        shareBase = basePath;
      } catch (err) {
        // Informational, not a warning — see kamus-sync for the rationale.
        console.log(`[JOB-PROFILE] Folder bersama tidak tersedia — memakai berkas unggahan saja`);
      }
    }

    // Scan the base folder itself PLUS every subfolder. "" represents the base
    // folder so root-level PDFs are picked up too — the old code only ever looked
    // one level down and silently ignored them.
    const scanDirs = Array.from(
      new Set(["", ...listSubfolders(shareBase), ...listSubfolders(uploadBase)]),
    );

    console.log(
      `[JOB-PROFILE] Scanning ${scanDirs.length} folder(s) ` +
        `[share=${shareBase ?? "-"} upload=${uploadBase}]${filterDesc}`,
    );

    // Guard against scanning the same path twice (a folder reachable from both
    // roots), keyed on the resolved path.
    const seenPaths = new Set<string>();
    // Byte-identical PDFs in different folders are REPORTED, not skipped.
    //
    // Skipping them looked tempting (one document = one profile), but which copy
    // survives would depend on folder iteration order — alphabetically ERRO sorts
    // before MULIA, so a stray copy would silently replace the original and the
    // catalog would show the wrong file name. Losing a file is far worse than
    // listing it twice, and file_path is the table's unique key, so ingesting
    // both is the behaviour the schema already implies.
    const contentPaths = new Map<string, string[]>(); // content hash -> all paths

    // Loaded ONCE for the whole run, not per file: it is a ~90-row table read
    // only to classify names, and a per-file query would multiply it by the
    // corpus for an answer that cannot change mid-run. Degrades to an empty set,
    // which makes the dictionary rule abstain rather than failing the sync.
    const kamusKeys = await loadKamusNameKeys();
    console.log(`[JOB-PROFILE] Kamus teknis: ${kamusKeys.size} nama untuk klasifikasi kompetensi`);

    // ── Phase 1: PLAN ──────────────────────────────────────────
    //
    // Scan and hash EVERY file before extracting any of them, so the backlog can
    // be written down. The old shape interleaved the two, and that is exactly why
    // the page could only ever show one file in progress: a file that had not
    // been reached yet had no row at all (first ingest) or still carried its
    // previous `completed` row, so the queue existed nowhere but in this loop's
    // cursor.
    //
    // Planning costs what scanning already cost — the old loop read and hashed
    // every file too, including the ones it went on to skip. The buffer is
    // deliberately NOT carried into phase 2: holding a few hundred PDFs in memory
    // to save one re-read is a bad trade against a path whose very next step is
    // PDF→PNG plus a multi-page vision call.
    type PlannedFile = {
      name: string;
      fullPath: string;
      sourceFolder: string;
      source: "share" | "upload";
      hash: string;
      /** Whether this run will actually (re)extract it. */
      needsWork: boolean;
    };
    const planned: PlannedFile[] = [];

    for (const dir of scanDirs) {
      // Uploaded file wins when the same PDF name exists in both places.
      const found = mergePdfSources(
        shareBase ? (dir ? join(shareBase, dir) : shareBase) : null,
        dir ? join(uploadBase, dir) : uploadBase,
      );
      const pdfFiles = found.filter((f) => {
        if (seenPaths.has(f.fullPath)) return false;
        seenPaths.add(f.fullPath);
        return true;
      });

      if (pdfFiles.length === 0) continue;

      totalFiles += pdfFiles.length;
      const uploadedCount = pdfFiles.filter((f) => f.source === "upload").length;
      console.log(
        `[JOB-PROFILE]   ${dir || "(root)"}: ${pdfFiles.length} PDF(s) (${uploadedCount} dari unggahan)`,
      );

      for (const file of pdfFiles) {
        try {
          // Hashing up front is also what lets a cross-folder duplicate be
          // reported BEFORE the expensive PDF→PNG→LLM path.
          const hash = sha256(readFileSync(file.fullPath));
          contentPaths.set(hash, [...(contentPaths.get(hash) ?? []), file.fullPath]);
          planned.push({
            name: file.name,
            fullPath: file.fullPath,
            // The folder name is stored as source_folder — display metadata
            // only, never a tenant scope (see the file header).
            sourceFolder: dir || "general",
            source: file.source,
            hash,
            needsWork: false,
          });
        } catch (readErr) {
          console.error(`[JOB-PROFILE]   ✗ ${file.name}: ${(readErr as Error).message}`);
        }
      }
    }

    // One query for the whole corpus instead of one per file — this is the same
    // lookup processOneFile does, hoisted so the skip decision can be made for
    // every file before any of them is extracted.
    const existingRows = await loadExistingProfiles(planned.map((f) => f.fullPath));
    for (const file of planned) {
      const row = existingRows.get(file.fullPath);
      // An upload forces reprocessing only on the run the UPLOAD ITSELF
      // triggered (`uploadsOnly`). Picking a file and pressing upload is an
      // explicit instruction, so the unchanged-hash shortcut must not swallow
      // it — but now that job profile uploads are KEPT rather than deleted,
      // forcing on every run would re-run the vision model over the entire
      // upload store on every Monday cron, for files nobody touched. Outside
      // that run an upload is just a file, hash-skipped like any other;
      // re-reading one on purpose is `reextractJobProfile`.
      const forced = force || (uploadsOnly && file.source === "upload");
      file.needsWork =
        forced || !row || row.fileHash !== file.hash || row.status !== "completed";
    }

    const queue = planned.filter((f) => f.needsWork);
    const skipped = planned.filter((f) => !f.needsWork);
    // A full run re-plans every file that exists, so it can safely reset the
    // whole queue — that is what clears a phantom backlog left by a run that was
    // killed mid-extraction. An uploadsOnly run only sees its own files, so it
    // clears per file instead of wiping a concurrent full run's queue.
    if (!uploadsOnly) await clearEntireQueue();
    await enqueueForExtraction(queue);
    await dequeue(skipped.map((f) => f.fullPath));

    // Skipped files are already accounted for: they reached a terminal state on
    // an earlier run and this one has nothing to do for them. Counting them here
    // keeps `synced` meaning what it meant before the loop was split.
    syncedFiles += skipped.length;
    console.log(
      `[JOB-PROFILE] Antrean: ${queue.length} berkas perlu diekstrak, ` +
        `${skipped.length} dilewati (tidak berubah)`,
    );

    // ── Phase 2: EXTRACT ───────────────────────────────────────
    //
    // The queue is in the database now, so the remaining count is readable from
    // any page load rather than being inferred from whichever single row happens
    // to say 'processing'.
    for (const file of queue) {
      try {
        const jobProfileId = await processOneFile(
          file.name,
          file.fullPath,
          file.sourceFolder,
          force || (uploadsOnly && file.source === "upload"),
          { hash: file.hash },
          kamusKeys,
        );
        // Only an upload can carry a tenant sidecar (the shared-folder scan has
        // no upload-time moment to choose one), so this is a no-op for every
        // other file.
        if (file.source === "upload" && jobProfileId != null) {
          await applyPendingTenantSidecar(file.fullPath, jobProfileId);
        }
        syncedFiles++;
        // Job profile uploads are KEPT, unlike the other upload kinds.
        //
        // The PDF is the only copy of the document that exists — `raw_text` is a
        // placeholder, not the extracted text, and the bytes are stored nowhere
        // else. Deleting it made a bad extraction permanent: the one action that
        // can fix it is re-reading the file, and the file was gone. HAV/MCU/kamus
        // uploads are still consumed, because those are bulk data files whose
        // content lands in tables that can simply be re-uploaded, not
        // per-document sources somebody re-reads one at a time.
        //
        // `consumedUploads` is left in place and deliberately empty: the discard
        // call below still runs and still reports, so turning this back on is a
        // one-line change rather than a re-plumbing.
      } catch (fileErr) {
        console.error(`[JOB-PROFILE]   ✗ ${file.name}: ${(fileErr as Error).message}`);
        // The row's own queued_at was cleared by processOneFile's failure path;
        // a throw from anywhere else leaves it queued, which is honest — that
        // file genuinely was not extracted.
      }
    }

    // Surface identical content across folders so it can be cleaned up at source.
    // Each copy still becomes its own profile, which means its own embedding —
    // duplicate points nudge the job-family clustering, so it is worth knowing.
    const duplicateGroups = Array.from(contentPaths.values()).filter((paths) => paths.length > 1);
    const duplicateCopies = duplicateGroups.reduce((n, paths) => n + paths.length - 1, 0);
    for (const paths of duplicateGroups) {
      console.warn(`[JOB-PROFILE] Isi identik di ${paths.length} lokasi: ${paths.join(" | ")}`);
    }

    const discarded = discardUploaded(consumedUploads);

    return {
      success: true,
      message:
        `Job profiles synced` +
        (duplicateCopies > 0
          ? `, ${duplicateCopies} file berisi duplikat antar folder (tetap diproses — cek log)`
          : '') +
        discardSummary(discarded) +
        filterDesc,
      synced: syncedFiles,
      total: totalFiles,
    };
  } catch (err) {
    console.error("[JOB-PROFILE] Sync failed:", err);
    return {
      success: false,
      message: String(err),
      synced: syncedFiles,
      total: totalFiles,
    };
  } finally {
    // Null when there is no share to release (uploads-only run).
    if (disconnectShare) await disconnectShare().catch(() => {});
  }
}

/**
 * Re-run the extraction for ONE job profile that a human judged wrong.
 *
 * The scheduled sync skips a file whose hash and status are unchanged, which is
 * right — re-reading 280 PDFs through a vision model to fix one is absurd. But
 * it left no way to say "this particular profile was read badly, try again",
 * and `--force` is all-or-nothing. This is that missing verb.
 *
 * It re-reads the PDF FROM DISK, so it picks up the current extraction prompt
 * and the current reconciliation rules. The row is updated in place (upsert by
 * `file_path`), so `sync_job_profiles.id` survives and every downstream link —
 * `job_profile_tenants`, the embeddings, the job-family matches — stays intact.
 *
 * The one thing it cannot do is conjure a PDF that is no longer on disk. Job
 * profile uploads USED to be deleted after processing, so a profile ingested
 * that way before the change has nothing left to re-read: `raw_text` is a
 * placeholder, not the document text, and the bytes were never stored. That
 * case returns a specific message telling the operator to upload the file
 * again, rather than a generic failure.
 */
/**
 * Re-read every job profile whose last extraction FAILED.
 *
 * Returns as soon as the rows are queued rather than waiting out the batch: each
 * file is a multi-page vision call, so a caller that awaited the whole thing
 * would sit on an HTTP request for minutes and time out somewhere in the middle
 * with the work still running. The queue (`queued_at`) is what makes that safe —
 * the Job Profiles page reads the backlog straight from the database and watches
 * it drain, so "started" does not have to mean "finished" to be visible.
 */
/** One batch at a time; a second trigger must not double-process the same rows. */
let batchInFlight = false;

type BatchRow = {
  id: number;
  file_name: string;
  file_path: string;
  source_folder: string | null;
  file_hash: string | null;
};

export type JobProfileBatchResult = {
  queued: number;
  missing: number;
  message: string;
  alreadyRunning?: boolean;
};

/**
 * Enqueue a set of rows and extract them in the BACKGROUND.
 *
 * Shared by the manual "Coba Lagi Semua" and the boot-time resume, because they
 * differ only in which rows they select — two copies would drift into one of
 * them forgetting to dequeue on failure and leaving a permanent phantom backlog.
 *
 * Returns as soon as the rows are queued. Each file is a multi-page vision call,
 * so awaiting the batch would hold an HTTP request (or the process's startup)
 * open for tens of minutes. The queue is what makes that safe: the Job Profiles
 * page reads the backlog from the database and watches it drain.
 */
async function runJobProfileBatch(rows: BatchRow[], label: string): Promise<JobProfileBatchResult> {
  if (batchInFlight) {
    return {
      queued: 0,
      missing: 0,
      alreadyRunning: true,
      message: "Pemrosesan job profile sedang berjalan. Tunggu sampai antrean habis.",
    };
  }
  if (rows.length === 0) return { queued: 0, missing: 0, message: "Tidak ada job profile yang perlu diproses." };

  // A row whose PDF is gone can never succeed, so it is answered now instead of
  // being queued to fail again — and it is told apart from a retryable failure,
  // because the fix is a re-upload, not another attempt.
  //
  // One stat per row, not two: splitting with two `filter(existsSync)` passes
  // would also let a file vanish between them and land in neither list.
  const present: BatchRow[] = [];
  const missing: BatchRow[] = [];
  for (const row of rows) (existsSync(row.file_path) ? present : missing).push(row);
  for (const row of missing) {
    await execute(
      `UPDATE sync_job_profiles SET status = 'failed', error_message = $1, queued_at = NULL WHERE id = $2`,
      [
        `Berkas PDF tidak ditemukan di server (${row.file_path}). ` +
          `Unggah ulang dokumennya — teks hasil ekstraksi tidak menyimpan isi PDF.`,
        row.id,
      ],
    );
  }

  if (present.length === 0) {
    return {
      queued: 0,
      missing: missing.length,
      message: `${missing.length} job profile menunggu, tetapi berkas PDF-nya tidak ada lagi di server. Unggah ulang dokumennya.`,
    };
  }

  await enqueueForExtraction(
    present.map((r) => ({
      name: r.file_name,
      fullPath: r.file_path,
      sourceFolder: r.source_folder ?? "general",
      // Every one of these rows was SELECTed from the table, so the upsert can
      // only take its ON CONFLICT branch and never writes this. Passing the real
      // hash anyway, so the call stays correct if that ever stops being true.
      hash: r.file_hash ?? "",
    })),
  );

  batchInFlight = true;
  console.log(`[JOB-PROFILE] ${label}: ${present.length} berkas mulai diproses di latar belakang`);
  // Deliberately not awaited — see the docblock. Every failure inside is written
  // to the row by processOneFile, so nothing is lost by not observing it here.
  void (async () => {
    try {
      const kamusKeys = await loadKamusNameKeys();
      let done = 0;
      for (const row of present) {
        try {
          const jobProfileId = await processOneFile(
            row.file_name,
            row.file_path,
            row.source_folder ?? "general",
            true,
            undefined,
            kamusKeys,
          );
          // MUST mirror syncJobProfiles. Leaving this out is what silently
          // un-scoped every file this path ingested: the upload's tenant choice
          // lives in a `<path>.tenants.json` sidecar and is applied HERE, so a
          // document extracted through the batch came out owned by nobody and
          // therefore visible to every business unit.
          if (jobProfileId != null) {
            await applyPendingTenantSidecar(row.file_path, jobProfileId);
          }
        } catch (err) {
          console.error(`[JOB-PROFILE]   ✗ ${label} ${row.file_name}: ${(err as Error).message}`);
        }
        done++;
      }
      console.log(`[JOB-PROFILE] ${label}: selesai (${done}/${present.length})`);
    } catch (err) {
      console.error(`[JOB-PROFILE] ${label} gagal: ${(err as Error).message}`);
    } finally {
      // Whatever happened, nothing is queued by THIS batch any more: a row left
      // queued after its processing threw would show as a permanent backlog.
      await dequeue(present.map((r) => r.file_path)).catch(() => {});
      batchInFlight = false;
    }
  })();

  return {
    queued: present.length,
    missing: missing.length,
    message:
      `${present.length} job profile masuk antrean` +
      (missing.length > 0 ? `, ${missing.length} dilewati karena berkas PDF-nya hilang` : "") +
      ". Prosesnya berjalan di latar belakang — halaman ini akan memperbarui sendiri.",
  };
}

/**
 * Re-read every job profile whose last extraction FAILED.
 */
export async function retryFailedJobProfiles(): Promise<JobProfileBatchResult> {
  const rows = await query<BatchRow>(
    `SELECT id, file_name, file_path, source_folder, file_hash
       FROM sync_job_profiles WHERE status = 'failed' ORDER BY id`,
  );
  if (rows.length === 0) {
    return { queued: 0, missing: 0, message: "Tidak ada job profile berstatus gagal." };
  }
  return runJobProfileBatch(rows, "coba-lagi-gagal");
}

/**
 * Pick the interrupted queue back up. Called once at startup.
 *
 * Nothing did this before, and that was the whole bug: the queue is durable in
 * the database, but `syncJobProfiles` only ever runs from the cron, the CLI or
 * an HTTP call — so killing the service mid-extraction left every remaining file
 * queued forever, and restarting it did nothing. scoring-service has had the
 * equivalent (`resumeInterruptedSessions` plus an orphan sweeper) all along;
 * this side simply never grew one.
 *
 * `status = 'processing'` is included even without a queue mark: at boot no
 * extraction can be in flight by definition, so such a row is a corpse from the
 * killed run, not work somebody else is doing.
 */
export async function resumeQueuedJobProfiles(): Promise<JobProfileBatchResult> {
  const rows = await query<BatchRow>(
    `SELECT id, file_name, file_path, source_folder, file_hash
       FROM sync_job_profiles
      WHERE queued_at IS NOT NULL OR status = 'processing'
      ORDER BY id`,
  );
  if (rows.length === 0) {
    return { queued: 0, missing: 0, message: "Antrean job profile kosong." };
  }
  return runJobProfileBatch(rows, "lanjut-antrean");
}

/**
 * Apply tenant sidecars that were never consumed.
 *
 * Recovery for documents ingested through a path that forgot to call
 * `applyPendingTenantSidecar` — they came out owned by nobody and so visible to
 * every business unit, which is a DISCLOSURE, not a cosmetic gap.
 *
 * Costs nothing to run: the sidecar is a small JSON file beside the PDF and the
 * work is one INSERT per tenant, so nothing is re-extracted. `takeTenantSidecar`
 * deletes the file only when it successfully reads it, which is precisely why
 * the mapping is still recoverable — the broken path never read them.
 *
 * Safe to run repeatedly and on every boot: a document with no sidecar (every
 * shared-folder scan, and anything already applied) is a no-op.
 */
export async function applyOrphanedTenantSidecars(): Promise<{
  scanned: number;
  recovered: number;
}> {
  const rows = await query<{ id: number; file_path: string }>(
    `SELECT p.id, p.file_path
       FROM sync_job_profiles p
       LEFT JOIN (SELECT DISTINCT job_profile_id FROM job_profile_tenants) t
         ON t.job_profile_id = p.id
      WHERE t.job_profile_id IS NULL
      ORDER BY p.id`,
  );

  let recovered = 0;
  for (const row of rows) {
    // Cheap pre-check so an unmapped shared-folder document costs one stat
    // rather than a read attempt.
    if (!existsSync(`${row.file_path}.tenants.json`)) continue;
    await applyPendingTenantSidecar(row.file_path, row.id);
    recovered++;
  }
  if (recovered > 0) {
    console.log(
      `[JOB-PROFILE] Pemetaan tenant dipulihkan untuk ${recovered} dokumen dari sidecar unggahan`,
    );
  }
  return { scanned: rows.length, recovered };
}

export async function reextractJobProfile(
  profileId: number,
): Promise<{ success: boolean; message: string; fileName?: string; missingFile?: boolean }> {
  const rows = await query<{
    id: number;
    file_name: string;
    file_path: string;
    source_folder: string | null;
  }>(
    `SELECT id, file_name, file_path, source_folder
       FROM sync_job_profiles WHERE id = $1`,
    [profileId],
  );
  if (rows.length === 0) {
    return { success: false, message: `Job profile #${profileId} tidak ditemukan.` };
  }
  const { file_name: fileName, file_path: filePath, source_folder: sourceFolder } = rows[0]!;

  if (!existsSync(filePath)) {
    return {
      success: false,
      missingFile: true,
      fileName,
      message:
        `Berkas PDF "${fileName}" sudah tidak ada di server, sehingga tidak bisa dibaca ulang. ` +
        `Unggah kembali berkasnya lewat halaman Sinkronisasi — dokumen inilah satu-satunya ` +
        `sumbernya; teks hasil ekstraksi sebelumnya tidak menyimpan isi PDF.`,
    };
  }

  // Loaded per call rather than cached: a re-read is a rare, deliberate action,
  // and reading ~90 rows costs nothing next to the vision-model call that follows.
  const kamusKeys = await loadKamusNameKeys();

  try {
    await processOneFile(fileName, filePath, sourceFolder ?? "general", true, undefined, kamusKeys);
    return { success: true, fileName, message: `"${fileName}" berhasil dibaca ulang.` };
  } catch (err) {
    // processOneFile already wrote status='failed' + error_message on the row,
    // so the detail page shows the reason; this is just the caller's copy.
    return {
      success: false,
      fileName,
      message: `Gagal membaca ulang "${fileName}": ${(err as Error).message}`,
    };
  }
}

// ── Per-file processing ──────────────────────────────────────

/**
 * Returns the resulting sync_job_profiles.id on success (whether newly
 * processed or skipped-unchanged), so the caller can apply an upload's tenant
 * sidecar to it. Throws (no id) on extraction failure, exactly as before.
 */
async function processOneFile(
  fileName: string,
  filePath: string,
  sourceFolder: string,
  force = false,
  /**
   * Hash already computed by the planning phase, and optionally the buffer.
   * The scan no longer carries buffers forward (a few hundred PDFs in memory to
   * save a re-read is a bad trade against PDF→PNG plus a vision call), so this
   * normally supplies the hash alone.
   */
  precomputed?: { buffer?: Buffer; hash: string },
  /**
   * Normalized technical-competency names from the kamus, loaded ONCE per sync
   * run by the caller. An empty set is a valid input — it only means the
   * dictionary rule abstains — so this stays optional and never blocks a file.
   */
  kamusKeys: Set<string> = new Set()
): Promise<number> {
  // 1 — Check if already synced & unchanged
  const existing = await query<{ id: number; file_hash: string; status: string }>(
    `SELECT id, file_hash, status FROM sync_job_profiles WHERE file_path = $1`,
    [filePath]
  );

  // 2 — Read file (reuse the caller's read when available)
  const buffer = precomputed?.buffer ?? readFileSync(filePath);
  const hash = precomputed?.hash ?? sha256(buffer);

  // `force` re-runs the LLM extraction even for unchanged completed files
  // (e.g. after an extraction-prompt change). The row is UPDATED in place
  // (upsert by file_path) — nothing is deleted, ids/links stay intact.
  if (
    !force &&
    existing.length > 0 &&
    existing[0].file_hash === hash &&
    existing[0].status === "completed"
  ) {
    console.log(`[JOB-PROFILE]   ✓ ${fileName} (unchanged, skipped)`);
    return existing[0].id;
  }
  if (force && existing.length > 0) {
    console.log(`[JOB-PROFILE]   ↻ ${fileName} (force reprocess)`);
  }

  // 3 — Convert PDF to images in a temporary folder
  const tempDir = mkdtempSync(join(tmpdir(), "pdf-to-img-"));
  const tempPdfPath = join(tempDir, "document.pdf");
  
  // Write the PDF to the temp folder
  writeFileSync(tempPdfPath, buffer);

  const images: string[] = [];
  try {
    // Convert PDF to PNG images (platform-aware: pdf-poppler on macOS/Win, pdftoppm on Linux)
    await convertPdfToImages(tempPdfPath, tempDir, "page");

    // Read and sort the resulting PNG files numerically
    const pngFiles = readdirSync(tempDir)
      .filter((f) => f.endsWith(".png"))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(b.match(/\d+/)?.[0] || "0", 10);
        return numA - numB;
      });

    if (pngFiles.length === 0) {
      throw new Error("PDF-to-image conversion produced no PNG files");
    }

    for (const pngFile of pngFiles) {
      const imgBuffer = readFileSync(join(tempDir, pngFile));
      images.push(imgBuffer.toString("base64"));
    }
  } finally {
    // Clean up temporary files
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn(`[JOB-PROFILE] Warning: failed to clean up temp dir ${tempDir}:`, cleanupErr);
    }
  }

  // 4 — Upsert with status = 'processing'
  const [{ id }] = await query<{ id: number }>(
    `INSERT INTO sync_job_profiles
       (file_name, file_path, source_folder, file_hash, raw_text, status, synced_at)
     VALUES ($1, $2, $3, $4, 'Processed via vision LLM (Poppler)', 'processing', NOW())
     ON CONFLICT (file_path) DO UPDATE SET
       file_name = EXCLUDED.file_name,
       file_hash = EXCLUDED.file_hash,
       raw_text  = EXCLUDED.raw_text,
       status    = 'processing',
       error_message = NULL,
       synced_at = NOW()
     RETURNING id`,
    [fileName, filePath, sourceFolder, hash]
  );

  // 5 — LLM extraction (retried; see extractWithRetries)
  try {
    const { extracted } = await extractWithRetries(images, fileName);

    // The model has just guessed at a table layout that varies between
    // documents; this decides the behavioral/technical split from the document's
    // own guarantees instead. Nothing is invented — an unclassifiable entry
    // stays where it was put and an unreadable level stays null.
    const reconciled = reconcileCompetencies(
      extracted.behavioralCompetencies,
      extracted.technicalCompetencies,
      kamusKeys
    );
    extracted.behavioralCompetencies = reconciled.behavioral;
    extracted.technicalCompetencies = reconciled.technical;
    // Persisted alongside the data so a bad read is auditable later. Reading
    // this in the UI is what turns "the extraction is broken sometimes" into a
    // named list of files and competencies.
    (extracted as Record<string, unknown>).competencyWarnings = reconciled.warnings;

    const warnSummary = summarizeWarnings(reconciled.warnings);
    if (warnSummary) {
      console.warn(`[JOB-PROFILE]   ⚠ ${fileName}: competency ${warnSummary}`);
    }

    await execute(
      `UPDATE sync_job_profiles SET
         job_profile_number  = $1,
         position_name       = $2,
         division_department = $3,
         supervisor          = $4,
         job_purpose         = $5,
         extracted_data      = $6,
         status              = 'completed',
         error_message       = NULL,
         processed_at        = NOW(),
         -- Terminal: out of the queue. Set here rather than alongside
         -- status='processing' above, because the file being extracted right now
         -- is still part of the backlog a reader is counting.
         queued_at           = NULL
       WHERE file_path = $7`,
      [
        extracted.documentInfo.documentNumber,
        extracted.jobIdentity.positionName,
        extracted.jobIdentity.divisionDepartment,
        extracted.jobIdentity.directSupervisor,
        extracted.jobPurpose,
        JSON.stringify(extracted),
        filePath,
      ]
    );
    console.log(`[JOB-PROFILE]   ✓ ${fileName}`);
    return id;
  } catch (llmErr) {
    console.error(`[JOB-PROFILE]   ✗ LLM failed for ${fileName}:`, (llmErr as Error).message);
    await execute(
      `UPDATE sync_job_profiles SET status = 'failed', error_message = $1, queued_at = NULL
        WHERE file_path = $2`,
      [String(llmErr), filePath]
    );
    throw llmErr;
  }
}
