// Message history: a chat's list preview, its first page when it opens, the
// older pages before it, and opening a chat at one message (a jump from
// search). The chat list refresh and the open-chat side effects stay per app.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise } from './ctx';
import {
  MESSAGE_JUMP_MAX_PAGES,
  PAGE_HISTORY_MAX,
  PREVIEW_HISTORY_MAX,
  canLoadHistory,
  dedupePage,
  setHistoryState,
  waitForHistory,
  type HistoryCtx,
} from './history-core';
import { applyChatReadMark, recordRead } from './reads';
import { coreKind, sortMessages } from './rows';

export {
  MESSAGE_JUMP_MAX_PAGES,
  MESSAGE_JUMP_WAIT_MS,
  PAGE_HISTORY_MAX,
  PREVIEW_HISTORY_MAX,
  canLoadHistory,
  clearSupersededMarker,
  dedupePage,
} from './history-core';
export type {
  HistoryCtx,
  HistoryLoad,
  HistoryPatch,
  HistorySet,
  HistoryState,
} from './history-core';

/**
 * One backwards history page, shared with `loadOlder` and `openAtMessage`.
 * The page can overlap what is loaded: `loadOlder` during the first page load
 * pages from the boot preview's cursor, the newest message. A message that is
 * already in the chat keeps its loaded copy, so each one shows once.
 */
export const loadOlderPage = (
  ctx: HistoryCtx,
  chatId: string,
  cursor: string,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    if (chat === undefined || current === undefined || ctx.loadingOlder.has(chatId)) {
      return Effect.void;
    }
    ctx.loadingOlder.add(chatId);
    const { k } = ctx;
    return Effect.gen(function* () {
      const page = yield* fromPromise(() =>
        current.loadHistory(chatId, coreKind(chat), { before: cursor, max: PAGE_HISTORY_MAX }),
      );
      k.ingestHistoryReactions(page.messages);
      k.ingestHistoryEdits(page.messages);
      const older = page.messages
        .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
        .map((message) => k.toUiMessage(message, ctx.get().currentUserId, page.messages));
      k.resolvePendingEdits(chatId);
      const withEditsApplied = dedupePage(
        k.sameMessage,
        older.map((message) => k.withEdits(message, chatId)),
      );
      ctx.set((state) => {
        const loaded = k.listFor(state, chatId);
        const added = withEditsApplied.filter(
          (message) => !loaded.some((item) => k.sameMessage(item.id, message.id)),
        );
        return {
          messagesByChat: {
            ...state.messagesByChat,
            [chatId]: sortMessages([...added, ...loaded]),
          },
          historyComplete: { ...state.historyComplete, [chatId]: page.complete },
        };
      });
      ctx.cursors[chatId] = page.first;
      k.refreshEdits(chatId);
      applyChatReadMark(ctx, chatId);
    }).pipe(
      // A failed page load leaves the cursor for a later retry.
      Effect.catchCause(() => Effect.void),
      Effect.ensuring(Effect.sync(() => ctx.loadingOlder.delete(chatId))),
    );
  });

/** Loads the newest message of a chat as its list preview; best effort. */
export const loadPreview = (
  ctx: HistoryCtx,
  current: XmppCore,
  chat: ChatSummary,
): Effect.Effect<void> => {
  const { k } = ctx;
  return Effect.gen(function* () {
    const page = yield* fromPromise(() =>
      current.loadHistory(chat.id, coreKind(chat), { max: PREVIEW_HISTORY_MAX }),
    );
    k.ingestHistoryReactions(page.messages);
    k.ingestHistoryEdits(page.messages);
    const last = page.messages
      .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
      .at(-1);
    if (last === undefined) {
      return;
    }
    const ui = k.toUiMessage(last, ctx.get().currentUserId);
    k.resolvePendingEdits(chat.id);
    const preview = k.previewFor(k.withEdits(ui, chat.id));
    // One update for the list row and its history flag (PERF-1), so a preview
    // notifies the store's listeners once.
    ctx.set((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.lastMessage === undefined
          ? { ...entry, lastMessage: preview }
          : entry,
      ),
      historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
    }));
    // The boot preview only fills the list row; it never marks read, so the
    // first open of a chat that was never opened on this device still shows
    // its unread divider (UI-9).
    ctx.cursors[chat.id] = page.first;
  }).pipe(
    // Preview is best-effort; the chat still works when opened.
    Effect.catchCause(() => Effect.void),
  );
};

/**
 * Runs the pending open once the core is connected and the chat is known.
 * Called after every point where either can become ready: the first chat
 * merge, a background refresh, and (re)connect.
 */
export function flushPending(ctx: HistoryCtx): void {
  const pending = ctx.pendingOpenChatId;
  if (pending === undefined) {
    return;
  }
  const chat = ctx.get().chats.find((entry) => entry.id === pending);
  if (chat === undefined || !canLoadHistory(ctx, chat)) {
    return;
  }
  ctx.pendingOpenChatId = undefined;
  ctx.rt.fork(openHistory(ctx, pending));
}

