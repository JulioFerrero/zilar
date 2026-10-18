import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { FIELD_INPUT } from './text-input';

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const FILTER_THRESHOLD = 8;

const TRIGGER =
  'well-surface flex h-10 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

const PANEL =
  'max-h-[var(--available-height)] min-w-[180px] overflow-y-auto rounded-[12px] border border-border-strong bg-surface p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_40px_rgba(0,0,0,0.85)] outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-100 motion-reduce:transition-opacity';

const ITEM =
  'flex w-full items-center gap-2 px-3 py-2 text-left text-[15px] select-none outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-list-hover data-[selected]:font-medium';

export function Select({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  disabled,
  className,
}: SelectProps) {
  const filterable = options.length > FILTER_THRESHOLD;
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!filterable || needle === '') {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [filterable, options, query]);

  return (
    <BaseSelect.Root
      items={options}
      value={value}
      onValueChange={(next: string | null) => {
        if (next !== null) {
          onValueChange(next);
        }
      }}
      disabled={disabled ?? false}
      onOpenChange={(open) => {
        if (!open) {
          setQuery('');
        }
      }}
    >
      <BaseSelect.Trigger className={cn(TRIGGER, className)} aria-label={label}>
        <BaseSelect.Value placeholder={placeholder} className="min-w-0 flex-1 truncate" />
        <BaseSelect.Icon className="shrink-0 text-muted-foreground">
          <ChevronDown className="size-4" aria-hidden="true" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <BaseSelect.Popup className={PANEL} aria-label={label}>
            {filterable && (
              <div className="px-1 pt-1">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Filter…"
                  aria-label={`Filter ${label}`}
                  className={cn(FIELD_INPUT, 'h-9 py-1')}
                />
              </div>
            )}
            <BaseSelect.List>
              {filtered.map((option) => (
                <BaseSelect.Item key={option.value} value={option.value} className={ITEM}>
                  <BaseSelect.ItemText className="min-w-0 flex-1 truncate">
                    {option.label}
                  </BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="shrink-0 text-accent">
                    <Check className="size-4" aria-hidden="true" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-[14px] text-muted-foreground">No matches</p>
            )}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
