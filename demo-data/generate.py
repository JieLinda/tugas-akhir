#!/usr/bin/env python3
"""Generate the Pulse demo files (Excel workbooks + PDFs) from generator/dataset.py.

    python3 demo-data/generate.py                 # rewrite the committed files (COMPANY_ID=DEMO, TC 9xx)
    python3 demo-data/generate.py --skip-pdf      # Excel only (reportlab not needed)
    python3 demo-data/generate.py --as-of 2027-03-01
    python3 demo-data/generate.py --company MPM9 --out /tmp/demo-mpm9
    python3 demo-data/generate.py --blank --out /tmp/demo-kosong
    python3 demo-data/generate.py --npk-prefix 98 --out /tmp/demo-npk98

Requires: openpyxl, reportlab  (pip install openpyxl reportlab)

The committed set is SELF-CONTAINED: every foreign key is filled and points at
another file of the set — COMPANY_ID is DEMO in all ten company files (map
"DEMO" to any company, built in or added, before uploading) and TECHNICAL_ID is
the demo kamus code TC 901-TC 914 defined by 13-kamus-kompetensi-demo.pdf.
`--blank` writes the older variant whose COMPANY_ID / TECHNICAL_ID cells are
left empty (yellow) to point at a real database. Every variant refuses to write
into the committed folder, so the standard set is never overwritten by accident.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from generator import dataset, excel_writer, sql_writer, summary  # noqa: E402
from generator.excel_writer import Options  # noqa: E402

STANDARD_COMPANY = "DEMO"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(),
                        help="reference date for appraisal years and disciplinary dates (default: today)")
    parser.add_argument("--company", default=STANDARD_COMPANY,
                        help=f"COMPANY_ID written in every row (default {STANDARD_COMPANY}; upper-cased like the ingester)")
    parser.add_argument("--blank", action="store_true",
                        help="leave COMPANY_ID and TECHNICAL_ID empty (yellow), to be filled from a real database")
    parser.add_argument("--npk-prefix", help="move NPKs 99001-99046 to <prefix>001-<prefix>046 (two digits, e.g. 98)")
    parser.add_argument("--out", type=Path, default=HERE, help="output folder (default: demo-data/)")
    parser.add_argument("--skip-pdf", action="store_true", help="write the Excel workbooks only")
    args = parser.parse_args()

    company = None if args.blank else args.company.strip().upper()
    variant = args.blank or company != STANDARD_COMPANY or bool(args.npk_prefix)
    if variant and args.out.resolve() == HERE:
        parser.error("--company / --blank / --npk-prefix write a VARIANT; pass --out to a different "
                     "folder so the committed files are not overwritten")
    if company is not None and not 0 < len(company) <= 10:
        parser.error("COMPANY_ID is varchar(10) in the sync tables")
    if args.npk_prefix:
        try:
            dataset.renumber(args.npk_prefix)
        except ValueError as err:
            parser.error(str(err))

    opts = Options(as_of=args.as_of, company=company, kamus_demo_codes=not args.blank)

    excel_dir = args.out / "excel"
    for path in excel_writer.write_all(excel_dir, opts):
        print(f"excel  {path.relative_to(args.out)}")

    if not args.skip_pdf:
        from generator import pdf_job_profile, pdf_kamus  # reportlab is only needed here

        kamus = pdf_kamus.write(args.out / "pdf" / "kamus-kompetensi", opts.as_of)
        print(f"pdf    {kamus.relative_to(args.out)}")
        for path in pdf_job_profile.write_all(args.out / "pdf" / "job-profile", opts.as_of):
            print(f"pdf    {path.relative_to(args.out)}")

    print(f"md     {summary.write(args.out, opts.as_of).relative_to(args.out)}")
    for path in sql_writer.write_all(args.out):
        print(f"sql    {path.relative_to(args.out)}")
    first, last = dataset.npk_range()
    print(f"\nas-of {opts.as_of.isoformat()}  NPK {first}-{last}  company={opts.company or '(kosong)'}  "
          f"technical_id={'TC 9xx' if opts.kamus_demo_codes else '(kosong)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
