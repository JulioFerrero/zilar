import type { ChatSummary } from '../lib/types';
import { chatSeeds } from './chats';
import { mockMessagesByChat } from './messages';

/** Chat seeds with their last message filled in from the message history. */
export const mockChats: ChatSummary[] = chatSeeds.map((seed) => {
  const messages = mockMessagesByChat[seed.id] ?? [];
  const lastMessage = messages.at(-1);
  return lastMessage ? { ...seed, lastMessage } : { ...seed };
});

export { chatSeeds } from './chats';
export { mockMessagesByChat } from './messages';
