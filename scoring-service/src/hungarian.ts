// Hungarian (Kuhn–Munkres) max-total assignment — a pure, dependency-free
// helper used by the AHP+TOPSIS technical scorer and the career fallback.

/**
 * Hungarian algorithm (Kuhn–Munkres, potentials formulation) for the
 * MAX-total-similarity one-to-one assignment between the rows and columns of
 * `sim` (m×n). Returns the k = min(m,n) matched [rowIdx, colIdx] pairs.
 */
export function hungarianMaxAssignment(sim: number[][]): [number, number][] {
  const m = sim.length;
  const n = sim[0]?.length ?? 0;
  if (m === 0 || n === 0) return [];

  // The potentials formulation needs rows ≤ cols; transpose when needed.
  const transposed = m > n;
  const a = transposed
    ? Array.from({ length: n }, (_, i) =>
        Array.from({ length: m }, (_, j) => sim[j]![i]!)
      )
    : sim;
  const rows = a.length;
  const cols = a[0]!.length;

  // Convert to a min-cost problem: cost = maxSim − sim.
  let maxVal = -Infinity;
  for (const row of a) for (const v of row) if (v > maxVal) maxVal = v;

  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(rows + 1).fill(0);
  const v = new Array<number>(cols + 1).fill(0);
  const match = new Array<number>(cols + 1).fill(0); // col j → row (1-based)
  const way = new Array<number>(cols + 1).fill(0);

  for (let i = 1; i <= rows; i++) {
    match[0] = i;
    let j0 = 0;
    const minv = new Array<number>(cols + 1).fill(INF);
    const used = new Array<boolean>(cols + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = match[j0]!;
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= cols; j++) {
        if (used[j]) continue;
        const cur = maxVal - a[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= cols; j++) {
        if (used[j]) {
          u[match[j]!] = u[match[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (match[j0] !== 0);
    do {
      const j1 = way[j0]!;
      match[j0] = match[j1]!;
      j0 = j1;
    } while (j0);
  }

  const pairs: [number, number][] = [];
  for (let j = 1; j <= cols; j++) {
    if (match[j]! > 0) {
      pairs.push(transposed ? [j - 1, match[j]! - 1] : [match[j]! - 1, j - 1]);
    }
  }
  return pairs;
}
