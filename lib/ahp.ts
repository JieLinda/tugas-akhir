// AHP (Analytic Hierarchy Process) math for the web app.
//
// ONE implementation across both deployables: the formula lives in
// scoring-service/src/ahp.ts (the copy the engine scores with) and the Saaty
// scale + input validation in scoring-service/src/ahp-saaty.ts. Both are
// dependency-free, whitelisted in the web .dockerignore, and re-exported here
// so web callers keep importing from '@/lib/ahp'. This file used to carry a
// line-for-line duplicate of computeAhpWeights; drift between two copies of
// "what the weights are" and "what is allowed" is how the governance editor
// came to show 1 where the matrix held 1.25 (docs/ahp-input-sync.md).
//
// Client-safe: no server imports.

export {
  computeAhpWeights,
  isValidPairwise,
  pairwiseFromWeights,
  randomConsistencyIndex,
  RANDOM_INDEX,
  type AhpResult,
} from '../scoring-service/src/ahp';

export {
  AHP_CR_MAX,
  SAATY_SCALE,
  ahpInputCheck,
  describeAhpIssue,
  describeAhpValidation,
  isSaatyValue,
  offScaleUpperCells,
  reciprocalSaaty,
  saatyLabel,
  samePairwise,
  snapToSaaty,
  validateAhpPairwise,
  type AhpInputCheck,
  type AhpIssue,
  type AhpValidation,
} from '../scoring-service/src/ahp-saaty';

/** An n×n identity-preference matrix (all comparisons "equally important"). */
export function equalPairwise(n: number): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 1));
}
