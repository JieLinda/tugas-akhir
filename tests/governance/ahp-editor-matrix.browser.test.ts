// TC-AHP-MATRIX — the "Matriks" view of the pairwise mode, in a real browser.
//
//  (b) Every cell below the diagonal must show the reciprocal of the cell above
//      it, i.e. the value actually stored there. Reported on run 622af32e: with
//      the columns in canonical order the lower triangle shows "1/2" for
//      Karier vs Teknis and Behavior vs Teknis, where the stored value is 2.
//  (a) Every cell above the diagonal must show the stored value (Acuan B holds
//      1.25 and 1.5, which the view rounds to 1 and 2) — and typing the digit
//      the field shows must store that digit. Before the fix the field showed
//      "1" over a stored 1.25 and React fired no onChange for the unchanged
//      value, so 1.25 stayed; now it shows 1,25 and commits on blur/Enter.
//
//   node --import tsx --test tests/governance/ahp-editor-matrix.browser.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { EDITOR_LABELS, REF_A, REF_B, parseRatioText } from './harness/ahp-fixtures';
import { dragMatrixHeader, openEditor, readMatrixView, storedMatrix, type MatrixCell } from './harness/ahp-editor-browser';

const idx = (label: string) => {
  const i = EDITOR_LABELS.findIndex((l) => label.startsWith(l));
  assert.ok(i >= 0, `label tidak dikenal: ${label}`);
  return i;
};

function mismatches(cells: MatrixCell[], stored: number[][], which: 'upper' | 'lower'): string[] {
  return cells
    .filter((c) => (which === 'upper' ? c.upper : !c.upper && c.row !== c.col))
    .map((c) => ({ c, shown: parseRatioText(c.text), want: stored[idx(c.row)]![idx(c.col)]! }))
    .filter(({ shown, want }) => shown == null || Math.abs(shown - want) > 1e-9)
    .map(({ c, want }) => `${c.row} vs ${c.col}: tampil "${c.text}", tersimpan ${+want.toFixed(4)}`);
}

describe('TC-AHP-MATRIX lower triangle (b)', () => {
  test('lower triangle shows the stored reciprocal — default (weight-sorted) column order', async () => {
    const s = await openEditor(REF_A);
    try {
      const { cells } = await readMatrixView(s.page);
      assert.deepEqual(mismatches(cells, REF_A, 'lower'), [], 'segitiga bawah tidak resiprokal');
    } finally {
      await s.close();
    }
  });

  test('lower triangle shows the stored reciprocal — canonical column order (as reported)', async () => {
    const s = await openEditor(REF_A);
    try {
      let { order } = await readMatrixView(s.page);
      // Drag the display order into AHP_CRITERIA_ORDER (display only; weights do not move).
      for (let target = 0; target < EDITOR_LABELS.length; target++) {
        const from = order.findIndex((l) => l.startsWith(EDITOR_LABELS[target]!));
        if (from !== target) await dragMatrixHeader(s.page, from, target);
        ({ order } = await readMatrixView(s.page));
      }
      assert.deepEqual(order.map(idx), [0, 1, 2, 3, 4, 5], 'urutan kolom kanonik');
      const { cells } = await readMatrixView(s.page);
      assert.deepEqual(mismatches(cells, REF_A, 'lower'), [], 'segitiga bawah tidak resiprokal');
    } finally {
      await s.close();
    }
  });
});

describe('TC-AHP-MATRIX upper triangle (a)', () => {
  test('upper triangle shows the stored value (Acuan B)', async () => {
    const s = await openEditor(REF_B);
    try {
      const { cells } = await readMatrixView(s.page);
      assert.deepEqual(mismatches(cells, REF_B, 'upper'), [], 'nilai tampil ≠ nilai tersimpan');
    } finally {
      await s.close();
    }
  });
});

describe('TC-AHP-LIST retyping a judgment (a)', () => {
  test('typing the digit a field shows stores that digit (Karier vs HAV, Acuan B)', async () => {
    const s = await openEditor(REF_B);
    try {
      await s.page.getByRole('button', { name: 'Berpasangan' }).click();
      const field = s.page.locator('input[title^="Seberapa kali Career Relevance lebih penting dari HAV Mapping"]');
      // The field now shows what is stored (1,25), not a rounded 1; typing 1 and
      // leaving the cell commits it (commit is on blur/Enter, not onChange).
      assert.equal(await field.inputValue(), '1,25', 'nilai yang tampil = nilai tersimpan');
      await field.click();
      await s.page.keyboard.type('1');
      await s.page.keyboard.press('Tab');
      const m = await storedMatrix(s.page);
      assert.equal(m![1]![4], 1, `pakar mengetik 1, tersimpan ${m![1]![4]}`);
    } finally {
      await s.close();
    }
  });
});
