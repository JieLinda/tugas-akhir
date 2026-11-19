'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FilterTreeView } from '@/components/governance/governance-filter-editor';
import {
  applyImportedRules,
  importNodeStatus,
  type ImportMode,
  type ImportResult,
} from '@/lib/filter-rule-import';
import { countEnabledFilterRules } from '@/lib/filter-rules';
import { formatDateTime } from '@/lib/datetime';
import {
  listTalentPoolRuleSourcesAction,
  type TalentPoolRuleSource,
} from '@/lib/talent-pool-actions';
import type {
  CandidateAttributeField,
  FilterConditionGroup,
  FilterRule,
} from '@/lib/db/schema';
import { cn } from '@/lib/utils';

function sourceLabel(s: TalentPoolRuleSource): string {
  if (s.kind === 'system_default') return `${s.name} — bawaan sistem`;
  return s.isTalentPool ? `${s.name} — tersimpan saat ini` : s.name;
}

/**
 * "Terapkan dari template program": pick rules that are already saved on a
 * program template — this business unit's templates as they stand now, or a
 * system program's shipped defaults — and apply them to the Talent Pool DRAFT.
 *
 * Applying writes nothing. The result replaces the editor's draft, the panel's
 * preview then counts what it does to the list, and Simpan is still the only
 * write — so this cannot become a way to change the rules without seeing the
 * consequence first.
 */
