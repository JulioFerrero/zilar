import { View } from 'react-native';
import { Cloud, Laptop, PowerOff, Sparkles, type LucideIcon } from 'lucide-react-native';

import { Text } from '@/components/ui/text';
import { ACCENT, ACCENT_FOREGROUND } from '@/lib/colors';
import { cn } from '@/lib/utils';

import { OptionRow } from './option-row';

export type ComputerMode = 'off' | 'cloud' | 'runner' | 'auto';

interface ComputerChoice {
  mode: ComputerMode;
  label: string;
  description: string;
  icon: LucideIcon;
  disabled: boolean;
}

/**
 * T-1425: the four computer choices, each with its one-line description. Off
 * is always offered; Zilar cloud needs the cloud desk client wired; My machine
 * and Auto need a home machine. A disabled choice shows why in place of its
 * description.
 */
function computerChoices(cloud: boolean, hasMachine: boolean): ComputerChoice[] {
  return [
    {
      mode: 'off',
      label: 'Off',
      description: 'No computer',
      icon: PowerOff,
      disabled: false,
    },
    {
      mode: 'cloud',
      label: 'Zilar',
      description: cloud ? 'Runs on a Zilar cloud computer' : 'Not available yet',
      icon: Cloud,
      disabled: !cloud,
    },
    {
      mode: 'runner',
      label: 'Machine',
      description: hasMachine ? 'Runs on your home machine' : 'Pick a machine first',
      icon: Laptop,
      disabled: !hasMachine,
    },
    {
      mode: 'auto',
      label: 'Auto',
      description: hasMachine
        ? "My machine when it's online, otherwise Zilar cloud"
        : 'Pick a machine first',
      icon: Sparkles,
      disabled: !hasMachine,
    },
  ];
}

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

/**
 * T-1425: where the AI's computer runs, next to the home-machine picker. A
 * single choice; the screen patches `computerMode` right away and reverts it
 * when the server refuses.
 */
export function ComputerPicker({
  label,
  value,
  cloud,
  hasMachine,
  disabled,
  error,
  onChange,
}: {
  /** Section heading; omitted when the caller renders its own. */
  label?: string;
  value: ComputerMode;
  /** Whether Zilar cloud desks are wired; false keeps that option disabled. */
  cloud: boolean;
  /** Whether the AI has a home machine; without one, My machine and Auto are off. */
  hasMachine: boolean;
  disabled?: boolean;
  /** A fixed error sentence shown under the options, or empty. */
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
            <ChoiceGlyph icon={choice.icon} selected={selected} />
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
