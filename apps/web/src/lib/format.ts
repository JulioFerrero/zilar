import {
  firstName,
  previewBody,
  type ChatSummary,
  type ReplyRef,
  type UiMessage,
} from '@zilar/chat-core';

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

export { formatMoney } from '@zilar/chat-core';

/** Header subtitle, see `ui-style.md` §4. */
export function chatSubtitle(chat: ChatSummary, now: Date): string {
  if (chat.isAI) {
    return `AI · ${chat.aiStatus === 'working' ? 'working' : 'idle'}`;
  }
  // T-0124: the channel header shows "N subscribers" (the usual channel wording).
  if (chat.chatKind === 'channel') {
    const count = chat.subscriberCount ?? chat.memberCount ?? 0;
    return `${count} ${count === 1 ? 'subscriber' : 'subscribers'}`;
  }
  if (chat.kind === 'group') {
    const members = chat.memberCount ?? 0;
    const online = chat.onlineCount ?? 0;
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
