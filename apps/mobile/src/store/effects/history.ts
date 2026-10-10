// The chat list refresh, the prefs and folders, `reloadChats` and the mobile
// `openChat` side effects. History itself (the first page, older pages,
// previews, the pending open and opening at a message) is in
// `@zilar/client-core/store`; it runs here through a `HistoryCtx` that maps the
// mobile state names (`historyLoad`/`'loaded'`) to the core's
// (`historyState`/`'ready'`), so the screens keep reading `historyLoad`.
import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import {
  clearSupersededMarker,
  flushPending as flushCore,
  loadOlder as loadOlderCore,
  loadPreview as loadPreviewCore,
  openAtMessage as openAtMessageCore,
  openHistory,
  type HistoryCtx,
  type HistoryPatch,
  type HistorySet,
  type HistoryState,
  type HistoryLoad,
} from '@zilar/client-core/store';

import type { ChatEntry } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
import { TOPIC_GONE_NOTICE } from '../../lib/topics';
import type { ChatStoreState, LoadState } from '../types';
import { Ports } from './ports';
import { detached, isClosed, lift, orElse, recover, type StoreCtx } from './runtime';

// The search-jump caps live in the core; re-exported for `real-store.ts` and
// the timer tests, which still import them from this module.
export { MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS } from '@zilar/client-core/store';

