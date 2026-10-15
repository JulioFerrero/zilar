import { useLocalSearchParams, useRouter } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { RequireAuth } from '@/auth/RequireAuth';
import { useGroupManage } from '@/components/chat/group-manage-section';
import { GroupRolesSheet } from '@/components/chat/group-roles-sheet';
import { InviteLinksSheet } from '@/components/chat/invite-links-sheet';
import { useGroupInviteLinks } from '@/components/chat/use-group-invite-links';
import { useGroupRoles } from '@/components/chat/use-group-roles';
import { useGroupVisibility } from '@/components/chat/use-group-visibility';
import { VisibilitySheet } from '@/components/chat/visibility-sheet';
import { GroupInfoRoot } from '@/components/group-info/root-page';
import { ActionSheet, ActionSheetItem } from '@/components/ui/action-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { goBackOrHome } from '@/lib/navigation';
import { topicsOfGroup } from '@/lib/topics';
import { useChatStore } from '@/store/chat-store-provider';

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

  const [moreOpen, setMoreOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (groupId !== '') {
      ensureGroupDetail(groupId);
    }
  }, [groupId, ensureGroupDetail]);

  const topics = useMemo(() => topicsOfGroup(chats, groupId), [chats, groupId]);
  const general = topics.find((topic) => topic.topic?.isGeneral === true);
  const groupTitle = general?.groupTitle ?? general?.title ?? groupDetail?.title ?? 'Group';
  // Mute and Search act on the group's own chat row, the General topic (T-1552).
  const groupChatId = general?.id ?? topics[0]?.id ?? groupId;

  const members = useMemo(() => groupDetail?.members ?? [], [groupDetail]);
  const groupAis = useMemo(() => groupDetail?.ais ?? [], [groupDetail]);
  const myRole = members.find((member) => member.userId === currentUserId)?.role;
  const isOwner = myRole === 'owner';
  const isManager = isOwner || myRole === 'admin';

  const manage = useGroupManage({ groupId, groupChatId, isOwner });
  const roles = useGroupRoles(groupId, members);
  const links = useGroupInviteLinks(groupId);
  const visibility = useGroupVisibility(groupId);

  const closeDelete = () => {
    if (!manage.busy) {
      setDeleteOpen(false);
      setDeleteName('');
    }
  };

  // T-1552: the sheets open only behind their own role gate, so a hidden key or
  // row can never open a manager- or owner-only sheet (a stale local role is
  // still bounded by the server, which is the enforcer).
  const openLinks = () => {
    if (isManager) {
      links.open();
    }
  };

  const openSettings = () => {
    if (isOwner) {
      visibility.open();
    }
  };

  return (
    <>
      <GroupInfoRoot
        groupChatId={groupChatId}
        title={groupTitle}
        memberCount={groupDetail === undefined ? undefined : members.length + groupAis.length}
        peopleCount={groupDetail === undefined ? undefined : members.length}
        isManager={isManager}
        isOwner={isOwner}
        onBack={() => goBackOrHome(router)}
        onSearch={() => router.push({ pathname: '/', params: { searchChat: groupChatId } })}
        onAdd={openLinks}
        onMore={() => setMoreOpen(true)}
        onOpenMembers={roles.open}
        onOpenLinks={openLinks}
        onOpenSettings={openSettings}
        onLeave={() => setLeaveOpen(true)}
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
        message="You will stop receiving messages from this group. You can be added back later."
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
