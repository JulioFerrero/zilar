import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Avatar } from '@/components/chat/avatar';
import { RoleChips } from '@/components/chat/role-chips';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { GroupRole } from '@/lib/chat-api';
import { deleteRoleConfirmText } from '@/lib/roles';
import type { CustomGroupRole } from '@/lib/roles-api';

export interface RolesSheetMember {
  userId: string;
  name: string;
  role: GroupRole;
  chips: { id: string; name: string }[];
}

/**
 * The group members + roles sheet (T-0137): every member sees the people
 * with their role chips and the roles with holder counts; owners/admins get
 * the CRUD section (create, rename, delete with a confirm that says what it
 * removes, assign with a member multi-select). Thin view: local input state
 * only, the screen performs the store actions.
 */
export function GroupRolesSheet({
  visible,
  groupTitle,
  members,
  roles,
  rolesError,
  isManager,
  busy,
  error,
  onRetryRoles,
  onCreateRole,
  onRenameRole,
  onDeleteRole,
  onToggleMember,
  onClose,
}: {
  visible: boolean;
  groupTitle: string;
  members: RolesSheetMember[];
  roles: CustomGroupRole[] | undefined;
  rolesError: string;
  isManager: boolean;
  busy: boolean;
  error: string;
  onRetryRoles: () => void;
  onCreateRole: (name: string) => Promise<void>;
  onRenameRole: (roleId: string, name: string) => Promise<void>;
  onDeleteRole: (roleId: string) => Promise<void>;
  onToggleMember: (role: CustomGroupRole, userId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | undefined>(undefined);
  const [assigningId, setAssigningId] = useState<string | undefined>(undefined);

  const create = () => {
    const name = newName.trim();
    if (name === '') {
      return;
    }
    void onCreateRole(name.slice(0, 30)).then(() => setNewName(''));
  };

  const rename = (roleId: string) => {
    const name = renameValue.trim();
    if (name === '') {
      return;
    }
    void onRenameRole(roleId, name.slice(0, 30)).then(() => setRenamingId(undefined));
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel="Close group members and roles"
      title={`${groupTitle} · Members (${members.length})`}
      maxHeightClassName="max-h-[80%]"
    >
      {members.map((member) => (
        <View key={member.userId} className="flex-row items-center gap-2 py-1.5">
          <Avatar id={member.userId} name={member.name} size={28} />
          <Text numberOfLines={1} className="flex-1 text-[15px] text-foreground">
            {member.name}
          </Text>
          <RoleChips roles={member.chips} />
          {member.role !== 'member' ? (
            <View className="rounded-[5px] border border-badge-muted px-1 py-px">
              <Text className="font-mono text-[10px] leading-[15px] text-muted-foreground">
                {member.role}
              </Text>
            </View>
          ) : null}
        </View>
      ))}

      <Text
        accessibilityRole="header"
        className="pt-3 text-[13px] font-semibold text-muted-foreground"
      >
        Roles
      </Text>
      {roles === undefined && rolesError === '' ? (
        <Text className="py-1 text-[14px] text-muted-foreground">Loading…</Text>
      ) : null}
      {rolesError !== '' ? (
        <View className="gap-2 py-1">
          <Text accessibilityRole="alert" className="text-[13px] text-danger">
            {rolesError}
          </Text>
          <Button
            variant="outline"
            accessibilityLabel="Retry loading roles"
            disabled={busy}
            onPress={onRetryRoles}
            className="self-start"
          >
            <Text>Retry</Text>
          </Button>
        </View>
      ) : null}
      {roles !== undefined && roles.length === 0 ? (
        <Text className="py-1 text-[14px] text-muted-foreground">
          No roles yet. Roles grant private-topic access and approver rights.
        </Text>
      ) : null}
      {roles?.map((role) => {
        const renaming = renamingId === role.id;
        const confirming = confirmingId === role.id;
        const assigning = assigningId === role.id;
        return (
          <View key={role.id} className="py-1">
            <View className="flex-row items-center gap-2">
              {renaming ? (
                <TextField
                  value={renameValue}
                  onChangeText={setRenameValue}
                  maxLength={30}
                  accessibilityLabel={`Rename ${role.name}`}
                  className="min-w-0 flex-1 py-1.5 text-[14px]"
                />
              ) : (
                <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] text-foreground">
                  {role.name} ({role.members.length})
                </Text>
              )}
              {isManager ? (
                renaming ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      accessibilityLabel={`Save ${role.name}`}
                      disabled={busy}
                      onPress={() => rename(role.id)}
                    >
                      <Text>Save</Text>
                    </Button>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel rename"
                      disabled={busy}
                      onPress={() => setRenamingId(undefined)}
                      className="rounded-[10px] px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                    >
                      <Text className="text-[14px] text-foreground">Cancel</Text>
                    </Pressable>
                  </>
                ) : confirming ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Confirm deleting ${role.name}`}
                      disabled={busy}
                      onPress={() => {
                        void onDeleteRole(role.id).then(() => setConfirmingId(undefined));
                      }}
                      className="rounded-[10px] bg-danger px-3 py-1.5 active:opacity-80 disabled:opacity-50"
                    >
                      <Text className="text-[14px] font-semibold text-accent-foreground">
                        Delete
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Cancel delete"
                      disabled={busy}
                      onPress={() => setConfirmingId(undefined)}
                      className="rounded-[10px] px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                    >
                      <Text className="text-[14px] text-foreground">Cancel</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      accessibilityLabel={`Assign ${role.name}`}
                      disabled={busy}
                      onPress={() => setAssigningId(assigning ? undefined : role.id)}
                    >
                      <Text>Assign</Text>
                    </Button>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Rename ${role.name}`}
                      disabled={busy}
                      onPress={() => {
                        setRenameValue(role.name);
                        setRenamingId(role.id);
                      }}
                      className="rounded-[10px] px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                    >
                      <Text className="text-[14px] text-foreground">Rename</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${role.name}`}
                      disabled={busy}
                      onPress={() => setConfirmingId(role.id)}
                      className="rounded-[10px] px-3 py-1.5 active:bg-surface-raised disabled:opacity-50"
                    >
                      <Text className="text-[14px] text-danger">Delete</Text>
                    </Pressable>
                  </>
                )
              ) : null}
            </View>
            {confirming && isManager ? (
              <Text className="py-1 text-[13px] text-muted-foreground">
                {deleteRoleConfirmText(role.name)}
              </Text>
            ) : null}
            {assigning && isManager && !renaming && !confirming ? (
              <View className="pl-1">
                {members.map((member) => {
                  const checked = role.members.some((holder) => holder.userId === member.userId);
                  return (
                    <Pressable
                      key={member.userId}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={`${member.name} holds ${role.name}`}
                      disabled={busy}
                      onPress={() => {
                        void onToggleMember(role, member.userId);
                      }}
                      className="flex-row items-center gap-3 rounded-lg px-2 py-1.5 active:bg-surface-raised disabled:opacity-50"
                    >
                      <Checkbox checked={checked} />
                      <Avatar id={member.userId} name={member.name} size={28} />
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-[14px]">
                        {member.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}
      {isManager && roles !== undefined ? (
        <View className="flex-row items-center gap-2 py-2">
          <TextField
            value={newName}
            onChangeText={setNewName}
            maxLength={30}
            accessibilityLabel="New role name"
            placeholder="e.g. Designers"
            className="min-w-0 flex-1 text-[14px]"
          />
          <Button
            accessibilityLabel="Add role"
            disabled={busy || newName.trim() === ''}
            onPress={create}
            className="shrink-0"
          >
            <Text>{busy ? 'Saving…' : 'Add role'}</Text>
          </Button>
        </View>
      ) : null}
      {error !== '' ? (
        <Text accessibilityRole="alert" className="py-1 text-[13px] text-danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
