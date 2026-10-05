// The encrypted Web Push payload the service worker decrypts and shows.
// The payload JSON is encrypted end to end by `web-push` (RFC 8291) between
// our server and the browser, so Google/Mozilla/Apple relays only see
// ciphertext. Encrypted payload budget is ≈ 4 KiB shared with headers; the
// payload below is capped at 3000 bytes.
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

// A message the component resolved from the chat archive for one publish IQ:
// who wrote it, where, and the raw text (if any). `undefined` text means the
// message carries no readable text (an attachment with no caption, a card).
export type ResolvedPushMessage = {
  /** Room bare JID for groups/topics, DM peer bare JID for DMs. */
  chatJid: string;
  /** Display name of the sender, never an e-mail. */
  senderName: string;
  /** Where it was written: `Group › Topic`, the group title, or the DM name. */
  place: string;
  text: string | undefined;
  messageId?: string;
};

export type PushFilterInput = {
  /** Muted by the user (chat_prefs, incl. group mute). Never notify. */
  muted: boolean;
  /** Private topic the user can no longer see. Never notify. */
  visible: boolean;
  /** The user's "Show message previews" setting. */
  showPreviews: boolean;
};

// Builds the payload, or undefined when the notification must be dropped.
// Mute and visibility win over everything: a muted chat or a private topic
// the user lost access to never produces a push, even for a mention.
export function buildPushPayload(
  message: ResolvedPushMessage,
  input: PushFilterInput,
): PushPayload | undefined {
  if (input.muted || !input.visible) {
    return undefined;
  }
  const title = truncateChars(titleFor(message), 140);
  const preview =
    input.showPreviews && message.text !== undefined ? previewFor(message.text) : undefined;
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

// DMs read as just the name ("Ana"); groups read as who plus where
// ("Ana in Acme Web › Bug: checkout…").
function titleFor(message: ResolvedPushMessage): string {
  if (message.place === '' || message.place === message.senderName) {
    return message.senderName;
  }
  return `${message.senderName} in ${message.place}`;
}

function previewFor(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed === '') {
    return 'New message';
  }
  return truncateChars(collapsed, PushPayloadSchema.PREVIEW_CHARS);
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
