"""Demo job-profile PDFs.

These are read by a VISION model (sync-service/src/services/llm-processor.ts),
not parsed by position, so the aim is a document that reads like the real
ones: an identity block, an organisation chart, purpose, responsibilities with
success indicators, authorities, working relationships, challenges, the job
specification, and two SEPARATE competency tables — behavioural (names only)
and technical (name + level 1-4) — exactly the distinction the extraction
prompt is written around.

File names follow the corpus convention "<POSITION_ID> <JD number> <title>.pdf":
the leading code is how the Job Profile Match report pairs a document with the
people sitting in that seat (lib/job-family/match.ts parseJobProfileFileName).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from . import dataset as ds
from .content import BEHAVIORAL, JOB_PROFILES

NAVY = colors.HexColor("#1F4E78")
LIGHT = colors.HexColor("#DDEBF7")
GRID = colors.HexColor("#8C8C8C")

_styles = getSampleStyleSheet()
BODY = ParagraphStyle("body", parent=_styles["Normal"], fontName="Helvetica", fontSize=9, leading=12, alignment=TA_LEFT)
BODY_B = ParagraphStyle("bodyb", parent=BODY, fontName="Helvetica-Bold")
SECTION = ParagraphStyle("section", parent=BODY, fontName="Helvetica-Bold", fontSize=10, textColor=colors.white)
SMALL = ParagraphStyle("small", parent=BODY, fontSize=7.5, leading=9, textColor=colors.HexColor("#595959"))

EFFECTIVE = date(2025, 1, 1)
PAGES = 2


file_name = ds.job_profile_file_name


def _section(title: str) -> Table:
    t = Table([[Paragraph(title, SECTION)]], colWidths=[180 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _grid(data, widths, header=False) -> Table:
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.5, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), LIGHT)]
    t.setStyle(TableStyle(style))
    return t


def _p(text: str, style=BODY) -> Paragraph:
    return Paragraph(text.replace("&", "&amp;"), style)


def _org_chart(code: str) -> Drawing:
    seat = ds.POSITION_BY_CODE[code]
    parent = ds.POSITION_BY_CODE[seat.parent].internal_title if seat.parent else "Direksi"
    subs = [p.internal_title for p in ds.POSITIONS if p.parent == code and p.valid_to is None]
    width, height = 180 * mm, 62 * mm
    d = Drawing(width, height)
    box_w, box_h = 52 * mm, 11 * mm

    def box(cx: float, y: float, label: str, fill) -> None:
        d.add(Rect(cx - box_w / 2, y, box_w, box_h, fillColor=fill, strokeColor=NAVY, strokeWidth=0.8))
        words = label.split()
        lines, line = [], ""
        for w in words:
            if len(f"{line} {w}".strip()) <= 30:
                line = f"{line} {w}".strip()
            else:
                lines.append(line)
                line = w
        lines.append(line)
        for i, l in enumerate(lines[:2]):
            d.add(String(cx, y + box_h - 4.2 * mm - i * 3.4 * mm, l, fontName="Helvetica", fontSize=7, textAnchor="middle"))

    cx = width / 2
    top_y, mid_y, low_y = height - box_h - 2, height / 2 - box_h / 2, 2
    box(cx, top_y, parent, colors.white)
    box(cx, mid_y, seat.internal_title, LIGHT)
    d.add(Line(cx, top_y, cx, mid_y + box_h, strokeColor=NAVY))
    if subs:
        n = len(subs)
        span = min(width - box_w, (n - 1) * (box_w + 4 * mm))
        xs = [cx - span / 2 + i * (span / (n - 1) if n > 1 else 0) for i in range(n)]
        bar_y = (mid_y + low_y + box_h) / 2
        d.add(Line(cx, mid_y, cx, bar_y, strokeColor=NAVY))
        d.add(Line(min(xs), bar_y, max(xs), bar_y, strokeColor=NAVY))
        for x, label in zip(xs, subs):
            d.add(Line(x, bar_y, x, low_y + box_h, strokeColor=NAVY))
            box(x, low_y, label, colors.white)
    return d


def _header_footer(code: str, jd: str):
    def draw(c, doc) -> None:
        c.saveState()
        w, h = A4
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 16)
        c.drawString(15 * mm, h - 18 * mm, "JOB PROFILE")
        c.setFont("Helvetica", 7.5)
        c.setFillColor(colors.HexColor("#595959"))
        c.drawString(15 * mm, h - 23 * mm, "DOKUMEN DEMO - DATA FIKTIF")
        c.setStrokeColor(GRID)
        c.setFillColor(colors.black)
        x0, y0 = w - 85 * mm, h - 27 * mm
        rows = [("No. Dokumen", jd), ("Tanggal Efektif", EFFECTIVE.isoformat()), ("Revisi", "0"),
                ("Halaman", f"{doc.page} dari {PAGES}")]
        for i, (k, v) in enumerate(rows):
            y = y0 + (len(rows) - 1 - i) * 4.5 * mm
            c.rect(x0, y, 70 * mm, 4.5 * mm, stroke=1, fill=0)
            c.line(x0 + 28 * mm, y, x0 + 28 * mm, y + 4.5 * mm)
            c.setFont("Helvetica", 7.5)
            c.drawString(x0 + 1.5 * mm, y + 1.4 * mm, k)
            c.drawString(x0 + 29.5 * mm, y + 1.4 * mm, v)
        c.setFont("Helvetica", 7)
        c.setFillColor(colors.HexColor("#808080"))
        c.drawString(15 * mm, 10 * mm, f"{jd} - {ds.POSITION_BY_CODE[code].internal_title} - dokumen demo, bukan dokumen resmi")
        c.restoreState()

    return draw


def build(code: str, jd: str, out_dir: Path) -> Path:
    seat = ds.POSITION_BY_CODE[code]
    info = JOB_PROFILES[code]
    division = ds.DIVISIONS[seat.division]
    department = ds.DEPARTMENTS[seat.department][0] if seat.department else "-"
    parent = ds.POSITION_BY_CODE[seat.parent].internal_title if seat.parent else "Direksi"
    subs = [p.internal_title for p in ds.POSITIONS if p.parent == code and p.valid_to is None]

    path = out_dir / file_name(code, jd)
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=32 * mm, bottomMargin=16 * mm,
                            title=f"{jd} {seat.internal_title}", author="Pulse demo data generator",
                            creator="demo-data/generate.py", invariant=1)
    story: list = []

    story += [_section("1. IDENTITAS JABATAN"), Spacer(1, 2 * mm)]
    story.append(_grid([
        [_p("Nama Jabatan", BODY_B), _p(seat.internal_title)],
        [_p("Division / Department", BODY_B), _p(f"{division} Division / {department}")],
        [_p("Atasan Langsung", BODY_B), _p(parent)],
        [_p("Bawahan Langsung", BODY_B), _p(", ".join(subs) if subs else "-")],
        [_p("Kode Posisi", BODY_B), _p(code)],
        [_p("Grade", BODY_B), _p(seat.grade)],
    ], [45 * mm, 135 * mm]))
    story += [Spacer(1, 4 * mm), _section("2. STRUKTUR ORGANISASI"), Spacer(1, 2 * mm), _org_chart(code)]

    story += [Spacer(1, 4 * mm), _section("3. TUJUAN JABATAN"), Spacer(1, 2 * mm), _p(info["purpose"])]

    rows = [[_p("No", BODY_B), _p("Tanggung Jawab Utama", BODY_B), _p("Indikator Keberhasilan", BODY_B)]]
    rows += [[_p(str(i)), _p(r), _p(k)] for i, (r, k) in enumerate(info["responsibilities"], start=1)]
    story += [Spacer(1, 4 * mm), KeepTogether([_section("4. TANGGUNG JAWAB UTAMA"), Spacer(1, 2 * mm),
                                               _grid(rows, [10 * mm, 105 * mm, 65 * mm], header=True)])]

    story += [Spacer(1, 4 * mm), _section("5. WEWENANG"), Spacer(1, 2 * mm)]
    story += [_p(f"{i}. {a}") for i, a in enumerate(info["authorities"], start=1)]

    story += [Spacer(1, 4 * mm), KeepTogether([
        _section("6. HUBUNGAN KERJA"), Spacer(1, 2 * mm),
        _grid([
            [_p("Internal", BODY_B), _p(", ".join(info["internal"]))],
            [_p("Eksternal", BODY_B), _p(", ".join(info["external"]))],
        ], [45 * mm, 135 * mm]),
    ])]

    story += [Spacer(1, 4 * mm), KeepTogether([
        _section("7. PEMECAHAN MASALAH"), Spacer(1, 2 * mm),
        _grid([
            [_p("Tantangan", BODY_B), _p("<br/>".join(f"- {c}" for c in info["challenges"]))],
            [_p("Perlu Persetujuan Atasan", BODY_B), _p("Keputusan di luar wewenang dan anggaran yang ditetapkan.")],
            [_p("Acuan", BODY_B), _p("Kebijakan perusahaan, SOP departemen, dan regulasi yang berlaku.")],
        ], [45 * mm, 135 * mm]),
    ])]

    story += [Spacer(1, 4 * mm), KeepTogether([
        _section("8. SPESIFIKASI JABATAN"), Spacer(1, 2 * mm),
        _grid([
            [_p("Pendidikan", BODY_B), _p(info["education"])],
            [_p("Pengalaman", BODY_B), _p(info["experience"])],
            [_p("Jenis Kelamin", BODY_B), _p("Pria / Wanita")],
            [_p("Keahlian / Sertifikasi", BODY_B), _p(", ".join(info["skills"]))],
        ], [45 * mm, 135 * mm]),
    ])]

    behavioral = BEHAVIORAL[info["level"]]
    beh_rows = [[_p("BEHAVIORAL COMPETENCY", BODY_B), ""]]
    for i in range(0, len(behavioral), 2):
        pair = behavioral[i:i + 2]
        beh_rows.append([_p(pair[0]), _p(pair[1]) if len(pair) > 1 else ""])
    beh = _grid(beh_rows, [90 * mm, 90 * mm])
    beh.setStyle(TableStyle([("SPAN", (0, 0), (1, 0)), ("BACKGROUND", (0, 0), (-1, 0), LIGHT)]))

    tech_rows = [[_p("TECHNICAL COMPETENCY", BODY_B), _p("Level", BODY_B)]]
    for key, level in seat.competencies:
        tech_rows.append([_p(ds.COMPETENCIES[key][1]), _p(str(level))])
    tech = _grid(tech_rows, [160 * mm, 20 * mm], header=True)

    story += [Spacer(1, 4 * mm), KeepTogether([
        _section("9. KOMPETENSI"), Spacer(1, 2 * mm), beh, Spacer(1, 3 * mm), tech,
        Spacer(1, 1.5 * mm), _p("Level kompetensi teknis: 1 Basic Knowledge, 2 Intermediate, 3 Advance, 4 Mastery.", SMALL),
    ])]

    story += [Spacer(1, 5 * mm), KeepTogether([
        _section("10. PENGESAHAN"), Spacer(1, 2 * mm),
        _grid([
            [_p("Dibuat oleh", BODY_B), _p("Diperiksa oleh", BODY_B), _p("Disetujui oleh", BODY_B)],
            [_p("<br/><br/><br/>HC Organization Development"), _p("<br/><br/><br/>People Development Department Head"),
             _p(f"<br/><br/><br/>{parent}")],
        ], [60 * mm, 60 * mm, 60 * mm], header=True),
    ])]

    decorate = _header_footer(code, jd)
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    # The header prints "n dari 2"; a content change that adds a page must fail
    # here rather than ship a document whose page count lies.
    assert doc.page == PAGES, (path.name, doc.page)
    return path


def write_all(out_dir: Path, as_of: date) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    return [build(code, jd, out_dir) for code, jd in ds.JOB_PROFILE_SEATS]
