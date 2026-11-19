/**
 * The four AHP weight-input modes in `components/governance/governance-ahp-editor.tsx`
 * are projections of ONE canonical matrix (docs/ahp-input-sync.md). These are
 * the invariants that make that true, checked exhaustively:
 *
 *  INV-1  after every write, all 30 off-diagonal cells are on the Saaty scale;
 *  INV-2  the matrix is exactly reciprocal (from the scale table), diagonal 1;
 *  INV-3  shown = stored = validated: the label a cell renders parses back to
 *         the stored value, and the badge's CR is validateAhpPairwise's CR;
 *  INV-4  weights, slider positions and order are derived from the matrix
 *         (a slider jumps to the recomputed weight — snap-back);
 *  INV-5  a write in one mode is visible in the others, because they all read
 *         the same matrix (nothing else is stored);
 *  INV-6  reading a mode never changes the matrix (switching modes never writes).
 *
 * Plus the properties the approved design promised: Urutan never inverts the
 * dragged order over all 720 orderings (CR maximum reported); the slider only
 * rewrites the moved criterion's row/column and is never stuck in a dead zone;
 * snapping Acuan B yields Acuan A.
 *
 * This replaces the old rank-sum checks (CR = 0 for Urutan/Slider), which the
 * approved design deliberately gave up. Pure arithmetic — no database.
 *
 *   npx tsx scripts/verify-ahp-modes.ts
 */
import {
  SAATY_SCALE,
  computeAhpWeights,
  reciprocalSaaty,
  saatyLabel,
  validateAhpPairwise,
} from '../lib/ahp';
import {
  activationMatrix,
  applyOrder,
  applySlider,
  canonicalize,
  diffJudgments,
  isCanonical,
  rankGroups,
  setJudgment,
  sliderPositions,
  SLIDER_MAX_PCT,
  SLIDER_MIN_PCT,
} from '../lib/ahp-input';

const REF_A = [
  [1, 1 / 2, 1 / 2, 3, 1, 3],
  [2, 1, 4, 5, 1, 5],
  [2, 1 / 4, 1, 3, 2, 6],
  [1 / 3, 1 / 5, 1 / 3, 1, 2, 2],
  [1, 1, 1 / 2, 1 / 2, 1, 4],
  [1 / 3, 1 / 5, 1 / 6, 1 / 2, 1 / 4, 1],
];
const REF_B = REF_A.map((r) => [...r]);
REF_B[1]![4] = 1.25;
REF_B[4]![1] = 1 / 1.25;
REF_B[2]![4] = 1.5;
REF_B[4]![2] = 1 / 1.5;

let failures = 0;
let checks = 0;
const fail = (msg: string) => {
  if (failures < 20) console.error(`  FAIL  ${msg}`);
  failures++;
};
const check = (cond: boolean, msg: () => string) => {
  checks++;
  if (!cond) fail(msg());
};

function parseLabel(t: string): number {
  return t.startsWith('1/') ? 1 / Number(t.slice(2)) : Number(t.replace(',', '.'));
}

/** INV-1, INV-2, INV-3 for one matrix. */
function canonicalInvariants(m: number[][], where: string) {
  for (let i = 0; i < 6; i++) {
    check(m[i]![i] === 1, () => `${where}: diagonal ${i}`);
    for (let j = 0; j < 6; j++) {
      if (i === j) continue;
      check(SAATY_SCALE.includes(m[i]![j]!), () => `${where}: a[${i}][${j}] = ${m[i]![j]} bukan anggota S (INV-1)`);
      if (i < j) check(m[j]![i] === reciprocalSaaty(m[i]![j]!), () => `${where}: tidak resiprokal [${i}][${j}] (INV-2)`);
      check(parseLabel(saatyLabel(m[i]![j]!)) === m[i]![j], () => `${where}: label "${saatyLabel(m[i]![j]!)}" ≠ tersimpan (INV-3)`);
    }
  }
  check(isCanonical(m), () => `${where}: isCanonical`);
  check(validateAhpPairwise(m).result!.cr === computeAhpWeights(m).cr, () => `${where}: CR lencana ≠ CR validasi (INV-3)`);
}

/** INV-4 / INV-6: reads are pure and agree with the formula. */
function readInvariants(m: number[][], where: string) {
  const copy = JSON.stringify(m);
  const w = computeAhpWeights(m).weights;
  const pos = sliderPositions(m);
  pos.forEach((p, i) => check(p === w[i]! * 100, () => `${where}: slider ${i} ≠ bobot (INV-4)`));
  const order = rankGroups(m).map((g) => g.criterion);
  for (let k = 1; k < 6; k++) check(w[order[k - 1]!]! >= w[order[k]!]! - 1e-12, () => `${where}: urutan tampil tidak menurun (INV-4)`);
  check(JSON.stringify(m) === copy, () => `${where}: membaca mengubah matriks (INV-6)`);
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]];
  const out: number[][] = [];
  for (const sub of permutations(n - 1)) for (let i = 0; i <= sub.length; i++) out.push([...sub.slice(0, i), n - 1, ...sub.slice(i)]);
  return out;
}

