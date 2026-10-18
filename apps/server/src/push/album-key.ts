import type { ResolvedPushMessage } from './payload';

// The per-device already-notified key for one album: the album id plus the
// sender identity `sameSender` uses. Remembering it next to the origin ids
// lets the DM scan and the group poller deliver an album once even when its
// siblings land in a later page.
export function albumKey(message: ResolvedPushMessage): string | undefined {
  if (message.albumId === undefined) {
    return undefined;
  }
  return `album:${message.albumId}:${message.chatJid}:${message.senderName}`;
}
