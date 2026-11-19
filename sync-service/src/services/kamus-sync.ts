/**
 * Kamus Kompetensi Sync — parses the "Dictionary Technical Competency for MPM"
 * PDF(s) from the `kamus-kompetensi` folder (under LOCAL_PDF_FOLDER, beside the
 * tenant job-profile folders) into structured competency records and upserts
 * them into the sync_kamus_kompetensi Postgres table.
 *
 * The PDF is an A4-landscape template. Every competency ("TC 003 — ASSET
 * QUALITY MANAGEMENT") has a header line (code + name), a description
 * paragraph, and a 4-column proficiency table:
 *   1 BASIC KNOWLEDGE | 2 INTERMEDIATE | 3 ADVANCE | 4 MASTERY
 *
 * The document is justified Word text, so words are frequently split into
 * individual glyphs and the four columns interleave in the raw text stream.
 * Instead of a naive text dump, each glyph/run is read with its (x, y)
 * position, words are rebuilt by gap detection, and text is bucketed into
 * columns by x. A competency may span multiple pages; continuation pages are
 * appended to the current record.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { config } from "../config.js";
import { execute, query } from "../db/postgres.js";
import { ensureNetworkShareAccess, assertPathAccessible } from "./network-share.js";
import {
  UPLOAD_SUBDIR,
  discardSummary,
  discardUploaded,
  mergePdfSources,
  uploadPath,
} from "./upload-store.js";
import type { SyncResult } from "../types.js";

// ── Layout constants (derived from the template) ─────────────
// Left x-boundary of each proficiency column. Anything left of COLS[0] is the
// rotated dimension-label margin and is ignored for level text.
const DEFAULT_COLS = [88, 267, 449, 632];
const LEVEL_KEYS = ["basic", "intermediate", "advance", "mastery"] as const;
const LEVEL_LABELS = ["BASIC KNOWLEDGE", "INTERMEDIATE", "ADVANCE", "MASTERY"];

// A header looks like: "TC 003 – ASSET QUALITY MANAGEMENT"
// (en-dash, em-dash, or hyphen all tolerated).
const HEADER_RE = /^TC\s*0*(\d+)\s*[–—-]\s*(.+)$/i;

type LevelKey = (typeof LEVEL_KEYS)[number];

type Token = {
  str: string;
  x: number;
  top: number;
  width: number;
  endX: number;
  charW: number;
};

type Line = { top: number; tokens: Token[] };

export type KamusRecord = {
  code: string;
  name: string;
  description: string;
  levels: Record<LevelKey, string>;
};

// ── Text geometry helpers ─────────────────────────────────────

function columnOf(x: number, cols: number[]): number {
  if (x < cols[0]!) return -1; // label margin
  for (let i = 3; i >= 1; i--) if (x >= cols[i]!) return i;
  return 0;
}

/** Collapse whitespace and drop the page footer/copyright tail. */
function cleanText(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .split(/\|\s*©/)[0]!
    .replace(/©\s*Atmos Performa[\s\S]*$/i, "")
    .trim();
}

/**
 * Turn one page's text items into positioned tokens.
 * pdfjs transform = [a, b, c, d, e, f]; e = x, f = baseline y. Converted to a
 * top-down coordinate (top = pageHeight - y) to match visual reading order.
 */
function pageTokens(textContent: any, pageHeight: number): Token[] {
  const tokens: Token[] = [];
  for (const item of textContent.items) {
    const str: string = item.str;
    if (!str || !str.trim()) continue;
    const x: number = item.transform[4];
    const y: number = item.transform[5];
    const width: number = item.width || 0;
    tokens.push({
      str,
      x,
      top: pageHeight - y,
      width,
      endX: x + width,
      // Approx per-character width — the space-insertion threshold when
      // stitching adjacent tokens back into words.
      charW: width / Math.max(str.length, 1),
    });
  }
  return tokens;
}

