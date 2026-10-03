import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, ChevronLeft, Eye, Link2, Plus, Search, Users } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, Share, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RequireAuth } from '@/auth/RequireAuth';
import { Avatar } from '@/components/chat/avatar';
import { ChannelScreen } from '@/components/chat/channel-screen';
import { InviteLinksSheet, type CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import {
  mayChangeVisibility,
  VisibilitySheet,
  visibilitySaveError,
} from '@/components/chat/visibility-sheet';
import { useDirectoryApi } from '@/components/directory/use-directory-api';
import { NewTopicSheet, type NewTopicInput } from '@/components/chat/new-topic-sheet';
import {
  TopicActionsSheet,
  type TopicPrefAction,
  type TopicSheetAction,
} from '@/components/chat/topic-sheets';
import { TopicRow } from '@/components/chat/topic-row';
import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { asColorScheme } from '@/lib/color-scheme';
import { ICON, MUTED_FOREGROUND } from '@/lib/colors';
import { well } from '@/lib/depth';
import { DirectoryApiError, type GroupVisibility } from '@/lib/directory-api';
import { mutedUntilFor } from '@/lib/chat-prefs';
import type { GroupInviteLink } from '@/lib/invite-links-api';
import { describeRolesError, mayManageRoles, membersWithChips } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';
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
  const scheme = asColorScheme(useColorScheme().colorScheme);

  const chats = useChatStore((state) => state.chats);
  const chatsLoad = useChatStore((state) => state.chatsLoad);
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  // Mount loads the detail only when nothing fresh is cached: the cached
  // path dedupes in-flight loads too, so the group screen after the chat
  // screen costs no second GET (T-0139). Explicit refreshes still force.
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const refreshGroupDetail = useChatStore((state) => state.refreshGroupDetail);
  const groupRoles = useChatStore((state) => state.groupRoles(groupId));
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);
  const createGroupRole = useChatStore((state) => state.createGroupRole);
  const renameGroupRole = useChatStore((state) => state.renameGroupRole);
  const deleteGroupRole = useChatStore((state) => state.deleteGroupRole);
  const setGroupRoleMembers = useChatStore((state) => state.setGroupRoleMembers);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);
  const createTopic = useChatStore((state) => state.createTopic);
  const addTopicAi = useChatStore((state) => state.addTopicAi);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksNow, setLinksNow] = useState(() => Date.now());
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksBusy, setLinksBusy] = useState(false);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);
  const archiveTopic = useChatStore((state) => state.archiveTopic);
  const setChatPref = useChatStore((state) => state.setChatPref);
  const topicNotice = useChatStore((state) => state.topicNotice);
  const dismissTopicNotice = useChatStore((state) => state.dismissTopicNotice);

  const [search, setSearch] = useState('');
  const [sheetFor, setSheetFor] = useState<ChatSummary | null>(null);
  const [sheetMuteOpen, setSheetMuteOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState('');
  const [sheetBusy, setSheetBusy] = useState(false);
  const [sheetError, setSheetError] = useState('');
  const [composerAiError, setComposerAiError] = useState('');
  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesBusy, setRolesBusy] = useState(false);
  const [rolesError, setRolesError] = useState('');
  const [rolesLoadError, setRolesLoadError] = useState('');
  // Visibility (T-0183): owner only, like the web panel. The sheet reads
  // server truth on open and saves through the directory API.
  const { api: directoryApi } = useDirectoryApi();
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [visibilityTruth, setVisibilityTruth] = useState<{
    visibility: GroupVisibility;
    handle: string | null;
  } | null>(null);
  const [visibilityLoadError, setVisibilityLoadError] = useState('');
  const [picked, setPicked] = useState<GroupVisibility>('private');
  const [typed, setTyped] = useState('');
  const [check, setCheck] = useState<{ available: boolean; reason?: string | undefined } | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const [visibilityError, setVisibilityError] = useState('');
  const [visibilitySaved, setVisibilitySaved] = useState(false);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);

  // The detail is keyed by group id (not chat id): load it on mount so the
  // member list, the "+" gate and the AI count resolve even on first visit.
  // The roles ride a second load for the members/roles sheet.
  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
      // The first load maps through the same error helper as every retry
      // (404 on a load means the group is gone, not denied).
      void refreshGroupRoles(groupId).catch((error: unknown) =>
        setRolesLoadError(describeRolesError(error, 'load')),
      );
    }
  }, [groupId, ensureGroupDetail, refreshGroupRoles]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? 'Group';
  const groupChatId = general?.id ?? topics[0]?.id ?? groupId;

  // Per-user archived topics hide like manager-archived ones (web parity):
  // both share one Archived toggle at the bottom, never two sections.
  // The effect-free `useState` below the memos above keeps every hook above
  // the early return (see `lib/hooks-guard`).
  const [archivedOpen, setArchivedOpen] = useState(false);
  const { active: activeTopics, archived: archivedTopics } = useMemo(
    () => splitGroupTopics(topics),
    [topics],
  );

  const query = search.trim().toLowerCase();
  const listed =
    query === ''
      ? activeTopics
      : activeTopics.filter((topic) => topic.title.toLowerCase().includes(query));
  const listedArchived =
    query === ''
      ? archivedTopics
      : archivedTopics.filter((topic) => topic.title.toLowerCase().includes(query));
  const visible = [...listed, ...(archivedOpen ? listedArchived : [])];

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
  const isManager = mayManageRoles(members.find((member) => member.userId === currentUserId)?.role);
  const myRole = members.find((member) => member.userId === currentUserId)?.role;
  const canChangeVisibility = mayChangeVisibility(myRole);
  const membersWithRoleChips = useMemo(
    () => membersWithChips(members, groupRoles),
    [members, groupRoles],
  );

  // Roles writes (T-0137) take the route's group id directly, so an empty
  // group with no loaded topic rows still works. The store replaces its
  // cache on success, so the sheet re-renders with server truth.
  const runRolesWrite = (work: () => Promise<unknown>): Promise<void> => {
    setRolesBusy(true);
    setRolesError('');
    return work()
      .then(() => {})
      .catch((error: unknown) => setRolesError(describeRolesError(error, 'write')))
      .finally(() => setRolesBusy(false));
  };

  const retryRolesLoad = () => {
    setRolesLoadError('');
    void refreshGroupRoles(groupId).catch((error: unknown) =>
      setRolesLoadError(describeRolesError(error, 'load')),
    );
  };

  const toggleRoleMember = (role: CustomGroupRole, userId: string): Promise<void> => {
    const held = role.members.some((holder) => holder.userId === userId);
    const userIds = held
      ? role.members.filter((holder) => holder.userId !== userId).map((holder) => holder.userId)
      : [...role.members.map((holder) => holder.userId), userId];
    return runRolesWrite(() => setGroupRoleMembers(groupId, role.id, userIds));
  };
  const notice =
    topicNotice !== undefined && topicNotice.groupId === groupId ? topicNotice.message : undefined;

  // Invite links (T-0136): owner/admin only, like the web panel. The list
  // loads when the sheet opens; the created URL is kept only until
  // dismissed, never stored.
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
    // Fresh clock for the expired/exhausted labels on every open: the sheet
    // stays mounted while hidden, so a mount-time stamp would go stale.
    setLinksNow(Date.now());
    setLinksOpen(true);
    void reloadLinks();
  };

  const createLink = (input: CreateInviteLinkForm) => {
    setLinksBusy(true);
    setLinksError('');
    void createInviteLink(groupId, input)
      .then((created) => {
        setCreatedUrl(created.url);
        return reloadLinks();
      })
      .catch(() => setLinksError('Could not create the invite link. Try again.'))
      .finally(() => setLinksBusy(false));
  };

  const revokeLink = (linkId: string) => {
    setRevokingId(linkId);
    setLinksError('');
    void revokeInviteLink(groupId, linkId)
      .then(() => reloadLinks())
      .catch(() => setLinksError('Could not revoke the invite link. Try again.'))
      .finally(() => setRevokingId(undefined));
  };

  // Visibility (T-0183): loads server truth when the sheet opens, keeps a
  // debounced live availability check for a changed handle, and saves
  // through the directory API (the store refreshes the detail so the header
  // re-renders with server truth).
  const openVisibility = () => {
    setVisibilityError('');
    setVisibilitySaved(false);
    setConfirmingPrivate(false);
    setCheck(null);
    setVisibilityOpen(true);
    setVisibilityLoadError('');
    void directoryApi
      .getGroupVisibility(groupId)
      .then((truth) => {
        setVisibilityTruth(truth);
        setPicked(truth.visibility);
        setTyped(truth.handle ?? '');
      })
      .catch(() => setVisibilityLoadError('Could not load visibility. Try again.'));
  };

  const trimmedHandle = typed.trim();
  const ownHandle =
    visibilityTruth?.handle !== null &&
    visibilityTruth?.handle !== undefined &&
    visibilityTruth.handle !== '' &&
    trimmedHandle.toLowerCase() === visibilityTruth.handle.toLowerCase();

  // Debounced live availability for a changed handle (the group's own
  // handle is skipped: the server sees its live row and would report
  // "taken"). The effect only schedules the check; the timeout applies the
  // busy state and the promise the result once (the lint rule flags
  // synchronous setState inside effects).
  useEffect(() => {
    if (!visibilityOpen || picked !== 'public' || trimmedHandle === '' || ownHandle) {
      return;
    }
    let active = true;
    const value = trimmedHandle;
    const pending = setTimeout(() => {
      if (!active) {
        return;
      }
      setChecking(true);
      void directoryApi
        .checkGroupHandle(value)
        .then((result) => {
          if (active) {
            setCheck(result);
            setChecking(false);
          }
        })
        .catch((error: unknown) => {
          if (!active) {
            return;
          }
          if (error instanceof DirectoryApiError && error.code === 'rate_limited') {
            setCheck({ available: false, reason: 'rate_limited' });
          } else {
            setCheck(null);
          }
          setChecking(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(pending);
    };
  }, [visibilityOpen, picked, trimmedHandle, ownHandle, directoryApi]);

  const saveVisibility = () => {
    if (visibilityTruth === null) {
      return;
    }
    if (picked === 'public' && trimmedHandle === '') {
      setVisibilityError('Choose a handle for the public group.');
      return;
    }
    if (picked === 'private' && visibilityTruth.visibility === 'public' && !confirmingPrivate) {
      setConfirmingPrivate(true);
      return;
    }
    setVisibilityBusy(true);
    setVisibilityError('');
    setVisibilitySaved(false);
    void directoryApi
      .setGroupVisibility(groupId, {
        visibility: picked,
        ...(picked === 'public' ? { handle: trimmedHandle } : {}),
      })
      .then(() => {
        setVisibilityTruth({
          visibility: picked,
          handle: picked === 'public' ? trimmedHandle : null,
        });
        setVisibilitySaved(true);
        setConfirmingPrivate(false);
        refreshGroupDetail(groupId);
      })
      .catch((error: unknown) => setVisibilityError(visibilitySaveError(error)))
      .finally(() => setVisibilityBusy(false));
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

  const openTopic = (chat: ChatSummary) => {
    dismissTopicNotice();
    router.push({ pathname: '/chat/[id]', params: { id: chat.id } });
  };

  const runSheetAction = (_action: TopicSheetAction) => {
    const chat = sheetFor;
    if (chat === null) {
      return;
    }
    setSheetBusy(true);
    setSheetError('');
    void archiveTopic(chat.id)
      .then(() => {
        setSheetFor(null);
        setSheetMuteOpen(false);
      })
      .catch(() => setSheetError('Could not archive the topic. Try again.'))
      .finally(() => setSheetBusy(false));
  };

  const runSheetPref = (action: TopicPrefAction) => {
    const chat = sheetFor;
    if (chat === null) {
      return;
    }
    setSheetBusy(true);
    setSheetError('');
    const input =
      action.kind === 'mute'
        ? { mutedUntil: mutedUntilFor(action.duration, new Date()) }
        : action.kind === 'unmute'
          ? { mutedUntil: null }
          : action.kind === 'pin'
            ? { pinned: action.pinned }
            : { archived: action.archived };
    void setChatPref(chat.id, input)
      .then(() => {
        setSheetFor(null);
        setSheetMuteOpen(false);
      })
      .catch(() => setSheetError('Could not save. Try again.'))
      .finally(() => setSheetBusy(false));
  };

  const openSheetFor = (chat: ChatSummary) => {
    setSheetError('');
    setSheetMuteOpen(false);
    setSheetFor(chat);
  };

  // Creates the topic, then adds one AI per tick. The sheet stays open
  // until the topic exists: a `createTopic` failure shows its error in the
  // open sheet, and a failed AI add names the AI (the topic still exists, so
  // the user lands in it and can retry from the topic panel).
  const create = (input: NewTopicInput) => {
    setComposerBusy(true);
    setComposerError('');
    setComposerAiError('');
    const aiNames = new Map(myAisInGroup.map((ai) => [ai.aiId, ai.name]));
    void createTopic(groupChatId, {
      name: input.name,
      kind: input.kind,
      visibility: input.visibility,
      ...(input.memberIds === undefined ? {} : { memberIds: input.memberIds }),
    })
      .then(async (chatId) => {
        const failed: string[] = [];
        for (const aiId of input.aiIds) {
          try {
            await addTopicAi(chatId, aiId);
          } catch {
            failed.push(aiNames.get(aiId) ?? 'An AI');
          }
        }
        setComposerOpen(false);
        if (failed.length > 0) {
          setComposerAiError(
            `Topic created, but could not add: ${failed.join(', ')}. Add them from the topic panel.`,
          );
        }
        router.push({ pathname: '/chat/[id]', params: { id: chatId } });
      })
      .catch(() => setComposerError('Could not create the topic. Try again.'))
      .finally(() => setComposerBusy(false));
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
      <View className="flex-row items-center gap-1 border-b border-divider bg-surface px-1 py-1">
        <IconButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={24} color={ICON[scheme]} />
        </IconButton>
        <Avatar id={groupChatId} name={groupTitle} size={36} />
        <View className="ml-2.5 min-w-0 flex-1">
          <Text numberOfLines={1} className="shrink text-[15px] font-semibold text-foreground">
            {groupTitle}
          </Text>
          <Text numberOfLines={1} className="shrink text-[12px] text-muted-foreground">
            {topicsHeaderSubtitle({
              memberCount: general?.memberCount ?? members.length,
              aiCount: groupAis.length,
              topicCount: activeTopics.length,
            })}
          </Text>
        </View>
        {canManageLinks ? (
          <IconButton label="Invite links" onPress={openLinks}>
            <Link2 size={20} color={ICON[scheme]} />
          </IconButton>
        ) : null}
        {canChangeVisibility ? (
          <IconButton label="Visibility" onPress={openVisibility}>
            <Eye size={20} color={ICON[scheme]} />
          </IconButton>
        ) : null}
        <IconButton label="Members and roles" onPress={() => setRolesOpen(true)}>
          <Users size={22} color={ICON[scheme]} />
        </IconButton>
      </View>

      {notice !== undefined ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-muted-foreground">{notice}</Text>
        </View>
      ) : null}
      {composerAiError !== '' ? (
        <View className="border-b border-divider bg-surface px-4 py-2">
          <Text className="text-center text-[13px] text-danger">{composerAiError}</Text>
        </View>
      ) : null}

      <View className="flex-row items-center gap-2 px-4 py-2">
        <View className="h-10 flex-1 flex-row items-center gap-2 rounded-xl px-3" style={well}>
          <Search size={16} color="#8a8a8a" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search topics"
            placeholderTextColor={MUTED_FOREGROUND[scheme]}
            accessibilityLabel="Search topics"
            className="flex-1 text-[15px] text-foreground"
          />
        </View>
      </View>

      <FlatList
        className="flex-1"
        data={visible}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        renderItem={({ item }) => (
          <TopicRow
            chat={item}
            onPress={() => openTopic(item)}
            onLongPress={() => openSheetFor(item)}
          />
        )}
        ListEmptyComponent={
          <View className="items-center px-6 pt-16">
            <Text className="text-[15px] text-muted-foreground">No topics found</Text>
          </View>
        }
        ListFooterComponent={
          listedArchived.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                archivedOpen
                  ? 'Hide archived topics'
                  : `Show archived topics, ${listedArchived.length}`
              }
              onPress={() => setArchivedOpen((value) => !value)}
              className="flex-row items-center justify-center gap-1.5 px-4 py-3 active:bg-surface-raised"
            >
              <Archive size={16} color={ICON[scheme]} />
              <Text className="text-[14px] font-medium text-muted-foreground">
                Archived ({listedArchived.length})
              </Text>
            </Pressable>
          ) : null
        }
      />

      {canCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="New topic"
          onPress={() => {
            setComposerError('');
            setComposerAiError('');
            setComposerOpen(true);
          }}
          className="absolute bottom-6 right-5 h-14 w-14 items-center justify-center rounded-[18px] bg-accent active:opacity-90"
        >
          <Plus size={24} color="#0a0a0a" />
        </Pressable>
      ) : null}

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
        key={composerOpen ? 'open' : 'closed'}
        visible={composerOpen}
        groupTitle={groupTitle}
        members={members}
        myAis={myAisInGroup}
        meUserId={currentUserId}
        busy={composerBusy}
        error={composerError}
        onCreate={create}
        onClose={() => {
          if (!composerBusy) {
            setComposerOpen(false);
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
        onCreate={createLink}
        onRevoke={revokeLink}
        onDismissCreated={() => setCreatedUrl(undefined)}
        onClose={() => {
          if (!linksBusy) {
            setLinksOpen(false);
          }
        }}
      />
      <GroupRolesSheet
        visible={rolesOpen}
        groupTitle={groupTitle}
        members={membersWithRoleChips}
        roles={groupRoles}
        rolesError={rolesLoadError}
        isManager={isManager}
        busy={rolesBusy}
        error={rolesError}
        onRetryRoles={retryRolesLoad}
        onCreateRole={(name) => runRolesWrite(() => createGroupRole(groupId, name))}
        onRenameRole={(roleId, name) => runRolesWrite(() => renameGroupRole(groupId, roleId, name))}
        onDeleteRole={(roleId) => runRolesWrite(() => deleteGroupRole(groupId, roleId))}
        onToggleMember={toggleRoleMember}
        onClose={() => {
          if (!rolesBusy) {
            setRolesOpen(false);
          }
        }}
      />
      <VisibilitySheet
        visible={visibilityOpen}
        groupTitle={groupTitle}
        visibility={visibilityTruth?.visibility ?? 'private'}
        handle={visibilityTruth?.handle ?? null}
        live={{ picked, typed }}
        busy={visibilityBusy}
        checking={checking}
        check={check}
        error={visibilityLoadError !== '' ? visibilityLoadError : visibilityError}
        saved={visibilitySaved}
        confirmingPrivate={confirmingPrivate}
        share={linksShare}
        onPick={(next) => {
          setPicked(next);
          setCheck(null);
          setVisibilityError('');
          setVisibilitySaved(false);
          setConfirmingPrivate(false);
        }}
        onHandleChange={(next) => {
          setTyped(next);
          setCheck(null);
          setVisibilitySaved(false);
        }}
        onSave={saveVisibility}
        onCancelPrivate={() => setConfirmingPrivate(false)}
        onClose={() => {
          if (!visibilityBusy) {
            setVisibilityOpen(false);
          }
        }}
      />
    </SafeAreaView>
  );
}
