// TC-PAR — values that exist TWICE, once per deployable (web app ↔ scoring-service),
// with no shared library to keep them in step. A drift here never throws: the UI
// simply states a rule the engine does not apply.
// TC-RRN — the re-run mode table: one creatable mode, four legacy ones still read.
// TC-LBL — the run-label scaffolding that must not grow.
//
//   node --import tsx --test tests/scoring/parity-and-reruns.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import * as webAhp from '../../lib/ahp';
import * as svcAhp from '../../scoring-service/src/ahp';
import {
  AHP_ASPECT_ORDER,
  DEFAULT_ASPECT_WEIGHTS,
  ahpWeightPercentages,
} from '../../lib/scoring-criteria';
import { AHP_CRITERIA_ORDER, DEFAULT_WEIGHTS } from '../../scoring-service/src/ahp-weights';
import {
  CREATABLE_RERUN_MODES,
  LEGACY_RERUN_MODES,
  RERUN_MODES,
  isCreatableRerunMode,
  isLegacyRerunMode,
  isRerunMode,
  rerunSpec,
  type RerunMode,
} from '../../lib/rerun-modes';
import {
  RUN_LABEL_MAX_LENGTH,
  assertDeltaSegmentCoversRerunModes,
  buildDerivedRunLabel,
  runLabelCore,
} from '../../lib/run-label';


describe('TC-PAR  web ↔ scoring-service parity', () => {
  test('TC-PAR-01 AHP math: both copies give identical weights and CR', () => {
    let s = 5;
    const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let t = 0; t < 100; t++) {
      const n = 2 + Math.floor(rand() * 8);
      const m = Array.from({ length: n }, () => new Array<number>(n).fill(1));
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const v = 1 / 9 + rand() * 8.9;
          m[i]![j] = v;
          m[j]![i] = 1 / v;
        }
      const a = webAhp.computeAhpWeights(m);
      const b = svcAhp.computeAhpWeights(m);
      assert.deepEqual(a.weights, b.weights);
      assert.equal(a.cr, b.cr);
    }
  });

  test('TC-PAR-02 default aspect weights and criterion order are the same table', () => {
    assert.deepEqual({ ...DEFAULT_ASPECT_WEIGHTS }, { ...DEFAULT_WEIGHTS });
    assert.deepEqual([...AHP_ASPECT_ORDER], [...AHP_CRITERIA_ORDER]);
  });

  test('TC-PAR-03 the governance UI quotes the weights the engine applies (no matrix)', () => {
    assert.deepEqual(ahpWeightPercentages(null), { ...DEFAULT_WEIGHTS });
  });
});

describe('TC-RRN  re-run modes', () => {
  test('TC-RRN-01 the table still holds all six stored modes; only incremental_add is creatable', () => {
    assert.deepEqual(Object.keys(RERUN_MODES).sort(), ['baseline', 'exclude', 'finalists_rematch', 'incremental_add', 'refresh_add', 'refresh_full']);
    assert.deepEqual([...CREATABLE_RERUN_MODES], ['incremental_add']);
    assert.deepEqual([...LEGACY_RERUN_MODES].sort(), ['exclude', 'finalists_rematch', 'refresh_add', 'refresh_full']);
    for (const m of LEGACY_RERUN_MODES) {
      assert.equal(RERUN_MODES[m].legacy, true, m);
      assert.equal(isCreatableRerunMode(m), false, m);
      assert.equal(isLegacyRerunMode(m), true, m);
    }
    assert.equal(RERUN_MODES.incremental_add.legacy, false);
    assert.equal(RERUN_MODES.incremental_add.label, 'Tambah Kandidat Pembanding');
  });

  test('TC-RRN-02 the creatable mode says the parent is frozen; legacy rows keep their own sentence', () => {
    assert.match(RERUN_MODES.incremental_add.description, /dibekukan/);
    // The parent's TOPSIS yardstick is frozen too: carried candidates keep their
    // order and closeness; the sentence must say so (and still cover old children).
    assert.match(RERUN_MODES.incremental_add.description, /skala TOPSIS/);
    assert.match(RERUN_MODES.incremental_add.expectation, /tetap pada urutan dan kecocokan run induk/);
    // Legacy rows describe what THEY did, so a run made under them still reads right.
    assert.match(RERUN_MODES.refresh_full.expectation, /data HR/);
    assert.match(RERUN_MODES.exclude.expectation, /menyempitnya/);
  });

  test('TC-RRN-03 the table carries no creation knobs any more — only display', () => {
    for (const s of Object.values(RERUN_MODES)) {
      assert.deepEqual(
        Object.keys(s).sort(),
        ['chip', 'delta', 'description', 'expectation', 'label', 'legacy', 'mode', 'tone'],
        s.mode,
      );
    }
  });

  test('TC-RRN-04 every mode states what may move the ranking', () => {
    for (const s of Object.values(RERUN_MODES)) assert.ok(s.expectation.trim().length > 20, s.mode);
  });

  test('TC-RRN-05 unknown mode strings are rejected / fall back safely', () => {
    assert.equal(isRerunMode('incremental_add'), true);
    assert.equal(isRerunMode('rescore'), false);
    assert.equal(isCreatableRerunMode('refresh_full'), false);
    assert.ok(rerunSpec('nonsense'));
  });
});

