// TC-AHP / TC-TOP / TC-HUN — the three numerical primitives every AHP+TOPSIS
// rank is built from. Pure arithmetic: no database, no environment.
//
//   node --import tsx --test test/ahp-topsis-math.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeAhpWeights,
  isValidPairwise,
  pairwiseFromWeights,
  randomConsistencyIndex,
} from "../src/ahp.js";
import { absoluteAnchorTopsis, topsisRank } from "../src/topsis.js";
import { hungarianMaxAssignment } from "../src/hungarian.js";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

/** Deterministic PRNG so a failing case can be replayed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ─── AHP ─────────────────────────────────────────────────────────

describe("TC-AHP  AHP priority weights", () => {
  test("TC-AHP-01 consistent matrix from weights reproduces the weights with CR = 0", () => {
    const w = [35, 25, 20, 10, 5, 5];
    const r = computeAhpWeights(pairwiseFromWeights(w));
    w.forEach((x, i) => close(r.weights[i]!, x / 100, 1e-12));
    close(r.cr, 0, 1e-9);
    close(r.lambdaMax, 6, 1e-9);
  });

  test("TC-AHP-02 weights always sum to 1 for random positive reciprocal matrices", () => {
    const rand = rng(7);
    for (let t = 0; t < 200; t++) {
      const n = 2 + Math.floor(rand() * 8);
      const m = Array.from({ length: n }, () => new Array<number>(n).fill(1));
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const v = 1 / 9 + rand() * (9 - 1 / 9);
          m[i]![j] = v;
          m[j]![i] = 1 / v;
        }
      const r = computeAhpWeights(m);
      close(r.weights.reduce((a, b) => a + b, 0), 1, 1e-9);
      assert.ok(r.weights.every((x) => x > 0));
      // λmax ≥ n for a positive reciprocal matrix (Perron); CR ≥ 0.
      assert.ok(r.lambdaMax >= n - 1e-9, `λmax ${r.lambdaMax} < n ${n}`);
    }
  });

  test("TC-AHP-03 a strongly inconsistent matrix is flagged CR > 0.1", () => {
    // A > B (9), B > C (9), but C > A (9): a cycle.
    const m = [
      [1, 9, 1 / 9],
      [1 / 9, 1, 9],
      [9, 1 / 9, 1],
    ];
    assert.ok(computeAhpWeights(m).cr > 0.1);
  });

  test("TC-AHP-04 Saaty textbook 3×3 example lands inside the acceptable band", () => {
    const m = [
      [1, 3, 5],
      [1 / 3, 1, 3],
      [1 / 5, 1 / 3, 1],
    ];
    const r = computeAhpWeights(m);
    // Published eigenvector ≈ 0.637 / 0.258 / 0.105, CR ≈ 0.033.
    close(r.weights[0]!, 0.637, 0.005);
    close(r.weights[1]!, 0.258, 0.005);
    close(r.weights[2]!, 0.105, 0.005);
    assert.ok(r.cr < 0.1 && r.cr > 0);
  });

  test("TC-AHP-05 degenerate sizes: n = 0, n = 1, n = 2", () => {
    assert.deepEqual(computeAhpWeights([]).weights, []);
    const one = computeAhpWeights([[1]]);
    assert.deepEqual(one.weights, [1]);
    assert.equal(one.cr, 0);
    const two = computeAhpWeights([
      [1, 3],
      [1 / 3, 1],
    ]);
    close(two.weights[0]!, 0.75, 1e-12);
    assert.equal(two.cr, 0, "RI(2) = 0, so a 2×2 is always consistent");
  });

  test("TC-AHP-06 Random Index table matches Saaty and saturates past n = 10", () => {
    assert.equal(randomConsistencyIndex(3), 0.58);
    assert.equal(randomConsistencyIndex(6), 1.24);
    assert.equal(randomConsistencyIndex(10), 1.49);
    assert.equal(randomConsistencyIndex(15), 1.49);
  });

  test("TC-AHP-07 pairwiseFromWeights guards zero weights (no division by zero)", () => {
    const m = pairwiseFromWeights([1, 0, 1]);
    assert.ok(m.flat().every((v) => Number.isFinite(v) && v > 0));
  });

  test("TC-AHP-08 isValidPairwise rejects wrong size, non-positive and non-finite cells", () => {
    const good = pairwiseFromWeights([1, 2, 3]);
    assert.equal(isValidPairwise(good, 3), true);
    assert.equal(isValidPairwise(good, 6), false, "a stored 3×3 must not pass as 6×6");
    assert.equal(isValidPairwise([[1, 0], [1, 1]], 2), false);
    assert.equal(isValidPairwise([[1, -2], [1, 1]], 2), false);
    assert.equal(isValidPairwise([[1, NaN], [1, 1]], 2), false);
    assert.equal(isValidPairwise([[1, Infinity], [1, 1]], 2), false);
    assert.equal(isValidPairwise([[1, "2"], [1, 1]], 2), false);
    assert.equal(isValidPairwise(null, 2), false);
    assert.equal(isValidPairwise([[1, 2]], 2), false);
  });
});

// ─── Classic TOPSIS ──────────────────────────────────────────────

describe("TC-TOP  classic TOPSIS (final ranking)", () => {
  const benefit6 = Array(6).fill("benefit") as "benefit"[];
  const w6 = [0.25, 0.05, 0.35, 0.1, 0.2, 0.05];

  test("TC-TOP-01 a dominating alternative gets closeness 1, a dominated one 0", () => {
    const r = topsisRank(
      [
        [90, 90, 90, 90, 90, 90],
        [50, 50, 50, 50, 50, 50],
        [10, 10, 10, 10, 10, 10],
      ],
      w6,
      benefit6
    );
    close(r.closeness[0]!, 1);
    close(r.closeness[2]!, 0);
    assert.ok(r.closeness[1]! > 0 && r.closeness[1]! < 1);
  });

  test("TC-TOP-02 identical alternatives all score 0.5 (no ideal separation)", () => {
    const r = topsisRank([[60, 60], [60, 60], [60, 60]], [0.5, 0.5], ["benefit", "benefit"]);
    r.closeness.forEach((c) => assert.equal(c, 0.5));
  });

  test("TC-TOP-03 single alternative → 0.5; empty matrix → empty result", () => {
    assert.deepEqual(topsisRank([[80, 20]], [0.5, 0.5], ["benefit", "benefit"]).closeness, [0.5]);
    assert.deepEqual(topsisRank([], [1], ["benefit"]).closeness, []);
  });

  test("TC-TOP-04 closeness is always within [0, 1]", () => {
    const rand = rng(11);
    for (let t = 0; t < 100; t++) {
      const m = Array.from({ length: 2 + Math.floor(rand() * 20) }, () =>
        Array.from({ length: 6 }, () => Math.round(rand() * 100))
      );
      for (const c of topsisRank(m, w6, benefit6).closeness) {
        assert.ok(c >= 0 && c <= 1, `closeness ${c}`);
      }
    }
  });

  test("TC-TOP-05 column scaling invariance: ×k on one criterion changes nothing", () => {
    const m = [
      [80, 40],
      [60, 70],
      [30, 90],
    ];
    const a = topsisRank(m, [0.6, 0.4], ["benefit", "benefit"]).closeness;
    const b = topsisRank(
      m.map(([x, y]) => [x! * 7, y!]),
      [0.6, 0.4],
      ["benefit", "benefit"]
    ).closeness;
    a.forEach((v, i) => close(v, b[i]!, 1e-12));
  });

  test("TC-TOP-06 a cost criterion inverts the preference", () => {
    const m = [[10], [90]];
    const benefit = topsisRank(m, [1], ["benefit"]).closeness;
    const cost = topsisRank(m, [1], ["cost"]).closeness;
    assert.ok(benefit[1]! > benefit[0]!);
    assert.ok(cost[0]! > cost[1]!);
  });

  test("TC-TOP-07 a zero-weight criterion has no influence on the ranking", () => {
    const m = [
      [80, 0],
      [60, 100],
    ];
    const r = topsisRank(m, [1, 0], ["benefit", "benefit"]).closeness;
    assert.ok(r[0]! > r[1]!);
  });

  test("TC-TOP-08 an all-zero column does not crash and does not separate anyone", () => {
    const r = topsisRank(
      [
        [80, 0],
        [40, 0],
      ],
      [0.5, 0.5],
      ["benefit", "benefit"]
    );
    assert.ok(r.closeness.every(Number.isFinite));
    close(r.closeness[0]!, 1);
  });

  test("TC-TOP-09 SET-RELATIVITY: adding an alternative can reorder two untouched ones", () => {
    // Documented property (CLAUDE.md, exclusion re-rank / incremental add): TOPSIS
    // is relative to the alternative set at both the column norms and the ideal/
    // anti-ideal. This pins that it is a real property of the method, not a bug.
    const w = [0.5, 0.5];
    const types = ["benefit", "benefit"] as const;
    const base = [
      [100, 0],
      [0, 100],
      [60, 45],
    ];
    const before = topsisRank(base, w, [...types]).closeness;
    let reordered = false;
    const rand = rng(3);
    for (let t = 0; t < 2000 && !reordered; t++) {
      const extra = [Math.round(rand() * 100), Math.round(rand() * 100)];
      const after = topsisRank([...base, extra], w, [...types]).closeness;
      if (Math.sign(before[0]! - before[2]!) !== Math.sign(after[0]! - after[2]!)) reordered = true;
    }
    assert.ok(reordered, "expected at least one added alternative to flip an untouched pair");
  });
});

// ─── Absolute-anchor TOPSIS (PA aspect) ──────────────────────────

describe("TC-ABS  absolute-anchor TOPSIS", () => {
  test("TC-ABS-01 at the positive anchor → 1, at the negative anchor → 0", () => {
    assert.equal(absoluteAnchorTopsis([4, 4, 4], 4, 1), 1);
    assert.equal(absoluteAnchorTopsis([1, 1, 1], 4, 1), 0);
  });

  test("TC-ABS-02 empty vector → 0.5 (no evidence either way)", () => {
    assert.equal(absoluteAnchorTopsis([], 4, 1), 0.5);
  });

  test("TC-ABS-03 constant vector: closeness is weight-independent", () => {
    const a = absoluteAnchorTopsis([3, 3, 3, 3], 4, 1, [0.7, 0.1, 0.1, 0.1]);
    const b = absoluteAnchorTopsis([3, 3, 3, 3], 4, 1, 0.5);
    close(a, b, 1e-12);
  });

  test("TC-ABS-04 recency decay: a recent improvement outranks a recent decline", () => {
    const improved = absoluteAnchorTopsis([4, 2, 2, 2, 2, 2], 4, 1, 0.8);
    const declined = absoluteAnchorTopsis([2, 2, 2, 2, 2, 4], 4, 1, 0.8);
    assert.ok(improved > declined);
    // decay 1 = equal weights → order no longer matters
    close(
      absoluteAnchorTopsis([4, 2, 2, 2, 2, 2], 4, 1, 1),
      absoluteAnchorTopsis([2, 2, 2, 2, 2, 4], 4, 1, 1),
      1e-12
    );
  });

  test("TC-ABS-05 a short weight vector reuses its last weight for extra slots", () => {
    const r = absoluteAnchorTopsis([4, 1, 1], 4, 1, [1, 1]);
    close(r, absoluteAnchorTopsis([4, 1, 1], 4, 1, [1, 1, 1]), 1e-12);
  });
});

// ─── Hungarian ───────────────────────────────────────────────────

function bruteForceMax(sim: number[][]): number {
  const m = sim.length;
  const n = sim[0]?.length ?? 0;
  if (m === 0 || n === 0) return 0;
  let best = -Infinity;
  const used = new Array<boolean>(n).fill(false);
  const k = Math.min(m, n);
  // Choose which k rows participate (when m > n) and assign them to columns.
  const rec = (row: number, assigned: number, total: number) => {
    if (assigned === k) {
      best = Math.max(best, total);
      return;
    }
    if (row === m) return;
    if (m - row > k - assigned) rec(row + 1, assigned, total); // skip this row
    for (let j = 0; j < n; j++) {
      if (used[j]) continue;
      used[j] = true;
      rec(row + 1, assigned + 1, total + sim[row]![j]!);
      used[j] = false;
    }
  };
  rec(0, 0, 0);
  return best;
}

describe("TC-HUN  Hungarian max assignment", () => {
  test("TC-HUN-01 matches exhaustive brute force on every shape up to 6×6", () => {
    const rand = rng(42);
    for (let m = 1; m <= 6; m++)
      for (let n = 1; n <= 6; n++)
        for (let t = 0; t < 15; t++) {
          const sim = Array.from({ length: m }, () =>
            Array.from({ length: n }, () => {
              const r = rand();
              // Mix exact zeros, ties and the 0..1.75 surplus range.
              return r < 0.2 ? 0 : r < 0.3 ? 0.5 : Math.round(r * 175) / 100;
            })
          );
          const pairs = hungarianMaxAssignment(sim);
          assert.equal(pairs.length, Math.min(m, n));
          const rows = new Set(pairs.map((p) => p[0]));
          const cols = new Set(pairs.map((p) => p[1]));
          assert.equal(rows.size, pairs.length, "a row used twice");
          assert.equal(cols.size, pairs.length, "a column used twice");
          const total = pairs.reduce((a, [i, j]) => a + sim[i]![j]!, 0);
          close(total, bruteForceMax(sim), 1e-9);
        }
  });

  test("TC-HUN-02 empty inputs return no pairs", () => {
    assert.deepEqual(hungarianMaxAssignment([]), []);
    assert.deepEqual(hungarianMaxAssignment([[]]), []);
  });

  test("TC-HUN-03 prefers the globally optimal pairing over the greedy one", () => {
    // Greedy picks (0,0)=0.9 then (1,1)=0.1 → 1.0; optimum is 0.8 + 0.8 = 1.6.
    const pairs = hungarianMaxAssignment([
      [0.9, 0.8],
      [0.8, 0.1],
    ]);
    const total = pairs.reduce((a, [i, j]) => a + [[0.9, 0.8], [0.8, 0.1]][i]![j]!, 0);
    close(total, 1.6);
  });
});
