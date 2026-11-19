"use client";

import { type ReactNode, useState, useEffect, useMemo } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Combobox } from "@/components/ui/combobox";
import { X, TriangleAlert, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { MasterPosition, CandidateLookupItem } from "@/lib/talent-data";
import {
  getJobProfilesAction,
  suggestJobProfileForSelectionAction,
} from "@/lib/job-profile-actions";
import {
  resolveHoldersForPositionAction,
  resolvePositionForCandidateAction,
  getPositionEnrichmentAction,
  type PositionEnrichment,
} from "@/lib/pulse-crud-actions";
import {
  parseJobProfileTechnicalCompetencies,
  parseDivisionDepartment,
  type JobProfileTechComp,
} from "@/lib/job-profile-utils";
import type { GradeLevelOption } from "@/lib/pulse-data";
import { ScrollArea } from "./ui/scroll-area";

type ProfileSuggestionSource = "family-candidate" | "family-position" | "title";

type EditablePosition = {
  id?: string;
  title: string;
  department?: string | null;
  division?: string | null;
  level?: string | null;
  description?: string | null;
  /** Program this position is managed under (see drizzle/0056). */
  programTemplateId?: string | null;
  programCode?: string | null;
  programName?: string | null;
  /** Runs already recorded — once there is one, the program is frozen. */
  runCount?: number;
  minGradeId?: string | null;
  maxGradeId?: string | null;
  education?: string | null;
  experience?: string | null;
  jobFamily?: string | null;
  requiredCompetencies?: {
    technicalId: string;
    technicalName: string;
    targetProficiency?: string;
  }[];
  currentHolder?: {
    name: string;
    employeeId: string;
    since?: string | null;
  };
  /** Every incumbent recorded for this position, primary first. */
  holders?: { name: string; employeeId: string }[];
};

/** One sitting incumbent offered by the lookup. */
type HolderOption = { name: string; employeeId: string; candidateId?: string | null };

type JobProfileLite = {
  id: number;
  positionName: string | null;
  divisionDepartment: string | null;
  extractedData: Record<string, unknown> | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Menyimpan..." : label}
    </Button>
  );
}

interface PositionFormDialogProps {
  title: string;
  description: string;
  submitLabel: string;
  trigger: ReactNode;
  action: (formData: FormData) => Promise<void>;
  position?: EditablePosition;
  positions?: MasterPosition[];
  candidates?: CandidateLookupItem[];
  gradeLevels?: GradeLevelOption[];
  /** Succession programs of the current tenant — a position belongs to one. */
  programs?: ProgramOption[];
}

export type ProgramOption = { id: string; code: string; name: string };

