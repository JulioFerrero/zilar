/**
 * The mobile twin of the web group-roles client (`apps/web/src/lib/api.ts`,
 * T-0116): list, create, rename and delete custom group roles, and replace a
 * role's holder set, as a Promise port over the client derived from the shared
 * contract (`@zilar/api-contract`, `roles.ts`, T-0892). Malformed role rows
 * return null from `parseCustomGroupRole` and are dropped by the callers,
 * never rendered.
 */

import { Exit, Schema } from 'effect';
import { ApiError, GroupRole as GroupRoleSchema, runApi } from '@zilar/api-contract';

import { createApiClient } from './effect/api-client';

export interface RoleHolder {
  userId: string;
  name: string;
}

/** A custom group role: a label with holders, granting private-topic access
 *  and approver rights in the topics it is attached to (T-0116). */
export interface CustomGroupRole {
  id: string;
  name: string;
  members: RoleHolder[];
}

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

/** A role row the viewer may see: malformed rows return null and are dropped. */
export function parseCustomGroupRole(value: unknown): CustomGroupRole | null {
  const decoded = Schema.decodeUnknownExit(GroupRoleSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/** The production `RolesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createRolesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): RolesApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  return {
    listGroupRoles: (groupId) =>
      runApi(client.roles.list({ params: { id: groupId } })).then(({ roles }) => [...roles]),
    // The server trims `name`; the contract encodes the trimmed form.
    createGroupRole: (groupId, name) =>
      runApi(client.roles.create({ params: { id: groupId }, payload: { name: name.trim() } })),
    renameGroupRole: (groupId, roleId, name) =>
      runApi(
        client.roles.rename({ params: { id: groupId, roleId }, payload: { name: name.trim() } }),
      ),
    deleteGroupRole: async (groupId, roleId) => {
      await runApi(client.roles.remove({ params: { id: groupId, roleId } }));
    },
    setGroupRoleMembers: (groupId, roleId, userIds) =>
      runApi(client.roles.setMembers({ params: { id: groupId, roleId }, payload: { userIds } })),
  };
}
