/**
 * Declarative Excel-upload specs for the data sources that otherwise only come
 * from MSSQL or the HR REST API.
 *
 * WHY A REGISTRY INSTEAD OF TEN `*-excel-sync.ts` FILES
 * Every one of these sources needs the same seven things: resolve the uploaded
 * workbook, read a sheet, map headers to columns, coerce cells, upsert in
 * batches, count added/updated/preserved, delete the consumed upload. Written
 * ten times that is ten places for the upsert to drift away from the MSSQL
 * upsert it has to agree with. Written once, the only per-source knowledge is
 * data — which is also exactly what the downloadable template needs, so the
 * template and the parser cannot disagree about a column name.
 *
 * INVARIANTS EVERY SPEC INHERITS (see excel-ingest.ts):
 *  • Update-only. An upload NEVER deletes: an employee absent from the sheet
 *    keeps whatever the last sync gave them. This differs from the REST
 *    education sync, which reconciles per employee — an uploaded sheet is a
 *    patch, not a snapshot, and treating it as a snapshot would silently wipe
 *    history the uploader never intended to touch.
 *  • The conflict target matches the MSSQL/REST sync's, so a row uploaded by
 *    hand updates the same DB row the automated sync would have updated
 *    instead of forking a duplicate.
 *  • Identity columns are never in the DO UPDATE set-list.
 *
 * ADDING A SOURCE: append a spec here, then add a matching tile to
 * EXCEL_DATA_SOURCES in components/settings/sync-settings-client.tsx and a
 * `tryExcelUpload(req, res, "<syncRoute>")` line to that route in routes/sync.ts.
 * The tile list is kept hand-written rather than fetched from here so the
 * Sinkronisasi page still renders when the sync service is unreachable.
 */
import { createHash } from "node:crypto";

// ── Cell coercion ──────────────────────────────────────────────

export type CellValue = string | number | boolean | Date | null;
export type Coerce = (raw: unknown) => CellValue;

const isBlank = (raw: unknown): boolean =>
  raw == null || (typeof raw === "string" && raw.trim() === "");

/** Trimmed text, truncated to the column's varchar length; blank becomes null. */
export function text(maxLen?: number): Coerce {
  return (raw) => {
    if (isBlank(raw)) return null;
    const s = String(raw).trim();
    if (!s) return null;
    return maxLen && s.length > maxLen ? s.slice(0, maxLen) : s;
  };
}

/**
 * A company code: trimmed and UPPER-CASED. Every other writer stores these upper
 * case — the MSSQL source, and the web's mapping actions, which uppercase the
 * Company ID — and every reader joins on plain equality
 * (sync_company_tenant_map.company_id = <table>.company_id). An upload typed
 * "demo" or "Mpm2 " would otherwise land in no company at all.
 */
export function companyCode(maxLen = 10): Coerce {
  const base = text(maxLen);
  return (raw) => {
    const v = base(raw);
    return typeof v === "string" ? v.toUpperCase() : v;
  };
}

