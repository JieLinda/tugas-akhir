// TC-AHP-INPUT — the canonical Saaty matrix and its four projections
// (docs/ahp-input-sync.md). Pure: no database, no browser.
//
//   node --import tsx --test tests/governance/ahp-input.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as webAhp from '../../lib/ahp';
import * as svcAhp from '../../scoring-service/src/ahp';
import * as svcSaaty from '../../scoring-service/src/ahp-saaty';
import {
  SAATY_SCALE,
  computeAhpWeights,
  isSaatyValue,
  reciprocalSaaty,
  saatyLabel,
  snapToSaaty,
  validateAhpPairwise,
} from '../../lib/ahp';
import {
  activationMatrix,
  applyOrder,
  applySlider,
  canonicalize,
  describeChange,
  isCanonical,
  matrixWeights,
  rankGroups,
  setJudgment,
  sliderPositions,
  upperValues,
} from '../../lib/ahp-input';
import { ahpSessionGateError, decideAhpSave } from '../../lib/ahp-save-rules';
import { REF_A, REF_B } from './harness/ahp-fixtures';

// Pre-change output of computeAhpWeights for the two reference matrices,
// captured from lib/ahp.ts as it stood before this change (commit 2f0a07f).
// The formula must not have moved: these are compared at 1e-12.
const BEFORE = {
  A: {
    weights: [0.15934377133445868, 0.33662239433121505, 0.22534612250086866, 0.09299207067884437, 0.13919960581519095, 0.04649603533942218],
    lambdaMax: 6.692971703979507,
    ci: 0.13859434079590133,
    cr: 0.11176962967411397,
  },
  B: {
    weights: [0.1587547072071165, 0.3480857088698124, 0.21400232238648184, 0.09264829638189243, 0.1401848169637508, 0.04632414819094621],
    lambdaMax: 6.6167059413347955,
    ci: 0.1233411882669591,
    cr: 0.0994687002152896,
  },
};

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (tol ${tol})`);

function assertCanonical(m: number[][], where: string) {
  for (let i = 0; i < 6; i++) {
    assert.equal(m[i]![i], 1, `${where}: diagonal`);
    for (let j = 0; j < 6; j++) {
      if (i === j) continue;
      assert.ok(SAATY_SCALE.includes(m[i]![j]!), `${where}: a[${i}][${j}] = ${m[i]![j]} bukan anggota S`);
      if (i < j) assert.equal(m[j]![i], reciprocalSaaty(m[i]![j]!), `${where}: resiprokal [${i}][${j}]`);
    }
  }
  assert.ok(isCanonical(m), `${where}: isCanonical`);
}

describe('TC-AHP-INPUT-01 snap ke skala Saaty (ruang log)', () => {
  test('nilai acuan', () => {
    assert.equal(snapToSaaty(1.25), 1);
    assert.equal(snapToSaaty(1.5), 2);
    assert.equal(snapToSaaty(Math.SQRT2), 1, 'seri di √2 → yang lebih dekat ke 1');
    assert.equal(snapToSaaty(1 / Math.SQRT2), 1, 'seri di 1/√2 → 1');
    assert.equal(snapToSaaty(2.45), 3, 'batas 2|3 di √6 = 2,449, bukan 2,5');
    assert.equal(snapToSaaty(2.44), 2);
    assert.equal(snapToSaaty(0.6), 1 / 2);
    assert.equal(snapToSaaty(5 / 3), 2);
    assert.equal(snapToSaaty(5 / 6), 1);
    assert.equal(snapToSaaty(12), 9);
    assert.equal(snapToSaaty(0.05), 1 / 9);
    for (const s of SAATY_SCALE) assert.equal(snapToSaaty(s), s, `anggota S tetap: ${s}`);
  });

  test('setiap ambang seri Saaty memilih nilai yang lebih dekat ke 1', () => {
    for (let k = 0; k < SAATY_SCALE.length - 1; k++) {
      const lo = SAATY_SCALE[k]!;
      const hi = SAATY_SCALE[k + 1]!;
      const tie = Math.sqrt(lo * hi);
      const want = Math.abs(Math.log(lo)) < Math.abs(Math.log(hi)) ? lo : hi;
      assert.equal(snapToSaaty(tie), want, `seri antara ${saatyLabel(lo)} dan ${saatyLabel(hi)}`);
    }
  });

  test('bukan rasio ditolak', () => {
    assert.throws(() => snapToSaaty(0));
    assert.throws(() => snapToSaaty(-1));
    assert.throws(() => snapToSaaty(Number.NaN));
  });

  test('resiprokal dari tabel: tepat, bukan 1/x', () => {
    for (const s of SAATY_SCALE) {
      const r = reciprocalSaaty(s);
      assert.ok(SAATY_SCALE.includes(r));
      close(s * r, 1, 1e-15);
    }
    assert.equal(reciprocalSaaty(1 / 3), 3);
    assert.equal(reciprocalSaaty(3), 1 / 3);
    assert.equal(reciprocalSaaty(1), 1);
  });

  test('label Saaty', () => {
    assert.equal(saatyLabel(3), '3');
    assert.equal(saatyLabel(1), '1');
    assert.equal(saatyLabel(1 / 3), '1/3');
    assert.equal(saatyLabel(0.3333), '0,3333', '4 desimal bukan anggota S pada toleransi baku');
    assert.equal(saatyLabel(0.3333, 1e-3), '1/3', 'toleransi 1e-3 untuk salinan 4 desimal');
    assert.equal(saatyLabel(1.25), '1,25');
    assert.equal(saatyLabel(0.8), '0,8');
  });
});

describe('TC-AHP-INPUT-02 validateAhpPairwise', () => {
  test('Acuan A: skala dan resiprokal benar, ditolak karena CR', () => {
    const v = validateAhpPairwise(REF_A);
    assert.equal(v.ok, false);
    assert.deepEqual(v.issues.map((i) => i.code), ['inconsistent']);
    close(v.result!.cr, 0.1118, 1e-4);
  });

  test('Acuan B: dua penilaian di luar S (empat sel), CR lolos', () => {
    const v = validateAhpPairwise(REF_B);
    assert.equal(v.ok, false);
    const off = v.issues.filter((i) => i.code === 'off_scale');
    assert.equal(off.length, 4, 'atas dan bawah untuk dua penilaian');
    assert.ok(!v.issues.some((i) => i.code === 'inconsistent'));
    close(v.result!.cr, 0.0995, 1e-4);
  });

  test('matriks kanonik yang konsisten lolos', () => {
    const v = validateAhpPairwise(activationMatrix());
    assert.equal(v.ok, true, JSON.stringify(v.issues));
  });

  test('setiap isu dikenali', () => {
    assert.deepEqual(validateAhpPairwise([[1]]).issues.map((i) => i.code), ['shape']);
    const zero = activationMatrix().map((r) => [...r]);
    zero[0]![1] = 0;
    assert.ok(validateAhpPairwise(zero).issues.some((i) => i.code === 'not_positive'));
    const diag = activationMatrix().map((r) => [...r]);
    diag[2]![2] = 2;
    assert.ok(validateAhpPairwise(diag).issues.some((i) => i.code === 'diagonal'));
    const nonRecip = activationMatrix().map((r) => [...r]);
    nonRecip[1]![0] = 3; // a01 = 5, a10 should be 1/5
    const nr = validateAhpPairwise(nonRecip);
    assert.ok(nr.issues.some((i) => i.code === 'not_reciprocal' && i.row === 0 && i.col === 1));
  });

  test('isValidPairwise tetap struktural (gerbang engine tidak berubah)', () => {
    assert.equal(webAhp.isValidPairwise(REF_B, 6), true, 'matriks lama tetap dapat dipakai engine');
    const nonRecip = REF_A.map((r) => [...r]);
    nonRecip[1]![0] = 3;
    assert.equal(webAhp.isValidPairwise(nonRecip, 6), true);
  });
});

describe('TC-AHP-INPUT-03 rumus tidak berubah; satu implementasi', () => {
  test('lib/ahp me-re-export fungsi scoring-service (objek yang sama)', () => {
    assert.equal(webAhp.computeAhpWeights, svcAhp.computeAhpWeights);
    assert.equal(webAhp.isValidPairwise, svcAhp.isValidPairwise);
    assert.equal(webAhp.validateAhpPairwise, svcSaaty.validateAhpPairwise);
    assert.equal(webAhp.snapToSaaty, svcSaaty.snapToSaaty);
  });

  for (const [name, m] of [['A', REF_A], ['B', REF_B]] as const) {
    test(`Acuan ${name}: bobot, λmaks, CI, CR identik dengan sebelum perubahan`, () => {
      const r = computeAhpWeights(m);
      const want = BEFORE[name];
      r.weights.forEach((w, i) => close(w, want.weights[i]!, 1e-12, `w${i}`));
      close(r.lambdaMax, want.lambdaMax, 1e-12, 'λ');
      close(r.ci, want.ci, 1e-12, 'CI');
      close(r.cr, want.cr, 1e-12, 'CR');
    });
  }

  test('Acuan A pada toleransi 1e-4 sesuai spesifikasi', () => {
    const r = computeAhpWeights(REF_A);
    [0.1593, 0.3366, 0.2253, 0.093, 0.1392, 0.0465].forEach((w, i) => close(r.weights[i]!, w, 1e-4));
    close(r.lambdaMax, 6.693, 1e-4);
    close(r.cr, 0.1118, 1e-4);
  });

  test('Acuan B pada toleransi 1e-4 sesuai spesifikasi', () => {
    const r = computeAhpWeights(REF_B);
    [0.1588, 0.3481, 0.214, 0.0926, 0.1402, 0.0463].forEach((w, i) => close(r.weights[i]!, w, 1e-4));
    close(r.cr, 0.0995, 1e-4);
  });

  test('snap atas Acuan B menghasilkan Acuan A persis', () => {
    const { matrix, changes } = canonicalize(REF_B);
    assert.deepEqual(matrix, REF_A.map((r) => r.map((v) => snapToSaaty(v))));
    upperValues(matrix).forEach((v, k) => assert.equal(v, upperValues(REF_A)[k]));
    assert.deepEqual(
      changes.map((c) => describeChange(c)),
      ['Karier vs HAV: 1,25 → 1', 'Behavior vs HAV: 1,5 → 2'],
    );
    close(computeAhpWeights(matrix).cr, 0.1118, 1e-4);
  });
});

describe('TC-AHP-INPUT-04 Daftar/Matriks ↔ kanonik', () => {
  test('pemberitahuan menyebut pasangan dan nilai sebelum → sesudah', () => {
    const r = setJudgment(REF_A, 1, 4, 2); // Karier 2× HAV
    assert.deepEqual(r.changes.map((c) => describeChange(c)), ['Karier vs HAV: 1 → 2']);
  });

  test('baris → matriks → baris identik untuk setiap penilaian 1–9 di setiap sel', () => {
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        for (let v = 1; v <= 9; v++) {
          for (const [hi, lo] of [[i, j], [j, i]] as const) {
            const { matrix } = setJudgment(REF_A, hi, lo, v);
            assertCanonical(matrix, `set ${hi}>${lo}=${v}`);
            // Read back the way the list view does: heavier side and intensity.
            const stored = matrix[i]![j]!;
            const readHi = stored >= 1 ? i : j;
            const readV = stored >= 1 ? stored : matrix[j]![i]!;
            if (v === 1) assert.equal(stored, 1);
            else {
              assert.equal(readHi, hi);
              assert.equal(readV, v);
            }
            // Writing back what was read changes nothing.
            const again = setJudgment(matrix, readHi, readHi === i ? j : i, readV);
            assert.deepEqual(again.matrix, matrix);
            assert.equal(again.changes.length, 0);
          }
        }
      }
    }
  });

  test('menulis apa pun di atas data lama mengkanonisasi seluruh matriks lebih dulu', () => {
    const r = setJudgment(REF_B, 0, 1, 1);
    assertCanonical(r.matrix, 'setelah tulis di atas B');
    assert.equal(r.canonicalized.length, 2);
  });
});

describe('TC-AHP-INPUT-05 Slider ↔ kanonik', () => {
  test('matriks → slider → matriks identik untuk matriks kanonik', () => {
    for (const m of [REF_A, activationMatrix()]) {
      const pos = sliderPositions(m);
      for (let i = 0; i < 6; i++) {
        // Releasing a slider where it already is: no request, no change.
        const r = applySlider(m, i, pos[i]!);
        assert.deepEqual(r.matrix, m, `slider ${i}`);
        assert.equal(r.changes.length, 0);
      }
    }
  });

  test('slider hanya menulis baris/kolom kriteria yang digeser', () => {
    const r = applySlider(REF_A, 4, 30); // HAV 13,9 % → 30 %
    assertCanonical(r.matrix, 'slider HAV');
    for (const c of r.changes) assert.ok(c.row === 4 || c.col === 4, `berubah di luar HAV: ${describeChange(c)}`);
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
      if (i !== 4 && j !== 4) assert.equal(r.matrix[i]![j], REF_A[i]![j], `penilaian ${i}/${j} tidak boleh berubah`);
    }
    assert.ok(r.changes.length > 0);
    close(r.resultPct, matrixWeights(r.matrix)[4]! * 100, 1e-12, 'slider melompat ke bobot hasil hitung ulang');
  });

  test('zona mati: posisi yang tidak mengubah penilaian maju ke titik berikutnya yang mengubahnya', () => {
    const m = activationMatrix();
    const behavior = sliderPositions(m)[2]!;
    close(behavior, 34.37, 0.01);
    const up = applySlider(m, 2, behavior + 0.1);
    assert.equal(up.advanced, true, 'harus maju');
    assert.ok(up.changes.length >= 1, 'minimal satu penilaian berubah');
    close(up.appliedPct, 36.1, 0.15, 'titik berubah pertama ≈ 36,1 %');
    assert.ok(up.resultPct > behavior, 'bergerak searah geseran');
    const down = applySlider(m, 2, behavior - 0.1);
    assert.equal(down.advanced, true);
    assert.ok(down.changes.length >= 1);
    assert.ok(down.resultPct < behavior);
    // Every press of an arrow key moves somewhere — never stuck.
    let cur = m;
    for (let k = 0; k < 10; k++) {
      const before = sliderPositions(cur)[2]!;
      const r = applySlider(cur, 2, before + 0.1);
      if (r.changes.length === 0) break; // end of the reachable range
      assert.notDeepEqual(r.matrix, cur);
      cur = r.matrix;
    }
  });

  test('ujung rentang: tidak ada lagi yang berubah, dan dikatakan demikian', () => {
    let m = activationMatrix();
    for (let k = 0; k < 40; k++) m = applySlider(m, 0, 65).matrix;
    const r = applySlider(m, 0, 65);
    assert.equal(r.changes.length, 0);
    assertCanonical(r.matrix, 'ujung');
  });
});

describe('TC-AHP-INPUT-06 Urutan pada 720 permutasi', () => {
  function permutations(n: number): number[][] {
    if (n === 1) return [[0]];
    const out: number[][] = [];
    for (const sub of permutations(n - 1)) for (let i = 0; i <= sub.length; i++) out.push([...sub.slice(0, i), n - 1, ...sub.slice(i)]);
    return out;
  }
  const bases: [string, number[][]][] = [
    ['bobot bawaan (activate)', activationMatrix()],
    ['Acuan A', REF_A],
    ['Acuan B (data lama)', REF_B],
  ];
  for (const [name, base] of bases) {
    test(`${name}: tidak pernah membalik urutan yang diseret; CR maksimum dilaporkan`, (t) => {
      const orders = permutations(6);
      assert.equal(orders.length, 720);
      let maxCr = 0;
      let ties = 0;
      for (const order of orders) {
        const { matrix } = applyOrder(base, order);
        assertCanonical(matrix, `urutan ${order}`);
        const w = matrixWeights(matrix);
        for (let p = 1; p < 6; p++) {
          const a = w[order[p - 1]!]!;
          const b = w[order[p]!]!;
          assert.ok(a >= b - 1e-12, `${name}: urutan [${order}] terbalik pada posisi ${p} (${a} < ${b})`);
          if (Math.abs(a - b) <= 1e-12) ties++;
        }
        // Display: ties share a rank, never shown as an inversion.
        const groups = rankGroups(matrix, order);
        assert.deepEqual(groups.map((g) => g.criterion), order, 'tampilan mengikuti urutan seretan di dalam seri');
        maxCr = Math.max(maxCr, computeAhpWeights(matrix).cr);
      }
      t.diagnostic(`${name}: CR maksimum ${maxCr.toFixed(4)} pada 720 permutasi; ${ties} pasangan seri berdampingan`);
      assert.ok(maxCr <= 0.1, `CR maksimum ${maxCr} melebihi 0,1`);
    });
  }
});

describe('TC-AHP-INPUT-07 activate()', () => {
  test('bobot bawaan dibulatkan ke skala Saaty: 26,09 / 4,97 / 34,37 / 9,43 / 20,17 / 4,97 %, CR 0,0054', () => {
    const m = activationMatrix();
    assertCanonical(m, 'activate');
    const r = computeAhpWeights(m);
    [0.2609, 0.0497, 0.3437, 0.0943, 0.2017, 0.0497].forEach((w, i) => close(r.weights[i]!, w, 1e-4));
    close(r.cr, 0.0054, 1e-4);
    assert.deepEqual(upperValues(m).map((v) => saatyLabel(v)), [
      '5', '1', '3', '1', '5', '1/7', '1/2', '1/4', '1', '4', '2', '7', '1/2', '2', '4',
    ]);
  });
});

describe('TC-AHP-SAVE kedua jalur simpan dan gerbang sesi', () => {
  test('tombol "Simpan Bobot AHP": selalu divalidasi', () => {
    assert.deepEqual(decideAhpSave(null, null, { allowUnchanged: false }), { kind: 'clear' });
    assert.equal(decideAhpSave({ pairwise: activationMatrix() }, null, { allowUnchanged: false }).kind, 'store');
    const b = decideAhpSave({ pairwise: REF_B }, { pairwise: REF_B }, { allowUnchanged: false });
    assert.equal(b.kind, 'reject', 'tombol AHP tidak melewatkan matriks lama walau sama');
    assert.match((b as { message: string }).message, /Karier vs HAV = 1,25 bukan anggota skala Saaty \(terdekat: 1\)/);
    const a = decideAhpSave({ pairwise: REF_A }, null, { allowUnchanged: false });
    assert.equal(a.kind, 'reject');
    assert.match((a as { message: string }).message, /Rasio konsistensi \(CR\) matriks AHP = 0\.112 melebihi 0\.1/);
  });

  test('bar "Simpan program": matriks lama yang TIDAK diubah dibiarkan; yang diubah divalidasi', () => {
    // Stored and submitted identical (compared against the stored value).
    assert.deepEqual(
      decideAhpSave({ pairwise: REF_B.map((r) => [...r]) }, { pairwise: REF_B }, { allowUnchanged: true }),
      { kind: 'keep_unchanged' },
    );
    // Same matrix but the stored one differs (e.g. edited by someone else): validated.
    const edited = REF_B.map((r) => [...r]);
    edited[0]![5] = 2;
    edited[5]![0] = 1 / 2;
    assert.equal(decideAhpSave({ pairwise: edited }, { pairwise: REF_B }, { allowUnchanged: true }).kind, 'reject');
    // A client claiming "unchanged" cannot: there is no flag, only the stored value.
    assert.equal(decideAhpSave({ pairwise: REF_B }, null, { allowUnchanged: true }).kind, 'reject');
    // A valid change is stored.
    const ok = decideAhpSave({ pairwise: activationMatrix() }, { pairwise: REF_B }, { allowUnchanged: true });
    assert.equal(ok.kind, 'store');
  });

  test('gerbang sesi scoring baru', () => {
    assert.equal(ahpSessionGateError(null, 'Critical Position'), null, 'tanpa matriks = bobot bawaan');
    assert.equal(ahpSessionGateError({ pairwise: activationMatrix() }, 'Critical Position'), null);
    const b = ahpSessionGateError({ pairwise: REF_B }, 'Critical Position');
    assert.ok(b);
    assert.match(b!, /Critical Position/);
    assert.match(b!, /Bulatkan ke skala Saaty/);
    assert.match(b!, /Karier vs HAV = 1,25/);
    assert.ok(ahpSessionGateError({ pairwise: REF_A }, 'X')!.includes('Rasio konsistensi'));
  });
});

describe('TC-AHP-INPUT-08 penanda run (engine)', () => {
  test('ahpInputCheck menandai data lama; bobot bawaan ditandai wajar', () => {
    const keys = ['technical', 'career', 'behavior', 'performance', 'hav', 'education'];
    const b = webAhp.ahpInputCheck(REF_B, 'ahp-matrix', keys);
    assert.equal(b.ok, false);
    assert.equal(b.expected, false);
    assert.deepEqual(b.offScale.map((c) => `${c.row}/${c.col}`), ['career/hav', 'behavior/hav']);
    assert.equal(b.crExceeded, false);
    const def = webAhp.ahpInputCheck(webAhp.pairwiseFromWeights([25, 5, 35, 10, 20, 5]), 'default', keys);
    assert.equal(def.ok, false);
    assert.equal(def.expected, true);
    // A 4-decimal stored copy of a canonical matrix is not reported off-scale at 1e-3.
    const rounded = activationMatrix().map((r) => r.map((v) => Number(v.toFixed(4))));
    assert.equal(webAhp.ahpInputCheck(rounded, 'ahp-matrix', keys, 1e-3).offScale.length, 0);
    assert.ok(isSaatyValue(0.1429, 1e-3));
  });
});
