'use client';

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  Download,
  Filter,
  Grid2x2,
  Info,
  Loader2,
  Pencil,
  RotateCcw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FilterRuleEditor, FilterTreeView } from '@/components/governance/governance-filter-editor';
import { TalentPoolRuleImportDialog } from '@/components/talent-pool-rule-import-dialog';
import { FIELD_VALUE_OPTIONS } from '@/lib/candidate-field-values';
import { countDisabledFilterRules, countEnabledFilterRules } from '@/lib/filter-rules';
import {
  previewTalentPoolFilterAction,
  updateTalentPoolFilterAction,
} from '@/lib/talent-pool-actions';
import type { TalentPoolData } from '@/lib/talent-pool-data';
import type {
  CandidateAttributeField,
  FilterConditionGroup,
  FilterRule,
} from '@/lib/db/schema';
import { cn } from '@/lib/utils';
import { InfoHint } from '@/components/ui/info-hint';

/**
 * What each rule does BEYOND this list — said under the rule itself, in the
 * editor and in the read view alike. The Talent Pool rules and Talent Mapping
 * share one tree but use it differently (HR decision, 2026-10), and that split
 * is invisible from the rules alone:
 *
 *   - Disiplin also decides who appears on Talent Mapping (`talentMappingGateTree`);
 *   - HAV, PA and BA are the map's INPUTS, so they never filter it;
 *   - an advisory rule (MCU) disqualifies nobody here either — it only flags.
 *
 * The switched-off case of a non-discipline rule needs no note: the switch row
 * (editor) and the "nonaktif" badge (read view) already say it.
 */
function talentPoolRuleNote(rule: FilterRule): ReactNode {
  const off = rule.enabled === false;
  if (rule.field === 'disciplineStatus') {
    return (
      <RuleNote tone="gate" icon={<Grid2x2 className="h-3 w-3" />}>
        {off
          ? 'Nonaktif — aturan ini tidak lagi menyaring Talent Mapping.'
          : 'Juga menentukan siapa yang tampil di Talent Mapping: peta memuat semua kandidat yang lolos aturan disiplin ini, tanpa memandang aturan lainnya.'}
      </RuleNote>
    );
  }
  if (off) return null;
  if (rule.severity === 'advisory') {
    return (
      <RuleNote>Hanya menandai — tidak menggugurkan siapa pun di daftar ini.</RuleNote>
    );
  }
  if (rule.field === 'havQuadrant') {
    return (
      <RuleNote>
        Dinilai dengan HAV yang berlaku (manual › upload › rumus PA × BA). Di Talent Mapping HAV
        adalah input, jadi aturan ini tidak menyaring peta — hanya menentukan status Lolos Talent
        Pool yang ditampilkan di sana.
      </RuleNote>
    );
  }
  if (rule.field === 'performanceGrade' || rule.field === 'behaviorRecommendation') {
    return (
      <RuleNote>
        Input Talent Mapping (sumbu {rule.field === 'performanceGrade' ? 'kinerja / PA' : 'kompetensi perilaku / BA'}
        ) — tidak menyaring peta.
      </RuleNote>
    );
  }
  return <RuleNote>Hanya untuk daftar Talent Pool — tidak memengaruhi Talent Mapping.</RuleNote>;
}

function RuleNote({
  children,
  tone = 'muted',
  icon,
}: {
  children: ReactNode;
  tone?: 'muted' | 'gate';
  icon?: ReactNode;
}) {
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-[11px] leading-relaxed',
        tone === 'gate' ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-muted-foreground',
      )}
    >
      <span className="mt-0.5 shrink-0">{icon ?? <Info className="h-3 w-3" />}</span>
      <span>{children}</span>
    </p>
  );
}

