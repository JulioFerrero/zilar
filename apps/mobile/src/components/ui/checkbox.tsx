import { Check } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { View } from 'react-native';

import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type CheckboxProps = {
  checked: boolean;
  disabled?: boolean;
};

/**
 * The visual checkbox box: the picker row owns the press handling and the
 * `checkbox` accessibility role, so this renders the box only — a Check
 * icon on accent when checked, an empty bordered box otherwise.
 */
export function Checkbox({ checked, disabled = false }: CheckboxProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View
      className={cn(
        'h-5 w-5 items-center justify-center rounded-md border',
        checked ? 'border-accent bg-accent' : 'border-border-strong',
        disabled && 'opacity-50',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} color={ACCENT_FOREGROUND[scheme]} /> : null}
    </View>
  );
}