export function TalentPoolRuleImportDialog({
  open,
  onOpenChange,
  draft,
  displayValue,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: FilterConditionGroup;
  displayValue: (field: CandidateAttributeField, value: FilterRule['value']) => string;
  onApply: (result: ImportResult, source: TalentPoolRuleSource) => void;
}) {
  const [sources, setSources] = useState<TalentPoolRuleSource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceKey, setSourceKey] = useState<string>('');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<ImportMode>('append');
  const [replaceSameField, setReplaceSameField] = useState(true);

  // Loaded on open, every time: a template edited in Tata Kelola since the
  // page rendered must show its rules as they are saved NOW.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSources(null);
    setLoadError(null);
    listTalentPoolRuleSourcesAction()
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        // Open on the first program that is not the Talent Pool's own saved
        // set — that one is what the editor already started from.
        const first = list.find((s) => s.kind === 'saved' && !s.isTalentPool) ?? list[0];
        setSourceKey((prev) => (prev && list.some((s) => s.key === prev) ? prev : first?.key ?? ''));
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Gagal memuat template program.');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const source = sources?.find((s) => s.key === sourceKey) ?? null;
  const children = source?.tree.children ?? [];
  const statuses = useMemo(
    () => children.map((node) => importNodeStatus(draft, node)),
    [children, draft],
  );

  // A fresh source starts with everything that would change something ticked;
  // rules the draft already has identically start unticked.
  useEffect(() => {
    setPicked(new Set(statuses.flatMap((s, i) => (s === 'same' ? [] : [i]))));
  }, [sourceKey, sources]);

  // Fields `replaceSameField` can actually clear: top-level rules only, and
  // only under an `and` root (an `or` root is kept whole as one branch).
  const replaceableFields = new Set(
    draft.op === 'and' || draft.children.length === 0
      ? draft.children.flatMap((c) => (c.kind === 'rule' ? [c.rule.field] : []))
      : [],
  );

  const pickedNodes = children.filter((_, i) => picked.has(i));
  const result = source
    ? applyImportedRules(draft, pickedNodes, { mode, replaceSameField, sourceOp: source.tree.op })
    : null;

  const savedSources = sources?.filter((s) => s.kind === 'saved') ?? [];
  const defaultSources = sources?.filter((s) => s.kind === 'system_default') ?? [];
  const allPicked = children.length > 0 && picked.size === children.length;

  function toggle(i: number, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(i);
      else next.delete(i);
      return next;
    });
  }

  const nothingChanges =
    !result ||
    (mode === 'append' ? result.added === 0 && result.replaced === 0 : pickedNodes.length === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            Terapkan aturan dari template program
          </DialogTitle>
          <DialogDescription>
            Pilih aturan filter yang sudah tersimpan pada template program, lalu terapkan ke draf
            aturan Talent Pool. Belum ada yang disimpan — dampaknya terlihat di pratinjau, dan
            perubahan baru berlaku setelah Anda menekan Simpan.
          </DialogDescription>
        </DialogHeader>

        {loadError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {loadError}
          </p>
        ) : !sources ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Memuat template program…
          </p>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Sumber aturan</Label>
              <Select value={sourceKey} onValueChange={setSourceKey}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pilih template program" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Tersimpan di Company aktif</SelectLabel>
                    {savedSources.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {sourceLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {defaultSources.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>Bawaan sistem</SelectLabel>
                      {defaultSources.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {sourceLabel(s)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
              {source && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {source.kind === 'system_default'
                    ? 'Aturan bawaan sistem — isi template ini sebelum pernah diubah di Tata Kelola.'
                    : `Tersimpan saat ini${source.updatedAt ? `, terakhir diubah ${formatDateTime(source.updatedAt)}` : ''}.`}
                  {source.isPositionProgram &&
                    ' Program ini menilai posisi; aturannya di sana tetap tidak berubah — yang diterapkan adalah salinannya.'}
                  {` ${countEnabledFilterRules(source.tree)} aturan aktif, digabung dengan `}
                  <strong>{source.tree.op === 'and' ? 'DAN' : 'ATAU'}</strong>.
                </p>
              )}
            </div>

            {source && children.length === 0 ? (
              <p className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Template ini tidak memiliki aturan filter.
              </p>
            ) : source ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Aturan yang diterapkan</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() =>
                      setPicked(allPicked ? new Set() : new Set(children.map((_, i) => i)))
                    }
                  >
                    {allPicked ? 'Kosongkan pilihan' : 'Pilih semua'}
                  </Button>
                </div>
                {children.map((node, i) => {
                  const status = statuses[i];
                  const id = `import-rule-${i}`;
                  return (
                    <div
                      key={`${sourceKey}-${i}`}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-2.5',
                        picked.has(i) ? 'border-primary/40 bg-primary/5' : 'bg-background',
                      )}
                    >
                      <Checkbox
                        id={id}
                        checked={picked.has(i)}
                        onCheckedChange={(v) => toggle(i, v === true)}
                        className="mt-2.5"
                      />
                      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer space-y-1.5">
                        <FilterTreeView node={node} displayValue={displayValue} />
                        {status === 'same' && (
                          <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                            Sudah ada di aturan Talent Pool
                          </Badge>
                        )}
                        {status === 'conflict' && (
                          <Badge className="border-amber-500/30 bg-amber-500/15 text-[10px] font-normal text-amber-700 dark:text-amber-300">
                            {mode === 'append' &&
                            replaceSameField &&
                            node.kind === 'rule' &&
                            replaceableFields.has(node.rule.field)
                              ? 'Menggantikan aturan Talent Pool pada bidang yang sama'
                              : 'Bidang ini sudah diatur di Talent Pool dengan ketentuan lain'}
                          </Badge>
                        )}
                      </label>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {source && children.length > 0 && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <Label className="text-xs">Cara menerapkan</Label>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as ImportMode)} className="gap-2">
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <RadioGroupItem value="append" className="mt-0.5" />
                    <span>
                      Tambahkan ke aturan saat ini
                      <span className="block text-[11px] text-muted-foreground">
                        Aturan terpilih ditambahkan dengan DAN; aturan Talent Pool lain tetap.
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <RadioGroupItem value="replace" className="mt-0.5" />
                    <span>
                      Ganti seluruh aturan saat ini
                      <span className="block text-[11px] text-muted-foreground">
                        Aturan Talent Pool menjadi persis aturan terpilih dari template ini.
                      </span>
                    </span>
                  </label>
                </RadioGroup>
                {mode === 'append' && (
                  <label className="flex cursor-pointer items-start gap-2 border-t pt-2 text-sm">
                    <Checkbox
                      checked={replaceSameField}
                      onCheckedChange={(v) => setReplaceSameField(v === true)}
                      className="mt-0.5"
                    />
                    <span>
                      Ganti aturan Talent Pool pada bidang yang sama
                      <span className="block text-[11px] text-muted-foreground">
                        Tanpa ini, dua aturan pada satu bidang (mis. PA) berlaku bersamaan dan yang
                        lebih ketat yang menentukan. Aturan di dalam grup tidak disentuh.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {!result
              ? ''
              : mode === 'replace'
                ? pickedNodes.length === 0
                  ? 'Pilih minimal satu aturan.'
                  : `${draft.children.length} aturan saat ini diganti ${pickedNodes.length} aturan terpilih.`
                : [
                    `${result.added} ditambahkan`,
                    result.replaced > 0 ? `${result.replaced} diganti` : null,
                    result.skippedDuplicates > 0 ? `${result.skippedDuplicates} sudah ada` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button
              disabled={nothingChanges}
              onClick={() => {
                if (!result || !source) return;
                onApply(result, source);
                onOpenChange(false);
              }}
            >
              Terapkan ke draf
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
