import * as React from 'react';
import { TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type TextFieldProps = React.ComponentProps<typeof TextInput> & {
  /** An optional label rendered above the field. */
  label?: string;
};

/**
 * The mobile kit text field: a recessed well, with an optional label above it.
 * It passes every `TextInput` prop through and fills the placeholder colour
 * from the scheme, so screens never hard-code one.
 */
export function TextField({
  label,
  className,
  placeholderTextColor,
  multiline,
  style,
  ...props
}: TextFieldProps) {
  const input = (
    <TextInput
      multiline={multiline}
      placeholderTextColor={placeholderTextColor ?? MUTED_FOREGROUND}
      style={multiline ? [{ textAlignVertical: 'top' }, style] : style}
      className={cn(
        'rounded-[10px] border border-border-strong bg-well px-3 py-2 text-[15px] text-foreground',
        className,
      )}
      {...props}
    />
  );
  if (label === undefined) {
    return input;
  }
  return (
    <View className="gap-1">
      <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      {input}
    </View>
  );
}
