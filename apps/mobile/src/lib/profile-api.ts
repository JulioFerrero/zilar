import { API_URL } from './auth';

/**
 * The profile API (`/api/handles/check`, `PUT /api/me/handle`,
 * `PUT/DELETE /api/avatars/user/<id>`), the mobile twin of the web client
 * in `apps/web/src/lib/api.ts`. The wire contract lives in
 * `apps/server/src/handles/routes.ts` and `apps/server/src/avatars/`.
 *
 * Mobile has no zod, so — like `ais-api.ts` — the boundary is validated
 * with type guards. `ProfileApiError` keeps the server's `code` and
 * `status`, so screens can branch on the error without parsing the message
 * again (taken vs. reserved vs. invalid vs. rate limited; too_soon carries
 * the next-change date in the message, like web).
 */

export type HandleCheckReason = 'invalid' | 'reserved' | 'taken';

export interface HandleCheck {
  available: boolean;
  reason?: HandleCheckReason | undefined;
}

/**
 * The signed-in profile with the settings fields: the `@username` (null
 * when unclaimed) and the picture url (absent when unset). Both stay
 * optional so payloads from an older server still parse — absent reads
 * like null, like web's `meSchema`.
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
   * PUTs the cropped avatar bytes to the owner's slot. The default
   * implementation sends `blob` through `fetch` (used by tests). React
   * Native's `fetch` cannot send binary bodies, so the settings screens
   * pass `uploader` (the `expo-file-system` upload in
   * `components/settings/avatar-uploader.tsx`) to put a local file.
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
   * The server's `nextChangeAt` for `handle_change_too_soon` (validated as
   * a date at the boundary); undefined for every other error.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isHandleCheckReason(value: unknown): value is HandleCheckReason {
  return value === 'invalid' || value === 'reserved' || value === 'taken';
}

function parseHandleCheck(value: unknown): HandleCheck | null {
  if (!isRecord(value)) return null;
  const available = value['available'];
  if (typeof available !== 'boolean') return null;
  const reason = value['reason'];
  if (reason === undefined) {
    return { available };
  }
  if (!isHandleCheckReason(reason)) return null;
  return { available, reason };
}

function parseClaimedHandle(value: unknown): { handle: string } | null {
  if (!isRecord(value)) return null;
  const handle = value['handle'];
  if (!isString(handle)) return null;
  return { handle };
}

function parseMyProfile(value: unknown): MyProfile | null {
  if (!isRecord(value)) return null;
  const id = value['id'];
  const email = value['email'];
  const name = value['name'];
  if (!isString(id) || !isString(email) || !isString(name)) {
    return null;
  }
  const handle = value['handle'];
  const avatarUrl = value['avatarUrl'];
  if (handle !== null && handle !== undefined && !isString(handle)) {
    return null;
  }
  if (avatarUrl !== undefined && !isString(avatarUrl)) {
    return null;
  }
  return {
    id,
    email,
    name,
    handle: isString(handle) ? handle : null,
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
  };
}

function parseAvatarUrl(value: unknown): { url: string } | null {
  if (!isRecord(value)) return null;
  const url = value['url'];
  if (!isString(url)) return null;
  return { url };
}

/** Pulls the `{ code, message }` envelope out of a failed response body. */
export function parseApiErrorBody(body: unknown): {
  code: string;
  message: string | null;
  nextChangeAt?: string | undefined;
} {
  const error = isRecord(body) && isRecord(body['error']) ? body['error'] : null;
  const code = isString(error?.['code']) ? error['code'] : 'request_failed';
  const message = isString(error?.['message']) ? error['message'] : null;
  // The handle claim carries the next-change date alongside the code (web
  // reads it the same way); anything that is not a parseable date is
  // dropped, so callers never format garbage.
  const nextChangeAt = error?.['nextChangeAt'];
  if (isString(nextChangeAt) && !Number.isNaN(new Date(nextChangeAt).getTime())) {
    return { code, message, nextChangeAt };
  }
  return { code, message };
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

/** The production `ProfileApi`: bearer auth, `fetch`, and the build-time API URL. */
export function createProfileApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): ProfileApi {
  const withToken = async (
    path: string,
    init: RequestInit,
    parse: (value: unknown) => unknown,
  ): Promise<unknown> => {
    const token = await getToken();
    if (token === undefined) {
      throw new ProfileApiError(401, 'unauthorized', 'No session');
    }
    const body = await request(apiUrl, path, token, init, fetchImpl);
    const parsed = parse(body);
    if (parsed === null) {
      throw new ProfileApiError(200, 'invalid_response', 'The server sent an unexpected response');
    }
    return parsed;
  };

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
        // The native upload path (`expo-file-system` PUT of the picked file):
        // the bearer rides on the PUT itself, like the attachment uploader.
        const token = await getToken();
        if (token === undefined) {
          throw new ProfileApiError(401, 'unauthorized', 'No session');
        }
        const parsed = parseAvatarUrl(
          await uploader(`${apiUrl}${avatarPutPath(ownerId)}`, blob.type),
        );
        if (parsed === null) {
          throw new ProfileApiError(
            200,
            'invalid_response',
            'The server sent an unexpected response',
          );
        }
        return parsed;
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
