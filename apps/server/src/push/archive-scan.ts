import { Duration, Effect, type Effect as EffectType } from 'effect';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { albumInfoFromXml } from '../xmpp/album-xml';
import { liveAiUiIds } from '../notify/ai-cards';
import { albumKey } from './album-key';
import { resolveCandidate } from './candidates';
import type { ResolvedPushMessage } from './payload';
import { ArchiveUnavailable, type PushServiceDeps } from './service';

// How many of the newest archived rows to scan for an acceptable message,
// and how often to re-read before giving up (the publish IQ can win the race
// against the MAM write).
const ARCHIVE_CANDIDATES = 25;
const ARCHIVE_LOOKUP_ATTEMPTS = 3;
const ARCHIVE_LOOKUP_RETRY_MS = 300;
// Only rows this fresh are ever notified: a message that arrived more than ten
// minutes ago must not be re-pushed when a later stanza (a typing state,
// presence, the keepalive wake) triggers the scan for it.
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
  /** Origin ids to mark as notified when a message is sent: the sent
   * message plus the older rows the winning read evaluated past
   * (`superseded` below). A row that resolved to muted or hidden stops
   * the walk and is never marked — a later change in the chat can still
   * notify it; rows already seen stay as they are. */
  notify: string[];
  /** What the scan ran into when nothing was acceptable. */
  saw: 'muted' | 'hidden' | 'duplicate' | 'no-message';
}

// The oldest notifiable message across every chat the user may see (DMs with
// contacts/AIs plus visible group and topic rooms), oldest first. One publish
// IQ produces at most one notification — the oldest unseen acceptable row in
// the last ten minutes wins, so a burst of IQs buzzes in arrival order, each
// IQ taking the next message and never repeating one. Rows older than
// ARCHIVE_FRESH_WINDOW_MS never notify: a typing state or presence can arrive
// long after the message and must not re-push it. Rows in muted chats and
// private topics the user cannot see never notify — not even generically: when
// the trigger's MAM row has not landed yet the scan cannot tell a muted
// message from a race, so an empty scope stays silent. Retraction rows (their
// text is the stock fallback), body-less reaction rows, the user's own
// outgoing DM rows, and rows already notified do not notify either.
export const newestMessageForUserEffect = Effect.fnUntraced(function* (
  deps: PushServiceDeps,
  userId: string,
  node: string,
): EffectType.fn.Return<NewestScan, ArchiveUnavailable> {
  const allowed = yield* Effect.tryPromise({
    try: () => allowedArchives(deps.db, deps.config, userId),
    catch: () => new ArchiveUnavailable(),
  });
  // Per node (device): one publish IQ per node means each device buzzes
  // independently, while a retried IQ for the same node still dedups (S1).
  const seen = deps.recentlyNotified.get(node) ?? new Set<string>();
  // Only rows this fresh may notify; the clock is read once per scan so the
  // MAM-race retries do not widen the window.
  const oldestAllowedMicros =
    BigInt((deps.now ?? (() => new Date()))().getTime() - ARCHIVE_FRESH_WINDOW_MS) * 1000n;
  // A muted or hidden row sticks across the MAM-race retries: the trigger
  // itself must stay silent, and later rows behind it are not evaluated.
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
    // The live AI UI's origin ids in this read, so a correction or retraction
    // of a card is skipped as well as the card itself (T-1400).
    const liveIds = liveAiUiIds(rows);
    const superseded: string[] = [];
    // Oldest first: the oldest unseen fresh row notifies now, so a burst of
    // IQs arrives in order — each IQ takes the next message — and the older
    // rows it walked past are marked notified with it.
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
        // A sibling of an album this node already pushed adds nothing: the
        // delivery remembered the album's sender key and a later MAM row
        // (F2) must stay silent. The row is remembered so a later trigger
        // does not reconsider it either.
        const key = albumKey(verdict.message);
        if (key !== undefined && seen.has(key)) {
          seen.add(row.originId);
          continue;
        }
        // The sent message plus every older row this read superseded. Rows
        // skipped as muted/hidden stop the walk instead (see the interface
        // comment): they are never marked. An album's photos archive as one
        // row each, so every scanned row of the same album id and sender is
        // marked with the winner: the next sibling's IQ then sends nothing.
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
    // Something new resolved to silence: the verdict already covers the
    // trigger, so stop. Anything else (only skipped rows, or nothing unseen
    // at all) retries: the trigger's MAM row may still be landing.
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
  // No acceptable row and nothing known muted: the trigger's MAM row may
  // still have been landing (or the message is one we never show, like a
  // retraction). Either way there is nothing to show, and — decision from
  // finding 2 — the scan stays silent rather than risking a generic buzz
  // for a muted or hidden message whose row never landed. Reads that held
  // only already-notified rows report `duplicate`; persistent emptiness
  // reports `no-message`.
  return { newest: undefined, notify: [], saw: everSawRows ? 'duplicate' : 'no-message' };
});

// The archive timestamp is microseconds since the epoch (Postgres hands a
// bigint back as a string). A row at or after the window start is fresh
// enough to notify; an older row never is.
function isFresh(timestamp: ArchiveCandidate['timestamp'], oldestMicros: bigint): boolean {
  return BigInt(timestamp) >= oldestMicros;
}

// Two rows came from the same sender: the same room and nick in a group, the
// same peer in a DM. Used to keep an album's sibling rows together (T-1269).
function sameSender(a: ArchiveCandidate, b: ArchiveCandidate): boolean {
  return a.owner === b.owner && a.barePeer === b.barePeer && a.nick === b.nick;
}

// The columns every candidate read returns, in the shape `ArchiveCandidate`
// names them.
const CANDIDATE_COLUMNS =
  'username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, txt AS text, xml';

// The scope predicate shared by every candidate read: the user's visible rooms
// plus their own DM archive. Values are bound in order (`next`), so callers
// keep appending their own placeholders after the three it consumes.
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

// One archived message by its origin id, restricted to the caller's scope. A
// row outside the scope matches nothing, so the caller cannot tell an unknown
// id from a message in a chat they may not see.
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

// One page of groupchat rows for the group push notifier (F5/MP-3): room
// messages never trigger ejabberd's MAM push, so the notifier polls for them.
// Rows strictly after the caller's `(timestamp, id)` cursor, oldest first, so
// the cursor can advance to the newest row read and a tick never repeats a
// row (the same `id` disambiguates rows that share a timestamp).
// A page of groupchat rows for the group notifier (F5/MP-3): room messages
// never trigger ejabberd's MAM push, so the notifier polls for rows strictly
// after its `(timestamp, id)` cursor, oldest first — the cursor advances to
// the newest row read and a tick never repeats a row (the `id`
// disambiguates rows sharing a timestamp).
export interface GroupchatPage {
  afterTimestamp: bigint;
  afterId: bigint;
  limit: number;
}

// A candidate row plus the ordering `id` the cursor needs, so the read below
// selects `CANDIDATE_COLUMNS` plus `id`.
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
