import { Data, Effect, Exit, Schema, type Effect as EffectType } from 'effect';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import { API_URL } from './auth';

/**
 * `ProfileApiError` is the shared `ApiError` (taken vs. reserved vs. invalid vs. rate limited), so screens branch on `status` without parsing the message.
 */

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

export interface HandleCheck {
  available: boolean;
  reason?: HandleCheckReason | undefined;
}

/**
 * Both stay optional so payloads from an older server still parse; absent reads as null.
 */
export interface MyProfile {
  id: string;
  email: string;
  name: string;
  handle: string | null;
  avatarUrl?: string | undefined;
}

export interface ProfileApi {
  getMe(): Promise<MyProfile>;
  checkHandle(handle: string): Promise<HandleCheck>;
  claimHandle(handle: string): Promise<{ handle: string }>;
  /**
   * React Native's `fetch` cannot send binary bodies, so the settings screens pass `uploader` (an `expo-file-system` PUT) instead; tests use the default blob.
   */
  uploadAvatar(
    ownerId: string,
    blob: Blob,
    uploader?: (url: string, mimeType: string) => Promise<unknown>,
  ): Promise<{ url: string }>;
  removeAvatar(ownerId: string): Promise<void>;
}

export class ProfileApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * `nextChangeAt` for `handle_change_too_soon`, validated as a date; undefined for every other error.
   */
  readonly nextChangeAt?: string | undefined;

  constructor(status: number, code: string, message: string, nextChangeAt?: string | undefined) {
    super(message);
    this.name = 'ProfileApiError';
    this.status = status;
    this.code = code;
    this.nextChangeAt = nextChangeAt;
  }
}

const HandleCheckSchema = struct({
  available: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(['invalid', 'reserved', 'taken'])),
});

const ClaimedHandleSchema = struct({
  handle: Schema.String,
});

// An absent `handle` reads as null and an absent `avatarUrl` stays absent, as web's `meSchema` does.
const MyProfileSchema = struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  handle: Schema.optional(Schema.NullOr(Schema.String)),
  avatarUrl: Schema.optional(Schema.String),
});

const AvatarUrlSchema = struct({
  url: Schema.String,
});

// Anything that is not a parseable date is dropped, so callers never format garbage.
const NextChangeAtSchema = struct({
  error: struct({
    nextChangeAt: Schema.optional(Schema.String),
  }),
});

