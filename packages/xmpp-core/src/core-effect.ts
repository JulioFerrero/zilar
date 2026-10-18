import { type XmppClient, type XmppElement, type XmppStatus } from '@xmpp/client';
import { Deferred, Effect } from 'effect';
import { HistoryFailed, IqFailed } from './errors';
import { makeEventHub, type EventName, type EventPayload, type StoredListener } from './events';
import { parseMamFin, toHistoryPage } from './mam';
import { PING_NAMESPACE } from './namespaces';
import {
  buildPingResult,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  parseDirectInvitation,
  parseRosterPush,
  stanzaErrorCondition,
} from './stanza';
import { mamResultTrusted } from './stanza/parse-context';
import { schedule, type Cancel } from './timers';
import type { XmppCore, XmppCoreEffect, XmppCoreOptions } from './types';
import type { WakeOutcome } from './types-suspend';
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
import { createLifecycle, type LifecycleApi } from './core-effect/lifecycle';
import { createOperations } from './core-effect/operations';
import { createPresence } from './core-effect/presence';

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

// XEP-0198, as used by @xmpp/client 0.14. xmpp.js's own inbound counter counts
// stanzas that arrive before `<enabled/>` and corrects only asynchronously, while our
// initial `<presence/>` goes out before `<enable/>`; in the same parser batch xmpp.js then
// acks that pre-enable stanza and ejabberd closes the session with "Client acknowledged more
// stanzas than sent by server". This counter follows the XEP: zero after `<enabled/>`,
// continuing after `<resumed/>`, counting only message/presence/iq.
export const STREAM_MANAGEMENT_NS = 'urn:xmpp:sm:3';

const COUNTED_STANZAS = new Set(['message', 'presence', 'iq']);

export type StreamManagementAck = {
  /** Stanzas handled since stream management was (re)enabled. */
  inbound(): number;
  counting(): boolean;
  observe(element: XmppElement): void;
  /** Stops counting new stanzas without losing the current value (disconnect). */
  stop(): void;
  /** Rewrites the `h` of an outgoing <a/> or <resume/> with the true count. */
  correctOutgoing(element: XmppElement): void;
};

export function createStreamManagementAck(): StreamManagementAck {
  let inbound = 0;
  let active = false;
  return {
    inbound: () => inbound,
    counting: () => active,
    observe(element) {
      if (element.is('enabled', STREAM_MANAGEMENT_NS)) {
        // "The counter for the received stanzas ('h') is set to zero and
        // started after receiving either <enable/> or <enabled/>."
        inbound = 0;
        active = true;
        return;
      }
      if (element.is('resumed', STREAM_MANAGEMENT_NS)) {
        // Resumption continues the previous counter.
        active = true;
        return;
      }
      if (active && COUNTED_STANZAS.has(element.name)) {
        inbound += 1;
      }
    },
    stop() {
      active = false;
    },
    correctOutgoing(element) {
      if (element.is('a', STREAM_MANAGEMENT_NS) || element.is('resume', STREAM_MANAGEMENT_NS)) {
        element.attrs.h = String(inbound);
      }
    },
  };
}

// Installs the corrected counter: reads every incoming element, patches the `h` of
// outgoing `<a/>`/`<resume/>`, and forwards the library's `ack`/`fail` for outgoing
// `<message/>` stanzas. Nothing when the client has no stream management.
export function installStreamManagementAck(
  client: XmppClient,
  handlers?: {
    onAcked?: (stanzaId: string) => void;
    onUnacked?: (stanzaId: string) => void;
    /** <enabled/> or <resumed/>: this stream now tracks outgoing stanzas. */
    onReady?: () => void;
  },
): void {
  const sm = (client as XmppClient & { streamManagement?: unknown }).streamManagement;
  if (sm === undefined || sm === null) return;

  const ack = createStreamManagementAck();
  client.on('element', (element) => {
    ack.observe(element);
    // A stream not (yet) managed tracks no outgoing stanza, so callers wait for this.
    if (
      element.is('enabled', STREAM_MANAGEMENT_NS) ||
      element.is('resumed', STREAM_MANAGEMENT_NS)
    ) {
      handlers?.onReady?.();
    }
  });
  client.on('disconnect', () => {
    ack.stop();
  });
  client.on('offline', () => {
    ack.stop();
  });

  // The library's middleware emits `ack` and `fail` with the stanza; only `<message/>`
  // with an `id` is reported.
  const report = (event: 'ack' | 'fail', stanza: XmppElement): void => {
    if (!stanza.is('message')) return;
    const id = stanza.attrs['id'];
    if (id === undefined) return;
    if (event === 'ack') {
      handlers?.onAcked?.(id);
    } else {
      handlers?.onUnacked?.(id);
    }
  };
  const emitter = sm as { on?: (event: string, listener: (stanza: XmppElement) => void) => void };
  emitter.on?.('ack', (stanza) => report('ack', stanza));
  emitter.on?.('fail', (stanza) => report('fail', stanza));

  const send = client.send.bind(client);
  client.send = (element) => {
    ack.correctOutgoing(element);
    return send(element);
  };
}

