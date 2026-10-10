import type { MockMessage, MockSeed } from '../../data';
import type { MockData } from '../../state';

/**
 * The message history table. It is a live getter plus one mutator so the fake
 * XMPP core (task F2) can append the stanzas it sends: a replacement object and
 * arrays (never mutation in place), so a `reset()` cannot leak a previous seed.
 */
export function createMessagesState(seed: MockSeed): Partial<MockData> {
  let messages = seed.messages;
  return {
    get messages(): Readonly<Record<string, readonly MockMessage[]>> {
      return messages;
    },
    appendMessage(chatJid: string, message: MockMessage): void {
      messages = { ...messages, [chatJid]: [...(messages[chatJid] ?? []), message] };
    },
  };
}
