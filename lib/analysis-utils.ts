import {
  candidateProfiles,
  type CandidateProfile,
  type PositionCandidate,
} from '@/lib/talent-data';
import { formatHavQuadrant } from '@/lib/hav-quadrant';

export const readinessTone: Record<string, string> = {
  Short: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
  Medium: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
  Long: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
  'Not Ready': 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20',
};

export const readinessConsoleTone: Record<string, string> = {
  Short: 'border-sky-400/30 bg-sky-500/10 text-sky-700 dark:text-sky-200',
  Medium: 'border-amber-400/30 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  Long: 'border-lime-400/30 bg-lime-500/10 text-lime-700 dark:text-lime-200',
  'Not Ready': 'border-rose-400/30 bg-rose-500/10 text-rose-700 dark:text-rose-200',
};

export const readinessStrokeTone: Record<string, string> = {
  Short: 'stroke-sky-400',
  Medium: 'stroke-amber-400',
  Long: 'stroke-lime-400',
  'Not Ready': 'stroke-rose-400',
};

export const readinessBarTone: Record<string, string> = {
  Short: 'from-sky-400 to-blue-500',
  Medium: 'from-amber-400 to-orange-500',
  Long: 'from-lime-400 to-emerald-500',
  'Not Ready': 'from-rose-500 to-rose-700',
};

export const networkSlots = [
  { x: 18, y: 18 },
  { x: 82, y: 18 },
  { x: 10, y: 52 },
  { x: 76, y: 48 },
  { x: 22, y: 80 },
  { x: 62, y: 82 },
];

export const backdropPoints = [
  { x: 8, y: 16 },
  { x: 24, y: 10 },
  { x: 37, y: 24 },
  { x: 49, y: 14 },
  { x: 63, y: 20 },
  { x: 78, y: 13 },
  { x: 91, y: 24 },
  { x: 12, y: 38 },
  { x: 26, y: 34 },
  { x: 41, y: 48 },
  { x: 59, y: 39 },
  { x: 73, y: 42 },
  { x: 88, y: 36 },
  { x: 18, y: 66 },
  { x: 34, y: 72 },
  { x: 46, y: 62 },
  { x: 68, y: 68 },
  { x: 84, y: 74 },
  { x: 28, y: 88 },
  { x: 52, y: 84 },
  { x: 76, y: 88 },
];

export const backdropEdges = [
  [0, 8],
  [1, 8],
  [1, 4],
  [2, 8],
  [2, 7],
  [3, 9],
  [4, 10],
  [5, 10],
  [5, 11],
  [6, 12],
  [7, 13],
  [8, 9],
  [8, 14],
  [9, 10],
  [10, 11],
  [10, 15],
  [11, 12],
  [11, 16],
  [12, 16],
  [13, 18],
  [14, 19],
  [15, 19],
  [16, 20],
  [17, 20],
];

// No `qualityScore`: it was `round(0.55 × weightedScore + 0.45 × jobMatch)` with
// `jobMatch` itself `weightedScore − 5` clamped to 30..95, so it was the final
// score shifted by ~2 points (and RAISED above it below 35) under a name that
// promised an independent quality measure. Removed from every surface rather
// than relabelled — there is nothing in it to relabel.
export type AnalysisCandidate = PositionCandidate & {
  profile: CandidateProfile | null;
  readinessWindow: string;
  eligiblePrograms: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: string[];
  riskLevel?: 'Low' | 'Moderate' | 'High';
};

export const candidateProfileMap = new Map(candidateProfiles.map((profile) => [profile.id, profile]));

/**
 * The rank a ranked row is printed with — on screen, in the exports and in the
 * AI assistant's context alike, so the three cannot disagree.
 *
 * On an AHP+TOPSIS row it is the rank against the WHOLE scored pool, which the
 * engine writes into the row's details as `ahpTopsis.poolRank`. The row's index
 * is wrong there: a candidate added by name is persisted even below the finalist
 * cut, and numbering by position turns "23rd of 24" into "12". LLM runs and runs
 * finished before the field existed have no pool rank, so they fall back to the
 * position in the list as displayed (`index` is 0-based).
 */
/**
 * The HAV quadrant a ranked row prints — Kandidat chip, dossier, comparison,
 * Excel export, printed reports and the AI context all go through this, so
 * none of them can show a different quadrant from the others.
 *
 * On a run result it is the quadrant the RUN scored (see `recordedHavQuadrant`
 * in lib/run-score-breakdown.ts), not the candidate's HAV today. A row that
 * never recorded one says "tidak tercatat" rather than borrowing today's: a
 * current quadrant beside the run's HAV score would claim the score came from
 * it. `withHash` prefixes a real quadrant with "#", as the chips print it.
 */
