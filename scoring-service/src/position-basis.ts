/**
 * The POSITION side of a run, frozen: what the target seat demanded when the
 * run was computed (FR-RR-07).
 *
 * A "Tambah Kandidat Pembanding" child scores only its new candidates. If it
 * scored them against the job profile, competency reference, education
 * requirement and career target document as they stand TODAY while every
 * carried-over candidate was scored against the parent's, the merged ranking
 * would compare two people measured with two different yardsticks — exactly the
 * comparability the re-run exists to protect. So every AHP run records the
 * basis it resolved (as VALUES, not ids: a job profile id points at a row that
 * can be re-extracted tomorrow), and a child scores its new candidates against
 * the basis it inherits. Somebody who wants today's job profile applied is
 * asking for a new assessment, which is a new root.
 *
 * Only the SOURCE of these inputs changes. The six formulas, the embedding
 * pipeline and the kamus level vectors are untouched: a frozen basis is fed to
 * the same scorers in place of the live resolution.
 *
 * Pure — no database — so the rules can be tested directly. The engine does
 * the reads (ahp-topsis-engine.ts).
 */

export type FrozenJobProfile = {
  /** `sync_job_profiles.id` the run resolved, for display and audit only. */
  id: number | null;
  /** How the position resolved to it. */
  matchTier: "jfm" | "exact" | "substring" | "embedding" | null;
  /** sha256 of the profile's extracted data at resolution time. */
  contentHash: string | null;
  positionName: string | null;
  jobPurpose: string | null;
  responsibilities: string[];
  responsibilityDetails: { responsibility: string; successIndicator: string | null }[];
  requiredCompetencies: { name: string; level: number }[];
  educationRequirement: string | null;
  challenges: string[];
};

export type FrozenCareerTarget = {
  jobProfileId: number | null;
  jobProfileName: string | null;
  matchType: string | null;
  status: "ok" | "no_match" | "no_embedding";
  /** The target document vector every stint was compared against (null = none). */
  vector: number[] | null;
  /** Set when the target was a synthesized document rather than a job profile. */
  pseudoNote: string | null;
  /** The target JD's stated experience text, for the depth yardstick. */
  statedExperience: string | null;
};

export type PositionBasis = {
  version: 1;
  /** The run that RESOLVED these values. For an inherited basis: an ancestor. */
  resolvedByRunId: string;
  resolvedAt: string;
  /**
   * How the resolving run obtained them: `own` = a root resolved its own;
   * `live_fallback` = a child resolved them live because its parent recorded
   * none (a run from before this change). Carried down unchanged, so a
   * grandchild still knows its basis is not the root's.
   */
  originSource: "own" | "live_fallback";
  jobProfile: FrozenJobProfile | null;
  targetPositionCode: string | null;
  required: {
    items: { name: string; level: number }[];
    source: string;
    detail: string | null;
    employeeIds: string[];
  };
  education: {
    source: "profile" | "critical_position" | "incumbent" | "none";
    /** Plain text when it comes from the job profile or the position. */
    requirement: string | null;
    /**
     * When the requirement is the INCUMBENT's own education + major, it is
     * stored here (plain text) rather than in `requirement`. The name is
     * historical — it used to hold a `v1:` envelope; application-level
     * encryption was removed and stored values were decrypted in place.
     */
    requirementSealed: string | null;
    /**
     * False only on older runs whose incumbent requirement could not be
     * sealed (key locked) and was therefore not stored. New runs write true.
     */
    recorded: boolean;
  };
  /** Null when this run resolved no career target (nobody to score). */
  careerTarget: FrozenCareerTarget | null;
  /** Fingerprint of the kamus level-embedding corpus (code, level, content hash, model). */
  kamus: { fingerprint: string | null; codes: number | null };
  embedding: {
    /** Model the engine embeds competency/title text with. */
    model: string;
    /** Model the job-profile document vectors were produced with. */
    documentModel: string | null;
    /** Dimensionality of the career target vector, when there is one. */
    dimensions: number | null;
  };
};

const isStr = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);
const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function competencyList(v: unknown): { name: string; level: number }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => ({ name: String((r as any)?.name ?? "").trim(), level: Number((r as any)?.level) }))
    .filter((r) => r.name.length > 0 && Number.isFinite(r.level));
}

/**
 * Read a stored basis back, or null when there is none to inherit (a run from
 * before this change) or it is malformed. A malformed basis is treated as
 * absent — the child then resolves live and SAYS so — rather than half-used.
 */
