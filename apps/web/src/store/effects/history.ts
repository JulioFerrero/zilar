// Message history, chat previews, the chat list refresh and opening a chat.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import { ApiError, type ChatPref } from '@/lib/api';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { coreKind, sortByRecency, sortMessages, summariesFor } from './chatRows';
import { CHAT_REFRESH_DEBOUNCE_MS, PAGE_HISTORY_MAX, PREVIEW_HISTORY_MAX } from './constants';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import { persistLastRead, recordRead } from './reads';
import { fromPromise, prefsByJid } from './util';

// Message search jumps at most this many history pages back looking for the
// hit before giving up with "Message not found".
const MESSAGE_JUMP_MAX_PAGES = 20;
// Upper bound for one stalled history wait inside `openAtMessage`: after this
// the jump gives up with "Message not found" instead of hanging.
const MESSAGE_JUMP_WAIT_MS = 10_000;
const HISTORY_POLL_MS = 25;

const setHistoryState = (
  ctx: StoreCtx,
  chatId: string,
  state: 'loading' | 'ready' | 'error',
): void => {
  ctx.set((previous) => ({ historyState: { ...previous.historyState, [chatId]: state } }));
};

// Drops the 'loading' marker of a pending chat that was superseded before it
// ever loaded, so no ownerless entry stays behind. Settled entries and
// in-flight loads are left alone.
const clearSupersededMarker = (ctx: StoreCtx, chatId: string): void => {
  if (ctx.loadingHistory.has(chatId)) {
    return;
  }
  ctx.set((previous) => {
    if (previous.historyState[chatId] !== 'loading') {
      return previous;
    }
    const next = { ...previous.historyState };
    delete next[chatId];
    return { historyState: next };
  });
};

export const canLoadHistory = (ctx: StoreCtx, chat: ChatSummary): boolean =>
  ctx.core !== undefined &&
  ctx.get().status === 'online' &&
  (chat.kind !== 'group' || ctx.groupsJoined);

