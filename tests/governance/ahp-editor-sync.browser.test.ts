// TC-AHP-SYNC — the four AHP input modes are projections of ONE matrix
// (docs/ahp-input-sync.md). Drives the real editor in headless Chromium:
// a change made in any mode (drag in Urutan, slider, Daftar row, Matriks cell)
// must show up in the other three and in the CR badge, all derived from the
// same stored matrix, with every cell on the Saaty scale. Also: commit on
// blur/Enter even when the digit is unchanged, blur before the Save click,
// mode switches never write, and the legacy banner.
//
//   node --import tsx --test tests/governance/ahp-editor-sync.browser.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { SAATY_SCALE, computeAhpWeights, saatyLabel, validateAhpPairwise } from '../../lib/ahp';
import { activationMatrix, rankGroups } from '../../lib/ahp-input';
import { EDITOR_LABELS, REF_A, REF_B, parseRatioText } from './harness/ahp-fixtures';
import {
  changeCount,
  openEditor,
  readBadge,
  readListView,
  readMatrixView,
  readNotice,
  readOrder,
  readSliders,
  savedPayload,
  storedMatrix,
  switchMode,
  switchPairView,
  type EditorSession,
} from './harness/ahp-editor-browser';

const KEYS = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'];
const idx = (label: string) => {
  const i = EDITOR_LABELS.findIndex((l) => label.startsWith(l));
  assert.ok(i >= 0, `label tidak dikenal: ${label}`);
  return i;
};

async function withEditor(m: number[][] | null, fn: (s: EditorSession) => Promise<void>) {
  const s = await openEditor(m);
  try {
    await fn(s);
  } finally {
    await s.close();
  }
}

/** Every mode, read off the screen, must equal the projection of the stored matrix. */
async function assertModesAgree(s: EditorSession, where: string) {
  const stored = (await storedMatrix(s.page))!;
  const { weights, cr } = computeAhpWeights(stored);

  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    if (i !== j) assert.ok(SAATY_SCALE.includes(stored[i]![j]!), `${where}: tersimpan a[${i}][${j}]=${stored[i]![j]} bukan anggota S`);
  }

  const list = await readListView(s.page);
  assert.equal(list.length, 15, `${where}: 15 baris`);
  for (const row of list) {
    const hi = idx(row.hi);
    const lo = idx(row.lo);
    assert.equal(parseRatioText(row.text), stored[hi]![lo], `${where}: Daftar ${row.hi} vs ${row.lo}`);
  }

  const { cells } = await readMatrixView(s.page);
  for (const c of cells) {
    if (c.row === c.col) continue;
    assert.equal(parseRatioText(c.text), stored[idx(c.row)]![idx(c.col)], `${where}: Matriks ${c.row}/${c.col} = "${c.text}"`);
  }

  const sliders = await readSliders(s.page);
  KEYS.forEach((k, i) => {
    assert.ok(Math.abs(sliders[k]!.pos - weights[i]! * 100) < 1e-9, `${where}: posisi slider ${k} ${sliders[k]!.pos} vs ${weights[i]! * 100}`);
    assert.equal(sliders[k]!.text, `${(weights[i]! * 100).toFixed(1)}%`, `${where}: bobot slider ${k}`);
  });

  const order = await readOrder(s.page);
  assert.deepEqual(order.map((o) => KEYS.indexOf(o.key)), rankGroups(stored).map((g) => g.criterion), `${where}: urutan`);

  const badge = await readBadge(s.page);
  assert.ok(badge.startsWith(`CR = ${cr.toFixed(3)}`), `${where}: lencana "${badge}" vs CR ${cr.toFixed(3)}`);
  assert.equal(badge.includes('TIDAK konsisten'), cr > 0.1, `${where}: lencana konsisten`);
  return stored;
}

