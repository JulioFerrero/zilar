import { formatLastSeen } from './time';
import type { ChatSummary } from './types';

/** The chat header subtitle from ui-style.md §4. */
export function chatSubtitle(chat: ChatSummary, now: Date): string {
  if (chat.kind === 'ai') {
    return chat.aiStatus === 'working' ? 'AI · working…' : 'AI · idle';
  }
  if (chat.kind === 'group') {
    const members = `${chat.memberCount ?? 0} members`;
    return chat.onlineCount ? `${members}, ${chat.onlineCount} online` : members;
  }
  if (chat.online) {
    return 'online';
  }
  return chat.lastSeenAt ? formatLastSeen(chat.lastSeenAt, now) : 'last seen recently';
}

/** `EUR 0.02`, for the approval card. */
export function formatMoney(money: { currency: string; amount: number }): string {
  return `${money.currency} ${money.amount.toFixed(2)}`;
}
