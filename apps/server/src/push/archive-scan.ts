import { Duration, Effect, type Effect as EffectType } from 'effect';
import { allowedArchives, type ArchivePool, type SearchOwner } from '../search/service';
import { resolveCandidate } from './candidates';
import type { ResolvedPushMessage } from './payload';
import { ArchiveUnavailable, type PushServiceDeps } from './service';

// How many of the newest archived rows to scan for an acceptable message,
// and how often to re-read before giving up (the publish IQ can win the race
// against the MAM write).
const ARCHIVE_CANDIDATES = 25;
const ARCHIVE_LOOKUP_ATTEMPTS = 3;
const ARCHIVE_LOOKUP_RETRY_MS = 300;

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
   * (`superseded` below). Rows skipped as muted or hidden above the sent
   * row are never marked — a later change can still notify them; rows that
   * were already seen stay as they are. */
  notify: string[];
  /** What the scan ran into when nothing was acceptable. */
  saw: 'muted' | 'hidden' | 'duplicate' | 'no-message';
}

// The newest notifiable message across every chat the user may see (DMs with
// contacts/AIs plus visible group and topic rooms), newest first. One publish
// IQ produces at most one notification — the newest acceptable row wins, and
// a burst while offline buzzes once with the latest, never once per message.
// Rows in muted chats and private topics the user cannot see never notify —
// not even generically: when the trigger's MAM row has not landed yet the
// scan cannot tell a muted message from a race, so an empty scope stays
// silent. Retraction rows (their text is the stock fallback), body-less
// reaction rows, the user's own outgoing DM rows, and rows already notified
// do not notify either.
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
  // A muted or hidden newest sticks across the MAM-race retries: the trigger
  // itself must stay silent, and older rows behind it are not evaluated.
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
    const superseded: string[] = [];
    for (const row of rows) {
      if (row.originId === '' || seen.has(row.originId)) {
        continue;
      }
      const verdict = yield* Effect.tryPromise({
        try: () => resolveCandidate(deps, userId, allowed, row),
        catch: () => new ArchiveUnavailable(),
      });
      if (verdict.status === 'ok') {
        // The sent message plus every older row this read superseded. Rows
        // skipped as muted/hidden above it are deliberately excluded (see
        // the interface comment): they were never notified for.
        return {
          newest: { message: verdict.message },
          notify: [row.originId, ...superseded],
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

function buildNewestQuery(allowed: SearchOwner): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const next = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const rooms = next(allowed.rooms);
  const ownLocalpart = next(allowed.ownLocalpart);
  const dmPeers = next(allowed.dmPeers);
  const cap = next(ARCHIVE_CANDIDATES);
  return {
    text: `SELECT username AS owner, peer, bare_peer AS "barePeer", kind, nick, origin_id AS "originId", timestamp, txt AS text, xml FROM archive WHERE (username = ANY(${rooms}) OR (username = ${ownLocalpart} AND bare_peer = ANY(${dmPeers}))) ORDER BY timestamp DESC LIMIT ${cap}`,
    values,
  };
}

async function readNewestCandidates(
  archive: ArchivePool,
  allowed: SearchOwner,
): Promise<ArchiveCandidate[]> {
  const built = buildNewestQuery(allowed);
  const rows = (await archive.query(built.text, built.values)) as unknown as ArchiveCandidate[];
  return rows;
}
