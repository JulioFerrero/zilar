import { Schema } from 'effect';
import { ApiError, Machine as MachineSchema, runApi } from '@zilar/api-contract';
import type { Machine, MachineStatus, PairingCode } from '@zilar/api-contract';
import { struct } from '@zilar/protocol';

import { API_URL } from './auth';
import { createApiClient } from './effect/api-client';
import { rawRequest } from './effect/raw-request';

/**
 * The machines (runners) API (`/api/machines`), the mobile twin of the web
 * client in `apps/web/src/lib/api.ts`. The routes come from the client derived
 * from the shared contract (`@zilar/api-contract`, `machines.ts`, T-0895).
 * Two calls stay hand-written: `renameMachine` (the server reads that body by
 * hand, so the contract declares no payload for it) and `setAiMachine` (the
 * AIs module is not in the contract yet).
 *
 * `setAiMachine` mirrors web's `setAiMachine`: the AI's home machine is a
 * separate route on purpose, not part of the general PATCH.
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
  /**
   * Assigns the AI's home machine (`null` clears it back to the platform).
   * Answers the new `machineId` parsed from the server's fresh public AI.
   */
  setAiMachine(aiId: string, machineId: string | null): Promise<string | null>;
}

/** The shared `ApiError` under this module's old name, so `instanceof` sites keep working. */
export const MachinesApiError = ApiError;
export type MachinesApiError = ApiError;

/** The AI's home machine id, read off the server's fresh public AI. */
const MachineIdSchema = struct({
  machineId: Schema.NullOr(Schema.String),
});

/** The production `MachinesApi`: bearer auth, `fetch`, and the build-time API URL. */
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
      rawRequest(transport, `/api/machines/${encodeURIComponent(id)}`, MachineSchema, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      }),
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
