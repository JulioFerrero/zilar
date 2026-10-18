// Telegram-style lookup by `@username` only: an exact handle or a handle prefix.
// Display-name search was dropped because it let anyone enumerate every user.
// Only users with a handle are returned, a blocker is never listed, and the
// query is never logged.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { normalizeHandle } from '@zilar/protocol';
import { relationFor, relationsFor, type OtherUserProfile } from './reads';

export const USER_SEARCH_MIN_LENGTH = 3;
export const USER_SEARCH_LIMIT = 10;

export type HandleRelation = Awaited<ReturnType<typeof relationFor>>;

export type UserSearchEntry = OtherUserProfile & { relation: HandleRelation };

// `%`, `_` and the escape char are literal text; PostgreSQL `LIKE` treats
// backslash as the escape by default, so no `ESCAPE` clause is needed.
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export function normalizeUserSearchQuery(query: string): string {
  const trimmed = query.trim();
  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return normalizeHandle(withoutAt);
}

export async function searchUsers(
  db: ServerDatabase,
  viewerId: string,
  query: string,
): Promise<UserSearchEntry[]> {
  const q = normalizeUserSearchQuery(query);
  if (q.length < USER_SEARCH_MIN_LENGTH) {
    return [];
  }
  const pattern = escapeLike(q);
  const rows = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // Exact handle or handle prefix only, never a display name, which would let
      // the whole user base be enumerated. The viewer and a blocker are excluded.
      return yield* sql<{
        userId: string;
        handle: string;
        name: string;
        image: string | null;
      }>`SELECT h.user_id, h.handle, u.name, u.image
        FROM handles h
        INNER JOIN "user" u ON u.id = h.user_id
        WHERE u.id <> ${viewerId}
          AND NOT EXISTS (
            SELECT 1 FROM user_blocks b
            WHERE b.user_id = u.id AND b.blocked_user_id = ${viewerId}
          )
          AND h.handle_lower LIKE ${pattern + '%'}
        ORDER BY
          CASE WHEN h.handle_lower = ${q} THEN 0 ELSE 1 END,
          u.name
        LIMIT ${USER_SEARCH_LIMIT}`;
    }),
  );
  // One batched read for every row's relation instead of a round trip per row.
  const relations = await relationsFor(
    db,
    viewerId,
    rows.map((row) => row.userId),
  );
  const entries: UserSearchEntry[] = rows.map((row) => ({
    userId: row.userId,
    name: row.name.trim() === '' ? 'Unnamed user' : row.name,
    handle: row.handle,
    image: row.image,
    relation: relations.get(row.userId) ?? 'none',
  }));
  return entries;
}
