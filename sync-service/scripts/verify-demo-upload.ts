/**
 * End-to-end check of the demo upload set against a RUNNING sync-service and
 * the database it writes — the same two requests the Tambah Data tiles send
 * (upload, then sync with ?uploadsOnly=1), in the README's order.
 *
 *   DATABASE_URL=… npx tsx scripts/verify-demo-upload.ts \
 *     --sync http://localhost:8011 [--web http://localhost:3000] [--set ../demo-data] [--keep]
 *   DATABASE_URL=… npx tsx scripts/verify-demo-upload.ts --cleanup-only <tenant uuid> [--set …]
 *
 * The sync-service must write to DATABASE_URL and have SYNC_SYSTEM_USER_ID set
 * (the candidate sync refuses to run without it).
 *
 * What it proves, against a NEW, NON-BUILT-IN company created for the run:
 *   • valid uploads land, link and derive: candidates, positions, position
 *     history, technical competencies, HAV, MCU, kamus and job profiles all
 *     belong to that company, and every candidate matches its designed outcome
 *     in ringkasan-data-demo.md (position, grade, PA, BA, HAV upload,
 *     discipline, MCU);
 *   • normalisation: a lower-case "demo " Company ID lands as DEMO; an NPK typed
 *     "8999" is stored "08999" in padded tables and "8999" in employee-form ones,
 *     and the candidate sync joins both;
 *   • invalid input is refused or warned about: a workbook with a wrong header
 *     is rejected and writes nothing; rows for an unmapped Company ID, an NPK
 *     outside Data Karyawan, a position outside Master Jabatan and a code
 *     outside the kamus are stored WITH a warning;
 *   • company scoping: the pages show the demo data under the new company and
 *     not under Mulia, and the built-in companies' candidates are untouched.
 * Without --keep everything it created is removed again (the generated
 * hapus-data-demo.sql plus the run's own extras) and the company is tombstoned.
 */
import { readFileSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { read as xlsxRead, utils, write as xlsxWrite } from "xlsx";
import { EXCEL_SOURCES } from "../src/services/excel-sources.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const SYNC = arg("sync") ?? "http://localhost:8011";
const WEB = arg("web");
const SET = resolve(arg("set") ?? "../demo-data");
const KEEP = process.argv.includes("--keep");
const DB = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DB) throw new Error("DATABASE_URL (the database the sync-service writes) is required");

const COMPANY = "DEMO";
const TENANT_NAME = "Demo Uji";
const TENANT_PREFIX = "10000000-0000-0000-0000-";
const LPAD_NPK = "8999"; // synthetic 4-digit employee: padded tables must store "08999"
const UNKNOWN_NPK = "99999"; // not in Data Karyawan
const UNKNOWN_POS = "DMZZ000001"; // not in Master Jabatan

const pool = new pg.Pool({ connectionString: DB });
const q = async <T = any>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
let failures = 0;
const check = (ok: boolean, label: string, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
};
const work = mkdtempSync(join(tmpdir(), "pulse-demo-upload-"));
const xl = (f: string) => join(SET, "excel", f);

