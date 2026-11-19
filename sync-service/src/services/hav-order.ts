import { canonicalQuadrant, formulaQuadrant, splitPerformanceSlots } from "./hav-effective.js";

/**
 * When does a write count as a HAV EVENT — the kind that is timestamped and
 * that replaces an older Talent Mapping placement? Pure, so it is pinned by
 * tests/talent-mapping/hav-sync-order.test.ts; the writer is hav-supersede.ts.
 *
 * HR's rule (2026-11, docs/talent-mapping.md § "Perubahan PA/BA dan tier
 * formula") — the LAST event wins:
 *
 *   1. PA or BA edited on the Kandidat form          → formula   (web app)
 *   2. a PA/BA upload or sync that CHANGES the        → formula   (here)
 *      candidate's PA or BA
 *   3. Talent Mapping drag & drop                     → manual, until 1/2 again
 *   4. a HAV upload whose quadrant differs from the   → upload    (here)
 *      candidate's HAV before it
 *
 * 1 and 2 must win over an older UPLOAD too, so they also pin the automatic
 * tier (`candidates.hav_auto_tier = 'formula'`, drizzle/0098); 4 pins it back
 * to 'upload'. Mirrors lib/hav-effective.ts for what the pin means.
 */

export type AutomaticSource = "upload" | "formula" | "none";
export type AutomaticHav = { quadrant: number | null; source: AutomaticSource };
export type AutomaticTier = "upload" | "formula";

/** The inputs the automatic HAV is computed from, decrypted. */
export type HavInputs = {
  /** The HAV upload as the candidate row holds it ("6", "Kuadran #6", …), else null. */
  upload: string | null;
  performanceGrade: string | null;
  behaviorRecommendation: string | null;
  /** `candidates.hav_auto_tier`; null/absent = the static order upload › formula. */
  tier?: AutomaticTier | null;
};

/**
 * The automatic HAV — the HAV in force without a manual placement: upload, else
 * formula, else none; unless the formula is pinned and computable, which then
 * outranks the upload.
 */
export function automaticHav(inputs: HavInputs): AutomaticHav {
  const uploaded = canonicalQuadrant(inputs.upload);
  const formula = formulaQuadrant(inputs);
  if (inputs.tier === "formula" && formula != null) return { quadrant: formula, source: "formula" };
  if (uploaded != null) return { quadrant: uploaded, source: "upload" };
  if (formula != null) return { quadrant: formula, source: "formula" };
  return { quadrant: null, source: "none" };
}

/** PA as compared for "did it change": the six graded slots, blanks kept, so formatting never counts. */
export function comparablePerformance(raw: string | null | undefined): string {
  const slots = splitPerformanceSlots(raw);
  return slots.every((s) => s == null) ? "" : slots.map((s) => s ?? "").join(",");
}

/** BA as compared for "did it change": uppercase, single spaces, dashes folded. */
export function comparableBehavior(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** True when PA or BA differs between two readings of one candidate. */
export function paBaChanged(
  before: Pick<HavInputs, "performanceGrade" | "behaviorRecommendation">,
  after: Pick<HavInputs, "performanceGrade" | "behaviorRecommendation">,
): boolean {
  return (
    comparablePerformance(before.performanceGrade) !== comparablePerformance(after.performanceGrade) ||
    comparableBehavior(before.behaviorRecommendation) !== comparableBehavior(after.behaviorRecommendation)
  );
}

export type HavEvent = {
  /** True: stamp the clock, set the tier, supersede an older placement. */
  changed: boolean;
  cause: "upload" | "formula";
  before: AutomaticHav;
  after: AutomaticHav;
  /** The automatic tier the event puts in force. */
  tier: AutomaticTier;
};

/**
 * A HAV workbook row arriving for one candidate (rule 4).
 *
 *   - the uploaded value CHANGED against the candidate's stored upload — a new
 *     statement from HR's sheet, even when it agrees with what is in force; or
 *   - `againstInForce` (an upload made in the app, not the weekly re-read of the
 *     shared HAV.xlsx) and the value differs from the candidate's HAV IN FORCE
 *     before it — a manual placement or a pinned formula included. The shared
 *     file is re-read unchanged every week, so for it only a change counts:
 *     otherwise every Monday would undo every PA/BA edit and placement.
 *
 * `inForce` is the HAV in force before the upload (manual placement › automatic).
 */
export function havUploadEvent(
  before: HavInputs,
  next: string,
  opts: { inForce: number | null; againstInForce: boolean },
): HavEvent {
  const was = automaticHav(before);
  const nextQ = canonicalQuadrant(next);
  const uploadChanged = canonicalQuadrant(before.upload) !== nextQ;
  const differsFromInForce = opts.againstInForce && nextQ !== opts.inForce;
  return {
    changed: nextQ != null && (uploadChanged || differsFromInForce),
    cause: "upload",
    before: was,
    after: { quadrant: nextQ, source: nextQ != null ? "upload" : "none" },
    tier: "upload",
  };
}

/**
 * A write of PA and/or BA onto one candidate (rules 1 and 2): an event when PA
 * or BA actually CHANGED and the formula can place them afterwards.
 *
 * NOT events: an identical re-read; a change that leaves the formula unable to
 * answer (PA or BA vanished — data going missing must not void a decision); a
 * re-copied HAV upload value (the candidate sync copies sync_hav, but that
 * upload was an event when it arrived, hav-supersede.ts applies it on the spot).
 */
export function paBaFormulaEvent(before: HavInputs, after: HavInputs): HavEvent {
  const was = automaticHav(before);
  const formula = formulaQuadrant(after);
  return {
    changed: formula != null && paBaChanged(before, after),
    cause: "formula",
    before: was,
    after: { quadrant: formula, source: formula != null ? "formula" : "none" },
    tier: "formula",
  };
}

/**
 * The candidate sync's own events (rule 2): PA/BA from the MSSQL syncs — or
 * from a PA/BA workbook upload — that change the candidate's PA or BA.
 * `uploadRecopied` reports a differing re-copy of sync_hav, which is counted
 * but never an event (see paBaFormulaEvent).
 */
export function candidateSyncHavEvent(
  before: HavInputs,
  after: HavInputs,
): HavEvent & { uploadRecopied: boolean } {
  const event = paBaFormulaEvent(before, after);
  const uploadRecopied = canonicalQuadrant(before.upload) !== canonicalQuadrant(after.upload);
  return { ...event, uploadRecopied };
}
