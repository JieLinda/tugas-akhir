/**
 * End-to-end timing of getJobFamilyMatchReport — the Job Profile Match tab.
 *
 * The page has no cheap gate: it is a server action behind Keycloak, so the only
 * way to time it without a browser session is to stub `requirePermission` and
 * `getCurrentTenantId` in the require cache before importing the action. That is
 * what the `stub()` calls below do; nothing else about the code path changes.
 *
 * Read-only apart from the two caches the report legitimately warms
 * (`job_family_title_embed`, `job_family_ai_match_cache`), which is why run #1
 * and run #2 are reported separately — #1 is the cold-process number a real user
 * sees after a deploy, #2 is a warm process.
 *
 * Reference numbers on this deployment (280 job profiles / 340 candidates /
 * 644 current position titles, embedding source `nomic-remote`):
 *
 *   before drizzle/0070    18465 ms cold    959 ms warm
 *   after                   1273 ms cold    542 ms warm
 *
 * with identical output both ways (matched 318 / unmatched 22 / profiles 80 /
 * positions 284) — the Float32 quantization in the vector cache moved nothing.
 */
import 'dotenv/config';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
const TENANT = '10000000-0000-0000-0000-000000000001';

function stub(spec: string, exports: Record<string, unknown>) {
  const resolved = req.resolve(spec);
  const real = (() => { try { return req(resolved); } catch { return {}; } })();
  req.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { ...real, ...exports } } as any;
}

async function main() {
  try { req.cache[req.resolve('server-only')] = { exports: {} } as any; } catch {}
  stub('../lib/rbac.ts', {
    requirePermission: async () => {},
    hasPermission: async () => true,
    getCurrentUserAccess: async () => ({ isAdmin: true, permissions: [] }),
  });
  stub('../lib/tenant.ts', { getCurrentTenantId: async () => TENANT });
  stub('next/cache', { revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: any) => f });

  const { getJobFamilyMatchReport } = await import('../lib/job-family-sync-actions');

  for (const label of ['cold process #1', 'same process #2']) {
    const t = Date.now();
    const r = await getJobFamilyMatchReport({ tenantIds: [TENANT] });
    const ms = Date.now() - t;
    console.log(`${label}: ${ms}ms  matched=${r.stats.matchedCandidates} unmatchedCand=${r.stats.unmatchedCandidates} unmatchedProf=${r.stats.unmatchedProfiles} unmatchedPos=${r.stats.unmatchedPositions} embAvail=${r.embeddingAvailable} aiAvail=${r.aiAvailable} aiDeferred=${r.aiDeferredTitles}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
