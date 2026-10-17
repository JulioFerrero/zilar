import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { HandleProfile } from '@/lib/contacts-api';

/**
 * One compact person row: a 40 px avatar, the name, `@handle`, and an optional
 * muted hint on the right ("Requested", "Blocked", …). Shared by the People
 * list and the exact `@handle` search result (T-1854).
 */
export function PersonRow({
  entry,
  hint,
  onOpen,
}: {
  entry: HandleProfile;
  hint?: string | undefined;
  /** Absent renders a static row: nothing to open (the viewer themself). */
  onOpen?: (() => void) | undefined;
}) {
  const content = (
    <>
      <EntityAvatar person={entry} size={40} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[14px] font-semibold text-foreground">
          {entry.name}
        </Text>
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          @{entry.handle}
        </Text>
      </View>
      {hint === undefined ? null : (
        <Text numberOfLines={1} className="shrink-0 text-[12px] text-muted-foreground">
          {hint}
        </Text>
      )}
    </>
  );

  if (onOpen === undefined) {
    return <View className="flex-row items-center gap-3 px-[10px] py-2">{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${entry.name}`}
      onPress={onOpen}
      className="flex-row items-center gap-3 rounded-[12px] px-[10px] py-2 active:bg-surface-raised"
    >
      {content}
    </Pressable>
  );
}
