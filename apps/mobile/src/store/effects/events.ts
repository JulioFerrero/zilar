import { Effect } from 'effect';
import { sortFolders } from '@zilar/chat-core';
import { deleteForEveryone, editMessage, react } from '@zilar/client-core/store';

import type { ChatFoldersApi } from '../../lib/chat-folders-api';
import { applyChatPrefs, optimisticPrefRow } from '../../lib/chat-prefs';
import type { PutChatPrefInput } from '../../lib/chat-prefs-api';
import type { ChatStoreState } from '../types';
import { failAfter, lift, type StoreCtx } from './runtime';

export { TYPING_CLEAR_MS } from '@zilar/client-core/store';
export const CHAT_REFRESH_DEBOUNCE_MS = 500;

export type EventActions = Pick<
  ChatStoreState,
  | 'react'
  | 'startEdit'
  | 'cancelEdit'
  | 'editMessage'
  | 'deleteForEveryone'
  | 'dismissActionError'
  | 'setChatPref'
  | 'setFolders'
  | 'createFolder'
  | 'updateFolder'
  | 'deleteFolder'
  | 'reorderFolders'
>;

export interface Events {
  readonly actions: EventActions;
  /** Refetches the chat list once the roster or invitation pushes go quiet. */
  scheduleChatsRefresh(): void;
  /** Ends the typing and refresh timers (`stop()`). */
  clearTimers(): void;
}

/**
 * The debounced chat-list refresh, chat prefs and folders. The typing lines
 * and the reaction, edit and delete sends are the core's
 * (`@zilar/client-core/store`); the actions here call them.
 */
export function makeEvents(ctx: StoreCtx): Events {
  const { ports, get, set, s, life } = ctx;
  const { now } = ports;

  // The key of a chat's clear-the-typing-line fiber in the store scope, the
  // one the core's `handleTyping` forks (`incoming.ts`).
  const typingKey = (chatId: string): string => `typing:${chatId}`;
  const REFRESH_KEY = 'chats-refresh';

  function scheduleChatsRefresh(): void {
    life.forkKeyed(
      REFRESH_KEY,
      Effect.sleep(CHAT_REFRESH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            // The refresh is its own fiber: a newer push re-arms the debounce
            // without cancelling a refresh already in flight.
            ctx.forkSession(ctx.fx.refreshChats);
          }),
        ),
      ),
    );
  }

  function clearTimers(): void {
    life.cancel(REFRESH_KEY);
    for (const chatId of Object.keys(get().typing)) {
      life.cancel(typingKey(chatId));
    }
  }

  /** The injected folders client; writes have no local fallback. */
  function foldersApi(): ChatFoldersApi {
    const api = ports.chatFolders;
    if (api === undefined) {
      throw new Error('Chat folders are not available.');
    }
    return api;
  }

  const actions: EventActions = {
    react: (chatId, messageId, emoji) => react(ctx.coreCtx, chatId, messageId, emoji),
    startEdit: (chatId, messageId) => {
      set({ editTarget: { chatId, messageId }, actionError: undefined });
    },
    cancelEdit: () => {
      set({ editTarget: undefined });
    },
    editMessage: (chatId, messageId, text) => editMessage(ctx.coreCtx, chatId, messageId, text),
    deleteForEveryone: (chatId, messageId) => deleteForEveryone(ctx.coreCtx, chatId, messageId),
    dismissActionError: () => {
      set({ actionError: undefined });
    },
    setChatPref: (chatId, input) =>
      ctx.run(
        Effect.gen(function* () {
          const api = ports.chatPrefs;
          if (api === undefined) {
            return yield* Effect.fail(new Error('Chat preferences are not available.'));
          }
          const nowMs = now().getTime();
          // Optimistic: merge the intended row into a copy of the full saved
          // rows first, like the web store; the saved truth below replaces
          // it. Merging into the full rows (not a single-row list) keeps
          // every other chat's prefs, and seeding from the chat's own saved
          // row keeps its kept fields on a partial write: a single row built
          // from the input alone would strip both until the PUT returns.
          const optimisticRows = [
            ...s.chatPrefRows.filter((row) => row.chatJid.toLowerCase() !== chatId.toLowerCase()),
            optimisticPrefRow(chatId, s.chatPrefRows, input as PutChatPrefInput, new Date(nowMs)),
          ];
          set((state) => ({ chats: applyChatPrefs(state.chats, optimisticRows, nowMs) }));
          // A failure re-merges the saved rows instead of restoring the
          // pre-write snapshot: anything that landed mid-flight (a new
          // message, an unread bump, a background refresh) survives, and
          // only the failed pref change is dropped.
          yield* failAfter(
            lift(() => api.putChatPref(chatId, input as PutChatPrefInput)).pipe(
              Effect.flatMap((saved) =>
                Effect.sync(() => {
                  s.chatPrefRows =
                    saved === null
                      ? s.chatPrefRows.filter(
                          (row) => row.chatJid.toLowerCase() !== chatId.toLowerCase(),
                        )
                      : [
                          ...s.chatPrefRows.filter(
                            (row) => row.chatJid.toLowerCase() !== chatId.toLowerCase(),
                          ),
                          saved,
                        ];
                  const refreshed = now().getTime();
                  set((state) => ({
                    chats: applyChatPrefs(state.chats, s.chatPrefRows, refreshed),
                  }));
                }),
              ),
            ),
            () =>
              Effect.sync(() =>
                set((state) => ({
                  chats: applyChatPrefs(state.chats, s.chatPrefRows, now().getTime()),
                })),
              ),
          );
        }),
      ),
    setFolders: (folders) => {
      const sorted = sortFolders(folders);
      set((state) => ({
        folders: sorted,
        foldersLoaded: true,
        activeFolder:
          state.activeFolder === 'all' || sorted.some((folder) => folder.id === state.activeFolder)
            ? state.activeFolder
            : 'all',
      }));
    },
    createFolder: (input) =>
      ctx.run(
        Effect.gen(function* () {
          const folder = yield* lift(() => foldersApi().createChatFolder(input));
          get().setFolders([...get().folders, folder]);
          return folder;
        }),
      ),
    updateFolder: (id, input) =>
      ctx.run(
        Effect.gen(function* () {
          const folder = yield* lift(() => foldersApi().patchChatFolder(id, input));
          get().setFolders(get().folders.map((item) => (item.id === id ? folder : item)));
          return folder;
        }),
      ),
    deleteFolder: (id) =>
      ctx.run(
        Effect.gen(function* () {
          yield* lift(() => foldersApi().deleteChatFolder(id));
          get().setFolders(get().folders.filter((item) => item.id !== id));
        }),
      ),
    reorderFolders: (ids) =>
      ctx.run(
        Effect.gen(function* () {
          const folders = yield* lift(() => foldersApi().reorderChatFolders(ids));
          get().setFolders(folders);
        }),
      ),
  };

  return { actions, scheduleChatsRefresh, clearTimers };
}
