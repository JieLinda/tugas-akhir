'use client';

import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { BookOpen, Check, FileText, Search, Sparkles, X } from 'lucide-react';
import {
  getJobProfilesAction,
  suggestJobProfileForPositionAction,
} from '@/lib/job-profile-actions';
import { updatePositionQualificationsAction } from '@/lib/pulse-crud-actions';
import { parseJobProfileTechnicalCompetencies } from '@/lib/job-profile-utils';

type CompetencyItem = { technicalName: string; targetProficiency?: string };
type JobProfileRow = Awaited<ReturnType<typeof getJobProfilesAction>>[number];

interface LinkJobProfileDialogProps {
  positionId: string;
  currentEducation?: string | null;
  currentExperience?: string | null;
  currentJobFamily?: string | null;
  currentCompetencies?: CompetencyItem[];
  trigger?: ReactNode;
}

export function LinkJobProfileDialog({
  positionId,
  currentEducation,
  currentExperience,
  currentJobFamily,
  currentCompetencies,
  trigger,
}: LinkJobProfileDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<JobProfileRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [educationInput, setEducationInput] = useState(currentEducation ?? '');
  const [experienceInput, setExperienceInput] = useState(currentExperience ?? '');
  const [jobFamilyInput, setJobFamilyInput] = useState(currentJobFamily ?? '');
  const [competencies, setCompetencies] = useState<CompetencyItem[]>(currentCompetencies ?? []);
  const [saving, setSaving] = useState(false);
  // Auto-suggested profile (from the incumbent pairing / title match).
  const [suggestion, setSuggestion] = useState<{ source: 'family' | 'title'; name: string | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setEducationInput(currentEducation ?? '');
    setExperienceInput(currentExperience ?? '');
    setJobFamilyInput(currentJobFamily ?? '');
    setCompetencies(currentCompetencies ?? []);
    setSelectedProfileId(null);
    setSearchQuery('');
    setSuggestion(null);

    let alive = true;
    (async () => {
      const list = await getJobProfilesAction();
      if (!alive) return;
      setProfiles(list);
      // Auto-search the position-incumbent → 1 matching profile and pre-fill it
      // (the user can still pick a different one below).
      try {
        const s = await suggestJobProfileForPositionAction(positionId);
        if (!alive || s.jobProfileId == null) return;
        const prof = list.find((p) => p.id === s.jobProfileId);
        if (prof) {
          applyProfile(prof);
          setSuggestion({ source: s.source ?? 'title', name: prof.positionName ?? s.positionName });
        }
      } catch {
        /* suggestion is best-effort */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, positionId, currentEducation, currentExperience, currentJobFamily, currentCompetencies]);

  const filteredProfiles = useMemo(() => {
    if (!searchQuery) return profiles;
    const q = searchQuery.toLowerCase();
    return profiles.filter(
      (p) =>
        (p.positionName ?? '').toLowerCase().includes(q) ||
        (p.divisionDepartment ?? '').toLowerCase().includes(q) ||
        (p.fileName ?? '').toLowerCase().includes(q)
    );
  }, [profiles, searchQuery]);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId) ?? null;

  function extractEducation(data: any): string | null {
    return data?.jobSpecification?.education ?? null;
  }

  function extractExperience(data: any): string | null {
    return data?.jobSpecification?.experience ?? null;
  }

  function extractJobFamily(data: any): string | null {
    return data?.jobIdentity?.divisionDepartment ?? null;
  }

  function applyProfile(profile: JobProfileRow) {
    setSelectedProfileId(profile.id);
    const data = profile.extractedData
      ? (typeof profile.extractedData === 'string' ? JSON.parse(profile.extractedData) : profile.extractedData)
      : null;

    setEducationInput(data ? extractEducation(data) ?? '' : '');
    setExperienceInput(data ? extractExperience(data) ?? '' : '');
    setJobFamilyInput(data ? extractJobFamily(data) ?? '' : '');

    // Handles both shapes (old string[], new {competency, level}[]) — the
    // level becomes targetProficiency on the position's required competencies.
    setCompetencies(data ? parseJobProfileTechnicalCompetencies(data.technicalCompetencies) : []);
  }

  function handleSelectProfile(profileId: number) {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) {
      applyProfile(profile);
      setSuggestion(null); // user made a manual choice
    }
  }

  function removeCompetency(name: string) {
    setCompetencies((prev) => prev.filter((c) => c.technicalName !== name));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const fd = new FormData();
      fd.set('id', positionId);
      fd.set('education', educationInput);
      fd.set('experience', experienceInput);
      fd.set('jobFamily', jobFamilyInput);
      fd.set('competencies', JSON.stringify(competencies));
      await updatePositionQualificationsAction(fd);
      toast.success('Kualifikasi posisi termasuk kompetensi teknis berhasil diperbarui.');
      setOpen(false);
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            Pilih dari Job Profile
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Pilih Kualifikasi & Kompetensi dari Job Profile
          </DialogTitle>
          <DialogDescription>
            Cari dan pilih job profile yang sesuai. Data kualifikasi dan kompetensi teknis akan otomatis terisi.
          </DialogDescription>
        </DialogHeader>

        {suggestion && (
          <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="text-muted-foreground leading-relaxed">
              Disarankan otomatis dari{' '}
              {suggestion.source === 'family' ? 'pasangan incumbent (Job Family)' : 'kecocokan nama posisi'}:{' '}
              <strong className="text-foreground">{suggestion.name ?? 'job profile terpilih'}</strong>. Anda dapat
              menggantinya di daftar.
            </p>
          </div>
        )}

        <div className="flex-1 overflow-hidden grid gap-4 sm:grid-cols-2 min-h-0">
          {/* Left panel: search + profile list */}
          <div className="flex flex-col gap-3 min-h-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Cari job profile..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9 text-sm"
              />
            </div>
            <ScrollArea className="flex-1 border rounded-lg min-h-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProfiles.map((profile) => {
                  const isSelected = profile.id === selectedProfileId;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => handleSelectProfile(profile.id)}
                      className={`w-full text-left px-3 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/40 ${
                        isSelected ? 'bg-primary/5 ring-1 ring-primary/20' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate flex-1">
                          {profile.positionName ?? profile.fileName}
                        </p>
                        {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {profile.divisionDepartment ?? '-'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right panel: editable fields + competencies */}
          <div className="space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="jpf-education" className="text-xs font-semibold">Pendidikan</Label>
              <Input
                id="jpf-education"
                value={educationInput}
                onChange={(e) => setEducationInput(e.target.value)}
                className="h-9 text-sm"
                placeholder="Min. pendidikan"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jpf-experience" className="text-xs font-semibold">Pengalaman</Label>
              <Input
                id="jpf-experience"
                value={experienceInput}
                onChange={(e) => setExperienceInput(e.target.value)}
                className="h-9 text-sm"
                placeholder="Min. pengalaman"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="jpf-job-family" className="text-xs font-semibold">Job Family</Label>
              <Input
                id="jpf-job-family"
                value={jobFamilyInput}
                onChange={(e) => setJobFamilyInput(e.target.value)}
                className="h-9 text-sm"
                placeholder="Job family"
              />
            </div>

            {/* Competencies section */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">
                Kompetensi Teknis
                {competencies.length > 0 && (
                  <span className="ml-1.5 text-muted-foreground font-normal">({competencies.length})</span>
                )}
              </Label>
              {competencies.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic px-1">
                  Pilih job profile untuk mengisi kompetensi teknis.
                </p>
              ) : (
                <ScrollArea className="max-h-36">
                  <div className="space-y-1">
                    {competencies.map((comp) => (
                      <div
                        key={comp.technicalName}
                        className="flex items-center justify-between rounded-md border border-slate-200/70 dark:border-slate-800 bg-background px-2.5 py-1.5"
                      >
                        <span className="min-w-0 flex items-center gap-1.5">
                          <span className="text-xs font-medium truncate">{comp.technicalName}</span>
                          {comp.targetProficiency && (
                            <span className="shrink-0 rounded border border-emerald-300/60 bg-emerald-500/10 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                              {comp.targetProficiency}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeCompetency(comp.technicalName)}
                          className="p-0.5 rounded text-muted-foreground hover:text-destructive shrink-0 ml-2"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 pt-4 border-t mt-4">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={saving}>
            Batal
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Kualifikasi & Kompetensi'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
