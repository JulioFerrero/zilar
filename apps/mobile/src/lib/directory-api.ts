import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';
import { ApiError, HANDLE_CHECK_MAX, HANDLE_CHECK_MIN, runApi } from '@zilar/api-contract';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';
import { createApiClient } from './effect/api-client';

/**
 * Public groups and channels only, never users or private groups; reads are rate limited 30 per 10 minutes. Errors are the shared `ApiError` (404 = unknown or private, 409 = full / handle taken, 429 = rate limited).
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
   * The mobile `GroupDetail` parser drops `visibility`/`handle`, so the sheet reads them here.
   */
  getGroupVisibility(groupId: string): Promise<GroupVisibilityState>;
  setGroupVisibility(groupId: string, input: SetGroupVisibilityInput): Promise<void>;
  checkGroupHandle(handle: string): Promise<HandleCheck>;
}

const PublicJoinResultSchema = struct({
  groupId: Schema.String,
  alreadyMember: Schema.Boolean,
});

// Older servers omit both keys: absent reads as private with no handle, and a non-string handle fails the row.
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

// The `Promise` edge maps each internal failure back to the same error, status, code and message.
class DirectoryNetworkError extends Data.TaggedError('DirectoryNetworkError') {}
class DirectoryRequestError extends Data.TaggedError('DirectoryRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly detail: Record<string, unknown>;
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
        credentials: 'omit',
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
    const rawError = isRecord(body) && isRecord(body.error) ? body.error : undefined;
    const nextChangeAt = rawError?.nextChangeAt;
    return yield* new DirectoryRequestError({
      status: response.status,
      code: error.code ?? 'request_failed',
      message: error.message ?? `Request failed (${response.status})`,
      detail: typeof nextChangeAt === 'string' ? { nextChangeAt } : {},
    });
  }
  return body;
});

export function buildVisibilityBody(input: SetGroupVisibilityInput): Record<string, unknown> {
  return input.visibility === 'public' && input.handle !== undefined
    ? { visibility: 'public', handle: input.handle }
    : { visibility: input.visibility };
}

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
          DirectoryUnauthorized: () => Effect.fail(new ApiError(401, 'unauthorized', 'No session')),
          DirectoryNetworkError: () =>
            Effect.fail(new ApiError(0, 'network_error', 'Could not reach the server')),
          DirectoryRequestError: (error) =>
            Effect.fail(new ApiError(error.status, error.code, error.message, error.detail)),
          DirectoryInvalidResponse: () =>
            Effect.fail(
              new ApiError(200, 'invalid_response', 'The server sent an unexpected response'),
            ),
        }),
      ),
    );

  return {
    searchDirectory: (input = {}) => {
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
      // A handle outside 1..64 characters is answered here, as a success body (`invalid`), before the client encodes the query.
      if (handle.length < HANDLE_CHECK_MIN || handle.length > HANDLE_CHECK_MAX) {
        return Promise.resolve({ available: false, reason: 'invalid' });
      }
      return runApi(client.handles.check({ query: { handle, kind: 'group' } }));
    },
  };
}
