// ── Why two runs differ, in sentences built from numbers (FR-CMP-09) ──
//
// Every sentence here is a TEMPLATE filled with facts `compareRuns` computed —
// no model writes or chooses any of it, and an LLM narrative stored on a run is
// never a source (FR-RR-14). The same comparison therefore always yields the
// same sentences (NF-2). The catalog, its examples and the thresholds below are
// documented in docs/rerun-explanation-templates.md; keep the two in step.
//
//   T-01  no numeric change at all
//   T-02  a candidate now holds the highest value of a criterion (ideal +)
//   T-03  a candidate now holds the lowest value of a criterion (ideal −)
//   T-04  a criterion's normalisation divisor moved r times
//   T-05  per candidate: rank movement and its two largest contributors
//   T-06  the weights changed (between roots)
//   T-07  aspect values of candidates in both runs changed
//   T-08  the pool's membership changed, with why
//   T-09  the active criteria differ, so weights were redistributed (Pers. 2.12)
//   T-10  summary: data / set changes vs configuration / judgement changes
//   T-11  the provisional flag differs

import { CRITERIA, CRITERION_LABEL, type Comparison, type CriterionKey } from './run-compare';
import { fmtAspect, fmtCloseness, fmtNumber, fmtPp, fmtWeight } from './run-compare-format';

export type ExplanationId =
  | 'T-01' | 'T-02' | 'T-03' | 'T-04' | 'T-05' | 'T-06'
  | 'T-07' | 'T-08' | 'T-09' | 'T-10' | 'T-11';

export type Explanation = { id: ExplanationId; text: string; candidateId?: string };

/** Below these, a change is real but not worth a sentence. */
export const MENTION_THRESHOLDS = {
  /** |closeness change| below this is "no change" (T-01): the stored precision. */
  closeness: 5e-7,
  /** |divisor ratio − 1| below this is not named (T-04): 0,5%. */
  divisorRatio: 0.005,
  /** Effective-weight changes below this many percentage points are not named (T-06). */
  weightPp: 0.005,
  /**
   * Aspect changes below this many points (0..100 scale) are not named (T-07),
   * and an extreme that moved less than this is not "taken over" (T-02/T-03).
   */
  aspect: 0.05,
  /**
   * A criterion is named as a contributor (T-05) only when its change in
   * squared distance |Δ(v−ideal)²| is at least this share of the candidate's
   * D⁺² + D⁻² in B. Squared weighted distances are small numbers (typically
   * 1e-5…1e-3), so an absolute cut-off would hide nearly everything; a share
   * says whether the criterion mattered to THIS candidate.
   */
  contributionShare: 0.01,
  /** Cap on names listed in one sentence before "dan N lainnya". */
  listCap: 5,
} as const;

/**
 * "a", "a dan b", "a, b, dan c", "a, b, c, d, e, dan 3 lainnya". Items that
 * carry decimal commas (id-ID) are joined with "; " instead, so "70,0" never
 * reads as two list items.
 */
function list(xs: string[], opts: { cap?: number; sep?: ', ' | '; ' } = {}): string {
  const cap = opts.cap ?? MENTION_THRESHOLDS.listCap;
  const sep = opts.sep ?? ', ';
  if (xs.length > cap) return `${xs.slice(0, cap).join(sep)}${sep}dan ${xs.length - cap} lainnya`;
  if (xs.length <= 1) return xs.join('');
  if (xs.length === 2) return `${xs[0]} dan ${xs[1]}`;
  return `${xs.slice(0, -1).join(sep)}${sep}dan ${xs[xs.length - 1]}`;
}

/** Lower-case the first letter only — a reason may name "run A" / "run B". */
const lcFirst = (x: string) => x.charAt(0).toLowerCase() + x.slice(1);

/**
 * How one criterion moved a candidate between A and B, from the change in its
 * squared distance to the best (ideal +) and to the worst (ideal −) value.
 * Closeness rises when the first shrinks and the second grows; when both
 * shrink (or both grow) the criterion's spread narrowed (widened) — that is
 * the normalisation, not the candidate.
 */
