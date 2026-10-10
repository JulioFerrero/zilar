import { type XmppClient, type XmppCredentialsProvider, type XmppStatus } from '@xmpp/client';
import { Deferred, Effect } from 'effect';
import { ConnectTimeout, ConnectionFailed, Disconnected, type XmppCoreError } from '../errors';
import { jidLocalPart } from '../jid';
import {
  buildAvailablePresence,
  buildCarbonsEnable,
  buildJoinPresence,
  buildPingRequest,
} from '../stanza';
import { schedule } from '../timers';
import type { ConnectionStatus } from '../types';
import {
  CONNECT_TIMEOUT_MS,
  DEFAULT_KEEPALIVE_MS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  WATCHDOG_SCHEDULE_MS,
  attempt,
  isFatalTokenError,
  toError,
  type CoreRuntime,
} from './config';

export type LifecycleApi = {
  setStatus: (next: ConnectionStatus) => void;
  applyRawStatus: (raw: XmppStatus) => void;
  setReconnectDelay: (ms: number) => void;
  finishConnect: (error?: Error) => void;
  startKeepalive: () => void;
  keepaliveEnabled: () => boolean;
  afterOnline: (current: XmppClient) => Effect.Effect<void>;
  stopAfterFailure: () => Effect.Effect<void>;
  disconnectQuietly: (current: XmppClient) => void;
  handleKeepaliveReply: (id: string) => boolean;
  credentials: XmppCredentialsProvider;
  connect: () => Effect.Effect<void, Error>;
  disconnect: () => Effect.Effect<void>;
};

