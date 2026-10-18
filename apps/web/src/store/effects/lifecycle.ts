import { Effect } from 'effect';
import {
  reset,
  startStore as coreStartStore,
  stopStore as coreStopStore,
  retryBoot as coreRetryBoot,
  type BootInput,
  type JoinGroupsHooks,
} from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';
import type { ChatPref, Contact, Me } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { clearEmojiRecents } from '@/lib/emojiRecents';
import { resetHandleGateDismissal } from '@/lib/handleGate';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';
import { clearChatListCache, readChatListCache } from '../chatListCache';
import {
  clearMessageCache,
  MESSAGE_CACHE_WRITE_DELAY_MS,
  readCachedPins,
  readMessageCache,
  writeMessageCache,
} from '../messageCache';
import { mergeWithPainted } from './chatRows';
import { LAST_READ_PREFIX } from './constants';
import type { StoreCtx } from './ctx';
import { disableSessionPush } from '@/lib/push/sessionEnable';
import { writeStoredDevice } from '@/lib/push/deviceStorage';
import { joinGroups } from './groupMembers';
import { refreshChats, scheduleChatsRefresh } from './history';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import { applyPrefsWithUnreadMark } from './prefs';
import { saveChatList } from './reads';
import { prefsByJid, fromPromise } from './util';

export { CONNECT_RETRY_DELAYS_MS, readLastRead } from '@zilar/client-core/store';

export const startStore = (ctx: StoreCtx): Effect.Effect<void> => coreStartStore(ctx);

export const retryBoot = (ctx: StoreCtx): Effect.Effect<void> => coreRetryBoot(ctx);

/** Closes the store Scope; the message ledger stays. */
export const stopStore = (ctx: StoreCtx): Effect.Effect<void> => coreStopStore(ctx);

/** Clears every piece of per-user state: the session, the ledger, the caches and the handle
 * dismissals, so one account's chats and caches cannot leak into the next. */
export const resetUserState = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { storage } = yield* Ports;
    ctx.get().stop();
    reset(ctx);
    // A pending throttled save must not recreate the key after the clear.
    cancelScheduledMessageSave(ctx);
    clearChatListCache(storage);
    clearEmojiRecents(storage);
    clearMessageCache(storage);
    resetIsServerOwnerCache();
    // A new sign-in is a new session for the handle gate: clear every dismissal.
    resetHandleGateDismissal();
    ctx.cachedUserId = undefined;
    // The stored push device belongs to the previous account's server row, so the next
    // account must re-register instead of re-enabling it; a blocked storage reads as none.
    yield* Effect.try(() => writeStoredDevice(null)).pipe(Effect.ignore);
    const lastReadUserId = ctx.lastReadUserId;
    if (storage !== null && lastReadUserId !== undefined) {
      yield* Effect.try(() => storage.removeItem(`${LAST_READ_PREFIX}${lastReadUserId}`)).pipe(
        Effect.ignore,
      );
    }
    ctx.set({
      currentUserId: '',
      me: undefined,
      status: 'offline',
      chatsState: 'loading',
      historyState: {},
      chats: [],
      contacts: [],
      chatPrefs: {},
      defaultBackground: null,
      pinsByChat: {},
      pinsReady: {},
      pinsPanel: undefined,
      pinsError: undefined,
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      activeChatId: undefined,
      groupInfos: {},
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
    });
    ctx.groupMembers.clear();
    ctx.groupInfos.clear();
    // Every id the ledger knows is user scoped: an author, origin id, text, alias chain and
    // server-id link must not survive into the next sign-in, so reset() clears them all.
    ctx.k.reset();
  });

export const signOutStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { goToLogin } = yield* Ports;
    // The stored pair outlives the session otherwise, so disable it before the disconnect.
    yield* Effect.promise(() =>
      Effect.runPromise(
        disableSessionPush({ setPushPair: (input) => ctx.get().setPushPair(input) }),
      ),
    ).pipe(Effect.ignore);
    yield* resetUserState(ctx);
    yield* fromPromise(() => authClient.signOut()).pipe(Effect.ignore);
    goToLogin();
  });

// One pending throttled write per store; a sign-out drops it so it cannot recreate the key.
const messageSaveTimers = new WeakMap<StoreCtx, ReturnType<typeof setTimeout>>();

