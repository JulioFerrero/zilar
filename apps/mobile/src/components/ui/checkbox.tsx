import { Check } from 'lucide-react-native';
import { View } from 'react-native';

import { ACCENT_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

type CheckboxProps = {
  checked: boolean;
  disabled?: boolean;
};

export function Checkbox({ checked, disabled = false }: CheckboxProps) {
  return (
    <View
      className={cn(
        'h-5 w-5 items-center justify-center rounded-md border',
        checked ? 'border-accent bg-accent' : 'border-border-strong',
        disabled && 'opacity-50',
      )}
    >
      {checked ? <Check size={14} strokeWidth={3} color={ACCENT_FOREGROUND} /> : null}
    </View>
  );
}
