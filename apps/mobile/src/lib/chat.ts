import type { ChatSummary } from '@galena/chat-core';

import { formatLastSeen } from './format';

/** The chat header subtitle from ui-style.md §4. */
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
  return chat.lastSeenAt !== undefined
    ? `last seen ${formatLastSeen(chat.lastSeenAt, now)}`
    : 'last seen recently';
}

/** `EUR 0.02`, for the approval card. */
export function formatMoney(money: { currency: string; amount: number }): string {
  return `${money.currency} ${money.amount.toFixed(2)}`;
}
