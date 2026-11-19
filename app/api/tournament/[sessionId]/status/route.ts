import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { hasPermission } from '@/lib/rbac';
import { getCurrentTenantId } from '@/lib/tenant';
import { sessionsOfCurrentMode } from '@/lib/demo/run-mode';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  // The wizard is the only reader and it already requires scoring.run. This route
  // answered anyone who knew a session id, so it is gated, tenant-scoped and
  // mode-scoped (drizzle/0093) like the rest of a run.
  if (!(await hasPermission('scoring.run')) && !(await hasPermission('positions.view'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { sessionId } = await params;

  if (!sessionId || !UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
  }

  const tenantId = await getCurrentTenantId();
  // Named columns: only the progress fields leave the server, and the session's
  // `final_ranked` (which also mirrors the run's `runInfo`) is not read whole.
  const [session] = await db
    .select({
      id: schema.tournamentSessions.id,
      status: schema.tournamentSessions.status,
      scoringMethod: schema.tournamentSessions.scoringMethod,
      currentPool: schema.tournamentSessions.currentPool,
      targetFinalists: schema.tournamentSessions.targetFinalists,
      updatedAt: schema.tournamentSessions.updatedAt,
      runId: schema.tournamentSessions.runId,
      // Phase progress written by the scoring service.
      ahpProgress: sql<unknown>`${schema.tournamentSessions.finalRanked} -> 'ahpProgress'`,
    })
    .from(schema.tournamentSessions)
    .where(
      and(
        eq(schema.tournamentSessions.id, sessionId),
        eq(schema.tournamentSessions.tenantId, tenantId),
        await sessionsOfCurrentMode(),
      ),
    )
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const currentPool = (session.currentPool as string[]) ?? [];

  return NextResponse.json({
    id: session.id,
    status: session.status,
    scoringMethod: session.scoringMethod,
    currentPoolSize: currentPool.length,
    targetFinalists: session.targetFinalists,
    totalCandidates: currentPool.length,
    updatedAt: session.updatedAt,
    runId: session.runId,
    ahpProgress: session.ahpProgress ?? null,
  });
}
