// The user's IANA time zone (T-1440). It lives in `user_profiles` beside the
// bio, outside Better Auth's `user` table. The zone never reaches a log: only
// these helpers touch it, and none logs.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { runSql } from '../effect/sql';

/** True for a valid IANA zone at most 64 characters long. */
export function isValidTimeZone(timeZone: string): boolean {
  if (timeZone.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Upserts the zone; callers validate it first. */
export async function upsertProfileTimeZone(
  db: ServerDatabase,
  userId: string,
  timeZone: string,
): Promise<void> {
  await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO user_profiles (user_id, time_zone, updated_at)
        VALUES (${userId}, ${timeZone}, now())
        ON CONFLICT (user_id) DO UPDATE SET
          time_zone = EXCLUDED.time_zone,
          updated_at = now()`;
    }),
  );
}

/**
 * The zone, or null when the user has no profile row or none stored. A LEFT
 * JOIN is not needed: a missing `user_profiles` row means no zone.
 */
export async function timeZoneFor(db: ServerDatabase, userId: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ timeZone: string | null }>`SELECT time_zone AS "timeZone"
        FROM user_profiles WHERE user_id = ${userId} LIMIT 1`;
    }),
  );
  return row?.timeZone ?? null;
}

/**
 * The zone of the user whose XMPP JID is `jid` (the group turn's sender), or
 * null when the sender is not a user (an AI, a stranger, an unresolved nick).
 * The JID must be the bare, lowercase form the rest of the gateway uses.
 */
export async function timeZoneForJid(db: ServerDatabase, jid: string): Promise<string | null> {
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ timeZone: string | null }>`SELECT p.time_zone AS "timeZone"
        FROM xmpp_accounts a JOIN user_profiles p ON p.user_id = a.user_id
        WHERE a.jid = ${jid} LIMIT 1`;
    }),
  );
  return row?.timeZone ?? null;
}
