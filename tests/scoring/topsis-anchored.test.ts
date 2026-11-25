// TC-ANCH — "Tambah Kandidat Pembanding" ranks a child on its PARENT's TOPSIS
// yardstick (divisors + weighted ideals), so carried candidates keep their
// parent closeness exactly and the added ones are inserted between them.
//
// Classic TOPSIS is set-relative: adding one candidate moves every divisor and
// possibly both ideals, and measured on 65 stored runs that reordered the
// carried candidates in 66% of single-candidate trials (13%: a parent
// non-finalist overtook a parent finalist with nobody's aspects changing).
// These tests drive the SAME functions the engine calls
// (scoring-service/src/topsis-ranking.ts, topsis.ts, rerun-freeze.ts).
//
//   node --import tsx --test tests/scoring/topsis-anchored.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  anchorsFromDetail,
  leftTopNCauseOf,
  rankCandidatesByTopsis,
  readTopsisAnchors,
  type RecordedTopsis,
  type TopsisAnchorsByKey,
} from '../../scoring-service/src/topsis-ranking';
import { topsisDetailed } from '../../scoring-service/src/topsis';
import { composeChildResultList } from '../../scoring-service/src/rerun-freeze';
import { AHP_CRITERIA_ORDER, type AhpCriterionKey } from '../../scoring-service/src/ahp-criteria';

type Aspects = Record<AhpCriterionKey, number>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const aspect = (lo = 0, hi = 100) => Math.round((lo + rand() * (hi - lo)) * 1000) / 1000;
const randomAspects = (lo = 0, hi = 100): Aspects =>
  Object.fromEntries(AHP_CRITERIA_ORDER.map((k) => [k, aspect(lo, hi)])) as Aspects;
const randomWeights = (): Aspects =>
  Object.fromEntries(AHP_CRITERIA_ORDER.map((k) => [k, 0.02 + rand()])) as Aspects;

/** The engine's matrix order: candidates by id (loadAhpCandidates … ORDER BY id). */
const rank = (
  ids: string[],
  aspects: Map<string, Aspects>,
  weights: Aspects,
  dropped: Set<AhpCriterionKey>,
  anchors?: TopsisAnchorsByKey | null,
) => rankCandidatesByTopsis([...ids].sort().map((id) => ({ id })), aspects, weights, dropped, anchors);

/** What the engine records in run_info.frozen.topsis, through a jsonb round trip. */
const record = (r: ReturnType<typeof rank>, mode: RecordedTopsis['mode'], source: RecordedTopsis['source']) =>
  JSON.parse(
    JSON.stringify({
      version: 1,
      mode,
      source,
      activeCriteria: r.activeCriteria,
      weightVector: Object.fromEntries(r.activeCriteria.map((k, j) => [k, r.detail.weightVector[j]])),
      ...anchorsFromDetail(r.detail, r.activeCriteria),
    } satisfies RecordedTopsis),
  );

const closenessOf = (r: ReturnType<typeof rank>) => new Map(r.rankedAll.map((e) => [e.candidate.id, e.closeness]));
const orderOf = (r: ReturnType<typeof rank>, keep?: Set<string>) =>
  r.rankedAll.map((e) => e.candidate.id).filter((id) => !keep || keep.has(id));

