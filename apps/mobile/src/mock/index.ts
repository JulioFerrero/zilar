import type { ChatSummary } from '../lib/types';
import { chatSeeds } from './chats';
import { mockMessagesByChat } from './messages';
import { mockTopicChats } from './topics';

type MockSeed = (typeof chatSeeds)[number] | ChatSummary;

/** Chat seeds with their last message filled in from the message history. */
export const mockChats: ChatSummary[] = [...chatSeeds, ...mockTopicChats()].map(
  (seed: MockSeed) => {
    const messages = mockMessagesByChat[seed.id] ?? [];
    const lastMessage = messages.at(-1) ?? ('lastMessage' in seed ? seed.lastMessage : undefined);
    return lastMessage ? { ...seed, lastMessage } : { ...seed };
  },
);

export { mockTopicChats } from './topics';

export { chatSeeds } from './chats';
export { mockMessagesByChat } from './messages';
