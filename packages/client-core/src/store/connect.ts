// The XMPP connect block: the connect retry schedule, the core listeners and
// the connect attempt itself. Split from `lifecycle.ts`, which is at its line
// budget.
import { Effect, Exit, Scope } from 'effect';
import { trustedMediaHosts } from '@zilar/chat-core';
import type { ConnectionStatus, XmppCore, XmppCoreOptions } from '@zilar/xmpp-core';
import { fromPromise, setConnectionStatus } from './ctx';
import { handleDeliveredMark } from './delivered';
import { flushPending } from './history';
import { loadPreviews } from './previews';
import { flushOnline, markReboundOutbox } from './online';
import { ackText, unackText, type SendCtx } from './send';
import {
  handleDisplayed,
  handleMessage,
  handleOccupants,
  handlePresence,
  handleTyping,
} from './incoming';
import type { LifecycleCtx } from './lifecycle';
import type { Fibers } from './lifetime';
import { scheduleChatsRefreshBurst } from './polling';
import type { CoreMe } from './ports';
import { onAuthFailed } from './session-check';
import { sortByRecency } from './rows';

// Waits between XMPP connect attempts after a failed token or login.
export const CONNECT_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000];

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
function subscribeToCore(
  ctx: LifecycleCtx,
  current: XmppCore,
  session: Fibers<never>,
  me: CoreMe,
): () => void {
  const unsubscribers = [
    current.on('status', (status: ConnectionStatus) => {
      setConnectionStatus(ctx, status);
      if (status === 'online') {
        flushOnline(ctx);
      }
    }),
    // A revoked session (signed out elsewhere) answers 401 here (T-1223):
    // `sessionGone` signs out to login instead of retrying for ever.
    current.on('authFailed', () => {
      onAuthFailed(ctx, session, me, scheduleConnectRetry);
    }),
    current.on('acked', ({ stanzaId }) => ackText(ctx as unknown as SendCtx, stanzaId)),
    current.on('unacked', ({ stanzaId }) => unackText(ctx as unknown as SendCtx, stanzaId)),
    // A fresh session (a `rebound`) may have lost in-flight texts: mark them to resend.
    current.on('rebound', () => markReboundOutbox(ctx)),
    current.on('message', (message) => handleMessage(ctx, message)),
    current.on('typing', (event) => handleTyping(ctx, event)),
    current.on('displayed', (event) => handleDisplayed(ctx, event)),
    current.on('deliveredMark', (event) => handleDeliveredMark(ctx, event)),
    current.on('occupants', (event) => handleOccupants(ctx, event)),
    current.on('presence', (event) => handlePresence(ctx, event)),
    // A group invitation or a roster push means the chat list changed on the
    // server: refetch it, join any new group rooms and load their preview.
    // PERF-11: a push burst (one per member) is coalesced into one refresh.
    current.on('invited', () => scheduleChatsRefreshBurst(ctx)),
    current.on('roster', () => scheduleChatsRefreshBurst(ctx)),
    // The server removed me from a room (kick, ban or affiliation change):
    // the chat list changed on the server, the same as above.
    current.on('removed', () => scheduleChatsRefreshBurst(ctx)),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}

export const connectXmpp = (
  ctx: LifecycleCtx,
  session: Fibers<never>,
  me: CoreMe,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { api, createXmpp } = ctx.ports;
    const tokenExit = yield* Effect.exit(fromPromise(() => api.getXmppToken()));
    if (Exit.isFailure(tokenExit)) {
      setConnectionStatus(ctx, 'offline');
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
    const unsubscribe = subscribeToCore(ctx, current, session, me);
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
      setConnectionStatus(ctx, 'offline');
      yield* Scope.close(attempt, Exit.void);
      yield* scheduleConnectRetry(ctx, session, me);
      return;
    }
    ctx.connectRetryAttempt = 0;
    setConnectionStatus(ctx, 'online');
    flushPending(ctx);
    yield* fromPromise(() => ctx.fx.joinGroups(current, me)).pipe(Effect.ignore);
    ctx.groupsJoined = true;
    flushPending(ctx);
    yield* loadPreviews(ctx, current);
    ctx.set((state) => ({ chats: sortByRecency(state.chats) }));
    ctx.fx.saveChatList();
  });