export function runHavText(
  candidate: Pick<PositionCandidate, 'havQuadrant' | 'havQuadrantSource'>,
  options: { withHash?: boolean } = {},
): string {
  if (candidate.havQuadrantSource === 'not_recorded') return 'tidak tercatat di run';
  if (!candidate.havQuadrant) return '—';
  const text = formatHavQuadrant(candidate.havQuadrant);
  return options.withHash ? `#${text}` : text;
}

export function displayRank(candidate: PositionCandidate, index: number): number {
  const poolRank = (candidate as { ahpTopsis?: { poolRank?: unknown } }).ahpTopsis?.poolRank;
  return typeof poolRank === 'number' && Number.isFinite(poolRank) ? poolRank : index + 1;
}

export function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function getReadinessWindow(readiness: PositionCandidate['readiness']) {
  switch (readiness) {
    case 'Short':
      return '0 - 1 Year';
    case 'Medium':
      return '1 - 2 Years';
    case 'Long':
      return '3 - 5 Years';
    default:
      return '> 5 Years';
  }
}

export function getRiskLevel(candidate: PositionCandidate): AnalysisCandidate['riskLevel'] {
  if (candidate.readiness === 'Not Ready') {
    return 'High';
  }

  if (candidate.readiness === 'Long' || candidate.constraint !== 'Tidak ada constraint mayor.') {
    return 'Moderate';
  }

  return 'Low';
}

export function buildStrengths(candidate: PositionCandidate, profile: CandidateProfile | null) {
  if (candidate.strengths && candidate.strengths.length > 0) {
    return candidate.strengths;
  }
  const strengths: string[] = [];

  if (candidate.scoreBreakdown.technical >= 3) {
    strengths.push('Technical competency matches target level.');
  }

  if (candidate.scoreBreakdown.behavior >= 3 || /READY/i.test(candidate.behaviorRecommendation ?? '')) {
    strengths.push('Proven strong leadership behaviors.');
  }

  // MCU deliberately plays no part in these scoring insights: it is never read
  // into a score.
  if (candidate.primaryFilter.discipline === 'qualified') {
    strengths.push('Cleared the discipline filter.');
  }

  if ((profile?.programs.filter((program) => program.status === 'Qualified').length ?? 0) >= 2) {
    strengths.push('Qualified for multiple pipeline pools.');
  }

  // REMOVED: `jobMatch >= 85` used to push "Excellent profile-to-role match
  // score." That claimed a profile-to-role comparison had been made and had come
  // out well, when `jobMatch` is min(95, max(30, weightedScore − 5)) — the
  // candidate's own overall score. So the sentence fired for anyone scoring 90+
  // and said nothing about their fit to the job profile. Career relevance is the
  // aspect that measures that, and it already has its own axis and panel; a
  // narrative line asserting it must read that, not the aggregate. The same
  // number was later removed from the exports, the dossier, the comparison and
  // the AI context for the same reason (see `PositionCandidate.jobMatch`).

  return Array.from(new Set(strengths)).slice(0, 3);
}

export function buildWeaknesses(candidate: PositionCandidate, profile: CandidateProfile | null) {
  if (candidate.weaknesses && candidate.weaknesses.length > 0) {
    return candidate.weaknesses;
  }
  const weaknesses: string[] = [];

  if (candidate.constraint !== 'Tidak ada constraint mayor.') {
    weaknesses.push(candidate.constraint);
  }

  if (candidate.scoreBreakdown.behavior < 3) {
    weaknesses.push('Leadership exposure needs acceleration.');
  }

  if (candidate.scoreBreakdown.education < 3) {
    weaknesses.push('Educational fit lags target preference.');
  }

  if (profile?.behaviorNotes) {
    weaknesses.push('Behaviour competency requires follow-up.');
  }

  return Array.from(new Set(weaknesses)).slice(0, 3);
}

export function buildRecommendation(candidate: PositionCandidate) {
  if (candidate.recommendation && candidate.recommendation.length > 0) {
    return candidate.recommendation;
  }
  switch (candidate.readiness) {
    case 'Short':
      return ['Ready for direct succession (0-1 year window).', 'Assign as primary active successor with rotation exposure.'];
    case 'Medium':
      return ['Candidate in readiness transition (1-2 years).', 'Initiate leadership development tracks and stretch goals.'];
    case 'Long':
      return ['Pipeline placement (3-5 years timeline).', 'Target technical depth and divisional assignment goals.'];
    default:
      return ['Not ready for vacancy nominations.', 'Resolve core filter failures and skill gaps first.'];
  }
}

export function getRiskTone(level: AnalysisCandidate['riskLevel']) {
  if (level === 'Low') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400';
  }

  if (level === 'Moderate') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400';
  }

  return 'border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-400';
}