export function contributionPhrase(dPlus: number, dMinus: number): string {
  const p = Math.sign(dPlus);
  const m = Math.sign(dMinus);
  if (p > 0 && m < 0) return 'menurunkan kecocokan: lebih jauh dari nilai tertinggi dan lebih dekat ke nilai terendah';
  if (p < 0 && m > 0) return 'menaikkan kecocokan: lebih dekat ke nilai tertinggi dan lebih jauh dari nilai terendah';
  if (p < 0 && m < 0) return 'selisih pada kriteria ini menyempit: lebih dekat ke nilai tertinggi maupun terendah';
  if (p > 0 && m > 0) return 'selisih pada kriteria ini melebar: lebih jauh dari nilai tertinggi maupun terendah';
  if (p > 0) return 'menurunkan kecocokan: lebih jauh dari nilai tertinggi';
  if (p < 0) return 'menaikkan kecocokan: lebih dekat ke nilai tertinggi';
  if (m < 0) return 'menurunkan kecocokan: lebih dekat ke nilai terendah';
  return 'menaikkan kecocokan: lebih jauh dari nilai terendah';
}

export function explainComparison(c: Comparison): {
  summary: Explanation[];
  perCandidate: Map<string, Explanation[]>;
} {
  const summary: Explanation[] = [];
  const perCandidate = new Map<string, Explanation[]>();
  const nameOf = new Map(c.ranking.map((r) => [r.candidateId, r.name]));
  const nm = (id: string) => nameOf.get(id) ?? id;
  const src = new Map(c.sources.map((s) => [s.key, s]));
  const poolA = new Map(c.a.pool.map((p) => [p.candidateId, p]));
  const poolB = new Map(c.b.pool.map((p) => [p.candidateId, p]));
  const childPair = c.relation.kind === 'b_child_of_a' && c.b.rerunMode === 'incremental_add';

  // T-10 — the sources, grouped the way the forum reads them.
  const dataSide = (['S1', 'S3', 'S4'] as const).filter((k) => src.get(k)!.differs).map((k) => src.get(k)!.label.toLowerCase());
  const configSide = (['S2', 'S5'] as const).filter((k) => src.get(k)!.differs).map((k) => src.get(k)!.label.toLowerCase());
  if (dataSide.length + configSide.length === 0) {
    summary.push({
      id: 'T-10',
      text: 'Tidak ada sumber perubahan: pool, bobot, nilai aspek, penyesuaian, dan konfigurasi penyajian A dan B sama.',
    });
  } else {
    const parts: string[] = [];
    if (dataSide.length) parts.push(`perubahan data atau himpunan (${list(dataSide)})`);
    if (configSide.length) parts.push(`perubahan konfigurasi atau pertimbangan (${list(configSide)})`);
    summary.push({ id: 'T-10', text: `Perbedaan A dan B bersumber dari ${parts.join(' dan ')}.` });
  }

  // T-01 — nothing numeric moved.
  const inBoth = c.ranking.filter((r) => r.membership === 'both');
  const anyMove =
    c.ranking.some((r) => r.membership !== 'both') ||
    inBoth.some((r) => r.deltaRank !== 0 || Math.abs((r.ccB ?? 0) - (r.ccA ?? 0)) > MENTION_THRESHOLDS.closeness);
  if (!anyMove) {
    summary.push({
      id: 'T-01',
      text: `Tidak ada perubahan angka: peringkat dan kecocokan setiap kandidat sama di A dan B${
        childPair ? ', karena semua kandidat yang diminta sudah ada di pool induk' : ''
      }.`,
    });
  }

  // T-08 — membership, with why where the stored data can say.
  const added = c.ranking.filter((r) => r.membership === 'only_b');
  const removed = c.ranking.filter((r) => r.membership === 'only_a');
  if (added.length + removed.length > 0) {
    const describe = (rs: typeof added) =>
      list(
        rs.map((r) => (r.membershipReason ? `${r.name} (${lcFirst(r.membershipReason)})` : r.name)),
        { sep: '; ' },
      );
    const bits: string[] = [];
    if (added.length) bits.push(`+${added.length} di B: ${describe(added)}`);
    if (removed.length) bits.push(`−${removed.length} dari A: ${describe(removed)}`);
    summary.push({ id: 'T-08', text: `Keanggotaan pool berubah — ${bits.join('; ')}.` });
  }

  // T-06 — weights; T-09 — active criteria.
  const weightBits = c.criteria
    .filter((r) => r.weightA != null && r.weightB != null && Math.abs(r.deltaWeightPp ?? 0) >= MENTION_THRESHOLDS.weightPp)
    .map((r) => `${r.label} ${fmtWeight(r.weightA!)} → ${fmtWeight(r.weightB!)} (${fmtPp(r.deltaWeightPp!, 2)})`);
  if (weightBits.length) {
    summary.push({ id: 'T-06', text: `Bobot efektif berubah: ${list(weightBits, { cap: CRITERIA.length, sep: '; ' })}.` });
  }
  const activeDiff = c.criteria.filter((r) => r.activeA !== r.activeB);
  if (activeDiff.length) {
    summary.push({
      id: 'T-09',
      text: `Kriteria aktif berbeda: ${list(
        activeDiff.map((r) => `${r.label} ${r.activeA ? 'aktif di A tetapi dibuang di B' : 'dibuang di A tetapi aktif di B'}`),
        { cap: CRITERIA.length, sep: '; ' },
      )}, sehingga bobotnya dibagi ulang di antara kriteria yang aktif (Pers. 2.12).`,
    });
  }

  // T-07 — aspect values of candidates both runs scored.
  const aspectBits: string[] = [];
  for (const r of inBoth) {
    const pa = poolA.get(r.candidateId)!;
    const pb = poolB.get(r.candidateId)!;
    const keys = r.aspectsChanged.filter((k) => Math.abs(pb.aspects[k] - pa.aspects[k]) >= MENTION_THRESHOLDS.aspect);
    if (keys.length === 0) continue;
    aspectBits.push(
      `${r.name}: ${keys.map((k) => `${CRITERION_LABEL[k]} ${fmtAspect(pa.aspects[k])} → ${fmtAspect(pb.aspects[k])}`).join(', ')}`,
    );
  }
  if (aspectBits.length) {
    summary.push({
      id: 'T-07',
      text: `Nilai aspek ${aspectBits.length} kandidat berubah — ${list(aspectBits, { sep: '; ' })}.`,
    });
  }

  // T-11 — the provisional flag.
  const provBits: string[] = [];
  for (const r of inBoth) {
    const pa = poolA.get(r.candidateId)!;
    const pb = poolB.get(r.candidateId)!;
    if (pa.provisional !== pb.provisional) {
      provBits.push(
        `${r.name} (${pa.provisional ? 'sementara di A' : 'terukur di A'}, ${pb.provisional ? 'sementara di B' : 'terukur di B'})`,
      );
    }
  }
  if (provBits.length) {
    summary.push({
      id: 'T-11',
      text: `Penanda skor sementara berbeda untuk ${provBits.length} kandidat: ${list(provBits, { sep: '; ' })}.`,
    });
  }

  // T-02 / T-03 — a candidate now holds the best / worst value of a criterion
  // and that value MOVED (joining the holders of an unchanged extreme moves no
  // ideal and explains nothing); T-04 — divisors, grouped by direction.
  const onlyB = new Set(added.map((r) => r.candidateId));
  const divisorUp: string[] = [];
  const divisorDown: string[] = [];
  for (const row of c.criteria) {
    if (!row.activeA || !row.activeB) continue;
    for (const [side, id] of [['pos', 'T-02'], ['neg', 'T-03']] as const) {
      const ia = side === 'pos' ? row.idealPosA : row.idealNegA;
      const ib = side === 'pos' ? row.idealPosB : row.idealNegB;
      if (!ia || !ib) continue;
      if (Math.abs(ib.raw - ia.raw) < MENTION_THRESHOLDS.aspect) continue;
      const fresh = ib.holders.filter((h) => !ia.holders.includes(h));
      if (fresh.length === 0) continue;
      const tagged = fresh.map((h) => ({ name: nm(h), comparison: childPair && onlyB.has(h) }));
      const who =
        tagged.length === 1
          ? tagged[0]!.comparison
            ? `${tagged[0]!.name}, kandidat pembanding,`
            : tagged[0]!.name
          : list(tagged.map((t) => (t.comparison ? `${t.name} (kandidat pembanding)` : t.name)));
      const word = side === 'pos' ? 'nilai tertinggi' : 'nilai terendah';
      summary.push({
        id,
        text: `${who} kini memegang ${word} ${row.label} (${fmtAspect(ib.raw)}; sebelumnya ${fmtAspect(ia.raw)} milik ${list(ia.holders.map(nm))}).`,
      });
    }
    if (row.divisorRatio != null && Math.abs(row.divisorRatio - 1) >= MENTION_THRESHOLDS.divisorRatio) {
      (row.divisorRatio > 1 ? divisorUp : divisorDown).push(`${row.label} (${fmtNumber(row.divisorRatio, 2)} kali)`);
    }
  }
  for (const [xs, up] of [[divisorUp, true], [divisorDown, false]] as const) {
    if (xs.length === 0) continue;
    summary.push({
      id: 'T-04',
      text: `Pembagi normalisasi ${up ? 'naik' : 'turun'} pada ${list(xs, { cap: CRITERIA.length })}, sehingga selisih pada ${
        xs.length > 1 ? 'kriteria-kriteria' : 'kriteria'
      } itu menyumbang lebih ${up ? 'kecil' : 'besar'} terhadap jarak.`,
    });
  }

  // T-05 — per candidate whose rank moved or whose finalist status changed.
  for (const r of inBoth) {
    const moved = (r.deltaRank ?? 0) !== 0;
    const finalistMoved = r.finalistChange === 'masuk' || r.finalistChange === 'keluar';
    if (!moved && !finalistMoved) continue;
    const b = c.breakdowns.get(r.candidateId);
    const scale = b?.b ? b.b.dPlus ** 2 + b.b.dMinus ** 2 : 0;
    const contributors = (b?.topMovers ?? []).filter((k) => {
      const d = b!.delta.get(k)!;
      return scale > 0 && (Math.abs(d.contribPlus) + Math.abs(d.contribMinus)) / scale >= MENTION_THRESHOLDS.contributionShare;
    });
    const describeCrit = (k: CriterionKey) => {
      const d = b!.delta.get(k)!;
      return `${CRITERION_LABEL[k]} (${contributionPhrase(d.contribPlus, d.contribMinus)})`;
    };
    const head = moved
      ? `Peringkat ${r.name} ${r.deltaRank! > 0 ? 'naik' : 'turun'} ${Math.abs(r.deltaRank!)} tingkat, dari ${r.rankA} ke ${r.rankB}`
      : `Peringkat ${r.name} tetap ${r.rankB}`;
    const cc =
      r.ccA != null && r.ccB != null
        ? ` (kecocokan ${fmtCloseness(r.ccA)} → ${fmtCloseness(r.ccB)}, ${fmtPp(r.deltaPp!)})`
        : '';
    const fin =
      r.finalistChange === 'masuk' ? ' dan kini masuk N besar' : r.finalistChange === 'keluar'
        ? r.leftCause === 'overtaken_by_comparison'
          ? ' dan kini keluar dari N besar karena disalip kandidat pembanding'
          : r.leftCause === 'pool_shift'
            ? ' dan kini keluar dari N besar karena skala pool bergeser'
            : ' dan kini keluar dari N besar'
        : '';
    const why = contributors.length ? ` Penyumbang terbesar: ${contributors.map(describeCrit).join('; ')}.` : '';
    perCandidate.set(r.candidateId, [{ id: 'T-05', candidateId: r.candidateId, text: `${head}${cc}${fin}.${why}` }]);
  }

  return { summary, perCandidate };
}

/** Every template id, for the catalog test. */
export const EXPLANATION_IDS: ExplanationId[] = [
  'T-01', 'T-02', 'T-03', 'T-04', 'T-05', 'T-06', 'T-07', 'T-08', 'T-09', 'T-10', 'T-11',
];
