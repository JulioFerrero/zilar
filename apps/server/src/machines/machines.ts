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

// The hub refreshes its cache from this; nothing else needs the view.
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

// A missing id and a foreign one both answer null, so existence is never leaked.
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

// Permanent: the row stays `revoked` (reserving the key) and the machine must
// pair again with a new key. Any AI pointing at it is cleared in the same
// transaction, so the UI never shows a revoked machine as a home.
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

// An approved machine must be revoked first, so its live connections close
// before the row goes.
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