function cancelScheduledMessageSave(ctx: StoreCtx): void {
  const timer = messageSaveTimers.get(ctx);
  if (timer !== undefined) {
    clearTimeout(timer);
    messageSaveTimers.delete(ctx);
  }
}

export function saveMessages(ctx: StoreCtx): void {
  cancelScheduledMessageSave(ctx);
  const state = ctx.get();
  writeMessageCache(
    ctx.ports.storage,
    state.currentUserId,
    state.chats,
    state.messagesByChat,
    state.pinsByChat,
  );
}

export function scheduleMessageSave(ctx: StoreCtx): void {
  const state = ctx.get();
  if (state.currentUserId === '' || typeof window === 'undefined') {
    return;
  }
  cancelScheduledMessageSave(ctx);
  const timer = setTimeout(() => {
    messageSaveTimers.delete(ctx);
    saveMessages(ctx);
  }, MESSAGE_CACHE_WRITE_DELAY_MS);
  messageSaveTimers.set(ctx, timer);
}

export function prepareStart(ctx: StoreCtx): void {
  const { storage } = ctx.ports;
  if (ctx.get().chats.length === 0) {
    const cached = readChatListCache(storage);
    if (cached === null) {
      ctx.set({ chatsState: 'loading' });
    } else {
      ctx.cachedUserId = cached.userId;
      ctx.set({ chats: cached.chats, chatsState: 'ready' });
      // Then the open chat's last rows, so it is not empty until XMPP connects.
      const cachedMessages = readMessageCache(storage, cached.userId);
      if (Object.keys(cachedMessages).length > 0) {
        ctx.set((state) => ({
          messagesByChat: { ...state.messagesByChat, ...cachedMessages },
        }));
      }
      // The cached pins paint the banner with the first frame; the pin load on open replaces them.
      const cachedPins = readCachedPins(storage, cached.userId);
      const missingPins = Object.fromEntries(
        Object.entries(cachedPins).filter(
          ([chatId]) => (ctx.get().pinsByChat[chatId] ?? []).length === 0,
        ),
      );
      if (Object.keys(missingPins).length > 0) {
        ctx.set((state) => ({
          pinsByChat: { ...state.pinsByChat, ...missingPins },
        }));
      }
    }
  }
  if (typeof window !== 'undefined') {
    const onPageHide = (): void => {
      saveChatList(ctx);
      saveMessages(ctx);
    };
    window.addEventListener('pagehide', onPageHide);
    ctx.rt.onStoreClose(Effect.sync(() => window.removeEventListener('pagehide', onPageHide)));
  }
}

export function applyBoot(ctx: StoreCtx, input: BootInput): void {
  const prefs = input.prefs as ChatPref[];
  ctx.set({
    me: input.me as Me,
    currentUserId: input.me.id,
    chats: applyPrefsWithUnreadMark(
      mergeWithPainted(input.previousChats, input.freshRows, input.sameUser),
      prefs,
      ctx.ports.now().getTime(),
    ),
    contacts: input.contacts as Contact[],
    chatPrefs: prefsByJid(prefs),
    chatsState: 'ready',
  });
}

export function applyStop(ctx: StoreCtx): void {
  ctx.set({ defaultBackground: null, mediaTrustedHosts: undefined });
  ctx.sendRuns.clear();
}

export function rememberGroupIds(ctx: StoreCtx, entries: readonly unknown[]): void {
  ctx.k.rememberGroupIds(entries as Parameters<typeof ctx.k.rememberGroupIds>[0]);
}

export function refreshChatsNow(ctx: StoreCtx): void {
  ctx.rt.fork(refreshChats(ctx));
}

export function refreshActiveChatPinsNow(ctx: StoreCtx, chatId: string): void {
  ctx.rt.fork(refreshPinsFor(ctx, chatId));
}

export function joinGroupsNow(
  ctx: StoreCtx,
  core: XmppCore,
  me: unknown,
  hooks?: JoinGroupsHooks,
): Promise<void> {
  return ctx.rt.runPromise(joinGroups(ctx, core, me as Me, hooks));
}

export { scheduleChatsRefresh, saveChatList };
