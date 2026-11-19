// TC-AHP-E2E — end to end against a RUNNING stack (web + scoring-service +
// Postgres), docs/ahp-input-sync.md §10. Not a *.test.ts on purpose: it needs
// the services up and it writes to the database it is pointed at (program
// templates, scoring runs), so it must never run against a real deployment.
//
//   E2E_BASE_URL=http://localhost:3360 \
//   DATABASE_URL=postgres://postgres@127.0.0.1:54329/pulse \
//   node --import tsx tests/governance/ahp-e2e.stack.ts
//
// What it proves, through the real UI:
//   1. A matrix set in the editor (slider + Daftar) is saved exactly as shown.
//   2. A program re-score started from Position Management scores with it: the
//      AHP sheet of each run's trace workbook holds the same 36 values as the
//      UI showed, all on the Saaty scale, and the engine's weights equal the
//      formula's (Δ = 0). run_info.ahp is full precision and flagged ok.
//   3. Both save paths on a program holding an OLDER off-scale matrix
//      (Acuan B, planted directly in the DB as legacy data): "Simpan program"
//      with the matrix untouched succeeds and leaves it as stored; with the
//      matrix edited it is refused; "Simpan Bobot AHP" is disabled.
//   4. The new-session gate: re-scoring that program is refused with the
//      message pointing at the editor, and no run is created.
import assert from 'node:assert/strict';
// `pg` ships no types in this package (the same gap lib/db/index.ts has); typed loosely here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require('pg') as { Pool: new (opts: { connectionString: string }) => any };
import * as XLSX from 'xlsx';

import { SAATY_SCALE, computeAhpWeights } from '../../lib/ahp';
import { EDITOR_LABELS, REF_B, parseRatioText } from './harness/ahp-fixtures';

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3360';
const DB = process.env.DATABASE_URL;
if (!DB) throw new Error('DATABASE_URL wajib');
if (!/127\.0\.0\.1|localhost/.test(DB)) throw new Error('Menolak: E2E ini menulis ke basis data — hanya untuk DB lokal.');

const pool = new Pool({ connectionString: DB });
const log = (...a: unknown[]) => console.log('  ·', ...a);
const idx = (label: string) => {
  const i = EDITOR_LABELS.findIndex((l) => label.startsWith(l));
  assert.ok(i >= 0, `label ${label}`);
  return i;
};

async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function toast(page: any): Promise<string> {
  const t = page.locator('[data-sonner-toast]').last();
  await t.waitFor({ timeout: 120000 });
  const text = (await t.textContent())!.trim();
  await page.evaluate(() => document.querySelectorAll('[data-sonner-toast]').forEach((e) => e.remove()));
  return text;
}

/** The Matriks view as numbers, canonical order. */
async function readUiMatrix(page: any): Promise<number[][]> {
  await page.getByRole('button', { name: /Berpasangan$/ }).click();
  await page.getByRole('button', { name: 'Matriks' }).click();
  const raw: { row: string; cells: { col: string; text: string }[] }[] = await page.locator('table').first().evaluate((table: HTMLTableElement) => {
    const order = [...table.querySelectorAll('thead th')].slice(1).map((th) => th.textContent!.trim());
    return [...table.querySelectorAll('tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      return {
        row: tds[0]!.textContent!.trim(),
        cells: tds.slice(1).map((td, j) => {
          const input = td.querySelector('input');
          return { col: order[j]!, text: input ? `${td.textContent!.trim()}${input.value}` : td.textContent!.trim() };
        }),
      };
    });
  });
  const m = Array.from({ length: 6 }, () => Array<number>(6).fill(NaN));
  for (const r of raw) for (const c of r.cells) m[idx(r.row)]![idx(c.col)] = parseRatioText(c.text)!;
  return m;
}

async function openProgram(page: any, name: string) {
  await page.goto(`${BASE}/governance`, { waitUntil: 'networkidle', timeout: 240000 });
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await page.getByText(`Kode:`).first().waitFor();
}

async function rescore(page: any, programName: string): Promise<string> {
  await page.goto(`${BASE}/positions`, { waitUntil: 'networkidle', timeout: 240000 });
  await page.getByRole('button', { name: 'Scoring Ulang' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: programName }).click();
  const run = dialog.getByRole('button', { name: /^Jalankan ulang \d+ posisi$/ });
  await run.waitFor();
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Jalankan ulang \d+ posisi$/.test(x.textContent!.trim()));
    return b && !b.hasAttribute('disabled');
  }, null, { timeout: 120000 });
  await run.click();
  return toast(page);
}

