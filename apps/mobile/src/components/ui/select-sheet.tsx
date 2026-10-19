import { palette } from '@zilar/ui-tokens';
import { Check, ChevronDown, Plus } from 'lucide-react-native';
import { Fragment, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

export interface SelectSheetOption {
  readonly value: string;
  readonly label: string;
  readonly group?: string;
  readonly tag?: string;
  readonly dot?: 'online';
}

export interface SelectSheetFooterOption {
  readonly label: string;
  readonly value?: string;
  readonly onPress: () => void;
}

/** Above this many options the sheet grows a filter field. */
const FILTER_THRESHOLD = 8;
/** Mirrors `BottomSheet`'s default `max-h-[85%]`. */
const SHEET_HEIGHT_FRACTION = 0.85;
/** The title row (`pt-[22px]` + a 36px key) plus the scroll content's vertical padding. */
const SHEET_CHROME_HEIGHT = 88;
const ROW_HEIGHT = 48;
const GROUP_LABEL_HEIGHT = 36;
const FILTER_FIELD_HEIGHT = 46;
const HAIRLINE = '#1a1a1a';

export function SelectSheet({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Filter…',
  footerOption,
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: readonly SelectSheetOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  footerOption?: SelectSheetFooterOption;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { height } = useWindowDimensions();
  const selected = options.find((option) => option.value === value) ?? null;
  const currentLabel =
    footerOption !== undefined && footerOption.value !== undefined && footerOption.value === value
      ? footerOption.label
      : (selected?.label ?? placeholder);
  const filterable = options.length > FILTER_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const shown =
    filterable && needle !== ''
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;
  const groups = new Map<string | undefined, SelectSheetOption[]>();
  for (const option of shown) {
    const rows = groups.get(option.group);
    if (rows === undefined) {
      groups.set(option.group, [option]);
    } else {
      rows.push(option);
    }
  }
  const groupLabels = new Set(
    options.flatMap((option) => (option.group === undefined ? [] : [option.group])),
  ).size;
  const contentHeight =
    options.length * ROW_HEIGHT +
    groupLabels * GROUP_LABEL_HEIGHT +
    (filterable ? FILTER_FIELD_HEIGHT : 0) +
    (footerOption === undefined ? 0 : ROW_HEIGHT);
  const scrollable = contentHeight > height * SHEET_HEIGHT_FRACTION - SHEET_CHROME_HEIGHT;

  const close = (): void => {
    setOpen(false);
    setQuery('');
  };

  const pick = (next: string): void => {
    onChange(next);
    close();
  };

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${currentLabel}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          'flex-row items-center justify-between gap-2 rounded-[10px] border border-border-strong bg-well px-3 py-2.5 active:opacity-80',
          disabled && 'opacity-50',
        )}
      >
        <Text className="min-w-0 flex-1 text-[15px] text-foreground">{currentLabel}</Text>
        <ChevronDown size={16} color={ICON} />
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={close}
        closeLabel={`Close ${label}`}
        title={label}
        scrollable={scrollable}
      >
        {filterable ? (
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            accessibilityLabel={`Filter ${label}`}
            autoCapitalize="none"
            autoCorrect={false}
            containerClassName="mb-1.5"
          />
        ) : null}
        {[...groups].map(([group, rows]) => (
          <Fragment key={group ?? ''}>
            {group !== undefined ? (
              <Text className="px-4 pt-3.5 pb-1.5 text-[13px] font-medium text-subtle-foreground">
                {group}
              </Text>
            ) : null}
            {rows.map((option) => {
              const active = option.value === value;
              const last = option === shown[shown.length - 1];
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: active }}
                  onPress={() => pick(option.value)}
                  className={cn(
                    'h-12 flex-row items-center gap-3 border-b active:opacity-70',
                    last && footerOption !== undefined && 'border-b-0',
                  )}
                  style={{
                    borderBottomColor: HAIRLINE,
                    backgroundColor: active ? palette.surfaceRaised : undefined,
                  }}
                >
                  <Text className="min-w-0 flex-1 text-[15px] text-foreground">{option.label}</Text>
                  {option.tag !== undefined ? (
                    <Text className="font-mono text-[12px] text-subtle-foreground">
                      {option.tag}
                    </Text>
                  ) : null}
                  {option.dot === 'online' ? (
                    <View className="h-2 w-2 rounded-full bg-online" />
                  ) : null}
                  {active ? <Check size={18} strokeWidth={2.2} color={ACCENT} /> : null}
                </Pressable>
              );
            })}
          </Fragment>
        ))}
        {shown.length === 0 ? (
          <Text className="py-2 text-[14px] text-muted-foreground">No matches</Text>
        ) : null}
        {footerOption !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={footerOption.label}
            onPress={() => {
              footerOption.onPress();
              close();
            }}
            className="h-12 flex-row items-center gap-3 border-t active:opacity-70"
            style={{ borderTopColor: HAIRLINE }}
          >
            <Plus size={16} color={MUTED_FOREGROUND} />
            <Text className="min-w-0 flex-1 text-[15px] text-muted-foreground">
              {footerOption.label}
            </Text>
          </Pressable>
        ) : null}
      </BottomSheet>
    </View>
  );
}
