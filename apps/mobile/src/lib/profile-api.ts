import { Exit, Schema, type Effect } from 'effect';
import { ApiError, type AuthMe, type HandleCheck, type ZilarClient } from '@zilar/api-contract';
import { makeChatsApi, makeHandlesApi } from '@zilar/client-core';
import { struct } from '@zilar/protocol';

import { errorFieldsOf } from './api-error-body';
import type { ApiCall, ApiTransport } from './effect/api-client';

/**
 * `ProfileApiError` is the shared `ApiError` (taken vs. reserved vs. invalid vs. rate limited), so screens branch on `status` without parsing the message.
 */

/** The profile row with an absent handle read as null, as web's `meSchema` does. */
export type MyProfile = Omit<AuthMe, 'handle'> & { handle: string | null };

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

const AvatarUrlSchema = struct({
  url: Schema.String,
});

// Anything that is not a parseable date is dropped, so callers never format garbage.
const NextChangeAtSchema = struct({
  error: struct({
    nextChangeAt: Schema.optional(Schema.String),
  }),
});

function parseAvatarUrl(value: unknown): { url: string } | null {
  const decoded = Schema.decodeUnknownExit(AvatarUrlSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function avatarUrlOrThrow(value: unknown): { url: string } {
  const parsed = parseAvatarUrl(value);
  if (parsed === null) {
    throw new ProfileApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return parsed;
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

function toProfileError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  const next = error.detail.nextChangeAt;
  return new ProfileApiError(
    error.status,
    error.code,
    error.message,
    typeof next === 'string' && !Number.isNaN(new Date(next).getTime()) ? next : undefined,
  );
}

export function makeProfileApi(call: ApiCall, transport: ApiTransport): ProfileApi {
  const profileCall = <A, E>(request: (client: ZilarClient) => Effect.Effect<A, E>): Promise<A> =>
    call(request).catch((error: unknown) => {
      throw toProfileError(error);
    });
  const chats = makeChatsApi(profileCall);
  const handles = makeHandlesApi(profileCall);

  // The bearer rides on the PUT itself, like the attachment uploader.
  async function avatarRequest(ownerId: string, init: RequestInit): Promise<unknown> {
    const token = await transport.getToken();
    if (token === undefined) {
      throw new ProfileApiError(401, 'unauthorized', 'No session');
    }
    let response: Response;
    try {
      response = await transport.fetchImpl(`${transport.apiUrl}${avatarPutPath(ownerId)}`, {
        ...init,
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
    } catch {
      throw new ProfileApiError(0, 'network_error', 'Could not reach the server');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const { code, message, nextChangeAt } = parseApiErrorBody(body);
      throw new ProfileApiError(
        response.status,
        code,
        message ?? `Request failed (${response.status})`,
        nextChangeAt,
      );
    }
    return body;
  }

  return {
    async getMe() {
      const me = await chats.getMe();
      return { ...me, handle: me.handle ?? null };
    },
    checkHandle: (handle) => handles.checkHandle(handle),
    claimHandle: (handle) => handles.claimHandle(handle),
    async uploadAvatar(ownerId, blob, uploader) {
      if (uploader !== undefined) {
        const token = await transport.getToken();
        if (token === undefined) {
          throw new ProfileApiError(401, 'unauthorized', 'No session');
        }
        return avatarUrlOrThrow(
          await uploader(`${transport.apiUrl}${avatarPutPath(ownerId)}`, blob.type),
        );
      }
      return avatarUrlOrThrow(
        await avatarRequest(ownerId, {
          method: 'PUT',
          headers: { 'content-type': blob.type },
          body: blob as unknown as BodyInit,
        }),
      );
    },
    async removeAvatar(ownerId) {
      await avatarRequest(ownerId, { method: 'DELETE' });
    },
  };
}
