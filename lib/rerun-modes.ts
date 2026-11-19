// ── Re-run modes: one that can be created, four that can only be read ─────
//
// A derived run answers exactly one question: "what does this ranking look like
// with these extra people in it?" Everything else about the parent run is
// FROZEN — the six aspect scores and raw inputs of every carried-over candidate,
// the AHP weights after redistribution, the active criteria, program / position /
// level range / filter rules, the calibration anchors and the reference date —
// so the ONLY thing that can move a carried-over candidate is the changed
// alternative set (TOPSIS is set-relative at the column norms and at the ideal /
// anti-ideal solutions). See "Re-run scoring — aturan desain" in CLAUDE.md.
//
// That is `incremental_add`, labelled "Tambah Kandidat Pembanding". The other
// four modes this table used to offer each mixed a second cause into the
// comparison (today's data, a narrower pool, live weights), and are no longer
// created: newer data or a newer configuration is a new ROOT run (the wizard, or
// "Scoring Ulang" for a program). They stay here as LEGACY rows because runs
// carrying them exist and must keep rendering — in the run tree, the ancestry
// breadcrumb and the configuration panel — with the sentence they were made
// under.
//
// Deliberately free of `server-only` and of any DB import: the dialog, the tree
// and the badges all read this table on the client.

export type RerunMode =
  | 'baseline'
  | 'incremental_add'
  | 'refresh_add'
  | 'exclude'
  | 'finalists_rematch'
  | 'refresh_full';

/** The only mode a user can start from a finished run. */
export const CREATABLE_RERUN_MODES = ['incremental_add'] as const;
export type CreatableRerunMode = (typeof CREATABLE_RERUN_MODES)[number];

/**
 * Modes that existed and can no longer be created. READ-ONLY: `rerunSpec()`
 * resolves them so old runs keep their label, chip and sentence.
 */
export const LEGACY_RERUN_MODES = [
  'refresh_add',
  'exclude',
  'finalists_rematch',
  'refresh_full',
] as const;
export type LegacyRerunMode = (typeof LEGACY_RERUN_MODES)[number];

export type RerunModeSpec = {
  mode: RerunMode;
  /** Full name, used as the dialog title and the tree node tooltip. */
  label: string;
  /** Two or three words — the chip on a tree node and in the run picker. */
  chip: string;
  /** The delta fragment that opens a derived run's label, e.g. "+2 kandidat". */
  delta: (counts: { added: number; excluded: number }) => string;
  /** One sentence: what this mode DOES. */
  description: string;
  /** One sentence: what may move the ranking, and therefore what may not. */
  expectation: string;
  /**
   * True for a mode that can no longer be created. Old runs carrying it still
   * resolve to this row — the run tree labels them "mode lama".
   */
  legacy: boolean;
  /** Tailwind tone key — see RERUN_TONE. */
  tone: 'emerald' | 'sky' | 'rose' | 'violet' | 'amber' | 'slate';
};

const n = (v: number) => (Number.isFinite(v) ? v : 0);

export const RERUN_MODES: Record<RerunMode, RerunModeSpec> = {
  baseline: {
    mode: 'baseline',
    label: 'Run awal',
    chip: 'Run awal',
    delta: () => '',
    description:
      'Penilaian dari nol: pool dibangun dari seluruh kandidat business unit terkait, disaring rentang level dan filter program, lalu keenam kriteria dihitung.',
    expectation: 'Tidak ada run induk — ini titik awal perbandingan.',
    legacy: false,
    tone: 'slate',
  },

  incremental_add: {
    mode: 'incremental_add',
    label: 'Tambah Kandidat Pembanding',
    chip: 'Pembanding',
    // Kept as "+N kandidat": `DELTA_SEGMENT` in lib/run-label.ts recognises it,
    // and every label already written by this mode uses it.
    delta: ({ added }) => `+${n(added)} kandidat`,
    description:
      'Run induk dibekukan apa adanya — keenam skor aspek dan data mentah kandidat lama, bobot AHP setelah pembagian ulang, kriteria aktif, aturan filter, jangkar kalibrasi, dan tanggal acuan. Hanya kandidat yang belum ada di pool induk yang dinilai; TOPSIS dihitung ulang atas gabungannya.',
    expectation:
      'Perubahan peringkat murni dipicu oleh bertambahnya himpunan alternatif — data dan bobot kandidat lain tidak berubah.',
    legacy: false,
    tone: 'emerald',
  },

  refresh_add: {
    mode: 'refresh_add',
    label: 'Tambah kandidat + data terbaru',
    chip: 'Tambah + refresh',
    delta: ({ added }) => `+${n(added)} kandidat (data terbaru)`,
    description:
      'Pool yang sama dengan run dasar ditambah kandidat pilihan, tetapi keenam kriteria SELURUH kandidat dihitung ulang dari data HR saat run ini dibuat.',
    expectation:
      'Perubahan peringkat dapat dipicu oleh kandidat yang ditambahkan MAUPUN oleh perubahan data seluruh kandidat sejak run dasar.',
    legacy: true,
    tone: 'sky',
  },

  exclude: {
    mode: 'exclude',
    label: 'Kecualikan kandidat',
    chip: 'Kecualikan',
    delta: ({ excluded }) => `\u2212${n(excluded)} kandidat`,
    description:
      'Kandidat yang dikecualikan dikeluarkan dari himpunan alternatif. Tidak ada yang dinilai ulang — skor aspek kandidat yang tersisa diambil dari run dasar.',
    expectation:
      'Perubahan peringkat dipicu oleh menyempitnya himpunan alternatif (TOPSIS bersifat relatif terhadap isi pool), bukan oleh data yang berubah.',
    legacy: true,
    tone: 'rose',
  },

  finalists_rematch: {
    mode: 'finalists_rematch',
    label: 'Tanding ulang finalis',
    chip: 'Tanding finalis',
    delta: () => 'tanding finalis',
    description:
      'Hanya finalis run dasar yang dipertandingkan ulang, dengan keenam kriteria dihitung ulang dari data HR saat run ini dibuat.',
    expectation:
      'Peringkat TIDAK setara dengan run dasar: himpunan alternatifnya jauh lebih sempit dan seragam tinggi, sehingga solusi ideal/anti-ideal saling mendekat dan beda kecil ikut membesar.',
    legacy: true,
    tone: 'violet',
  },

  refresh_full: {
    mode: 'refresh_full',
    label: 'Hitung ulang dengan data terbaru',
    chip: 'Data terbaru',
    delta: () => 'data terbaru',
    description:
      'Pool dibangun ulang memakai program, posisi, rentang level dan filter yang sama seperti run dasar, tetapi atas data saat run ini dibuat. Semua dinilai ulang.',
    expectation:
      'Perubahan peringkat dapat dipicu oleh perubahan data HR mana pun dan oleh berubahnya keanggotaan pool.',
    legacy: true,
    tone: 'amber',
  },
};

