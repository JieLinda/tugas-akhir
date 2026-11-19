'use client';

import { Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, FolderPlus, Plus, Trash2 } from 'lucide-react';
import { ALL_FIELDS, ALL_OPERATORS, FIELD_LABELS, OPERATOR_LABELS } from './governance-types';
import type { FilterRule, FilterCondition, FilterConditionGroup } from './governance-types';
import {
  FIELD_INPUT_KIND,
  FIELD_VALUE_OPTIONS,
  mergeFieldOptions,
  type FieldInputKind,
} from '@/lib/candidate-field-values';
import type { CandidateAttributeField, FilterOperator } from '@/lib/db/schema';

/**
 * A caption the host page attaches to individual rules — e.g. the Talent Pool
 * page saying which rule also decides who appears on Talent Mapping. Rendered
 * under the rule in both the editor and the read-only view, so the explanation
 * is in front of the reader whichever one they are looking at.
 */
export type FilterRuleNote = (rule: FilterRule) => ReactNode;

const MULTI_OPERATORS: FilterOperator[] = ['in', 'notIn'];
const NO_VALUE_OPERATORS: FilterOperator[] = ['notExpired', 'isExpired'];

function defaultRule(): FilterRule {
  return { field: 'disciplineStatus', operator: 'eq', value: 'CLEAR', label: '', message: '' };
}

/** Coerce a rule value into a string array (for multi-select operators). */
function toValueArray(value: FilterRule['value']): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value == null || value === '') return [];
  return [String(value)];
}

/** Default value for a field when the field or operator changes. */
function defaultValueFor(field: CandidateAttributeField, isMulti: boolean): FilterRule['value'] {
  if (isMulti) return [];
  if (FIELD_INPUT_KIND[field] === 'numeric') return 0;
  const opts = FIELD_VALUE_OPTIONS[field];
  return opts && opts.length > 0 ? opts[0].value : '';
}

/** Return a copy of the rule with a new field (and a fresh, valid value). */
function withField(rule: FilterRule, field: CandidateAttributeField): FilterRule {
  const isMulti = MULTI_OPERATORS.includes(rule.operator);
  return { ...rule, field, value: defaultValueFor(field, isMulti) };
}

/** Return a copy of the rule with a new operator (converting the value shape). */
function withOperator(rule: FilterRule, operator: FilterOperator): FilterRule {
  const wasMulti = MULTI_OPERATORS.includes(rule.operator);
  const nowMulti = MULTI_OPERATORS.includes(operator);
  let value = rule.value;
  if (NO_VALUE_OPERATORS.includes(operator)) {
    value = undefined;
  } else if (nowMulti && !wasMulti) {
    value = toValueArray(rule.value);
  } else if (!nowMulti && wasMulti) {
    value = toValueArray(rule.value)[0] ?? defaultValueFor(rule.field, false);
  }
  return { ...rule, operator, value };
}