export function PositionFormDialog({
  title,
  description,
  submitLabel,
  trigger,
  action,
  position,
  positions = [],
  candidates = [],
  gradeLevels = [],
  programs = [],
}: PositionFormDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [programTemplateId, setProgramTemplateId] = useState(
    position?.programTemplateId ?? "",
  );
  // A scored position keeps the program its ranking was produced under; the way
  // to assess the same seat under another program is to add it again.
  const programLocked = Boolean(position?.id) && (position?.runCount ?? 0) > 0;

  // Form input states.
  //
  // A position can be held by several people at once (non-unique roles like
  // SALESMAN or INSTRUCTOR), so the lookup offers every active incumbent and the
  // user ticks the ones this position is about. The FIRST ticked one is the
  // primary — it is what the position row itself stores and what every existing
  // reader joins on.
  const [holderOptions, setHolderOptions] = useState<HolderOption[]>(
    position?.holders?.length
      ? position.holders
      : position?.currentHolder
        ? [
            {
              name: position.currentHolder.name,
              employeeId: position.currentHolder.employeeId,
            },
          ]
        : [],
  );
  const [selectedHolderIds, setSelectedHolderIds] = useState<string[]>(
    (position?.holders?.length
      ? position.holders
      : position?.currentHolder
        ? [position.currentHolder]
        : []
    ).map((h) => h.employeeId),
  );
  const selectedHolders = useMemo(
    () => holderOptions.filter((h) => selectedHolderIds.includes(h.employeeId)),
    [holderOptions, selectedHolderIds],
  );
  // Derived, never stored: the primary is simply the first ticked incumbent, so
  // it can never drift out of step with the list on screen.
  const holderName = selectedHolders[0]?.name ?? "";
  const holderEmployeeId = selectedHolders[0]?.employeeId ?? "";

  function toggleHolder(employeeId: string) {
    setSelectedHolderIds((prev) =>
      prev.includes(employeeId)
        ? prev.filter((id) => id !== employeeId)
        : [...prev, employeeId],
    );
  }

  const [titleInput, setTitleInput] = useState(position?.title ?? "");
  const [department, setDepartment] = useState(position?.department ?? "");
  const [division, setDivision] = useState(position?.division ?? "");
  const [minLevelName, setMinLevelName] = useState("");
  const [maxLevelName, setMaxLevelName] = useState("");

  // Quick search selection values
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");

  // Job profile state
  const [jobProfiles, setJobProfiles] = useState<JobProfileLite[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(
    null,
  );
  const [selectedProfileName, setSelectedProfileName] = useState("");

  // Qualification fields (populated from job profile)
  const [education, setEducation] = useState("");
  const [experience, setExperience] = useState("");
  const [jobFamily, setJobFamily] = useState("");
  const [competencies, setCompetencies] = useState<JobProfileTechComp[]>([]);

  // Employee_id-based holder/position lookup (in flight) + the resulting
  // job-profile auto-suggestion (via job_family_matches), so the user can see
  // WHY the qualification fields got filled and still override them.
  const [resolvingLookup, setResolvingLookup] = useState(false);
  const [profileSuggestion, setProfileSuggestion] = useState<{
    source: ProfileSuggestionSource;
    name: string | null;
    jobPurpose: string | null;
    supervisor: string | null;
  } | null>(null);

  // Read-only position context (grade/level, summary, hierarchy) — sourced
  // from sync_positions/sync_position_hierarchy, purely informational.
  const [positionEnrichment, setPositionEnrichment] =
    useState<PositionEnrichment | null>(null);

  // Load job profiles when dialog opens
  useEffect(() => {
    if (open) {
      getJobProfilesAction().then((rows) => {
        setJobProfiles(
          rows.map(
            (r: {
              id: number;
              positionName: string | null;
              divisionDepartment: string | null;
              extractedData: unknown;
            }) => ({
              id: r.id,
              positionName: r.positionName,
              divisionDepartment: r.divisionDepartment,
              extractedData: (typeof r.extractedData === "object" &&
              r.extractedData !== null
                ? r.extractedData
                : typeof r.extractedData === "string"
                  ? JSON.parse(r.extractedData)
                  : null) as Record<string, unknown> | null,
            }),
          ),
        );
      });
    }
  }, [open]);

  const profileOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { value: string; label: string }[] = [];
    for (const p of jobProfiles) {
      const name = p.positionName ?? "Tanpa nama";
      if (seen.has(name)) continue;
      seen.add(name);
      const suffix = p.divisionDepartment ? ` (${p.divisionDepartment})` : "";
      opts.push({ value: name, label: `${name}${suffix}` });
    }
    opts.sort((a, b) => a.label.localeCompare(b.label));
    return opts;
  }, [jobProfiles]);

  function extractStr(
    data: Record<string, unknown> | null,
    ...path: string[]
  ): string {
    if (!data) return "";
    let current: unknown = data;
    for (const key of path) {
      if (current && typeof current === "object" && key in current) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return "";
      }
    }
    return typeof current === "string" ? current : String(current ?? "");
  }

  /** Fill qualification/competency fields from a job profile's extracted data. */
  function applyProfileData(
    profileId: number,
    data: Record<string, unknown> | null,
  ) {
    setSelectedProfileId(profileId);
    const profile = jobProfiles.find((p) => p.id === profileId);
    setSelectedProfileName(profile?.positionName ?? "");
    const spec = (data?.jobSpecification as Record<string, unknown>) ?? {};
    const identity = (data?.jobIdentity as Record<string, unknown>) ?? {};

    setEducation(typeof spec.education === "string" ? spec.education : "");
    setExperience(typeof spec.experience === "string" ? spec.experience : "");
    const rawDivisionDepartment =
      typeof identity.divisionDepartment === "string"
        ? identity.divisionDepartment
        : "";
    setJobFamily(rawDivisionDepartment);
    // Refine "Detail posisi jabatan"'s Departemen/Divisi using the job
    // profile's own divisionDepartment text, parsed by its "<Divisi> - <Dept>"
    // convention (see parseDivisionDepartment). Only overwrite a side that the
    // job profile actually resolved — a job profile with just a division code
    // ("BOD") shouldn't blank out an already-known department, and vice versa.
    const parsedOrg = parseDivisionDepartment(rawDivisionDepartment);
    if (parsedOrg.division) setDivision(parsedOrg.division);
    if (parsedOrg.department) setDepartment(parsedOrg.department);
    // Handles both shapes (old string[], new {competency, level}[]).
    setCompetencies(
      data
        ? parseJobProfileTechnicalCompetencies(
            data.technicalCompetencies as any,
          )
        : [],
    );
  }

  function handleSelectProfile(profileId: number) {
    const profile = jobProfiles.find((p) => p.id === profileId);
    if (!profile || !profile.extractedData) return;
    applyProfileData(profileId, profile.extractedData);
    setProfileSuggestion(null); // user made a manual choice — no longer "auto"
  }

  /** Auto-suggest + auto-fill a job profile from the picked candidate/position. */
  async function runProfileSuggestion(
    candidateId: string | null,
    masterPositionId: string | null,
    titleFallback: string | null,
  ) {
    try {
      const s = await suggestJobProfileForSelectionAction({
        candidateId,
        masterPositionId,
        titleFallback,
      });
      if (s.jobProfileId == null) {
        setProfileSuggestion(null);
        return;
      }
      const data =
        typeof s.extractedData === "string"
          ? (JSON.parse(s.extractedData) as Record<string, unknown>)
          : (s.extractedData as Record<string, unknown> | null);
      applyProfileData(s.jobProfileId, data);
      setProfileSuggestion({
        source: s.source ?? "title",
        name: s.positionName,
        jobPurpose: s.jobPurpose,
        supervisor: s.supervisor,
      });
    } catch {
      // Best-effort suggestion — leave qualification fields as-is on failure.
    }
  }

  /** Read-only position context (grade/level, summary, hierarchy). */
  async function runPositionEnrichment(masterPositionId: string | null) {
    if (!masterPositionId) {
      setPositionEnrichment(null);
      return;
    }
    try {
      const enrichment = await getPositionEnrichmentAction(masterPositionId);
      setPositionEnrichment(enrichment);
    } catch {
      setPositionEnrichment(null);
    }
  }

  function removeCompetency(idx: number) {
    setCompetencies((prev) => prev.filter((_, i) => i !== idx));
  }

  // When editing and job profiles are loaded, try to select the matching profile
  useEffect(() => {
    if (!position || !open) return;
    setSelectedProfileId(null);
    setSelectedProfileName("");
    const quals: Record<string, string | null | undefined> =
      (position as any)?.qualifications ?? {};
    const jobFamilyText = (position as any)?.jobFamily ?? quals.jobFamily ?? "";
    const searchText = (jobFamilyText || position.title || "").toLowerCase();
    if (!searchText) return;
    const match = jobProfiles.find(
      (p) =>
        (p.positionName ?? "").toLowerCase() === searchText ||
        (p.divisionDepartment ?? "").toLowerCase().includes(searchText),
    );
    if (match) {
      setSelectedProfileName(match.positionName ?? "");
      setSelectedProfileId(match.id);
    }
  }, [open, position?.id, jobProfiles]);

  // Sync state when open changes or position changes
  useEffect(() => {
    if (open) {
      const storedHolders = position?.holders?.length
        ? position.holders
        : position?.currentHolder
          ? [
              {
                name: position.currentHolder.name,
                employeeId: position.currentHolder.employeeId,
              },
            ]
          : [];
      setHolderOptions(storedHolders);
      setSelectedHolderIds(storedHolders.map((h) => h.employeeId));
      setTitleInput(position?.title ?? "");
      setDepartment(position?.department ?? "");
      setDivision(position?.division ?? "");

      // Resolve min/max level names from stored grade boundaries
      if (position?.minGradeId) {
        const minNum = parseInt(position.minGradeId, 10);
        if (!Number.isNaN(minNum)) {
          const match = levelOptions.find((lo) => {
            const range = getGradeRange(lo.value);
            return range && range.min === minNum;
          });
          setMinLevelName(match?.value ?? "");
        } else {
          setMinLevelName("");
        }
      } else {
        setMinLevelName("");
      }

      if (position?.maxGradeId) {
        const maxNum = parseInt(position.maxGradeId, 10);
        if (!Number.isNaN(maxNum)) {
          const match = levelOptions.find((lo) => {
            const range = getGradeRange(lo.value);
            return range && range.max === maxNum;
          });
          setMaxLevelName(match?.value ?? "");
        } else {
          setMaxLevelName("");
        }
      } else {
        setMaxLevelName("");
      }

      setSelectedPersonId("");
      setSelectedPositionId("");
      setProgramTemplateId(
        position?.programTemplateId ??
          programs.find((p) => p.code === position?.programCode)?.id ??
          "",
      );

      // Pre-populate qualification fields when editing an existing position
      // (supports both top-level EditablePosition and nested PositionSummary shapes)
      const quals: Record<string, string | null | undefined> =
        (position as any)?.qualifications ?? {};
      setSelectedProfileId(null);
      setSelectedProfileName("");
      setEducation((position as any)?.education ?? quals.education ?? "");
      setExperience((position as any)?.experience ?? quals.experience ?? "");
      setJobFamily((position as any)?.jobFamily ?? quals.jobFamily ?? "");
      setCompetencies(
        ((position as any)?.requiredCompetencies as JobProfileTechComp[]) ?? [],
      );

      setResolvingLookup(false);
      setProfileSuggestion(null);
      setPositionEnrichment(null);
    }
  }, [open, position]);

  // Options for searching candidates (people)
  const personOptions = candidates.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.employeeId})`,
  }));

  // The master positions table often holds several rows for the same logical
  // position (different ids but identical title/department/division — across
  // companies mapped to one tenant, or grade/validity variants). Collapse them
  // so the picker doesn't show the same job more than once, keeping the row that
  // actually has an incumbent: the twins are indistinguishable to the user, and
  // picking one without a holder leaves "Nama pejabat" empty (which then blocks
  // saving with "Nama pejabat wajib diisi."). The holder is also shown in the
  // label so the right row is obvious before selecting — and searchable by name.
  const positionOptions = useMemo(() => {
    const normalize = (value: string | null | undefined) =>
      (value ?? "").trim().replace(/\s+/g, " ").toUpperCase();
    const byKey = new Map<string, MasterPosition>();

    for (const positionItem of positions) {
      const key = [
        normalize(positionItem.title),
        normalize(positionItem.department),
        normalize(positionItem.division),
      ].join("|");
      const kept = byKey.get(key);
      if (
        !kept ||
        (!kept.currentHolder?.name && positionItem.currentHolder?.name)
      ) {
        byKey.set(key, positionItem);
      }
    }

    // Map iteration order follows `positions` (already sorted by title).
    return Array.from(byKey.values()).map((positionItem) => {
      const holder = positionItem.currentHolder?.name;
      const others = Math.max((positionItem.activeHolderCount ?? 0) - 1, 0);
      const suffix = [positionItem.department, positionItem.division]
        .filter(Boolean)
        .join(" · ");
      const holderLabel = holder
        ? others > 0
          ? `${holder} (+${others} pejabat aktif lainnya)`
          : holder
        : "(belum ada pejabat)";
      return {
        value: positionItem.id,
        label: `${positionItem.title} — ${holderLabel}`,
        description: suffix || undefined,
      };
    });
  }, [positions]);

  // Build unique level names sorted by their lowest grade
  const levelOptions = useMemo(() => {
    const map = new Map<string, { min: number; max: number }>();
    for (const g of gradeLevels) {
      const num = parseInt(g.gradeId, 10);
      if (Number.isNaN(num)) continue;
      const entry = map.get(g.levelName ?? g.gradeId) ?? { min: num, max: num };
      entry.min = Math.min(entry.min, num);
      entry.max = Math.max(entry.max, num);
      map.set(g.levelName ?? g.gradeId, entry);
    }
    return Array.from(map.entries())
      .map(([label, { min, max }]) => ({ label, min, max }))
      .sort((a, b) => a.min - b.min)
      .map(({ label, min, max }) => ({
        value: label,
        label:
          min === max
            ? `${label} (Grade ${min})`
            : `${label} (Grade ${min}-${max})`,
      }));
  }, [gradeLevels]);

  const filteredMaxLevelOptions = useMemo(() => {
    if (!minLevelName) return levelOptions;
    const minRange = getGradeRange(minLevelName);
    if (!minRange) return levelOptions;
    return levelOptions.filter((lo) => {
      const range = getGradeRange(lo.value);
      return range && range.min >= minRange.min;
    });
  }, [levelOptions, minLevelName]);

  function getGradeRange(
    levelName: string,
  ): { min: number; max: number } | null {
    const nums = gradeLevels
      .filter((g) => (g.levelName ?? g.gradeId) === levelName)
      .map((g) => parseInt(g.gradeId, 10))
      .filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }

  function resolveMinMaxGradeIds(): { minGradeId: string; maxGradeId: string } {
    const minRange = minLevelName ? getGradeRange(minLevelName) : null;
    const maxRange = maxLevelName ? getGradeRange(maxLevelName) : null;
    return {
      minGradeId: minRange ? String(minRange.min) : "",
      maxGradeId: maxRange ? String(maxRange.max) : "",
    };
  }

  const resolvedMinMax = useMemo(resolveMinMaxGradeIds, [
    minLevelName,
    maxLevelName,
    gradeLevels,
  ]);

  // Jalur 1: pilih karyawan → resolve posisi aktifnya via relasi employee_id
  // (sync_employee_positions), bukan menebak lewat kecocokan string title.
  const handlePersonSelect = async (candidateId: string) => {
    setSelectedPersonId(candidateId);
    setSelectedPositionId(""); // Reset the position search
    const candidate = candidates.find((c) => c.id === candidateId);
    if (!candidate) return;

    const pickedHolder: HolderOption = {
      name: candidate.name,
      employeeId: candidate.employeeId,
      candidateId,
    };
    setHolderOptions([pickedHolder]);
    setSelectedHolderIds([candidate.employeeId]);
    setDepartment(candidate.department ?? "");
    setDivision(candidate.division ?? "");

    let resolvedTitle = candidate.currentPosition;
    let masterPositionId: string | null = null;

    setResolvingLookup(true);
    try {
      const resolved = await resolvePositionForCandidateAction(candidateId);
      if (resolved) {
        resolvedTitle = resolved.title;
        masterPositionId = resolved.masterPositionId;
      }
      // The picked person may share their seat with others — offer them too,
      // with the picked one kept first (and therefore primary).
      if (masterPositionId) {
        const holders = await resolveHoldersForPositionAction(masterPositionId);
        const others = holders
          .filter((h) => h.holderEmployeeId !== candidate.employeeId)
          .map((h) => ({
            name: h.holderName,
            employeeId: h.holderEmployeeId,
            candidateId: h.candidateId,
          }));
        const merged = [pickedHolder, ...others];
        setHolderOptions(merged);
        setSelectedHolderIds(merged.map((h) => h.employeeId));
      }
    } catch {
      toast.error(
        "Gagal mengambil posisi aktif karyawan dari relasi data; menggunakan data cadangan.",
      );
    } finally {
      setResolvingLookup(false);
    }

    setTitleInput(resolvedTitle);
    if (masterPositionId) setSelectedPositionId(masterPositionId);

    runProfileSuggestion(candidateId, masterPositionId, resolvedTitle);
    runPositionEnrichment(masterPositionId);
  };

  // Jalur 2: pilih jabatan master → resolve incumbent aktifnya via relasi
  // employee_id (sync_employee_positions → candidates), bukan menebak lewat
  // kecocokan string title.
  const handlePositionSelect = async (positionId: string) => {
    setSelectedPositionId(positionId);
    setSelectedPersonId(""); // Reset the person search
    const matchedPosition = positions.find((p) => p.id === positionId);
    if (!matchedPosition) return;

    setTitleInput(matchedPosition.title);
    setDepartment(matchedPosition.department ?? "");
    setDivision(matchedPosition.division ?? "");

    let candidateId: string | null = null;

    setResolvingLookup(true);
    try {
      // Every active incumbent, not just one: this seat may be held by several
      // people, and all of them are people this position needs successors for.
      const holders = await resolveHoldersForPositionAction(positionId);
      if (holders.length > 0) {
        const options = holders.map((h) => ({
          name: h.holderName,
          employeeId: h.holderEmployeeId,
          candidateId: h.candidateId,
        }));
        setHolderOptions(options);
        setSelectedHolderIds(options.map((h) => h.employeeId));
        candidateId = holders[0]!.candidateId;
        if (candidateId) setSelectedPersonId(candidateId);
      } else {
        setHolderOptions([]);
        setSelectedHolderIds([]);
      }
    } catch {
      setHolderOptions([]);
      setSelectedHolderIds([]);
      toast.error("Gagal mengambil pejabat aktif posisi ini dari relasi data.");
    } finally {
      setResolvingLookup(false);
    }

    runProfileSuggestion(candidateId, positionId, matchedPosition.title);
    runPositionEnrichment(positionId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="min-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-[60vh]">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              // Re-populate disabled inputs manually since disabled fields are excluded from native FormData
              if (position?.id) formData.set("id", position.id);
              formData.set("title", titleInput);
              formData.set("holderName", holderName);
              formData.set("holderEmployeeId", holderEmployeeId);
              // Full incumbent set, primary first. The pair above stays for the
              // readers that join on the position row itself.
              formData.set(
                "holders",
                JSON.stringify(
                  selectedHolders.map((h) => ({
                    name: h.name,
                    employeeId: h.employeeId,
                  })),
                ),
              );
              formData.set("department", department);
              formData.set("division", division);
              formData.set("education", education);
              formData.set("experience", experience);
              formData.set("jobFamily", jobFamily);
              formData.set("competencies", JSON.stringify(competencies));
              formData.set("minGradeId", resolvedMinMax.minGradeId);
              formData.set("maxGradeId", resolvedMinMax.maxGradeId);
              formData.set("programTemplateId", programTemplateId);
              if (!programTemplateId) {
                toast.error("Program suksesi wajib dipilih.");
                return;
              }
              if (selectedHolders.length === 0) {
                toast.error("Pilih minimal satu pejabat saat ini.");
                return;
              }
              try {
                await action(formData);
                setOpen(false);
                router.refresh();
              } catch {
                // Dialog stays open on error so the user can fix the input
              }
            }}
            className="space-y-4"
          >
            {position && <input type="hidden" name="id" value={position.id} />}

            {/* Program — one position belongs to exactly one succession program.
              Scoring the same seat under another program means adding it again. */}
            <fieldset className="rounded-lg border border-violet-200/70 bg-violet-500/5 p-4 space-y-2 dark:border-violet-900/50 dark:bg-violet-500/10">
              <legend className="px-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
                Program suksesi
              </legend>
              <Label className="text-xs text-muted-foreground">
                Program penilaian <span className="text-destructive">*</span>
              </Label>
              {programLocked ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[11px]">
                    {position?.programName ??
                      position?.programCode ??
                      "Program terpilih"}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">
                    terkunci
                  </span>
                </div>
              ) : (
                <Combobox
                  options={programs.map((p) => ({
                    value: p.id,
                    label: p.name,
                  }))}
                  value={programTemplateId}
                  onValueChange={setProgramTemplateId}
                  placeholder="Pilih program..."
                  searchPlaceholder="Cari program..."
                  emptyText="Program tidak ditemukan."
                  triggerClassName="text-sm bg-card max-w-md"
                />
              )}
              <p className="text-[10px] leading-normal text-muted-foreground">
                {programLocked
                  ? "Program tidak dapat diubah karena posisi ini sudah pernah di-scoring. Untuk menilai posisi yang sama pada program lain, tambahkan posisi baru dengan program tersebut."
                  : "Satu posisi berlaku untuk satu program. Untuk menjalankan scoring posisi yang sama pada program lain, tambahkan posisi tersebut sekali lagi dengan program yang berbeda."}
              </p>
              <input
                type="hidden"
                name="programTemplateId"
                value={programTemplateId}
              />
            </fieldset>

            {/* Primary Lookup - Focused */}
            {!position && (candidates.length > 0 || positions.length > 0) && (
              <div className="rounded-lg border border-sky-100 bg-sky-500/5 p-4 space-y-3 dark:border-sky-950/60 dark:bg-sky-500/10">
                <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
                  Pencarian & Penentuan Jabatan Kritis
                  {resolvingLookup && (
                    <span className="text-[10px] font-normal normal-case text-muted-foreground">
                      Mencari relasi data...
                    </span>
                  )}
                </h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 flex flex-col">
                    <Label className="text-xs text-muted-foreground">
                      1. Cari berdasarkan Karyawan (Person){" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Combobox
                      options={personOptions}
                      value={selectedPersonId}
                      onValueChange={handlePersonSelect}
                      placeholder="Pilih nama karyawan..."
                      searchPlaceholder="Cari nama..."
                      disabled={resolvingLookup}
                      className="w-sm"
                    />
                  </div>
                  <div className="space-y-1.5 flex flex-col">
                    <Label className="text-xs text-muted-foreground">
                      2. Cari berdasarkan Jabatan Master{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Combobox
                      options={positionOptions}
                      value={selectedPositionId}
                      onValueChange={handlePositionSelect}
                      placeholder="Pilih nama jabatan..."
                      searchPlaceholder="Cari jabatan..."
                      disabled={resolvingLookup}
                      className="w-sm"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground leading-normal">
                  * Cari nama karyawan atau jabatan master di atas —
                  posisi/pejabat aktif dicari lewat relasi data, dan job profile yang sesuai (Job
                  Family) ikut terisi otomatis di bawah. Anda tetap dapat
                  menyesuaikan isian jika diperlukan.
                </p>
              </div>
            )}

            {/* Incumbent / Current Holder — primary input */}
            <fieldset className="rounded-lg border p-4 space-y-3">
              <legend className="px-2 text-sm font-semibold text-muted-foreground">
                Pejabat saat ini (yang akan digantikan)
              </legend>
              {holderOptions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Akan terisi otomatis setelah karyawan atau jabatan master
                  dipilih di atas.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {holderOptions.map((holder) => {
                    const checked = selectedHolderIds.includes(
                      holder.employeeId,
                    );
                    const isPrimary =
                      selectedHolders[0]?.employeeId === holder.employeeId;
                    return (
                      <label
                        key={holder.employeeId || holder.name}
                        className="flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm transition-colors hover:bg-muted/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleHolder(holder.employeeId)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {holder.name || "(tanpa nama)"}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {holder.employeeId || "—"}
                        </span>
                        {isPrimary && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            Utama
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                  <p className="text-[10px] leading-normal text-muted-foreground">
                    {holderOptions.length > 1
                      ? `Jabatan ini dipegang ${holderOptions.length} orang aktif. Centang semua yang akan digantikan — masing-masing dikeluarkan dari kolam kandidat posisi ini, dan yang pertama tercentang menjadi pejabat utama.`
                      : "Pejabat yang dicentang dikeluarkan dari kolam kandidat posisi ini."}
                  </p>
                </div>
              )}
            </fieldset>

            {/* Position details derived from the incumbent's role */}
            <fieldset className="rounded-lg border p-4 space-y-3">
              <legend className="px-2 text-sm font-semibold text-muted-foreground">
                Detail posisi jabatan
              </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="position-title">
                    Nama posisi <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    disabled={true}
                    id="position-title"
                    name="title"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    placeholder="Akan terisi otomatis..."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position-department">Departemen</Label>
                  <Input
                    disabled={true}
                    id="position-department"
                    name="department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Akan terisi otomatis..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="position-division">Divisi</Label>
                  <Input
                    disabled={true}
                    id="position-division"
                    name="division"
                    value={division}
                    onChange={(e) => setDivision(e.target.value)}
                    placeholder="Akan terisi otomatis..."
                  />
                </div>
              </div>

              {/* Read-only enrichment: sync_positions (grade/level/ringkasan) +
                sync_position_hierarchy (atasan/bawahan) + job profile (tujuan
                jabatan, atasan versi job profile). Informational only — not
                submitted, critical_positions has no columns for these. */}
              {(positionEnrichment ||
                profileSuggestion?.jobPurpose ||
                profileSuggestion?.supervisor) && (
                <div className="space-y-2 rounded-lg border border-dashed bg-muted/20 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Informasi Tambahan Posisi
                  </p>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                    {positionEnrichment?.gradeId && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Grade / Level
                        </p>
                        <p className="text-xs font-medium">
                          {positionEnrichment.gradeId}
                          {positionEnrichment.posLevelNo != null
                            ? ` (Level ${positionEnrichment.posLevelNo})`
                            : ""}
                        </p>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        Atasan Langsung
                      </p>
                      <p className="text-xs font-medium">
                        {positionEnrichment?.supervisorTitle ??
                          profileSuggestion?.supervisor ??
                          "-"}
                      </p>
                    </div>
                    {positionEnrichment && (
                      <div>
                        <p className="text-[10px] text-muted-foreground">
                          Jumlah Bawahan Langsung
                        </p>
                        <p className="text-xs font-medium">
                          {positionEnrichment.subordinateCount} orang
                        </p>
                      </div>
                    )}
                  </div>
                  {(positionEnrichment?.summary ||
                    profileSuggestion?.jobPurpose) && (
                    <div>
                      <p className="text-[10px] text-muted-foreground">
                        {profileSuggestion?.jobPurpose
                          ? "Tujuan Jabatan (Job Profile)"
                          : "Ringkasan Posisi"}
                      </p>
                      <p className="text-xs leading-relaxed text-foreground/90">
                        {profileSuggestion?.jobPurpose ??
                          positionEnrichment?.summary}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </fieldset>

            {/* Qualification from Job Profile */}
            <fieldset className="rounded-lg border border-sky-200/60 dark:border-sky-900/50 p-4 space-y-3">
              <legend className="px-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
                Kualifikasi & Kompetensi
              </legend>

              {/* Profile selector */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">
                    Pilih dari Job Profile{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                </div>
                <Combobox
                  options={profileOptions}
                  value={selectedProfileName}
                  onValueChange={(name) => {
                    const profile =
                      jobProfiles.find(
                        (p) => p.positionName === name && p.extractedData,
                      ) ?? jobProfiles.find((p) => p.positionName === name);
                    if (profile) handleSelectProfile(profile.id);
                  }}
                  placeholder="Cari jabatan..."
                  searchPlaceholder="Cari jabatan..."
                  emptyText="Tidak ada job profile."
                  triggerClassName="text-sm bg-card max-w-md"
                />

                {selectedProfileId !== null ? (
                  profileSuggestion ? (
                    <div className="flex items-start gap-2 rounded-lg border border-sky-300/70 bg-sky-500/10 p-2.5 text-sky-800 dark:border-sky-900/60 dark:text-sky-200">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="text-[11px] leading-normal">
                        Disarankan otomatis dari{" "}
                        {profileSuggestion.source === "family-candidate"
                          ? "pasangan incumbent kandidat (Job Family)"
                          : profileSuggestion.source === "family-position"
                            ? "pasangan jabatan (Job Family)"
                            : "kecocokan nama posisi"}
                        :{" "}
                        <strong>
                          {profileSuggestion.name ?? "job profile terpilih"}
                        </strong>
                        . Kualifikasi &amp; kompetensi terisi otomatis — Anda
                        tetap dapat menggantinya dari daftar di atas.
                      </p>
                    </div>
                  ) : (
                    <></>
                  )
                ) : !position?.id ? (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-500/10 p-2.5 text-amber-800 dark:border-amber-900/60 dark:text-amber-200">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="text-[11px] leading-normal">
                      Kualifikasi & kompetensi teknis akan terisi otomatis, dan
                      hasil scoring (khususnya metode AHP + TOPSIS) jadi lebih
                      akurat.
                    </p>
                  </div>
                ) : null}
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pos-education" className="text-xs">
                    Pendidikan
                  </Label>
                  <Input
                    id="pos-education"
                    name="education"
                    value={education}
                    onChange={(e) => setEducation(e.target.value)}
                    placeholder="Min. S1 Teknik Mesin"
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pos-experience" className="text-xs">
                    Pengalaman
                  </Label>
                  <Input
                    id="pos-experience"
                    name="experience"
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                    placeholder="Min. 5 tahun"
                    className="text-sm"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pos-job-family" className="text-xs">
                  Job Family
                </Label>
                <Input
                  id="pos-job-family"
                  name="jobFamily"
                  value={jobFamily}
                  onChange={(e) => setJobFamily(e.target.value)}
                  placeholder="Manufacturing / Produksi"
                  className="text-sm"
                />
              </div>

              {/* Grade Range (Successor Eligibility) */}
              <div className="space-y-2">
                <Label className="text-xs">
                  Rentang Level Suksesor{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Combobox
                    options={levelOptions}
                    value={minLevelName}
                    onValueChange={(v) => {
                      setMinLevelName(v);
                      if (!maxLevelName) {
                        setMaxLevelName(v);
                      } else {
                        const maxRange = getGradeRange(maxLevelName);
                        const vRange = getGradeRange(v);
                        if (maxRange && vRange && maxRange.min < vRange.min) {
                          setMaxLevelName("");
                        }
                      }
                    }}
                    placeholder="Level minimum..."
                    searchPlaceholder="Cari level..."
                    emptyText="Tidak ada level tersedia."
                    triggerClassName="text-sm bg-card"
                  />
                  <Combobox
                    options={filteredMaxLevelOptions}
                    value={maxLevelName}
                    onValueChange={(v) => {
                      setMaxLevelName(v);
                    }}
                    placeholder="Level maksimum..."
                    searchPlaceholder="Cari level..."
                    emptyText="Tidak ada level tersedia."
                    triggerClassName="text-sm bg-card"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Kandidat dengan grade di luar rentang ini (huruf diabaikan,
                  mis. 5a→5) akan difilter otomatis saat scoring.
                </p>
                <input
                  type="hidden"
                  name="minGradeId"
                  value={resolvedMinMax.minGradeId}
                />
                <input
                  type="hidden"
                  name="maxGradeId"
                  value={resolvedMinMax.maxGradeId}
                />
              </div>

              {/* Competencies */}
              <div className="space-y-2">
                <Label className="text-xs">Kompetensi Teknis</Label>
                {competencies.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {competencies.map((comp, i) => (
                      <Badge
                        key={i}
                        variant="secondary"
                        className="gap-1 pr-1 text-[11px]"
                      >
                        {comp.technicalName}
                        {comp.targetProficiency && (
                          <span className="rounded bg-emerald-500/15 px-1 text-[9px] font-semibold text-emerald-700 dark:text-emerald-300">
                            {comp.targetProficiency}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeCompetency(i)}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {selectedProfileId
                      ? "Job profile ini tidak memiliki kompetensi teknis."
                      : "Pilih job profile untuk mengisi kompetensi."}
                  </p>
                )}
                <input
                  type="hidden"
                  name="competencies"
                  value={JSON.stringify(competencies)}
                />
              </div>
            </fieldset>

            <DialogFooter>
              <SubmitButton label={submitLabel} />
            </DialogFooter>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
