// TC-AHP-DISPLAY — the pairwise tab must SHOW the matrix the server validates
// and the engine scores with. Renders the real AhpMatrixEditor (list view, the
// view the "Berpasangan" mode opens on) with react-dom/server; no database.
//
// Reproduces run 622af32e ("uji AHP"): the stored matrix holds career–hav =
// 1.25 and behavior–hav = 1.5 (Acuan B, CR 0.0995 → accepted) while the tab
// shows 1 and 2 (Acuan A, CR 0.1118 → would be rejected).
//
//   node --import tsx --test tests/governance/ahp-editor-display.test.ts
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { computeAhpWeights } from '../../lib/ahp';
import { EDITOR_LABELS, REF_B, parseRatioText } from './harness/ahp-fixtures';

// The editor imports a 'use server' module that reaches the database (and
// `server-only`). Seed the module cache with a no-op before the component is
// loaded — this test renders, it never saves.
const actionsPath = require.resolve('../../lib/program-actions');
const stub = new Module(actionsPath);
stub.filename = actionsPath;
stub.loaded = true;
stub.exports = { saveAhpConfigAction: async () => {} };
require.cache[actionsPath] = stub;

type Editor = typeof import('../../components/governance/governance-ahp-editor').AhpMatrixEditor;
let AhpMatrixEditor: Editor;

before(async () => {
  ({ AhpMatrixEditor } = await import('../../components/governance/governance-ahp-editor'));
});

function render(pairwise: number[][]): string {
  return renderToStaticMarkup(
    createElement(AhpMatrixEditor, { value: { pairwise }, onChange: () => {}, templateId: 'tpl-test' }),
  );
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");

/** Every pair the list view shows: "<hi> lebih penting <v> × dibanding <lo>". */
function displayedPairs(html: string): { hi: number; lo: number; shown: number }[] {
  const out: { hi: number; lo: number; shown: number }[] = [];
  for (const m of html.matchAll(/<input\b[^>]*>/g)) {
    const tag = m[0];
    const title = /title="([^"]*)"/.exec(tag)?.[1];
    const value = /value="([^"]*)"/.exec(tag)?.[1];
    if (!title || value == null) continue;
    const t = /^Seberapa kali (.+) lebih penting dari (.+) \(1-9\)$/.exec(decode(title));
    if (!t) continue;
    out.push({
      hi: EDITOR_LABELS.indexOf(t[1] as (typeof EDITOR_LABELS)[number]),
      lo: EDITOR_LABELS.indexOf(t[2] as (typeof EDITOR_LABELS)[number]),
      shown: parseRatioText(decode(value)) ?? Number.NaN,
    });
  }
  return out;
}

describe('TC-AHP-DISPLAY run 622af32e (Acuan B stored)', () => {
  test('the list view shows all 15 judgments', () => {
    const pairs = displayedPairs(render(REF_B));
    assert.equal(pairs.length, 15);
    assert.ok(pairs.every((p) => p.hi >= 0 && p.lo >= 0 && p.hi !== p.lo));
  });

  test('(a) every displayed judgment equals the stored judgment', () => {
    const pairs = displayedPairs(render(REF_B));
    const mismatches = pairs
      .filter((p) => Math.abs(p.shown - REF_B[p.hi]![p.lo]!) > 1e-9)
      .map((p) => `${EDITOR_LABELS[p.hi]} vs ${EDITOR_LABELS[p.lo]}: tampil ${p.shown}, tersimpan ${REF_B[p.hi]![p.lo]}`);
    assert.deepEqual(mismatches, [], 'nilai tampil ≠ nilai tersimpan');
  });

  test('(a) the verdict computed from what is shown equals the verdict the badge (and the server) gives', () => {
    const html = render(REF_B);
    const shown = REF_B.map((r) => [...r]);
    for (const p of displayedPairs(html)) {
      shown[p.hi]![p.lo] = p.shown;
      shown[p.lo]![p.hi] = 1 / p.shown;
    }
    const crShown = computeAhpWeights(shown).cr;
    const crStored = computeAhpWeights(REF_B).cr;
    const badge = /CR = ([\d.]+) · (TIDAK konsisten|konsisten)/.exec(decode(html));
    assert.ok(badge, 'badge CR tidak ditemukan');
    assert.equal(badge[1], crStored.toFixed(3), 'badge melaporkan CR matriks tersimpan');
    assert.equal(
      crShown <= 0.1,
      badge[2] === 'konsisten',
      `matriks yang TAMPIL ber-CR ${crShown.toFixed(4)}, tetapi badge menyatakan "${badge[2]}" (CR tersimpan ${crStored.toFixed(4)})`,
    );
  });
});
