import type { ChatSummary } from '../lib/types';
import { chatSeeds } from './chats';
import { mockMessagesByChat } from './messages';
import { mockTopicChats } from './topics';

type MockSeed = (typeof chatSeeds)[number] | ChatSummary;

// The "Dev team" group carries the mockup's topics (T-0112, same seven as the
// web mock): the legacy single `dev-team` row is replaced by its topics, with
// General keeping the `dev-team` id so old deep links open it.
const GENERAL_ID = mockTopicChats().find((topic) => topic.topic?.isGeneral === true)?.id;

/** Chat seeds with their last message filled in from the message history. */
export const mockChats: ChatSummary[] = [
  ...chatSeeds.filter((seed) => seed.id !== GENERAL_ID),
  ...mockTopicChats(),
].map((seed: MockSeed) => {
  const messages = mockMessagesByChat[seed.id] ?? [];
  const lastMessage = messages.at(-1) ?? ('lastMessage' in seed ? seed.lastMessage : undefined);
  return lastMessage ? { ...seed, lastMessage } : { ...seed };
});

export { mockTopicChats } from './topics';

export { chatSeeds } from './chats';
export { mockMessagesByChat } from './messages';
