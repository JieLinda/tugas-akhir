'use server';

import { requirePermission } from '@/lib/rbac';

import { revalidatePath } from 'next/cache';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ACTIVE_SCORING_PROMPT_KEYS, isActiveScoringPromptKey } from '@/lib/scoring-prompt-keys';

export type ScoringPromptVersion = {
  version: number;
  content: string;
  summary: string | null;
  createdAt: string;
};

export type ScoringPromptEntry = {
  label: string;
  description: string;
  prompt: string;
  versions?: ScoringPromptVersion[];
};

export type ScoringPromptsData = {
  version: number;
  prompts: Record<string, ScoringPromptEntry>;
};

const PROMPTS_PATH = join(process.cwd(), 'lib', 'scoring-prompts.json');
const MAX_VERSIONS = 50;

/**
 * Only the prompts an engine still reads, in ACTIVE_SCORING_PROMPT_KEYS order.
 * Every action below reads through this, so a write drops any other key the file
 * still holds (nothing reads them).
 */
function activeOnly(data: ScoringPromptsData): ScoringPromptsData {
  const prompts: Record<string, ScoringPromptEntry> = {};
  for (const key of ACTIVE_SCORING_PROMPT_KEYS) {
    const entry = data.prompts?.[key];
    if (entry) prompts[key] = entry;
  }
  return { version: data.version ?? 1, prompts };
}

export async function getScoringPrompts(): Promise<ScoringPromptsData> {
  try {
    const raw = await readFile(PROMPTS_PATH, 'utf-8');
    return activeOnly(JSON.parse(raw) as ScoringPromptsData);
  } catch {
    return { version: 1, prompts: {} };
  }
}

/**
 * Tell the scoring service to drop its in-memory prompt cache. It loads the
 * file once and caches forever, so without this an edit only takes effect after
 * a restart. Best-effort: the file is already written, and the service picks the
 * change up on its next start regardless.
 */
async function notifyScoringServiceReload(): Promise<void> {
  const base = process.env.SCORING_SERVICE_URL;
  if (!base) return;
  try {
    await fetch(`${base.replace(/\/$/, '')}/api/scoring/_reload-prompts`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Service down / unreachable — the edit is persisted either way.
  }
}

async function writeScoringPrompts(data: ScoringPromptsData): Promise<void> {
  await writeFile(PROMPTS_PATH, JSON.stringify(activeOnly(data), null, 2), 'utf-8');
  await notifyScoringServiceReload();
}

function nextVersionNumber(versions: ScoringPromptVersion[] | undefined): number {
  return (versions ?? []).reduce((max, v) => Math.max(max, v.version), 0) + 1;
}

/**
 * Push a snapshot onto the front of a prompt's version history (newest first),
 * capping the retained history.
 */
function pushVersion(
  entry: ScoringPromptEntry,
  content: string,
  summary: string | null,
): void {
  const versions = entry.versions ?? [];
  versions.unshift({
    version: nextVersionNumber(versions),
    content,
    summary,
    createdAt: new Date().toISOString(),
  });
  entry.versions = versions.slice(0, MAX_VERSIONS);
}

export async function updateScoringPromptAction(
  key: string,
  prompt: string,
): Promise<{ success: boolean }> {
  await requirePermission('governance.manage');
  if (!isActiveScoringPromptKey(key)) return { success: false };
  const data = await getScoringPrompts();
  const entry = data.prompts[key];
  if (!entry) {
    return { success: false };
  }

  // Auto-snapshot: if the prompt is changing and the old prompt is non-empty,
  // save it as a version before overwriting.
  const oldPrompt = entry.prompt;
  if (oldPrompt && oldPrompt.trim() && oldPrompt !== prompt) {
    pushVersion(entry, oldPrompt, null);
  }

  entry.prompt = prompt;
  await writeScoringPrompts(data);
  revalidatePath('/governance');
  return { success: true };
}

export async function listScoringPromptVersions(
  key: string,
): Promise<ScoringPromptVersion[]> {
  if (!isActiveScoringPromptKey(key)) return [];
  const data = await getScoringPrompts();
  const versions = data.prompts[key]?.versions ?? [];
  // Newest first.
  return [...versions].sort((a, b) => b.version - a.version);
}

export async function saveScoringPromptVersionAction(
  formData: FormData,
): Promise<{ success: boolean }> {
  await requirePermission('governance.manage');
  const key = String(formData.get('key') ?? '');
  const content = String(formData.get('content') ?? '');
  const summary = (formData.get('summary') as string | null)?.trim() || null;

  if (!isActiveScoringPromptKey(key) || !content.trim()) return { success: false };

  const data = await getScoringPrompts();
  const entry = data.prompts[key];
  if (!entry) return { success: false };

  // Explicit checkpoint: snapshot the current editor content with a note and
  // make it the active prompt.
  pushVersion(entry, content, summary);
  entry.prompt = content;
  await writeScoringPrompts(data);
  revalidatePath('/governance');
  return { success: true };
}

export async function restoreScoringPromptVersionAction(
  formData: FormData,
): Promise<{ success: boolean; prompt?: string }> {
  await requirePermission('governance.manage');
  const key = String(formData.get('key') ?? '');
  const version = Number(formData.get('version') ?? NaN);

  if (!isActiveScoringPromptKey(key) || !Number.isFinite(version)) return { success: false };

  const data = await getScoringPrompts();
  const entry = data.prompts[key];
  if (!entry) return { success: false };

  const target = (entry.versions ?? []).find((v) => v.version === version);
  if (!target) return { success: false };

  // Snapshot the current prompt before restoring so the restore is reversible.
  if (entry.prompt && entry.prompt.trim() && entry.prompt !== target.content) {
    pushVersion(entry, entry.prompt, null);
  }
  entry.prompt = target.content;
  await writeScoringPrompts(data);
  revalidatePath('/governance');
  return { success: true, prompt: target.content };
}

export async function deleteScoringPromptVersionAction(
  formData: FormData,
): Promise<{ success: boolean }> {
  await requirePermission('governance.manage');
  const key = String(formData.get('key') ?? '');
  const version = Number(formData.get('version') ?? NaN);

  if (!isActiveScoringPromptKey(key) || !Number.isFinite(version)) return { success: false };

  const data = await getScoringPrompts();
  const entry = data.prompts[key];
  if (!entry?.versions) return { success: false };

  entry.versions = entry.versions.filter((v) => v.version !== version);
  await writeScoringPrompts(data);
  revalidatePath('/governance');
  return { success: true };
}
