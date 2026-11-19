"""Write the twelve demo workbooks.

Layout rules come from the parsers, not from taste:

* The ten registry sources (sync-service/src/services/excel-sources.ts) read the
  sheet named like the template's data sheet, falling back to the FIRST sheet,
  and match headers case-insensitively. Header text and order below copy the
  spec exactly, so these files are interchangeable with the downloadable
  templates.
* HAV (hav-sync.ts) reads ONLY a sheet named "ALL", headers exactly
  NPK / NAMA / Quadrant (case-sensitive).
* MCU (mcu-sync.ts) reads the FIRST sheet, headers exactly
  NPK / Nama / Kesimpulan / Keterangan (case-sensitive).

So every instruction sheet is appended AFTER the data sheet.

Cells that must point at data already in the target database are written
blank and filled yellow; cells that may optionally point at it are orange.
Dates are real Excel date cells (the parser reads the raw serial and converts
it at UTC midnight, which is timezone-safe); identifiers are text.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from openpyxl import Workbook
from openpyxl.comments import Comment
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from . import dataset as ds

YELLOW = PatternFill("solid", fgColor="FFE699")  # must be filled from YOUR database
ORANGE = PatternFill("solid", fgColor="F8CBAD")  # optional, from YOUR database
HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
HEADER_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=14, color="1F4E78")
BOLD = Font(bold=True)
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

REQUIRED_FK = "required_fk"
OPTIONAL_FK = "optional_fk"


@dataclass
class Column:
    header: str
    width: int = 14
    kind: str = "text"  # text | int | decimal | date | raw
    note: str = ""


@dataclass
class Sheet:
    name: str
    columns: list[Column]
    rows: list[dict[str, Any]]
    # (row index, header) -> REQUIRED_FK | OPTIONAL_FK
    marks: dict[tuple[int, str], str] = field(default_factory=dict)


@dataclass
class Book:
    file_name: str
    tile: str  # tile label on the Sinkronisasi page
    upload_kind: str  # POST /api/sync/upload/<kind>
    data: Sheet
    instructions: list[str]
    extra_sheets: list[Sheet] = field(default_factory=list)


@dataclass
class Options:
    as_of: date
    company: str | None = None  # fills COMPANY_ID when given
    kamus_demo_codes: bool = False  # fills TECHNICAL_ID with TC 9xx when set


# ── helpers ─────────────────────────────────────────────────────────────────


def months_before(day: date, months: int) -> date:
    y, m = divmod(day.year * 12 + (day.month - 1) - months, 12)
    m += 1
    last = [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
    return date(y, m, min(day.day, last))


def add_months(day: date, months: int) -> date:
    return months_before(day, -months)


def yn(flag: bool) -> str:
    return "Y" if flag else "N"


COMPANY_NOTE = (
    "ISI DARI DATABASE ANDA: Company ID yang AKTIF di Sinkronisasi -> Pemetaan Company ID -> Company "
    "(tabel sync_company_tenant_map). Sama untuk SEMUA baris dan SEMUA berkas."
)


def company_cell(opts: Options) -> str | None:
    return opts.company or None


def mark_company(sheet_rows: list[dict[str, Any]], marks: dict) -> None:
    """COMPANY_ID is yellow on every row, filled or not: it is the one value that must come from YOUR mapping."""
    for i, _ in enumerate(sheet_rows):
        marks[(i, "COMPANY_ID")] = REQUIRED_FK


# ── workbook rendering ──────────────────────────────────────────────────────


def _write_data_sheet(ws, sheet: Sheet) -> None:
    for c, col in enumerate(sheet.columns, start=1):
        cell = ws.cell(row=1, column=c, value=col.header)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(vertical="center")
        cell.border = BOX
        if col.note:
            comment = Comment(col.note, "Data Demo Pulse")
            comment.width = 360
            comment.height = 140
            cell.comment = comment
        ws.column_dimensions[get_column_letter(c)].width = col.width

    for r, row in enumerate(sheet.rows):
        for c, col in enumerate(sheet.columns, start=1):
            value = row.get(col.header)
            cell = ws.cell(row=r + 2, column=c)
            if value is not None and value != "":
                cell.value = value
            # Format even blank cells, so a code typed into a yellow cell stays text.
            if col.kind == "date":
                cell.number_format = "yyyy-mm-dd"
            elif col.kind == "text":
                cell.number_format = "@"
            elif col.kind == "decimal":
                cell.number_format = "0.00"
            mark = sheet.marks.get((r, col.header))
            if mark == REQUIRED_FK:
                cell.fill = YELLOW
            elif mark == OPTIONAL_FK:
                cell.fill = ORANGE
            cell.border = BOX

    ws.freeze_panes = "A2"
    if sheet.rows:
        ws.auto_filter.ref = f"A1:{get_column_letter(len(sheet.columns))}{len(sheet.rows) + 1}"


def _write_instructions(ws, lines: list[str]) -> None:
    ws.column_dimensions["A"].width = 6
    ws.column_dimensions["B"].width = 118
    row = 1
    for line in lines:
        if line.startswith("# "):
            ws.cell(row=row, column=2, value=line[2:]).font = TITLE_FONT
        elif line.startswith("## "):
            ws.cell(row=row, column=2, value=line[3:]).font = BOLD
        elif line.startswith("[KUNING] "):
            ws.cell(row=row, column=1).fill = YELLOW
            ws.cell(row=row, column=2, value=line[len("[KUNING] "):])
        elif line.startswith("[JINGGA] "):
            ws.cell(row=row, column=1).fill = ORANGE
            ws.cell(row=row, column=2, value=line[len("[JINGGA] "):])
        else:
            ws.cell(row=row, column=2, value=line)
        ws.cell(row=row, column=2).alignment = Alignment(wrap_text=True, vertical="top")
        row += 1


def write_book(book: Book, out_dir: Path, as_of: date) -> Path:
    wb = Workbook()
    # Fixed document timestamps: regenerating with the same as-of date must not
    # change the committed bytes.
    stamp = datetime(as_of.year, as_of.month, as_of.day)
    wb.properties.created = stamp
    wb.properties.modified = stamp
    wb.properties.creator = "Pulse demo data generator"
    wb.properties.title = f"Data demo - {book.tile}"
    ws = wb.active
    ws.title = book.data.name
    _write_data_sheet(ws, book.data)
    for extra in book.extra_sheets:
        _write_data_sheet(wb.create_sheet(extra.name), extra)
    _write_instructions(wb.create_sheet("Petunjuk Demo"), book.instructions)
    wb.active = 0
    path = out_dir / book.file_name
    buffer = io.BytesIO()
    wb.save(buffer)
    path.write_bytes(_deterministic_xlsx(buffer.getvalue(), stamp))
    return path


def _deterministic_xlsx(data: bytes, stamp: datetime) -> bytes:
    """Re-pack the workbook with fixed zip entry times and a fixed `modified`
    property: openpyxl stamps both with the wall clock on every save."""
    iso = stamp.strftime("%Y-%m-%dT%H:%M:%SZ")
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            content = src.read(info.filename)
            if info.filename == "docProps/core.xml":
                content = re.sub(rb"(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)",
                                 rb"\g<1>" + iso.encode() + rb"\g<2>", content)
            fixed = zipfile.ZipInfo(info.filename, date_time=stamp.timetuple()[:6])
            fixed.compress_type = zipfile.ZIP_DEFLATED
            dst.writestr(fixed, content)
    return out.getvalue()


# ── shared instruction fragments ────────────────────────────────────────────


def common_header(title: str, tile: str, purpose: list[str]) -> list[str]:
    first, last = ds.npk_range()
    return [
        f"# DATA DEMO (FIKTIF) — {title}",
        "",
        *purpose,
        "",
        "## Cara mengunggah",
        f"Pengaturan -> Sinkronisasi -> kartu unggahan '{tile}' -> seret berkas ini atau klik 'pilih berkas'.",
        "Berkas langsung diproses lalu dihapus dari server; simpan salinan Anda sendiri.",
        "",
        "## Arti warna sel",
        "[KUNING] Wajib diisi dengan nilai dari DATABASE ANDA sebelum diunggah (sengaja dikosongkan).",
        "[JINGGA] Opsional — boleh diisi dengan nilai dari database Anda, boleh dibiarkan kosong.",
        f"Sel lain sudah terisi data fiktif yang saling cocok antar-berkas (NPK {first}-{last}, posisi DM...).",
        "",
    ]


COMPANY_FILL_LINES = [
    "## Mengisi COMPANY_ID (kuning)",
    "Pakai SATU Company ID yang sudah aktif di Sinkronisasi -> 'Pemetaan Company ID -> Company'.",
    "Disarankan membuat pemetaan khusus demo, mis. Company ID 'DEMO' -> Company tujuan, supaya data",
    "demo terpisah dari company asli. Cari nilainya dengan:",
    "    SELECT company_id, tenant_id, label FROM sync_company_tenant_map WHERE is_active;",
    "Cara cepat di Excel: blok semua sel kuning di kolom COMPANY_ID, ketik kodenya, tekan Ctrl+Enter.",
    "Gunakan Company ID yang SAMA di kesepuluh berkas yang punya kolom COMPANY_ID (01-10).",
    "",
]


def footer(order_note: str, expected: str) -> list[str]:
    return [
        "## Urutan",
        order_note,
        "Urutan lengkap ada di demo-data/README.md.",
        "",
        "## Hasil yang diharapkan",
        expected,
        "Unggahan bersifat MEMPERBARUI, tidak pernah menghapus: mengunggah ulang berkas yang sama",
        "menghasilkan '0 baru, N diperbarui'.",
    ]


# ── the twelve books ────────────────────────────────────────────────────────


def employees_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14, note="NPK fiktif 99001-99046."),
        Column("DISPLAY_NAME", 28),
        Column("GRADE_ID", 10, note="Grade 1-13 sesuai tangga di berkas 02-level-grade.xlsx."),
        Column("INTERNAL_TITLE", 42),
        Column("COMPANY_OFFICE", 18),
        Column("IDDIVISION", 12),
        Column("DIVISION", 24),
        Column("IDDEPARTMENT", 14),
        Column("DEPARTMENT", 28),
        Column("IS_BRANCH_HEAD", 16),
        Column("IS_AFC", 10),
        Column("IS_HOMSO", 10),
        Column("ENTRY_DATE", 14, "date"),
    ]
    rows = []
    for e in ds.EMPLOYEES:
        p = e.position
        dep = ds.DEPARTMENTS.get(p.department) if p.department else None
        rows.append({
            "COMPANY_ID": company_cell(opts),
            "EMPLOYEE_ID": e.npk,
            "DISPLAY_NAME": e.name,
            "GRADE_ID": p.grade,
            "INTERNAL_TITLE": p.internal_title,
            "COMPANY_OFFICE": e.office,
            "IDDIVISION": p.division,
            "DIVISION": ds.DIVISIONS[p.division],
            "IDDEPARTMENT": p.department,
            "DEPARTMENT": dep[0] if dep else None,
            "IS_BRANCH_HEAD": "N",
            "IS_AFC": "N",
            "IS_HOMSO": "N",
            "ENTRY_DATE": e.entry,
        })
    marks: dict = {}
    mark_company(rows, marks)
    first, last = ds.npk_range()
    lines = common_header(
        "Data Karyawan", "Data Karyawan",
        [f"{len(rows)} karyawan fiktif di 5 divisi dan 8 departemen. Berkas inilah sumber NPK yang dipakai",
         "semua berkas lain. Division head sengaja tidak punya departemen (kolom departemen kosong = wajar)."],
    ) + [
        "## PENTING — COMPANY_ID di berkas ini tidak divalidasi",
        "Di sumber Data Karyawan, COMPANY_ID BUKAN kolom wajib: baris dengan COMPANY_ID kosong TETAP masuk,",
        "tetapi dengan company kosong sehingga tidak pernah menjadi kandidat. Isi dulu sebelum mengunggah.",
        "Mengunggah berkas ber-COMPANY_ID kosong SETELAH versi yang benar juga mengosongkan company mereka.",
        "",
        *COMPANY_FILL_LINES,
        "## Cek NPK bentrok (sebelum unggah)",
        f"Kunci baris sumber ini hanya EMPLOYEE_ID. Pastikan NPK {first}-{last} belum dipakai karyawan asli:",
        f"    SELECT employee_id, display_name FROM sync_employees WHERE employee_id BETWEEN '{first}' AND '{last}';",
        "Hasil harus kosong. Bila tidak, buat ulang berkas dengan generator: --npk-prefix 98 (lihat README).",
        "",
        *footer(
            "Unggah pertama. Setelahnya jalankan sinkronisasi 'Struktur Org' (Database) supaya Divisi &"
            " Departemen DMDIV../DMDEP.. terbentuk dari berkas ini.",
            f"'{len(rows)} baris Data Karyawan diproses ({len(rows)} baru, 0 diperbarui...)'.",
        ),
    ]
    return Book("01-data-karyawan.xlsx", "Data Karyawan", "employees", Sheet("Employees", cols, rows, marks), lines)


def grade_levels_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("LEVEL_ID", 12),
        Column("LEVEL_NAME", 20),
        Column("GRADE_ID", 10),
    ]
    rows = [
        {"COMPANY_ID": company_cell(opts), "LEVEL_ID": lid, "LEVEL_NAME": name, "GRADE_ID": g}
        for lid, name, grades in ds.GRADE_LEVELS
        for g in grades
    ]
    marks: dict = {}
    mark_company(rows, marks)
    lines = common_header(
        "Level & Grade", "Level & Grade",
        ["Tangga grade demo: STAFF 1-4, SUPERVISOR 5-6, MANAGER 7-8, GENERAL MANAGER 9-10, DIRECTOR 12-13",
         "(tanpa grade 11, seperti tangga asli). Nama level dipakai aplikasi untuk ambang pensiun dan rentang",
         "suksesor 'Tambah massal', jadi nama level di sini sengaja memakai nama baku."],
    ) + [
        *COMPANY_FILL_LINES,
        "## Catatan",
        "LEVEL_ID diawali 'DM-' agar mudah dikenali dan dihapus. Bila Company ID yang Anda pakai adalah company",
        "ASLI yang sudah punya tangga grade dari MSSQL, baris ini akan MENAMBAH level DM-* di sampingnya.",
        "",
        *footer("Boleh diunggah kapan saja (tidak bergantung berkas lain).",
                f"'{len(rows)} baris Level & Grade diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("02-level-grade.xlsx", "Level & Grade", "grade-levels", Sheet("GradeLevels", cols, rows, marks), lines)


AUDIT_CREATED = date(2024, 1, 15)


def positions_master_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("POSITION_ID", 14),
        Column("INTERNAL_TITLE", 42),
        Column("EXTERNAL_TITLE", 36),
        Column("SUMMARY", 60),
        Column("GRADE_ID", 10),
        Column("POS_LEVEL_NO", 13, "int"),
        Column("VALID_FROM", 13, "date"),
        Column("VALID_TO", 13, "date"),
        Column("CREATE_BY", 12),
        Column("CREATE_DATE", 13, "date"),
        Column("MODI_BY", 12),
        Column("MODI_DATE", 13, "date"),
    ]
    rows = []
    for p in ds.POSITIONS:
        rows.append({
            "COMPANY_ID": company_cell(opts),
            "POSITION_ID": p.code,
            "INTERNAL_TITLE": p.internal_title,
            "EXTERNAL_TITLE": p.external_title,
            "SUMMARY": p.summary,
            "GRADE_ID": p.grade,
            "POS_LEVEL_NO": p.level_no,
            "VALID_FROM": p.valid_from,
            "VALID_TO": p.valid_to,
            "CREATE_BY": "system",
            "CREATE_DATE": AUDIT_CREATED,
            "MODI_BY": "system" if p.valid_to else None,
            "MODI_DATE": date(2022, 1, 3) if p.valid_to else None,
        })
    marks: dict = {}
    mark_company(rows, marks)
    lines = common_header(
        "Master Jabatan", "Master Jabatan",
        [f"{len(rows)} posisi demo berkode DMxxxxxxxx (bentuk sama dengan kode asli seperti CS20000100).",
         "DM04060099 'Programmer' adalah jabatan LAMA (VALID_TO 2021-12-31): tetap tampil di riwayat karier,",
         "tetapi tidak pernah menjadi posisi saat ini.",
         "Treasury & Tax Department Head (DM02040001) sengaja KOSONG sejak pemegangnya naik jabatan — target",
         "suksesi yang bagus untuk demo."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah sebelum Hierarki Jabatan dan Penempatan Karyawan.",
                f"'{len(rows)} baris Master Jabatan diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("03-master-jabatan.xlsx", "Master Jabatan", "positions-master", Sheet("Positions", cols, rows, marks), lines)


def positions_hierarchy_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("POSITION_ID", 14),
        Column("PARENT_POSITION_ID", 20, note=(
            "Atasan langsung. Kosong = puncak pohon demo. OPSIONAL (jingga): isi dengan POSITION_ID atasan ASLI "
            "di database Anda bila struktur demo ingin digantung di bawah posisi nyata (mis. direktur).")),
        Column("VALID_FROM", 13, "date"),
        Column("VALID_TO", 13, "date"),
        Column("CREATE_BY", 12),
        Column("CREATE_DATE", 13, "date"),
        Column("MODI_BY", 12),
        Column("MODI_DATE", 13, "date"),
    ]
    rows = []
    marks: dict = {}
    for i, p in enumerate(ds.POSITIONS):
        rows.append({
            "COMPANY_ID": company_cell(opts),
            "POSITION_ID": p.code,
            "PARENT_POSITION_ID": p.parent,
            "VALID_FROM": p.valid_from,
            "VALID_TO": p.valid_to,
            "CREATE_BY": "system",
            "CREATE_DATE": AUDIT_CREATED,
            "MODI_BY": None,
            "MODI_DATE": None,
        })
        if p.parent is None:
            marks[(i, "PARENT_POSITION_ID")] = OPTIONAL_FK
    mark_company(rows, marks)
    roots = [p.code for p in ds.POSITIONS if p.parent is None]
    lines = common_header(
        "Hierarki Jabatan", "Hierarki Jabatan",
        ["Satu baris per posisi demo: siapa atasan langsungnya. Lima division head adalah puncak pohon demo",
         f"({', '.join(roots)}) sehingga PARENT_POSITION_ID-nya kosong."],
    ) + [
        *COMPANY_FILL_LINES,
        "## PARENT_POSITION_ID (jingga, opsional)",
        "Biarkan kosong untuk lima pohon terpisah, atau isi dengan POSITION_ID atasan ASLI di database Anda:",
        "    SELECT position_id, internal_title FROM sync_positions",
        "     WHERE company_id = '<Company ID Anda>' AND (valid_to IS NULL OR valid_to >= now());",
        "",
        *footer("Unggah setelah Master Jabatan.",
                f"'{len(rows)} baris Hierarki Jabatan diproses ({len(rows)} baru, 0 diperbarui)'. "
                "Lihat hasilnya di Posisi -> Struktur Posisi."),
    ]
    return Book("04-hierarki-jabatan.xlsx", "Hierarki Jabatan", "positions-hierarchy", Sheet("Hierarchy", cols, rows, marks), lines)


def positions_employees_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("POSITION_ID", 14),
        Column("PRIMARY_POSITION", 18),
        Column("VALID_FROM", 13, "date"),
        Column("VALID_TO", 13, "date"),
        Column("CREATE_BY", 12),
        Column("CREATE_DATE", 13, "date"),
        Column("MODI_BY", 12),
        Column("MODI_DATE", 13, "date"),
    ]
    rows = []
    for e in ds.EMPLOYEES:
        for s in sorted(e.stints, key=lambda s: s.start):
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "POSITION_ID": s.position,
                "PRIMARY_POSITION": yn(s.primary),
                "VALID_FROM": s.start,
                "VALID_TO": s.end,
                "CREATE_BY": "system",
                "CREATE_DATE": s.start,
                "MODI_BY": "system" if s.end else None,
                "MODI_DATE": s.end + timedelta(days=1) if s.end else None,
            })
    marks: dict = {}
    mark_company(rows, marks)
    multi = sorted({e.current.position for e in ds.EMPLOYEES if len(ds.holders_of(e.current.position)) > 1})
    acting = [(e, s) for e in ds.EMPLOYEES for s in e.stints if not s.primary]
    acting_lines = [
        f"{e.name} ({e.npk}) adalah Plt. {ds.POSITION_BY_CODE[s.position].internal_title}: barisnya PRIMARY_POSITION = N,"
        for e, s in acting
    ]
    lines = common_header(
        "Penempatan Karyawan", "Penempatan Karyawan",
        [f"{len(rows)} baris penempatan untuk {len(ds.EMPLOYEES)} karyawan, termasuk RIWAYAT jabatan lama (VALID_TO terisi)",
         "yang menjadi bahan aspek karier dan Riwayat Posisi kandidat.",
         f"Posisi dengan beberapa pemegang sekaligus: {', '.join(multi)}.",
         *acting_lines,
         "jadi tidak pernah menjadi posisi saat ini (kandidat hanya dibentuk dari baris PRIMARY_POSITION = Y yang aktif)."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah setelah Data Karyawan dan Master Jabatan.",
                f"'{len(rows)} baris Penempatan Karyawan diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("05-penempatan-karyawan.xlsx", "Penempatan Karyawan", "positions-employees",
                Sheet("EmployeePositions", cols, rows, marks), lines)


def positions_competencies_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("COMPANY_OFFICE", 18),
        Column("COST_CENTER", 13),
        Column("ORG_ID", 10),
        Column("POSITION_ID", 14),
        Column("GRADE_ID", 10),
        Column("TECHNICAL_ID", 14, note=(
            "ISI DARI DATABASE ANDA: kode kompetensi di Kamus Kompetensi (sync_kamus_kompetensi.code), mis. 'TC 012'. "
            "Lihat sheet 'Kode Kompetensi'. Bila Anda mengunggah kamus demo, kodenya TC 901-TC 914.")),
        Column("TECHNICAL_NAME", 44),
        Column("PROFICIENCY_ID", 15),
        Column("PROFICIENCY_NAME", 18),
        Column("SCORE", 8, "int"),
        Column("CURRENT_PROFICIENCY_ID", 22),
        Column("CURRENT_PROFICIENCY_NAME", 24),
        Column("CURRENT_SCORE", 14, "int"),
        Column("GAP", 8, "int"),
        Column("IS_ACTIVE", 10),
        Column("CREATE_BY", 12),
        Column("CREATE_DATE", 13, "date"),
        Column("MODI_BY", 12),
        Column("MODI_DATE", 13, "date"),
    ]
    rows = []
    marks: dict = {}
    for e in ds.EMPLOYEES:
        p = e.position
        for key, demanded in p.competencies:
            code, name = ds.COMPETENCIES[key]
            attained = max(1, min(4, demanded + e.competency_delta))
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "COMPANY_OFFICE": e.office,
                "COST_CENTER": None,
                "ORG_ID": None,
                "POSITION_ID": p.code,
                "GRADE_ID": p.grade,
                "TECHNICAL_ID": code if opts.kamus_demo_codes else None,
                "TECHNICAL_NAME": name,
                "PROFICIENCY_ID": ds.PROFICIENCY[demanded][0],
                "PROFICIENCY_NAME": ds.PROFICIENCY[demanded][1],
                "SCORE": demanded,
                "CURRENT_PROFICIENCY_ID": ds.PROFICIENCY[attained][0],
                "CURRENT_PROFICIENCY_NAME": ds.PROFICIENCY[attained][1],
                "CURRENT_SCORE": attained,
                "GAP": attained - demanded,
                "IS_ACTIVE": "Y",
                "CREATE_BY": "system",
                "CREATE_DATE": AUDIT_CREATED,
                "MODI_BY": None,
                "MODI_DATE": None,
            })
            marks[(len(rows) - 1, "TECHNICAL_ID")] = REQUIRED_FK
    mark_company(rows, marks)

    used = sorted({k for e in ds.EMPLOYEES for k, _ in e.position.competencies}, key=lambda k: ds.COMPETENCIES[k][0])
    map_cols = [
        Column("TECHNICAL_NAME", 46),
        Column("KODE_DI_KAMUS_DEMO", 20, note="Kode bila Anda mengunggah 13-kamus-kompetensi-demo.pdf."),
        Column("KODE_DI_KAMUS_ANDA", 22, note="Isi dengan kode kompetensi yang paling sesuai dari kamus Anda."),
        Column("JUMLAH_BARIS", 14, "int"),
    ]
    map_rows = []
    map_marks: dict = {}
    for key in used:
        code, name = ds.COMPETENCIES[key]
        n = sum(1 for r in rows if r["TECHNICAL_NAME"] == name)
        map_rows.append({"TECHNICAL_NAME": name, "KODE_DI_KAMUS_DEMO": code, "KODE_DI_KAMUS_ANDA": None, "JUMLAH_BARIS": n})
        map_marks[(len(map_rows) - 1, "KODE_DI_KAMUS_ANDA")] = REQUIRED_FK
    mapping = Sheet("Kode Kompetensi", map_cols, map_rows, map_marks)

    lines = common_header(
        "Kompetensi Teknis", "Kompetensi Teknis",
        [f"{len(rows)} baris: kompetensi teknis tiap karyawan untuk posisinya saat ini, dengan level yang DITUNTUT",
         "jabatan (PROFICIENCY_*, SCORE) dan level yang DICAPAI karyawan (CURRENT_*, CURRENT_SCORE).",
         f"Memakai {len(used)} kompetensi; daftarnya ada di sheet 'Kode Kompetensi'."],
    ) + [
        *COMPANY_FILL_LINES,
        "## Mengisi TECHNICAL_ID (kuning) — WAJIB, baris tanpa kode akan DILEWATI",
        "TECHNICAL_ID adalah kode di Kamus Kompetensi database Anda. Dua pilihan:",
        "  a) Kamus ASLI Anda: di sheet 'Kode Kompetensi' isi kolom KODE_DI_KAMUS_ANDA untuk tiap nama, dengan",
        "     kode yang paling sesuai. Cari dengan:",
        "         SELECT code, name FROM sync_kamus_kompetensi ORDER BY code;",
        "     Lalu di sel TECHNICAL_ID baris 2 ketik  =VLOOKUP(I2,'Kode Kompetensi'!A:C,3,FALSE) , isi ke bawah,",
        "     lalu Salin -> Tempel Spesial -> Nilai. (Opsional: ganti juga TECHNICAL_NAME dengan nama di kamus Anda.)",
        "  b) Kamus DEMO: pakai kolom KODE_DI_KAMUS_DEMO (TC 901-TC 914) dengan rumus yang sama tetapi kolom ke-2:",
        "         =VLOOKUP(I2,'Kode Kompetensi'!A:B,2,FALSE)",
        "     dan unggah juga 13-kamus-kompetensi-demo.pdf di kartu 'Kamus Kompetensi' (urutannya bebas: kode",
        "     di berkas ini tidak divalidasi saat unggah, tetapi baru bermakna setelah kamusnya ada).",
        "COST_CENTER dan ORG_ID sengaja kosong (opsional, tidak dipakai aplikasi).",
        "",
        *footer("Unggah setelah Data Karyawan dan Master Jabatan.",
                f"'{len(rows)} baris Kompetensi Teknis diproses ({len(rows)} baru, 0 diperbarui)'. Bila TECHNICAL_ID"
                f" belum diisi: 'Tidak ada baris valid ... {len(rows)} baris dilewati karena kolom wajib kosong'."),
    ]
    return Book("06-kompetensi-teknis.xlsx", "Kompetensi Teknis", "positions-competencies",
                Sheet("TechCompetency", cols, rows, marks), lines, [mapping])


def performance_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("COMPANY_OFFICE", 18),
        Column("COST_CENTER", 13),
        Column("ORG_ID", 10),
        Column("POSITION_ID", 14),
        Column("GRADE_ID", 10),
        Column("SEQ", 6, "int"),
        Column("TAHUN", 8, "int"),
        Column("S1", 6),
        Column("S2", 6),
        Column("PROMOSI", 44),
        Column("IS_PRINT_REPORT", 16),
        Column("CREATE_BY", 12),
        Column("CREATE_DATE", 13, "date"),
        Column("MODI_BY", 12),
        Column("MODI_DATE", 13, "date"),
    ]
    year = opts.as_of.year
    rows = []
    for e in ds.EMPLOYEES:
        for offset in sorted(e.pa):
            s1, s2 = e.pa[offset]
            if s1 is None and s2 is None:
                continue
            tahun = year + offset
            held = ds.position_held_on(e, date(tahun, 6, 30))
            created = date(tahun, 7, 31) if s2 is None else date(tahun, 12, 31)
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "COMPANY_OFFICE": e.office,
                "COST_CENTER": None,
                "ORG_ID": None,
                "POSITION_ID": held.code,
                "GRADE_ID": held.grade,
                "SEQ": 1,
                "TAHUN": tahun,
                "S1": s1,
                "S2": s2,
                "PROMOSI": e.promotion_note.get(offset),
                "IS_PRINT_REPORT": "Y" if s2 is not None else "N",
                "CREATE_BY": "system",
                "CREATE_DATE": created,
                "MODI_BY": None,
                "MODI_DATE": None,
            })
    marks: dict = {}
    mark_company(rows, marks)
    window = f"{year - 3}-{year - 1}"
    lines = common_header(
        "Penilaian Kinerja", "Penilaian Kinerja",
        [f"{len(rows)} baris PA tahun {year - 4}-{year} (SEQ 1 per tahun). Tahun {year} baru berisi S1.",
         f"Sinkronisasi kandidat membaca tiga tahun terakhir ({window}) sebagai performance_grade enam periode,",
         "yang menjadi sumbu kinerja HAV dan aturan PA program. Variasi sengaja dibuat: A/B konsisten, ada C,",
         "ada D/E (memaksa kinerja Low), karyawan baru tanpa PA, dan satu karyawan yang PA-nya hanya ada",
         f"sampai {year - 5} (di luar jendela -> belum terpetakan di Talent Mapping)."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah sebelum sinkronisasi Kandidat.",
                f"'{len(rows)} baris Penilaian Kinerja diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("07-penilaian-kinerja.xlsx", "Penilaian Kinerja", "performance",
                Sheet("PerformanceAppraisal", cols, rows, marks), lines)


def behavior_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("REKOMENDASI_NAME", 44, note=(
            "Kosakata baku DVP_MASTER_REKOMENDASI (STRENGTH, VERY HIGH, READY, POTENSI, NOT READY, ...). "
            "Label di luar kosakata ini tidak bisa dipetakan ke HAV.")),
        Column("KETERANGAN", 64),
        Column("TGL_PELAKSANAAN", 17, "date"),
    ]
    rows = []
    for e in ds.EMPLOYEES:
        for a in sorted(e.assessments, key=lambda a: a.held):
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "REKOMENDASI_NAME": a.recommendation,
                "KETERANGAN": a.note,
                "TGL_PELAKSANAAN": a.held,
            })
    marks: dict = {}
    mark_company(rows, marks)
    people = len({r["EMPLOYEE_ID"] for r in rows})
    dupes = len(rows) - people
    without = [e.npk for e in ds.EMPLOYEES if not e.assessments]
    lines = common_header(
        "Kompetensi Perilaku", "Kompetensi Perilaku",
        [f"{len(rows)} baris assessment untuk {people} karyawan. {dupes} karyawan punya assessment lama dan baru:",
         "sistem menyimpan yang TERBARU saja, jadi hasil unggahan menyebut baris duplikat yang digabung.",
         f"Tanpa assessment (sengaja): {', '.join(without)} -> HAV rumus tidak bisa dihitung untuk mereka.",
         "Semua kategori memakai kosakata baku, termasuk tiga kategori terbawah (NOT READY, VERY LOW,",
         "BELUM ADA POTENSI) yang menggugurkan aturan Behavior."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah sebelum sinkronisasi Kandidat.",
                f"'{people} baris Kompetensi Perilaku diproses ({people} baru, 0 diperbarui, {dupes} baris duplikat"
                f" digabung)' — {len(rows)} baris di berkas, {people} karyawan tersimpan."),
    ]
    return Book("08-kompetensi-perilaku.xlsx", "Kompetensi Perilaku", "behavior-competencies",
                Sheet("Behavior", cols, rows, marks), lines)


def disciplinary_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("DISPLAY_NAME", 24),
        Column("DISCIPLINARY_NO", 16, "int"),
        Column("INCIDENT_DATE", 15, "date"),
        Column("VIOLATION", 54),
        Column("VIOLATION_DEGREE", 17, "int"),
        Column("VIOLATION_TYPE", 15, "int"),
        Column("WARNING_LEVEL", 15, "int", note=(
            "Angka. Cara sinkronisasi kandidat membacanya: 1 = ST (tetap lolos), 2 = SP (masih berlaku -> "
            "ACTIVE_SP; berakhir < 2 tahun -> SP_UNDER_2_YEARS), 3 = SP3, 5 = SP First/Last. Level 2 yang "
            "berakhir > 2 tahun lalu dianggap CLEAR.")),
        Column("EFFECT_VIOLATION", 30),
        Column("ADVICE_GIVEN", 36),
        Column("SANCTION_GIVEN", 28),
        Column("LETTER_NO", 22),
        Column("DATE_ISSUE", 13, "date"),
        Column("EXPIRY_DATE", 13, "date"),
        Column("DISCIPLINARY_NOTE", 30),
    ]
    rows = []
    serial = 0
    for e in ds.EMPLOYEES:
        for no, d in enumerate(sorted(e.discipline, key=lambda d: -d.issued_months_ago), start=1):
            serial += 1
            issued = months_before(opts.as_of, d.issued_months_ago)
            expiry = add_months(issued, d.valid_months) - timedelta(days=1)
            kind = {1: "ST", 2: "SP2", 3: "SP3", 5: "SPFL"}.get(d.warning_level, "SP")
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "DISPLAY_NAME": e.name,
                "DISCIPLINARY_NO": no,
                "INCIDENT_DATE": issued - timedelta(days=7),
                "VIOLATION": d.violation,
                "VIOLATION_DEGREE": d.degree,
                "VIOLATION_TYPE": d.vtype,
                "WARNING_LEVEL": d.warning_level,
                "EFFECT_VIOLATION": d.effect,
                "ADVICE_GIVEN": d.advice,
                "SANCTION_GIVEN": d.sanction,
                "LETTER_NO": f"{serial:03d}/DMO-HC/{kind}/{issued.year}",
                "DATE_ISSUE": issued,
                "EXPIRY_DATE": expiry,
                "DISCIPLINARY_NOTE": d.note,
            })
    marks: dict = {}
    mark_company(rows, marks)
    meaning = {
        "ST": "ST (warning 1): tetap lolos aturan disiplin.",
        "SP_UNDER_2_YEARS": "SP berakhir < 2 tahun lalu (SP_UNDER_2_YEARS): gugur, keluar dari peta Talent Mapping.",
        "CLEAR": "SP berakhir > 2 tahun lalu: dianggap CLEAR, tetap lolos.",
        "SP3": "SP3: gugur walau kinerjanya baik.",
        "ACTIVE_SP": "SP masih berlaku (ACTIVE_SP): gugur.",
    }
    cases = [f"  {e.npk} {e.name.split()[0]:<8} -> {meaning[e.expect_discipline]}" for e in ds.EMPLOYEES if e.discipline]
    lines = common_header(
        "Catatan Disiplin", "Catatan Disiplin",
        [f"{len(rows)} catatan untuk {len({r['EMPLOYEE_ID'] for r in rows})} karyawan; karyawan lain bersih (CLEAR).",
         "Setiap kategori status disiplin terwakili:",
         *cases,
         f"Tanggal surat dihitung mundur dari {opts.as_of.isoformat()} supaya kategorinya tetap seperti di atas."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah sebelum sinkronisasi Kandidat.",
                f"'{len(rows)} baris Catatan Disiplin diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("09-catatan-disiplin.xlsx", "Catatan Disiplin", "disciplinary", Sheet("Disciplinary", cols, rows, marks), lines)


def education_book(opts: Options) -> Book:
    cols = [
        Column("COMPANY_ID", 14, note=COMPANY_NOTE),
        Column("EMPLOYEE_ID", 14),
        Column("DISPLAY_NAME", 24),
        Column("EDUCATION_LEVEL", 16),
        Column("EDUCATION_LEVEL_RANK", 21, "int", note="SMA/SMK 3, D3 6, S1 8, S2 9 — pendidikan TERTINGGI dipilih dari angka ini."),
        Column("EDUCATION_FIELD", 26),
        Column("INSTITUTION_NAME", 38),
        Column("INSTITUTION_LOCATION", 20),
        Column("START_YEAR", 11, "int"),
        Column("END_YEAR", 10, "int"),
        Column("GPA", 7, "decimal"),
        Column("ACHIEVEMENT", 16),
        Column("EDUCATION_NOTE", 18),
    ]
    rows = []
    for e in ds.EMPLOYEES:
        for ed in e.education:
            rows.append({
                "COMPANY_ID": company_cell(opts),
                "EMPLOYEE_ID": e.npk,
                "DISPLAY_NAME": e.name,
                "EDUCATION_LEVEL": ed.level,
                "EDUCATION_LEVEL_RANK": ds.EDU_RANK[ed.level],
                "EDUCATION_FIELD": ed.major,
                "INSTITUTION_NAME": ed.institution,
                "INSTITUTION_LOCATION": ed.location,
                "START_YEAR": ed.start_year,
                "END_YEAR": ed.end_year,
                "GPA": ed.gpa,
                "ACHIEVEMENT": ed.achievement,
                "EDUCATION_NOTE": None,
            })
    marks: dict = {}
    mark_company(rows, marks)
    two = [e.npk for e in ds.EMPLOYEES if len(e.education) > 1]
    lines = common_header(
        "Riwayat Pendidikan", "Riwayat Pendidikan",
        [f"{len(rows)} riwayat pendidikan. Karyawan dengan dua jenjang ({', '.join(two)}) menunjukkan bahwa yang",
         "dipakai kandidat adalah jenjang dengan EDUCATION_LEVEL_RANK tertinggi. Nama institusi adalah kampus nyata,",
         "tetapi orang dan nilainya fiktif. GPA kosong untuk lulusan SMK."],
    ) + [
        *COMPANY_FILL_LINES,
        *footer("Unggah sebelum sinkronisasi Kandidat.",
                f"'{len(rows)} baris Riwayat Pendidikan diproses ({len(rows)} baru, 0 diperbarui)'."),
    ]
    return Book("10-riwayat-pendidikan.xlsx", "Riwayat Pendidikan", "education", Sheet("Education", cols, rows, marks), lines)


def mcu_book(opts: Options) -> Book:
    cols = [
        Column("NPK", 12),
        Column("Nama", 28),
        Column("Kesimpulan", 18, note="Fit / Fit With Note / Unfit (header harus persis 'Kesimpulan')."),
        Column("Keterangan", 80),
    ]
    rows = [
        {"NPK": e.npk, "Nama": e.name, "Kesimpulan": e.mcu[0], "Keterangan": e.mcu[1]}
        for e in ds.EMPLOYEES
        if e.mcu is not None
    ]
    missing = [e.npk for e in ds.EMPLOYEES if e.mcu is None]
    unfit = [e.npk for e in ds.EMPLOYEES if e.mcu and e.mcu[0] == "Unfit"]
    note = [e.npk for e in ds.EMPLOYEES if e.mcu and e.mcu[0] == "Fit With Note"]
    lines = [
        "# DATA DEMO (FIKTIF) — Status MCU",
        "",
        f"{len(rows)} karyawan: Fit, Fit With Note ({', '.join(note)}) dan Unfit ({', '.join(unfit)}).",
        f"Tanpa baris MCU (sengaja): {', '.join(missing)} -> kandidat memakai status bawaan 'fit'.",
        "Aturan MCU di program bersifat ADVISORY: kandidat Unfit hanya DITANDAI, tidak digugurkan.",
        "Berkas ini tidak punya kolom yang merujuk ke database, jadi tidak ada sel kuning.",
        "",
        "## Cara mengunggah",
        "Pengaturan -> Sinkronisasi -> kartu 'Status MCU'. Sheet data HARUS tetap menjadi sheet PERTAMA dan nama",
        "header harus persis NPK / Nama / Kesimpulan / Keterangan (huruf besar/kecil berpengaruh).",
        "",
        "## Urutan",
        "Unggah SEBELUM sinkronisasi Kandidat: status MCU baru masuk ke kandidat saat sinkronisasi Kandidat berjalan.",
        "Bila diunggah sesudahnya, jalankan sinkronisasi Kandidat sekali lagi.",
        "",
        "## Hasil yang diharapkan",
        f"'{len(rows)} record MCU diproses ({len(rows)} baru, 0 diperbarui)'.",
    ]
    return Book("11-status-mcu.xlsx", "Status MCU", "mcu", Sheet("MCU", cols, rows), lines)


def hav_book(opts: Options) -> Book:
    cols = [
        Column("NPK", 12),
        Column("NAMA", 28),
        Column("Quadrant", 12, "raw", note="Angka 1-16. Teks seperti 'Kuadran 2' juga diterima: angka pertamanya yang diambil."),
    ]
    rows = []
    for e in ds.EMPLOYEES:
        if e.hav_upload is None:
            continue
        q: Any = int(e.hav_upload) if e.hav_upload.isdigit() else e.hav_upload
        rows.append({"NPK": e.npk, "NAMA": e.name, "Quadrant": q})
    differs = [e.npk for e in ds.EMPLOYEES if e.hav_upload and e.expect_formula is not None and e.expect_hav != e.expect_formula]
    lines = [
        "# DATA DEMO (FIKTIF) — HAV Quadrant",
        "",
        f"{len(rows)} karyawan dengan kuadran HAV hasil kalibrasi HR. Karyawan lain mendapat HAV dari RUMUS",
        "(PA x assessment perilaku) — Talent Mapping menampilkan keduanya beserta sumbernya.",
        f"Unggahan yang BERBEDA dari hasil rumus (kalibrasi HR): {', '.join(differs)}.",
        "Satu baris sengaja ditulis 'Kuadran 2' (teks) untuk menunjukkan bahwa angka pertamanya yang diambil.",
        "Berkas ini tidak punya kolom yang merujuk ke database, jadi tidak ada sel kuning.",
        "",
        "## Cara mengunggah",
        "Pengaturan -> Sinkronisasi -> kartu 'HAV Quadrant'. Nama sheet data HARUS 'ALL' dan header persis",
        "NPK / NAMA / Quadrant (huruf besar/kecil berpengaruh).",
        "",
        "## Urutan",
        "Paling menarik diunggah SETELAH sinkronisasi Kandidat: kuadran yang berubah langsung diterapkan ke",
        "kandidat saat itu juga dan pesannya menyebut berapa kandidat diperbarui.",
        "",
        "## Hasil yang diharapkan",
        f"'{len(rows)} record HAV diproses ({len(rows)} baru, 0 diperbarui). {len(rows)} kuadran berubah: ... kandidat",
        "langsung diperbarui'. Mengunggah ulang berkas yang sama: '0 kuadran berubah'.",
    ]
    return Book("12-hav-quadrant.xlsx", "HAV Quadrant", "hav", Sheet("ALL", cols, rows), lines)


BOOK_BUILDERS: list[Callable[[Options], Book]] = [
    employees_book,
    grade_levels_book,
    positions_master_book,
    positions_hierarchy_book,
    positions_employees_book,
    positions_competencies_book,
    performance_book,
    behavior_book,
    disciplinary_book,
    education_book,
    mcu_book,
    hav_book,
]


def write_all(out_dir: Path, opts: Options) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    return [write_book(builder(opts), out_dir, opts.as_of) for builder in BOOK_BUILDERS]
