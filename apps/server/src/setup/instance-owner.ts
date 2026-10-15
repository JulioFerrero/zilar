// Instance owner (SEC-12). The owner is stored once in `instance_settings`
// under `instance.owner_user_id`, instead of being re-derived as the oldest
// `user` row on every check: deleting or recreating accounts can therefore
// not move ownership of the integrations and voice settings. The first check
// claims the oldest user under the setup advisory lock (see
// `takeSetupLockEffect`), which serializes the race across processes; the
// stored id never changes afterwards.

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

// Today's definition of the owner: the oldest user, the id as the tiebreak.
// `"user"` is a reserved word, so it stays quoted.
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

// Claims the oldest user as the owner exactly once. The state is read INSIDE
// the setup lock, so two concurrent first checks cannot store different ids;
// the insert is idempotent (`on conflict do nothing`) as the backstop.
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

/**
 * The stored instance owner, claiming the oldest user on the first call and
 * reusing it afterwards. With no users at all it returns null and stores
 * nothing.
 */
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
 * Whether `userId` is the stored instance owner. The stored id never changes:
 * when that user no longer exists nobody owns the instance (one warn, ids
 * only, no fallback to the next-oldest account).
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
