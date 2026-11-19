/**
 * Isian default sebuah posisi, diturunkan dari data yang sudah ada.
 *
 * MENGAPA ADA: form "Tambah Posisi" di aplikasi tidak menuntut user
 * mengetik pemangku jabatan, pendidikan, dan job family — begitu jabatan sasaran
 * dipilih, ketiganya terisi sendiri dari dokumen job profile yang cocok
 * (jalur Job Profile Match) dan dari jabatan master hasil sinkronisasi. Agent
 * dulu tidak punya jalur itu, sehingga permintaan yang wajar ("tambah posisi
 * untuk Data Engineering Analyst") berbalik menjadi empat pertanyaan
 * yang jawabannya sebetulnya sudah ada di basis data.
 *
 * Modul ini menyediakan jalur itu untuk pemakai non-UI. Ia TIDAK menulis apa
 * pun, dan setiap field yang dihasilkannya membawa asal-usulnya, karena isian
 * otomatis yang tidak bisa ditelusuri lebih buruk daripada isian kosong: user
 * tidak punya cara tahu mana yang perlu dikoreksi.
 */

import 'server-only';

import { and, eq, ilike, or, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { suggestJobProfileForSelectionAction } from '@/lib/job-profile-actions';
import { getGradeLevelsForTenant } from '@/lib/pulse-data';

export type DefaultField<T> = {
  value: T;
  /** Dari mana nilainya berasal — ditampilkan ke user apa adanya. */
  source: string | null;
};

export type PositionManagementDefaults = {
  matchedPositionId: string | null;
  matchedTitle: string | null;
  department: DefaultField<string>;
  division: DefaultField<string>;
  holderName: DefaultField<string>;
  holderEmployeeId: DefaultField<string>;
  education: DefaultField<string>;
  experience: DefaultField<string>;
  jobFamily: DefaultField<string>;
  minGradeId: DefaultField<string>;
  maxGradeId: DefaultField<string>;
  /** Field yang tetap kosong — inilah yang layak ditanyakan ke user. */
  missing: string[];
  notes: string[];
};

const kosong = (): DefaultField<string> => ({ value: '', source: null });

/**
 * Cari jabatan master yang paling cocok dengan sebuah judul.
 *
 * Kecocokan persis lebih dulu, baru substring. Sengaja mengembalikan SATU
 * saja dan menandai bila ada beberapa yang cocok — memilih diam-diam di antara
 * dua jabatan yang mirip akan mengisi grade dan pemangku jabatan dari jabatan
 * yang salah.
 */
async function findMasterPosition(title: string, tenantId: string) {
  const t = title.trim();
  if (!t) return { row: null, ambiguous: 0 };

  const rows = await db
    .select({
      id: schema.positions.id,
      internalTitle: schema.positions.internalTitle,
      externalTitle: schema.positions.externalTitle,
      department: schema.positions.department,
      division: schema.positions.division,
      gradeId: schema.positions.gradeId,
    })
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.tenantId, tenantId),
        or(
          ilike(schema.positions.internalTitle, t),
          ilike(schema.positions.externalTitle, t),
          ilike(schema.positions.internalTitle, `%${t}%`),
          ilike(schema.positions.externalTitle, `%${t}%`),
        ),
      ),
    )
    .limit(10);

  if (rows.length === 0) return { row: null, ambiguous: 0 };
  const norm = (s: string | null) => (s ?? '').trim().toLowerCase();
  const exact = rows.filter((r) => norm(r.internalTitle) === t.toLowerCase() || norm(r.externalTitle) === t.toLowerCase());
  const pool = exact.length > 0 ? exact : rows;
  return { row: pool[0]!, ambiguous: pool.length };
}

/**
 * Rentang grade kandidat.
 *
 * Ini satu-satunya field yang TIDAK punya padanan otomatis di form web — di
 * sana user memilihnya dari daftar. Turunannya di sini karena itu ditulis
 * eksplisit sebagai aturan, bukan disamarkan sebagai "data": kandidat suksesi
 * diambil dari grade jabatan itu sendiri sampai satu tingkat di bawahnya, yaitu
 * rentang yang paling sering dipakai pada posisi yang sudah ada. Selalu
 * dilaporkan sebagai turunan supaya user tahu inilah yang paling perlu dicek.
 */
