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
} from '@/components/chat/topic-sheets';
import { useGroupNewTopic } from '@/components/chat/use-group-new-topic';
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
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  // Mount loads the detail only when nothing fresh is cached: the cached
  // path dedupes in-flight loads too, so the group screen after the chat
  // screen costs no second GET (T-0139). Explicit refreshes still force.
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
  const [openedNewTopic, setOpenedNewTopic] = useState(false);

  // The detail is keyed by group id (not chat id): load it on mount so the
  // member list, the "+" gate and the AI count resolve even on first visit.
  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? groupDetail?.title ?? 'Group';
  const groupChatId = general?.id ?? topics[0]?.id ?? groupId;

  // Per-user archived topics hide like manager-archived ones (web parity):
  // both share one Archived toggle at the bottom, never two sections.
  // Every hook below stays above the early return (enforced by the oxlint
  // `react/rules-of-hooks` rule on `src/app`; the keyed remount and roles
  // load are covered by `components/chat/group-screen-sheets.test.tsx`).
  const { active: activeTopics, archived: archivedTopics } = useMemo(
    () => splitGroupTopics(topics),
    [topics],
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

  // T-1289/MUX-29: the "+" menu's New topic picker lands here with
  // `?newTopic=1`. Open the sheet once the group detail confirms the viewer
  // may create (the picker only offered allowed groups); the adjusted-state
  // pattern matches the chats screen's `?searchChat=` handling.
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
    runArchive(chat.id);
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

  if (topics.length === 0 && chatsLoad === 'loaded') {
    goBackOrHome(router);
    return null;
  }

  // T-0144: a channel renders its own screen (info, feed, admins, invite
  // links, leave, promote/demote) instead of the topics list — a channel has
  // exactly one topic, its feed, and no topic creation. The feed row carries
  // `chatKind: 'channel'`; the detail backs it up once loaded.
  const channelFeed = topics.find((topic) => topic.chatKind === 'channel');
  const channelByDetail = groupDetail?.kind === 'channel';
  if (channelFeed !== undefined || (channelByDetail && topics.length > 0)) {
    const feed = channelFeed ?? topics[0]!;
    return <ChannelScreen groupId={groupId} feedId={feed.id} title={groupTitle} />;
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <GroupHeader
        title={groupTitle}
        avatarId={groupChatId}
        subtitle={topicsHeaderSubtitle({
          // T-1552: AIs count as members, so the header shows one combined count.
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
      {sheetError !== '' ? (
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
