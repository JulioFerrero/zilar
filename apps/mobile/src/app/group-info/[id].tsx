import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Trash2 } from 'lucide-react-native';
import { type ComponentProps, useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { RequireAuth } from '@/auth/RequireAuth';
import { useGroupManage } from '@/components/chat/group-manage-section';
import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { InviteLinksSheet, type CreateInviteLinkForm } from '@/components/chat/invite-links-sheet';
import { NewTopicSheet } from '@/components/chat/new-topic-sheet';
import { useGroupNewTopic } from '@/components/chat/use-group-new-topic';
import { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { VisibilitySheet } from '@/components/chat/visibility-sheet';
import { useGroupRules } from '@/components/group-info/allowed-page';
import {
  GroupContentSheets,
  GroupInfoPages,
  type GroupInfoPage,
  useGroupContent,
} from '@/components/group-info/group-info-pages';
import { MembersPage } from '@/components/group-info/members-page';
import { GroupInfoRoot } from '@/components/group-info/root-page';
import { SettingsPage } from '@/components/group-info/settings-page';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { goBackOrHome } from '@/lib/navigation';
import { mayCreateTopic, topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';
import { Effect } from 'effect';
import { groupAction, rawCall } from '@/components/chat/group-action';
import type { GroupMember } from '@/lib/chat-api';
import { useQuery } from '@/lib/effect/use-query';
import type { CustomGroupRole } from '@/lib/roles-api';
import { describeRolesError, mayManageRoles, membersWithChips } from '@/lib/roles';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import type { GroupInviteLink } from '@/lib/invite-links-api';

// The group screen's roles sheet state and writes: the query, the busy/error flags and the CRUD handlers the sheet calls.
function useGroupRoles(groupId: string, members: readonly GroupMember[]) {
  const groupRoles = useChatStore((state) => state.groupRoles(groupId));
  const refreshGroupRoles = useChatStore((state) => state.refreshGroupRoles);
  const createGroupRole = useChatStore((state) => state.createGroupRole);
  const renameGroupRole = useChatStore((state) => state.renameGroupRole);
  const deleteGroupRole = useChatStore((state) => state.deleteGroupRole);
  const setGroupRoleMembers = useChatStore((state) => state.setGroupRoleMembers);
  const currentUserId = useChatStore((state) => state.currentUserId);

  const [rolesOpen, setRolesOpen] = useState(false);
  const [rolesBusy, setRolesBusy] = useState(false);
  const [rolesError, setRolesError] = useState('');
  const [rolesLoadError, setRolesLoadError] = useState('');

  // The roles query also feeds the members/roles sheet; its first load maps through the same error helper as every retry (404 means the group is gone).
  const [, reloadRoles] = useQuery(
    () =>
      groupId === ''
        ? Effect.void
        : groupAction(
            rawCall(() => refreshGroupRoles(groupId)),
            (cause) => setRolesLoadError(describeRolesError(cause, 'load')),
          ),
    [groupId, refreshGroupRoles],
  );

  // Roles writes take the group id directly, so an empty group with no loaded topic rows still works. The store replaces its cache on success; the sheet awaits the returned promise, which settles on success and failure.
  const runRolesWrite = (work: () => Promise<unknown>): Promise<void> => {
    setRolesBusy(true);
    setRolesError('');
    return Effect.runPromise(
      groupAction(
        rawCall(work),
        (cause) => setRolesError(describeRolesError(cause, 'write')),
        () => setRolesBusy(false),
      ),
    );
  };

  const retryRolesLoad = () => {
    setRolesLoadError('');
    reloadRoles();
  };

  const toggleRoleMember = (role: CustomGroupRole, userId: string): Promise<void> => {
    const held = role.members.some((holder) => holder.userId === userId);
    const userIds = held
      ? role.members.filter((holder) => holder.userId !== userId).map((holder) => holder.userId)
      : [...role.members.map((holder) => holder.userId), userId];
    return runRolesWrite(() => setGroupRoleMembers(groupId, role.id, userIds));
  };

  const isManager = mayManageRoles(members.find((member) => member.userId === currentUserId)?.role);
  const membersWithRoleChips = membersWithChips(members, groupRoles);

  return {
    visible: rolesOpen,
    open: () => setRolesOpen(true),
    close: () => {
      if (!rolesBusy) {
        setRolesOpen(false);
      }
    },
    members: membersWithRoleChips,
    roles: groupRoles,
    isManager,
    busy: rolesBusy,
    error: rolesError,
    loadError: rolesLoadError,
    retry: retryRolesLoad,
    createRole: (name: string) => runRolesWrite(() => createGroupRole(groupId, name)),
    renameRole: (roleId: string, name: string) =>
      runRolesWrite(() => renameGroupRole(groupId, roleId, name)),
    deleteRole: (roleId: string) => runRolesWrite(() => deleteGroupRole(groupId, roleId)),
    toggleMember: toggleRoleMember,
  };
}

export default function GroupInfoScreen() {
  return (
    <RequireAuth>
      <GroupInfo />
    </RequireAuth>
  );
}

function GroupInfo() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = typeof params.id === 'string' ? params.id : '';

  const chats = useChatStore((state) => state.chats);
  const groupDetail = useChatStore((state) => state.groupDetail(groupId));
  const ensureGroupDetail = useChatStore((state) => state.ensureGroupDetail);
  const currentUserId = useChatStore((state) => state.currentUserId);
  const contacts = useChatStore((state) => state.contacts);
  const ownedAis = useChatStore((state) => state.ownedAis);
  const joinTopic = useChatStore((state) => state.joinTopic);

  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [page, setPage] = useState<GroupInfoPage>('root');
  const [pickerOnMount, setPickerOnMount] = useState(false);

  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? groupDetail?.title ?? 'Group';
  // Mute and Search act on the group's own chat row, the General topic; without it the keys stay disabled (the raw group id is no fallback).
  const groupChatId = general?.id ?? topics[0]?.id;
  const chatReady = groupChatId !== undefined;

  const members = useMemo(() => groupDetail?.members ?? [], [groupDetail]);
  const groupAis = useMemo(() => groupDetail?.ais ?? [], [groupDetail]);
  const myRole = members.find((member) => member.userId === currentUserId)?.role;
  const isOwner = myRole === 'owner';
  const isManager = isOwner || myRole === 'admin';

  const manage = useGroupManage({ groupId, groupChatId: groupChatId ?? groupId, isOwner });
  const roles = useGroupRoles(groupId, members);
  // The group screen's invite-links sheet state and writes, owner/admin only like web. The list loads when the sheet opens; the created URL is kept only until dismissed, never stored.
  const listInviteLinks = useChatStore((state) => state.listInviteLinks);
  const createInviteLink = useChatStore((state) => state.createInviteLink);
  const revokeInviteLink = useChatStore((state) => state.revokeInviteLink);
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksNow, setLinksNow] = useState(() => Date.now());
  const [links, setLinks] = useState<GroupInviteLink[]>([]);
  const [linksError, setLinksError] = useState('');
  const [createdUrl, setCreatedUrl] = useState<string | undefined>(undefined);
  const [revokingId, setRevokingId] = useState<string | undefined>(undefined);
  const fetchLinks = (linksGroupId: string) =>
    Effect.sync(() => {
      setLinksError('');
    }).pipe(
      Effect.andThen(
        groupAction(
          rawCall(() => listInviteLinks(linksGroupId)).pipe(
            Effect.tap((list) =>
              Effect.sync(() => {
                setLinks(list);
              }),
            ),
          ),
          () => setLinksError('Could not load invite links. Try again.'),
        ),
      ),
    );
  const [, loadLinks] = useAction((linksGroupId: string) => fetchLinks(linksGroupId));
  const openLinksSheet = () => {
    setLinksError('');
    setCreatedUrl(undefined);
    setRevokingId(undefined);
    // Fresh clock on every open: the sheet stays mounted while hidden, so a mount-time stamp would go stale.
    setLinksNow(Date.now());
    setLinksOpen(true);
    loadLinks(groupId);
  };
  const [linkCreate, runLinkCreate] = useAction((input: CreateInviteLinkForm) =>
    groupAction(
      rawCall(() => createInviteLink(groupId, input)).pipe(
        Effect.tap((created) =>
          Effect.sync(() => {
            setCreatedUrl(created.url);
          }),
        ),
        Effect.andThen(fetchLinks(groupId)),
      ),
      () => setLinksError('Could not create the invite link. Try again.'),
    ),
  );
  const linksBusy = isWaiting(linkCreate);
  const [, runLinkRevoke] = useAction((linkId: string) =>
    groupAction(
      rawCall(() => revokeInviteLink(groupId, linkId)).pipe(Effect.andThen(fetchLinks(groupId))),
      () => setLinksError('Could not revoke the invite link. Try again.'),
      () => setRevokingId(undefined),
    ),
  );
  const createLink = (input: CreateInviteLinkForm) => {
    setLinksError('');
    runLinkCreate(input);
  };
  const revokeLink = (linkId: string) => {
    setRevokingId(linkId);
    setLinksError('');
    runLinkRevoke(linkId);
  };
  // The clipboard/share bridge: `expo-clipboard` and `Share` cannot run in Node tests, so the sheet takes callbacks and the screen wires the real modules.
  const share = useMemo(
    () => ({
      copyText: (text: string) =>
        Effect.runPromise(Effect.promise(() => Clipboard.setStringAsync(text)).pipe(Effect.asVoid)),
      shareText: (text: string) =>
        Effect.runPromise(
          Effect.tryPromise({
            try: () => Share.share({ message: text }),
            catch: (cause) => cause,
          }).pipe(Effect.asVoid),
        ),
    }),
    [],
  );
  const closeLinks = () => {
    if (!linksBusy) {
      setLinksOpen(false);
    }
  };
  const dismissCreated = () => setCreatedUrl(undefined);
  const visibility = useGroupVisibility(groupId);
  const myAisInGroup = useMemo(
    () => groupAis.filter((ai) => ownedAis.some((owned) => owned.id === ai.aiId)),
    [groupAis, ownedAis],
  );
  const canCreate = mayCreateTopic({
    members,
    meUserId: currentUserId,
    membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
  });
  const newTopic = useGroupNewTopic({ groupChatId: groupChatId ?? '', myAis: myAisInGroup });
  const content = useGroupContent(groupChatId);
  const groupRules = useGroupRules(groupId, isManager);

  const closeDelete = () => {
    if (!manage.busy) {
      setDeleteOpen(false);
      setDeleteName('');
    }
  };

  // The sheets open only behind their own role gate, so a hidden key can never open a manager- or owner-only sheet; the server is the enforcer.
  const openLinks = () => {
    if (isManager) {
      openLinksSheet();
    }
  };

  const openSettings = () => {
    if (isManager) {
      setPage('settings');
    }
  };

  const openVisibility = () => {
    if (isOwner) {
      visibility.open();
    }
  };

  const openMembers = () => {
    setPickerOnMount(false);
    setPage('members');
  };

  const openRoles = () => {
    if (isManager) {
      roles.open();
    }
  };

  const openMembersWithPicker = () => {
    if (isManager) {
      setPickerOnMount(true);
      setPage('members');
    }
  };

  const openActivity = () => {
    if (isManager) {
      setPage('activity');
    }
  };

  const openAllowed = () => {
    if (isManager) {
      setPage('allowed');
    }
  };

  const closePage = () => {
    setPickerOnMount(false);
    setPage('root');
  };

  const rootProps: ComponentProps<typeof GroupInfoRoot> = {
    groupChatId: groupChatId ?? groupId,
    chatReady,
    title: groupTitle,
    memberCount: groupDetail === undefined ? undefined : members.length + groupAis.length,
    pinsCount: content.pinsCount,
    allowedCount: groupRules.status === 'ready' ? groupRules.rules.length : undefined,
    topics,
    currentUserId,
    groupMembers: members,
    groupAis,
    isManager,
    isOwner,
    onBack: () => goBackOrHome(router),
    onSearch: () => {
      if (groupChatId !== undefined) {
        router.push({ pathname: '/', params: { searchChat: groupChatId } });
      }
    },
    onAdd: openMembersWithPicker,
    onMore: () => setMoreOpen(true),
    onOpenMembers: openMembers,
    onOpenSettings: openSettings,
    onLeave: () => setLeaveOpen(true),
    onOpenMedia: content.openMedia,
    onOpenPins: content.openPins,
    onOpenTools: () => setPage('tools'),
    onOpenActivity: openActivity,
    onOpenAllowed: openAllowed,
    onOpenTopic: (chatId) => router.push({ pathname: '/chat/[id]', params: { id: chatId } }),
    onNewTopic: () => {
      if (canCreate && groupChatId !== undefined) {
        newTopic.open();
      }
    },
    onJoinTopic: (chatId) => joinTopic(chatId),
  };

  const membersProps: ComponentProps<typeof MembersPage> = {
    groupId,
    members,
    ais: groupAis,
    roles: roles.roles,
    me: currentUserId,
    isManager,
    isOwner,
    contacts,
    openPickerOnMount: pickerOnMount,
    onOpenLinks: openLinks,
    onOpenRoles: openRoles,
    onBack: closePage,
  };

  const settingsProps: ComponentProps<typeof SettingsPage> = {
    groupId,
    title: groupTitle,
    avatarUrl: groupDetail?.avatarUrl,
    membersCanCreateTopics: groupDetail?.membersCanCreateTopics === true,
    listener: groupDetail?.listener,
    isManager,
    isOwner,
    onBack: closePage,
    onOpenVisibility: openVisibility,
  };

  return (
    <>
      <GroupInfoPages
        page={page}
        onBack={closePage}
        groupId={groupId}
        rules={groupRules}
        root={rootProps}
        members={membersProps}
        settings={settingsProps}
      />

      <ActionSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onDismissed={() => {
          if (pendingDelete) {
            setPendingDelete(false);
            setDeleteOpen(true);
          }
        }}
        closeLabel="Close more actions"
      >
        <ActionSheetItem
          label="Delete group"
          icon={Trash2}
          destructive
          onPress={() => {
            setPendingDelete(true);
            setMoreOpen(false);
          }}
        />
      </ActionSheet>

      <ConfirmDialog
        visible={leaveOpen}
        title={`Leave ${groupTitle}?`}
        message="You can rejoin only with an invite."
        confirmLabel="Leave"
        busyLabel="Leaving…"
        busy={manage.busy}
        error={manage.error}
        onCancel={() => setLeaveOpen(false)}
        onConfirm={manage.onLeave}
      />

      <BottomSheet
        visible={deleteOpen}
        onClose={closeDelete}
        closeLabel="Close delete group"
        title="Delete group"
        footer={
          <Button
            variant="destructive"
            accessibilityLabel="Delete group"
            disabled={manage.busy || deleteName.trim() !== groupTitle}
            onPress={manage.onDelete}
          >
            <Text>{manage.busy ? 'Deleting…' : 'Delete group'}</Text>
          </Button>
        }
      >
        <Text className="text-[13px] leading-5 text-muted-foreground">
          Delete {groupTitle} for everyone? All topics and messages go away. This can&apos;t be
          undone.
        </Text>
        <View className="mt-3">
          <TextField
            value={deleteName}
            onChangeText={setDeleteName}
            placeholder={groupTitle}
            accessibilityLabel="Type the group name to confirm"
          />
        </View>
        {manage.error !== '' ? (
          <Text accessibilityRole="alert" className="pt-2 text-[13px] text-danger">
            {manage.error}
          </Text>
        ) : null}
      </BottomSheet>

      <InviteLinksSheet
        visible={linksOpen}
        links={links}
        busy={linksBusy}
        error={linksError}
        createdUrl={createdUrl}
        revokingId={revokingId}
        now={linksNow}
        share={share}
        onCreate={createLink}
        onRevoke={revokeLink}
        onDismissCreated={dismissCreated}
        onClose={closeLinks}
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
        onClose={() => {
          if (!manage.busy) {
            roles.close();
          }
        }}
        manage={manage}
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
        share={share}
        onPick={visibility.pick}
        onHandleChange={visibility.changeHandle}
        onSave={visibility.save}
        onCancelPrivate={visibility.cancelPrivate}
        onClose={visibility.close}
      />

      <GroupContentSheets content={content} />

      {/* T-1787: the New topic row's sheet, created on the group's own row. */}
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
    </>
  );
}