// Resolves true once the in-flight first-page load for a chat settles, false
// after MESSAGE_JUMP_WAIT_MS so a stalled fetch cannot hang the jump: the
// caller then shows "Message not found".
const waitForHistory = (ctx: StoreCtx, chatId: string): Effect.Effect<boolean> => {
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

/** One backwards history page, shared with `loadOlder` and `openAtMessage`. */
export const loadOlderPage = (ctx: StoreCtx, chatId: string, cursor: string): Effect.Effect<void> =>
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
      ctx.set((state) => ({
        messagesByChat: {
          ...state.messagesByChat,
          [chatId]: sortMessages([...withEditsApplied, ...k.listFor(state, chatId)]),
        },
        historyComplete: { ...state.historyComplete, [chatId]: page.complete },
      }));
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
  ctx: StoreCtx,
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
export function flushPending(ctx: StoreCtx): void {
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

export const openHistory = (ctx: StoreCtx, chatId: string): Effect.Effect<void> =>
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
export function loadOlder(ctx: StoreCtx, chatId: string): void {
  const cursor = ctx.cursors[chatId];
  if (cursor === undefined) {
    return;
  }
  ctx.rt.fork(loadOlderPage(ctx, chatId, cursor));
}

/** Makes `chatId` the open chat and starts what it needs: pins, members, history. */
export function openChat(ctx: StoreCtx, chatId: string): void {
  ctx.set((state) => ({
    activeChatId: chatId,
    // Opening another chat dismisses the notice (it belongs to the
    // previous view); reopening the same chat keeps it.
    topicNotice: state.topicNotice?.chatId === chatId ? state.topicNotice : undefined,
  }));
  // Navigating away resolves a pending quiet self-archive: the mark exists so
  // the disappearance refresh moves silently, but leaving first means no
  // silent move is wanted — a leaked mark would silence a later, unrelated
  // removal. Drop every mark except one for the chat just opened.
  for (const id of ctx.quietArchiveIds) {
    if (id !== chatId) {
      ctx.quietArchiveIds.delete(id);
    }
  }
  recordRead(ctx, chatId, ctx.lastRead[chatId]);
  loadGroupMembersInBackground(ctx, chatId);
  ctx.rt.fork(refreshPinsFor(ctx, chatId));
  if (ctx.pendingOpenChatId !== undefined && ctx.pendingOpenChatId !== chatId) {
    clearSupersededMarker(ctx, ctx.pendingOpenChatId);
  }
  ctx.pendingOpenChatId = chatId;
  ctx.rt.fork(openHistory(ctx, chatId));
}

/**
 * Opens a chat and pages backwards until the message is loaded or history
 * runs out. Fails with `message_not_found` when it is not there.
 */
export const openAtMessage = (
  ctx: StoreCtx,
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

/**
 * A group invitation or a roster push means the chat list changed on the
 * server. Refetch it after a short wait, joining any new group rooms and
 * loading their preview. A new push replaces the pending wait; the refresh
 * itself runs in its own fiber, so a later push cannot interrupt it half way.
 */
export function scheduleChatsRefresh(ctx: StoreCtx): void {
  ctx.rt.forkKeyed(
    'chats-refresh',
    Effect.sleep(CHAT_REFRESH_DEBOUNCE_MS).pipe(
      Effect.andThen(
        Effect.sync(() => {
          ctx.rt.fork(refreshChats(ctx));
        }),
      ),
    ),
  );
}

/**
 * The periodic + focus refresh: refetches `/api/chats` so a topic created,
 * made private, or where I was removed appears or disappears without a
 * reload. Failures are silent; the next tick retries.
 */
export const refreshChats = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  refreshChatsOrThrow(ctx).pipe(Effect.catchCause(() => Effect.void));

/**
 * The throwing half of `refreshChats`: fetches the list and merges it,
 * reporting fetch failures to the caller. The background callers (poll,
 * focus, roster) swallow them and retry on the next tick; the row re-check
 * (`refreshTopicRow`) lets them throw instead of reading a stale list as
 * "alive".
 */
export const refreshChatsOrThrow = (ctx: StoreCtx): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    const { k } = ctx;
    const session = ctx.rt.session();
    const [entries, prefs] = yield* Effect.all(
      [
        fromPromise(() => api.getChats()),
        fromPromise(() => api.listChatPrefs()).pipe(
          Effect.catchCause(() => Effect.succeed([] as ChatPref[])),
        ),
      ],
      { concurrency: 'unbounded' },
    );
    if (ctx.rt.session() !== session) {
      // A newer `start()`/`stop()` superseded this refresh (boot, retry,
      // sign-out): the list below is stale, so say so instead of merging it —
      // the caller (`refreshTopicRow`) rejects rather than read stale state
      // as "topic alive".
      return yield* Effect.fail(
        new ApiError(0, 'stale_refresh', 'The chat list refresh was superseded'),
      );
    }

    const previous = ctx.get().chats;
    const known = new Map(previous.map((chat) => [chat.id, chat]));
    const activeChatId = ctx.get().activeChatId;
    const freshRows = entries.flatMap((entry) => summariesFor(entry));
    const fresh = freshRows.filter((row) => !known.has(row.id));
    const kept = freshRows
      .filter((row) => known.has(row.id))
      .map((row) => {
        const existing = known.get(row.id);
        if (existing === undefined) {
          return row;
        }
        return {
          ...row,
          ...(existing.lastMessage === undefined ? {} : { lastMessage: existing.lastMessage }),
          unread: existing.unread,
          ...(existing.online === undefined ? {} : { online: existing.online }),
          ...(existing.onlineCount === undefined ? {} : { onlineCount: existing.onlineCount }),
        };
      });
    // New chats appear at the top; the rest keep their recency order.
    ctx.set({
      chats: applyChatPrefs([...fresh, ...sortByRecency(kept)], prefs, now().getTime()),
      chatPrefs: prefsByJid(prefs),
    });
    k.rememberGroupIds(entries);
    // A topic that disappeared while open (made private, archived, or I was
    // removed) navigates to the group's General topic with a short notice —
    // unless the disappearance was just caused by this client on purpose
    // (e.g. archiving the open topic from its own header): ids in
    // `quietArchiveIds` move silently.
    const openChatRow =
      activeChatId === undefined
        ? undefined
        : ctx.get().chats.find((chat) => chat.id === activeChatId);
    if (activeChatId !== undefined && openChatRow === undefined) {
      // A deliberate self-archive moves silently: consume the quiet mark
      // while resolving this disappearance, whichever branch handles it.
      // Deleting only inside the General branch leaks the id when General
      // is absent — or when `applyTopicRow` already dropped the row, so
      // `was` below is undefined — and the leaked mark would silence a
      // later, unrelated removal.
      const quiet = ctx.quietArchiveIds.has(activeChatId);
      ctx.quietArchiveIds.delete(activeChatId);
      const was = previous.find((chat) => chat.id === activeChatId);
      const notice =
        was?.topic === undefined || was.groupId === undefined
          ? undefined
          : { groupId: was.groupId, groupTitle: was.groupTitle ?? '' };
      if (notice !== undefined) {
        const general = ctx
          .get()
          .chats.find((chat) => chat.groupId === notice.groupId && chat.topic?.isGeneral === true);
        if (general !== undefined) {
          ctx.set({
            activeChatId: general.id,
            topicNotice: quiet
              ? undefined
              : { chatId: general.id, message: 'This topic is no longer available.' },
          });
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', `/c/${encodeURIComponent(general.id)}`);
          }
        } else {
          ctx.set({ activeChatId: undefined });
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', '/');
          }
        }
      } else {
        ctx.set({ activeChatId: undefined });
      }
    }
    flushPending(ctx);

    const current = ctx.core;
    const me = ctx.get().me;
    if (current === undefined || me === undefined) {
      return;
    }
    for (const entry of entries) {
      if (entry.kind !== 'group') {
        continue;
      }
      for (const row of summariesFor(entry)) {
        if (known.has(row.id)) {
          continue;
        }
        yield* fromPromise(() => current.joinRoom(row.id, k.nick(me))).pipe(Effect.ignore);
        loadGroupMembersInBackground(ctx, row.id);
      }
    }
    for (const row of freshRows) {
      if (known.has(row.id)) {
        continue;
      }
      const chat = ctx.get().chats.find((item) => item.id === row.id);
      if (chat !== undefined) {
        yield* loadPreview(ctx, current, chat);
      }
    }
  });
