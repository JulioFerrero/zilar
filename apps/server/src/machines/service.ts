export const MAX_PAIRING_CODES_PER_USER = 5;
export const MAX_MACHINES_PER_USER = 20;
export const MAX_PENDING_MACHINES_PER_USER = 5;

export type { MachineRow } from '../db/rows';
export type MachineStatus = 'pending' | 'approved' | 'revoked';

// Routes map this to 409 with a stable code; missing or foreign machines return
// null instead, so they answer 404.
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
