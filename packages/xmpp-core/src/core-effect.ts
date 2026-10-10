import { type XmppClient, type XmppElement } from '@xmpp/client';
import { Effect } from 'effect';
import { makeEventHub, type EventName, type EventPayload, type StoredListener } from './events';
import { installStreamManagementAck } from './stream-management';
import type { XmppCore, XmppCoreEffect, XmppCoreOptions } from './types';
import {
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

export type { ClientFactory, ClientOptions, CoreDependencies } from './core-effect/config';

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
      runtime.meJid = jid.bare().toString();
      runtime.hasBeenOnline = true;
      runtime.reconnectAttempt = 0;
      lifecycle.setReconnectDelay(reconnectDelayFor(0));
      lifecycle.setStatus('online');
      lifecycle.finishConnect();
      lifecycle.startKeepalive();
      Effect.runFork(lifecycle.afterOnline(current));
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
        runtime.authFailed = false;
        lifecycle.finishConnect(error);
        Effect.runFork(lifecycle.stopAfterFailure());
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
    installStreamManagementAck(created);
    runtime.xmpp = created;
    return created;
  }

  const presence = createPresence(runtime);
  const stanzaRouter = createStanzaRouter(runtime);
  const lifecycle = createLifecycle(runtime);
  const operations = createOperations(runtime);

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
