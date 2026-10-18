import { type MachineRow } from '../db/rows';
import { fingerprintOfPublicKey } from './crypto';
// The public key is never returned: `fingerprint` (16 hex chars of its sha256)
// lets the owner compare. `online` needs both the hub and a live tunnel.
export interface PublicMachine {
  id: string;
  name: string;
  status: MachineStatus;
  os: string;
  osVersion: string;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  diskFreeGb: number;
  drivers: string[];
  fingerprint: string;
  online: boolean;
  createdAt: Date;
  approvedAt: Date | null;
  lastSeenAt: Date | null;
}

export function toPublicMachine(
  row: MachineRow,
  isOnline?: (machineId: string) => boolean,
): PublicMachine {
  const capabilities = row.capabilities;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    os: asString(capabilities['os']),
    osVersion: asString(capabilities['os_version']),
    arch: asString(capabilities['arch']),
    cpu: asString(capabilities['cpu']),
    cores: asNumber(capabilities['cores']),
    ramGb: asNumber(capabilities['ram_gb']),
    diskFreeGb: asNumber(capabilities['disk_free_gb']),
    drivers: asStringArray(capabilities['drivers']),
    fingerprint: fingerprintOfPublicKey(row.publicKey),
    online: isOnline?.(row.id) ?? false,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    lastSeenAt: row.lastSeenAt,
  };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

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
