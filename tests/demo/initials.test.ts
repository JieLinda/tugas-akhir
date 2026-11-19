// TC-DEMO-INI — unique initials for candidate names in demo mode.
// The rule (HR): first letter of every word; a later candidate whose initials
// equal an earlier one's takes the SECOND letter of their last word as the
// last initial. Continued to the 3rd, 4th… letter, then numbered, so the
// guarantee "never the same initials twice" holds for any population.
//
//   node --import tsx --test tests/demo/initials.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assignUniqueInitials,
  nameLetterWords,
  nextUniqueInitials,
  plainInitials,
} from '../../lib/demo/initials';

describe('TC-DEMO-INI  initials of one name', () => {
  test('TC-DEMO-INI-01 first letter of every word, uppercased', () => {
    assert.equal(plainInitials('Budi Santoso'), 'BS');
    assert.equal(plainInitials('andi pratama putra'), 'APP');
    assert.equal(plainInitials('SUPRIYADI'), 'S');
  });

  test('TC-DEMO-INI-02 punctuation is not a letter; degrees after a comma are not the name', () => {
    assert.equal(plainInitials('M. Rizki'), 'MR');
    assert.equal(plainInitials("Ma'ruf Amin"), 'MA');
    assert.equal(plainInitials('Budi Santoso, S.Kom., M.M.'), 'BS');
    assert.equal(plainInitials('  Dewi   Anggraini  '), 'DA');
    assert.deepEqual(nameLetterWords('A - B'), [['A'], ['B']]);
  });

  test('TC-DEMO-INI-03 a name with no letters has no initials', () => {
    assert.equal(plainInitials(''), '');
    assert.equal(plainInitials(null), '');
    assert.equal(nextUniqueInitials('---', new Set()), null);
  });
});

describe('TC-DEMO-INI  uniqueness across candidates', () => {
  test('TC-DEMO-INI-10 the second candidate with the same initials takes the 2nd letter of the last word', () => {
    const out = assignUniqueInitials([
      { key: 'a', name: 'Budi Santoso' },
      { key: 'b', name: 'Bambang Sutrisno' },
    ]);
    assert.equal(out.get('a'), 'BS');
    assert.equal(out.get('b'), 'BU');
  });

  test('TC-DEMO-INI-11 a third collision continues with the 3rd letter, then the 4th', () => {
    const out = assignUniqueInitials([
      { key: 'a', name: 'Budi Santoso' }, // BS
      { key: 'b', name: 'Bambang Sutrisno' }, // BU
      { key: 'c', name: 'Bayu Sugianto' }, // BS, BU taken → BG
      { key: 'd', name: 'Bima Susilo' }, // BS, BU taken → 3rd letter S → BS taken → 4th letter I → BI
    ]);
    assert.deepEqual([...out.values()], ['BS', 'BU', 'BG', 'BI']);
  });

  test('TC-DEMO-INI-12 namesakes are two people and get two different initials', () => {
    const out = assignUniqueInitials([
      { key: 'first', name: 'Budi Santoso' },
      { key: 'second', name: 'BUDI SANTOSO' },
    ]);
    assert.equal(out.get('first'), 'BS');
    assert.equal(out.get('second'), 'BA');
  });

  test('TC-DEMO-INI-13 a collision created by the 2nd-letter step is itself resolved', () => {
    const out = assignUniqueInitials([
      { key: 'a', name: 'Budi Santoso' }, // BS
      { key: 'b', name: 'Bambang Sutrisno' }, // BU
      { key: 'c', name: 'Bagus Utomo' }, // plain BU is taken → 2nd letter of Utomo → BT
    ]);
    assert.equal(out.get('c'), 'BT');
  });

  test('TC-DEMO-INI-14 every letter of the last word taken → numbered', () => {
    const out = assignUniqueInitials([
      { key: 'a', name: 'Ali Bo' }, // AB
      { key: 'b', name: 'Agus Bo' }, // AB taken → AO
      { key: 'c', name: 'Adi Bo' }, // AB, AO taken → AB2
      { key: 'd', name: 'Ani Bo' }, // → AB3
    ]);
    assert.deepEqual([...out.values()], ['AB', 'AO', 'AB2', 'AB3']);
  });

  test('TC-DEMO-INI-15 single-word names follow the same rule on their only word', () => {
    const out = assignUniqueInitials([
      { key: 'a', name: 'Supriyadi' },
      { key: 'b', name: 'Sugianto' },
    ]);
    assert.equal(out.get('a'), 'S');
    assert.equal(out.get('b'), 'U');
  });

  test('TC-DEMO-INI-16 no two entries ever share initials (large population)', () => {
    const first = ['Budi', 'Bambang', 'Bayu', 'Bima', 'Agus', 'Andi', 'Dewi', 'Dian', 'Eko', 'Sri'];
    const last = ['Santoso', 'Sutrisno', 'Susanto', 'Setiawan', 'Saputra', 'Wijaya', 'Hidayat', 'Pratama'];
    const entries = [];
    let n = 0;
    for (let round = 0; round < 6; round++) {
      for (const f of first) for (const l of last) entries.push({ key: String(n++), name: `${f} ${l}` });
    }
    const out = assignUniqueInitials(entries);
    assert.equal(out.size, entries.length);
    assert.equal(new Set(out.values()).size, entries.length);
  });

  test('TC-DEMO-INI-17 order decides who keeps the plain initials; a duplicate key keeps its first answer', () => {
    const out = assignUniqueInitials([
      { key: 'b', name: 'Bambang Sutrisno' },
      { key: 'a', name: 'Budi Santoso' },
      { key: 'b', name: 'Bambang Sutrisno' },
    ]);
    assert.equal(out.get('b'), 'BS');
    assert.equal(out.get('a'), 'BA');
    assert.equal(out.size, 2);
  });

  test('TC-DEMO-INI-18 nameless entries get nothing and take nothing', () => {
    const out = assignUniqueInitials([
      { key: 'x', name: null },
      { key: 'a', name: 'Budi Santoso' },
    ]);
    assert.equal(out.has('x'), false);
    assert.equal(out.get('a'), 'BS');
  });
});
