// The Android notification channels of the native push (T-1302, MUX-23). One
// channel per chat kind, like Telegram's private/group/channel split, so the
// owner can mute each kind on its own. `native.ts` creates these before the
// permission prompt and deletes the single legacy "Messages" channel, so
// Settings → Apps → Zilar → Notifications lists exactly the three.

/** The chat kind a native wake can carry. AI chats are DMs. */
export type PushChatKind = 'dm' | 'group' | 'channel';

export interface ChatChannel {
  kind: PushChatKind;
  id: string;
  name: string;
}

/** The single channel before T-1302; deleted when the three are created. */
export const LEGACY_CHANNEL_ID = 'messages';

const BY_KIND: Record<PushChatKind, ChatChannel> = {
  dm: { kind: 'dm', id: 'direct-messages', name: 'Direct messages' },
  group: { kind: 'group', id: 'groups', name: 'Groups' },
  channel: { kind: 'channel', id: 'channels', name: 'Channels' },
};

/** The three channels, in the order they appear in Settings. */
export const CHAT_CHANNELS: readonly ChatChannel[] = [BY_KIND.dm, BY_KIND.group, BY_KIND.channel];

/** The channel for one chat kind. */
export function channelForKind(kind: PushChatKind): ChatChannel {
  return BY_KIND[kind];
}

/**
 * The channel a wake posts on. The server does not send a chat kind yet, so an
 * absent one falls back to `group` (see the T-1302 Report): the phone cannot
 * tell a DM peer JID from a room JID, because the room domain is server
 * configuration (`XMPP_MUC_DOMAIN`), not on the device.
 */
export function channelForWake(kind: PushChatKind | undefined): ChatChannel {
  return channelForKind(kind ?? 'group');
}

/** Decodes a `chatKind` out of the wake payload; undefined when absent or unknown. */
export function parseChatKind(value: unknown): PushChatKind | undefined {
  return value === 'dm' || value === 'group' || value === 'channel' ? value : undefined;
}