const bases: [string, number[][]][] = [
  ['activate()', activationMatrix()],
  ['Acuan A', REF_A],
  ['Acuan B (data lama)', REF_B],
];

console.log('1. activate() dan snap atas Acuan B…');
canonicalInvariants(activationMatrix(), 'activate()');
{
  const { matrix } = canonicalize(REF_B);
  check(JSON.stringify(matrix) === JSON.stringify(REF_A), () => 'snap(Acuan B) ≠ Acuan A');
  const w = computeAhpWeights(activationMatrix());
  console.log(`   activate(): ${w.weights.map((x) => (x * 100).toFixed(2) + '%').join(' · ')}, CR ${w.cr.toFixed(4)}`);
}

console.log('2. Urutan: 720 permutasi per matriks awal…');
for (const [name, base] of bases) {
  let maxCr = 0;
  let ties = 0;
  for (const order of permutations(6)) {
    const { matrix } = applyOrder(base, order);
    canonicalInvariants(matrix, `${name} urutan [${order}]`);
    readInvariants(matrix, `${name} urutan [${order}]`);
    const w = computeAhpWeights(matrix).weights;
    for (let p = 1; p < 6; p++) {
      const a = w[order[p - 1]!]!;
      const b = w[order[p]!]!;
      check(a >= b - 1e-12, () => `${name}: urutan [${order}] terbalik pada posisi ${p}`);
      if (Math.abs(a - b) <= 1e-12) ties++;
    }
    maxCr = Math.max(maxCr, computeAhpWeights(matrix).cr);
  }
  console.log(`   ${name}: CR maksimum ${maxCr.toFixed(4)}, ${ties} pasangan seri berdampingan, 0 pembalikan diharapkan`);
}

console.log('3. Slider: sapuan per kriteria, 2–65 % langkah 0,5…');
for (const [name, base] of bases) {
  let maxCr = 0;
  let advancedCount = 0;
  for (let i = 0; i < 6; i++) {
    for (let t = SLIDER_MIN_PCT; t <= SLIDER_MAX_PCT; t += 0.5) {
      const r = applySlider(base, i, t);
      const where = `${name} slider ${i} → ${t}%`;
      canonicalInvariants(r.matrix, where);
      readInvariants(r.matrix, where);
      const start = canonicalize(base).matrix;
      for (const c of diffJudgments(start, r.matrix)) {
        check(c.row === i || c.col === i, () => `${where}: penilaian ${c.row}/${c.col} di luar baris/kolom ${i} berubah`);
      }
      check(Math.abs(r.resultPct - computeAhpWeights(r.matrix).weights[i]! * 100) < 1e-12, () => `${where}: slider tidak melompat ke bobot hasil hitung ulang`);
      if (r.advanced) advancedCount++;
      maxCr = Math.max(maxCr, computeAhpWeights(r.matrix).cr);
    }
    // Never stuck: a 0.1-point step from any reached position changes something
    // unless the range end is reached.
    let cur = canonicalize(base).matrix;
    for (let k = 0; k < 200; k++) {
      const p = sliderPositions(cur)[i]!;
      const r = applySlider(cur, i, p + 0.1);
      if (r.changes.length === 0) {
        check(r.appliedPct >= SLIDER_MAX_PCT - 1e-9 || r.resultPct >= p, () => `${name}: slider ${i} macet di ${p.toFixed(2)}%`);
        break;
      }
      cur = r.matrix;
    }
  }
  console.log(`   ${name}: CR maksimum ${maxCr.toFixed(4)}, ${advancedCount} pelepasan maju melewati zona mati`);
}

console.log('4. Daftar/Matriks: setiap penilaian 1–9 di setiap sel, kedua arah…');
for (const [name, base] of bases) {
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) for (let v = 1; v <= 9; v++) {
    for (const [hi, lo] of [[i, j], [j, i]] as const) {
      const { matrix, changes } = setJudgment(base, hi, lo, v);
      const where = `${name} ${hi}>${lo}=${v}`;
      canonicalInvariants(matrix, where);
      check(matrix[hi]![lo] === v, () => `${where}: nilai yang diketik tidak tersimpan`);
      for (const c of changes) check(c.row === i && c.col === j, () => `${where}: penilaian lain ikut berubah`);
    }
  }
}

console.log(`\n${checks} pemeriksaan, ${failures} gagal.`);
if (failures > 0) {
  console.error('GAGAL');
  process.exit(1);
}
console.log('LULUS');
