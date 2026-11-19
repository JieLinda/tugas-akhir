// TC-BAH — behavioural-assessment history for the Talent Mapping work queue.
// Two halves in two deployables: sync-service decides which source rows become
// history (buildBehaviorHistory), the web app merges the current row back in
// (mergeBehaviorHistory). Both fail silently — a duplicate entry, the wrong one
// shown as "terbaru", or yesterday's BA above today's — so they are pinned here.
//
//   node --import tsx --test tests/talent-mapping/behavior-history.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TALENT_MAPPING_BA_HISTORY_DEPTH, mergeBehaviorHistory } from '../../lib/talent-mapping';
import {
  BEHAVIOR_HISTORY_DEPTH,
  buildBehaviorHistory,
  type BehaviorHistorySourceRow,
} from '../../sync-service/src/services/behavior-history';

const row = (employee: string, iso: string | null, label: string | null, note: string | null = null): BehaviorHistorySourceRow => ({
  COMPANY_ID: 'MPM2',
  EMPLOYEE_ID: employee,
  REKOMENDASI_NAME: label,
  KETERANGAN: note,
  TGL_PELAKSANAAN: iso ? new Date(iso) : null,
});

describe('TC-BAH-SYNC  which source rows become history', () => {
  test('TC-BAH-01 newest first, capped at the depth, ranked 1..n per employee', () => {
    const out = buildBehaviorHistory([
      row('07321', '2015-03-01', 'LOW'),
      row('07321', '2023-01-12', 'READY'),
      row('07321', '2019-10-28', 'HIGH'),
      row('07321', '2011-07-26', 'POTENSI'),
      row('08301', '2020-05-05', 'STRENGTH'),
    ]);
    const a = out.filter((r) => r.employeeId === '07321');
    assert.deepEqual(a.map((r) => [r.rank, r.rekomendasiName]), [[1, 'READY'], [2, 'HIGH'], [3, 'LOW']]);
    assert.equal(out.filter((r) => r.employeeId === '08301').length, 1);
  });

  test('TC-BAH-02 two rows on one date are one assessment; the labelled one wins', () => {
    const out = buildBehaviorHistory([
      row('07321', '2023-01-12', null),
      row('07321', '2023-01-12', 'READY'),
      row('07321', '2019-10-28', 'HIGH'),
    ]);
    assert.deepEqual(out.map((r) => r.rekomendasiName), ['READY', 'HIGH']);
  });

  test('TC-BAH-03 undated rows are dropped — they cannot sit in a history', () => {
    const out = buildBehaviorHistory([row('07321', null, 'READY'), row('07321', '2019-10-28', 'HIGH')]);
    assert.deepEqual(out.map((r) => r.rekomendasiName), ['HIGH']);
  });

  test('TC-BAH-04 blanks become null, text is trimmed', () => {
    const [only] = buildBehaviorHistory([row('07321', '2019-10-28', '  HIGH ', '   ')]);
    assert.equal(only!.rekomendasiName, 'HIGH');
    assert.equal(only!.keterangan, null);
  });

  test('TC-BAH-05 the sync and the page agree on how many entries a person has', () => {
    assert.equal(BEHAVIOR_HISTORY_DEPTH, TALENT_MAPPING_BA_HISTORY_DEPTH);
  });
});

describe('TC-BAH-WEB  merging the current row into the history', () => {
  const e = (label: string | null, date: string | null, note: string | null = null) => ({ label, date, note });

  test('TC-BAH-06 the current row joins the history and the list stays newest first', () => {
    const merged = mergeBehaviorHistory(e('HIGH', '2025-11-04'), [e('READY', '2023-01-12'), e('LOW', '2019-10-28')]);
    assert.deepEqual(merged.map((x) => x.date), ['2025-11-04', '2023-01-12', '2019-10-28']);
  });

  test('TC-BAH-07 on the same date the CURRENT row wins (it is what the formula reads)', () => {
    const merged = mergeBehaviorHistory(e('HIGH', '2023-01-12'), [e('READY', '2023-01-12'), e('LOW', '2019-10-28')]);
    assert.deepEqual(merged.map((x) => x.label), ['HIGH', 'LOW']);
  });

  test('TC-BAH-08 an empty history table still yields the current BA ("min 1")', () => {
    assert.deepEqual(mergeBehaviorHistory(e('READY', '2023-01-12'), []), [e('READY', '2023-01-12')]);
  });

  test('TC-BAH-09 capped at the depth; entries with neither category nor date are dropped', () => {
    const merged = mergeBehaviorHistory(e(null, null), [
      e('A1', '2024-01-01'),
      e('A2', '2023-01-01'),
      e('A3', '2022-01-01'),
      e('A4', '2021-01-01'),
    ]);
    assert.deepEqual(merged.map((x) => x.label), ['A1', 'A2', 'A3']);
  });

  test('TC-BAH-10 an undated entry with a category is kept, after the dated ones', () => {
    const merged = mergeBehaviorHistory(e('READY', null), [e('HIGH', '2019-10-28')]);
    assert.deepEqual(merged.map((x) => x.label), ['HIGH', 'READY']);
  });
});
