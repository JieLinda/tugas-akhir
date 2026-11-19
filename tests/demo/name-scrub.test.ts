// TC-DEMO-SCR — demo mode replaces candidate names inside arbitrary data.
//
//   node --import tsx --test tests/demo/name-scrub.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { assignUniqueInitials } from '../../lib/demo/initials';
import {
  buildDemoNameIndex,
  normalizeName,
  scrubNamesDeep,
  scrubNamesInText,
} from '../../lib/demo/name-scrub';

const people = [
  { id: 'c-1', name: 'Budi Santoso' },
  { id: 'c-2', name: 'Bambang Sutrisno' },
  { id: 'c-3', name: 'BUDI SANTOSO' }, // a namesake: another person
  { id: 'c-4', name: 'Supriyadi' },
  { id: 'c-5', name: 'Budi Santoso Wijaya' },
  { id: 'c-6', name: 'Mulia' },
];
const initials = assignUniqueInitials(people.map((p) => ({ key: p.id, name: p.name })));
const index = buildDemoNameIndex(
  people.map((p) => ({ ...p, initials: initials.get(p.id)! })),
  { neverMatch: ['Mulia', 'MSO', 'ERRO'] },
);

describe('TC-DEMO-SCR  strings', () => {
  test('TC-DEMO-SCR-01 a string that IS a name becomes its initials, whatever its case and spacing', () => {
    assert.equal(scrubNamesInText('Budi Santoso', index), 'BS');
    assert.equal(scrubNamesInText('  budi   SANTOSO ', index), '  BS ');
    assert.equal(scrubNamesInText('Supriyadi', index), 'S');
  });

  test('TC-DEMO-SCR-02 names inside a text are replaced on whole words, punctuation kept', () => {
    assert.equal(
      scrubNamesInText('Kandidat (Budi Santoso) dan Bambang Sutrisno, keduanya siap.', index),
      'Kandidat (BS) dan BU, keduanya siap.',
    );
    assert.equal(scrubNamesInText('Budi Santosowati', index), 'Budi Santosowati');
  });

  test('TC-DEMO-SCR-03 the longest name wins', () => {
    assert.equal(scrubNamesInText('Budi Santoso Wijaya terpilih', index), `${initials.get('c-5')} terpilih`);
  });

  test('TC-DEMO-SCR-04 a single-word name is not rewritten inside prose', () => {
    assert.equal(scrubNamesInText('Supriyadi menunjukkan kinerja baik', index), 'Supriyadi menunjukkan kinerja baik');
  });

  test('TC-DEMO-SCR-05 a business-unit name is never read as a name', () => {
    assert.equal(scrubNamesInText('Mulia', index), 'Mulia');
  });

  test('TC-DEMO-SCR-06 degrees after a comma do not hide a name', () => {
    assert.equal(normalizeName('Budi Santoso, S.Kom.'), 'BUDI SANTOSO');
    // the name is replaced; the degree is not identifying and stays
    assert.equal(scrubNamesInText('Budi Santoso, S.Kom.', index), 'BS, S.Kom.');
  });
});

