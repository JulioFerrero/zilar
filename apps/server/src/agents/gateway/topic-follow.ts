// T-1448 (UX Task I): an AI assigned as a topic's owner follows that topic.
// Every new human message there reaches it with no `@`, until the owner changes
// or the owner presses Stop. The room's owner is read from the `topics` row by
// room localpart, cached briefly because a busy followed room asks on every
// message. The pause set is in memory only: a server restart clears it, and a
// followed room simply starts following again.
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
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

// Rooms where this AI paused following, keyed by AI id. In memory only: a
// restart clears every pause, and the next message follows again until Stop.
const pausedFollows = new Map<string, Set<string>>();

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

/** Stops the AI following this room until it is mentioned again. */
export function pauseFollow(aiId: string, roomJid: string): void {
  const localpart = roomLocalpart(roomJid);
  const rooms = pausedFollows.get(aiId) ?? new Set<string>();
  rooms.add(localpart);
  pausedFollows.set(aiId, rooms);
}

/** Restarts following for the AI in this room. */
export function resumeFollow(aiId: string, roomJid: string): void {
  const rooms = pausedFollows.get(aiId);
  if (rooms === undefined) {
    return;
  }
  rooms.delete(roomLocalpart(roomJid));
  if (rooms.size === 0) {
    pausedFollows.delete(aiId);
  }
}

/** Whether the AI has stopped following this room. */
export function isFollowPaused(aiId: string, roomJid: string): boolean {
  return pausedFollows.get(aiId)?.has(roomLocalpart(roomJid)) ?? false;
}
