'use client';

import { CaretUpDownIcon, CheckIcon } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional secondary line shown muted under the label in the dropdown. */
  description?: string;
  disabled?: boolean;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  triggerClassName?: string;
  triggerPrefix?: React.ReactNode;
  /**
   * Render the popover as a modal layer. Keep this `true` (the default) when the
   * Combobox lives inside a Dialog — a Dialog locks background scrolling via
   * `react-remove-scroll`, and the popover (portalled outside the dialog's
   * scroll-allowlist) would otherwise have its wheel/touch events swallowed, so
   * the dropdown list can't be scrolled. A modal popover owns its own scroll
   * layer, which restores scrolling. Pass `false` only if you specifically need
   * the page behind an open (non-dialog) combobox to stay scrollable.
   */
  modal?: boolean;
  /**
   * Accept a value that is not in `options`: what the user typed becomes
   * selectable as "Gunakan …", and a current value with no matching option
   * still renders on the trigger instead of falling back to the placeholder.
   *
   * For fields where the free-form case is legitimate but the listed values are
   * the ones that do something — a criterion name, for instance, where only the
   * canonical names carry a scoring weight.
   */
  allowCustomValue?: boolean;
  /** Label for the accept-what-I-typed row. Receives the raw input. */
  customValueLabel?: (input: string) => string;
}

/**
 * A `truncate`d span that exposes its full text as a tooltip ONLY when the text
 * is actually clipped by the available width.
 *
 * The popover is pinned to the trigger's width
 * (`w-(--radix-popover-trigger-width)`), so a long option in a narrow field is
 * clipped in the dropdown as well as on the trigger — the value the user is
 * choosing between became unreadable exactly where it mattered.
 *
 * Measured rather than unconditional: a bare `title` would attach a tooltip to
 * every option including the short ones, so hovering a fully-visible label pops
 * a box repeating what is already on screen. Measuring means the tooltip appears
 * only when it carries something the user cannot already read.
 *
 * A native `title` rather than the Radix Tooltip on purpose. This renders inside
 * a Popover that is frequently itself inside a Dialog, and a third nested portal
 * layer there fights the dialog's focus trap and `pointer-events` lock — cost
 * with no benefit, since the payload is one line of plain text.
 */
function TruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // +1 absorbs sub-pixel rounding, which otherwise reports a flush-fitting
    // label as clipped on fractional-DPI displays.
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    // The width can change without the text changing — the dialog resizes, the
    // window resizes, a font loads late — so keep measuring instead of trusting
    // the value at mount.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={cn('truncate', className)} title={clipped ? text : undefined}>
      {text}
    </span>
  );
}

export function Combobox({
  options,
  value,
  onValueChange,
  disabled = false,
  placeholder = 'Select…',
  searchPlaceholder = 'Cari…',
  emptyText = 'Tidak ditemukan.',
  className,
  triggerClassName,
  triggerPrefix,
  modal = true,
  allowCustomValue = false,
  customValueLabel = (input) => `Gunakan "${input}"`,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const selected = options.find((option) => option.value === value);
  const trimmedSearch = search.trim();
  // Offer the typed text only when it is genuinely new — otherwise the list
  // shows "Gunakan X" right next to the X the user could just click.
  const showCustom =
    allowCustomValue &&
    trimmedSearch.length > 0 &&
    !options.some((option) => option.value.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-medium bg-background', triggerClassName)}
        >
          <span className="flex min-w-0 flex-1 items-center">
            {triggerPrefix ? <span className="mr-2 shrink-0 text-muted-foreground">{triggerPrefix}</span> : null}
            <TruncatedText
              text={selected ? selected.label : allowCustomValue && value ? value : placeholder}
            />
          </span>
          <CaretUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" weight="bold" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-(--radix-popover-trigger-width) p-0', className)} align="start">
        <Command
          filter={(value, search) => {
            if (value.toLowerCase().includes(search.toLowerCase())) return 1;
            return 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {!showCustom && <CommandEmpty>{emptyText}</CommandEmpty>}
            <CommandGroup>
              {showCustom && (
                <CommandItem
                  value={trimmedSearch}
                  onSelect={() => {
                    onValueChange(trimmedSearch);
                    setSearch('');
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn(
                      'mr-2 mt-0.5 h-4 w-4 shrink-0 self-start',
                      value === trimmedSearch ? 'opacity-100' : 'opacity-0',
                    )}
                    weight="bold"
                  />
                  <TruncatedText text={customValueLabel(trimmedSearch)} className="font-medium" />
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.description ? `${option.label} ${option.description}` : option.label}
                  disabled={option.disabled}
                  onSelect={() => {
                    if (option.disabled) {
                      return;
                    }
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn('mr-2 h-4 w-4 shrink-0 self-start mt-0.5', value === option.value ? 'opacity-100' : 'opacity-0')}
                    weight="bold"
                  />
                  <span className="flex min-w-0 flex-col">
                    <TruncatedText text={option.label} className="font-medium" />
                    {option.description ? (
                      <TruncatedText
                        text={option.description}
                        className="text-xs text-muted-foreground"
                      />
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
