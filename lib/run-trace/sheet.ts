// A tiny, pure model of a workbook — cells, formulas, defined names — that the
// trace export builds sheet by sheet and lib/run-trace/xlsx.ts hands to SheetJS.
//
// Pure on purpose (no SheetJS, no database): the formulas are the deliverable,
// and keeping their construction free of I/O is what lets a test build a
// workbook from a fixture and recalculate it.
//
// FORMULA CONVENTIONS, binding for every sheet:
//   • formulas are written WITHOUT the leading "=" (OOXML stores them that way);
//   • functions introduced after Excel 2007 MUST carry the `_xlfn.` prefix in the
//     file (PERCENTILE.INC, MAXIFS) — without it Excel and LibreOffice both show
//     #NAME?. Use `fn()` below rather than typing the prefix by hand;
//   • parameters are referenced by DEFINED NAME (P_…), never by address, so a
//     reader sees `P_TEK_L` in the formula bar instead of `Parameter!$C$7`.

export type CellValue = string | number | boolean | null;

export type Cell =
  | CellValue
  | {
      /** Formula text without "=". */
      f?: string;
      /** A constant (or, beside `f`, nothing — values are left to the recalculation). */
      v?: CellValue;
      /** Number format, e.g. "0.000000", "yyyy-mm-dd hh:mm:ss". */
      z?: string;
      /** Result type hint for a formula: n(umber), s(tring), b(oolean). */
      t?: 'n' | 's' | 'b';
    };

export type SheetModel = {
  name: string;
  rows: Cell[][];
  /** Column widths in characters. */
  widths: number[];
};

export type WorkbookModel = {
  sheets: SheetModel[];
  names: { name: string; ref: string; comment?: string }[];
};

/** Modern functions that OOXML stores with the `_xlfn.` prefix. */
const XLFN = new Set(['PERCENTILE.INC', 'MAXIFS', 'MINIFS', 'TEXTJOIN', 'CONCAT']);

/** A function name as the file must store it. */
export function fn(name: string): string {
  return XLFN.has(name) ? `_xlfn.${name}` : name;
}

/** 0-based column index → letters (0 → A, 26 → AA). */
export function colName(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Quote a sheet name for a reference ('Teknis - Pasangan'!A1). */
export function q(sheet: string): string {
  return `'${sheet.replace(/'/g, "''")}'`;
}

/** A1 reference. `row` is 1-based; `col` 0-based. `abs` pins both parts. */
export function a1(col: number, row: number, abs = false): string {
  return abs ? `$${colName(col)}$${row}` : `${colName(col)}${row}`;
}

/** Reference into another sheet. */
export function xref(sheet: string, col: number, row: number, abs = true): string {
  return `${q(sheet)}!${a1(col, row, abs)}`;
}

/** A rectangular range on a sheet (rows 1-based, inclusive). */
export function xrange(sheet: string | null, col1: number, row1: number, col2: number, row2: number): string {
  const r = `$${colName(col1)}$${row1}:$${colName(col2)}$${row2}`;
  return sheet ? `${q(sheet)}!${r}` : r;
}

/** A whole column on a sheet — for SUMIFS / COUNTIFS / MAXIFS lookups. */
export function xcol(sheet: string, col: number): string {
  return `${q(sheet)}!$${colName(col)}:$${colName(col)}`;
}

/** Excel string literal. */
export function str(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/** Excel serial (days since 1899-12-30) of an ISO instant, in UTC. */
export function serialOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms / 86_400_000 + 25_569 : null;
}

/** Excel serial of a local calendar date "YYYY-MM-DD" (midnight). */
export function serialOfDate(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 + 25_569;
}

export const DATE_TIME = 'yyyy-mm-dd hh:mm:ss';
export const DATE_ONLY = 'yyyy-mm-dd';
export const FULL = '0.000000000';

/** Formula cell helpers. */
export const F = (f: string, z?: string): Cell => ({ f, t: 'n', ...(z ? { z } : {}) });
export const FS = (f: string): Cell => ({ f, t: 's' });
export const FB = (f: string): Cell => ({ f, t: 'b' });
/** A constant with a number format. */
export const N = (v: number | null | undefined, z?: string): Cell =>
  v == null || !Number.isFinite(v) ? null : z ? { v, z } : v;

/**
 * One sheet under construction. Rows are appended; `row()` returns the 1-based
 * row number the cells landed on, which is what formulas need.
 */
export class SheetBuilder {
  readonly name: string;
  readonly rows: Cell[][] = [];
  widths: number[] = [];

  constructor(name: string, widths: number[] = []) {
    // Excel caps sheet names at 31 characters.
    this.name = name.slice(0, 31);
    this.widths = widths;
  }

  /** Append a row; returns its 1-based number. */
  row(cells: Cell[] = []): number {
    this.rows.push(cells);
    return this.rows.length;
  }

  /** The row number the NEXT `row()` call will return. */
  get next(): number {
    return this.rows.length + 1;
  }

  /** Append several text lines (one per row, column A). */
  lines(texts: string[]): void {
    for (const t of texts) this.row([t]);
  }

  blank(n = 1): void {
    for (let i = 0; i < n; i++) this.row([]);
  }

  toModel(): SheetModel {
    return { name: this.name, rows: this.rows, widths: this.widths };
  }
}

/** Δ column formula: blank when either side is blank, else a − b. */
export function deltaF(a: string, b: string): Cell {
  return F(`IF(OR(${a}="",${b}=""),"",${a}-${b})`);
}

/**
 * Count of mismatches over a Δ column — the per-stage check. A row counts when
 * |Δ| exceeds the tolerance, when it reads "BEDA" (a text comparison), or when
 * it is an ERROR: COUNTIF skips error cells, so without the ISERROR term a
 * column of #NAME? (an Excel without MAXIFS) would report zero mismatches.
 *
 * `toleranceCell` is a REFERENCE to a numeric cell, never a number pasted into
 * the criterion: COUNTIF parses its criterion text in the reader's locale, so
 * ">0.000001" written as text means something else (or nothing) in an Excel
 * using a decimal comma, and a criterion that never matches counts zero — a
 * vacuous "all clear". ">"&C5 converts the number with the same locale that
 * then parses it back.
 */
export function mismatchCountF(range: string, toleranceCell: string): Cell {
  return F(
    `COUNTIF(${range},">"&${toleranceCell})+COUNTIF(${range},"<"&-${toleranceCell})+COUNTIF(${range},"BEDA")+SUMPRODUCT(--ISERROR(${range}))`,
  );
}
