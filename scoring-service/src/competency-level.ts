// The competency-matching cell value — the ONE implementation, used by
// ahp-topsis-engine.ts for the technical aspect (and the career fallback, which
// uses the very same matcher).
//
// It was split out when the removed LLM "AI Tournament" had a second copy of the
// formula in its evidence builder, and the two had already drifted: that copy
// computed only the over-qualification surplus, so an exact-name match whose
// level sat BELOW the requirement scored a full 1.0 there while the AHP engine
// gave it a ratio.
//
// It imports nothing at all, so it can never participate in a cycle. The
// similarity anchors are PASSED IN rather than read from config, because they
// are derived from the kamus corpus and change with it (technical-anchors.ts).


/**
 * How far the shortfall penalty is spread. A gap of g levels costs g/SPAN.
 *
 * SPAN 4 over a 1..4 ladder means the maximum possible shortfall (level 1
 * against a Mastery requirement) still keeps a quarter of the credit, because
 * holding the competency three levels short is NOT the same as not holding it:
 * the candidate demonstrably has the thing the job asked for, just not enough of
 * it. A span of 3 would zero that case out, which reads as "does not have it"
 * and — before identity pairing was separated out — also let Hungarian discard
 * the pair entirely, since a 0 cell has no pull in a sum-maximising assignment.
 *
 * Tunable because it is a policy number, not a measured one.
 */
export const LEVEL_GAP_SPAN = Math.max(
  1,
  parseFloat(process.env.TECHNICAL_LEVEL_GAP_SPAN || "4")
);

/**
 * How much an IDENTITY pair can earn above 1.0 for exceeding the required level,
 * spread over the maximum gap (3 steps on a 1..4 ladder). The ceiling is
 * therefore `1 + SURPLUS`, reached exactly at Basic-requirement vs Mastery-held.
 *
 * Raised from 0.25 (ceiling 1.25) to 0.75 (ceiling 1.75) as a deliberate policy
 * change: at +25% a candidate three levels clear of the requirement was worth
 * barely more than one who merely met it, so depth of mastery hardly showed in
 * the Technical score. At +75% exceeding the bar is worth roughly what a whole
 * additional met requirement is.
 *
 * Two consequences worth knowing before tuning this further. It applies ONLY to
 * identity pairs (same competency by name or kamus code) — a similarity pair
 * stays capped at 1.0, so raising it also widens the gap between really holding
 * a competency and merely resembling it. And because Hungarian maximises the
 * SUM, a larger surplus makes an over-levelled identity cell pull harder in the
 * assignment; identity is settled before Hungarian runs, so it cannot steal
 * another column's correct pairing, but it does raise what a surplus cell is
 * worth relative to covering an extra requirement.
 *
 * A policy number, not a measured one — hence tunable.
 */
export const OVER_QUALIFICATION_SURPLUS = Math.max(
  0,
  parseFloat(process.env.TECHNICAL_OVERQUALIFICATION_SURPLUS || "0.75")
);

/** The maximum level factor an identity pair can reach (`1 + SURPLUS`). */
export const LEVEL_FACTOR_CEILING = 1 + OVER_QUALIFICATION_SURPLUS;

/**
 * The level term. `c` = level the candidate holds, `r` = level the job demands.
 * ONE shape for every pairing, identity and similarity alike:
 *
 *   c ≥ r → met or exceeded. An IDENTITY pair (same competency, established by
 *           name or by kamus code) earns a bounded over-qualification surplus
 *           (+OVER_QUALIFICATION_SURPLUS spread over the max gap, ceiling
 *           1 + that — currently 1.75). A SIMILARITY pair is capped at 1.0:
 *           exceeding the target on a competency the job did not actually ask
 *           for is not a surplus worth paying for, and the cap keeps identity
 *           strictly ahead of mere resemblance.
 *   c < r → 1 − (r−c)/SPAN. Level is an ordinal ladder (Basic → Intermediate →
 *           Advance → Mastery), so only the DIFFERENCE is meaningful — the same
 *           reading the cumulative level embeddings are built on (level L =
 *           descriptors 1..L accumulated). A ratio (c/r) would instead assert
 *           that Mastery is "twice" Intermediate, which the kamus never claims.
 *
 * `levelKnown === false` yields 1 — neutral. An unreadable proficiency (NULL /
 * "#N/A" / "NOT ASSESSED") must not become a competency finding: on this
 * deployment ~17% of candidate_technical_competencies rows are unreadable, and
 * scoring them as level 1 would report a shortfall the data never claimed.
 */
export function competencyLevelFactor(
  candLevel: number,
  reqLevel: number,
  isIdentity: boolean,
  levelKnown: boolean
): number {
  if (!levelKnown) return 1;
  const r = Math.max(1, reqLevel);
  if (candLevel >= r) {
    return isIdentity
      ? Math.min(
          1 + (OVER_QUALIFICATION_SURPLUS * (candLevel - r)) / 3,
          LEVEL_FACTOR_CEILING
        )
      : 1;
  }
  return Math.max(0, 1 - (r - candLevel) / LEVEL_GAP_SPAN);
}

/**
 * Stretch a raw competency cosine onto a true 0..1 with the corpus anchors —
 * below `simFloor` there is no evidence of coverage, at or above `simCeil` the
 * two competencies are effectively the same.
 *
 * A raw cosine is not a percentage. Measured over this dictionary's full census
 * (90 competencies × 4 levels, nomic-embed-text-v2-moe), every competency has
 * some OTHER competency sitting at ~0.72–0.86, and Hungarian maximises — so the
 * raw value handed a wholly wrong pairing 72–86 points out of 100.
 *
 * The anchors are NOT constants: they describe one corpus, so they are
 * recomputed whenever that corpus changes (see technical-anchors.ts). They are
 * passed in rather than read from module state because two runs can execute
 * concurrently in one process, and a run must score against one fixed pair of
 * anchors from start to finish.
 *
 * Degenerate anchors (ceil <= floor) fall back to the raw value clamped, so a
 * misconfiguration cannot silently zero the whole criterion.
 */
export function rescaleTechnicalSimilarity(
  raw: number,
  anchors: { simFloor: number; simCeil: number }
): number {
  const { simFloor, simCeil } = anchors;
  if (!(simCeil > simFloor)) return Math.max(0, Math.min(1, raw));
  return Math.max(0, Math.min(1, (raw - simFloor) / (simCeil - simFloor)));
}
