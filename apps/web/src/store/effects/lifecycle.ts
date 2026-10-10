// start, stop, sign-out, boot, the XMPP connection and its retries. One store
// Scope runs from `start()` to `stop()`; each boot attempt (`start()` and the
// chat list "retry") owns a session Scope inside it, and each XMPP connection
// attempt owns a Scope inside the session. Closing a Scope interrupts the
// fibers forked in it and removes its listeners and its connection.
import { Effect, Exit, Schema, Scope } from 'effect';
import {
  handleDisplayed,
  handleMessage,
  handleOccupants,
  handlePresence,
  handleTyping,
} from '@zilar/client-core/store';
import type { XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import type { ChatPref, Me, XmppToken } from '@/lib/api';
import { authClient } from '@/lib/auth';
import { trustedMediaHosts } from '@/lib/attachments';
import { applyChatPrefs } from '@/lib/chatPrefs';
import { resetHandleGateDismissal } from '@/lib/handleGate';
import { resetIsServerOwnerCache } from '@/lib/useIsServerOwner';
import { clearChatListCache, readChatListCache } from '../chatListCache';
import type { ConnectionStatus } from '../store';
import { mergeWithPainted, sortByRecency, summariesFor } from './chatRows';
import { CONNECT_RETRY_DELAYS_MS, LAST_READ_PREFIX } from './constants';
import type { StoreCtx } from './ctx';
import { joinGroups } from './groupMembers';
import { flushPending, loadPreview, scheduleChatsRefresh } from './history';
import {
  clearFinishedTurns,
  startChatsPolling,
  startDraftStream,
  startPinsPolling,
} from './polling';
import { Ports, type StorageLike } from './ports';
import { saveChatList } from './reads';
import type { Fibers } from './runtime';
import { fromPromise, prefsByJid } from './util';

const parseJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

/** The last-read message ids saved for a user; anything unusable reads as none. */
export const readLastRead = (
  storage: StorageLike | null,
  userId: string,
): Effect.Effect<Record<string, string>> => {
  const none: Record<string, string> = {};
  if (storage === null) {
    return Effect.succeed(none);
  }
  return Effect.try(() => storage.getItem(`${LAST_READ_PREFIX}${userId}`)).pipe(
    Effect.map((raw) => {
      if (raw === null) {
        return none;
      }
      const parsed = parseJson(raw);
      if (Exit.isFailure(parsed)) {
        return none;
      }
      const value = parsed.value;
      if (value === null || typeof value !== 'object') {
        return none;
      }
      const result: Record<string, string> = {};
      for (const [chatId, messageId] of Object.entries(value)) {
        if (typeof messageId === 'string') {
          result[chatId] = messageId;
        }
      }
      return result;
    }),
    Effect.orElseSucceed(() => none),
  );
};

/** Opens a session, paints the cached chat list and boots. */
export const startStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { storage } = yield* Ports;
    const session = ctx.rt.beginSession();
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
    session.fork(boot(ctx, session));
  });

/** The chat list "retry": a fresh session boots again. */
export const retryBoot = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.sync(() => {
    ctx.connectRetryPending = false;
    const session = ctx.rt.beginSession();
    ctx.set({ chatsState: 'loading' });
    session.fork(boot(ctx, session));
  });

/** Closes the store Scope: every fiber, listener and the connection go. */
export const stopStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.sync(() => {
    clearFinishedTurns(ctx);
    ctx.set({ drafts: {}, finishedDraftMessages: {}, defaultBackground: null });
    ctx.pendingOpenChatId = undefined;
    ctx.rt.closeStore();
    ctx.sendRuns.clear();
    ctx.connectRetryAttempt = 0;
    ctx.connectRetryPending = false;
    ctx.groupsJoined = false;
    ctx.mediaToken = undefined;
    ctx.set({ mediaTrustedHosts: undefined });
  });

export const signOutStore = (ctx: StoreCtx): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { storage, goToLogin } = yield* Ports;
    ctx.get().stop();
    clearChatListCache(storage);
    resetIsServerOwnerCache();
    // A new sign-in is a new session for the handle gate: clear every
    // dismissal so the next user is asked again.
    resetHandleGateDismissal();
    ctx.cachedUserId = undefined;
    ctx.lastRead = {};
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
      messagesByChat: {},
      reactions: {},
      edits: {},
      pinsByChat: {},
      pinsReady: {},
      pinsPanel: undefined,
      pinsError: undefined,
      editTarget: undefined,
      actionError: undefined,
      mediaTrustedHosts: undefined,
      activeChatId: undefined,
      historyComplete: {},
      groupInfos: {},
      typing: {},
      drafts: {},
      finishedDraftMessages: {},
      search: '',
      searchChat: undefined,
      activeFolder: 'all',
      folders: [],
    });
    ctx.groupMembers.clear();
    ctx.groupInfos.clear();
    ctx.messageAuthors.clear();
    ctx.messageOriginIds.clear();
    ctx.messageBaseTexts.clear();
    // The app still clears local state even if sign-out fails.
    yield* fromPromise(() => authClient.signOut()).pipe(Effect.ignore);
    goToLogin();
  });

