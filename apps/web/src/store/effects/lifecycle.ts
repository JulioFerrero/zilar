// The web bindings of the store lifecycle. `start`, `stop` and the chat list
// retry now live in `@zilar/client-core/store`; this file keeps the web-only
// adapter code (the cached paint, `pagehide`, the boot state write and
// sign-out) and binds the core to web's `StoreCtx`.
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

/** Opens a session, paints the cached list and boots (R9: idempotent). */
export const startStore = (ctx: StoreCtx): Effect.Effect<void> => coreStartStore(ctx);

/** The chat list "retry": a fresh session boots again. */
export const retryBoot = (ctx: StoreCtx): Effect.Effect<void> => coreRetryBoot(ctx);

/** Closes the store Scope; the message ledger stays (R10). */
export const stopStore = (ctx: StoreCtx): Effect.Effect<void> => coreStopStore(ctx);

/**
 * Clears every piece of per-user state: the store session, the message ledger,
 * the caches and the sign-in gate dismissals. `signOutStore` calls it on the
 * way out, and `switchUser` calls it when a different account signs in, so the
 * previous account's chats and per-message caches cannot leak into the new one.
 */
export const resetUserState = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { storage } = yield* Ports;
    ctx.get().stop();
    reset(ctx);
    // A pending throttled save must not recreate the key after the clear.
    cancelScheduledMessageSave(ctx);
    clearChatListCache(storage);
    clearMessageCache(storage);
    resetIsServerOwnerCache();
    // A new sign-in is a new session for the handle gate: clear every
    // dismissal so the next user is asked again.
    resetHandleGateDismissal();
    ctx.cachedUserId = undefined;
    // A new sign-in is a new user for the push handle too (T-1152): the stored
    // device belongs to the previous account's server row, so the next account
    // must re-register instead of re-enabling it. A blocked storage reads as
    // none either way, and clearing never blocks the reset.
    yield* Effect.try(() => writeStoredDevice(null)).pipe(Effect.ignore);
    const lastReadUserId = ctx.lastReadUserId;
    if (storage !== null && lastReadUserId !== undefined) {
      // Ignore storage failures on the way out.
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
    // Every id the ledger knows is user scoped too: a message's author,
    // origin id, base text, alias chain and server-id link must not survive
    // into the next sign-in. `reset()` clears them all; the manual clears only
    // covered three maps and missed the alias and server-id ones (UI-13).
    ctx.k.reset();
  });

export const signOutStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { goToLogin } = yield* Ports;
    // The stored pair outlives the session otherwise (T-1152): disable it
    // before the store disconnects, best effort with the 2 s timeout inside.
    yield* Effect.promise(() =>
      Effect.runPromise(
        disableSessionPush({ setPushPair: (input) => ctx.get().setPushPair(input) }),
      ),
    ).pipe(Effect.ignore);
    yield* resetUserState(ctx);
    // The app still clears local state even if sign-out fails.
    yield* fromPromise(() => authClient.signOut()).pipe(Effect.ignore);
    goToLogin();
  });

// --- Adapter code: the web-only parts of the lifecycle the core calls back. ---

// One pending throttled write per store. A sign-out drops it, so it can never
// recreate the key after the reset removed it.
const messageSaveTimers = new WeakMap<StoreCtx, ReturnType<typeof setTimeout>>();

function cancelScheduledMessageSave(ctx: StoreCtx): void {
  const timer = messageSaveTimers.get(ctx);
  if (timer !== undefined) {
    clearTimeout(timer);
    messageSaveTimers.delete(ctx);
  }
}

/** Writes the message cache now (`pagehide`) and drops any pending write. */
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

/** Schedules one write about 2 s after the last message change. */
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

/** Paints the cached list and arms `pagehide`, once per store. */
export function prepareStart(ctx: StoreCtx): void {
  const { storage } = ctx.ports;
  if (ctx.get().chats.length === 0) {
    const cached = readChatListCache(storage);
    if (cached === null) {
      ctx.set({ chatsState: 'loading' });
    } else {
      // Paint the last list at once; boot replaces it with fresh data.
      ctx.cachedUserId = cached.userId;
      ctx.set({ chats: cached.chats, chatsState: 'ready' });
      // Then the open chat's last rows, so it is not empty until XMPP
      // connects. The history page merges over them in place.
      const cachedMessages = readMessageCache(storage, cached.userId);
      if (Object.keys(cachedMessages).length > 0) {
        ctx.set((state) => ({
          messagesByChat: { ...state.messagesByChat, ...cachedMessages },
        }));
      }
      // The cached pins paint the banner with the first frame; the pin load on
      // open still replaces them. A chat that already has pins keeps them.
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

/** Writes the boot result into web's own state. */
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

/** Clears web's per-session state on `stop()`. */
export function applyStop(ctx: StoreCtx): void {
  ctx.set({ defaultBackground: null, mediaTrustedHosts: undefined });
  ctx.sendRuns.clear();
}

/** Records the group id of every chat row (web's `rememberGroupIds`). */
export function rememberGroupIds(ctx: StoreCtx, entries: readonly unknown[]): void {
  ctx.k.rememberGroupIds(entries as Parameters<typeof ctx.k.rememberGroupIds>[0]);
}

/** Re-fetches the chat list now. */
export function refreshChatsNow(ctx: StoreCtx): void {
  ctx.rt.fork(refreshChats(ctx));
}

/** Refreshes the open chat's pins now. */
export function refreshActiveChatPinsNow(ctx: StoreCtx, chatId: string): void {
  ctx.rt.fork(refreshPinsFor(ctx, chatId));
}

/** Joins new group rooms and loads their members; resolves when the joins are done. */
export function joinGroupsNow(
  ctx: StoreCtx,
  core: XmppCore,
  me: unknown,
  hooks?: JoinGroupsHooks,
): Promise<void> {
  return ctx.rt.runPromise(joinGroups(ctx, core, me as Me, hooks));
}

export { scheduleChatsRefresh, saveChatList };
