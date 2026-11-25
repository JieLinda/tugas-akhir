/**
 * One discipline status per person from all of their sync_disciplinary rows —
 * an aggregate, so it is evaluated per GROUP BY person. The HEAVIEST record
 * wins, in the order HR set (2026-11-25), lightest → heaviest:
 *
 *   CLEAR → ST → SP_OVER_2_YEARS → SP_UNDER_2_YEARS → ACTIVE_SP → SP3 / SP_FIRST_LAST
 *
 * WARNING_LEVEL is read the way the HR source actually codes it, measured
 * against the SANCTION_GIVEN text: 1 = SP1, 2 = SP2, 3 = SP3, 4 = ST (Surat
 * Teguran), 5 = SP Pertama & Terakhir. This used to read 1 as ST and ignore 4,
 * so every SP1 counted as a Surat Teguran (and passed) while every real ST read
 * as CLEAR. SP1 and SP2 are judged alike: active while EXPIRY_DATE is today or
 * later, then "< 2 years" for two years after it, then "≥ 2 years".
 *
 * An SP1/SP2 with no EXPIRY_DATE counts as ACTIVE: nothing shows it ended, and
 * guessing it did would admit somebody on missing data. A level outside 1..5
 * counts as nothing (CLEAR); the Excel upload warns about such rows.
 *
 * Who passes is NOT decided here — that is the program's discipline filter rule
 * (lib/discipline.ts has the same order for the pickers).
 *
 * Its own dependency-free module so tests/talent-pool/discipline-derivation.test.ts
 * can run it in Postgres without loading the sync-service config.
 */
export const DISCIPLINE_STATUS_SQL = `CASE
              WHEN bool_or(warning_level = 5) THEN 'SP_FIRST_LAST'
              WHEN bool_or(warning_level = 3) THEN 'SP3'
              WHEN bool_or(warning_level IN (1, 2) AND (expiry_date IS NULL OR expiry_date >= NOW())) THEN 'ACTIVE_SP'
              WHEN bool_or(warning_level IN (1, 2) AND expiry_date >= NOW() - INTERVAL '2 years') THEN 'SP_UNDER_2_YEARS'
              WHEN bool_or(warning_level IN (1, 2)) THEN 'SP_OVER_2_YEARS'
              WHEN bool_or(warning_level = 4) THEN 'ST'
              ELSE 'CLEAR'
          END`;
