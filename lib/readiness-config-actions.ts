'use server';

import { requirePermission } from '@/lib/rbac';

import { revalidatePath } from 'next/cache';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type ReadinessThreshold = {
  minScore: number;
  level: string;
  eta: string;
  description: string;
};

export type ReadinessConfig = {
  thresholds: ReadinessThreshold[];
  defaultLevel: string;
};

const CONFIG_PATH = join(process.cwd(), 'lib', 'readiness-config.json');

const DEFAULT_CONFIG: ReadinessConfig = {
  thresholds: [
    { minScore: 80, level: 'Short', eta: '0 - 1 tahun', description: 'Siap untuk suksesi dalam waktu dekat' },
    { minScore: 65, level: 'Medium', eta: '1 - 2 tahun', description: 'Siap dengan pengembangan tambahan' },
    { minScore: 50, level: 'Long', eta: '3 - 5 tahun', description: 'Potensi tinggi namun perlu pengembangan intensif' },
  ],
  defaultLevel: 'Not Ready',
};

export async function getReadinessConfig(): Promise<ReadinessConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as ReadinessConfig;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function updateReadinessConfigAction(
  thresholds: ReadinessThreshold[],
  defaultLevel: string,
): Promise<{ success: boolean }> {
  await requirePermission('governance.manage');
  const validated = thresholds
    .filter((t) => t.minScore >= 0 && t.minScore <= 100)
    .sort((a, b) => b.minScore - a.minScore);

  await writeFile(
    CONFIG_PATH,
    JSON.stringify({ thresholds: validated, defaultLevel }, null, 2),
    'utf-8',
  );

  // The scoring service caches these thresholds in memory; without this the new
  // values only apply after a restart. Best-effort — the file is already saved.
  const base = process.env.SCORING_SERVICE_URL;
  if (base) {
    try {
      await fetch(`${base.replace(/\/$/, '')}/api/scoring/_reload-readiness`, {
        method: 'POST',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Service unreachable — thresholds still take effect on its next start.
    }
  }

  revalidatePath('/governance');
  return { success: true };
}

export async function resolveReadiness(
  score: number,
  config: ReadinessConfig = DEFAULT_CONFIG,
): Promise<string> {
  for (const t of config.thresholds) {
    if (score >= t.minScore) return t.level;
  }
  return config.defaultLevel;
}
