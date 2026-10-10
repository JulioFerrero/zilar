import { useLocalSearchParams, useRouter } from 'expo-router';
import { Effect } from 'effect';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChannelScreen } from '@/components/chat/channel-screen';
import { groupAction, rawCall } from '@/components/chat/group-action';
import { GroupHeader } from '@/components/chat/group-header';
import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { GroupTopicList } from '@/components/chat/group-topic-list';
import { InviteLinksSheet } from '@/components/chat/invite-links-sheet';
import { NewTopicSheet } from '@/components/chat/new-topic-sheet';
import {
  TopicActionsSheet,
  type TopicPrefAction,
  type TopicSheetAction,
} from '@/components/chat/topic-sheets';
import { useGroupInviteLinks } from '@/components/chat/use-group-invite-links';
import { useGroupNewTopic } from '@/components/chat/use-group-new-topic';
import { useGroupRoles } from '@/components/chat/use-group-roles';
import { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { mayChangeVisibility, VisibilitySheet } from '@/components/chat/visibility-sheet';
import { Text } from '@/components/ui/text';
import { mutedUntilFor } from '@/lib/chat-prefs';
import { isWaiting, useAction } from '@/lib/effect/use-action';
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
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';

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

  // The detail is keyed by group id (not chat id): load it on mount so the
  // member list, the "+" gate and the AI count resolve even on first visit.
  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? 'Group';
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
  const canManageLinks = useMemo(
    () =>
      members.some(
        (member) =>
          member.userId === currentUserId && (member.role === 'owner' || member.role === 'admin'),
      ),
    [members, currentUserId],
  );
  const canCreate = mayCreateTopic({
    members,
    meUserId: currentUserId,
    membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
  });
  const myRole = members.find((member) => member.userId === currentUserId)?.role;
  const canChangeVisibility = mayChangeVisibility(myRole);

  const roles = useGroupRoles(groupId, members);
  const links = useGroupInviteLinks(groupId);
  const visibility = useGroupVisibility(groupId);
  const newTopic = useGroupNewTopic({ groupChatId, myAis: myAisInGroup });

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
    router.back();
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
          memberCount: general?.memberCount ?? members.length,
          aiCount: groupAis.length,
          topicCount: activeTopics.length,
        })}
        canManageLinks={canManageLinks}
        canChangeVisibility={canChangeVisibility}
        onBack={() => router.back()}
        onOpenLinks={links.open}
        onOpenVisibility={visibility.open}
        onOpenRoles={roles.open}
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
      <InviteLinksSheet
        visible={links.visible}
        links={links.links}
        busy={links.busy}
        error={links.error}
        createdUrl={links.createdUrl}
        revokingId={links.revokingId}
        now={links.now}
        share={links.share}
        onCreate={links.create}
        onRevoke={links.revoke}
        onDismissCreated={links.dismissCreated}
        onClose={links.close}
      />
      <GroupRolesSheet
        visible={roles.visible}
        groupTitle={groupTitle}
        members={roles.members}
        roles={roles.roles}
        rolesError={roles.loadError}
        isManager={roles.isManager}
        busy={roles.busy}
        error={roles.error}
        onRetryRoles={roles.retry}
        onCreateRole={roles.createRole}
        onRenameRole={roles.renameRole}
        onDeleteRole={roles.deleteRole}
        onToggleMember={roles.toggleMember}
        onClose={roles.close}
      />
      <VisibilitySheet
        visible={visibility.visible}
        groupTitle={groupTitle}
        visibility={visibility.truth?.visibility ?? 'private'}
        handle={visibility.truth?.handle ?? null}
        live={{ picked: visibility.picked, typed: visibility.typed }}
        busy={visibility.busy}
        checking={visibility.checking}
        check={visibility.check}
        error={visibility.error}
        saved={visibility.saved}
        confirmingPrivate={visibility.confirmingPrivate}
        share={links.share}
        onPick={visibility.pick}
        onHandleChange={visibility.changeHandle}
        onSave={visibility.save}
        onCancelPrivate={visibility.cancelPrivate}
        onClose={visibility.close}
      />
    </SafeAreaView>
  );
}
