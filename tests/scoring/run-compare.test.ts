// TC-CMP — the 1:1 run comparison (lib/run-compare.ts, FR-CMP-01..10, 13) and
// the reproducibility check (NFR-RR-01). Pure: no database, no model.
//
//   node --import tsx --test tests/scoring/run-compare.test.ts
//
// What is pinned here:
//   • an ORACLE: a plain textbook TOPSIS written in this file (the one copy of
//     the formula I-7 allows), against the engine function every replay uses;
//   • a FIXTURE small enough to compute by hand (3 → 4 candidates, 2 criteria),
//     with the arithmetic in the comments;
//   • four PROPERTIES over random runs: (i) replay = stored, (ii) a parent →
//     "Tambah Kandidat Pembanding" child differs in S1 only, (iii) the last
//     attribution step IS run B, (iv) swapping A and B flips every Δ;
//   • one test per explanation template T-01..T-11.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CRITERIA,
  attribute,
  comparabilityError,
  compareRuns,
  configStatusLabel,
  rankPool,
  relationOf,
  replayRun,
  verifyRunReproducibility,
  type Comparison,
  type CriterionKey,
  type RunCandidate,
  type RunConfigView,
  type RunRecord,
} from '../../lib/run-compare';
import { explainComparison, EXPLANATION_IDS, type ExplanationId } from '../../lib/run-compare-explain';
import { toComparisonDto } from '../../lib/run-compare-dto';
import { overviewFacts } from '../../lib/run-compare-overview';
import { buildComparisonSheets } from '../../lib/run-compare-export';
import { configViewFrom } from '../../lib/run-compare-config';
import { fmtCloseness, fmtPp, fmtRankDelta, fmtTiny, fmtWeight } from '../../lib/run-compare-format';
// The ENGINE's export — what produced every stored closeness.
import { rankCandidatesByTopsis } from '../../scoring-service/src/ahp-topsis-engine';
import { topsisDetailed } from '../../scoring-service/src/topsis';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = (p: string) => readFileSync(root + p, 'utf8');
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ── Deterministic randomness ────────────────────────────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ── Building runs ───────────────────────────────────────────────────────────

type Aspects = Record<CriterionKey, number>;
const zeroAspects = (): Aspects => ({ technical: 0, career: 0, behavior: 0, performance: 0, hav: 0, education: 0 });
const aspectsOf = (p: Partial<Aspects>): Aspects => ({ ...zeroAspects(), ...p });

type PoolSpec = {
  id: string;
  name?: string;
  aspects: Partial<Aspects>;
  provisional?: boolean;
  comparison?: boolean;
  existingPool?: boolean;
  outOfRange?: boolean;
};

type RunSpec = {
  id: string;
  lineage?: string[];
  rerunMode?: string;
  method?: string;
  weights: Aspects;
  active: CriterionKey[];
  pool: PoolSpec[];
  finalistCount?: number;
  /** Hand-written stored values (6 decimals). Otherwise stored the way the engine stores them. */
  stored?: Record<string, { closeness: number; rank: number }>;
  disqualified?: Record<string, string[]>;
  incumbentsNow?: string[];
  deletedNow?: string[];
  treeKey?: string;
  readinessMin?: number;
  shuffleWith?: () => number;
};

function configOf(s: RunSpec, isChild: boolean): RunConfigView {
  const origin = isChild ? 'frozen_parent' : 'root_snapshot';
  return {
    weights: s.weights,
    weightsOrigin: origin,
    pairwise: null,
    consistency: null,
    weightSource: isChild ? 'inherited' : 'ahp-matrix',
    activeCriteria: s.active,
    droppedCriteria: CRITERIA.filter((k) => !s.active.includes(k)).map((key) => ({ key, reason: 'tidak terukur' })),
    criteriaOrigin: origin,
    filter: {
      ruleLabels: ['Disiplin: tidak ada sanksi aktif'],
      ruleCount: 1,
      treeKey: s.treeKey ?? '{"op":"and","rules":["discipline"]}',
      enforce: true,
      origin,
    },
    gradeRange: { min: '5', max: '8' },
    includedTenantIds: ['tenant-1'],
    readiness: {
      thresholds: [
        { minScore: s.readinessMin ?? 80, level: 'Ready Now' },
        { minScore: 60, level: 'Ready 1-2 Years' },
      ],
      defaultLevel: 'Not Ready',
    },
    readinessOrigin: origin,
    finalistCount: s.finalistCount ?? 3,
    anchors: { technical: null, career: null, depth: null, origin },
    referenceDate: '2026-10-01T03:00:00.000Z',
    referenceDateOrigin: origin,
    positionBasis: null,
    models: null,
    dataVersions: null,
  };
}

/**
 * A RunRecord as the loader would return it. Unless `stored` is given, the
 * stored closeness and ranks are produced the way the ENGINE produces them:
 * candidates in id order (`loadAhpCandidates … ORDER BY id`), its own
 * `rankCandidatesByTopsis`, `closeness.toFixed(6)` into numeric(10,6), the
 * unrounded value into `details.topsis`, `pool_rank` = position in the sort.
 */
function mkRun(s: RunSpec): RunRecord {
  const lineage = s.lineage ?? [s.id];
  const isChild = lineage.length > 1;
  const method = s.method ?? 'AHP_TOPSIS';
  const aspectsById = new Map(s.pool.map((p) => [p.id, aspectsOf(p.aspects)]));
  const engineIds = s.pool.map((p) => p.id).sort();
  const dropped = new Set(CRITERIA.filter((k) => !s.active.includes(k)));
  const engine = rankCandidatesByTopsis(
    engineIds.map((id) => ({ id })),
    aspectsById,
    s.weights,
    dropped,
  );
  const storedById = new Map<string, { closeness: number; full: number | null; rank: number }>();
  engine.rankedAll.forEach((e, i) =>
    storedById.set(e.candidate.id, {
      closeness: Number(e.closeness.toFixed(6)),
      full: e.closeness,
      rank: i + 1,
    }),
  );
  if (s.stored) {
    for (const [id, v] of Object.entries(s.stored)) storedById.set(id, { closeness: v.closeness, full: null, rank: v.rank });
  }
  const n = s.finalistCount ?? 3;
  const pool: RunCandidate[] = s.pool.map((p) => {
    const st = storedById.get(p.id)!;
    return {
      candidateId: p.id,
      name: p.name ?? p.id.slice(-2),
      unit: 'Mulia',
      aspects: aspectsOf(p.aspects),
      storedCloseness: st.closeness,
      fullCloseness: st.full,
      storedRank: st.rank,
      isFinalist: st.rank <= n,
      listed: st.rank <= n || Boolean(p.comparison),
      readiness: st.rank <= n ? 'Ready Now' : null,
      provisional: Boolean(p.provisional),
      markers: {
        comparison: Boolean(p.comparison),
        existingPool: Boolean(p.existingPool),
        newlyScored: Boolean(p.comparison && !p.existingPool),
        enteredTopN: false,
        leftTopN: false,
        outOfRange: Boolean(p.outOfRange),
      },
      excluded: null,
      decision: null,
    };
  });
  return {
    id: s.id,
    positionId: 'position-1',
    tenantId: 'tenant-1',
    label: s.id,
    method,
    status: 'completed',
    createdAt: '2026-10-01T00:00:00.000Z',
    completedAt: '2026-10-01T00:01:00.000Z',
    createdByName: 'Penguji',
    parentRunId: isChild ? lineage[lineage.length - 2]! : null,
    rerunMode: s.rerunMode ?? (isChild ? 'incremental_add' : 'none'),
    rerunReason: isChild ? 'Permintaan forum' : null,
    legacy: false,
    modeLabel: isChild ? 'Tambah Kandidat Pembanding' : 'Run awal',
    lineage,
    config: configOf(s, isChild),
    pool: s.shuffleWith ? shuffle(pool, s.shuffleWith) : pool,
    poolSource: method === 'AHP_TOPSIS' ? 'pool_snapshot' : 'none',
    disqualified: new Map(Object.entries(s.disqualified ?? {})),
    deletedNow: new Set(s.deletedNow ?? []),
    incumbentsNow: new Set(s.incumbentsNow ?? []),
  };
}

