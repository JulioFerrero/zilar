import { bareJid } from '../jid';
import type { MediaItemRow } from '../db/rows';
import type { SearchOwner } from '../search/service';
import type { MediaChatScope, MediaKind } from './indexer';

// The reply schemas live in the shared contract (`@zilar/api-contract`,
// `media.ts`, T-0895). Every optional field is absent, never `null` (the
// handler returns a raw response built by `toMediaItem`, like the old `c.json`).
export interface MediaItem {
  messageId: string;
  chat: string;
  at: string;
  senderName: string;
  kind: MediaKind;
  url?: string;
  name?: string;
  size?: number;
  mime?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  waveform?: number[];
  linkUrl?: string;
  linkHost?: string;
}

// The effect/sql gallery read returns the same columns in the same camelCase
// shape as the row above. `at_micros` is int8, which the pg driver
// hands back as a string, so it is `string | number` here and converted to a
// number when mapping (the values fit in a double).

// The nick is the part after `/` in an old room stanza's `from`, which the
// index stored as `sender_jid` before T-2014; an empty nick (or no resource at
// all) answers "Unknown", like search's `senderNameFor`.
function roomNick(senderJid: string): string {
  const nick = senderJid.split('/')[1]?.trim() ?? '';
  return nick === '' ? 'Unknown' : nick;
}

// The bare JIDs a gallery page names from our tables: new room rows store the
// real sender's bare JID, old ones store `room/nick`, whose bare part is the
// room and simply finds no name. One batched lookup per page.
export function roomSenderJids(rows: readonly MediaItemRow[]): string[] {
  return rows.map((row) => bareJid(row.senderJid)).filter((jid) => jid !== '');
}

export function senderNameFor(
  row: MediaItemRow,
  filter: MediaChatScope,
  allowed: SearchOwner,
  domain: string,
  roomNames: ReadonlyMap<string, string> = new Map(),
): string {
  if (filter.kind === 'room') {
    // A room sender's name comes from `bare_peer` through our tables, never
    // from the nick; an old `room/nick` row falls back to that nick.
    return roomNames.get(bareJid(row.senderJid)) ?? roomNick(row.senderJid);
  }
  // In a DM the caller's own outgoing messages carry their own bare JID as
  // the stanza `from`; anything else is the peer.
  const ownBareJid = `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
  if (bareJid(row.senderJid) === ownBareJid) {
    return 'You';
  }
  return allowed.peerNames.get(filter.peer) ?? 'Unknown';
}

// Absent fields are omitted from the payload, never sent as `null`.
export function toMediaItem(row: MediaItemRow, senderName: string): MediaItem {
  return {
    messageId: row.messageId,
    chat: row.chatJid,
    at: new Date(Math.floor(row.atMicros / 1000)).toISOString(),
    senderName,
    kind: row.kind,
    ...(row.url === null ? {} : { url: row.url }),
    ...(row.name === null ? {} : { name: row.name }),
    ...(row.size === null ? {} : { size: row.size }),
    ...(row.mime === null ? {} : { mime: row.mime }),
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.waveform === null ? {} : { waveform: row.waveform }),
    ...(row.linkUrl === null ? {} : { linkUrl: row.linkUrl }),
    ...(row.linkHost === null ? {} : { linkHost: row.linkHost }),
  };
}
