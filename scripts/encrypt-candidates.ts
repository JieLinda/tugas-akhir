import 'dotenv/config';

import { eq } from 'drizzle-orm';
import { db, pool } from '../lib/db';
import * as schema from '../lib/db/schema';
import { CANDIDATE_ENCRYPTED_KEYS, encryptCandidateRow } from '../lib/candidate-crypto';
import { ensureUnlocked, isInitialized } from '../lib/crypto/key-store';

/**
 * Backfill: encrypt every candidate row that is still stored in plaintext.
 *
 * The read path is write-through-transparent (non-"v1:" values pass through
 * decryption unchanged), so existing rows keep working — but a direct database
 * read would still show plaintext until this runs. This script seals every
 * encryptable column on every candidate row, idempotently (already-encrypted
 * values are re-sealed harmlessly; rows that are fully encrypted are skipped).
 *
 * Run once after the 0054 migration is applied and the master key is in place:
 *   pnpm tsx scripts/encrypt-candidates.ts
 */
async function main() {
  if (!(await ensureUnlocked())) {
    if (await isInitialized()) {
      console.error(
        'Encryption is initialised but no usable master key was found. ' +
          'Set PULSE_MASTER_KEY_FILE (or PULSE_MASTER_KEY) and try again.',
      );
      process.exit(1);
    }
    console.log('Encryption is not initialised — nothing to encrypt.');
    return;
  }

  const rows = await db.select().from(schema.candidates);
  console.log(`Scanning ${rows.length} candidate row(s)…`);

  let updated = 0;
  let alreadyEncrypted = 0;
  for (const row of rows) {
    const next = await encryptCandidateRow(row);
    const rowRecord = row as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    const changes: Record<string, unknown> = {};
    for (const key of CANDIDATE_ENCRYPTED_KEYS) {
      if (!(key in rowRecord)) continue;
      const before = rowRecord[key];
      // Already sealed values are left untouched — re-sealing would churn every
      // row on every run (GCM IVs are random), not just the plaintext ones.
      if (typeof before === 'string' && before.startsWith('v1:')) continue;
      const after = nextRecord[key];
      if (before === after) continue;
      changes[key] = after;
    }
    const changeCount = Object.keys(changes).length;
    if (changeCount === 0) {
      alreadyEncrypted += 1;
      continue;
    }
    await db
      .update(schema.candidates)
      .set(changes as Partial<typeof schema.candidates.$inferInsert>)
      .where(eq(schema.candidates.id, row.id));
    updated += 1;
  }

  console.log(
    `Done: ${updated} row(s) encrypted, ${alreadyEncrypted} already fully encrypted.`,
  );
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
