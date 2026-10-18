import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import {
  applyChatDelivery,
  clearSupersededMarker,
  flushPending as flushCore,
  loadOlder as loadOlderCore,
  loadPreview as loadPreviewCore,
  mergeChatRows,
  openAtMessage as openAtMessageCore,
  openHistory,
  pruneInactiveChats,
  type HistoryCtx,
  type HistoryLoad,
  type HistoryPatch,
  type HistorySet,
  type HistoryState,
} from '@zilar/client-core/store';

import type { ChatEntry } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { TOPIC_GONE_NOTICE } from '../../lib/topics';
import { clearUnreadMarkOnOpen } from './events';
import { Ports } from './ports';
import { detached, isClosed, lift, orElse, recover, type StoreCtx } from './runtime';
import type { ChatStoreState, LoadState } from '../types';

const toCoreLoad = (load: LoadState): HistoryLoad => (load === 'loaded' ? 'ready' : load);
const toMobileLoad = (load: HistoryLoad): LoadState => (load === 'ready' ? 'loaded' : load);

function makeHistoryCtx(ctx: StoreCtx): HistoryCtx {
  const { get, set, s } = ctx;

  const asHistoryState = (state: ChatStoreState): HistoryState => ({
    ...state,
    historyState: Object.fromEntries(
      Object.entries(state.historyLoad).map(([chatId, load]) => [chatId, toCoreLoad(load)]),
    ),
  });

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
      // `clearSupersededMarker` returns the state it was given to skip the write; keep the store's "same object" convention.
      if (patch === previous) {
        return state;
      }
      return asMobilePatch(patch);
    });
  };

  // `rt`, `k`, `fx`, the ports, `lastRead` and the bookkeeping are the same objects the rest of the core uses, so a read mark or cursor written here is visible everywhere.
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

  return historyCtx;
}

export { MESSAGE_JUMP_MAX_PAGES, MESSAGE_JUMP_WAIT_MS } from '@zilar/client-core/store';

export interface History {
  readonly loadPrefRows: Effect.Effect<ChatPref[], never, Ports>;
  readonly loadFolders: Effect.Effect<void, never, Ports>;
  readonly refreshChats: Effect.Effect<void, never, Ports>;
  loadPreview(current: XmppCore, chat: ChatSummary): Effect.Effect<void, never, Ports>;
  flushPending(): void;
  openChat(chatId: string): void;
  reloadChats(): void;
  retryHistory(chatId: string): void;
  loadOlder(chatId: string): void;
  openAtMessage(chatId: string, messageId: string): Promise<UiMessage>;
}

export function makeHistory(ctx: StoreCtx): History {
  const { ports, get, set, s, life, h, fx } = ctx;
  const { groupIds } = s;

  const historyCtx = makeHistoryCtx(ctx);

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
    yield* orElse(
      lift(() => chatFolders.listChatFolders()).pipe(
        Effect.flatMap((folders) => Effect.sync(() => get().setFolders(folders))),
      ),
      undefined,
    );
  });

  // A server row at least as new as memory wins (a read on another device clears here); a newer in-memory preview wins. Topic rows that disappeared vanish; chat prefs apply after the merge. Returns the previous chats so the caller can tell which rows are new.
  function mergeChatEntries(entries: ChatEntry[]): Map<string, ChatSummary> {
    const previous = get().chats;
    const known = new Map(previous.map((chat) => [chat.id, chat]));
    const activeChatId = get().activeChatId;
    const rows = entries.flatMap((entry) => h.summariesFor(entry));
    // Confirms the newest preview of every row and applies the delivered mark the server reports to our own loaded messages.
    for (const row of rows) {
      applyChatDelivery(historyCtx, row);
    }
    const wanted = new Set(rows.map((row) => row.id));
    set({
      chats: mergeChatRows(previous, rows, activeChatId, s.chatPrefRows, ports.now().getTime()),
    });
    h.rememberGroupIds(entries);
    // A topic that disappeared while open goes back to its group's topics screen with a notice that never names the topic.
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
      // Dedupe per group id: every topic row joins its own room, but names come from one shared detail GET.
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

  // Prefs and folders never fail, and a failing chat list does not cancel them.
  const fetchChatList = Effect.gen(function* () {
    const { api } = yield* Ports;
    return yield* Effect.all(
      [lift(() => api.getChats()), detached(loadPrefRows), detached(loadFolders)],
      { concurrency: 'unbounded' },
    ).pipe(Effect.option);
  });

  // The generation is checked after the fetch: a refresh run by an action, outside the generation's fibers, must not land after a stop.
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
      // The chat just opened is now active, so every other chat drops to its newest KEEP_INACTIVE messages.
      pruneInactiveChats(historyCtx, chatId);
      h.recordRead(chatId, s.lastRead[chatId]);
      clearUnreadMarkOnOpen(ctx, chatId);
      // The detail first: it fills the cache, so the member-name fallback shares the same GET on a cold open.
      const groupId = h.groupIdForChat(chatId);
      if (groupId !== undefined) {
        ctx.forkSession(fx.ensureGroupDetail(groupId));
      }
      ctx.forkSession(fx.ensureGroupMembers(chatId));
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