export function parsePositionBasis(raw: unknown): PositionBasis | null {
  const b = raw as Record<string, any> | null;
  if (!b || typeof b !== "object" || b.version !== 1) return null;
  if (!isStr(b.resolvedByRunId) || !b.required || !b.education || !b.embedding) return null;
  const jp = b.jobProfile as Record<string, any> | null;
  const ct = b.careerTarget as Record<string, any> | null;
  return {
    version: 1,
    resolvedByRunId: b.resolvedByRunId,
    resolvedAt: strOrNull(b.resolvedAt) ?? "",
    originSource: b.originSource === "live_fallback" ? "live_fallback" : "own",
    jobProfile: jp
      ? {
          id: numOrNull(jp.id),
          matchTier: ["jfm", "exact", "substring", "embedding"].includes(jp.matchTier) ? jp.matchTier : null,
          contentHash: strOrNull(jp.contentHash),
          positionName: strOrNull(jp.positionName),
          jobPurpose: strOrNull(jp.jobPurpose),
          responsibilities: Array.isArray(jp.responsibilities) ? jp.responsibilities.map(String) : [],
          responsibilityDetails: Array.isArray(jp.responsibilityDetails)
            ? jp.responsibilityDetails.map((r: any) => ({
                responsibility: String(r?.responsibility ?? ""),
                successIndicator: strOrNull(r?.successIndicator),
              }))
            : [],
          requiredCompetencies: competencyList(jp.requiredCompetencies),
          educationRequirement: strOrNull(jp.educationRequirement),
          challenges: Array.isArray(jp.challenges) ? jp.challenges.map(String) : [],
        }
      : null,
    targetPositionCode: strOrNull(b.targetPositionCode),
    required: {
      items: competencyList(b.required.items),
      source: String(b.required.source ?? "none"),
      detail: strOrNull(b.required.detail),
      employeeIds: Array.isArray(b.required.employeeIds) ? b.required.employeeIds.map(String) : [],
    },
    education: {
      source: ["profile", "critical_position", "incumbent", "none"].includes(b.education.source)
        ? b.education.source
        : "none",
      requirement: strOrNull(b.education.requirement),
      requirementSealed: strOrNull(b.education.requirementSealed),
      recorded: b.education.recorded !== false,
    },
    careerTarget: ct
      ? {
          jobProfileId: numOrNull(ct.jobProfileId),
          jobProfileName: strOrNull(ct.jobProfileName),
          matchType: strOrNull(ct.matchType),
          status: ct.status === "ok" || ct.status === "no_embedding" ? ct.status : "no_match",
          vector:
            Array.isArray(ct.vector) && ct.vector.length > 0 && ct.vector.every((x: unknown) => typeof x === "number")
              ? (ct.vector as number[])
              : null,
          pseudoNote: strOrNull(ct.pseudoNote),
          statedExperience: strOrNull(ct.statedExperience),
        }
      : null,
    kamus: { fingerprint: strOrNull(b.kamus?.fingerprint), codes: numOrNull(b.kamus?.codes) },
    embedding: {
      model: String(b.embedding.model ?? ""),
      documentModel: strOrNull(b.embedding.documentModel),
      dimensions: numOrNull(b.embedding.dimensions),
    },
  };
}

/** One reason the frozen basis cannot be applied as-is, in the user's language. */
export type BasisCaveat = {
  key: "kamus_changed" | "embedding_model_changed" | "career_vector_dimension" | "education_unrecorded";
  message: string;
};

/**
 * What changed AROUND a frozen basis since it was resolved, and which parts
 * therefore cannot be applied as frozen. Nothing here is silent: every caveat
 * ends up in `run_info.positionBasisStatus.caveats` and on the page.
 *
 *  - the kamus corpus moved (FR-RR-07 d): the competency DEFINITIONS are still
 *    read live — a new candidate's competencies were unknown when the root was
 *    computed, so there is no frozen vector for them — and the run says so;
 *  - the embedding model changed: cosines across two models are meaningless;
 *  - the stored career vector no longer has the corpus' dimensionality: it
 *    cannot be compared at all, so career resolves its target live;
 *  - an incumbent-derived education requirement was not recorded (older runs
 *    made while the encryption key was locked).
 */
export function basisCaveats(input: {
  basis: PositionBasis;
  liveKamusFingerprint: string | null;
  liveEmbeddingModel: string;
  liveDocumentModel: string | null;
  liveVectorDimensions: number | null;
}): BasisCaveat[] {
  const { basis } = input;
  const out: BasisCaveat[] = [];
  if (
    basis.kamus.fingerprint &&
    input.liveKamusFingerprint &&
    basis.kamus.fingerprint !== input.liveKamusFingerprint
  ) {
    out.push({
      key: "kamus_changed",
      message:
        "Kamus kompetensi berubah sejak run induk. Definisi kompetensi kandidat baru dibaca dari kamus yang berlaku sekarang, karena kompetensi mereka belum diketahui saat run induk dihitung.",
    });
  }
  const modelChanged =
    (basis.embedding.model && basis.embedding.model !== input.liveEmbeddingModel) ||
    (basis.embedding.documentModel &&
      input.liveDocumentModel &&
      basis.embedding.documentModel !== input.liveDocumentModel);
  if (modelChanged) {
    out.push({
      key: "embedding_model_changed",
      message: `Model embedding berbeda dari run induk (${basis.embedding.documentModel ?? basis.embedding.model} → ${input.liveDocumentModel ?? input.liveEmbeddingModel}). Kemiripan teks kandidat baru dihitung di ruang vektor lain, sehingga skor teknis dan kariernya tidak sepenuhnya sebanding dengan kandidat lama.`,
    });
  }
  const v = basis.careerTarget?.vector;
  if (v && input.liveVectorDimensions != null && v.length !== input.liveVectorDimensions) {
    out.push({
      key: "career_vector_dimension",
      message: `Vektor dokumen posisi target yang dibekukan berdimensi ${v.length}, sedangkan korpus job profile sekarang berdimensi ${input.liveVectorDimensions}. Dokumen target karier kandidat baru terpaksa dibaca dari kondisi hari ini.`,
    });
  }
  if (basis.education.source === "incumbent" && !basis.education.recorded) {
    out.push({
      key: "education_unrecorded",
      message:
        "Syarat pendidikan run induk diambil dari pendidikan pejabat, tetapi tidak dapat disimpan terenkripsi saat itu. Syarat pendidikan kandidat baru dibaca dari kondisi hari ini.",
    });
  }
  return out;
}
