import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import type { ServerDatabase } from '../db/client';
import { sqlRuntimeFor } from '../effect/sql';
import { HttpError } from '../errors';
import { jidFor, localpartFor } from '../xmpp/provisioning';
import { canManageTopic, canSeeTopic, type TopicRow } from '../topics/access';
import { requireChatAccess } from '../chats/access';

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

// The stored `chat_jid` for a DM: `min(jidA,jidB)|max(jidA,jidB)` over lowercased
// bare JIDs, so both people share one pin list.
export function dmPairKey(ownBareJid: string, peerBareJid: string): string {
  const [first, second] = [ownBareJid.toLowerCase(), peerBareJid.toLowerCase()].sort();
  return `${first}|${second}`;
}

async function findTopicByRoomLocalpart(
  db: ServerDatabase,
  roomLocalpart: string,
): Promise<TopicRow | null> {
  const program = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows =
      yield* sql<TopicRow>`SELECT * FROM topics WHERE room_localpart = ${roomLocalpart} LIMIT 1`;
    return rows[0] ?? null;
  });
  return sqlRuntimeFor(db).runPromise(program);
}

// Resolves the `chat` parameter to its stored `chat_jid` plus, for rooms, the owning
// topic row. A stranger or a malformed JID gets the same 404 as an unknown chat.
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
    const topic = await findTopicByRoomLocalpart(db, localpart);
    // A room with no visible owning topic (or an archived one) is still a 404.
    if (!topic || !(await canSeeTopic(db, topic, userId))) {
      throw toMissingChat();
    }
    return { kind: 'room', chatJid: access.bare, topic };
  }
  const ownBare = jidFor(localpartFor(userId), domain).toLowerCase();
  return { kind: 'dm', chatJid: dmPairKey(ownBare, access.bare) };
}

// In a DM either person; in a group topic a group owner/admin who can see it, or the
// topic creator. General belongs to the group, so only its owner/admins pin there. Plain
// members read but do not change; an invisible chat is the same 404 as unknown.
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
  if (!chat.topic.isGeneral && chat.topic.createdBy === userId) {
    return;
  }
  if (await canManageTopic(db, chat.topic, userId)) {
    return;
  }
  throw new HttpError(403, 'forbidden', 'Only a topic manager can pin messages');
}

// One side of a DM pair, or anyone who can see the pin's topic room.
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
  const topic = await findTopicByRoomLocalpart(db, localpart);
  if (!topic || !(await canSeeTopic(db, topic, userId))) {
    throw toMissingChat();
  }
  return { kind: 'room', chatJid: storedChatJid, topic };
}
