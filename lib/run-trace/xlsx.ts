import 'server-only';

// Render a WorkbookModel with SheetJS. Formula cells are written WITHOUT cached
// values: the file is recalculated by whatever opens it (Excel performs a full
// calculation for a workbook carrying no calc chain; LibreOffice computes every
// formula cell that has no stored result), so a reader always sees what the
// formulas produce — never a number this server asserted.

import * as XLSX from 'xlsx';
import type { Cell, WorkbookModel } from './sheet';

function toSheetJsCell(cell: Cell): XLSX.CellObject | null {
  if (cell === null || cell === undefined || cell === '') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? { t: 'n', v: cell } : null;
  if (typeof cell === 'string') return { t: 's', v: cell };
  if (typeof cell === 'boolean') return { t: 'b', v: cell };
  if (cell.f) {
    const out: XLSX.CellObject = { t: cell.t ?? 'n', f: cell.f } as XLSX.CellObject;
    if (cell.z) out.z = cell.z;
    return out;
  }
  const v = cell.v;
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? { t: 'n', v, ...(cell.z ? { z: cell.z } : {}) } : null;
  if (typeof v === 'boolean') return { t: 'b', v };
  return { t: 's', v: String(v) };
}

export function renderTraceWorkbook(model: WorkbookModel): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of model.sheets) {
    const ws: XLSX.WorkSheet = {};
    let maxCol = 0;
    sheet.rows.forEach((row, r) => {
      if (!row) return;
      row.forEach((cell, c) => {
        const out = toSheetJsCell(cell as Cell);
        if (!out) return;
        ws[XLSX.utils.encode_cell({ r, c })] = out;
        if (c > maxCol) maxCol = c;
      });
    });
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, sheet.rows.length - 1), c: maxCol } });
    if (sheet.widths.length) ws['!cols'] = sheet.widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  wb.Workbook = { Names: model.names.map((n) => ({ Name: n.name, Ref: n.ref, ...(n.comment ? { Comment: n.comment } : {}) })) };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}
