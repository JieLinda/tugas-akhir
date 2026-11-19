'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoHint } from '@/components/ui/info-hint';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  GripVertical,
  Eye,
  ChevronDown,
  RotateCcw,
  Wand2,
  Code2,
  LayoutTemplate,
  ArrowUp,
  ArrowDown,
  Plus,
} from 'lucide-react';
import {
  getRestructureSampleAction,
  embedSingleJobProfileAction,
  saveRestructureTemplateAction,
  saveRestructureOverrideAction,
  type JobProfileOption,
  type RestructureSample,
} from '@/lib/job-family-actions';
import {
  restructureJobProfile,
  TEMPLATE_TOKENS,
  SECTION_LABELS,
  SECTION_GROUPS,
  DEFAULT_RESTRUCTURE_TEMPLATE,
} from '@/lib/job-family/restructure';
import {
  editProfileTemplate,
  isOverrideDirty,
  isTemplateDirty,
  overrideOf,
  type JobFamilyConfig,
} from '@/lib/job-family/config';
import {
  defaultSectionText,
  enableAllSections,
  moveSection,
  moveSectionTo,
  parseTemplate,
  setSectionText,
  toggleSection,
  type TemplateToken,
} from '@/lib/job-family/template-editor';

// ── Section metadata ──────────────────────────────────────────

const GROUP_LABELS: Record<string, string> = {
  informasi_administratif: 'Informasi Administratif',
  struktur_organisasi: 'Struktur Organisasi',
  kualifikasi: 'Kualifikasi',
  kompetensi: 'Kompetensi',
  substansi_jabatan: 'Substansi Jabatan',
  hubungan_kerja: 'Hubungan Kerja',
};

const GROUP_DESCRIPTIONS: Record<string, string> = {
  informasi_administratif: 'Nama jabatan, divisi, dan departemen.',
  struktur_organisasi: 'Atasan, bawahan, dan posisi dalam bagan organisasi.',
  kualifikasi: 'Pendidikan, pengalaman, dan keahlian yang dibutuhkan.',
  kompetensi: 'Kompetensi teknis dan perilaku yang diperlukan.',
  substansi_jabatan: 'Tujuan jabatan, tanggung jawab, dan wewenang.',
  hubungan_kerja: 'Relasi kerja internal dan eksternal.',
};

const TOKEN_DESCRIPTIONS: Record<string, string> = {
  positionName: 'Nama jabatan dari dokumen job profile.',
  divisionDepartment: 'Divisi dan departemen tempat jabatan berada.',
  directSupervisor: 'Nama atasan langsung.',
  subordinates: 'Daftar bawahan langsung.',
  organizationChart: 'Ringkasan posisi dalam bagan organisasi.',
  education: 'Kualifikasi pendidikan yang disyaratkan.',
  experience: 'Pengalaman kerja yang disyaratkan.',
  skills: 'Keahlian yang dibutuhkan.',
  technicalCompetencies: 'Daftar kompetensi teknis dengan levelnya.',
  behavioralCompetencies: 'Daftar kompetensi perilaku.',
  jobPurpose: 'Tujuan utama jabatan.',
  responsibilities: 'Tanggung jawab dan indikator keberhasilan.',
  authorities: 'Wewenang yang dimiliki jabatan.',
  internalRelationships: 'Hubungan kerja dengan pihak internal.',
  externalRelationships: 'Hubungan kerja dengan pihak eksternal.',
};

// ── Sections ──────────────────────────────────────────────────
// Parsing and rebuilding a template lives in lib/job-family/template-editor.ts.

type SectionItem = {
  token: TemplateToken;
  label: string;
  groupId: string;
};

const ALL_SECTIONS: SectionItem[] = (Object.entries(SECTION_GROUPS) as [string, readonly TemplateToken[]][])
  .flatMap(([groupId, tokens]) =>
    tokens.map((token) => ({ token, label: SECTION_LABELS[token], groupId })),
  );

