/**
 * The mobile twin of the web group-roles client (`apps/web/src/lib/api.ts`,
 * T-0116): list, create, rename and delete custom group roles, and replace a
 * role's holder set. The wire contract lives in
 * `apps/server/src/roles/{routes,service}`.
 *
 * Mobile has no zod, so — like `topics-api.ts` — the boundary is validated
 * with type guards. Malformed role rows return null and are dropped by the
 * callers, never rendered.
 */

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

export class RolesApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RolesApiError';
    this.status = status;
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function parseRoleHolder(value: unknown): RoleHolder | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  if (!isString(userId) || !isString(name)) return null;
  return { userId, name };
}

/** A role row the viewer may see: malformed rows return null and are dropped. */
export function parseCustomGroupRole(value: unknown): CustomGroupRole | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const name = value['name'];
  const members = value['members'];
  if (!isString(id) || !isString(name) || !Array.isArray(members)) return null;
  const parsed: RoleHolder[] = [];
  for (const entry of members) {
    const holder = parseRoleHolder(entry);
    if (holder === null) return null;
    parsed.push(holder);
  }
  return { id, name, members: parsed };
}

async function request(
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
  } catch {
    throw new RolesApiError(0, 'network_error', 'Could not reach the server');
  }

  // DELETE answers 204 with no body: an empty payload parses as null.
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new RolesApiError(response.status, code, message);
  }
  return body;
}

/** The production `RolesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createRolesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): RolesApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new RolesApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new RolesApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  const parseRoleList = (value: unknown): CustomGroupRole[] | null => {
    if (!isRecord(value) || !Array.isArray(value['roles'])) return null;
    const roles: CustomGroupRole[] = [];
    for (const entry of value['roles']) {
      const role = parseCustomGroupRole(entry);
      if (role === null) return null;
      roles.push(role);
    }
    return roles;
  };

  const json = (input: { name: string } | { userIds: string[] }): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  return {
    async listGroupRoles(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/roles`,
        { method: 'GET' },
        parseRoleList,
      );
      return body as CustomGroupRole[];
    },
    async createGroupRole(groupId, name) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/roles`,
        json({ name }),
        parseCustomGroupRole,
      );
      return body as CustomGroupRole;
    },
    async renameGroupRole(groupId, roleId, name) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`,
        { ...json({ name }), method: 'PATCH' },
        parseCustomGroupRole,
      );
      return body as CustomGroupRole;
    },
    async deleteGroupRole(groupId, roleId) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}`,
        { method: 'DELETE' },
        // The server answers 204 with no body, so null is the only valid shape.
        (value) => (value === null ? true : null),
      );
    },
    async setGroupRoleMembers(groupId, roleId, userIds) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/roles/${encodeURIComponent(roleId)}/members`,
        { ...json({ userIds }), method: 'PUT' },
        parseCustomGroupRole,
      );
      return body as CustomGroupRole;
    },
  };
}
