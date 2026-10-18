import { Duration, Effect, type Effect as EffectType } from 'effect';
import { type ArchivePool, type SearchOwner } from '../search/service';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { liveAiUiIds } from '../notify/ai-cards';
import { albumKey } from './album-key';
import { cachedAllowedArchives } from './archives-cache';
import { resolveCandidate } from './candidates';
import type { ResolvedPushMessage } from './payload';
import { ArchiveUnavailable, type PushServiceDeps } from './service';

// How many of the newest archived rows to scan per attempt, and how often to
// re-read before giving up (the publish IQ can win the race with the MAM
// write).
const ARCHIVE_CANDIDATES = 25;
const ARCHIVE_LOOKUP_ATTEMPTS = 3;
const ARCHIVE_LOOKUP_RETRY_MS = 300;
// Only rows this fresh are notified: an older message must not be re-pushed
// by a later typing state, presence or keepalive wake.
const ARCHIVE_FRESH_WINDOW_MS = 10 * 60 * 1000;

export interface ArchiveCandidate {
  owner: string;
  barePeer: string;
  kind: string;
  nick: string;
  originId: string;
  timestamp: number | string | bigint;
  text: string | null;
  xml: string;
}

interface NewestScan {
  newest: { message: ResolvedPushMessage } | undefined;
  notify: string[];
  saw: 'muted' | 'hidden' | 'duplicate' | 'no-message';
}

// The oldest notifiable message across every chat the user may see, oldest
// first, one notification per publish IQ. Muted chats and invisible private
// topics never notify, not even generically: when the trigger's MAM row has
// not landed, a muted message is indistinguishable from a race, so an empty
// scope stays silent. Retractions, body-less reactions, the user's own DMs
// and already-notified rows do not notify either.
export const newestMessageForUserEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  userId: string,
  node: string,
): EffectType.fn.Return<NewestScan, ArchiveUnavailable> {
  const allowed = yield* Effect.tryPromise({
    try: () => cachedAllowedArchives(deps.db, deps.config, userId),
    catch: () => new ArchiveUnavailable(),
  });
  const seen = deps.recentlyNotified.get(node) ?? new Set<string>();
  const oldestAllowedMicros =
    BigInt((deps.now ?? (() => new Date()))().getTime() - ARCHIVE_FRESH_WINDOW_MS) * 1000n;
  let sticky: 'muted' | 'hidden' | undefined;
  let everSawRows = false;
  for (let attempt = 0; attempt < ARCHIVE_LOOKUP_ATTEMPTS; attempt += 1) {
    const rows = yield* Effect.tryPromise({
      try: () => readNewestCandidates(deps.archive, allowed),
      catch: () => new ArchiveUnavailable(),
    });
    if (rows.length > 0) {
      everSawRows = true;
    }
    const liveIds = liveAiUiIds(rows);
    const superseded: string[] = [];
    for (const row of [...rows].reverse()) {
      if (row.originId === '' || seen.has(row.originId)) {
        continue;
      }
      if (!isFresh(row.timestamp, oldestAllowedMicros)) {
        continue;
      }
      const verdict = yield* Effect.tryPromise({
        try: () => resolveCandidate(deps, userId, allowed, row, liveIds),
        catch: () => new ArchiveUnavailable(),
      });
      if (verdict.status === 'ok') {
        const key = albumKey(verdict.message);
        if (key !== undefined && seen.has(key)) {
          seen.add(row.originId);
          continue;
        }
        // The sent message plus every older row this read superseded; muted/hidden
        // rows stop the walk and are never marked. An album's photos archive as one
        // row each, so every row of the same album and sender is marked with the
        // winner.
        const albumId = verdict.message.albumId;
        const albums =
          albumId === undefined
            ? []
            : rows
                .filter(
                  (sibling) =>
                    sibling.originId !== row.originId &&
                    sibling.originId !== '' &&
                    sameSender(row, sibling) &&
                    albumInfoFromXml(sibling.xml)?.id === albumId,
                )
                .map((sibling) => sibling.originId);
        return {
          newest: { message: verdict.message },
          notify: [row.originId, ...superseded, ...albums],
          saw: 'duplicate',
        };
      }
      if (verdict.status === 'muted' || verdict.status === 'hidden') {
        sticky = verdict.status;
        break;
      }
      superseded.push(row.originId);
    }
    if (sticky !== undefined) {
      break;
    }
    if (attempt + 1 < ARCHIVE_LOOKUP_ATTEMPTS) {
      yield* Effect.sleep(Duration.millis(ARCHIVE_LOOKUP_RETRY_MS));
    }
  }

  if (sticky !== undefined) {
    return { newest: undefined, notify: [], saw: sticky };
  }
  // No acceptable row and nothing known muted: the MAM row may still land, or
  // the message is one we never show. Stay silent rather than risk a generic
  // buzz; reads with only notified rows report `duplicate`, persistent
  // emptiness `no-message`.
  return { newest: undefined, notify: [], saw: everSawRows ? 'duplicate' : 'no-message' };
});

