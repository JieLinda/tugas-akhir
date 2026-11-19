/**
 * The exact-match education tier — recorded, or re-derived deterministically.
 *
 * WHY THIS EXISTS. `educationDetail.exactComparison` only started being written
 * recently, so every earlier run showed "tingkatan tidak tercatat" and its score
 * could not be explained by the rule that produced it. Inferring the tier from
 * the SCORE is unsound: the tier table (100/80/50) replaced a single flat
 * `EDUCATION_EXACT_MATCH_SCORE`, and stored legacy values collide with tier
 * values — this deployment has exact-match rows at 90 while the env default is
 * now 100, which would be mislabelled as the `higher` tier.
 *
 * But the comparison itself never needed the score. It is a pure function of the
 * candidate's education string and the requirement string, both of which ARE
 * stored on every run. So the tier is re-derived from those instead, and every
 * run — old and new — is explained by the same rule.
 *
 * MIRRORS `exactEducationMatch` in `scoring-service/src/ahp-topsis-engine.ts`
 * (separate deployables, no shared lib). If the level ranks, the stopword list,
 * or the "minimum" phrasing test change there, change them here too — a drift
 * would make this page describe a tier the engine did not apply.
 */

/**
 * Canonical education-level ranks (higher = more advanced). Synonyms folded in.
 *
 * D4 shares S1's rank on purpose: both sit at KKNI level 6, so "D4" against an
 * "S1" requirement is an EQUAL match, not a shortfall. Leaving it at 7 sent every
 * D4 holder down the LLM path against the ~60 job profiles that ask for S1.
 * Rank 7 is now unused; the numbers are ordinal comparators, so a gap costs
 * nothing and records that the promotion was deliberate.
 *
 * English labels are here because that is what this deployment's HR source
 * actually stores — `SENIOR HIGH SCHOOL`, `JUNIOR HIGH SCHOOL`,
 * `ELEMENTARY SCHOOL`. Without them those candidates rank 0, which fails the
 * level test and pushes every one of them to the LLM scorer.
 *
 * `sederajat` is deliberately NOT here. It is a modifier ("SMA/SMK sederajat"),
 * already a stopword, and giving it rank 3 was a trap: "Minimal S1 atau
 * sederajat" yielded ranks [8,3], and the minimum branch takes the LOWEST — so an
 * SMA holder would satisfy an S1 requirement. Dropping it is safe because the
 * levels it accompanies are always spelled out beside it.
 */
const EDU_LEVEL_RANK: Record<string, number> = {
  sd: 1, elementary: 1,
  smp: 2, sltp: 2, mts: 2,
  sma: 3, smk: 3, slta: 3, stm: 3, man: 3, smea: 3, aliyah: 3,
  d1: 4,
  d2: 5,
  d3: 6, diploma: 6, ahlimadya: 6,
  // d4 == s1 (KKNI level 6). Rank 7 intentionally left unused.
  d4: 8,
  s1: 8, sarjana: 8, bachelor: 8, strata1: 8,
  s2: 9, magister: 9, master: 9, pascasarjana: 9,
  s3: 10, doktor: 10, doctoral: 10, phd: 10,
};

/**
 * Split into lowercase alphanumeric tokens.
 *
 * Multi-word and punctuated forms are collapsed FIRST, because the next step
 * flattens punctuation to spaces and a phrase would then never key into
 * EDU_LEVEL_RANK. Each rule below is a form this deployment's data actually
 * contains:
 *   "S-1" / "S 1" / "S.1"  — 5 of 113 job profiles write it this way, and they
 *                            could not produce an exact match for ANY candidate.
 *   "AHLI MADYA"           — the `ahlimadya` key was unreachable without this.
 *   "SARJANA TERAPAN"      — the formal name of D4.
 *   English school names   — what the HR source stores for the school levels.
 */
function eduTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/strata\s*([123])/g, "strata$1")
    // \b on BOTH sides is load-bearing. Without the leading boundary any word
    // ending in s or d followed by a digit loses its last letter: "Kelas 3"
    // would become "Kela" + "s3" and inject a doctorate-level rank.
    .replace(/\b([sd])\s*[-.]?\s*([1234])\b/g, "$1$2")
    .replace(/ahli\s*madya/g, "ahlimadya")
    .replace(/sarjana\s*terapan/g, "d4")
    .replace(/senior\s*high\s*school/g, "sma")
    .replace(/junior\s*high\s*school/g, "smp")
    .replace(/vocational\s*(?:high\s*)?school/g, "smk")
    .replace(/elementary\s*school/g, "sd")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Canonical rank of a candidate's education-level string (0 = unknown). */
