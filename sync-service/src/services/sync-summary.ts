import type { SyncResult } from "../types.js";

/**
 * Fold a composite sync (several sub-syncs run in one call) into a single
 * SyncResult-shaped envelope.
 *
 * Why this exists: `/sync/org` and `/sync/positions/all` used to answer with
 * ONLY their per-part breakdown — `{ divisions: {...}, departments: {...} }` —
 * with no `success` at the top level. Every caller checks `data.success`, so an
 * entirely successful run read as `undefined` → falsy → "gagal", even though the
 * response was HTTP 200 and every part had succeeded.
 *
 * Spreading this alongside the parts keeps the breakdown (callers already
 * destructure `result.divisions` etc.) while making the envelope answer the same
 * question every other endpoint answers.
 */
export function summarizeParts(parts: Record<string, SyncResult>): SyncResult {
  const entries = Object.entries(parts);
  const failed = entries.filter(([, r]) => !r?.success);

  const synced = entries.reduce((n, [, r]) => n + (r?.synced ?? 0), 0);
  const total = entries.reduce((n, [, r]) => n + (r?.total ?? 0), 0);

  const message = failed.length
    ? `${failed.length} dari ${entries.length} bagian gagal — ` +
      failed.map(([key, r]) => `${key}: ${r?.message ?? "tidak diketahui"}`).join("; ")
    : entries.map(([key, r]) => `${key} ${r.synced}`).join(" · ");

  // Partial failure counts as failure: reporting success while a sub-sync threw
  // would hide exactly the case someone needs to act on.
  return { success: failed.length === 0, synced, total, message };
}
