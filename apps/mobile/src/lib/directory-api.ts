import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';
import { ApiError, HANDLE_CHECK_MAX, HANDLE_CHECK_MIN, runApi } from '@zilar/api-contract';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * The public directory API (directory search, lookup by handle, public
 * join, the visibility PATCH on one group and the handle check), the mobile
 * `apps/web/src/lib/api.ts` (T-0164). The wire contract lives in
 * `apps/server/src/directory/api.ts` (public groups and channels only,
 * never users or private groups; 20 per page with a cursor; reads are rate
 * limited 30 per 10 minutes) and the visibility route in
 * `apps/server/src/groups/`.
 *
 * The boundary is validated with Effect Schema (T-0541, the T-0506 recipe):
 * the request is an Effect pipeline, cut back to a `Promise` at the edge
 * with `Effect.runPromise`. `DirectoryApiError` keeps the server's `code`
 * and `status`, so screens can branch on the error without parsing the
 * message again (404 = unknown or private, 409 = full / handle taken,
 * 429 = rate limited).
 */

export type DirectoryKind = 'group' | 'channel';

export interface DirectoryEntry {
  id: string;
  kind: DirectoryKind;
  title: string;
  handle: string;
  description: string | null;
  memberCount: number;
  joined: boolean;
  avatarUrl?: string | undefined;
}

export interface DirectoryPage {
  entries: DirectoryEntry[];
  next: string | null;
}

export interface SearchDirectoryInput {
  q?: string;
  kind?: DirectoryKind;
  cursor?: string;
}

export interface PublicJoinResult {
  groupId: string;
  alreadyMember: boolean;
}

export type GroupVisibility = 'private' | 'public';

export interface GroupVisibilityState {
  visibility: GroupVisibility;
  handle: string | null;
}

export interface SetGroupVisibilityInput {
  visibility: GroupVisibility;
  handle?: string;
}

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

export interface HandleCheck {
  available: boolean;
  reason?: HandleCheckReason | undefined;
}

export interface DirectoryApi {
  searchDirectory(input?: SearchDirectoryInput): Promise<DirectoryPage>;
  lookupGroupByHandle(handle: string): Promise<DirectoryEntry>;
  joinPublicGroup(groupId: string): Promise<PublicJoinResult>;
  /**
   * Reads the visibility slice of one group (`GET /api/groups/:id`, owner
   * truth). The mobile `GroupDetail` parser drops `visibility`/`handle`, so
   * the visibility sheet reads them here instead of changing `chat-api.ts`.
   */
  getGroupVisibility(groupId: string): Promise<GroupVisibilityState>;
  setGroupVisibility(groupId: string, input: SetGroupVisibilityInput): Promise<void>;
  checkGroupHandle(handle: string): Promise<HandleCheck>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const DirectoryApiError = ApiError;
export type DirectoryApiError = ApiError;

const PublicJoinResultSchema = struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

// Older servers omit both keys: absent reads like private with no handle, a
// non-string handle or any other visibility value fails the row.
const GroupVisibilitySchema = struct({
  visibility: Schema.optional(Schema.Literals(['private', 'public'])),
  handle: Schema.optional(Schema.NullOr(Schema.String)),
});

function parsePublicJoinResult(value: unknown): PublicJoinResult | null {
  const decoded = Schema.decodeUnknownExit(PublicJoinResultSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseGroupVisibility(value: unknown): GroupVisibilityState | null {
  const decoded = Schema.decodeUnknownExit(GroupVisibilitySchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    visibility: decoded.value.visibility ?? 'private',
    handle: decoded.value.handle ?? null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The internal failures, one per case. They carry no field beyond what the
// old `DirectoryApiError` already surfaced; the `Promise` edge maps each back
// to that same error, status, code and message.
class DirectoryNetworkError extends Data.TaggedError('DirectoryNetworkError') {}
class DirectoryRequestError extends Data.TaggedError('DirectoryRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
}> {}
class DirectoryUnauthorized extends Data.TaggedError('DirectoryUnauthorized') {}
class DirectoryInvalidResponse extends Data.TaggedError('DirectoryInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, DirectoryNetworkError | DirectoryRequestError> {
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
    catch: () => new DirectoryNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const error = errorFieldsOf(body);
    return yield* new DirectoryRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
    });
  }
  return body;
});

/** The exact PATCH body the server's visibility route accepts. */
export function buildVisibilityBody(input: SetGroupVisibilityInput): Record<string, unknown> {
  return input.visibility === 'public' && input.handle !== undefined
    ? { visibility: 'public', handle: input.handle }
    : { visibility: input.visibility };
}

/** The production `DirectoryApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createDirectoryApi(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): DirectoryApi {
  const client = createApiClient({ getToken, fetchImpl, apiUrl });
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    DirectoryUnauthorized | DirectoryNetworkError | DirectoryRequestError | DirectoryInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new DirectoryUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new DirectoryInvalidResponse();
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
          DirectoryUnauthorized: () =>
            Effect.fail(new DirectoryApiError(401, 'unauthorized', 'No session')),
          DirectoryNetworkError: () =>
            Effect.fail(new DirectoryApiError(0, 'network_error', 'Could not reach the server')),
          DirectoryRequestError: (error) =>
            Effect.fail(new DirectoryApiError(error.status, error.code, error.message)),
          DirectoryInvalidResponse: () =>
            Effect.fail(
              new DirectoryApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  return {
    searchDirectory: (input = {}) => {
      // An empty `q` or `cursor` is left out, like before.
      const query = {
        ...(input.q === undefined || input.q === '' ? {} : { q: input.q }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.cursor === undefined || input.cursor === '' ? {} : { cursor: input.cursor }),
      };
      return runApi(client.directory.search({ query })).then((page) => ({
        entries: [...page.entries],
        next: page.next,
      }));
    },
    lookupGroupByHandle: (handle) => runApi(client.directory.byHandle({ params: { handle } })),
    async joinPublicGroup(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}/join`,
        { method: 'POST' },
        parsePublicJoinResult,
      );
      return body as PublicJoinResult;
    },
    async getGroupVisibility(groupId) {
      const body = await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        { method: 'GET' },
        parseGroupVisibility,
      );
      return body as GroupVisibilityState;
    },
    async setGroupVisibility(groupId, input) {
      await withToken(
        `/api/groups/${encodeURIComponent(groupId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(buildVisibilityBody(input)),
        },
        (value) => (isRecord(value) ? value : null),
      );
    },
    checkGroupHandle: (handle) => {
      // The server answers a handle outside 1..64 characters with a success
      // body (`invalid`), but the derived client encodes the query before it
      // sends it, so the same answer is given here.
      if (handle.length < HANDLE_CHECK_MIN || handle.length > HANDLE_CHECK_MAX) {
        return Promise.resolve({ available: false, reason: 'invalid' });
      }
      return runApi(client.handles.check({ query: { handle, kind: 'group' } }));
    },
  };
}
