import type { PushNotification } from './protocol';

// The encrypted Web Push payload the service worker decrypts and shows.
// The chat text is never left to third-party push servers in clear text:
// `web-push` encrypts this JSON end-to-end (RFC 8291) between our server
// and the browser, so Google/Mozilla/Apple relays only see ciphertext.
// A deployment that cannot verify that property must use `title` +
// `chatId` only and fetch the body over the app's own connection.
export const PushPayloadSchema = {
  MAX_BYTES: 3000,
} as const;

export type PushPayload = {
  title: string;
  body: string;
  chatId: string;
  messageId?: string;
};

export type PushFilterInput = {
  /** Muted by the user (T-0113 chat_prefs). Never notify. */
  muted: boolean;
  /** Private topic the user can no longer see (T-0108). Never notify. */
  visible: boolean;
  /** Group room notifications carry no MAM-derived chat id. */
  chatId: string | undefined;
};

// Builds the payload, or undefined when the notification must be dropped.
// Mute and visibility win over everything: a muted chat or a private topic
// the user lost access to never produces a push, even for a mention.
export function buildPushPayload(
  notification: PushNotification,
  input: PushFilterInput,
): PushPayload | undefined {
  if (input.muted || !input.visible || input.chatId === undefined) {
    return undefined;
  }
  const title = senderLabel(notification.lastMessageSender);
  const body = notification.lastMessageBody ?? 'New message';
  const payload: PushPayload = {
    title,
    body: truncateUtf8(body, PushPayloadSchema.MAX_BYTES - 256),
    chatId: input.chatId,
  };
  const messageId = messageIdOf(notification);
  if (messageId !== undefined) {
    payload.messageId = messageId;
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > PushPayloadSchema.MAX_BYTES) {
    payload.body = truncateUtf8(payload.body, 512);
  }
  return payload;
}

function senderLabel(sender: string | undefined): string {
  if (sender === undefined || sender === '') {
    return 'New message';
  }
  const at = sender.indexOf('@');
  const local = at < 0 ? sender : sender.slice(0, at);
  return local === '' ? 'New message' : local;
}

// ejabberd's notification carries no stanza id; callers that need one must
// join against MAM. Kept explicit so nobody assumes it is present.
function messageIdOf(_notification: PushNotification): string | undefined {
  return undefined;
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
