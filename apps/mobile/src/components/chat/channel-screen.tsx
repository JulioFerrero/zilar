import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { Data, Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { InviteLinksSheet, type CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
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

/** A store call that rejected; `code` is what the server said (empty when none). */
class ChannelCallFailed extends Data.TaggedError('ChannelCallFailed')<{
  readonly code: string;
}> {}

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';

/** A store promise as an Effect: a rejection keeps its code for the message. */
function callStore<A>(call: () => Promise<A>): Effect.Effect<A, ChannelCallFailed> {
  return Effect.tryPromise({
    try: call,
    catch: (error) => new ChannelCallFailed({ code: codeOf(error) }),
  });
}

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
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);

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

  const [linksOpen, setLinksOpen] = useState(false);
  const [linksNow, setLinksNow] = useState(() => Date.now());
  const [links, setLinks] = useState<
    {
      id: string;
      label: string | null;
      tokenHint: string;
      uses: number;
      maxUses: number | null;
      expiresAt: string | null;
      revoked: boolean;
      createdAt: string;
    }[]
  >([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);

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

  // The links list, each step an Effect run in the background (the old
  // promise chains, same order and same messages). A new load clears the
  // error first; a failed load keeps the last list.
  const reloadLinks = (): Effect.Effect<void> =>
    Effect.sync(() => setLinksError('')).pipe(
      Effect.andThen(callStore(() => listInviteLinks(groupId))),
      Effect.match({
        onFailure: () => setLinksError('Could not load invite links. Try again.'),
        onSuccess: (next) => setLinks(next),
      }),
    );

  const openLinks = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    setLinksNow(Date.now());
    setLinksOpen(true);
    Effect.runFork(reloadLinks());
  };

  const flipRole = (userId: string, role: 'admin' | 'member') => {
    changeRole({ userId, role });
  };

  const leave = () => {
    if (leaving) {
      return;
    }
    leaveAction(undefined);
  };

  // The clipboard/share bridge for the shown-once block: `expo-clipboard`
  // and React Native's `Share` cannot run in Node tests, so the sheet takes
  // callbacks and this screen wires the real modules at the edge. The sheet
  // takes Promises, so each bridge call runs its Effect to a Promise.
  const linksShare = useMemo(
    () => ({
      copyText: (text: string) =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Clipboard.setStringAsync(text),
            catch: (error) => error,
          }).pipe(Effect.asVoid),
        ),
      shareText: (text: string): Promise<void> =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Share.share({ message: text }),
            catch: (error) => error,
          }).pipe(Effect.asVoid),
        ),
    }),
    [],
  );

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

        <Text className="mt-5 text-[13px] font-semibold text-muted-foreground">
          {isManager ? 'SUBSCRIBERS' : 'ADMINS'}
        </Text>
        {groupDetail === undefined && slice === undefined ? (
          <Text className="mt-1 text-[13px] text-muted-foreground">Loading…</Text>
        ) : null}
        {!isManager && sliceFailed ? (
          <Text role="alert" className="mt-1 text-[13px] text-danger">
            Could not load the admins. Try again.
          </Text>
        ) : null}
        {admins.map((member) => (
          <View key={member.userId} className="mt-1 flex-row items-center gap-2 py-1.5">
            <Avatar id={member.userId} name={member.name} size={32} />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
              {member.name}
            </Text>
            <Text className="text-[11px] text-muted-foreground">{member.role}</Text>
            {isOwner && member.userId !== currentUserId && member.role === 'admin' ? (
              <Button
                accessibilityLabel={`Demote ${member.name} to subscriber`}
                disabled={roleBusy}
                onPress={() => flipRole(member.userId, 'member')}
                variant="outline"
                size="sm"
              >
                <Text>Demote</Text>
              </Button>
            ) : null}
          </View>
        ))}
        {subscribers.map((member) => (
          <View key={member.userId} className="mt-1 flex-row items-center gap-2 py-1.5">
            <Avatar id={member.userId} name={member.name} size={32} />
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px] text-foreground">
              {member.name}
            </Text>
            {isOwner && member.userId !== currentUserId ? (
              <Button
                accessibilityLabel={`Promote ${member.name} to admin`}
                disabled={roleBusy}
                onPress={() => flipRole(member.userId, 'admin')}
                variant="outline"
                size="sm"
              >
                <Text>Promote</Text>
              </Button>
            ) : null}
          </View>
        ))}
        {roleError !== '' ? (
          <Text role="alert" className="mt-1 text-[13px] text-danger">
            {roleError}
          </Text>
        ) : null}

        {isManager ? (
          <Button
            accessibilityLabel="Invite links"
            onPress={openLinks}
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
        visible={linksOpen}
        links={links}
        busy={linksBusy}
        error={linksError}
        createdUrl={createdUrl}
        revokingId={revokingId}
        now={linksNow}
        share={linksShare}
        onCreate={(input: CreateInviteLinkForm) => {
          setLinksBusy(true);
          setLinksError('');
          Effect.runFork(
            callStore(() => createInviteLink(groupId, input)).pipe(
              Effect.tap((created) => Effect.sync(() => setCreatedUrl(created.url))),
              Effect.andThen(reloadLinks()),
              Effect.catchTag('ChannelCallFailed', () =>
                Effect.sync(() => setLinksError('Could not create the invite link. Try again.')),
              ),
              Effect.ensuring(Effect.sync(() => setLinksBusy(false))),
            ),
          );
        }}
        onRevoke={(linkId: string) => {
          setRevokingId(linkId);
          setLinksError('');
          Effect.runFork(
            callStore(() => revokeInviteLink(groupId, linkId)).pipe(
              Effect.andThen(reloadLinks()),
              Effect.catchTag('ChannelCallFailed', () =>
                Effect.sync(() => setLinksError('Could not revoke the invite link. Try again.')),
              ),
              Effect.ensuring(Effect.sync(() => setRevokingId(undefined))),
            ),
          );
        }}
        onDismissCreated={() => setCreatedUrl(undefined)}
        onClose={() => {
          if (!linksBusy) {
            setLinksOpen(false);
          }
        }}
      />
    </SafeAreaView>
  );
}
