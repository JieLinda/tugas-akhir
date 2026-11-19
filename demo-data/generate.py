#!/usr/bin/env python3
"""Generate the Pulse demo files (Excel workbooks + PDFs) from generator/dataset.py.

    python3 demo-data/generate.py                 # rewrite the committed files (blank FK cells)
    python3 demo-data/generate.py --as-of 2027-03-01
    python3 demo-data/generate.py --company DEMO --kamus-demo-codes --out /tmp/demo-terisi
    python3 demo-data/generate.py --npk-prefix 98 --out /tmp/demo-npk98

Requires: openpyxl, reportlab  (pip install openpyxl reportlab)

The committed files deliberately leave COMPANY_ID and TECHNICAL_ID blank: those
cells must point at data that already exists in the target database. The two
fill options exist for a self-contained demo database; they refuse to write
into the committed folder so the blank set is never overwritten by accident.
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--as-of", type=date.fromisoformat, default=date.today(),
                        help="reference date for appraisal years and disciplinary dates (default: today)")
    parser.add_argument("--company", help="fill COMPANY_ID with this code (must be active in sync_company_tenant_map)")
    parser.add_argument("--kamus-demo-codes", action="store_true",
                        help="fill TECHNICAL_ID with the demo kamus codes TC 901-TC 914")
    parser.add_argument("--npk-prefix", help="move NPKs 99001-99046 to <prefix>001-<prefix>046 (two digits, e.g. 98)")
    parser.add_argument("--out", type=Path, default=HERE, help="output folder (default: demo-data/)")
    parser.add_argument("--skip-pdf", action="store_true", help="write the Excel workbooks only")
    args = parser.parse_args()

    variant = bool(args.company) or args.kamus_demo_codes or bool(args.npk_prefix)
    if variant and args.out.resolve() == HERE:
        parser.error("--company / --kamus-demo-codes / --npk-prefix write a VARIANT; pass --out to a different "
                     "folder so the committed files are not overwritten")
    if args.company and len(args.company) > 10:
        parser.error("COMPANY_ID is varchar(10) in the sync tables")
    if args.npk_prefix:
        try:
            dataset.renumber(args.npk_prefix)
        except ValueError as err:
            parser.error(str(err))

    opts = Options(as_of=args.as_of, company=args.company, kamus_demo_codes=args.kamus_demo_codes)

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