/** Group tokens into visual lines by their `top`, within a tolerance. */
function groupLines(tokens: Token[], tol = 3): Line[] {
  const sorted = [...tokens].sort((a, b) => a.top - b.top || a.x - b.x);
  const lines: Line[] = [];
  for (const t of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(t.top - last.top) <= tol) {
      last.tokens.push(t);
      last.top = (last.top * (last.tokens.length - 1) + t.top) / last.tokens.length;
    } else {
      lines.push({ top: t.top, tokens: [t] });
    }
  }
  for (const l of lines) l.tokens.sort((a, b) => a.x - b.x);
  return lines;
}

/** Stitch x-sorted tokens into a string, inserting spaces at word gaps. */
function stitch(tokens: Token[]): string {
  let out = "";
  let prevEnd: number | null = null;
  let prevCharW = 6;
  for (const t of tokens) {
    if (prevEnd !== null) {
      const gap = t.x - prevEnd;
      const needSpace =
        gap > Math.max(prevCharW, t.charW) * 0.4 &&
        !out.endsWith(" ") &&
        !t.str.startsWith(" ");
      if (needSpace) out += " ";
    }
    out += t.str;
    prevEnd = t.endX;
    prevCharW = t.charW || prevCharW;
  }
  return out;
}

/** Calibrate column x-boundaries from the page's own level-header row. */
function calibrateColumns(lines: Line[]): number[] {
  const centers: number[] = [];
  for (const label of LEVEL_LABELS) {
    let found: number | null = null;
    const firstWord = label.split(" ")[0]!;
    for (const line of lines) {
      for (const t of line.tokens) {
        const s = t.str.replace(/[()]/g, "").toUpperCase();
        if (s.startsWith(firstWord) && s.includes(firstWord)) {
          if (label === "BASIC KNOWLEDGE" ? s.includes("BASIC") : s.includes(label)) {
            found = t.x + t.width / 2;
          }
        }
      }
      if (found !== null) break;
    }
    if (found === null) return DEFAULT_COLS;
    centers.push(found);
  }
  const b: number[] = [];
  const gap0 = (centers[1]! - centers[0]!) / 2;
  b[0] = centers[0]! - gap0;
  b[1] = (centers[0]! + centers[1]!) / 2;
  b[2] = (centers[1]! + centers[2]!) / 2;
  b[3] = (centers[2]! + centers[3]!) / 2;
  return b;
}

/** Locate the header line and the table-start y on a page (if present). */
function analysePage(lines: Line[]): {
  header: { code: string; name: string; top: number } | null;
  tableTop: number | null;
} {
  let header: { code: string; name: string; top: number } | null = null;
  let tableTop: number | null = null;

  for (const line of lines) {
    const text = cleanText(stitch(line.tokens));
    if (!header) {
      const m = text.match(HEADER_RE);
      if (m) {
        header = { code: `TC ${m[1]!.padStart(3, "0")}`, name: m[2]!.trim(), top: line.top };
        continue;
      }
    }
    if (tableTop === null && /BASIC\s*KNOWLEDGE/i.test(text)) {
      tableTop = line.top;
    }
  }
  return { header, tableTop };
}

/** Extract the 4 level texts from the table region of a page. */
function extractLevels(lines: Line[], cols: number[], tableTop: number | null): string[] {
  const buckets: Token[][] = [[], [], [], []];
  for (const line of lines) {
    if (tableTop !== null && line.top <= tableTop + 4) continue; // skip header/desc region
    for (const t of line.tokens) {
      const c = columnOf(t.x, cols);
      if (c >= 0) buckets[c]!.push({ ...t, top: line.top });
    }
  }
  return buckets.map((toks) => {
    const colLines = groupLines(toks, 3);
    return cleanText(colLines.map((l) => stitch(l.tokens)).join(" "));
  });
}

