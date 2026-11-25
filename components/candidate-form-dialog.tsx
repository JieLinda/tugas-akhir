'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CaretDownIcon } from '@phosphor-icons/react';
import { Trash2, Plus, Calculator } from 'lucide-react';
import { HAV_SOURCE_LABEL, paBaChanged } from '@/lib/hav-effective';
import { deriveHavQuadrant } from '@/lib/hav-quadrant-derive';
import { HAV_GAP_LABEL } from '@/lib/talent-mapping';
import { HAV_QUADRANTS, formatHavQuadrant, normalizeHavQuadrant } from '@/lib/hav-quadrant';
import { FIELD_VALUE_OPTIONS } from '@/lib/candidate-field-values';
import { DISCIPLINE_LEVELS, canonicalDisciplineStatus } from '@/lib/discipline';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import type { CandidateProfile } from '@/lib/talent-data';
import { useIsDemoMode } from '@/components/app-mode-provider';
import { MASKED_NPK } from '@/lib/app-mode-shared';
import { DEMO_EDITABLE_FIELDS } from '@/lib/demo/fields';

function getScoreFromProficiency(prof?: string | null): number {
  if (!prof) return 0;
  const p = prof.toLowerCase();
  if (p.includes('expert')) return 4;
  if (p.includes('advanced')) return 3;
  if (p.includes('intermediate')) return 2;
  if (p.includes('basic')) return 1;
  return 0;
}

function getProficiencyFromScore(score?: number | null): string {
  if (score === 4) return 'Expert';
  if (score === 3) return 'Advanced';
  if (score === 2) return 'Intermediate';
  if (score === 1) return 'Basic';
  return 'Not Assessed';
}

const EMPTY_OPTION_VALUE = '__empty__';

/** The five PA letter grades, in order. Same set the filter engine recognizes. */
const PA_GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'E'] as const;

// Lightest → heaviest, the one order lib/discipline.ts defines.
const disciplineOptions: ComboboxOption[] = [
  { value: EMPTY_OPTION_VALUE, label: '— pilih —' },
  ...DISCIPLINE_LEVELS.map((l) => ({ value: l.value, label: l.optionLabel })),
];

const mcuOptions: ComboboxOption[] = [
  { value: EMPTY_OPTION_VALUE, label: '— pilih —' },
  { value: 'fit', label: 'Fit' },
  { value: 'fit_with_note', label: 'Fit dengan catatan' },
  { value: 'unfit', label: 'Unfit' },
  { value: 'expired', label: 'Kadaluarsa' },
];

const performanceOptions: ComboboxOption[] = [
  { value: EMPTY_OPTION_VALUE, label: '— pilih —' },
  { value: 'A', label: 'A' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
  { value: 'D', label: 'D' },
  { value: 'E', label: 'E' },
];

// HAV quadrant lookup (master data) — value is the canonical quadrant number.
const havQuadrantOptions: ComboboxOption[] = [
  { value: EMPTY_OPTION_VALUE, label: '— pilih —' },
  ...HAV_QUADRANTS.map((q) => ({
    value: String(q.number),
    label: `${q.number} · ${q.name} (${q.category})`,
  })),
];

function toComboboxValue(value?: string | null) {
  return value && value.length > 0 ? value : EMPTY_OPTION_VALUE;
}

function toFormValue(value: string) {
  return value === EMPTY_OPTION_VALUE ? '' : value;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Menyimpan...' : label}
    </Button>
  );
}

interface CandidateFormDialogProps {
  title: string;
  description: string;
  submitLabel: string;
  trigger: React.ReactNode;
  action: (formData: FormData) => Promise<void>;
  candidate?: CandidateProfile;
  departments?: string[];
  divisions?: string[];
  positions?: string[];
  masterCompetencies?: { technicalId: string; technicalName: string }[];
}

