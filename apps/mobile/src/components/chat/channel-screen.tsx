import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Data, Effect, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { ChevronLeft, Crown, Eye, MoreVertical, Shield, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { ChannelInfoRoot } from '@/components/channel-info/root-page';
import { EntityAvatar } from '@/components/chat/entity-avatar';
import { useGroupManage } from '@/components/chat/group-manage-section';
import type { CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { InviteLinksSheet } from '@/components/chat/invite-links-sheet';
import { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { GroupVisibilitySheet } from '@/components/chat/visibility-sheet';
import { ActivityPage } from '@/components/group-info/activity-page';
import { GroupAisList } from '@/components/group-info/ais-list';
import { AllowedPage, useGroupRules } from '@/components/group-info/allowed-page';
import { GroupContentSheets, useGroupContent } from '@/components/group-info/group-info-pages';
import { IconButton } from '@/components/ui/icon-button';
import { SearchField } from '@/components/ui/search-field';
import { Text, TextField } from '@/components/ui/text';
import type { GroupRole } from '@/lib/chat-api';
import {
  channelDescription,
  channelSubscriberCount,
  channelViewerRole,
  mayManageChannel,
} from '@/lib/channels';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { failureOf, isWaiting, useAction } from '@/lib/effect/use-action';
import { goBackOrHome } from '@/lib/navigation';
import { WEB_HOST } from '@/lib/web-host';
import { useChatStore } from '@/store/chat-store-provider';
import { InfoRow, InfoRowGroup } from '@/components/group-info/info-row';
import { ScreenHeader } from '@/components/ui/screen-header';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';

/** A store call that rejected; `code` is what the server said (empty when none). */
class ChannelCallFailed extends Data.TaggedError('ChannelCallFailed')<{
  readonly code: string;
}> {}

const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';

function callStore<A>(call: () => Promise<A>): Effect.Effect<A, ChannelCallFailed> {
  return Effect.tryPromise({
    try: call,
    catch: (error) => new ChannelCallFailed({ code: codeOf(error) }),
  });
}

type ChannelMoreMenuProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  busy: boolean;
  error: string;
  onDelete: () => void;
};

function ChannelMoreMenu({ open, onClose, title, busy, error, onDelete }: ChannelMoreMenuProps) {
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');

  const closeDelete = () => {
    if (!busy) {
      setDeleteOpen(false);
      setDeleteName('');
    }
  };

  return (
    <>
      <ActionSheet
        visible={open}
        onClose={onClose}
        onDismissed={() => {
          if (pendingDelete) {
            setPendingDelete(false);
            setDeleteOpen(true);
          }
        }}
        closeLabel="Close more actions"
      >
        <ActionSheetItem
          label="Delete channel"
          icon={Trash2}
          destructive
          onPress={() => {
            setPendingDelete(true);
            onClose();
          }}
        />
      </ActionSheet>

      <BottomSheet
        visible={deleteOpen}
        onClose={closeDelete}
        closeLabel="Close delete channel"
        title="Delete channel"
        footer={
          <Button
            variant="destructive"
            accessibilityLabel="Delete channel"
            disabled={busy || deleteName.trim() !== title}
            onPress={onDelete}
          >
            <Text>{busy ? 'Deleting…' : 'Delete channel'}</Text>
          </Button>
        }
      >
        <Text className="text-[13px] leading-5 text-muted-foreground">
          Delete {title} for everyone? The channel and its messages go away. This can&apos;t be
          undone.
        </Text>
        <View className="mt-3">
          <TextField
            value={deleteName}
            onChangeText={setDeleteName}
            placeholder={title}
            accessibilityLabel="Type the channel name to confirm"
          />
        </View>
        {error !== '' ? (
          <Text accessibilityRole="alert" className="pt-2 text-[13px] text-danger">
            {error}
          </Text>
        ) : null}
      </BottomSheet>
    </>
  );
}

type ChannelSettingsPageProps = {
  onBack: () => void;
  onOpenVisibility: () => void;
};

function ChannelSettingsPage({ onBack, onOpenVisibility }: ChannelSettingsPageProps) {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Settings" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="gap-3 px-4 pt-1">
          <InfoRowGroup>
            <InfoRow icon={Eye} label="Visibility" onPress={onOpenVisibility} />
          </InfoRowGroup>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** The owner crown color from web's `MemberRow`; mobile has no token for it. */
const OWNER_COLOR = '#e5b84b';

type ChannelPerson = {
  userId: string;
  name: string;
  handle?: string;
  role: GroupRole;
};

const RANK: Record<GroupRole, number> = { owner: 0, admin: 1, member: 2 };

type ChannelPeoplePageProps = {
  people: ChannelPerson[];
  me: string;
  isOwner: boolean;
  loading: boolean;
  loadFailed: boolean;
  roleBusy: boolean;
  roleError: string;
  onFlipRole: (userId: string, role: 'admin' | 'member') => void;
  onBack: () => void;
};

function ChannelPeoplePage({
  people,
  me,
  isOwner,
  loading,
  loadFailed,
  roleBusy,
  roleError,
  onFlipRole,
  onBack,
}: ChannelPeoplePageProps) {
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<ChannelPerson | undefined>(undefined);

  const needle = query.trim().toLowerCase();
  const visible = [...people]
    .sort((a, b) => RANK[a.role] - RANK[b.role])
    .filter(
      (person) =>
        needle === '' ||
        person.name.toLowerCase().includes(needle) ||
        (person.handle ?? '').toLowerCase().includes(needle),
    );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top']}>
      <ScreenHeader variant="sub" title="Subscribers" onBack={onBack} />

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View className="px-4 pb-3">
          <SearchField
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            maxLength={100}
            placeholder="Search"
            accessibilityLabel="Search subscribers"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {loading ? <Text className="px-4 text-[13px] text-muted-foreground">Loading…</Text> : null}
        {!loading && loadFailed ? (
          <Text accessibilityRole="alert" className="px-4 text-[13px] text-danger">
            Could not load the members. Try again.
          </Text>
        ) : null}

        <View className="px-4">
          <InfoRowGroup>
            {visible.map((person) => {
              const manageable = isOwner && person.role !== 'owner' && person.userId !== me;
              return (
                <View
                  key={person.userId}
                  className="min-h-[48px] flex-row items-center gap-3 px-3 py-2"
                >
                  <EntityAvatar person={person} size={40} />
                  <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                    <Text numberOfLines={1} className="shrink text-[15px] text-foreground">
                      {person.name}
                    </Text>
                    {person.handle === undefined ? null : (
                      <Text numberOfLines={1} className="shrink text-[13px] text-muted-foreground">
                        @{person.handle}
                      </Text>
                    )}
                    {person.role === 'owner' ? (
                      <View accessibilityRole="image" accessibilityLabel="Owner">
                        <Crown size={14} color={OWNER_COLOR} />
                      </View>
                    ) : null}
                    {person.role === 'admin' ? (
                      <View accessibilityRole="image" accessibilityLabel="Admin">
                        <Shield size={14} color={MUTED_FOREGROUND} />
                      </View>
                    ) : null}
                  </View>
                  {manageable ? (
                    <IconButton
                      label={`Options for ${person.name}`}
                      className="h-9 w-9"
                      disabled={roleBusy}
                      onPress={() => setMenuFor(person)}
                    >
                      <MoreVertical size={16} color={ICON} />
                    </IconButton>
                  ) : null}
                </View>
              );
            })}
          </InfoRowGroup>
        </View>

        {roleError === '' ? null : (
          <Text accessibilityRole="alert" className="px-4 pt-3 text-center text-[13px] text-danger">
            {roleError}
          </Text>
        )}
      </ScrollView>

      <ActionSheet
        visible={menuFor !== undefined}
        onClose={() => setMenuFor(undefined)}
        closeLabel="Close member options"
        title={menuFor?.name}
      >
        {menuFor !== undefined ? (
          <ActionSheetItem
            label={menuFor.role === 'admin' ? 'Remove admin' : 'Make admin'}
            icon={Shield}
            disabled={roleBusy}
            onPress={() => {
              const person = menuFor;
              setMenuFor(undefined);
              onFlipRole(person.userId, person.role === 'admin' ? 'member' : 'admin');
            }}
          />
        ) : null}
      </ActionSheet>
    </SafeAreaView>
  );
}

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
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);
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

  // The links list, each step an Effect run in the background; a new load clears the error first and a failed load keeps the last list.
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

  // The clipboard/share bridge: `expo-clipboard` and `Share` cannot run in Node tests, so the sheet takes callbacks and the screen wires the real modules at the edge.
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

  const onCreateLink = (input: CreateInviteLinkForm) => {
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
  };

  const onRevokeLink = (linkId: string) => {
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
  };

  const onDismissCreated = () => setCreatedUrl(undefined);

  const onCloseLinks = () => {
    if (!linksBusy) {
      setLinksOpen(false);
    }
  };

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
        <GroupVisibilitySheet state={visibility} groupTitle={title} share={linksShare} />
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
        onOpenLinks={openLinks}
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
        visible={linksOpen}
        links={links}
        busy={linksBusy}
        error={linksError}
        createdUrl={createdUrl}
        revokingId={revokingId}
        now={linksNow}
        share={linksShare}
        onCreate={onCreateLink}
        onRevoke={onRevokeLink}
        onDismissCreated={onDismissCreated}
        onClose={onCloseLinks}
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