async function gradeRange(
  gradeId: string | null,
  tenantId: string,
): Promise<{ min: DefaultField<string>; max: DefaultField<string>; note: string | null }> {
  if (!gradeId) return { min: kosong(), max: kosong(), note: null };
  const levels = await getGradeLevelsForTenant(tenantId);
  const ids = levels.map((l) => l.gradeId);
  const idx = ids.indexOf(gradeId);
  if (idx === -1) {
    return {
      min: { value: gradeId, source: `grade jabatan (${gradeId})` },
      max: { value: gradeId, source: `grade jabatan (${gradeId})` },
      note: `Grade "${gradeId}" tidak ada pada daftar grade unit bisnis ini, jadi rentangnya dipersempit ke grade itu saja.`,
    };
  }
  // Daftar grade terurut menaik menurut levelId; "satu tingkat di bawah"
  // adalah indeks sebelumnya bila ada.
  const bawah = levels[Math.max(0, idx - 1)]!;
  return {
    min: { value: bawah.gradeId, source: `satu tingkat di bawah grade jabatan (${gradeId})` },
    max: { value: gradeId, source: `grade jabatan menurut data sinkronisasi` },
    note:
      'Rentang grade adalah TURUNAN, bukan data tersimpan: diambil dari grade jabatan sampai satu tingkat di bawahnya. Periksa dan sesuaikan bila kebijakan suksesi jabatan ini berbeda.',
  };
}

