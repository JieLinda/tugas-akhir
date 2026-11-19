'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import * as schema from '@/lib/db/schema';
import { ensureLocalUser } from '@/lib/pulse-data';
import { requirePermission } from '@/lib/rbac';
import { decryptOrNull, encryptIfEnabled, ensureUnlocked } from '@/lib/crypto/key-store';
import { isDemoMode } from '@/lib/app-mode';
import { demoScrub } from '@/lib/demo/names';

// The chatbot lives on the position-detail analysis surface (position-detail-tabs
// → ChatbotPanel), so it is gated on analysis.manage. Rows are additionally
// scoped to the caller's own userId, so one user can never read another's chat.
//
// `content` is stored ENCRYPTED. This is the densest free-text record of
// candidate discussion in the product — an analyst asking why someone was ranked
// where they were, with the dossier quoted back — and unlike almost every other
// sensitive column it is never filtered, sorted, joined or aggregated on, so
// encrypting it costs nothing. Contrast candidates.name / employee_id / mcu_status,
// which are query keys and cannot be encrypted without breaking the product
// (see CLAUDE.md).
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

  // Load the key from disk before decrypting, so a freshly restarted process
  // renders the history instead of a wall of placeholders.
  await ensureUnlocked();

  // Degrade rather than throw when the app is locked: a chat panel that renders
  // a placeholder is recoverable, one that 500s takes the whole analysis tab
  // down. Messages written before encryption was enabled are not in the v1
  // format and pass through untouched.
  //
  // `createdAt` and `readable` exist for the export (lib/chat-export.ts): a
  // transcript without timestamps is not a record of anything, and `readable`
  // is what lets the document say a message was locked instead of quietly
  // presenting the placeholder as something the assistant said. The flag is
  // returned rather than string-matched on the client, because only this
  // function knows which text is a placeholder.
  const history = rows.map((r) => {
    const opened = decryptOrNull(r.content);
    return {
      role: r.role,
      content:
        opened.value ??
        (opened.locked
          ? '[Pesan terenkripsi — buka kunci enkripsi untuk membacanya]'
          : '[Pesan tidak dapat didekripsi]'),
      createdAt: r.createdAt.toISOString(),
      readable: opened.value != null,
    };
  });
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
  // Plaintext when encryption was never turned on (so existing installs are
  // unaffected), ciphertext when it is unlocked, and a hard error when it is
  // initialised but locked — never a silent plaintext write into a column the
  // operator believes is uniformly protected.
  await db
    .insert(schema.chatMessages)
    .values({ userId, runId, role, content: (await encryptIfEnabled(content)) ?? '' });
}

export async function clearChatHistoryAction(runId: string) {
  await requirePermission('analysis.manage');
  const userId = await ensureLocalUser();
  await db
    .delete(schema.chatMessages)
    .where(and(eq(schema.chatMessages.userId, userId), eq(schema.chatMessages.runId, runId)));
  revalidatePath('/positions');
}
