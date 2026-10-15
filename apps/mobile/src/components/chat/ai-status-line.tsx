import {
  liveStageFor,
  topicActivityLine,
  topicActivityView,
  type ChatSummary,
} from '@zilar/chat-core';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * T-1551: the quiet line above a topic's composer, the phone twin of web's
 * `AiStatusLine` (T-1537). It shows the first AI at work with its picture and
 * what it does, then "+N" for the others. It renders nothing when the chat is
 * not a topic or no AI is working or waiting.
 */
export function AiStatusLine({ chat }: { chat: ChatSummary }) {
  const messages = useChatStore((state) => state.messagesByChat[chat.id]);
  const topic = chat.topic;
  const entries = topic === undefined ? [] : topicActivityView(topic.activity, topic.doneAt).active;
  const first = entries[0];
  if (first === undefined) {
    return null;
  }
  const stage = liveStageFor(messages, first.jid);
  const text =
    first.state === 'working' && stage !== undefined
      ? `· ${stage}`
      : topicActivityLine(first.state);
  const extra = entries.length - 1;
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      className="flex-row items-center gap-1.5 px-2 py-1.5"
    >
      <EntityAvatar
        person={{ id: first.aiId, name: first.name, avatarUrl: first.avatarUrl }}
        size={16}
        ai
      />
      <Text numberOfLines={1} className="min-w-0 shrink text-[13px] text-muted-foreground">
        <Text className="text-foreground">{first.name}</Text> {text}
      </Text>
      {extra > 0 ? (
        <Text className="shrink-0 font-mono text-[13px] text-muted-foreground">+{extra}</Text>
      ) : null}
    </View>
  );
}