export function isRerunMode(value: unknown): value is RerunMode {
  return typeof value === 'string' && value in RERUN_MODES;
}

/** True only for a mode a user may start today. */
export function isCreatableRerunMode(value: unknown): value is CreatableRerunMode {
  return (
    typeof value === 'string' &&
    (CREATABLE_RERUN_MODES as readonly string[]).includes(value)
  );
}

/** True for a mode that old runs carry but nothing creates any more. */
export function isLegacyRerunMode(value: unknown): value is LegacyRerunMode {
  return (
    typeof value === 'string' &&
    (LEGACY_RERUN_MODES as readonly string[]).includes(value)
  );
}

/**
 * Never throws and never invents a mode: an unknown/absent value resolves to
 * `baseline`, which is also what every run created before this column existed
 * is, structurally — it has no parent. LEGACY modes resolve to their own row.
 */
export function rerunSpec(mode: unknown): RerunModeSpec {
  return isRerunMode(mode) ? RERUN_MODES[mode] : RERUN_MODES.baseline;
}

/** Tailwind classes per tone — one place, so a chip and a tree node agree. */
export const RERUN_TONE: Record<
  RerunModeSpec['tone'],
  { chip: string; dot: string; line: string; soft: string }
> = {
  emerald: {
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    line: 'border-emerald-500/40',
    soft: 'bg-emerald-500/5',
  },
  sky: {
    chip: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    dot: 'bg-sky-500',
    line: 'border-sky-500/40',
    soft: 'bg-sky-500/5',
  },
  rose: {
    chip: 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    dot: 'bg-rose-500',
    line: 'border-rose-500/40',
    soft: 'bg-rose-500/5',
  },
  violet: {
    chip: 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    dot: 'bg-violet-500',
    line: 'border-violet-500/40',
    soft: 'bg-violet-500/5',
  },
  amber: {
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    line: 'border-amber-500/40',
    soft: 'bg-amber-500/5',
  },
  slate: {
    chip: 'border-slate-400/40 bg-slate-400/10 text-slate-600 dark:text-slate-300',
    dot: 'bg-slate-400',
    line: 'border-slate-400/40',
    soft: 'bg-slate-400/5',
  },
};

/** The six AHP criteria, in the row/column order of every stored matrix. */
export type RerunCriterionKey =
  | 'technical'
  | 'career'
  | 'behavior'
  | 'performance'
  | 'hav'
  | 'education';

/**
 * Everything a derived run inherits from its parent beyond the aspect scores —
 * resolved ONCE, by the web app, when the child is created, and handed to the
 * scoring service inside `AhpRerunSpec.frozen`. The service applies these
 * values instead of reading their live counterparts. Mirrored in
 * `scoring-service/src/rerun-freeze.ts` (separate deployable, no shared lib);
 * the two must change together.
 *
 * A part the parent never recorded is `null` with `source: 'live_fallback'`: the
 * service resolves it live, records the value it used in the child's own
 * `run_info.frozen`, and a grandchild inherits THAT — so the chain is still
 * frozen from the child onward, and the fallback is said, not hidden.
 */
