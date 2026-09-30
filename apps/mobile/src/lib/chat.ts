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

/**
 * What each header action opens per chat kind (T-0139): the title opens the
 * info sheet where one exists (topics today), the search row always opens
 * the scoped search, and the menu opens the sheet where one exists (topics
 * today) — no dead taps. Screens hide the buttons they do not wire, and the
 * header renders no `onPress`-less button (see `ChatHeader` + its test).
 */
export type HeaderAction = 'info' | 'search' | 'menu';

export interface HeaderActionsInput {
  kind: 'dm' | 'group' | 'topic';
  hasSearch: boolean;
  hasInfo: boolean;
  hasMenu: boolean;
}

/** The header actions available for one chat kind: every entry must open something. */
export function headerActionsFor(input: HeaderActionsInput): HeaderAction[] {
  const actions: HeaderAction[] = [];
  if (input.hasInfo) {
    actions.push('info');
  }
  if (input.hasSearch) {
    actions.push('search');
  }
  if (input.hasMenu) {
    actions.push('menu');
  }
  return actions;
}

/** `EUR 0.02`, for the approval card. */
export function formatMoney(money: { currency: string; amount: number }): string {
  return `${money.currency} ${money.amount.toFixed(2)}`;
}
