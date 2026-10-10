import type { MockSeed } from '../../data';
import type { MockData } from '../../state';

/** The message history table; the fake XMPP (task F2) reads and appends to it. */
export function createMessagesState(seed: MockSeed): Partial<MockData> {
  return { messages: seed.messages };
}
