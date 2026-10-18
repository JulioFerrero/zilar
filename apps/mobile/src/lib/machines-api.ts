import { Schema } from 'effect';
import { runApi } from '@zilar/api-contract';
import type { Machine, MachineStatus, PairingCode } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

/**
 * `setAiMachine` stays hand-written: the AI's home machine is a separate route on purpose, not part of the general PATCH.
 */

export type { Machine, MachineStatus, PairingCode };

export interface MachinesApi {
  listMachines(): Promise<Machine[]>;
  createPairingCode(): Promise<PairingCode>;
  approveMachine(id: string): Promise<Machine>;
  denyMachine(id: string): Promise<void>;
  revokeMachine(id: string): Promise<Machine>;
  renameMachine(id: string, name: string): Promise<Machine>;
  deleteMachine(id: string): Promise<void>;
  setAiMachine(aiId: string, machineId: string | null): Promise<string | null>;
}

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
    listMachines: () => runApi(client.machines.list()).then((rows) => [...rows]),
    createPairingCode: () => runApi(client.machines.createPairingCode()),
    approveMachine: (id) => runApi(client.machines.approve({ params: { id } })),
    denyMachine: (id) => runApi(client.machines.deny({ params: { id } })),
    revokeMachine: (id) => runApi(client.machines.revoke({ params: { id } })),
    renameMachine: (id, name) =>
      runApi(client.machines.rename({ params: { id }, payload: { name: name.trim() } })),
    deleteMachine: (id) => runApi(client.machines.remove({ params: { id } })),
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
