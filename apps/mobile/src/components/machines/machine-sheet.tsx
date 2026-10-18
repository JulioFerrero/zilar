import { View } from 'react-native';

import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { Text } from '@/components/ui/text';
import type { Machine } from '@/lib/machines-api';
import { cn } from '@/lib/utils';

/** Groups the raw fingerprint in fours for display (`a1b2 c3d4 e5f6 0718`). */
function groupFingerprint(value: string): string {
  return value.replace(/(.{4})(?=.)/g, '$1 ');
}

export function MachineSheet({
  machine,
  aiNames,
  visible,
  onClose,
  onRename,
  onRevoke,
}: {
  machine: Machine | null;
  aiNames: string[];
  visible: boolean;
  onClose: () => void;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const online = machine?.online === true;
  return (
    <ActionSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close machine actions"
      header={
        machine === null ? undefined : (
          <View className="gap-3 px-4 py-3.5">
            <View className="flex-row items-center gap-2.5">
              <View
                accessibilityRole="image"
                accessibilityLabel={online ? 'Online' : 'Offline'}
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  online ? 'bg-online' : 'bg-muted-foreground',
                )}
              />
              <Text
                numberOfLines={1}
                className="min-w-0 flex-1 text-[17px] font-semibold text-foreground"
              >
                {machine.name}
              </Text>
            </View>

            <Text className="text-[13px] text-muted-foreground">
              {machine.os} {machine.osVersion} · {machine.arch}
            </Text>

            <View className="h-11 items-center justify-center rounded-xl bg-well px-3">
              <Text
                numberOfLines={1}
                className="font-mono text-[15px] tracking-[0.08em] text-foreground"
              >
                {groupFingerprint(machine.fingerprint)}
              </Text>
            </View>

            {aiNames.length === 0 ? null : (
              <Text className="text-[13px] text-muted-foreground">{aiNames.join(', ')}</Text>
            )}
          </View>
        )
      }
    >
      <ActionSheetItem label="Rename" onPress={onRename} />
      <ActionSheetItem label="Revoke" destructive onPress={onRevoke} />
    </ActionSheet>
  );
}
