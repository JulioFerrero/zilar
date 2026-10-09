import { Effect, Fiber } from 'effect';
import {
  applyEdit,
  canDeleteMessage,
  canEditMessage,
  emptyEdits,
  mentionsForTrimmedText,
  rebaseMentions,
  sortFolders,
  type EditAuthor,
  type EditUpdate,
} from '@zilar/chat-core';

import type { ChatFoldersApi } from '../../lib/chat-folders-api';
import { applyChatPrefs, optimisticPrefRow } from '../../lib/chat-prefs';
import type { PutChatPrefInput } from '../../lib/chat-prefs-api';
import type { ChatStoreState } from '../types';
import { failAfter, lift, recover, type StoreCtx } from './runtime';

export const TYPING_CLEAR_MS = 5000;
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
  /** A peer's chat state: shows the typing line and clears it after `TYPING_CLEAR_MS`. */
  handleTyping(event: { chatJid: string; fromJid: string; state: string; outgoing: boolean }): void;
  /** Refetches the chat list once the roster or invitation pushes go quiet. */
  scheduleChatsRefresh(): void;
  /** Ends the typing and refresh timers (`stop()`). */
  clearTimers(): void;
}

/**
 * Typing lines (one timer fiber per chat), the debounced chat-list refresh,
 * the reaction/edit/delete sends with their rollback, chat prefs and folders.
 */
