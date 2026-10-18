import { chatEntriesFromList } from '@zilar/client-core';

import type { ChatEntry } from './chat-api';

/** Decodes a `/api/chats` body through the shared contract schema; one malformed entry fails the whole list. */
export function parseChatsList(value: unknown): ChatEntry[] | null {
  return chatEntriesFromList(value);
}