export async function buildPositionManagementDefaults(
  input: { title: string; masterPositionId?: string | null },
  tenantId: string,
): Promise<PositionManagementDefaults> {
  const title = String(input.title ?? '').trim();
  const notes: string[] = [];

  let master: {
    id: string;
    internalTitle: string | null;
    externalTitle: string | null;
    department: string | null;
    division: string | null;
    gradeId: string | null;
  } | null = null;

  if (input.masterPositionId) {
    const [row] = await db
      .select({
        id: schema.positions.id,
        internalTitle: schema.positions.internalTitle,
        externalTitle: schema.positions.externalTitle,
        department: schema.positions.department,
        division: schema.positions.division,
        gradeId: schema.positions.gradeId,
      })
      .from(schema.positions)
      .where(
        and(eq(schema.positions.id, input.masterPositionId), eq(schema.positions.tenantId, tenantId)),
      )
      .limit(1);
    master = row ?? null;
    if (!master) notes.push('Jabatan master yang disebut tidak ada pada unit bisnis ini.');
  } else {
    const found = await findMasterPosition(title, tenantId);
    master = found.row;
    if (found.ambiguous > 1) {
      notes.push(
        `Ada ${found.ambiguous} jabatan master yang cocok dengan "${title}"; yang pertama dipakai. Sebutkan jabatan yang tepat bila keliru.`,
      );
    }
    if (!master) {
      notes.push(
        `Tidak ada jabatan master bernama "${title}" pada data sinkronisasi, jadi departemen, divisi, pemangku jabatan, dan rentang grade tidak dapat diisi otomatis.`,
      );
    }
  }

  // Pemangku jabatan: siapa yang saat ini menduduki jabatan master itu.
  let holderName = kosong();
  let holderEmployeeId = kosong();
  if (master) {
    // Pemangku jabatan dibaca lewat sync_employee_positions, yang memetakan NPK
    // ke position_id jabatan master — jalur yang sama dengan yang dipakai
    // aplikasi. `primary_position` diutamakan: seorang karyawan bisa tercatat
    // pada beberapa jabatan, dan yang menduduki jabatan ini adalah yang primer.
    const res = await db.execute(sql`
      SELECT se.display_name AS "name", se.employee_id AS "employeeId"
      FROM sync_employee_positions sep
      JOIN sync_employees se ON se.employee_id = sep.employee_id
      JOIN positions p ON p.position_id = sep.position_id
      WHERE p.id = ${master.id} AND p.tenant_id = ${tenantId}
      ORDER BY sep.primary_position DESC NULLS LAST, se.display_name
      LIMIT 2
    `);
    const rows = res.rows as Array<{ name: string | null; employeeId: string | null }>;
    if (rows.length > 0 && rows[0]!.name) {
      holderName = { value: rows[0]!.name!, source: 'pemangku jabatan saat ini (data karyawan)' };
      if (rows[0]!.employeeId) {
        holderEmployeeId = { value: rows[0]!.employeeId!, source: 'NPK pemangku jabatan' };
      }
      if (rows.length > 1) {
        notes.push('Jabatan ini punya lebih dari satu pemangku; yang pertama dipakai.');
      }
    } else {
      notes.push('Tidak ada karyawan yang tercatat menduduki jabatan ini, jadi pemangku jabatan kosong.');
    }
  }

  // Kualifikasi: dari dokumen job profile yang cocok — jalur Job Profile Match
  // yang sama dengan yang dipakai form di aplikasi.
  let education = kosong();
  let experience = kosong();
  let jobFamily = kosong();
  const saran = await suggestJobProfileForSelectionAction({
    masterPositionId: master?.id ?? null,
    titleFallback: title || null,
  });
  if (saran.jobProfileId && saran.extractedData) {
    const data = saran.extractedData as Record<string, unknown>;
    const spec = (data.jobSpecification ?? {}) as Record<string, unknown>;
    const asal = `dokumen job profile "${saran.positionName ?? title}"`;
    if (typeof spec.education === 'string' && spec.education.trim()) {
      education = { value: spec.education.trim(), source: asal };
    }
    if (typeof spec.experience === 'string' && spec.experience.trim()) {
      experience = { value: spec.experience.trim(), source: asal };
    }
  } else {
    notes.push(
      'Tidak ada dokumen job profile yang cocok dengan jabatan ini, jadi kualifikasi pendidikan dan pengalaman tidak dapat diisi otomatis.',
    );
  }

  // Job family: dari hasil pengelompokan, bila dokumennya sudah terpetakan.
  if (saran.jobProfileId) {
    // Penugasan topik run TERBARU: topicId hanya bermakna di dalam satu run,
    // jadi mengambil baris terbaru tanpa mengikat run-nya akan mencampur peta.
    const res = await db.execute(sql`
      SELECT COALESCE(t.general_title, t.label) AS "family"
      FROM job_family_topic_assignments a
      JOIN job_family_topics t ON t.run_id = a.run_id AND t.topic_id = a.topic_id
      WHERE a.job_profile_id = ${saran.jobProfileId} AND a.topic_id >= 0
      ORDER BY a.created_at DESC
      LIMIT 1
    `);
    const fam = (res.rows as Array<{ family: string | null }>)[0]?.family;
    if (fam) jobFamily = { value: fam, source: 'hasil pengelompokan job family' };
  }
  if (!jobFamily.value && master?.division) {
    jobFamily = { value: master.division, source: 'divisi jabatan (job family belum terpetakan)' };
  }

  const grade = await gradeRange(master?.gradeId ?? null, tenantId);
  if (grade.note) notes.push(grade.note);

  const out: PositionManagementDefaults = {
    matchedPositionId: master?.id ?? null,
    matchedTitle: master ? (master.internalTitle ?? master.externalTitle ?? title) : null,
    department: master?.department
      ? { value: master.department, source: 'jabatan master' }
      : kosong(),
    division: master?.division ? { value: master.division, source: 'jabatan master' } : kosong(),
    holderName,
    holderEmployeeId,
    education,
    experience,
    jobFamily,
    minGradeId: grade.min,
    maxGradeId: grade.max,
    missing: [],
    notes,
  };

  // Field WAJIB yang tetap kosong — inilah, dan hanya inilah, yang layak
  // ditanyakan ke user.
  out.missing = (
    [
      ['holderName', out.holderName],
      ['education', out.education],
      ['jobFamily', out.jobFamily],
      ['minGradeId', out.minGradeId],
      ['maxGradeId', out.maxGradeId],
    ] as const
  )
    .filter(([, f]) => !f.value)
    .map(([k]) => k);

  return out;
}
