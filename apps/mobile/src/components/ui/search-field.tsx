import type { LucideIcon } from 'lucide-react-native';
import { Search, X } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { asColorScheme } from '@/lib/color-scheme';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { cn } from '@/lib/utils';

type SearchFieldProps = React.ComponentProps<typeof TextInput> & {
  /** A lucide component, drawn at 16 px in the muted colour of the scheme. */
  icon?: LucideIcon;
  /** Shows a clear button when given and the value is a non-empty string. */
  onClear?: () => void;
  /** The clear button's accessibility label. */
  clearLabel?: string;
  /** Extra classes for the outer well row. */
  containerClassName?: string;
};

/**
 * The mobile kit search field: a recessed well row with a leading icon and
 * an optional clear button. It passes every `TextInput` prop through and
 * fills the icon and placeholder colours from the scheme, so screens never
 * hard-code one.
 */
export function SearchField({
  icon: Icon = Search,
  onClear,
  clearLabel = 'Clear search',
  containerClassName,
  className,
  placeholderTextColor,
  value,
  ...props
}: SearchFieldProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View
      className={cn('h-10 flex-row items-center gap-2 rounded-xl px-3', containerClassName)}
      style={well}
    >
      <Icon size={16} color={MUTED_FOREGROUND[scheme]} />
      <TextInput
        value={value}
        placeholderTextColor={placeholderTextColor ?? MUTED_FOREGROUND[scheme]}
        className={cn('flex-1 text-[15px] text-foreground', className)}
        {...props}
      />
      {onClear !== undefined && typeof value === 'string' && value !== '' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={clearLabel} onPress={onClear}>
          <X size={16} color={MUTED_FOREGROUND[scheme]} />
        </Pressable>
      ) : null}
    </View>
  );
}
