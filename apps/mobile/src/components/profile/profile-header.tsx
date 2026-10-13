import { type AvatarPersonInput } from '@zilar/chat-core';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';

type ProfileHeaderProps = {
  /** The person shown: their name, fallback id and picture (T-1334). */
  person: AvatarPersonInput;
  /** "online" / "last seen …" for a known DM, else the @handle. */
  status: string;
  /** Draws the green dot beside the status (a DM that is online). */
  online: boolean;
};

/**
 * The Telegram-style profile top (T-1308): a large centred picture, the name
 * below it and the status under that.
 */
export function ProfileHeader({ person, status, online }: ProfileHeaderProps) {
  return (
    <View className="items-center gap-1 pt-4">
      <EntityAvatar person={person} size={104} />
      <Text className="mt-2 text-[22px] font-semibold text-foreground">{person.name}</Text>
      <View className="flex-row items-center gap-1.5">
        {online ? <View className="h-2 w-2 rounded-full bg-online" /> : null}
        <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
          {status}
        </Text>
      </View>
    </View>
  );
}