describe('TC-AHP-SYNC perubahan di satu mode memperbarui tiga mode lain dan CR', () => {
  test('awal: keempat tampilan dari satu matriks (activate)', async () => {
    await withEditor(activationMatrix(), async (s) => {
      await assertModesAgree(s, 'awal');
    });
  });

  test('Daftar: ketik digit + Enter', async () => {
    await withEditor(activationMatrix(), async (s) => {
      const before = (await storedMatrix(s.page))!;
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Career Relevance"]');
      assert.equal(await field.inputValue(), '5');
      await field.click();
      await s.page.keyboard.type('3');
      await s.page.keyboard.press('Enter');
      const after = await assertModesAgree(s, 'Daftar');
      assert.equal(after[0]![1], 3);
      assert.equal(after[1]![0], 1 / 3);
      assert.notDeepEqual(after, before);
      assert.match((await readNotice(s.page)) ?? '', /Teknis vs Karier: 5 → 3/);
    });
  });

  test('Matriks: ketik digit di sel atas + Tab (blur)', async () => {
    await withEditor(REF_A, async (s) => {
      await switchPairView(s.page, 'Matriks');
      // Default column order is by weight; find the upper cell PA row / HAV col shown as "1/2".
      // REF_A: PA is 2× HAV; HAV precedes PA by weight, so the upper cell is row HAV / col PA, shown "1/" + 2.
      const field = s.page.locator('input[title="Performance Appraisal lebih penting 2× dibanding HAV Mapping"]');
      assert.equal(await field.inputValue(), '2');
      await field.click();
      await s.page.keyboard.type('4');
      await s.page.keyboard.press('Tab');
      const after = await assertModesAgree(s, 'Matriks');
      assert.equal(after[3]![4], 4, 'PA 4× HAV');
      assert.equal(after[4]![3], 1 / 4);
    });
  });

  test('Slider: tombol panah sekali — zona mati dilewati, slider melompat ke bobot hasil hitung ulang', async () => {
    await withEditor(activationMatrix(), async (s) => {
      await switchMode(s.page, 'Slider');
      const thumb = s.page.locator('[data-slider="behavior"] [role="slider"]');
      const before = Number(await thumb.getAttribute('aria-valuenow'));
      await thumb.focus();
      await s.page.keyboard.press('ArrowRight');
      const after = await assertModesAgree(s, 'Slider');
      const w = computeAhpWeights(after).weights[2]! * 100;
      assert.ok(w > before, `bobot Behavior naik: ${before} → ${w}`);
      // Only Behavior's own judgments may change.
      const base = activationMatrix();
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
        if (i !== 2 && j !== 2) assert.equal(after[i]![j], base[i]![j], `penilaian ${i}/${j} tidak boleh berubah`);
      }
      const notice = (await readNotice(s.page)) ?? '';
      assert.match(notice, /slider maju ke/, 'pemberitahuan zona mati');
      assert.match(notice, /penilaian berubah: .*(Behavior vs \S+|\S+ vs Behavior): \S+ → \S+/, 'pasangan yang berubah disebut, sebelum → sesudah');
    });
  });

  test('Urutan: seret baris terakhir ke atas', async () => {
    await withEditor(REF_A, async (s) => {
      await switchMode(s.page, 'Urutan');
      const rows = s.page.locator('[data-testid="ahp-order-list"] [data-criterion]');
      const lastKey = await rows.nth(5).getAttribute('data-criterion');
      await rows.nth(5).dragTo(rows.nth(0));
      const order = await readOrder(s.page);
      assert.equal(order[0]!.key, lastKey, 'kriteria yang diseret kini teratas');
      await assertModesAgree(s, 'Urutan');
      assert.match((await readNotice(s.page)) ?? '', /Urutan menulis ulang ke-15 penilaian/);
    });
  });

  test('berpindah mode tidak menulis apa pun', async () => {
    await withEditor(REF_A, async (s) => {
      for (const m of ['Urutan', 'Slider', 'Berpasangan', 'Urutan', 'Berpasangan'] as const) await switchMode(s.page, m);
      await switchPairView(s.page, 'Matriks');
      await switchPairView(s.page, 'Daftar');
      assert.equal(await changeCount(s.page), 0);
      assert.deepEqual(await storedMatrix(s.page), REF_A);
    });
  });
});

