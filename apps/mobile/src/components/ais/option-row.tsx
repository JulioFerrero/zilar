import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

type OptionRowProps = {
  selected: boolean;
  disabled?: boolean;
  role?: 'radio' | 'button';
  accessibilityLabel?: string;
  onPress: () => void;
  children: ReactNode;
  className?: string;
};

export function OptionRow({
  selected,
  disabled = false,
  role = 'radio',
  accessibilityLabel,
  onPress,
  children,
  className,
}: OptionRowProps) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={role === 'radio' ? { selected, disabled } : { disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        'flex-row items-center gap-3 rounded-xl border px-3 py-2.5 active:opacity-80',
        selected ? 'border-accent bg-surface-raised' : 'border-divider bg-background',
        disabled && 'opacity-50',
        className,
      )}
    >
      {children}
    </Pressable>
  );
}

export function OptionGlyph({ label, selected }: { label: string; selected: boolean }) {
  return (
    <View
      className={cn(
        'h-9 w-9 shrink-0 items-center justify-center rounded-full',
        selected ? 'bg-accent' : 'bg-surface',
      )}
    >
      <Text
        className={cn(
          'text-[14px] font-semibold',
          selected ? 'text-accent-foreground' : 'text-accent',
        )}
      >
        {label.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}
