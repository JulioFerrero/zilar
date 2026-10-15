// T-1448 (UX Task I): an AI assigned as a topic's owner follows that topic.
// Every new human message there reaches it with no `@`, until the owner changes
// or the owner presses Stop. The room's owner is read from the `topics` row by
// room localpart, cached briefly because a busy followed room asks on every
// message. T-1493: a Stop pause is saved in `topics.follow_paused_at` and
// reloaded at start, so a restart or a deploy never resumes following on its own.
import { Cause, Effect } from 'effect';
import { SqlClient, type SqlError } from 'effect/sql';
import type { ServerDatabase } from '../../db/client';
import { runSql } from '../../effect/sql';
import { bareJid } from '../../jid';

// How long a room's owner lookup is cached. The owner changes rarely, and a
// followed room reads it on every message, so a short cache keeps the fan-out
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
// `isFollowPaused` synchronous on the message path (T-1493).
const pausedFollows = new Map<string, Set<string>>();

// The database `initTopicFollow` was handed, used to save every pause and
// resume. It stays `undefined` until start (or a test) calls `initTopicFollow`;
// until then a pause is kept in memory only.
let pauseDb: ServerDatabase | undefined;

// A topic, a claim or a Stop can all name the room by its JID or by its
// localpart; both reduce to the localpart the `topics` row keys on.
function roomLocalpart(roomJid: string): string {
  return bareJid(roomJid).split('@')[0] ?? '';
}

/** Forgets a room's cached owner after its topic changes. */
export function invalidateTopicFollow(roomLocalpart: string): void {
  followCache.delete(roomLocalpart);
}

/**
 * The AI that owns the non-archived topic behind this room, or `null` when no
 * topic owns it. Cached for {@link FOLLOW_CACHE_TTL_MS}.
 */
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
      return yield* sql<{ ownerAiId: string | null }>`
        SELECT owner_ai_id FROM topics
        WHERE room_localpart = ${localpart} AND archived_at IS NULL
        LIMIT 1`;
    }),
  );
  const aiId = row?.ownerAiId ?? null;
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
      return yield* sql<{ ownerAiId: string | null; roomLocalpart: string }>`
        SELECT owner_ai_id, room_localpart FROM topics
        WHERE follow_paused_at IS NOT NULL AND owner_ai_id IS NOT NULL AND archived_at IS NULL`;
    }),
  );
  for (const row of rows) {
    if (row.ownerAiId === null) {
      continue;
    }
    const rooms = pausedFollows.get(row.ownerAiId) ?? new Set<string>();
    rooms.add(row.roomLocalpart);
    pausedFollows.set(row.ownerAiId, rooms);
  }
}

/**
 * Forgets the in-memory state (the saved rows in `topics` stay), so a test can
 * reload the pauses the way a restart does. Not called from server code.
 */
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
        WHERE room_localpart = ${localpart} AND owner_ai_id = ${aiId}`;
    }),
  );
}

/** Restarts following for the AI in this room. */
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
        WHERE room_localpart = ${localpart} AND owner_ai_id = ${aiId}
          AND follow_paused_at IS NOT NULL`;
    }),
  );
}

/**
 * Saves one pause or resume when the gateway has a database, and resolves either
 * way so the callers can keep `void`ing it. A failure is logged like the
 * swallowed failure in `effect/sql.ts`; it never throws into the message path.
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the AI has stopped following this room. */
export function isFollowPaused(aiId: string, roomJid: string): boolean {
  return pausedFollows.get(aiId)?.has(roomLocalpart(roomJid)) ?? false;
}
