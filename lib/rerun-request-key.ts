// ── The identity of a "Tambah Kandidat Pembanding" request (FR-RR-13) ──
//
// A double click, or the same request resubmitted moments later, must create
// ONE child run. Two submissions are "the same" when they name the same
// parent, the same people, the same confirmations and the same reason — order
// and duplicates in the lists do not matter. `startRerunAction` stores this key
// in `config_snapshot.rerun.requestKey` and, under a transaction-scoped
// advisory lock on it, returns the run an identical request created within the
// last two minutes instead of creating another.
//
// Kept outside lib/scoring-engine.ts because a 'use server' module may only
// export async functions, and this one is tested directly.

import { createHash } from 'node:crypto';

export const RERUN_IDEMPOTENCY_WINDOW_SECONDS = 120;

export function rerunRequestKey(input: {
  parentId: string;
  pickedIds: string[];
  confirmedIds: string[];
  reason: string;
}): string {
  const payload = JSON.stringify([
    input.parentId,
    [...new Set(input.pickedIds.map((x) => x.trim()).filter(Boolean))].sort(),
    [...new Set(input.confirmedIds.map((x) => x.trim()).filter(Boolean))].sort(),
    input.reason.trim(),
  ]);
  return createHash('sha256').update(payload).digest('hex');
}
