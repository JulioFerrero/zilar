// The owner is stored once under `instance.owner_user_id` instead of being re-derived as
// the oldest user, so deleting or recreating accounts cannot move ownership. The first
// check claims the oldest user under the setup advisory lock; the id never changes after.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { takeSetupLockEffect } from './settings';

export const INSTANCE_OWNER_SETTING = 'instance.owner_user_id';

interface InstanceSettingRow {
  value: string;
}

type OwnerLogger = { warn: (fields: Record<string, unknown>, message: string) => void };

function readStoredOwnerEffect(): Effect.Effect<
  string | null,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<InstanceSettingRow>`SELECT value FROM instance_settings
      WHERE key = ${INSTANCE_OWNER_SETTING} LIMIT 1`;
    return row?.value ?? null;
  });
}

// The oldest user, the id as the tiebreak. `"user"` is a reserved word, so it stays quoted.
function oldestUserIdEffect(): Effect.Effect<
  string | null,
  SqlError.SqlError,
  SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{ id: string }>`SELECT id FROM "user"
      ORDER BY created_at ASC, id ASC LIMIT 1`;
    return row?.id ?? null;
  });
}

// The state is read INSIDE the setup lock, so two concurrent first checks cannot store
// different ids; the insert is idempotent as the backstop.
function claimOwnerEffect(): Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* takeSetupLockEffect();
        const existing = yield* readStoredOwnerEffect();
        if (existing !== null) {
          return existing;
        }
        const oldest = yield* oldestUserIdEffect();
        if (oldest === null) {
          return null;
        }
        yield* sql`INSERT INTO instance_settings (key, value)
          VALUES (${INSTANCE_OWNER_SETTING}, ${oldest})
          ON CONFLICT (key) DO NOTHING`;
        return oldest;
      }),
    );
  });
}

/** The stored owner, claiming the oldest user on first call; null (and no write) with
 * no users. */
export function instanceOwnerId(db: ServerDatabase): Promise<string | null> {
  return runSql(
    db,
    Effect.gen(function* () {
      const stored = yield* readStoredOwnerEffect();
      if (stored !== null) {
        return stored;
      }
      return yield* claimOwnerEffect();
    }),
  );
}

function userExistsEffect(
  userId: string,
): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ id: string }>`SELECT id FROM "user" WHERE id = ${userId} LIMIT 1`;
    return rows.length > 0;
  });
}

/**
 * The stored id never changes: when that user no longer exists nobody owns the instance
 * (one warn, ids only, no fallback to the next-oldest account).
 */
export async function isInstanceOwner(
  db: ServerDatabase,
  userId: string,
  logger?: OwnerLogger,
): Promise<boolean> {
  const ownerId = await instanceOwnerId(db);
  if (ownerId === null) {
    return false;
  }
  const ownerExists = await runSql(db, userExistsEffect(ownerId));
  if (!ownerExists) {
    logger?.warn(
      { ownerUserId: ownerId, userId },
      'the stored instance owner no longer exists; nobody owns this instance',
    );
    return false;
  }
  return ownerId === userId;
}
