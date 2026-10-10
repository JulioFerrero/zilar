import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import type { MachineRow } from '../db/rows';
import { runSql } from '../effect/sql';

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
