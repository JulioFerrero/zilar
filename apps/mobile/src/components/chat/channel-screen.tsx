import { useRouter } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { ChannelMembers } from '@/components/chat/channel-members';
import { InviteLinksSheet } from '@/components/chat/invite-links-sheet';
import {
  ChannelCallFailed,
  callStore,
  useChannelInvites,
} from '@/components/chat/use-channel-invites';
import { Text } from '@/components/ui/text';
import { Button } from '@/components/ui/button';
import {
  channelAdminsOf,
  channelDescription,
  channelInfoSubtitle,
  channelSubscriberCount,
  channelViewerRole,
  mayManageChannel,
} from '@/lib/channels';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { useChatStore } from '@/store/chat-store-provider';

type ChannelScreenProps = {
  groupId: string;
  feedId: string;
  title: string;
};

/**
 * The channel screen (T-0144), the mobile twin of web's `ChannelPanel`: the
 * channel's title, description and subscriber count; the feed row (the
 * General topic — tapping opens it); the admins/owner list (subscribers see
 * only that slice, never the audience); invite links for owners/admins via
 * the existing sheet; Leave channel for subscribers; promote/demote for the
 * owner (`PUT /api/groups/:id/members/:userId/role`, the last-admin guard
 * reads as a plain message).
 *
 * The subscriber audience is visible to managers only — the detail carries
 * the full list for them (the server strips `members` for subscribers), and
 * subscribers load the admins slice through `listChannelMembers`.
 */
export function ChannelScreen({ groupId, feedId, title }: ChannelScreenProps) {
  return (
    <RequireAuth>
      <Channel groupId={groupId} feedId={feedId} title={title} />
    </RequireAuth>
  );
}

function Channel({ groupId, feedId, title }: ChannelScreenProps) {
  const router = useRouter();
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const chats = useChatStore((state) => state.chats);
  const listChannelMembers = useChatStore((state) => state.listChannelMembers);
  const changeChannelRole = useChatStore((state) => state.changeChannelRole);
  const leaveChannel = useChatStore((state) => state.leaveChannel);
  const links = useChannelInvites(groupId);

  // A role change ignores a second press while one is waiting (the old
  // `roleBusy` guard). The message is cleared while a new attempt runs.
  // Uninterruptible: the change must land even if the screen unmounts first.
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

  // Leaving navigates home on success; the button stays "Leaving…" after it.
  const [leaveState, leaveAction] = useAction(() =>
    // Uninterruptible: leaving navigates away, so the screen may unmount
    // before the store call resolves; the navigation must still happen.
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

  // The admins slice of a subscriber: the last loaded value is kept while a
  // new load runs, and a failed load keeps it too (the old `slice` state).
  const [sliceState, loadSlice] = useAction(() => callStore(() => listChannelMembers(groupId)), {
    mode: 'replace',
  });
  const slice = Option.getOrUndefined(AsyncResult.value(sliceState));
  const sliceFailed = failureOf(sliceState) !== undefined;

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

  // Non-managers never see the audience: the admins slice (owner/admins —
  // who posts is public, every admin post carries its name) loads once the
  // detail settles. Managers read the full list from the detail they
  // already hold, so no second request. The load is an action, so a state
  // change never runs inside the effect body.
  useEffect(() => {
    if (isManager || groupDetail === undefined) {
      return;
    }
    loadSlice(undefined);
  }, [isManager, groupDetail, groupId, loadSlice]);

  const members = groupDetail?.members ?? [];
  const shown = isManager ? members : (slice ?? []);
  const admins = channelAdminsOf(shown);
  // Managers see the audience below the posters; subscribers never do.
  const subscribers = isManager ? members.filter((member) => member.role === 'member') : [];
  const count = channelSubscriberCount(
    feedRow ?? {},
    members.length === 0 ? undefined : members.length,
  );
  const description = channelDescription(feedRow ?? {}, groupDetail);

  const flipRole = (userId: string, role: 'admin' | 'member') => {
    changeRole({ userId, role });
  };

  const leave = () => {
    if (leaving) {
      return;
    }
    leaveAction(undefined);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <View className="flex-1 px-4 py-4">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-[22px] font-semibold text-foreground">{title}</Text>
          <View accessibilityRole="image" accessibilityLabel="Channel">
            <Megaphone size={18} color="#8a8a8a" />
          </View>
        </View>
        <Text className="mt-0.5 text-[13px] text-muted-foreground">
          {channelInfoSubtitle(count)}
        </Text>
        {description !== null && description !== '' ? (
          <Text className="mt-2 text-[14px] text-muted-foreground">{description}</Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open the ${title} feed`}
          onPress={() => router.push({ pathname: '/chat/[id]', params: { id: feedId } })}
          className="mt-4 flex-row items-center gap-3 rounded-2xl bg-surface px-4 py-3 active:bg-surface-raised"
        >
          <Avatar id={feedId} name={title} size={40} />
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[15px] font-semibold text-foreground">
              Feed
            </Text>
            <Text numberOfLines={1} className="text-[13px] text-muted-foreground">
              {feedRow?.lastMessage?.text ?? 'Open the feed'}
            </Text>
          </View>
        </Pressable>

        <ChannelMembers
          isManager={isManager}
          isOwner={isOwner}
          currentUserId={currentUserId}
          loading={groupDetail === undefined && slice === undefined}
          admins={admins}
          adminsLoadFailed={sliceFailed}
          subscribers={subscribers}
          roleBusy={roleBusy}
          roleError={roleError}
          onFlipRole={flipRole}
        />

        {isManager ? (
          <Button
            accessibilityLabel="Invite links"
            onPress={links.open}
            variant="default"
            size="default"
            className="mt-4 self-start"
          >
            <Text>Invite links</Text>
          </Button>
        ) : (
          <Button
            accessibilityLabel="Leave channel"
            disabled={leaving}
            onPress={leave}
            variant="outline"
            size="default"
            className="mt-4 self-start"
          >
            <Text>{leaving ? 'Leaving…' : 'Leave channel'}</Text>
          </Button>
        )}
        {!isManager && leaveFailed ? (
          <Text role="alert" className="mt-2 text-[13px] text-danger">
            Could not leave the channel. Try again.
          </Text>
        ) : null}
      </View>
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
    </SafeAreaView>
  );
}
