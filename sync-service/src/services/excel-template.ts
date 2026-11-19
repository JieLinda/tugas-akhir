import { utils, write as xlsxWrite } from "xlsx";
import type { ExcelSourceSpec } from "./excel-sources.js";

/**
 * Build the downloadable starter workbook for an Excel source, from the SAME
 * spec the parser reads.
 *
 * Generated on demand rather than committed as a binary: the older HAV/MCU
 * templates are checked-in .xlsx files produced by a script nobody is obliged to
 * re-run, so a column rename in the parser leaves a template that silently
 * produces zero rows. Deriving both from one spec makes that class of drift
 * impossible.
 */

/** Column widths so the sheet is readable without manual resizing. */
const widthsFor = (spec: ExcelSourceSpec) =>
  spec.columns.map((c) => ({ wch: c.width ?? Math.max(12, c.header.length + 2) }));

function petunjukSheet(lines: string[]) {
  // Single unnamed column: this sheet is never parsed, only read by humans.
  const ws = utils.aoa_to_sheet(lines.map((l) => [l]));
  ws["!cols"] = [{ wch: 104 }];
  return ws;
}

function instructions(spec: ExcelSourceSpec): string[] {
  const conflict = spec.conflictTarget
    .map((c) => spec.columns.find((col) => col.column === c)?.header ?? c.toUpperCase())
    .join(" + ");

  const derivedKey = (spec.derived ?? []).some((d) => spec.conflictTarget.includes(d.column));
  const keySentence = derivedKey
    ? spec.immutable
        ?.filter((c) => c !== "source_key")
        .map((c) => spec.columns.find((col) => col.column === c)?.header ?? c.toUpperCase())
        .join(" + ") ?? conflict
    : conflict;

  const lines: string[] = [
    `PETUNJUK PENGISIAN — ${spec.label.toUpperCase()}`,
    "",
    spec.desc,
    "",
    "SHEET DATA:",
    `  Data dibaca dari sheet bernama "${spec.sheet}". Bila sheet dengan nama itu tidak ada,`,
    "  sistem memakai sheet PERTAMA. Sheet Petunjuk ini diabaikan selama namanya bukan",
    `  "${spec.sheet}" dan tidak dipindah ke urutan pertama.`,
    "",
    "BARIS HEADER:",
    "  Baris pertama harus berisi nama kolom. Huruf besar/kecil dan spasi di awal/akhir",
    "  TIDAK berpengaruh — 'employee_id', 'EMPLOYEE_ID', dan ' Employee_Id ' sama saja.",
    "  Urutan kolom bebas. Kolom tambahan yang tidak dikenal diabaikan, bukan error.",
    "",
    "KOLOM:",
  ];

  for (const col of spec.columns) {
    lines.push(`  ${col.note}`);
  }

  lines.push(
    "",
    "KUNCI BARIS (menentukan memperbarui atau menambah):",
    `  ${keySentence}`,
    "  Baris dengan kunci yang sama dengan data yang sudah ada akan MEMPERBARUI baris itu.",
    "  Kunci yang belum ada akan menambah baris baru.",
    "",
    "SIFAT UNGGAHAN — MEMPERBARUI, BUKAN MENGGANTI:",
    "  Unggahan ini TIDAK PERNAH menghapus. Data yang tidak ada di file tetap utuh apa adanya.",
    "  Jadi file boleh berisi hanya baris yang ingin diperbarui, tidak harus seluruh data.",
    "",
    "BARIS YANG DILEWATI:",
    "  Baris yang salah satu kolom wajibnya kosong akan DILEWATI, bukan membatalkan seluruh",
    "  proses. Jumlah dan alasan baris yang dilewati dilaporkan setelah unggahan selesai.",
    "",
    "FORMAT TANGGAL:",
    "  Gunakan YYYY-MM-DD (mis. 2024-03-11) atau DD/MM/YYYY. Sel bertipe tanggal Excel juga",
    "  diterima. Komponen jam diabaikan — hanya tanggalnya yang disimpan.",
    "",
  );

  if (spec.extraNotes?.length) {
    lines.push("CATATAN KHUSUS:", ...spec.extraNotes.map((n) => (n ? `  ${n}` : "")), "");
  }

  lines.push(
    "SETELAH DIUNGGAH:",
    "  Berkas langsung diproses lalu DIHAPUS dari server. Simpan salinan Anda sendiri.",
    "  Berkas yang GAGAL diproses tidak dihapus, supaya bisa diperiksa.",
    "",
    "  Unggahan hanya berlaku sekali: sinkronisasi terjadwal berikutnya kembali menarik data",
    "  dari sumber aslinya (MSSQL / API HR).",
    "",
    `Hapus baris contoh di sheet "${spec.sheet}" sebelum mengisi data sebenarnya.`,
  );

  return lines;
}

/** The .xlsx bytes of the starter workbook for `spec`. */
export function buildTemplateWorkbook(spec: ExcelSourceSpec): Buffer {
  const wb = utils.book_new();

  const header = spec.columns.map((c) => c.header);
  const sampleRows = [0, 1, 2].map((i) =>
    spec.columns.map((c) => {
      const v = c.samples[i];
      return v instanceof Date ? v.toISOString().slice(0, 10) : v;
    }),
  );

  const data = utils.aoa_to_sheet([header, ...sampleRows]);
  data["!cols"] = widthsFor(spec);
  // Appended first so it is SheetNames[0] — the fallback the parser uses when
  // the sheet has been renamed.
  utils.book_append_sheet(wb, data, spec.sheet);
  utils.book_append_sheet(wb, petunjukSheet(instructions(spec)), "Petunjuk");

  return xlsxWrite(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Download file name for the template of `spec`. */
export function templateFileName(spec: ExcelSourceSpec): string {
  return `template-${spec.key}.xlsx`;
}
