import type { ChatEntry } from '@zilar/api-contract';
import type { MockMe, MockMessage, MockPerson, MockSeed } from './data';

/** The live, in-memory tables and their mutators. One per `MockBackend`. */
export interface MockData {
  readonly me: MockMe;
  readonly people: readonly MockPerson[];
  readonly chats: readonly ChatEntry[];
  readonly messages: Readonly<Record<string, readonly MockMessage[]>>;
  /** Rename the viewer (`PATCH /me`); the only mutator task A needs. */
  renameMe(name: string): void;
}

export function createMockData(seed: MockSeed): MockData {
  let me = { ...seed.me };
  return {
    get me(): MockMe {
      return me;
    },
    people: seed.people,
    chats: seed.chats,
    messages: seed.messages,
    renameMe(name: string): void {
      me = { ...me, name };
    },
  };
}
