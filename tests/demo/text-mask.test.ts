// TC-DEMO-TXT — demo-mode masking of job profile content and kamus kompetensi.
//
//   node --import tsx --test tests/demo/text-mask.test.ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_MASK,
  maskJobProfileExtractedData,
  maskJobProfileText,
  maskKamusText,
  maskLeadingWords,
  maskMiddleWords,
} from '../../lib/demo/text-mask';

const M = DEMO_MASK;

describe('TC-DEMO-TXT  job profile: first three words of every point', () => {
  test('TC-DEMO-TXT-01 a long point keeps its first three words', () => {
    assert.equal(
      maskLeadingWords('Menyusun rencana kerja tahunan departemen sesuai target perusahaan'),
      `Menyusun rencana kerja ${M}`,
    );
  });

  test('TC-DEMO-TXT-02 a point of three words or fewer is never shown whole', () => {
    assert.equal(maskLeadingWords('Mengelola tim penjualan'), `Mengelola tim ${M}`);
    assert.equal(maskLeadingWords('Budi Santoso'), `Budi ${M}`);
    assert.equal(maskLeadingWords('Direktur'), M);
    assert.equal(maskLeadingWords('Satu dua tiga empat'), `Satu dua tiga ${M}`);
  });

  test('TC-DEMO-TXT-03 a list marker is kept and does not spend a word', () => {
    assert.equal(maskLeadingWords('1. Tercapainya target penjualan 100% per bulan'), `1. Tercapainya target penjualan ${M}`);
    assert.equal(maskLeadingWords('- Laporan bulanan tepat waktu'), `- Laporan bulanan tepat ${M}`);
  });

  test('TC-DEMO-TXT-04 every line of a multi-line cell is its own point', () => {
    assert.equal(
      maskJobProfileText('Menyusun anggaran tahunan divisi\n\nMemonitor realisasi anggaran setiap bulan'),
      `Menyusun anggaran tahunan ${M}\n\nMemonitor realisasi anggaran ${M}`,
    );
  });

  test('TC-DEMO-TXT-05 masking twice changes nothing', () => {
    const once = maskLeadingWords('Menyusun rencana kerja tahunan departemen');
    assert.equal(maskLeadingWords(once), once);
    const short = maskLeadingWords('Budi Santoso');
    assert.equal(maskLeadingWords(short), short);
  });

  test('TC-DEMO-TXT-06 only the named sections of extracted_data are masked', () => {
    const data = {
      documentInfo: { documentNumber: 'JD-MSD-022', effectiveDate: '2024-01-01', revision: '1', pageCount: '4' },
      jobIdentity: { positionName: 'IT Application Development Analyst', divisionDepartment: 'IT', directSupervisor: 'IT Dept Head', subordinates: ['Programmer Senior'] },
      organizationStructure: { organizationChartSummary: 'Melapor langsung kepada Department Head IT Application' },
      jobSpecification: { education: 'S1 Teknik Informatika', experience: '3 tahun', gender: null, skills: ['SQL Server'] },
      behavioralCompetencies: ['Integrity'],
      technicalCompetencies: [{ competency: 'BUSINESS PROCESS ANALYSIS', level: 3 }],
      authorities: ['Menyetujui desain teknis aplikasi baru', 'Menolak'],
      jobPurpose: 'Merancang dan mengembangkan aplikasi bisnis yang andal',
      responsibilities: [
        { responsibility: 'Menganalisis kebutuhan pengguna secara menyeluruh', successIndicator: 'Dokumen kebutuhan disetujui pengguna' },
      ],
      workingRelationships: { internal: ['Departemen Finance untuk integrasi data'], external: 'Vendor aplikasi; Konsultan' },
      problemSolving: {
        references: ['SOP Pengembangan Aplikasi versi terbaru'],
        approvalRequired: ['Perubahan jadwal rilis aplikasi'],
        challenges: ['Kebutuhan pengguna yang sering berubah'],
      },
      approvals: { preparedBy: 'Budi Santoso', checkedBy: 'HC Department Head', approvedBy: null },
    };
    const out = maskJobProfileExtractedData(data) as typeof data & Record<string, any>;

    // untouched
    assert.deepEqual(out.documentInfo, data.documentInfo);
    assert.deepEqual(out.jobIdentity, data.jobIdentity);
    assert.deepEqual(out.jobSpecification, data.jobSpecification);
    assert.deepEqual(out.behavioralCompetencies, data.behavioralCompetencies);
    assert.deepEqual(out.technicalCompetencies, data.technicalCompetencies);

    // masked
    assert.equal(out.jobPurpose, `Merancang dan mengembangkan ${M}`);
    assert.equal(out.organizationStructure.organizationChartSummary, `Melapor langsung kepada ${M}`);
    assert.deepEqual(out.approvals, { preparedBy: `Budi ${M}`, checkedBy: `HC Department ${M}`, approvedBy: null });
    assert.deepEqual(out.responsibilities, [
      { responsibility: `Menganalisis kebutuhan pengguna ${M}`, successIndicator: `Dokumen kebutuhan disetujui ${M}` },
    ]);
    assert.deepEqual(out.authorities, [`Menyetujui desain teknis ${M}`, M]);
    assert.deepEqual(out.workingRelationships.internal, [`Departemen Finance untuk ${M}`]);
    // a list stored as one string is masked per point it will be displayed as
    assert.deepEqual(out.workingRelationships.external, [`Vendor ${M}`, M]);
    assert.deepEqual(out.problemSolving.references, [`SOP Pengembangan Aplikasi ${M}`]);
    assert.deepEqual(out.problemSolving.approvalRequired, [`Perubahan jadwal rilis ${M}`]);
    assert.deepEqual(out.problemSolving.challenges, [`Kebutuhan pengguna yang ${M}`]);

    // input not mutated
    assert.equal(data.jobPurpose, 'Merancang dan mengembangkan aplikasi bisnis yang andal');
  });

  test('TC-DEMO-TXT-07 a JSON string is parsed; an unparseable one becomes null', () => {
    const out = maskJobProfileExtractedData(JSON.stringify({ jobPurpose: 'Satu dua tiga empat lima' })) as Record<string, unknown>;
    assert.equal(out.jobPurpose, `Satu dua tiga ${M}`);
    assert.equal(maskJobProfileExtractedData('{not json'), null);
    assert.equal(maskJobProfileExtractedData(null), null);
  });
});

