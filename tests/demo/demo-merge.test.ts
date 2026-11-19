// TC-DEMO-MERGE — a demo candidate is "fields edited in demo mode + every other
// field live", never a frozen snapshot of the edit form.
//
//   node --import tsx --test tests/demo/*.test.ts
//
// What this pins, because each one fails silently (a number is still produced):
//   - only EDITED fields come from the copy; the rest follow the real record;
//   - an untouched HAV is NOT an edit, so it is re-derived from an edited PA/BA
//     instead of staying at whatever the form showed;
//   - payloads saved before edited-field tracking infer their edits the same way
//     in the web app and in scoring-service (separate deployables);
//   - the row overlays apply only edited fields, so a HAV already folded on a
//     row is not overwritten by a copy that never edited it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_EDITABLE_FIELDS,
  parseDemoPayload,
  presentCandidateRowForDemo,
  resolveDemoCopy,
  type DemoCandidateFields,
  type DemoRealValues,
} from '../../lib/demo/fields';
import { deriveHavQuadrant } from '../../lib/hav-quadrant-derive';
import { resolveEffectiveHav } from '../../lib/hav-effective';
import {
  DEMO_EDITABLE_FIELDS as SVC_EDITABLE_FIELDS,
  havEditedIds,
  overlayDemoCopy,
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
  email: 'asli@example.test',
  currentPosition: 'Analyst',
  department: 'IT',
  division: 'Ops',
  yearsExperience: '6',
  disciplineStatus: 'CLEAR',
  mcuStatus: 'fit',
  mcuNoteManual: null,
  performanceGrade: 'B,B,B,B,,',
  havQuadrant: null,
  behaviorRecommendation: 'READY',
  behaviorNotes: null,
  education: 'S1',
  major: 'Informatika',
};

/** What the old form saved: every field as shown, HAV = the HAV in force. */
const snapshot = (over: Partial<DemoCandidateFields> = {}): DemoCandidateFields => ({
  ...REAL,
  name: REAL.name!,
  performanceGrade: 'B,B,B,B,,',
  havQuadrant: webFormula(REAL.performanceGrade, REAL.behaviorRecommendation),
  technicalCompetencies: null,
  ...over,
});

describe('TC-DEMO-MERGE-01 tracked edits', () => {
  test('only edited fields come from the copy; the rest is the real value NOW', () => {
    const stored = snapshot({ performanceGrade: 'A,A,A,A,,', department: 'LAMA', editedFields: ['performanceGrade'] });
    const liveNow = { ...REAL, department: 'Baru dari sync' };
    const r = resolveDemoCopy(stored, liveNow, webFormula);
    assert.equal(r.performanceGrade, 'A,A,A,A,,');
    assert.equal(r.department, 'Baru dari sync', 'an unedited field follows the live record, not the snapshot');
    assert.deepEqual(r.editedFields, ['performanceGrade']);
    assert.equal(r.technicalCompetencies, null, 'unedited competencies = keep the real ones');
  });

  test('an unedited HAV is re-derived from the edited PA, a real placement still counts', () => {
    const stored = snapshot({ performanceGrade: 'D,D,D,D,,', editedFields: ['performanceGrade'] });
    const r = resolveDemoCopy(stored, REAL, webFormula);
    assert.equal(r.havQuadrant, null, 'the real (empty) upload, not the snapshot of the old formula');
    const row = presentCandidateRowForDemo(
      { id: 'c1', havQuadrant: REAL.havQuadrant, performanceGrade: REAL.performanceGrade, behaviorRecommendation: REAL.behaviorRecommendation },
      r,
    );
    const before = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: REAL.havQuadrant, performanceGrade: REAL.performanceGrade, behaviorRecommendation: REAL.behaviorRecommendation });
    const after = resolveEffectiveHav({ manualQuadrant: null, uploadedQuadrant: row.havQuadrant, performanceGrade: row.performanceGrade, behaviorRecommendation: row.behaviorRecommendation });
    assert.equal(after.source, 'formula');
    assert.notEqual(after.quadrant, before.quadrant, 'editing PA moved the HAV');
  });

  test('an edited HAV wins; payload round-trips its edit list', () => {
    const stored = snapshot({ havQuadrant: '1', editedFields: ['havQuadrant'] });
    const parsed = parseDemoPayload(JSON.stringify(stored))!;
    assert.deepEqual(parsed.editedFields, ['havQuadrant']);
    const r = resolveDemoCopy(parsed, REAL, webFormula);
    assert.equal(r.havQuadrant, '1');
    assert.deepEqual([...havEditedIds(new Map([['c1', r as never]]))], ['c1']);
  });

  test('unknown names in a stored edit list are dropped', () => {
    const parsed = parseDemoPayload(JSON.stringify({ ...snapshot(), editedFields: ['name', 'id', 'tenantId'] }))!;
    assert.deepEqual(parsed.editedFields, ['name']);
  });
});

