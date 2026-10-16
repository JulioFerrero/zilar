import { Exit, Schema } from 'effect';
import { ApiError, runApi, type AuthMe, type AuthSessions } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { createApiClient } from './effect/api-client';

/** The signed-in profile, from `GET /api/me` (T-0015/T-0020). */
export interface Me {
  id: string;
  email: string;
  name: string;
  jid: string | null;
  /**
   * The short bio (T-1259). Optional so a payload from a server without a bio
   * still decodes; readers treat an absent one as `''`.
   */
  bio?: string | undefined;
  /**
   * The profile picture URL (T-1334). Carried so the own avatar can show it
   * from the session while a screen's own `GET /me` is still in flight.
   */
  avatarUrl?: string | undefined;
  /**
   * The user's IANA time zone (T-1440). Optional so a payload from a server
   * without one still decodes; readers treat an absent one as "unknown".
   */
  timeZone?: string | undefined;
}

/**
 * A failed API call, carrying the status and the server's error code: the
 * shared `ApiError` under this module's old name, so `instanceof` sites keep
 * working.
 */
export const AuthApiError = ApiError;
export type AuthApiError = ApiError;

// The routes come from the client derived from the shared contract
// (`@zilar/api-contract`, `auth.ts`, T-0895). The profile here is the narrow
// view the app needs; an absent `jid` reads as `null`.
function toMe(
  profile: Pick<AuthMe, 'id' | 'email' | 'name' | 'jid' | 'bio' | 'avatarUrl' | 'timeZone'>,
): Me {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    jid: profile.jid ?? null,
    // Kept absent when the server has no bio, so `Me` stays equal to payloads
    // from an older server; readers fall back to `''`.
    ...(profile.bio === undefined ? {} : { bio: profile.bio }),
    // Same for the picture (T-1334): absent stays absent.
    ...(profile.avatarUrl === undefined ? {} : { avatarUrl: profile.avatarUrl }),
    // Same for the time zone (T-1440): absent stays absent.
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

// T-1440: report the device's IANA zone once per app start when it differs from
// the stored one. Silent and best effort: a failure retries next start.
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
  // The contract encodes the trimmed name (the server trimmed it anyway). The
  // reply is the updated user without `jid`, which reads as `null`. T-1440: a
  // time zone rides the same payload when the app reports one.
  const patched = await runApi(
    clientFor(apiUrl, token, fetchImpl).auth.patchMe({
      payload: { name: name.trim(), ...(timeZone === undefined ? {} : { timeZone }) },
    }),
  );
  return toMe({ ...patched, jid: null });
}

/**
 * Saves the bio through `PATCH /api/me` (T-1259). The server still requires
 * `name`, so the current one rides along unchanged; the payload carries both
 * trimmed fields (the contract validates them).
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
 * The caller's signed-in sessions, newest `updatedAt` first with `current` on
 * this one (T-1250). The rows carry no token and no IP address.
 */
export async function listSessions(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthSessions> {
  return runApi(clientFor(apiUrl, token, fetchImpl).auth.listSessions());
}

/** Signs out one other device (`DELETE /me/sessions/:id`); the server answers 204 (T-1250). */
export async function revokeSession(
  apiUrl: string,
  token: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await runApi(clientFor(apiUrl, token, fetchImpl).auth.revokeSession({ params: { id } }));
}

// The invite check answers a bare `{ valid: boolean }`; anything else,
// including a non-object body, means "not valid".
const InviteCheckSchema = struct({
  valid: Schema.optional(Schema.Boolean),
});

/**
 * Checks an invite link without leaking anything about its creator. The route
 * is public: no token, and the `fetch` init omits credentials, so it stays
 * outside the bearer client.
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
