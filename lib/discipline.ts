import type { DisciplineStatus } from '@/lib/db/schema';

/**
 * The discipline statuses, in ONE order: lightest first, heaviest last (HR
 * decision, 2026-11-25). Every list that offers or explains a status — the
 * candidate form, the filter-rule value picker, labels, badges — reads this, so
 * the order cannot drift between screens.
 *
 *   1 CLEAR             no record
 *   2 ST                Surat Teguran                      (source WARNING_LEVEL 4)
 *   3 SP_OVER_2_YEARS   SP1/SP2 ended ≥ 2 years ago         (level 1 or 2)
 *   4 SP_UNDER_2_YEARS  SP1/SP2 ended < 2 years ago         (level 1 or 2)
 *   5 ACTIVE_SP         SP1/SP2 still in force             (level 1 or 2)
 *   6 SP3 / SP_FIRST_LAST                                  (level 3 / 5)
 *
 * The order decides nothing by itself. Who is admitted is whatever the program's
 * discipline FILTER RULE lists (Talent Pool → Aturan Filter, Tata Kelola); this
 * order only decides how the choices are shown, so picking "everything up to X"
 * is picking a prefix of the list.
 *
 * A person with several records takes the HEAVIEST one — that is the derivation
 * in sync-service/src/services/candidate-populate.ts (DISCIPLINE_STATUS_SQL),
 * which reads the HR source codes 1 = SP1, 2 = SP2, 3 = SP3, 4 = ST,
 * 5 = SP Pertama & Terakhir (measured against SANCTION_GIVEN, 2026-11-25).
 *
 * WARNING and SANCTION are legacy hand-entered values no sync writes; they stay
 * selectable so an old row can still be matched, at the end of the list.
 *
 * Client-safe: no server-only imports.
 */
export type DisciplineLevel = {
  value: DisciplineStatus;
  /** Short label for badges and tables. */
  label: string;
  /** Longer label for pickers, where the reader is choosing a cut-off. */
  optionLabel: string;
  /** 1 = lightest. Equal ranks are equally heavy (SP3, SP_FIRST_LAST). */
  rank: number;
  /** Badge tone. */
  tone: 'good' | 'warn' | 'bad';
  legacy?: boolean;
};

export const DISCIPLINE_LEVELS: readonly DisciplineLevel[] = [
  { value: 'CLEAR', label: 'Bersih', optionLabel: 'Clear — tidak ada catatan', rank: 1, tone: 'good' },
  { value: 'ST', label: 'ST (Surat Teguran)', optionLabel: 'ST — Surat Teguran', rank: 2, tone: 'warn' },
  {
    value: 'SP_OVER_2_YEARS',
    label: 'SP1/SP2 berakhir ≥ 2 tahun',
    optionLabel: 'SP1 & SP2 tidak aktif — berakhir ≥ 2 tahun lalu',
    rank: 3,
    tone: 'warn',
  },
  {
    value: 'SP_UNDER_2_YEARS',
    label: 'SP1/SP2 berakhir < 2 tahun',
    optionLabel: 'SP1 & SP2 tidak aktif — berakhir < 2 tahun lalu',
    rank: 4,
    tone: 'bad',
  },
  { value: 'ACTIVE_SP', label: 'SP1/SP2 aktif', optionLabel: 'SP1 & SP2 aktif', rank: 5, tone: 'bad' },
  { value: 'SP3', label: 'SP3', optionLabel: 'SP3', rank: 6, tone: 'bad' },
  {
    value: 'SP_FIRST_LAST',
    label: 'SP Pertama & Terakhir',
    optionLabel: 'SP Pertama & Terakhir',
    rank: 6,
    tone: 'bad',
  },
  { value: 'WARNING', label: 'Warning', optionLabel: 'Warning (nilai lama)', rank: 7, tone: 'warn', legacy: true },
  { value: 'SANCTION', label: 'Sanksi aktif', optionLabel: 'Sanction (nilai lama)', rank: 7, tone: 'bad', legacy: true },
];

export const DISCIPLINE_STATUS_VALUES = DISCIPLINE_LEVELS.map((l) => l.value) as readonly DisciplineStatus[];

const BY_VALUE = new Map(DISCIPLINE_LEVELS.map((l) => [l.value as string, l]));

/**
 * The stored form of a discipline status: trimmed and upper-case. The filter
 * engine compares exactly, and a lower-case `clear` (the column's old default)
 * used to fail a rule listing `CLEAR` while its label still read "Bersih".
 */
export function canonicalDisciplineStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase();
}

export function disciplineLevel(value: string | null | undefined): DisciplineLevel | null {
  return BY_VALUE.get(canonicalDisciplineStatus(value)) ?? null;
}

/** Sort comparator for status values: lightest first, unknown values last. */
export function compareDisciplineStatus(a: string, b: string): number {
  const ra = disciplineLevel(a)?.rank ?? 99;
  const rb = disciplineLevel(b)?.rank ?? 99;
  return ra - rb || a.localeCompare(b);
}
