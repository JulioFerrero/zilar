// The message archive seed: one record per stanza, keyed later by bare chat JID.
//
// A record holds everything the fake XMPP (plan task F2) emits for a message
// event or a history page, except the fields the thread it lives in already
// names: `chatJid` and `kind`, plus the timestamp, which `createSeed` dates
// against its clock from `minutesAgo`.
//
// Reaction, correction and retraction stanzas are archive records too: they
// name their target and never render as a bubble on their own, exactly like the
// stanzas the real server archives.
import type { Payload } from '@zilar/protocol';
import type { ChatMessage } from '@zilar/xmpp-core';

/** One archived stanza, before `createSeed` fills the thread and clock fields. */
export interface MockMessageSeed {
  readonly id: string;
  readonly fromJid: string;
  readonly minutesAgo: number;
  readonly body?: string;
  readonly payload?: Payload;
  readonly forward?: ChatMessage['forward'];
  readonly replyTo?: ChatMessage['replyTo'];
  readonly mentions?: ChatMessage['mentions'];
  readonly reactions?: ChatMessage['reactions'];
  readonly correction?: ChatMessage['correction'];
  readonly retraction?: ChatMessage['retraction'];
}

/** The bare JIDs the seed's people post from. */
export const JIDS = {
  you: 'you@zilar.test',
  ana: 'ana@zilar.test',
  luis: 'luis@zilar.test',
  marta: 'marta@zilar.test',
  marco: 'marco@zilar.test',
  sofia: 'sofia@zilar.test',
  dev1: 'ai-dev-1@zilar.test',
  qa1: 'ai-qa-1@zilar.test',
  marketing: 'ai-marketing@zilar.test',
} as const;

/**
 * A relative wall-clock time as minutes before the seed's clock. A record at
 * `daysAgo` days back and `hour:minute` is older than a later one on the same
 * day and than any record with a smaller `daysAgo`, which is all the ordering
 * the seed needs.
 */
export function ago(daysAgo: number, hour: number, minute = 0): number {
  return daysAgo * 1440 + (1440 - (hour * 60 + minute));
}

/** A text or payload message. */
export function msg(
  id: string,
  fromJid: string,
  minutesAgo: number,
  content: Omit<MockMessageSeed, 'id' | 'fromJid' | 'minutesAgo'> = {},
): MockMessageSeed {
  return { id, fromJid, minutesAgo, ...content };
}

/** A XEP-0444 reaction update carrying one reactor's complete set. */
export function reaction(
  id: string,
  fromJid: string,
  minutesAgo: number,
  targetId: string,
  emojis: string[],
): MockMessageSeed {
  return { id, fromJid, minutesAgo, reactions: { targetId, emojis } };
}

/** A XEP-0308 correction carrying the full new body. */
export function correction(
  id: string,
  fromJid: string,
  minutesAgo: number,
  targetId: string,
  body: string,
): MockMessageSeed {
  return { id, fromJid, minutesAgo, body, correction: { targetId } };
}

/** A XEP-0424 retraction; it names the target and carries no body. */
export function retraction(
  id: string,
  fromJid: string,
  minutesAgo: number,
  targetId: string,
): MockMessageSeed {
  return { id, fromJid, minutesAgo, retraction: { targetId } };
}