export function createLifecycle(runtime: CoreRuntime): LifecycleApi {
  function setStatus(next: ConnectionStatus): void {
    if (runtime.currentStatus === next) return;
    runtime.currentStatus = next;
    if (next === 'online' || next === 'offline') {
      stopWatchdog();
      runtime.watchdogRestarts = 0;
    } else {
      armWatchdog();
    }
    runtime.emitEvent('status', next);
  }

  // A function, so a check after an `await` is not narrowed by an earlier one.
  function isOnline(): boolean {
    return runtime.currentStatus === 'online';
  }

  function watchdogMs(): number {
    if (runtime.options.reconnectWatchdogMs !== undefined) {
      return runtime.options.reconnectWatchdogMs;
    }
    return (
      WATCHDOG_SCHEDULE_MS[Math.min(runtime.watchdogRestarts, WATCHDOG_SCHEDULE_MS.length - 1)] ??
      20_000
    );
  }

  function stopWatchdog(): void {
    if (runtime.watchdogTimer !== undefined) {
      runtime.watchdogTimer();
      runtime.watchdogTimer = undefined;
    }
  }

  function armWatchdog(): void {
    if (runtime.watchdogTimer !== undefined || !runtime.desiredOnline || watchdogMs() <= 0) return;
    runtime.watchdogTimer = schedule(watchdogMs(), () => {
      runtime.watchdogTimer = undefined;
      Effect.runFork(restartStuckClient());
    });
  }

  // The client has not come online in time: drop it and start a fresh one.
  // `xmpp` is cleared first, so every late event of the old client is ignored
  // (see the `current !== xmpp` guards in `attachHandlers`).
  const restartStuckClient = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    if (!runtime.desiredOnline || runtime.currentStatus === 'online') return;
    const stale = runtime.xmpp;
    runtime.xmpp = undefined;
    runtime.watchdogRestarts += 1;
    resetOnlineState();
    runtime.transientTokenError = undefined;
    if (stale !== undefined) {
      // The old stream is already dead; nothing useful to report.
      yield* attempt(() => stale.stop()).pipe(Effect.ignore);
    }
    if (!runtime.desiredOnline || isOnline() || runtime.xmpp !== undefined) return;
    const fresh = runtime.ensureClient();
    armWatchdog();
    // The error event reports the failure; the watchdog tries again.
    Effect.runFork(attempt(() => fresh.start()).pipe(Effect.ignore));
  });

  function finishConnect(error?: Error): void {
    if (runtime.connectTimer !== undefined) {
      runtime.connectTimer();
      runtime.connectTimer = undefined;
    }
    const pending = runtime.pendingConnect;
    runtime.pendingConnect = undefined;
    if (pending === undefined) return;
    Deferred.doneUnsafe(pending, error === undefined ? Effect.void : Effect.fail(error));
  }

  // The failures stay as thrown: the same object reaches the client's error
  // handler, which compares it with `transientTokenError`.
  const authenticateWithFreshToken = Effect.fnUntraced(function* (
    authenticate: Parameters<XmppCredentialsProvider>[0],
    mechanisms: string[],
  ): Effect.fn.Return<void, unknown> {
    const fresh = yield* Effect.tryPromise({
      try: () => runtime.options.getToken(),
      catch: (error) => error,
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          // The thrown error reaches the client's error handler, which
          // reports it. Only a fatal error (bad credentials) stops
          // reconnecting; any other token failure is transient and the
          // client keeps trying.
          if (isFatalTokenError(error)) {
            runtime.authFailed = true;
          } else {
            runtime.transientTokenError = error;
          }
        }),
      ),
    );

    runtime.latestToken = fresh.token;
    const mechanism = mechanisms.includes('PLAIN') ? 'PLAIN' : mechanisms[0];
    yield* Effect.tryPromise({
      try: () =>
        authenticate({ username: jidLocalPart(fresh.jid), password: fresh.token }, mechanism),
      catch: (error) => error,
    });
  });

  const credentials: XmppCredentialsProvider = (authenticate, mechanisms) =>
    Effect.runPromise(authenticateWithFreshToken(authenticate, mechanisms));

  // The reconnect attempt counter, the cold-start flag and the keepalive make
  // up the per-attempt online state: every teardown resets them.
  function resetOnlineState(): void {
    runtime.reconnectAttempt = 0;
    runtime.coldAttemptSeen = false;
    stopKeepalive();
  }

  const stopAfterFailure = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    runtime.desiredOnline = false;
    runtime.hasBeenOnline = false;
    resetOnlineState();
    setStatus('offline');
    runtime.meJid = undefined;
    runtime.clearAllRosters();
    rejectPendingIqs(() => new ConnectionFailed());
    const current = runtime.xmpp;
    if (current !== undefined) {
      // The stream is already failing; nothing useful to report.
      yield* attempt(() => current.stop()).pipe(Effect.ignore);
    }
  });

  function rejectPendingIqs(makeError: () => XmppCoreError): void {
    for (const [id, pending] of runtime.pendingIqs) {
      runtime.pendingIqs.delete(id);
      Deferred.doneUnsafe(pending.deferred, Effect.fail(makeError()));
    }
  }

  function keepaliveEnabled(): boolean {
    const idle = runtime.options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
    const timeout = runtime.options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;
    return idle > 0 && timeout > 0;
  }

  function stopKeepalive(): void {
    runtime.keepalivePingId = undefined;
    if (runtime.keepaliveIdleTimer !== undefined) {
      runtime.keepaliveIdleTimer();
      runtime.keepaliveIdleTimer = undefined;
    }
    if (runtime.keepaliveReplyTimer !== undefined) {
      runtime.keepaliveReplyTimer();
      runtime.keepaliveReplyTimer = undefined;
    }
  }

  // Drives the library's wait before its next auto-reconnect: the schedule
  // in `reconnect.delay` is read when the retry is queued, so setting it at
  // the start of every attempt governs the wait after that attempt fails.
  function setReconnectDelay(ms: number): void {
    const current = runtime.xmpp;
    if (current === undefined) return;
    // A client without a reconnect driver (some test fakes) throws here; the
    // status flow still reports reconnecting.
    Effect.runSync(
      Effect.try({
        try: () => {
          current.reconnect.delay = ms;
        },
        catch: toError,
      }).pipe(Effect.ignore),
    );
  }

  // While online, pings the server domain after `keepaliveMs` without any
  // received stanza; without a reply in `keepaliveTimeoutMs` the connection
  // counts as dead and is torn down so the normal path reconnects.
  function startKeepalive(): void {
    stopKeepalive();
    if (!keepaliveEnabled() || !runtime.desiredOnline) return;
    runtime.keepaliveIdleTimer = schedule(
      runtime.options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS,
      () => {
        runtime.keepaliveIdleTimer = undefined;
        Effect.runFork(sendKeepalivePing());
      },
    );
  }

  const sendKeepalivePing = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const current = runtime.xmpp;
    if (current === undefined || !runtime.desiredOnline || runtime.currentStatus !== 'online') {
      return;
    }
    const id = runtime.generateId();
    runtime.keepalivePingId = id;
    const sent = yield* attempt(() =>
      current.send(buildPingRequest({ id, to: runtime.options.domain })),
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!sent) {
      runtime.keepalivePingId = undefined;
      reconnectDeadConnection();
      return;
    }
    runtime.keepaliveReplyTimer = schedule(
      runtime.options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS,
      () => {
        runtime.keepaliveReplyTimer = undefined;
        runtime.keepalivePingId = undefined;
        reconnectDeadConnection();
      },
    );
  });

  // The keepalive found a dead connection: tear the socket down. The
  // resulting `disconnect` status lets the library reconnect through the
  // normal path (status `reconnecting`, then `online` again).
  function reconnectDeadConnection(): void {
    stopKeepalive();
    const current = runtime.xmpp;
    if (current === undefined || !runtime.desiredOnline) return;
    disconnectQuietly(current);
  }

  // The stream may already be dead (or its disconnect may throw): the
  // disconnect status still fires and the normal path reconnects.
  function disconnectQuietly(current: XmppClient): void {
    Effect.runFork(attempt(() => current.disconnect()).pipe(Effect.ignore));
  }

  function handleKeepaliveReply(id: string): boolean {
    if (runtime.keepalivePingId === undefined || runtime.keepalivePingId !== id) return false;
    runtime.keepalivePingId = undefined;
    if (runtime.keepaliveReplyTimer !== undefined) {
      runtime.keepaliveReplyTimer();
      runtime.keepaliveReplyTimer = undefined;
    }
    // A result or an error both prove the connection is alive: a fresh idle
    // period starts.
    startKeepalive();
    return true;
  }

  const afterOnline = Effect.fnUntraced(function* (current: XmppClient): Effect.fn.Return<void> {
    yield* runtime.sendQuietly(current, buildAvailablePresence());
    yield* runtime.sendQuietly(current, buildCarbonsEnable(runtime.generateId()));
    for (const [roomJid, nick] of runtime.joinedRooms) {
      // The server sends the full occupant list when we rejoin, so drop the
      // stale roster first.
      runtime.clearRoster(roomJid);
      yield* runtime.sendQuietly(current, buildJoinPresence(roomJid, nick));
    }
  });

  function applyRawStatus(raw: XmppStatus): void {
    if (raw === 'online') {
      setStatus('online');
      return;
    }
    if (raw === 'offline') {
      setStatus('offline');
      return;
    }
    if (
      raw === 'connecting' ||
      raw === 'connect' ||
      raw === 'connected' ||
      raw === 'opening' ||
      raw === 'open'
    ) {
      setStatus(
        runtime.desiredOnline ? (runtime.hasBeenOnline ? 'reconnecting' : 'connecting') : 'offline',
      );
      return;
    }
    setStatus(
      runtime.desiredOnline ? (runtime.hasBeenOnline ? 'reconnecting' : 'offline') : 'offline',
    );
  }

  // Resolves when the client is online. It fails with `ConnectTimeout`,
  // `Disconnected`, or the error that stopped the attempt for good (a
  // conflict, a bad login), as thrown by the library.
  const connectEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void, Error> {
    if (runtime.currentStatus === 'online') return;
    if (runtime.pendingConnect !== undefined) return yield* Deferred.await(runtime.pendingConnect);

    runtime.desiredOnline = true;
    runtime.authFailed = false;
    runtime.coldAttemptSeen = false;
    // An explicit connect() while the client is stuck mid-attempt (a resume
    // from the background) replaces it at once instead of waiting.
    const stuck =
      runtime.xmpp !== undefined &&
      (runtime.currentStatus === 'connecting' || runtime.currentStatus === 'reconnecting');
    const current = runtime.ensureClient();
    setStatus(runtime.hasBeenOnline ? 'reconnecting' : 'connecting');

    const deferred = Deferred.makeUnsafe<void, Error>();
    runtime.pendingConnect = deferred;
    runtime.connectTimer = schedule(CONNECT_TIMEOUT_MS, () => {
      finishConnect(new ConnectTimeout());
    });

    if (stuck) {
      Effect.runFork(restartStuckClient());
    } else {
      // The error event reports the failure; auto-reconnect keeps trying.
      Effect.runFork(attempt(() => current.start()).pipe(Effect.ignore));
    }

    return yield* Deferred.await(deferred);
  });

  const disconnectEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    runtime.desiredOnline = false;
    runtime.hasBeenOnline = false;
    runtime.transientTokenError = undefined;
    resetOnlineState();
    setStatus('offline');
    finishConnect(new Disconnected());
    runtime.clearAllRosters();
    rejectPendingIqs(() => new Disconnected());
    const current = runtime.xmpp;
    if (current !== undefined) {
      // Stopping an already-closed stream is not an error worth surfacing.
      yield* attempt(() => current.stop()).pipe(Effect.ignore);
    }
    runtime.meJid = undefined;
  });

  return {
    setStatus,
    applyRawStatus,
    setReconnectDelay,
    finishConnect,
    startKeepalive,
    keepaliveEnabled,
    afterOnline,
    stopAfterFailure,
    disconnectQuietly,
    handleKeepaliveReply,
    credentials,
    connect: connectEffect,
    disconnect: disconnectEffect,
  };
}
