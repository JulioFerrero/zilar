import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { type MachinePairingCodeRow, type MachineRow } from '../db/rows';
import { isUniqueViolation } from '../effect/error-utils';
import { runSql } from '../effect/sql';
import {
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  PAIRING_CODE_TTL_MS,
} from './codes';
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

export async function countActivePairingCodes(
  db: ServerDatabase,
  ownerUserId: string,
  now: Date,
): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM machine_pairing_codes
        WHERE owner_user_id = ${ownerUserId} AND used_at IS NULL AND expires_at > ${now}`;
    }),
  );
  return Number(row?.total ?? 0);
}

export async function createPairingCode(
  db: ServerDatabase,
  ownerUserId: string,
  now: Date,
): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  // The count and insert share one transaction under a per-owner lock, so
  // parallel requests cannot both slip under the cap.
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'machines:' + ownerUserId}))`;
          const [active] = yield* sql<{ total: number }>`SELECT count(*)::int AS total
            FROM machine_pairing_codes
            WHERE owner_user_id = ${ownerUserId} AND used_at IS NULL AND expires_at > ${now}`;
          if (Number(active?.total ?? 0) >= MAX_PAIRING_CODES_PER_USER) {
            return yield* Effect.fail(
              new MachineServiceError(
                'pairing_code_limit',
                `At most ${MAX_PAIRING_CODES_PER_USER} unused pairing codes per user`,
              ),
            );
          }
          // A hash collision resolves to a fresh code; the unique constraint makes
          // the retry mandatory.
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const code = generatePairingCode();
            const normalized = normalizePairingCode(code);
            if (normalized === null) {
              return yield* Effect.die(new Error('Generated an invalid pairing code'));
            }
            const [row] = yield* sql<MachinePairingCodeRow>`INSERT INTO machine_pairing_codes
                (id, owner_user_id, code_hash, expires_at)
              VALUES (${randomUUID()}, ${ownerUserId}, ${hashPairingCode(normalized)}, ${expiresAt})
              ON CONFLICT DO NOTHING
              RETURNING *`;
            if (row) {
              return { code, expiresAt };
            }
          }
          return yield* Effect.die(new Error('Could not generate a unique pairing code'));
        }),
      );
    }),
  );
}

// Marks a code used only while unused and unexpired; two concurrent requests
// yield exactly one row, and the loser sees null.
export async function consumePairingCode(
  db: ServerDatabase,
  codeHash: string,
  now: Date,
): Promise<MachinePairingCodeRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachinePairingCodeRow>`UPDATE machine_pairing_codes
        SET used_at = ${now}
        WHERE code_hash = ${codeHash} AND used_at IS NULL AND expires_at > ${now}
        RETURNING *`;
    }),
  );
  return row ?? null;
}

interface PairMachineInput {
  ownerUserId: string;
  name: string;
  publicKey: string;
  capabilities: Record<string, unknown>;
}

// Inserts as `pending`: quotas and insert share one transaction under a
// per-owner lock. A duplicate public key, including one on a revoked row, fails
// with `key_in_use`.
export async function insertPendingMachine(
  db: ServerDatabase,
  input: PairMachineInput,
): Promise<MachineRow> {
  try {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(hashtext(${'machines:' + input.ownerUserId}))`;
            const [counts] = yield* sql<{ total: number; pending: number }>`
              SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'pending')::int AS pending
              FROM machines WHERE owner_user_id = ${input.ownerUserId}`;
            if (Number(counts?.total ?? 0) >= MAX_MACHINES_PER_USER) {
              return yield* Effect.fail(
                new MachineServiceError(
                  'machine_limit',
                  `At most ${MAX_MACHINES_PER_USER} machines per user`,
                ),
              );
            }
            if (Number(counts?.pending ?? 0) >= MAX_PENDING_MACHINES_PER_USER) {
              return yield* Effect.fail(
                new MachineServiceError(
                  'pending_limit',
                  `At most ${MAX_PENDING_MACHINES_PER_USER} pending machines per user`,
                ),
              );
            }
            return yield* sql<MachineRow>`INSERT INTO machines
                (id, owner_user_id, name, public_key, capabilities, status)
              VALUES (
                ${randomUUID()},
                ${input.ownerUserId},
                ${input.name},
                ${input.publicKey},
                ${JSON.stringify(input.capabilities)}::jsonb,
                'pending'
              )
              RETURNING *`;
          }),
        );
      }),
    );
    if (!row) {
      throw new Error('Failed to create machine');
    }
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new MachineServiceError(
        'key_in_use',
        'This public key is already registered to a machine',
      );
    }
    throw error;
  }
}