/** A random root run: 3–9 candidates, random active criteria and weights. */
function randomRoot(rnd: () => number, id: string, idBase: number, opts: { ties?: boolean } = {}): RunSpec {
  const size = 3 + Math.floor(rnd() * 7);
  const value = () => (opts.ties ? 10 * Math.floor(rnd() * 11) : Math.round(rnd() * 1000) / 10);
  const pool: PoolSpec[] = Array.from({ length: size }, (_, i) => ({
    id: uuid(idBase + i),
    aspects: Object.fromEntries(CRITERIA.map((k) => [k, value()])) as Aspects,
  }));
  const active = CRITERIA.filter(() => rnd() > 0.25);
  const weights = Object.fromEntries(CRITERIA.map((k) => [k, 0.02 + rnd()])) as Aspects;
  return { id, weights, active: active.length ? active : [...CRITERIA], pool, finalistCount: Math.min(3, size) };
}

/** Its "Tambah Kandidat Pembanding" child: the same everything, plus 1–3 new candidates. */
function childOf(rnd: () => number, parent: RunSpec, id: string, idBase: number): RunSpec {
  const extra = 1 + Math.floor(rnd() * 3);
  const added: PoolSpec[] = Array.from({ length: extra }, (_, i) => ({
    id: uuid(idBase + i),
    aspects: Object.fromEntries(CRITERIA.map((k) => [k, Math.round(rnd() * 1000) / 10])) as Aspects,
    comparison: true,
  }));
  return {
    ...parent,
    id,
    lineage: [...(parent.lineage ?? [parent.id]), id],
    rerunMode: 'incremental_add',
    pool: [...parent.pool.map((p) => ({ ...p })), ...added],
    stored: undefined,
  };
}

// ── The oracle (I-7's one allowed copy: a TEST oracle) ──────────────────────

/** Textbook TOPSIS over the active criteria only, weights renormalised (Pers. 2.12). */
function oracle(rows: number[][], weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0);
  const w = weights.map((x) => x / total);
  const n = w.length;
  const divisor = Array.from({ length: n }, (_, j) => Math.hypot(...rows.map((r) => r[j]!)));
  const v = rows.map((r) => r.map((x, j) => (w[j]! * x) / divisor[j]!));
  const best = Array.from({ length: n }, (_, j) => Math.max(...v.map((r) => r[j]!)));
  const worst = Array.from({ length: n }, (_, j) => Math.min(...v.map((r) => r[j]!)));
  return v.map((r) => {
    const dPlus = Math.sqrt(r.reduce((s, x, j) => s + (x - best[j]!) ** 2, 0));
    const dMinus = Math.sqrt(r.reduce((s, x, j) => s + (x - worst[j]!) ** 2, 0));
    return { dPlus, dMinus, closeness: dPlus + dMinus > 0 ? dMinus / (dPlus + dMinus) : 0.5, divisor };
  });
}

describe('TC-CMP-ORACLE: the replay is textbook TOPSIS (I-7)', () => {
  test('rankPool agrees with an independent TOPSIS on 300 random pools', () => {
    const rnd = mulberry32(7);
    for (let t = 0; t < 300; t++) {
      const spec = randomRoot(rnd, `r${t}`, 1000 * (t + 1));
      const pool = spec.pool.map((p) => ({ candidateId: p.id, aspects: aspectsOf(p.aspects) }));
      const replay = rankPool(pool, spec.weights, spec.active);
      const ids = pool.map((p) => p.candidateId).sort();
      const o = oracle(
        ids.map((id) => spec.active.map((k) => pool.find((p) => p.candidateId === id)!.aspects[k])),
        spec.active.map((k) => spec.weights[k]),
      );
      ids.forEach((id, i) => {
        const r = replay.byId.get(id)!;
        assert.ok(Math.abs(r.closeness - o[i]!.closeness) <= 1e-12, `closeness ${id}: ${r.closeness} vs ${o[i]!.closeness}`);
        assert.ok(Math.abs(r.dPlus - o[i]!.dPlus) <= 1e-12);
        assert.ok(Math.abs(r.dMinus - o[i]!.dMinus) <= 1e-12);
      });
      spec.active.forEach((k, j) => {
        assert.ok(Math.abs(replay.criteria.get(k)!.divisor - o[0]!.divisor[j]!) <= 1e-9, `divisor ${k}`);
      });
      // The ranks are the closeness order (ties to the lower id).
      const byRank = [...replay.byId.entries()].sort((x, y) => x[1].rank - y[1].rank);
      for (let i = 1; i < byRank.length; i++) {
        const prev = o[ids.indexOf(byRank[i - 1]![0])]!.closeness;
        const cur = o[ids.indexOf(byRank[i]![0])]!.closeness;
        assert.ok(prev >= cur - 1e-12, 'rank order follows closeness');
      }
    }
  });

  test('the "pembagi" is the vector norm sqrt(Σx²) — the normalisation the engine applies (FR-CMP-07)', () => {
    const d = topsisDetailed([[3], [4]], [1], ['benefit']);
    assert.equal(d.colNorms[0], 5);
    assert.deepEqual(d.normalized.map((r) => r[0]), [0.6, 0.8]);
  });
});

