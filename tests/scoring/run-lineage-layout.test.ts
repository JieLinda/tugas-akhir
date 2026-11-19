// TC-LIN — the lineage navigator on the "Perbandingan Run" tab: where each run
// is drawn, which connectors belong to the A–B path, what a collapse hides and
// how B steps through its siblings. Built for a root with many children, so
// most cases use one. Pure; no database, no browser.
//
//   node --import tsx --test tests/scoring/run-lineage-layout.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildRunForest, type RunTreeRow } from '../../lib/run-tree';
import {
  LINEAGE_DIMS,
  allCollapsible,
  collapseAllExcept,
  columnX,
  connectorPath,
  generationLabel,
  layoutLineage,
  lineageIndex,
  lineagePath,
  siblingStep,
} from '../../lib/run-lineage-layout';
import { RUN_COMPARE_TAB, compareHref, defaultComparePair, nextPair } from '../../lib/run-history';

const D = LINEAGE_DIMS;
const rowY = (r: number, extra = 0) => D.padY + extra + r * (D.nodeH + D.rowGap);

function row(id: string, parent: string | null, minute: number, extra: Partial<RunTreeRow> = {}): RunTreeRow {
  return {
    runId: id,
    label: parent ? `+1 kandidat — Critical Position — 2026-10-01 10:${String(minute).padStart(2, '0')}` : 'Critical Position — 2026-10-01',
    mode: parent ? 'incremental_add' : 'baseline',
    method: 'AHP_TOPSIS',
    status: 'completed',
    program: 'successor',
    candidateCount: 12,
    createdAt: new Date(Date.UTC(2026, 9, 1, 3, minute)).toISOString(),
    completedAt: null,
    parentRunId: parent,
    ...extra,
  };
}

/** R (root) with twelve children c1..c12; c3 has two children g1, g2; plus an older root R0 with one child. */
function wideForest() {
  const rows: RunTreeRow[] = [row('R0', null, 0), row('R0c', 'R0', 1), row('R', null, 5)];
  for (let i = 1; i <= 12; i++) rows.push(row(`c${i}`, 'R', 5 + i));
  rows.push(row('g1', 'c3', 30), row('g2', 'c3', 31));
  return buildRunForest(rows);
}

describe('TC-LIN layout', () => {
  test('a root with many children: the root shares its first child’s row, the rest stack beneath, one row each', () => {
    const forest = wideForest();
    const lay = layoutLineage(forest.roots);
    const at = new Map(lay.nodes.map((n) => [n.node.runId, n]));
    // Newest tree first (buildRunForest), children oldest first.
    assert.equal(lay.nodes[0].node.runId, 'R');
    assert.equal(at.get('R')!.row, 0);
    assert.equal(at.get('c1')!.row, 0);
    assert.equal(at.get('c2')!.row, 1);
    // c3 shares its row with its first child g1; g2 takes the next row; c4 follows.
    assert.equal(at.get('c3')!.row, 2);
    assert.equal(at.get('g1')!.row, 2);
    assert.equal(at.get('g2')!.row, 3);
    assert.equal(at.get('c4')!.row, 4);
    assert.equal(at.get('c12')!.row, 12);
    // Columns are generations.
    assert.equal(at.get('R')!.x, columnX(0));
    assert.equal(at.get('c7')!.x, columnX(1));
    assert.equal(at.get('g2')!.x, columnX(2));
    assert.equal(lay.columns, 3);
    // Sibling bookkeeping.
    assert.equal(at.get('c7')!.siblingIndex, 6);
    assert.equal(at.get('c7')!.siblingCount, 12);
    // A parent's subtree ends at its last descendant's row; a leaf's at itself.
    assert.equal(at.get('R')!.subtreeBottom, at.get('c12')!.y + D.nodeH);
    assert.equal(at.get('c3')!.subtreeBottom, at.get('g2')!.y + D.nodeH);
    assert.equal(at.get('c7')!.subtreeBottom, at.get('c7')!.y + D.nodeH);
    // No two cards overlap: every (x, y) is unique.
    const keys = new Set(lay.nodes.map((n) => `${n.x}:${n.y}`));
    assert.equal(keys.size, lay.nodes.length);
  });

  test('a second tree starts below the first, after the tree gap', () => {
    const lay = layoutLineage(wideForest().roots);
    const at = new Map(lay.nodes.map((n) => [n.node.runId, n]));
    // R's tree occupies rows 0..12; R0 is row 13, pushed down by one tree gap.
    assert.equal(at.get('R0')!.row, 13);
    assert.equal(at.get('R0')!.y, rowY(13, D.treeGap));
    assert.deepEqual(
      lay.trees.map((t) => [t.rootId, t.runs]),
      [
        ['R', 15],
        ['R0', 2],
      ],
    );
    assert.equal(lay.height, at.get('R0c')!.y + D.nodeH + D.padY);
    assert.equal(lay.width, D.padX * 2 + 3 * D.nodeW + 2 * D.colGap);
  });

  test('every child gets exactly one connector from its parent; the first child’s is a straight line', () => {
    const lay = layoutLineage(wideForest().roots);
    assert.equal(lay.edges.length, lay.nodes.length - 2); // two roots have none
    const toC1 = lay.edges.find((e) => e.childId === 'c1')!;
    assert.match(toC1.d, /^M[\d.]+,[\d.]+ H[\d.]+$/);
    const toC5 = lay.edges.find((e) => e.childId === 'c5')!;
    assert.match(toC5.d, /Q/); // a rounded elbow down the trunk
    assert.equal(
      connectorPath({ x: 0, y: 0 }, { x: 300, y: 0 }),
      `M${D.nodeW},${D.nodeH / 2} H300`,
    );
  });

  test('collapsing a node hides its subtree, keeps the node, and reports what it hides', () => {
    const forest = wideForest();
    const lay = layoutLineage(forest.roots, { collapsed: new Set(['c3']) });
    const ids = lay.nodes.map((n) => n.node.runId);
    assert.ok(!ids.includes('g1') && !ids.includes('g2'));
    const c3 = lay.nodes.find((n) => n.node.runId === 'c3')!;
    assert.equal(c3.hiddenDescendants, 2);
    assert.equal(c3.shownChildren, 0);
    assert.equal(c3.subtreeBottom, c3.y + D.nodeH);
    // c4 moves up into g2's old row.
    assert.equal(lay.nodes.find((n) => n.node.runId === 'c4')!.row, 3);
    // A collapsed root takes one row for its whole tree.
    const folded = layoutLineage(forest.roots, { collapsed: new Set(['R']) });
    assert.equal(folded.nodes.find((n) => n.node.runId === 'R')!.hiddenDescendants, 14);
    assert.equal(folded.nodes.find((n) => n.node.runId === 'R0')!.row, 1);
    // Collapsing a leaf is a no-op.
    const leaf = layoutLineage(forest.roots, { collapsed: new Set(['c1']) });
    assert.equal(leaf.nodes.find((n) => n.node.runId === 'c1')!.hiddenDescendants, 0);
  });
});