export interface History {
  /** The prefs rows: server truth when injected, empty otherwise. */
  readonly loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  /** The user's chat folders (T-0248); a failed load keeps the last list. */
  readonly loadFolders: Effect.Effect<void, never, Ports>;
  /** The periodic and foreground refresh; failures are silent. */
  readonly refreshChats: Effect.Effect<void, never, Ports>;
  loadPreview(current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports>;
  /** Runs the pending open once the core is online and the chat is known. */
  flushPending(): void;
  openChat(chatId: string): void;
  reloadChats(): void;
  retryHistory(chatId: string): void;
  loadOlder(chatId: string): void;
  openAtMessage(chatId: string, messageId: string): Promise<UiMessage>;
}

const toCoreLoad = (load: LoadState): HistoryLoad => (load === 'loaded' ? 'ready' : load);
const toMobileLoad = (load: HistoryLoad): LoadState => (load === 'ready' ? 'loaded' : load);

/**
 * First-page history, older pages, previews, the chat list refresh and
 * `openChat`. Every load is a fiber of the session, so `stop()` interrupts
 * it; the chat list refresh also ends with its generation.
 */
export function makeHistory(ctx: StoreCtx): History {
  const { ports, get, set, s, life, h, fx } = ctx;
  const { groupIds } = s;

  // The core's `HistoryState` over the mobile state: only the load-map name
  // and its `'ready'`/`'loaded'` value differ.
  const asHistoryState = (state: ChatStoreState): HistoryState => ({
    ...state,
    historyState: Object.fromEntries(
      Object.entries(state.historyLoad).map(([chatId, load]) => [chatId, toCoreLoad(load)]),
    ),
  });

  // A core patch back to the mobile names: `historyState` becomes
  // `historyLoad`, everything else passes through.
  const asMobilePatch = (patch: HistoryPatch): Partial<ChatStoreState> => {
    if (patch.historyState === undefined) {
      return patch;
    }
    const { historyState, ...rest } = patch;
    return {
      ...rest,
      historyLoad: Object.fromEntries(
        Object.entries(historyState).map(([chatId, load]) => [chatId, toMobileLoad(load)]),
      ),
    };
  };

  const historySet: HistorySet = (update) => {
    set((state) => {
      const previous = asHistoryState(state);
      const patch = typeof update === 'function' ? update(previous) : update;
      // `clearSupersededMarker` returns the state it was given to skip the
      // write; keep the store's "same object" convention.
      if (patch === previous) {
        return state;
      }
      return asMobilePatch(patch);
    });
  };

  // The view of this store the core history modules run on. `rt`, `k`, `fx`,
  // the ports, `lastRead` and the mutable bookkeeping are the same objects the
  // rest of the core uses, so a read mark or a cursor written here is visible
  // everywhere.
  const historyCtx: HistoryCtx = {
    get: () => asHistoryState(get()),
    set: historySet,
    ports: ctx.coreCtx.ports,
    rt: ctx.coreCtx.rt,
    k: ctx.coreCtx.k,
    fx: ctx.coreCtx.fx,
    get core() {
      return s.core;
    },
    set core(value) {
      s.core = value;
    },
    get lastRead() {
      return s.lastRead;
    },
    set lastRead(value) {
      s.lastRead = value;
    },
    lastReadUserId: ctx.coreCtx.lastReadUserId,
    pendingOutgoing: s.pendingOutgoing,
    get groupsJoined() {
      return s.groupsJoined;
    },
    set groupsJoined(value) {
      s.groupsJoined = value;
    },
    get pendingOpenChatId() {
      return s.pendingOpenChatId;
    },
    set pendingOpenChatId(value) {
      s.pendingOpenChatId = value;
    },
    cursors: s.cursors,
    loadingHistory: s.loadingHistory,
    loadingOlder: s.loadingOlder,
  };

  const loadPrefRows: Effect.Effect<ChatPref[], never, Ports> = Effect.gen(function* () {
    const { chatPrefs } = yield* Ports;
    if (chatPrefs === undefined) {
      return [];
    }
    return yield* recover(
      lift(() => chatPrefs.listChatPrefs()),
      () => Effect.sync((): ChatPref[] => s.chatPrefRows),
    );
  });

  const loadFolders: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const { chatFolders } = yield* Ports;
    if (chatFolders === undefined) {
      return;
    }
    // Keep the last list on a failure; a retry happens on the next refresh.
    yield* orElse(
      lift(() => chatFolders.listChatFolders()).pipe(
        Effect.flatMap((folders) => Effect.sync(() => get().setFolders(folders))),
      ),
      undefined,
    );
  });

  // Merges a fresh chat list, preserving the local last message, unread
  // count, mute flag and presence of the chats already shown. Topic entries
  // (T-0112) expand to one row per visible topic; rows that disappeared
  // (made private, archived, or I was removed) vanish here, and the open
  // topic moves to the topics screen with a short, name-free notice.
  // Chat prefs (T-0135) are applied after the merge so server rows pin,
  // mute and archive the summaries; a pref whose chat is gone is ignored.
  // Returns the previous chats so the caller can tell which rows are new.
  function mergeChatEntries(entries: ChatEntry[]): Map<string, ChatSummary> {
    const previous = get().chats;
    const known = new Map(previous.map((chat) => [chat.id, chat]));
    const rows = entries.flatMap((entry) => h.summariesFor(entry));
    const wanted = new Set(rows.map((row) => row.id));
    const fresh = rows.filter((row) => !known.has(row.id));
    const kept = rows
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
    const merged = applyChatPrefs(
      [...fresh, ...h.sortByRecency(kept)],
      s.chatPrefRows,
      ports.now().getTime(),
    );
    set({ chats: merged });
    h.rememberGroupIds(entries);
    // A topic that disappeared while open navigates back to its group's
    // topics screen with a short notice that never names the topic.
    const openId = get().activeChatId;
    if (openId !== null && !wanted.has(openId)) {
      const was = previous.find((chat) => chat.id === openId);
      if (was?.topic !== undefined && was.groupId !== undefined) {
        set({
          activeChatId: null,
          topicNotice: { groupId: was.groupId, message: TOPIC_GONE_NOTICE },
        });
      } else {
        set({ activeChatId: null });
      }
    }
    return known;
  }

  const loadPreview = (current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports> =>
    loadPreviewCore(historyCtx, current, chat);

  // Joins the rooms of the new groups and loads their preview, best-effort.
  // Topic rows (T-0112) each join their own room, like group rows today.
  const adoptChatEntries = (
    entries: ChatEntry[],
    known: Map<string, ChatSummary>,
  ): Effect.Effect<void, never, Ports> =>
    Effect.gen(function* () {
      const current = s.core;
      const me = get().me;
      if (current === undefined || me === undefined) {
        return;
      }
      // Dedupe the roster path per group id (T-0147): every topic row of one
      // group joins its own room, but the member names come from one shared
      // detail GET per group, not one per row.
      const detailStarted = new Set<string>();
      const freshRows = entries
        .flatMap((entry) => h.summariesFor(entry))
        .filter((row) => !known.has(row.id) && row.kind === 'group');
      for (const row of freshRows) {
        yield* orElse(
          lift(() => current.joinRoom(row.id, h.nick(me))),
          undefined,
        );
        const groupId = row.groupId ?? groupIds.get(row.id);
        if (groupId !== undefined && !detailStarted.has(groupId)) {
          detailStarted.add(groupId);
          ctx.forkSession(fx.ensureGroupDetail(groupId));
        }
        ctx.forkSession(fx.ensureGroupMembers(row.id));
      }
      for (const row of entries.flatMap((entry) => h.summariesFor(entry))) {
        if (known.has(row.id)) {
          continue;
        }
        const chat = get().chats.find((item) => item.id === row.id);
        if (chat !== undefined) {
          yield* loadPreview(current, chat);
        }
      }
    });

  // The chats, prefs and folders load together; prefs and folders never fail,
  // and a failing chat list does not cancel them.
  const fetchChatList = Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* Effect.all(
      [lift(() => api.getChats()), detached(loadPrefRows), detached(loadFolders)],
      { concurrency: 'unbounded' },
    ).pipe(Effect.option);
  });

  // A background refresh failure stays silent; the manual reload reports it.
  // The generation is checked after the fetch: a refresh run by an action,
  // outside the generation's fibers, must not land after a stop.
  const refreshChats: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const generation = life.generation();
    const fetched = yield* fetchChatList;
    if (fetched._tag === 'None' || isClosed(generation)) {
      return;
    }
    const [entries, prefs] = fetched.value;
    s.chatPrefRows = prefs;
    const known = mergeChatEntries(entries);
    flushCore(historyCtx);
    yield* adoptChatEntries(entries, known);
  });

  // Pull-to-refresh and the list's Retry key. Unlike a background refresh it
  // reports a failure in `chatsLoad`, and it only re-runs boot when the first
  // boot never got as far as a core (e.g. the first `/api/chats` failed).
  const reloadChatsList: Effect.Effect<void, never, Ports> = Effect.gen(function* () {
    const generation = life.generation();
    const fetched = yield* fetchChatList;
    if (fetched._tag === 'None') {
      if (!isClosed(generation)) {
        set({ chatsLoad: 'error' });
      }
      return;
    }
    if (isClosed(generation)) {
      return;
    }
    const [entries, prefs] = fetched.value;
    s.chatPrefRows = prefs;
    const known = mergeChatEntries(entries);
    set({ chatsLoad: 'loaded' });
    flushCore(historyCtx);
    yield* adoptChatEntries(entries, known);
  });

  // The core's `openAtMessage` opens the chat and pages back to the message;
  // mobile also flags it as the jump target for the chat screen to scroll to.
  const openAtMessage = (
    chatId: string,
    messageId: string,
  ): Effect.Effect<UiMessage, Error, Ports> =>
    Effect.gen(function* () {
      const found = yield* openAtMessageCore(historyCtx, chatId, messageId);
      set({ jumpTarget: { chatId, messageId } });
      return found;
    });

  return {
    loadPrefRows,
    loadFolders,
    refreshChats,
    loadPreview,
    flushPending: () => {
      flushCore(historyCtx);
    },
    loadOlder: (chatId) => {
      loadOlderCore(historyCtx, chatId);
    },
    openAtMessage: (chatId, messageId) => ctx.run(openAtMessage(chatId, messageId)),
    retryHistory: (chatId) => {
      ctx.forkSession(openHistory(historyCtx, chatId));
    },
    reloadChats: () => {
      set({ chatsLoad: 'loading' });
      // A first boot that never reached a core (e.g. `/api/chats` failed) is
      // retried whole; a running session just refetches the list.
      if (s.core === undefined) {
        fx.restartBoot();
        return;
      }
      ctx.fork(reloadChatsList);
    },
    openChat: (chatId) => {
      set((state) => {
        const chat = state.chats.find((entry) => entry.id === chatId);
        const noticeGroup = state.topicNotice?.groupId;
        const keepNotice =
          noticeGroup !== undefined && chat?.groupId !== undefined && chat.groupId === noticeGroup;
        return {
          activeChatId: chatId,
          topicNotice: keepNotice ? state.topicNotice : undefined,
        };
      });
      h.recordRead(chatId, s.lastRead[chatId]);
      // The detail first: it fills the cache, so the member-name fallback
      // shares the same GET on a cold open (T-0147 ordering).
      const groupId = h.groupIdForChat(chatId);
      if (groupId !== undefined) {
        ctx.forkSession(fx.ensureGroupDetail(groupId));
      }
      ctx.forkSession(fx.ensureGroupMembers(chatId));
      // Pins load when the chat opens and refresh on focus + 60 s while
      // it is open, like the web store (no realtime channel yet).
      ctx.forkSession(fx.loadPins(chatId, true));
      fx.startPinsPolling(chatId);
      if (s.pendingOpenChatId !== undefined && s.pendingOpenChatId !== chatId) {
        clearSupersededMarker(historyCtx, s.pendingOpenChatId);
      }
      s.pendingOpenChatId = chatId;
      ctx.forkSession(openHistory(historyCtx, chatId));
    },
  };
}