// ── The hand-computed fixture ───────────────────────────────────────────────
//
// Two active criteria — Kompetensi Teknis (w = 0,6) and Behavior (w = 0,4);
// the other four are dropped, so the weights need no renormalisation.
//
// PARENT (P), three candidates:            Teknis  Behavior
//     X                                       20       20
//     Y                                       40       10
//     Z                                       40       20
//   pembagi Teknis   = √(20² + 40² + 40²) = √3600 = 60
//   pembagi Behavior = √(20² + 10² + 20²) = √900  = 30
//   v = w·x / pembagi:
//     X: 0,6·20/60 = 0,2    0,4·20/30 = 0,26667
//     Y: 0,6·40/60 = 0,4    0,4·10/30 = 0,13333
//     Z: 0,6·40/60 = 0,4    0,4·20/30 = 0,26667
//   ideal + = (0,4 ; 0,26667) — held by Y,Z (Teknis) and X,Z (Behavior)
//   ideal − = (0,2 ; 0,13333) — held by X (Teknis) and Y (Behavior)
//     X: D+ = √(0,2² + 0)       = 0,2      D− = √(0 + 0,13333²) = 0,13333   CC = 0,13333/0,33333 = 0,4
//     Y: D+ = √(0 + 0,13333²)   = 0,13333  D− = √(0,2² + 0)      = 0,2       CC = 0,2/0,33333     = 0,6
//     Z: D+ = 0                            D− = √(0,2² + 0,13333²) = 0,24037  CC = 1
//   ranks: Z 1, Y 2, X 3.
//
// CHILD (C) = P + W (Teknis 80, Behavior 40), everything else inherited:
//   pembagi Teknis   = √(3600 + 80²) = √10000 = 100   (ratio 100/60 = 1,6667)
//   pembagi Behavior = √(900 + 40²)  = √2500  = 50    (ratio 50/30  = 1,6667)
//   v: X (0,12 ; 0,16)  Y (0,24 ; 0,08)  Z (0,24 ; 0,16)  W (0,48 ; 0,32)
//   ideal + = (0,48 ; 0,32) — W on both;  ideal − = (0,12 ; 0,08) — X, Y
//     X: D+ = √(0,36² + 0,16²) = √0,1552 = 0,39395   D− = 0,08               CC = 0,08/0,47395    = 0,168793
//     Y: D+ = √(0,24² + 0,24²) = √0,1152 = 0,33941   D− = 0,12               CC = 0,12/0,45941    = 0,261204
//     Z: D+ = √(0,24² + 0,16²) = √0,0832 = 0,28844   D− = √0,0208 = 0,14422  CC = 1/3 (D+ = 2·D−) = 0,333333
//     W: D+ = 0                                                               CC = 1
//   ranks: W 1, Z 2, Y 3, X 4 — every carried candidate drops exactly one place.

const X = uuid(1);
const Y = uuid(2);
const Z = uuid(3);
const W = uuid(4);
const TWO = ['technical', 'behavior'] as CriterionKey[];
const W2: Aspects = { technical: 0.6, career: 0, behavior: 0.4, performance: 0, hav: 0, education: 0 };
const handParentSpec: RunSpec = {
  id: 'P',
  weights: W2,
  active: TWO,
  finalistCount: 2,
  pool: [
    { id: X, name: 'X', aspects: { technical: 20, behavior: 20 } },
    { id: Y, name: 'Y', aspects: { technical: 40, behavior: 10 } },
    { id: Z, name: 'Z', aspects: { technical: 40, behavior: 20 } },
  ],
  stored: { [X]: { closeness: 0.4, rank: 3 }, [Y]: { closeness: 0.6, rank: 2 }, [Z]: { closeness: 1, rank: 1 } },
};
const handChildSpec: RunSpec = {
  ...handParentSpec,
  id: 'C',
  lineage: ['P', 'C'],
  rerunMode: 'incremental_add',
  pool: [...handParentSpec.pool, { id: W, name: 'W', aspects: { technical: 80, behavior: 40 }, comparison: true }],
  stored: {
    [X]: { closeness: 0.168793, rank: 4 },
    [Y]: { closeness: 0.261204, rank: 3 },
    [Z]: { closeness: 0.333333, rank: 2 },
    [W]: { closeness: 1, rank: 1 },
  },
};

describe('TC-CMP-HAND: a fixture computed by hand', () => {
  test('the parent replays to the hand-computed numbers', () => {
    const p = mkRun(handParentSpec);
    const r = replayRun(p);
    assert.ok(r.available);
    assert.equal(r.criteria.get('technical')!.divisor, 60);
    assert.equal(r.criteria.get('behavior')!.divisor, 30);
    assert.ok(Math.abs(r.cells.get(X)!.get('behavior')!.weighted - 0.4 * 20 / 30) < 1e-15);
    assert.deepEqual([...r.criteria.get('technical')!.idealPosHolders].sort(), [Y, Z]);
    assert.deepEqual(r.criteria.get('technical')!.idealNegHolders, [X]);
    assert.ok(Math.abs(r.byId.get(X)!.closeness - 0.4) < 1e-15);
    assert.ok(Math.abs(r.byId.get(Y)!.closeness - 0.6) < 1e-15);
    assert.equal(r.byId.get(Z)!.closeness, 1);
    assert.ok(Math.abs(r.byId.get(Z)!.dMinus - Math.sqrt(0.2 ** 2 + (0.4 / 3) ** 2)) < 1e-15);
    assert.deepEqual([Z, Y, X].map((id) => r.byId.get(id)!.rank), [1, 2, 3]);
    const v = verifyRunReproducibility(p);
    assert.ok(v.verifiable && v.reproducible, 'hand-written stored values reproduce');
  });

  test('the child replays to the hand-computed numbers', () => {
    const c = mkRun(handChildSpec);
    const r = replayRun(c);
    assert.ok(r.available);
    assert.equal(r.criteria.get('technical')!.divisor, 100);
    assert.equal(r.criteria.get('behavior')!.divisor, 50);
    assert.deepEqual(r.criteria.get('technical')!.idealPosHolders, [W]);
    assert.deepEqual(r.criteria.get('behavior')!.idealNegHolders, [Y]);
    assert.ok(Math.abs(r.byId.get(X)!.closeness - 0.08 / (Math.sqrt(0.1552) + 0.08)) < 1e-12);
    assert.ok(Math.abs(r.byId.get(Z)!.closeness - 1 / 3) < 1e-12);
    assert.deepEqual([W, Z, Y, X].map((id) => r.byId.get(id)!.rank), [1, 2, 3, 4]);
    const v = verifyRunReproducibility(c);
    assert.ok(v.verifiable && v.reproducible, JSON.stringify(v));
  });

  test('comparing P with C: only the pool differs, and the numbers are the hand ones', () => {
    const cmp = compareRuns(mkRun(handParentSpec), mkRun(handChildSpec));
    assert.equal(cmp.relation.kind, 'b_child_of_a');
    assert.equal(cmp.relationText, 'B turunan langsung A.');
    assert.deepEqual(cmp.sources.map((s) => [s.key, s.differs]), [
      ['S1', true], ['S2', false], ['S3', false], ['S4', false], ['S5', false],
    ]);
    assert.equal(cmp.sources[0]!.summary, 'Pool: +1 kandidat, −0');
    assert.deepEqual(cmp.freezeViolations, []);
    // Ranking table, B's order.
    assert.deepEqual(cmp.ranking.map((r) => r.name), ['W', 'Z', 'Y', 'X']);
    const z = cmp.ranking.find((r) => r.candidateId === Z)!;
    assert.equal(z.deltaRank, -1);
    assert.equal(fmtRankDelta(z.deltaRank!), '▼1 (turun)');
    assert.equal(fmtCloseness(z.ccA!), '100,0%');
    assert.equal(fmtCloseness(z.ccB!), '33,3%');
    assert.equal(fmtPp(z.deltaPp!), '−66,7 pp');
    assert.equal(z.finalistChange, 'tetap');
    const y = cmp.ranking.find((r) => r.candidateId === Y)!;
    assert.equal(y.finalistChange, 'keluar', 'N = 2: Y drops from 2nd to 3rd');
    const w = cmp.ranking.find((r) => r.candidateId === W)!;
    assert.equal(w.membership, 'only_b');
    assert.equal(w.membershipReason, 'Kandidat pembanding yang ditambahkan di run B');
    // Criteria table: weights 60/40, divisors 60→100 and 30→50.
    const tech = cmp.criteria.find((r) => r.key === 'technical')!;
    assert.equal(fmtWeight(tech.weightA!), '60,00%');
    assert.equal(tech.deltaWeightPp, 0);
    assert.equal(tech.divisorA, 60);
    assert.equal(tech.divisorB, 100);
    assert.ok(Math.abs(tech.divisorRatio! - 5 / 3) < 1e-12);
    assert.deepEqual(tech.idealPosB, { raw: 80, holders: [W] });
    assert.equal(cmp.criteria.find((r) => r.key === 'career')!.activeA, false);
    // Breakdown of Z: behaviour moved most (its distance to the new best grew).
    const bz = cmp.breakdowns.get(Z)!;
    assert.ok(Math.abs(bz.delta.get('behavior')!.contribPlus - 0.16 ** 2) < 1e-12, 'Z: (0,16 − 0,32)² − 0');
    assert.ok(Math.abs(bz.delta.get('technical')!.contribPlus - 0.24 ** 2) < 1e-12, 'Z: (0,24 − 0,48)² − 0');
    assert.deepEqual(bz.topMovers, ['technical', 'behavior']);
  });

  test('attribution on P → C moves at the pool step only, and ends on C', () => {
    const p = mkRun(handParentSpec);
    const c = mkRun(handChildSpec);
    const steps = attribute(p, c)!;
    assert.deepEqual(steps.map((s) => s.key), ['A', 'weights', 'aspects', 'pool']);
    for (const k of ['weights', 'aspects'] as const) {
      const s = steps.find((x) => x.key === k)!;
      assert.deepEqual([...s.byId], [...steps[0]!.byId], `step ${k} moves nothing`);
    }
    const last = steps[3]!.byId;
    assert.equal(last.get(Z)!.rank, 2);
    assert.ok(Math.abs(last.get(Z)!.closeness - 1 / 3) < 1e-12);
  });
});

