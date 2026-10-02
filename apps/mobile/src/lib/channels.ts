import type { ChatSummary } from '@zilar/chat-core';

import type { GroupRole } from './chat-api';

/**
 * Channel helpers (T-0144), the mobile twin of the web channel behaviour
 * (`ChannelComposerBar` / `ChannelPanel`, T-0124): who posts, who reads, and
 * which list a viewer may see. Components stay thin; everything here is a
 * pure function with Vitest coverage.
 */

/** True when the chat is a channel feed row. Absent `chatKind` = group. */
export function isChannelChat(chat: Pick<ChatSummary, 'chatKind'>): boolean {
  return chat.chatKind === 'channel';
}

/** The viewer's role: the feed row's `myRole` first, else the group detail. */
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
 * Whether the viewer posts in a channel: owner/admin only. Unknown reads as
 * a subscriber (read-only) until the role is known — the safe default, like
 * web.
 */
export function mayPostInChannel(role: 'owner' | 'admin' | 'member' | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** "N subscribers" for a channel row, singular for one. */
export function channelSubscriberLabel(count: number): string {
  return count === 1 ? '1 subscriber' : `${count} subscribers`;
}

/**
 * The subscriber count of a channel row: `subscriberCount` first (the wire
 * name), then the group member count, else the detail length.
 */
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

/** The channel's blurb: the row first, else the group detail. */
export function channelDescription(
  row: Pick<ChatSummary, 'description'>,
  detail: { description?: string | null } | undefined,
): string | null {
  if (row.description !== undefined && row.description !== null && row.description !== '') {
    return row.description;
  }
  return detail?.description ?? null;
}

/** Only owner/admins post — the admins slice subscribers see (who posts). */
export function channelAdminsOf(
  members: readonly { userId: string; name: string; role: GroupRole }[],
): { userId: string; name: string; role: 'owner' | 'admin' }[] {
  const admins: { userId: string; name: string; role: 'owner' | 'admin' }[] = [];
  for (const member of members) {
    if (member.role === 'owner' || member.role === 'admin') {
      admins.push({ userId: member.userId, name: member.name, role: member.role });
    }
  }
  return admins;
}

/** Whether the viewer manages a channel (invite links, roles): owner/admin. */
export function mayManageChannel(role: 'owner' | 'admin' | 'member' | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** The channel info line: "N subscribers", never member names. */
export function channelInfoSubtitle(count: number): string {
  return channelSubscriberLabel(count);
}
