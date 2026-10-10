// The message seed: the per-thread archive records assembled into the API's
// `ChatMessage` shape, keyed by bare chat JID. Timestamps are relative to the
// seed clock, so a demo always shows recent history.
import type { ChatKind, ChatMessage } from '@zilar/xmpp-core';
import type { MockSeed } from '../../data';
import { currentUser } from '../../data/people';
import type { DomainContext } from '../domain';
import { messageSeeds, type MockMessageSeed } from './threads';

const MINUTE_MS = 60_000;

// A room JID is a group chat; everything else (a contact or an AI) is a DM.
function threadKind(chatJid: string): ChatKind {
  return chatJid.includes('@rooms.') ? 'groupchat' : 'chat';
}

function toChatMessage(
  chatJid: string,
  kind: ChatKind,
  seed: MockMessageSeed,
  at: number,
): ChatMessage {
  return {
    id: seed.id,
    chatJid,
    kind,
    fromJid: seed.fromJid,
    fromResolved: true,
    timestamp: new Date(at - seed.minutesAgo * MINUTE_MS),
    outgoing: seed.fromJid === currentUser.jid,
    ...(seed.body === undefined ? {} : { body: seed.body }),
    ...(seed.payload === undefined ? {} : { payload: seed.payload }),
    ...(seed.forward === undefined ? {} : { forward: seed.forward }),
    ...(seed.replyTo === undefined ? {} : { replyTo: seed.replyTo }),
    ...(seed.mentions === undefined ? {} : { mentions: seed.mentions }),
    ...(seed.reactions === undefined ? {} : { reactions: seed.reactions }),
    ...(seed.correction === undefined ? {} : { correction: seed.correction }),
    ...(seed.retraction === undefined ? {} : { retraction: seed.retraction }),
  };
}

/**
 * The messages domain's rows. The map is rebuilt per call from the clock, so it
 * is never shared between seeds.
 */
export function seedMessages(context: DomainContext): Partial<MockSeed> {
  const at = context.now().getTime();
  const messages: Record<string, readonly ChatMessage[]> = {};
  for (const [chatJid, seeds] of Object.entries(messageSeeds)) {
    const kind = threadKind(chatJid);
    messages[chatJid] = seeds.map((seed) => toChatMessage(chatJid, kind, seed, at));
  }
  return { messages };
}
