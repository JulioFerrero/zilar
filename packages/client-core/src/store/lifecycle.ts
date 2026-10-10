// start, stop, boot, the XMPP connection and its retries, and the resume hook.
// One store Scope runs from `start()` to `stop()`; each boot attempt (`start()`
// and the chat list "retry") owns a session Scope inside it, and each XMPP
// connection attempt owns a Scope inside the session. Closing a Scope interrupts
// the fibers forked in it and removes its listeners and its connection.
//
// The app-specific work (cached paint, the boot state write, joining rooms,
// saving the list) goes through `ctx.fx` hooks, so the core never needs the
// app's own `Ports` service.
import { Effect, Exit, Fiber, Schema, Scope } from 'effect';
import { trustedMediaHosts, type MediaTokenShape } from '@zilar/chat-core';
import type { ConnectionStatus, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import { fromPromise, type StoreAppHooks } from './ctx';
import { flushPending, loadPreview, type HistoryCtx } from './history';
import {
  handleDisplayed,
  handleMessage,
  handleOccupants,
  handlePresence,
  handleTyping,
} from './incoming';
import type { Fibers } from './lifetime';
import {
  clearFinishedTurns,
  startChatsPolling,
  startDraftStream,
  startPinsPolling,
  type DraftTurns,
} from './polling';
import { type CoreMe, type KeyValue } from './ports';
import { LAST_READ_PREFIX } from './reads';
import { sortByRecency } from './rows';

const parseJson = Schema.decodeUnknownExit(Schema.fromJsonString(Schema.Unknown));

// Waits between XMPP connect attempts after a failed token or login.
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

/** The boot in flight: a resume waits for it (R8). */
export interface LifecycleBoot {
  readonly session: Fibers<never>;
  readonly fiber: Fiber.Fiber<unknown, never>;
}

/** The lifecycle context: the history context plus the app hooks and the
 * per-store bookkeeping the boot and the connection retry keep. */
export interface LifecycleCtx extends HistoryCtx, DraftTurns {
  readonly fx: StoreAppHooks;
  /** True from `start()` until `stop()`: a second `start()` is a no-op (R9). */
  started: boolean;
  /** The user whose cached chat list was painted on start, if any. */
  cachedUserId: string | undefined;
  connectRetryAttempt: number;
  connectRetryPending: boolean;
  /** The XMPP token the latest connection used, for the media allow-list. */
  mediaToken: MediaTokenShape | undefined;
  /** The boot in flight, so a resume can wait for it (R8, mobile). */
  boot: LifecycleBoot | undefined;
}

/** The last-read message ids saved for a user; anything unusable reads as none. */
export const readLastRead = (
  storage: KeyValue | null,
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

/** Opens a session, paints the cached list and boots (R9: idempotent). */
export const startStore = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    if (ctx.started) {
      return;
    }
    ctx.started = true;
    const session = ctx.rt.beginSession();
    ctx.fx.prepareStart();
    ctx.boot = { session, fiber: session.fork(boot(ctx, session)) };
  });

/** The chat list "retry": a fresh session boots again. */
export const retryBoot = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    ctx.connectRetryPending = false;
    const session = ctx.rt.beginSession();
    ctx.fx.setChatsLoad('loading');
    ctx.boot = { session, fiber: session.fork(boot(ctx, session)) };
  });

/** Closes the store Scope: every fiber, listener and the connection go. The
 * message ledger stays (R10): `reset()` is what clears it. */
export const stopStore = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.sync(() => {
    ctx.started = false;
    ctx.boot = undefined;
    clearFinishedTurns(ctx);
    ctx.set({ drafts: {}, finishedDraftMessages: {} });
    ctx.pendingOpenChatId = undefined;
    ctx.rt.closeStore();
    ctx.connectRetryAttempt = 0;
    ctx.connectRetryPending = false;
    ctx.groupsJoined = false;
    ctx.mediaToken = undefined;
    ctx.fx.applyStop();
  });

/** Clears the message ledger and the per-session state. Mobile calls this from
 * its sign-out after `stop()`; web resets in its own `signOutStore` adapter. */
export function reset(ctx: LifecycleCtx): void {
  ctx.pendingOutgoing.clear();
  for (const chatId of Object.keys(ctx.cursors)) {
    delete ctx.cursors[chatId];
  }
  ctx.lastRead = {};
  ctx.set({
    messagesByChat: {},
    edits: {},
    reactions: {},
    typing: {},
    drafts: {},
    finishedDraftMessages: {},
    historyComplete: {},
  });
}

/**
 * A resume from the background: behind `flags.reconnectOnResume` only (R8).
 * Waits for the boot in flight, reconnects a core that dropped, or boots when
 * there is none. Web leaves the flag off and does not use it.
 */
