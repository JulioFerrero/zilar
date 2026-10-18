/**
 * The mobile port over the shared group-roles calls (`@zilar/client-core`,
 * `groups-api.ts`, T-2056): list, create, rename and delete custom group roles,
 * and replace a role's holder set, as a Promise port over the client derived
 * from the shared contract (`@zilar/api-contract`, `roles.ts`, T-0892).
 */

import { ApiError, runApi, type GroupRole as CustomGroupRole } from '@zilar/api-contract';
import { makeGroupsApi } from '@zilar/client-core';

import { createApiClient } from './effect/api-client';

export type { RoleMember as RoleHolder } from '@zilar/api-contract';
/** A custom group role: a label with holders, granting private-topic access
 *  and approver rights in the topics it is attached to (T-0116). */
export type { GroupRole as CustomGroupRole } from '@zilar/api-contract';

export interface RolesApi {
  listGroupRoles(groupId: string): Promise<CustomGroupRole[]>;
  createGroupRole(groupId: string, name: string): Promise<CustomGroupRole>;
  renameGroupRole(groupId: string, roleId: string, name: string): Promise<CustomGroupRole>;
  deleteGroupRole(groupId: string, roleId: string): Promise<void>;
  setGroupRoleMembers(groupId: string, roleId: string, userIds: string[]): Promise<CustomGroupRole>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const RolesApiError = ApiError;
export type RolesApiError = ApiError;

/** The production `RolesApi`: bearer auth, `fetch`, and the build-time API URL. */
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
