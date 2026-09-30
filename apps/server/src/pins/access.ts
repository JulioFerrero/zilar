import { eq } from 'drizzle-orm';
import type { ServerDatabase } from '../db/client';
import { topics } from '../db/schema';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { canManageTopic, canSeeTopic, type TopicRow } from '../topics/access';
import { requireChatAccess } from '../chat-prefs/service';

// The same 404 as for an unknown chat, so chat JIDs cannot be probed.
const MISSING_CHAT_MESSAGE = 'Chat not found';

export function toMissingChat(): HttpError {
  return new HttpError(404, 'not_found', MISSING_CHAT_MESSAGE);
}

export type PinChat =
  { kind: 'dm'; chatJid: string } | { kind: 'room'; chatJid: string; topic: TopicRow };

export interface ResolvePinChatOptions {
  chatJid: string;
  userId: string;
  domain: string;
  mucDomain: string;
}

// The stored `chat_jid` for a DM: the canonical pair key
// `min(jidA,jidB)|max(jidA,jidB)` over lowercased bare JIDs, so both people
// share one pin list whichever side names the chat.
export function dmPairKey(ownBareJid: string, peerBareJid: string): string {
  const [first, second] = [ownBareJid.toLowerCase(), peerBareJid.toLowerCase()].sort();
  return `${first}|${second}`;
}

// Resolves the `chat` parameter to the stored `chat_jid` plus, for rooms,
// the topic row that owns it. Visibility only: a stranger (or a malformed
// JID) gets the same 404 as an unknown chat. Pin/write permission is a
// separate check (`requirePinManager`).
export async function resolvePinChat(
  db: ServerDatabase,
  options: ResolvePinChatOptions,
): Promise<PinChat> {
  const { chatJid, userId, domain, mucDomain } = options;
  const access = await requireChatAccess(db, { chatJid, userId, domain, mucDomain }).catch(
    () => null,
  );
  if (!access) {
    throw toMissingChat();
  }
  const at = access.bare.indexOf('@');
  const host = access.bare.slice(at + 1);
  if (host === mucDomain.toLowerCase()) {
    const localpart = access.bare.slice(0, at);
    const [topic] = await db
      .select()
      .from(topics)
      .where(eq(topics.roomLocalpart, localpart))
      .limit(1);
    // The room exists in the directory but no visible topic owns it (or the
    // topic is archived): still a 404, never a leak.
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      throw toMissingChat();
    }
    return { kind: 'room', chatJid: access.bare, topic };
  }
  const ownBare = jidFor(localpartFor(userId), domain).toLowerCase();
  return { kind: 'dm', chatJid: dmPairKey(ownBare, access.bare) };
}

// Who may pin or unpin: in a DM either person; in a group topic (including
// General) a group owner/admin who can see the topic, or the topic creator.
// Plain members can read pins but may not change them. A caller who may not
// even see the chat gets the same 404 as for an unknown chat.
export async function requirePinManager(
  db: ServerDatabase,
  chat: PinChat,
  userId: string,
): Promise<void> {
  if (chat.kind === 'dm') {
    return;
  }
  if (!(await canSeeTopic(db, chat.topic, userId))) {
    throw toMissingChat();
  }
  if (chat.topic.createdBy === userId) {
    return;
  }
  if (await canManageTopic(db, chat.topic, userId)) {
    return;
  }
  throw new HttpError(403, 'forbidden', 'Only a topic manager can pin messages');
}

// Whether the caller may read or unpin the stored pin row behind
// `DELETE /api/pins/:id` (which carries no chat parameter): one side of a DM
// pair, or anyone who can see the pin's topic room.
export async function requirePinVisible(
  db: ServerDatabase,
  storedChatJid: string,
  userId: string,
  domain: string,
): Promise<PinChat> {
  if (!storedChatJid.includes('|')) {
    return resolveRoomPin(db, storedChatJid, userId);
  }
  const ownBare = jidFor(localpartFor(userId), domain).toLowerCase();
  const sides = storedChatJid.split('|');
  if (sides.length !== 2 || !sides.includes(ownBare)) {
    throw toMissingChat();
  }
  return { kind: 'dm', chatJid: storedChatJid };
}

async function resolveRoomPin(
  db: ServerDatabase,
  storedChatJid: string,
  userId: string,
): Promise<PinChat> {
  const at = storedChatJid.indexOf('@');
  const localpart = at === -1 ? '' : storedChatJid.slice(0, at);
  const [topic] = await db
    .select()
    .from(topics)
    .where(eq(topics.roomLocalpart, localpart))
    .limit(1);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    throw toMissingChat();
  }
  return { kind: 'room', chatJid: storedChatJid, topic };
}
