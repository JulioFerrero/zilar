// A member removed by an owner/admin is banned, so they cannot walk back in
// through a public join or a still-valid invite; adding them back lifts it,
// leaving never bans.

import { Effect } from 'effect';
import { SqlClient, SqlError } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

// Whether the group banned this user; unknown groups answer false, and
// callers treat unknown as not found first.
export async function isBanned(
  db: ServerDatabase,
  groupId: string,
  userId: string,
): Promise<boolean> {
  return runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* isBannedIn(sql, groupId, userId);
    }),
  );
}

// The same check on a caller's connection, so a join re-checks inside its
// transaction and a removal cannot slip between check and insert.
export function isBannedIn(
  sql: SqlClient.SqlClient,
  groupId: string,
  userId: string,
): Effect.Effect<boolean, SqlError.SqlError> {
  return Effect.gen(function* () {
    const [row] = yield* sql<{ userId: string }>`SELECT user_id FROM group_bans
      WHERE group_id = ${groupId} AND user_id = ${userId} LIMIT 1`;
    return row !== undefined;
  });
}

// Bans a removed member. Idempotent: a second removal keeps one row.
export function banMember(
  sql: SqlClient.SqlClient,
  groupId: string,
  userId: string,
  bannedBy: string,
): Effect.Effect<void, SqlError.SqlError> {
  return Effect.gen(function* () {
    yield* sql`INSERT INTO group_bans (group_id, user_id, banned_by)
      VALUES (${groupId}, ${userId}, ${bannedBy})
      ON CONFLICT (group_id, user_id) DO NOTHING`;
  });
}

// Lifts the bans of the people an owner or admin adds back.
export function unbanMembers(
  sql: SqlClient.SqlClient,
  groupId: string,
  userIds: string[],
): Effect.Effect<void, SqlError.SqlError> {
  return Effect.gen(function* () {
    if (userIds.length === 0) {
      return;
    }
    yield* sql`DELETE FROM group_bans
      WHERE group_id = ${groupId} AND user_id IN ${sql.in(userIds)}`;
  });
}
