import { Router, type Request, type Response } from "express";
import express from "express";
import { mkdir, rename, writeFile, unlink } from "node:fs/promises";
import { extname, join } from "node:path";
import { read as xlsxRead } from "xlsx";
import { UPLOAD_SUBDIR, uploadPath, uploadRoot } from "../services/upload-store.js";
import { excelSpecByKey } from "../services/excel-sources.js";
import { buildTemplateWorkbook, templateFileName } from "../services/excel-template.js";

/**
 * Upload the source files the file-based syncs read, so they can be replaced
 * from the Sinkronisasi page instead of requiring someone to drop them onto the
 * shared folder by hand.
 *
 * Transport is a RAW body rather than multipart/form-data: it needs no extra
 * dependency (express.raw ships with Express), survives the Next.js proxy
 * unchanged (it forwards req.blob()), and the client can post a File directly.
 * The original filename travels in ?filename= because a raw body carries none.
 */
export const uploadRouter = Router() as ReturnType<typeof Router>;

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024; // 40 MB

/**
 * The four original kinds, which each have a bespoke sync reading a bespoke
 * layout. Everything else is driven by the declarative registry in
 * excel-sources.ts — see isExcelKind() below.
 */
const LEGACY_KINDS = ["hav", "mcu", "kamus", "job-profiles"] as const;
type LegacyKind = (typeof LEGACY_KINDS)[number];
type UploadKind = LegacyKind | string;

const isLegacy = (kind: string): kind is LegacyKind =>
  (LEGACY_KINDS as readonly string[]).includes(kind);

const isKnownKind = (kind: string): boolean => isLegacy(kind) || excelSpecByKey(kind) !== null;

/**
 * Kinds whose payload is a workbook. Getting this wrong is silent rather than
 * loud: validateBytes' PDF check is the fall-through branch, so a new Excel kind
 * omitted here would be rejected with "File bukan PDF yang valid".
 */
const isExcelKind = (kind: string): boolean =>
  kind === "hav" || kind === "mcu" || excelSpecByKey(kind) !== null;

const EXCEL_EXTS = new Set([".xlsx", ".xls", ".xlsm"]);


/** Leading bytes that a real Excel workbook must start with. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // .xlsx / .xlsm (OOXML = zip)
const OLE2_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // legacy .xls

/** A tenant id is a plain UUID — the web app resolves it from its hardcoded
 *  tenant list before ever sending it here. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse `?tenants=<uuid>,<uuid>`, dropping anything that isn't UUID-shaped. */
function parseTenantIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s));
}

/** Resolve the destination folder + file name for a kind of upload. */
function resolveTarget(
  kind: UploadKind,
  opts: { filename?: string },
): { folder: string; file: string } | { error: string } {
  // Everything lands in the LOCAL upload store — never the shared folder. An
  // upload is the escape hatch for when the share is unreachable, so it must not
  // require LOCAL_*_FOLDER to be configured or reachable at all.
  const pdfName = (): { name: string } | { error: string } => {
    const name = opts.filename
    if (!name) return { error: "Nama file tidak valid" };
    if (extname(name).toLowerCase() !== ".pdf") {
      return { error: "Hanya file .pdf yang diterima" };
    }
    return { name };
  };

  switch (kind) {
    // hav-sync/mcu-sync read one fixed filename, so an upload replaces it.
    case "hav":
      return { folder: uploadPath(UPLOAD_SUBDIR.hav), file: "HAV.xlsx" };
    case "mcu":
      return { folder: uploadPath(UPLOAD_SUBDIR.mcu), file: "MCU.xlsx" };
    case "kamus": {
      const r = pdfName();
      if ("error" in r) return r;
      return { folder: uploadPath(UPLOAD_SUBDIR.kamus), file: r.name };
    }
    // One flat folder — no tenant subfolder. The shared folder's single "Mulia"
    // directory was never a tenant scope; its contents describe positions
    // across every business unit. Which tenant(s) a document belongs to is
    // decided directly (an optional `?tenants=` on this same upload, applied
    // once the sync ingests the file — see the POST handler below), not by
    // where the file happens to sit on disk.
    case "job-profiles": {
      const r = pdfName();
      if ("error" in r) return r;
      return { folder: uploadPath(UPLOAD_SUBDIR.jobProfiles), file: r.name };
    }
    default: {
      // Registry-driven sources: one fixed file per source, same replace-on-
      // upload semantics as hav/mcu.
      const spec = excelSpecByKey(kind);
      if (!spec) return { error: `Jenis unggahan tidak dikenal: ${kind}` };
      return { folder: uploadPath(spec.subdir), file: spec.fileName };
    }
  }
}

/**
 * Validate the bytes actually are what they claim BEFORE overwriting anything —
 * a corrupt HAV.xlsx would otherwise silently break every later sync.
 */
