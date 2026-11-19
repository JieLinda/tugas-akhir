// TC-DEMO — demo mode ("mode demo" / "mode asli").
//
// Pins the pure rules every demo surface relies on: the URL keyword, the
// display masks, the demo-copy overlay, the file pseudonyms (which must keep
// every equality the trace workbook's formulas test), and the parity of the
// two text maskers (web and scoring-service are separate deployables).
//
//   node --import tsx --test tests/demo/*.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MASKED_CODE,
  MASKED_NPK,
  appModeFromCookie,
  deploymentModeConfig,
  maskCode,
  maskIdentifiersInText,
  maskNpk,
  parseModeKeyword,
  resolveAppMode,
} from '../../lib/app-mode-shared';
import { parseDemoPayload, presentCandidateRowForDemo, type DemoCandidateFields } from '../../lib/demo/fields';
import { maskJobProfileFileName, maskProfileForDemo } from '../../lib/demo/mask';
import { pseudonymizeIdentifiers } from '../../lib/demo/pseudonymize';
import { overlayDemoCopy } from '../../scoring-service/src/demo-overlay';
import type { CandidateProfile } from '../../lib/talent-data';

const COPY: DemoCandidateFields = {
  name: 'Budi Demo',
  employeeId: '99999',
  email: 'demo@example.test',
  currentPosition: 'Demo Analyst',
  department: 'Demo Dept',
  division: 'Demo Div',
  yearsExperience: '7',
  disciplineStatus: 'CLEAR',
  mcuStatus: 'unfit',
  mcuNoteManual: 'catatan demo',
  performanceGrade: 'A,B,,,,',
  havQuadrant: '3',
  behaviorRecommendation: 'RECOMMENDED',
  behaviorNotes: null,
  education: 'S2',
  major: 'Informatika',
  technicalCompetencies: null,
};

describe('TC-DEMO-01 mode keyword', () => {
  test('demo switches on; asli / real / normal switch off; anything else is not a switch', () => {
    assert.equal(parseModeKeyword('demo'), 'demo');
    assert.equal(parseModeKeyword(' DEMO '), 'demo');
    assert.equal(parseModeKeyword('asli'), 'real');
    assert.equal(parseModeKeyword('real'), 'real');
    assert.equal(parseModeKeyword('normal'), 'real');
    assert.equal(parseModeKeyword('x'), null);
    assert.equal(parseModeKeyword(''), null);
    assert.equal(parseModeKeyword(null), null);
  });
  test('only the exact cookie value means demo', () => {
    assert.equal(appModeFromCookie('demo'), 'demo');
    assert.equal(appModeFromCookie('Demo'), 'real');
    assert.equal(appModeFromCookie(undefined), 'real');
  });
  test('an absent or unknown cookie means the deployment default', () => {
    assert.equal(appModeFromCookie(undefined, 'demo'), 'demo');
    assert.equal(appModeFromCookie('Demo', 'demo'), 'demo');
    assert.equal(appModeFromCookie('real', 'demo'), 'real');
    assert.equal(appModeFromCookie('demo', 'real'), 'demo');
  });
});

describe('TC-DEMO-01b deployment default (PULSE_DEFAULT_MODE / PULSE_MODE_LOCKED)', () => {
  test('unset env keeps today\'s behaviour: asli, unlocked', () => {
    assert.deepEqual(deploymentModeConfig({}), { defaultMode: 'real', locked: false });
    assert.deepEqual(deploymentModeConfig({ PULSE_DEFAULT_MODE: 'nonsense' }), { defaultMode: 'real', locked: false });
  });
  test('the default accepts the URL keyword words', () => {
    assert.equal(deploymentModeConfig({ PULSE_DEFAULT_MODE: 'demo' }).defaultMode, 'demo');
    assert.equal(deploymentModeConfig({ PULSE_DEFAULT_MODE: ' Demo ' }).defaultMode, 'demo');
    assert.equal(deploymentModeConfig({ PULSE_DEFAULT_MODE: 'asli' }).defaultMode, 'real');
  });
  test('lock flag', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) assert.equal(deploymentModeConfig({ PULSE_MODE_LOCKED: v }).locked, true, v);
    for (const v of ['', '0', 'false', 'no']) assert.equal(deploymentModeConfig({ PULSE_MODE_LOCKED: v }).locked, false, v);
  });
  test('demo default: a fresh browser is demo, a switched one is real', () => {
    const cfg = { defaultMode: 'demo' as const, locked: false };
    assert.equal(resolveAppMode(undefined, cfg), 'demo');
    assert.equal(resolveAppMode('real', cfg), 'real');
  });
  test('locked: the cookie is ignored in both directions', () => {
    assert.equal(resolveAppMode('real', { defaultMode: 'demo', locked: true }), 'demo');
    assert.equal(resolveAppMode('demo', { defaultMode: 'real', locked: true }), 'real');
  });
});

