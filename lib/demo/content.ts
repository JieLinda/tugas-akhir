import 'server-only';

import { isDemoMode } from '@/lib/app-mode';
import {
  maskJobProfileExtractedData,
  maskJobProfileText,
  maskKamusText,
  maskLeadingWords,
} from '@/lib/demo/text-mask';

/**
 * Demo mode — job profile and kamus CONTENT, masked on the server
 * (rules in lib/demo-mask.ts; switch in lib/demo-mode.ts). Every helper here
 * returns its argument untouched when demo mode is off, copies rather than
 * mutates, and is applied only to data on its way to a browser — the stored
 * job profiles and the kamus are never rewritten.
 */

type JobProfileContentRow = {
  jobPurpose?: string | null;
  extractedData?: unknown;
  rawText?: string | null;
};

function maskJobProfileRow<T extends JobProfileContentRow>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  if ('extractedData' in row) out.extractedData = maskJobProfileExtractedData(row.extractedData);
  if (typeof row.jobPurpose === 'string') out.jobPurpose = maskJobProfileText(row.jobPurpose);
  // The OCR dump is the whole document; nothing renders it, and in demo mode
  // nothing may carry it either.
  if ('rawText' in row) out.rawText = null;
  return out as T;
}

/** Job profile rows (`jobPurpose`, `extractedData`, `rawText`) for display. */
export async function demoMaskJobProfiles<T extends JobProfileContentRow>(rows: T[]): Promise<T[]> {
  if (!(await isDemoMode())) return rows;
  return rows.map(maskJobProfileRow);
}

export async function demoMaskJobProfile<T extends JobProfileContentRow>(row: T): Promise<T>;
export async function demoMaskJobProfile<T extends JobProfileContentRow>(row: T | null): Promise<T | null>;
export async function demoMaskJobProfile<T extends JobProfileContentRow>(row: T | null): Promise<T | null> {
  if (!row || !(await isDemoMode())) return row;
  return maskJobProfileRow(row);
}

/**
 * Job-profile EXCERPTS that other screens build from the same content — the Job
 * Family map's member summary (`jobPurpose`, `responsibilities`), its document
 * snippet (`documentSnippet`), and the distance panel's facets. Matched by key
 * anywhere inside `value`, so a summary nested in a member nested in a topic is
 * found without this module knowing those shapes.
 */
export async function demoMaskJobProfileExcerpts<T>(value: T): Promise<T> {
  if (!(await isDemoMode())) return value;
  const walk = (item: unknown, key: string | null): unknown => {
    if (typeof item === 'string') {
      if (key === 'jobPurpose') return maskJobProfileText(item);
      if (key === 'documentSnippet' || key === 'responsibilities') return maskLeadingWords(item);
      return item;
    }
    if (Array.isArray(item)) return item.map((child) => walk(child, key));
    if (item && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) {
        out[childKey] = walk(child, childKey);
      }
      return out;
    }
    return item;
  };
  return walk(value, null) as T;
}

type KamusContentRow = {
  description: string | null;
  levelBasic: string | null;
  levelIntermediate: string | null;
  levelAdvance: string | null;
  levelMastery: string | null;
};

/** Kamus kompetensi rows: description and the four level definitions. */
export async function demoMaskKamus<T extends KamusContentRow>(rows: T[]): Promise<T[]> {
  if (!(await isDemoMode())) return rows;
  return rows.map((row) => ({
    ...row,
    description: maskKamusText(row.description),
    levelBasic: maskKamusText(row.levelBasic),
    levelIntermediate: maskKamusText(row.levelIntermediate),
    levelAdvance: maskKamusText(row.levelAdvance),
    levelMastery: maskKamusText(row.levelMastery),
  }));
}
