// The picture of a group message's sender, shared by web and mobile. A bubble knows only
// the sender's JID, so an AI of the topic or a group member shows the picture the rest of
// the app uses instead of the name-seeded ball. No state, no Effect.
import type { TopicInfoAi } from '@zilar/chat-core';

export interface SenderAvatarMember {
  userId: string;
  avatarUrl?: string | undefined;
}

function bareJid(value: string): string {
  const lower = value.trim().toLowerCase();
  const slash = lower.indexOf('/');
  return slash === -1 ? lower : lower.slice(0, slash);
}

/**
 * The JID of one group member: `userId` is a localpart on both apps' detail rows, so it
 * takes the sender's domain; a value that already carries a domain stays as is.
 */
function memberJid(userId: string, domain: string): string {
  const bare = bareJid(userId);
  return bare.includes('@') ? bare : `${bare}@${domain}`;
}

/**
 * The sender's picture: the topic AI whose bare JID matches, else the group member, else
 * `undefined` (the name-seeded ball stays). A match without a picture falls through.
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
