import type { GroupRole } from '@zilar/api-contract';
import { makeGroupsApi } from '@zilar/client-core';

import type { ApiCall } from './effect/api-client';

/** Grants private-topic access and approver rights in the topics it is attached to. */

export interface RolesApi {
  listGroupRoles(groupId: string): Promise<GroupRole[]>;
  createGroupRole(groupId: string, name: string): Promise<GroupRole>;
  renameGroupRole(groupId: string, roleId: string, name: string): Promise<GroupRole>;
  deleteGroupRole(groupId: string, roleId: string): Promise<void>;
  setGroupRoleMembers(groupId: string, roleId: string, userIds: string[]): Promise<GroupRole>;
}

export function makeRolesApi(call: ApiCall): RolesApi {
  const api = makeGroupsApi(call);
  return {
    listGroupRoles: api.listGroupRoles,
    createGroupRole: api.createGroupRole,
    renameGroupRole: api.renameGroupRole,
    deleteGroupRole: api.deleteGroupRole,
    setGroupRoleMembers: api.setGroupRoleMembers,
  };
}