// Timestamps are microseconds since the epoch; at or after the window start
// is fresh.
function isFresh(timestamp: ArchiveCandidate['timestamp'], oldestMicros: bigint): boolean {
  return BigInt(timestamp) >= oldestMicros;
}

function sameSender(a: ArchiveCandidate, b: ArchiveCandidate): boolean {
  return a.owner === b.owner && a.barePeer === b.barePeer && a.nick === b.nick;
}

const CANDIDATE_COLUMNS =
  'username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, txt AS text, xml';

// The scope predicate shared by every candidate read: the user's visible
// rooms plus their own DM archive. Values bind in order, so callers append
// after the three it consumes.
function scopePredicate(allowed: SearchOwner, next: (value: unknown) => string): string {
  const rooms = next(allowed.rooms);
  const ownLocalpart = next(allowed.ownLocalpart);
  const dmPeers = next(allowed.dmPeers);
  return `(username = ANY(${rooms}) OR (username = ${ownLocalpart} AND bare_peer = ANY(${dmPeers})))`;
}

function binder(): { values: unknown[]; next: (value: unknown) => string } {
  const values: unknown[] = [];
  return {
    values,
    next: (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

function buildNewestQuery(allowed: SearchOwner): { text: string; values: unknown[] } {
  const { values, next } = binder();
  const scope = scopePredicate(allowed, next);
  const cap = next(ARCHIVE_CANDIDATES);
  return {
    text: `SELECT ${CANDIDATE_COLUMNS} FROM archive WHERE ${scope} ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

// One archived message by origin id, restricted to the caller's scope; an
// unknown id and an invisible message look the same.
function buildOriginIdQuery(
  allowed: SearchOwner,
  originId: string,
): { text: string; values: unknown[] } {
  const { values, next } = binder();
  const scope = scopePredicate(allowed, next);
  const id = next(originId);
  return {
    text: `SELECT ${CANDIDATE_COLUMNS} FROM archive WHERE ${scope} AND origin_id = ${id} ORDER BY timestamp DESC LIMIT 1`,
    values,
  };
}

export interface GroupchatPage {
  afterTimestamp: bigint;
  afterId: bigint;
  limit: number;
}

export interface GroupchatRow extends ArchiveCandidate {
  id: number | string | bigint;
}

export async function readGroupchatPage(
  archive: ArchivePool,
  page: GroupchatPage,
): Promise<GroupchatRow[]> {
  const rows = (await archive.query(
    `SELECT username AS owner, peer, bare_peer AS "barePeer", kind, nick,
       origin_id AS "originId", timestamp, txt AS text, xml, id
     FROM archive
     WHERE kind = 'groupchat' AND (timestamp, id) > ($1, $2)
     ORDER BY timestamp ASC, id ASC LIMIT $3`,
    [page.afterTimestamp, page.afterId, page.limit],
  )) as unknown as GroupchatRow[];
  return rows;
}

async function readNewestCandidates(
  archive: ArchivePool,
  allowed: SearchOwner,
): Promise<ArchiveCandidate[]> {
  const built = buildNewestQuery(allowed);
  const rows = (await archive.query(built.text, built.values)) as unknown as ArchiveCandidate[];
  return rows;
}

export async function readCandidateByOriginId(
  archive: ArchivePool,
  allowed: SearchOwner,
  originId: string,
): Promise<ArchiveCandidate | undefined> {
  const built = buildOriginIdQuery(allowed, originId);
  const rows = (await archive.query(built.text, built.values)) as unknown as ArchiveCandidate[];
  return rows[0];
}
