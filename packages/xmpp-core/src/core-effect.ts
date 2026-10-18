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

// `rebound` joins the map through interface merging: a fresh session bound (not a
// resume), so stanzas sent on the previous stream may be lost and the store resends.
declare module './events' {
  interface EventPayloadMap {
    rebound: void;
  }
}
declare module './types' {
  interface XmppCore {
    /**
     * A fresh session bound after a live one (`rebound`, not a resume): the old stream
     * is gone, so its unacked stanzas may be lost; the store resends in-flight texts.
     */
    on(event: 'rebound', cb: () => void): () => void;
  }
}

export type CoreEffect = XmppCoreEffect & { on: XmppCore['on'] };

// A runtime function no module assigned yet; wiring finishes before the first call,
// so this only guards a wiring mistake.
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

  // A fresh bind is not stream-managed until the library sends `<enable/>`; a stanza
  // written before that is never tracked or acked, so reporting `online` first leaves
  // the store's resent texts on the clock for good. The online transition therefore
  // waits for `<enabled/>`/`resumed`, with a short fallback for no stream management.
  let pendingOnline: XmppClient | undefined;
  let streamReadyTimer: Cancel | undefined;

  function clearStreamReady(): void {
    if (streamReadyTimer !== undefined) {
      streamReadyTimer();
      streamReadyTimer = undefined;
    }
  }

  // Report `online` now, after stream management is active, so the store's flush writes
  // a tracked stanza. A replaced client or a wanted-offline core is left alone.
  function finishOnline(current: XmppClient): void {
    clearStreamReady();
    pendingOnline = undefined;
    if (current !== runtime.xmpp || !runtime.desiredOnline) return;
    lifecycle.setStatus('online');
    lifecycle.finishConnect();
    lifecycle.startKeepalive();
    Effect.runFork(lifecycle.afterOnline(current));
  }

  function onStreamReady(current: XmppClient): void {
    if (pendingOnline !== current) return;
    finishOnline(current);
  }

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
    // What a successful (re)connect runs, whether resumed (the `resumed` listener) or
    // freshly bound (`online`). `meJid` keeps its value when a resume carries no JID.
    function onOnline(current: XmppClient, bareJid: string | undefined, resumed: boolean): void {
      const wasOnline = runtime.hasBeenOnline;
      if (bareJid !== undefined) {
        runtime.meJid = bareJid;
      }
      runtime.hasBeenOnline = true;
      runtime.reconnectAttempt = 0;
      lifecycle.setReconnectDelay(reconnectDelayFor(0));
      // A fresh bind while a session was live is a `rebound`, not a resume: the store marks
      // its in-flight texts for one resend, before the online listener flushes.
      if (!resumed && wasOnline) {
        emitEvent('rebound', undefined);
      }
      // Wait for stream management before going online: the store's flush writes to the
      // socket, and a stanza written before `<enable/>` never gets its `ack`.
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
      // xmpp.js reports the `online` status just before the `online` event with the bound
      // JID; only that event goes online, so no listener queries history without identity.
      if (raw === 'online') return;
      // Arm the wait at the start of every attempt, so a failure backs off 1, 2, 4, 8, 15
      // then 30 s; a cold start keeps the library's 1 s first retry.
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

    // A resume is the silent twin of `online`: xmpp.js sets the status without emitting it,
    // so without this the core stays `reconnecting` and `wake()` hangs.
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
        // Replaced by another session with the same full JID: stop for good, so two clients
        // never kick each other; a later explicit `connect()` still works.
        lifecycle.finishConnect(error);
        Effect.runFork(lifecycle.stopAfterFailure());
        emitEvent('replaced', undefined);
        return;
      }
      if (runtime.authFailed || isSaslError(error)) {
        // A token that fails for good tells the store, so it can run its own retry ladder; a
        // SASL error (bad login) stays silent.
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
        // Tear down a stuck unauthenticated stream so the client retries with a fresh token.
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
