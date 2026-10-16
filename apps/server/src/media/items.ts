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

// The nick is the part after `/` in a room stanza's `from`; an empty nick (or
// no resource at all) answers "Unknown", like search's `senderNameFor`.
function roomNick(senderJid: string): string {
  const nick = senderJid.split('/')[1]?.trim() ?? '';
  return nick === '' ? 'Unknown' : nick;
}

export function senderNameFor(
  row: MediaItemRow,
  filter: MediaChatScope,
  allowed: SearchOwner,
  domain: string,
): string {
  if (filter.kind === 'room') {
    return roomNick(row.senderJid);
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
