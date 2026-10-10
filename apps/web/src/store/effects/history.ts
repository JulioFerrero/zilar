// The chat list refresh and opening a chat. History itself (previews, the
// first page, older pages, opening at a message) is in
// `@zilar/client-core/store`; it is re-exported here for the web modules.
import { Effect } from 'effect';
import {
  clearSupersededMarker,
  flushPending,
  loadPreview,
  openHistory,
  recordRead,
} from '@zilar/client-core/store';
import { ApiError, type ChatPref } from '@/lib/api';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { sortByRecency, summariesFor } from './chatRows';
import { CHAT_REFRESH_DEBOUNCE_MS } from './constants';
import type { StoreCtx } from './ctx';
import { loadGroupMembersInBackground } from './groupMembers';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import { fromPromise, prefsByJid } from './util';

export {
  canLoadHistory,
  flushPending,
  loadOlder,
  loadPreview,
  openAtMessage,
  openHistory,
} from '@zilar/client-core/store';

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
