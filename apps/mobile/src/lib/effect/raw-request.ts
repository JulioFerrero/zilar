// One hand-written request for the endpoints that stay outside the derived
// contract client (T-0895): routes whose body the server reads by hand (the
// contract declares no payload), and routes of modules not in the contract
// yet. It keeps what the derived client does: a missing token fails 401
// `unauthorized` before anything is sent, and every failure is an `ApiError`
// (`network_error` 0, the server's envelope, `invalid_response`).

import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody } from '@zilar/api-contract';
import type { ApiTransport } from './api-client';

export async function rawRequest<T>(
  { getToken, fetchImpl, apiUrl }: ApiTransport,
  path: string,
  schema: Schema.Codec<T, unknown>,
  init: RequestInit = { method: 'GET' },
): Promise<T> {
  const token = await getToken();
  if (token === undefined) {
    throw new ApiError(401, 'unauthorized', 'No session');
  }
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
    throw new ApiError(0, 'network_error', 'Could not reach the server');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw apiErrorFromBody(response.status, body);
  }
  const decoded = Schema.decodeUnknownExit(schema)(body);
  if (!Exit.isSuccess(decoded)) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'The server sent an unexpected response',
    );
  }
  return decoded.value;
}
