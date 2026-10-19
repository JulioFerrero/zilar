import type { ChatSummary } from '@zilar/chat-core';

import type { GroupRole } from './chat-api';

export function isChannelChat(chat: Pick<ChatSummary, 'chatKind'>): boolean {
  return chat.chatKind === 'channel';
}

export function channelViewerRole(
  row: Pick<ChatSummary, 'myRole'>,
  detail: { members: { userId: string; role: GroupRole }[] } | undefined,
  meUserId: string,
): 'owner' | 'admin' | 'member' | undefined {
  if (row.myRole !== undefined) {
    return row.myRole;
  }
  return detail?.members.find((member) => member.userId === meUserId)?.role;
}

/**
 * Owner/admin only; an unknown role reads as a subscriber (read-only) until it is known — the safe default.
 */
export function mayPostInChannel(role: 'owner' | 'admin' | 'member' | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

export function channelSubscriberLabel(count: number): string {
  return count === 1 ? '1 subscriber' : `${count} subscribers`;
}

export function channelSubscriberCount(
  row: Pick<ChatSummary, 'subscriberCount' | 'memberCount'>,
  detailMemberCount: number | undefined,
): number {
  if (row.subscriberCount !== undefined) {
    return row.subscriberCount;
  }
  if (row.memberCount !== undefined) {
    return row.memberCount;
  }
  return detailMemberCount ?? 0;
}

export function channelDescription(
  row: Pick<ChatSummary, 'description'>,
  detail: { description?: string | null } | undefined,
): string | null {
  if (row.description !== undefined && row.description !== null && row.description !== '') {
    return row.description;
  }
  return detail?.description ?? null;
}

export function mayManageChannel(role: 'owner' | 'admin' | 'member' | undefined): boolean {
  return role === 'owner' || role === 'admin';
}
