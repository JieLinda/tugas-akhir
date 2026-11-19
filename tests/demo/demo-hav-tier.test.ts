// TC-DEMO-HAVT — the formula pin on a demo copy (`havTier`, drizzle/0098's demo
// twin): a PA/BA edit or "Hitung kuadran HAV" in demo mode puts the formula over
// the real placement and the real upload; a demo HAV edit outranks the pin, and
// un-editing the HAV leaves the formula in force. Web and scoring-service must
// read the copy the same way.
//
//   node --import tsx --test tests/demo/demo-hav-tier.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDemoPayload, resolveDemoCopy, type DemoRealValues } from '../../lib/demo/fields';
import { deriveHavQuadrant } from '../../lib/hav-quadrant-derive';
import {
  havEditedIds,
  havFormulaPinnedIds,
  resolveDemoCopy as svcResolveDemoCopy,
} from '../../scoring-service/src/demo-overlay';
import { formulaQuadrant } from '../../scoring-service/src/hav-effective';

const webFormula = (pa: string | null, ba: string | null) => {
  const d = deriveHavQuadrant({ performanceGrade: pa, behaviorRecommendation: ba });
  return d.ok ? String(d.quadrant) : null;
};
const svcFormula = (pa: string | null, ba: string | null) => {
  const q = formulaQuadrant({ performanceGrade: pa, behaviorRecommendation: ba });
  return q == null ? null : String(q);
};

const REAL: DemoRealValues = {
  name: 'Asli',
  employeeId: '00370',
  email: null,
  currentPosition: 'Analyst',
  department: 'IT',
  division: 'Ops',
  yearsExperience: '6',
  disciplineStatus: 'CLEAR',
  mcuStatus: 'fit',
  mcuNoteManual: null,
  performanceGrade: 'B,B,B,B,,',
  havQuadrant: '7',
  behaviorRecommendation: 'READY',
  behaviorNotes: null,
  education: 'S1',
  major: 'Informatika',
};

function payload(over: Record<string, unknown>): string {
  return JSON.stringify({ ...REAL, technicalCompetencies: null, ...over });
}

describe('TC-DEMO-HAVT  havTier on the demo copy', () => {
  test('a formula pin survives parsing and resolution, in both deployables', () => {
    const text = payload({ performanceGrade: 'C,C,,,,', editedFields: ['performanceGrade'], havTier: 'formula' });
    const web = resolveDemoCopy(parseDemoPayload(text)!, REAL, webFormula);
    assert.equal(web.havTier, 'formula');
    const parsed = JSON.parse(text);
    const svc = svcResolveDemoCopy(parsed as never, REAL, svcFormula);
    assert.equal(svc.havTier, 'formula');
    assert.deepEqual(Array.from(havFormulaPinnedIds(new Map([['c1', svc]]))), ['c1']);
  });

  test('a demo HAV edit outranks the pin; the pin is kept for when the edit is undone', () => {
    const text = payload({ havQuadrant: '12', editedFields: ['havQuadrant'], havTier: 'formula' });
    const svc = svcResolveDemoCopy(JSON.parse(text) as never, REAL, svcFormula);
    const copies = new Map([['c1', svc]]);
    assert.equal(svc.havTier, 'formula');
    assert.deepEqual(Array.from(havEditedIds(copies)), ['c1']);
    assert.deepEqual(Array.from(havFormulaPinnedIds(copies)), [], 'an edited HAV is not formula-pinned');
  });

  test('a copy without the key, or with junk, is not pinned', () => {
    for (const havTier of [undefined, 'upload', 'yes', 1]) {
      const text = payload({ editedFields: ['name'], havTier });
      assert.equal(resolveDemoCopy(parseDemoPayload(text)!, REAL, webFormula).havTier, null);
      assert.equal(svcResolveDemoCopy(JSON.parse(text) as never, REAL, svcFormula).havTier, null);
    }
  });
});
