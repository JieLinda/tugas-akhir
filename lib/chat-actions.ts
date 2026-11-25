'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { isDemoMode } from '@/lib/app-mode';
import { demoScrub } from '@/lib/demo/names';

// The chatbot lives on the position-detail analysis surface (position-detail-tabs
// → ChatbotPanel), so it is gated on analysis.manage. Rows are additionally
// scoped to the caller's own userId, so one user can never read another's chat.
export async function loadChatHistoryAction(runId: string) {
  await requirePermission('analysis.manage');
  const userId = await ensureLocalUser();
  const rows = await db
    .select({
      role: schema.chatMessages.role,
      content: schema.chatMessages.content,
      createdAt: schema.chatMessages.createdAt,
    })
    .from(schema.chatMessages)
    .where(and(eq(schema.chatMessages.userId, userId), eq(schema.chatMessages.runId, runId)))
    .orderBy(schema.chatMessages.createdAt);

  // `createdAt` exists for the export (lib/chat-export.ts): a transcript
  // without timestamps is not a record of anything.
  const history = rows.map((r) => ({
    role: r.role,
    content: r.content,
    createdAt: r.createdAt.toISOString(),
  }));
  if (!(await isDemoMode()) || history.length === 0) return history;
  // Demo mode: a transcript is prose about this run's candidates with no ids to
  // anchor it ("Budi lebih siap…"), so every candidate of the run is passed as
  // context and their names — whole or in part — come back as initials.
  const ranked = await db
    .select({ candidateId: schema.analysisResults.candidateId })
    .from(schema.analysisResults)
    .where(eq(schema.analysisResults.runId, runId));
  return demoScrub(history, { contextCandidateIds: ranked.map((r) => r.candidateId) });
}

export async function saveChatMessageAction(runId: string, role: string, content: string) {
  await requirePermission('analysis.manage');
  const userId = await ensureLocalUser();
  await db.insert(schema.chatMessages).values({ userId, runId, role, content });
}

export async function clearChatHistoryAction(runId: string) {
  await requirePermission('analysis.manage');
  const userId = await ensureLocalUser();
  await db
    .delete(schema.chatMessages)
    .where(and(eq(schema.chatMessages.userId, userId), eq(schema.chatMessages.runId, runId)));
  revalidatePath('/positions');
}