function parseHandleCheck(value: unknown): HandleCheck | null {
  const decoded = Schema.decodeUnknownExit(HandleCheckSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseClaimedHandle(value: unknown): { handle: string } | null {
  const decoded = Schema.decodeUnknownExit(ClaimedHandleSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function parseMyProfile(value: unknown): MyProfile | null {
  const decoded = Schema.decodeUnknownExit(MyProfileSchema)(value);
  if (!Exit.isSuccess(decoded)) return null;
  return {
    id: decoded.value.id,
    email: decoded.value.email,
    name: decoded.value.name,
    handle: decoded.value.handle ?? null,
    ...(decoded.value.avatarUrl === undefined ? {} : { avatarUrl: decoded.value.avatarUrl }),
  };
}

function parseAvatarUrl(value: unknown): { url: string } | null {
  const decoded = Schema.decodeUnknownExit(AvatarUrlSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function parseApiErrorBody(body: unknown): {
  code: string;
  message: string | null;
  nextChangeAt?: string | undefined;
} {
  const error = errorFieldsOf(body);
  const nextChangeAt = parseNextChangeAt(body);
  return {
    code: error.code ?? 'request_failed',
    message: error.message ?? null,
    ...(nextChangeAt === undefined ? {} : { nextChangeAt }),
  };
}

function parseNextChangeAt(body: unknown): string | undefined {
  const decoded = Schema.decodeUnknownExit(NextChangeAtSchema)(body);
  if (!Exit.isSuccess(decoded)) return undefined;
  const nextChangeAt = decoded.value.error.nextChangeAt;
  if (nextChangeAt === undefined || Number.isNaN(new Date(nextChangeAt).getTime())) {
    return undefined;
  }
  return nextChangeAt;
}

export function avatarPutPath(ownerId: string): string {
  return `/api/avatars/user/${encodeURIComponent(ownerId)}`;
}

export function checkHandlePath(handle: string): string {
  const params = new URLSearchParams();
  params.set('handle', handle);
  return `/api/handles/check?${params.toString()}`;
}

export function avatarFileName(mimeType: string): string {
  const lower = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (lower === 'image/png') return 'avatar.png';
  if (lower === 'image/webp') return 'avatar.webp';
  return 'avatar.jpg';
}

// The `Promise` edge maps each internal failure back to the same error, status, code, message and `nextChangeAt`.
class ProfileNetworkError extends Data.TaggedError('ProfileNetworkError') {}
class ProfileRequestError extends Data.TaggedError('ProfileRequestError')<{
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly nextChangeAt?: string | undefined;
}> {}
class ProfileUnauthorized extends Data.TaggedError('ProfileUnauthorized') {}
class ProfileInvalidResponse extends Data.TaggedError('ProfileInvalidResponse') {}

const requestEffect = Effect.fnUntraced(function* (
  apiUrl: string,
  path: string,
  token: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): EffectType.fn.Return<unknown, ProfileNetworkError | ProfileRequestError> {
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
    catch: () => new ProfileNetworkError(),
  });

  const body: unknown = yield* Effect.promise(
    () => response.json().catch(() => null) as Promise<unknown>,
  );

  if (!response.ok) {
    const { code, message, nextChangeAt } = parseApiErrorBody(body);
    return yield* new ProfileRequestError({
      status: response.status,
      code,
      message: message ?? `Request failed (${response.status})`,
      ...(nextChangeAt === undefined ? {} : { nextChangeAt }),
    });
  }
  return body;
});

export function createProfileApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ProfileApi {
  const withTokenEffect = Effect.fnUntraced(function* (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): EffectType.fn.Return<
    unknown,
    ProfileUnauthorized | ProfileNetworkError | ProfileRequestError | ProfileInvalidResponse
  > {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ProfileUnauthorized();
    }
    const body = yield* requestEffect(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      return yield* new ProfileInvalidResponse();
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
          ProfileUnauthorized: () =>
            Effect.fail(new ProfileApiError(401, 'unauthorized', 'No session')),
          ProfileNetworkError: () =>
            Effect.fail(new ProfileApiError(0, 'network_error', 'Could not reach the server')),
          ProfileRequestError: (error) =>
            Effect.fail(
              new ProfileApiError(error.status, error.code, error.message, error.nextChangeAt),
            ),
          ProfileInvalidResponse: () =>
            Effect.fail(
              new ProfileApiError(
                200,
                'invalid_response',
                'The server sent an unexpected response',
              ),
            ),
        }),
      ),
    );

  // The bearer rides on the PUT itself, like the attachment uploader.
  const uploadNativeEffect = Effect.fnUntraced(function* (
    ownerId: string,
    blob: Blob,
    uploader: (url: string, mimeType: string) => Promise<unknown>,
  ): EffectType.fn.Return<{ url: string }, ProfileUnauthorized | ProfileInvalidResponse> {
    const token = yield* Effect.promise(() => getToken());
    if (token === undefined) {
      return yield* new ProfileUnauthorized();
    }
    const parsed = parseAvatarUrl(
      yield* Effect.promise(() => uploader(`${apiUrl}${avatarPutPath(ownerId)}`, blob.type)),
    );
    if (parsed === null) {
      return yield* new ProfileInvalidResponse();
    }
    return parsed;
  });

  return {
    async getMe() {
      const body = await withToken('/api/me', { method: 'GET' }, parseMyProfile);
      return body as MyProfile;
    },
    async checkHandle(handle) {
      const body = await withToken(checkHandlePath(handle), { method: 'GET' }, parseHandleCheck);
      return body as HandleCheck;
    },
    async claimHandle(handle) {
      const body = await withToken(
        '/api/me/handle',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ handle }),
        },
        parseClaimedHandle,
      );
      return body as { handle: string };
    },
    async uploadAvatar(ownerId, blob, uploader) {
      if (uploader !== undefined) {
        return Effect.runPromise(
          uploadNativeEffect(ownerId, blob, uploader).pipe(
            Effect.catchTags({
              ProfileUnauthorized: () =>
                Effect.fail(new ProfileApiError(401, 'unauthorized', 'No session')),
              ProfileInvalidResponse: () =>
                Effect.fail(
                  new ProfileApiError(
                    200,
                    'invalid_response',
                    'The server sent an unexpected response',
                  ),
                ),
            }),
          ),
        );
      }
      const body = await withToken(
        avatarPutPath(ownerId),
        {
          method: 'PUT',
          headers: { 'content-type': blob.type },
          body: blob as unknown as BodyInit,
        },
        parseAvatarUrl,
      );
      return body as { url: string };
    },
    async removeAvatar(ownerId) {
      await withToken(avatarPutPath(ownerId), { method: 'DELETE' }, () => undefined);
    },
  };
}
