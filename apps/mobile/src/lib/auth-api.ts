import { Exit, Schema } from 'effect';
import { ApiError, runApi, type AuthMe } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { createApiClient } from './effect/api-client';

/** The signed-in profile, from `GET /api/me` (T-0015/T-0020). */
export interface Me {
  id: string;
  email: string;
  name: string;
  jid: string | null;
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
function toMe(profile: Pick<AuthMe, 'id' | 'email' | 'name' | 'jid'>): Me {
  return { id: profile.id, email: profile.email, name: profile.name, jid: profile.jid ?? null };
}

function clientFor(apiUrl: string, token: string, fetchImpl: typeof fetch) {
  return createApiClient({ getToken: async () => token, fetchImpl, apiUrl });
}

export async function fetchMe(
  apiUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  return toMe(await runApi(clientFor(apiUrl, token, fetchImpl).auth.me()));
}

export async function updateMe(
  apiUrl: string,
  token: string,
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Me> {
  // The contract encodes the trimmed name (the server trimmed it anyway). The
  // reply is the updated user without `jid`, which reads as `null`.
  const patched = await runApi(
    clientFor(apiUrl, token, fetchImpl).auth.patchMe({ payload: { name: name.trim() } }),
  );
  return toMe({ ...patched, jid: null });
}

// The invite check answers a bare `{ valid: boolean }`; anything else,
// including a non-object body, means "not valid".
const InviteCheckSchema = struct({
  valid: Schema.optional(Schema.Boolean),
});

/**
 * Checks an invite link without leaking anything about its creator. The route
 * is public: no token, and the `fetch` init stays bare, so it stays outside the
 * bearer client.
 */
export async function checkInvite(
  apiUrl: string,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}/api/invites/${encodeURIComponent(code)}`, {
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
