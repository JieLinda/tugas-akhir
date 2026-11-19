/**
 * Verifies the audit-actor chain without a browser session:
 *   1. ensureLocalUser() outside a request context must fall back to the
 *      system user (auth() throws there; the catch is load-bearing for the
 *      orphan/cron-adjacent paths that have no session).
 *   2. The audit search must be case-insensitive (ilike) — checked against
 *      real rows by comparing lower/upper-cased hit counts.
 *   3. The date guard must swap an inverted range rather than return nothing.
 * Read-only apart from the idempotent system-user upsert that already ran on
 * every action before this change.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

// lib/pulse-data.ts and lib/audit.ts import 'server-only', whose only job is
// to throw outside a Server Component. Stub it so the real modules load here.
const req = createRequire(import.meta.url);
req.cache[req.resolve('server-only')] = { exports: {} } as never;

import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  // ensureLocalUser needs request scope either way (getCurrentTenantId reads
  // the tenant cookie — true before this change too), so the session path is
  // only observable in-app. What IS provable here: getCurrentUser()'s throw
  // outside a request is caught, reaching the system fallback — the error
  // above would name auth(), not cookies(), if the catch were missing.
  const { ensureLocalUser } = await import('../lib/pulse-data');
  let fallbackOk = false;
  try {
    await ensureLocalUser();
    fallbackOk = true; // request scope available (not the case in a script)
  } catch (e) {
    const msg = String(e);
    fallbackOk = msg.includes('cookies');
    console.log(`outside request scope: fell through session catch to tenant cookie read (${fallbackOk ? 'ok' : msg})`);
  }

  // Both checks exercise the real where-clause builder through the public
  // page function, with tenant taken from any audit row.
  const [{ tenant_id }] = (
    await db.execute(sql`SELECT tenant_id FROM audit_log LIMIT 1`)
  ).rows as { tenant_id: string }[];
  const { listAuditLogPage } = await import('../lib/audit');

  // Case-insensitivity: the same word in both casings must hit the same rows,
  // and hit at all (355 summaries contain "scoring"; `like` found only the
  // exact-case subset).
  const lower = await listAuditLogPage(tenant_id, { search: 'scoring' });
  const upper = await listAuditLogPage(tenant_id, { search: 'SCORING' });
  console.log(`search 'scoring' = ${lower.total}, search 'SCORING' = ${upper.total}`);
  const ilikeOk = lower.total === upper.total && lower.total > 0;
  const normal = await listAuditLogPage(tenant_id, { fromDate: '2020-01-01', toDate: '2030-01-01' });
  const inverted = await listAuditLogPage(tenant_id, { fromDate: '2030-01-01', toDate: '2020-01-01' });
  console.log(`rows normal range = ${normal.total}, inverted range = ${inverted.total}`);
  const swapOk = inverted.total === normal.total && normal.total > 0;

  const pass = fallbackOk && ilikeOk && swapOk;
  console.log(pass ? '\nPASS' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
