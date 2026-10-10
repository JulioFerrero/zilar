// The machines service barrel (T-1018 size split): the old
// `machines/service.ts` contents live in `pairing.ts` (pairing codes and the
// pending-machine insert), `machines.ts` (the machine row reads and writes),
// `crypto.ts` (the public-key fingerprint and signature check) and `view.ts`
// (the owner-facing shape). This path keeps the caps and the service error,
// and stays a barrel so every importer keeps working with the same names and
// kinds.

export const MAX_PAIRING_CODES_PER_USER = 5;
export const MAX_MACHINES_PER_USER = 20;
export const MAX_PENDING_MACHINES_PER_USER = 5;

export type { MachineRow } from '../db/rows';
export type MachineStatus = 'pending' | 'approved' | 'revoked';

// Thrown for quota and conflict failures so routes can map them to 409s with
// a stable code. Unknown states (missing machine, wrong owner) are null
// returns instead, so routes answer 404.
export class MachineServiceError extends Error {
  readonly errorCode: 'pairing_code_limit' | 'machine_limit' | 'pending_limit' | 'key_in_use';

  constructor(errorCode: MachineServiceError['errorCode'], message: string) {
    super(message);
    this.name = 'MachineServiceError';
    this.errorCode = errorCode;
  }
}

export { fingerprintOfPublicKey, verifyPairingSignature } from './crypto';
export { toPublicMachine } from './view';
export type { PublicMachine } from './view';
export {
  consumePairingCode,
  countActivePairingCodes,
  createPairingCode,
  insertPendingMachine,
} from './pairing';
export type { PairMachineInput } from './pairing';
export {
  approveMachine,
  countMachines,
  countPendingMachines,
  deleteMachine,
  denyMachine,
  findOwnedMachine,
  listApprovedMachineKeys,
  listMachines,
  renameMachine,
  revokeMachine,
} from './machines';