// ── HTTP: exactly what the tiles send ──────────────────────────────────────
type SyncReply = { success?: boolean; message?: string; synced?: number; total?: number; warnings?: string[] };
async function upload(kind: string, path: string, filename: string, tenants?: string): Promise<SyncReply> {
  const qs = new URLSearchParams({ filename });
  if (tenants) qs.set("tenants", tenants);
  const res = await fetch(`${SYNC}/api/sync/upload/${kind}?${qs}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: readFileSync(path),
  });
  return (await res.json()) as SyncReply;
}
async function runSync(route: string): Promise<SyncReply> {
  const res = await fetch(`${SYNC}/api/sync/${route}?uploadsOnly=1`, { method: "POST" });
  return (await res.json()) as SyncReply;
}
const specOf = (key: string) => EXCEL_SOURCES.find((s) => s.key === key)!;
async function uploadExcel(key: string, path: string): Promise<SyncReply> {
  const up = await upload(key, path, path.split(/[\\/]/).pop()!);
  if (!up.success) return up;
  return runSync(specOf(key).syncRoute);
}
const hasWarning = (r: SyncReply, needle: string) => (r.warnings ?? []).some((w) => w.includes(needle));

/** A copy of a demo workbook with its data rows edited (sheet name kept). */
function variant(file: string, edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[], renameHeader?: [string, string]): string {
  const wb = xlsxRead(readFileSync(xl(file)), { type: "buffer", cellDates: false });
  const name = wb.SheetNames[0]!;
  let rows = utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]!, { defval: null });
  rows = edit(rows);
  if (renameHeader) rows = rows.map((r) => { const { [renameHeader[0]]: v, ...rest } = r; return { ...rest, [renameHeader[1]]: v }; });
  const out = utils.book_new();
  utils.book_append_sheet(out, utils.json_to_sheet(rows), name);
  const path = join(work, file.replace(".xlsx", `-uji.xlsx`));
  writeFileSync(path, xlsxWrite(out, { type: "buffer", bookType: "xlsx" }));
  return path;
}

async function main() {
  // A run whose cleanup failed left its company behind: remove it and stop.
  const cleanupOnly = arg("cleanup-only");
  if (cleanupOnly) {
    await cleanup(cleanupOnly);
    await pool.end();
    console.log(`\n${failures === 0 ? "CLEANED" : `${failures} FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  }
  console.log(`sync ${SYNC} · web ${WEB ?? "(skipped)"} · set ${SET}\n`);
  const health = await fetch(`${SYNC}/health`).then((r) => r.ok).catch(() => false);
  if (!health) throw new Error(`sync-service not reachable at ${SYNC}`);

  // ── 0. preflight: nothing demo-shaped may exist yet ─────────────────────
  const clash = await q(
    `SELECT 'npk' k, employee_id v FROM sync_employees WHERE employee_id BETWEEN '99001' AND '99046' OR employee_id IN ($1::text,$2::text,'0'||$1::text)
     UNION ALL SELECT 'mapping', company_id FROM sync_company_tenant_map WHERE company_id = $3
     UNION ALL SELECT 'tenant', slug FROM tenants WHERE lower(slug) = lower($4) AND deleted_at IS NULL`,
    [LPAD_NPK, UNKNOWN_NPK, COMPANY, TENANT_NAME],
  );
  if (clash.length > 0) throw new Error(`demo identities already in use: ${JSON.stringify(clash)}`);
  const baseline = await q<{ name: string; n: number }>(
    `SELECT t.name, count(*)::int n FROM candidates c JOIN tenants t ON t.id = c.tenant_id WHERE c.deleted_at IS NULL GROUP BY 1`,
  );

  // ── 1. a NON-built-in company, created by createTenantAction's rule ─────
  const next = (await q<{ n: string }>(
    `SELECT coalesce(max(right(id::text,12)::bigint),0)::text n FROM tenants WHERE id::text LIKE $1 AND right(id::text,12) ~ '^[0-9]{12}$'`,
    [TENANT_PREFIX + "%"],
  ))[0]!.n;
  const slug = TENANT_NAME.toLowerCase();
  // Same rule as createTenantAction: a removed company of that name is RESTORED
  // (same id, the slug index is total); otherwise the next number in the format.
  const removed = await q<{ id: string }>(`SELECT id::text FROM tenants WHERE lower(slug) = $1 AND deleted_at IS NOT NULL`, [slug]);
  const tenantId = removed[0]?.id ?? TENANT_PREFIX + (BigInt(next) + BigInt(1)).toString().padStart(12, "0");
  if (removed[0]) await q(`UPDATE tenants SET name = $2, deleted_at = NULL WHERE id = $1::uuid`, [tenantId, TENANT_NAME]);
  else await q(`INSERT INTO tenants (id, slug, name, is_builtin) VALUES ($1::uuid, $2, $3, false)`, [tenantId, slug, TENANT_NAME]);
  console.log(`company "${TENANT_NAME}" ${tenantId} (not built in${removed[0] ? ", restored" : ""})\n`);

  try {
    // ── 2. invalid template: wrong header -> rejected, nothing written ────
    const badHeader = variant("09-catatan-disiplin.xlsx", (r) => r, ["EMPLOYEE_ID", "NIK"]);
    const bad = await uploadExcel("disciplinary", badHeader);
    const wrote = (await q(`SELECT count(*)::int n FROM sync_disciplinary WHERE employee_id BETWEEN '99001' AND '99046'`))[0].n;
    check(bad.success === false && /Kolom wajib tidak ditemukan.*EMPLOYEE_ID/.test(bad.message ?? "") && wrote === 0,
      "invalid template (EMPLOYEE_ID header renamed) is REJECTED and writes nothing", bad.message);

    // ── 3. employees BEFORE the mapping exists -> stored, with a warning ──
    const employees = variant("01-data-karyawan.xlsx", (rows) => {
      const model = rows[rows.length - 1]!;
      return [...rows, { ...model, EMPLOYEE_ID: LPAD_NPK, DISPLAY_NAME: "Uji Normalisasi NPK" }];
    });
    const empRes = await uploadExcel("employees", employees);
    check(empRes.success === true && hasWarning(empRes, `COMPANY_ID ${COMPANY} belum dipetakan`),
      `Data Karyawan uploaded before the mapping: stored (${empRes.synced} rows) and WARNED that ${COMPANY} is unmapped`, empRes);

    // ── 4. the mapping, by the web action's rule (trim + upper case) ──────
    await q(`INSERT INTO sync_company_tenant_map (company_id, tenant_id, label, is_active) VALUES ($1, $2::uuid, $3, true)`,
      [" demo ".trim().toUpperCase(), tenantId, TENANT_NAME]);

    // ── 5. the rest, in README order, with the invalid cases mixed in ─────
    const steps: Array<[string, string, (r: SyncReply) => void]> = [];
    const expectClean = (label: string) => (r: SyncReply) =>
      check(r.success === true && !(r.warnings?.length), `${label}: ${r.synced} rows, no warnings`, r);
    steps.push(["grade-levels", xl("02-level-grade.xlsx"), expectClean("02 Level & Grade")]);
    steps.push(["positions-master", xl("03-master-jabatan.xlsx"), expectClean("03 Master Jabatan")]);
    steps.push(["positions-hierarchy",
      variant("04-hierarki-jabatan.xlsx", (rows) => [...rows, { ...rows[1]!, POSITION_ID: UNKNOWN_POS, PARENT_POSITION_ID: rows[1]!.POSITION_ID }]),
      (r) => check(r.success === true && hasWarning(r, UNKNOWN_POS), `04 Hierarki + 1 row for ${UNKNOWN_POS}: stored and WARNED (position not in Master Jabatan)`, r)]);
    steps.push(["positions-employees",
      variant("05-penempatan-karyawan.xlsx", (rows) => {
        const model = rows.find((x) => String(x.EMPLOYEE_ID) === "99046" && !x.VALID_TO)!;
        return [...rows, { ...model, EMPLOYEE_ID: LPAD_NPK }];
      }),
      expectClean("05 Penempatan (+ the 4-digit NPK row)")]);
    steps.push(["positions-competencies", xl("06-kompetensi-teknis.xlsx"),
      (r) => check(r.success === true && hasWarning(r, "TECHNICAL_ID tidak ada di Kamus"), "06 Kompetensi Teknis BEFORE the kamus: stored and WARNED (14 codes unknown)", r)]);
    steps.push(["performance", xl("07-penilaian-kinerja.xlsx"), expectClean("07 Penilaian Kinerja")]);
    steps.push(["behavior-competencies", xl("08-kompetensi-perilaku.xlsx"), expectClean("08 Kompetensi Perilaku")]);
    steps.push(["disciplinary",
      variant("09-catatan-disiplin.xlsx", (rows) => [
        ...rows.map((x) => ({ ...x, COMPANY_ID: "demo " })),
        { ...rows[0]!, COMPANY_ID: "demo ", EMPLOYEE_ID: "0" + LPAD_NPK, DISCIPLINARY_NO: 1, LETTER_NO: "UJI-LPAD" },
        { ...rows[0]!, COMPANY_ID: "demo ", EMPLOYEE_ID: UNKNOWN_NPK, DISCIPLINARY_NO: 1, LETTER_NO: "UJI-NPK" },
      ]),
      (r) => check(r.success === true && hasWarning(r, UNKNOWN_NPK) && !hasWarning(r, "belum dipetakan"),
        `09 Disiplin with COMPANY_ID "demo " + an unknown NPK: no mapping warning (normalised), WARNED about ${UNKNOWN_NPK}`, r)]);
    steps.push(["education", xl("10-riwayat-pendidikan.xlsx"), expectClean("10 Riwayat Pendidikan")]);
    for (const [key, path, verify] of steps) verify(await uploadExcel(key, path));

    const mcuUp = await upload("mcu", xl("11-status-mcu.xlsx"), "11-status-mcu.xlsx");
    const mcu = mcuUp.success ? await runSync("mcu") : mcuUp;
    check(mcu.success === true && !(mcu.warnings?.length), `11 Status MCU: ${mcu.synced} records, no warnings`, mcu);

    const kamusDir = join(SET, "pdf", "kamus-kompetensi");
    const kamusFile = readdirSync(kamusDir).find((f) => f.endsWith(".pdf"))!;
    const kUp = await upload("kamus", join(kamusDir, kamusFile), kamusFile);
    const kamus = kUp.success ? await runSync("kamus-kompetensi") : kUp;
    check(kamus.success === true, `13 Kamus PDF: ${kamus.message}`, kamus);
    const tech2 = await uploadExcel("positions-competencies", xl("06-kompetensi-teknis.xlsx"));
    check(tech2.success === true && !(tech2.warnings?.length), "06 Kompetensi Teknis re-uploaded AFTER the kamus: no warnings", tech2);

    const havUp = await upload("hav", xl("12-hav-quadrant.xlsx"), "12-hav-quadrant.xlsx");
    const hav = havUp.success ? await runSync("hav") : havUp;
    check(hav.success === true && !(hav.warnings?.length), `12 HAV: ${hav.message?.slice(0, 120)}`, hav);

    const jpDir = join(SET, "pdf", "job-profile");
    const jps = readdirSync(jpDir).filter((f) => f.endsWith(".pdf"));
    for (const f of jps) {
      const r = await upload("job-profiles", join(jpDir, f), f, tenantId);
      if (!r.success) check(false, `job profile upload ${f}`, r);
    }
    const jpSync = await runSync("job-profiles");
    check(jpSync.success !== false, `14 Job Profile: ${jps.length} PDFs queued for extraction`, jpSync);
    // Extraction is a vision-model call per document; wait for terminal states.
    const deadline = Date.now() + 10 * 60_000;
    let jpRows: Array<{ file_name: string; status: string; queued: boolean; position_name: string | null }> = [];
    while (Date.now() < deadline) {
      jpRows = await q(`SELECT file_name, status, queued_at IS NOT NULL queued, position_name FROM sync_job_profiles WHERE file_name LIKE '%JD-DMO-%'`);
      if (jpRows.length === jps.length && jpRows.every((r) => !r.queued && ["completed", "failed"].includes(r.status))) break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    check(jpRows.length === jps.length && jpRows.every((r) => r.status === "completed"),
      `job profiles extracted: ${jpRows.filter((r) => r.status === "completed").length}/${jps.length} completed`, jpRows);

    // ── 6. database: linked to the right company and keys ─────────────────
    const stored = await q(`SELECT DISTINCT company_id FROM sync_disciplinary WHERE employee_id IN ('99013','99018')`);
    check(stored.length === 1 && stored[0].company_id === COMPANY, `"demo " stored as ${COMPANY}`, stored);
    const padded = await q(`SELECT employee_id FROM sync_employee_positions WHERE company_id=$1 AND employee_id IN ($2::text, '0'||$2::text)`, [COMPANY, LPAD_NPK]);
    const empForm = await q(`SELECT employee_id FROM sync_disciplinary WHERE company_id=$1 AND letter_no='UJI-LPAD'`, [COMPANY]);
    check(padded.length === 1 && padded[0].employee_id === "0" + LPAD_NPK && empForm[0]?.employee_id === LPAD_NPK,
      `NPK "${LPAD_NPK}" stored "0${LPAD_NPK}" in placements (padded) and "0${LPAD_NPK}" -> "${LPAD_NPK}" in disciplinary (employee form)`, { padded, empForm });

    const cands = await q<any>(`SELECT * FROM candidates WHERE tenant_id = $1::uuid AND deleted_at IS NULL`, [tenantId]);
    const lpadCand = cands.find((c) => c.employee_id === LPAD_NPK);
    check(cands.length === 47, `company "${TENANT_NAME}" has 47 candidates (46 demo + the 4-digit NPK)`, cands.length);
    check(!!lpadCand && lpadCand.current_position && lpadCand.discipline_status === "ST",
      `candidate ${LPAD_NPK}: current position "${lpadCand?.current_position}" (padded placement) and discipline ST (employee-form record) both joined`, lpadCand && { pos: lpadCand.current_position, disc: lpadCand.discipline_status });
    const counts = (await q(
      `SELECT (SELECT count(*)::int FROM positions WHERE tenant_id=$1::uuid) pos,
              (SELECT count(*)::int FROM positions WHERE tenant_id=$1::uuid AND position_id LIKE 'DM%') pos_dm,
              (SELECT count(*)::int FROM candidate_position_history h JOIN candidates c ON c.id=h.candidate_id WHERE c.tenant_id=$1::uuid) hist,
              (SELECT count(*)::int FROM candidate_technical_competencies t JOIN candidates c ON c.id=t.candidate_id WHERE c.tenant_id=$1::uuid) tech,
              (SELECT count(*)::int FROM job_profile_tenants jt JOIN sync_job_profiles j ON j.id=jt.job_profile_id WHERE jt.tenant_id=$1::uuid AND j.file_name LIKE '%JD-DMO-%') jp,
              (SELECT count(*)::int FROM sync_kamus_kompetensi WHERE code BETWEEN 'TC 901' AND 'TC 914') kamus`,
      [tenantId],
    ))[0];
    check(counts.pos === counts.pos_dm && counts.pos_dm === 40, `positions: 40 DM positions in the company's master list (Manajemen Posisi lookup), none from another company`, counts);
    check(counts.hist === 67, `position history: 67 rows (66 demo + 1)`, counts.hist);
    check(counts.tech === 110, `technical competencies: 110 rows reached the candidates`, counts.tech);
    check(counts.jp === jps.length, `job profiles: all ${jps.length} assigned to "${TENANT_NAME}"`, counts.jp);
    check(counts.kamus === 14, `kamus: TC 901-TC 914 present`, counts.kamus);

    // Designed outcome per person (ringkasan-data-demo.md).
    const md = readFileSync(join(SET, "ringkasan-data-demo.md"), "utf8");
    const designed = md.split(/\r?\n/).filter((l) => /^\| 99\d{3} \|/.test(l)).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
    // The md writes "no value" as —, PA in backticks, and an uploaded HAV as the
    // workbook's own label ("Kuadran 2"), which the ingester canonicalises to "2".
    const norm = (v: string) => { const t = v.replace(/`/g, "").trim(); return t.startsWith("—") ? null : t; };
    const havOf = (v: string) => { const t = norm(v); return t ? (t.match(/\d+/)?.[0] ?? t) : null; };
    // A PA string of six EMPTY slots is how the candidate sync writes "PA exists,
    // but none inside the three-year window" (99039); the app reads it as no PA.
    const paOf = (v: unknown) => (v == null || /^[\s,]*$/.test(String(v)) ? null : String(v));
    const mcuOf = (v: string) => (v.startsWith("—") ? "fit" : v.toLowerCase().replace(/ /g, "_"));
    const byNpk = new Map(cands.map((c) => [c.employee_id, c]));
    const diffs: string[] = [];
    for (const d of designed) {
      const [npk, name, pos, grade, , pa, ba, , havUp2, , disc, mcuStatus] = d as string[];
      const c = byNpk.get(npk!);
      if (!c) { diffs.push(`${npk}: no candidate`); continue; }
      const want: Record<string, unknown> = {
        name, current_position: pos, grade, performance_grade: norm(pa!), behavior_recommendation: norm(ba!),
        hav_quadrant: havOf(havUp2!), discipline_status: disc, mcu_status: mcuOf(mcuStatus!),
      };
      for (const [k, v] of Object.entries(want)) {
        const got = k === "performance_grade" ? paOf(c[k]) : c[k] == null || c[k] === "" ? null : String(c[k]);
        if (got !== (v == null ? null : String(v))) diffs.push(`${npk} ${k}: want ${v} got ${got}`);
      }
    }
    check(designed.length === 46 && diffs.length === 0, `46/46 candidates match their designed outcome (position, grade, PA, BA, HAV upload, discipline, MCU)`, diffs);

    const after = await q<{ name: string; n: number }>(
      `SELECT t.name, count(*)::int n FROM candidates c JOIN tenants t ON t.id = c.tenant_id WHERE c.deleted_at IS NULL AND t.is_builtin GROUP BY 1`,
    );
    const changed = after.filter((a) => baseline.find((b) => b.name === a.name)?.n !== a.n);
    check(changed.length === 0, `built-in companies' live candidate counts unchanged (${after.map((a) => `${a.name} ${a.n}`).join(", ")})`, { baseline, after });

    // ── 7. the pages, per company (cookie = the header dropdown) ──────────
    if (WEB) {
      const page = async (path: string, slugCookie: string) =>
        (await fetch(`${WEB}${path}`, { headers: { cookie: `pulse_tenant=${encodeURIComponent(slugCookie)}; pulse_mode=real` }, redirect: "manual" })).text();
      const firstDemo = [...cands].sort((a, b) => String(a.name).localeCompare(String(b.name)))[0]!.name as string;
      const demoList = await page("/candidates", slug);
      const muliaList = await page("/candidates", "mulia");
      check(demoList.includes(firstDemo) && !muliaList.includes(firstDemo),
        `Kandidat: "${firstDemo}" listed under "${TENANT_NAME}" and NOT under Mulia`);
      check(demoList.includes("IT Application Development Department Head"), `Kandidat: position lookups under "${TENANT_NAME}" carry the demo positions`);
      const c99002 = byNpk.get("99002")!;
      const detail = await page(`/candidates/${c99002.id}`, slug);
      check(detail.includes("Retail Sales Department Head") && detail.includes("Area Sales Supervisor"),
        `Kandidat detail 99002: current position and earlier position from the history`);
      const docsDemo = await page("/job-profiles", slug);
      const docsMulia = await page("/job-profiles", "mulia");
      check(docsDemo.includes("JD-DMO-001") && !docsMulia.includes("JD-DMO-001"),
        `Dokumen: job profiles visible under "${TENANT_NAME}" (assigned at upload) and NOT under Mulia`);
    }
  } finally {
    if (!KEEP) await cleanup(tenantId);
    else console.log(`\n--keep: data left in place under "${TENANT_NAME}" (${tenantId}); remove with demo-data/sql/hapus-data-demo.sql`);
    await pool.end();
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/** The generated cleanup script (company = DEMO, committed), plus this run's extras. */
async function cleanup(tenantId: string) {
  const script = readFileSync(join(SET, "sql", "hapus-data-demo.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("\\"))
    .join("\n")
    .replace(/:'company'/g, `'${COMPANY}'`)
    .replace(/^\s*(BEGIN|COMMIT|ROLLBACK);\s*$/gim, "");
  // Uploaded job-profile PDFs are KEPT in the upload store and a full sync
  // rescans it: remove them through the sync-service, as deleting a company does.
  const jpFiles = (await q<{ file_path: string }>(`SELECT file_path FROM sync_job_profiles WHERE file_name LIKE '%JD-DMO-%'`)).map((r) => r.file_path);
  if (jpFiles.length > 0) {
    const res = await fetch(`${SYNC}/api/sync/upload/_purge-job-profiles`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paths: jpFiles }),
    }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    check(res.removed === jpFiles.length, `cleanup: ${jpFiles.length} uploaded job-profile PDFs removed from the upload store`, res);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(script);
    await client.query(`UPDATE candidates SET deleted_at = now(), deleted_mode = 'bulk' WHERE tenant_id = $1::uuid AND deleted_at IS NULL`, [tenantId]);
    for (const t of ["sync_employee_positions", "sync_disciplinary", "sync_employees"])
      await client.query(`DELETE FROM ${t} WHERE employee_id IN ($1::text, '0'||$1::text, $2::text)`, [LPAD_NPK, UNKNOWN_NPK]);
    await client.query(`DELETE FROM sync_position_hierarchy WHERE company_id = $1 AND position_id = $2`, [COMPANY, UNKNOWN_POS]);
    await client.query(`DELETE FROM positions WHERE tenant_id = $1::uuid AND NOT EXISTS (SELECT 1 FROM critical_positions cp WHERE cp.position_id = positions.id)`, [tenantId]);
    await client.query(`DELETE FROM sync_company_tenant_map WHERE company_id = $1`, [COMPANY]);
    await client.query(`UPDATE tenants SET deleted_at = now() WHERE id = $1::uuid AND NOT is_builtin`, [tenantId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  const left = (await q(
    `SELECT (SELECT count(*)::int FROM sync_employees WHERE employee_id BETWEEN '99001' AND '99046' OR employee_id IN ($1::text,$2::text)) emp,
            (SELECT count(*)::int FROM candidates WHERE tenant_id=$3::uuid AND deleted_at IS NULL) live,
            (SELECT count(*)::int FROM sync_job_profiles WHERE file_name LIKE '%JD-DMO-%') jp,
            (SELECT count(*)::int FROM sync_kamus_kompetensi WHERE code BETWEEN 'TC 901' AND 'TC 914') kamus,
            (SELECT count(*)::int FROM positions WHERE tenant_id=$3::uuid) pos,
            (SELECT count(*)::int FROM sync_company_tenant_map WHERE company_id=$4) map`,
    [LPAD_NPK, UNKNOWN_NPK, tenantId, COMPANY],
  ))[0];
  check(Object.values(left).every((n) => n === 0), `cleanup: nothing demo-shaped left, company "${TENANT_NAME}" tombstoned`, left);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
