import { Ban, ChevronDown, ChevronRight } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { PublicAi } from '@zilar/client-core';
import { MUTED_FOREGROUND } from '@/lib/colors';
import type { Machine } from '@/lib/machines-api';
import { cn } from '@/lib/utils';

/**
 * The owner's AIs grouped by their home machine, for the row picture and the
 * sheet's names. A `null` list (the AI read failed) groups nothing.
 */
export function groupAisByMachine(ais: PublicAi[] | null): Map<string, PublicAi[]> {
  const map = new Map<string, PublicAi[]>();
  if (ais === null) {
    return map;
  }
  for (const ai of ais) {
    if (ai.machineId === null || ai.machineId === undefined) {
      continue;
    }
    const list = map.get(ai.machineId) ?? [];
    list.push(ai);
    map.set(ai.machineId, list);
  }
  return map;
}

export function MachineRow({
  machine,
  ai,
  onPress,
}: {
  machine: Machine;
  ai: PublicAi | undefined;
  onPress: () => void;
}) {
  const online = machine.online === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={machine.name}
      onPress={onPress}
      className="flex min-h-[52px] flex-row items-center gap-3 px-4 active:bg-list-hover"
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={online ? 'Online' : 'Offline'}
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          online ? 'bg-online' : 'bg-muted-foreground',
        )}
      />
      <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] font-medium text-foreground">
        {machine.name}
      </Text>
      {ai === undefined ? null : (
        <EntityAvatar
          person={{ id: ai.jid, name: ai.name, avatarUrl: ai.avatarUrl }}
          size={24}
          ai
        />
      )}
      <ChevronRight size={16} color={MUTED_FOREGROUND} />
    </Pressable>
  );
}

export function RevokedToggleRow({
  count,
  expanded,
  onPress,
}: {
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={expanded ? 'Hide revoked machines' : 'Show revoked machines'}
      accessibilityState={{ expanded }}
      onPress={onPress}
      className="flex min-h-[52px] flex-row items-center gap-3 px-4 active:bg-list-hover"
    >
      <Ban size={16} color={MUTED_FOREGROUND} />
      <Text className="min-w-0 flex-1 text-[15px] text-muted-foreground">Revoked</Text>
      <Text className="font-mono text-[12px] text-muted-foreground">{count}</Text>
      {expanded ? (
        <ChevronDown size={16} color={MUTED_FOREGROUND} />
      ) : (
        <ChevronRight size={16} color={MUTED_FOREGROUND} />
      )}
    </Pressable>
  );
}
