import { Effect } from 'effect';
import { useState } from 'react';

import { groupAction, rawCall } from '@/components/chat/group-action';
import type { GroupMember } from '@/lib/chat-api';
import { useQuery } from '@/lib/effect/use-query';
import type { CustomGroupRole } from '@/lib/roles-api';
import { describeRolesError, mayManageRoles, membersWithChips } from '@/lib/roles';
import { useChatStore } from '@/store/chat-store-provider';

/**
 * The group screen's roles sheet state and writes (T-0137). The route keeps the
 * sheet and the header button; this owns the query, the busy/error flags and
 * the CRUD handlers the sheet calls.
 */
export function useGroupRoles(groupId: string, members: readonly GroupMember[]) {
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

  // The roles ride a query for the members/roles sheet; its first load maps
  // through the same error helper as every retry (404 means the group is gone).
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

  // Roles writes (T-0137) take the route's group id directly, so an empty
  // group with no loaded topic rows still works. The store replaces its
  // cache on success, so the sheet re-renders with server truth. The sheet
  // awaits the returned promise, which settles on success and on failure.
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
