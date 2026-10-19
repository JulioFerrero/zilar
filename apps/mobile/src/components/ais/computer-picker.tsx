import { View } from 'react-native';
import { Cloud, Laptop, PowerOff, Sparkles, type LucideIcon } from 'lucide-react-native';

import { computerChoices, type ComputerMode } from '@zilar/chat-core';
import { Text } from '@/components/ui/text';
import { ACCENT, ACCENT_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

import { OptionRow } from './option-row';

const COMPUTER_ICONS: Record<ComputerMode, LucideIcon> = {
  off: PowerOff,
  cloud: Cloud,
  runner: Laptop,
  auto: Sparkles,
};

function ChoiceGlyph({ icon: Icon, selected }: { icon: LucideIcon; selected: boolean }) {
  return (
    <View
      className={cn(
        'h-9 w-9 shrink-0 items-center justify-center rounded-full',
        selected ? 'bg-accent' : 'bg-surface',
      )}
    >
      <Icon size={16} color={selected ? ACCENT_FOREGROUND : ACCENT} />
    </View>
  );
}

export function ComputerPicker({
  label,
  value,
  cloud,
  hasMachine,
  disabled,
  error,
  onChange,
}: {
  label?: string;
  value: ComputerMode;
  cloud: boolean;
  hasMachine: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (mode: ComputerMode) => void;
}) {
  return (
    <View className="gap-2">
      {label !== undefined ? (
        <Text className="text-[14px] font-medium text-foreground">{label}</Text>
      ) : null}
      {computerChoices(cloud, hasMachine).map((choice) => {
        const selected = choice.mode === value;
        return (
          <OptionRow
            key={choice.mode}
            selected={selected}
            disabled={choice.disabled || disabled === true}
            accessibilityLabel={choice.label}
            onPress={() => onChange(choice.mode)}
          >
            <ChoiceGlyph icon={COMPUTER_ICONS[choice.mode]} selected={selected} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-medium text-foreground">{choice.label}</Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {choice.description}
              </Text>
            </View>
          </OptionRow>
        );
      })}
      {error !== undefined && error !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
