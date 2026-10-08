import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';
import type { GroupMember, TokenProvider } from './chat-api';

/**
 * The channel management calls (T-0144), the mobile twin of the web channel
 * client (`apps/web/src/lib/api.ts`, "Channels"): create a channel, leave
 * one, read the members slice and flip a member's role. The wire contract
 * lives in `apps/server/src/groups/routes.ts` (T-0124).
 *
 * The boundary is validated with Effect Schema (T-0532, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. A malformed payload throws `invalid_response`. Raw
 * server messages never reach the UI; callers map status/code to their own
 * neutral lines.
 */

export type ChannelMemberRole = 'admin' | 'member';

export interface GroupsApi {
  /** Creates a channel (title + optional description ≤ 300, optional public visibility). */
  createChannel(input: {
    title: string;
    description?: string;
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
  /** Creates a group (title + member ids, no `kind`; optional public visibility). */
  createGroup(input: {
    title: string;
    memberIds: string[];
    visibility?: 'public';
    handle?: string;
  }): Promise<{ id: string }>;
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

const NamedRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
});

const GroupMemberSchema = struct({
  userId: Schema.String,
  name: Schema.String,
  role: Schema.Literals(['owner', 'admin', 'member']),
  roles: Schema.optional(Schema.mutable(Schema.Array(NamedRoleSchema))),
});

// The slice rejects as a whole when any member is malformed, so a half-rendered
// audience never reaches the UI.
const GroupMembersEnvelopeSchema = struct({
  members: Schema.mutable(Schema.Array(GroupMemberSchema)),
});

const IdAckSchema = struct({ id: Schema.String });

function parseGroupMembers(value: unknown): GroupMember[] | null {
  const decoded = Schema.decodeUnknownExit(GroupMembersEnvelopeSchema)(value);
  if (!Exit.isSuccess(decoded)) {
    return null;
  }
  return decoded.value.members.map((member) => ({
    userId: member.userId,
    name: member.name,
    role: member.role,
    roles: member.roles ?? [],
  }));
}

function parseIdAck(value: unknown): { id: string } | null {
  const decoded = Schema.decodeUnknownExit(IdAckSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The role and remove calls only require a JSON object; any record answers.
function parseRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `GroupsApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class GroupsNetworkError extends Data.TaggedError('GroupsNetworkError') {}
class GroupsRequestError extends Data.TaggedError('GroupsRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class GroupsUnauthorized extends Data.TaggedError('GroupsUnauthorized') {}
class GroupsInvalidResponse extends Data.TaggedError('GroupsInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, GroupsNetworkError | GroupsRequestError> {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetchImpl(`${apiUrl}${path}`, {
        ...init,
        signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      }),
    catch: () => new GroupsNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new GroupsRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `GroupsApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createGroupsApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): GroupsApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    GroupsUnauthorized | GroupsNetworkError | GroupsRequestError | GroupsInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new GroupsUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new GroupsInvalidResponse();
    }
    return parsed;
  });

  const withToken = (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> =>
    Effect.runPromise(
      withTokenEffect(path, init, parse).pipe(
        Effect.catchTags({
          GroupsUnauthorized: () =>
            Effect.fail(new GroupsApiError(401, 'unauthorized', 'No session')),
          GroupsNetworkError: () =>
            Effect.fail(new GroupsApiError(0, 'network_error', 'Could not reach the server')),
          GroupsRequestError: (error) =>
            Effect.fail(new GroupsApiError(error.status, error.code, error.message)),
          GroupsInvalidResponse: () =>
            Effect.fail(
              new GroupsApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

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
            // T-0228: visibility and handle go over the wire only on public
            // creates (private requests stay exactly as before).
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public', handle: input.handle }
              : {}),
          }),
        },
        parseIdAck,
      );
      return body as { id: string };
    },
    async createGroup(input) {
      const body = await withToken(
        '/api/groups',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: input.title,
            memberIds: input.memberIds,
            // T-0228: public creates carry the handle in the same step.
            ...(input.visibility === 'public' && input.handle !== undefined
              ? { visibility: 'public', handle: input.handle }
              : {}),
          }),
        },
        parseIdAck,
      );
      return body as { id: string };
    },
    async listGroupMembers(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/members`,
        { method: 'GET' },
        parseGroupMembers,
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
        parseRecord,
      );
    },
    async removeGroupMember(groupId, userId) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
        { method: 'DELETE' },
        parseRecord,
      );
    },
  };
}
