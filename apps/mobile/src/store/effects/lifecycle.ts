// The mobile bindings of the store lifecycle. `start`, `stop`, the chat list
// retry and the resume now live in `@zilar/client-core/store` (T-0918); this
// file builds the `LifecycleCtx` the core functions run on, maps the mobile
// `historyLoad`/`'loaded'` names to the core's `historyState`/`'ready'`, and
// keeps the mobile-only app hooks (the AppState resume, the mobile caches).
import type { XmppCore } from '@zilar/xmpp-core';
import { Effect } from 'effect';
import {
  clearDraftTimeout,
  markTurnFinished,
  reconnect as coreReconnect,
  reset,
  retryBoot as coreRetryBoot,
  startStore as coreStartStore,
  stopStore as coreStopStore,
  suspendStore as coreSuspendStore,
  type HistoryLoad,
  type HistoryPatch,
  type HistoryState,
  type LifecycleCtx,
  type StoreAppHooks,
} from '@zilar/client-core/store';

import type { ChatEntry, Contact, Me } from '../../lib/chat-api';
import {
  clearChatListCache,
  readChatListCache,
  writeChatListCache,
} from '../../lib/chat-list-cache';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
import { dismissChatNotifications, syncBadge } from '../../lib/push/badge';
import type { ChatStoreState, LoadState } from '../types';
import type { StoreCtx } from './runtime';

export interface Lifecycle {
  start(): void;
  stop(): void;
  /** `reloadChats` while no core exists: ends the session and boots again. */
  restartBoot(): void;
  /** The AI's final message arrived: remember its turn, stop the chat's timer. */
  finishDraftTurn(chatId: string, turnId: string): void;
}

const toCoreLoad = (load: LoadState): HistoryLoad => (load === 'loaded' ? 'ready' : load);
const toMobileLoad = (load: HistoryLoad): LoadState => (load === 'ready' ? 'loaded' : load);

// How long the app may sit in `background` before the session suspends (F1):
// brief switches away keep the socket, longer ones let ejabberd push.
export const BACKGROUND_SUSPEND_GRACE_MS = 10_000;

/**
 * Runs the mobile store on the core lifecycle. The core owns the store and
 * session scopes (`life.lifetime`) and the connect retry; the adapter supplies
 * the mobile state, the app hooks and the resume listener (AppState focus).
 */
