import type { ChatSummary } from '@zilar/chat-core';

import { formatLastSeen } from './format';

/** The chat header subtitle from ui-style.md §4. */
export function chatSubtitle(chat: ChatSummary, now: Date): string {
  if (chat.isAI) {
    return `AI · ${chat.aiStatus === 'working' ? 'working' : 'idle'}`;
  }
  // T-0144: a channel reads "N subscribers", never "N members".
  if (chat.chatKind === 'channel') {
    const count = chat.subscriberCount ?? chat.memberCount ?? 0;
    return count === 1 ? '1 subscriber' : `${count} subscribers`;
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

export { formatMoney } from '@zilar/chat-core';
