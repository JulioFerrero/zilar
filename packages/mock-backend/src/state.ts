import type { ChatEntry, ConnectionView, Machine, PublicAi } from '@zilar/api-contract';
import type { MockMe, MockMessage, MockPerson, MockSeed } from './data';
import type { MockAiMemory } from './domains/ai-memory/seed';
import type { MockApproval } from './domains/approvals/seed';
import type { MockApprovalRule } from './domains/approval-rules/seed';
import type { MockAuditEntry } from './domains/audit/seed';
import type { MockBackground } from './domains/backgrounds/seed';
import type { MockChatFolder } from './domains/chat-folders/seed';
import type { MockInviteLink } from './domains/invite-links/seed';
import type { MockRoutine } from './domains/routines/seed';
import type { MockStickerPack } from './domains/stickers/seed';
import type { MockRun, MockTool } from './domains/tools/seed';
import { domains } from './domains';

/**
 * The live, in-memory tables and their mutators, one `MockBackend` per instance.
 * It is assembled from `src/domains/index.ts`: each domain's `createState` returns
 * its slice and the slices are merged here, so this file lists no domain.
 *
 * Getters are copied as accessors (not values) so a slice's mutators stay live:
 * `renameMe`, `putAi`, `removeConnection` and friends replace the array or row
 * behind the getter and the merged view follows. Every array is replaced, never
 * mutated in place, so a `reset()` cannot leak a previous seed.
 */
export interface MockData {
  readonly me: MockMe;
  readonly people: readonly MockPerson[];
  readonly chats: readonly ChatEntry[];
  readonly messages: Readonly<Record<string, readonly MockMessage[]>>;
  /** Append a stanza to a chat's thread (the fake XMPP core writes here). */
  appendMessage(chatJid: string, message: MockMessage): void;
  readonly approvals: MockApproval[];
  readonly approvalRules: MockApprovalRule[];
  readonly audit: readonly MockAuditEntry[];
  readonly tools: MockTool[];
  readonly routines: MockRoutine[];
  readonly runs: MockRun[];
  nextToolSequence: number;
  nextRunSequence: number;

  readonly ais: readonly PublicAi[];
  readonly connections: readonly ConnectionView[];
  readonly machines: readonly Machine[];

  // T-1046: the sticker packs, the panel order, the favorite sticker ids and
  // the sequence that mints new pack/sticker ids. The arrays are replaced, not
  // mutated in place, so a `reset()` cannot leak a previous seed.
  stickerPacks: MockStickerPack[];
  stickerPanel: string[];
  stickerFavorites: string[];
  nextStickerSequence: number;
  /** Rename the viewer (`PATCH /me`); the only mutator task A needs. */
  renameMe(name: string): void;

  findAi(id: string): PublicAi | undefined;
  /** The next `ai-mock-N` id, matching web's `nextAiSequence`. */
  nextAiId(): string;
  /** Replace an AI in place, or prepend it when it is new (like web's create). */
  putAi(ai: PublicAi): void;
  removeAi(id: string): void;

  hasConnection(id: string): boolean;
  /** The next `conn-mock-N` id, matching web's `nextConnectionSequence`. */
  nextConnectionId(): string;
  /** Prepend a new connection, or replace the row with the same id. */
  putConnection(connection: ConnectionView): void;
  removeConnection(id: string): void;

  findMachine(id: string): Machine | undefined;
  /** Replace a machine in place, or append it when it is new. */
  putMachine(machine: Machine): Machine;
  removeMachine(id: string): void;
  /** Clears the home-machine link of every AI on a machine (revoke). */
  detachMachine(machineId: string): void;

  /** The memory for a chat+ai key, seeded on first read like web's mock. */
  aiMemoryFor(key: string): MockAiMemory;
  removeAiFact(key: string, factId: string): boolean;
  clearAiMemory(key: string): void;

  // T-0944: invite links in memory for the page load. `inviteTokens` maps each
  // shown-once token to its link id; the rows carry hints only, like the real
  // server's list. `joinAttempts` is the per-link 429 window.
  inviteLinks: MockInviteLink[];
  readonly inviteTokens: Map<string, string>;
  readonly joinAttempts: Map<string, number>;
  nextInviteLinkSequence: number;

  // T-1045: the caller's chat folders and uploaded background images. Both
  // arrays are replaced on every write and the counters mint their row ids.
  chatFolders: MockChatFolder[];
  nextFolderSequence: number;
  backgrounds: MockBackground[];
  nextBackgroundSequence: number;
}

export function createMockData(seed: MockSeed): MockData {
  // `people` is the one shared table; every other key comes from a domain.
  const merged = { people: seed.people } as MockData;
  for (const domain of domains) {
    Object.defineProperties(merged, Object.getOwnPropertyDescriptors(domain.createState(seed)));
  }
  return merged;
}