export type StanzaRouterApi = {
  handleStanza: (stanza: XmppElement) => void;
};

function createStanzaRouter(runtime: CoreRuntime): StanzaRouterApi {
  function handleMamResult(stanza: XmppElement): void {
    const queryId = mamResultQueryId(stanza);
    if (queryId === undefined) return;
    const pending = runtime.pendingQueries.get(queryId);
    if (pending === undefined) return;
    const context = runtime.parseContext();
    if (!mamResultTrusted(stanza, context)) return;
    const decoded = decodeMessageStanza(stanza, context);
    if (decoded.message !== undefined) pending.messages.push(decoded.message);
  }

  function handleIq(stanza: XmppElement): void {
    const id = stanza.attrs['id'];
    if (id !== undefined) {
      // Our own keepalive ping answered (result or error both prove alive).
      if (runtime.handleKeepaliveReply(id)) return;
      const pending = runtime.pendingIqs.get(id);
      if (pending !== undefined) {
        runtime.pendingIqs.delete(id);
        if (stanza.attrs['type'] === 'error') {
          Deferred.doneUnsafe(
            pending.deferred,
            Effect.fail(new IqFailed({ condition: stanzaErrorCondition(stanza) })),
          );
        } else {
          Deferred.doneUnsafe(pending.deferred, Effect.succeed(stanza));
        }
        return;
      }
    }

    // An incoming server ping (XEP-0199) gets an empty result back.
    if (
      stanza.attrs['type'] === 'get' &&
      id !== undefined &&
      stanza.getChild('ping', PING_NAMESPACE) !== undefined
    ) {
      const current = runtime.xmpp;
      if (current !== undefined) {
        const from = stanza.attrs['from'];
        Effect.runFork(runtime.sendQuietly(current, buildPingResult(id, from)));
      }
      return;
    }

    const rosterPush = parseRosterPush(stanza, runtime.options.domain, runtime.meJid);
    if (rosterPush !== undefined) {
      runtime.handleRosterPush(rosterPush);
      return;
    }

    if (id === undefined) return;
    for (const [queryId, pending] of runtime.pendingQueries) {
      if (pending.iqId !== id) continue;
      runtime.pendingQueries.delete(queryId);
      if (stanza.attrs['type'] === 'error') {
        Deferred.doneUnsafe(
          pending.deferred,
          Effect.fail(new HistoryFailed({ condition: stanzaErrorCondition(stanza) })),
        );
        return;
      }
      Deferred.doneUnsafe(
        pending.deferred,
        Effect.succeed(toHistoryPage(pending.messages, parseMamFin(stanza))),
      );
      return;
    }
  }

  function handleStanza(stanza: XmppElement): void {
    if (stanza.is('message')) {
      if (isMamResult(stanza)) {
        handleMamResult(stanza);
        return;
      }
      const invited = parseDirectInvitation(stanza, runtime.options.domain, runtime.mucDomain);
      if (invited !== undefined) runtime.emitEvent('invited', invited);
      const decoded = decodeMessageStanza(stanza, runtime.parseContext());
      if (decoded.message !== undefined) runtime.emitEvent('message', decoded.message);
      if (decoded.typing !== undefined) runtime.emitEvent('typing', decoded.typing);
      if (decoded.displayed !== undefined) runtime.emitEvent('displayed', decoded.displayed);
      if (decoded.deliveredMark !== undefined) {
        runtime.emitEvent('deliveredMark', decoded.deliveredMark);
      }
      return;
    }
    if (stanza.is('presence')) {
      runtime.handlePresence(stanza);
      return;
    }
    if (stanza.is('iq')) {
      handleIq(stanza);
    }
  }

  return { handleStanza };
}

