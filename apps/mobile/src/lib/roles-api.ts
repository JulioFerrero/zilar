import { ApiError, runApi, type GroupRole as CustomGroupRole } from '@zilar/api-contract';
import { makeGroupsApi } from '@zilar/client-core';

import { createApiClient } from './effect/api-client';

export type { RoleMember as RoleHolder } from '@zilar/api-contract';
/** Grants private-topic access and approver rights in the topics it is attached to. */
export type { GroupRole as CustomGroupRole } from '@zilar/api-contract';

export interface RolesApi {
  listGroupRoles(groupId: string): Promise<CustomGroupRole[]>;
  createGroupRole(groupId: string, name: string): Promise<CustomGroupRole>;
  renameGroupRole(groupId: string, roleId: string, name: string): Promise<CustomGroupRole>;
  deleteGroupRole(groupId: string, roleId: string): Promise<void>;
  setGroupRoleMembers(groupId: string, roleId: string, userIds: string[]): Promise<CustomGroupRole>;
}

export const RolesApiError = ApiError;
export type RolesApiError = ApiError;

export function createRolesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): RolesApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const api = makeGroupsApi((call) => runApi(call(client)));
  return {
    listGroupRoles: api.listGroupRoles,
    createGroupRole: api.createGroupRole,
    renameGroupRole: api.renameGroupRole,
    deleteGroupRole: api.deleteGroupRole,
    setGroupRoleMembers: api.setGroupRoleMembers,
  };
}