/** Extract the description paragraph (between header and table). */
function extractDescription(lines: Line[], headerTop: number, tableTop: number | null): string {
  const lo = headerTop + 4;
  const hi = tableTop !== null ? tableTop - 4 : headerTop + 60;
  const parts: string[] = [];
  for (const line of lines) {
    if (line.top > lo && line.top < hi) parts.push(stitch(line.tokens));
  }
  return cleanText(parts.join(" "));
}

// ── PDF parsing ───────────────────────────────────────────────

export async function parseKamusPdf(buffer: Buffer): Promise<KamusRecord[]> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const records: (KamusRecord & { _pages: number[] })[] = [];
  let current: (KamusRecord & { _pages: number[] }) | null = null;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const tokens = pageTokens(textContent, viewport.height);
    if (!tokens.length) continue;

    const lines = groupLines(tokens, 3);
    const { header, tableTop } = analysePage(lines);
    const cols = calibrateColumns(lines);

    if (header) {
      current = {
        code: header.code,
        name: header.name,
        description: extractDescription(lines, header.top, tableTop),
        levels: { basic: "", intermediate: "", advance: "", mastery: "" },
        _pages: [p],
      };
      records.push(current);
      const levels = extractLevels(lines, cols, tableTop);
      LEVEL_KEYS.forEach((k, i) => (current!.levels[k] += levels[i]!));
    } else if (current) {
      // Continuation page: append table text to the current record.
      const levels = extractLevels(lines, cols, tableTop);
      LEVEL_KEYS.forEach((k, i) => {
        if (levels[i]) current!.levels[k] += (current!.levels[k] ? " " : "") + levels[i];
      });
      current._pages.push(p);
    }
    // Pages before the first header (cover, foreword, TOC) are skipped.
  }

  return records.map(({ _pages, ...r }) => ({
    ...r,
    levels: {
      basic: cleanText(r.levels.basic),
      intermediate: cleanText(r.levels.intermediate),
      advance: cleanText(r.levels.advance),
      mastery: cleanText(r.levels.mastery),
    },
  }));
}

// ── Main sync function ────────────────────────────────────────

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

const KAMUS_FOLDER = "kamus-kompetensi";

