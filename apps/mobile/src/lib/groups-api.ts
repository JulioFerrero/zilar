import { API_URL } from './auth';
import type { GroupMember, TokenProvider } from './chat-api';

/**
 * The channel management calls (T-0144), the mobile twin of the web channel
 * client (`apps/web/src/lib/api.ts`, "Channels"): create a channel, leave
 * one, read the members slice and flip a member's role. The wire contract
 * lives in `apps/server/src/groups/routes.ts` (T-0124).
 *
 * Mobile has no zod, so — like `chat-api.ts` — the boundary is validated
 * with type guards: a malformed payload throws `invalid_response`. Raw
 * server messages never reach the UI; callers map status/code to their own
 * neutral lines.
 */

export type ChannelMemberRole = 'admin' | 'member';

export interface GroupsApi {
  /** Creates a channel (title + optional description ≤ 300). */
  createChannel(input: { title: string; description?: string }): Promise<{ id: string }>;
  /** Creates a private group (title + member ids, no `kind`). */
  createGroup(input: { title: string; memberIds: string[] }): Promise<{ id: string }>;
  /**
   * Reads the members slice for one group: the full audience for
   * owners/admins, the owner/admins slice for channel subscribers (never the
   * audience), 404 for strangers. Rejects on failure.
   */
  listGroupMembers(groupId: string): Promise<GroupMember[]>;
  /**
   * Promotes a subscriber to admin or demotes one back (owner only,
   * channels only — plain groups answer the same 404 as an unknown id).
   * The last-admin demotion answers 409 `channel_needs_admin`. Rejects on
   * failure.
   */
  changeGroupMemberRole(groupId: string, userId: string, role: ChannelMemberRole): Promise<void>;
  /**
   * Removes one member (owners/admins), or the caller themself to leave.
   * The last-admin removal answers 409 `channel_needs_admin`. Rejects on
   * failure.
   */
  removeGroupMember(groupId: string, userId: string): Promise<void>;
}

export class GroupsApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'GroupsApiError';
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

function isGroupRole(value: unknown): value is 'owner' | 'admin' | 'member' {
  return value === 'owner' || value === 'admin' || value === 'member';
}

function parseGroupMember(value: unknown): GroupMember | null {
  if (!isRecord(value)) return null;
  const userId = value['userId'];
  const name = value['name'];
  const role = value['role'];
  if (!isString(userId) || !isString(name) || !isGroupRole(role)) return null;
  const roles: { id: string; name: string }[] = [];
  const rawRoles = value['roles'];
  if (rawRoles !== undefined) {
    if (!Array.isArray(rawRoles)) return null;
    for (const entry of rawRoles) {
      if (!isRecord(entry)) return null;
      const id = entry['id'];
      const roleName = entry['name'];
      if (!isString(id) || !isString(roleName)) return null;
      roles.push({ id, name: roleName });
    }
  }
  return { userId, name, role, roles };
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
    throw new GroupsApiError(0, 'network_error', 'Could not reach the server');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
    const code = isString(error?.['code']) ? error['code'] : 'request_failed';
    const message = isString(error?.['message'])
      ? error['message']
      : `Request failed (${response.status})`;
    throw new GroupsApiError(response.status, code, message);
  }
  return body;
}

/** The production `GroupsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createGroupsApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): GroupsApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new GroupsApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new GroupsApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

  return {
    async createChannel(input) {
      const body = await withToken(
        '/api/groups',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: input.title,
            kind: 'channel',
            ...(input.description === undefined || input.description.trim() === ''
              ? {}
              : { description: input.description.trim() }),
          }),
        },
        (value) => {
          if (!isRecord(value) || !isString(value['id'])) return null;
          return { id: value['id'] };
        },
      );
      return body as { id: string };
    },
    async createGroup(input) {
      const body = await withToken(
        '/api/groups',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: input.title, memberIds: input.memberIds }),
        },
        (value) => {
          if (!isRecord(value) || !isString(value['id'])) return null;
          return { id: value['id'] };
        },
      );
      return body as { id: string };
    },
    async listGroupMembers(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/members`,
        { method: 'GET' },
        (value) => {
          if (!isRecord(value) || !Array.isArray(value['members'])) return null;
          const members: GroupMember[] = [];
          for (const entry of value['members']) {
            const member = parseGroupMember(entry);
            if (member === null) return null;
            members.push(member);
          }
          return members;
        },
      );
      return body as GroupMember[];
    },
    async changeGroupMemberRole(groupId, userId, role) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}/role`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role }),
        },
        (value) => (isRecord(value) ? value : null),
      );
    },
    async removeGroupMember(groupId, userId) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
        (value) => (isRecord(value) ? value : null),
      );
    },
  };
}
