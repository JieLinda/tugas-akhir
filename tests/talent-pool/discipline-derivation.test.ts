// TC-DISC-SQL — the discipline status the candidate sync derives from
// sync_disciplinary rows, run in Postgres itself (the rule is SQL). Read-only:
// the rows are a VALUES list named like the table, nothing is written.
//
//   node --import tsx --test tests/talent-pool/discipline-derivation.test.ts
//
// Skipped when no DATABASE_URL / POSTGRES_URL is set.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'dotenv/config';
import { createRequire } from 'node:module';

// Loaded untyped: the web tsconfig has no @types/pg (a known baseline gap), and
// this test must not add to it.
type PgPool = {
  query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
};
const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (cfg: { connectionString: string }) => PgPool };
import { DISCIPLINE_STATUS_SQL } from '../../sync-service/src/services/discipline-status';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const pool = url ? new Pool({ connectionString: url }) : null;
after(() => pool?.end());

/** [person, WARNING_LEVEL, EXPIRY_DATE as an interval from now (null = no date)] */
type Row = [string, number | null, string | null];

async function derive(rows: Row[]): Promise<Record<string, string>> {
  const values = rows
    .map((_, i) => `($${i * 3 + 1}::text, $${i * 3 + 2}::int, CASE WHEN $${i * 3 + 3}::text IS NULL THEN NULL ELSE now() + $${i * 3 + 3}::interval END)`)
    .join(', ');
  const { rows: out } = await pool!.query<{ who: string; status: string }>(
    `WITH sync_disciplinary(employee_id, warning_level, expiry_date) AS (VALUES ${values})
     SELECT employee_id AS who, ${DISCIPLINE_STATUS_SQL} AS status
       FROM sync_disciplinary GROUP BY employee_id`,
    rows.flat(),
  );
  return Object.fromEntries(out.map((r) => [r.who, r.status]));
}

describe('TC-DISC-SQL  DISCIPLINE_STATUS_SQL', { skip: !pool && 'no database' }, () => {
  before(async () => {
    await pool!.query('SELECT 1');
  });

  test('01 HR source codes: 1 = SP1, 2 = SP2, 3 = SP3, 4 = ST, 5 = SP Pertama & Terakhir', async () => {
    const s = await derive([
      ['sp1-active', 1, '30 days'],
      ['sp2-active', 2, '30 days'],
      ['sp3', 3, '-10 years'],
      ['st', 4, '-1 day'],
      ['spfl', 5, '-10 years'],
    ]);
    assert.deepEqual(s, {
      'sp1-active': 'ACTIVE_SP',
      'sp2-active': 'ACTIVE_SP',
      sp3: 'SP3',
      st: 'ST',
      spfl: 'SP_FIRST_LAST',
    });
  });

  test('02 SP1 and SP2 alike: active → ended < 2 years → ended ≥ 2 years, with the boundaries', async () => {
    const s = await derive([
      ['sp1-ended-1d', 1, '-1 day'],
      ['sp1-ended-just-under-2y', 1, '-2 years +1 day'],
      ['sp1-ended-just-over-2y', 1, '-2 years -1 day'],
      ['sp2-ended-1y', 2, '-1 year'],
      ['sp2-ended-5y', 2, '-5 years'],
      ['sp1-no-expiry', 1, null],
    ]);
    assert.deepEqual(s, {
      'sp1-ended-1d': 'SP_UNDER_2_YEARS',
      'sp1-ended-just-under-2y': 'SP_UNDER_2_YEARS',
      'sp1-ended-just-over-2y': 'SP_OVER_2_YEARS',
      'sp2-ended-1y': 'SP_UNDER_2_YEARS',
      'sp2-ended-5y': 'SP_OVER_2_YEARS',
      // Nothing shows it ended: active, never admitted on missing data.
      'sp1-no-expiry': 'ACTIVE_SP',
    });
  });

  test('03 the HEAVIEST record wins, in the HR order', async () => {
    const s = await derive([
      ['st+old-sp', 4, '-1 day'],
      ['st+old-sp', 2, '-5 years'],
      ['old-sp+recent-sp', 1, '-5 years'],
      ['old-sp+recent-sp', 2, '-6 months'],
      ['recent+active', 2, '-6 months'],
      ['recent+active', 1, '10 days'],
      ['active+sp3', 1, '10 days'],
      ['active+sp3', 3, '-9 years'],
      ['st-only-twice', 4, '-1 day'],
      ['st-only-twice', 4, '-3 years'],
    ]);
    assert.deepEqual(s, {
      'st+old-sp': 'SP_OVER_2_YEARS',
      'old-sp+recent-sp': 'SP_UNDER_2_YEARS',
      'recent+active': 'ACTIVE_SP',
      'active+sp3': 'SP3',
      'st-only-twice': 'ST',
    });
  });

  test('04 a code outside 1..5 counts as nothing (the upload warns about it)', async () => {
    const s = await derive([
      ['zero', 0, '10 days'],
      ['six', 6, '10 days'],
      ['null', null, '10 days'],
    ]);
    assert.deepEqual(s, { zero: 'CLEAR', six: 'CLEAR', null: 'CLEAR' });
  });
});