/**
 * The eligibility rules, shown and edited where their consequence is displayed.
 *
 * The Talent Pool list IS the output of this tree, and the tree used to live
 * one page away in Tata Kelola — so the loop for tuning a bar was edit, save,
 * navigate, count, navigate back. Two blocks here close it: the rules render
 * above the list that obeys them, and an edit previews its own effect (how many
 * people it admits and removes, and what it does to Talent Mapping) before
 * anything is written.
 *
 * Each rule can be removed, or switched OFF (`enabled: false`): kept with its
 * values, evaluated by nothing, restorable with one click. That is what
 * "menonaktifkan kriteria" means here, and the engine strips such a rule rather
 * than treating it as passed (lib/filter-rules.ts `decidingFilterTree`).
 *
 * The preview is not a second implementation of the filter. It calls the same
 * `getTalentPoolData` the page was rendered with, passing the unsaved tree as an
 * override, so a previewed count and the saved one cannot disagree.
 *
 * Editing needs `governance.manage`, not the `candidates.view` that opens this
 * page: this is a program template like the ones that gate scoring, so
 * surfacing it here must not widen who may change it. Without the permission
 * the panel is read-only, and the server action refuses regardless.
 */
export function TalentPoolFilterPanel({
  data,
  canManage,
  fieldValues,
  onDataChange,
}: {
  data: TalentPoolData;
  canManage: boolean;
  /** Distinct values present in candidate data, per field — drives the pickers. */
  fieldValues: Partial<Record<string, string[]>>;
  /** Hand the recomputed pool back to the page after a save. */
  onDataChange: (next: TalentPoolData) => void;
}) {
  const program = data.program;
  const savedTree = program?.filterTree ?? null;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [tree, setTree] = useState<FilterConditionGroup | null>(savedTree);
  const [saving, startSaving] = useTransition();
  const [importOpen, setImportOpen] = useState(false);
  // Rule sets applied into the current draft, named in the audit line on save.
  const [appliedFrom, setAppliedFrom] = useState<string[]>([]);

  // What the unsaved tree WOULD produce. `null` until the first preview lands.
  const [preview, setPreview] = useState<{
    qualified: number;
    notQualified: number;
    mappingPopulation: number;
  } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewSeq = useRef(0);

  // A save replaces the saved tree; re-seed the draft so "Batal" returns to
  // what is now in force rather than to what it was two saves ago.
  useEffect(() => {
    setTree(savedTree);
    setAppliedFrom([]);
  }, [savedTree]);

  const dirty =
    tree !== null && savedTree !== null && JSON.stringify(tree) !== JSON.stringify(savedTree);

  // Debounced preview. Every edit is a few keystrokes away from the next, and
  // this reads every candidate row in the business unit — so it waits for the
  // typing to stop. `previewSeq` drops an answer that arrived after a newer
  // request, which is what stops the counts flickering backwards.
  useEffect(() => {
    if (!editing || !tree || !dirty) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    const seq = ++previewSeq.current;
    setPreviewing(true);
    const timer = setTimeout(() => {
      previewTalentPoolFilterAction(tree)
        .then((next) => {
          if (seq !== previewSeq.current) return;
          setPreview({
            qualified: next.qualified.length,
            notQualified: next.notQualified.length,
            mappingPopulation: next.mappingPopulation,
          });
        })
        .catch(() => {
          if (seq === previewSeq.current) setPreview(null);
        })
        .finally(() => {
          if (seq === previewSeq.current) setPreviewing(false);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [editing, tree, dirty]);

  const displayRuleValue = useCallback(
    (field: CandidateAttributeField, value: FilterRule['value']): string => {
      const opts = FIELD_VALUE_OPTIONS[field] ?? [];
      const label = (v: string | number) =>
        opts.find((o) => o.value === String(v))?.label ?? String(v);
      if (Array.isArray(value)) return (value as (string | number)[]).map(label).join(', ');
      if (value == null) return '';
      return label(value);
    },
    [],
  );

  function handleCancel() {
    setTree(savedTree);
    setAppliedFrom([]);
    setPreview(null);
    setEditing(false);
  }

  function handleSave() {
    if (!tree) return;
    startSaving(async () => {
      try {
        const res = await updateTalentPoolFilterAction({ filterTree: tree, appliedFrom });
        if (!res.ok || !res.data) {
          toast.error(res.message);
          return;
        }
        toast.success(res.message);
        onDataChange(res.data);
        setAppliedFrom([]);
        setPreview(null);
        setEditing(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan aturan filter.');
      }
    });
  }

  // No program at all — the page already shows a destructive banner saying so,
  // and there is no tree to render or edit.
  if (!program || !tree) return null;

  const enabledCount = countEnabledFilterRules(tree);
  const disabledCount = countDisabledFilterRules(tree);
  const delta = preview ? preview.qualified - data.qualified.length : 0;
  const mapDelta = preview ? preview.mappingPopulation - data.mappingPopulation : 0;

  return (
    <Card className="overflow-hidden">
      {/* Tinted band, same idiom as CollapsibleCard's `primary` accent: the
          whole header is the toggle, and a header that looks exactly like the
          card body gives no sign of that. The tint deepens on hover and the
          chevron turns, so the affordance survives for anyone who does not
          notice the colour. */}
      <CardHeader
        className={cn(
          '-mt-6 cursor-pointer border-b border-border/60 bg-primary/6 pt-5 pb-4 transition-colors hover:bg-primary/11 dark:bg-primary/10 dark:hover:bg-primary/15',
          open && 'bg-primary/9 dark:bg-primary/14',
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <button
            type="button"
            onClick={(e) => {
              // The band already toggles; this keeps the keyboard path working
              // without the click counting twice.
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            className="group -m-1 flex min-w-0 cursor-pointer items-start gap-2 rounded-lg p-1 text-left"
          >
            <span className="min-w-0 flex-1">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <Filter className="h-4 w-4 text-primary" />
                Aturan Filter Talent Pool
                <Badge variant="outline" className="font-normal">
                  {enabledCount} aturan aktif
                </Badge>
                {disabledCount > 0 && (
                  <Badge variant="outline" className="border-dashed font-normal text-muted-foreground">
                    {disabledCount} nonaktif
                  </Badge>
                )}
                {dirty && (
                  <Badge className="border-amber-500/30 bg-amber-500/15 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    Belum disimpan
                  </Badge>
                )}
              </CardTitle>
            </span>
            <ChevronDown
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0 text-primary transition-transform group-hover:text-primary',
                open && 'rotate-180',
              )}
            />
          </button>
          {/* Beside the toggle, not inside it — InfoHint stops its own click,
              so explaining the panel never folds it. */}
          <InfoHint title="Aturan Filter Talent Pool" className="mt-1">
            Aturan lengkap yang memisahkan daftar di bawah menjadi Lolos dan Tidak Lolos — murni gambaran terima/tolak,
            berlaku untuk Company aktif. Setiap aturan bisa diubah, dihapus, atau dinonaktifkan. Hanya aturan{' '}
            <strong>Disiplin</strong> yang juga menentukan siapa yang tampil di Talent Mapping.
          </InfoHint>
          <span className="flex-1" aria-hidden />

          {open && canManage && !editing && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 bg-background"
              onClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Ubah aturan filter
            </Button>
          )}
        </div>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4 pt-5">
          {!canManage && (
            <p className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Anda dapat melihat aturan filternya; mengubahnya membutuhkan izin kelola tata kelola.
            </p>
          )}

          {editing ? (
            <>
              {/* No "Tegakkan aturan saat scoring" switch, and no per-rule
                  Menggugurkan / Hanya menandai choice. Both decide what a
                  SCORING RUN does with a failing candidate, and Talent Pool is
                  in NON_POSITION_PROGRAM_CODES — no run is ever started under
                  it. A rule written here carries no `severity`, which the
                  engine reads as hard; the stored advisory MCU rule keeps its
                  severity and its note says what that means. The Aktif /
                  Nonaktif switch IS offered: it changes this list, now. */}
              {/* Rules already saved on a program template — this unit's
                  templates as they stand now, or a system program's shipped
                  defaults — applied into the DRAFT. Nothing is written here:
                  the preview below counts the result and Simpan stays the
                  only write. */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
                <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">Mulai dari aturan tersimpan</span>
                  <InfoHint size="xs" title="Mulai dari aturan tersimpan">
                    Pakai aturan yang sudah tersimpan di template program lain (mis. Critical Position) atau aturan
                    bawaan sistem sebagai titik awal. Tidak ada yang ditulis sampai Anda menekan Simpan.
                  </InfoHint>
                  {appliedFrom.length > 0 && (
                    <span className="mt-0.5 w-full text-foreground">
                      Diterapkan ke draf: {appliedFrom.join(', ')}
                    </span>
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1.5"
                  onClick={() => setImportOpen(true)}
                  disabled={saving}
                >
                  <Download className="h-3.5 w-3.5" />
                  Terapkan dari template program
                </Button>
              </div>
              <TalentPoolRuleImportDialog
                open={importOpen}
                onOpenChange={setImportOpen}
                draft={tree}
                displayValue={displayRuleValue}
                onApply={(result, source) => {
                  setTree(result.tree);
                  const name =
                    source.kind === 'system_default'
                      ? `${source.name} (bawaan sistem)`
                      : source.isTalentPool
                        ? `${source.name} (tersimpan)`
                        : source.name;
                  setAppliedFrom((prev) => (prev.includes(name) ? prev : [...prev, name]));
                  toast.success(
                    `Aturan dari ${name} diterapkan ke draf — periksa dampaknya, lalu simpan.`,
                  );
                }}
              />

              <FilterRuleEditor
                tree={tree}
                onChange={setTree}
                fieldValues={fieldValues}
                showSeverity={false}
                allowDisable
                ruleNote={talentPoolRuleNote}
              />

              {/* The answer, before the write. Without it the only way to learn
                  what a rule costs is to save it and count afterwards. */}
              <div className="rounded-lg border bg-muted/20 p-3">
                {!dirty ? (
                  <p className="text-xs text-muted-foreground">
                    Ubah, hapus, atau nonaktifkan aturan filter di atas untuk melihat dampaknya
                    sebelum disimpan.
                  </p>
                ) : previewing || !preview ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Menghitung dampak aturan filter baru…
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Bila disimpan
                    </p>
                    <p className="text-xs">
                      Lolos{' '}
                      <strong className="tabular-nums text-foreground">{preview.qualified}</strong>
                      <span className="text-muted-foreground"> dari {data.totalEvaluated}</span>
                      <DeltaChip delta={delta} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Tidak lolos{' '}
                      <strong className="tabular-nums text-foreground">{preview.notQualified}</strong>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Talent Mapping{' '}
                      <strong className="tabular-nums text-foreground">
                        {preview.mappingPopulation}
                      </strong>{' '}
                      kandidat di peta
                      <DeltaChip delta={mapDelta} />
                    </p>
                    {preview.qualified === 0 && (
                      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <TriangleAlert className="h-3.5 w-3.5" />
                        Tidak ada kandidat yang lolos aturan filter ini.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving} className="gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  Batalkan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTree(savedTree);
                    setAppliedFrom([]);
                  }}
                  disabled={saving || !dirty}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Kembalikan
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving || !dirty} className="gap-1.5">
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Simpan &amp; perbarui daftar
                </Button>
              </div>
            </>
          ) : tree.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada aturan filter — seluruh kandidat aktif masuk pool, dan Talent Mapping memuat
              seluruh kandidat aktif.
            </p>
          ) : (
            <FilterTreeView
              node={tree}
              displayValue={displayRuleValue}
              showSeverity={false}
              ruleNote={talentPoolRuleNote}
            />
          )}
        </CardContent>
      )}
    </Card>
  );
}

function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0) return null;
  return (
    <span
      className={cn(
        'ml-1.5 font-semibold tabular-nums',
        delta > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300',
      )}
    >
      {delta > 0 ? `+${delta}` : delta}
    </span>
  );
}
