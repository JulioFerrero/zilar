import { topicActivityLine, type ChatSummary, type TopicAiActivity } from '@zilar/chat-core';
import { palette } from '@zilar/ui-tokens';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRouter } from 'expo-router';
import { Square } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { makeAisApi } from '@zilar/client-core';
import { useApi } from '@/lib/use-mockable-api';
import { AiActivityMark } from '@/components/chat/ai-activity-marks';
import { ActionSheet } from '@/components/ui/action-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useQuery } from '@/lib/effect/use-query';
import { useChatStore } from '@/store/chat-store-provider';

function AisHereRow({
  entry,
  chatId,
  canStop,
  onOpenApprovals,
  onOpenQuestion,
}: {
  entry: TopicAiActivity;
  chatId: string;
  canStop: boolean;
  onOpenApprovals: () => void;
  onOpenQuestion: (messageId: string) => void;
}) {
  const { api } = useApi(makeAisApi);
  const [stopping, setStopping] = useState(false);
  const [failed, setFailed] = useState(false);

  const stop = (): void => {
    if (stopping) {
      return;
    }
    setStopping(true);
    setFailed(false);
    void api
      .stopAiTurn(entry.aiId, chatId)
      .catch(() => {
        setFailed(true);
      })
      .finally(() => {
        setStopping(false);
      });
  };

  const picture = <AiActivityMark entry={entry} size={36} ringColor={palette.surface} />;
  const lines = (
    <View className="min-w-0 flex-1">
      <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
        {entry.name}
      </Text>
      <Text numberOfLines={1} className="text-[14px] text-muted-foreground">
        {topicActivityLine(entry.state)}
      </Text>
    </View>
  );

  const waiting = entry.state === 'waiting';
  const questionId = entry.questionId;
  const onPress =
    waiting && questionId !== undefined ? () => onOpenQuestion(questionId) : onOpenApprovals;
  return (
    <View>
      {waiting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${entry.name} ${topicActivityLine(entry.state)}`}
          onPress={onPress}
          className="flex-row items-center gap-3 px-4 py-3 active:bg-list-hover"
        >
          {picture}
          {lines}
        </Pressable>
      ) : (
        <View className="flex-row items-center gap-3 px-4 py-3">
          {picture}
          {lines}
          {entry.state === 'working' && canStop ? (
            <IconButton label={`Stop ${entry.name}`} disabled={stopping} onPress={stop}>
              <Square size={16} color={MUTED_FOREGROUND} />
            </IconButton>
          ) : null}
        </View>
      )}
      {failed ? (
        <Text accessibilityRole="alert" className="px-4 pb-2 text-[13px] text-danger">
          Could not stop {entry.name}
        </Text>
      ) : null}
    </View>
  );
}

export function AisHereSheet({
  visible,
  onClose,
  chat,
}: {
  visible: boolean;
  onClose: () => void;
  chat: ChatSummary;
}) {
  const router = useRouter();
  const { api } = useApi(makeAisApi);
  // Only an AI the viewer owns can be stopped.
  const [aisResult] = useQuery(() => Effect.promise(() => api.listAis()), [api]);
  const ownIds = AsyncResult.isSuccess(aisResult)
    ? new Set(aisResult.value.map((ai) => ai.id))
    : undefined;
  const activity = chat.topic?.activity ?? [];
  const openAtMessage = useChatStore((state) => state.openAtMessage);

  const openApprovals = (): void => {
    onClose();
    router.push('/settings/approvals');
  };

  const openQuestion = (messageId: string): void => {
    onClose();
    void openAtMessage(chat.id, messageId).catch(() => undefined);
  };

  return (
    <ActionSheet visible={visible} onClose={onClose} closeLabel="Close AIs here" title="AIs here">
      {activity.map((entry) => (
        <AisHereRow
          key={entry.aiId}
          entry={entry}
          chatId={chat.id}
          canStop={ownIds?.has(entry.aiId) === true}
          onOpenApprovals={openApprovals}
          onOpenQuestion={openQuestion}
        />
      ))}
    </ActionSheet>
  );
}
