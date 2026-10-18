import { bareJid } from '../jid';
import type { MediaItemRow } from '../db/rows';
import type { SearchOwner } from '../search/service';
import type { MediaChatScope, MediaKind } from './indexer';

// Every optional field is absent, never `null`.
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

// `at_micros` is int8, which the pg driver hands back as a string; it is converted to a
// number when mapping (the values fit in a double).

// The nick is the part after `/` in an old `room/nick` sender; an empty nick answers
// "Unknown".
function roomNick(senderJid: string): string {
  const nick = senderJid.split('/')[1]?.trim() ?? '';
  return nick === '' ? 'Unknown' : nick;
}

// One batched lookup per page: old `room/nick` rows have the room as their bare part and
// simply find no name.
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
    // A room sender's name comes from `bare_peer`, never the nick.
    return roomNames.get(bareJid(row.senderJid)) ?? roomNick(row.senderJid);
  }
  // In a DM the caller's outgoing messages carry their own bare JID; anything else is the peer.
  const ownBareJid = `${allowed.ownLocalpart}@${domain.toLowerCase()}`;
  if (bareJid(row.senderJid) === ownBareJid) {
    return 'You';
  }
  return allowed.peerNames.get(filter.peer) ?? 'Unknown';
}

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