describe('TC-DEMO-TXT  kamus: first 20%, hidden 60%, last 20%', () => {
  test('TC-DEMO-TXT-10 ten words → two at each end', () => {
    assert.equal(
      maskMiddleWords('Mampu menjelaskan konsep dasar proses bisnis di unit kerjanya sendiri'),
      `Mampu menjelaskan ${M} kerjanya sendiri`,
    );
  });

  test('TC-DEMO-TXT-11 never more than 20% at either end', () => {
    for (let n = 1; n <= 40; n++) {
      const text = Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
      const shown = maskMiddleWords(text).split(' ').filter((w) => w !== M).length;
      assert.ok(shown <= 2 * Math.floor(n / 5), `n=${n} shown=${shown}`);
      assert.ok(n - shown >= Math.ceil(n * 0.6), `n=${n} hidden=${n - shown}`);
    }
  });

  test('TC-DEMO-TXT-12 under five words is hidden entirely', () => {
    assert.equal(maskMiddleWords('Memahami konsep dasar'), M);
    assert.equal(maskMiddleWords('Satu dua tiga empat lima'), `Satu ${M} lima`);
  });

  test('TC-DEMO-TXT-13 a level paragraph keeps its bullets, one mask per bullet', () => {
    const level = '• Mampu menjelaskan konsep dasar proses bisnis • Mampu memetakan alur kerja di unit kerjanya';
    assert.equal(maskKamusText(level), `Mampu ${M} bisnis • Mampu ${M} kerjanya`);
    assert.equal(maskKamusText(null), null);
    assert.equal(maskKamusText(''), '');
  });
});
