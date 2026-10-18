import { useRouter } from 'expo-router';
import { Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { ChevronLeft } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChannelMoreMenu } from '@/components/channel-info/more-menu';
import { ChannelPeoplePage } from '@/components/channel-info/people-page';
import { ChannelInfoRoot } from '@/components/channel-info/root-page';
import { ChannelSettingsPage } from '@/components/channel-info/settings-page';
import { useGroupManage } from '@/components/chat/group-manage-section';
import { InviteLinksSheet } from '@/components/chat/invite-links-sheet';
import {
  ChannelCallFailed,
  callStore,
  useChannelInvites,
} from '@/components/chat/use-channel-invites';
import { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { VisibilitySheet } from '@/components/chat/visibility-sheet';
import { ActivityPage } from '@/components/group-info/activity-page';
import { GroupAisList } from '@/components/group-info/ais-list';
import { AllowedPage, useGroupRules } from '@/components/group-info/allowed-page';
import { GroupContentSheets, useGroupContent } from '@/components/group-info/group-info-pages';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import {
  channelDescription,
  channelSubscriberCount,
  channelViewerRole,
  mayManageChannel,
} from '@/lib/channels';
import { ICON } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { goBackOrHome } from '@/lib/navigation';
import { WEB_HOST } from '@/lib/web-host';
import { useChatStore } from '@/store/chat-store-provider';

type ChannelScreenProps = {
  groupId: string;
  feedId: string;
  title: string;
};

type ChannelPage = 'root' | 'people' | 'ais' | 'activity' | 'allowed' | 'settings';

/** The subscriber audience is visible to managers only: the server strips
 *  `members` for subscribers, who load the admins slice instead. */
export function ChannelScreen({ groupId, feedId, title }: ChannelScreenProps) {
  return (
    <RequireAuth>
      <Channel groupId={groupId} feedId={feedId} title={title} />
    </RequireAuth>
  );
}

function Channel({ groupId, feedId, title }: ChannelScreenProps) {
  const router = useRouter();
  const [page, setPage] = useState<ChannelPage>('root');
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const chats = useChatStore((state) => state.chats);
  const listChannelMembers = useChatStore((state) => state.listChannelMembers);
  const changeChannelRole = useChatStore((state) => state.changeChannelRole);
  const leaveChannel = useChatStore((state) => state.leaveChannel);
  const links = useChannelInvites(groupId);
  const content = useGroupContent(feedId);
  const visibility = useGroupVisibility(groupId);
  const [moreOpen, setMoreOpen] = useState(false);

  // Uninterruptible: the role change must land even if the screen unmounts first.
  const [roleState, changeRole] = useAction(
    ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      callStore(() => changeChannelRole(feedId, userId, role)).pipe(Effect.uninterruptible),
  );
  const roleBusy = isWaiting(roleState);
  const roleFailure = roleBusy ? undefined : failureOf(roleState);
  // The last-admin guard reads as a plain message, never a raw dump.
  const roleError =
    roleFailure === undefined
      ? ''
      : roleFailure.code === 'channel_needs_admin'
        ? 'The channel needs at least one admin.'
        : 'Could not change the role. Try again.';

  const [leaveState, leaveAction] = useAction(() =>
    // Uninterruptible: leaving navigates away, so the screen may unmount first.
    callStore(() => leaveChannel(feedId)).pipe(
      Effect.andThen(
        Effect.try({
          try: () => router.replace('/'),
          catch: () => new ChannelCallFailed({ code: '' }),
        }),
      ),
      Effect.uninterruptible,
    ),
  );
  const leaving = isWaiting(leaveState) || AsyncResult.isSuccess(leaveState);
  const leaveFailed = !isWaiting(leaveState) && failureOf(leaveState) !== undefined;

  const [sliceState, loadSlice] = useAction(() => callStore(() => listChannelMembers(groupId)), {
    mode: 'replace',
  });
  const slice = Option.getOrUndefined(AsyncResult.value(sliceState));
  const sliceFailed = failureOf(sliceState) !== undefined;

  const [, share] = useAction(
    (url: string) =>
      Effect.tryPromise({ try: () => Share.share({ message: url }), catch: (cause) => cause }).pipe(
        Effect.ignore,
      ),
    { mode: 'replace' },
  );

  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const feedRow = chats.find((chat) => chat.id === feedId);
  const myRole = channelViewerRole(
    feedRow ?? {},
    groupDetail === undefined
      ? undefined
      : {
          members: groupDetail.members.map((member) => ({
            userId: member.userId,
            role: member.role,
          })),
        },
    currentUserId,
  );
  const isManager = mayManageChannel(myRole);
  const isOwner = myRole === 'owner';
  const groupRules = useGroupRules(groupId, isManager);
  const manage = useGroupManage({ groupId, groupChatId: feedId, isOwner, noun: 'channel' });

  // Non-managers never see the audience: the admins slice loads once the detail
  // settles, while managers read the full list from the detail they already hold.
  useEffect(() => {
    if (isManager || groupDetail === undefined) {
      return;
    }
    loadSlice(undefined);
  }, [isManager, groupDetail, groupId, loadSlice]);

  const members = groupDetail?.members ?? [];
  const shown = isManager ? members : (slice ?? []);
  const count = channelSubscriberCount(
    feedRow ?? {},
    members.length === 0 ? undefined : members.length,
  );
  const description = channelDescription(feedRow ?? {}, groupDetail);
  const rawHandle = feedRow?.handle ?? null;
  const handle = rawHandle === '' ? null : rawHandle;
  const shareUrl = handle === null ? null : `${WEB_HOST}/@${encodeURIComponent(handle)}`;

  const closePage = () => setPage('root');

  if (page === 'ais') {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['top']}>
        <View className="h-14 flex-row items-center gap-2 px-3">
          <IconButton label="Back" onPress={closePage}>
            <ChevronLeft size={18} color={ICON} />
          </IconButton>
          <Text className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">AIs</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <GroupAisList groupId={groupId} ais={groupDetail?.ais ?? []} isManager={isManager} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (page === 'people') {
    return (
      <ChannelPeoplePage
        people={shown}
        me={currentUserId}
        isOwner={isOwner}
        loading={groupDetail === undefined && slice === undefined}
        loadFailed={sliceFailed}
        roleBusy={roleBusy}
        roleError={roleError}
        onFlipRole={(userId, role) => changeRole({ userId, role })}
        onBack={closePage}
      />
    );
  }

  if (page === 'activity') {
    return <ActivityPage groupId={groupId} onBack={closePage} />;
  }

  if (page === 'allowed') {
    return <AllowedPage handle={groupRules} onBack={closePage} />;
  }

  if (page === 'settings') {
    return (
      <>
        <ChannelSettingsPage
          onBack={closePage}
          onOpenVisibility={() => {
            if (isOwner) {
              visibility.open();
            }
          }}
        />
        {/* The sheet lives here, not on the root: only Settings opens it, and
            the subpages early-return so the root's copy would be unmounted. */}
        <VisibilitySheet
          visible={visibility.visible}
          groupTitle={title}
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
      </>
    );
  }

  return (
    <>
      <ChannelInfoRoot
        feedId={feedId}
        title={title}
        avatarUrl={feedRow?.avatarUrl}
        handle={handle}
        subscriberCount={count}
        description={description}
        aisCount={groupDetail === undefined ? undefined : (groupDetail.ais ?? []).length}
        feedPreview={feedRow?.lastMessage?.text}
        chatReady={feedRow !== undefined}
        pinsCount={content.pinsCount}
        isManager={isManager}
        isOwner={isOwner}
        canLeave={!isOwner}
        leaving={leaving}
        leaveError={leaveFailed ? 'Could not leave the channel. Try again.' : ''}
        onBack={() => goBackOrHome(router)}
        onSearch={() => router.push({ pathname: '/', params: { searchChat: feedId } })}
        onShare={shareUrl === null ? undefined : () => share(shareUrl)}
        onMore={() => setMoreOpen(true)}
        onOpenFeed={() => router.push({ pathname: '/chat/[id]', params: { id: feedId } })}
        onOpenPeople={() => setPage('people')}
        onOpenAis={() => setPage('ais')}
        onOpenLinks={links.open}
        onOpenMedia={content.openMedia}
        onOpenPins={content.openPins}
        onOpenActivity={() => setPage('activity')}
        onOpenAllowed={() => setPage('allowed')}
        onOpenSettings={() => setPage('settings')}
        onLeave={() => {
          if (!leaving) {
            leaveAction(undefined);
          }
        }}
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
        onCreate={links.onCreate}
        onRevoke={links.onRevoke}
        onDismissCreated={links.onDismissCreated}
        onClose={links.onClose}
      />
      <ChannelMoreMenu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={title}
        busy={manage.busy}
        error={manage.error}
        onDelete={manage.onDelete}
      />
      <GroupContentSheets content={content} />
    </>
  );
}
