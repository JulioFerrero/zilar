import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import type { Contact } from '@/lib/contacts-api';

/**
 * One contact row (T-1314): avatar with the online dot, the name and a second
 * line (status or `@handle`), plus an optional trailing node (the "⋯" menu on
 * the Contacts screen, the round checkbox in the New group picker).
 */
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
  /** The second line; an empty string renders only the name. */
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
