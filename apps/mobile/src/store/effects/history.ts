import { Effect } from 'effect';
import type { ChatSummary, UiMessage } from '@zilar/chat-core';
import type { XmppCore } from '@zilar/xmpp-core';
import {
  adoptNewRows,
  bridgeLocals,
  flushPending,
  loadOlder as loadOlderCore,
  loadPreview,
  mergeFreshChats,
  openAtMessage as openAtMessageCore,
  openChatCore,
  openHistory,
  type HistoryCtx,
} from '@zilar/client-core/store';

import type { ChatEntry } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { TOPIC_GONE_NOTICE } from '../../lib/topics';
import { Ports } from './ports';
import { detached, isClosed, lift, orElse, recover, type StoreCtx } from './runtime';

function makeHistoryCtx(ctx: StoreCtx): HistoryCtx {
  const { get, set, s } = ctx;

  // `rt`, `k`, `fx`, the ports and the bookkeeping are the same objects the rest of the core uses, so a read mark or cursor written here is visible everywhere.
  const historyCtx: HistoryCtx = {
    get,
    set,
    ports: ctx.coreCtx.ports,
    rt: ctx.coreCtx.rt,
    k: ctx.coreCtx.k,
    fx: ctx.coreCtx.fx,
    core: s.core,
    lastRead: s.lastRead,
    lastReadUserId: ctx.coreCtx.lastReadUserId,
    pendingOutgoing: s.pendingOutgoing,
    groupsJoined: s.groupsJoined,
    pendingOpenChatId: s.pendingOpenChatId,
    cursors: s.cursors,
    loadingHistory: s.loadingHistory,
    loadingOlder: s.loadingOlder,
  };

  bridgeLocals(s, historyCtx, ['core', 'lastRead', 'groupsJoined', 'pendingOpenChatId']);

  return historyCtx;
}

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

  // A server row at least as new as memory wins (a read on another device clears here); a newer in-memory preview wins. Topic rows that disappeared vanish; chat prefs apply after the merge. Returns the rows from before the merge so the caller can tell which ones are new.
  function mergeChatEntries(entries: ChatEntry[]): ChatSummary[] {
    const rows = entries.flatMap((entry) => h.summariesFor(entry));
    const previous = mergeFreshChats(
      historyCtx,
      rows,
      entries,
      s.chatPrefRows,
      ports.now().getTime(),
    );
    // A topic that disappeared while open goes back to its group's topics screen with a notice that never names the topic.
    const wanted = new Set(rows.map((row) => row.id));
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
    return previous;
  }

  const adoptChatEntries = (entries: ChatEntry[], known: ReadonlyMap<string, ChatSummary>) => {
    const current = s.core;
    const me = get().me;
    if (current === undefined || me === undefined) {
      return Effect.void;
    }
    // Dedupe per group id: every topic row joins its own room, but names come from one shared detail GET.
    const detailStarted = new Set<string>();
    const rows = entries.flatMap((entry) => h.summariesFor(entry));
    return adoptNewRows(historyCtx, current, me, rows, known, (row) => {
      const groupId = row.groupId ?? groupIds.get(row.id);
      if (groupId !== undefined && !detailStarted.has(groupId)) {
        detailStarted.add(groupId);
        ctx.forkSession(fx.ensureGroupDetail(groupId));
      }
      ctx.forkSession(fx.ensureGroupMembers(row.id));
    });
  };

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
    const previous = mergeChatEntries(entries);
    flushPending(historyCtx);
    yield* adoptChatEntries(entries, new Map(previous.map((chat) => [chat.id, chat])));
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
    const previous = mergeChatEntries(entries);
    set({ chatsLoad: 'loaded' });
    flushPending(historyCtx);
    yield* adoptChatEntries(entries, new Map(previous.map((chat) => [chat.id, chat])));
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
    loadPreview: (current, chat) => loadPreview(historyCtx, current, chat),
    flushPending: () => {
      flushPending(historyCtx);
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
      const load = openChatCore(historyCtx, chatId, {
        // The pref write keeps the server in step when no numeric read mark can be sent.
        writeUnreadMark: (id) =>
          ctx.fork(lift(() => get().setChatPref(id, { unreadMark: false })).pipe(Effect.ignore)),
      });
      // The detail first: it fills the cache, so the member-name fallback shares the same GET on a cold open.
      const groupId = h.groupIdForChat(chatId);
      if (groupId !== undefined) {
        ctx.forkSession(fx.ensureGroupDetail(groupId));
      }
      ctx.forkSession(fx.ensureGroupMembers(chatId));
      ctx.forkSession(fx.loadPins(chatId, true));
      fx.startPinsPolling(chatId);
      ctx.forkSession(load);
    },
  };
}