export function CandidateFormDialog({
  title,
  description,
  submitLabel,
  trigger,
  action,
  candidate,
  departments = [],
  divisions = [],
  positions = [],
  masterCompetencies = [],
}: CandidateFormDialogProps) {
  const router = useRouter();
  // Demo mode: every displayed field is editable (NPK and HAV included) and the
  // page hands in the demo action — the real record is never written from here.
  const demo = useIsDemoMode();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Demo mode: what the form showed when it opened, per field. A save sends
  // the names of the fields that differ from it (`editedFields`), and only
  // those are read from the demo copy — everything untouched keeps following
  // the real record (lib/demo/fields.ts). Captured from the rendered form
  // itself, so it is compared in exactly the format the save submits. Captured
  // ONCE until a save succeeds: the field state outlives a closed dialog, so a
  // change abandoned with Batal and reopened must still count as a change.
  const demoBaseline = useRef<Map<string, string> | null>(null);
  const captureDemoBaseline = useCallback(
    (form: HTMLFormElement | null) => {
      if (!form || !demo || demoBaseline.current) return;
      const fd = new FormData(form);
      demoBaseline.current = new Map(DEMO_EDITABLE_FIELDS.map((f) => [f, String(fd.get(f) ?? '').trim()]));
    },
    [demo],
  );
  const raw = candidate?.raw;
  const [disciplineStatus, setDisciplineStatus] = useState(() =>
    // Canonical case: an old lower-case 'clear' would otherwise match no option.
    candidate ? toComboboxValue(raw?.disciplineStatus ? canonicalDisciplineStatus(raw.disciplineStatus) : raw?.disciplineStatus) : 'CLEAR',
  );
  const [mcuStatus, setMcuStatus] = useState(() =>
    candidate ? toComboboxValue(raw?.mcuStatus) : 'fit',
  );
  // The HUMAN-entered note only. `mcuNote` (from the MCU workbook) is shown
  // read-only beside this field and is never edited here — the sync owns it and
  // would overwrite an edit on the next Monday run.
  const [mcuNoteManual, setMcuNoteManual] = useState(() => raw?.mcuNoteManual ?? '');
  const [behaviorRecommendation, setBehaviorRecommendation] = useState(() =>
    toComboboxValue(raw?.behaviorRecommendation),
  );
  // Behavior recommendation lookup — the DVP_MASTER_REKOMENDASI set, plus the
  // candidate's current value if it happens to fall outside the known list.
  const behaviorRecOptions: ComboboxOption[] = (() => {
    const base = FIELD_VALUE_OPTIONS.behaviorRecommendation ?? [];
    const current = (raw?.behaviorRecommendation ?? '').trim();
    const opts: ComboboxOption[] = [{ value: EMPTY_OPTION_VALUE, label: '— pilih —' }, ...base];
    if (current && !base.some((o) => o.value === current)) opts.push({ value: current, label: current });
    return opts;
  })();
  const [behaviorNotes, setBehaviorNotes] = useState(() => raw?.behaviorNotes ?? '');
  const [havQuadrant, setHavQuadrant] = useState(() =>
    toComboboxValue(
      normalizeHavQuadrant(demo ? candidate?.havQuadrant ?? raw?.havQuadrant : raw?.havQuadrant ?? candidate?.havQuadrant),
    ),
  );
  const [departmentVal, setDepartmentVal] = useState(() => candidate?.department && candidate.department !== '-' ? candidate.department : '');
  const [divisionVal, setDivisionVal] = useState(() => candidate?.division && candidate.division !== '-' ? candidate.division : '');
  const [currentPositionVal, setCurrentPositionVal] = useState(() => candidate?.currentPosition && candidate.currentPosition !== '-' ? candidate.currentPosition : '');

  // PA Values (6 semesters)
  const [paValues, setPaValues] = useState<string[]>(() => {
    const rawPA = raw?.performanceGrade || ',,,,,';
    const parts = rawPA.split(',');
    while (parts.length < 6) parts.push('');
    return parts.map(p => p.trim());
  });

  const cy = new Date().getFullYear();
  const combinedPerformanceGrade = paValues.join(',');

  // "Hitung kuadran HAV" (edit only, both modes): on save, the HAV is placed by
  // the formula over the PA and behaviour in THIS form, overriding a Talent
  // Mapping placement and an upload, and recorded as the formula's doing
  // (lib/hav-formula-event.ts; demo: the copy's `havTier`). The preview follows
  // the fields live, so what is shown is what the server will compute.
  const [recomputeHav, setRecomputeHav] = useState(false);
  const [havCalcError, setHavCalcError] = useState<string | null>(null);
  const formulaPreview = useMemo(
    () =>
      deriveHavQuadrant({
        performanceGrade: combinedPerformanceGrade,
        behaviorRecommendation: toFormValue(behaviorRecommendation),
      }),
    [combinedPerformanceGrade, behaviorRecommendation],
  );
  // A PA/BA edit is itself an event: saving it re-places the HAV by the formula
  // (when the formula can answer), so the form says so before the save.
  const paBaEdited =
    Boolean(candidate) &&
    paBaChanged(
      { performanceGrade: raw?.performanceGrade ?? '', behaviorRecommendation: raw?.behaviorRecommendation ?? '' },
      { performanceGrade: combinedPerformanceGrade, behaviorRecommendation: toFormValue(behaviorRecommendation) },
    );
  // Demo: the HAV field is editable, so it shows the computed square while the
  // recompute is on (and the server un-edits the HAV regardless).
  useEffect(() => {
    if (demo && recomputeHav && formulaPreview.ok) setHavQuadrant(String(formulaPreview.quadrant));
  }, [demo, recomputeHav, formulaPreview]);
  // A recompute that can no longer be computed (a field emptied after the
  // click) is switched off rather than submitted to be refused.
  useEffect(() => {
    if (recomputeHav && !formulaPreview.ok) {
      setRecomputeHav(false);
      setHavCalcError(`Kuadran HAV tidak dapat dihitung: ${formulaPreview.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}.`);
    }
  }, [recomputeHav, formulaPreview]);
  const handleComputeHav = () => {
    if (!formulaPreview.ok) {
      setRecomputeHav(false);
      setHavCalcError(`Kuadran HAV tidak dapat dihitung: ${formulaPreview.gaps.map((g) => HAV_GAP_LABEL[g]).join('; ')}.`);
      return;
    }
    setHavCalcError(null);
    setRecomputeHav(true);
  };

  // Technical competencies state supporting Add, Edit, Remove
  const [competencies, setCompetencies] = useState(() => {
    return (candidate?.technicalCompetencies || []).map((tc) => {
      const initialScore = tc.score ?? 3;
      const initialCurrentScore = tc.currentScore ?? getScoreFromProficiency(tc.currentProficiencyName ?? tc.proficiencyName);
      return {
        technicalId: tc.technicalId,
        technicalName: tc.technicalName,
        proficiencyName: tc.proficiencyName || getProficiencyFromScore(initialScore),
        currentProficiencyName: getProficiencyFromScore(initialCurrentScore),
        score: initialScore,
        currentScore: initialCurrentScore,
        gap: initialCurrentScore - initialScore,
        isManual: tc.isManual ?? false,
        sourceKey: tc.sourceKey ?? `manual_${tc.technicalId}`,
      };
    });
  });

  const proficiencyOptions = [
    { value: 0, label: 'Not Assessed' },
    { value: 1, label: 'Basic' },
    { value: 2, label: 'Intermediate' },
    { value: 3, label: 'Advanced' },
    { value: 4, label: 'Expert' },
  ];

  const handleAddCompetency = (technicalId: string) => {
    if (!technicalId || technicalId === EMPTY_OPTION_VALUE) return;
    const matched = masterCompetencies.find((mc) => mc.technicalId === technicalId);
    if (!matched) return;
    if (competencies.some((c) => c.technicalId === technicalId)) return;

    setCompetencies((prev) => [
      ...prev,
      {
        technicalId: matched.technicalId,
        technicalName: matched.technicalName,
        proficiencyName: getProficiencyFromScore(3), // Default target proficiency
        currentProficiencyName: getProficiencyFromScore(2), // Default current proficiency
        score: 3,
        currentScore: 2,
        gap: 2 - 3,
        isManual: true,
        sourceKey: `manual_${matched.technicalId}`,
      },
    ]);
  };

  const handleProficiencyChange = (technicalId: string, value: string) => {
    setCompetencies((prev) =>
      prev.map((c) => {
        if (c.technicalId !== technicalId) return c;
        const currentScore = getScoreFromProficiency(value);
        const targetScore = c.score ?? 3;
        return {
          ...c,
          currentProficiencyName: value,
          currentScore,
          gap: currentScore - targetScore,
          isManual: true,
        };
      })
    );
  };

  const handleTargetScoreChange = (technicalId: string, value: number) => {
    setCompetencies((prev) =>
      prev.map((c) => {
        if (c.technicalId !== technicalId) return c;
        const currentScore = c.currentScore ?? 2;
        return {
          ...c,
          score: value,
          gap: currentScore - value,
          isManual: true,
        };
      })
    );
  };

  const handleRemoveCompetency = (technicalId: string) => {
    setCompetencies((prev) => prev.filter((c) => c.technicalId !== technicalId));
  };

  // Expand/collapse for technical competencies (separate trigger)
  const [techExpanded, setTechExpanded] = useState(false);

  const handlePaChange = (index: number, val: string) => {
    setPaValues(prev => {
      const next = [...prev];
      next[index] = val === EMPTY_OPTION_VALUE ? '' : val;
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Drop a stale rejection when the dialog is reopened, otherwise the
        // previous attempt's message greets the next edit.
        if (!next) {
          setError(null);
          setRecomputeHav(false);
          setHavCalcError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          ref={captureDemoBaseline}
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            if (demo && candidate && demoBaseline.current) {
              const baseline = demoBaseline.current;
              const edited = DEMO_EDITABLE_FIELDS.filter(
                (f) => String(formData.get(f) ?? '').trim() !== (baseline.get(f) ?? ''),
              );
              formData.set('editedFields', JSON.stringify(edited));
            }
            setError(null);
            try {
              await action(formData);
              demoBaseline.current = null;
              setOpen(false);
              router.refresh();
            } catch (err) {
              // Dialog stays open on error so the user can fix the input — and
              // now says WHY. Some callers wrap `action` in a toast (the
              // candidates page does); the candidate detail page passes the
              // server action straight through, so without this the rejection
              // was completely invisible: the dialog simply sat there.
              setError(err instanceof Error ? err.message : 'Gagal menyimpan data.');
            }
          }}
          className="space-y-5"
        >
          {candidate && <input type="hidden" name="id" value={candidate.id} />}

          {/* Section: Basic info */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identitas</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="candidate-name">Nama lengkap <span className="text-destructive">*</span></Label>
                <Input id="candidate-name" name="name" defaultValue={candidate?.name ?? ''} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-employeeId">ID Karyawan <span className="text-destructive">*</span></Label>
                {/*
                  Read-only when editing. The NPK is the candidate's identity —
                  half of the unique key the sync upserts on, and what every
                  employee-data relation resolves through — so the update action
                  never writes it. Leaving the field editable meant a retyped NPK
                  was silently discarded under a "berhasil diperbarui" toast.
                  It stays a submitted field (readOnly submits, disabled does
                  not) so the server still sees the value and can reject a
                  changed one instead of trusting the client to enforce this.
                */}
                {demo && candidate ? (
                  // Demo: editable, but the NPK is never shown in clear — the field
                  // starts empty behind a masked placeholder and empty keeps it.
                  <>
                    <Input
                      id="candidate-employeeId"
                      name="employeeId"
                      defaultValue=""
                      placeholder={MASKED_NPK}
                      autoComplete="off"
                      aria-describedby="candidate-employeeId-note"
                    />
                    <p id="candidate-employeeId-note" className="text-xs text-muted-foreground">
                      Kosongkan untuk mempertahankan nilai saat ini.
                    </p>
                  </>
                ) : (
                <Input
                  id="candidate-employeeId"
                  name="employeeId"
                  defaultValue={raw?.employeeId ?? ''}
                  placeholder="MUL-2024-001"
                  required
                  readOnly={Boolean(candidate)}
                  aria-describedby={candidate ? 'candidate-employeeId-note' : undefined}
                  className={candidate ? 'bg-muted text-muted-foreground' : undefined}
                />
                )}
                {candidate && !demo ? (
                  <p id="candidate-employeeId-note" className="text-xs text-muted-foreground">
                    NPK adalah identitas kandidat dan tidak dapat diubah di sini. Untuk memperbaiki
                    NPK yang salah, hapus kandidat ini lalu jalankan sinkronisasi.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-email">Email</Label>
                <Input id="candidate-email" name="email" type="email" defaultValue={candidate?.email ?? ''} />
              </div>
              <div className="space-y-2">
                <Label>Posisi saat ini <span className="text-destructive">*</span></Label>
                <Combobox
                  value={currentPositionVal}
                  onValueChange={setCurrentPositionVal}
                  options={positions.map((p) => ({ value: p, label: p }))}
                  placeholder="Pilih posisi..."
                  searchPlaceholder="Cari posisi..."
                  emptyText="Posisi tidak ditemukan."
                  triggerClassName="bg-card"
                />
                <input type="hidden" name="currentPosition" value={currentPositionVal} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="candidate-years">Masa kerja (tahun) <span className="text-destructive">*</span></Label>
                <Input id="candidate-years" name="yearsExperience" type="number" min="0" defaultValue={candidate?.yearsOfService ?? ''} required />
              </div>

              <div className="space-y-2">
                <Label>Divisi <span className="text-destructive">*</span></Label>
                <Combobox
                  value={divisionVal}
                  onValueChange={setDivisionVal}
                  options={divisions.map((d) => ({ value: d, label: d }))}
                  placeholder="Pilih divisi..."
                  searchPlaceholder="Cari divisi..."
                  emptyText="Divisi tidak ditemukan."
                  triggerClassName="bg-card"
                />
                <input type="hidden" name="division" value={divisionVal} required />
              </div>

              <div className="space-y-2">
                <Label>Departemen <span className="text-destructive">*</span></Label>
                <Combobox
                  value={departmentVal}
                  onValueChange={setDepartmentVal}
                  options={departments.map((d) => ({ value: d, label: d }))}
                  placeholder="Pilih departemen..."
                  searchPlaceholder="Cari departemen..."
                  emptyText="Departemen tidak ditemukan."
                  triggerClassName="bg-card"
                />
                <input type="hidden" name="department" value={departmentVal} required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="candidate-education">Pendidikan <span className="text-destructive">*</span></Label>
                <Input id="candidate-education" name="education" defaultValue={raw?.education ?? candidate?.education ?? ''} placeholder="S1, S2, ..." required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-major">Jurusan <span className="text-destructive">*</span></Label>
                <Input id="candidate-major" name="major" defaultValue={raw?.major ?? candidate?.major ?? ''} placeholder="Teknik Sipil, Manajemen, ..." required />
              </div>
            </div>
          </section>

          <Separator />

          {/* Section: Atribut kelayakan */}
          <section className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Atribut Kelayakan</p>
              <p className="text-xs text-muted-foreground">Digunakan oleh program untuk filter kelayakan otomatis.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status Disiplin</Label>
                <Combobox
                  value={disciplineStatus}
                  onValueChange={setDisciplineStatus}
                  options={disciplineOptions}
                  placeholder="Pilih status disiplin"
                  searchPlaceholder="Cari status disiplin..."
                  emptyText="Status disiplin tidak ditemukan."
                  triggerClassName="bg-card"
                />
                <input type="hidden" name="disciplineStatus" value={toFormValue(disciplineStatus)} />
              </div>
              <div className="space-y-2">
                <Label>Status MCU</Label>
                <Combobox
                  value={mcuStatus}
                  onValueChange={setMcuStatus}
                  options={mcuOptions}
                  placeholder="Pilih status MCU"
                  searchPlaceholder="Cari status MCU..."
                  emptyText="Status MCU tidak ditemukan."
                  triggerClassName="bg-card"
                />
                <input type="hidden" name="mcuStatus" value={toFormValue(mcuStatus)} />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="candidate-mcu-note">Keterangan MCU</Label>
                <Textarea
                  id="candidate-mcu-note"
                  value={mcuNoteManual}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMcuNoteManual(e.target.value)}
                  rows={2}
                  placeholder="Kondisi dan batasannya, mis. 'tidak boleh angkat beban >10 kg'"
                />
                <input type="hidden" name="mcuNoteManual" value={mcuNoteManual} />
                <p className="text-[11px] text-muted-foreground">
                  Catatan medis kandidat. Tidak menggugurkan kandidat dan tidak mengubah skor.
                  Tulis batasan kerjanya, bukan diagnosis lengkap.
                </p>
                {raw?.mcuNote ? (
                  <p className="rounded-md border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                    <span className="font-semibold">Dari sinkronisasi:</span> {raw.mcuNote}
                    <br />
                    Isian di atas menimpa keterangan ini bila diisi.
                  </p>
                ) : null}
              </div>
              
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Riwayat Performance Appraisal (3 Tahun Terakhir)
                </Label>
                <div className="grid gap-3 sm:grid-cols-3 rounded-lg bg-muted/20">
                  {[
                    { year: cy - 1, s2Index: 0, s1Index: 1 },
                    { year: cy - 2, s2Index: 2, s1Index: 3 },
                    { year: cy - 3, s2Index: 4, s1Index: 5 },
                  ].map((item) => (
                    <div key={item.year} className="space-y-2 rounded-md border bg-card p-2.5">
                      <p className="text-xs font-bold text-center text-primary">{item.year}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground block text-center">S1</span>
                          <Select
                            value={paValues[item.s1Index] || EMPTY_OPTION_VALUE}
                            onValueChange={(v) => handlePaChange(item.s1Index, v)}
                          >
                            <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label={`PA ${item.year} S1`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_OPTION_VALUE} className="text-xs">—</SelectItem>
                              {PA_GRADE_OPTIONS.map((g) => (
                                <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-semibold text-muted-foreground block text-center">S2</span>
                          <Select
                            value={paValues[item.s2Index] || EMPTY_OPTION_VALUE}
                            onValueChange={(v) => handlePaChange(item.s2Index, v)}
                          >
                            <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label={`PA ${item.year} S2`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_OPTION_VALUE} className="text-xs">—</SelectItem>
                              {PA_GRADE_OPTIONS.map((g) => (
                                <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <input type="hidden" name="performanceGrade" value={combinedPerformanceGrade} />
              </div>

              {/* Technical competencies - same level as Performance Appraisal */}
              <div className="space-y-2 sm:col-span-2">
                <button
                  type="button"
                  onClick={() => setTechExpanded((v) => !v)}
                  className="flex w-full items-center justify-between text-xs text-muted-foreground transition-colors hover:text-foreground font-semibold uppercase tracking-wider"
                >
                  <span>Technical Competencies ({competencies.length})</span>
                  <CaretDownIcon className={`h-3.5 w-3.5 transition-transform ${techExpanded ? 'rotate-180' : ''}`} weight="bold" />
                </button>

                {techExpanded && (
                  <div className="rounded-lg border bg-muted/20 p-3 space-y-4">
                    {competencies.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic text-center py-2">
                        Belum ada kompetensi teknis yang ditambahkan.
                      </p>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {competencies.map((tc) => (
                          <div key={tc.technicalId} className="space-y-2 rounded-md border bg-card p-2.5 relative">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold text-foreground pr-6 leading-tight">{tc.technicalName}</p>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-destructive absolute top-1.5 right-1.5 hover:bg-destructive/10"
                                onClick={() => handleRemoveCompetency(tc.technicalId)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>

                            <div className="grid grid-cols-2 gap-2 pt-1">
                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold text-muted-foreground block">Current Proficiency</span>
                                <Select
                                  value={tc.currentProficiencyName}
                                  onValueChange={(val) => handleProficiencyChange(tc.technicalId, val)}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Pilih..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {proficiencyOptions.map((opt) => (
                                      <SelectItem key={opt.value} value={opt.label} className="text-xs">
                                        {opt.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div className="space-y-1">
                                <span className="text-[10px] font-semibold text-muted-foreground block">Target Score</span>
                                <Input
                                  type="number"
                                  min={0}
                                  max={4}
                                  value={tc.score ?? 3}
                                  onChange={(e) => handleTargetScoreChange(tc.technicalId, parseInt(e.target.value) || 3)}
                                  className="h-8 text-xs px-2"
                                />
                              </div>
                            </div>

                            <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1.5 border-t border-dashed">
                              <span>Current Score: <strong className="text-foreground">{tc.currentScore ?? 0}</strong></span>
                              <span>Gap: <strong className={tc.gap !== null && tc.gap < 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>{tc.gap ?? 0}</strong></span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-dashed">
                      <div className="flex-1">
                        <Combobox
                          value=""
                          onValueChange={handleAddCompetency}
                          options={masterCompetencies
                            .filter((mc) => !competencies.some((c) => c.technicalId === mc.technicalId))
                            .map((mc) => ({ value: mc.technicalId, label: mc.technicalName }))}
                          placeholder="Tambah kompetensi teknis..."
                          searchPlaceholder="Cari kompetensi..."
                          emptyText="Semua kompetensi sudah ditambahkan."
                          triggerClassName="h-9 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <input type="hidden" name="technicalCompetencies" value={JSON.stringify(competencies)} />
              </div>

              {candidate && !demo ? (
                // Read-only on edit: the HAV in force moves by EVENTS
                // (lib/hav-effective.ts) — a Talent Mapping placement, a HAV
                // upload, or from here a PA/BA change or "Hitung kuadran HAV"
                // (lib/hav-formula-event.ts) — never by a typed quadrant: the
                // column this field used to write is the Excel value the sync
                // overwrites every run.
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label>HAV Quadrant</Label>
                    <HavComputeButton onClick={handleComputeHav} active={recomputeHav} />
                  </div>
                  <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/40 px-3 py-1.5 text-xs">
                    {recomputeHav && formulaPreview.ok ? (
                      <>
                        <span className="text-muted-foreground line-through">{formatHavQuadrant(candidate.havQuadrant)}</span>
                        <span aria-hidden>→</span>
                        <span className="font-medium">{formatHavQuadrant(formulaPreview.quadrant)}</span>
                        <span className="text-muted-foreground">· {HAV_SOURCE_LABEL.formula}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-medium">{formatHavQuadrant(candidate.havQuadrant)}</span>
                        {candidate.havSource && (
                          <span className="text-muted-foreground">· {HAV_SOURCE_LABEL[candidate.havSource]}</span>
                        )}
                      </>
                    )}
                  </div>
                  <HavComputeNote
                    recompute={recomputeHav && formulaPreview.ok}
                    paBaEdited={paBaEdited && formulaPreview.ok}
                    error={havCalcError}
                    onCancel={() => setRecomputeHav(false)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Berubah lewat{' '}
                    <Link href="/talent-pool/mapping" className="font-medium text-primary underline-offset-2 hover:underline">
                      Talent Mapping
                    </Link>{' '}
                    (penempatan manual), upload HAV di Sinkronisasi, atau perubahan PA/Behavior (rumus PA × BA).
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="candidate-hav">HAV Quadrant <span className="text-destructive">*</span></Label>
                    {candidate && <HavComputeButton onClick={handleComputeHav} active={recomputeHav} />}
                  </div>
                  <Combobox
                    value={havQuadrant}
                    onValueChange={(v) => {
                      // Picking a square by hand is a HAV edit, which outranks
                      // the formula: the recompute is switched off.
                      setRecomputeHav(false);
                      setHavQuadrant(v);
                    }}
                    options={havQuadrantOptions}
                    placeholder="Pilih kuadran HAV"
                    searchPlaceholder="Cari kuadran (nomor/nama)..."
                    emptyText="Kuadran tidak ditemukan."
                    triggerClassName="h-9 text-xs bg-card"
                  />
                  <input type="hidden" name="havQuadrant" value={toFormValue(havQuadrant)} required={!demo} />
                  {candidate && (
                    <HavComputeNote
                      recompute={recomputeHav && formulaPreview.ok}
                      paBaEdited={paBaEdited && formulaPreview.ok}
                      error={havCalcError}
                      onCancel={() => setRecomputeHav(false)}
                    />
                  )}
                  {!demo && (
                    <p className="text-[11px] text-muted-foreground">
                      Nilai awal. Setelah tersimpan, HAV diatur di Talent Mapping, lewat upload HAV, atau oleh perubahan PA/Behavior.
                    </p>
                  )}
                </div>
              )}
              <input type="hidden" name="recomputeHav" value={recomputeHav && formulaPreview.ok ? '1' : ''} />
              <div className="space-y-2">
                <Label htmlFor="candidate-behavior-recommendation">Behavior Recommendation <span className="text-destructive">*</span></Label>
                <Combobox
                  value={behaviorRecommendation}
                  onValueChange={setBehaviorRecommendation}
                  options={behaviorRecOptions}
                  placeholder="Pilih rekomendasi behavior"
                  searchPlaceholder="Cari rekomendasi..."
                  emptyText="Rekomendasi tidak ditemukan."
                  triggerClassName="h-9 text-xs bg-card"
                />
                <input type="hidden" name="behaviorRecommendation" value={toFormValue(behaviorRecommendation)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-behavior-notes">Behavior Notes</Label>
                <Textarea
                  id="candidate-behavior-notes"
                  name="behaviorNotes"
                  value={behaviorNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBehaviorNotes(e.target.value)}
                  rows={3}
                  placeholder="Detail kompetensi (mis. competencies under review)"
                />
                <input type="hidden" name="behaviorNotes" value={behaviorNotes} />
              </div>
            </div>
          </section>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <SubmitButton label={submitLabel} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function HavComputeButton({ onClick, active }: { onClick: () => void; active: boolean }) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      size="sm"
      className="h-7 gap-1.5 px-2 text-[11px]"
      onClick={onClick}
    >
      <Calculator className="size-3.5" />
      Hitung kuadran HAV
    </Button>
  );
}

/** What saving will do to the HAV: the button's pending recompute, a PA/BA edit, or why the formula cannot answer. */
function HavComputeNote({
  recompute,
  paBaEdited,
  error,
  onCancel,
}: {
  recompute: boolean;
  paBaEdited: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  if (recompute) {
    return (
      <p className="text-[11px] text-sky-700 dark:text-sky-300">
        Saat disimpan, HAV ditempatkan menurut rumus PA × BA dan menggantikan penempatan manual atau upload HAV.{' '}
        <button type="button" className="font-medium underline underline-offset-2" onClick={onCancel}>
          Batalkan
        </button>
      </p>
    );
  }
  if (error) return <p className="text-[11px] text-destructive">{error}</p>;
  if (paBaEdited) {
    return (
      <p className="text-[11px] text-sky-700 dark:text-sky-300">
        PA/Behavior berubah: saat disimpan, HAV ditempatkan ulang menurut rumus PA × BA.
      </p>
    );
  }
  return null;
}
