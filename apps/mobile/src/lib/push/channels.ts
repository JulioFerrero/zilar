// One channel per chat kind, so the owner mutes each kind on its own; `native.ts` creates these before the permission prompt and deletes the single legacy "Messages" channel.

export type PushChatKind = 'dm' | 'group' | 'channel';

export interface ChatChannel {
  kind: PushChatKind;
  id: string;
  name: string;
}

export const LEGACY_CHANNEL_ID = 'messages';

const BY_KIND: Record<PushChatKind, ChatChannel> = {
  dm: { kind: 'dm', id: 'direct-messages', name: 'Direct messages' },
  group: { kind: 'group', id: 'groups', name: 'Groups' },
  channel: { kind: 'channel', id: 'channels', name: 'Channels' },
};

export const CHAT_CHANNELS: readonly ChatChannel[] = [BY_KIND.dm, BY_KIND.group, BY_KIND.channel];

export function channelForKind(kind: PushChatKind): ChatChannel {
  return BY_KIND[kind];
}

/**
 * The server sends no chat kind yet, so an absent one falls back to `group`: the phone cannot tell a DM peer JID from a room JID, because the room domain (`XMPP_MUC_DOMAIN`) is server configuration.
 */
export function channelForWake(kind: PushChatKind | undefined): ChatChannel {
  return channelForKind(kind ?? 'group');
}

export function parseChatKind(value: unknown): PushChatKind | undefined {
  return value === 'dm' || value === 'group' || value === 'channel' ? value : undefined;
}
