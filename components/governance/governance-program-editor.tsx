'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

import { Edit2, Check, Filter, RotateCcw, Layers, Loader2, Save, Trash2 } from 'lucide-react';
import { updateProgramTemplateAction, deleteProgramTemplateAction } from '@/lib/program-actions';
import { FIELD_VALUE_OPTIONS } from '@/lib/candidate-field-values';
import { countFilterRules, toFilterTreeSet } from '@/lib/filter-rules';
import type { CandidateAttributeField } from '@/lib/db/schema';
import type { TemplateSerialized, FilterRule, FilterConditionGroup, DefaultCriterion, AhpConfig } from './governance-types';
import { FilterRuleEditor, FilterTreeView } from './governance-filter-editor';
import { AhpMatrixEditor } from './governance-ahp-editor';

export function ProgramDetailEditor({
  template,
  fieldValues,
}: {
  template: TemplateSerialized;
  fieldValues: Partial<Record<string, string[]>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingFilters, setEditingFilters] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Local editable state
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [defaultMethod, setDefaultMethod] = useState(template.defaultMethod);
  const [targetFinalists, setTargetFinalists] = useState(String(template.targetFinalists ?? 10));
  const [filterTree, setFilterTree] = useState<FilterConditionGroup>(template.filterTree);
  const [defaultCriteria, setDefaultCriteria] = useState<DefaultCriterion[]>(template.defaultCriteria);
  const [enforceFilterRules, setEnforceFilterRules] = useState<boolean>(template.enforceFilterRules ?? true);
  const [ahpConfig, setAhpConfig] = useState<AhpConfig | null>(template.ahpConfig ?? null);

  // The parent renders this editor with `key={template.id}`, so switching
  // programs remounts it with fresh state; after a save, router.refresh()
  // delivers the saved template and `dirty` below goes back to false.
  const dirty = useMemo(
    () =>
      name !== template.name ||
      description !== (template.description ?? '') ||
      defaultMethod !== template.defaultMethod ||
      targetFinalists !== String(template.targetFinalists ?? 10) ||
      enforceFilterRules !== (template.enforceFilterRules ?? true) ||
      JSON.stringify(filterTree) !== JSON.stringify(template.filterTree) ||
      JSON.stringify(defaultCriteria) !== JSON.stringify(template.defaultCriteria) ||
      JSON.stringify(ahpConfig) !== JSON.stringify(template.ahpConfig ?? null),
    [
      name,
      description,
      defaultMethod,
      targetFinalists,
      enforceFilterRules,
      filterTree,
      defaultCriteria,
      ahpConfig,
      template,
    ],
  );

  function resetToTemplate() {
    setName(template.name);
    setDescription(template.description ?? '');
    setDefaultMethod(template.defaultMethod);
    setTargetFinalists(String(template.targetFinalists ?? 10));
    setFilterTree(template.filterTree);
    setDefaultCriteria(template.defaultCriteria);
    setEnforceFilterRules(template.enforceFilterRules ?? true);
    setAhpConfig(template.ahpConfig ?? null);
    setEditingFilters(false);
  }

  function handleSave() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', template.id);
        fd.set('name', name);
        fd.set('description', description);
        fd.set('defaultMethod', defaultMethod);
        fd.set('targetFinalists', targetFinalists);
        fd.set('filterRules', JSON.stringify(toFilterTreeSet(filterTree)));
        fd.set('defaultCriteria', JSON.stringify(defaultCriteria));
        fd.set('enforceFilterRules', enforceFilterRules ? 'true' : 'false');
        fd.set('ahpConfig', ahpConfig ? JSON.stringify(ahpConfig) : '');
        await updateProgramTemplateAction(fd);
        toast.success('Program berhasil disimpan.');
        router.refresh();
        setEditingFilters(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.');
      }
    });
  }

  function handleDelete() {
    setConfirmDelete(false);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', template.id);
        await deleteProgramTemplateAction(fd);
        toast.success('Program dihapus.');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Gagal menghapus.');
      }
    });
  }

  // Map a stored filter value to its friendly label (falls back to the raw value).
  function displayRuleValue(field: CandidateAttributeField, value: FilterRule['value']): string {
    const opts = FIELD_VALUE_OPTIONS[field] ?? [];
    const label = (v: string | number) => opts.find((o) => o.value === String(v))?.label ?? String(v);
    if (Array.isArray(value)) return (value as (string | number)[]).map(label).join(', ');
    if (value == null) return '';
    return label(value);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            {template.name}
            {dirty && (
              <Badge className="border-amber-500/30 bg-amber-500/15 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                Belum disimpan
              </Badge>
            )}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Kode: <code className="font-mono">{template.code}</code>
            {template.isSystem && ' • Program built-in — boleh diubah, tidak bisa dihapus'}
          </p>
        </div>
        {!template.isSystem && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Hapus program
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Basic info */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Nama program</Label>
            <Input className="bg-background" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Target Finalis (N)</Label>
            <Input
              className="bg-background"
              type="number"
              min={1}
              max={50}
              value={targetFinalists}
              onChange={(e) => setTargetFinalists(e.target.value)}
              placeholder="10"
            />
            <p className="text-[11px] text-muted-foreground">Jumlah target finalis (Top-N) yang dikembalikan mesin scoring.</p>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Deskripsi</Label>
            <Textarea className="bg-background" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>

        <Separator />

        {/* Filter Rules */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Aturan Filter</h3>
              <Badge variant="secondary" className="text-xs">
                {countFilterRules(filterTree)} aturan filter
              </Badge>
            </div>
            <Button size="sm" variant={editingFilters ? 'secondary' : 'outline'} onClick={() => setEditingFilters(!editingFilters)}>
              {editingFilters ? <Check className="mr-1 h-3.5 w-3.5" /> : <Edit2 className="mr-1 h-3.5 w-3.5" />}
              {editingFilters ? 'Selesai mengubah' : 'Ubah aturan filter'}
            </Button>
          </div>
          {editingFilters && <EditingHint />}

          {/* Hard-enforce toggle */}
          <div className={cn(
            'flex items-start justify-between gap-4 rounded-lg border p-3',
            enforceFilterRules
              ? 'border-rose-300/70 bg-rose-500/5 dark:border-rose-900/50'
              : 'border-slate-200 dark:border-slate-800',
          )}>
            <div className="space-y-0.5">
              <Label htmlFor="enforce-filter" className="text-sm font-semibold">
                Gugurkan otomatis kandidat yang gagal aturan filter
              </Label>
              <p className="text-[11px] text-muted-foreground leading-normal">
                {enforceFilterRules
                  ? 'Kandidat yang gagal salah satu aturan filter di atas otomatis GUGUR dan tidak diikutkan dalam scoring — muncul di daftar "Tidak Lolos".'
                  : 'Nonaktif: aturan filter tidak menggugurkan siapa pun — semua kandidat ikut dinilai.'}
              </p>
            </div>
            <Switch
              id="enforce-filter"
              checked={enforceFilterRules}
              onCheckedChange={setEnforceFilterRules}
              className="mt-0.5 shrink-0"
            />
          </div>

          {!editingFilters ? (
            <div className="mt-3 space-y-2">
              {filterTree.children.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tidak ada filter — semua kandidat lolos.</p>
              ) : (
                <FilterTreeView node={filterTree} displayValue={displayRuleValue} />
              )}
            </div>
          ) : (
            <FilterRuleEditor tree={filterTree} onChange={setFilterTree} fieldValues={fieldValues} />
          )}
        </section>

        <Separator />

        {/* AHP pairwise matrix */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Bobot AHP</h3>
            {ahpConfig && (
              <Badge variant="secondary" className="text-xs">Matriks aktif</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-normal">
            Satu-satunya tempat bobot diatur. Bandingkan kepentingan antar-kriteria berpasangan
            (skala Saaty); bobot prioritas dan rasio konsistensi (CR) dihitung otomatis. Bila belum
            diisi, program ini memakai bobot built-in sistem.
          </p>
          <AhpMatrixEditor key={template.id} value={ahpConfig} onChange={setAhpConfig} templateId={template.id} />
        </section>

        {/* One save for the whole program, pinned to the bottom of the
            scroll container so it is reachable from every section
            above. The per-section "Ubah" buttons only open editors;
            nothing is written until this button is pressed. */}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 rounded-b-xl border-t bg-background/95 px-6 py-3 backdrop-blur">
          <p className={cn('text-xs', dirty ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
            {dirty
              ? 'Ada perubahan yang belum disimpan.'
              : 'Semua perubahan tersimpan.'}{' '}
            <span className="text-muted-foreground">Berlaku untuk run berikutnya; run yang sudah selesai tidak berubah.</span>
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={resetToTemplate} disabled={!dirty || pending}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Batalkan
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!dirty || pending}>
              {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Simpan program
            </Button>
          </div>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-base">Hapus program &ldquo;{template.name}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Program ini hilang dari pilihan saat memulai scoring. Run yang sudah selesai di bawah
                program ini tetap tersimpan beserta aturannya. Tindakan ini tidak dapat dibatalkan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2">
              <AlertDialogCancel className="h-9 text-xs">Batal</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                className="h-9 bg-destructive text-xs text-white hover:bg-destructive/90"
              >
                Hapus program
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function EditingHint() {
  return (
    <p className="rounded-md border border-amber-300/60 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:text-amber-200">
      Perubahan di bagian ini belum tersimpan — tekan <strong>Simpan program</strong> di bawah setelah selesai.
    </p>
  );
}