describe('TC-DEMO-SCR  objects', () => {
  test('TC-DEMO-SCR-10 namesakes are told apart by id', () => {
    const out = scrubNamesDeep(
      [
        { id: 'c-1', name: 'Budi Santoso', currentPosition: 'Analyst' },
        { id: 'c-3', name: 'BUDI SANTOSO', currentPosition: 'Supervisor' },
      ],
      index,
    );
    assert.deepEqual(out, [
      { id: 'c-1', name: 'BS', currentPosition: 'Analyst' },
      { id: 'c-3', name: initials.get('c-3'), currentPosition: 'Supervisor' },
    ]);
    assert.notEqual(initials.get('c-3'), 'BS');
  });

  test('TC-DEMO-SCR-11 a row pointing at a candidate gets that candidate\'s initials even for an old name', () => {
    const out = scrubNamesDeep({ candidateId: 'c-2', candidateName: 'Bambang Sutrisno (lama)', rank: 1 }, index);
    assert.deepEqual(out, { candidateId: 'c-2', candidateName: 'BU', rank: 1 });
    // the id path also covers a candidate whose name is a stop word
    assert.deepEqual(scrubNamesDeep({ id: 'c-6', name: 'Mulia' }, index), { id: 'c-6', name: initials.get('c-6') });
  });

  test('TC-DEMO-SCR-12 name keys of non-candidate rows are only touched when they hold a name', () => {
    const out = scrubNamesDeep(
      {
        program: { id: 'tpl-1', name: 'Critical Position' },
        holderName: 'BAMBANG SUTRISNO',
        label: 'Run — Budi Santoso — 2026-08-24',
        tenant: { id: 't', name: 'Mulia' },
      },
      index,
    );
    assert.deepEqual(out, {
      program: { id: 'tpl-1', name: 'Critical Position' },
      holderName: 'BU',
      label: 'Run — BS — 2026-08-24',
      tenant: { id: 't', name: 'Mulia' },
    });
  });

  test('TC-DEMO-SCR-14 a one-word name inside a sentence is replaced when the payload refers to that candidate', () => {
    const out = scrubNamesDeep(
      {
        ranking: [{ candidateId: 'c-4', name: 'Supriyadi', rank: 3 }],
        explanations: ['Supriyadi naik 2 tingkat karena bobot perilaku.'],
      },
      index,
    );
    assert.deepEqual(out.explanations, ['S naik 2 tingkat karena bobot perilaku.']);
    // …and left alone when the payload does not refer to them
    assert.deepEqual(scrubNamesDeep({ text: 'Supriyadi naik 2 tingkat' }, index), { text: 'Supriyadi naik 2 tingkat' });
  });

  test('TC-DEMO-SCR-15 inside a candidate\'s own row, a capitalised part of their name is replaced', () => {
    const out = scrubNamesDeep(
      {
        candidateId: 'c-1',
        name: 'Budi Santoso',
        strengths: ['Budi menunjukkan kepemimpinan yang kuat.', 'Pak Santoso dikenal tegas.'],
        notes: 'Menjunjung budi pekerti.',
      },
      index,
    );
    assert.deepEqual(out.strengths, ['BS menunjukkan kepemimpinan yang kuat.', 'Pak BS dikenal tegas.']);
    // lowercase is an ordinary word, not the name
    assert.equal(out.notes, 'Menjunjung budi pekerti.');
  });

  test('TC-DEMO-SCR-16 a candidate row loses its email and photo; seat fields keep shared words', () => {
    const out = scrubNamesDeep(
      {
        id: 'c-2',
        name: 'Bambang Sutrisno',
        email: 'bambang.sutrisno@mpm-motor.com',
        photoUrl: 'https://hr.example/07321.jpg',
        currentPosition: 'Kepala Cabang Sutrisno',
      },
      index,
    );
    assert.equal(out.name, 'BU');
    assert.notEqual(out.email, 'bambang.sutrisno@mpm-motor.com');
    assert.equal(out.photoUrl, null);
    assert.equal(out.currentPosition, 'Kepala Cabang Sutrisno');
  });

  test('TC-DEMO-SCR-13 dates and non-plain values pass through; the input is not mutated', () => {
    const when = new Date('2026-01-01T00:00:00Z');
    const input = { candidateId: 'c-1', name: 'Budi Santoso', at: when, nested: [{ text: 'Bambang Sutrisno' }] };
    const out = scrubNamesDeep(input, index);
    assert.equal(out.at, when);
    assert.equal(out.name, 'BS');
    assert.equal(out.nested[0]!.text, 'BU');
    assert.equal(input.name, 'Budi Santoso');
    assert.equal(input.nested[0]!.text, 'Bambang Sutrisno');
  });
});

describe('TC-DEMO-SCR  demo copies', () => {
  // A demo copy renamed c-9: the initials follow the name in force, and the
  // real name — still inside runs finished before the edit — maps to them too.
  const renamed = buildDemoNameIndex([
    { id: 'c-1', name: 'Budi Santoso', initials: 'BS' },
    { id: 'c-9', name: 'Joko Widodo', aliases: ['Hendra Gunawan'], initials: 'JW' },
    { id: 'c-8', name: 'Sutrisno', aliases: ['Supriyadi'], initials: 'S' },
  ]);

  test('TC-DEMO-SCR-20 the copy name and the real name both become the copy name\'s initials', () => {
    assert.equal(scrubNamesInText('Joko Widodo', renamed), 'JW');
    assert.equal(scrubNamesInText('Hasil Hendra Gunawan naik', renamed), 'Hasil JW naik');
    assert.deepEqual(scrubNamesDeep({ candidateId: 'c-9', name: 'Hendra Gunawan' }, renamed), { candidateId: 'c-9', name: 'JW' });
  });

  test('TC-DEMO-SCR-21 one-word names of a referenced candidate — copy and real — are caught in prose', () => {
    const out = scrubNamesDeep(
      { ranking: [{ candidateId: 'c-8', name: 'Sutrisno' }], text: ['Supriyadi turun 1 tingkat', 'Sutrisno naik'] },
      renamed,
    );
    assert.deepEqual(out.text, ['S turun 1 tingkat', 'S naik']);
  });
});
