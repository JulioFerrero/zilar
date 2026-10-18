import { Exit, Schema } from 'effect';
import { ApiError, runApi, type AuthMe, type AuthSessions } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { createApiClient } from './effect/api-client';

export interface Me {
  id: string;
  email: string;
  name: string;
  jid: string | null;
  /**
   * Optional so a payload from a server without a bio still decodes; readers treat it as `''`.
   */
  bio?: string | undefined;
  /**
   * Carried so the own avatar shows from the session while a screen's `GET /me` is in flight.
   */
  avatarUrl?: string | undefined;
  /**
   * Optional so a payload from a server without one still decodes; readers treat it as unknown.
   */
  timeZone?: string | undefined;
}

export const AuthApiError = ApiError;
export type AuthApiError = ApiError;

function toMe(
  profile: Pick<AuthMe, 'id' | 'email' | 'name' | 'jid' | 'bio' | 'avatarUrl' | 'timeZone'>,
): Me {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    jid: profile.jid ?? null,
    // Absent stays absent, so `Me` stays equal to payloads from a server without a bio.
    ...(profile.bio === undefined ? {} : { bio: profile.bio }),
    ...(profile.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
    ...(profile.timeZone === undefined ? {} : { timeZone: profile.timeZone }),
  };
}

function clientFor(apiUrl: string, token: string, fetchImpl: typeof fetch) {
  return createApiClient({ getToken: async () => token, fetchImpl, apiUrl });
}

export async function fetchMe(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  const me = toMe(await runApi(clientFor(apiUrl, token, fetchImpl).auth.me()));
  void reportTimeZoneOnce(apiUrl, token, me, fetchImpl);
  return me;
}

// Report the device's IANA zone once per app start, best effort: a failure retries next start.
let timeZoneReported = false;

async function reportTimeZoneOnce(
  apiUrl: string,
  token: string,
  me: Me,
  fetchImpl: typeof fetch,
): Promise<void> {
  if (timeZoneReported) {
    return;
  }
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (zone === '' || zone === me.timeZone) {
    return;
  }
  timeZoneReported = true;
  try {
    await updateMe(apiUrl, token, me.name, fetchImpl, zone);
  } catch {
    // Ignored: a failure only means the next start tries again.
  }
}

export async function updateMe(
  apiUrl: string,
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
  timeZone?: string,
): Promise<Me> {
  // The name is trimmed by the contract; a time zone rides the same payload when the app reports one.
  const patched = await runApi(
    clientFor(apiUrl, token, fetchImpl).auth.patchMe({
      payload: { name: name.trim(), ...(timeZone === undefined ? {} : { timeZone }) },
    }),
  );
  return toMe({ ...patched, jid: null });
}

/**
 * The server still requires `name`, so the current one rides along unchanged.
 */
export async function updateBio(
  apiUrl: string,
  token: string,
  name: string,
  bio: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  const patched = await runApi(
    clientFor(apiUrl, token, fetchImpl).auth.patchMe({
      payload: { name: name.trim(), bio: bio.trim() },
    }),
  );
  return toMe({ ...patched, jid: null });
}

/**
 * Newest `updatedAt` first, with `current` on this one; the rows carry no token and no IP address.
 */
export async function listSessions(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthSessions> {
  return runApi(clientFor(apiUrl, token, fetchImpl).auth.listSessions());
}

export async function revokeSession(
  apiUrl: string,
  token: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await runApi(clientFor(apiUrl, token, fetchImpl).auth.revokeSession({ params: { id } }));
}

// Anything but a bare `{ valid: boolean }` — including a non-object body — means "not valid".
const InviteCheckSchema = struct({
  valid: Schema.optional(Schema.Boolean),
});

/**
 * Public route outside the bearer client: no token and no credentials, so it leaks nothing about the invite's creator.
 */
export async function checkInvite(
  apiUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/api/invites/${encodeURIComponent(code)}`, {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return false;
  }
  const decoded = Schema.decodeUnknownExit(InviteCheckSchema)(body);
  return Exit.isSuccess(decoded) && decoded.value.valid === true;
}
