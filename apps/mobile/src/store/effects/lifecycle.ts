// effect-plain: the async expo-file-system seam for the shared codec; failures are swallowed.
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
  decodeChatListCache,
  encodeChatListCache,
} from '@zilar/client-core/store';
import type { ChatSummary } from '@zilar/chat-core';

import type { ChatEntry, Contact, Me } from '../../lib/chat-api';
import type { ChatPref } from '../../lib/chat-prefs-api';
import { applyChatPrefs } from '../../lib/chat-prefs';
import { dismissChatNotifications, syncBadge } from '../../lib/push/badge';
import { markCachePainted } from '../../lib/startup-paint';
import type { ChatStoreState, LoadState } from '../types';
import type { StoreCtx } from './runtime';

const CHAT_LIST_CACHE_FILE_NAME = 'zilar-chat-list.json';

function cacheUri(documentDirectory: string): string {
  return documentDirectory + CHAT_LIST_CACHE_FILE_NAME;
}

async function readCacheFile(): Promise<string | null> {
  try {
    const { documentDirectory, readAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return null;
    }
    return await readAsStringAsync(cacheUri(documentDirectory));
  } catch {
    return null;
  }
}

async function writeCacheFile(contents: string): Promise<void> {
  try {
    const { documentDirectory, writeAsStringAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return;
    }
    await writeAsStringAsync(cacheUri(documentDirectory), contents);
  } catch {
    // Ignore the failure: messaging must not depend on the cache.
  }
}

async function deleteCacheFile(): Promise<void> {
  try {
    const { documentDirectory, deleteAsync } = await import('expo-file-system/legacy');
    if (documentDirectory === null) {
      return;
    }
    await deleteAsync(cacheUri(documentDirectory), { idempotent: true });
  } catch {
    // Ignore the failure on the way out.
  }
}

/**
 * `chats` keeps unknown fields, so a newer build's cache still paints.
 */
export async function readChatListCache(): Promise<{
  userId: string;
  chats: ChatSummary[];
} | null> {
  const raw = await readCacheFile();
  return raw === null ? null : (decodeChatListCache(raw) ?? null);
}

function writeChatListCache(userId: string, chats: readonly ChatSummary[]): void {
  if (userId === '') {
    return;
  }
  try {
    void writeCacheFile(encodeChatListCache(userId, chats));
  } catch {
    // A serialization failure must never break messaging.
  }
}

/** Called on sign-out, so one user's list never paints as another's. */
function clearChatListCache(): void {
  void deleteCacheFile();
}

export interface Lifecycle {
  start(): void;
  stop(): void;
  restartBoot(): void;
  finishDraftTurn(chatId: string, turnId: string): void;
}

const toCoreLoad = (load: LoadState): HistoryLoad => (load === 'loaded' ? 'ready' : load);
const toMobileLoad = (load: HistoryLoad): LoadState => (load === 'ready' ? 'loaded' : load);

// Background longer than 10 s suspends the session so ejabberd pushes; brief switches keep the socket.
export const BACKGROUND_SUSPEND_GRACE_MS = 10_000;

export function makeLifecycle(ctx: StoreCtx): Lifecycle {
  const { get, set, s, life, h, coreCtx, offline } = ctx;

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

  // Separate from `s.core`: a closed attempt clears this one, so a resume after a failed connect boots a fresh core.
  let lifecycleCore: XmppCore | undefined;

  let lifecycleCtx!: LifecycleCtx;

  const saveChatListNow = (): void => {
    const state = get();
    if (state.chatsLoad === 'loaded') {
      writeChatListCache(state.currentUserId, state.chats);
    }
  };

  // Loads cached messages before the boot so an open chat paints at once; a file left by another user is ignored, and the next save replaces it.
  const hydrateOfflineCache = async (): Promise<void> => {
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
    // The cached pins paint the banner before the pins answer, so the thread does not drop.
    get().seedCachedPins(cached.pins ?? {});
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
        // Paint the saved list before `/api/chats` answers; the boot replaces it right after.
        const paintChatList = readChatListCache().then((cached) => {
          if (cached === null || get().chats.length > 0) {
            return;
          }
          lifecycleCtx.cachedUserId = cached.userId;
          set({ chats: cached.chats, chatsLoad: 'loaded' });
        });
        // The splash stays up until both reads land, so the first frame is content, not a skeleton.
        void Promise.allSettled([paintChatList, hydrateOfflineCache()]).then(() => {
          markCachePainted();
        });
      } else {
        markCachePainted();
      }
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
        // Leaving the foreground (web's `pagehide`): save the list now so the next cold start paints the latest.
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
    joinGroups: (core, me, hooks) => ctx.run(ctx.fx.joinGroups(core, me as Me, hooks)),
    saveChatList: saveChatListNow,
    refreshDefaultBackground: () => {},
    loadFolders: () => {
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
    // Shares the text outbox with `sendCtx`; `reset()` clears it on sign-out, so one user's queue never goes out as another user's.
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
      // The core sees every assignment, including the `undefined` a closed attempt writes; `teardown()` clears it on sign-out.
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
    get joinedRooms() {
      return coreCtx.fx.joinedRooms;
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
      // And the offline cache, so the next user starts clean; no late write recreates it.
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