describe('TC-LIN path between A and B', () => {
  test('siblings meet at their parent; only the two connectors into them are highlighted', () => {
    const forest = wideForest();
    const p = lineagePath(forest.roots, 'c2', 'c9');
    assert.equal(p.lca, 'R');
    assert.deepEqual([...p.nodes].sort(), ['R', 'c2', 'c9']);
    const lay = layoutLineage(forest.roots, { highlight: p });
    assert.deepEqual(
      lay.edges.filter((e) => e.highlighted).map((e) => e.childId).sort(),
      ['c2', 'c9'],
    );
  });

  test('a grandchild against the root runs through its parent', () => {
    const forest = wideForest();
    const p = lineagePath(forest.roots, 'R', 'g2');
    assert.equal(p.lca, 'R');
    assert.deepEqual([...p.nodes].sort(), ['R', 'c3', 'g2']);
    const lay = layoutLineage(forest.roots, { highlight: p });
    assert.deepEqual(lay.edges.filter((e) => e.highlighted).map((e) => e.childId).sort(), ['c3', 'g2']);
  });

  test('two runs of different trees have no path — nothing is invented through a common root', () => {
    const p = lineagePath(wideForest().roots, 'R0c', 'c4');
    assert.equal(p.sameTree, false);
    assert.equal(p.lca, null);
    assert.equal(p.nodes.size, 0);
    assert.equal(layoutLineage(wideForest().roots, { highlight: p }).edges.filter((e) => e.highlighted).length, 0);
  });

  test('unknown or missing ids give an empty path', () => {
    const forest = wideForest();
    assert.equal(lineagePath(forest.roots, null, 'c1').nodes.size, 0);
    assert.equal(lineagePath(forest.roots, 'nope', 'c1').sameTree, false);
  });
});

