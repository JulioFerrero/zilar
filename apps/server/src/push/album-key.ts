import type { ResolvedPushMessage } from './payload';

// The per-device "already notified" key for one album (T-1270): the album id
// plus the sender identity `archive-scan.ts`'s `sameSender` uses. The resolved
// message's `chatJid` is the room for a group and the bare peer for a DM, and
// `senderName` is the room nick for a group. Remembering this key next to the
// origin ids lets the DM scan and the group poller deliver an album once even
// when its sibling rows land in a later page.
export function albumKey(message: ResolvedPushMessage): string | undefined {
  if (message.albumId === undefined) {
    return undefined;
  }
  return `album:${message.albumId}:${message.chatJid}:${message.senderName}`;
}