/** Loads the first (newest) history page of a chat, or remembers it until it can. */
export const openHistory = (ctx: HistoryCtx, chatId: string): Effect.Effect<void> =>
  Effect.suspend(() => {
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    // `core` is assigned before `connect()` resolves, so "ready" means
    // online: a MAM query sent while still connecting fails.
    if (current === undefined || chat === undefined || !canLoadHistory(ctx, chat)) {
      // The chat screen mounted before the data was there (e.g. a reload
      // of /c/<jid>). Remember it and load once both are ready.
      ctx.pendingOpenChatId = chatId;
      setHistoryState(ctx, chatId, 'loading');
      return Effect.void;
    }
    if (ctx.loadingHistory.has(chatId)) {
      // A load for this chat is already in flight; it covers this open.
      if (ctx.pendingOpenChatId === chatId) {
        ctx.pendingOpenChatId = undefined;
      }
      return Effect.void;
    }
    if (ctx.pendingOpenChatId === chatId) {
      ctx.pendingOpenChatId = undefined;
    }
    ctx.loadingHistory.add(chatId);
    setHistoryState(ctx, chatId, 'loading');
    const { k } = ctx;
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const page = yield* fromPromise(() =>
          current.loadHistory(chatId, coreKind(chat), { max: PAGE_HISTORY_MAX }),
        );
        k.ingestHistoryReactions(page.messages);
        k.ingestHistoryEdits(page.messages);
        const loaded = page.messages
          .filter((message) => !k.isReactionOnly(message) && !k.isEditStanza(message))
          .map((message) => k.toUiMessage(message, ctx.get().currentUserId, page.messages));
        k.resolvePendingEdits(chatId);
        const withEditsApplied = dedupePage(
          k.sameMessage,
          loaded.map((message) => k.withEdits(message, chatId)),
        );
        const newest = withEditsApplied.at(-1);
        ctx.set((state) => {
          const live = k
            .listFor(state, chatId)
            .filter(
              (message) => !withEditsApplied.some((item) => k.sameMessage(item.id, message.id)),
            );
          return {
            messagesByChat: {
              ...state.messagesByChat,
              [chatId]: sortMessages([...withEditsApplied, ...live]),
            },
            historyComplete: { ...state.historyComplete, [chatId]: page.complete },
            chats:
              newest === undefined
                ? state.chats
                : state.chats.map((entry) =>
                    entry.id === chatId ? { ...entry, lastMessage: k.previewFor(newest) } : entry,
                  ),
          };
        });
        ctx.cursors[chatId] = page.first;
        k.refreshEdits(chatId);
        applyChatReadMark(ctx, chatId);
        // The displayed marker goes out only for a chat that is open,
        // visible and focused: a page that lands after leaving must not
        // mark seen (UI-2).
        if (ctx.get().activeChatId === chatId && ctx.ports.isVisible()) {
          const last = withEditsApplied.at(-1);
          if (last !== undefined) {
            recordRead(ctx, chatId, last.id);
            current.markDisplayed(chatId, coreKind(chat), last.id);
          }
        }
        setHistoryState(ctx, chatId, 'ready');
      }).pipe(
        // Keep whatever live messages we have; the view offers a retry. When
        // the page fails but live messages are on screen in the open,
        // visible chat, still mark the newest one seen (UI-9).
        Effect.catchCause(() =>
          Effect.sync(() => {
            setHistoryState(ctx, chatId, 'error');
            if (ctx.get().activeChatId === chatId && ctx.ports.isVisible()) {
              const live = ctx.k.listFor(ctx.get(), chatId).at(-1);
              if (live !== undefined) {
                recordRead(ctx, chatId, live.id);
                current.markDisplayed(chatId, coreKind(chat), live.id);
              }
            }
          }),
        ),
        Effect.ensuring(Effect.sync(() => ctx.loadingHistory.delete(chatId))),
      );
      flushPending(ctx);
    });
  });

/** Loads the page before the oldest one loaded, if there is one. */
export function loadOlder(ctx: HistoryCtx, chatId: string): void {
  const cursor = ctx.cursors[chatId];
  if (cursor !== undefined) ctx.rt.fork(loadOlderPage(ctx, chatId, cursor));
}

/**
 * Opens a chat and pages backwards until the message is loaded or history
 * runs out. Fails with `message_not_found` when it is not there.
 */
export const openAtMessage = (
  ctx: HistoryCtx,
  chatId: string,
  messageId: string,
): Effect.Effect<UiMessage, Error> =>
  Effect.gen(function* () {
    const { k } = ctx;
    const find = (): UiMessage | undefined =>
      k.listFor(ctx.get(), chatId).find((item) => k.sameMessage(item.id, messageId));
    ctx.get().openChat(chatId);
    const chat = ctx.get().chats.find((entry) => entry.id === chatId);
    const current = ctx.core;
    if (chat === undefined || current === undefined || !canLoadHistory(ctx, chat)) {
      const found = find();
      if (found === undefined) {
        return yield* Effect.fail(new Error('message_not_found'));
      }
      return found;
    }
    // Wait for the opening page when it is still in flight, then page
    // backwards until the message is loaded or history runs out. A stalled
    // wait (false) breaks out to "Message not found".
    for (let pages = 0; pages < MESSAGE_JUMP_MAX_PAGES; pages += 1) {
      const loaded = find();
      if (loaded !== undefined) {
        return loaded;
      }
      if (ctx.get().historyComplete[chatId] === true) {
        break;
      }
      if (ctx.loadingHistory.has(chatId)) {
        if (!(yield* waitForHistory(ctx, chatId))) {
          break;
        }
        continue;
      }
      const cursor = ctx.cursors[chatId];
      if (cursor === undefined) {
        if (!(yield* waitForHistory(ctx, chatId))) {
          break;
        }
        continue;
      }
      yield* loadOlderPage(ctx, chatId, cursor);
    }
    const found = find();
    if (found === undefined) {
      return yield* Effect.fail(new Error('message_not_found'));
    }
    return found;
  });
