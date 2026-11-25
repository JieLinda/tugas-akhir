/**
 * Static check of the demo upload set (demo-data/): does every file agree with
 * the upload contract AND with every other file it refers to?
 *
 *   cd sync-service && npx tsx scripts/verify-demo-data.ts [path/to/demo-data]
 *
 * Reads the files the way the ingesters do — headers and sheet names against
 * EXCEL_SOURCES, NPKs through npkKey, the kamus through the real parseKamusPdf —
 * and checks every foreign key between them:
 *   • COMPANY_ID: present, upper case, and ONE value across the ten company files;
 *   • NPK: unique in Data Karyawan, already in canonical form (npkKey(v) === v),
 *     and every NPK in placements / competencies / PA / BA / disciplinary /
 *     education / MCU / HAV exists in Data Karyawan;
 *   • POSITION_ID (placements, competencies, hierarchy incl. parent) in Master Jabatan;
 *   • GRADE_ID (employees, positions, competencies) in Level & Grade;
 *   • TECHNICAL_ID in the kamus PDF, with the kamus' own name;
 *   • each employee's open primary placement is the position Data Karyawan names;
 *   • each job-profile PDF's file name starts with a position code from Master
 *     Jabatan, and its text lists every competency the competency file demands
 *     for that seat.
 * Exits 1 on any failure. No database, no network.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { read as xlsxRead, utils } from "xlsx";
import { EXCEL_SOURCES } from "../src/services/excel-sources.js";
import { parseKamusPdf } from "../src/services/kamus-sync.js";
import { npkKey } from "../src/services/npk.js";

type Row = Record<string, unknown>;
const root = resolve(process.argv[2] ?? "../demo-data");
let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
};
const str = (v: unknown) => (v == null ? "" : String(v).trim());

const FILES: Record<string, string> = {
  employees: "01-data-karyawan.xlsx",
  "grade-levels": "02-level-grade.xlsx",
  "positions-master": "03-master-jabatan.xlsx",
  "positions-hierarchy": "04-hierarki-jabatan.xlsx",
  "positions-employees": "05-penempatan-karyawan.xlsx",
  "positions-competencies": "06-kompetensi-teknis.xlsx",
  performance: "07-penilaian-kinerja.xlsx",
  "behavior-competencies": "08-kompetensi-perilaku.xlsx",
  disciplinary: "09-catatan-disiplin.xlsx",
  education: "10-riwayat-pendidikan.xlsx",
};

function sheetRows(file: string, sheet?: string): { headers: string[]; rows: Row[]; sheetName: string } {
  const wb = xlsxRead(readFileSync(join(root, "excel", file)), { type: "buffer", cellDates: false });
  const sheetName = sheet ?? wb.SheetNames[0]!;
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`${file}: sheet ${sheetName} missing (has ${wb.SheetNames.join(", ")})`);
  const grid = utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const headers = (grid[0] ?? []).map((h) => str(h));
  const rows = utils.sheet_to_json<Row>(ws, { defval: null });
  return { headers, rows, sheetName };
}

async function main() {
  console.log(`demo-data: ${root}\n`);
  const data: Record<string, Row[]> = {};

  // 1. Contract: sheet name + every spec header, per Excel source.
  for (const spec of EXCEL_SOURCES) {
    const file = FILES[spec.key];
    if (!file) { check(false, `${spec.key}: no demo file for this upload source`); continue; }
    const { headers, rows, sheetName } = sheetRows(file, spec.sheet);
    const missing = spec.columns.map((c) => c.header).filter((h) => !headers.includes(h));
    check(sheetName === spec.sheet && missing.length === 0, `${file}: sheet "${spec.sheet}" with all ${spec.columns.length} template headers`, { missing });
    const required = spec.columns.filter((c) => c.required).map((c) => c.header);
    const blank = rows.filter((r) => required.some((h) => str(r[h]) === "")).length;
    check(blank === 0, `${file}: ${rows.length} rows, every required column filled`, { blankRows: blank, required });
    data[spec.key] = rows;
  }
  const hav = sheetRows("12-hav-quadrant.xlsx", "ALL");
  check(["NPK", "NAMA", "Quadrant"].every((h) => hav.headers.includes(h)), "12-hav-quadrant.xlsx: sheet ALL with NPK / NAMA / Quadrant (case-sensitive)");
  const mcu = sheetRows("11-status-mcu.xlsx");
  check(["NPK", "Nama", "Kesimpulan"].every((h) => mcu.headers.includes(h)), "11-status-mcu.xlsx: first sheet with NPK / Nama / Kesimpulan");

  // 2. COMPANY_ID: one upper-case value everywhere.
  const companies = new Set<string>();
  for (const k of Object.keys(FILES)) for (const r of data[k] ?? []) companies.add(str(r.COMPANY_ID));
  const [company] = [...companies];
  check(companies.size === 1 && !!company && company === company.toUpperCase(), `COMPANY_ID is one upper-case value in all ten files: ${[...companies].join(", ")}`);

  // 3. NPK identity.
  const emps = data.employees ?? [];
  const npks = emps.map((r) => str(r.EMPLOYEE_ID));
  check(new Set(npks).size === npks.length, `Data Karyawan: ${npks.length} unique NPKs`);
  const nonCanonical = npks.filter((n) => npkKey(n) !== n);
  check(nonCanonical.length === 0, "every NPK is already in LPAD form (npkKey(v) === v), so padded and employee-form tables agree", nonCanonical);
  const known = new Set(npks.map(npkKey));
  const npkRefs: Array<[string, Row[], string]> = [
    ["05 penempatan", data["positions-employees"] ?? [], "EMPLOYEE_ID"],
    ["06 kompetensi teknis", data["positions-competencies"] ?? [], "EMPLOYEE_ID"],
    ["07 penilaian kinerja", data.performance ?? [], "EMPLOYEE_ID"],
    ["08 kompetensi perilaku", data["behavior-competencies"] ?? [], "EMPLOYEE_ID"],
    ["09 catatan disiplin", data.disciplinary ?? [], "EMPLOYEE_ID"],
    ["10 riwayat pendidikan", data.education ?? [], "EMPLOYEE_ID"],
    ["11 status MCU", mcu.rows, "NPK"],
    ["12 HAV", hav.rows, "NPK"],
  ];
  for (const [label, rows, col] of npkRefs) {
    const orphans = [...new Set(rows.map((r) => str(r[col])).filter((n) => !known.has(npkKey(n))))];
    check(orphans.length === 0, `${label}: every NPK (${new Set(rows.map((r) => str(r[col]))).size}) is in Data Karyawan`, orphans);
  }

  // 4. Positions.
  const positions = data["positions-master"] ?? [];
  const posIds = new Set(positions.map((r) => str(r.POSITION_ID)));
  const posRefs: Array<[string, Row[], string[]]> = [
    ["04 hierarki", data["positions-hierarchy"] ?? [], ["POSITION_ID", "PARENT_POSITION_ID"]],
    ["05 penempatan", data["positions-employees"] ?? [], ["POSITION_ID"]],
    ["06 kompetensi teknis", data["positions-competencies"] ?? [], ["POSITION_ID"]],
  ];
  for (const [label, rows, cols] of posRefs) {
    const orphans = new Set<string>();
    for (const r of rows) for (const c of cols) { const v = str(r[c]); if (v && !posIds.has(v)) orphans.add(v); }
    check(orphans.size === 0, `${label}: every ${cols.join(" / ")} is in Master Jabatan`, [...orphans]);
  }

  // 5. Grades.
  const grades = new Set((data["grade-levels"] ?? []).map((r) => str(r.GRADE_ID)));
  for (const [label, rows] of [["01 karyawan", emps], ["03 master jabatan", positions], ["06 kompetensi teknis", data["positions-competencies"] ?? []]] as const) {
    const orphans = [...new Set(rows.map((r) => str(r.GRADE_ID)).filter((g) => g && !grades.has(g)))];
    check(orphans.length === 0, `${label}: every GRADE_ID is in Level & Grade`, orphans);
  }

  // 6. Each employee sits where Data Karyawan says (open primary placement).
  const titleByPos = new Map(positions.map((r) => [str(r.POSITION_ID), str(r.INTERNAL_TITLE)]));
  const openPrimary = new Map<string, string>();
  for (const r of data["positions-employees"] ?? []) {
    const primary = ["Y", "TRUE", "1"].includes(str(r.PRIMARY_POSITION).toUpperCase());
    if (primary && str(r.VALID_TO) === "") openPrimary.set(npkKey(str(r.EMPLOYEE_ID)), str(r.POSITION_ID));
  }
  const mismatched = emps
    .filter((e) => titleByPos.get(openPrimary.get(npkKey(str(e.EMPLOYEE_ID))) ?? "") !== str(e.INTERNAL_TITLE))
    .map((e) => str(e.EMPLOYEE_ID));
  check(mismatched.length === 0, `every employee has one open primary placement matching INTERNAL_TITLE (${openPrimary.size}/${emps.length})`, mismatched);

  // 7. Kamus: TECHNICAL_ID defined by the kamus PDF, under the same name.
  const kamusDir = join(root, "pdf", "kamus-kompetensi");
  const kamusFile = readdirSync(kamusDir).find((f) => f.toLowerCase().endsWith(".pdf"))!;
  const kamus = await parseKamusPdf(readFileSync(join(kamusDir, kamusFile)));
  const kamusName = new Map(kamus.map((k) => [k.code, k.name]));
  check(kamus.length > 0 && kamus.every((k) => k.description && Object.values(k.levels).every(Boolean)), `${kamusFile}: ${kamus.length} competencies parse with description and all four levels`);
  const tech = data["positions-competencies"] ?? [];
  const badCodes = [...new Set(tech.map((r) => str(r.TECHNICAL_ID)).filter((c) => !kamusName.has(c)))];
  check(badCodes.length === 0, `06 kompetensi teknis: every TECHNICAL_ID is defined in the kamus PDF`, badCodes);
  const badNames = [...new Set(tech.filter((r) => kamusName.get(str(r.TECHNICAL_ID)) !== str(r.TECHNICAL_NAME)).map((r) => `${str(r.TECHNICAL_ID)}=${str(r.TECHNICAL_NAME)}`))];
  check(badNames.length === 0, "06 kompetensi teknis: TECHNICAL_NAME equals the kamus name of its code", badNames);

  // 8. Job profiles: file name -> position code; text lists the seat's demanded competencies.
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const jpDir = join(root, "pdf", "job-profile");
  for (const file of readdirSync(jpDir).filter((f) => f.toLowerCase().endsWith(".pdf"))) {
    const code = file.split(/\s+/)[0]!;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(join(jpDir, file))), useSystemFonts: true }).promise;
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      text += " " + tc.items.map((i: any) => i.str).join(" ");
    }
    text = text.replace(/\s+/g, " ").toUpperCase();
    const demanded = [...new Set(tech.filter((r) => str(r.POSITION_ID) === code).map((r) => str(r.TECHNICAL_NAME)))];
    const absent = demanded.filter((n) => !text.includes(n.toUpperCase()));
    check(posIds.has(code) && text.includes(titleByPos.get(code)!.toUpperCase()), `${file}: position code ${code} is in Master Jabatan and the document names "${titleByPos.get(code)}"`);
    if (demanded.length > 0) {
      check(absent.length === 0, `${file}: lists all ${demanded.length} competencies 06 demands for ${code}`, absent);
    } else {
      // A vacant seat (no incumbent) has no rows in 06, which is per employee:
      // its competencies can only come from the document — so they must at least
      // be kamus competencies, or scoring could not identify them.
      const fromKamus = kamus.filter((k) => text.includes(k.name.toUpperCase())).map((k) => k.code);
      check(fromKamus.length > 0, `${file}: vacant seat ${code}; its document names ${fromKamus.length} kamus competencies (${fromKamus.join(", ")})`);
    }
  }

  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
