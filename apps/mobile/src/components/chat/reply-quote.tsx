import { lightToPlain, replyQuoteContent, senderColor, type UiMessage } from '@zilar/chat-core';
import { Pressable, View } from 'react-native';

import { useChatJump } from '@/components/chat/chat-jump-context';
import { LONG_PRESS_MS } from '@/components/chat/message-bubble-decor';
import { useOpenMessageMenu } from '@/components/chat/message-menu-context';
import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * Quoted reply block at the top of a bubble: a bar and the name in the
 * replied-to sender's colour (the accent for our own messages), and the excerpt
 * or a media label ("Photo", "Voice message", …) when the target has no text.
 * With a chat-jump in scope it is a button that jumps to the quoted message on
 * tap (T-1667), while a long hold still opens the bubble menu; otherwise a
 * plain block, like select mode.
 */
export function ReplyQuote({ message }: { message: UiMessage }) {
  const reply = message.replyTo;
  const jump = useChatJump();
  const openMenu = useOpenMessageMenu();
  // The wire reply carries no name: resolve the target from the loaded history.
  const referenced = useChatStore((state) =>
    reply === undefined
      ? undefined
      : state.messagesByChat[message.chatId]?.find((item) => item.id === reply.id),
  );
  const currentUserId = useChatStore((state) => state.currentUserId);
  if (reply === undefined) {
    return null;
  }
  const content = replyQuoteContent(reply, referenced, currentUserId);
  if (content === undefined) {
    return null;
  }
  const color = content.own ? ACCENT : senderColor(content.senderId);
  const block = (
    <>
      <View className="w-[3px]" style={{ backgroundColor: color }} />
      <View className="min-w-0 flex-1 px-2 py-1">
        <Text className="text-[13px] font-semibold" color={color}>
          {content.senderName}
        </Text>
        {content.text !== undefined ? (
          <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
            {lightToPlain(content.text)}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (jump === undefined) {
    return <View className="mb-1 flex-row overflow-hidden rounded-md bg-surface">{block}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Go to the message from ${content.senderName}`}
      onPress={() => jump(reply.id)}
      onLongPress={openMenu}
      delayLongPress={LONG_PRESS_MS}
      className="mb-1 flex-row overflow-hidden rounded-md bg-surface"
    >
      {block}
    </Pressable>
  );
}