export const reconnect = (ctx: LifecycleCtx): Effect.Effect<void> =>
  Effect.suspend(() => {
    if (!ctx.ports.flags.reconnectOnResume || !ctx.started) {
      return Effect.void;
    }
    const pending = ctx.boot;
    if (pending !== undefined) {
      return Fiber.await(pending.fiber).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            // The awaited boot failed before creating a core: try again for
            // this session instead of silently dropping the resume.
            if (ctx.core === undefined && ctx.started && ctx.rt.session() === pending.session) {
              return retryBoot(ctx);
            }
            return Effect.void;
          }),
        ),
      );
    }
    const current = ctx.core;
    if (current === undefined) {
      return retryBoot(ctx);
    }
    if (ctx.get().status === 'online') {
      return Effect.void;
    }
    return fromPromise(() => current.connect()).pipe(
      Effect.andThen(
        Effect.gen(function* () {
          ctx.fx.setStatus('online');
          flushPending(ctx);
          const me = ctx.get().me;
          if (me !== undefined && me !== null) {
            yield* fromPromise(() => ctx.fx.joinGroups(current, me)).pipe(Effect.ignore);
          }
          ctx.groupsJoined = true;
          flushPending(ctx);
        }),
      ),
      Effect.catchCause(() => Effect.sync(() => ctx.fx.setStatus('offline'))),
    );
  });

const boot = (ctx: LifecycleCtx, session: Fibers<never>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { api, storage } = ctx.ports;
    const prefs = Effect.suspend(() => {
      const list = api.listChatPrefs;
      return list === undefined
        ? Effect.succeed([] as readonly unknown[])
        : fromPromise(() => list()).pipe(
            Effect.catchCause(() => Effect.succeed([] as readonly unknown[])),
          );
    });
    const loaded = yield* Effect.exit(
      Effect.all(
        [
          fromPromise(() => api.getMe()),
          fromPromise(() => api.getChats()),
          fromPromise(() => api.getContacts()),
          prefs,
        ],
        { concurrency: 'unbounded' },
      ),
    );
    if (Exit.isFailure(loaded)) {
      ctx.fx.setStatus('offline');
      ctx.fx.setChatsLoad('error');
      return;
    }
    const [me, entries, contacts, prefRows] = loaded.value;

    ctx.lastReadUserId = me.id;
    ctx.lastRead = yield* readLastRead(storage, me.id);
    ctx.fx.rememberGroupIds(entries);
    const freshRows = entries.flatMap((entry) => ctx.ports.rows.summariesFor(entry));
    ctx.fx.applyBoot({
      me,
      freshRows,
      previousChats: ctx.get().chats,
      sameUser: ctx.cachedUserId === me.id,
      contacts,
      prefs: prefRows,
    });
    // The global background default is a nice-to-have; load it without holding
    // up the chat list, and leave it null on failure.
    yield* Effect.sync(() => ctx.fx.refreshDefaultBackground());
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
  ctx: LifecycleCtx,
  session: Fibers<never>,
  me: CoreMe,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (!ctx.ports.flags.connectRetry) {
      return;
    }
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
function subscribeToCore(ctx: LifecycleCtx, current: XmppCore): () => void {
  const unsubscribers = [
    current.on('status', (status: ConnectionStatus) => {
      ctx.fx.setStatus(status);
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
    current.on('invited', () => ctx.fx.scheduleChatsRefresh()),
    current.on('roster', () => ctx.fx.scheduleChatsRefresh()),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

const connectXmpp = (ctx: LifecycleCtx, session: Fibers<never>, me: CoreMe): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { api, createXmpp } = ctx.ports;
    const tokenExit = yield* Effect.exit(fromPromise(() => api.getXmppToken()));
    if (Exit.isFailure(tokenExit)) {
      ctx.fx.setStatus('offline');
      yield* scheduleConnectRetry(ctx, session, me);
      return;
    }
    const token = tokenExit.value;
    let firstToken: { jid: string; token: string } | undefined = token;
    ctx.mediaToken = { service: token.service, domain: token.domain };
    ctx.fx.setMediaTrustedHosts(trustedMediaHosts(ctx.mediaToken));

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
      ctx.fx.setMediaTrustedHosts(trustedMediaHosts(ctx.mediaToken));
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
      ctx.fx.setStatus('offline');
      yield* Scope.close(attempt, Exit.void);
      yield* scheduleConnectRetry(ctx, session, me);
      return;
    }
    ctx.connectRetryAttempt = 0;
    ctx.fx.setStatus('online');
    flushPending(ctx);
    yield* fromPromise(() => ctx.fx.joinGroups(current, me)).pipe(Effect.ignore);
    ctx.groupsJoined = true;
    flushPending(ctx);
    yield* Effect.all(
      ctx.get().chats.map((chat) => loadPreview(ctx, current, chat)),
      { concurrency: 'unbounded' },
    );
    ctx.set((state) => ({ chats: sortByRecency(state.chats) }));
    ctx.fx.saveChatList();
  });
