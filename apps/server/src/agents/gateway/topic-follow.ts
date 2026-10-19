import { Cause, Effect } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { messageOf } from '../../effect/error-utils';
import { runSql } from '../../effect/sql';
import { bareJid } from '../../jid';

// How long a room's follower lookup is cached. The follower changes rarely, and
// a followed room reads it on every message, so a short cache keeps the fan-out
// across the room's AI sessions cheap.
const FOLLOW_CACHE_TTL_MS = 15_000;

// Cap on cached rooms so a busy server cannot grow the map without bound. The
// oldest entry is evicted when a new room would exceed it.
const FOLLOW_CACHE_MAX = 2_000;

interface FollowCacheEntry {
  aiId: string | null;
  atMs: number;
}

const followCache = new Map<string, FollowCacheEntry>();

// Rooms where this AI paused following, keyed by AI id. The durable copy lives
// in `topics.follow_paused_at`; this map is the in-memory copy that keeps
// `isFollowPaused` synchronous on the message path, with the durable copy in
// `topics.follow_paused_at`.
const pausedFollows = new Map<string, Set<string>>();

let pauseDb: ServerDatabase | undefined;

// A topic, a claim or a Stop can all name the room by its JID or by its
// localpart; both reduce to the localpart the `topics` row keys on.
function roomLocalpart(roomJid: string): string {
  return bareJid(roomJid).split('@')[0] ?? '';
}

export function invalidateTopicFollow(roomLocalpart: string): void {
  followCache.delete(roomLocalpart);
}

export async function followingAiFor(db: ServerDatabase, roomJid: string): Promise<string | null> {
  const localpart = roomLocalpart(roomJid);
  const cached = followCache.get(localpart);
  if (cached !== undefined && Date.now() - cached.atMs < FOLLOW_CACHE_TTL_MS) {
    return cached.aiId;
  }
  const [row] = await runSql(
    db,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ followerAiId: string | null }>`
        SELECT follower_ai_id FROM topics
        WHERE room_localpart = ${localpart} AND archived_at IS NULL
          AND is_general = false
        LIMIT 1`;
    }),
  );
  const aiId = row?.followerAiId ?? null;
  rememberRoom(localpart, aiId);
  return aiId;
}

function rememberRoom(localpart: string, aiId: string | null): void {
  if (!followCache.has(localpart) && followCache.size >= FOLLOW_CACHE_MAX) {
    const oldest = followCache.keys().next().value;
    if (oldest !== undefined) {
      followCache.delete(oldest);
    }
  }
  followCache.set(localpart, { aiId, atMs: Date.now() });
}

/**
 * Remembers the database that later pauses and resumes are saved through, then
 * loads every saved Stop pause into memory. The gateway calls this once at
 * start; a test calls it again, after {@link resetTopicFollowStateForTests}, to
 * simulate a restart. A failed load is the caller's to log: it must not block
 * start, and without it the room simply follows again until the next Stop.
 */
export async function initTopicFollow(database: ServerDatabase): Promise<void> {
  pauseDb = database;
  const rows = await runSql(
    database,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql<{ followerAiId: string | null; roomLocalpart: string }>`
        SELECT follower_ai_id, room_localpart FROM topics
        WHERE follow_paused_at IS NOT NULL AND follower_ai_id IS NOT NULL
          AND archived_at IS NULL AND is_general = false`;
    }),
  );
  for (const row of rows) {
    if (row.followerAiId === null) {
      continue;
    }
    const rooms = pausedFollows.get(row.followerAiId) ?? new Set<string>();
    rooms.add(row.roomLocalpart);
    pausedFollows.set(row.followerAiId, rooms);
  }
}

export function resetTopicFollowStateForTests(): void {
  followCache.clear();
  pausedFollows.clear();
  pauseDb = undefined;
}

/** Stops the AI following this room until it is mentioned again. */
export function pauseFollow(aiId: string, roomJid: string): Promise<void> {
  const localpart = roomLocalpart(roomJid);
  const rooms = pausedFollows.get(aiId) ?? new Set<string>();
  rooms.add(localpart);
  pausedFollows.set(aiId, rooms);
  // The in-memory pause is set above; the write is fire-and-forget so a message
  // path never waits on it, and `saveFollowChange` swallows a failure.
  return saveFollowChange(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE topics SET follow_paused_at = now()
        WHERE room_localpart = ${localpart} AND follower_ai_id = ${aiId}`;
    }),
  );
}

export function resumeFollow(aiId: string, roomJid: string): Promise<void> {
  const rooms = pausedFollows.get(aiId);
  if (rooms === undefined) {
    return Promise.resolve();
  }
  const localpart = roomLocalpart(roomJid);
  rooms.delete(localpart);
  if (rooms.size === 0) {
    pausedFollows.delete(aiId);
  }
  return saveFollowChange(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE topics SET follow_paused_at = NULL
        WHERE room_localpart = ${localpart} AND follower_ai_id = ${aiId}
          AND follow_paused_at IS NOT NULL`;
    }),
  );
}

/**
 * Makes an AI the topic's follower and clears any Stop pause, so a person's
 * @mention or reply moves following to that AI. The write is fire-and-forget;
 * General is never followed.
 */
export function setTopicFollower(roomJid: string, aiId: string): Promise<void> {
  const localpart = roomLocalpart(roomJid);
  const rooms = pausedFollows.get(aiId);
  if (rooms !== undefined) {
    rooms.delete(localpart);
    if (rooms.size === 0) {
      pausedFollows.delete(aiId);
    }
  }
  // Drop the cached lookup rather than writing the new follower into it. A
  // mention in the General topic must not be cached as its follower — the
  // `is_general = false` guard only runs on the read — and the fire-and-forget
  // write may still be in flight, so the next plain message re-reads the row.
  invalidateTopicFollow(localpart);
  return saveFollowChange(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE topics SET follower_ai_id = ${aiId}, follow_paused_at = NULL
        WHERE room_localpart = ${localpart} AND archived_at IS NULL
          AND is_general = false`;
    }),
  );
}

/**
 * Saves one pause or resume when the gateway has a database, and resolves
 * either way so callers can keep `void`ing it; a failure is logged and never
 * throws into the message path.
 */
function saveFollowChange(
  statement: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient>,
): Promise<void> {
  if (pauseDb === undefined) {
    return Promise.resolve();
  }
  const logged = statement.pipe(Effect.catchCause((cause) => logNotSaved(Cause.pretty(cause))));
  try {
    return runSql(pauseDb, logged);
  } catch (error) {
    // `runSql` throws when the database has no registered runtime (a disposed
    // one, or a db this module never started against); log and carry on.
    Effect.runSync(logNotSaved(messageOf(error)));
    return Promise.resolve();
  }
}

function logNotSaved(detail: string): Effect.Effect<void> {
  return Effect.logWarning(`topic follow pause was not saved: ${detail}`);
}

export function isFollowPaused(aiId: string, roomJid: string): boolean {
  return pausedFollows.get(aiId)?.has(roomLocalpart(roomJid)) ?? false;
}
