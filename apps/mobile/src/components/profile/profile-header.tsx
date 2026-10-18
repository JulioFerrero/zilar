import { type AvatarPersonInput } from '@zilar/chat-core';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';

type ProfileHeaderProps = {
  person: AvatarPersonInput;
  status: string;
  online: boolean;
};

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
