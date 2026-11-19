// TC-TPL / TC-CFG — Pengaturan Job Family → Restrukturisasi Dokumen.
//
// TC-TPL pins the visual template editor (lib/job-family/template-editor.ts):
// every operation is parse → change one section → rebuild, and none of them may
// drop text the user wrote. TC-CFG pins the per-part save rule
// (lib/job-family/config.ts): a save writes one part, a profile edit never
// writes the global template, and adopting a save never discards another
// part's unsaved edit.
//
//   node --import tsx --test tests/job-family/*.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_RESTRUCTURE_TEMPLATE, restructureJobProfile } from '../../lib/job-family/restructure';
import {
  buildTemplate,
  defaultSectionText,
  enableAllSections,
  hasSectionToken,
  moveSection,
  moveSectionTo,
  parseTemplate,
  setSectionText,
  toggleSection,
} from '../../lib/job-family/template-editor';
import {
  DEFAULT_JOB_FAMILY_CONFIG,
  editProfileTemplate,
  isOverrideDirty,
  normalizeJobFamilyConfig,
  rebaseConfigDraft,
  sanitizeBertopicPatch,
  sanitizeEmbeddingPatch,
  type JobFamilyConfig,
} from '../../lib/job-family/config';

const WITH_FREE_TEXT = [
  'Ringkasan jabatan berikut:',
  'Jabatan: {{positionName}}',
  'Tujuan Jabatan: {{jobPurpose}}',
  'Tanggung Jawab:',
  '{{responsibilities}}',
  'Akhir dokumen.',
].join('\n');

describe('TC-TPL template editor', () => {
  test('TC-TPL-01 the default template survives a parse/build round trip unchanged', () => {
    assert.equal(buildTemplate(parseTemplate(DEFAULT_RESTRUCTURE_TEMPLATE)), DEFAULT_RESTRUCTURE_TEMPLATE);
  });

  test('TC-TPL-02 free text belongs to the section below it, and trailing text is kept', () => {
    const p = parseTemplate(WITH_FREE_TEXT);
    assert.deepEqual(p.order, ['positionName', 'jobPurpose', 'responsibilities']);
    assert.equal(p.blocks.positionName, 'Ringkasan jabatan berikut:\nJabatan: {{positionName}}');
    assert.equal(p.blocks.responsibilities, 'Tanggung Jawab:\n{{responsibilities}}');
    assert.equal(p.tail, 'Akhir dokumen.');
  });

  test('TC-TPL-03 moving and toggling other sections drops no free text', () => {
    let t = moveSection(WITH_FREE_TEXT, 'responsibilities', -1);
    t = toggleSection(t, 'skills');
    t = toggleSection(t, 'skills');
    for (const line of ['Ringkasan jabatan berikut:', 'Tanggung Jawab:', 'Akhir dokumen.']) {
      assert.ok(t.includes(line), `missing "${line}" in:\n${t}`);
    }
    assert.deepEqual(parseTemplate(t).order, ['positionName', 'responsibilities', 'jobPurpose']);
  });

  test('TC-TPL-04 switching a section off removes it with its heading; on appends the default text', () => {
    const off = toggleSection(WITH_FREE_TEXT, 'responsibilities');
    assert.ok(!off.includes('{{responsibilities}}'));
    assert.ok(!off.includes('Tanggung Jawab:'));
    const on = toggleSection(off, 'responsibilities');
    assert.ok(on.endsWith(`${defaultSectionText('responsibilities')}\nAkhir dokumen.`));
  });

  test('TC-TPL-05 "Aktifkan Semua" keeps order and wording, and appends only what was off', () => {
    const custom = 'Tujuan: {{jobPurpose}}\nNama jabatan: {{positionName}}';
    const all = enableAllSections(custom);
    const p = parseTemplate(all);
    assert.deepEqual(p.order.slice(0, 2), ['jobPurpose', 'positionName']);
    assert.equal(p.blocks.jobPurpose, 'Tujuan: {{jobPurpose}}');
    assert.equal(p.order.length, 15);
    assert.equal(enableAllSections(all), all);
  });

  test('TC-TPL-06 drag-and-drop and per-section text edits touch one section only', () => {
    const moved = moveSectionTo(WITH_FREE_TEXT, 'responsibilities', 'positionName');
    assert.deepEqual(parseTemplate(moved).order, ['responsibilities', 'positionName', 'jobPurpose']);
    const edited = setSectionText(WITH_FREE_TEXT, 'jobPurpose', 'Misi: {{jobPurpose}}');
    assert.equal(edited, WITH_FREE_TEXT.replace('Tujuan Jabatan: {{jobPurpose}}', 'Misi: {{jobPurpose}}'));
  });

  test('TC-TPL-07 a repeated or unknown token line is kept as free text, as the renderer reads it', () => {
    const t = 'Jabatan: {{positionName}}\nLagi: {{positionName}}\nX: {{tidakAda}}\nTujuan: {{jobPurpose}}';
    const p = parseTemplate(t);
    assert.deepEqual(p.order, ['positionName', 'jobPurpose']);
    assert.equal(p.blocks.jobPurpose, 'Lagi: {{positionName}}\nX: {{tidakAda}}\nTujuan: {{jobPurpose}}');
    const doc = restructureJobProfile({ jobIdentity: { positionName: 'Analis' }, jobPurpose: 'P' }, t);
    assert.equal(doc, 'Jabatan: Analis\nLagi: Analis\nTujuan: P');
  });

  test('TC-TPL-08 a template must name a known section', () => {
    assert.equal(hasSectionToken('Jabatan: {{positionName}}'), true);
    assert.equal(hasSectionToken('Jabatan: {{posName}}'), false);
    assert.equal(hasSectionToken(''), false);
  });
});

