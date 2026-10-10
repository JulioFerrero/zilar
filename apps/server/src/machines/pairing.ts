import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { MachinePairingCodeRow, MachineRow } from '../db/rows';
import { runSql } from '../effect/sql';
import {
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  PAIRING_CODE_TTL_MS,
} from './codes';
import { countMachines, countPendingMachines } from './machines';
import {
  MachineServiceError,
  MAX_MACHINES_PER_USER,
  MAX_PAIRING_CODES_PER_USER,
  MAX_PENDING_MACHINES_PER_USER,
} from './service';

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
  const active = await countActivePairingCodes(db, ownerUserId, now);
  if (active >= MAX_PAIRING_CODES_PER_USER) {
    throw new MachineServiceError(
      'pairing_code_limit',
      `At most ${MAX_PAIRING_CODES_PER_USER} unused pairing codes per user`,
    );
  }
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  // A hash collision resolves to a fresh code; with 64 bits of entropy it
  // will not happen, but the unique constraint makes a retry mandatory.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePairingCode();
    const normalized = normalizePairingCode(code);
    if (normalized === null) {
      throw new Error('Generated an invalid pairing code');
    }
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        return yield* sql<MachinePairingCodeRow>`INSERT INTO machine_pairing_codes
            (id, owner_user_id, code_hash, expires_at)
          VALUES (${randomUUID()}, ${ownerUserId}, ${hashPairingCode(normalized)}, ${expiresAt})
          ON CONFLICT DO NOTHING
          RETURNING *`;
      }),
    );
    if (row) {
      return { code, expiresAt };
    }
  }
  throw new Error('Could not generate a unique pairing code');
}

// Atomically consumes a code: marks it used only when it is still unused and
// unexpired, and returns the row. Two concurrent requests for one code yield
// exactly one row; the loser sees null.
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

export interface PairMachineInput {
  ownerUserId: string;
  name: string;
  publicKey: string;
  capabilities: Record<string, unknown>;
}

// Inserts the machine as `pending`. Quotas are checked here so concurrent
// pairs cannot both slip under the caps; a duplicate public key — including
// one on a revoked machine, whose row is kept — fails with `key_in_use`.
export async function insertPendingMachine(
  db: ServerDatabase,
  input: PairMachineInput,
): Promise<MachineRow> {
  const [total, pending] = await Promise.all([
    countMachines(db, input.ownerUserId),
    countPendingMachines(db, input.ownerUserId),
  ]);
  if (total >= MAX_MACHINES_PER_USER) {
    throw new MachineServiceError(
      'machine_limit',
      `At most ${MAX_MACHINES_PER_USER} machines per user`,
    );
  }
  if (pending >= MAX_PENDING_MACHINES_PER_USER) {
    throw new MachineServiceError(
      'pending_limit',
      `At most ${MAX_PENDING_MACHINES_PER_USER} pending machines per user`,
    );
  }
  try {
    const [row] = await runSql(
      db,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
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

// `effect/sql` wraps driver failures in `SqlError` and exposes the structured
// `UniqueViolation` reason; accept that or a plain `{ code: '23505' }` error
// (plain driver errors and the recovery tests' doubles). Matched by
// code/constraint, never by message text.
function isUniqueViolation(error: unknown): boolean {
  if (error instanceof SqlError.SqlError) {
    return error.reason._tag === 'UniqueViolation';
  }
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return false;
    }
    const record = current as { code?: unknown; cause?: unknown };
    if (record.code === '23505') {
      return true;
    }
    if (!('cause' in record)) {
      return false;
    }
    current = record.cause;
  }
  return false;
}