describe('TC-LBL  derived run labels', () => {
  const now = new Date('2026-10-19T04:30:00Z');

  test('TC-LBL-01 every delta the mode table emits is recognised as scaffolding', () => {
    assert.deepEqual(assertDeltaSegmentCoversRerunModes(Object.values(RERUN_MODES)), []);
  });

  test('TC-LBL-02 the core survives every historical label shape', () => {
    const core = 'Critical — IT APPLICATION DEVELOPMENT DEPARTMENT HEAD';
    for (const label of [
      `${core} — 2026-08-24`,
      `+2 kandidat — ${core} — 2026-08-24 11:05`,
      `−1 kandidat — +2 kandidat (data terbaru) — ${core} — 24/8/2026`,
      `Re-scoring (+2 kandidat) — ${core} — 3 Agu 2026, 13.49`,
      `tanding finalis — data terbaru — ${core} — 2026-08-24 — 2026-08-24 13:02`,
    ]) {
      assert.equal(runLabelCore(label), core, label);
    }
  });

  test('TC-LBL-03 re-running a re-run 30 times does not grow the label', () => {
    let label = 'Critical — WAREHOUSE SUPERVISOR — 2026-08-24';
    const lengths = new Set<number>();
    for (let i = 0; i < 30; i++) {
      // Every delta that exists in stored labels, legacy ones included — a label
      // is re-derived from whatever its parent was.
      const modes = Object.keys(RERUN_MODES) as RerunMode[];
      const mode = modes[i % modes.length]!;
      label = buildDerivedRunLabel(RERUN_MODES[mode].delta({ added: 3, excluded: 2 }), label, 'Run', now);
      assert.ok(label.length <= RUN_LABEL_MAX_LENGTH);
      assert.ok(!/\d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}/.test(label), `stamp duplicated: ${label}`);
      lengths.add(runLabelCore(label).length);
    }
    assert.equal(lengths.size, 1, 'core length constant across generations');
  });

  test('TC-LBL-04 a very long custom label is elided to fit varchar(255), keeping delta and stamp', () => {
    const l = buildDerivedRunLabel('+1 kandidat', 'X'.repeat(400), 'Run', now);
    assert.ok(l.length <= RUN_LABEL_MAX_LENGTH);
    assert.ok(l.startsWith('+1 kandidat'));
    assert.ok(l.includes('…'));
  });

  test('TC-LBL-05 the stamp is Asia/Jakarta wall-clock (04:30Z → 11:30)', () => {
    assert.ok(buildDerivedRunLabel('+1 kandidat', 'A', 'Run', now).endsWith('2026-10-19 11:30'));
  });
});
