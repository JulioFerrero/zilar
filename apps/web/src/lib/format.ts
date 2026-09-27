import type { ChatSummary } from '@galena/chat-core';
import type { Money } from '@galena/protocol';

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

export function formatMoney(money: Money): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency: money.currency }).format(
    money.amount,
  );
}

/** Header subtitle, see `ui-style.md` §4. */
export function chatSubtitle(chat: ChatSummary, now: Date): string {
  if (chat.isAI) {
    return `AI · ${chat.aiStatus === 'working' ? 'working' : 'idle'}`;
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