export type FrozenRunBasis = {
  version: 1;
  /** The top of the lineage; carried-over candidates always hold its values. */
  rootRunId: string;
  parentRunId: string;
  /**
   * The instant stint ages are measured to (career recency decay, Pers. 2.5,
   * and the tenure of an ongoing stint). Independent of when the new
   * candidates' data was pulled, which is `dataPulledAt` on the run snapshot.
   */
  referenceDate: string;
  /** `parent_frozen` = the parent recorded it; `parent_completed_at` = derived from when the parent finished. */
  referenceDateSource: 'parent_frozen' | 'parent_completed_at';
  ahp: {
    /** Full-precision priority vector the parent ranked with, before redistribution. */
    weights: Record<RerunCriterionKey, number> | null;
    pairwise: number[][] | null;
    /** Criteria in the parent's TOPSIS matrix. Never re-evaluated in a child. */
    activeCriteria: RerunCriterionKey[] | null;
    droppedCriteria: { key: RerunCriterionKey; reason: string }[] | null;
    /** The parent's own weight source label, for display. */
    weightSource: string | null;
    source: 'parent' | 'live_fallback';
    /**
     * The parent's own CR / λmax / CI. Never recomputed from the stored matrix,
     * which an older parent rounded to 4 decimals. Absent on older bases.
     */
    consistency?: { cr: number; lambdaMax: number; ci: number } | null;
  };
  anchors: {
    technical: { simFloor: number; simCeil: number; source: string } | null;
    career: { simFloor: number; simCeil: number; source: string } | null;
    /** Career depth yardstick (T_tahun, T_stint). */
    depth: { targetYears: number; targetRows: number } | null;
    source: 'parent' | 'live_fallback';
  };
  /**
   * What the target seat demanded when the parent was scored (FR-RR-07): job
   * profile, competency reference, education requirement, career target vector,
   * kamus fingerprint, embedding model — as VALUES. The child scores its new
   * candidates against exactly this. Null when the parent recorded none (a run
   * from before this change); the service then resolves live and says so.
   */
  positionBasis?: FrozenPositionBasis | null;
  /** The models the parent used, so the child can report a model that moved. */
  models?: RunModelsRecord | null;
  /** How long the web app spent validating and classifying the request (ms). */
  validationMs?: number | null;
};

/**
 * Mirror of `PositionBasis` in scoring-service/src/position-basis.ts. The web
 * app reads it from the parent's `run_info.frozen.positionBasis` and passes it
 * through untouched; only the service interprets it for scoring.
 */
export type FrozenPositionBasis = {
  version: 1;
  resolvedByRunId: string;
  resolvedAt: string;
  originSource: 'own' | 'live_fallback';
  jobProfile: {
    id: number | null;
    matchTier: 'jfm' | 'exact' | 'substring' | 'embedding' | null;
    contentHash: string | null;
    positionName: string | null;
    jobPurpose: string | null;
    responsibilities: string[];
    responsibilityDetails: { responsibility: string; successIndicator: string | null }[];
    requiredCompetencies: { name: string; level: number }[];
    educationRequirement: string | null;
    challenges: string[];
  } | null;
  targetPositionCode: string | null;
  required: { items: { name: string; level: number }[]; source: string; detail: string | null; employeeIds: string[] };
  education: {
    source: 'profile' | 'critical_position' | 'incumbent' | 'none';
    requirement: string | null;
    requirementSealed: string | null;
    recorded: boolean;
  };
  careerTarget: {
    jobProfileId: number | null;
    jobProfileName: string | null;
    matchType: string | null;
    status: 'ok' | 'no_match' | 'no_embedding';
    vector: number[] | null;
    pseudoNote: string | null;
    statedExperience: string | null;
  } | null;
  kamus: { fingerprint: string | null; codes: number | null };
  embedding: { model: string; documentModel: string | null; dimensions: number | null };
};

/** Mirror of `RunModels` in scoring-service/src/rerun-freeze.ts. */
export type RunModelsRecord = {
  embedding: { model: string; documentModel: string | null };
  education: { provider: 'gemini'; model: string | null; configured: boolean };
  narrative: { enabled: boolean; model: string | null };
};

/**
 * The spec the SCORING SERVICE reads off `tournament_sessions.final_ranked.ahpRerun`.
 *
 * Only `incremental_add` is ever written. The service refuses any other mode and
 * any session that carries the retired keys (`ahpAugment`, `ahpExclude`,
 * `ahpAlwaysInclude`) or no `frozen` block — a session queued by the old web app
 * fails with a message instead of being scored under rules that no longer exist.
 */
export type AhpRerunSpec = {
  mode: CreatableRerunMode;
  baseRunId: string;
  /** Not in the parent's pool: the six aspects are scored, nothing else is. */
  newCandidateIds: string[];
  /**
   * Already in the parent's pool but not among its finalists: NEVER re-scored —
   * their aspects come from the parent like everyone else's — but always given a
   * result row, at their whole-pool rank.
   */
  existingPoolCandidateIds: string[];
  frozen: FrozenRunBasis;
};
