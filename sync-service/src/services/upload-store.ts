import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { extname, isAbsolute, join, resolve, sep } from "node:path";
import { config } from "../config.js";

/**
 * Local store for files uploaded through the Sinkronisasi page.
 *
 * Uploading exists precisely for the case where the shared folder is NOT
 * reachable (unmapped drive, missing credentials, LOCAL_*_FOLDER unset), so
 * nothing in here may touch a UNC path or require share access. Layout mirrors
 * what each sync expects to find:
 *
 *   <uploadRoot>/hav/HAV.xlsx
 *   <uploadRoot>/mcu/MCU.xlsx
 *   <uploadRoot>/kamus-kompetensi/*.pdf
 *   <uploadRoot>/job-profiles/<tenantSlug>/*.pdf
 *
 * When a file exists in BOTH the upload store and the shared folder, the
 * uploaded copy wins — it is the deliberate, explicitly-placed one.
 */
export function uploadRoot(): string {
  const configured = config.uploadFolder || "uploads";
  // resolve() also NORMALISES an absolute path: "C:/x/uploads" from .env would
  // otherwise never prefix-match the backslashed paths resolve() produces in
  // discardUploaded, so every processed upload was reported "gagal dihapus"
  // and left on disk.
  return isAbsolute(configured) ? resolve(configured) : resolve(process.cwd(), configured);
}

export const UPLOAD_SUBDIR = {
  hav: "hav",
  mcu: "mcu",
  kamus: "kamus-kompetensi",
  jobProfiles: "job-profiles",
} as const;

/** Absolute path inside the upload store. */
export function uploadPath(...segments: string[]): string {
  return join(uploadRoot(), ...segments);
}

/** The uploaded HAV/MCU workbook, or null when nothing has been uploaded. */
export function uploadedWorkbook(kind: "hav" | "mcu"): string | null {
  const file = uploadPath(UPLOAD_SUBDIR[kind], kind === "hav" ? "HAV.xlsx" : "MCU.xlsx");
  return existsSync(file) ? file : null;
}

export type PdfEntry = { name: string; fullPath: string; source: "upload" | "share" };

function listPdfs(folder: string, source: PdfEntry["source"]): PdfEntry[] {
  try {
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter((f) => {
        if (extname(f).toLowerCase() !== ".pdf") return false;
        try {
          return statSync(join(folder, f)).isFile();
        } catch {
          return false;
        }
      })
      .map((name) => ({ name, fullPath: join(folder, name), source }));
  } catch {
    // Unreachable share must not abort the sync — the upload store may still
    // have everything needed.
    return [];
  }
}

/**
 * Merge PDFs from the shared folder and the upload store, uploaded copy winning
 * on a same-name collision. `shareFolder` may be null/unreachable.
 */
export function mergePdfSources(shareFolder: string | null, uploadFolder: string): PdfEntry[] {
  const byName = new Map<string, PdfEntry>();
  for (const entry of listPdfs(shareFolder ?? "", "share")) byName.set(entry.name.toLowerCase(), entry);
  for (const entry of listPdfs(uploadFolder, "upload")) byName.set(entry.name.toLowerCase(), entry);
  return Array.from(byName.values());
}

/** True when the folder itself holds at least one PDF (not counting subfolders). */
export function hasPdfsDirectlyIn(folder: string | null): boolean {
  if (!folder) return false;
  return listPdfs(folder, "upload").length > 0;
}

/**
 * Delete files that came from the upload store once their sync has ingested
 * them. Uploading is now the ONLY way to feed the file-based syncs, so the
 * store is a hand-off buffer rather than a library: leaving files behind would
 * make every later run re-scan (and, with `force`, re-extract) documents whose
 * content is already in Postgres, and would grow the container's disk without
 * bound.
 *
 * Only ever called with paths the caller tagged `source: "upload"`, so a file
 * on the shared folder can never be removed by a sync.
 *
 * Best-effort by design: a failed delete is reported but must not fail a sync
 * whose data is already committed.
 */
export function discardUploaded(paths: string[]): { removed: number; failed: string[] } {
  const root = uploadRoot();
  let removed = 0;
  const failed: string[] = [];
  for (const p of paths) {
    // Defence in depth: never delete outside the upload store, whatever the
    // caller passed in.
    const abs = resolve(p);
    if (abs !== root && !abs.startsWith(root + sep)) {
      failed.push(p);
      continue;
    }
    try {
      rmSync(abs, { force: true });
      removed++;
    } catch (err) {
      console.warn(`[UPLOAD-STORE] Gagal menghapus ${abs}: ${String(err)}`);
      failed.push(p);
    }
  }
  if (removed > 0) console.log(`[UPLOAD-STORE] ${removed} file unggahan dihapus setelah diproses`);
  return { removed, failed };
}

/** Human-readable suffix appended to a sync message, or "" when nothing was removed. */
export function discardSummary(result: { removed: number; failed: string[] }): string {
  if (result.removed === 0 && result.failed.length === 0) return "";
  const parts: string[] = [];
  if (result.removed > 0) parts.push(`${result.removed} file unggahan dihapus setelah diproses`);
  if (result.failed.length > 0) parts.push(`${result.failed.length} gagal dihapus`);
  return `, ${parts.join(", ")}`;
}

/** Directory names directly under a folder; [] when it is missing/unreachable. */
export function listSubfolders(folder: string | null): string[] {
  if (!folder) return [];
  try {
    if (!existsSync(folder)) return [];
    return readdirSync(folder).filter((entry) => {
      try {
        return statSync(join(folder, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}
