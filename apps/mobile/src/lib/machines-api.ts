import { Exit, Schema } from 'effect';
import { ApiError, apiErrorFromBody } from '@zilar/api-contract';
import {
  makeMachinesApi as makeSharedMachinesApi,
  type MachinesApi as SharedMachinesApi,
} from '@zilar/client-core';
import { struct } from '@zilar/protocol';

import type { ApiCall, ApiTransport } from './effect/api-client';
import { API_TIMEOUT_MS, fetchWithTimeout } from './effect/fetch-timeout';

// The AI's home machine is a separate route on purpose, not part of the general PATCH.

export type MachinesApi = SharedMachinesApi & {
  setAiMachine(aiId: string, machineId: string | null): Promise<string | null>;
};

const MachineIdSchema = struct({
  machineId: Schema.NullOr(Schema.String),
});

export function makeMachinesApi(call: ApiCall, transport: ApiTransport): MachinesApi {
  return {
    ...makeSharedMachinesApi(call),
    setAiMachine: async (aiId, machineId) => {
      const parsed = await rawRequest(
        transport,
        `/api/ais/${encodeURIComponent(aiId)}/machine`,
        MachineIdSchema,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ machineId }),
        },
      );
      return parsed.machineId;
    },
  };
}

// For routes outside the derived contract client: a missing token fails 401 `unauthorized` before sending, and every failure is an `ApiError`.
async function rawRequest<T>(
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
