import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';
import type { TokenProvider } from './chat-api';

/**
 * The public directory API (directory search, lookup by handle, public
 * join, the visibility PATCH on one group and the handle check), the mobile
 * `apps/web/src/lib/api.ts` (T-0164). The wire contract lives in
 * `apps/server/src/directory/routes.ts` (public groups and channels only,
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

export class DirectoryApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DirectoryApiError';
    this.status = status;
    this.code = code;
  }
}

const DirectoryKindSchema = Schema.Literals(['group', 'channel']);

const DirectoryEntrySchema = struct({
  id: Schema.String,
  kind: DirectoryKindSchema,
  title: Schema.String,
  handle: Schema.String,
  description: Schema.NullOr(Schema.String),
  memberCount: Schema.Number,
  joined: Schema.Boolean,
  avatarUrl: Schema.optional(Schema.String),
});

const DirectoryPageSchema = struct({
  entries: Schema.mutable(Schema.Array(DirectoryEntrySchema)),
  next: Schema.NullOr(Schema.String),
});

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

const HandleCheckSchema = struct({
  available: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(['invalid', 'reserved', 'taken'])),
});

function parseDirectoryEntry(value: unknown): DirectoryEntry | null {
  const decoded = Schema.decodeUnknownExit(DirectoryEntrySchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseDirectoryPage(value: unknown): DirectoryPage | null {
  const decoded = Schema.decodeUnknownExit(DirectoryPageSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

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

function parseHandleCheck(value: unknown): HandleCheck | null {
  const decoded = Schema.decodeUnknownExit(HandleCheckSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
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
    async searchDirectory(input = {}) {
      const params = new URLSearchParams();
      if (input.q !== undefined && input.q !== '') {
        params.set('q', input.q);
      }
      if (input.kind !== undefined) {
        params.set('kind', input.kind);
      }
      if (input.cursor !== undefined && input.cursor !== '') {
        params.set('cursor', input.cursor);
      }
      const suffix = params.size === 0 ? '' : `?${params.toString()}`;
      const body = await withToken(
        `/api/directory${suffix}`,
        { method: 'GET' },
        parseDirectoryPage,
      );
      return body as DirectoryPage;
    },
    async lookupGroupByHandle(handle) {
      const body = await withToken(
        `/api/groups/by-handle/${encodeURIComponent(handle)}`,
        { method: 'GET' },
        parseDirectoryEntry,
      );
      return body as DirectoryEntry;
    },
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
    async checkGroupHandle(handle) {
      const params = new URLSearchParams();
      params.set('handle', handle);
      params.set('kind', 'group');
      const body = await withToken(
        `/api/handles/check?${params.toString()}`,
        { method: 'GET' },
        parseHandleCheck,
      );
      return body as HandleCheck;
    },
  };
}