export function makeLifecycle(ctx: StoreCtx): Lifecycle {
  const { get, set, s, life, h, coreCtx, offline } = ctx;

  // The core's `HistoryState` over the mobile state: only the load-map name
  // and its `'ready'`/`'loaded'` value differ (as `effects/history.ts`).
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

  // The core's own handle on the XMPP core, separate from `s.core`. `s.core`
  // keeps the last handle for the history previews and the adoption path
  // (`effects/history.ts`), but a closed attempt clears this one, so a resume
  // after a failed connect boots a fresh core instead of reconnecting one whose
  // listeners are gone (PREREVIEW finding 1).
  let lifecycleCore: XmppCore | undefined;

  // Late-bound: the app hooks below call back into the context that holds them.
  let lifecycleCtx!: LifecycleCtx;

  // Saves the painted list for the next cold start (PERF-12); only a fully
  // loaded list is worth keeping. Called after a connect (by the core) and when
  // the app leaves the foreground, like web's `pagehide`.
  const saveChatListNow = (): void => {
    const state = get();
    if (state.chatsLoad === 'loaded') {
      writeChatListCache(state.currentUserId, state.chats);
    }
  };

  // T-1313: load the cached messages of the recent chats before the boot, so a
  // cold start (online or offline) opens an open chat at once. The chat list
  // stays the existing chat-list cache's job (PERF-12). The owner id is the
  // signed-in user's; a file left by another user is ignored here and the next
  // save (after the boot) replaces it.
  const hydrateOfflineCache = (): void => {
    void (async () => {
      const userId = await offline.sessionUserId();
      if (userId === undefined || userId === '') {
        return;
      }
      const cached = await offline.cache.hydrate(userId);
      if (cached === null) {
        return;
      }
      const state = get();
      const messagesByChat = { ...state.messagesByChat };
      for (const [chatId, list] of Object.entries(cached.messages)) {
        if (messagesByChat[chatId] === undefined) {
          messagesByChat[chatId] = list;
        }
      }
      set({ currentUserId: userId, messagesByChat });
    })();
  };

  const appHooks: StoreAppHooks = {
    syncBadge: () => {
      Effect.runFork(syncBadge(lifecycleCtx.get().chats));
    },
    dismissChatNotifications: (chatId) => {
      Effect.runFork(dismissChatNotifications(chatId));
    },
    loadGroupMembers: (chatId) => {
      ctx.forkSession(ctx.fx.ensureGroupMembers(chatId));
    },
    finishDraftTurn: (chatId, turnId) => {
      markTurnFinished(lifecycleCtx, turnId);
      clearDraftTimeout(lifecycleCtx, chatId);
    },
    forgetRetryBytes: () => {},
    setStatus: (status) => {
      set({ status });
    },
    prepareStart: () => {
      if (get().chats.length === 0) {
        set({ chatsLoad: 'loading' });
        // PERF-12: paint the saved list before `/api/chats` answers. The read
        // is async (a file), so this lands as a first paint and the boot
        // replaces it with fresh data right after.
        void readChatListCache().then((cached) => {
          if (cached === null || get().chats.length > 0) {
            return;
          }
          lifecycleCtx.cachedUserId = cached.userId;
          set({ chats: cached.chats, chatsLoad: 'loaded' });
        });
        hydrateOfflineCache();
      }
      // F1: `background` starts a 10 s grace that suspends the session, so
      // ejabberd pushes while the app is away; `active` cancels the grace
      // and the existing resume below wakes the session. `inactive` (an iOS
      // transition) does nothing: `onBackground` never fires for it.
      let suspendTimer: ReturnType<typeof setTimeout> | undefined;
      const clearSuspendTimer = (): void => {
        if (suspendTimer !== undefined) {
          clearTimeout(suspendTimer);
          suspendTimer = undefined;
        }
      };
      const unsubscribeFocus = ctx.ports.visibility.onFocus(() => {
        clearSuspendTimer();
        life.lifetime.fork(coreReconnect(lifecycleCtx));
      });
      const unsubscribeBackground = ctx.ports.onBackground(() => {
        clearSuspendTimer();
        // The app is leaving the foreground: save the list now (web's
        // `pagehide`), so the next cold start paints the latest. The offline
        // cache flushes its debounced write at the same point (T-1313).
        saveChatListNow();
        offline.cache.flush();
        suspendTimer = setTimeout(() => {
          suspendTimer = undefined;
          life.lifetime.fork(coreSuspendStore(lifecycleCtx));
        }, BACKGROUND_SUSPEND_GRACE_MS);
      });
      life.lifetime.onStoreClose(
        Effect.sync(() => {
          clearSuspendTimer();
          unsubscribeFocus();
          unsubscribeBackground();
        }),
      );
    },
    setChatsLoad: (load) => {
      set({ chatsLoad: load === 'ready' ? 'loaded' : load });
    },
    applyBoot: (input) => {
      const prefs = input.prefs as ChatPref[];
      s.chatPrefRows = prefs;
      set({
        me: input.me as Me,
        currentUserId: input.me.id,
        chats: applyChatPrefs(input.freshRows, prefs, ctx.ports.now().getTime()),
        contacts: input.contacts as Contact[],
        chatsLoad: 'loaded',
      });
    },
    rememberGroupIds: (entries) => {
      h.rememberGroupIds(entries as ChatEntry[]);
    },
    scheduleChatsRefresh: () => {
      ctx.fx.scheduleChatsRefresh();
    },
    refreshChats: () => {
      ctx.forkSession(ctx.fx.refreshChats);
    },
    refreshActiveChatPins: (chatId) => {
      ctx.fx.refreshActiveChatPins(chatId);
    },
    joinGroups: (core, me) => ctx.run(ctx.fx.joinGroups(core, me as Me)),
    saveChatList: saveChatListNow,
    refreshDefaultBackground: () => {},
    loadFolders: () => {
      // The folders load beside the chat list, as they did before the move to
      // the core lifecycle; a failure keeps the last list.
      ctx.forkSession(ctx.fx.loadFolders);
    },
    setMediaTrustedHosts: (hosts) => {
      s.mediaTrustedHosts = hosts ?? new Set();
      set({ mediaTrustedHosts: s.mediaTrustedHosts });
    },
    applyStop: () => {
      h.teardown();
    },
  };

  lifecycleCtx = {
    get: () => asHistoryState(get()),
    set: (update) => {
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
    },
    ports: coreCtx.ports,
    rt: life.lifetime,
    k: coreCtx.k,
    fx: appHooks,
    // Shares the text outbox (F4) with the send context: `sendCtx` and the
    // lifecycle flush/ack listeners write the same map. Set here rather than
    // constructed here: the send binding creates it with the store, and
    // `reset()` clears it on sign-out, so one user's queue never goes out
    // as another user.
    get outbox() {
      return coreCtx.outbox;
    },
    set outbox(value) {
      coreCtx.outbox = value;
    },
    get core() {
      return lifecycleCore;
    },
    set core(value) {
      // The core sees every assignment, including the `undefined` a closed
      // attempt writes. `s.core` keeps the last handle (its adoption path and
      // history previews use it best-effort); `teardown()` clears it on sign-out.
      lifecycleCore = value;
      if (value !== undefined) {
        s.core = value;
      }
    },
    get lastRead() {
      return s.lastRead;
    },
    set lastRead(value) {
      s.lastRead = value;
    },
    lastReadUserId: undefined,
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
    finishedTurns: s.finishedTurns,
    finishedTurnOrder: s.finishedTurnOrder,
    started: false,
    cachedUserId: undefined,
    connectRetryAttempt: 0,
    connectRetryPending: false,
    get mediaToken() {
      return s.mediaToken;
    },
    set mediaToken(value) {
      s.mediaToken = value;
    },
    boot: undefined,
  };

  return {
    start: () => {
      Effect.runSync(coreStartStore(lifecycleCtx));
    },
    stop: () => {
      Effect.runSync(coreStopStore(lifecycleCtx));
      reset(lifecycleCtx);
      // Sign-out forgets the cached list so the next user never paints this one.
      clearChatListCache();
      // And the offline cache, so the next user starts clean (T-1313). The
      // removal runs after any in-flight write; no late write recreates it.
      void offline.cache.clear();
    },
    restartBoot: () => {
      Effect.runSync(coreRetryBoot(lifecycleCtx));
    },
    finishDraftTurn: (chatId, turnId) => {
      markTurnFinished(lifecycleCtx, turnId);
      clearDraftTimeout(lifecycleCtx, chatId);
    },
  };
}
