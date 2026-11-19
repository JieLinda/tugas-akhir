// ── The lineage navigator's geometry — the pure half ──────────────────────
//
// The "Komparasi Versi" tab draws a position's runs as a node-link tree and
// lets the reader point at any two of them. This module decides WHERE every
// node goes and which connector belongs to the A–B path; the component only
// paints. Pure and client-safe, so the shape is tested without a browser
// (tests/scoring/run-lineage-layout.test.ts).
//
// The layout is left-to-right with generations as columns and each parent
// level with its FIRST child, the others stacked beneath it. That is the shape
// that survives the case this view exists for — one root with many
// "Tambah Kandidat Pembanding" children. A top-down org chart puts twenty
// siblings side by side and the tree becomes a horizontal scroll; a centred
// tidy tree parks the root halfway down a tall column where the reader has to
// look for it. Here twenty siblings are twenty rows, the root sits at the top
// of its own column, and the depth (rarely more than three) is what goes right.

import type { RunTreeNode } from './run-tree';

export const LINEAGE_DIMS = {
  nodeW: 248,
  nodeH: 56,
  colGap: 52,
  rowGap: 10,
  /** Extra space between two separate trees (two roots). */
  treeGap: 26,
  padX: 12,
  padY: 10,
};
export type LineageDims = typeof LINEAGE_DIMS;

export type LineageLayoutNode = {
  node: RunTreeNode;
  parentId: string | null;
  rootId: string;
  depth: number;
  /** Vertical slot; several trees share one sequence. */
  row: number;
  x: number;
  y: number;
  /** Children drawn (0 when the node is collapsed). */
  shownChildren: number;
  /** Every descendant a collapse on this node is hiding. */
  hiddenDescendants: number;
  /**
   * Bottom edge of the last row this node's drawn subtree occupies (its own
   * bottom for a leaf or a folded node). The navigator lets a parent's card
   * stick to the top of its column down to here, so a root with many children
   * stays in view while they scroll past.
   */
  subtreeBottom: number;
  /** Position among its siblings (among the roots, for a root). */
  siblingIndex: number;
  siblingCount: number;
};

export type LineageLayoutEdge = {
  parentId: string;
  childId: string;
  /** SVG path data, in canvas coordinates. */
  d: string;
  /** On the path between A and B. */
  highlighted: boolean;
};

export type LineageLayout = {
  nodes: LineageLayoutNode[];
  edges: LineageLayoutEdge[];
  width: number;
  height: number;
  /** Generation columns actually drawn (deepest visible depth + 1). */
  columns: number;
  /** Vertical extent of each tree, for the separators between them. */
  trees: { rootId: string; top: number; bottom: number; runs: number }[];
};