describe('TC-LIN folding and stepping', () => {
  test('"Lipat cabang lain" keeps the ancestors of A and B open and folds everything else', () => {
    const forest = wideForest();
    assert.deepEqual([...collapseAllExcept(forest.roots, ['g1', 'c5'])].sort(), ['R0']);
    // Neither A nor B under c3: c3 folds, and so does the other tree.
    assert.deepEqual([...collapseAllExcept(forest.roots, ['c1', 'c5'])].sort(), ['R0', 'c3']);
    assert.deepEqual([...allCollapsible(forest.roots)].sort(), ['R', 'R0', 'c3']);
  });

  test('B steps through the comparable siblings in drawing order, skipping the ones that cannot be compared', () => {
    const rows: RunTreeRow[] = [row('R', null, 0)];
    for (let i = 1; i <= 6; i++) rows.push(row(`c${i}`, 'R', i, i === 3 ? { method: 'SAW' } : {}));
    const forest = buildRunForest(rows);
    const ok = (n: { method: string; status: string }) => n.method === 'AHP_TOPSIS' && n.status === 'completed';
    assert.deepEqual(siblingStep(forest.roots, 'c2', ok), { prev: 'c1', next: 'c4', position: 2, total: 5 });
    assert.deepEqual(siblingStep(forest.roots, 'c1', ok), { prev: null, next: 'c2', position: 1, total: 5 });
    assert.deepEqual(siblingStep(forest.roots, 'c6', ok), { prev: 'c5', next: null, position: 5, total: 5 });
    // A root steps among the roots.
    assert.deepEqual(siblingStep(forest.roots, 'R', ok), { prev: null, next: null, position: 1, total: 1 });
    // A run that is not eligible itself has no position.
    assert.equal(siblingStep(forest.roots, 'c3', ok).position, 0);
  });

  test('the index knows every run’s parent and root; captions name the generations', () => {
    const idx = lineageIndex(wideForest().roots);
    assert.equal(idx.size, 17);
    assert.deepEqual(idx.get('g2'), { node: idx.get('g2')!.node, parentId: 'c3', rootId: 'R' });
    assert.equal(generationLabel(0), 'Root');
    assert.equal(generationLabel(2), 'Turunan 2');
  });
});

describe('TC-LIN default pair and links', () => {
  test('the open run is B against its parent; a root against its previous root; the oldest against the next', () => {
    const forest = wideForest();
    assert.deepEqual(defaultComparePair(forest.roots, 'c7'), { a: 'R', b: 'c7' });
    assert.deepEqual(defaultComparePair(forest.roots, 'g2'), { a: 'c3', b: 'g2' });
    // R is a root: its "previous" comparable run is R0c (created before R).
    assert.deepEqual(defaultComparePair(forest.roots, 'R'), { a: 'R0c', b: 'R' });
    // R0 is the oldest run of all: it is A, the run right after it B.
    assert.deepEqual(defaultComparePair(forest.roots, 'R0'), { a: 'R0', b: 'R0c' });
  });

  test('an open run that cannot be compared falls back to the newest comparable run', () => {
    const rows: RunTreeRow[] = [row('R', null, 0), row('c1', 'R', 1), row('L', null, 9, { method: 'SAW' })];
    const forest = buildRunForest(rows);
    assert.deepEqual(defaultComparePair(forest.roots, 'L'), { a: 'R', b: 'c1' });
    assert.deepEqual(defaultComparePair(forest.roots, null), { a: 'R', b: 'c1' });
  });

  test('fewer than two comparable runs → no default pair', () => {
    const forest = buildRunForest([row('R', null, 0), row('L', null, 1, { method: 'SAW' })]);
    assert.equal(defaultComparePair(forest.roots, 'R'), null);
    assert.equal(defaultComparePair([], null), null);
  });

  test('a comparison link opens the tab with the pair and B as the run on screen (FR-CMP-11)', () => {
    const href = compareHref('pos-1', 'run-a', 'run-b');
    const url = new URL(href, 'http://x');
    assert.equal(url.pathname, '/positions/pos-1');
    assert.equal(url.searchParams.get('tab'), RUN_COMPARE_TAB);
    assert.equal(url.searchParams.get('a'), 'run-a');
    assert.equal(url.searchParams.get('b'), 'run-b');
    assert.equal(url.searchParams.get('runId'), 'run-b');
  });
});

describe('TC-LIN picking A and B', () => {
  const fill = (b: string) => (b === 'c5' ? 'R' : null);

  test('a card click makes B; the A button makes A; nothing else moves', () => {
    assert.deepEqual(nextPair({ a: 'R', b: 'c1' }, 'b', 'c5', fill), { a: 'R', b: 'c5' });
    assert.deepEqual(nextPair({ a: 'R', b: 'c1' }, 'a', 'c2', fill), { a: 'c2', b: 'c1' });
  });

  test('picking the run already in the other slot swaps them — A and B are never equal', () => {
    assert.deepEqual(nextPair({ a: 'R', b: 'c1' }, 'b', 'R', fill), { a: 'c1', b: 'R' });
    assert.deepEqual(nextPair({ a: 'R', b: 'c1' }, 'a', 'c1', fill), { a: 'c1', b: 'R' });
  });

  test('picking the run already in that slot changes nothing', () => {
    const pair = { a: 'R', b: 'c1' };
    assert.equal(nextPair(pair, 'b', 'c1', fill), pair);
    assert.equal(nextPair(pair, 'a', 'R', fill), pair);
  });

  test('a B picked while A is empty gets the neighbour the shortcuts offer first', () => {
    assert.deepEqual(nextPair({ a: null, b: null }, 'b', 'c5', fill), { a: 'R', b: 'c5' });
    assert.deepEqual(nextPair({ a: null, b: null }, 'b', 'c9', fill), { a: null, b: 'c9' });
  });
});
