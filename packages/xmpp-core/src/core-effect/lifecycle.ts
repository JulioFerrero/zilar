import { type XmppClient, type XmppCredentialsProvider, type XmppStatus } from '@xmpp/client';
import { Deferred, Effect } from 'effect';
import { ConnectTimeout, ConnectionFailed, Disconnected, type XmppCoreError } from '../errors';
import { buildAvailablePresence, buildCarbonsEnable, buildJoinPresence } from '../stanza';
import { schedule } from '../timers';
import type { ConnectionStatus } from '../types';
import {
  CONNECT_TIMEOUT_MS,
  WATCHDOG_SCHEDULE_MS,
  attempt,
  toError,
  type CoreRuntime,
} from './config';
import { createKeepalive } from './keepalive';
import { createTokenAuth } from './token-auth';

export type LifecycleApi = {
  setStatus: (next: ConnectionStatus) => void;
  stopWatchdog: () => void;
  stopKeepalive: () => void;
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
    if (runtime.watchdogRestarts === 0 && runtime.options.reconnectWatchdogFirstMs !== undefined) {
      return runtime.options.reconnectWatchdogFirstMs;
    }
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
  // (see the `current !== xmpp` guards in `attachHandlers`). Stanzas the old
  // client's stream management still queues never get an `ack` or a `fail`
  // (a resume happens on a new client, not on this queue), so each queued
  // outgoing `<message/>` is reported as `unacked` first: the store resends
  // it once under the same id on the next online (T-1216).
  const restartStuckClient = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    if (!runtime.desiredOnline || runtime.currentStatus === 'online') return;
    const stale = runtime.xmpp;
    runtime.xmpp = undefined;
    runtime.watchdogRestarts += 1;
    resetOnlineState();
    runtime.transientTokenError = undefined;
    if (stale !== undefined) {
      reportStaleQueue(stale);
      // The old stream is already dead; nothing useful to report.
      yield* attempt(() => stale.stop()).pipe(Effect.ignore);
    }
    // Arm before the guards below: a concurrent ensureClient (an explicit
    // connect() landing while the old client stops) must not leave the core
    // watchdog-less, or xmpp.js's growing backoff stalls the reconnect (T-1220).
    armWatchdog();
    if (!runtime.desiredOnline || isOnline() || runtime.xmpp !== undefined) return;
    const fresh = runtime.ensureClient();
    // The error event reports the failure; the watchdog tries again.
    Effect.runFork(attempt(() => fresh.start()).pipe(Effect.ignore));
  });

  // Reads the stale client's queued stream-management stanzas the same way
  // the core reaches the library (`core-effect.ts:153-162`): the `outbound_q`
  // the `disconnect` handler deliberately leaves alone
  // (`@xmpp/stream-management/index.js:56-62`). Each queued outgoing
  // `<message/>` with an `id` fires the core's `unacked` event — the same
  // event a `fail` maps to (`core-effect.ts:220-223`, via
  // `installStreamManagementAck`) — before the old client is stopped.
  function reportStaleQueue(stale: XmppClient): void {
    const sm = (stale as XmppClient & { streamManagement?: unknown }).streamManagement as
      { outbound_q?: unknown } | undefined;
    const queue = sm?.outbound_q;
    if (!Array.isArray(queue)) return;
    for (const item of queue) {
      const stanza = (item as { stanza?: unknown }).stanza;
      if (typeof stanza !== 'object' || stanza === null) continue;
      const element = stanza as {
        is: (name: string) => boolean;
        attrs: Record<string, unknown>;
      };
      if (!element.is('message')) continue;
      const id = element.attrs['id'];
      if (typeof id !== 'string' || id === '') continue;
      runtime.emitEvent('unacked', { stanzaId: id });
    }
  }

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

  // The token fetch and SASL live in `token-auth.ts`, so this module stays
  // under its line budget; the credentials provider is what the client calls.
  const tokenAuth = createTokenAuth(runtime);

  // The keepalive lives in `keepalive.ts`; it reaches `disconnectQuietly`
  // (declared below, hoisted) to tear down a dead connection.
  const keepalive = createKeepalive(runtime, disconnectQuietly);

  // The reconnect attempt counter, the cold-start flag and the keepalive make
  // up the per-attempt online state: every teardown resets them.
  function resetOnlineState(): void {
    runtime.reconnectAttempt = 0;
    runtime.coldAttemptSeen = false;
    keepalive.stopKeepalive();
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

  // The stream may already be dead (or its disconnect may throw): the
  // disconnect status still fires and the normal path reconnects.
  function disconnectQuietly(current: XmppClient): void {
    Effect.runFork(attempt(() => current.disconnect()).pipe(Effect.ignore));
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
    stopWatchdog,
    stopKeepalive: keepalive.stopKeepalive,
    applyRawStatus,
    setReconnectDelay,
    finishConnect,
    startKeepalive: keepalive.startKeepalive,
    keepaliveEnabled: keepalive.keepaliveEnabled,
    afterOnline,
    stopAfterFailure,
    disconnectQuietly,
    handleKeepaliveReply: keepalive.handleKeepaliveReply,
    credentials: tokenAuth.credentials,
    connect: connectEffect,
    disconnect: disconnectEffect,
  };
}
