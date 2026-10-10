import type { ChatEntry, ConnectionView, Machine, PublicAi } from '@zilar/api-contract';
import type { ChatKind, ChatMessage } from '@zilar/xmpp-core';
import { mockAis, mockConnections, mockMachines } from './ais';
import { seedApprovals, type MockApproval } from './approvals';
import { seedAudit, type MockAuditEntry } from './audit';
import { chats } from './chats';
import { messageSeeds, type MockMessageSeed } from './messages';
import { currentUser, defaultMe, people, type MockMe, type MockPerson } from './people';
import {
  seedRoutines,
  seedRuns,
  seedTools,
  type MockRoutine,
  type MockRun,
  type MockTool,
} from './tools';

export type { MockAiMemory } from './ais';
export type { MockMe, MockPerson } from './people';
export type { MockMessageSeed } from './messages';
export type { MockApproval, MockApprovalRule } from './approvals';
export type { MockAuditEntry } from './audit';
export type { MockRoutine, MockRun, MockTool, MockToolVersion } from './tools';

/** One stored message: the fake XMPP emits these as `message` events. */
export type MockMessage = ChatMessage;

export interface MockSeed {
  readonly me: MockMe;
  readonly people: readonly MockPerson[];
  readonly chats: readonly ChatEntry[];
  readonly messages: Readonly<Record<string, readonly MockMessage[]>>;
  readonly approvals: readonly MockApproval[];
  readonly audit: readonly MockAuditEntry[];
  readonly tools: readonly MockTool[];
  readonly routines: readonly MockRoutine[];
  readonly runs: readonly MockRun[];
  readonly ais: readonly PublicAi[];
  readonly connections: readonly ConnectionView[];
  readonly machines: readonly Machine[];
}

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
 * A fresh seed. Message timestamps are relative to `now`, so a demo always
 * shows recent history. `me` and the messages map are rebuilt per call; the
 * people and chat entries are immutable shared data, so a `reset()` never
 * mutates a previous seed.
 */
export function createSeed(now: () => Date = () => new Date()): MockSeed {
  const at = now().getTime();
  const messages: Record<string, readonly MockMessage[]> = {};
  for (const [chatJid, seeds] of Object.entries(messageSeeds)) {
    const kind = threadKind(chatJid);
    messages[chatJid] = seeds.map((seed) => toChatMessage(chatJid, kind, seed, at));
  }
  return {
    me: defaultMe(),
    people,
    chats,
    messages,
    approvals: seedApprovals(now),
    audit: seedAudit(now),
    tools: seedTools(),
    routines: seedRoutines(),
    runs: seedRuns(),
    ais: mockAis,
    connections: mockConnections,
    machines: mockMachines,
  };
}

export const defaultSeed: MockSeed = createSeed();