/** Smart value control that mirrors the real domain of the selected field. */
function FilterValueControl({
  operator,
  value,
  options,
  kind,
  onChange,
}: {
  operator: FilterOperator;
  value: FilterRule['value'];
  options: ComboboxOption[];
  kind: FieldInputKind;
  onChange: (value: FilterRule['value']) => void;
}) {
  if (NO_VALUE_OPERATORS.includes(operator)) {
    return (
      <p className="flex h-8 items-center text-xs text-muted-foreground">
        Operator ini tidak memerlukan nilai.
      </p>
    );
  }

  const isMulti = MULTI_OPERATORS.includes(operator);

  // Numeric field (yearsExperience) — free numeric entry.
  if (kind === 'numeric') {
    if (isMulti) {
      return (
        <Input
          className="h-8 bg-background text-xs"
          value={toValueArray(value).join(', ')}
          onChange={(e) => {
            const nums = e.target.value
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => Number.isFinite(n));
            onChange(nums);
          }}
          placeholder="Contoh: 3, 5, 8"
        />
      );
    }
    return (
      <Input
        className="h-8 bg-background text-xs"
        type="number"
        value={value == null || Array.isArray(value) ? '' : String(value)}
        onChange={(e) => {
          const num = Number(e.target.value);
          onChange(e.target.value.trim() === '' ? '' : Number.isFinite(num) ? num : e.target.value);
        }}
        placeholder="Contoh: 5"
      />
    );
  }

  // Enum field — strictly from the merged option set.
  if (kind === 'enum') {
    if (isMulti) {
      const selected = toValueArray(value);
      return (
        <div className="flex flex-wrap gap-1.5">
          {options.map((opt) => {
            const active = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onChange(
                    active ? selected.filter((v) => v !== opt.value) : [...selected, opt.value],
                  )
                }
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted/60',
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <Combobox
        value={value == null ? '' : String(value)}
        onValueChange={onChange}
        options={options}
        placeholder="Pilih nilai"
        searchPlaceholder="Cari nilai..."
        emptyText="Nilai tidak ditemukan."
        triggerClassName="h-8 px-2 text-xs"
      />
    );
  }

  // Free-text field (education) — input + suggestions.
  const selected = toValueArray(value);
  const suggestions = options.filter((opt) => !selected.includes(opt.value)).slice(0, 12);
  return (
    <div className="space-y-1.5">
      <Input
        className="h-8 bg-background text-xs"
        value={isMulti ? selected.join(', ') : value == null || Array.isArray(value) ? '' : String(value)}
        onChange={(e) => {
          if (isMulti) {
            const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange(parts);
          } else {
            onChange(e.target.value);
          }
        }}
        placeholder={isMulti ? 'Pisahkan dengan koma' : 'Ketik atau pilih nilai'}
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() =>
                isMulti ? onChange([...selected, opt.value]) : onChange(opt.value)
              }
              className="rounded-md border border-dashed border-input bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A single filter rule row (field / operator / value + label / message). */
function RuleRow({
  rule,
  fieldValues,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  showSeverity = true,
  allowDisable = false,
  ruleNote,
}: {
  rule: FilterRule;
  fieldValues: Partial<Record<string, string[]>>;
  onChange: (rule: FilterRule) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /**
   * Offer the Menggugurkan / Hanya menandai choice. False on a surface whose
   * program cannot act on it — Talent Pool never starts a scoring run, so an
   * advisory rule there would differ from a hard one in no observable way, and
   * a control with no consequence is worse than no control. A rule written
   * with this hidden carries no `severity`, which the engine reads as hard.
   */
  showSeverity?: boolean;
  /**
   * Offer the Aktif / Nonaktif switch. Off keeps the rule — field, values,
   * label — in the tree and takes it out of every verdict, so a criterion can
   * be suspended and restored without retyping it. Only the Talent Pool page
   * turns this on; the engine honours `enabled: false` wherever it is stored.
   */
  allowDisable?: boolean;
  ruleNote?: FilterRuleNote;
}) {
  const kind = FIELD_INPUT_KIND[rule.field] ?? 'text';
  const options = mergeFieldOptions(rule.field, fieldValues[rule.field]);
  const enabled = rule.enabled !== false;
  const note = ruleNote?.(rule);

  return (
    <div
      className={cn(
        'grid gap-2 rounded-lg border bg-background/60 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]',
        !enabled && 'border-dashed bg-muted/30',
      )}
    >
      {allowDisable && (
        <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
          <Switch
            checked={enabled}
            onCheckedChange={(on) => {
              // `enabled` is written only as `false`; switching back on removes
              // the key, so a re-enabled rule is byte-identical to one that was
              // never switched off.
              const { enabled: _drop, ...rest } = rule;
              onChange(on ? rest : { ...rest, enabled: false });
            }}
            aria-label={enabled ? 'Nonaktifkan aturan filter ini' : 'Aktifkan aturan filter ini'}
          />
          <span className={cn('text-xs font-medium', enabled ? 'text-foreground' : 'text-muted-foreground')}>
            {enabled ? 'Aktif' : 'Nonaktif'}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {enabled
              ? 'Dinilai pada setiap kandidat.'
              : 'Tetap tersimpan dengan nilainya, tetapi tidak dinilai sama sekali — tidak menggugurkan dan tidak menandai siapa pun.'}
          </span>
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">Field</Label>
        <Combobox
          value={rule.field}
          onValueChange={(value) => onChange(withField(rule, value as CandidateAttributeField))}
          options={ALL_FIELDS.map((field) => ({ value: field, label: FIELD_LABELS[field] ?? field }))}
          placeholder="Pilih field"
          searchPlaceholder="Cari field..."
          emptyText="Field tidak ditemukan."
          triggerClassName="h-8 px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Operator</Label>
        <Combobox
          value={rule.operator}
          onValueChange={(value) => onChange(withOperator(rule, value as FilterOperator))}
          options={ALL_OPERATORS.map((operator) => ({ value: operator, label: OPERATOR_LABELS[operator] }))}
          placeholder="Pilih operator"
          searchPlaceholder="Cari operator..."
          emptyText="Operator tidak ditemukan."
          triggerClassName="h-8 px-2 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Nilai</Label>
        <FilterValueControl
          operator={rule.operator}
          value={rule.value}
          options={options}
          kind={kind}
          onChange={(value) => onChange({ ...rule, value })}
        />
      </div>
      <div className="flex items-end gap-1">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onMoveUp} disabled={!canMoveUp}>
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onMoveDown} disabled={!canMoveDown}>
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label className="text-xs">Label</Label>
        <Input
          className="h-8 text-xs bg-background"
          value={rule.label}
          onChange={(e) => onChange({ ...rule, label: e.target.value })}
          placeholder="Nama aturan filter (ditampilkan ke pengguna)"
        />
      </div>
      <div className="sm:col-span-2 space-y-1">
        <Label className="text-xs">Pesan gagal</Label>
        <Input
          className="h-8 text-xs bg-background"
          value={rule.message}
          onChange={(e) => onChange({ ...rule, message: e.target.value })}
          placeholder="Pesan yang tampil jika kandidat gagal aturan filter ini"
        />
      </div>
      {showSeverity && (
      <div className="sm:col-span-4 space-y-1">
        <Label className="text-xs">Akibat bila gagal</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border">
            {(
              [
                { value: 'hard' as const, label: 'Menggugurkan' },
                { value: 'advisory' as const, label: 'Hanya menandai' },
              ]
            ).map((opt) => {
              // A rule written before `severity` existed has none, and that
              // absence MEANS 'hard' — the same default the engine applies.
              const active = (rule.severity ?? 'hard') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ ...rule, severity: opt.value })}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {(rule.severity ?? 'hard') === 'advisory'
              ? 'Kandidat tetap dinilai dan masuk peringkat; kegagalannya dilaporkan di samping hasil.'
              : 'Kandidat yang gagal tidak ikut dinilai sama sekali.'}
          </p>
        </div>
      </div>
      )}
      {note && <div className="sm:col-span-4">{note}</div>}
    </div>
  );
}

/** AND/OR toggle for a group's combinator. */
function OperatorToggle({ op, onChange }: { op: 'and' | 'or'; onChange: (op: 'and' | 'or') => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {(['and', 'or'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            'px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors',
            op === value
              ? value === 'and'
                ? 'bg-primary/15 text-primary'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'text-muted-foreground hover:bg-muted/60',
          )}
        >
          {value === 'and' ? 'DAN' : 'ATAU'}
        </button>
      ))}
    </div>
  );
}

/** Recursively editable condition group. */
function GroupEditor({
  node,
  fieldValues,
  onChange,
  onRemove,
  depth,
  showSeverity = true,
  allowDisable = false,
  ruleNote,
}: {
  node: FilterConditionGroup;
  fieldValues: Partial<Record<string, string[]>>;
  onChange: (node: FilterConditionGroup) => void;
  onRemove?: () => void;
  depth: number;
  showSeverity?: boolean;
  allowDisable?: boolean;
  ruleNote?: FilterRuleNote;
}) {
  const setChild = (i: number, child: FilterCondition) =>
    onChange({ ...node, children: node.children.map((c, idx) => (idx === i ? child : c)) });
  const removeChild = (i: number) =>
    onChange({ ...node, children: node.children.filter((_, idx) => idx !== i) });
  const moveChild = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= node.children.length) return;
    const next = [...node.children];
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...node, children: next });
  };
  const addRule = () =>
    onChange({ ...node, children: [...node.children, { kind: 'rule', rule: defaultRule() }] });
  const addGroup = () =>
    onChange({
      ...node,
      children: [...node.children, { kind: 'group', op: node.op === 'and' ? 'or' : 'and', children: [{ kind: 'rule', rule: defaultRule() }] }],
    });

  const connector = node.op === 'and' ? 'DAN' : 'ATAU';

  return (
    <div
      className={cn(
        'space-y-2 rounded-xl border p-3',
        depth === 0 ? 'bg-muted/20' : 'border-l-2 border-l-primary/40 bg-background/40',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <OperatorToggle op={node.op} onChange={(op) => onChange({ ...node, op })} />
          <span className="text-[11px] text-muted-foreground">
            {node.op === 'and'
              ? 'Semua kondisi di grup ini harus terpenuhi'
              : 'Cukup salah satu kondisi di grup ini terpenuhi'}
          </span>
        </div>
        {onRemove && (
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={onRemove} title="Hapus grup">
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {node.children.length === 0 && (
        <p className="text-xs text-muted-foreground">Grup kosong — tambahkan aturan filter atau sub-grup.</p>
      )}

      {node.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider',
                  node.op === 'and' ? 'text-primary/80' : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {connector}
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>
          )}
          {child.kind === 'rule' ? (
            <RuleRow
              rule={child.rule}
              fieldValues={fieldValues}
              onChange={(rule) => setChild(i, { kind: 'rule', rule })}
              onRemove={() => removeChild(i)}
              onMoveUp={() => moveChild(i, -1)}
              onMoveDown={() => moveChild(i, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < node.children.length - 1}
              showSeverity={showSeverity}
              allowDisable={allowDisable}
              ruleNote={ruleNote}
            />
          ) : (
            <GroupEditor
              node={child}
              fieldValues={fieldValues}
              onChange={(g) => setChild(i, g)}
              onRemove={() => removeChild(i)}
              depth={depth + 1}
              showSeverity={showSeverity}
              allowDisable={allowDisable}
              ruleNote={ruleNote}
            />
          )}
        </Fragment>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={addRule} className="h-8">
          <Plus className="mr-1 h-3.5 w-3.5" /> Tambah aturan filter
        </Button>
        <Button size="sm" variant="outline" onClick={addGroup} className="h-8">
          <FolderPlus className="mr-1 h-3.5 w-3.5" /> Tambah sub-grup
        </Button>
      </div>
    </div>
  );
}

export function FilterRuleEditor({
  tree,
  onChange,
  fieldValues = {},
  showSeverity = true,
  allowDisable = false,
  ruleNote,
}: {
  tree: FilterConditionGroup;
  onChange: (tree: FilterConditionGroup) => void;
  /** Distinct values present in candidate data, per field. */
  fieldValues?: Partial<Record<string, string[]>>;
  /** See RuleRow — false hides the Menggugurkan / Hanya menandai choice. */
  showSeverity?: boolean;
  /** See RuleRow — true offers the per-rule Aktif / Nonaktif switch. */
  allowDisable?: boolean;
  ruleNote?: FilterRuleNote;
}) {
  return (
    <div className="mt-3">
      <GroupEditor
        node={tree}
        fieldValues={fieldValues}
        onChange={onChange}
        depth={0}
        showSeverity={showSeverity}
        allowDisable={allowDisable}
        ruleNote={ruleNote}
      />
    </div>
  );
}

/** Read-only recursive view of a condition tree. */
export function FilterTreeView({
  node,
  displayValue,
  depth = 0,
  showSeverity = true,
  ruleNote,
}: {
  node: FilterCondition;
  displayValue: (field: CandidateAttributeField, value: FilterRule['value']) => string;
  depth?: number;
  /** False hides the "hanya menandai" badge — see RuleRow's showSeverity. */
  showSeverity?: boolean;
  ruleNote?: FilterRuleNote;
}) {
  if (node.kind === 'rule') {
    const rule = node.rule;
    // A switched-off rule is always marked, whatever the host page offers: a
    // read-only view that rendered it like a live rule would state a criterion
    // nobody is judged by.
    const enabled = rule.enabled !== false;
    const note = ruleNote?.(rule);
    return (
      <div className={cn('rounded-lg border p-2.5 text-sm', !enabled && 'border-dashed bg-muted/30')}>
        <div className={cn('flex flex-wrap items-center gap-2', !enabled && 'opacity-60')}>
          <span className="shrink-0 rounded-md border px-1.5 py-0.5 text-xs">
            {FIELD_LABELS[rule.field] ?? rule.field}
          </span>
          <span className="text-muted-foreground">{OPERATOR_LABELS[rule.operator] ?? rule.operator}</span>
          <span className={cn('font-medium', !enabled && 'line-through decoration-muted-foreground/60')}>
            {rule.operator === 'notExpired' || rule.operator === 'isExpired'
              ? ''
              : displayValue(rule.field as CandidateAttributeField, rule.value)}
          </span>
          {!enabled && (
            <span className="shrink-0 rounded-md border border-dashed px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              nonaktif
            </span>
          )}
          {showSeverity && rule.severity === 'advisory' && (
            <span className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
              hanya menandai
            </span>
          )}
          {rule.message && <span className="ml-auto text-xs italic text-muted-foreground">{rule.message}</span>}
        </div>
        {note && <div className="mt-1.5">{note}</div>}
      </div>
    );
  }

  const connector = node.op === 'and' ? 'DAN' : 'ATAU';
  return (
    <div className={cn('space-y-1.5', depth > 0 && 'rounded-lg border border-l-2 border-l-primary/40 border-dashed p-2.5')}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {node.op === 'and' ? 'Semua (DAN)' : 'Salah satu (ATAU)'}
      </span>
      {node.children.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && (
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'text-[10px] font-bold uppercase tracking-wider',
                  node.op === 'and' ? 'text-primary/80' : 'text-amber-600 dark:text-amber-400',
                )}
              >
                {connector}
              </span>
              <div className="h-px flex-1 bg-border/60" />
            </div>
          )}
          <FilterTreeView
            node={child}
            displayValue={displayValue}
            depth={depth + 1}
            showSeverity={showSeverity}
            ruleNote={ruleNote}
          />
        </Fragment>
      ))}
    </div>
  );
}
