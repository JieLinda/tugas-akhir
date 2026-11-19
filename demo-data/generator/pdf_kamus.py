"""The demo Kamus Kompetensi PDF.

sync-service/src/services/kamus-sync.ts does not read this PDF as prose: it
rebuilds lines from pdfjs text positions and buckets the four proficiency
columns by x. The layout below is therefore load-bearing:

* A4 landscape, ONE competency per page; pages before the first header (the
  cover) are skipped, and the cover must not contain a "TC nnn - ..." line.
* The header "TC 901 – NAME" sits alone on its line (the regex is anchored).
* Everything between the header and the level-label row is the DESCRIPTION, so
  nothing else may be drawn there.
* The label row carries the four tokens BASIC KNOWLEDGE / INTERMEDIATE /
  ADVANCE / MASTERY, each centred in its column: the parser derives the column
  boundaries from those centres. The level numbers share that row, so they are
  neither description nor level text.
* Every level line STARTS inside its column (bucketing is by start x). The
  footer starts left of the first column, so it is ignored.
* No description line may start with one of the four label words, or the
  column calibration would latch onto it.

A competency's code and name come from dataset.COMPETENCIES (TC 901-TC 914:
far above the real dictionary, so an upload can never overwrite a real entry).
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from . import dataset as ds
from .content import KAMUS

PAGE_W, PAGE_H = landscape(A4)  # 841.9 x 595.3
COL_LEFT = [95.0, 277.0, 459.0, 641.0]
COL_W = 182.0
LABELS = ["BASIC KNOWLEDGE", "INTERMEDIATE", "ADVANCE", "MASTERY"]
FILE_NAME = ds.KAMUS_PDF_NAME


def wrap(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for w in words:
        candidate = f"{line} {w}".strip()
        if stringWidth(candidate, font, size) <= width:
            line = candidate
        else:
            if line:
                lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def _cover(c: canvas.Canvas, as_of: date) -> None:
    c.setFillColorRGB(0.12, 0.31, 0.47)
    c.rect(0, PAGE_H - 140, PAGE_W, 140, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 28)
    c.drawString(60, PAGE_H - 80, "DICTIONARY TECHNICAL COMPETENCY")
    c.setFont("Helvetica", 14)
    c.drawString(60, PAGE_H - 110, "Kamus Kompetensi Teknis - DATA DEMO (FIKTIF)")
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 11)
    rows = [
        f"Berisi {len(ds.COMPETENCIES)} kompetensi demo berkode TC 901 sampai TC 914.",
        "Kode di atas 900 sengaja dipilih agar tidak menimpa kamus asli saat diunggah.",
        "Satu kompetensi per halaman: deskripsi lalu empat level kecakapan.",
        f"Dibuat untuk demo aplikasi Pulse pada {as_of.isoformat()}.",
    ]
    y = PAGE_H - 200
    for r in rows:
        c.drawString(60, y, r)
        y -= 20
    c.setFont("Helvetica", 8)
    c.drawString(30, 30, "Kamus Kompetensi Teknis - DATA DEMO (fiktif)")


def _competency_page(c: canvas.Canvas, key: str, page_no: int) -> None:
    code, name = ds.COMPETENCIES[key]
    description, *levels = KAMUS[key]

    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(40, 562, "KAMUS KOMPETENSI TEKNIS - DATA DEMO (FIKTIF)")
    c.setFillColorRGB(0.12, 0.31, 0.47)
    c.setFont("Helvetica-Bold", 15)
    c.drawString(40, 528, f"{code} – {name}")

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 10)
    desc_lines = wrap(description, "Helvetica", 10, 760)
    assert len(desc_lines) <= 4, (key, "description too long for the layout")
    for i, line in enumerate(desc_lines):
        first = line.split()[0].upper().strip("()")
        assert not any(first.startswith(l.split()[0]) for l in LABELS), (key, line)
        c.drawString(40, 502 - i * 14, line)

    top, label_base, bottom = 440.0, 422.0, 60.0
    # Header band + grid (lines and fills are not text, the parser ignores them).
    c.setFillColorRGB(0.87, 0.92, 0.97)
    c.rect(COL_LEFT[0], label_base - 10, COL_W * 4, top - label_base + 10, stroke=0, fill=1)
    c.setStrokeColorRGB(0.55, 0.55, 0.55)
    c.setLineWidth(0.6)
    c.rect(COL_LEFT[0], bottom, COL_W * 4, top - bottom, stroke=1, fill=0)
    c.line(COL_LEFT[0], label_base - 10, COL_LEFT[0] + COL_W * 4, label_base - 10)
    for x in COL_LEFT[1:]:
        c.line(x, bottom, x, top)

    c.setFillColorRGB(0, 0, 0)
    for i, label in enumerate(LABELS):
        c.setFont("Helvetica-Bold", 9)
        c.drawString(COL_LEFT[i] + 6, label_base, str(i + 1))
        c.drawCentredString(COL_LEFT[i] + COL_W / 2, label_base, label)

        y = label_base - 26
        for point in levels[i]:
            for j, line in enumerate(wrap(point, "Helvetica", 8.5, COL_W - 26)):
                c.setFont("Helvetica", 8.5)
                c.drawString(COL_LEFT[i] + (8 if j == 0 else 16), y, f"• {line}" if j == 0 else line)
                y -= 11.5
            y -= 5
        assert y > bottom + 6, (key, i, "level text overflows the table")

    c.setFont("Helvetica", 8)
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.drawString(30, 30, f"Kamus Kompetensi Teknis - DATA DEMO (fiktif) - halaman {page_no}")


def write(out_dir: Path, as_of: date) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / FILE_NAME
    # invariant=1: no creation timestamp or random document id, so the same
    # input produces the same bytes and a regeneration does not churn git.
    c = canvas.Canvas(str(path), pagesize=(PAGE_W, PAGE_H), invariant=1)
    c.setTitle("Kamus Kompetensi Teknis - DATA DEMO")
    c.setAuthor("Pulse demo data generator")
    c.setCreator("demo-data/generate.py")
    _cover(c, as_of)
    c.showPage()
    for n, key in enumerate(sorted(ds.COMPETENCIES, key=lambda k: ds.COMPETENCIES[k][0]), start=2):
        _competency_page(c, key, n)
        c.showPage()
    c.save()
    return path