function insertTokenAtCursor(currentText: string, cursorPos: number | null, token: string): string {
  const pos = cursorPos ?? currentText.length;
  const insert = `{{${token}}}`;
  return currentText.slice(0, pos) + insert + currentText.slice(pos);
}

// ── Help sub-components ───────────────────────────────────────

function TokenHelpBadges({
  onInsert,
}: {
  onInsert?: (token: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {TEMPLATE_TOKENS.map((t) => (
        <Tooltip key={t}>
          <TooltipTrigger asChild>
            {onInsert ? (
              <button
                type="button"
                className="inline-flex cursor-pointer items-center rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] transition-colors hover:bg-primary/10 hover:border-primary/40"
                onClick={() => onInsert(t)}
              >
                <Plus className="mr-0.5 h-2.5 w-2.5" />
                {`{{${t}}}`}
              </button>
            ) : (
              <Badge variant="secondary" className="cursor-default font-mono text-[10px]">
                {`{{${t}}}`}
              </Badge>
            )}
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">{SECTION_LABELS[t as keyof typeof SECTION_LABELS]}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{TOKEN_DESCRIPTIONS[t]}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function PreviewPane({ title, text, empty }: { title: string; text: string; empty: string }) {
  return (
    <div className="flex flex-col rounded-xl border bg-card overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {text && (
          <Badge variant="outline" className="ml-auto text-[10px]">
            {text.length.toLocaleString('id-ID')} karakter
          </Badge>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4">
        {text ? (
          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/85">
            {text}
          </pre>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">{empty}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  enabled,
  currentText,
  defaultText,
  onToggle,
  onTextChange,
  onMoveUp,
  onMoveDown,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isFirst,
  isLast,
  isDragging,
  isDragOver,
}: {
  section: SectionItem;
  enabled: boolean;
  currentText?: string;
  defaultText?: string;
  onToggle: () => void;
  onTextChange?: (text: string) => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const displayText = currentText || defaultText || `${section.label}: {{${section.token}}}`;
  const isCustom = currentText && currentText !== defaultText;

  const insertToken = useCallback(
    (token: string) => {
      const ta = textareaRef.current;
      const cursorPos = ta ? ta.selectionStart : null;
      const newText = insertTokenAtCursor(displayText, cursorPos, token);
      onTextChange?.(newText);
      setTimeout(() => {
        if (ta) {
          const newPos = (cursorPos ?? displayText.length) + `{{${token}}}`.length;
          ta.focus();
          ta.setSelectionRange(newPos, newPos);
        }
      }, 0);
    },
    [displayText, onTextChange],
  );

  return (
    <div
      draggable={enabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`flex items-start gap-2 rounded-lg border p-3 transition-all ${
        isDragging
          ? 'opacity-40 scale-[0.98]'
          : isDragOver
            ? 'border-primary/60 bg-primary/5 shadow-[0_0_0_2px_rgba(234,88,12,0.15)]'
            : enabled
              ? 'border-primary/30 bg-primary/5'
              : 'border-muted bg-muted/20 opacity-60 hover:opacity-80'
      }`}
    >
      <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
        {enabled && onMoveUp && (
          <Button variant="ghost" size="icon" className="h-5 w-5" disabled={isFirst} onClick={onMoveUp}>
            <ArrowUp className="h-3 w-3" />
          </Button>
        )}
        <div className="flex-1 flex items-center cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-primary/80 transition-colors">
          <GripVertical className={`h-4 w-4 ${enabled ? '' : 'invisible'}`} />
        </div>
        {enabled && onMoveDown && (
          <Button variant="ghost" size="icon" className="h-5 w-5" disabled={isLast} onClick={onMoveDown}>
            <ArrowDown className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-muted-foreground mb-1">{section.label}</p>
            {enabled && onTextChange ? (
              <Textarea
                ref={textareaRef}
                value={displayText}
                onChange={(e) => onTextChange(e.target.value)}
                rows={Math.min(displayText.split('\n').length, 3)}
                className="min-h-[28px] resize-none font-mono text-xs leading-relaxed"
                placeholder={defaultText || `${section.label}: {{${section.token}}}`}
              />
            ) : (
              <p className="font-mono text-xs text-foreground/70 leading-relaxed break-all">
                {displayText}
              </p>
            )}
          </div>
        </div>

        {enabled && onTextChange && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground">Sisipkan token:</p>
            <TokenHelpBadges onInsert={insertToken} />
          </div>
        )}

        {isCustom && enabled && (
          <p className="text-[10px] text-primary/70">
            Default: {defaultText || `${section.label}: {{${section.token}}}`}
          </p>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex shrink-0 items-center pt-0.5">
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="left">
          {enabled ? 'Nonaktifkan bagian ini' : 'Aktifkan bagian ini'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

export function RestructureTemplateCard({
  config,
  setConfig,
  saved,
  onSaved,
  profileOptions,
  initialSample,
  pgvectorReady,
  canManage,
}: {
  /** The draft every control here edits. */
  config: JobFamilyConfig;
  setConfig: React.Dispatch<React.SetStateAction<JobFamilyConfig>>;
  /** The config as the server holds it; "belum disimpan" is measured against it. */
  saved: JobFamilyConfig;
  /** Receives the whole saved config after a save, so the parent can adopt it. */
  onSaved: (next: JobFamilyConfig) => void;
  profileOptions: JobProfileOption[];
  initialSample: RestructureSample | null;
  pgvectorReady: boolean;
  canManage: boolean;
}) {
  const [mode, setMode] = useState<'global' | 'specific'>('global');
  const [editorMode, setEditorMode] = useState<'visual' | 'raw'>('visual');
  const [selectedId, setSelectedId] = useState('');
  const [sample, setSample] = useState<RestructureSample | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const [busy, setBusy] = useState<'template' | 'override' | 'embed' | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(Object.keys(SECTION_GROUPS)),
  );
  const [dragToken, setDragToken] = useState<TemplateToken | null>(null);
  const [dragOverToken, setDragOverToken] = useState<TemplateToken | null>(null);

  // ── Global template ──
  const globalParsed = useMemo(
    () => parseTemplate(config.restructureTemplate),
    [config.restructureTemplate],
  );
  const templateDirty = isTemplateDirty(config, saved);

  // ── This profile's own template ('' = follows the global one) ──
  const override = selectedId ? overrideOf(config, selectedId) : '';
  const savedOverride = selectedId ? overrideOf(saved, selectedId) : '';
  const hasOverride = Boolean(override);
  const overrideDirty = selectedId ? isOverrideDirty(config, saved, selectedId) : false;
  const specificSourceTemplate = hasOverride ? override : config.restructureTemplate;
  const specificParsed = useMemo(
    () => parseTemplate(specificSourceTemplate),
    [specificSourceTemplate],
  );
  // A profile that follows the global template is embedded with the SAVED one,
  // while the preview here shows the draft. Embedding then would store a vector
  // of text nobody saw, so the button waits for the global template to be saved.
  const embedBlockedByGlobal = !hasOverride && templateDirty;

  /** Edit the global template. Never touches any profile's own template. */
  const editGlobal = useCallback(
    (fn: (template: string) => string) =>
      setConfig((c) => ({ ...c, restructureTemplate: fn(c.restructureTemplate) })),
    [setConfig],
  );

  /**
   * Edit the selected profile's own template. The first edit starts it from the
   * global template as currently shown; the global template itself is never
   * written from here.
   */
  const editSpecific = useCallback(
    (fn: (template: string) => string) => {
      if (selectedId) setConfig((c) => editProfileTemplate(c, selectedId, fn));
    },
    [selectedId, setConfig],
  );

  const resetGlobalTemplate = useCallback(() => {
    editGlobal(() => DEFAULT_RESTRUCTURE_TEMPLATE);
    toast.success('Template dikembalikan ke default (belum disimpan).');
  }, [editGlobal]);

  // ── Drag-and-drop handlers ──
  const handleDragStart = useCallback((token: TemplateToken) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', token);
    setDragToken(token);
  }, []);

  const handleDragOver = useCallback((token: TemplateToken) => (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverToken(token);
  }, []);

  const handleDrop = useCallback(
    (targetToken: TemplateToken, mode: 'global' | 'specific') => (e: React.DragEvent) => {
      e.preventDefault();
      const fromToken = e.dataTransfer.getData('text/plain') as TemplateToken;
      setDragToken(null);
      setDragOverToken(null);
      if (!fromToken || fromToken === targetToken) return;
      const edit = mode === 'global' ? editGlobal : editSpecific;
      edit((t) => moveSectionTo(t, fromToken, targetToken));
    },
    [editGlobal, editSpecific],
  );

  const handleDragEnd = useCallback(() => {
    setDragToken(null);
    setDragOverToken(null);
  }, []);

  // ── Previews ──
  const globalPreview = restructureJobProfile(
    initialSample?.extractedData,
    config.restructureTemplate,
  );

  const specificPreview = sample
    ? restructureJobProfile(sample.extractedData, specificSourceTemplate)
    : '';

  // ── Profile selection ──
  const options: ComboboxOption[] = profileOptions.map((p) => ({
    value: String(p.id),
    label: p.positionName ?? `Profil #${p.id}`,
    description: p.divisionDepartment ?? undefined,
  }));

  async function onSelectProfile(value: string) {
    // Unsaved edits to the previous profile stay in the draft and are still
    // there when it is selected again.
    setSelectedId(value);
    setSample(null);
    if (!value) return;
    setSampleLoading(true);
    try {
      setSample(await getRestructureSampleAction(Number(value)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memuat data profil.');
    } finally {
      setSampleLoading(false);
    }
  }

  // ── Saving: each button writes only its own part ──

  async function saveGlobalTemplate() {
    setBusy('template');
    try {
      onSaved(await saveRestructureTemplateAction(config.restructureTemplate));
      toast.success('Template global tersimpan. Berlaku setelah Jalankan Transformasi.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  async function saveOverride() {
    if (!selectedId) return;
    setBusy('override');
    try {
      onSaved(await saveRestructureOverrideAction(Number(selectedId), override || null));
      toast.success(
        override
          ? 'Template khusus tersimpan.'
          : 'Template khusus dihapus; profil ini kembali mengikuti template global.',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setBusy(null);
    }
  }

  async function clearOverride() {
    if (!selectedId) return;
    setBusy('override');
    try {
      const next = await saveRestructureOverrideAction(Number(selectedId), null);
      // Drop the draft's copy too, saved or not: this button removes the
      // template, it does not merely revert unsaved edits to it.
      setConfig((c) => {
        const { [selectedId]: _removed, ...rest } = c.restructureOverrides;
        return { ...c, restructureOverrides: rest };
      });
      onSaved(next);
      toast.success('Template khusus dihapus; profil ini kembali mengikuti template global.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Restructure and embed THIS profile. Its own template is saved first when it
   * has unsaved edits, so the stored vector and the stored template agree;
   * nothing else is saved.
   */
  async function embedOne() {
    if (!selectedId || embedBlockedByGlobal) return;
    setBusy('embed');
    try {
      if (overrideDirty) {
        onSaved(await saveRestructureOverrideAction(Number(selectedId), override || null));
      }
      const res = await embedSingleJobProfileAction(Number(selectedId));
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal meng-embed profil.');
    } finally {
      setBusy(null);
    }
  }

  // ── Render helper: visual section list ──
  function renderVisualEditor(dragMode: 'global' | 'specific') {
    const { order: tokens, blocks: texts } = dragMode === 'global' ? globalParsed : specificParsed;
    const edit = dragMode === 'global' ? editGlobal : editSpecific;
    const onToggle = (token: TemplateToken) => edit((t) => toggleSection(t, token));
    const onMove = (token: TemplateToken, dir: 1 | -1) => edit((t) => moveSection(t, token, dir));
    const onTextChange = (token: TemplateToken, text: string) =>
      edit((t) => setSectionText(t, token, text));
    const tokenSet = new Set<TemplateToken>(tokens);
    const orderedSections = [
      ...tokens.map((t) => ALL_SECTIONS.find((s) => s.token === t)!).filter(Boolean),
      ...ALL_SECTIONS.filter((s) => !tokenSet.has(s.token)),
    ];

    return (
      <div className="space-y-4">
        {Object.entries(SECTION_GROUPS).map(([groupId, groupTokens]) => {
          const groupSections = orderedSections.filter((s) => s.groupId === groupId);
          if (groupSections.length === 0) return null;
          const enabledCount = groupSections.filter((s) => tokenSet.has(s.token)).length;

          return (
            <Collapsible
              key={groupId}
              open={expandedGroups.has(groupId)}
              onOpenChange={(open) => {
                setExpandedGroups((prev) => {
                  const next = new Set(prev);
                  if (open) next.add(groupId);
                  else next.delete(groupId);
                  return next;
                });
              }}
            >
              <div className="rounded-xl border bg-card/50">
                {/* The group's description sits behind a "?" that cannot live
                    inside the trigger (a button). So the row holds the labelled
                    trigger, the hint, then a pointer-only trigger filling the
                    rest, which keeps the whole row clickable as it was. */}
                <div className="flex items-center rounded-t-xl transition-colors hover:bg-muted/30">
                  <CollapsibleTrigger className="flex min-w-0 items-center gap-3 py-3 pl-4 text-left">
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                        expandedGroups.has(groupId) ? '' : '-rotate-90'
                      }`}
                    />
                    <span className="truncate text-sm font-semibold">{GROUP_LABELS[groupId]}</span>
                    <span className="sr-only">
                      {enabledCount}/{groupTokens.length} aktif
                    </span>
                  </CollapsibleTrigger>
                  <InfoHint title={GROUP_LABELS[groupId]} size="xs" className="ml-1.5">
                    <p>{GROUP_DESCRIPTIONS[groupId]}</p>
                  </InfoHint>
                  <CollapsibleTrigger
                    tabIndex={-1}
                    aria-hidden
                    className="flex flex-1 items-center justify-end self-stretch pl-3 pr-4"
                  >
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {enabledCount}/{groupTokens.length} aktif
                    </Badge>
                  </CollapsibleTrigger>
                </div>
                <CollapsibleContent>
                  <Separator />
                  <div className="space-y-2 p-3">
                    {groupSections.map((section) => {
                      const isEnabled = tokenSet.has(section.token);
                      const enabledIdx = isEnabled ? tokens.indexOf(section.token) : -1;
                      const defaultText = defaultSectionText(section.token);
                      return (
                        <SectionCard
                          key={section.token}
                          section={section}
                          enabled={isEnabled}
                          currentText={isEnabled ? texts[section.token] : undefined}
                          defaultText={defaultText}
                          onToggle={() => onToggle(section.token)}
                          onTextChange={
                            isEnabled
                              ? (text) => onTextChange(section.token, text)
                              : undefined
                          }
                          onMoveUp={
                            enabledIdx > 0
                              ? () => onMove(section.token, -1)
                              : undefined
                          }
                          onMoveDown={
                            enabledIdx >= 0 && enabledIdx < tokens.length - 1
                              ? () => onMove(section.token, 1)
                              : undefined
                          }
                          onDragStart={isEnabled ? handleDragStart(section.token) : undefined}
                          onDragOver={isEnabled ? handleDragOver(section.token) : undefined}
                          onDrop={isEnabled ? handleDrop(section.token, dragMode) : undefined}
                          onDragEnd={handleDragEnd}
                          isFirst={enabledIdx === 0}
                          isLast={enabledIdx === tokens.length - 1}
                          isDragging={dragToken === section.token}
                          isDragOver={dragOverToken === section.token}
                        />
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          );
        })}
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────

  return (
    <Card className="p-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            Template Restrukturisasi Dokumen
            <InfoHint title="Template Restrukturisasi Dokumen">
              <p>
                Tentukan bagian mana dari job profile yang dibaca mesin dan bagaimana urutannya.
                Tiap bagian dapat diisi teks bebas dengan token{' '}
                <code className="text-[11px]">{'{{namaToken}}'}</code>.
              </p>
              <p>
                Tarik gagang (<GripVertical className="inline h-3 w-3 align-middle" />) untuk
                mengatur ulang urutan.
              </p>
            </InfoHint>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border bg-muted/50 p-1">
            <Button
              variant={editorMode === 'visual' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
              onClick={() => setEditorMode('visual')}
            >
              <LayoutTemplate className="h-3.5 w-3.5" />
              Visual
            </Button>
            <Button
              variant={editorMode === 'raw' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 gap-1.5 text-[11px]"
              onClick={() => setEditorMode('raw')}
            >
              <Code2 className="h-3.5 w-3.5" />
              Teks
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as 'global' | 'specific')} className="p-6">
        {/* What each tab is for sits behind one "?" beside the strip — not in
            a trigger, which is a button. */}
        <div className="mb-5 flex items-center gap-1.5">
          <TabsList>
            <TabsTrigger value="global" className="gap-1.5">
              <LayoutTemplate className="h-3.5 w-3.5" />
              Template Global
            </TabsTrigger>
            <TabsTrigger value="specific" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              Profil Spesifik
            </TabsTrigger>
          </TabsList>
          <InfoHint title="Template Global & Profil Spesifik">
            <p>
              <strong>Template Global.</strong> Template ini berlaku untuk <strong>semua</strong>{' '}
              job profile. Ubah di sini untuk menentukan informasi apa yang akan dibaca mesin saat
              membangun pengetahuan AI dan peta job family.
            </p>
            <p>
              <strong>Profil Spesifik.</strong> Pilih satu job profile untuk memberi{' '}
              <strong>template khusus</strong> yang menimpa template global. Berguna bila satu
              posisi perlu dibaca berbeda dari yang lain.
            </p>
          </InfoHint>
        </div>

        {/* ── Global template ── */}
        <TabsContent value="global" className="space-y-5">
          <div className="grid gap-6 lg:grid-cols-2 items-start">
            <div className="space-y-4">
              {editorMode === 'visual' ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Bagian yang disertakan ({globalParsed.order.length})
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={resetGlobalTemplate}>
                            <RotateCcw className="h-3 w-3" />
                            Default
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Kembalikan ke template default</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => editGlobal(enableAllSections)}
                          >
                            <Wand2 className="h-3 w-3" />
                            Aktifkan Semua
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Sertakan semua bagian yang tersedia</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  {renderVisualEditor('global')}
                </>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Template Mentah
                    </p>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-[11px]" onClick={resetGlobalTemplate}>
                      <RotateCcw className="h-3 w-3" />
                      Default
                    </Button>
                  </div>
                  <TokenHelpBadges />
                  <Textarea
                    value={config.restructureTemplate}
                    onChange={(e) => setConfig((c) => ({ ...c, restructureTemplate: e.target.value }))}
                    rows={18}
                    className="font-mono text-xs leading-relaxed"
                    placeholder="Tulis template dengan token {{namaToken}}…"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                {templateDirty && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">Belum disimpan</span>
                )}
                <Button
                  size="sm"
                  onClick={saveGlobalTemplate}
                  disabled={busy !== null || !templateDirty || !canManage}
                  className="gap-1.5"
                >
                  {busy === 'template' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  Simpan Template
                </Button>
              </div>
            </div>

            <PreviewPane
              title="Pratinjau (job profile pertama)"
              text={globalPreview}
              empty="Tidak ada job profile terekstrak untuk pratinjau."
            />
          </div>
        </TabsContent>

        {/* ── Specific profile ── */}
        <TabsContent value="specific" className="space-y-5">
          <div className="max-w-md">
            <Combobox
              options={options}
              value={selectedId}
              onValueChange={onSelectProfile}
              disabled={busy !== null || options.length === 0}
              placeholder={options.length === 0 ? 'Tidak ada job profile terekstrak' : 'Pilih job profile…'}
              searchPlaceholder="Cari nama jabatan / divisi…"
              emptyText="Job profile tidak ditemukan."
            />
          </div>

          {!selectedId ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
              <FileText className="mb-3 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Belum ada profil terpilih</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Pilih dari daftar di atas untuk pratinjau dan template khusus.
              </p>
            </div>
          ) : sampleLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-xl border py-12">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Memuat data profil…</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                {hasOverride ? (
                  <Badge className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/15 px-2.5 py-1">
                    <Sparkles className="h-3.5 w-3.5" />
                    Template khusus aktif
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
                    <Eye className="h-3.5 w-3.5" />
                    Mengikuti template global
                  </Badge>
                )}
                {overrideDirty && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">
                    {hasOverride
                      ? 'Belum disimpan'
                      : 'Belum disimpan: template khusus akan dihapus'}
                  </span>
                )}
                {sample && (
                  <span className="text-sm font-medium">
                    {sample.positionName ?? `Profil #${selectedId}`}
                  </span>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-2 items-start">
                <div className="space-y-4">
                  {editorMode === 'visual' ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Bagian yang disertakan ({specificParsed.order.length})
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 text-[11px]"
                          onClick={() => editSpecific(enableAllSections)}
                        >
                          <Wand2 className="h-3 w-3" />
                          Aktifkan Semua
                        </Button>
                      </div>
                      {renderVisualEditor('specific')}
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Template Mentah
                      </p>
                      <TokenHelpBadges />
                      <Textarea
                        value={specificSourceTemplate}
                        onChange={(e) => {
                          const text = e.target.value;
                          editSpecific(() => text);
                        }}
                        rows={18}
                        placeholder="Kosong = pakai template global. Tulis template khusus…"
                        className="font-mono text-xs leading-relaxed"
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Kosongkan untuk kembali memakai template global bagi profil ini.
                      </p>
                    </div>
                  )}
                </div>

                <PreviewPane
                  title={`Pratinjau — ${sample?.positionName ?? `Profil #${selectedId}`}`}
                  text={specificPreview}
                  empty="Data profil tidak tersedia untuk pratinjau."
                />
              </div>

              <Separator />

              <div className="flex flex-wrap justify-end gap-2">
                {(hasOverride || savedOverride) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={clearOverride}
                    disabled={busy !== null || !canManage}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Hapus template khusus
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveOverride}
                  disabled={busy !== null || !overrideDirty || !canManage}
                >
                  {busy === 'override' ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Simpan template khusus
                </Button>
                <Button
                  size="sm"
                  onClick={embedOne}
                  disabled={busy !== null || !pgvectorReady || embedBlockedByGlobal || !canManage}
                  className="gap-1.5"
                >
                  {busy === 'embed' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Restrukturisasi &amp; Embed
                </Button>
              </div>

              {!pgvectorReady && (
                <p className="text-right text-[10px] text-amber-600 dark:text-amber-400">
                  Embed profil butuh pgvector aktif.
                </p>
              )}
              {pgvectorReady && embedBlockedByGlobal && (
                <p className="text-right text-[10px] text-amber-600 dark:text-amber-400">
                  Profil ini mengikuti template global, dan template global punya perubahan yang
                  belum disimpan. Simpan dulu di tab Template Global agar yang di-embed sama dengan
                  pratinjau.
                </p>
              )}
              {pgvectorReady && !embedBlockedByGlobal && overrideDirty && (
                <p className="text-right text-[10px] text-muted-foreground">
                  Restrukturisasi &amp; Embed menyimpan template khusus profil ini lebih dulu.
                </p>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
