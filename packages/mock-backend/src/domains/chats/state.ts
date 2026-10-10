import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/** The chat list; the seed's `ChatEntry[]`, exposed read-only on `MockData`. */
export function createChatsState(seed: MockSeed): Partial<MockData> {
  return { chats: seed.chats };
}
