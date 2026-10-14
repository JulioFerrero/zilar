// People prefix search (T-1148, T-1286): Telegram-style lookup by
// `@username` only, used by the chat-list search. T-1286 (SG-7) dropped the
// display-name clauses, which let anyone enumerate every user by name; a
// query now matches an exact handle or a handle prefix. Only users with a
// handle are returned, unknown handles are not, and a person who blocked the
// viewer is never listed. The query is never logged.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';
import { normalizeHandle } from '../handles/rules';
import { relationFor, relationsFor, type OtherUserProfile } from './reads';

export const USER_SEARCH_MIN_LENGTH = 3;
export const USER_SEARCH_LIMIT = 10;

export type HandleRelation = Awaited<ReturnType<typeof relationFor>>;

export type UserSearchEntry = OtherUserProfile & { relation: HandleRelation };

// `%`, `_` and the escape char in a query are literal text, never wildcards.
// PostgreSQL `LIKE` treats backslash as the escape by default, so no `ESCAPE`
// clause is needed (same rule as the directory search).
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// Trims, strips one leading `@` and lowercases. Under 3 characters there is
// nothing to search: `[]` without a round trip.
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
      // T-1286 (SG-7): matches an exact handle or a handle prefix only —
      // never a display name, which let the whole user base be enumerated.
      // Exact handle first, then handle prefix, tied by display name. The
      // viewer and anyone who blocked the viewer (silently, like
      // `profileForHandle`) are excluded.
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
  // SG-7 (T-1437): one batched read for every row's relation instead of one
  // `relationFor` round trip per row. The output order and content stay the
  // same; a row's relation is what `relationFor` would return for it.
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
