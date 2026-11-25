"""Write ringkasan-data-demo.md: who is who in the demo data and what each
person is designed to show. Generated from dataset.py so it cannot drift from
the workbooks; the expected HAV / discipline / Talent Pool columns are the ones
the verification run checked against the application's own code."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from . import dataset as ds


def _pa_csv(e: ds.Employee) -> str:
    """The six-slot performance_grade the candidate sync builds (newest first)."""
    slots: list[str] = []
    for offset in (-1, -2, -3):
        s1, s2 = e.pa.get(offset, (None, None))
        slots += [s2 or "", s1 or ""]
    return ",".join(slots) if any(slots) else "—"


def _years(e: ds.Employee, as_of: date) -> int:
    return int((as_of - e.entry).days // 365.25)


def write(out_dir: Path, as_of: date) -> Path:
    path = out_dir / "ringkasan-data-demo.md"
    first, last = ds.npk_range()
    tp = [e for e in ds.EMPLOYEES if e.expect_talent_pool]
    on_map = [e for e in ds.EMPLOYEES if e.expect_discipline in ("CLEAR", "ST", "SP_OVER_2_YEARS")]
    unplaced = [e for e in on_map if e.expect_hav is None]
    lines = [
        "# Ringkasan data demo",
        "",
        "> Berkas ini DIBUAT OTOMATIS oleh `demo-data/generate.py` dari `generator/dataset.py`. Jangan diedit",
        "> manual; ubah datasetnya lalu jalankan ulang generator.",
        "",
        f"Tanggal acuan: **{as_of.isoformat()}** — tahun PA yang dibaca sinkronisasi Kandidat adalah "
        f"{as_of.year - 3}-{as_of.year - 1}.",
        "",
        "| Angka | Nilai |",
        "|---|---|",
        f"| Karyawan (NPK {first}-{last}) | {len(ds.EMPLOYEES)} |",
        f"| Posisi (aktif / jabatan lama) | {sum(p.valid_to is None for p in ds.POSITIONS)} / {sum(p.valid_to is not None for p in ds.POSITIONS)} |",
        f"| Divisi / departemen | {len(ds.DIVISIONS)} / {len(ds.DEPARTMENTS)} |",
        f"| Lolos aturan disiplin = populasi peta Talent Mapping | {len(on_map)} |",
        f"| Belum terpetakan (tanpa HAV) | {len(unplaced)} ({', '.join(e.npk for e in unplaced)}) |",
        f"| Lolos Talent Pool (aturan bawaan program Talent Pool) | {len(tp)} |",
        f"| HAV dari unggahan (12-hav-quadrant.xlsx) | {sum(e.hav_upload is not None for e in ds.EMPLOYEES)} |",
        "",
        "Kolom *PA* ditulis seperti `performance_grade` kandidat: enam periode, terbaru dulu "
        f"({as_of.year - 1} S2, {as_of.year - 1} S1, {as_of.year - 2} S2, …). *HAV rumus* = PA × assessment perilaku "
        "(`lib/hav-quadrant-derive.ts`); *HAV berlaku* = unggahan bila ada, selain itu rumus. Kolom *Talent Pool* "
        "memakai aturan bawaan program Talent Pool; bila aturan di Tata Kelola sudah diubah, hasilnya ikut berubah.",
        "",
        "| NPK | Nama | Jabatan saat ini | Grade | Masa kerja | PA | Assessment perilaku | HAV rumus | HAV unggahan | HAV berlaku | Disiplin | MCU | Talent Pool | Yang diperagakan |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for e in ds.EMPLOYEES:
        latest = max(e.assessments, key=lambda a: a.held).recommendation if e.assessments else "—"
        mcu = e.mcu[0] if e.mcu else "— (bawaan fit)"
        lines.append(
            f"| {e.npk} | {e.name} | {e.position.internal_title} | {e.grade} | {_years(e, as_of)} th | `{_pa_csv(e)}` "
            f"| {latest} | {e.expect_formula or '—'} | {e.hav_upload or '—'} | {e.expect_hav or '—'} "
            f"| {e.expect_discipline} | {mcu} | {'Lolos' if e.expect_talent_pool else 'Tidak'} | {e.story} |"
        )

    lines += [
        "",
        "## Posisi",
        "",
        "| POSITION_ID | Jabatan | Grade | Atasan | Pemegang saat ini | Job profile demo |",
        "|---|---|---|---|---|---|",
    ]
    jds = dict(ds.JOB_PROFILE_SEATS)
    for p in ds.POSITIONS:
        holders = ds.holders_of(p.code)
        acting = [e for e in ds.EMPLOYEES for s in e.stints if s.position == p.code and not s.primary and s.end is None]
        if p.valid_to is not None:
            who = f"— (jabatan lama, berlaku s.d. {p.valid_to.isoformat()})"
        elif holders:
            who = ", ".join(f"{e.name} ({e.npk})" for e in holders)
        else:
            who = "**KOSONG**" + (f" — Plt. {', '.join(f'{e.name} ({e.npk})' for e in acting)}" if acting else "")
        parent = ds.POSITION_BY_CODE[p.parent].internal_title if p.parent else "— (puncak)"
        lines.append(f"| {p.code} | {p.internal_title} | {p.grade} | {parent} | {who} | {jds.get(p.code, '')} |")

    lines += [
        "",
        "## Kompetensi teknis (kamus demo)",
        "",
        "| Kode di kamus demo | Nama | Dipakai di 06-kompetensi-teknis.xlsx |",
        "|---|---|---|",
    ]
    for key, (code, name) in sorted(ds.COMPETENCIES.items(), key=lambda kv: kv[1][0]):
        n = sum(1 for e in ds.EMPLOYEES for k, _ in e.position.competencies if k == key)
        lines.append(f"| {code} | {name} | {n} baris |")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
