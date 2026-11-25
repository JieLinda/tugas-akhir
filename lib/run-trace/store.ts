import 'server-only';

// Writes the `pool` stage of a run's calculation trace (drizzle/0092) — what the
// web app decided before scoring-service saw the session: who was in the
// population, who the incumbent / grade gate removed, and every filter rule's
// verdict per candidate with the value it was judged on.
//
// Same rule as the engine stage (scoring-service/src/run-trace.ts): it never
// fails the run it describes.

import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import type { PoolTrace } from '../../scoring-service/src/run-trace-types';

export async function writePoolTrace(input: {
  runId: string;
  tenantId: string;
  trace: PoolTrace;
}): Promise<{ recorded: boolean; reason: string | null }> {
  let payload: string;
  try {
    payload = JSON.stringify(input.trace);
  } catch (err) {
    return { recorded: false, reason: `Jejak pool tidak dapat diserialisasi: ${String(err)}` };
  }
  if (!payload) return { recorded: false, reason: 'Jejak pool kosong.' };
  try {
    await db
      .insert(schema.scoringRunTraces)
      .values({
        runId: input.runId,
        tenantId: input.tenantId,
        stage: 'pool',
        version: input.trace.version,
        payload,
        sealed: false,
        byteSize: Buffer.byteLength(payload, 'utf8'),
      })
      .onConflictDoNothing();
    return { recorded: true, reason: null };
  } catch (err) {
    // A database without drizzle/0092 keeps creating runs exactly as before.
    const reason = err instanceof Error ? err.message : String(err);
    console.warn('[run-trace] pool trace not written:', reason);
    return { recorded: false, reason };
  }
}