// ── Properties ──────────────────────────────────────────────────────────────

describe('TC-CMP-PROP-i: a replay equals what was stored (NFR-RR-01, I-4)', () => {
  test('300 random runs stored the engine way reproduce exactly, from any row order', () => {
    const rnd = mulberry32(11);
    for (let t = 0; t < 300; t++) {
      const spec = randomRoot(rnd, `r${t}`, 1000 * (t + 1), { ties: t % 3 === 0 });
      const v = verifyRunReproducibility(mkRun({ ...spec, shuffleWith: rnd }));
      assert.ok(v.verifiable, 'verifiable');
      assert.ok(v.reproducible, `run ${t}: ${JSON.stringify(v)}`);
      assert.equal(v.maxStoredDelta, 0);
      assert.equal(v.maxFullDelta, 0, 'bit-identical at full precision');
    }
  });

  test('exact ties are broken by id, as the engine broke them', () => {
    const spec: RunSpec = {
      id: 'T',
      weights: W2,
      active: TWO,
      pool: [uuid(9), uuid(5), uuid(7)].map((id) => ({ id, aspects: { technical: 50, behavior: 50 } })),
    };
    const run = mkRun(spec);
    assert.deepEqual(
      [...run.pool].sort((a, b) => a.storedRank - b.storedRank).map((c) => c.candidateId),
      [uuid(5), uuid(7), uuid(9)],
    );
    const v = verifyRunReproducibility(run);
    assert.ok(v.verifiable && v.reproducible);
  });

  test('a tampered closeness or rank is caught, not absorbed', () => {
    const run = mkRun(handParentSpec);
    run.pool.find((c) => c.candidateId === Y)!.storedCloseness = 0.600002;
    run.pool.find((c) => c.candidateId === X)!.storedRank = 1;
    const v = verifyRunReproducibility(run);
    assert.ok(v.verifiable);
    assert.equal(v.reproducible, false);
    assert.equal(v.closenessMismatches[0]!.candidateId, Y);
    assert.deepEqual(v.rankMismatches, [{ candidateId: X, stored: 1, replayed: 3 }]);
  });

  test('what cannot be replayed says why instead of passing', () => {
    const legacy = mkRun({ ...handParentSpec, method: 'SAW' });
    const v1 = verifyRunReproducibility(legacy);
    assert.equal(v1.verifiable, false);
    assert.match(!v1.verifiable ? v1.reason : '', /bukan AHP \+ TOPSIS/);
    const old = mkRun(handParentSpec);
    old.poolSource = 'finalists_only';
    const v2 = verifyRunReproducibility(old);
    assert.equal(v2.verifiable, false);
    assert.match(!v2.verifiable ? v2.reason : '', /seluruh pool/);
  });
});

describe('TC-CMP-PROP-ii: a parent and its "Tambah Kandidat Pembanding" child differ in S1 only', () => {
  test('200 random parent → child pairs', () => {
    const rnd = mulberry32(23);
    for (let t = 0; t < 200; t++) {
      const parent = randomRoot(rnd, `p${t}`, 1000 * (t + 1));
      const child = childOf(rnd, parent, `c${t}`, 1000 * (t + 1) + 500);
      const cmp = compareRuns(mkRun(parent), mkRun(child));
      const differs = Object.fromEntries(cmp.sources.map((s) => [s.key, s.differs]));
      assert.deepEqual(differs, { S1: true, S2: false, S3: false, S4: false, S5: false }, `pair ${t}`);
      assert.deepEqual(cmp.freezeViolations, []);
      const steps = cmp.attribution!;
      for (const k of ['weights', 'aspects'] as const) {
        assert.deepEqual([...steps.find((s) => s.key === k)!.byId], [...steps[0]!.byId], `pair ${t}: ${k} is zero`);
      }
    }
  });

  test('a moved frozen part on such a pair is reported as a freeze violation, never absorbed', () => {
    const child = mkRun({
      ...handChildSpec,
      pool: handChildSpec.pool.map((p) => (p.id === X ? { ...p, aspects: { technical: 25, behavior: 20 } } : p)),
      stored: undefined,
      readinessMin: 85,
    });
    const cmp = compareRuns(mkRun(handParentSpec), child);
    assert.deepEqual(cmp.freezeViolations.map((s) => s.key).sort(), ['S3', 'S5']);
  });
});

describe('TC-CMP-PROP-iii: the last attribution step is exactly run B', () => {
  test('200 random pairs of unrelated roots', () => {
    const rnd = mulberry32(31);
    for (let t = 0; t < 200; t++) {
      const a = mkRun(randomRoot(rnd, `a${t}`, 1000 * (t + 1)));
      // B shares part of A's pool (some aspects changed), drops some, adds some.
      const bSpec = randomRoot(rnd, `b${t}`, 1000 * (t + 1) + 300);
      const carried = a.pool
        .filter(() => rnd() > 0.3)
        .map((c) => ({
          id: c.candidateId,
          aspects: rnd() > 0.5 ? c.aspects : { ...c.aspects, behavior: Math.round(rnd() * 1000) / 10 },
        }));
      const b = mkRun({ ...bSpec, pool: [...carried, ...bSpec.pool] });
      const steps = attribute(a, b)!;
      const last = steps[steps.length - 1]!;
      const replayB = replayRun(b);
      assert.ok(replayB.available);
      assert.equal(last.byId.size, b.pool.length);
      for (const c of b.pool) {
        const s = last.byId.get(c.candidateId)!;
        assert.equal(s.closeness, replayB.byId.get(c.candidateId)!.closeness, 'identical to B replayed');
        assert.equal(s.closeness, c.fullCloseness, 'identical to B as stored');
        assert.equal(s.rank, c.storedRank);
      }
    }
  });
});

