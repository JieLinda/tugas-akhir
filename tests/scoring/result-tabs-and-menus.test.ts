// TC-TAB / TC-NAV — which result tab a URL opens on the position page, and
// which menu owns a Data Referensi route. Both are small tables that several
// components read; these cases pin what an old bookmark, a hidden tab and the
// split of "Profil Job" into Dokumen + Posisi must keep doing. Pure; no
// database, no browser.
//
//   node --import tsx --test tests/scoring/result-tabs-and-menus.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RESULT_TAB_ALIASES, RUN_COMPARE_TAB, compareHref } from '../../lib/run-history';
import {
  AI_ASSISTANT_TAB_ENABLED,
  DEFAULT_RESULT_TAB,
  RESULT_TAB_IDS,
  parseResultTab,
} from '../../lib/position-result-tabs';
import {
  JOB_PROFILES_HUB,
  POSITION_HUB,
  SIDEBAR_GROUPS,
  activeHubSection,
  isHubSectionActive,
  isNavItemActive,
  routeLabel,
} from '../../lib/navigation';

describe('TC-TAB result tabs', () => {
  test('the comparison tab is "komparasi-versi" and the old id still opens it', () => {
    assert.equal(RUN_COMPARE_TAB, 'komparasi-versi');
    assert.equal(RESULT_TAB_ALIASES['perbandingan-run'], RUN_COMPARE_TAB);
    assert.equal(parseResultTab('perbandingan-run'), RUN_COMPARE_TAB);
    assert.equal(parseResultTab('komparasi-versi'), RUN_COMPARE_TAB);
  });

  test('a link built for the comparison names the current id', () => {
    const url = new URL(compareHref('pos-1', 'run-a', 'run-b'), 'http://x');
    assert.equal(url.searchParams.get('tab'), 'komparasi-versi');
  });

  test('Komparasi Versi comes right after Konfigurasi, last in the menu', () => {
    const at = RESULT_TAB_IDS.indexOf(RUN_COMPARE_TAB);
    assert.equal(RESULT_TAB_IDS[at - 1], 'konfigurasi-run');
    assert.equal(at, RESULT_TAB_IDS.length - 1);
  });

  test('the hidden AI Assistant tab cannot be opened from a URL', () => {
    assert.equal(AI_ASSISTANT_TAB_ENABLED, false);
    assert.equal(RESULT_TAB_IDS.includes('ai-assistant'), false);
    assert.equal(parseResultTab('ai-assistant'), DEFAULT_RESULT_TAB);
  });

  test('unknown or missing ids open Kandidat', () => {
    assert.equal(parseResultTab(null), 'candidates');
    assert.equal(parseResultTab(undefined), 'candidates');
    assert.equal(parseResultTab(''), 'candidates');
    assert.equal(parseResultTab('nope'), 'candidates');
    assert.equal(parseResultTab('konfigurasi-run'), 'konfigurasi-run');
  });
});

describe('TC-NAV Data Referensi menus', () => {
  const reference = SIDEBAR_GROUPS.find((g) => g.id === 'reference')!;

  test('Data Referensi holds Kandidat, then Dokumen and Posisi on one permission', () => {
    assert.deepEqual(
      reference.items.map((i) => [i.label, i.href, i.permission]),
      [
        ['Kandidat', '/candidates', 'candidates.view'],
        ['Dokumen', '/job-profiles', 'job_profiles.view'],
        ['Posisi', '/posisi', 'job_profiles.view'],
      ],
    );
  });

  test('Dokumen has documents, match and the dictionary — nothing about positions', () => {
    assert.deepEqual(
      JOB_PROFILES_HUB.sections.map((s) => s.label),
      ['Dokumen Job Profile', 'Job Profile Match', 'Kamus Kompetensi'],
    );
  });

  test('Posisi has only Job Family (with its hidden settings page) — Struktur Posisi is deleted', () => {
    assert.deepEqual(
      POSITION_HUB.sections.filter((s) => !s.hidden).map((s) => s.label),
      ['Job Family'],
    );
    assert.equal(POSITION_HUB.sections.some((s) => s.href.startsWith('/posisi/struktur')), false);
  });

  test('each menu lights up on its own sections only', () => {
    // By href, not by position: the group's order is a layout decision.
    const dokumen = reference.items.find((i) => i.href === '/job-profiles')!;
    const posisi = reference.items.find((i) => i.href === '/posisi')!;
    const kandidat = reference.items.find((i) => i.href === '/candidates')!;
    for (const p of ['/job-profiles', '/posisi/job-family']) assert.equal(isNavItemActive(kandidat, p), false, p);
    for (const p of ['/job-profiles', '/job-profiles/match', '/job-profiles/kamus']) {
      assert.equal(isNavItemActive(dokumen, p), true, p);
      assert.equal(isNavItemActive(posisi, p), false, p);
    }
    for (const p of ['/posisi/job-family', '/posisi/job-family/pengaturan']) {
      assert.equal(isNavItemActive(posisi, p), true, p);
      assert.equal(isNavItemActive(dokumen, p), false, p);
    }
    // "/posisi" must not light up Manajemen Posisi ("/positions") or vice versa.
    const manajemen = SIDEBAR_GROUPS.flatMap((g) => g.items).find((i) => i.href === '/positions')!;
    assert.equal(isNavItemActive(manajemen, '/posisi/job-family'), false);
    assert.equal(isNavItemActive(posisi, '/positions/abc'), false);
  });

  test('the settings page owns the header but keeps the Job Family pill lit', () => {
    const active = activeHubSection('/posisi/job-family/pengaturan', POSITION_HUB);
    assert.equal(active?.title, 'Pengaturan Job Family');
    const jobFamily = POSITION_HUB.sections.find((s) => s.label === 'Job Family')!;
    assert.equal(isHubSectionActive(jobFamily, '/posisi/job-family/pengaturan', POSITION_HUB), true);
  });

  test('the Dokumen root section is exact, so it does not shadow its siblings', () => {
    const root = JOB_PROFILES_HUB.sections[0]!;
    assert.equal(isHubSectionActive(root, '/job-profiles/match', JOB_PROFILES_HUB), false);
    assert.equal(activeHubSection('/job-profiles/kamus', JOB_PROFILES_HUB)?.label, 'Kamus Kompetensi');
  });

  test('route labels name the menu at its root and the section below it', () => {
    assert.equal(routeLabel('/job-profiles'), 'Dokumen');
    assert.equal(routeLabel('/job-profiles/match'), 'Job Profile Match');
    assert.equal(routeLabel('/posisi'), 'Posisi');
    assert.equal(routeLabel('/posisi/job-family'), 'Job Family');
    assert.equal(routeLabel('/posisi/job-family/pengaturan'), 'Pengaturan Job Family');
  });

  test('every hub section carries an explanation for its "?"', () => {
    for (const s of [...JOB_PROFILES_HUB.sections, ...POSITION_HUB.sections]) {
      assert.ok(s.description.trim().length > 20, s.href);
    }
  });
});
