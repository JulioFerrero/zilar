import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly dot?: 'online';
  readonly icon?: LucideIcon;
  readonly group?: string;
  readonly tag?: string;
}

export interface ComboboxFooterItem {
  readonly label: string;
  readonly value?: string;
  readonly onSelect: () => void;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  label: string;
  placeholder?: string;
  triggerPlaceholder?: string;
  footerItem?: ComboboxFooterItem;
  disabled?: boolean;
  className?: string;
}

const TRIGGER =
  'well-surface flex h-10 w-full items-center justify-between gap-2 rounded-[10px] px-3 text-left text-sm text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

const POPUP =
  'flex max-h-80 w-[var(--anchor-width)] min-w-[180px] flex-col overflow-hidden rounded-[12px] border border-border-strong bg-surface p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_40px_rgba(0,0,0,0.85)] outline-none origin-[var(--transform-origin)] transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[starting-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:duration-100 motion-reduce:transition-opacity';

const SEARCH = 'well-surface mb-1 flex h-[34px] shrink-0 items-center gap-2 rounded-[8px] px-2.5';

const ITEM =
  'flex h-[34px] w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-sm text-foreground select-none outline-none data-[highlighted]:bg-surface-raised data-[selected]:bg-surface-raised';

const FOOTER_ITEM =
  'flex h-[34px] shrink-0 items-center gap-2.5 rounded-[8px] px-2.5 text-left text-sm text-muted-foreground outline-none hover:bg-surface-raised';

const GROUP_LABEL = 'px-2.5 pt-2 pb-1 text-[12px] font-medium text-subtle-foreground';

interface ComboboxGroupData {
  readonly value: string;
  readonly items: readonly ComboboxOption[];
}

function groupOptions(options: readonly ComboboxOption[]): ComboboxGroupData[] {
  const groups = new Map<string, ComboboxOption[]>();
  for (const option of options) {
    const key = option.group ?? '';
    const items = groups.get(key);
    if (items === undefined) {
      groups.set(key, [option]);
    } else {
      items.push(option);
    }
  }
  return [...groups].map(([value, items]) => ({ value, items }));
}

export function Combobox({
  options,
  value,
  onValueChange,
  label,
  placeholder,
  triggerPlaceholder,
  footerItem,
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const grouped = options.some((option) => option.group !== undefined);
  const collection = useMemo(
    () =>
      BaseCombobox.createItems<ComboboxOption, string>(grouped ? groupOptions(options) : options, {
        getValue: (option) => option.value,
        getLabel: (option) => option.label,
      }),
    [grouped, options],
  );

  const renderItem = (option: ComboboxOption) => {
    const Icon = option.icon;
    return (
      <BaseCombobox.Item key={option.value} value={option.value} className={ITEM}>
        {Icon === undefined ? null : <Icon className="size-4 shrink-0" aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.tag === undefined ? null : (
          <span className="shrink-0 font-mono text-[12px] text-subtle-foreground">
            {option.tag}
          </span>
        )}
        {option.dot === 'online' ? (
          <span
            role="img"
            aria-label="Key added"
            className="size-2 shrink-0 rounded-full bg-online ring-2 ring-surface"
          />
        ) : null}
        <BaseCombobox.ItemIndicator className="shrink-0 text-foreground">
          <Check className="size-4" aria-hidden="true" />
        </BaseCombobox.ItemIndicator>
      </BaseCombobox.Item>
    );
  };

  return (
    <BaseCombobox.Root
      items={collection}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') {
          onValueChange(next);
        }
      }}
      open={open}
      onOpenChange={(nextOpen) => setOpen(nextOpen)}
      disabled={disabled ?? false}
    >
      <BaseCombobox.Trigger className={cn(TRIGGER, className)} aria-label={label}>
        <span className="min-w-0 flex-1 truncate text-left">
          {footerItem !== undefined && footerItem.value === value ? (
            <span className="truncate">{footerItem.label}</span>
          ) : (
            <BaseCombobox.Value placeholder={triggerPlaceholder} />
          )}
        </span>
        <BaseCombobox.Icon className="shrink-0 text-subtle-foreground">
          <ChevronDown className="size-4" aria-hidden="true" />
        </BaseCombobox.Icon>
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner
          className="z-50"
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
        >
          <BaseCombobox.Popup className={POPUP}>
            <div className={SEARCH}>
              <Search className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
              <BaseCombobox.Input
                placeholder={placeholder}
                aria-label={`Search ${label}`}
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
              />
            </div>
            <BaseCombobox.Empty className="px-2.5 py-2 text-sm text-muted-foreground">
              No matches
            </BaseCombobox.Empty>
            <BaseCombobox.List className="min-h-0 flex-1 overflow-y-auto">
              {(item: ComboboxOption | ComboboxGroupData) => {
                if (!('items' in item)) return renderItem(item);
                return (
                  <BaseCombobox.Group key={item.value} items={item.items}>
                    {item.value === '' ? null : (
                      <BaseCombobox.GroupLabel className={GROUP_LABEL}>
                        {item.value}
                      </BaseCombobox.GroupLabel>
                    )}
                    <BaseCombobox.Collection>
                      {(option: ComboboxOption) => renderItem(option)}
                    </BaseCombobox.Collection>
                  </BaseCombobox.Group>
                );
              }}
            </BaseCombobox.List>
            {footerItem === undefined ? null : (
              <>
                <BaseCombobox.Separator className="my-1 h-px shrink-0 bg-border" />
                <button
                  type="button"
                  className={FOOTER_ITEM}
                  onClick={() => {
                    footerItem.onSelect();
                    setOpen(false);
                  }}
                >
                  <Plus className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{footerItem.label}</span>
                </button>
              </>
            )}
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}
