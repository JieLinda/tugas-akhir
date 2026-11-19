'use server';

import { readFile, writeFile } from 'node:fs/promises';
import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/rbac';
import {
  DEFAULT_RETIREMENT_CONFIG,
  RETIREMENT_CONFIG_PATH,
  normalizeRetirementConfig,
  type RetirementConfig,
} from '@/lib/retirement-config';

export async function getRetirementConfigAction(): Promise<RetirementConfig> {
  try {
    return normalizeRetirementConfig(JSON.parse(await readFile(RETIREMENT_CONFIG_PATH, 'utf-8')));
  } catch {
    return DEFAULT_RETIREMENT_CONFIG;
  }
}

export async function updateRetirementConfigAction(
  config: RetirementConfig,
): Promise<{ success: boolean; error?: string }> {
  await requirePermission('governance.manage');
  // Normalized before writing, not after reading: a bad value saved once would
  // otherwise be re-validated on every render for the rest of its life.
  const normalized = normalizeRetirementConfig(config);
  if (Object.keys(normalized.byLevel).length === 0) {
    return { success: false, error: 'Minimal satu level harus punya batas usia.' };
  }
  try {
    await writeFile(RETIREMENT_CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Gagal menyimpan konfigurasi.' };
  }
  revalidatePath('/positions');
  revalidatePath('/governance');
  return { success: true };
}