describe('TC-ANCH: a child ranks on its parent\'s TOPSIS yardstick', () => {
  test('carried candidates keep the parent closeness bit for bit and their order, over 300 random pools', () => {
    let classicReordered = 0;
    for (let t = 0; t < 300; t++) {
      const n = 4 + Math.floor(rand() * 30);
      const ids = Array.from({ length: n }, (_, i) => uuid(t * 100 + i + 1));
      const aspects = new Map(ids.map((id) => [id, randomAspects()]));
      const dropped = new Set<AhpCriterionKey>(AHP_CRITERIA_ORDER.filter(() => rand() < 0.15));
      const w = randomWeights();
      const parent = rank(ids, aspects, w, dropped);
      const anchors = readTopsisAnchors(record(parent, 'classic', 'own'), parent.activeCriteria)!;
      assert.ok(anchors, 'recorded anchors read back');

      const added = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => uuid(900000 + t * 10 + i));
      // Wider range than the parent's on purpose: some added values exceed its ideals.
      for (const id of added) aspects.set(id, randomAspects(-10, 130));
      const union = [...ids, ...added];
      const child = rank(union, aspects, w, dropped, anchors);

      const pc = closenessOf(parent);
      const cc = closenessOf(child);
      for (const id of ids) assert.equal(cc.get(id), pc.get(id), `t=${t} ${id}: closeness must be identical`);
      assert.deepEqual(orderOf(child, new Set(ids)), orderOf(parent), `t=${t}: carried order must not move`);
      for (const id of added) {
        const c = cc.get(id)!;
        assert.ok(c >= 0 && c <= 1, `t=${t}: an added closeness stays in [0, 1] (${c})`);
      }

      // Control: classic TOPSIS over the same union does reorder (rank reversal).
      if (orderOf(rank(union, aspects, w, dropped), new Set(ids)).join() !== orderOf(parent).join()) classicReordered++;
    }
    assert.ok(classicReordered > 30, `the classic control must show reversals, or this test proves nothing (${classicReordered})`);
  });

  test('a grandchild sits on the ROOT\'s yardstick: the child\'s added candidates keep their closeness too', () => {
    const ids = Array.from({ length: 12 }, (_, i) => uuid(i + 1));
    const aspects = new Map(ids.map((id) => [id, randomAspects()]));
    const w = randomWeights();
    const none = new Set<AhpCriterionKey>();
    const root = rank(ids, aspects, w, none);
    const rootAnchors = readTopsisAnchors(record(root, 'classic', 'own'), root.activeCriteria)!;

    const n1 = uuid(501);
    aspects.set(n1, randomAspects(0, 120));
    const child = rank([...ids, n1], aspects, w, none, rootAnchors);
    // The child records the yardstick it ranked WITH — the root's.
    const childRecord = record(child, 'anchored', 'parent');
    const childAnchors = readTopsisAnchors(childRecord, child.activeCriteria)!;
    for (const k of child.activeCriteria) {
      assert.equal(childAnchors.colNorms[k], rootAnchors.colNorms[k]);
      assert.equal(childAnchors.idealPos[k], rootAnchors.idealPos[k]);
      assert.equal(childAnchors.idealNeg[k], rootAnchors.idealNeg[k]);
    }

    const n2 = uuid(502);
    aspects.set(n2, randomAspects(0, 120));
    const grand = rank([...ids, n1, n2], aspects, w, none, childAnchors);
    const cc = closenessOf(child);
    const gc = closenessOf(grand);
    for (const id of [...ids, n1]) assert.equal(gc.get(id), cc.get(id), id);
    assert.deepEqual(orderOf(grand, new Set([...ids, n1])), orderOf(child));
  });

  test('an added candidate beyond the parent\'s ideal is placed AT it, and that is reported', () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const aspects = new Map<string, Aspects>([
      [ids[0]!, { technical: 80, career: 50, behavior: 60, performance: 70, hav: 40, education: 50 }],
      [ids[1]!, { technical: 60, career: 70, behavior: 40, performance: 50, hav: 60, education: 50 }],
      [ids[2]!, { technical: 40, career: 30, behavior: 80, performance: 30, hav: 80, education: 50 }],
    ]);
    const w = Object.fromEntries(AHP_CRITERIA_ORDER.map((k) => [k, 1])) as Aspects;
    const none = new Set<AhpCriterionKey>();
    const parent = rank(ids, aspects, w, none);
    const anchors = anchorsFromDetail(parent.detail, parent.activeCriteria);
    const star = uuid(99);
    aspects.set(star, { technical: 100, career: 100, behavior: 100, performance: 100, hav: 100, education: 50 });
    const child = rank([...ids, star], aspects, w, none, anchors);
    const i = child.detail.rowIds.indexOf(star);
    const clampedKeys = child.activeCriteria.filter((_, j) => child.detail.clamped[i]![j]);
    assert.deepEqual(clampedKeys, ['technical', 'career', 'behavior', 'performance', 'hav']);
    // Education: everybody 50 in the parent, so its ideals coincide — 50 is inside.
    assert.equal(child.detail.clamped[i]![child.activeCriteria.indexOf('education')], false);
    // At the ideal on every separating criterion: D⁺ = 0, closeness 1, rank 1.
    assert.equal(child.rankedAll[0]!.candidate.id, star);
    assert.equal(child.rankedAll[0]!.closeness, 1);
    assert.equal(child.detail.anchored, true);
    assert.equal(parent.detail.anchored, false);
    assert.ok(parent.detail.clamped.flat().every((x) => !x));
  });

  test('without anchors topsisDetailed is unchanged (classic)', () => {
    const d = topsisDetailed([[3, 1], [4, 2]], [0.5, 0.5], ['benefit', 'benefit']);
    assert.equal(d.anchored, false);
    assert.deepEqual(d.clamped, [[false, false], [false, false]]);
    assert.equal(d.colNorms[0], 5);
  });

  test('recorded anchors are refused when they do not describe this ranking', () => {
    const ids = [uuid(1), uuid(2), uuid(3), uuid(4)];
    const aspects = new Map(ids.map((id) => [id, randomAspects()]));
    const w = randomWeights();
    const r = rank(ids, aspects, w, new Set());
    const rec = record(r, 'classic', 'own');
    const wv = Object.fromEntries(r.activeCriteria.map((k, j) => [k, r.detail.weightVector[j]!]));
    assert.ok(readTopsisAnchors(rec, r.activeCriteria, wv), 'same weights: usable');
    const otherW = { ...wv, technical: wv.technical! + 1e-6 };
    assert.equal(readTopsisAnchors(rec, r.activeCriteria, otherW), null, 'other weights: a different scale');
    const missing = { ...rec, colNorms: { ...rec.colNorms, hav: undefined } };
    assert.equal(readTopsisAnchors(missing, r.activeCriteria), null, 'a missing criterion');
    assert.equal(readTopsisAnchors(null, r.activeCriteria), null);
    assert.throws(
      () => rankCandidatesByTopsis(ids.map((id) => ({ id })), aspects, w, new Set(), { colNorms: {}, idealPos: {}, idealNeg: {} }),
      /Jangkar TOPSIS tidak lengkap/,
    );
  });
});

