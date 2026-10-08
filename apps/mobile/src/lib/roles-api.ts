/**
 * The mobile twin of the web group-roles client (`apps/web/src/lib/api.ts`,
 * T-0116): list, create, rename and delete custom group roles, and replace a
 * role's holder set. The wire contract lives in
 * `apps/server/src/roles/{routes,service}`.
 *
 * The boundary is validated with Effect Schema (T-0527, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge with
 * `Effect.runPromise`. Malformed role rows return null and are dropped by the
 * callers, never rendered.
 */

import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

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

const RoleHolderSchema = struct({
  userId: Schema.String,
  name: Schema.String,
});

// `Array` is made mutable to keep the `RoleHolder[]` type the API has always
// returned.
const CustomGroupRoleSchema = struct({
  id: Schema.String,
  name: Schema.String,
  members: Schema.mutable(Schema.Array(RoleHolderSchema)),
});

const RolesListSchema = struct({
  roles: Schema.mutable(Schema.Array(CustomGroupRoleSchema)),
});

// The server's error envelope. A missing or malformed envelope keeps the fixed
// fallbacks used by `requestEffect`.
const ErrorBodySchema = struct({
  error: struct({
    code: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
});

/** A role row the viewer may see: malformed rows return null and are dropped. */
export function parseCustomGroupRole(value: unknown): CustomGroupRole | null {
  const decoded = Schema.decodeUnknownExit(CustomGroupRoleSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

// The internal failures, one per case. They carry no field beyond what the old
// `RolesApiError` already surfaced; the `Promise` edge maps each back to that
// same error, status, code and message.
class RolesNetworkError extends Data.TaggedError('RolesNetworkError') {}
class RolesRequestError extends Data.TaggedError('RolesRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class RolesUnauthorized extends Data.TaggedError('RolesUnauthorized') {}
class RolesInvalidResponse extends Data.TaggedError('RolesInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, RolesNetworkError | RolesRequestError> {
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
    catch: () => new RolesNetworkError(),
  });

  // DELETE answers 204 with no body: an empty payload parses as null.
  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const decoded = Schema.decodeUnknownExit(ErrorBodySchema)(body);
    const error = Exit.isSuccess(decoded) ? decoded.value.error : undefined;
    return yield* new RolesRequestError({
      status: response.status,
      code: error?.code ?? 'request_failed',
      message: error?.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The production `RolesApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createRolesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string,
): RolesApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    RolesUnauthorized | RolesNetworkError | RolesRequestError | RolesInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new RolesUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new RolesInvalidResponse();
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
          RolesUnauthorized: () =>
            Effect.fail(new RolesApiError(401, 'unauthorized', 'No session')),
          RolesNetworkError: () =>
            Effect.fail(new RolesApiError(0, 'network_error', 'Could not reach the server')),
          RolesRequestError: (error) =>
            Effect.fail(new RolesApiError(error.status, error.code, error.message)),
          RolesInvalidResponse: () =>
            Effect.fail(
              new RolesApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  const parseRoleList = (value: unknown): CustomGroupRole[] | null => {
    const decoded = Schema.decodeUnknownExit(RolesListSchema)(value);
    return Exit.isSuccess(decoded) ? decoded.value.roles : null;
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
