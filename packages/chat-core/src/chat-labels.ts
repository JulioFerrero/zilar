import { firstName, previewBody } from './messages';
import type { ChatSummary, ReplyRef, UiMessage } from './types';

/** Relative "last seen" text for the chat header. */
export function formatLastSeen(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  }
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric' }).format(date);
}

/** Header subtitle, see `ui-style.md` §4. */
export function chatSubtitle(chat: ChatSummary, now: Date): string {
  if (chat.isAI) {
    return `AI · ${chat.aiStatus === 'working' ? 'working' : 'idle'}`;
  }
  // A channel reads "N subscribers", never "N members".
  if (chat.chatKind === 'channel') {
    const count = chat.subscriberCount ?? chat.memberCount ?? 0;
    return `${count} ${count === 1 ? 'subscriber' : 'subscribers'}`;
  }
  if (chat.kind === 'group') {
    const online = chat.onlineCount ?? 0;
    // Everyone online is a member, and the room's occupants include AIs (the same rule as `handleOccupants`).
    const members = Math.max(chat.memberCount ?? 0, online);
    return online > 0 ? `${members} members, ${online} online` : `${members} members`;
  }
  if (chat.online === true) {
    return 'online';
  }
  if (chat.lastSeenAt !== undefined) {
    return `last seen ${formatLastSeen(chat.lastSeenAt, now)}`;
  }
  return 'last seen recently';
}

/**
 * Typing label for the list preview and the header subtitle (see `ui-style.md`
 * §4). Direct messages read `typing`; groups name the first person.
 */
export function typingLabel(chat: ChatSummary, names: readonly string[]): string | undefined {
  const first = names[0];
  if (first === undefined) {
    return undefined;
  }
  if (chat.kind === 'group') {
    if (names.length === 1) {
      return `${firstName(first)} is typing`;
    }
    const second = names[1];
    if (names.length === 2 && second !== undefined) {
      return `${firstName(first)} and ${firstName(second)} are typing`;
    }
    return `${names.length} people are typing`;
  }
  return 'typing';
}

/**
 * T-1777: the header's "… writing" line while people or AIs write, from the
 * `PhoneHeader.dc.html` board. One writer is named; two are named; three or
 * more read as a count. First names, like `typingLabel`.
 */
export function writingLabel(names: readonly string[]): string | undefined {
  const first = names[0];
  if (first === undefined) {
    return undefined;
  }
  const second = names[1];
  if (second === undefined) {
    return `${firstName(first)} is writing…`;
  }
  const third = names[2];
  if (third === undefined) {
    return `${firstName(first)}, ${firstName(second)} writing…`;
  }
  return `${names.length} writing…`;
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
