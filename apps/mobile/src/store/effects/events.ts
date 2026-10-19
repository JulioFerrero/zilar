import { Effect } from 'effect';
import {
  CHAT_REFRESH_DEBOUNCE_MS,
  clearHistory as clearHistoryCore,
  deleteForEveryone,
  deleteForMe as deleteForMeCore,
  editMessage,
  optimisticPrefRow,
  react,
  recordRead,
  setFolders as setFoldersCore,
  updatePref as updatePrefCore,
  type PrefsStore,
} from '@zilar/client-core/store';

import type { ChatFoldersApi } from '../../lib/chat-folders-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
import type { ChatPref, PutChatPrefInput } from '../../lib/chat-prefs-api';
import type { ChatStoreState } from '../types';
import { lift, type StoreCtx } from './runtime';
export { CHAT_REFRESH_DEBOUNCE_MS };

export type EventActions = Pick<
  ChatStoreState,
  | 'react'
  | 'startEdit'
  | 'cancelEdit'
  | 'editMessage'
  | 'deleteForEveryone'
  | 'deleteForMe'
  | 'clearHistory'
  | 'dismissActionError'
  | 'setChatPref'
  | 'markChatRead'
  | 'setFolders'
  | 'createFolder'
  | 'updateFolder'
  | 'deleteFolder'
  | 'reorderFolders'
>;

export interface Events {
  readonly actions: EventActions;
  scheduleChatsRefresh(): void;
  clearTimers(): void;
}

export function makeEvents(ctx: StoreCtx): Events {
  const { ports, get, set, s, life } = ctx;
  const { now } = ports;

  const typingKey = (chatId: string): string => `typing:${chatId}`;
  const REFRESH_KEY = 'chats-refresh';

  function scheduleChatsRefresh(): void {
    life.forkKeyed(
      REFRESH_KEY,
      Effect.sleep(CHAT_REFRESH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            // The refresh is its own fiber: a newer push re-arms the debounce without cancelling a refresh already in flight.
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

  function foldersApi(): ChatFoldersApi {
    const api = ports.chatFolders;
    if (api === undefined) {
      throw new Error('Chat folders are not available.');
    }
    return api;
  }

  const prefsStore: PrefsStore<PutChatPrefInput, ChatPref> = {
    savedRows: () => s.chatPrefRows,
    setSavedRows: (rows) => {
      s.chatPrefRows = [...rows];
    },
    paint: (rows) =>
      set((state) => ({ chats: applyChatPrefs(state.chats, [...rows], now().getTime()) })),
    optimisticRow: optimisticPrefRow,
  };

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
    deleteForMe: (chatId, messageId) => ctx.run(deleteForMeCore(ctx.coreCtx, chatId, messageId)),
    clearHistory: (chatId) => ctx.run(clearHistoryCore(ctx.coreCtx, chatId)),
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
          yield* updatePrefCore(ctx.coreCtx, api, prefsStore, chatId, input as PutChatPrefInput);
        }),
      ),
    markChatRead: (chatId) =>
      ctx.run(
        Effect.gen(function* () {
          const chat = get().chats.find((entry) => entry.id === chatId);
          recordRead(ctx.coreCtx, chatId, chat?.lastMessage?.archiveId ?? s.lastRead[chatId]);
          const api = ports.chatPrefs;
          if (api === undefined) {
            return;
          }
          yield* updatePrefCore(ctx.coreCtx, api, prefsStore, chatId, { unreadMark: false });
        }),
      ),
    setFolders: (folders) => {
      setFoldersCore(
        {
          activeFolder: () => get().activeFolder,
          commit: (patch) => set({ ...patch, foldersLoaded: true }),
        },
        folders,
      );
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
