// Message history: a chat's list preview, its first page when it opens, the
// older pages before it, and opening a chat at one message (a jump from
// search). The chat list refresh and the open-chat side effects stay per app.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import { fromPromise, type CoreCtx, type CorePatch, type CoreState } from './ctx';
import { persistLastRead, recordRead } from './reads';
import { coreKind, sortMessages } from './rows';

export const PREVIEW_HISTORY_MAX = 1;
export const PAGE_HISTORY_MAX = 50;
// Message search jumps at most this many history pages back looking for the
// hit before giving up with "Message not found".
export const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after this
// the jump gives up with "Message not found" instead of hanging.
export const MESSAGE_JUMP_WAIT_MS = 10_000;
const HISTORY_POLL_MS = 25;

/** Where a chat's first history page is. */
export type HistoryLoad = 'loading' | 'ready' | 'error';

/** The part of a store's state history reads, beside the core state. */
export interface HistoryState extends CoreState {
  /** The XMPP connection status; history loads only while it is `online`. */
  readonly status: string;
  readonly historyState: Record<string, HistoryLoad>;
  readonly historyComplete: Record<string, boolean>;
  /** The store's own open-chat action. */
  readonly openChat: (chatId: string) => void;
}

/** The part of a store's state history writes. */
export interface HistoryPatch extends CorePatch {
  historyState?: Record<string, HistoryLoad>;
  historyComplete?: Record<string, boolean>;
}

export type HistorySet = (update: HistoryPatch | ((state: HistoryState) => HistoryPatch)) => void;

/** The core context plus the bookkeeping history keeps beside the state. */
export interface HistoryCtx extends CoreCtx {
  readonly get: () => HistoryState;
  readonly set: HistorySet;
  /** Group history (MUC MAM) only works once the rooms are joined. */
  groupsJoined: boolean;
  /** The latest chat opened before the core or the chats were ready. */
  pendingOpenChatId: string | undefined;
  /** The oldest loaded message id per chat: where the next older page starts. */
  readonly cursors: Record<string, string | undefined>;
  /** First-page history loads in flight, by chat id. */
  readonly loadingHistory: Set<string>;
  /** Older-page loads in flight, by chat id. */
  readonly loadingOlder: Set<string>;
}

const setHistoryState = (ctx: HistoryCtx, chatId: string, state: HistoryLoad): void => {
  ctx.set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
};

/**
 * Drops the 'loading' marker of a pending chat that was superseded before it
 * ever loaded, so no ownerless entry stays behind. Settled entries and
 * in-flight loads are left alone.
 */
export const clearSupersededMarker = (ctx: HistoryCtx, chatId: string): void => {
  if (ctx.loadingHistory.has(chatId)) {
    return;
  }
  ctx.set((previous) => {
    if (previous.historyState[chatId] !== 'loading') {
      // The same state object: the store skips the update.
      return previous;
    }
    const next = { ...previous.historyState };
    delete next[chatId];
    return { historyState: next };
  });
};

export const canLoadHistory = (ctx: HistoryCtx, chat: ChatSummary): boolean =>
  ctx.core !== undefined &&
  ctx.get().status === 'online' &&
  (chat.kind !== 'group' || ctx.groupsJoined);

// Resolves true once the in-flight first-page load for a chat settles, false
// after MESSAGE_JUMP_WAIT_MS so a stalled fetch cannot hang the jump: the
// caller then shows "Message not found".
const waitForHistory = (ctx: HistoryCtx, chatId: string): Effect.Effect<boolean> => {
  const settled: Effect.Effect<boolean> = Effect.sleep(HISTORY_POLL_MS).pipe(
    Effect.andThen(
      Effect.suspend(() => (ctx.loadingHistory.has(chatId) ? settled : Effect.succeed(true))),
    ),
  );
  return settled.pipe(
    Effect.timeoutOrElse({
      duration: MESSAGE_JUMP_WAIT_MS,
      orElse: () => Effect.succeed(false),
    }),
  );
};

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
        .map((message) => k.toUiMessage(message, ctx.get().currentUserId));
      k.resolvePendingEdits(chatId);
      const withEditsApplied = older.map((message) => k.withEdits(message, chatId));
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
    ctx.set((state) => ({
      chats: state.chats.map((entry) =>
        entry.id === chat.id && entry.lastMessage === undefined
          ? { ...entry, lastMessage: preview }
          : entry,
      ),
    }));
    if (ctx.lastRead[chat.id] === undefined) {
      ctx.lastRead[chat.id] = ui.id;
      persistLastRead(ctx);
    }
    ctx.cursors[chat.id] = page.first;
    ctx.set((state) => ({
      historyComplete: { ...state.historyComplete, [chat.id]: page.complete },
    }));
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
          .map((message) => k.toUiMessage(message, ctx.get().currentUserId));
        k.resolvePendingEdits(chatId);
        const withEditsApplied = loaded.map((message) => k.withEdits(message, chatId));
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
        const last = withEditsApplied.at(-1);
        if (last !== undefined) {
          recordRead(ctx, chatId, last.id);
          current.markDisplayed(chatId, coreKind(chat), last.id);
        }
        setHistoryState(ctx, chatId, 'ready');
      }).pipe(
        // Keep whatever live messages we have; the view offers a retry.
        Effect.catchCause(() => Effect.sync(() => setHistoryState(ctx, chatId, 'error'))),
        Effect.ensuring(Effect.sync(() => ctx.loadingHistory.delete(chatId))),
      );
      flushPending(ctx);
    });
  });

/** Loads the page before the oldest one loaded, if there is one. */
export function loadOlder(ctx: HistoryCtx, chatId: string): void {
  const cursor = ctx.cursors[chatId];
  if (cursor === undefined) {
    return;
  }
  ctx.rt.fork(loadOlderPage(ctx, chatId, cursor));
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
