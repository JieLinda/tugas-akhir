/**
 * Penerjemahan nama TINGKAT jabatan ("Staff", "Supervisor") ke rentang grade id.
 *
 * MENGAPA ADA: orang menyebut rentang kandidat dengan nama tingkat, bukan nomor
 * grade — "dari staff hingga supervisor". Wizard scoring di aplikasi memang
 * bekerja begitu: user memilih nama tingkat, dan komponennya sendiri yang
 * menurunkan angka grade-nya. Agent dulu hanya menerima `minGradeId`/`maxGradeId`
 * mentah, sehingga permintaan yang wajar berbalik menjadi pertanyaan "mohon
 * konfirmasi ID grade untuk 'Staff' dan 'Supervisor'" — meminta user
 * menerjemahkan sesuatu yang sudah bisa diterjemahkan sistem.
 *
 * Aturannya disalin PERSIS dari components/scoring/scoring-wizard.tsx: satu nama
 * tingkat memetakan ke BEBERAPA grade, jadi batas bawah memakai grade terkecil
 * tingkat itu dan batas atas memakai grade terbesar tingkat itu. Mengambil ujung
 * yang salah akan mempersempit pool tanpa ada yang sadar.
 *
 * Modul ini MURNI — tanpa `server-only`, tanpa akses basis data — supaya
 * aturannya dapat diuji terpisah. Pemanggil yang menyediakan barisnya.
 */

export type GradeLevelRow = {
  gradeId: string;
  levelName: string | null;
};

export type GradeLevelRange = {
  /** Nama tingkat apa adanya seperti tersimpan, mis. "Supervisor". */
  levelName: string;
  min: number;
  max: number;
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Rentang grade tiap nama tingkat, terurut menaik. */
export function buildGradeLevelRanges(rows: readonly GradeLevelRow[]): GradeLevelRange[] {
  const byName = new Map<string, { min: number; max: number }>();
  for (const r of rows) {
    const name = (r.levelName ?? r.gradeId ?? '').trim();
    if (!name) continue;
    const n = parseInt(r.gradeId, 10);
    if (!Number.isFinite(n)) continue;
    const cur = byName.get(name);
    byName.set(
      name,
      cur ? { min: Math.min(cur.min, n), max: Math.max(cur.max, n) } : { min: n, max: n },
    );
  }
  return [...byName.entries()]
    .map(([levelName, v]) => ({ levelName, ...v }))
    .sort((a, b) => a.min - b.min || a.levelName.localeCompare(b.levelName));
}

/**
 * Cari satu tingkat menurut sebutan user.
 *
 * Berjenjang: sama persis → awalan → substring, berhenti begitu tepat satu
 * tingkat ditemukan. Bila sebuah sebutan cocok ke lebih dari satu tingkat, TIDAK
 * ada yang dipilih — menebak antara "Supervisor" dan "Supervisor Senior" akan
 * menggeser batas pool tanpa jejak.
 */
export function findGradeLevel(
  ranges: readonly GradeLevelRange[],
  spoken: string,
): { hit: GradeLevelRange | null; ambiguous: GradeLevelRange[] } {
  const q = normalize(spoken);
  if (!q) return { hit: null, ambiguous: [] };

  const tahap = [
    ranges.filter((r) => normalize(r.levelName) === q),
    ranges.filter((r) => normalize(r.levelName).startsWith(q)),
    ranges.filter(
      (r) => normalize(r.levelName).includes(q) || q.includes(normalize(r.levelName)),
    ),
  ];
  for (const hasil of tahap) {
    if (hasil.length === 1) return { hit: hasil[0]!, ambiguous: [] };
    if (hasil.length > 1) return { hit: null, ambiguous: hasil };
  }
  return { hit: null, ambiguous: [] };
}

export type ResolvedGradeRange = {
  minGradeId: string | null;
  maxGradeId: string | null;
  /** Kalimat siap tampil tentang bagaimana rentangnya diturunkan. */
  note: string | null;
};

export function describeRanges(ranges: readonly GradeLevelRange[]): string {
  return ranges
    .map((r) =>
      r.min === r.max ? `${r.levelName} (grade ${r.min})` : `${r.levelName} (grade ${r.min}–${r.max})`,
    )
    .join(', ');
}

/**
 * Terjemahkan sebutan tingkat menjadi `minGradeId` / `maxGradeId`.
 *
 * Melempar galat yang MENYEBUTKAN pilihan yang tersedia ketika sebuah sebutan
 * tidak dikenali — itu pertanyaan yang bisa dijawab user, sedangkan "sebutkan ID
 * grade-nya" bukan.
 */
export function resolveGradeRange(
  ranges: readonly GradeLevelRange[],
  minLevel: string | null | undefined,
  maxLevel: string | null | undefined,
): ResolvedGradeRange {
  const wantMin = (minLevel ?? '').trim();
  const wantMax = (maxLevel ?? '').trim();
  if (!wantMin && !wantMax) return { minGradeId: null, maxGradeId: null, note: null };

  if (ranges.length === 0) {
    throw new Error(
      'Unit bisnis ini belum punya data tingkat jabatan (grade level) hasil sinkronisasi, jadi rentang grade tidak dapat diturunkan dari nama tingkat.',
    );
  }

  const pick = (spoken: string, sisi: 'bawah' | 'atas'): GradeLevelRange => {
    const { hit, ambiguous } = findGradeLevel(ranges, spoken);
    if (hit) return hit;
    if (ambiguous.length > 1) {
      throw new Error(
        `Sebutan tingkat "${spoken}" cocok ke lebih dari satu tingkat: ${ambiguous
          .map((r) => r.levelName)
          .join(', ')}. Sebutkan yang mana yang dimaksud untuk batas ${sisi}.`,
      );
    }
    throw new Error(
      `Tingkat jabatan "${spoken}" tidak dikenali pada unit bisnis ini. Pilihan yang tersedia: ${describeRanges(ranges)}.`,
    );
  };

  // Batas bawah memakai grade TERKECIL tingkat itu, batas atas memakai grade
  // TERBESAR — sama seperti wizard.
  const lo = wantMin ? pick(wantMin, 'bawah') : null;
  const hi = wantMax ? pick(wantMax, 'atas') : null;

  if (lo && hi && lo.min > hi.max) {
    throw new Error(
      `Rentangnya terbalik: tingkat "${lo.levelName}" (grade ${lo.min}) berada di atas "${hi.levelName}" (grade ${hi.max}). Tukar batas bawah dan atasnya.`,
    );
  }

  const bagian: string[] = [];
  if (lo) bagian.push(`${lo.levelName} → grade ${lo.min}`);
  if (hi) bagian.push(`${hi.levelName} → grade ${hi.max}`);
  const note =
    lo && hi && lo.levelName === hi.levelName
      ? `Rentang grade dibatasi pada satu tingkat ${lo.levelName} (grade ${lo.min}–${hi.max}).`
      : `Rentang grade diturunkan dari nama tingkat: ${bagian.join(', ')}.`;

  return {
    minGradeId: lo ? String(lo.min) : null,
    maxGradeId: hi ? String(hi.max) : null,
    note,
  };
}