// `suspend()` parks the session when the app leaves the foreground; `wake()` brings it
// back. xmpp.js keeps the stream-management id across a `disconnect` and clears it only
// on `offline`, so `suspend()` ends the socket below the stream layer and `wake()`
// drives a normal reconnect, which resumes when ejabberd still holds the session.
// Only what suspend reads of the library client: the ambient client knows
// start/stop/disconnect but not the socket or the SM state.
type SuspendableClient = {
  status: XmppStatus;
  socket: { end(): void } | null;
  reconnect: { start(): void; stop(): void };
  streamManagement?: { id?: string; on(event: string, listener: () => void): unknown } | null;
};

function asSuspendable(current: XmppClient): SuspendableClient | undefined {
  const client = current as unknown as SuspendableClient;
  return typeof client.status === 'string' && client.socket !== undefined ? client : undefined;
}

// The stream-management id xmpp.js would resume with (`previd`), if any. It
// survives `disconnect` and is cleared only by `offline` or a fresh bind.
function streamManagementId(current: XmppClient): string | undefined {
  const sm = asSuspendable(current)?.streamManagement;
  const id = sm?.id;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

// `start()` throws unless the library is offline, but after `suspend()` the socket just
// closed, so stepping back to `offline` is the resume without clearing the SM id.
function readyForRestart(current: XmppClient): void {
  const client = asSuspendable(current);
  if (client !== undefined && client.status === 'disconnect') {
    client.status = 'offline';
  }
}

export type SuspendApi = {
  suspend: () => Effect.Effect<void, Error>;
  wake: () => Effect.Effect<WakeOutcome, Error>;
};

function createSuspend(runtime: CoreRuntime, lifecycle: LifecycleApi): SuspendApi {
  // Whether `suspend()` stopped the reconnect driver; `wake()` restarts it once, so a
  // foreground without a suspend never stacks listeners.
  let suspended = false;

  // Stops the reconnect driver, watchdog and keepalive, then ends the socket directly:
  // no framing close, so ejabberd moves the session to pending and keeps it resumable.
  const suspend = Effect.fnUntraced(function* (): Effect.fn.Return<void, Error> {
    const current = runtime.xmpp;
    runtime.desiredOnline = false;
    lifecycle.stopWatchdog();
    lifecycle.stopKeepalive();
    if (current !== undefined) {
      const client = asSuspendable(current);
      if (client !== undefined) {
        client.reconnect.stop();
        suspended = true;
      }
      if (client?.socket != null) {
        const socket = client.socket;
        // A synchronous throw (an already-dead socket) must still leave the
        // status offline, so a failed close is ignored.
        yield* attempt(() => Promise.resolve().then(() => socket.end())).pipe(Effect.ignore);
      }
    }
    lifecycle.setStatus('offline');
  });

  // Reconnects, resuming when ejabberd still holds the session. The driver restarts only
  // when `suspend()` stopped it; another `start()` would stack a second listener. A resume
  // keeps the SM id, a fresh bind reports `rebound`.
  const wake = Effect.fnUntraced(function* (): Effect.fn.Return<WakeOutcome, Error> {
    const wasSuspended = suspended;
    suspended = false;
    const current = runtime.xmpp;
    if (current === undefined) {
      yield* lifecycle.connect();
      return 'rebound';
    }
    if (wasSuspended) {
      asSuspendable(current)?.reconnect.start();
    }
    const before = streamManagementId(current);
    readyForRestart(current);
    yield* lifecycle.connect();
    const after = streamManagementId(current);
    return before !== undefined && after === before ? 'resumed' : 'rebound';
  });

  return { suspend, wake };
}

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