describe('TC-CMP-PROP-iv: swapping A and B flips the sign of every Δ', () => {
  function assertMirror(ab: Comparison, ba: Comparison) {
    const mirror = { both: 'both', only_a: 'only_b', only_b: 'only_a' } as const;
    const flip = { masuk: 'keluar', keluar: 'masuk', tetap: 'tetap', tidak: 'tidak' } as const;
    for (const r of ab.ranking) {
      const s = ba.ranking.find((x) => x.candidateId === r.candidateId)!;
      assert.equal(s.membership, mirror[r.membership]);
      assert.ok(r.deltaRank === null ? s.deltaRank === null : r.deltaRank === -s.deltaRank!, 'Δ rank');
      assert.ok(r.deltaPp === null ? s.deltaPp === null : r.deltaPp === -s.deltaPp!, 'Δ pp');
      assert.equal(s.finalistChange, r.finalistChange === null ? null : flip[r.finalistChange]);
      assert.deepEqual([...s.aspectsChanged].sort(), [...r.aspectsChanged].sort());
    }
    for (const r of ab.criteria) {
      const s = ba.criteria.find((x) => x.key === r.key)!;
      assert.ok(r.deltaWeightPp === null ? s.deltaWeightPp === null : r.deltaWeightPp === -s.deltaWeightPp!, 'Δ weight');
      if (r.divisorRatio != null) assert.ok(Math.abs(r.divisorRatio * s.divisorRatio! - 1) < 1e-12, 'ratio inverts');
      assert.equal(r.activeA, s.activeB);
    }
    for (const it of ab.config) {
      const s = ba.config.find((x) => x.key === it.key)!;
      assert.ok(it.delta === null ? s.delta === null : it.delta === -s.delta!, `config ${it.key}`);
      assert.equal(it.same, s.same);
      assert.equal(it.a, s.b);
    }
    for (const [id, d] of ab.breakdowns) {
      const e = ba.breakdowns.get(id)!;
      for (const [k, v] of d.delta) {
        const w = e.delta.get(k)!;
        assert.ok(v.raw === -w.raw && v.weighted === -w.weighted, `breakdown ${k}`);
        assert.ok(v.contribPlus === -w.contribPlus && v.contribMinus === -w.contribMinus, `contribution ${k}`);
      }
    }
    assert.deepEqual(
      ab.sources.map((s) => s.differs),
      ba.sources.map((s) => s.differs),
      'a source differs both ways or neither',
    );
  }

  test('200 random pairs of roots, and the hand pair', () => {
    const rnd = mulberry32(47);
    for (let t = 0; t < 200; t++) {
      const aSpec = randomRoot(rnd, `a${t}`, 1000 * (t + 1));
      const bSpec = randomRoot(rnd, `b${t}`, 1000 * (t + 1) + 300);
      const shared = aSpec.pool.filter(() => rnd() > 0.4).map((p) => ({ ...p, aspects: { ...p.aspects, hav: 50 } }));
      const a = mkRun(aSpec);
      const b = mkRun({ ...bSpec, pool: [...shared, ...bSpec.pool] });
      assertMirror(compareRuns(a, b), compareRuns(b, a));
    }
    const p = mkRun(handParentSpec);
    const c = mkRun(handChildSpec);
    const pc = compareRuns(p, c);
    const cp = compareRuns(c, p);
    assertMirror(pc, cp);
    assert.equal(cp.relation.kind, 'a_child_of_b');
    assert.deepEqual(cp.freezeViolations, [], 'the frozen pair is recognised either way round');
  });
});

// ── Relationship, membership reasons, adjustments ───────────────────────────

describe('TC-CMP-REL: how A and B are related (FR-CMP-02)', () => {
  const run = (id: string, lineage: string[]) => mkRun({ ...handParentSpec, id, lineage });
  test('every relation the page names', () => {
    const r = run('R', ['R']);
    const c1 = run('C1', ['R', 'C1']);
    const c2 = run('C2', ['R', 'C1', 'C2']);
    const s1 = run('S1', ['R', 'S1']);
    const other = run('Q', ['Q']);
    assert.deepEqual(relationOf(r, r), { kind: 'same_run' });
    assert.deepEqual(relationOf(r, c1), { kind: 'b_child_of_a' });
    assert.deepEqual(relationOf(r, c2), { kind: 'b_descendant_of_a', generations: 2 });
    assert.deepEqual(relationOf(c2, r), { kind: 'a_descendant_of_b', generations: 2 });
    assert.deepEqual(relationOf(c2, s1), { kind: 'same_tree', commonAncestorId: 'R' });
    assert.deepEqual(relationOf(r, other), { kind: 'different_root' });
  });
});

describe('TC-CMP-GUARD: which pairs the server refuses (FR-CMP-01, I-5, NFR-RR-07)', () => {
  test('another tenant, another position, a non-AHP run or an unfinished run is refused with its reason', () => {
    const a = mkRun(handParentSpec);
    const b = mkRun(handChildSpec);
    assert.equal(comparabilityError(a, b), null);
    // The loader returns null for a run of another tenant: "not found here".
    assert.equal(comparabilityError(a, null), 'Run tidak ditemukan di Company ini.');
    assert.equal(comparabilityError(a, { ...b, tenantId: 'another-tenant' }), 'Run tidak ditemukan di Company ini.');
    assert.match(comparabilityError(a, { ...b, positionId: 'another-position' })!, /posisi target yang sama/);
    assert.match(comparabilityError({ ...a, method: 'SAW' }, b)!, /^Run A bukan AHP \+ TOPSIS/);
    assert.match(comparabilityError(a, { ...b, status: 'in_progress' })!, /^Run B belum selesai/);
  });
});

describe('TC-CMP-POOL: why a candidate is on one side only (FR-CMP-05)', () => {
  test('rejected by the other run, incumbent now, deleted now, or no recorded reason', () => {
    const a = mkRun({
      ...handParentSpec,
      incumbentsNow: [X],
      deletedNow: [Y],
    });
    const b = mkRun({
      id: 'B',
      weights: W2,
      active: TWO,
      treeKey: '{"op":"and","rules":["discipline","pa"]}',
      pool: [{ id: Z, name: 'Z', aspects: { technical: 40, behavior: 20 } }, { id: W, name: 'W', aspects: { technical: 10, behavior: 10 } }],
      disqualified: {},
    });
    const aWithRejection = mkRun({ ...handParentSpec, disqualified: { [W]: ['PA: nilai D dalam 2 tahun terakhir'] } });
    const cmp = compareRuns(a, b);
    const reason = (id: string) => cmp.ranking.find((r) => r.candidateId === id)!.membershipReason;
    assert.equal(reason(X), 'Kini pemegang jabatan target');
    assert.equal(reason(Y), 'Data kandidat kini dihapus');
    assert.equal(reason(W), null, 'nothing stored explains W — the page says so rather than guessing');
    const cmp2 = compareRuns(aWithRejection, b);
    assert.equal(
      cmp2.ranking.find((r) => r.candidateId === W)!.membershipReason,
      'Tidak lolos aturan filter di run A: PA: nilai D dalam 2 tahun terakhir (aturan filter kedua run berbeda)',
    );
  });

  test('a comparison candidate added outside the grade range says so', () => {
    const child = mkRun({
      ...handChildSpec,
      pool: handChildSpec.pool.map((p) => (p.id === W ? { ...p, outOfRange: true } : p)),
    });
    const cmp = compareRuns(mkRun(handParentSpec), child);
    assert.equal(
      cmp.ranking.find((r) => r.candidateId === W)!.membershipReason,
      'Kandidat pembanding di run B, di luar rentang grade, ditambahkan dengan konfirmasi',
    );
  });
});

