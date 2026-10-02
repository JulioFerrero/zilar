import {
  firstName,
  previewBody,
  previewPrefix,
  type ChatSummary,
  type ReplyRef,
  type UiMessage,
} from '@zilar/chat-core';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export type PreviewOptions = {
  isGroup: boolean;
  currentUserId: string;
};

/**
 * Prefix and body for the chat-list preview, kept apart so the sender can be
 * colored. `previewPrefix` already includes its trailing space, so joining the
 * two parts yields the exact preview text (`Dani: ok!`).
 */
export function previewParts(
  lastMessage: UiMessage | undefined,
  options: PreviewOptions,
): { prefix: string; body: string } {
  return { prefix: previewPrefix(lastMessage, options), body: previewBody(lastMessage) };
}

/**
 * Relative "last seen" text for the chat header. `chat-core` has no
 * equivalent, so it stays mobile-specific.
 */
export function formatLastSeen(date: Date, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  const minutes = Math.floor(elapsed / MINUTE_MS);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const hours = Math.floor(elapsed / HOUR_MS);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 7) {
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(date);
}

/**
 * Typing label for the list preview and the header subtitle (see
 * `ui-style.md` §4). Direct messages read `typing`; groups name the first
 * person.
 */
export function typingLabel(chat: ChatSummary, names: readonly string[]): string | undefined {
  const first = names[0];
  if (first === undefined) {
    return undefined;
  }
  if (chat.kind === 'group') {
    return names.length > 1
      ? `${firstName(first)} and others are typing`
      : `${firstName(first)} is typing`;
  }
  return 'typing';
}

/** Reply reference built from a message, used by the composer's reply bar. */
export function replyRef(message: UiMessage, currentUserId: string): ReplyRef {
  const text = previewBody(message);
  return {
    id: message.id,
    senderName: message.senderId === currentUserId ? 'You' : message.senderName,
    ...(text.length > 0 ? { text } : {}),
  };
}
