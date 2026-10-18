import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';

export function ContactRow({
  person,
  subtitle,
  online = false,
  accessibilityLabel,
  onPress,
  onLongPress,
  trailing,
}: {
  person: Contact;
  subtitle: string;
  online?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  trailing?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      className="flex-row items-center gap-3 px-3 py-2.5 active:bg-surface-raised"
    >
      <EntityAvatar person={person} size={44} online={online} />
      <View className="min-w-0 flex-1">
        <Text numberOfLines={1} className="text-[15px] font-medium text-foreground">
          {person.name}
        </Text>
        {subtitle === '' ? null : (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </Pressable>
  );
}
