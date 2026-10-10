import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { MachinePairingCodeRow, MachineRow } from '../db/rows';
import { sqlRuntimeFor } from '../effect/sql';
import {
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  pairingSignatureMessage,
  PAIRING_CODE_TTL_MS,
} from './codes';

export const MAX_PAIRING_CODES_PER_USER = 5;
export const MAX_MACHINES_PER_USER = 20;
export const MAX_PENDING_MACHINES_PER_USER = 5;

export type { MachineRow };
export type MachineStatus = 'pending' | 'approved' | 'revoked';

// Every query runs on the `effect/sql` client registered for this database
// (see `../effect/sql`). The exported functions stay `async` so routes and
// tests keep their shape during the transition.
function runSql<A, E>(
  db: ServerDatabase,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Promise<A> {
  return sqlRuntimeFor(db).runPromise(effect);
}

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

export function fingerprintOfPublicKey(publicKeyBase64: string): string {
  return createHash('sha256')
    .update(Buffer.from(publicKeyBase64, 'base64'))
    .digest('hex')
    .slice(0, 16);
}

// Proof-of-possession check: `signature` must be an ed25519 signature by
// `publicKey` over `zilar-pair:v1:<NORMALIZED_CODE>`. Returns false (never
// throws) for a malformed key, a malformed signature, or a signature over
// anything else — including someone else's public key.
export function verifyPairingSignature(
  publicKeyBase64: string,
  signatureBase64: string,
  normalizedCode: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length === 0) {
      return false;
    }
    return verify(null, pairingSignatureMessage(normalizedCode), key, signature);
  } catch {
    return false;
  }
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

export async function countMachines(db: ServerDatabase, ownerUserId: string): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM machines WHERE owner_user_id = ${ownerUserId}`;
    }),
  );
  return Number(row?.total ?? 0);
}

export async function countPendingMachines(
  db: ServerDatabase,
  ownerUserId: string,
): Promise<number> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ total: number }>`SELECT count(*)::int AS total
        FROM machines WHERE owner_user_id = ${ownerUserId} AND status = 'pending'`;
    }),
  );
  return Number(row?.total ?? 0);
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

export async function listMachines(db: ServerDatabase, ownerUserId: string): Promise<MachineRow[]> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`SELECT * FROM machines
        WHERE owner_user_id = ${ownerUserId}
        ORDER BY created_at`;
    }),
  );
  return [...rows];
}

// The full set of approved (machine id, public key) pairs. Used by the hub
// to refresh its in-memory cache; nothing else needs this view.
export async function listApprovedMachineKeys(
  db: ServerDatabase,
): Promise<Array<{ id: string; publicKey: string }>> {
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ id: string; publicKey: string }>`SELECT id, public_key FROM machines
        WHERE status = 'approved'`;
    }),
  );
  return [...rows];
}

// Looks up one machine owned by `ownerUserId`. Returns null for a missing id
// and for an id owned by someone else alike, so existence is never leaked.
export async function findOwnedMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
): Promise<MachineRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`SELECT * FROM machines
        WHERE id = ${id} AND owner_user_id = ${ownerUserId} LIMIT 1`;
    }),
  );
  return row ?? null;
}

export async function approveMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
  now: Date,
): Promise<MachineRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`UPDATE machines
        SET status = 'approved', approved_at = ${now}
        WHERE id = ${id} AND owner_user_id = ${ownerUserId} AND status = 'pending'
        RETURNING *`;
    }),
  );
  return row ?? null;
}

export async function denyMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`DELETE FROM machines
        WHERE id = ${id} AND owner_user_id = ${ownerUserId} AND status = 'pending'
        RETURNING *`;
    }),
  );
  return row !== undefined;
}

// Revocation is permanent: the row stays `revoked` (keeping the public key
// reserved) and the machine must pair again with a new key. T-0091: the
// `machine_id` on any AI that pointed at it must be cleared in the same
// transaction, so the UI can never leave a revoked machine displayed as an
// AI's home. `SET NULL` on the FK handles the rarer "delete the row"
// case automatically.
export async function revokeMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
  now: Date,
): Promise<MachineRow | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const [row] = yield* sql<MachineRow>`UPDATE machines
            SET status = 'revoked', revoked_at = ${now}
            WHERE id = ${id} AND owner_user_id = ${ownerUserId}
              AND (status = 'approved' OR status = 'pending')
            RETURNING *`;
          if (row !== undefined) {
            yield* sql`UPDATE ais SET machine_id = NULL, updated_at = ${now}
              WHERE machine_id = ${id}`;
          }
          return row ?? null;
        }),
      );
    }),
  );
}

export async function renameMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
  name: string,
): Promise<MachineRow | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`UPDATE machines
        SET name = ${name}
        WHERE id = ${id} AND owner_user_id = ${ownerUserId}
        RETURNING *`;
    }),
  );
  return row ?? null;
}

// Only pending and revoked machines can be deleted; an approved machine must
// be revoked first so its live connections are closed before the row goes.
export async function deleteMachine(
  db: ServerDatabase,
  id: string,
  ownerUserId: string,
): Promise<boolean> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<MachineRow>`DELETE FROM machines
        WHERE id = ${id} AND owner_user_id = ${ownerUserId}
          AND (status = 'pending' OR status = 'revoked')
        RETURNING *`;
    }),
  );
  return row !== undefined;
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
