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
  type HistoryLoad,
  type HistoryPatch,
  type HistoryState,
  type LifecycleCtx,
  type StoreAppHooks,
} from '@zilar/client-core/store';

import type { ChatEntry, Contact, Me } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
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

/**
 * Runs the mobile store on the core lifecycle. The core owns the store and
 * session scopes (`life.lifetime`) and the connect retry; the adapter supplies
 * the mobile state, the app hooks and the resume listener (AppState focus).
 */
export function makeLifecycle(ctx: StoreCtx): Lifecycle {
  const { get, set, s, life, h, coreCtx } = ctx;

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

  const appHooks: StoreAppHooks = {
    syncBadge: () => {},
    dismissChatNotifications: () => {},
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
      }
      const unsubscribe = ctx.ports.visibility.onFocus(() => {
        life.lifetime.fork(coreReconnect(lifecycleCtx));
      });
      life.lifetime.onStoreClose(Effect.sync(unsubscribe));
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
    saveChatList: () => {},
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