function cfg(over: Partial<JobFamilyConfig> = {}): JobFamilyConfig {
  return { ...DEFAULT_JOB_FAMILY_CONFIG, restructureOverrides: {}, ...over };
}

describe('TC-CFG per-part saves', () => {
  test('TC-CFG-01 editing a profile never writes the global template', () => {
    const c = cfg();
    const next = editProfileTemplate(c, '7', (t) => setSectionText(t, 'jobPurpose', 'Misi: {{jobPurpose}}'));
    assert.equal(next.restructureTemplate, c.restructureTemplate);
    assert.ok(next.restructureOverrides['7']!.includes('Misi: {{jobPurpose}}'));
    // A second edit builds on the profile's own template, not on the global one.
    const again = editProfileTemplate(next, '7', (t) => toggleSection(t, 'skills'));
    assert.ok(again.restructureOverrides['7']!.includes('Misi: {{jobPurpose}}'));
    assert.equal(again.restructureTemplate, c.restructureTemplate);
  });

  test('TC-CFG-02 adopting a save keeps unsaved edits to other parts', () => {
    const before = cfg({ restructureOverrides: { '1': 'A: {{positionName}}' } });
    const draft = cfg({
      restructureTemplate: 'Edited: {{positionName}}',
      restructureOverrides: { '1': 'A: {{positionName}}', '2': 'B: {{jobPurpose}}' },
      bertopic: { ...before.bertopic, minClusterSize: 9 },
    });
    // Only profile 2's template was saved.
    const after = cfg({ restructureOverrides: { '1': 'A: {{positionName}}', '2': 'B: {{jobPurpose}}' } });
    const rebased = rebaseConfigDraft(draft, before, after);
    assert.equal(rebased.restructureTemplate, 'Edited: {{positionName}}');
    assert.equal(rebased.bertopic.minClusterSize, 9);
    assert.equal(isOverrideDirty(rebased, after, '2'), false);
  });

  test('TC-CFG-03 a part nobody edited here takes the newly saved value', () => {
    const before = cfg();
    const draft = cfg();
    const after = cfg({
      restructureTemplate: 'Saved elsewhere: {{positionName}}',
      restructureOverrides: { '5': 'C: {{skills}}' },
      bertopic: { ...before.bertopic, nNeighbors: 30 },
    });
    assert.deepEqual(rebaseConfigDraft(draft, before, after), after);
  });

  test('TC-CFG-05 a stored config is read in today\'s shape: retired keys dropped, missing ones filled', () => {
    const stored = {
      restructureTemplate: 'Jabatan: {{positionName}}',
      embedding: { source: 'nomic-remote', model: 'm', dimensions: 768, batchSize: 32 },
      bertopic: { nNeighbors: 20, minTopicSize: 5, language: 'multilingual' },
    } as unknown as Partial<JobFamilyConfig>;
    const c = normalizeJobFamilyConfig(stored);
    assert.equal(c.bertopic.nNeighbors, 20);
    assert.equal(c.bertopic.minClusterSize, DEFAULT_JOB_FAMILY_CONFIG.bertopic.minClusterSize);
    assert.ok(!('minTopicSize' in c.bertopic) && !('language' in c.bertopic));
    assert.deepEqual(c.restructureOverrides, {});
    // What a settings card sends back from such a config passes the save's check.
    assert.deepEqual(sanitizeBertopicPatch(c.bertopic).ignored, []);
    assert.deepEqual(sanitizeEmbeddingPatch(c.embedding).ignored, []);
  });

  test('TC-CFG-04 BERTopic and embedding patches are refused field by field, never kept silently', () => {
    const b = sanitizeBertopicPatch({ minClusterSize: 7, minSamples: null, metric: 3, nope: 1, nNeighbors: Number.NaN });
    assert.deepEqual(b.clean, { minClusterSize: 7, minSamples: null });
    assert.equal(b.ignored.length, 3);
    const e = sanitizeEmbeddingPatch({ source: 'nomic-remote', dimensions: 768, batchSize: 0, restructureTemplate: 'x' });
    assert.deepEqual(e.clean, { source: 'nomic-remote', dimensions: 768 });
    assert.equal(e.ignored.length, 2);
  });
});
