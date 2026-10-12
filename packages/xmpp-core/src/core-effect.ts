import { type XmppClient, type XmppElement } from '@xmpp/client';
import { Effect } from 'effect';
import { makeEventHub, type EventName, type EventPayload, type StoredListener } from './events';
import { installStreamManagementAck } from './stream-management';
import { schedule, type Cancel } from './timers';
import type { XmppCore, XmppCoreEffect, XmppCoreOptions } from './types';
import {
  SM_ENABLE_TIMEOUT_MS,
  attempt,
  defaultClientFactory,
  defaultGenerateId,
  defaultResource,
  errorMessage,
  isConflictError,
  isSaslError,
  reconnectDelayFor,
  redact,
  type CoreDependencies,
  type CoreRuntime,
} from './core-effect/config';
import { createLifecycle } from './core-effect/lifecycle';
import { createOperations } from './core-effect/operations';
import { createPresence } from './core-effect/presence';
import { createStanzaRouter } from './core-effect/stanza-router';
import { createSuspend } from './core-effect/suspend';

export type { ClientFactory, ClientOptions, CoreDependencies } from './core-effect/config';

// The `rebound` event joins the map through interface merging, like the ack
// events in `types-ack.ts`: a fresh session bound (not a stream-management
// resume), so stanzas sent on the previous stream may be lost and the store
// resends its in-flight texts.
declare module './events' {
  interface EventPayloadMap {
    rebound: void;
  }
}
declare module './types' {
  interface XmppCore {
    /**
     * A fresh session bound after a live one (a `rebound`, not a resume): the
     * old stream is gone, so its unacked stanzas may be lost. The store marks
     * its in-flight texts for one resend under the same id.
     */
    on(event: 'rebound', cb: () => void): () => void;
  }
}

// The Effect core plus the callback form of the events (`XmppCore.on`), which
// the Promise facade in `client.ts` hands on.
export type CoreEffect = XmppCoreEffect & { on: XmppCore['on'] };

// A runtime function that no module assigned yet. The factories close over the
// runtime and read every function at call time, so wiring always finishes before
// the first call; this only guards a wiring mistake.
const notWired = (): never => {
  throw new Error('core-effect: function not wired');
};

