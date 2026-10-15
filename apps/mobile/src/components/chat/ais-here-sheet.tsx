import { topicActivityLine, type ChatSummary, type TopicAiActivity } from '@zilar/chat-core';
import { palette } from '@zilar/ui-tokens';
import { Effect } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useRouter } from 'expo-router';
import { Square } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { useAisApi } from '@/components/ais/use-ais-api';
import { AiActivityMark } from '@/components/chat/ai-activity-marks';
import { ActionSheet } from '@/components/ui/action-sheet';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { MUTED_FOREGROUND } from '@/lib/colors';
import { useQuery } from '@/lib/effect/use-query';

/** One AI in the "AIs here" sheet: its picture with its mark, name and line, plus Stop. */
function AisHereRow({
  entry,
  chatId,
  canStop,
  onOpenApprovals,
}: {
  entry: TopicAiActivity;
  chatId: string;
  canStop: boolean;
  onOpenApprovals: () => void;
}) {
  const { api } = useAisApi();
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
  return (
    <View>
      {waiting ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${entry.name} ${topicActivityLine(entry.state)}`}
          onPress={onOpenApprovals}
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

/**
 * The topic header's "AIs here" sheet (T-1539), the mobile twin of the web
 * popover: every AI at work in the topic with what it is doing, Stop for a
 * working AI the viewer owns, and a row to Approvals for one waiting for you.
 */
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
  const { api } = useAisApi();
  // Only an AI the viewer owns can be stopped, like the task card (T-1422).
  // Until the list loads, or when it fails, no entry shows Stop.
  const [aisResult] = useQuery(() => Effect.promise(() => api.listAis()), [api]);
  const ownIds = AsyncResult.isSuccess(aisResult)
    ? new Set(aisResult.value.map((ai) => ai.id))
    : undefined;
  const activity = chat.topic?.activity ?? [];

  const openApprovals = (): void => {
    onClose();
    router.push('/settings/approvals');
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
        />
      ))}
    </ActionSheet>
  );
}
