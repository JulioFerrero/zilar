import { useColorScheme } from 'nativewind';
import { Switch as NativeSwitch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ACCENT, MUTED_FOREGROUND } from '@/lib/colors';
import { BORDER_STRONG } from '@/lib/depth';

export interface SwitchProps {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** Hides the visible label; `label` still names the control for screen readers. */
  hideLabel?: boolean;
}

/**
 * The mobile kit switch: a labelled row with the React Native switch drawn with
 * a grey track and a light thumb, so the thumb stands out from the dark card in
 * both states. The label names the control for screen readers even when hidden.
 */
export function Switch({ label, value, onValueChange, disabled, hideLabel = false }: SwitchProps) {
  const scheme = asColorScheme(useColorScheme().colorScheme);
  return (
    <View className="flex-row items-center gap-2">
      {hideLabel ? null : (
        <Text className="min-w-0 flex-1 text-[15px] text-foreground">{label}</Text>
      )}
      <NativeSwitch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: BORDER_STRONG, true: MUTED_FOREGROUND[scheme] }}
        ios_backgroundColor={BORDER_STRONG}
        thumbColor={ACCENT[scheme]}
      />
    </View>
  );
}