describe('TC-DEMO-02 display masks', () => {
  test('fixed-width marks; empty stays empty', () => {
    assert.equal(maskNpk('00370'), MASKED_NPK);
    assert.equal(maskNpk(370), MASKED_NPK);
    assert.equal(maskNpk(''), '');
    assert.equal(maskNpk(null), '');
    assert.equal(maskCode('JP-01'), MASKED_CODE);
    assert.equal(maskCode('  '), '');
  });
  test('text masking is whole-token and covers both NPK paddings', () => {
    const text = 'Incumbent 370 (00370) memegang posisi 10012345; 13702 dan 2026-11-04 tidak disentuh.';
    const out = maskIdentifiersInText(text, { npks: ['00370'], codes: ['10012345'] });
    assert.equal(out, `Incumbent ${MASKED_NPK} (${MASKED_NPK}) memegang posisi ${MASKED_CODE}; 13702 dan 2026-11-04 tidak disentuh.`);
  });
});

describe('TC-DEMO-03 demo copy overlay', () => {
  test('only keys the row carries are replaced, in its own naming, and the photo goes', () => {
    const camel = { id: 'c1', name: 'Asli', employeeId: '00101', currentPosition: 'Asli', photoUrl: 'http://x/p.jpg', grade: '7' };
    const shown = presentCandidateRowForDemo(camel, COPY);
    assert.equal(shown.name, 'Budi Demo');
    assert.equal(shown.currentPosition, 'Demo Analyst');
    assert.equal(shown.employeeId, '00101', 'identity (NPK joins) keeps the real NPK');
    assert.equal(shown.photoUrl, null);
    assert.equal(shown.grade, '7');
    assert.ok(!('department' in shown), 'a key the row lacks is not added');

    const snake = { id: 'c1', name: 'Asli', hav_quadrant: '9', performance_grade: 'C', photo_url: 'p' };
    const s2 = presentCandidateRowForDemo(snake, COPY);
    assert.equal(s2.hav_quadrant, '3');
    assert.equal(s2.performance_grade, 'A,B,,,,');
    assert.equal(s2.photo_url, null);
  });
  test('no copy: values untouched, photo still removed', () => {
    const row = { id: 'c1', name: 'Asli', photoUrl: 'p' };
    assert.deepEqual(presentCandidateRowForDemo(row, null), { id: 'c1', name: 'Asli', photoUrl: null });
  });
  test('scoring-service overlay mirrors the web one and keeps a numeric experience numeric', () => {
    const row = { id: 'c1', name: 'Asli', employeeId: '00101', yearsExperience: 3, havQuadrant: '9', unknown: 'x' };
    const out = overlayDemoCopy(row, { ...COPY, technicalCompetencies: null });
    assert.equal(out.name, 'Budi Demo');
    assert.equal(out.employeeId, '00101');
    assert.equal(out.yearsExperience, 7);
    assert.equal(out.havQuadrant, '3');
    assert.equal(out.unknown, 'x');
  });
  test('a payload that is not a demo copy is refused', () => {
    assert.equal(parseDemoPayload('not json'), null);
    assert.equal(parseDemoPayload(JSON.stringify({ nope: 1 })), null);
    assert.equal(parseDemoPayload(JSON.stringify(COPY))?.name, 'Budi Demo');
  });
});

describe('TC-DEMO-04 profile and file-name masks', () => {
  test('a profile leaves the server with no NPK, photo, stint code or code-only competency name', () => {
    const profile = {
      id: 'c1',
      name: 'Budi',
      employeeId: '00101',
      photoUrl: 'p',
      raw: { employeeId: '00101', photoUrl: 'p' },
      positionHistory: [{ positionId: 'JP01', internalTitle: 'Analyst' }],
      technicalCompetencies: [
        { technicalId: 'K01', technicalName: 'K01' },
        { technicalId: 'K02', technicalName: 'Database' },
      ],
    } as unknown as CandidateProfile;
    const m = maskProfileForDemo(profile) as unknown as Record<string, any>;
    assert.equal(m.employeeId, MASKED_NPK);
    assert.equal(m.photoUrl, null);
    assert.equal(m.raw.employeeId, MASKED_NPK);
    assert.equal(m.raw.photoUrl, null);
    assert.equal(m.positionHistory[0].positionId, MASKED_CODE);
    assert.equal(m.positionHistory[0].internalTitle, 'Analyst');
    assert.equal(m.technicalCompetencies[0].technicalName, MASKED_CODE);
    assert.equal(m.technicalCompetencies[1].technicalName, 'Database');
  });
  test('job-profile file names keep the title and lose the code and JD number', () => {
    assert.equal(maskJobProfileFileName('10012345 JD-MSD-022 System Integrator Analyst.pdf'), `${MASKED_CODE} ${MASKED_CODE} System Integrator Analyst`);
    assert.equal(maskJobProfileFileName('10012345 Cashier (Rev. 2).pdf'), `${MASKED_CODE} Cashier`);
    assert.equal(maskJobProfileFileName('JUSTONEWORD.pdf'), MASKED_CODE);
    assert.equal(maskJobProfileFileName(null), '');
  });
});

