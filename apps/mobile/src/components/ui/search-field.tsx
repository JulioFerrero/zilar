import type { LucideIcon } from 'lucide-react-native';
import { Search, X } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { cn } from '@/lib/utils';

type SearchFieldProps = React.ComponentProps<typeof TextInput> & {
  icon?: LucideIcon;
  onClear?: () => void;
  clearLabel?: string;
  containerClassName?: string;
};

export function SearchField({
  icon: Icon = Search,
  onClear,
  clearLabel = 'Clear search',
  containerClassName,
  className,
  placeholderTextColor,
  value,
  style,
  ...props
}: SearchFieldProps) {
  return (
    <View
      className={cn('min-h-10 flex-row items-center gap-2 rounded-xl px-3', containerClassName)}
      style={well}
    >
      <Icon size={16} color={MUTED_FOREGROUND} />
      <TextInput
        value={value}
        placeholderTextColor={placeholderTextColor ?? MUTED_FOREGROUND}
        className={cn('flex-1 py-0 text-[15px] text-foreground', className)}
        style={[{ textAlignVertical: 'center' }, style]}
        {...props}
      />
      {onClear !== undefined && typeof value === 'string' && value !== '' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          hitSlop={12}
          onPress={onClear}
        >
          <X size={16} color={MUTED_FOREGROUND} />
        </Pressable>
      ) : null}
    </View>
  );
}