// ── The explanation templates T-01..T-11 (FR-CMP-09) ────────────────────────

function sentences(a: RunRecord, b: RunRecord) {
  const e = explainComparison(compareRuns(a, b));
  return { e, all: [...e.summary, ...[...e.perCandidate.values()].flat()] };
}
const ids = (xs: { id: ExplanationId }[]) => [...new Set(xs.map((x) => x.id))].sort();
const textOf = (xs: { id: ExplanationId; text: string }[], id: ExplanationId) => xs.filter((x) => x.id === id).map((x) => x.text);

describe('TC-CMP-TPL: every explanation template has a test', () => {
  test('T-01 + T-10: nothing moved — and why, on a child whose candidates were all in the pool already', () => {
    const p = mkRun(handParentSpec);
    const c = mkRun({
      ...handParentSpec,
      id: 'C',
      lineage: ['P', 'C'],
      rerunMode: 'incremental_add',
      pool: handParentSpec.pool.map((x) => (x.id === X ? { ...x, existingPool: true, comparison: true } : x)),
    });
    const { all } = sentences(p, c);
    assert.deepEqual(ids(all), ['T-01', 'T-10']);
    assert.deepEqual(textOf(all, 'T-01'), [
      'Tidak ada perubahan angka: peringkat dan kecocokan setiap kandidat sama di A dan B, karena semua kandidat yang diminta sudah ada di pool induk.',
    ]);
    assert.deepEqual(textOf(all, 'T-10'), [
      'Tidak ada sumber perubahan: pool, bobot, nilai aspek, penyesuaian, dan konfigurasi penyajian A dan B sama.',
    ]);
  });

  test('T-02, T-04, T-05, T-08, T-10 on the hand fixture', () => {
    const { e, all } = sentences(mkRun(handParentSpec), mkRun(handChildSpec));
    assert.deepEqual(ids(all), ['T-02', 'T-04', 'T-05', 'T-08', 'T-10']);
    assert.deepEqual(textOf(all, 'T-10'), ['Perbedaan A dan B bersumber dari perubahan data atau himpunan (komposisi pool).']);
    assert.deepEqual(textOf(all, 'T-08'), ['Keanggotaan pool berubah — +1 di B: W (kandidat pembanding yang ditambahkan di run B).']);
    assert.deepEqual(textOf(all, 'T-02'), [
      'W, kandidat pembanding, kini memegang nilai tertinggi Kompetensi Teknis (80,0; sebelumnya 40,0 milik Y dan Z).',
      'W, kandidat pembanding, kini memegang nilai tertinggi Behavior (40,0; sebelumnya 20,0 milik X dan Z).',
    ]);
    assert.deepEqual(textOf(all, 'T-04'), [
      'Pembagi normalisasi naik pada Kompetensi Teknis (1,67 kali) dan Behavior (1,67 kali), sehingga selisih pada kriteria-kriteria itu menyumbang lebih kecil terhadap jarak.',
    ]);
    assert.deepEqual(e.perCandidate.get(Y)!.map((x) => x.text), [
      'Peringkat Y turun 1 tingkat, dari 2 ke 3 (kecocokan 60,0% → 26,1%, −33,9 pp) dan kini keluar dari N besar. ' +
        'Penyumbang terbesar: Kompetensi Teknis (menurunkan kecocokan: lebih jauh dari nilai tertinggi dan lebih dekat ke nilai terendah); ' +
        // Y already held the lowest Behavior in P and still does in C, so only
        // its distance to the (new, higher) best value moved: 0,01778 → 0,0576.
        'Behavior (menurunkan kecocokan: lebih jauh dari nilai tertinggi).',
    ]);
    assert.equal(e.perCandidate.has(W), false, 'T-05 is for candidates in both runs');
  });

  test('T-03: a comparison candidate now holds the lowest value', () => {
    const V = uuid(5);
    const c = mkRun({
      ...handChildSpec,
      pool: [...handParentSpec.pool, { id: V, name: 'V', aspects: { technical: 10, behavior: 5 }, comparison: true }],
      stored: undefined,
    });
    const { all } = sentences(mkRun(handParentSpec), c);
    assert.deepEqual(textOf(all, 'T-03'), [
      'V, kandidat pembanding, kini memegang nilai terendah Kompetensi Teknis (10,0; sebelumnya 20,0 milik X).',
      'V, kandidat pembanding, kini memegang nilai terendah Behavior (5,0; sebelumnya 10,0 milik Y).',
    ]);
    assert.ok(textOf(all, 'T-04')[0]!.startsWith('Pembagi normalisasi naik pada Kompetensi Teknis (1,01 kali)'));
  });

  test('T-06: the weights changed between roots', () => {
    const a = mkRun(handParentSpec);
    const b = mkRun({ ...handParentSpec, id: 'B', weights: { ...W2, technical: 0.5, behavior: 0.5 }, stored: undefined });
    const { all } = sentences(a, b);
    assert.deepEqual(textOf(all, 'T-06'), [
      'Bobot efektif berubah: Kompetensi Teknis 60,00% → 50,00% (−10,00 pp) dan Behavior 40,00% → 50,00% (+10,00 pp).',
    ]);
    assert.ok(textOf(all, 'T-10')[0]!.includes('perubahan konfigurasi atau pertimbangan (bobot dan kriteria aktif)'));
  });

  test('T-07: aspect values changed between roots', () => {
    const b = mkRun({
      ...handParentSpec,
      id: 'B',
      pool: handParentSpec.pool.map((p) => (p.id === Y ? { ...p, aspects: { technical: 40, behavior: 25.5 } } : p)),
      stored: undefined,
    });
    const { all } = sentences(mkRun(handParentSpec), b);
    assert.deepEqual(textOf(all, 'T-07'), ['Nilai aspek 1 kandidat berubah — Y: Behavior 10,0 → 25,5.']);
  });

  test('T-09: the active criteria differ, so the weights were redistributed', () => {
    const b = mkRun({ ...handParentSpec, id: 'B', active: ['technical', 'behavior', 'hav'], stored: undefined,
      weights: { ...W2, hav: 0.25 },
      pool: handParentSpec.pool.map((p) => ({ ...p, aspects: { ...p.aspects, hav: 60 } })) });
    const { all } = sentences(mkRun(handParentSpec), b);
    assert.deepEqual(textOf(all, 'T-09'), [
      'Kriteria aktif berbeda: HAV dibuang di A tetapi aktif di B, sehingga bobotnya dibagi ulang di antara kriteria yang aktif (Pers. 2.12).',
    ]);
  });

  test('T-11: the provisional flag differs', () => {
    const a = mkRun(handParentSpec);
    const b = mkRun({
      ...handParentSpec,
      id: 'B',
      pool: handParentSpec.pool.map((p) => (p.id === X ? { ...p, provisional: true } : p)),
    });
    const { all } = sentences(a, b);
    assert.deepEqual(textOf(all, 'T-11'), [
      'Penanda skor sementara berbeda untuk 1 kandidat: X (terukur di A, sementara di B).',
    ]);
  });

  test('the catalog is complete, and the same comparison always yields the same sentences (NF-2)', () => {
    assert.equal(EXPLANATION_IDS.length, 11);
    const seen = new Set<ExplanationId>();
    const rnd = mulberry32(5);
    const pairs: [RunRecord, RunRecord][] = [
      [mkRun(handParentSpec), mkRun(handChildSpec)],
      [mkRun(handParentSpec), mkRun({ ...handChildSpec, pool: [...handParentSpec.pool, { id: uuid(5), aspects: { technical: 10, behavior: 5 }, comparison: true }], stored: undefined })],
    ];
    for (let t = 0; t < 40; t++) {
      const a = randomRoot(rnd, `a${t}`, 1000 * (t + 1));
      const b = randomRoot(rnd, `b${t}`, 1000 * (t + 1) + 300);
      const aRun = mkRun(a);
      const bRun = mkRun({ ...b, pool: [...a.pool.slice(0, 2).map((p) => ({ ...p, provisional: rnd() > 0.5 })), ...b.pool] });
      pairs.push([aRun, bRun]);
    }
    pairs.push([mkRun(handParentSpec), mkRun(handParentSpec)]);
    pairs.push([
      mkRun(handParentSpec),
      mkRun({
        ...handParentSpec,
        id: 'B',
        pool: handParentSpec.pool.map((p) => (p.id === Y ? { ...p, aspects: { technical: 40, behavior: 25.5 } } : p)),
        stored: undefined,
      }),
    ]);
    for (const [a, b] of pairs) {
      const one = explainComparison(compareRuns(a, b));
      const two = explainComparison(compareRuns(a, b));
      assert.deepEqual(one.summary, two.summary);
      assert.deepEqual([...one.perCandidate], [...two.perCandidate]);
      for (const x of [...one.summary, ...[...one.perCandidate.values()].flat()]) seen.add(x.id);
    }
    assert.deepEqual([...seen].sort(), [...EXPLANATION_IDS].sort(), 'every template is reachable');
  });
});

