// For routes outside the derived contract client: a missing token fails 401 `unauthorized` before sending, and every failure is an `ApiError`.

import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody } from '@zilar/api-contract';
import type { ApiTransport } from './api-client';
import { API_TIMEOUT_MS, fetchWithTimeout } from './fetch-timeout';

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
    response = await fetchWithTimeout(
      fetchImpl,
      `${apiUrl}${path}`,
      {
        ...init,
        credentials: 'omit',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
      },
      API_TIMEOUT_MS,
    );
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
