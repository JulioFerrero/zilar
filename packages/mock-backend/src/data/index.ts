import type { ChatEntry, ConnectionView, Machine, PublicAi } from '@zilar/api-contract';
import { mockAis, mockConnections, mockMachines } from './ais';
import { chats } from './chats';
import { messageSeeds } from './messages';
import { defaultMe, people, type MockMe, type MockPerson } from './people';

export type { MockAiMemory } from './ais';
export type { MockMe, MockPerson } from './people';

/** One stored message: `chatJid` is the record's key, `createdAt` an ISO string. */
export interface MockMessage {
  readonly id: string;
  readonly chatJid: string;
  readonly senderJid: string;
  readonly senderName: string;
  readonly createdAt: string;
  readonly text: string;
}

export interface MockSeed {
  readonly me: MockMe;
  readonly people: readonly MockPerson[];
  readonly chats: readonly ChatEntry[];
  readonly messages: Readonly<Record<string, readonly MockMessage[]>>;
  readonly ais: readonly PublicAi[];
  readonly connections: readonly ConnectionView[];
  readonly machines: readonly Machine[];
}

const MINUTE_MS = 60_000;

/**
 * A fresh seed. Message timestamps are relative to `now`, so a demo always
 * shows recent history (the old seeds used `atHour`, which did the same). `me`
 * and the messages map are rebuilt per call; the people and chat entries are
 * immutable shared data, so a `reset()` never mutates a previous seed.
 */
export function createSeed(now: () => Date = () => new Date()): MockSeed {
  const at = now().getTime();
  const messages: Record<string, readonly MockMessage[]> = {};
  for (const [chatJid, seeds] of Object.entries(messageSeeds)) {
    messages[chatJid] = seeds.map((seed) => ({
      id: seed.id,
      chatJid,
      senderJid: seed.senderJid,
      senderName: seed.senderName,
      createdAt: new Date(at - seed.minutesAgo * MINUTE_MS).toISOString(),
      text: seed.text,
    }));
  }
  return {
    me: defaultMe(),
    people,
    chats,
    messages,
    ais: mockAis,
    connections: mockConnections,
    machines: mockMachines,
  };
}

export const defaultSeed: MockSeed = createSeed();
