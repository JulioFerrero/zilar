import { View } from 'react-native';

import { Text } from '@/components/ui/text';

import type { Connection } from '../../lib/ais-api';
import { OptionGlyph, OptionRow } from './option-row';
import { providerLabel } from './providers';

/** The wizard's provider picker over the caller's active connections. */
export function ProviderPicker({
  connections,
  value,
  onChange,
}: {
  connections: readonly Connection[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <View className="gap-2">
      {connections.map((connection) => {
        const selected = connection.id === value;
        const label = providerLabel(connection.provider);
        return (
          <OptionRow
            key={connection.id}
            selected={selected}
            accessibilityLabel={label}
            onPress={() => onChange(connection.id)}
          >
            <OptionGlyph label={label} selected={selected} />
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] font-medium text-foreground">{label}</Text>
              <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
                {connection.label ?? 'No label'}
              </Text>
            </View>
          </OptionRow>
        );
      })}
    </View>
  );
}