function candidateLevelRank(education: string | null | undefined): number {
  let best = 0;
  for (const tok of eduTokens(education ?? '')) {
    const r = EDU_LEVEL_RANK[tok];
    if (r && r > best) best = r;
  }
  return best;
}

export type EduTier = 'higher' | 'equal' | 'lower';

/** The one rule, in one place. */
export const EDU_TIER_SCORE: Record<EduTier, number> = { higher: 100, equal: 80, lower: 50 };

export const EDU_TIER_LABEL: Record<EduTier, string> = {
  higher: 'jenjang kandidat LEBIH TINGGI dari yang disyaratkan',
  equal: 'jenjang kandidat SETARA dengan yang disyaratkan',
  lower: 'jenjang kandidat LEBIH RENDAH dari yang disyaratkan',
};

export type EduTierInfo = {
  tier: EduTier | null;
  /**
   * recorded       — the run stored it.
   * derived        — recomputed here from education vs requirement.
   * undeterminable — neither side states a recognisable level, so no comparison
   *                  exists. Not the same as "not recorded".
   */
  basis: 'recorded' | 'derived' | 'undeterminable';
  /** What the tier rule says the score should be. */
  ruleScore: number | null;
  /**
   * True when the run's stored score differs from the rule. Only happens on runs
   * scored before the tiering existed, which used one flat value for every exact
   * match. Surfaced rather than corrected: the stored score is what actually fed
   * TOPSIS and produced the ranking, so rewriting it would make the page
   * disagree with the rank it explains.
   */
  deviates: boolean;
  candidateRank: number;
  requiredRank: number | null;
  /** Requirement phrased as a minimum ("minimal S1") rather than an exact level. */
  isMinimum: boolean;
};

/**
 * Resolve the tier for an exact-match education result. Returns null tier only
 * when no level comparison can be made at all.
 */
export function resolveEduTier(detail: {
  source: string;
  score: number;
  education: string | null;
  requirement: string | null;
  exactComparison?: EduTier | null;
}): EduTierInfo | null {
  if (detail.source !== 'exact-match') return null;

  const reqLower = (detail.requirement ?? '').toLowerCase();
  const isMinimum = /\b(minimal|min|setidaknya|paling\s*rendah)\b/.test(reqLower);
  const reqRanks = eduTokens(detail.requirement ?? '')
    .map((t) => EDU_LEVEL_RANK[t])
    .filter((r): r is number => Boolean(r));
  const candRank = candidateLevelRank(detail.education);
  const requiredRank = reqRanks.length > 0 ? (isMinimum ? Math.min(...reqRanks) : reqRanks[0]!) : null;

  const build = (tier: EduTier | null, basis: EduTierInfo['basis']): EduTierInfo => ({
    tier,
    basis,
    ruleScore: tier ? EDU_TIER_SCORE[tier] : null,
    deviates: tier ? EDU_TIER_SCORE[tier] !== detail.score : false,
    candidateRank: candRank,
    requiredRank,
    isMinimum,
  });

  if (detail.exactComparison) return build(detail.exactComparison, 'recorded');

  // Re-derive, exactly as the engine would have. A match reached this path only
  // because the level was satisfied, so `lower` cannot arise from the minimum
  // branch — it is reachable only when the requirement names an exact level the
  // candidate sits below, which the engine treats as not matched at all. Kept
  // for completeness so the table below is the whole rule, not a subset.
  if (reqRanks.length === 0 || candRank === 0) return build(null, 'undeterminable');
  if (isMinimum) {
    const minRank = Math.min(...reqRanks);
    return build(candRank > minRank ? 'higher' : candRank === minRank ? 'equal' : 'lower', 'derived');
  }
  if (reqRanks.includes(candRank)) return build('equal', 'derived');
  const nearest = Math.min(...reqRanks);
  return build(candRank > nearest ? 'higher' : 'lower', 'derived');
}