const boot = (ctx: StoreCtx, session: Fibers): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api, storage, now } = yield* Ports;
    const loaded = yield* Effect.exit(
      Effect.all(
        [
          fromPromise(() => api.getMe()),
          fromPromise(() => api.getChats()),
          fromPromise(() => api.getContacts()),
          fromPromise(() => api.listChatPrefs()).pipe(
            Effect.catchCause(() => Effect.succeed([] as ChatPref[])),
          ),
        ],
        { concurrency: 'unbounded' },
      ),
    );
    if (Exit.isFailure(loaded)) {
      ctx.set({ status: 'offline', chatsState: 'error' });
      return;
    }
    const [me, entries, contacts, prefs] = loaded.value;

    ctx.lastReadUserId = me.id;
    ctx.lastRead = yield* readLastRead(storage, me.id);
    ctx.k.rememberGroupIds(entries);
    const freshRows = entries.flatMap((entry) => summariesFor(entry));
    ctx.set({
      me,
      currentUserId: me.id,
      chats: applyChatPrefs(
        mergeWithPainted(ctx.get().chats, freshRows, ctx.cachedUserId === me.id),
        prefs,
        now().getTime(),
      ),
      contacts,
      chatPrefs: prefsByJid(prefs),
      chatsState: 'ready',
    });
    // T-0461: the global background default is a nice-to-have; load it
    // without holding up the chat list, and leave it null on failure.
    yield* Effect.sync(() => {
      void ctx.get().refreshDefaultBackground();
    });
    yield* startDraftStream(ctx, session);
    yield* startChatsPolling(ctx, session);
    yield* startPinsPolling(ctx, session);
    flushPending(ctx);
    yield* connectXmpp(ctx, session, me);
  });

// After a failed token or login, try again with growing waits instead of
// staying offline until a reload (a 429 on the token route used to leave
// the app on "Waiting for network…" for good).
const scheduleConnectRetry = (
  ctx: StoreCtx,
  session: Fibers,
  me: Me,
): Effect.Effect<void, never, Ports> =>
  Effect.sync(() => {
    if (ctx.rt.session() !== session || ctx.connectRetryPending) {
      return;
    }
    const delay =
      CONNECT_RETRY_DELAYS_MS[
        Math.min(ctx.connectRetryAttempt, CONNECT_RETRY_DELAYS_MS.length - 1)
      ] ?? 0;
    ctx.connectRetryAttempt += 1;
    ctx.connectRetryPending = true;
    session.fork(
      Effect.sleep(delay).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            ctx.connectRetryPending = false;
            return connectXmpp(ctx, session, me);
          }),
        ),
      ),
    );
  });

// Listeners are plain callbacks: the core calls them synchronously, in the
// order it emits, which the store (and its tests) rely on.
function subscribeToCore(ctx: StoreCtx, current: XmppCore): () => void {
  const unsubscribers = [
    current.on('status', (status: ConnectionStatus) => {
      ctx.set({ status });
      if (status === 'online') {
        flushPending(ctx);
      }
    }),
    current.on('message', (message) => handleMessage(ctx, message)),
    current.on('typing', (event) => handleTyping(ctx, event)),
    current.on('displayed', (event) => handleDisplayed(ctx, event)),
    current.on('occupants', (event) => handleOccupants(ctx, event)),
    current.on('presence', (event) => handlePresence(ctx, event)),
    // A group invitation or a roster push means the chat list changed on the
    // server: refetch it, join any new group rooms and load their preview.
    current.on('invited', () => scheduleChatsRefresh(ctx)),
    current.on('roster', () => scheduleChatsRefresh(ctx)),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

const connectXmpp = (ctx: StoreCtx, session: Fibers, me: Me): Effect.Effect<void, never, Ports> =>
  Effect.gen(function* () {
    const { api, createXmpp } = yield* Ports;
    const tokenExit = yield* Effect.exit(fromPromise(() => api.getXmppToken()));
    if (Exit.isFailure(tokenExit)) {
      ctx.set({ status: 'offline' });
      yield* scheduleConnectRetry(ctx, session, me);
      return;
    }
    const token = tokenExit.value;
    let firstToken: XmppToken | undefined = token;
    ctx.mediaToken = { service: token.service, domain: token.domain };
    ctx.set({ mediaTrustedHosts: trustedMediaHosts(ctx.mediaToken) });

    // The first connect uses the token fetched above; every reconnect asks
    // for a fresh one.
    const nextToken = Effect.gen(function* () {
      if (firstToken !== undefined) {
        const fresh = firstToken;
        firstToken = undefined;
        return { jid: fresh.jid, token: fresh.token };
      }
      const fresh = yield* fromPromise(() => api.getXmppToken());
      ctx.mediaToken = { service: fresh.service, domain: fresh.domain };
      ctx.set({ mediaTrustedHosts: trustedMediaHosts(ctx.mediaToken) });
      return { jid: fresh.jid, token: fresh.token };
    });
    const options: XmppCoreOptions = {
      service: token.service,
      domain: token.domain,
      getToken: () => ctx.rt.runPromise(nextToken),
    };

    const attempt = yield* Scope.fork(session.scope);
    const current = createXmpp(options);
    ctx.core = current;
    const unsubscribe = subscribeToCore(ctx, current);
    yield* Scope.addFinalizer(
      attempt,
      Effect.sync(() => {
        unsubscribe();
        if (ctx.core === current) {
          ctx.core = undefined;
        }
        ctx.rt.runDetached(fromPromise(() => current.disconnect()).pipe(Effect.ignore));
      }),
    );

    const connected = yield* Effect.exit(fromPromise(() => current.connect()));
    if (Exit.isFailure(connected)) {
      ctx.set({ status: 'offline' });
      yield* Scope.close(attempt, Exit.void);
      yield* scheduleConnectRetry(ctx, session, me);
      return;
    }
    ctx.connectRetryAttempt = 0;
    ctx.set({ status: 'online' });
    flushPending(ctx);
    yield* joinGroups(ctx, current, me);
    ctx.groupsJoined = true;
    flushPending(ctx);
    yield* Effect.all(
      ctx.get().chats.map((chat) => loadPreview(ctx, current, chat)),
      { concurrency: 'unbounded' },
    );
    ctx.set((state) => ({ chats: sortByRecency(state.chats) }));
    saveChatList(ctx);
  });
