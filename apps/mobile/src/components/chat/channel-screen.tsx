import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { InviteLinksSheet, type CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { Text } from '@/components/ui/text';
import {
  channelAdminsOf,
  channelDescription,
  channelInfoSubtitle,
  channelSubscriberCount,
  channelViewerRole,
  mayManageChannel,
} from '@/lib/channels';
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
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);

  const [slice, setSlice] = useState<
    { userId: string; name: string; role: 'owner' | 'admin' | 'member' }[] | undefined
  >(undefined);
  const [sliceError, setSliceError] = useState('');
  const [roleBusy, setRoleBusy] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');
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
  // already hold, so no second request. The state settles exactly once per
  // load (no synchronous setState in the effect body).
  useEffect(() => {
    if (isManager || groupDetail === undefined) {
      return;
    }
    let active = true;
    void listChannelMembers(groupId).then(
      (members) => {
        if (active) {
          setSlice(members);
          setSliceError('');
        }
      },
      () => {
        if (active) {
          setSliceError('Could not load the admins. Try again.');
        }
      },
    );
    return () => {
      active = false;
    };
  }, [isManager, groupDetail, groupId, listChannelMembers]);

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

  const reloadLinks = async (): Promise<void> => {
    setLinksError('');
    try {
      setLinks(await listInviteLinks(groupId));
    } catch {
      setLinksError('Could not load invite links. Try again.');
    }
  };

  const openLinks = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    setLinksNow(Date.now());
    setLinksOpen(true);
    void reloadLinks();
  };

  const flipRole = (userId: string, role: 'admin' | 'member') => {
    if (roleBusy) {
      return;
    }
    setRoleBusy(true);
    setRoleError('');
    void changeChannelRole(feedId, userId, role)
      .catch((error: unknown) => {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : '';
        // The last-admin guard reads as a plain message, never a raw dump.
        setRoleError(
          code === 'channel_needs_admin'
            ? 'The channel needs at least one admin.'
            : 'Could not change the role. Try again.',
        );
      })
      .finally(() => setRoleBusy(false));
  };

  const leave = () => {
    if (leaving) {
      return;
    }
    setLeaving(true);
    setLeaveError('');
    void leaveChannel(feedId)
      .then(() => router.replace('/'))
      .catch(() => {
        setLeaveError('Could not leave the channel. Try again.');
        setLeaving(false);
      });
  };

  // The clipboard/share bridge for the shown-once block: `expo-clipboard`
  // and React Native's `Share` cannot run in Node tests, so the sheet takes
  // callbacks and this screen wires the real modules at the edge.
  const linksShare = useMemo(
    () => ({
      copyText: (text: string) => Clipboard.setStringAsync(text).then(() => {}),
      shareText: async (text: string): Promise<void> => {
        await Share.share({ message: text });
      },
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
        {!isManager && sliceError !== '' ? (
          <Text role="alert" className="mt-1 text-[13px] text-danger">
            {sliceError}
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Demote ${member.name} to subscriber`}
                disabled={roleBusy}
                onPress={() => flipRole(member.userId, 'member')}
                className="rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
              >
                <Text className="text-[13px] text-foreground">Demote</Text>
              </Pressable>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Promote ${member.name} to admin`}
                disabled={roleBusy}
                onPress={() => flipRole(member.userId, 'admin')}
                className="rounded-full border border-border-strong px-3 py-1 active:bg-surface-raised disabled:opacity-60"
              >
                <Text className="text-[13px] text-foreground">Promote</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {roleError !== '' ? (
          <Text role="alert" className="mt-1 text-[13px] text-danger">
            {roleError}
          </Text>
        ) : null}

        {isManager ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Invite links"
            onPress={openLinks}
            className="mt-4 self-start rounded-full bg-accent px-4 py-2 active:opacity-90"
          >
            <Text className="text-[15px] font-medium text-accent-foreground">Invite links</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave channel"
            disabled={leaving}
            onPress={leave}
            className="mt-4 self-start rounded-full border border-border-strong px-4 py-2 active:bg-surface-raised disabled:opacity-60"
          >
            <Text className="text-[15px] font-medium text-foreground">
              {leaving ? 'Leaving…' : 'Leave channel'}
            </Text>
          </Pressable>
        )}
        {!isManager && leaveError !== '' ? (
          <Text role="alert" className="mt-2 text-[13px] text-danger">
            {leaveError}
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
          void createInviteLink(groupId, input)
            .then((created) => {
              setCreatedUrl(created.url);
              return reloadLinks();
            })
            .catch(() => setLinksError('Could not create the invite link. Try again.'))
            .finally(() => setLinksBusy(false));
        }}
        onRevoke={(linkId: string) => {
          setRevokingId(linkId);
          setLinksError('');
          void revokeInviteLink(groupId, linkId)
            .then(() => reloadLinks())
            .catch(() => setLinksError('Could not revoke the invite link. Try again.'))
            .finally(() => setRevokingId(undefined));
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
