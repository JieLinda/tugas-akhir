export type SyncResult = {
  success: boolean;
  message: string;
  synced: number;
  total: number;
  /**
   * Non-blocking findings about what was imported — a Company ID no mapping
   * covers, an NPK that is not in Data Karyawan, a position or competency code
   * nothing defines. The rows ARE stored (upload order legitimately varies), but
   * they will not show in any company until the reference exists. The upload
   * tile shows these as a warning toast; they are also appended to `message`.
   */
  warnings?: string[];
  /**
   * The Company IDs whose rows this run actually WROTE (Excel ingest only;
   * absent = not known / not company-scoped). Used by routes/sync.ts to
   * re-derive candidates for those companies alone; stripped before the result
   * is sent.
   */
  companyIds?: string[];
};

export type SyncAllResult = {
  divisions: SyncResult;
  departments: SyncResult;
  employees: SyncResult;
  positionMaster: SyncResult;
  positionHierarchy: SyncResult;
  employeePositions: SyncResult;
  technicalCompetencies: SyncResult;
  positionsPopulated: SyncResult;
  performance: SyncResult;
  disciplinary: SyncResult;
  education: SyncResult;
  /** Employee personal information — birth date, source of candidate age. */
  personal: SyncResult;
  candidates: SyncResult;
  jobProfiles: SyncResult;
  gradeLevels: SyncResult;
  behaviorCompetencies: SyncResult;
  // talentMapping / rtc / assessmentCenter / talentStaging were here, dropped
  // with the /talent prototype (branch `parked/talent-5box`). Dropped rather
  // than left reporting a permanent 0/0: a zero there reads as "the EDP source
  // was empty this week", which is a different fact from "we stopped asking".
};

export type ExtractedJobProfile = {
  documentInfo: {
    documentNumber: string | null;
    effectiveDate: string | null;
    revision: string | null;
    pageCount: string | null;
  };
  jobIdentity: {
    positionName: string;
    divisionDepartment: string;
    directSupervisor: string;
    subordinates: string[];
  };
  organizationStructure: {
    organizationChartSummary: string | null;
  };
  jobSpecification: {
    education: string | null;
    experience: string | null;
    gender: string | null;
    skills: string[];
  };
  /**
   * Names only. The behavioural table on the PDF has no level column, so an
   * entry here that carries one came from a mis-read row and is moved to
   * `technicalCompetencies` by `reconcileCompetencies` before storage.
   */
  behavioralCompetencies: string[];
  /** New extractions return `{ competency, level }` objects (level 1=Basic /
   *  2=Intermediate / 3=Advanced / 4=Expert, or **null** when the document did
   *  not legibly state one — never a guess); rows extracted before the prompt
   *  change may still hold plain strings. Consumers must accept both. */
  technicalCompetencies: ({ competency: string; level: string | number | null } | string)[];
  /**
   * What `reconcileCompetencies` had to correct, persisted so a bad read is
   * auditable instead of silent. Absent on rows extracted before this existed,
   * which is NOT the same as "nothing was wrong" — those were never checked.
   */
  competencyWarnings?: {
    kind: string;
    competency: string;
    detail: string;
  }[];
  authorities: string[];
  jobPurpose: string;
  responsibilities: {
    responsibility: string;
    successIndicator: string;
  }[];
  workingRelationships: {
    internal: string[];
    external: string[];
  };
  problemSolving: {
    references: string[];
    approvalRequired: string[];
    challenges: string[];
  };
  approvals: {
    preparedBy: string | null;
    checkedBy: string | null;
    approvedBy: string | null;
  };
};
