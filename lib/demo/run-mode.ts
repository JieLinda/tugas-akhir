import 'server-only';

import { eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '@/lib/db/schema';
import { isDemoMode } from '@/lib/app-mode';

// Demo runs and real runs never meet (drizzle/0093). A run, a session or a
// successor pick created in demo mode carries `is_demo = true`; every query that
// lists, aggregates or opens one is restricted to the CURRENT mode, so real mode
// never shows a demo assessment and demo mode never shows a real one (a real
// run holds candidates who are OFF in demo mode, which must not appear).

/** Drizzle condition: scoring runs of the current mode. */
export async function runsOfCurrentMode(): Promise<SQL> {
  return eq(schema.scoringRuns.isDemo, await isDemoMode());
}

/** Drizzle condition: scoring sessions (tournament_sessions) of the current mode. */
export async function sessionsOfCurrentMode(): Promise<SQL> {
  return eq(schema.tournamentSessions.isDemo, await isDemoMode());
}

/** Drizzle condition: successor picks of the current mode. */
export async function picksOfCurrentMode(): Promise<SQL> {
  return eq(schema.positionPicks.isDemo, await isDemoMode());
}

/** Raw-SQL fragment `<alias>.is_demo = <current mode>`, for hand-written queries. */
export async function isDemoSql(alias: string): Promise<SQL> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error(`invalid alias ${alias}`);
  return sql`${sql.raw(alias)}.is_demo = ${await isDemoMode()}`;
}
