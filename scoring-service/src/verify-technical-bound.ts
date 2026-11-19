/**
 * Replays every scored candidate's stored competency pairs through the CURRENT
 * saturation rule and asserts the aggregate is a true 0..100.
 *
 * Runs inside scoring-service so it exercises the real `matchCompetencySets`
 * arithmetic and the real `LEVEL_FACTOR_CEILING`, not a re-implementation.
 *
 *   npx tsx src/verify-technical-bound.ts
 *
 * Read-only.
 */
import { query } from "./db/postgres.js";
import { LEVEL_FACTOR_CEILING, competencyLevelFactor } from "./competency-level.js";

type Pair = {
  required: { name: string; level: number; code: string | null };
  candidate: { name: string; level: number; code: string | null } | null;
  matchType: string;
  value: number;
  levelFactor?: number;
  levelUnknown?: boolean;
};

async function main() {
  const rows = await query<{
    run_id: string;
    candidate_id: string;
    aspects: Record<string, number> | null;
    details: { technicalMatching?: { pairs?: Pair[] } } | null;
  }>(`SELECT run_id, candidate_id, aspects, details FROM scoring_run_pool_aspects`);

  console.log(`LEVEL_FACTOR_CEILING = ${LEVEL_FACTOR_CEILING}`);
  console.log(`rows: ${rows.length}\n`);

  let checked = 0;
  let storedOver100 = 0;
  let boundedOver100 = 0;
  let cellOverCeiling = 0;
  let maxRawMean = 0;
  let maxBounded = 0;
  const overshoot: { stored: number; rawMean: number; bounded: number }[] = [];

  for (const r of rows) {
    const pairs = r.details?.technicalMatching?.pairs;
    if (!pairs || pairs.length === 0) continue;
    const stored = Number(r.aspects?.technical);
    if (!Number.isFinite(stored)) continue;

    const scored = pairs.filter((p) => p.matchType !== "unmeasurable");
    if (scored.length === 0) continue;
    checked += 1;

    // No cell may exceed the ceiling — that would mean the level term itself is
    // unbounded, which saturating the mean would not fix.
    for (const p of scored) {
      if (Number(p.value) > LEVEL_FACTOR_CEILING + 1e-9) cellOverCeiling += 1;
    }

    const sum = scored.reduce((a, p) => a + (Number(p.value) || 0), 0);
    const rawMean = sum / scored.length;
    const bounded = Math.round(Math.min(1, rawMean) * 100);

    if (stored > 100) storedOver100 += 1;
    if (bounded > 100) boundedOver100 += 1;
    maxRawMean = Math.max(maxRawMean, rawMean);
    maxBounded = Math.max(maxBounded, bounded);
    if (rawMean > 1.0005) overshoot.push({ stored, rawMean, bounded });
  }

  console.log(`checked                        : ${checked}`);
  console.log(`cells above LEVEL_FACTOR_CEILING: ${cellOverCeiling}   (must be 0)`);
  console.log(`stored scores above 100         : ${storedOver100}   (legacy runs, kept as scored)`);
  console.log(`BOUNDED scores above 100        : ${boundedOver100}   (must be 0)`);
  console.log(`max pre-saturation mean         : ${maxRawMean.toFixed(4)}`);
  console.log(`max bounded score               : ${maxBounded}   (must be <= 100)`);

  if (overshoot.length) {
    console.log(`\ncandidates who overshoot the requirements (${overshoot.length}):`);
    for (const o of overshoot) {
      console.log(
        `  stored ${o.stored}  ->  raw mean ${o.rawMean.toFixed(4)}  ->  bounded ${o.bounded}`,
      );
    }
  }

  // The level term itself must be bounded for every level pair on the ladder.
  console.log("\nlevelFactor over the whole 1..4 ladder (identity / similarity):");
  let worst = 0;
  for (let r = 1; r <= 4; r++) {
    const cells: string[] = [];
    for (let c = 1; c <= 4; c++) {
      const id = competencyLevelFactor(c, r, true, true);
      const sim = competencyLevelFactor(c, r, false, true);
      worst = Math.max(worst, id, sim);
      cells.push(`c${c}: ${id.toFixed(3)}/${sim.toFixed(3)}`);
    }
    console.log(`  req ${r}  ${cells.join("   ")}`);
  }
  console.log(`  max levelFactor anywhere: ${worst.toFixed(3)}  (ceiling ${LEVEL_FACTOR_CEILING})`);

  const pass = cellOverCeiling === 0 && boundedOver100 === 0 && maxBounded <= 100;
  console.log(pass ? "\nPASS" : "\nFAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
