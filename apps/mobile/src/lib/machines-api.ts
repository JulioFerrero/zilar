import { Schema } from 'effect';
import {
  makeMachinesApi as makeSharedMachinesApi,
  type MachinesApi as SharedMachinesApi,
} from '@zilar/client-core';
import { struct } from '@zilar/protocol';

import type { ApiCall, ApiTransport } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

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
