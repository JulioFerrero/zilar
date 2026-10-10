import type { UiMessage } from '@zilar/chat-core';
import { View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';

export function MessageTombstone({
  message,
  outgoing,
  isGroup,
  isLastInGroup,
}: {
  message: UiMessage;
  outgoing: boolean;
  isGroup: boolean;
  isLastInGroup: boolean;
}) {
  const showAvatar = isGroup && !outgoing && isLastInGroup;
  return (
    <View
      className={cn(
        'flex-row px-2',
        outgoing ? 'justify-end' : 'items-end',
        isLastInGroup ? 'mb-2' : 'mb-0.5',
      )}
    >
      {!outgoing && isGroup ? (
        showAvatar ? (
          <Avatar id={message.senderId} name={message.senderName} size={34} className="mr-2" />
        ) : (
          <View className="mr-2" style={{ width: 34 }} />
        )
      ) : null}
      <View className={cn('max-w-[80%] shrink', outgoing ? 'items-end' : 'items-start')}>
        <View
          className={cn(
            'rounded-[14px] bg-[#1a1a1a] px-3 py-1.5',
            outgoing ? 'rounded-br-[4px]' : 'rounded-bl-[4px]',
          )}
        >
          <Text className="text-[13px] italic text-muted-foreground">
            {outgoing ? 'You deleted this message' : 'This message was deleted'}
          </Text>
        </View>
      </View>
    </View>
  );
}
