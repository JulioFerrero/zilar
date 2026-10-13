import { X } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { ICON } from '@/lib/colors';
import type { Contact } from '@/lib/contacts-api';

/**
 * One selected member shown above the New group picker (T-1314): the avatar,
 * the name and an X that unsticks them, like Telegram's chips.
 */
export function ContactChip({ person, onRemove }: { person: Contact; onRemove: () => void }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-full border border-border-strong bg-surface py-1 pl-1 pr-1.5">
      <EntityAvatar person={person} size={22} />
      <Text numberOfLines={1} className="max-w-[120px] text-[13px] text-foreground">
        {person.name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${person.name}`}
        onPress={onRemove}
        hitSlop={6}
      >
        <X size={14} color={ICON} />
      </Pressable>
    </View>
  );
}