// ── Configuration side by side, with origins (FR-CMP-04, FR-SN-01, I-3) ─────

describe('TC-CMP-CFG: every configuration item says where its value came from', () => {
  const frozen = (over: Record<string, unknown> = {}) => ({
    version: 1,
    ahp: {
      source: 'own',
      weights: { technical: 0.25, career: 0.05, behavior: 0.35, performance: 0.1, hav: 0.2, education: 0.05 },
      pairwise: null,
      activeCriteria: [...CRITERIA],
      droppedCriteria: [],
      weightSource: 'default',
      consistency: { cr: 0, lambdaMax: 6, ci: 0 },
    },
    anchors: { technical: { simFloor: 0.5, simCeil: 0.9, source: 'measured' }, career: null, depth: null, source: 'own' },
    referenceDate: '2026-09-01T03:00:00.000Z',
    referenceDateSource: 'run_start',
    ...over,
  });
  const snapshot = (templateSource: 'live' | 'inherited', rerun = false) => ({
    version: 1,
    templateSource,
    template: { filterTree: { kind: 'group', children: [] }, ruleCount: 0, enforceFilterRules: true },
    readiness: { thresholds: [{ minScore: 80, level: 'Ready Now' }], defaultLevel: 'Not Ready' },
    ...(rerun ? { rerun: { mode: 'incremental_add' } } : {}),
  });

  test('a root on the system default weights; its child inherits them — never "Bawaan sistem" twice', () => {
    const root = configViewFrom({ isChild: false, configSnapshot: snapshot('live'), runInfo: { frozen: frozen() }, filterSummary: {}, finalistCount: 6 });
    assert.equal(root.weightsOrigin, 'default');
    assert.equal(root.criteriaOrigin, 'root_snapshot');
    assert.equal(root.filter.origin, 'root_snapshot');
    assert.equal(root.readinessOrigin, 'root_snapshot');
    assert.equal(root.anchors.origin, 'root_snapshot');
    assert.equal(root.referenceDateOrigin, 'root_snapshot');
    const child = configViewFrom({
      isChild: true,
      configSnapshot: snapshot('inherited', true),
      runInfo: { frozen: frozen({ ahp: { ...frozen().ahp, source: 'parent', weightSource: 'inherited' }, anchors: { ...frozen().anchors, source: 'parent' }, referenceDateSource: 'parent_frozen' }) },
      filterSummary: {},
      finalistCount: 6,
    });
    for (const o of [child.weightsOrigin, child.criteriaOrigin, child.filter.origin, child.readinessOrigin, child.anchors.origin, child.referenceDateOrigin]) {
      assert.equal(o, 'frozen_parent');
    }
  });

  test('what an older parent did not record is a live fallback, and what nobody stored is "Tidak tersimpan"', () => {
    const child = configViewFrom({
      isChild: true,
      configSnapshot: snapshot('inherited', true),
      runInfo: { frozen: frozen({ ahp: { ...frozen().ahp, source: 'live_fallback', weightSource: 'ahp-matrix' }, anchors: { ...frozen().anchors, source: 'live_fallback' } }) },
      filterSummary: {},
      finalistCount: 6,
    });
    assert.equal(child.weightsOrigin, 'live_fallback');
    assert.equal(child.anchors.origin, 'live_fallback');
    const old = configViewFrom({ isChild: false, configSnapshot: null, runInfo: {}, filterSummary: {}, finalistCount: null });
    assert.equal(old.weightsOrigin, 'not_recorded');
    assert.equal(old.filter.origin, 'not_recorded');
    assert.equal(old.readinessOrigin, 'not_recorded');
    assert.equal(old.referenceDateOrigin, 'not_recorded');
    assert.equal(old.positionBasis, null);
  });

  test('the side-by-side items use the page formats and compare values, not labels', () => {
    const cmp = compareRuns(mkRun(handParentSpec), mkRun(handChildSpec));
    const item = (k: string) => cmp.config.find((x) => x.key === k)!;
    assert.equal(item('weight.technical').a, '60,00%');
    assert.equal(item('weight.technical').same, true);
    assert.equal(item('anchor.referenceDate').a, '2026-10-01 10:00');
    // The child's source reads "inherited" over the very vector the parent used.
    assert.equal(item('weight.source').a, 'Matriks perbandingan dari Tata Kelola');
    assert.equal(item('weight.source').b, 'Diwarisi dari run induk');
    assert.equal(item('weight.source').same, true);
    assert.equal(item('weight.source').originB, 'frozen_parent');
  });

  test('an item neither run stored reads "Tidak tercatat", never "Sama" (I-6)', () => {
    const cmp = compareRuns(mkRun(handParentSpec), mkRun(handChildSpec));
    const unrecorded = cmp.config.filter((x) => !x.recordedA && !x.recordedB);
    assert.ok(unrecorded.length > 0, 'the hand fixture stores no position basis, models or data versions');
    for (const x of unrecorded) assert.equal(configStatusLabel(x), 'Tidak tercatat', x.key);
    assert.equal(configStatusLabel({ same: false, recordedA: false, recordedB: true }), 'Tidak tercatat pada run A');
    assert.equal(configStatusLabel({ same: false, recordedA: true, recordedB: false }), 'Tidak tercatat pada run B');
    assert.equal(configStatusLabel({ same: true, recordedA: true, recordedB: true }), 'Sama');
    assert.equal(configStatusLabel({ same: false, recordedA: true, recordedB: true }), 'Berbeda');
  });

  test('a replay residual is written in Indonesian notation, not "1.2e-12"', () => {
    assert.equal(fmtTiny(0), '0');
    assert.equal(fmtTiny(1.23e-12), '1,2 × 10⁻¹²');
    assert.equal(fmtTiny(4e-10), '4,0 × 10⁻¹⁰');
  });
});