export function countDescendants(node: RunTreeNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

/** x of a generation column's left edge. */
export const columnX = (depth: number, dims: LineageDims = LINEAGE_DIMS) =>
  dims.padX + depth * (dims.nodeW + dims.colGap);

/**
 * The connector from a parent's right edge to a child's left edge: out along
 * the parent's mid-line to a trunk halfway into the gap, down the trunk with a
 * rounded corner, and in to the child. The first child shares the parent's row,
 * so its connector is a straight line — which is what makes a long chain read
 * as one line of work.
 */
export function connectorPath(
  parent: { x: number; y: number },
  child: { x: number; y: number },
  dims: LineageDims = LINEAGE_DIMS,
): string {
  const x1 = parent.x + dims.nodeW;
  const y1 = parent.y + dims.nodeH / 2;
  const x2 = child.x;
  const y2 = child.y + dims.nodeH / 2;
  if (Math.abs(y2 - y1) < 0.5) return `M${x1},${y1} H${x2}`;
  const tx = x1 + dims.colGap / 2;
  const r = Math.min(8, Math.abs(y2 - y1) / 2, dims.colGap / 4);
  const dir = y2 > y1 ? 1 : -1;
  return `M${x1},${y1} H${tx - r} Q${tx},${y1} ${tx},${y1 + dir * r} V${y2 - dir * r} Q${tx},${y2} ${tx + r},${y2} H${x2}`;
}

/**
 * Lay the forest out. `collapsed` hides a node's descendants (the node itself
 * stays, carrying the count it hides); `highlight` is the set from
 * `lineagePath` — a connector is on the A–B path when its child is in the set
 * and is not the meeting point itself.
 */
export function layoutLineage(
  roots: RunTreeNode[],
  opts: {
    collapsed?: ReadonlySet<string>;
    highlight?: { nodes: ReadonlySet<string>; lca: string | null } | null;
    dims?: Partial<LineageDims>;
  } = {},
): LineageLayout {
  const dims: LineageDims = { ...LINEAGE_DIMS, ...(opts.dims ?? {}) };
  const collapsed = opts.collapsed ?? new Set<string>();
  const nodes: LineageLayoutNode[] = [];
  const byId = new Map<string, LineageLayoutNode>();
  const trees: LineageLayout['trees'] = [];
  const seen = new Set<string>();

  let row = 0;
  let extraY = 0; // accumulated tree gaps
  let maxDepth = 0;

  const yOf = (r: number) => dims.padY + extraY + r * (dims.nodeH + dims.rowGap);

  const place = (
    node: RunTreeNode,
    depth: number,
    parentId: string | null,
    rootId: string,
    siblingIndex: number,
    siblingCount: number,
  ) => {
    // A cycle is impossible through the FK but possible through a manual
    // UPDATE; buildRunForest already terminates it, and so does this.
    if (seen.has(node.runId)) return;
    seen.add(node.runId);
    const isCollapsed = collapsed.has(node.runId) && node.children.length > 0;
    const laid: LineageLayoutNode = {
      node,
      parentId,
      rootId,
      depth,
      row,
      x: columnX(depth, dims),
      y: yOf(row),
      shownChildren: isCollapsed ? 0 : node.children.length,
      hiddenDescendants: isCollapsed ? countDescendants(node) : 0,
      subtreeBottom: 0,
      siblingIndex,
      siblingCount,
    };
    nodes.push(laid);
    byId.set(node.runId, laid);
    if (depth > maxDepth) maxDepth = depth;
    if (isCollapsed || node.children.length === 0) {
      row += 1;
    } else {
      node.children.forEach((c, i) => place(c, depth + 1, node.runId, rootId, i, node.children.length));
    }
    laid.subtreeBottom = yOf(row - 1) + dims.nodeH;
  };

  roots.forEach((root, i) => {
    if (i > 0) extraY += dims.treeGap;
    const top = yOf(row);
    place(root, 0, null, root.runId, i, roots.length);
    const last = nodes[nodes.length - 1];
    trees.push({
      rootId: root.runId,
      top,
      bottom: last ? last.y + dims.nodeH : top,
      runs: 1 + countDescendants(root),
    });
  });

  const hl = opts.highlight ?? null;
  const edges: LineageLayoutEdge[] = [];
  for (const n of nodes) {
    if (!n.parentId) continue;
    const parent = byId.get(n.parentId);
    if (!parent) continue;
    edges.push({
      parentId: parent.node.runId,
      childId: n.node.runId,
      d: connectorPath(parent, n, dims),
      highlighted: Boolean(hl && hl.nodes.has(n.node.runId) && n.node.runId !== hl.lca),
    });
  }

  const columns = nodes.length ? maxDepth + 1 : 0;
  const lastBottom = nodes.reduce((m, n) => Math.max(m, n.y + dims.nodeH), 0);
  return {
    nodes,
    edges,
    width: dims.padX * 2 + columns * dims.nodeW + Math.max(0, columns - 1) * dims.colGap,
    height: nodes.length ? lastBottom + dims.padY : 0,
    columns,
    trees,
  };
}

/** Each run's parent id (null for a root) and its root id. */
export function lineageIndex(roots: RunTreeNode[]): Map<string, { node: RunTreeNode; parentId: string | null; rootId: string }> {
  const out = new Map<string, { node: RunTreeNode; parentId: string | null; rootId: string }>();
  const walk = (n: RunTreeNode, parentId: string | null, rootId: string) => {
    if (out.has(n.runId)) return;
    out.set(n.runId, { node: n, parentId, rootId });
    n.children.forEach((c) => walk(c, n.runId, rootId));
  };
  roots.forEach((r) => walk(r, null, r.runId));
  return out;
}

/** `id` and every ancestor up to its root, nearest first. */
export function ancestry(index: ReturnType<typeof lineageIndex>, id: string): string[] {
  const out: string[] = [];
  let cur: string | null = id;
  const guard = new Set<string>();
  while (cur && index.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    out.push(cur);
    cur = index.get(cur)!.parentId;
  }
  return out;
}

/**
 * The path between A and B through their nearest common ancestor: every node
 * on it (A, B and the meeting point included), the meeting point, and whether
 * the two share a tree at all. Two runs of different trees have no path — the
 * view says so instead of inventing one through a common root.
 */
export function lineagePath(
  roots: RunTreeNode[],
  a: string | null,
  b: string | null,
  index: ReturnType<typeof lineageIndex> = lineageIndex(roots),
): { nodes: Set<string>; lca: string | null; sameTree: boolean } {
  if (!a || !b || !index.has(a) || !index.has(b)) return { nodes: new Set(), lca: null, sameTree: false };
  const upA = ancestry(index, a);
  const upB = ancestry(index, b);
  const inB = new Set(upB);
  const lca = upA.find((id) => inB.has(id)) ?? null;
  if (!lca) return { nodes: new Set(), lca: null, sameTree: false };
  const nodes = new Set<string>();
  for (const id of upA) {
    nodes.add(id);
    if (id === lca) break;
  }
  for (const id of upB) {
    nodes.add(id);
    if (id === lca) break;
  }
  return { nodes, lca, sameTree: true };
}

/**
 * The nodes to collapse so that only the branches holding the given runs stay
 * open: every node with children that is not a strict ancestor of one of them.
 * The kept runs themselves fold too — their own subtrees are "the others".
 */
export function collapseAllExcept(roots: RunTreeNode[], keep: (string | null | undefined)[]): Set<string> {
  const index = lineageIndex(roots);
  const open = new Set<string>();
  for (const id of keep) {
    if (!id || !index.has(id)) continue;
    ancestry(index, id)
      .slice(1)
      .forEach((x) => open.add(x));
  }
  const out = new Set<string>();
  for (const [id, { node }] of index) if (node.children.length > 0 && !open.has(id)) out.add(id);
  return out;
}

/** Every node with children — "Lipat semua". */
export function allCollapsible(roots: RunTreeNode[]): Set<string> {
  const out = new Set<string>();
  for (const [id, { node }] of lineageIndex(roots)) if (node.children.length > 0) out.add(id);
  return out;
}

/**
 * Stepping B through its siblings — the one gesture a root with many children
 * needs: compare the root with child 1, then child 2, and so on, without
 * hunting for each in the tree. Siblings are the parent's children (the roots,
 * for a root) in the order the tree draws them; only `isEligible` ones count.
 */
export function siblingStep(
  roots: RunTreeNode[],
  id: string | null,
  isEligible: (n: RunTreeNode) => boolean,
  index: ReturnType<typeof lineageIndex> = lineageIndex(roots),
): { prev: string | null; next: string | null; position: number; total: number } {
  const none = { prev: null, next: null, position: 0, total: 0 };
  if (!id || !index.has(id)) return none;
  const parentId = index.get(id)!.parentId;
  const siblings = (parentId ? index.get(parentId)!.node.children : roots).filter(isEligible);
  const at = siblings.findIndex((s) => s.runId === id);
  if (at < 0) return { ...none, total: siblings.length };
  return {
    prev: at > 0 ? siblings[at - 1].runId : null,
    next: at < siblings.length - 1 ? siblings[at + 1].runId : null,
    position: at + 1,
    total: siblings.length,
  };
}

/** Column caption: "Root", then "Turunan 1", "Turunan 2", … */
export const generationLabel = (depth: number) => (depth === 0 ? 'Root' : `Turunan ${depth}`);
