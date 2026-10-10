import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { Machine } from '@/lib/machines-api';

/** One machine row, reused by the pending, approved and revoked sections. */
export function MachineCard({
  machine,
  busy,
  error,
  actions,
}: {
  machine: Machine;
  busy: boolean;
  error: string;
  actions: React.ReactNode;
}) {
  return (
    <View className="gap-1 px-3 py-2.5">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
            {machine.name}
          </Text>
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {machine.os} {machine.osVersion} · {machine.arch}
          </Text>
        </View>
        <View className="flex-row shrink-0 gap-2" pointerEvents={busy ? 'none' : 'auto'}>
          {actions}
        </View>
      </View>
      {error !== '' ? (
        <Text accessibilityRole="alert" className="text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
