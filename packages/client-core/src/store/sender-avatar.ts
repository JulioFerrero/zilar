// The picture of a group message's sender, shared by web and mobile (T-1996).
// A bubble knows only the sender's JID, so a sender that is an AI of the topic
// or a member of the group shows the picture the rest of the app already uses
// (My AIs, the people line) instead of the ball seeded from the sender's name.
// No state, no Effect: both apps call this with the rows they already hold.
import type { TopicInfoAi } from '@zilar/chat-core';

/** The one group-member field the resolver reads; both apps' details fit it. */
export interface SenderAvatarMember {
  userId: string;
  avatarUrl?: string | undefined;
}

/** A JID without its resource, lower cased, so comparisons ignore both. */
function bareJid(value: string): string {
  const lower = value.trim().toLowerCase();
  const slash = lower.indexOf('/');
  return slash === -1 ? lower : lower.slice(0, slash);
}

/**
 * The JID of one group member: the member's `userId` is a localpart on both
 * apps' detail rows (the mention list builds `${userId}@${domain}` too), so it
 * takes the sender's domain; a value that already carries a domain stays as is.
 */
function memberJid(userId: string, domain: string): string {
  const bare = bareJid(userId);
  return bare.includes('@') ? bare : `${bare}@${domain}`;
}

/**
 * The sender's picture: the topic AI whose bare JID matches, else the group
 * member whose JID matches, else `undefined` (the name-seeded ball stays the
 * fallback). A match without a picture falls through to the next lookup.
 */
export function senderAvatarUrl(
  senderJid: string,
  topicAis: readonly TopicInfoAi[] | undefined,
  groupMembers: readonly SenderAvatarMember[] | undefined,
): string | undefined {
  const sender = bareJid(senderJid);
  const at = sender.indexOf('@');
  if (sender === '' || at === -1) {
    return undefined;
  }
  const ai = topicAis?.find((entry) => entry.jid !== undefined && bareJid(entry.jid) === sender);
  if (ai?.avatarUrl !== undefined) {
    return ai.avatarUrl;
  }
  const domain = sender.slice(at + 1);
  const member = groupMembers?.find((entry) => memberJid(entry.userId, domain) === sender);
  return member?.avatarUrl;
}
