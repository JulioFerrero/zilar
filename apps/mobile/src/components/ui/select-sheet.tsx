import { Check, ChevronDown } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/bottom-sheet';
import { SearchField } from '@/components/ui/search-field';
import { Text } from '@/components/ui/text';
import { ACCENT, ICON } from '@/lib/colors';
import { cn } from '@/lib/utils';

export interface SelectSheetOption {
  readonly value: string;
  readonly label: string;
}

/** Above this many options the sheet grows a filter field. */
const FILTER_THRESHOLD = 8;

/**
 * The mobile kit single-choice field: a row that shows the current value and
 * opens the native `BottomSheet` with the option list, a checkmark on the
 * selected row, and a search field once the list is longer than
 * `FILTER_THRESHOLD` options.
 */
export function SelectSheet({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: readonly SelectSheetOption[];
  onChange: (value: string) => void;
  placeholder?: string;
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
        <View className="gap-2 pt-3 pb-2">
          {filterable ? (
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Filter…"
              accessibilityLabel={`Filter ${label}`}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}
          {shown.map((option) => {
            const active = option.value === value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: active }}
                onPress={() => pick(option.value)}
                className="flex-row items-center gap-3 py-2 active:opacity-70"
              >
                <Text
                  className={cn(
                    'min-w-0 flex-1 text-[16px]',
                    active ? 'font-medium text-accent' : 'text-foreground',
                  )}
                >
                  {option.label}
                </Text>
                {active ? <Check size={18} color={ACCENT} /> : null}
              </Pressable>
            );
          })}
          {shown.length === 0 ? (
            <Text className="py-2 text-[14px] text-muted-foreground">No matches</Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}