export function makeEvents(ctx: StoreCtx): Events {
  const { ports, get, set, s, h } = ctx;
  const { now } = ports;

  // One clear-the-typing-line timer fiber per chat id.
  const typingTimers = new Map<string, Fiber.Fiber<void>>();
  let refreshTimer: Fiber.Fiber<void> | undefined;

  function clearTypingTimer(chatId: string): void {
    const timer = typingTimers.get(chatId);
    if (timer !== undefined) {
      Effect.runFork(Fiber.interrupt(timer));
      typingTimers.delete(chatId);
    }
  }

  function handleTyping(event: {
    chatJid: string;
    fromJid: string;
    state: string;
    outgoing: boolean;
  }): void {
    // A MUC reflects my own chat states back to me. When the sender cannot be
    // resolved to a real JID, xmpp-core marks the reflection `outgoing` and
    // keeps the full room JID, so the JID check alone is not enough.
    if (event.outgoing || h.isOwnSender(event.fromJid)) {
      return;
    }
    const chatId = event.chatJid;
    ctx.forkSession(ctx.fx.ensureGroupMembers(chatId));
    const name = h.senderNameFor({
      chatJid: chatId,
      fromJid: event.fromJid,
      outgoing: false,
    });
    clearTypingTimer(chatId);
    if (event.state === 'composing') {
      set((state) => ({ typing: { ...state.typing, [chatId]: { names: [name] } } }));
      typingTimers.set(
        chatId,
        ctx.forkSession(
          Effect.sleep(TYPING_CLEAR_MS).pipe(
            Effect.andThen(
              Effect.sync(() => {
                set((state) => {
                  const next = { ...state.typing };
                  delete next[chatId];
                  return { typing: next };
                });
                typingTimers.delete(chatId);
              }),
            ),
          ),
        ),
      );
    } else {
      set((state) => {
        const next = { ...state.typing };
        delete next[chatId];
        return { typing: next };
      });
    }
  }

  function scheduleChatsRefresh(): void {
    if (refreshTimer !== undefined) {
      Effect.runFork(Fiber.interrupt(refreshTimer));
    }
    refreshTimer = ctx.forkSession(
      Effect.sleep(CHAT_REFRESH_DEBOUNCE_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            refreshTimer = undefined;
            // The refresh is its own fiber: a newer push re-arms the debounce
            // without cancelling a refresh already in flight.
            ctx.forkSession(ctx.fx.refreshChats);
          }),
        ),
      ),
    );
  }

  function clearTimers(): void {
    for (const timer of typingTimers.values()) {
      Effect.runFork(Fiber.interrupt(timer));
    }
    typingTimers.clear();
    if (refreshTimer !== undefined) {
      Effect.runFork(Fiber.interrupt(refreshTimer));
      refreshTimer = undefined;
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
    react: (chatId, messageId, emoji) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const mine = h.myJid();
      if (chat === undefined || mine === undefined) {
        return;
      }
      // The local key is alias-resolved; the wire target must be the server
      // id everyone else knows. An unacked message has none yet, so reacting
      // would send a target nobody could match: do nothing until it has one.
      const targetId = h.aliasRoot(messageId);
      const wireTarget = h.wireTargetFor(messageId);
      const currentCore = s.core;
      if (wireTarget === undefined || currentCore === undefined) {
        return;
      }
      const current = get().reactions[chatId]?.targets[targetId]?.[mine]?.emojis ?? [];
      const next = current.includes(emoji)
        ? current.filter((entry) => entry !== emoji)
        : [...current, emoji];
      const apply = (emojis: string[]): void => {
        h.applyReactionUpdate(chatId, targetId, mine, emojis, now().getTime());
      };
      apply(next);
      // The send failed: undo the optimistic toggle.
      ctx.forkSession(
        recover(
          lift(() => currentCore.sendReactions(chatId, h.coreKind(chat), wireTarget, next)),
          () => Effect.sync(() => apply(current)),
        ),
      );
    },
    startEdit: (chatId, messageId) => {
      set({ editTarget: { chatId, messageId }, actionError: undefined });
    },
    cancelEdit: () => {
      set({ editTarget: undefined });
    },
    editMessage: (chatId, messageId, text) => {
      const trimmed = text.trim();
      const chat = get().chats.find((entry) => entry.id === chatId);
      const mine = h.myJid();
      if (chat === undefined || mine === undefined || trimmed.length === 0) {
        return;
      }
      const message = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      if (message === undefined || !canEditMessage(message, get().currentUserId, now())) {
        return;
      }
      // The UI already blocks a no-op edit; the store does too, so no stanza
      // is ever sent for an unchanged text.
      if (message.text === trimmed) {
        return;
      }
      // XEP-0308 names the original by its sender-generated id.
      const wireTarget = h.correctionTargetFor(messageId);
      const currentCore = s.core;
      if (wireTarget === undefined || currentCore === undefined) {
        return;
      }
      const targetId = h.aliasRoot(messageId);
      const author: EditAuthor = { jid: mine, resolved: true };
      const priorMentions = rebaseMentions(message.text ?? '', text, message.mentions ?? []);
      const mentions = mentionsForTrimmedText(text, trimmed, priorMentions);
      const update: EditUpdate = {
        kind: 'correction',
        targetId,
        author,
        text: trimmed,
        order: now().getTime(),
      };
      if (mentions.length > 0) {
        update.mentions = mentions;
      }
      const previous = get().edits[chatId];
      set({ actionError: undefined });
      set((state) => ({
        edits: {
          ...state.edits,
          [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
        },
      }));
      h.refreshEdits(chatId);
      ctx.forkSession(
        recover(
          lift(() =>
            currentCore.sendCorrection(
              chatId,
              h.coreKind(chat),
              wireTarget,
              trimmed,
              mentions.length === 0
                ? undefined
                : {
                    mentions: mentions.map((mention) => ({
                      jid: mention.jid,
                      begin: mention.begin,
                      end: mention.end,
                    })),
                  },
            ),
          ),
          () =>
            Effect.sync(() => {
              h.restoreMessage(chatId, message);
              h.restoreEdits(chatId, previous);
              set({
                actionError: { chatId, message: 'Could not save the edit. Try again.' },
              });
            }),
        ),
      );
    },
    deleteForEveryone: (chatId, messageId) => {
      const chat = get().chats.find((entry) => entry.id === chatId);
      const mine = h.myJid();
      if (chat === undefined || mine === undefined) {
        return;
      }
      const message = h.listFor(get(), chatId).find((item) => h.sameMessage(item.id, messageId));
      if (message === undefined || !canDeleteMessage(message, get().currentUserId)) {
        return;
      }
      const wireTarget = h.retractionTargetFor(chat, messageId);
      const currentCore = s.core;
      if (wireTarget === undefined || currentCore === undefined) {
        return;
      }
      const targetId = h.aliasRoot(messageId);
      const author: EditAuthor = { jid: mine, resolved: true };
      const update: EditUpdate = {
        kind: 'retraction',
        targetId,
        author,
        order: now().getTime(),
      };
      const previous = get().edits[chatId];
      set({ actionError: undefined });
      set((state) => ({
        edits: {
          ...state.edits,
          [chatId]: applyEdit(state.edits[chatId] ?? emptyEdits(), update, author),
        },
      }));
      h.refreshEdits(chatId);
      ctx.forkSession(
        recover(
          lift(() => currentCore.sendRetraction(chatId, h.coreKind(chat), wireTarget)),
          () =>
            Effect.sync(() => {
              h.restoreMessage(chatId, message);
              h.restoreEdits(chatId, previous);
              set({
                actionError: { chatId, message: 'Could not delete the message. Try again.' },
              });
            }),
        ),
      );
    },
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

  return { actions, handleTyping, scheduleChatsRefresh, clearTimers };
}