export function createCoreEffect(
  options: XmppCoreOptions,
  deps: CoreDependencies = {},
): CoreEffect {
  const now = deps.now ?? ((): Date => new Date());
  const generateId = deps.generateId ?? defaultGenerateId;
  const createClient = deps.createClient ?? defaultClientFactory;
  const mucDomain = `rooms.${options.domain}`;

  const runtime: CoreRuntime = {
    options,
    now,
    generateId,
    createClient,
    mucDomain,
    currentStatus: 'offline',
    meJid: undefined,
    desiredOnline: false,
    hasBeenOnline: false,
    authFailed: false,
    transientTokenError: undefined,
    reconnectAttempt: 0,
    coldAttemptSeen: false,
    keepalivePingId: undefined,
    keepaliveIdleTimer: undefined,
    keepaliveReplyTimer: undefined,
    watchdogTimer: undefined,
    watchdogRestarts: 0,
    latestToken: undefined,
    xmpp: undefined,
    pendingConnect: undefined,
    connectTimer: undefined,
    events: makeEventHub(),
    joinedRooms: new Map(),
    rosters: new Map(),
    pendingJoins: new Map(),
    pendingQueries: new Map(),
    pendingIqs: new Map(),
    emitEvent: notWired,
    ensureClient: notWired,
    sendQuietly: notWired,
    handleStanza: notWired,
    handlePresence: notWired,
    handleRosterPush: notWired,
    handleKeepaliveReply: notWired,
    clearRoster: notWired,
    clearAllRosters: notWired,
    parseContext: notWired,
  };

  function emitEvent<K extends EventName>(event: K, payload: EventPayload[K]): void {
    runtime.events.emit(event, payload);
  }

  function emitError(message: string): void {
    emitEvent('error', {
      message: runtime.latestToken === undefined ? message : redact(message, runtime.latestToken),
    });
  }

  // T-1220: a fresh bind is not stream-managed until the library sends
  // <enable/>. A stanza written before that is neither queued by the library
  // nor counted by the server, so its stream-management `ack` never comes. The
  // store flushes its text outbox on the `online` status, so reporting `online`
  // before <enabled/> leaves every resent text on the clock for good (the lead
  // saw the tick only after a cold restart, from history). The online
  // transition therefore waits for <enabled/>/`resumed`, with a short fallback
  // for a server that offers no stream management.
  let pendingOnline: XmppClient | undefined;
  let streamReadyTimer: Cancel | undefined;

  function clearStreamReady(): void {
    if (streamReadyTimer !== undefined) {
      streamReadyTimer();
      streamReadyTimer = undefined;
    }
  }

  // The deferred half of `onOnline`: report `online` now, after stream
  // management is active, so the store's flush writes a tracked stanza. A
  // client replaced meanwhile, or a wanted-offline core, is left alone.
  function finishOnline(current: XmppClient): void {
    clearStreamReady();
    pendingOnline = undefined;
    if (current !== runtime.xmpp || !runtime.desiredOnline) return;
    lifecycle.setStatus('online');
    lifecycle.finishConnect();
    lifecycle.startKeepalive();
    Effect.runFork(lifecycle.afterOnline(current));
  }

  // <enabled/> or <resumed/> on the live client: run the deferred online.
  function onStreamReady(current: XmppClient): void {
    if (pendingOnline !== current) return;
    finishOnline(current);
  }

  // A failed send is reported as an `error` event and never fails the caller.
  function sendQuietly(current: XmppClient, stanza: XmppElement): Effect.Effect<void> {
    return attempt(() => current.send(stanza)).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          emitError(error.message);
        }),
      ),
      Effect.ignore,
    );
  }

  function attachHandlers(current: XmppClient): void {
    // What a successful (re)connect runs, whether the server resumed the old
    // session (silent, via the `resumed` listener below) or bound a fresh one
    // (the `online` event). `meJid` keeps its value when a resume carries no
    // new JID: the binding never changed.
    function onOnline(current: XmppClient, bareJid: string | undefined, resumed: boolean): void {
      const wasOnline = runtime.hasBeenOnline;
      if (bareJid !== undefined) {
        runtime.meJid = bareJid;
      }
      runtime.hasBeenOnline = true;
      runtime.reconnectAttempt = 0;
      lifecycle.setReconnectDelay(reconnectDelayFor(0));
      // A fresh bind while a session was already live is a `rebound`, not a
      // resume: the old stream is gone, so the store marks its in-flight
      // texts for one resend. Before the online transition: the store's online
      // listener must flush after the marks land (T-1216).
      if (!resumed && wasOnline) {
        emitEvent('rebound', undefined);
      }
      // Wait for stream management before the online transition (T-1220): the
      // store's online flush writes to the socket, and a stanza written before
      // <enable/> is never stream-managed, so its `ack` never arrives. A
      // resume is already stream-managed; a client without stream management
      // (unit fakes) has nothing to wait for.
      const sm = (
        current as XmppClient & { streamManagement?: { enabled?: boolean; enableSent?: boolean } }
      ).streamManagement;
      if (!resumed && sm !== undefined && sm.enabled !== true && sm.enableSent !== true) {
        clearStreamReady();
        pendingOnline = current;
        streamReadyTimer = schedule(SM_ENABLE_TIMEOUT_MS, () => {
          streamReadyTimer = undefined;
          finishOnline(current);
        });
        return;
      }
      finishOnline(current);
    }

    current.on('status', (raw) => {
      if (current !== runtime.xmpp) return;
      // xmpp.js reports the `online` status just before the `online` event
      // that carries the bound JID. Going online here would let a listener
      // query history with no identity yet, so only that event goes online.
      if (raw === 'online') return;
      // Every attempt starts here: arm the wait after it, so a failure
      // backs off 1 s, 2 s, 4 s, 8 s, 15 s, then 30 s. A cold start that
      // never went online keeps the 1 s wait the library starts with, so
      // its first retry is 1 s too.
      if (raw === 'connecting') {
        if (runtime.hasBeenOnline || runtime.coldAttemptSeen) {
          runtime.reconnectAttempt += 1;
          lifecycle.setReconnectDelay(reconnectDelayFor(runtime.reconnectAttempt));
        }
        runtime.coldAttemptSeen = true;
      }
      lifecycle.applyRawStatus(raw);
    });

    current.on('online', (jid) => {
      if (current !== runtime.xmpp) return;
      onOnline(current, jid.bare().toString(), false);
    });

    // A stream-management resume is the silent twin of `online`: xmpp.js sets
    // the status without emitting it (`_ready(true)`), so without this the
    // core would stay `reconnecting` after a resume and `wake()` would hang.
    const sm = (current as XmppClient & { streamManagement?: unknown }).streamManagement as
      { on(event: 'resumed', listener: () => void): unknown } | undefined;
    sm?.on('resumed', () => {
      if (current !== runtime.xmpp) return;
      const jid = current.jid;
      onOnline(current, jid === null ? undefined : jid.bare().toString(), true);
    });

    current.on('error', (error) => {
      if (current !== runtime.xmpp) return;
      emitError(errorMessage(error));
      if (isConflictError(error)) {
        // Replaced by another session with the same full JID: stop for good
        // with no auto-reconnect, so two clients never kick each other in a
        // loop. A later explicit `connect()` still works.
        lifecycle.finishConnect(error);
        Effect.runFork(lifecycle.stopAfterFailure());
        emitEvent('replaced', undefined);
        return;
      }
      if (runtime.authFailed || isSaslError(error)) {
        // A token that fails for good (401/403 on both attempts) tells the
        // store, so it can run its own retry ladder instead of staying
        // offline; a SASL error (bad login) stays silent, as today.
        const tokenAuthFailed = runtime.authFailed;
        runtime.authFailed = false;
        lifecycle.finishConnect(error);
        Effect.runFork(lifecycle.stopAfterFailure());
        if (tokenAuthFailed) {
          emitEvent('authFailed', undefined);
        }
        return;
      }
      if (error === runtime.transientTokenError) {
        // A transient token failure leaves a stuck unauthenticated stream:
        // tear it down so the client reconnects and tries a fresh token
        // with backoff, instead of idling until the server closes it.
        runtime.transientTokenError = undefined;
        if (runtime.desiredOnline && runtime.currentStatus !== 'online') {
          lifecycle.disconnectQuietly(current);
        }
      }
    });

    current.on('stanza', (stanza) => {
      if (current !== runtime.xmpp) return;
      // Any traffic proves the connection is alive and restarts the idle
      // period; the keepalive only fires on a truly silent connection.
      if (runtime.currentStatus === 'online' && lifecycle.keepaliveEnabled()) {
        lifecycle.startKeepalive();
      }
      runtime.handleStanza(stanza);
    });
  }

  function ensureClient(): XmppClient {
    if (runtime.xmpp !== undefined) return runtime.xmpp;
    const created = createClient({
      service: options.service,
      domain: options.domain,
      credentials: lifecycle.credentials,
      resource: options.resource ?? defaultResource(),
    });
    attachHandlers(created);
    installStreamManagementAck(created, {
      onAcked: (stanzaId) => emitEvent('acked', { stanzaId }),
      onUnacked: (stanzaId) => emitEvent('unacked', { stanzaId }),
      onReady: () => onStreamReady(created),
    });
    runtime.xmpp = created;
    return created;
  }

  const presence = createPresence(runtime);
  const stanzaRouter = createStanzaRouter(runtime);
  const lifecycle = createLifecycle(runtime);
  const operations = createOperations(runtime);
  const suspend = createSuspend(runtime, lifecycle);

  runtime.emitEvent = emitEvent;
  runtime.ensureClient = ensureClient;
  runtime.sendQuietly = sendQuietly;
  runtime.handleStanza = stanzaRouter.handleStanza;
  runtime.handlePresence = presence.handlePresence;
  runtime.handleRosterPush = presence.handleRosterPush;
  runtime.handleKeepaliveReply = lifecycle.handleKeepaliveReply;
  runtime.clearRoster = presence.clearRoster;
  runtime.clearAllRosters = presence.clearAllRosters;
  runtime.parseContext = presence.parseContext;

  return {
    status: () => runtime.currentStatus,
    me: () => runtime.meJid,
    occupants: presence.occupantsFor,
    connect: lifecycle.connect,
    disconnect: lifecycle.disconnect,
    suspend: suspend.suspend,
    wake: suspend.wake,
    joinRoom: operations.joinRoom,
    leaveRoom: operations.leaveRoom,
    sendMessage: operations.sendMessage,
    sendReactions: operations.sendReactions,
    sendCorrection: operations.sendCorrection,
    sendRetraction: operations.sendRetraction,
    loadHistory: operations.loadHistory,
    requestUploadSlot: operations.requestUploadSlot,
    setPushEnabled: operations.setPushEnabled,
    sendTyping: operations.sendTyping,
    markDisplayed: operations.markDisplayed,
    on: (event: EventName, listener: StoredListener) => runtime.events.on(event, listener),
  };
}
