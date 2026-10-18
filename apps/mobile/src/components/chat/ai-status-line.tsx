import {
  liveStageFor,
  topicActivityLine,
  topicActivityView,
  type ChatSummary,
} from '@zilar/chat-core';
import { Effect } from 'effect';
import { View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { Text } from '@/components/ui/text';
import { useChatStore } from '@/store/chat-store-provider';

export function AiStatusLine({ chat }: { chat: ChatSummary }) {
  const messages = useChatStore((state) => state.messagesByChat[chat.id]);
  const openAtMessage = useChatStore((state) => state.openAtMessage);
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
  const openQuestion = (messageId: string): void => {
    Effect.runFork(
      Effect.tryPromise({
        try: () => openAtMessage(chat.id, messageId),
        catch: (cause) => cause,
      }).pipe(Effect.ignore),
    );
  };
  const questionId = first.questionId;
  return (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      className="max-w-full flex-row items-center gap-1.5 rounded-full border border-divider bg-surface-raised px-3 py-1"
    >
      <EntityAvatar
        person={{ id: first.aiId, name: first.name, avatarUrl: first.avatarUrl }}
        size={16}
        ai
      />
      <Text numberOfLines={1} className="min-w-0 shrink text-[13px] text-muted-foreground">
        {first.state === 'waiting' && questionId !== undefined ? (
          <Text className="text-foreground" onPress={() => openQuestion(questionId)}>
            {first.name}
          </Text>
        ) : (
          <Text className="text-foreground">{first.name}</Text>
        )}{' '}
        {text}
      </Text>
      {extra > 0 ? (
        <Text className="shrink-0 font-mono text-[13px] text-muted-foreground">+{extra}</Text>
      ) : null}
    </View>
  );
}