describe('TC-DEMO-05 file pseudonyms keep every equality', () => {
  const bundle = {
    run: { id: '7dba1677-d4a9-4eb9-8319-1339180a9a23', positionId: '44444444-4444-4444-8444-444444444444' },
    configSnapshot: { template: { code: 'successor', name: 'Critical Position' } },
    engine: {
      technical: {
        candidates: {
          c1: {
            required: [{ name: 'Database', code: 'K01', norm: 'database', level: 2 }],
            held: [{ name: 'Database', code: 'K01', norm: 'database', level: 3 }],
          },
        },
      },
      career: {
        stints: [
          { title: 'JP01', positionId: 'JP01', fallbackKey: 'JP01##MUL##00101|00999' },
          { title: 'Analyst', positionId: 'jp02', fallbackKey: 'JP02##MUL##00999' },
        ],
        fallbacks: {
          'JP01##MUL##00101|00999': {
            key: 'JP01##MUL##00101|00999',
            code: 'JP01',
            excluded: ['00101', '00999'],
            holders: [{ employeeId: '00777', companyId: 'MUL' }],
          },
        },
        idf: { keys: [{ key: 'C:K01', name: 'database', df: 3 }, { key: 'N:excel', name: 'excel', df: 9 }] },
      },
    },
  };
  const { value: out, npks, codes } = pseudonymizeIdentifiers(bundle);
  const json = JSON.stringify(out);

  test('no real NPK or code survives anywhere, keys included', () => {
    for (const real of ['00101', '00999', '00777', 'JP01', 'JP02', 'jp02', 'K01']) {
      assert.ok(!new RegExp(`(?<![A-Za-z0-9])${real}(?![A-Za-z0-9])`).test(json), `${real} leaked: ${json}`);
    }
    assert.equal(npks, 3);
    assert.equal(codes, 3);
  });
  test('the same value gets the same pseudonym in every place', () => {
    const tech = out.engine.technical.candidates.c1;
    assert.equal(tech.required[0]!.code, tech.held[0]!.code, 'identity by kamus code survives');
    const stint = out.engine.career.stints[0]!;
    assert.equal(stint.title, stint.positionId, 'a stint titled by its code is titled by its pseudonym');
    const fb = out.engine.career.fallbacks[stint.fallbackKey as keyof typeof out.engine.career.fallbacks];
    assert.ok(fb, 'the fallback table is still found by the stint key (VLOOKUP)');
    assert.equal(fb.key, stint.fallbackKey);
    assert.equal(fb.code, stint.positionId);
    assert.deepEqual(fb.excluded, stint.fallbackKey.split('##')[2]!.split('|'));
    assert.equal(out.engine.career.idf.keys[0]!.key, `C:${tech.required[0]!.code}`, 'the IDF key follows its code');
    assert.equal(out.engine.career.idf.keys[1]!.key, 'N:excel', 'a name key is not a code');
    const lower = out.engine.career.stints[1]!;
    assert.match(lower.positionId, /^KODE-\d{3}$/);
    assert.equal(lower.fallbackKey.split('##')[0], lower.positionId, 'a lower-case code and its upper-case key share one pseudonym');
  });
  test('uuids, program codes and company ids are not identifiers of a person or a seat', () => {
    assert.equal(out.run.id, bundle.run.id);
    assert.equal(out.run.positionId, bundle.run.positionId);
    assert.equal(out.configSnapshot.template.code, 'successor');
    assert.equal(Object.values(out.engine.career.fallbacks)[0]!.holders[0]!.companyId, 'MUL');
  });
  test('nothing to replace returns the value itself', () => {
    const plain = { a: 1, b: ['x'] };
    assert.equal(pseudonymizeIdentifiers(plain).value, plain);
  });
});
