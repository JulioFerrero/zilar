import { makeBlockedJidsStore } from '@zilar/client-core';
import { isBlockedSender, type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { Effect } from 'effect';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import type { ContactsApi } from './contacts-api';

let currentApi: ContactsApi | undefined;

const store = makeBlockedJidsStore({
  load: () =>
    Effect.runPromise(
      Effect.tryPromise({
        try: () => currentApi?.listBlockedUsers() ?? Promise.resolve([]),
        catch: (error) => error,
      }),
    ),
  watchRefresh: (refresh) => {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
      }
    });
  },
});

export function useBlockedJids(api: ContactsApi): ReadonlySet<string> {
  useEffect(() => {
    currentApi = api;
  }, [api]);
  return store.useBlockedJids();
}

export function reloadBlockedJids(api: ContactsApi): Promise<void> {
  currentApi = api;
  return store.refresh();
}

/**
 * In a group or channel a blocked person's messages are dropped; my own always stay, and DMs and AI chats are never filtered.
 */
export function filterBlockedMessages(
  chat: ChatSummary,
  messages: readonly UiMessage[],
  blocked: ReadonlySet<string>,
  meId: string,
): readonly UiMessage[] {
  if (chat.kind !== 'group' || chat.isAI === true || blocked.size === 0) {
    return messages;
  }
  return messages.filter(
    (message) => message.senderId === meId || !isBlockedSender(message.senderId, blocked),
  );
}

/** Test-only: reset the module state between tests. */
export function resetBlockedJidsForTests(): void {
  store.resetForTests();
  currentApi = undefined;
}
