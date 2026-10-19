import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { EntityAvatar } from '@/components/chat/entity-avatar';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { StateMessage } from '@/components/ui/state-message';
import { Text } from '@/components/ui/text';
import { interruptFiber, runLater } from '@zilar/client-core';
import { useChatStore } from '@/store/chat-store-provider';
import { mayCreateTopic } from '@zilar/chat-core';

type NewTopicCandidate = { id: string; title: string; seed: string };

// The picker waits at most this long for group details: `ensureGroupDetail` swallows a failed load, so a detail that never lands would leave the spinner on forever.
export const NEW_TOPIC_LOAD_CAP_MS = 5000;

/** How often a detail that has not landed yet is asked for again. */
export const NEW_TOPIC_RETRY_MS = 1000;

// The "+" menu's New topic picker: the groups where this viewer may create a topic, read through the same store accessor the group screen uses (`groupDetail`, `currentUserId`, `members`), so a group the screen offers is listed here. Details stream in, and a cap bounds the wait.
export function NewTopicGroupSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (groupId: string) => void;
}) {
  const chats = useChatStore((state) => state.chats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);

  // One entry per group, keyed by `groupId`; channels have no topics to create.
  const candidates = useMemo(() => {
    const groups = new Map<string, NewTopicCandidate>();
    for (const chat of chats) {
      if (chat.chatKind === 'channel' || chat.groupId === undefined) {
        continue;
      }
      const existing = groups.get(chat.groupId);
      const title = chat.groupTitle ?? chat.title;
      if (existing === undefined) {
        groups.set(chat.groupId, { id: chat.groupId, title, seed: chat.id });
      } else if (chat.topic?.isGeneral === true) {
        groups.set(chat.groupId, { ...existing, seed: chat.id });
      }
    }
    return [...groups.values()];
  }, [chats]);

  // Eligibility read through the store subscription with the group screen's accessor, so a detail landing after mount re-fires the selector. The snapshot is one joined string: `id` for not eligible, `id\u0001` for eligible, empty while missing.
  const detailKey = useChatStore((state) =>
    candidates
      .map((group) => {
        const detail = state.groupDetail(group.id);
        if (detail === undefined) {
          return '';
        }
        return mayCreateTopic({
          members: detail.members,
          meUserId: currentUserId,
          membersCanCreateTopics: detail.membersCanCreateTopics === true,
        })
          ? `${group.id}\u0001`
          : group.id;
      })
      .join('\u0000'),
  );

  const { eligible, checked } = useMemo(() => {
    const eligibleIds = new Set<string>();
    let loaded = 0;
    for (const entry of detailKey.split('\u0000')) {
      if (entry === '') {
        continue;
      }
      const canCreate = entry.endsWith('\u0001');
      const id = canCreate ? entry.slice(0, -1) : entry;
      loaded += 1;
      if (canCreate) {
        eligibleIds.add(id);
      }
    }
    return { eligible: candidates.filter((group) => eligibleIds.has(group.id)), checked: loaded };
  }, [candidates, detailKey]);

  // A bounded wait for details that never land, reset on close and restarted while the sheet is open.
  const [capExpired, setCapExpired] = useState(false);
  if (!visible && capExpired) {
    setCapExpired(false);
  }
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const fiber = runLater(NEW_TOPIC_LOAD_CAP_MS, () => setCapExpired(true));
    return () => {
      interruptFiber(fiber);
    };
  }, [visible]);

  // Loads each group's detail while open and retries a missing one every `NEW_TOPIC_RETRY_MS`, until it lands, the cap fires or the sheet closes.
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    for (const group of candidates) {
      ensureGroupDetail(group.id);
    }
    if (checked >= candidates.length || capExpired) {
      return undefined;
    }
    const fiber = runLater(NEW_TOPIC_RETRY_MS, () => setRetryTick((tick) => tick + 1));
    return () => {
      interruptFiber(fiber);
    };
  }, [visible, candidates, ensureGroupDetail, checked, capExpired, retryTick]);

  const hasCandidates = candidates.length > 0;
  // Don't judge the list before `/api/chats` answered: an empty candidate set during the first load is "not there yet", not "no groups".
  const chatsReady = chatsLoad !== 'loading';
  // A failed load never lands, so the cap is the failure path out of the spinner.
  const settled = chatsReady && (!hasCandidates || checked >= candidates.length || capExpired);
  const loading = !settled && eligible.length === 0;

  return (
    <BottomSheet visible={visible} onClose={onClose} closeLabel="Close new topic" title="New topic">
      <Text className="mt-1 text-[14px] text-muted-foreground">Choose a group.</Text>
      {eligible.length > 0 ? (
        <View className="mt-2 gap-1">
          {eligible.map((group) => (
            <Pressable
              key={group.id}
              accessibilityRole="button"
              accessibilityLabel={`New topic in ${group.title}`}
              onPress={() => onPick(group.id)}
              className="flex-row items-center gap-3 rounded-lg px-2 py-2 active:bg-surface-raised"
            >
              <EntityAvatar chat={{ id: group.seed, title: group.title }} size={36} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                {group.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : loading ? (
        <StateMessage kind="loading" title="Looking for your groups…" />
      ) : (
        <StateMessage
          kind="empty"
          title="You can't create topics in any group yet."
          hint="Ask an admin to allow new topics, or open a group you manage."
        />
      )}
    </BottomSheet>
  );
}