async function main() {
  const { chromium } = require('playwright');
  const tenant = (await q(`SELECT id FROM tenants WHERE slug = 'mulia'`))[0].id;
  const prog = async (code: string) =>
    (await q(`SELECT id, name, description, ahp_config FROM program_templates WHERE tenant_id = $1 AND code = $2`, [tenant, code]))[0];

  // ── Fixture: an OLDER off-scale matrix on Emergency Position (legacy data). ──
  const emergency = await prog('emergency');
  await q(`UPDATE program_templates SET ahp_config = $1 WHERE id = $2`, [JSON.stringify({ pairwise: REF_B }), emergency.id]);
  await q(`UPDATE program_templates SET ahp_config = NULL WHERE id = $1`, [(await prog('successor')).id]);
  // The seeded candidates carry too few fields to pass the shipped filter rules,
  // and an empty pool is not what this test is about: turn hard filtering off
  // for Critical Position (the same switch the program editor offers).
  await q(`UPDATE program_templates SET enforce_filter_rules = false WHERE tenant_id = $1 AND code = 'successor'`, [tenant]);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.setDefaultTimeout(120000);
  const results: string[] = [];
  try {
    // ── 1. Critical Position: set a matrix in the UI and save it ──
    console.log('1. Critical Position: atur matriks dari UI, simpan');
    await openProgram(page, 'Critical Position');
    await page.getByRole('button', { name: 'Atur Bobot AHP' }).click();
    // Slider: one arrow step on Behavior (crosses the dead zone).
    const thumb = page.locator('[data-slider="behavior"] [role="slider"]');
    await thumb.focus();
    await page.keyboard.press('ArrowRight');
    // Daftar: Teknis vs Karier 5 → 3.
    await page.getByRole('button', { name: /Berpasangan$/ }).click();
    await page.getByRole('button', { name: 'Daftar' }).click();
    const field = page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Career Relevance"]');
    await field.click();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    const ui = await readUiMatrix(page);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) assert.ok(SAATY_SCALE.includes(ui[i]![j]!), `UI ${i}/${j}`);
    const badge = (await page.getByTestId('ahp-cr-badge').textContent())!.trim();
    log('lencana', badge);
    assert.match(badge, /· konsisten/);
    await page.getByRole('button', { name: 'Simpan Bobot AHP' }).click();
    assert.equal(await toast(page), 'Bobot AHP berhasil disimpan.');
    const savedPw: number[][] = (await prog('successor')).ahp_config.pairwise;
    assert.deepEqual(savedPw, ui, 'matriks tersimpan = matriks yang tampil di UI');
    log('tersimpan di program_templates.ahp_config = yang tampil (36 sel, eksak)');
    results.push('1 OK');

    // ── 2. Re-score the program from Position Management; check the trace ──
    console.log('2. Scoring Ulang Critical Position → trace');
    // created_at is a zone-less WIB wall clock: compare against the database's
    // own localtimestamp as TEXT, never a JS Date (which pg would send as UTC).
    const t0: string = (await q(`SELECT localtimestamp::text AS t`))[0].t;
    const msg = await rescore(page, 'Critical Position');
    log('toast', msg);
    assert.match(msg, /posisi diantrikan/);
    let runs: any[] = [];
    for (let k = 0; k < 120; k++) {
      runs = await q(
        `SELECT r.id, r.status, r.run_info, r.label FROM scoring_runs r JOIN critical_positions cp ON cp.id = r.position_id
          WHERE cp.tenant_id = $1 AND cp.program_code = 'successor' AND r.created_at >= $2::timestamp ORDER BY r.created_at`,
        [tenant, t0],
      );
      if (runs.length >= 3 && runs.every((r) => r.status === 'completed' || r.run_info?.failure)) break;
      await new Promise((res) => setTimeout(res, 3000));
    }
    log('run', runs.map((r) => `${r.id.slice(0, 8)} ${r.status}${r.run_info?.failure ? ' GAGAL: ' + r.run_info.failure.message : ''}`).join(', '));
    assert.ok(runs.length >= 3, `3 run, ada ${runs.length}`);
    const formula = computeAhpWeights(ui).weights;
    for (const run of runs) {
      assert.equal(run.status, 'completed', `run ${run.id} selesai`);
      const ahp = run.run_info.ahp;
      assert.deepEqual(ahp.pairwise, ui, 'run_info.ahp.pairwise = UI (presisi penuh)');
      assert.equal(ahp.pairwisePrecision, 'full');
      assert.equal(ahp.inputCheck.ok, true, 'penanda engine: valid');
      const res = await page.request.get(`${BASE}/api/scoring-runs/${run.id}/trace-xlsx`);
      assert.equal(res.status(), 200, `trace-xlsx ${res.status()}`);
      const wb = XLSX.read(await res.body(), { type: 'buffer' });
      const sheet = wb.Sheets['AHP'];
      assert.ok(sheet, 'lembar AHP');
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      const h = rows.findIndex((r) => r[0] === 'Kriteria' && r[1] === 'Kompetensi Teknis');
      assert.ok(h >= 0, 'header matriks');
      const traceM = rows.slice(h + 1, h + 7).map((r) => r.slice(1, 7).map(Number));
      assert.deepEqual(traceM, ui, 'matriks lembar AHP = UI');
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) if (i !== j) assert.ok(SAATY_SCALE.includes(traceM[i]![j]!));
      const engineCol = rows[h]!.indexOf('Bobot engine');
      const engine = rows.slice(h + 1, h + 7).map((r) => Number(r[engineCol]));
      engine.forEach((w, i) => assert.equal(w, formula[i], `bobot engine = bobot rumus (Δ = 0) ${i}`));
      const flagRow = rows.find((r) => r[0] === 'Penanda');
      assert.match(String(flagRow?.[1]), /Masukan valid/);
      log(`run ${run.id.slice(0, 8)}: lembar AHP = UI, 30 sel ∈ S, Δ bobot = 0, penanda "${String(flagRow?.[1]).slice(0, 40)}…"`);
    }
    results.push('2 OK');

    // ── 3. Emergency Position: legacy matrix, both save paths ──
    console.log('3. Emergency Position (data lama Acuan B): kedua jalur simpan');
    await openProgram(page, 'Emergency Position');
    const banner = (await page.getByTestId('ahp-legacy-banner').textContent())!;
    assert.match(banner, /Karier vs HAV: 1,25 → 1/);
    assert.match(banner, /0\.0995 → setelah dibulatkan 0\.1118/);
    assert.equal(await page.getByRole('button', { name: 'Simpan Bobot AHP' }).isDisabled(), true);
    log('banner data lama tampil; Simpan Bobot AHP nonaktif');
    // 3a. Unrelated edit, matrix untouched → saved, matrix left as stored.
    const desc = page.locator('textarea').first();
    const newDesc = `Deskripsi diubah oleh uji E2E AHP ${Date.now()}.`; // unique: the test is re-runnable
    await desc.fill(newDesc);
    await page.getByRole('button', { name: 'Simpan program' }).click();
    assert.equal(await toast(page), 'Program berhasil disimpan.');
    const afterA = await prog('emergency');
    assert.equal(afterA.description, newDesc);
    assert.deepEqual(afterA.ahp_config.pairwise, REF_B, 'matriks lama tidak diubah');
    log('Simpan program dengan matriks lama tak diubah: tersimpan, ahp_config tetap Acuan B');
    // 3b. Matrix edited → validated → refused.
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Emergency Position/ }).click();
    await page.getByRole('button', { name: 'Daftar' }).click();
    const f2 = page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Education"]');
    await f2.click();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Simpan program' }).click();
    const refused = await toast(page);
    log('toast', refused.slice(0, 110));
    assert.match(refused, /Rasio konsistensi \(CR\) matriks AHP = 0\.112 melebihi 0\.1/);
    assert.deepEqual((await prog('emergency')).ahp_config.pairwise, REF_B, 'tetap Acuan B');
    results.push('3 OK');

    // ── 4. Gate: no new session from a program whose matrix fails validation ──
    console.log('4. Gerbang sesi scoring baru (Emergency Position)');
    const before = Number((await q(`SELECT count(*) FROM scoring_runs`))[0].count);
    const gated = await rescore(page, 'Emergency Position');
    log('toast', gated.slice(0, 160));
    assert.match(gated, /Bobot AHP program "Emergency Position" belum valid/);
    assert.match(gated, /Bulatkan ke skala Saaty/);
    const after = Number((await q(`SELECT count(*) FROM scoring_runs`))[0].count);
    assert.equal(after, before, 'tidak ada run baru');
    log('ditolak, tidak ada run baru');
    results.push('4 OK');
  } finally {
    await page.screenshot({ path: process.env.E2E_SCREENSHOT ?? '/tmp/ahp-e2e-last.png', fullPage: true }).catch(() => {});
    await browser.close();
    await pool.end();
  }
  console.log(`\nLULUS: ${results.join(', ')}`);
}

main().catch((e) => {
  console.error('\nGAGAL:', e);
  process.exit(1);
});
