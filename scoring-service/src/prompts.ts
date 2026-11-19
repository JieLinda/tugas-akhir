import { readFileSync } from 'node:fs';
import { resolveSharedConfigPath } from './shared-config-path.js';

/** Re-resolved on every load so a mounted/edited file is picked up on reload. */
function promptsPath(): string | null {
  return resolveSharedConfigPath('scoring-prompts.json', process.env.SCORING_PROMPTS_PATH);
}

type PromptsData = {
  version: number;
  prompts: Record<string, {
    label: string;
    description: string;
    prompt: string;
  }>;
};

let cache: PromptsData | null = null;

function loadFile(): PromptsData {
  const path = promptsPath();
  if (!path) {
    console.warn(
      `[Prompts] WARNING: lib/scoring-prompts.json not found (set SCORING_PROMPTS_PATH or mount it); using fallback prompts.`
    );
    return { version: 1, prompts: {} };
  }
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as PromptsData;
    console.log(`[Prompts] Loaded ${Object.keys(data.prompts ?? {}).length} prompts from ${path}`);
    return data;
  } catch (err) {
    // Malformed JSON must not take scoring down — fall back to built-in prompts.
    console.warn(`[Prompts] WARNING: failed to read ${path}: ${String(err)}; using fallback prompts.`);
    return { version: 1, prompts: {} };
  }
}

export function getPrompt(key: string, fallback: string): string {
  if (!cache) cache = loadFile();
  return cache.prompts[key]?.prompt ?? fallback;
}

export function reloadPrompts(): void {
  cache = loadFile();
  console.log(`[Prompts] Reloaded ${Object.keys(cache.prompts).length} prompts`);
}