function validateBytes(kind: UploadKind, buf: Buffer, fileName: string): string | null {
  if (buf.length === 0) return "File kosong";

  if (isExcelKind(kind)) {
    if (!EXCEL_EXTS.has(extname(fileName).toLowerCase())) {
      return "Hanya file Excel (.xlsx / .xls / .xlsm) yang diterima";
    }
    // Magic bytes first: xlsxRead() is lenient and happily parses arbitrary text
    // as a single-sheet workbook, so a parse check alone lets garbage through
    // and overwrites a good HAV.xlsx with something no sync can use.
    const isZip = buf.subarray(0, 4).equals(ZIP_MAGIC);
    const isOle2 = buf.subarray(0, 8).equals(OLE2_MAGIC);
    if (!isZip && !isOle2) {
      return "File bukan workbook Excel yang valid (isi file tidak dikenali)";
    }
    try {
      const wb = xlsxRead(buf, { type: "buffer" });
      if (!wb.SheetNames?.length) return "Workbook tidak memiliki sheet";
    } catch (err) {
      return `File tidak dapat dibaca sebagai Excel: ${String(err)}`;
    }
    return null;
  }

  // PDF magic bytes — cheap guard against a mis-named upload.
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return "File bukan PDF yang valid";
  }
  return null;
}

/**
 * The starter workbook for one Excel source, generated from its spec.
 *
 * GET, so the audit middleware ignores it (it only wraps POST) and downloading
 * a template does not write a bogus `sync_runs` row.
 */
uploadRouter.get("/template/:kind", (req: Request, res: Response) => {
  const kind = (req.params.kind as string | undefined) ?? "";
  const spec = excelSpecByKey(kind);
  if (!spec) {
    return res
      .status(404)
      .json({ success: false, message: `Template tidak tersedia untuk: ${kind}` });
  }

  try {
    const buf = buildTemplateWorkbook(spec);
    res.setHeader(
      "content-type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("content-disposition", `attachment; filename="${templateFileName(spec)}"`);
    // The proxy forwards response headers verbatim apart from the hop-by-hop
    // ones, so both of the above survive to the browser.
    return res.send(buf);
  } catch (err) {
    console.error(`[UPLOAD] template ${spec.key} failed:`, err);
    return res.status(500).json({ success: false, message: String(err) });
  }
});

uploadRouter.post(
  "/:kind",
  express.raw({ type: "*/*", limit: MAX_UPLOAD_BYTES }),
  async (req: Request, res: Response) => {
    const kind = req.params.kind as UploadKind;
    if (!isKnownKind(kind)) {
      return res.status(404).json({ success: false, message: `Unknown upload kind: ${kind}` });
    }

    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      return res
        .status(400)
        .json({ success: false, message: "Body harus berupa data biner file" });
    }

    const filename = typeof req.query.filename === "string" ? req.query.filename : undefined;
    // Job profiles only: which tenant(s) this document belongs to, chosen at
    // upload time. Applied once the next sync ingests the file — see
    // job-profile-sync.ts's applyPendingTenantSidecar().
    const tenantIds = kind === "job-profiles"
      ? parseTenantIds(typeof req.query.tenants === "string" ? req.query.tenants : undefined)
      : [];

    const target = resolveTarget(kind, { filename });
    if ("error" in target) {
      return res.status(400).json({ success: false, message: target.error });
    }

    // For the fixed-name kinds the stored name is fixed, so validate against the
    // UPLOADED name to catch someone sending a PDF; for PDFs the two are the same.
    const nameForCheck = isExcelKind(kind) ? (filename ?? target.file) : target.file;
    const invalid = validateBytes(kind, body, nameForCheck);
    if (invalid) {
      return res.status(400).json({ success: false, message: invalid });
    }

    const destination = join(target.folder, target.file);
    // No ensureNetworkShareAccess here, by design: the destination is a plain
    // local directory, so an upload keeps working when the share is down —
    // which is the whole reason uploading exists.
    //
    // Write to a sibling temp file then rename, so a failed/partial upload can
    // never leave the sync reading a half-written workbook.
    const tempPath = `${destination}.uploading`;

    try {
      await mkdir(target.folder, { recursive: true });
      await writeFile(tempPath, body);
      await rename(tempPath, destination);

      // Written only after the PDF itself is safely in place, so a sidecar
      // never exists without its document. job-profile-sync.ts consumes
      // (reads + deletes) this the moment it ingests the file, whenever that
      // ends up happening.
      if (tenantIds.length > 0) {
        await writeFile(`${destination}.tenants.json`, JSON.stringify({ tenantIds }));
      }

      console.log(`[UPLOAD] ${kind}: wrote ${body.length} bytes -> ${destination}`);

      return res.json({
        success: true,
        message: `${target.file} berhasil diunggah`,
        file: target.file,
        folder: target.folder,
        uploadRoot: uploadRoot(),
        bytes: body.length,
      });
    } catch (err) {
      await unlink(tempPath).catch(() => {});
      console.error(`[UPLOAD] ${kind} failed:`, err);
      return res.status(500).json({ success: false, message: String(err) });
    }
  },
);
