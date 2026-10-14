import { palette } from '@zilar/ui-tokens';
import { Check, ChevronDown, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

export interface SelectSheetOption {
  readonly value: string;
  readonly label: string;
  /** A trailing 8 px status dot, `online` being the green one. */
  readonly dot?: 'online';
}

/** A pinned row under the list, e.g. "OpenAI-compatible" with a plus icon. */
export interface SelectSheetFooterOption {
  readonly label: string;
  readonly onPress: () => void;
}

/** Above this many options the sheet grows a filter field. */
const FILTER_THRESHOLD = 8;

/** The list caps at about seven rows (`Mobile.dc.html`); longer lists scroll. */
const MAX_ROWS = 7;
const ROW_HEIGHT = 48;
const HAIRLINE = '#1a1a1a';

/**
 * The mobile kit single-choice field: a row that shows the current value and
 * opens the native `BottomSheet` with the option list, a checkmark on the
 * selected row, and a search field once the list is longer than
 * `FILTER_THRESHOLD` options. Rows are 48 px with a hairline divider; a row can
 * carry a green status dot, the selected row is `surfaceRaised` plus a check,
 * the list caps at about seven rows and scrolls, and `footerOption` pins an
 * extra action (a plus icon, then the label) under a hairline.
 */
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
  const selected = options.find((option) => option.value === value) ?? null;
  const filterable = options.length > FILTER_THRESHOLD;
  const needle = query.trim().toLowerCase();
  const shown =
    filterable && needle !== ''
      ? options.filter((option) => option.label.toLowerCase().includes(needle))
      : options;

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
        accessibilityLabel={`${label}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          'flex-row items-center justify-between gap-2 rounded-[10px] border border-border-strong bg-well px-3 py-2.5 active:opacity-80',
          disabled && 'opacity-50',
        )}
      >
        <Text className="min-w-0 flex-1 text-[15px] text-foreground">
          {selected?.label ?? placeholder}
        </Text>
        <ChevronDown size={16} color={ICON} />
      </Pressable>

      <BottomSheet visible={open} onClose={close} closeLabel={`Close ${label}`} title={label}>
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
        <ScrollView
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={{ maxHeight: MAX_ROWS * ROW_HEIGHT }}
        >
          {shown.map((option, index) => {
            const active = option.value === value;
            const last = index === shown.length - 1;
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
                {option.dot === 'online' ? (
                  <View className="h-2 w-2 rounded-full bg-online" />
                ) : null}
                {active ? <Check size={18} strokeWidth={2.2} color={ACCENT} /> : null}
              </Pressable>
            );
          })}
          {shown.length === 0 ? (
            <Text className="py-2 text-[14px] text-muted-foreground">No matches</Text>
          ) : null}
        </ScrollView>
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
