import { isUnjoinedTopic } from '@zilar/chat-core';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChannelScreen } from '@/components/chat/channel-screen';
import { groupAction, rawCall } from '@/components/chat/group-action';
import { GroupHeader } from '@/components/chat/group-header';
import { GroupTopicList } from '@/components/chat/group-topic-list';
import { NewTopicSheet } from '@/components/chat/new-topic-sheet';
import {
  TopicActionsSheet,
  type TopicPrefAction,
  type TopicSheetAction,
} from '@/components/chat/topic-actions-sheet';
import { useGroupNewTopic } from '@/components/chat/use-group-new-topic';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { goBackOrHome } from '@/lib/navigation';
import {
  mayArchiveTopic,
  mayCreateTopic,
  splitGroupTopics,
  topicsHeaderSubtitle,
  topicsOfGroup,
} from '@/lib/topics';
import type { ChatSummary } from '@/lib/types';
import { useChatStore } from '@/store/chat-store-provider';

export default function GroupTopicsScreen() {
  return (
    <RequireAuth>
      <GroupTopics />
    </RequireAuth>
  );
}

function GroupTopics() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; newTopic?: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';
  const wantsNewTopic = params.newTopic === '1';

  const chats = useChatStore((state) => state.chats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  // Until the boot lands `me`, `groupIdForChat`'s map is empty, so the list may be the cached one.
  const me = useChatStore((state) => state.me);
  // A channel's chat row carries no `groupId`, so the row is resolved through the store's remembered entry map.
  const groupIdForChat = useChatStore((state) => state.groupIdForChat);
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  // The cached path dedupes in-flight loads too, so the group screen after the chat screen costs no second GET.
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const archiveTopic = useChatStore((state) => state.archiveTopic);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const dismissTopicNotice = useChatStore((state) => state.dismissTopicNotice);

  const [sheetFor, setSheetFor] = useState<ChatSummary | null>(null);
  const [sheetMuteOpen, setSheetMuteOpen] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [confirmArchive, setConfirmArchive] = useState<ChatSummary | null>(null);
  const [openedNewTopic, setOpenedNewTopic] = useState(false);

  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? groupDetail?.title ?? 'Group';
  const groupChatId = general?.id ?? topics[0]?.id ?? groupId;

  // Per-user archived topics hide like manager-archived ones: one Archived toggle, never two sections. Every hook stays above the early return (the `react/rules-of-hooks` rule on `src/app`).
  const { active: activeTopics, archived: archivedTopics } = useMemo(
    () => splitGroupTopics(topics.filter((chat) => !isUnjoinedTopic(chat.topic, currentUserId))),
    [topics, currentUserId],
  );

  const members = useMemo(() => groupDetail?.members ?? [], [groupDetail]);
  const groupAis = useMemo(() => groupDetail?.ais ?? [], [groupDetail]);
  const myAisInGroup = useMemo(
    () => groupAis.filter((ai) => ownedAis.some((owned) => owned.id === ai.aiId)),
    [groupAis, ownedAis],
  );
  const canCreate = mayCreateTopic({
    members,
    meUserId: currentUserId,
    membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
  });

  const newTopic = useGroupNewTopic({ groupChatId, myAis: myAisInGroup });

  if (wantsNewTopic && !openedNewTopic && canCreate && topics.length > 0) {
    setOpenedNewTopic(true);
    newTopic.open();
  }

  const notice =
    topicNotice !== undefined && topicNotice.groupId === groupId ? topicNotice.message : undefined;

  const [archiveState, runArchive] = useAction((chatId: string) =>
    groupAction(
      rawCall(() => archiveTopic(chatId)).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setSheetFor(null);
            setSheetMuteOpen(false);
            setConfirmArchive(null);
          }),
        ),
      ),
      () => setSheetError('Could not archive the topic. Try again.'),
    ),
  );

  const [prefState, runPref] = useAction(
    (request: { readonly chatId: string; readonly change: Parameters<typeof setChatPref>[1] }) =>
      groupAction(
        rawCall(() => setChatPref(request.chatId, request.change)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              setSheetFor(null);
              setSheetMuteOpen(false);
            }),
          ),
        ),
        () => setSheetError('Could not save. Try again.'),
      ),
  );
  const sheetBusy = isWaiting(archiveState) || isWaiting(prefState);

  const openTopic = (chat: ChatSummary) => {
    dismissTopicNotice();
    router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
  };

  const runSheetAction = (_action: TopicSheetAction) => {
    const chat = sheetFor;
    if (chat === null) {
      return;
    }
    setSheetError('');
    setConfirmArchive(chat);
    setSheetFor(null);
    setSheetMuteOpen(false);
  };

  const runSheetPref = (action: TopicPrefAction) => {
    const chat = sheetFor;
    if (chat === null) {
      return;
    }
    setSheetError('');
    const input =
      action.kind === 'mute'
        ? { mutedUntil: mutedUntilFor(action.duration, new Date()) }
        : action.kind === 'unmute'
          ? { mutedUntil: null }
          : action.kind === 'pin'
            ? { pinned: action.pinned }
            : { archived: action.archived };
    runPref({ chatId: chat.id, change: input });
  };

  const openSheetFor = (chat: ChatSummary) => {
    setSheetError('');
    setSheetMuteOpen(false);
    setSheetFor(chat);
  };

  // A channel renders its own screen instead of the topics list: its chat row is the feed, never a topic row. This check runs before the empty-topics return so a channel opens instead of going home.
  const channelRow = chats.find(
    (chat) => chat.chatKind === 'channel' && groupIdForChat(chat.id) === groupId,
  );
  const channelFeed = channelRow ?? topics.find((topic) => topic.chatKind === 'channel');
  const channelByDetail = groupDetail?.kind === 'channel';
  if (channelFeed !== undefined || (channelByDetail && topics.length > 0)) {
    const feed = channelFeed ?? topics[0]!;
    const feedTitle = channelRow === undefined ? groupTitle : channelRow.title;
    return <ChannelScreen groupId={groupId} feedId={feed.id} title={feedTitle} />;
  }

  // The cached list can paint as 'loaded' before the boot fills `groupIdForChat`, so never leave for the chat list until `me` is set, or a cached list hides the channel.
  if (topics.length === 0 && chatsLoad === 'loaded' && me !== undefined) {
    goBackOrHome(router);
    return null;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <GroupHeader
        title={groupTitle}
        avatarId={groupChatId}
        subtitle={topicsHeaderSubtitle({
          memberCount:
            (groupDetail === undefined
              ? (general?.memberCount ?? members.length)
              : members.length) + groupAis.length,
          topicCount: activeTopics.length,
        })}
        onBack={() => goBackOrHome(router)}
        onOpenInfo={() => router.push({ pathname: '/group-info/[id]', params: { id: groupId } })}
      />

      {notice !== undefined ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-muted-foreground">{notice}</Text>
        </View>
      ) : null}
      {newTopic.aiError !== '' ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-danger">{newTopic.aiError}</Text>
        </View>
      ) : null}

      <GroupTopicList
        activeTopics={activeTopics}
        archivedTopics={archivedTopics}
        canCreate={canCreate}
        onOpenTopic={openTopic}
        onOpenSheet={openSheetFor}
        onNewTopic={newTopic.open}
      />

      <TopicActionsSheet
        chat={sheetFor}
        canArchive={
          sheetFor !== null &&
          mayArchiveTopic(
            {
              members,
              meUserId: currentUserId,
              membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
            },
            sheetFor.topic,
          )
        }
        muteOpen={sheetMuteOpen}
        onOpenMute={() => setSheetMuteOpen(true)}
        onAction={runSheetAction}
        onPref={runSheetPref}
        onClose={() => {
          if (!sheetBusy) {
            setSheetFor(null);
            setSheetMuteOpen(false);
          }
        }}
      />
      <ConfirmDialog
        visible={confirmArchive !== null}
        title={`Archive “${confirmArchive?.title ?? ''}” for everyone?`}
        message="The topic disappears from the list for everyone. Its history stays on the server."
        error={sheetError}
        confirmLabel="Archive"
        busyLabel="Archiving…"
        busy={isWaiting(archiveState)}
        onCancel={() => {
          if (!isWaiting(archiveState)) {
            setConfirmArchive(null);
            setSheetError('');
          }
        }}
        onConfirm={() => {
          if (confirmArchive !== null) {
            setSheetError('');
            runArchive(confirmArchive.id);
          }
        }}
      />
      {sheetError !== '' && confirmArchive === null ? (
        <View className="absolute bottom-24 left-4 right-4 rounded-[10px] bg-danger/20 px-3 py-2">
          <Text className="text-center text-[13px] text-danger">{sheetError}</Text>
        </View>
      ) : null}

      <NewTopicSheet
        key={newTopic.visible ? 'open' : 'closed'}
        visible={newTopic.visible}
        groupTitle={groupTitle}
        members={members}
        myAis={myAisInGroup}
        meUserId={currentUserId}
        busy={newTopic.busy}
        error={newTopic.error}
        onCreate={newTopic.create}
        onClose={newTopic.close}
      />
    </SafeAreaView>
  );
}