export async function syncKamusKompetensi(
  options: { force?: boolean; uploadsOnly?: boolean } = {},
): Promise<SyncResult> {
  // uploadsOnly: triggered from the Sinkronisasi page right after an upload, so
  // the shared folder must be ignored entirely — the user is saying "process
  // THIS file", not "rescan everything". The scheduled job leaves it unset and
  // still merges both sources.
  const uploadsOnly = options.uploadsOnly === true;
  const basePath = uploadsOnly ? null : config.localPdfFolder;
  const force = options.force === true;
  // The kamus folder sits BESIDE the job-profiles base folder (same parent as
  // hav/mcu/job-profiles): <parent>/kamus-kompetensi. Uploaded PDFs live in the
  // local upload store instead, and are merged in below.
  const shareFolder = basePath ? join(dirname(basePath), KAMUS_FOLDER) : null;
  const uploadFolder = uploadPath(UPLOAD_SUBDIR.kamus);
  // Share access is best-effort: when it fails we can still run purely on
  // uploaded files, which is the point of the upload store.
  const disconnectShare = basePath
    ? await ensureNetworkShareAccess(basePath).catch(() => null)
    : null;

  let totalRecords = 0;
  let syncedRecords = 0;
  let files = 0;

  try {
    let shareReachable = false;
    if (basePath) {
      try {
        assertPathAccessible(basePath, "LOCAL_PDF_FOLDER");
        shareReachable = true;
      } catch {
        // Informational, not a warning: uploading is the supported path now, so
        // an unset/unmounted share is the NORMAL case (a Windows UNC path can
        // never be reached from the Linux container). Logging the full error
        // here made every upload look like it had failed.
        console.log(`[KAMUS] Folder bersama tidak tersedia — memakai berkas unggahan saja`);
      }
    }

    const entries = mergePdfSources(shareReachable ? shareFolder : null, uploadFolder);
    if (entries.length === 0) {
      return {
        success: false,
        message: uploadsOnly
          ? `Tidak ada PDF kamus yang diunggah (folder unggahan: ${uploadFolder})`
          : `Tidak ada PDF kamus. Folder bersama: ${shareFolder ?? "(belum diatur)"} · unggahan: ${uploadFolder}`,
        synced: 0,
        total: 0,
      };
    }
    const uploadedCount = entries.filter((e) => e.source === "upload").length;

    console.log(
      `[KAMUS] Found ${entries.length} PDF(s) ` +
        `(${uploadedCount} dari unggahan, ${entries.length - uploadedCount} dari folder bersama)` +
        `${force ? " [force]" : ""}`,
    );

    // Uploaded PDFs whose content is now in Postgres — removed at the end.
    const consumedUploads: string[] = [];

    for (const entry of entries) {
      const filePath = entry.fullPath;
      const fileName = basename(filePath);
      files++;
      const buffer = readFileSync(filePath);
      const hash = sha256(buffer);

      // Skip when this exact file version has already been ingested (any row
      // carries the source hash). `force` re-parses regardless — rows are
      // upserted by code, nothing is deleted.
      //
      // An UPLOADED file never takes this shortcut: someone picking a file and
      // pressing upload is an explicit instruction to process it. Skipping it
      // silently (and then deleting it, as the cleanup does) looks exactly like
      // the upload was ignored.
      if (!force && entry.source !== "upload") {
        const existing = await query<{ n: string }>(
          `SELECT count(*)::int AS n FROM sync_kamus_kompetensi WHERE source_file = $1 AND file_hash = $2`,
          [fileName, hash],
        );
        if (Number(existing[0]?.n ?? 0) > 0) {
          // Share-sourced only: uploads never reach here (see the guard above).
          console.log(`[KAMUS]   ✓ ${fileName} (unchanged, skipped)`);
          continue;
        }
      }

      const records = await parseKamusPdf(buffer);
      totalRecords += records.length;
      console.log(`[KAMUS]   ${fileName}: ${records.length} kompetensi diparse`);

      for (const r of records) {
        if (!r.code || !r.name) continue;
        await execute(
          `INSERT INTO sync_kamus_kompetensi
             (code, name, description, level_basic, level_intermediate, level_advance, level_mastery, source_file, file_hash, synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
           ON CONFLICT (code) DO UPDATE SET
             name               = EXCLUDED.name,
             description        = EXCLUDED.description,
             level_basic        = EXCLUDED.level_basic,
             level_intermediate = EXCLUDED.level_intermediate,
             level_advance      = EXCLUDED.level_advance,
             level_mastery      = EXCLUDED.level_mastery,
             source_file        = EXCLUDED.source_file,
             file_hash          = EXCLUDED.file_hash,
             synced_at          = NOW()`,
          [
            r.code,
            r.name.slice(0, 300),
            r.description || null,
            r.levels.basic || null,
            r.levels.intermediate || null,
            r.levels.advance || null,
            r.levels.mastery || null,
            fileName,
            hash,
          ],
        );
        syncedRecords++;
      }
      if (entry.source === "upload") consumedUploads.push(filePath);
    }

    const discarded = discardUploaded(consumedUploads);

    return {
      success: true,
      message: `Kamus kompetensi synced dari ${files} file PDF` + discardSummary(discarded),
      synced: syncedRecords,
      total: totalRecords,
    };
  } catch (err) {
    console.error("[KAMUS] Sync failed:", err);
    return { success: false, message: String(err), synced: syncedRecords, total: totalRecords };
  } finally {
    // Null when there is no share to release (uploads-only run).
    if (disconnectShare) await disconnectShare().catch(() => {});
  }
}
