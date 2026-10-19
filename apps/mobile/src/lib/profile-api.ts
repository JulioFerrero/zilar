import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody, type AuthMe, type HandleCheck } from '@zilar/api-contract';
import { makeChatsApi, makeHandlesApi } from '@zilar/client-core';
import { struct } from '@zilar/protocol';

import type { ApiCall, ApiTransport } from './effect/api-client';

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

const AvatarUrlSchema = struct({
  url: Schema.String,
});

function parseAvatarUrl(value: unknown): { url: string } | null {
  const decoded = Schema.decodeUnknownExit(AvatarUrlSchema)(value);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

function avatarUrlOrThrow(value: unknown): { url: string } {
  const parsed = parseAvatarUrl(value);
  if (parsed === null) {
    throw new ApiError(200, 'invalid_response', 'The server sent an unexpected response');
  }
  return parsed;
}

export function avatarPutPath(ownerId: string): string {
  return `/api/avatars/user/${encodeURIComponent(ownerId)}`;
}

export function makeProfileApi(call: ApiCall, transport: ApiTransport): ProfileApi {
  const chats = makeChatsApi(call);
  const handles = makeHandlesApi(call);

  // The bearer rides on the PUT itself, like the attachment uploader.
  async function avatarRequest(ownerId: string, init: RequestInit): Promise<unknown> {
    const token = await transport.getToken();
    if (token === undefined) {
      throw new ApiError(401, 'unauthorized', 'No session');
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
      throw new ApiError(0, 'network_error', 'Could not reach the server');
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw apiErrorFromBody(response.status, body);
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
          throw new ApiError(401, 'unauthorized', 'No session');
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