describe('TC-AHP-RETYPE input ulang angka yang sama', () => {
  test('ketik digit yang sama dengan yang tampil + Enter: di-commit', async () => {
    await withEditor(activationMatrix(), async (s) => {
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Career Relevance"]');
      assert.equal(await field.inputValue(), '5');
      const n0 = await changeCount(s.page);
      await field.click();
      await s.page.keyboard.type('5');
      await s.page.keyboard.press('Enter');
      assert.equal(await changeCount(s.page), n0 + 1, 'commit terjadi walau nilainya sama');
      assert.deepEqual(await storedMatrix(s.page), activationMatrix());
    });
  });

  test('ketik digit yang sama + blur (Tab): di-commit', async () => {
    await withEditor(activationMatrix(), async (s) => {
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Career Relevance"]');
      const n0 = await changeCount(s.page);
      await field.click();
      await s.page.keyboard.type('5');
      await s.page.keyboard.press('Tab');
      assert.equal(await changeCount(s.page), n0 + 1);
    });
  });

  test('hanya fokus lalu keluar tanpa mengetik: tidak menulis', async () => {
    await withEditor(REF_B, async (s) => {
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Career Relevance lebih penting dari HAV Mapping"]');
      await field.click();
      await s.page.keyboard.press('Tab');
      assert.equal(await changeCount(s.page), 0);
      assert.equal((await storedMatrix(s.page))![1]![4], 1.25, 'data lama tidak dibulatkan diam-diam');
    });
  });

  test('ketik lalu langsung klik Simpan: blur meng-commit sebelum klik', async () => {
    await withEditor(activationMatrix(), async (s) => {
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Technical Competency lebih penting dari Career Relevance"]');
      await field.click();
      await s.page.keyboard.type('4');
      await s.page.getByRole('button', { name: 'Simpan Bobot AHP' }).click();
      await s.page.waitForFunction(() => (window as any).__ahpSaved != null);
      const saved = await savedPayload(s.page);
      assert.equal(saved!.value!.pairwise[0]![1], 4, 'payload simpan memuat digit yang baru diketik');
      assert.deepEqual(saved!.value!.pairwise, await storedMatrix(s.page));
    });
  });
});

describe('TC-AHP-LEGACY matriks lama di luar skala Saaty', () => {
  test('banner menyebut sel, CR sebelum → sesudah; Simpan nonaktif; tombol membulatkan', async () => {
    await withEditor(REF_B, async (s) => {
      const banner = s.page.getByTestId('ahp-legacy-banner');
      const text = (await banner.textContent())!;
      assert.match(text, /Karier vs HAV: 1,25 → 1/);
      assert.match(text, /Behavior vs HAV: 1,5 → 2/);
      assert.match(text, /CR tersimpan 0\.0995 → setelah dibulatkan 0\.1118 \(akan DITOLAK/);
      assert.match(await readBadge(s.page), /2 nilai di luar skala Saaty/);
      assert.equal(await s.page.getByRole('button', { name: 'Simpan Bobot AHP' }).isDisabled(), true);
      await s.page.getByRole('button', { name: 'Bulatkan ke skala Saaty' }).click();
      assert.deepEqual(await storedMatrix(s.page), REF_A.map((r) => r.map((v) => v)));
      assert.equal(await s.page.getByTestId('ahp-legacy-banner').count(), 0);
      assert.match((await readNotice(s.page)) ?? '', /Karier vs HAV: 1,25 → 1; Behavior vs HAV: 1,5 → 2/);
      assert.match(await readBadge(s.page), /CR = 0\.112 · TIDAK konsisten/);
      assert.equal(validateAhpPairwise(await storedMatrix(s.page)).ok, false);
    });
  });

  test('mengetik di sel data lama: nilai yang diketik tersimpan, sisanya dibulatkan dan dilaporkan', async () => {
    await withEditor(REF_B, async (s) => {
      await switchPairView(s.page, 'Daftar');
      const field = s.page.locator('input[title^="Seberapa kali Career Relevance lebih penting dari HAV Mapping"]');
      assert.equal(await field.inputValue(), saatyLabel(1.25), 'yang tampil = yang tersimpan');
      await field.click();
      await s.page.keyboard.type('1');
      await s.page.keyboard.press('Tab');
      const m = (await storedMatrix(s.page))!;
      assert.equal(m[1]![4], 1);
      assert.equal(m[2]![4], 2, 'Behavior/HAV ikut dibulatkan');
      assert.match((await readNotice(s.page)) ?? '', /2 nilai lama dibulatkan ke skala Saaty/);
    });
  });
});