// ── Serialisation and structure guards ──────────────────────────────────────

describe('TC-CMP-XLSX: the export keeps numbers as numbers (FR-CMP-12)', () => {
  test('eight sheets in the documented order; closeness, weights, CR and N are numbers', () => {
    // The hand fixture records no CR; give both runs one, as an AHP run does.
    const withCr = (r: RunRecord): RunRecord => ({ ...r, config: { ...r.config, consistency: { cr: 0.0123, lambdaMax: 6.06, ci: 0.012 } } });
    const cmp = compareRuns(withCr(mkRun(handParentSpec)), withCr(mkRun(handChildSpec)));
    const sheets = buildComparisonSheets(toComparisonDto(cmp, explainComparison(cmp)), 'POSISI UJI');
    assert.deepEqual(
      sheets.map((x) => x.name),
      ['Ringkasan', 'Konfigurasi', 'Pool', 'Peringkat', 'Kriteria', 'Rincian kandidat', 'Kalimat penjelasan', 'Atribusi'],
    );
    const sheet = (n: string) => sheets.find((x) => x.name === n)!.rows;
    const peringkat = sheet('Peringkat');
    const col = (h: string) => peringkat[0]!.indexOf(h);
    for (const row of peringkat.slice(1)) {
      for (const h of ['Kecocokan A', 'Kecocokan B']) {
        const v = row[col(h)];
        assert.ok(v === null || typeof v === 'number', `${h} must be a number or empty, got ${JSON.stringify(v)}`);
      }
    }
    const konf = sheet('Konfigurasi');
    const item = (label: string) => konf.find((r) => r[1] === label)!;
    assert.equal(typeof item('Bobot nominal Kompetensi Teknis')[2], 'number');
    assert.equal(item('Rasio konsistensi (CR)')[4], 0.0123);
    assert.equal(typeof item('Jumlah finalis (N)')[2], 'number');
    // A label stays a label.
    assert.equal(typeof item('Sumber bobot')[2], 'string');
    // No numeric value hides in a formatted string ("25,00%").
    for (const r of konf) for (const v of r) if (typeof v === 'string') assert.doesNotMatch(v, /^[-+−]?\d+(,\d+)?%$/, `formatted number in Konfigurasi: ${v}`);
  });
});

describe('TC-CMP-DTO: the comparison crosses the server boundary intact', () => {
  test('no Map or Set survives into the DTO; a JSON round trip changes nothing', () => {
    const cmp = compareRuns(mkRun(handParentSpec), mkRun(handChildSpec));
    const dto = toComparisonDto(cmp, explainComparison(cmp));
    assert.deepEqual(JSON.parse(JSON.stringify(dto)), dto);
    assert.equal(dto.breakdowns.length, 4);
    assert.equal(dto.attribution!.length, 4);
    assert.ok(dto.explanations.perCandidate[Z]!.length === 1);
  });
});

describe('TC-CMP-STRUCT: one TOPSIS, no model, no recomputed aspect (I-7, FR-CMP-13)', () => {
  test('the comparison modules hold no copy of the formula and import nothing that reads a model', () => {
    for (const f of ['lib/run-compare.ts', 'lib/run-compare-explain.ts', 'lib/run-compare-format.ts', 'lib/run-compare-export.ts']) {
      const s = src(f);
      assert.doesNotMatch(s, /Math\.sqrt|Math\.hypot/, `${f} must not compute TOPSIS itself`);
      assert.doesNotMatch(s, /from ['"][^'"]*(llm|gemini|openai|langchain|embed|db)['"/]/i, `${f} must not reach a model or the database`);
    }
    assert.match(src('lib/run-compare.ts'), /from '\.\.\/scoring-service\/src\/topsis-ranking'/);
    // The panel on a run page is the compact view of the same comparison, not a
    // second diff engine (FR-CMP, "jangan membuat duplikatnya").
    assert.match(src('components/analysis/rank-shift-panel.tsx'), /getRunShiftAction/);
    assert.doesNotMatch(src('components/analysis/rank-shift-panel.tsx'), /run-diff/);
  });

  test('the shared engine files stay dependency-free, so the web build can include them', () => {
    for (const f of ['scoring-service/src/topsis-ranking.ts', 'scoring-service/src/topsis.ts', 'scoring-service/src/ahp-criteria.ts']) {
      const imports = [...src(f).matchAll(/^import[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
      for (const i of imports) assert.ok(i === './ahp-criteria' || i === './topsis', `${f} imports ${i}`);
      assert.match(src('.dockerignore'), new RegExp(`!${f.replace(/[.]/g, '\\.')}`), `${f} is whitelisted for the web build`);
    }
  });

  test('the engine ranks with the shared function, not a copy of it', () => {
    const engine = src('scoring-service/src/ahp-topsis-engine.ts');
    assert.match(engine, /from "\.\/topsis-ranking\.js"/);
    assert.doesNotMatch(engine, /export function rankCandidatesByTopsis/);
  });
});

describe('TC-CMP-OVERVIEW: the summary tiles read the same comparison as the tables', () => {
  test('the hand fixture: W joins, takes rank 1, and pushes Y out of the top N', () => {
    const cmp = compareRuns(mkRun(handParentSpec), mkRun(handChildSpec));
    const dto = toComparisonDto(cmp, explainComparison(cmp));
    const f = overviewFacts(dto);
    assert.equal(f.topA, 'Z');
    assert.equal(f.topB, 'W');
    assert.equal(f.poolA, 3);
    assert.equal(f.poolB, 4);
    assert.equal(f.comparison, 1);
    assert.equal(f.comparisonInTopN, 1);
    // Z, Y and X are in both runs and each moved down one place.
    assert.equal(f.moved, 3);
    assert.equal(f.movedFinalists, 2);
    // W went straight into the top N — it counts as an entry, and as a comparison candidate.
    assert.equal(f.entered, 1);
    assert.equal(f.enteredComparison, 1);
    assert.equal(f.left, 1);
    assert.equal(f.nA, 2);
    assert.equal(f.nB, 2);
    assert.deepEqual(f.differing.map((d) => d.key), ['S1']);
    // The tiles and the table agree: every entry and exit is a row of the table.
    assert.equal(f.entered + f.nA - f.left, f.nB);
  });

  test('a run against itself has nothing to report', () => {
    const r = mkRun(handParentSpec);
    const cmp = compareRuns(r, mkRun({ ...handParentSpec, id: 'P2' }));
    const f = overviewFacts(toComparisonDto(cmp, explainComparison(cmp)));
    assert.equal(f.moved, 0);
    assert.equal(f.entered, 0);
    assert.equal(f.left, 0);
    assert.equal(f.topA, f.topB);
  });
});
