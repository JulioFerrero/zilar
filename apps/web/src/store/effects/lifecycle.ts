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
} from '@zilar/client-core/store';
import type { XmppCore } from '@zilar/xmpp-core';
import type { ChatPref, Contact, Me } from '@/lib/api';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { authClient } from '@/lib/auth';
import { resetHandleGateDismissal } from '@/lib/handleGate';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';
import { clearChatListCache, readChatListCache } from '../chatListCache';
import { mergeWithPainted } from './chatRows';
import { LAST_READ_PREFIX } from './constants';
import type { StoreCtx } from './ctx';
import { joinGroups } from './groupMembers';
import { refreshChats, scheduleChatsRefresh } from './history';
import { refreshPinsFor } from './pins';
import { Ports } from './ports';
import { saveChatList } from './reads';
import { prefsByJid, fromPromise } from './util';

export { CONNECT_RETRY_DELAYS_MS, readLastRead } from '@zilar/client-core/store';

/** Opens a session, paints the cached list and boots (R9: idempotent). */
export const startStore = (ctx: StoreCtx): Effect.Effect<void> => coreStartStore(ctx);

/** The chat list "retry": a fresh session boots again. */
export const retryBoot = (ctx: StoreCtx): Effect.Effect<void> => coreRetryBoot(ctx);

/** Closes the store Scope; the message ledger stays (R10). */
export const stopStore = (ctx: StoreCtx): Effect.Effect<void> => coreStopStore(ctx);

export const signOutStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { storage, goToLogin } = yield* Ports;
    ctx.get().stop();
    reset(ctx);
    clearChatListCache(storage);
    resetIsServerOwnerCache();
    // A new sign-in is a new session for the handle gate: clear every
    // dismissal so the next user is asked again.
    resetHandleGateDismissal();
    ctx.cachedUserId = undefined;
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
    // The per-message edit caches are user scoped too: a message's author,
    // origin id and base text must not survive into the next sign-in.
    ctx.messageAuthors.clear();
    ctx.messageOriginIds.clear();
    ctx.messageBaseTexts.clear();
    // The app still clears local state even if sign-out fails.
    yield* fromPromise(() => authClient.signOut()).pipe(Effect.ignore);
    goToLogin();
  });

// --- Adapter code: the web-only parts of the lifecycle the core calls back. ---

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
    }
  }
  if (typeof window !== 'undefined') {
    const onPageHide = (): void => saveChatList(ctx);
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
    chats: applyChatPrefs(
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
export function joinGroupsNow(ctx: StoreCtx, core: XmppCore, me: unknown): Promise<void> {
  return ctx.rt.runPromise(joinGroups(ctx, core, me as Me));
}

export { scheduleChatsRefresh, saveChatList };
