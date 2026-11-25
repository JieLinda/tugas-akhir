"""The fictional organisation behind every demo file.

Everything the Excel workbooks and PDFs contain is derived from the tables in
this module, so the twelve workbooks agree with each other by construction:
an NPK in the HAV file is an NPK in the employee file, a POSITION_ID in the
placement file is a seat in the position master, and so on.

What is deliberately NOT here is anything that must point at data which
already lives in the target database and which this dataset does not create:

  * COMPANY_ID  -> must match an active row of sync_company_tenant_map
                   (Sinkronisasi -> "Pemetaan Company ID -> Company").
  * TECHNICAL_ID -> must match sync_kamus_kompetensi.code (the kamus).

Those cells are written blank (and highlighted) unless the generator is given
explicit values on the command line.

Identifiers are chosen so they cannot be mistaken for real data and are easy
to remove afterwards (demo-data/sql/hapus-data-demo.sql):

  * NPK            99001-99046 (five digits, no leading zero: the sync joins
                   pad to five characters with LPAD, which TRUNCATES longer ids)
  * POSITION_ID    DMxxxxxxxx (same shape as the real CS20000100 codes)
  * division/dept  DMDIVxx / DMDEPxx
  * level ids      DM-STF, DM-SPV, ...
  * kamus codes    TC 901-TC 914 (the real dictionary stops far below 900)

Dates that decide a rule (disciplinary expiry, the three appraisal years the
candidate sync reads) are RELATIVE to the generation date, so regenerating the
files later keeps every person in the category they were designed for.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

# ── Competencies (technical) ────────────────────────────────────────────────
# key -> (code in the DEMO kamus PDF, name). The names are used verbatim in the
# demo kamus, in the TECHNICAL_NAME column and in the job-profile PDFs, so the
# kamus code identity resolves exactly when the demo kamus is used.

COMPETENCIES: dict[str, tuple[str, str]] = {
    "RETAIL": ("TC 901", "MOTORCYCLE RETAIL SALES PLANNING"),
    "DEALER": ("TC 902", "DEALER NETWORK RELATIONSHIP MANAGEMENT"),
    "MARCOM": ("TC 903", "INTEGRATED MARKETING CAMPAIGN PLANNING"),
    "FINREP": ("TC 904", "FINANCIAL CLOSING AND REPORTING"),
    "TAX": ("TC 905", "CORPORATE TAX COMPLIANCE"),
    "TREASURY": ("TC 906", "TREASURY AND CASH FLOW MANAGEMENT"),
    "LEARNING": ("TC 907", "LEARNING PROGRAM DESIGN AND EVALUATION"),
    "TALENT": ("TC 908", "TALENT REVIEW AND SUCCESSION PLANNING"),
    "APPDEV": ("TC 909", "APPLICATION DEVELOPMENT LIFE CYCLE"),
    "SYSINT": ("TC 910", "ENTERPRISE SYSTEM INTEGRATION"),
    "SERVICE": ("TC 911", "MOTORCYCLE SERVICE QUALITY ASSURANCE"),
    "SPAREPART": ("TC 912", "SPARE PART DEMAND AND INVENTORY PLANNING"),
    "BUDGET": ("TC 913", "OPERATIONAL BUDGET PLANNING AND CONTROL"),
    "DATA": ("TC 914", "BUSINESS DATA ANALYSIS AND REPORTING"),
}

# The level vocabulary the template documents (PROFICIENCY_* / CURRENT_*).
PROFICIENCY = {1: ("P1", "Basic"), 2: ("P2", "Intermediate"), 3: ("P3", "Advance"), 4: ("P4", "Mastery")}

# ── Organisation ────────────────────────────────────────────────────────────

DIVISIONS: dict[str, str] = {
    "DMDIV01": "Sales & Marketing",
    "DMDIV02": "Finance & Accounting",
    "DMDIV03": "Human Capital",
    "DMDIV04": "Information Technology",
    "DMDIV05": "After Sales Service",
}

# department id -> (name, division id)
DEPARTMENTS: dict[str, tuple[str, str]] = {
    "DMDEP01": ("Retail Sales", "DMDIV01"),
    "DMDEP02": ("Marketing Communication", "DMDIV01"),
    "DMDEP03": ("Accounting", "DMDIV02"),
    "DMDEP04": ("Treasury & Tax", "DMDIV02"),
    "DMDEP05": ("People Development", "DMDIV03"),
    "DMDEP06": ("IT Application Development", "DMDIV04"),
    "DMDEP07": ("Technical Service", "DMDIV05"),
    "DMDEP08": ("Spare Parts", "DMDIV05"),
}

# The grade ladder (Level & Grade). Mirrors the shape the app expects:
# STAFF 1-4, SUPERVISOR 5-6, MANAGER 7-8, GENERAL MANAGER 9-10, DIRECTOR 12-13
# (no grade 11, as in the real ladder). Level NAMES are what the app keys on
# (retirement thresholds, bulk-add successor ranges), so they are the real ones.
GRADE_LEVELS: list[tuple[str, str, list[str]]] = [
    ("DM-STF", "STAFF", ["1", "2", "3", "4"]),
    ("DM-SPV", "SUPERVISOR", ["5", "6"]),
    ("DM-MGR", "MANAGER", ["7", "8"]),
    ("DM-GM", "GENERAL MANAGER", ["9", "10"]),
    ("DM-DIR", "DIRECTOR", ["12", "13"]),
]

POSITIONS_VALID_FROM = date(2000, 1, 1)


@dataclass(frozen=True)
class Position:
    code: str
    internal_title: str
    external_title: str
    grade: str
    level_no: int  # 2 = division head ... 5 = staff (template: smaller = more senior)
    division: str
    department: str | None
    parent: str | None  # None = top of the demo tree (PARENT_POSITION_ID left blank)
    summary: str
    competencies: tuple[tuple[str, int], ...]  # (competency key, level the JOB demands)
    valid_from: date = POSITIONS_VALID_FROM
    valid_to: date | None = None


POSITIONS: list[Position] = [
    # ── Sales & Marketing ──
    Position("DM01000001", "Sales & Marketing Division Head", "Head of Sales & Marketing", "10", 2, "DMDIV01", None, None,
             "Memimpin strategi penjualan ritel dan pemasaran sepeda motor di seluruh area penjualan.",
             (("RETAIL", 4), ("DEALER", 4), ("BUDGET", 4), ("DATA", 3))),
    Position("DM01010001", "Retail Sales Department Head", "Retail Sales Manager", "8", 3, "DMDIV01", "DMDEP01", "DM01000001",
             "Mengelola pencapaian target penjualan ritel dan kinerja area penjualan.",
             (("RETAIL", 3), ("DEALER", 3), ("BUDGET", 3), ("DATA", 3))),
    Position("DM01010011", "Area Sales Supervisor Surabaya", "Area Sales Supervisor", "6", 4, "DMDIV01", "DMDEP01", "DM01010001",
             "Mengawasi pencapaian penjualan dan aktivitas tenaga penjualan area Surabaya.",
             (("RETAIL", 3), ("DEALER", 2), ("DATA", 2))),
    Position("DM01010012", "Area Sales Supervisor Malang", "Area Sales Supervisor", "5", 4, "DMDIV01", "DMDEP01", "DM01010001",
             "Mengawasi pencapaian penjualan dan aktivitas tenaga penjualan area Malang.",
             (("RETAIL", 3), ("DEALER", 2), ("DATA", 2))),
    Position("DM01010013", "Sales Operation Supervisor", "Sales Operation Supervisor", "6", 4, "DMDIV01", "DMDEP01", "DM01010001",
             "Mengelola administrasi, data, dan alokasi unit penjualan ritel.",
             (("RETAIL", 2), ("DATA", 3), ("BUDGET", 2))),
    Position("DM01010021", "Sales Counter Staff Surabaya", "Sales Counter Officer", "2", 5, "DMDIV01", "DMDEP01", "DM01010011",
             "Melayani konsumen dan memproses transaksi penjualan di area Surabaya.",
             (("RETAIL", 2), ("DEALER", 1))),
    Position("DM01010022", "Sales Administration Staff", "Sales Administration Officer", "3", 5, "DMDIV01", "DMDEP01", "DM01010013",
             "Mengelola dokumen dan data transaksi penjualan.",
             (("DATA", 2), ("RETAIL", 1))),
    Position("DM01010023", "Sales Counter Staff Malang", "Sales Counter Officer", "2", 5, "DMDIV01", "DMDEP01", "DM01010012",
             "Melayani konsumen dan memproses transaksi penjualan di area Malang.",
             (("RETAIL", 2), ("DEALER", 1))),
    Position("DM01020001", "Marketing Communication Department Head", "Marketing Communication Manager", "7", 3, "DMDIV01", "DMDEP02", "DM01000001",
             "Merancang dan mengendalikan program komunikasi pemasaran dan promosi.",
             (("MARCOM", 3), ("BUDGET", 3), ("DATA", 3))),
    Position("DM01020011", "Marketing Communication Supervisor", "Marketing Communication Supervisor", "5", 4, "DMDIV01", "DMDEP02", "DM01020001",
             "Mengawasi pelaksanaan kampanye dan materi komunikasi pemasaran.",
             (("MARCOM", 3), ("DATA", 2))),
    Position("DM01020021", "Digital Marketing Officer", "Digital Marketing Officer", "3", 5, "DMDIV01", "DMDEP02", "DM01020011",
             "Menjalankan kampanye digital dan mengelola kanal media sosial.",
             (("MARCOM", 2), ("DATA", 2))),
    Position("DM01020022", "Event & Promotion Officer", "Event & Promotion Officer", "3", 5, "DMDIV01", "DMDEP02", "DM01020011",
             "Menyelenggarakan event dan program promosi bersama jaringan dealer.",
             (("MARCOM", 2), ("DEALER", 1))),
    # ── Finance & Accounting ──
    Position("DM02000001", "Finance & Accounting Division Head", "Head of Finance & Accounting", "10", 2, "DMDIV02", None, None,
             "Memimpin fungsi akuntansi, perpajakan, dan treasury perusahaan.",
             (("FINREP", 4), ("TAX", 3), ("TREASURY", 3), ("BUDGET", 4))),
    Position("DM02030001", "Accounting Department Head", "Accounting Manager", "8", 3, "DMDIV02", "DMDEP03", "DM02000001",
             "Menjamin penutupan buku dan laporan keuangan tepat waktu dan akurat.",
             (("FINREP", 3), ("TAX", 2), ("BUDGET", 3))),
    Position("DM02030011", "Accounting Supervisor", "Accounting Supervisor", "6", 4, "DMDIV02", "DMDEP03", "DM02030001",
             "Mengawasi pencatatan transaksi dan rekonsiliasi akun.",
             (("FINREP", 3), ("TAX", 2), ("DATA", 2))),
    Position("DM02030021", "Accounting Staff", "Accounting Officer", "3", 5, "DMDIV02", "DMDEP03", "DM02030011",
             "Mencatat transaksi dan menyiapkan rekonsiliasi akun.",
             (("FINREP", 2), ("DATA", 1))),
    Position("DM02030022", "Accounts Payable Staff", "Accounts Payable Officer", "2", 5, "DMDIV02", "DMDEP03", "DM02030011",
             "Memverifikasi tagihan dan memproses pembayaran pemasok.",
             (("FINREP", 1), ("TREASURY", 1))),
    Position("DM02040001", "Treasury & Tax Department Head", "Treasury & Tax Manager", "7", 3, "DMDIV02", "DMDEP04", "DM02000001",
             "Mengelola likuiditas, pendanaan, dan kepatuhan pajak perusahaan.",
             (("TREASURY", 3), ("TAX", 3), ("BUDGET", 3), ("FINREP", 2))),
    Position("DM02040011", "Tax Supervisor", "Tax Supervisor", "5", 4, "DMDIV02", "DMDEP04", "DM02040001",
             "Mengawasi perhitungan, pelaporan, dan pemeriksaan pajak.",
             (("TAX", 3), ("FINREP", 2))),
    Position("DM02040021", "Treasury Staff", "Treasury Officer", "3", 5, "DMDIV02", "DMDEP04", "DM02040001",
             "Mengelola arus kas harian dan hubungan dengan bank.",
             (("TREASURY", 2), ("FINREP", 1))),
    # ── Human Capital ──
    Position("DM03000001", "Human Capital Division Head", "Head of Human Capital", "9", 2, "DMDIV03", None, None,
             "Memimpin strategi pengelolaan dan pengembangan sumber daya manusia.",
             (("LEARNING", 3), ("TALENT", 4), ("BUDGET", 4))),
    Position("DM03050001", "People Development Department Head", "People Development Manager", "7", 3, "DMDIV03", "DMDEP05", "DM03000001",
             "Mengelola program pembelajaran, talent review, dan suksesi.",
             (("LEARNING", 3), ("TALENT", 3), ("BUDGET", 3))),
    Position("DM03050011", "Learning & Development Supervisor", "Learning & Development Supervisor", "5", 4, "DMDIV03", "DMDEP05", "DM03050001",
             "Mengawasi perancangan dan pelaksanaan program pelatihan.",
             (("LEARNING", 3), ("TALENT", 2), ("DATA", 2))),
    Position("DM03050021", "Learning & Development Officer", "Learning & Development Officer", "3", 5, "DMDIV03", "DMDEP05", "DM03050011",
             "Menyelenggarakan pelatihan dan mengevaluasi efektivitasnya.",
             (("LEARNING", 2),)),
    Position("DM03050022", "Talent Management Officer", "Talent Management Officer", "4", 5, "DMDIV03", "DMDEP05", "DM03050011",
             "Menyiapkan data talent review dan rencana pengembangan individu.",
             (("TALENT", 2), ("DATA", 2))),
    # ── Information Technology ──
    Position("DM04000001", "Information Technology Division Head", "Head of Information Technology", "10", 2, "DMDIV04", None, None,
             "Memimpin strategi teknologi informasi dan portofolio aplikasi perusahaan.",
             (("APPDEV", 4), ("SYSINT", 4), ("BUDGET", 4))),
    Position("DM04060001", "IT Application Development Department Head", "IT Application Development Manager", "8", 3, "DMDIV04", "DMDEP06", "DM04000001",
             "Mengelola pengembangan dan pemeliharaan aplikasi bisnis.",
             (("APPDEV", 4), ("SYSINT", 3), ("BUDGET", 3), ("DATA", 3))),
    Position("DM04060011", "IT Application Development Supervisor", "IT Application Development Supervisor", "6", 4, "DMDIV04", "DMDEP06", "DM04060001",
             "Mengawasi tim pengembang dan kualitas rilis aplikasi.",
             (("APPDEV", 3), ("SYSINT", 3), ("DATA", 2))),
    Position("DM04060021", "IT Application Development Analyst", "IT Application Development Analyst", "4", 5, "DMDIV04", "DMDEP06", "DM04060011",
             "Menganalisis kebutuhan dan membangun fitur aplikasi.",
             (("APPDEV", 2), ("DATA", 2))),
    Position("DM04060022", "System Integrator Analyst", "System Integrator Analyst", "4", 5, "DMDIV04", "DMDEP06", "DM04060011",
             "Merancang dan memelihara integrasi antar sistem.",
             (("SYSINT", 2), ("APPDEV", 2))),
    # Retired seat: valid only 2005-2021, so the position master shows a closed
    # VALID_TO and three careers carry a stint in it.
    Position("DM04060099", "Programmer", "Programmer", "3", 5, "DMDIV04", "DMDEP06", "DM04060011",
             "Jabatan lama sebelum restrukturisasi IT 2022 (digantikan IT Application Development Analyst).",
             (("APPDEV", 2),), valid_from=date(2005, 1, 1), valid_to=date(2021, 12, 31)),
    # ── After Sales Service ──
    Position("DM05000001", "After Sales Service Division Head", "Head of After Sales Service", "9", 2, "DMDIV05", None, None,
             "Memimpin layanan purna jual, mutu servis, dan ketersediaan suku cadang.",
             (("SERVICE", 4), ("SPAREPART", 3), ("BUDGET", 4))),
    Position("DM05070001", "Technical Service Department Head", "Technical Service Manager", "7", 3, "DMDIV05", "DMDEP07", "DM05000001",
             "Mengelola mutu servis bengkel dan program pelatihan teknis.",
             (("SERVICE", 3), ("BUDGET", 3), ("DATA", 2))),
    Position("DM05070011", "Service Quality Supervisor", "Service Quality Supervisor", "6", 4, "DMDIV05", "DMDEP07", "DM05070001",
             "Mengawasi audit mutu servis dan tindak lanjut keluhan konsumen.",
             (("SERVICE", 3), ("DATA", 2))),
    Position("DM05070012", "Service Training Supervisor", "Service Training Supervisor", "5", 4, "DMDIV05", "DMDEP07", "DM05070001",
             "Mengawasi program pelatihan mekanik jaringan bengkel.",
             (("SERVICE", 3), ("LEARNING", 2))),
    Position("DM05070021", "Technical Instructor", "Technical Instructor", "3", 5, "DMDIV05", "DMDEP07", "DM05070012",
             "Melatih mekanik jaringan bengkel sesuai standar servis.",
             (("SERVICE", 2), ("LEARNING", 2))),
    Position("DM05070022", "Warranty Claim Officer", "Warranty Claim Officer", "3", 5, "DMDIV05", "DMDEP07", "DM05070011",
             "Memverifikasi dan memproses klaim garansi dari bengkel.",
             (("SERVICE", 2), ("DATA", 1))),
    Position("DM05080001", "Spare Parts Department Head", "Spare Parts Manager", "7", 3, "DMDIV05", "DMDEP08", "DM05000001",
             "Menjamin ketersediaan suku cadang dengan tingkat persediaan yang efisien.",
             (("SPAREPART", 3), ("BUDGET", 3), ("DATA", 3))),
    Position("DM05080011", "Spare Parts Planning Supervisor", "Spare Parts Planning Supervisor", "5", 4, "DMDIV05", "DMDEP08", "DM05080001",
             "Menyusun perencanaan kebutuhan dan pemesanan suku cadang.",
             (("SPAREPART", 3), ("DATA", 2))),
    Position("DM05080021", "Warehouse Staff", "Warehouse Officer", "2", 5, "DMDIV05", "DMDEP08", "DM05080011",
             "Menerima, menyimpan, dan menyiapkan pengiriman suku cadang.",
             (("SPAREPART", 1),)),
]

POSITION_BY_CODE: dict[str, Position] = {p.code: p for p in POSITIONS}

OFFICE_HO = "Head Office"
OFFICE_SBY = "Cabang Surabaya"
OFFICE_MLG = "Cabang Malang"


@dataclass(frozen=True)
class Stint:
    position: str
    start: date
    end: date | None = None  # None = still in the seat (VALID_TO blank)
    primary: bool = True


@dataclass(frozen=True)
class Education:
    level: str  # SMA/SMK/D3/S1/S2
    major: str
    institution: str
    location: str
    start_year: int
    end_year: int
    gpa: float | None
    achievement: str | None = None


EDU_RANK = {"SMA": 3, "SMK": 3, "D3": 6, "S1": 8, "S2": 9}


@dataclass(frozen=True)
class Discipline:
    """One record. `issued_months_ago` is relative to the generation date so the
    derived discipline_status (candidate-populate.ts) stays what was designed."""

    warning_level: int  # HR source codes: 1 = SP1, 2 = SP2, 3 = SP3, 4 = ST, 5 = SP Pertama & Terakhir (candidate-populate.ts)
    issued_months_ago: int
    valid_months: int
    violation: str
    degree: int
    vtype: int
    effect: str | None
    advice: str | None
    sanction: str
    note: str | None = None


@dataclass(frozen=True)
class Assessment:
    held: date
    recommendation: str
    note: str


@dataclass
class Employee:
    npk: str
    name: str
    office: str
    entry: date
    stints: list[Stint]
    # Appraisal grades by year OFFSET from the generation year: {-1: (S1, S2)}.
    # The candidate sync reads offsets -1, -2, -3 (six semesters, newest first).
    pa: dict[int, tuple[str | None, str | None]]
    assessments: list[Assessment]
    education: list[Education]
    mcu: tuple[str, str | None] | None  # (Kesimpulan, Keterangan); None = no MCU row
    hav_upload: str | None = None  # the cell as written in HAV.xlsx ("7", "Kuadran 2", ...)
    discipline: list[Discipline] = field(default_factory=list)
    # How far the person's ATTAINED technical level sits from what the job demands.
    competency_delta: int = 0
    promotion_note: dict[int, str] = field(default_factory=dict)  # offset -> PROMOSI text
    # What the demo is meant to show about this person (README summary).
    story: str = ""
    # Expected results, checked by the verification harness against the REAL code.
    expect_formula: int | None = None  # HAV from PA x BA (lib/hav-quadrant-derive.ts)
    expect_hav: int | None = None  # HAV in force (upload > formula)
    expect_discipline: str = "CLEAR"
    expect_talent_pool: bool = False

    @property
    def current(self) -> Stint:
        live = [s for s in self.stints if s.end is None and s.primary]
        return max(live, key=lambda s: s.start)

    @property
    def position(self) -> Position:
        return POSITION_BY_CODE[self.current.position]

    @property
    def grade(self) -> str:
        return self.position.grade


def _edu(level, major, inst, loc, start, end, gpa=None, ach=None) -> Education:
    return Education(level, major, inst, loc, start, end, gpa, ach)


UNAIR = ("Universitas Airlangga", "Surabaya")
ITS = ("Institut Teknologi Sepuluh Nopember", "Surabaya")
UB = ("Universitas Brawijaya", "Malang")
UM = ("Universitas Negeri Malang", "Malang")
PETRA = ("Universitas Kristen Petra", "Surabaya")
UGM = ("Universitas Gadjah Mada", "Yogyakarta")
UNDIP = ("Universitas Diponegoro", "Semarang")
POLINEMA = ("Politeknik Negeri Malang", "Malang")
PENS = ("Politeknik Elektronika Negeri Surabaya", "Surabaya")
UNPAD = ("Universitas Padjadjaran", "Bandung")
UBAYA = ("Universitas Surabaya", "Surabaya")
PERBANAS = ("STIE Perbanas Surabaya", "Surabaya")
SMKN1SBY = ("SMK Negeri 1 Surabaya", "Surabaya")
SMKN2MLG = ("SMK Negeri 2 Malang", "Malang")


def edu(level, major, where, start, end, gpa=None, ach=None) -> Education:
    return _edu(level, major, where[0], where[1], start, end, gpa, ach)


MCU_FIT = ("Fit", None)

# ── People ──────────────────────────────────────────────────────────────────
# PA offsets: 0 = generation year (S2 not appraised yet), -1..-3 = the window the
# candidate sync reads, -4 = older history. HAV formula: Low if any D/E in the
# last two years (offsets -1, -2), else the newest two graded semesters
# (offset -1 S2, then S1): AA/AB/BB High, one C Mid High, CC Mid Low.

EMPLOYEES: list[Employee] = [
    # ── Sales & Marketing ──
    Employee("99001", "Hendra Wijaya", OFFICE_HO, date(2003, 4, 1),
             [Stint("DM01000001", date(2003, 4, 1))],
             {-4: ("B", "A"), -3: ("A", "A"), -2: ("A", "B"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2023, 5, 10), "STRENGTH", "Kepemimpinan bisnis sangat kuat; siap untuk peran direksi.")],
             [edu("S2", "Manajemen Pemasaran", UNAIR, 2008, 2010, 3.71), edu("S1", "Manajemen", UB, 1997, 2001, 3.38)],
             ("Fit With Note", "Hipertensi terkontrol dengan obat; kontrol rutin tiap 3 bulan."),
             hav_upload="1", competency_delta=0,
             story="Division head berkinerja puncak; HAV unggahan = rumus (Q1).",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99002", "Rina Kusumawati", OFFICE_HO, date(2008, 7, 14),
             [Stint("DM01010021", date(2008, 7, 14), date(2013, 12, 31)),
              Stint("DM01010011", date(2014, 1, 1), date(2019, 12, 31)),
              Stint("DM01010001", date(2020, 1, 1))],
             {-4: ("A", "B"), -3: ("B", "B"), -2: ("B", "A"), -1: ("A", "B"), 0: ("B", None)},
             [Assessment(date(2024, 3, 12), "VERY HIGH", "Analisis pasar tajam; perlu memperluas jejaring lintas fungsi.")],
             [edu("S1", "Manajemen", PETRA, 2003, 2007, 3.45)],
             MCU_FIT, hav_upload="2", competency_delta=0,
             story="Karier naik dari Sales Counter -> Area Sales Supervisor -> Dept Head (3 baris riwayat jabatan).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99003", "Agus Setiawan", OFFICE_SBY, date(2012, 2, 1),
             [Stint("DM01010022", date(2012, 2, 1), date(2019, 12, 31)),
              Stint("DM01010011", date(2020, 1, 1))],
             {-4: ("B", "B"), -3: ("B", "A"), -2: ("A", "A"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2021, 3, 10), "READY", "Assessment lama (ditimpa assessment 2024)."),
              Assessment(date(2024, 8, 20), "STRENGTH", "Konsisten melampaui target; kuat dalam coaching tim.")],
             [edu("S1", "Manajemen", UNAIR, 2007, 2011, 3.56)],
             MCU_FIT, competency_delta=1,
             story="Supervisor bintang; HAV dari rumus (Q1). Punya 2 baris assessment -> yang terbaru dipakai.",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99004", "Dewi Paramitha", OFFICE_MLG, date(2015, 9, 1),
             [Stint("DM01010023", date(2015, 9, 1), date(2020, 12, 31)),
              Stint("DM01010012", date(2021, 1, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "C"), -1: ("C", "B"), 0: ("B", None)},
             [Assessment(date(2024, 6, 18), "PENGEMBANGAN JANGKA PENDEK", "Siap naik dengan penguatan perencanaan area.")],
             [edu("S1", "Manajemen", UB, 2010, 2014, 3.29)],
             MCU_FIT, competency_delta=0,
             story="PA terakhir B+C -> Mid High; BA Mid High -> Q3 (lolos Talent Pool).",
             expect_formula=3, expect_hav=3, expect_talent_pool=True),
    Employee("99005", "Fajar Nugroho", OFFICE_SBY, date(2019, 3, 11),
             [Stint("DM01010021", date(2019, 3, 11))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("B", "C"), 0: ("B", None)},
             [Assessment(date(2025, 2, 14), "READY", "Siap dengan pengembangan kemampuan negosiasi.")],
             [edu("D3", "Manajemen Pemasaran", POLINEMA, 2015, 2018, 3.12)],
             MCU_FIT, competency_delta=0,
             story="Q8 (BA Mid Low x PA Mid High): masuk peta, tidak lolos Talent Pool.",
             expect_formula=8, expect_hav=8, expect_talent_pool=False),
    Employee("99006", "Siti Rahmawati", OFFICE_SBY, date(2021, 6, 1),
             [Stint("DM01010021", date(2021, 6, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "A"), -1: ("B", "C"), 0: ("A", None)},
             [Assessment(date(2025, 1, 22), "NEED TARGETED DEVELOPMENT", "Perlu pendampingan pada pelayanan pelanggan korporat.")],
             [edu("D3", "Administrasi Bisnis", POLINEMA, 2017, 2020, 3.35)],
             MCU_FIT, competency_delta=0,
             story="Pemegang kedua kursi Sales Counter Surabaya (jabatan multi-pemegang). Q8.",
             expect_formula=8, expect_hav=8, expect_talent_pool=False),
    Employee("99007", "Yoga Prasetyo", OFFICE_MLG, date(2017, 1, 9),
             [Stint("DM01010023", date(2017, 1, 9))],
             {-4: ("C", "C"), -3: ("C", "C"), -2: ("C", "C"), -1: ("C", "C"), 0: ("C", None)},
             [Assessment(date(2023, 10, 5), "MIDDLE LOW", "Perlu peningkatan inisiatif dan disiplin target.")],
             [edu("SMK", "Pemasaran", SMKN2MLG, 2013, 2016, None)],
             ("Fit With Note", "Miopia sedang; wajib memakai kacamata saat berkendara."),
             competency_delta=-1,
             story="PA C semua (tanpa A/B) dan BA Low -> Q15. Tidak lolos Talent Pool.",
             expect_formula=15, expect_hav=15, expect_talent_pool=False),
    Employee("99008", "Nanda Putri Maharani", OFFICE_MLG, date(2026, 3, 2),
             [Stint("DM01010023", date(2026, 3, 2))],
             {},
             [],
             [edu("D3", "Manajemen", POLINEMA, 2021, 2024, 3.48)],
             None, competency_delta=-1,
             story="Karyawan baru: belum ada PA, BA, maupun MCU -> 'Belum terpetakan' di Talent Mapping.",
             expect_formula=None, expect_hav=None, expect_talent_pool=False),
    Employee("99009", "Bayu Saputra", OFFICE_HO, date(2016, 4, 18),
             [Stint("DM01010022", date(2016, 4, 18))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [],
             [edu("S1", "Administrasi Bisnis", UBAYA, 2011, 2015, 3.21)],
             MCU_FIT, competency_delta=0,
             story="PA lengkap (High) tetapi belum pernah assessment perilaku -> belum terpetakan.",
             expect_formula=None, expect_hav=None, expect_talent_pool=False),
    Employee("99010", "Indra Gunawan", OFFICE_HO, date(2009, 11, 2),
             [Stint("DM01020001", date(2009, 11, 2))],
             {-4: ("A", "A"), -3: ("A", "B"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2023, 9, 15), "HIGH", "Kreatif; perlu memperkuat pengendalian anggaran kampanye.")],
             [edu("S1", "Ilmu Komunikasi", UNAIR, 2004, 2008, 3.40)],
             ("Fit With Note", "Kolesterol tinggi; disarankan diet dan olahraga rutin."),
             hav_upload="4", competency_delta=0,
             story="Rumus memberi Q7, HR mengkalibrasi ke Q4 lewat unggahan HAV -> unggahan yang berlaku.",
             expect_formula=7, expect_hav=4, expect_talent_pool=True),
    Employee("99011", "Maya Anggraini", OFFICE_HO, date(2014, 5, 19),
             [Stint("DM01020022", date(2014, 5, 19), date(2019, 12, 31)),
              Stint("DM01020011", date(2020, 1, 1))],
             {-4: ("A", "B"), -3: ("A", "A"), -2: ("A", "B"), -1: ("B", "A"), 0: ("A", None)},
             [Assessment(date(2024, 11, 7), "VERY HIGH", "Komunikator kuat; siap memimpin departemen dalam 1-2 tahun.")],
             [edu("S1", "Ilmu Komunikasi", UNPAD, 2009, 2013, 3.62)],
             MCU_FIT, hav_upload="2", competency_delta=1,
             story="Kandidat suksesor kuat (Q2).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99012", "Rizky Ramadhan", OFFICE_HO, date(2020, 2, 3),
             [Stint("DM01020021", date(2020, 2, 3))],
             {-4: ("B", "B"), -3: ("B", "A"), -2: ("A", "A"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2025, 3, 20), "POTENSI", "Potensial; perlu eksposur pada proyek lintas fungsi.")],
             [edu("S1", "Desain Komunikasi Visual", PETRA, 2015, 2019, 3.67, "Cum laude")],
             MCU_FIT, competency_delta=1,
             story="Staf muda berkinerja tinggi (Q7) -> lolos Talent Pool.",
             expect_formula=7, expect_hav=7, expect_talent_pool=True),
    Employee("99013", "Lia Permata Sari", OFFICE_HO, date(2018, 8, 13),
             [Stint("DM01020022", date(2018, 8, 13))],
             {-4: ("B", "B"), -3: ("B", "C"), -2: ("C", "C"), -1: ("C", "B"), 0: ("B", None)},
             [Assessment(date(2024, 4, 25), "NEED TARGETED DEVELOPMENT", "Perlu pengembangan perencanaan event yang terukur.")],
             [edu("S1", "Manajemen", UM, 2013, 2017, 3.15)],
             MCU_FIT, competency_delta=0,
             discipline=[Discipline(4, 16, 3, "Terlambat hadir berulang (5 kali dalam satu bulan).", 1, 1,
                                    None, "Pembinaan oleh atasan langsung.", "ST (Surat Teguran)")],
             story="Punya Surat Teguran (warning level 4 = ST): tetap memenuhi aturan disiplin. Q8.",
             expect_formula=8, expect_hav=8, expect_discipline="ST", expect_talent_pool=False),
    # ── Finance & Accounting ──
    Employee("99014", "Wahyu Hidayat", OFFICE_HO, date(2001, 2, 1),
             [Stint("DM02030011", date(2001, 2, 1), date(2014, 12, 31)),
              Stint("DM02040001", date(2015, 1, 1), date(2024, 12, 31)),
              Stint("DM02000001", date(2025, 1, 1))],
             {-4: ("A", "A"), -3: ("A", "A"), -2: ("A", "A"), -1: ("A", "B"), 0: ("A", None)},
             [Assessment(date(2022, 11, 21), "STRENGTH", "Pemikir strategis; kuat dalam tata kelola keuangan.")],
             [edu("S2", "Akuntansi", UGM, 2006, 2008, 3.80), edu("S1", "Akuntansi", UNAIR, 1996, 2000, 3.52)],
             MCU_FIT, hav_upload="1", competency_delta=0,
             promotion_note={-2: "Promosi ke Division Head (efektif awal tahun berikutnya)"},
             story="Naik ke Division Head; kursi lamanya (Treasury & Tax Dept Head) kini KOSONG.",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99015", "Ratna Sari Dewi", OFFICE_HO, date(2006, 3, 6),
             [Stint("DM02030001", date(2006, 3, 6)),
              # Acting holder of the vacant seat: PRIMARY_POSITION = N, so it never
              # becomes her current position, but it is a live placement.
              Stint("DM02040001", date(2025, 1, 1), None, primary=False)],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("C", "B"), 0: ("B", None)},
             [Assessment(date(2023, 6, 8), "READY WITH DEVELOPMENT", "Siap dengan pengembangan pada perencanaan pajak.")],
             [edu("S1", "Akuntansi", PERBANAS, 2001, 2005, 3.33)],
             MCU_FIT, competency_delta=0,
             story="Plt. Treasury & Tax Dept Head (baris PRIMARY_POSITION = N). Q8.",
             expect_formula=8, expect_hav=8, expect_talent_pool=False),
    Employee("99016", "Eko Purnomo", OFFICE_HO, date(2011, 10, 10),
             [Stint("DM02030021", date(2011, 10, 10), date(2018, 12, 31)),
              Stint("DM02030011", date(2019, 1, 1))],
             {-4: ("B", "B"), -3: ("A", "B"), -2: ("B", "B"), -1: ("B", "A"), 0: ("A", None)},
             [Assessment(date(2024, 9, 3), "PENGEMBANGAN JANGKA PENDEK", "Teliti dan andal; perlu eksposur pada manajemen pajak.")],
             [edu("S1", "Akuntansi", UNAIR, 2006, 2010, 3.48)],
             ("Unfit", "Pasca operasi jantung; belum boleh bekerja penuh waktu sampai evaluasi kardiologi berikutnya."),
             competency_delta=1,
             story="MCU Unfit -> hanya DITANDAI (aturan MCU bersifat advisory), tetap lolos Talent Pool (Q2).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99017", "Putri Ayu Ningsih", OFFICE_HO, date(2015, 1, 5),
             [Stint("DM02030021", date(2015, 1, 5))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("A", "B"), -1: ("C", "C"), 0: ("B", None)},
             [Assessment(date(2024, 7, 11), "MIDDLE HIGH", "Stabil; perlu meningkatkan analisis laporan.")],
             [edu("S1", "Akuntansi", UBAYA, 2010, 2014, 3.26)],
             MCU_FIT, competency_delta=0,
             story="PA terakhir C+C -> Mid Low; BA Mid Low -> Q9.",
             expect_formula=9, expect_hav=9, expect_talent_pool=False),
    Employee("99018", "Dimas Aditya", OFFICE_HO, date(2019, 7, 22),
             [Stint("DM02030021", date(2019, 7, 22))],
             {-4: ("B", "C"), -3: ("C", "C"), -2: ("D", "C"), -1: ("B", "C"), 0: ("C", None)},
             [Assessment(date(2024, 2, 28), "BUTUH PENGEMBANGAN", "Perlu pengembangan ketelitian dan kepatuhan prosedur.")],
             [edu("D3", "Akuntansi", POLINEMA, 2015, 2018, 2.94)],
             MCU_FIT, competency_delta=-1,
             discipline=[
                 Discipline(4, 32, 3, "Tidak mengikuti prosedur verifikasi dokumen.", 1, 1,
                            None, "Pembinaan oleh atasan langsung.", "ST (Surat Teguran)"),
                 Discipline(2, 20, 6, "Kesalahan input berulang yang menyebabkan selisih kas.", 2, 1,
                            "Selisih kas harus dikoreksi manual.", "Pendampingan supervisor selama 3 bulan.",
                            "SP2 (Surat Peringatan)"),
             ],
             story="ST lama + SP2 berakhir < 2 tahun lalu -> yang terberat menang, SP_UNDER_2_YEARS: gugur aturan disiplin dan TIDAK masuk peta Talent Mapping.",
             expect_formula=12, expect_hav=12, expect_discipline="SP_UNDER_2_YEARS", expect_talent_pool=False),
    Employee("99019", "Anisa Fitriani", OFFICE_HO, date(2022, 9, 1),
             [Stint("DM02030022", date(2022, 9, 1))],
             {-3: ("B", "B"), -2: ("B", "B"), -1: ("B", "A"), 0: ("A", None)},
             [],
             [edu("S1", "Akuntansi", UM, 2017, 2021, 3.58)],
             MCU_FIT, competency_delta=0,
             story="Belum pernah assessment perilaku -> belum terpetakan; masa kerja < 5 tahun.",
             expect_formula=None, expect_hav=None, expect_talent_pool=False),
    Employee("99020", "Hadi Santoso", OFFICE_HO, date(2013, 4, 15),
             [Stint("DM02040011", date(2013, 4, 15))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("C", "C"), 0: ("C", None)},
             [Assessment(date(2023, 12, 12), "HIGH", "Menguasai regulasi pajak; perlu memperkuat kepemimpinan tim.")],
             [edu("S1", "Perpajakan", UB, 2008, 2012, 3.31)],
             MCU_FIT, competency_delta=0,
             story="Supervisor dengan PA terakhir C+C -> Q9; tidak lolos program suksesi.",
             expect_formula=9, expect_hav=9, expect_talent_pool=False),
    Employee("99021", "Arief Kurniawan", OFFICE_HO, date(2017, 10, 2),
             [Stint("DM02040021", date(2017, 10, 2))],
             {-4: ("C", "B"), -3: ("B", "B"), -2: ("B", "C"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2024, 5, 16), "MIDDLE HIGH", "Andal dalam operasional kas; siap tanggung jawab lebih.")],
             [edu("S1", "Manajemen Keuangan", PERBANAS, 2012, 2016, 3.24)],
             MCU_FIT, competency_delta=0,
             discipline=[Discipline(2, 58, 6, "Keterlambatan setor dana operasional.", 2, 1,
                                    None, "Pembinaan oleh atasan langsung.", "SP2 (Surat Peringatan)")],
             story="SP2 yang berakhir >= 2 tahun lalu -> SP_OVER_2_YEARS; aturan disiplin bawaan meloloskannya, tetap lolos Talent Pool (Q7).",
             expect_formula=7, expect_hav=7, expect_discipline="SP_OVER_2_YEARS", expect_talent_pool=True),
    # ── Human Capital ──
    Employee("99022", "Sri Astuti", OFFICE_HO, date(2004, 9, 1),
             [Stint("DM03000001", date(2004, 9, 1))],
             {-4: ("A", "B"), -3: ("A", "B"), -2: ("A", "A"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2022, 8, 30), "VERY HIGH", "Pemimpin perubahan yang kuat; dihormati lintas divisi.")],
             [edu("S2", "Psikologi", UGM, 2009, 2011, 3.74), edu("S1", "Psikologi", UNAIR, 1999, 2003, 3.41)],
             MCU_FIT, hav_upload="2", competency_delta=0,
             story="Division head (Q2).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99023", "Bambang Supriyadi", OFFICE_HO, date(2010, 1, 18),
             [Stint("DM03050001", date(2010, 1, 18))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2023, 3, 9), "READY", "Siap; perlu memperkuat analitik HR.")],
             [edu("S1", "Psikologi", UNDIP, 2004, 2008, 3.27)],
             ("Fit With Note", "Diabetes melitus tipe 2 terkontrol; kontrol gula darah berkala."),
             hav_upload="7", competency_delta=0,
             story="HAV unggahan sama dengan rumus (Q7): unggah ulang tidak dihitung sebagai perubahan.",
             expect_formula=7, expect_hav=7, expect_talent_pool=True),
    Employee("99024", "Novi Handayani", OFFICE_HO, date(2014, 11, 3),
             [Stint("DM03050021", date(2014, 11, 3), date(2020, 6, 30)),
              Stint("DM03050011", date(2020, 7, 1))],
             {-4: ("A", "B"), -3: ("A", "A"), -2: ("B", "A"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2025, 4, 9), "STRENGTH", "Desainer program pembelajaran yang unggul; siap memimpin departemen.")],
             [edu("S1", "Psikologi", UNAIR, 2009, 2013, 3.69)],
             MCU_FIT, competency_delta=1,
             story="Supervisor bintang (Q1) - kandidat kuat untuk People Development Dept Head.",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99025", "Fadli Rahman", OFFICE_HO, date(2019, 2, 11),
             [Stint("DM03050021", date(2019, 2, 11))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("B", "C"), 0: ("B", None)},
             [Assessment(date(2024, 10, 1), "LOW", "Perlu fokus pada penguasaan peran saat ini.")],
             [edu("S1", "Psikologi", UM, 2014, 2018, 3.08)],
             MCU_FIT, competency_delta=-1,
             story="BA Low x PA Mid High -> Q14.",
             expect_formula=14, expect_hav=14, expect_talent_pool=False),
    Employee("99026", "Dian Puspitasari", OFFICE_HO, date(2016, 6, 6),
             [Stint("DM03050022", date(2016, 6, 6))],
             {-4: ("B", "B"), -3: ("A", "B"), -2: ("A", "A"), -1: ("A", "B"), 0: ("A", None)},
             [Assessment(date(2024, 12, 4), "PENGEMBANGAN JANGKA PENDEK", "Analitis dan proaktif; siap ke level supervisor.")],
             [edu("S1", "Psikologi", UNPAD, 2011, 2015, 3.55)],
             MCU_FIT, competency_delta=1,
             story="Staf siap promosi (Q2).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    # ── Information Technology ──
    Employee("99027", "Teguh Wibowo", OFFICE_HO, date(2005, 5, 2),
             [Stint("DM04000001", date(2005, 5, 2))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("A", "B"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2023, 2, 15), "STRENGTH", "Visioner teknologi; kuat dalam tata kelola TI.")],
             [edu("S2", "Sistem Informasi", ITS, 2010, 2012, 3.77), edu("S1", "Teknik Informatika", ITS, 1999, 2004, 3.36)],
             ("Fit With Note", "Miopia tinggi; wajib memakai kacamata saat berkendara."),
             hav_upload="1", competency_delta=0,
             story="Division head (Q1).",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99028", "Yudi Hartono", OFFICE_HO, date(2009, 8, 10),
             [Stint("DM04060099", date(2009, 8, 10), date(2015, 12, 31)),
              Stint("DM04060011", date(2016, 1, 1), date(2021, 12, 31)),
              Stint("DM04060001", date(2022, 1, 1))],
             {-4: ("A", "A"), -3: ("A", "A"), -2: ("B", "A"), -1: ("A", "B"), 0: ("A", None)},
             [Assessment(date(2019, 5, 22), "POTENSI", "Assessment lama (ditimpa assessment 2022)."),
              Assessment(date(2022, 10, 20), "HIGH", "Arsitek solusi yang kuat; perlu delegasi lebih baik.")],
             [edu("S1", "Teknik Informatika", ITS, 2004, 2008, 3.44)],
             MCU_FIT, hav_upload="4", competency_delta=0,
             story="Pernah menjabat 'Programmer' (jabatan lama, VALID_TO 2021). Rumus Q7, unggahan Q4.",
             expect_formula=7, expect_hav=4, expect_talent_pool=True),
    Employee("99029", "Galih Pratama", OFFICE_HO, date(2013, 3, 4),
             [Stint("DM04060099", date(2013, 3, 4), date(2017, 12, 31)),
              Stint("DM04060021", date(2018, 1, 1), date(2021, 12, 31)),
              Stint("DM04060011", date(2022, 1, 1))],
             {-4: ("B", "A"), -3: ("A", "B"), -2: ("A", "A"), -1: ("B", "A"), 0: ("A", None)},
             [Assessment(date(2024, 1, 17), "VERY HIGH", "Teknis sangat kuat; siap memimpin departemen pengembangan.")],
             [edu("S1", "Teknik Informatika", ITS, 2008, 2012, 3.61)],
             MCU_FIT, competency_delta=1,
             story="Suksesor terkuat untuk IT Application Development Dept Head (Q2).",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99030", "Andika Wirawan", OFFICE_HO, date(2016, 7, 4),
             [Stint("DM04060099", date(2016, 7, 4), date(2019, 12, 31)),
              Stint("DM04060021", date(2020, 1, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("A", "B"), 0: ("B", None)},
             [Assessment(date(2024, 6, 27), "READY", "Siap; perlu penguatan desain arsitektur.")],
             [edu("S1", "Sistem Informasi", UB, 2011, 2015, 3.30)],
             MCU_FIT, competency_delta=0,
             story="Analis (Q7) -> lolos Talent Pool.",
             expect_formula=7, expect_hav=7, expect_talent_pool=True),
    Employee("99031", "Citra Melati", OFFICE_HO, date(2018, 1, 15),
             [Stint("DM04060021", date(2018, 1, 15))],
             {-4: ("B", "B"), -3: ("B", "C"), -2: ("C", "B"), -1: ("C", "C"), 0: ("C", None)},
             [Assessment(date(2023, 11, 29), "POTENSI", "Potensial; perlu konsistensi kualitas kode.")],
             [edu("S1", "Teknik Informatika", PENS, 2013, 2017, 3.18)],
             MCU_FIT, competency_delta=-1,
             story="PA terakhir C+C -> Q9.",
             expect_formula=9, expect_hav=9, expect_talent_pool=False),
    Employee("99032", "Reza Firmansyah", OFFICE_HO, date(2023, 2, 1),
             [Stint("DM04060021", date(2023, 2, 1))],
             {-3: ("B", "B"), -2: ("A", "A"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2025, 5, 14), "STRENGTH", "Talenta muda luar biasa; cepat belajar.")],
             [edu("S1", "Teknik Informatika", ITS, 2018, 2022, 3.82, "Cum laude")],
             MCU_FIT, competency_delta=1,
             story="Q1 tetapi masa kerja < 5 tahun: lolos Talent Pool, gugur aturan masa kerja Critical Position.",
             expect_formula=1, expect_hav=1, expect_talent_pool=True),
    Employee("99033", "Fikri Maulana", OFFICE_HO, date(2017, 3, 13),
             [Stint("DM02030021", date(2017, 3, 13), date(2019, 6, 30)),
              Stint("DM04060022", date(2019, 7, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "A"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2024, 8, 8), "MIDDLE HIGH", "Kuat dalam integrasi; perlu kepatuhan prosedur keamanan.")],
             [edu("S1", "Sistem Informasi", UBAYA, 2012, 2016, 3.37)],
             MCU_FIT, competency_delta=0,
             discipline=[Discipline(3, 26, 6, "Penyalahgunaan hak akses sistem produksi.", 3, 2,
                                    "Potensi kebocoran data konsumen.", "Pencabutan hak akses produksi.",
                                    "SP3 (Surat Peringatan Ketiga)")],
             story="Pindah lintas fungsi (Accounting -> IT). Kinerja baik (Q7) tetapi SP3 -> gugur disiplin, keluar dari peta.",
             expect_formula=7, expect_hav=7, expect_discipline="SP3", expect_talent_pool=False),
    # ── After Sales Service ──
    Employee("99034", "Joko Susilo", OFFICE_HO, date(2002, 1, 7),
             [Stint("DM05000001", date(2002, 1, 7))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("C", "B"), 0: ("B", None)},
             [Assessment(date(2022, 7, 7), "READY", "Berpengalaman luas di layanan purna jual.")],
             [edu("S1", "Teknik Mesin", ITS, 1996, 2001, 3.12)],
             MCU_FIT, competency_delta=0,
             story="Division head Q8.",
             expect_formula=8, expect_hav=8, expect_talent_pool=False),
    Employee("99035", "Sugeng Riyadi", OFFICE_HO, date(2007, 5, 21),
             [Stint("DM05070001", date(2007, 5, 21))],
             {-4: ("B", "C"), -3: ("C", "B"), -2: ("B", "C"), -1: ("C", "C"), 0: ("C", None)},
             [Assessment(date(2023, 4, 19), "FOCUS ON OPTIMIZATION IN CURRENT POSITION", "Fokus optimalisasi pada peran saat ini.")],
             [edu("D3", "Teknik Mesin", POLINEMA, 2002, 2005, 2.98)],
             ("Unfit", "Low back pain kronis (HNP lumbal); tidak boleh mengangkat beban lebih dari 10 kg."),
             competency_delta=-1,
             story="Dept head Q15 dan MCU Unfit (ditandai saja).",
             expect_formula=15, expect_hav=15, expect_talent_pool=False),
    Employee("99036", "Wulan Kartika", OFFICE_HO, date(2012, 9, 24),
             [Stint("DM05070021", date(2012, 9, 24), date(2018, 12, 31)),
              Stint("DM05070011", date(2019, 1, 1))],
             {-4: ("A", "B"), -3: ("A", "B"), -2: ("B", "B"), -1: ("C", "B"), 0: ("A", None)},
             [Assessment(date(2024, 3, 28), "STRENGTH", "Standar mutu sangat tinggi; disegani bengkel jaringan.")],
             [edu("S1", "Teknik Industri", ITS, 2007, 2011, 3.46)],
             MCU_FIT, competency_delta=1,
             story="BA High x PA Mid High -> Q4.",
             expect_formula=4, expect_hav=4, expect_talent_pool=True),
    Employee("99037", "Taufik Nurhadi", OFFICE_SBY, date(2014, 2, 17),
             [Stint("DM05070021", date(2014, 2, 17))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2023, 8, 23), "NOT READY", "Belum siap untuk peran yang lebih tinggi.")],
             [edu("SMK", "Teknik Sepeda Motor", SMKN1SBY, 2009, 2012, None)],
             MCU_FIT, competency_delta=0,
             story="BA 'NOT READY' (kategori terbawah) -> gugur aturan Behavior walau PA bagus (Q13).",
             expect_formula=13, expect_hav=13, expect_talent_pool=False),
    Employee("99038", "Rudi Hermawan", OFFICE_MLG, date(2020, 10, 5),
             [Stint("DM05070021", date(2020, 10, 5))],
             {-4: ("C", "C"), -3: ("C", "C"), -2: ("D", "C"), -1: ("E", "C"), 0: ("C", None)},
             [Assessment(date(2024, 11, 13), "BELUM ADA POTENSI", "Belum menunjukkan potensi pengembangan.")],
             [edu("SMK", "Teknik Sepeda Motor", SMKN2MLG, 2016, 2019, None)],
             MCU_FIT, hav_upload="16", competency_delta=-2,
             story="PA D/E dan BA terbawah -> Q16 (Bottom), gugur aturan HAV dan Behavior.",
             expect_formula=16, expect_hav=16, expect_talent_pool=False),
    Employee("99039", "Lukman Suryadi", OFFICE_HO, date(2011, 12, 5),
             [Stint("DM05070022", date(2011, 12, 5))],
             {-7: ("B", "B"), -6: ("B", "A"), -5: ("A", "A")},
             [Assessment(date(2021, 9, 14), "READY", "Siap; perlu pembaruan pengetahuan produk.")],
             [edu("D3", "Teknik Mesin", POLINEMA, 2007, 2010, 3.05)],
             MCU_FIT, competency_delta=0,
             story="PA hanya ada sampai 5 tahun lalu (di luar jendela 3 tahun) -> belum terpetakan; antrean menunjukkan PA lama.",
             expect_formula=None, expect_hav=None, expect_talent_pool=False),
    Employee("99040", "Bagus Haryanto", OFFICE_HO, date(2008, 10, 13),
             [Stint("DM05080001", date(2008, 10, 13))],
             {-4: ("B", "B"), -3: ("B", "A"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2023, 7, 26), "PENGEMBANGAN JANGKA PENDEK", "Perencana yang andal; perlu inovasi proses.")],
             [edu("S1", "Teknik Industri", UB, 2003, 2007, 3.22)],
             MCU_FIT, hav_upload="3", competency_delta=0,
             story="Rumus Q2, HR mengkalibrasi turun ke Q3 lewat unggahan.",
             expect_formula=2, expect_hav=3, expect_talent_pool=True),
    Employee("99041", "Yuliana Safitri", OFFICE_HO, date(2013, 6, 3),
             [Stint("DM05080021", date(2013, 6, 3), date(2017, 12, 31)),
              Stint("DM05080011", date(2018, 1, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("A", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2024, 4, 3), "READY", "Siap; kuat dalam perencanaan kebutuhan.")],
             [edu("S1", "Teknik Industri", UM, 2008, 2012, 3.34)],
             MCU_FIT, competency_delta=0,
             story="Naik dari Warehouse Staff ke Supervisor (Q7).",
             expect_formula=7, expect_hav=7, expect_talent_pool=True),
    Employee("99042", "Doni Saputro", OFFICE_HO, date(2019, 1, 14),
             [Stint("DM05080021", date(2019, 1, 14))],
             {-4: ("B", "B"), -3: ("C", "B"), -2: ("B", "B"), -1: ("B", "C"), 0: ("C", None)},
             [Assessment(date(2024, 9, 19), "MIDDLE LOW", "Perlu peningkatan ketelitian stok.")],
             [edu("SMK", "Logistik", SMKN1SBY, 2014, 2017, None)],
             MCU_FIT, competency_delta=-1,
             discipline=[Discipline(2, 3, 6, "Selisih stok gudang akibat prosedur penerimaan tidak dijalankan.", 2, 1,
                                    "Selisih persediaan.", "Pendampingan supervisor selama 6 bulan.",
                                    "SP2 (Surat Peringatan)")],
             story="SP masih berlaku (ACTIVE_SP) -> gugur aturan disiplin, keluar dari peta.",
             expect_formula=14, expect_hav=14, expect_discipline="ACTIVE_SP", expect_talent_pool=False),
    Employee("99043", "Ahmad Fauzi", OFFICE_HO, date(2011, 8, 1),
             [Stint("DM01010022", date(2011, 8, 1), date(2016, 12, 31)),
              Stint("DM01010013", date(2017, 1, 1))],
             {-4: ("A", "A"), -3: ("A", "A"), -2: ("A", "B"), -1: ("A", "A"), 0: ("A", None)},
             [Assessment(date(2025, 6, 12), "VERY HIGH", "Analitis dan tegas; siap memimpin departemen.")],
             [edu("S1", "Manajemen", UBAYA, 2006, 2010, 3.50)],
             MCU_FIT, hav_upload="Kuadran 2", competency_delta=1,
             story="HAV ditulis 'Kuadran 2' (teks): sistem mengambil angkanya -> Q2.",
             expect_formula=2, expect_hav=2, expect_talent_pool=True),
    Employee("99044", "Ika Wulandari", OFFICE_HO, date(2015, 3, 16),
             [Stint("DM05070021", date(2015, 3, 16), date(2021, 12, 31)),
              Stint("DM05070012", date(2022, 1, 1))],
             {-4: ("B", "B"), -3: ("B", "B"), -2: ("B", "B"), -1: ("C", "B"), 0: ("B", None)},
             [Assessment(date(2025, 1, 30), "READY WITH DEVELOPMENT", "Siap dengan pengembangan kepemimpinan.")],
             [edu("D3", "Teknik Mesin", POLINEMA, 2010, 2013, 3.11), edu("S1", "Teknik Industri", UM, 2016, 2019, 3.29)],
             MCU_FIT, hav_upload="7", competency_delta=0,
             story="Rumus Q8 (tidak lolos), HR mengkalibrasi ke Q7 -> lolos Talent Pool karena unggahan HAV.",
             expect_formula=8, expect_hav=7, expect_talent_pool=True),
    Employee("99045", "Sandi Gunadi", OFFICE_HO, date(2023, 7, 3),
             [Stint("DM05080021", date(2023, 7, 3))],
             {-3: (None, "C"), -2: ("B", "B"), -1: ("B", "B"), 0: ("B", None)},
             [Assessment(date(2025, 2, 19), "VERY LOW", "Belum memenuhi ekspektasi perilaku kerja.")],
             [edu("SMK", "Logistik", SMKN1SBY, 2018, 2021, None)],
             None, competency_delta=-1,
             story="BA 'VERY LOW' (kategori terbawah) -> gugur aturan Behavior; belum ada MCU (status default Fit).",
             expect_formula=13, expect_hav=13, expect_talent_pool=False),
    Employee("99046", "Mega Anjani", OFFICE_HO, date(2024, 2, 5),
             [Stint("DM03050021", date(2024, 2, 5))],
             {-2: (None, "B"), -1: ("A", "B"), 0: ("A", None)},
             [Assessment(date(2025, 8, 21), "POTENSI", "Potensial; antusias dan cepat beradaptasi.")],
             [edu("S1", "Psikologi", UB, 2019, 2023, 3.64)],
             MCU_FIT, competency_delta=0,
             story="Karyawan 2 tahun (Q7): lolos Talent Pool, belum memenuhi masa kerja Critical Position.",
             expect_formula=7, expect_hav=7, expect_talent_pool=True),
]

EMPLOYEE_BY_NPK: dict[str, Employee] = {e.npk: e for e in EMPLOYEES}

# Seats that get a demo job-profile PDF: (position code, JD number).
JOB_PROFILE_SEATS: list[tuple[str, str]] = [
    ("DM04060001", "JD-DMO-001"),
    ("DM02040001", "JD-DMO-002"),
    ("DM01010001", "JD-DMO-003"),
    ("DM03050001", "JD-DMO-004"),
    ("DM05080001", "JD-DMO-005"),
    ("DM04060011", "JD-DMO-006"),
]


KAMUS_PDF_NAME = "13-kamus-kompetensi-demo.pdf"


def job_profile_file_name(code: str, jd: str) -> str:
    """Corpus convention "<POSITION_ID> <JD number> <title>.pdf" (see pdf_job_profile)."""
    return f"{code} {jd} {POSITION_BY_CODE[code].internal_title}.pdf"


def renumber(prefix: str) -> None:
    """Move every NPK to another 5-digit block (99001 -> <prefix>001).

    For a database where 99001-99046 already belong to real people. Two digits,
    no leading zero: the sync joins compare LPAD(employee_id, 5, '0'), so a
    leading zero or a sixth digit would break or truncate the join.
    """
    if not (len(prefix) == 2 and prefix.isdigit() and prefix[0] != "0"):
        raise ValueError("NPK prefix must be two digits, not starting with 0 (e.g. 98)")
    for e in EMPLOYEES:
        e.npk = prefix + e.npk[2:]
    EMPLOYEE_BY_NPK.clear()
    EMPLOYEE_BY_NPK.update({e.npk: e for e in EMPLOYEES})


def npk_range() -> tuple[str, str]:
    npks = sorted(e.npk for e in EMPLOYEES)
    return npks[0], npks[-1]


def holders_of(code: str) -> list[Employee]:
    """Live PRIMARY incumbents of a seat."""
    return [e for e in EMPLOYEES if e.current.position == code]


def position_held_on(e: Employee, day: date) -> Position:
    """The primary seat an employee held on a given day (falls back to the first)."""
    for s in sorted((s for s in e.stints if s.primary), key=lambda s: s.start):
        if s.start <= day and (s.end is None or s.end >= day):
            return POSITION_BY_CODE[s.position]
    return POSITION_BY_CODE[sorted(e.stints, key=lambda s: s.start)[0].position]


def _self_check() -> None:
    """Fail fast on an inconsistent dataset instead of shipping broken files."""
    npks = [e.npk for e in EMPLOYEES]
    assert len(npks) == len(set(npks)), "duplicate NPK"
    for e in EMPLOYEES:
        assert len(e.npk) == 5 and e.npk.isdigit() and not e.npk.startswith("0"), e.npk
        for s in e.stints:
            assert s.position in POSITION_BY_CODE, (e.npk, s.position)
            p = POSITION_BY_CODE[s.position]
            assert p.valid_from <= s.start, (e.npk, s.position, "stint before seat exists")
            if p.valid_to is not None:
                assert s.end is not None and s.end <= p.valid_to, (e.npk, s.position, "stint after seat retired")
        _ = e.current  # exactly one live primary seat
        assert e.position.valid_to is None, (e.npk, "current seat retired")
        assert e.entry == min(s.start for s in e.stints), (e.npk, "entry date != first stint")
        for a in e.assessments:
            assert a.recommendation == a.recommendation.upper(), a.recommendation
    for p in POSITIONS:
        assert p.parent is None or p.parent in POSITION_BY_CODE, p.code
        assert p.division in DIVISIONS, p.code
        assert p.department is None or p.department in DEPARTMENTS, p.code
        for key, level in p.competencies:
            assert key in COMPETENCIES and 1 <= level <= 4, (p.code, key)
    for code, _jd in JOB_PROFILE_SEATS:
        assert code in POSITION_BY_CODE, code
    grades = {g for _lid, _name, gs in GRADE_LEVELS for g in gs}
    for p in POSITIONS:
        assert p.grade in grades, (p.code, p.grade)


_self_check()