describe('TC-ANCH-LEFT: why a parent finalist left the top N', () => {
  const [A, B, C, D, X] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(9)];
  const parentRank = new Map([[A, 1], [B, 2], [C, 3], [D, 4]]);

  test('overtaken only by somebody the parent never ranked → overtaken_by_comparison', () => {
    assert.equal(leftTopNCauseOf(B, [A, X], parentRank), 'overtaken_by_comparison');
  });
  test('somebody the parent ranked below is now above → pool_shift', () => {
    assert.equal(leftTopNCauseOf(B, [A, C], parentRank), 'pool_shift');
    assert.equal(leftTopNCauseOf(B, [X, D, A], parentRank), 'pool_shift');
  });

  test('composeChildResultList names the cause on the leaving finalist only', () => {
    // Parent top 2 = A, B. Child order: X, A, B, C, D (X added) → B leaves, overtaken.
    const anchored = composeChildResultList({
      rankedIds: [X, A, B, C, D],
      topN: 2,
      parentFinalistIds: new Set([A, B]),
      comparisonIds: new Set([X]),
      parentRankById: parentRank,
    }).listed;
    const b = anchored.find((l) => l.candidateId === B)!;
    assert.deepEqual([b.leftTopN, b.leftTopNCause], [true, 'overtaken_by_comparison']);
    assert.ok(anchored.filter((l) => l.candidateId !== B).every((l) => l.leftTopNCause === null));

    // A classic-era child: C overtook B with X sitting below both → pool_shift.
    const legacy = composeChildResultList({
      rankedIds: [A, C, B, X, D],
      topN: 2,
      parentFinalistIds: new Set([A, B]),
      comparisonIds: new Set([X]),
      parentRankById: parentRank,
    }).listed;
    assert.equal(legacy.find((l) => l.candidateId === B)!.leftTopNCause, 'pool_shift');

    // Without parent ranks the cause is not decided.
    const undecided = composeChildResultList({
      rankedIds: [X, A, B],
      topN: 2,
      parentFinalistIds: new Set([A, B]),
      comparisonIds: new Set([X]),
    }).listed;
    assert.equal(undecided.find((l) => l.candidateId === B)!.leftTopNCause, null);
  });
});
