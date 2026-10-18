import type { FcmWakeData, PushChatKind } from './fcm';

// The encrypted Web Push payload the service worker decrypts. `web-push`
// encrypts end to end (RFC 8291), so relays see only ciphertext. The budget
// is ≈ 4 KiB shared with headers; this payload is capped at 3000 bytes.
export const PushPayloadSchema = {
  MAX_BYTES: 3000,
  /** Message preview length: the first 120 characters of the text. */
  PREVIEW_CHARS: 120,
} as const;

export type PushPayload = {
  title: string;
  body: string;
  chatId?: string;
  messageId?: string;
};

// A message resolved from the archive: who wrote it, where, and the raw text.
// `undefined` means no readable text (an attachment with no caption, a card).
export type ResolvedPushMessage = {
  /** Room bare JID for groups/topics, DM peer bare JID for DMs. */
  chatJid: string;
  /** Which kind of chat it is, so the phone picks the right channel. */
  chatKind: PushChatKind;
  /** Display name of the sender, never an e-mail. */
  senderName: string;
  /** Where it was written: `Group › Topic`, the group title, or the DM name. */
  place: string;
  text: string | undefined;
  messageId?: string;
  /** The album a photo of a multi-photo message belongs to. */
  albumId?: string;
  /** How many photos the album holds, when `albumId` is set. */
  albumCount?: number;
};

export type PushFilterInput = {
  /** Muted by the user (chat_prefs, incl. group mute). Never notify. */
  muted: boolean;
  /** Private topic the user can no longer see. Never notify. */
  visible: boolean;
  /** The user's "Show message previews" setting. */
  showPreviews: boolean;
};

// Mute and visibility win over everything: a muted chat or a private topic
// the user lost access to never pushes, even for a mention. Shared by both
// transports so the rule cannot drift.
function passesFilters(input: PushFilterInput): boolean {
  return !input.muted && input.visible;
}

export function buildPushPayload(
  message: ResolvedPushMessage,
  input: PushFilterInput,
): PushPayload | undefined {
  if (!passesFilters(input)) {
    return undefined;
  }
  const title = truncateChars(titleFor(message), 140);
  const preview = input.showPreviews ? previewFor(message) : undefined;
  const payload: PushPayload = {
    title,
    body: preview ?? 'New message',
    chatId: message.chatJid,
  };
  if (message.messageId !== undefined) {
    payload.messageId = message.messageId;
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > PushPayloadSchema.MAX_BYTES) {
    payload.body = truncateUtf8(payload.body, 512);
    payload.title = truncateUtf8(payload.title, 128);
  }
  return payload;
}

// Builds the FCM data-only wake, or undefined when it must be dropped. It
// carries ids only, never the text or sender name: the app fetches and
// enriches the message. The same guard drops both kinds. `messageId` is
// omitted when the row carried none.
export function buildNativeWakePayload(
  message: ResolvedPushMessage,
  input: PushFilterInput,
  serverId: string,
): FcmWakeData | undefined {
  if (!passesFilters(input)) {
    return undefined;
  }
  if (message.messageId === undefined) {
    return { chatId: message.chatJid, chatKind: message.chatKind, serverId };
  }
  return {
    chatId: message.chatJid,
    chatKind: message.chatKind,
    messageId: message.messageId,
    serverId,
  };
}

// DMs read as just the name ("Ana"); groups as who plus where.
function titleFor(message: ResolvedPushMessage): string {
  if (message.place === '' || message.place === message.senderName) {
    return message.senderName;
  }
  return `${message.senderName} in ${message.place}`;
}

// The preview body: the text, or "{n} photos" for an album with no caption.
// `undefined` uses the generic body.
function previewFor(message: ResolvedPushMessage): string | undefined {
  if (message.text !== undefined) {
    const collapsed = message.text.replace(/\s+/g, ' ').trim();
    if (collapsed === '') {
      return 'New message';
    }
    return truncateChars(collapsed, PushPayloadSchema.PREVIEW_CHARS);
  }
  if (message.albumCount !== undefined && message.albumCount >= 2) {
    return `${message.albumCount} photos`;
  }
  return undefined;
}

function truncateChars(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  return `${chars.slice(0, maxChars).join('')}…`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) {
    return value;
  }
  let end = maxBytes;
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) {
    end -= 1;
  }
  return `${bytes.subarray(0, end).toString('utf8')}…`;
}