/** Integer, tolerating "12,345", " 7 ", and Excel's numeric cells. */
export function int(): Coerce {
  return (raw) => {
    if (isBlank(raw)) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : null;
    const cleaned = String(raw).trim().replace(/[^\d.\-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
}

/** Decimal for numeric() columns; kept as a number so pg formats it. */
export function decimal(): Coerce {
  return (raw) => {
    if (isBlank(raw)) return null;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    // Indonesian sheets frequently use a comma decimal separator.
    const cleaned = String(raw).trim().replace(/\s/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };
}

/**
 * Boolean from the several spellings that reach these sheets. 'Y'/'N' is what
 * MSSQL uses (asBooleanFlag in position-sync.ts), the rest are what people
 * actually type.
 */
export function bool(fallback: boolean | null = null): Coerce {
  return (raw) => {
    if (isBlank(raw)) return fallback;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") return raw !== 0;
    const s = String(raw).trim().toUpperCase();
    if (["Y", "YES", "TRUE", "1", "YA", "T"].includes(s)) return true;
    if (["N", "NO", "FALSE", "0", "TIDAK", "F"].includes(s)) return false;
    return fallback;
  };
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * A calendar date, always at UTC midnight.
 *
 * Read deliberately from the RAW cell (excel-ingest passes cellDates:false) and
 * converted here rather than letting SheetJS build the Date: SheetJS interprets
 * the serial in the server's local zone, so the same workbook parsed in Jakarta
 * and in UTC yields dates a day apart. That matters more than usual here —
 * valid_from is part of the synthesised source_key for three of these tables,
 * so a one-hour drift would mint a NEW row instead of updating the existing one.
 *
 * Time-of-day is dropped for the same reason: MSSQL's VALID_FROM values are
 * date-only in practice, and keeping a spurious time component would break the
 * source_key match against rows the MSSQL sync already wrote.
 */
export function dateOnly(): Coerce {
  return (raw) => {
    if (isBlank(raw)) return null;
    if (raw instanceof Date) {
      return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
    }
    if (typeof raw === "number") {
      if (!Number.isFinite(raw) || raw <= 0) return null;
      return new Date(EXCEL_EPOCH_UTC + Math.trunc(raw) * 86_400_000);
    }
    const s = String(raw).trim();
    if (!s) return null;
    // ISO first (yyyy-mm-dd), then the dd/mm/yyyy and dd-mm-yyyy people type.
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (iso) return new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!));
    const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
    if (dmy) return new Date(Date.UTC(+dmy[3]!, +dmy[2]! - 1, +dmy[1]!));
    const parsed = Date.parse(s);
    if (Number.isNaN(parsed)) return null;
    const d = new Date(parsed);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
}

// ── Spec shape ─────────────────────────────────────────────────

export type ExcelColumn = {
  /** Header text written into the template and matched (case-insensitively) on read. */
  header: string;
  /** Postgres column it feeds. */
  column: string;
  coerce: Coerce;
  /** Row is skipped when this coerces to null. Use for every conflict-key part. */
  required?: boolean;
  /** Value substituted when the cell is blank — for NOT NULL columns with a default. */
  fallback?: CellValue;
  /** Three example cells for the template's sample rows. */
  samples: [CellValue, CellValue, CellValue];
  /** One line of Petunjuk copy describing this column. */
  note: string;
  width?: number;
};

export type ExcelSourceSpec = {
  /** Upload endpoint segment: POST /api/sync/upload/<key>. */
  key: string;
  /** Sync route this upload feeds: POST /api/sync/<syncRoute>. */
  syncRoute: string;
  /** Folder under the upload root. */
  subdir: string;
  /** Fixed stored file name — an upload replaces the previous one. */
  fileName: string;
  /** Sheet written into the template; read back by name, falling back to the first sheet. */
  sheet: string;
  label: string;
  /** Short description shown on the upload tile. */
  desc: string;
  table: string;
  columns: ExcelColumn[];
  /** Upsert conflict target — must match the automated sync's. */
  conflictTarget: string[];
  /** Columns computed from the mapped row rather than read from a cell. */
  derived?: { column: string; build: (row: Record<string, CellValue>) => CellValue }[];
  /**
   * Tie-breaker when two sheet rows collide on the conflict target. Postgres
   * rejects an INSERT whose VALUES contain the same conflict key twice ("ON
   * CONFLICT DO UPDATE command cannot affect row a second time"), so duplicates
   * must be resolved BEFORE the statement is built. Without this the last row
   * in sheet order wins; with it, the row whose named column sorts highest does
   * — mirroring how the MSSQL syncs pick the freshest record.
   */
  dedupePreferHighest?: string;
  /**
   * A date column that decides which of two records for the SAME conflict key
   * is current: an uploaded row whose date is OLDER than the stored row's (or
   * has no date while the stored one has) is not applied, and is reported
   * instead. Compared by calendar date in Asia/Jakarta, so an assessment of the
   * same day replaces the stored one (a corrected note). For tables that keep
   * only the latest record per person — today the behavioural assessment —
   * where an old workbook would otherwise quietly replace a newer result.
   */
  keepNewestBy?: string;
  /**
   * How this table stores an NPK, so an upload writes it the way the MSSQL sync
   * does and every existing join keeps working (excel-ingest canonicalises
   * before source_key is built):
   *   • "padded"   — left-padded to 5 (sync_employee_positions, PA, BA,
   *                  technical competencies; joined as LPAD(e.employee_id, 5, '0'));
   *   • "employee" — the spelling sync_employees already holds for that person
   *                  (sync_employees itself, disciplinary, education; joined on
   *                  plain equality with e.employee_id).
   */
  npkForm?: "padded" | "employee";
  /** Never written by DO UPDATE. Defaults to the conflict target. */
  immutable?: string[];
  /** Extra Petunjuk paragraphs appended after the generic ones. */
  extraNotes?: string[];
};

// ── Shared source_key builders ─────────────────────────────────
// These MUST stay byte-identical to the MSSQL/REST sync that owns the table,
// or an uploaded row inserts a duplicate instead of updating.

const s = (v: CellValue): string => (v == null ? "" : String(v));
const iso = (v: CellValue): string => (v instanceof Date ? v.toISOString() : "null");

/** position-sync.ts:220 — `${COMPANY_ID}:${POSITION_ID}:${VALID_FROM?.toISOString() ?? "null"}` */
const hierarchySourceKey = (r: Record<string, CellValue>): string =>
  `${s(r.company_id)}:${s(r.position_id)}:${iso(r.valid_from ?? null)}`;

/** position-sync.ts:303 — adds EMPLOYEE_ID between company and position. */
const employeePositionSourceKey = (r: Record<string, CellValue>): string =>
  `${s(r.company_id)}:${s(r.employee_id)}:${s(r.position_id)}:${iso(r.valid_from ?? null)}`;

/** position-sync.ts:76-78 — POSITION_ID is "-" when absent, not "". */
const techSourceKey = (r: Record<string, CellValue>): string =>
  `${s(r.company_id)}:${s(r.employee_id)}:${r.position_id == null ? "-" : s(r.position_id)}:${s(r.technical_id)}`;

/** education-sync.ts:29-40 — md5 over ':'-joined parts, nulls as ''. */
const educationSourceKey = (r: Record<string, CellValue>): string =>
  createHash("md5")
    .update(
      [
        s(r.company_id),
        s(r.employee_id),
        s(r.education_level),
        s(r.education_field),
        s(r.institution_name),
        r.start_year == null ? "" : String(r.start_year),
        r.end_year == null ? "" : String(r.end_year),
      ].join(":"),
    )
    .digest("hex");

// ── The specs ──────────────────────────────────────────────────

const companyCol = (): ExcelColumn => ({
  header: "COMPANY_ID",
  column: "company_id",
  coerce: companyCode(10),
  required: true,
  samples: ["MPM2", "MPM2", "MPM5"],
  note: "COMPANY_ID  — Kode company di MSSQL (mis. MPM2). Wajib; menentukan tenant lewat pemetaan Company→Tenant.",
  width: 14,
});

const employeeCol = (): ExcelColumn => ({
  header: "EMPLOYEE_ID",
  column: "employee_id",
  coerce: text(20),
  required: true,
  samples: ["12345", "12346", "12347"],
  note: "EMPLOYEE_ID — NPK karyawan. Wajib.",
  width: 14,
});

const auditColumns = (): ExcelColumn[] => [
  {
    header: "CREATE_BY",
    column: "create_by",
    coerce: text(100),
    samples: ["system", "system", "system"],
    note: "CREATE_BY   — Opsional, hanya jejak audit dari sistem sumber.",
    width: 14,
  },
  {
    header: "CREATE_DATE",
    column: "create_date",
    coerce: dateOnly(),
    samples: ["2020-01-15", "2021-03-01", "2022-07-20"],
    note: "CREATE_DATE — Opsional. Format tanggal: YYYY-MM-DD atau DD/MM/YYYY.",
    width: 14,
  },
  {
    header: "MODI_BY",
    column: "modi_by",
    coerce: text(100),
    samples: [null, "system", null],
    note: "MODI_BY     — Opsional.",
    width: 14,
  },
  {
    header: "MODI_DATE",
    column: "modi_date",
    coerce: dateOnly(),
    samples: [null, "2024-02-10", null],
    note: "MODI_DATE   — Opsional.",
    width: 14,
  },
];

export const EXCEL_SOURCES: ExcelSourceSpec[] = [
  // ── 1. Employees ─────────────────────────────────────────────
  {
    key: "employees",
    syncRoute: "employees",
    subdir: "employees",
    fileName: "employees.xlsx",
    sheet: "Employees",
    label: "Data Karyawan",
    desc: "Master karyawan: NPK, nama, grade, divisi, departemen. Menggantikan tarikan dari MSSQL MPMDS.",
    table: "sync_employees",
    conflictTarget: ["employee_id"],
    npkForm: "employee",
    columns: [
      // Required (it used to be optional): an employee without a company maps to
      // no tenant, so they never become a candidate — and re-uploading such a
      // file over a correct one erased their company.
      companyCol(),
      employeeCol(),
      {
        header: "DISPLAY_NAME",
        column: "display_name",
        coerce: text(200),
        samples: ["Contoh Nama Karyawan", "Contoh Nama Lainnya", "Contoh Nama Ketiga"],
        note: "DISPLAY_NAME — Nama karyawan.",
        width: 30,
      },
      {
        header: "GRADE_ID",
        column: "grade_id",
        coerce: text(20),
        samples: ["G10", "G11", "G09"],
        note: "GRADE_ID    — Kode grade. Dipakai penyaringan rentang grade saat scoring.",
        width: 12,
      },
      {
        header: "INTERNAL_TITLE",
        column: "internal_title",
        coerce: text(200),
        samples: ["Staff Finance", "Supervisor Sales", "Manager HRGA"],
        note: "INTERNAL_TITLE — Jabatan internal.",
        width: 28,
      },
      {
        header: "COMPANY_OFFICE",
        column: "company_office",
        coerce: text(100),
        samples: ["Head Office", "Cabang Bandung", "Head Office"],
        note: "COMPANY_OFFICE — Lokasi/kantor.",
        width: 20,
      },
      {
        header: "IDDIVISION",
        column: "iddivision",
        coerce: text(20),
        samples: ["DIV01", "DIV02", "DIV03"],
        note: "IDDIVISION  — Kode divisi. Sinkronisasi Divisi & Departemen diturunkan dari kolom ini.",
        width: 14,
      },
      {
        header: "DIVISION",
        column: "division",
        coerce: text(200),
        samples: ["Finance", "Sales", "HRGA"],
        note: "DIVISION    — Nama divisi.",
        width: 20,
      },
      {
        header: "IDDEPARTMENT",
        column: "iddepartment",
        coerce: text(20),
        samples: ["DEP01", "DEP02", "DEP03"],
        note: "IDDEPARTMENT — Kode departemen.",
        width: 16,
      },
      {
        header: "DEPARTMENT",
        column: "department",
        coerce: text(200),
        samples: ["Accounting", "Retail Sales", "People Development"],
        note: "DEPARTMENT  — Nama departemen.",
        width: 24,
      },
      {
        header: "IS_BRANCH_HEAD",
        column: "is_branch_head",
        coerce: bool(false),
        fallback: false,
        samples: ["N", "Y", "N"],
        note: "IS_BRANCH_HEAD — Y/N (juga menerima TRUE/FALSE, 1/0, Ya/Tidak). Kosong = N.",
        width: 16,
      },
      {
        header: "IS_AFC",
        column: "is_afc",
        coerce: bool(false),
        fallback: false,
        samples: ["N", "N", "Y"],
        note: "IS_AFC      — Y/N. Kosong = N.",
        width: 10,
      },
      {
        header: "IS_HOMSO",
        column: "is_homso",
        coerce: bool(false),
        fallback: false,
        samples: ["N", "N", "N"],
        note: "IS_HOMSO    — Y/N. Kosong = N.",
        width: 12,
      },
      {
        header: "ENTRY_DATE",
        column: "entry_date",
        coerce: dateOnly(),
        samples: ["2015-06-01", "2018-09-15", "2012-01-05"],
        note: "ENTRY_DATE  — Tanggal masuk kerja. Dipakai menghitung masa kerja (years_experience) kandidat.",
        width: 14,
      },
    ],
    extraNotes: [
      "DIVISI & DEPARTEMEN tidak punya template sendiri: keduanya diturunkan otomatis dari",
      "kolom IDDIVISION/DIVISION/IDDEPARTMENT/DEPARTMENT di file ini. Jalankan sinkronisasi",
      "Struktur Organisasi setelah unggahan ini untuk memperbaruinya.",
    ],
  },

  // ── 2. Position master ───────────────────────────────────────
  {
    key: "positions-master",
    syncRoute: "positions/master",
    subdir: "positions-master",
    fileName: "positions-master.xlsx",
    sheet: "Positions",
    label: "Master Jabatan",
    desc: "Master posisi: kode, judul internal/eksternal, grade, masa berlaku.",
    table: "sync_positions",
    conflictTarget: ["company_id", "position_id", "valid_from"],
    columns: [
      companyCol(),
      {
        header: "POSITION_ID",
        column: "position_id",
        coerce: text(40),
        required: true,
        samples: ["POS0001", "POS0002", "POS0003"],
        note: "POSITION_ID — Kode posisi. Wajib.",
        width: 16,
      },
      {
        header: "INTERNAL_TITLE",
        column: "internal_title",
        coerce: text(300),
        samples: ["Staff Finance", "Supervisor Sales", "Manager HRGA"],
        note: "INTERNAL_TITLE — Judul jabatan internal.",
        width: 30,
      },
      {
        header: "EXTERNAL_TITLE",
        column: "external_title",
        coerce: text(300),
        samples: ["Finance Staff", "Sales Supervisor", "HRGA Manager"],
        note: "EXTERNAL_TITLE — Judul jabatan eksternal.",
        width: 30,
      },
      {
        header: "SUMMARY",
        column: "summary",
        coerce: text(),
        samples: ["Ringkasan tugas jabatan.", null, null],
        note: "SUMMARY     — Ringkasan jabatan. Opsional, teks bebas.",
        width: 40,
      },
      {
        header: "GRADE_ID",
        column: "grade_id",
        coerce: text(20),
        samples: ["G10", "G11", "G13"],
        note: "GRADE_ID    — Grade jabatan.",
        width: 12,
      },
      {
        header: "POS_LEVEL_NO",
        column: "pos_level_no",
        coerce: int(),
        samples: [5, 4, 3],
        note: "POS_LEVEL_NO — Angka level jabatan. Opsional.",
        width: 14,
      },
      {
        header: "VALID_FROM",
        column: "valid_from",
        coerce: dateOnly(),
        required: true,
        samples: ["2023-01-01", "2023-01-01", "2024-01-01"],
        note: "VALID_FROM  — Mulai berlaku. WAJIB: bersama COMPANY_ID+POSITION_ID inilah kunci baris.",
        width: 14,
      },
      {
        header: "VALID_TO",
        column: "valid_to",
        coerce: dateOnly(),
        samples: [null, null, "2025-12-31"],
        note: "VALID_TO    — Berakhir berlaku. Kosongkan bila masih berlaku.",
        width: 14,
      },
      ...auditColumns(),
    ],
    extraNotes: [
      "VALID_FROM adalah bagian dari kunci baris. Mengubah tanggalnya membuat BARIS BARU,",
      "bukan memperbarui yang lama — persis seperti perilaku tarikan MSSQL.",
    ],
  },

  // ── 3. Position hierarchy ────────────────────────────────────
  {
    key: "positions-hierarchy",
    syncRoute: "positions/hierarchy",
    subdir: "positions-hierarchy",
    fileName: "positions-hierarchy.xlsx",
    sheet: "Hierarchy",
    label: "Hierarki Jabatan",
    desc: "Relasi atasan–bawahan antar posisi (parent position).",
    table: "sync_position_hierarchy",
    conflictTarget: ["source_key"],
    immutable: ["source_key", "company_id", "position_id", "valid_from"],
    derived: [{ column: "source_key", build: hierarchySourceKey }],
    columns: [
      companyCol(),
      {
        header: "POSITION_ID",
        column: "position_id",
        coerce: text(40),
        required: true,
        samples: ["POS0002", "POS0003", "POS0001"],
        note: "POSITION_ID — Posisi anak. Wajib.",
        width: 16,
      },
      {
        header: "PARENT_POSITION_ID",
        column: "parent_position_id",
        coerce: text(40),
        samples: ["POS0003", null, "POS0002"],
        note: "PARENT_POSITION_ID — Posisi atasan langsung. Kosongkan untuk posisi puncak.",
        width: 20,
      },
      {
        header: "VALID_FROM",
        column: "valid_from",
        coerce: dateOnly(),
        required: true,
        samples: ["2023-01-01", "2023-01-01", "2023-01-01"],
        note: "VALID_FROM  — Mulai berlaku. Wajib; ikut membentuk kunci baris.",
        width: 14,
      },
      {
        header: "VALID_TO",
        column: "valid_to",
        coerce: dateOnly(),
        samples: [null, null, null],
        note: "VALID_TO    — Berakhir berlaku. Kosongkan bila masih berlaku.",
        width: 14,
      },
      ...auditColumns(),
    ],
  },

  // ── 4. Employee ↔ position mapping ───────────────────────────
  {
    key: "positions-employees",
    syncRoute: "positions/employees",
    subdir: "positions-employees",
    fileName: "positions-employees.xlsx",
    sheet: "EmployeePositions",
    label: "Penempatan Karyawan",
    desc: "Pemetaan karyawan ke posisi, termasuk penanda posisi utama dan masa berlaku.",
    table: "sync_employee_positions",
    npkForm: "padded",
    conflictTarget: ["source_key"],
    immutable: ["source_key", "company_id", "employee_id", "position_id", "valid_from"],
    derived: [{ column: "source_key", build: employeePositionSourceKey }],
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "POSITION_ID",
        column: "position_id",
        coerce: text(40),
        required: true,
        samples: ["POS0001", "POS0002", "POS0003"],
        note: "POSITION_ID — Kode posisi yang diduduki. Wajib.",
        width: 16,
      },
      {
        header: "PRIMARY_POSITION",
        column: "primary_position",
        coerce: bool(false),
        fallback: false,
        required: false,
        samples: ["Y", "Y", "N"],
        note: "PRIMARY_POSITION — Y untuk posisi utama. HANYA posisi utama yang dipakai saat membentuk kandidat.",
        width: 18,
      },
      {
        header: "VALID_FROM",
        column: "valid_from",
        coerce: dateOnly(),
        required: true,
        samples: ["2023-01-01", "2023-06-01", "2024-01-01"],
        note: "VALID_FROM  — Mulai menduduki posisi. Wajib; ikut membentuk kunci baris.",
        width: 14,
      },
      {
        header: "VALID_TO",
        column: "valid_to",
        coerce: dateOnly(),
        samples: [null, null, null],
        note: "VALID_TO    — Berakhir. Kosongkan bila masih menjabat — posisi yang sudah lewat tidak dipakai sebagai posisi saat ini.",
        width: 14,
      },
      ...auditColumns(),
    ],
    extraNotes: [
      "Kandidat hanya terbentuk dari baris dengan PRIMARY_POSITION = Y yang masa berlakunya",
      "masih aktif hari ini (VALID_FROM <= hari ini dan VALID_TO kosong atau belum lewat).",
    ],
  },

  // ── 5. Technical competencies ────────────────────────────────
  {
    key: "positions-competencies",
    syncRoute: "positions/competencies",
    subdir: "positions-competencies",
    fileName: "positions-competencies.xlsx",
    sheet: "TechCompetency",
    label: "Kompetensi Teknis",
    desc: "Pemetaan kompetensi teknis per karyawan: level yang dituntut jabatan vs level yang dicapai.",
    table: "sync_technical_competencies",
    npkForm: "padded",
    conflictTarget: ["source_key"],
    // position-sync.ts:360-372 keeps the newest MODI_DATE (falling back to
    // CREATE_DATE) when the source has several rows for one source_key.
    dedupePreferHighest: "modi_date",
    immutable: ["source_key", "company_id", "employee_id", "technical_id"],
    derived: [{ column: "source_key", build: techSourceKey }],
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "COMPANY_OFFICE",
        column: "company_office",
        coerce: text(100),
        samples: ["Head Office", "Head Office", "Cabang Bandung"],
        note: "COMPANY_OFFICE — Opsional.",
        width: 18,
      },
      {
        header: "COST_CENTER",
        column: "cost_center",
        coerce: text(20),
        samples: [null, null, null],
        note: "COST_CENTER — Opsional.",
        width: 14,
      },
      {
        header: "ORG_ID",
        column: "org_id",
        coerce: text(20),
        samples: [null, null, null],
        note: "ORG_ID      — Opsional.",
        width: 12,
      },
      {
        header: "POSITION_ID",
        column: "position_id",
        coerce: text(40),
        samples: ["POS0001", "POS0001", "POS0002"],
        note: "POSITION_ID — Posisi yang menuntut kompetensi ini. Opsional tapi ikut membentuk kunci baris.",
        width: 16,
      },
      {
        header: "GRADE_ID",
        column: "grade_id",
        coerce: text(20),
        samples: ["G10", "G10", "G11"],
        note: "GRADE_ID    — Opsional.",
        width: 12,
      },
      {
        header: "TECHNICAL_ID",
        column: "technical_id",
        coerce: text(40),
        required: true,
        samples: ["TC 001", "TC 002", "TC 003"],
        note: "TECHNICAL_ID — Kode kompetensi, harus cocok dengan kode di Kamus Kompetensi (mis. TC 003). Wajib.",
        width: 16,
      },
      {
        header: "TECHNICAL_NAME",
        column: "technical_name",
        coerce: text(300),
        samples: ["Financial Analysis", "Negotiation", "Talent Management"],
        note: "TECHNICAL_NAME — Nama kompetensi.",
        width: 30,
      },
      {
        header: "PROFICIENCY_ID",
        column: "proficiency_id",
        coerce: text(40),
        samples: ["P3", "P2", "P4"],
        note: "PROFICIENCY_ID — Kode level yang DITUNTUT jabatan.",
        width: 16,
      },
      {
        header: "PROFICIENCY_NAME",
        column: "proficiency_name",
        coerce: text(120),
        samples: ["Advance", "Intermediate", "Mastery"],
        note: "PROFICIENCY_NAME — Nama level yang DITUNTUT jabatan (Basic/Intermediate/Advance/Mastery).",
        width: 20,
      },
      {
        header: "SCORE",
        column: "score",
        coerce: int(),
        samples: [3, 2, 4],
        note: "SCORE       — Angka level yang DITUNTUT jabatan (1-4).",
        width: 10,
      },
      {
        header: "CURRENT_PROFICIENCY_ID",
        column: "current_proficiency_id",
        coerce: text(40),
        samples: ["P2", "P2", "P3"],
        note: "CURRENT_PROFICIENCY_ID — Kode level yang DICAPAI karyawan.",
        width: 22,
      },
      {
        header: "CURRENT_PROFICIENCY_NAME",
        column: "current_proficiency_name",
        coerce: text(120),
        samples: ["Intermediate", "Intermediate", "Advance"],
        note: "CURRENT_PROFICIENCY_NAME — Nama level yang DICAPAI karyawan.",
        width: 24,
      },
      {
        header: "CURRENT_SCORE",
        column: "current_score",
        coerce: int(),
        samples: [2, 2, 3],
        note: "CURRENT_SCORE — Angka level yang DICAPAI karyawan (1-4).",
        width: 14,
      },
      {
        header: "GAP",
        column: "gap",
        coerce: int(),
        samples: [-1, 0, -1],
        note: "GAP         — CURRENT_SCORE dikurangi SCORE. Opsional; isi bila tersedia.",
        width: 8,
      },
      {
        header: "IS_ACTIVE",
        column: "is_active",
        coerce: bool(true),
        fallback: true,
        samples: ["Y", "Y", "Y"],
        note: "IS_ACTIVE   — Y/N. Kosong dianggap Y.",
        width: 12,
      },
      ...auditColumns(),
    ],
    extraNotes: [
      "PENTING — arti dua pasang kolom ini sering tertukar:",
      "  PROFICIENCY_*  = level yang DITUNTUT oleh jabatan.",
      "  CURRENT_*      = level yang sudah DICAPAI karyawan.",
      "Scoring memakai keduanya secara berbeda, jadi menukarnya membalik hasil penilaian.",
    ],
  },

  // ── 6. Performance appraisals ────────────────────────────────
  {
    key: "performance",
    syncRoute: "performance",
    subdir: "performance",
    fileName: "performance-appraisal.xlsx",
    sheet: "PerformanceAppraisal",
    label: "Penilaian Kinerja",
    desc: "Riwayat performance appraisal per tahun (S1, S2, promosi).",
    table: "sync_performance_appraisals",
    npkForm: "padded",
    conflictTarget: ["company_id", "employee_id", "tahun", "seq"],
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "COMPANY_OFFICE",
        column: "company_office",
        coerce: text(100),
        samples: ["Head Office", "Head Office", "Head Office"],
        note: "COMPANY_OFFICE — Opsional.",
        width: 18,
      },
      {
        header: "COST_CENTER",
        column: "cost_center",
        coerce: text(20),
        samples: [null, null, null],
        note: "COST_CENTER — Opsional.",
        width: 14,
      },
      {
        header: "ORG_ID",
        column: "org_id",
        coerce: text(20),
        samples: [null, null, null],
        note: "ORG_ID      — Opsional.",
        width: 12,
      },
      {
        header: "POSITION_ID",
        column: "position_id",
        coerce: text(20),
        samples: ["POS0001", "POS0001", "POS0001"],
        note: "POSITION_ID — Posisi saat dinilai. Opsional.",
        width: 16,
      },
      {
        header: "GRADE_ID",
        column: "grade_id",
        coerce: text(10),
        samples: ["G10", "G10", "G10"],
        note: "GRADE_ID    — Grade saat dinilai. Opsional.",
        width: 12,
      },
      {
        header: "SEQ",
        column: "seq",
        coerce: int(),
        required: true,
        samples: [1, 1, 1],
        note: "SEQ         — Nomor urut penilaian dalam satu tahun. Wajib; biasanya 1. Ikut membentuk kunci baris.",
        width: 8,
      },
      {
        header: "TAHUN",
        column: "tahun",
        coerce: int(),
        required: true,
        samples: [2023, 2024, 2025],
        note: "TAHUN       — Tahun penilaian (4 digit). Wajib; ikut membentuk kunci baris.",
        width: 10,
      },
      {
        header: "S1",
        column: "s1",
        coerce: text(10),
        samples: ["B", "B", "A"],
        note: "S1          — Nilai semester/komponen 1.",
        width: 8,
      },
      {
        header: "S2",
        column: "s2",
        coerce: text(10),
        samples: ["B", "A", "A"],
        note: "S2          — Nilai semester/komponen 2. performance_grade kandidat disusun dari S2,S1 tiga tahun terakhir.",
        width: 8,
      },
      {
        header: "PROMOSI",
        column: "promosi",
        coerce: text(50),
        samples: [null, "Promosi", null],
        note: "PROMOSI     — Keterangan promosi. Opsional.",
        width: 16,
      },
      {
        header: "IS_PRINT_REPORT",
        column: "is_print_report",
        coerce: bool(null),
        samples: ["Y", "Y", "N"],
        note: "IS_PRINT_REPORT — Y/N. Opsional.",
        width: 16,
      },
      ...auditColumns(),
    ],
    extraNotes: [
      "Kunci baris adalah COMPANY_ID + EMPLOYEE_ID + TAHUN + SEQ. Mengunggah ulang tahun yang",
      "sama dengan SEQ sama akan MEMPERBARUI baris itu; tahun lain tetap utuh.",
    ],
  },

  // ── 7. Grade levels ──────────────────────────────────────────
  {
    key: "grade-levels",
    syncRoute: "grade-levels",
    subdir: "grade-levels",
    fileName: "grade-levels.xlsx",
    sheet: "GradeLevels",
    label: "Level & Grade",
    desc: "Pemetaan level jabatan ke grade — dipakai menyusun rentang grade posisi.",
    table: "sync_grade_levels",
    conflictTarget: ["company_id", "level_id", "grade_id"],
    columns: [
      companyCol(),
      {
        header: "LEVEL_ID",
        column: "level_id",
        coerce: text(20),
        required: true,
        samples: ["L01", "L01", "L02"],
        note: "LEVEL_ID    — Kode level. Wajib.",
        width: 12,
      },
      {
        header: "LEVEL_NAME",
        column: "level_name",
        coerce: text(200),
        samples: ["Staff", "Staff", "Supervisor"],
        note: "LEVEL_NAME  — Nama level.",
        width: 20,
      },
      {
        header: "GRADE_ID",
        column: "grade_id",
        coerce: text(20),
        required: true,
        samples: ["G09", "G10", "G11"],
        note: "GRADE_ID    — Grade yang termasuk level ini. Wajib. Satu baris per pasangan level–grade.",
        width: 12,
      },
    ],
    extraNotes: [
      "Satu level biasanya mencakup beberapa grade: tulis SATU BARIS per pasangan",
      "LEVEL_ID + GRADE_ID (contoh: L01 punya baris untuk G09 dan G10).",
    ],
  },

  // ── 8. Behavior competencies ─────────────────────────────────
  {
    key: "behavior-competencies",
    syncRoute: "behavior-competencies",
    subdir: "behavior-competencies",
    fileName: "behavior-competencies.xlsx",
    sheet: "Behavior",
    label: "Kompetensi Perilaku",
    desc: "Hasil assessment center terakhir per karyawan: rekomendasi dan keterangan.",
    table: "sync_behavior_competencies",
    npkForm: "padded",
    conflictTarget: ["company_id", "employee_id"],
    // Only the latest assessment is kept per employee, same as the MSSQL query's
    // ROW_NUMBER() ... ORDER BY TGL_PELAKSANAAN DESC — within the file, and
    // against what is already stored: an older assessment never replaces a newer one.
    dedupePreferHighest: "tgl_pelaksanaan",
    keepNewestBy: "tgl_pelaksanaan",
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "REKOMENDASI_NAME",
        column: "rekomendasi_name",
        coerce: text(255),
        samples: ["Disarankan", "Disarankan Dengan Pengembangan", "Belum Disarankan"],
        note: "REKOMENDASI_NAME — Hasil rekomendasi assessment. Dipakai langsung sebagai aspek Perilaku saat scoring.",
        width: 34,
      },
      {
        header: "KETERANGAN",
        column: "keterangan",
        coerce: text(),
        samples: ["Catatan hasil assessment.", null, null],
        note: "KETERANGAN  — Catatan bebas. Opsional.",
        width: 40,
      },
      {
        header: "TGL_PELAKSANAAN",
        column: "tgl_pelaksanaan",
        coerce: dateOnly(),
        samples: ["2024-05-20", "2023-11-02", "2024-08-14"],
        note: "TGL_PELAKSANAAN — Tanggal assessment. Bila satu karyawan punya beberapa, isi yang TERBARU saja.",
        width: 18,
      },
    ],
    extraNotes: [
      "Hanya SATU baris per karyawan (assessment terbaru). Bila file memuat lebih dari satu",
      "baris untuk NPK yang sama, baris dengan TGL_PELAKSANAAN terbaru yang dipakai.",
      "Baris yang TGL_PELAKSANAAN-nya lebih lama dari assessment yang sudah tersimpan (atau kosong)",
      "tidak diterapkan dan dilaporkan setelah unggah; tanggal yang sama menggantikan data tersimpan.",
    ],
  },

  // ── 9. Disciplinary ──────────────────────────────────────────
  {
    key: "disciplinary",
    syncRoute: "disciplinary",
    subdir: "disciplinary",
    fileName: "disciplinary.xlsx",
    sheet: "Disciplinary",
    label: "Catatan Disiplin",
    desc: "Riwayat pelanggaran & sanksi. Menggantikan tarikan dari API HR.",
    table: "sync_disciplinary",
    npkForm: "employee",
    conflictTarget: ["company_id", "employee_id", "disciplinary_no"],
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "DISPLAY_NAME",
        column: "display_name",
        coerce: text(200),
        samples: ["Contoh Nama Karyawan", "Contoh Nama Lainnya", "Contoh Nama Ketiga"],
        note: "DISPLAY_NAME — Nama karyawan. Opsional, memudahkan pembacaan.",
        width: 30,
      },
      {
        header: "DISCIPLINARY_NO",
        column: "disciplinary_no",
        coerce: int(),
        required: true,
        samples: [1, 2, 1],
        note: "DISCIPLINARY_NO — Nomor urut catatan untuk karyawan itu. Wajib, ANGKA; ikut membentuk kunci baris.",
        width: 16,
      },
      {
        header: "INCIDENT_DATE",
        column: "incident_date",
        coerce: dateOnly(),
        samples: ["2024-03-11", "2025-01-20", "2023-08-02"],
        note: "INCIDENT_DATE — Tanggal kejadian.",
        width: 16,
      },
      {
        header: "VIOLATION",
        column: "violation",
        coerce: text(),
        samples: ["Terlambat berulang", "Pelanggaran SOP", "Absen tanpa keterangan"],
        note: "VIOLATION   — Uraian pelanggaran.",
        width: 34,
      },
      {
        header: "VIOLATION_DEGREE",
        column: "violation_degree",
        coerce: int(),
        samples: [1, 2, 1],
        note: "VIOLATION_DEGREE — Derajat pelanggaran, ANGKA.",
        width: 18,
      },
      {
        header: "VIOLATION_TYPE",
        column: "violation_type",
        coerce: int(),
        samples: [1, 1, 2],
        note: "VIOLATION_TYPE — Jenis pelanggaran, ANGKA.",
        width: 16,
      },
      {
        header: "WARNING_LEVEL",
        column: "warning_level",
        coerce: int(),
        samples: [1, 3, 4],
        // The HR source's own codes (measured against SANCTION_GIVEN, 2026-11-25);
        // candidate-populate.ts DISCIPLINE_STATUS_SQL reads them.
        note: "WARNING_LEVEL — Tingkat surat, ANGKA: 1 = SP1, 2 = SP2, 3 = SP3, 4 = ST (Surat Teguran), 5 = SP Pertama & Terakhir. SP1/SP2 dinilai dari EXPIRY_DATE (masih berlaku / berakhir < 2 tahun / ≥ 2 tahun). Menentukan status disiplin kandidat, jadi salah isi di sini bisa menggugurkan orang dari program.",
        width: 16,
      },
      {
        header: "EFFECT_VIOLATION",
        column: "effect_violation",
        coerce: text(),
        samples: [null, "Kerugian operasional", null],
        note: "EFFECT_VIOLATION — Dampak pelanggaran. Opsional.",
        width: 28,
      },
      {
        header: "ADVICE_GIVEN",
        column: "advice_given",
        coerce: text(200),
        samples: [null, null, null],
        note: "ADVICE_GIVEN — Saran/pembinaan. Opsional.",
        width: 24,
      },
      {
        header: "SANCTION_GIVEN",
        column: "sanction_given",
        coerce: text(200),
        samples: ["SP1", "SP3", "ST"],
        note: "SANCTION_GIVEN — Sanksi yang diberikan.",
        width: 18,
      },
      {
        header: "LETTER_NO",
        column: "letter_no",
        coerce: text(200),
        samples: ["001/SP1/2024", "014/SP3/2025", "007/ST/2023"],
        note: "LETTER_NO   — Nomor surat.",
        width: 20,
      },
      {
        header: "DATE_ISSUE",
        column: "date_issue",
        coerce: dateOnly(),
        samples: ["2024-03-15", "2025-01-25", "2023-08-10"],
        note: "DATE_ISSUE  — Tanggal surat terbit.",
        width: 14,
      },
      {
        header: "EXPIRY_DATE",
        column: "expiry_date",
        coerce: dateOnly(),
        samples: ["2025-03-15", "2026-01-25", "2024-08-10"],
        note: "EXPIRY_DATE — Tanggal sanksi berakhir. Dipakai menilai apakah sanksi masih aktif.",
        width: 14,
      },
      {
        header: "DISCIPLINARY_NOTE",
        column: "disciplinary_note",
        coerce: text(),
        samples: [null, null, null],
        note: "DISCIPLINARY_NOTE — Catatan tambahan. Opsional.",
        width: 30,
      },
    ],
    extraNotes: [
      "Satu baris = satu catatan. Karyawan tanpa catatan disiplin TIDAK perlu ditulis di file ini.",
      "WARNING_LEVEL harus angka, bukan teks 'SP1' — teks akan dibaca sebagai 1 hanya bila",
      "mengandung angka, dan sel tanpa angka sama sekali menjadi kosong.",
    ],
  },

  // ── 10. Education ────────────────────────────────────────────
  {
    key: "education",
    syncRoute: "education",
    subdir: "education",
    fileName: "education.xlsx",
    sheet: "Education",
    label: "Riwayat Pendidikan",
    desc: "Jenjang, jurusan, institusi, dan IPK per karyawan. Menggantikan tarikan dari API HR.",
    table: "sync_education",
    npkForm: "employee",
    conflictTarget: ["source_key"],
    immutable: [
      "source_key",
      "company_id",
      "employee_id",
      "education_level",
      "education_field",
      "institution_name",
      "start_year",
      "end_year",
    ],
    derived: [{ column: "source_key", build: educationSourceKey }],
    columns: [
      companyCol(),
      employeeCol(),
      {
        header: "DISPLAY_NAME",
        column: "display_name",
        coerce: text(200),
        samples: ["Contoh Nama Karyawan", "Contoh Nama Lainnya", "Contoh Nama Ketiga"],
        note: "DISPLAY_NAME — Nama karyawan. Opsional.",
        width: 30,
      },
      {
        header: "EDUCATION_LEVEL",
        column: "education_level",
        coerce: text(50),
        required: true,
        samples: ["S1", "S2", "D3"],
        note: "EDUCATION_LEVEL — Jenjang (SMA/D3/S1/S2/S3). Wajib; ikut membentuk kunci baris.",
        width: 16,
      },
      {
        header: "EDUCATION_LEVEL_RANK",
        column: "education_level_rank",
        coerce: int(),
        samples: [3, 4, 2],
        note: "EDUCATION_LEVEL_RANK — Angka peringkat jenjang; makin besar makin tinggi. Pendidikan TERTINGGI kandidat dipilih berdasarkan kolom ini, jadi kosong berarti baris itu tidak pernah terpilih.",
        width: 20,
      },
      {
        header: "EDUCATION_FIELD",
        column: "education_field",
        coerce: text(100),
        required: true,
        samples: ["Akuntansi", "Manajemen", "Teknik Mesin"],
        note: "EDUCATION_FIELD — Jurusan. Wajib; ikut membentuk kunci baris.",
        width: 22,
      },
      {
        header: "INSTITUTION_NAME",
        column: "institution_name",
        coerce: text(300),
        required: true,
        samples: ["Universitas Contoh", "Universitas Contoh Dua", "Politeknik Contoh"],
        note: "INSTITUTION_NAME — Nama institusi. Wajib; ikut membentuk kunci baris.",
        width: 30,
      },
      {
        header: "INSTITUTION_LOCATION",
        column: "institution_location",
        coerce: text(100),
        samples: ["Jakarta", "Bandung", "Surabaya"],
        note: "INSTITUTION_LOCATION — Kota institusi. Opsional.",
        width: 20,
      },
      {
        header: "START_YEAR",
        column: "start_year",
        coerce: int(),
        samples: [2010, 2016, 2008],
        note: "START_YEAR  — Tahun mulai (4 digit). Ikut membentuk kunci baris.",
        width: 12,
      },
      {
        header: "END_YEAR",
        column: "end_year",
        coerce: int(),
        samples: [2014, 2018, 2011],
        note: "END_YEAR    — Tahun lulus (4 digit). Ikut membentuk kunci baris.",
        width: 12,
      },
      {
        header: "GPA",
        column: "gpa",
        coerce: decimal(),
        samples: [3.42, 3.78, 3.1],
        note: "GPA         — IPK, maksimum 2 angka desimal. Koma maupun titik diterima (3,42 = 3.42).",
        width: 10,
      },
      {
        header: "ACHIEVEMENT",
        column: "achievement",
        coerce: text(),
        samples: [null, "Cum laude", null],
        note: "ACHIEVEMENT — Prestasi. Opsional.",
        width: 24,
      },
      {
        header: "EDUCATION_NOTE",
        column: "education_note",
        coerce: text(),
        samples: [null, null, null],
        note: "EDUCATION_NOTE — Catatan bebas. Opsional.",
        width: 24,
      },
    ],
    extraNotes: [
      "Satu baris per riwayat pendidikan; satu karyawan boleh punya beberapa baris.",
      "Kunci baris dihitung dari EMPLOYEE_ID + EDUCATION_LEVEL + EDUCATION_FIELD +",
      "INSTITUTION_NAME + START_YEAR + END_YEAR. Mengubah salah satunya membuat baris BARU,",
      "sedangkan baris lama tetap ada — koreksi ejaan institusi sebaiknya dilakukan langsung",
      "di sumber, bukan lewat unggahan.",
      "",
      "Berbeda dengan tarikan dari API HR yang merekonsiliasi (menghapus riwayat yang hilang),",
      "unggahan ini TIDAK PERNAH menghapus.",
    ],
  },
];

const BY_KEY = new Map(EXCEL_SOURCES.map((spec) => [spec.key, spec]));
const BY_ROUTE = new Map(EXCEL_SOURCES.map((spec) => [spec.syncRoute, spec]));

export function excelSpecByKey(key: string): ExcelSourceSpec | null {
  return BY_KEY.get(key) ?? null;
}

/** Look a spec up by the sync route it feeds, e.g. "positions/master". */
export function excelSpecByRoute(route: string): ExcelSourceSpec | null {
  return BY_ROUTE.get(route) ?? null;
}

export function excelSourceKeys(): string[] {
  return EXCEL_SOURCES.map((spec) => spec.key);
}

/** Columns written by DO UPDATE: everything mapped, minus the identity ones. */
export function updatableColumns(spec: ExcelSourceSpec): string[] {
  const immutable = new Set(spec.immutable ?? spec.conflictTarget);
  const all = [
    ...spec.columns.map((c) => c.column),
    ...(spec.derived ?? []).map((d) => d.column),
  ];
  return all.filter((c) => !immutable.has(c));
}
