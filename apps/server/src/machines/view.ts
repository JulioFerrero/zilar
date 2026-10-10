import type { MachineRow } from '../db/rows';
import { fingerprintOfPublicKey } from './crypto';
import type { MachineStatus } from './service';

// The owner-facing shape. The public key is never returned: `fingerprint`
// (the first 16 hex chars of sha256(public key bytes)) lets the owner compare
// the machine with what the runner shows locally. `online` is true only
// when the runner hub is on and the machine has a live tunnel connection.
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
