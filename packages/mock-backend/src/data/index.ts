import type { ChatEntry, ConnectionView, Machine, PublicAi } from '@zilar/api-contract';
import type { ChatMessage } from '@zilar/xmpp-core';
import type { MockApproval } from '../domains/approvals/seed';
import type { MockAuditEntry } from '../domains/audit/seed';
import type { DomainContext } from '../domains/domain';
import { domains } from '../domains';
import type { MockRoutine } from '../domains/routines/seed';
import type { MockStickerPack } from '../domains/stickers/seed';
import type { MockRun, MockTool } from '../domains/tools/seed';
import { people, type MockMe, type MockPerson } from './people';

export type { MockMe, MockPerson } from './people';

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
  /** T-1046: the two demo sticker packs, the panel order and its favorites. */
  readonly stickerPacks: readonly MockStickerPack[];
  readonly stickerPanel: readonly string[];
  readonly stickerFavorites: readonly string[];
}

/**
 * A fresh seed, assembled from `src/domains/index.ts`: the shared people plus
 * every domain's rows. Message timestamps are relative to `now`, so a demo
 * always shows recent history, and each call rebuilds the mutable maps so a
 * `reset()` never leans on a previous seed.
 */
export function createSeed(now: () => Date = () => new Date()): MockSeed {
  const context: DomainContext = { now };
  const seed: Partial<MockSeed> = { people };
  for (const domain of domains) {
    Object.assign(seed, domain.seed(context));
  }
  return seed as MockSeed;
}

export const defaultSeed: MockSeed = createSeed();
