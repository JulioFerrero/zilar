import { View } from 'react-native';

import { Text } from '@/components/ui/text';

import type { Machine } from '../../lib/machines-api';
import { OptionGlyph, OptionRow } from './option-row';

/**
 * The AI edit screen's home-machine picker (mirrors web `AiPanel`'s machine
 * select): the owner's approved machines plus "The platform (no machine)".
 * The current value always shows, even when the machine is gone, so the
 * picker never silently switches the AI to the platform.
 */
export function MachinePicker({
  machines,
  loaded,
  value,
  disabled,
  onChange,
}: {
  machines: readonly Machine[];
  /** False while the list is still loading: the picker shows the current value only. */
  loaded: boolean;
  /** The AI's current home machine id, or null for the platform. */
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
}) {
  const approved = machines.filter((machine) => machine.status === 'approved');
  const knownIds = new Set(approved.map((machine) => machine.id));
  const currentUnknown = value !== null && !knownIds.has(value);

  return (
    <View className="gap-2">
      {loaded ? (
        <OptionRow
          selected={value === null}
          disabled={disabled}
          accessibilityLabel="The platform (no machine)"
          onPress={() => onChange(null)}
        >
          <OptionGlyph label="Platform" selected={value === null} />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-medium text-foreground">
              The platform (no machine)
            </Text>
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              The AI runs on the shared platform
            </Text>
          </View>
        </OptionRow>
      ) : null}
      {approved.map((machine) => {
        const selected = machine.id === value;
        return (
          <OptionRow
            key={machine.id}
            selected={selected}
            disabled={disabled}
            accessibilityLabel={machine.name}
            onPress={() => onChange(machine.id)}
          >
            <OptionGlyph label={machine.name} selected={selected} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-medium text-foreground">{machine.name}</Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {machine.os} {machine.osVersion} · {machine.arch}
              </Text>
            </View>
          </OptionRow>
        );
      })}
      {currentUnknown ? (
        <OptionRow
          selected
          disabled
          accessibilityLabel={'Current machine (unavailable)'}
          onPress={() => {}}
        >
          <OptionGlyph label="?" selected />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-medium text-foreground">
              Current machine (unavailable)
            </Text>
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              It was revoked or removed elsewhere
            </Text>
          </View>
        </OptionRow>
      ) : null}
    </View>
  );
}
