import { Schema } from 'effect';
import { runApi } from '@zilar/api-contract';
import { makeMachinesApi, type MachinesApi as SharedMachinesApi } from '@zilar/client-core';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

// The AI's home machine is a separate route on purpose, not part of the general PATCH.

export type { Machine, MachineStatus, PairingCode } from '@zilar/api-contract';

export type MachinesApi = SharedMachinesApi & {
  setAiMachine(aiId: string, machineId: string | null): Promise<string | null>;
};

const MachineIdSchema = struct({
  machineId: Schema.NullOr(Schema.String),
});

export function createMachinesApi(
  getToken: () => Promise<string | undefined>,
  fetchImpl: typeof fetch = fetch,
  apiUrl: string = API_URL,
): MachinesApi {
  const transport = { getToken, fetchImpl, apiUrl };
  const client = createApiClient(transport);
  return {
    ...makeMachinesApi((call) => runApi(call(client))),
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
