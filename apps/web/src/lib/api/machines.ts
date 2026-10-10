// effect-plain: moved unchanged from apps/web/src/lib/api.ts (size split)
import { Machine, type MachineStatus, type PairingCode } from '@zilar/api-contract';
import { callApi } from '@/lib/effect/api-client';

// --- Machines (T-0070) ---------------------------------------------------
// The wire contract lives in apps/server/src/machines/api.ts and
// service.ts. `ApiError` carries the server's `code` and `status`, so callers
// can branch without parsing the message again. `online` is optional so the
// schema works before T-0071 (the runner hub) lands.

// The schemas and endpoints live in `@zilar/api-contract` (`machines.ts`,
// T-0895).
export type { Machine, MachineStatus, PairingCode };
export { Machine as machineSchema };

export function listMachines(): Promise<Machine[]> {
  return callApi((client) => client.machines.list()).then((rows) => [...rows]);
}

export function createPairingCode(): Promise<PairingCode> {
  return callApi((client) => client.machines.createPairingCode());
}

export function approveMachine(id: string): Promise<Machine> {
  return callApi((client) => client.machines.approve({ params: { id } }));
}

export async function denyMachine(id: string): Promise<void> {
  await callApi((client) => client.machines.deny({ params: { id } }));
}

export function revokeMachine(id: string): Promise<Machine> {
  return callApi((client) => client.machines.revoke({ params: { id } }));
}

export function renameMachine(id: string, name: string): Promise<Machine> {
  // The server trims the name; the contract encodes the trimmed form.
  return callApi((client) =>
    client.machines.rename({ params: { id }, payload: { name: name.trim() } }),
  );
}

export async function deleteMachine(id: string): Promise<void> {
  await callApi((client) => client.machines.remove({ params: { id } }));
}
