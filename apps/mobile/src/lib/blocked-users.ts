import { Effect } from 'effect';
import { isBlockedSender, localpartOf, type ChatSummary, type UiMessage } from '@zilar/chat-core';
import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import type { ContactsApi } from './contacts-api';

// The lowercased localparts I blocked, kept outside React so every chat row
// and MessageList reads the same set without a prop chain. Loads lazily on
// first use and on app foreground; a failed load keeps the last good set so a
// flaky network never unhides someone's messages. The mobile twin of the web
// `blockedJids` hook.
let blocked: ReadonlySet<string> = new Set();
// True while a load is in flight, so a second caller does not start another.
let loading = false;
let appStateListening = false;
let currentApi: ContactsApi | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

const loadEffect = (api: ContactsApi): Effect.Effect<void> =>
  Effect.tryPromise({ try: () => api.listBlockedUsers(), catch: (error) => error }).pipe(
    Effect.flatMap((people) =>
      Effect.try({
        try: () => {
          const next = new Set<string>();
          for (const person of people) {
            if (person.jid !== null && person.jid.trim() !== '') {
              next.add(localpartOf(person.jid.trim()));
            }
          }
          blocked = next;
          emit();
        },
        catch: (error) => error,
      }),
    ),
    // Keep the last good set.
    Effect.catch(() => Effect.void),
  );

function ensureAppStateListener(): void {
  if (appStateListening) {
    return;
  }
  appStateListening = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active' && currentApi !== undefined) {
      Effect.runFork(loadEffect(currentApi));
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ReadonlySet<string> {
  return blocked;
}

/** The lowercased localparts I blocked; starts loading on first use. */
export function useBlockedJids(api: ContactsApi): ReadonlySet<string> {
  useEffect(() => {
    currentApi = api;
    ensureAppStateListener();
    if (!loading) {
      loading = true;
      Effect.runFork(
        loadEffect(api).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              loading = false;
            }),
          ),
        ),
      );
    }
  }, [api]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Reload the set after a successful block or unblock. */
export function reloadBlockedJids(api: ContactsApi): Promise<void> {
  return Effect.runPromise(loadEffect(api));
}

/**
 * The messages a chat list shows. In a group or channel the messages of
 * blocked people are dropped; my own messages always stay. DMs and AI chats
 * are never filtered.
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
  blocked = new Set();
  loading = false;
  appStateListening = false;
  currentApi = undefined;
  listeners.clear();
}

/** Test-only: the lowercased localparts currently loaded. */
export function blockedJidsSnapshot(): ReadonlySet<string> {
  return blocked;
}
