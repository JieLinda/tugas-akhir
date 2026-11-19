'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';
import {
  Building2,
  ChevronDown,
  Clock,
  Gauge,
  Globe,
  Hash,
  Layers,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { GovernanceClientProps, GovernanceTabId } from './governance-types';
import { ProgramDetailEditor } from './governance-program-editor';
import { CreateProgramButton } from './governance-create-program';
import { AuditLogTab } from './governance-audit-log';
import { ScoringPromptsEditor } from './scoring-prompts-editor';
import { ReadinessEditor } from './readiness-editor';
import { RetirementEditor } from './retirement-editor';

/**
 * Where a section's settings apply. Programs and the audit log are rows of the
 * active Company; prompts and both threshold files are app-wide. The old page
 * never said which was which, and "I changed Readiness in Mulia and MSO changed
 * too" was a recurring question.
 */
type Scope = 'tenant' | 'global';

type Section = {
  id: GovernanceTabId;
  label: string;
  icon: LucideIcon;
  description: string;
  scope: Scope;
  badge?: number;
};

const SCOPE_LABEL: Record<Scope, { text: string; icon: LucideIcon; className: string }> = {
  tenant: {
    text: 'Berlaku untuk Company aktif',
    icon: Building2,
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  global: {
    text: 'Berlaku untuk semua Company',
    icon: Globe,
    className: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
};


/**
 * The "Ambang usia pensiun pejabat" editor is HIDDEN, not deleted (by request,
 * 2026-11). The thresholds still apply — lib/retirement-config.json is read by
 * Position Management's retirement badge and Beranda — they are just no longer
 * editable here. Flip to `true` to bring the editor (and the tab's "& Pensiun"
 * label) back; RetirementEditor and its action are untouched.
 */
const RETIREMENT_EDITOR_VISIBLE = false;

export function GovernanceClient({
  templates,
  auditLog,
  auditTotal,
  gradeLevels,
  scoringPrompts,
  readinessConfig,
  retirementConfig,
  fieldValues,
  initialTab = 'programs',
}: GovernanceClientProps) {
  const [activeTab, setActiveTab] = useState<GovernanceTabId>(initialTab);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    templates[0]?.id ?? null,
  );
  const [gradesOpen, setGradesOpen] = useState(false);

  // Keep the section in the URL so a refresh, a shared link or the browser's
  // back button lands on the same section. replaceState rather than
  // router.push: switching sections is not a navigation worth a history entry
  // and must not re-run the page's eleven server reads.
  function selectTab(next: string) {
    const id = next as GovernanceTabId;
    setActiveTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', id);
      window.history.replaceState(null, '', url);
    } catch {
      // URL sync is a convenience; the tab already switched.
    }
  }

  const selected = templates.find((t) => t.id === selectedTemplateId);

  const navGroups: { label: string; items: Section[] }[] = [
    {
      label: 'Aturan Penilaian',
      items: [
        {
          id: 'programs',
          label: 'Program Penilaian',
          icon: Settings,
          description:
            'Satu program = satu aturan main: aturan filter kandidat, target finalis, dan bobot AHP. Dipilih saat memulai scoring.',
          scope: 'tenant',
        },
        {
          id: 'prompts',
          label: 'Instruksi & Model AI',
          icon: Sparkles,
          description:
            'Prompt model bahasa yang dipakai metode AHP + TOPSIS: penilaian kriteria Pendidikan dan penulis insight per finalis.',
          scope: 'global',
        },
        {
          id: 'readiness',
          label: RETIREMENT_EDITOR_VISIBLE ? 'Kesiapan & Pensiun' : 'Kesiapan',
          icon: Gauge,
          description: RETIREMENT_EDITOR_VISIBLE
            ? 'Seberapa mendesak suksesi: ambang skor tingkat kesiapan kandidat (Short/Medium/Long) dan ambang usia pensiun pejabat per level.'
            : 'Ambang skor tingkat kesiapan kandidat (Short/Medium/Long) pada hasil scoring.',
          scope: 'global',
        },
      ],
    },
    {
      label: 'Pemantauan',
      items: [
        {
          id: 'audit',
          label: 'Riwayat Perubahan',
          icon: Clock,
          description:
            'Siapa mengubah apa di Tata Kelola. Perubahan prompt dan ambang tidak tercatat di sini karena tersimpan sebagai berkas konfigurasi, bukan data Company.',
          scope: 'tenant',
        },
      ],
    },
  ];
  const activeItem = navGroups.flatMap((g) => g.items).find((i) => i.id === activeTab);
  const scope = activeItem ? SCOPE_LABEL[activeItem.scope] : null;
  const ScopeIcon = scope?.icon;

  const levelNames = Array.from(
    new Set(gradeLevels.map((g) => g.levelName).filter((n): n is string => Boolean(n))),
  );

  return (
    <Tabs value={activeTab} onValueChange={selectTab}>
      <div className="grid items-start gap-5 lg:grid-cols-[236px_minmax(0,1fr)]">
        {/* Grouped section nav */}
        <aside className="h-fit rounded-xl border bg-card p-2 shadow-xs lg:sticky lg:top-4">
          {navGroups.map((group) => (
            <div key={group.label} className="space-y-0.5 pb-2 last:pb-0">
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/55">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = activeTab === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-primary/10 font-semibold text-primary'
                        : 'font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <Badge
                        variant="secondary"
                        className="h-4 min-w-4 justify-center rounded-full bg-rose-500/15 px-1 text-[10px] font-bold text-rose-600 dark:text-rose-400"
                      >
                        {item.badge}
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Active section */}
        <div className="min-w-0 space-y-4">
          {activeItem && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-primary">
                  <activeItem.icon className="h-4.5 w-4.5" />
                </div>
                <h2 className="flex min-w-0 items-center gap-1.5 text-base font-bold leading-tight">
                  {activeItem.label}
                  <InfoHint title={activeItem.label}>
                    <p>{activeItem.description}</p>
                    <p>
                      Perubahan di halaman ini berlaku untuk run berikutnya. Run yang sudah selesai menyimpan aturannya
                      sendiri dan tidak berubah.
                    </p>
                  </InfoHint>
                </h2>
              </div>
              {scope && ScopeIcon && (
                <Badge variant="outline" className={cn('shrink-0 gap-1.5 font-medium', scope.className)}>
                  <ScopeIcon className="h-3 w-3" />
                  {scope.text}
                </Badge>
              )}
            </div>
          )}

          {/* ─── Program Penilaian ─── */}
          <TabsContent value="programs" className="space-y-4">
            {/* Program picker as a chip row: a second left column beside the
                section nav used to squeeze the editor into the remaining
                third of the page and read as one more menu level. */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-2">
              <span className="px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Program
              </span>
              {templates.map((t) => {
                const active = t.id === selectedTemplateId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTemplateId(t.id)}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors',
                      active
                        ? 'border-primary/40 bg-primary/10 font-semibold text-primary'
                        : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                    )}
                  >
                    <Layers className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.name}</span>
                    {t.isSystem && (
                      <Badge variant="outline" className="text-[10px]">
                        Built-in
                      </Badge>
                    )}
                  </button>
                );
              })}
              <div className="ml-auto">
                <CreateProgramButton variant="chip" />
              </div>
            </div>

            {selected ? (
              // Keyed by id so switching programs starts a fresh editor state
              // instead of leaking one program's unsaved edits into another.
              <ProgramDetailEditor key={selected.id} template={selected} fieldValues={fieldValues} />
            ) : (
              <Card className="flex items-center justify-center p-12 text-sm text-muted-foreground">
                Pilih program di atas untuk melihat dan mengubah aturannya.
              </Card>
            )}
          </TabsContent>

          {/* ─── Instruksi & Model AI ─── */}
          <TabsContent value="prompts" className="space-y-6">
            <SectionBlock
              title="Prompt AHP + TOPSIS"
              hint="Pendidikan: dipakai hanya bila pendidikan kandidat tidak persis sama dengan syarat job profile — model menilai kecocokan jenjang dan jurusan. Insight finalis: narasi keunggulan, kebutuhan pengembangan, dan arahan suksesi; tidak mengubah skor, peringkat, atau kesiapan. Berlaku untuk semua Company."
            >
              <ScoringPromptsEditor data={scoringPrompts} />
            </SectionBlock>
          </TabsContent>

          {/* ─── Kesiapan & Pensiun ─── */}
          {/* Both answer "how urgent is this succession?" — one from the
              candidate's score, one from the incumbent's remaining time. The
              grade ladder sits underneath as the reference the retirement
              thresholds are keyed on. */}
          <TabsContent value="readiness" className="space-y-6">
            <SectionBlock
              step={RETIREMENT_EDITOR_VISIBLE ? '1' : undefined}
              title="Tingkat kesiapan kandidat"
              hint="Ambang skor akhir yang menentukan Short / Medium / Long / Not Ready pada hasil scoring."
            >
              <ReadinessEditor initialConfig={readinessConfig} />
            </SectionBlock>
            {RETIREMENT_EDITOR_VISIBLE && (
              <SectionBlock
                step="2"
                title="Ambang usia pensiun pejabat"
                hint="Usia per level yang membuat pejabat ditandai mendekati pensiun di Manajemen Posisi."
              >
                <RetirementEditor initialConfig={retirementConfig} levelNames={levelNames} />
              </SectionBlock>
            )}

            <Collapsible open={gradesOpen} onOpenChange={setGradesOpen}>
              <Card className="border-dashed shadow-none">
                {/* The hint sits beside the trigger, not inside it: a button
                    inside the trigger button would be invalid and would also
                    fold the card when it was only meant to explain it. */}
                <div className="flex items-center gap-1 pr-3 transition-colors hover:bg-muted/30">
                  <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 text-left">
                    <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="min-w-0 flex-1 text-sm font-semibold">Referensi: master grade per level</p>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {gradeLevels.length} baris
                    </Badge>
                    <ChevronDown
                      className={cn(
                        'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                        gradesOpen ? 'rotate-180' : '',
                      )}
                    />
                  </CollapsibleTrigger>
                  <InfoHint title="Referensi: master grade per level" align="end">
                    Level dan grade dari sinkronisasi HR (MPMHRGA) — acuan nama level di ambang pensiun dan rentang
                    grade pada pendaftaran posisi. Baca-saja.
                  </InfoHint>
                </div>
                <CollapsibleContent>
                  <CardContent className="border-t p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Company</TableHead>
                          <TableHead>Level ID</TableHead>
                          <TableHead>Nama Level</TableHead>
                          <TableHead>Grade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gradeLevels.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                              Belum ada data grade. Jalankan sinkronisasi terlebih dahulu.
                            </TableCell>
                          </TableRow>
                        ) : (
                          gradeLevels.map((g, i) => (
                            <TableRow key={`${g.companyId}-${g.levelId}-${g.gradeId}-${i}`}>
                              <TableCell className="font-mono text-sm">{g.companyId}</TableCell>
                              <TableCell className="text-sm">{g.levelId}</TableCell>
                              <TableCell className="text-sm">{g.levelName ?? '—'}</TableCell>
                              <TableCell className="text-sm">{g.gradeId}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </TabsContent>

          {/* ─── Riwayat Perubahan ─── */}
          <TabsContent value="audit">
            <AuditLogTab initialEntries={auditLog} initialTotal={auditTotal} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}

/** Sub-heading for a section's editor; numbered when the section stacks several. */
function SectionBlock({
  step,
  title,
  hint,
  children,
}: {
  step?: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        {step && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
            {step}
          </span>
        )}
        <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-tight">
          {title}
          <InfoHint title={title}>{hint}</InfoHint>
        </h3>
      </div>
      {children}
    </section>
  );
}