describe('TC-DEMO-MERGE-02 payloads saved before tracking', () => {
  test('edits are inferred as "differs from the real value"; a copied formula HAV is not an edit', () => {
    const legacy = snapshot({ performanceGrade: 'A,A,A,A,,', name: 'Budi Demo' });
    const parsed = parseDemoPayload(JSON.stringify(legacy))!;
    assert.equal(parsed.editedFields, undefined);
    const r = resolveDemoCopy(parsed, REAL, webFormula);
    assert.deepEqual(r.editedFields, ['name', 'performanceGrade']);
    assert.equal(r.havQuadrant, null, 'the snapshot of the formula HAV no longer freezes it');
  });

  test('a HAV different from both the upload and the formula IS an edit', () => {
    const r = resolveDemoCopy(parseDemoPayload(JSON.stringify(snapshot({ havQuadrant: '16' })))!, REAL, webFormula);
    assert.ok(r.editedFields!.includes('havQuadrant'));
    assert.equal(r.havQuadrant, '16');
  });

  test('PA slot padding and number formatting are not edits', () => {
    const r = resolveDemoCopy(
      parseDemoPayload(JSON.stringify(snapshot({ performanceGrade: 'B,B,B,B,,', yearsExperience: '6.0' })))!,
      { ...REAL, performanceGrade: 'B,B,B,B', yearsExperience: '6' },
      webFormula,
    );
    assert.deepEqual(r.editedFields, []);
  });
});

describe('TC-DEMO-MERGE-03 web and scoring-service agree', () => {
  test('same editable field list', () => {
    assert.deepEqual([...SVC_EDITABLE_FIELDS], [...DEMO_EDITABLE_FIELDS]);
  });

  const cases: [string, DemoCandidateFields, DemoRealValues][] = [
    ['tracked PA edit', snapshot({ performanceGrade: 'A,A,A,A,,', editedFields: ['performanceGrade'] }), REAL],
    ['tracked HAV edit', snapshot({ havQuadrant: '2', editedFields: ['havQuadrant', 'mcuStatus'], mcuStatus: 'unfit' }), REAL],
    ['legacy snapshot with edits', snapshot({ name: 'X', behaviorRecommendation: 'NOT READY', mcuStatus: 'unfit' }), REAL],
    ['legacy explicit HAV', snapshot({ havQuadrant: '9' }), { ...REAL, havQuadrant: '5' }],
    ['legacy untouched', snapshot(), REAL],
  ];
  for (const [label, stored, real] of cases) {
    test(label, () => {
      const parsed = parseDemoPayload(JSON.stringify(stored))!;
      const web = resolveDemoCopy(parsed, real, webFormula);
      const svc = svcResolveDemoCopy(parsed as never, real, svcFormula);
      // Scoring has no email/employeeId on its copy; everything it scores must match.
      const { email: _e, employeeId: _n, ...webScored } = web;
      assert.deepEqual(svc, webScored);
    });
  }
});

describe('TC-DEMO-MERGE-04 overlays apply edited fields only', () => {
  const copy = resolveDemoCopy(
    snapshot({ education: 'S2', havQuadrant: '3', editedFields: ['education'] }),
    REAL,
    webFormula,
  );
  test('web row overlay leaves a folded HAV alone', () => {
    const row = { id: 'c1', education: 'S1', havQuadrant: '7', photoUrl: 'x' };
    assert.deepEqual(presentCandidateRowForDemo(row, copy), { id: 'c1', education: 'S2', havQuadrant: '7', photoUrl: null });
  });
  test('scoring-service overlay does the same', () => {
    const row = { id: 'c1', education: 'S1', havQuadrant: '7', yearsExperience: 6 };
    assert.deepEqual(overlayDemoCopy(row, copy as never), { id: 'c1', education: 'S2', havQuadrant: '7', yearsExperience: 6 });
  });
});
