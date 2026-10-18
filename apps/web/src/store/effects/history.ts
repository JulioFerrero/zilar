import { Effect } from 'effect';
import type { UiMessage } from '@zilar/chat-core';
import {
  applyChatDelivery,
  clearSupersededMarker,
  flushPending,
  loadPreview,
  mergeChatRows,
  openAtMessage as openAtMessageCore,
  openHistory,
  pruneInactiveChats,
  recordRead,
} from '@zilar/client-core/store';
import { ApiError } from '@/lib/api';
import { summariesFor } from './chatRows';
import { CHAT_REFRESH_DEBOUNCE_MS } from './constants';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import { setUnreadMark } from './prefs';
import { fromPromise, prefsByJid } from './util';

export {
  canLoadHistory,
  flushPending,
  loadOlder,
  loadPreview,
  openHistory,
} from '@zilar/client-core/store';

/** No ids: the stable empty set the reveal reader returns when a chat has none. */
const NO_REVEALS: ReadonlySet<string> = new Set();

// Jump targets the list must grow its window to include before it scrolls. The list renders
// only its newest window, so a target is recorded here and useMessageWindow grows to it.
const revealTargets = new Map<string, ReadonlySet<string>>();
const revealListeners = new Set<() => void>();

function notifyRevealListeners(): void {
  for (const listener of revealListeners) {
    listener();
  }
}

export function requestMessageWindowReveal(chatId: string, messageId: string): void {
  const current = revealTargets.get(chatId);
  if (current?.has(messageId) === true) {
    return;
  }
  revealTargets.set(chatId, new Set([...(current ?? []), messageId]));
  notifyRevealListeners();
}

export function clearMessageWindowReveal(chatId: string, messageId: string): void {
  const current = revealTargets.get(chatId);
  if (current?.has(messageId) !== true) {
    return;
  }
  const next = new Set(current);
  next.delete(messageId);
  revealTargets.set(chatId, next);
  notifyRevealListeners();
}

export function messageWindowReveals(chatId: string): ReadonlySet<string> {
  return revealTargets.get(chatId) ?? NO_REVEALS;
}

export function subscribeMessageWindowReveals(listener: () => void): () => void {
  revealListeners.add(listener);
  return () => {
    revealListeners.delete(listener);
  };
}

/** openAtMessage plus the window reveal: after the message loads, remember it so the list
 * grows to include it before the jump scrolls. */
export const openAtMessage = (
  ctx: StoreCtx,
  chatId: string,
  messageId: string,
): Effect.Effect<UiMessage, Error> =>
  openAtMessageCore(ctx, chatId, messageId).pipe(
    Effect.tap(() => Effect.sync(() => requestMessageWindowReveal(chatId, messageId))),
  );

export function openChat(ctx: StoreCtx, chatId: string): void {
  ctx.set((state) => ({
    activeChatId: chatId,
    // Opening another chat dismisses its notice; reopening the same chat keeps it.
    topicNotice: state.topicNotice?.chatId === chatId ? state.topicNotice : undefined,
  }));
  // The chat just opened is now active, so every other chat drops to its newest KEEP_INACTIVE.
  pruneInactiveChats(ctx, chatId);
  // Drop every quiet-archive mark except the one for the chat just opened: a leaked mark
  // would silence a later, unrelated removal.
  for (const id of ctx.quietArchiveIds) {
    if (id !== chatId) {
      ctx.quietArchiveIds.delete(id);
    }
  }
  recordRead(ctx, chatId, ctx.lastRead[chatId]);
  // Opening a chat clears its manual unread mark at once; the pref write keeps the server in
  // step even when no numeric read mark can be sent (a fresh device holds no last-read id).
  const opening = ctx.get().chats.find((entry) => entry.id === chatId);
  if (opening?.unreadMark === true) {
    ctx.set((state) => ({
      chats: state.chats.map((chat) =>
        chat.id === chatId ? { ...chat, unreadMark: false } : chat,
      ),
    }));
    ctx.rt.fork(setUnreadMark(ctx, chatId, false).pipe(Effect.ignore));
  }
  loadGroupMembersInBackground(ctx, chatId);
  ctx.rt.fork(refreshPinsFor(ctx, chatId));
  if (ctx.pendingOpenChatId !== undefined && ctx.pendingOpenChatId !== chatId) {
    clearSupersededMarker(ctx, ctx.pendingOpenChatId);
  }
  ctx.pendingOpenChatId = chatId;
  ctx.rt.fork(openHistory(ctx, chatId));
}

/** A roster push means the chat list changed: refetch after a short wait, joining new
 * rooms and loading previews. A new push replaces the wait; the refresh runs in its own
 * fiber so a later push cannot interrupt it half way. */
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

/** The periodic and focus refresh: refetches /api/chats so a created or removed topic
 * appears without a reload. Failures are silent; the next tick retries. */
export const refreshChats = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  refreshChatsOrThrow(ctx).pipe(Effect.catchCause(() => Effect.void));

/** The throwing half of refreshChats: fetch and merge, reporting failures. Background
 * callers swallow them; refreshTopicRow lets them throw instead of reading a stale list. */
export const refreshChatsOrThrow = (ctx: StoreCtx): Effect.Effect<void, unknown, Ports> =>
  Effect.gen(function* () {
    const { api, now } = yield* Ports;
    const { k } = ctx;
    const session = ctx.rt.session();
    const [entries, loadedPrefs] = yield* Effect.all(
      [fromPromise(() => api.getChats()), Effect.option(fromPromise(() => api.listChatPrefs()))],
      { concurrency: 'unbounded' },
    );
    if (ctx.rt.session() !== session) {
      // A newer start()/stop() superseded this refresh: fail instead of merging a stale list,
      // so refreshTopicRow cannot read an old state as topic alive.
      return yield* Effect.fail(
        new ApiError(0, 'stale_refresh', 'The chat list refresh was superseded'),
      );
    }

    const previous = ctx.get().chats;
    const known = new Map(previous.map((chat) => [chat.id, chat]));
    const activeChatId = ctx.get().activeChatId;
    const freshRows = entries.flatMap((entry) => summariesFor(entry));
    // Confirm the newest preview of every row and apply the delivered mark the server reports.
    for (const row of freshRows) {
      applyChatDelivery(ctx, row);
    }
    // A failed prefs read keeps the last rows, so pins, mutes and archives survive.
    const prefs =
      loadedPrefs._tag === 'Some' ? loadedPrefs.value : Object.values(ctx.get().chatPrefs);
    ctx.set({
      chats: mergeChatRows(previous, freshRows, activeChatId, prefs, now().getTime()),
      ...(loadedPrefs._tag === 'Some' ? { chatPrefs: prefsByJid(prefs) } : {}),
    });
    k.rememberGroupIds(entries);
    // A topic that disappeared while open navigates to General with a short notice — unless
    // this client caused it (e.g. archiving from its own header): those move silently.
    const openChatRow =
      activeChatId === undefined
        ? undefined
        : ctx.get().chats.find((chat) => chat.id === activeChatId);
    if (activeChatId !== undefined && openChatRow === undefined) {
      // Consume the quiet mark in whichever branch handles the disappearance: deleting it only
      // inside the General branch leaks the id and would silence a later removal.
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
