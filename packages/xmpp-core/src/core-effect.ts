import {
  client as createLibraryClient,
  type XmppClient,
  type XmppCredentialsProvider,
  type XmppElement,
  type XmppStatus,
} from '@xmpp/client';
import { Deferred, Duration, Effect } from 'effect';
import {
  ConnectionFailed,
  ConnectTimeout,
  Disconnected,
  HistoryFailed,
  HistorySendFailed,
  HistoryTimeout,
  IqFailed,
  JoinRejected,
  JoinSendFailed,
  JoinTimeout,
  NoIdentity,
  NotOnline,
  PushToggleFailed,
  PushToggleTimeout,
  UploadSlotFailed,
  UploadSlotInvalid,
  UploadSlotTimeout,
  type XmppCoreError,
} from './errors';
import { makeEventHub, type EventName, type EventPayload, type StoredListener } from './events';
import { jidLocalPart } from './jid';
import { DEFAULT_HISTORY_MAX, buildMamQuery, parseMamFin, toHistoryPage } from './mam';
import { PING_NAMESPACE } from './namespaces';
import { installStreamManagementAck } from './stream-management';
import { schedule, type Cancel } from './timers';
import {
  buildAvailablePresence,
  buildCarbonsEnable,
  buildCorrection,
  buildDisplayed,
  buildJoinPresence,
  buildLeavePresence,
  buildMessage,
  buildPingRequest,
  buildPingResult,
  buildPushDisable,
  buildPushEnable,
  buildReactions,
  buildRetraction,
  buildRosterError,
  buildRosterResult,
  buildTyping,
  buildUploadSlotRequest,
  decodeMessageStanza,
  isMamResult,
  mamResultQueryId,
  parseDirectInvitation,
  parseMucPresence,
  parseContactPresence,
  parseRosterPush,
  parseUploadSlot,
  stanzaErrorCondition,
  type MucPresence,
  type ParseContext,
  type RosterPush,
} from './stanza';
import type {
  ChatKind,
  ChatMessage,
  ConnectionStatus,
  HistoryPage,
  LoadHistoryOptions,
  Occupant,
  SendCorrectionOptions,
  SendMessageOptions,
  UploadRequest,
  UploadSlot,
  XmppCore,
  XmppCoreEffect,
  XmppCoreOptions,
} from './types';

const CONNECT_TIMEOUT_MS = 15_000;
// How long the client may stay in `connecting` / `reconnecting` before it is
// torn down and replaced by a fresh one. A normal connect (socket, TLS, token
// fetch, login) takes a second or two, so the first wait is short and each
// replacement that also fails waits a little longer (5, 8, 12, then 20 s;
// back to 5 s once online). That is at most about 20 token requests per ten
// minutes, far under the route's limit. `XmppCoreOptions.reconnectWatchdogMs`
// replaces the whole schedule with one fixed wait; 0 disables. xmpp.js only
// schedules a retry when it sees a socket `disconnect`; an attempt that fails
// without one (or a token fetch that never answers) leaves it waiting for
// ever, which is what showed as "Connecting..." until the app was force closed.
const WATCHDOG_SCHEDULE_MS = [5_000, 8_000, 12_000, 20_000];
const JOIN_TIMEOUT_MS = 15_000;
const HISTORY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 15_000;
// Idle time without any received stanza before the client pings the server
// (XEP-0199), and the wait for the reply before the connection counts as
// dead. Both are overridable per `XmppCoreOptions`; 0 disables the keepalive.
const DEFAULT_KEEPALIVE_MS = 30_000;
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 15_000;
// Waits between reconnect attempts after transient failures: 1 s, 2 s, 4 s,
// 8 s, 15 s, then 30 s, reset to 1 s after a successful connect. Even at the
// 30 s floor a client attempts about 20 tokens per 10 minutes, far under the
// token route's rate limit (120 per 10 minutes).
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

export type ClientOptions = {
  service: string;
  domain: string;
  credentials: XmppCredentialsProvider;
  resource: string;
};

export type ClientFactory = (options: ClientOptions) => XmppClient;

export type CoreDependencies = {
  createClient?: ClientFactory;
  now?: () => Date;
  generateId?: () => string;
};

// A request waits on a Deferred that the stanza handlers complete
// synchronously (`Deferred.doneUnsafe`), so a reply that arrives before the
// request starts awaiting is kept. The request removes its entry when it ends.
type PendingJoin = {
  deferred: Deferred.Deferred<void, XmppCoreError>;
};

type PendingQuery = {
  iqId: string;
  messages: ChatMessage[];
  deferred: Deferred.Deferred<HistoryPage, XmppCoreError>;
};

type PendingIq = {
  deferred: Deferred.Deferred<XmppElement, XmppCoreError>;
};

let idSequence = 0;

function defaultGenerateId(): string {
  idSequence += 1;
  return `g${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function defaultResource(): string {
  return `zilar-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultClientFactory(options: ClientOptions): XmppClient {
  return createLibraryClient({
    service: options.service,
    domain: options.domain,
    credentials: options.credentials,
    resource: options.resource,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A rejection of the library keeps its Error; anything else becomes one with
// the same text.
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

// One call into the library's Promise API as an Effect. A throw before the
// Promise exists fails the Effect like a rejection does.
function attempt(call: () => Promise<unknown>): Effect.Effect<void, Error> {
  return Effect.tryPromise({ try: call, catch: toError }).pipe(Effect.asVoid);
}

function isSaslError(error: unknown): boolean {
  return error instanceof Error && error.name === 'SASLError';
}

// Only an error that proves the credentials are bad is a fatal token
// failure: `getToken` rejecting with an error whose numeric `status` is 401
// or 403 (what the web and mobile token calls carry for an HTTP error
// response). A failed fetch (no response), a timeout, a 5xx or a 429 carry
// no fatal status and stay transient: the client keeps reconnecting.
function isFatalTokenError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && (status === 401 || status === 403);
}

function reconnectDelayFor(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
}

// A `conflict` stream error: another session logged in with the same full
// JID and the server replaced this one. @xmpp/client reports it through the
// `error` event as a StreamError whose `condition` is the stanza condition
// name (`conflict - <text>` in the message).
function isConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const condition = (error as { condition?: unknown }).condition;
  if (condition === 'conflict') {
    return true;
  }
  return (
    error.name === 'StreamError' &&
    (error.message === 'conflict' || error.message.startsWith('conflict - '))
  );
}

function redact(text: string, secret: string): string {
  return secret === '' ? text : text.split(secret).join('[redacted]');
}

// The Effect core plus the callback form of the events (`XmppCore.on`), which
// the Promise facade in `client.ts` hands on.
export type CoreEffect = XmppCoreEffect & { on: XmppCore['on'] };

export function createCoreEffect(
  options: XmppCoreOptions,
  deps: CoreDependencies = {},
): CoreEffect {
  const now = deps.now ?? ((): Date => new Date());
  const generateId = deps.generateId ?? defaultGenerateId;
  const createClient = deps.createClient ?? defaultClientFactory;
  const mucDomain = `rooms.${options.domain}`;

  let currentStatus: ConnectionStatus = 'offline';
  let meJid: string | undefined;
  let desiredOnline = false;
  let hasBeenOnline = false;
  let authFailed = false;
  // The token error of the in-flight authentication, when the failure was
  // transient. The client's error event carries the same object, so the
  // handler recognises it and tears the stuck stream down for a retry
  // instead of stopping for good.
  let transientTokenError: unknown;
  // Count of reconnect attempts since the last online; drives the
  // `reconnect.delay` the library waits before each retry.
  let reconnectAttempt = 0;
  // True once a client that never went online has started its first attempt:
  // later `connecting` events are retries and walk the backoff schedule.
  let coldAttemptSeen = false;
  // The keepalive ping id while its reply is pending, if any.
  let keepalivePingId: string | undefined;
  let keepaliveIdleTimer: Cancel | undefined;
  let keepaliveReplyTimer: Cancel | undefined;
  let watchdogTimer: Cancel | undefined;
  // How many times the watchdog replaced the client since the last online.
  let watchdogRestarts = 0;
  let latestToken: string | undefined;
  let xmpp: XmppClient | undefined;

  // The in-flight `connect()`: every caller awaits this Deferred, which
  // keeps the outcome if it settles before anyone awaits.
  let pendingConnect: Deferred.Deferred<void, Error> | undefined;
  let connectTimer: Cancel | undefined;

  const events = makeEventHub();
  const joinedRooms = new Map<string, string>();
  const rosters = new Map<string, Map<string, Occupant>>();
  const pendingJoins = new Map<string, PendingJoin>();
  const pendingQueries = new Map<string, PendingQuery>();
  const pendingIqs = new Map<string, PendingIq>();

  function emitEvent<K extends EventName>(event: K, payload: EventPayload[K]): void {
    events.emit(event, payload);
  }

  function emitError(message: string): void {
    emitEvent('error', {
      message: latestToken === undefined ? message : redact(message, latestToken),
    });
  }

  function setStatus(next: ConnectionStatus): void {
    if (currentStatus === next) return;
    currentStatus = next;
    if (next === 'online' || next === 'offline') {
      stopWatchdog();
      watchdogRestarts = 0;
    } else {
      armWatchdog();
    }
    emitEvent('status', next);
  }

  // A function, so a check after an `await` is not narrowed by an earlier one.
  function isOnline(): boolean {
    return currentStatus === 'online';
  }

  function watchdogMs(): number {
    if (options.reconnectWatchdogMs !== undefined) return options.reconnectWatchdogMs;
    return (
      WATCHDOG_SCHEDULE_MS[Math.min(watchdogRestarts, WATCHDOG_SCHEDULE_MS.length - 1)] ?? 20_000
    );
  }

  function stopWatchdog(): void {
    if (watchdogTimer !== undefined) {
      watchdogTimer();
      watchdogTimer = undefined;
    }
  }

  function armWatchdog(): void {
    if (watchdogTimer !== undefined || !desiredOnline || watchdogMs() <= 0) return;
    watchdogTimer = schedule(watchdogMs(), () => {
      watchdogTimer = undefined;
      Effect.runFork(restartStuckClient());
    });
  }

  // The client has not come online in time: drop it and start a fresh one.
  // `xmpp` is cleared first, so every late event of the old client is ignored
  // (see the `current !== xmpp` guards in `attachHandlers`).
  const restartStuckClient = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    if (!desiredOnline || currentStatus === 'online') return;
    const stale = xmpp;
    xmpp = undefined;
    watchdogRestarts += 1;
    reconnectAttempt = 0;
    coldAttemptSeen = false;
    transientTokenError = undefined;
    stopKeepalive();
    if (stale !== undefined) {
      // The old stream is already dead; nothing useful to report.
      yield* attempt(() => stale.stop()).pipe(Effect.ignore);
    }
    if (!desiredOnline || isOnline() || xmpp !== undefined) return;
    const fresh = ensureClient();
    armWatchdog();
    // The error event reports the failure; the watchdog tries again.
    Effect.runFork(attempt(() => fresh.start()).pipe(Effect.ignore));
  });

  function rosterFor(roomJid: string): Map<string, Occupant> {
    let roster = rosters.get(roomJid);
    if (roster === undefined) {
      roster = new Map();
      rosters.set(roomJid, roster);
    }
    return roster;
  }

  function occupantsFor(roomJid: string): Occupant[] {
    const roster = rosters.get(roomJid);
    if (roster === undefined) return [];
    const result: Occupant[] = [];
    for (const occupant of roster.values()) {
      result.push({ ...occupant });
    }
    result.sort((left, right) => left.jid.localeCompare(right.jid));
    return result;
  }

  function emitOccupants(roomJid: string): void {
    emitEvent('occupants', { roomJid, occupants: occupantsFor(roomJid) });
  }

  function clearRoster(roomJid: string): void {
    const roster = rosters.get(roomJid);
    if (roster === undefined) return;
    rosters.delete(roomJid);
    if (roster.size > 0) {
      emitEvent('occupants', { roomJid, occupants: [] });
    }
  }

  function clearAllRosters(): void {
    const roomJids: string[] = [];
    for (const roomJid of rosters.keys()) {
      roomJids.push(roomJid);
    }
    for (const roomJid of roomJids) {
      clearRoster(roomJid);
    }
  }

  function applyPresence(presence: MucPresence): void {
    const roster = rosterFor(presence.roomJid);
    if (!presence.available) {
      if (roster.delete(presence.occupantJid)) {
        emitOccupants(presence.roomJid);
      }
      return;
    }

    const occupant: Occupant = {
      jid: presence.occupantJid,
      nick: presence.nick,
      available: true,
    };
    if (presence.realJid !== undefined) occupant.realJid = presence.realJid;
    if (presence.occupantId !== undefined) occupant.occupantId = presence.occupantId;
    if (presence.affiliation !== undefined) occupant.affiliation = presence.affiliation;
    if (presence.role !== undefined) occupant.role = presence.role;
    roster.set(presence.occupantJid, occupant);
    emitOccupants(presence.roomJid);
  }

  function parseContext(): ParseContext {
    const context: ParseContext = {
      domain: options.domain,
      mucDomain,
      now,
      rosterFor: (roomJid) => rosters.get(roomJid),
      myNickFor: (roomJid) => joinedRooms.get(roomJid),
    };
    if (meJid !== undefined) context.me = meJid;
    return context;
  }

  function finishConnect(error?: Error): void {
    if (connectTimer !== undefined) {
      connectTimer();
      connectTimer = undefined;
    }
    const pending = pendingConnect;
    pendingConnect = undefined;
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
      try: () => options.getToken(),
      catch: (error) => error,
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          // The thrown error reaches the client's error handler, which
          // reports it. Only a fatal error (bad credentials) stops
          // reconnecting; any other token failure is transient and the
          // client keeps trying.
          if (isFatalTokenError(error)) {
            authFailed = true;
          } else {
            transientTokenError = error;
          }
        }),
      ),
    );

    latestToken = fresh.token;
    const mechanism = mechanisms.includes('PLAIN') ? 'PLAIN' : mechanisms[0];
    yield* Effect.tryPromise({
      try: () =>
        authenticate({ username: jidLocalPart(fresh.jid), password: fresh.token }, mechanism),
      catch: (error) => error,
    });
  });

  const credentials: XmppCredentialsProvider = (authenticate, mechanisms) =>
    Effect.runPromise(authenticateWithFreshToken(authenticate, mechanisms));

  const stopAfterFailure = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    desiredOnline = false;
    hasBeenOnline = false;
    reconnectAttempt = 0;
    coldAttemptSeen = false;
    stopKeepalive();
    setStatus('offline');
    meJid = undefined;
    clearAllRosters();
    rejectPendingIqs(() => new ConnectionFailed());
    const current = xmpp;
    if (current !== undefined) {
      // The stream is already failing; nothing useful to report.
      yield* attempt(() => current.stop()).pipe(Effect.ignore);
    }
  });

  function rejectPendingIqs(makeError: () => XmppCoreError): void {
    for (const [id, pending] of pendingIqs) {
      pendingIqs.delete(id);
      Deferred.doneUnsafe(pending.deferred, Effect.fail(makeError()));
    }
  }

  function keepaliveEnabled(): boolean {
    const idle = options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS;
    const timeout = options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS;
    return idle > 0 && timeout > 0;
  }

  function stopKeepalive(): void {
    keepalivePingId = undefined;
    if (keepaliveIdleTimer !== undefined) {
      keepaliveIdleTimer();
      keepaliveIdleTimer = undefined;
    }
    if (keepaliveReplyTimer !== undefined) {
      keepaliveReplyTimer();
      keepaliveReplyTimer = undefined;
    }
  }

  // Drives the library's wait before its next auto-reconnect: the schedule
  // in `reconnect.delay` is read when the retry is queued, so setting it at
  // the start of every attempt governs the wait after that attempt fails.
  function setReconnectDelay(ms: number): void {
    const current = xmpp;
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
    if (!keepaliveEnabled() || !desiredOnline) return;
    keepaliveIdleTimer = schedule(options.keepaliveMs ?? DEFAULT_KEEPALIVE_MS, () => {
      keepaliveIdleTimer = undefined;
      Effect.runFork(sendKeepalivePing());
    });
  }

  const sendKeepalivePing = Effect.fnUntraced(function* (): Effect.fn.Return<void> {
    const current = xmpp;
    if (current === undefined || !desiredOnline || currentStatus !== 'online') return;
    const id = generateId();
    keepalivePingId = id;
    const sent = yield* attempt(() =>
      current.send(buildPingRequest({ id, to: options.domain })),
    ).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!sent) {
      keepalivePingId = undefined;
      reconnectDeadConnection();
      return;
    }
    keepaliveReplyTimer = schedule(
      options.keepaliveTimeoutMs ?? DEFAULT_KEEPALIVE_TIMEOUT_MS,
      () => {
        keepaliveReplyTimer = undefined;
        keepalivePingId = undefined;
        reconnectDeadConnection();
      },
    );
  });

  // The keepalive found a dead connection: tear the socket down. The
  // resulting `disconnect` status lets the library reconnect through the
  // normal path (status `reconnecting`, then `online` again).
  function reconnectDeadConnection(): void {
    stopKeepalive();
    const current = xmpp;
    if (current === undefined || !desiredOnline) return;
    disconnectQuietly(current);
  }

  // The stream may already be dead (or its disconnect may throw): the
  // disconnect status still fires and the normal path reconnects.
  function disconnectQuietly(current: XmppClient): void {
    Effect.runFork(attempt(() => current.disconnect()).pipe(Effect.ignore));
  }

  function handleKeepaliveReply(id: string): boolean {
    if (keepalivePingId === undefined || keepalivePingId !== id) return false;
    keepalivePingId = undefined;
    if (keepaliveReplyTimer !== undefined) {
      keepaliveReplyTimer();
      keepaliveReplyTimer = undefined;
    }
    // A result or an error both prove the connection is alive: a fresh idle
    // period starts.
    startKeepalive();
    return true;
  }

  const afterOnline = Effect.fnUntraced(function* (current: XmppClient): Effect.fn.Return<void> {
    yield* sendQuietly(current, buildAvailablePresence());
    yield* sendQuietly(current, buildCarbonsEnable(generateId()));
    for (const [roomJid, nick] of joinedRooms) {
      // The server sends the full occupant list when we rejoin, so drop the
      // stale roster first.
      clearRoster(roomJid);
      yield* sendQuietly(current, buildJoinPresence(roomJid, nick));
    }
  });

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
      setStatus(desiredOnline ? (hasBeenOnline ? 'reconnecting' : 'connecting') : 'offline');
      return;
    }
    setStatus(desiredOnline ? (hasBeenOnline ? 'reconnecting' : 'offline') : 'offline');
  }

  function attachHandlers(current: XmppClient): void {
    current.on('status', (raw) => {
      if (current !== xmpp) return;
      // xmpp.js reports the `online` status just before the `online` event
      // that carries the bound JID. Going online here would let a listener
      // query history with no identity yet, so only that event goes online.
      if (raw === 'online') return;
      // Every attempt starts here: arm the wait after it, so a failure
      // backs off 1 s, 2 s, 4 s, 8 s, 15 s, then 30 s. A cold start that
      // never went online keeps the 1 s wait the library starts with, so
      // its first retry is 1 s too.
      if (raw === 'connecting') {
        if (hasBeenOnline || coldAttemptSeen) {
          reconnectAttempt += 1;
          setReconnectDelay(reconnectDelayFor(reconnectAttempt));
        }
        coldAttemptSeen = true;
      }
      applyRawStatus(raw);
    });

    current.on('online', (jid) => {
      if (current !== xmpp) return;
      meJid = jid.bare().toString();
      hasBeenOnline = true;
      reconnectAttempt = 0;
      setReconnectDelay(reconnectDelayFor(0));
      setStatus('online');
      finishConnect();
      startKeepalive();
      Effect.runFork(afterOnline(current));
    });

    current.on('error', (error) => {
      if (current !== xmpp) return;
      emitError(errorMessage(error));
      if (isConflictError(error)) {
        // Replaced by another session with the same full JID: stop for good
        // with no auto-reconnect, so two clients never kick each other in a
        // loop. A later explicit `connect()` still works.
        finishConnect(error);
        Effect.runFork(stopAfterFailure());
        emitEvent('replaced', undefined);
        return;
      }
      if (authFailed || isSaslError(error)) {
        authFailed = false;
        finishConnect(error);
        Effect.runFork(stopAfterFailure());
        return;
      }
      if (error === transientTokenError) {
        // A transient token failure leaves a stuck unauthenticated stream:
        // tear it down so the client reconnects and tries a fresh token
        // with backoff, instead of idling until the server closes it.
        transientTokenError = undefined;
        if (desiredOnline && currentStatus !== 'online') disconnectQuietly(current);
      }
    });

    current.on('stanza', (stanza) => {
      if (current !== xmpp) return;
      // Any traffic proves the connection is alive and restarts the idle
      // period; the keepalive only fires on a truly silent connection.
      if (currentStatus === 'online' && keepaliveEnabled()) startKeepalive();
      handleStanza(stanza);
    });
  }

  function ensureClient(): XmppClient {
    if (xmpp !== undefined) return xmpp;
    const created = createClient({
      service: options.service,
      domain: options.domain,
      credentials,
      resource: options.resource ?? defaultResource(),
    });
    attachHandlers(created);
    installStreamManagementAck(created);
    xmpp = created;
    return created;
  }

  function handleStanza(stanza: XmppElement): void {
    if (stanza.is('message')) {
      if (isMamResult(stanza)) {
        handleMamResult(stanza);
        return;
      }
      const invited = parseDirectInvitation(stanza, options.domain, mucDomain);
      if (invited !== undefined) emitEvent('invited', invited);
      const decoded = decodeMessageStanza(stanza, parseContext());
      if (decoded.message !== undefined) emitEvent('message', decoded.message);
      if (decoded.typing !== undefined) emitEvent('typing', decoded.typing);
      if (decoded.displayed !== undefined) emitEvent('displayed', decoded.displayed);
      return;
    }
    if (stanza.is('presence')) {
      handlePresence(stanza);
      return;
    }
    if (stanza.is('iq')) {
      handleIq(stanza);
    }
  }

  function handlePresence(stanza: XmppElement): void {
    const from = stanza.attrs['from'];
    if (from !== undefined) {
      const pending = pendingJoins.get(from);
      if (pending !== undefined) {
        const type = stanza.attrs['type'];
        if (type === 'error') {
          pendingJoins.delete(from);
          Deferred.doneUnsafe(
            pending.deferred,
            Effect.fail(new JoinRejected({ condition: stanzaErrorCondition(stanza) })),
          );
        } else if (type === undefined) {
          pendingJoins.delete(from);
          Deferred.doneUnsafe(pending.deferred, Effect.void);
        }
      }
    }

    // Roster data is only trusted from rooms we joined and only from the MUC
    // domain, so another sender cannot claim an identity.
    const presence = parseMucPresence(stanza, mucDomain);
    if (presence !== undefined && joinedRooms.has(presence.roomJid)) {
      applyPresence(presence);
      return;
    }

    const contact = parseContactPresence(stanza, options.domain);
    if (contact !== undefined) emitEvent('presence', contact);
  }

  function handleMamResult(stanza: XmppElement): void {
    const queryId = mamResultQueryId(stanza);
    if (queryId === undefined) return;
    const pending = pendingQueries.get(queryId);
    if (pending === undefined) return;
    const decoded = decodeMessageStanza(stanza, parseContext());
    if (decoded.message !== undefined) pending.messages.push(decoded.message);
  }

  function handleIq(stanza: XmppElement): void {
    const id = stanza.attrs['id'];
    if (id !== undefined) {
      // Our own keepalive ping answered (a result or an error both prove
      // the connection is alive).
      if (handleKeepaliveReply(id)) return;
      const pending = pendingIqs.get(id);
      if (pending !== undefined) {
        pendingIqs.delete(id);
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
      const current = xmpp;
      if (current !== undefined) {
        const from = stanza.attrs['from'];
        Effect.runFork(sendQuietly(current, buildPingResult(id, from)));
      }
      return;
    }

    const rosterPush = parseRosterPush(stanza, options.domain, meJid);
    if (rosterPush !== undefined) {
      handleRosterPush(rosterPush);
      return;
    }

    if (id === undefined) return;
    for (const [queryId, pending] of pendingQueries) {
      if (pending.iqId !== id) continue;
      pendingQueries.delete(queryId);
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

  function handleRosterPush(push: RosterPush): void {
    if (xmpp !== undefined) {
      const reply = push.trusted
        ? buildRosterResult(push.id, push.from)
        : buildRosterError(push.id, push.from);
      Effect.runFork(sendQuietly(xmpp, reply));
    }
    if (!push.trusted) return;
    for (const item of push.items) emitEvent('roster', item);
  }

  // Resolves when the client is online. It fails with `ConnectTimeout`,
  // `Disconnected`, or the error that stopped the attempt for good (a
  // conflict, a bad login), as thrown by the library.
  const connectEffect = Effect.fnUntraced(function* (): Effect.fn.Return<void, Error> {
    if (currentStatus === 'online') return;
    if (pendingConnect !== undefined) return yield* Deferred.await(pendingConnect);

    desiredOnline = true;
    authFailed = false;
    coldAttemptSeen = false;
    // An explicit connect() while the client is stuck mid-attempt (a resume
    // from the background) replaces it at once instead of waiting.
    const stuck =
      xmpp !== undefined && (currentStatus === 'connecting' || currentStatus === 'reconnecting');
    const current = ensureClient();
    setStatus(hasBeenOnline ? 'reconnecting' : 'connecting');

    const deferred = Deferred.makeUnsafe<void, Error>();
    pendingConnect = deferred;
    connectTimer = schedule(CONNECT_TIMEOUT_MS, () => {
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
    desiredOnline = false;
    hasBeenOnline = false;
    reconnectAttempt = 0;
    coldAttemptSeen = false;
    transientTokenError = undefined;
    stopKeepalive();
    setStatus('offline');
    finishConnect(new Disconnected());
    clearAllRosters();
    rejectPendingIqs(() => new Disconnected());
    const current = xmpp;
    if (current !== undefined) {
      // Stopping an already-closed stream is not an error worth surfacing.
      yield* attempt(() => current.stop()).pipe(Effect.ignore);
    }
    meJid = undefined;
  });

  // One request on a Deferred. The caller has already put its map entry in
  // place, so the reply handlers can find it. The send starts at once on a
  // child fiber, so the stanza goes out before the caller's first await: a
  // failed send fails the Deferred (a no-op once a reply or an earlier
  // failure completed it), and a send that never settles cannot hold the
  // request back from its reply or its timeout. Then the request awaits the
  // Deferred, which keeps a reply that arrived early, under the timeout.
  // `release` drops the map entry on every exit, including interruption.
  function request<A>(args: {
    deferred: Deferred.Deferred<A, XmppCoreError>;
    send: Effect.Effect<void, XmppCoreError>;
    timeoutMs: number;
    onTimeout: () => XmppCoreError;
    release: () => void;
  }): Effect.Effect<A, XmppCoreError> {
    const { deferred } = args;
    return Effect.gen(function* () {
      yield* args.send.pipe(
        Effect.tapError((error) => Deferred.fail(deferred, error)),
        Effect.ignore,
        Effect.forkChild({ startImmediately: true }),
      );
      return yield* Deferred.await(deferred).pipe(
        Effect.timeoutOrElse({
          duration: Duration.millis(args.timeoutMs),
          orElse: () => Effect.fail(args.onTimeout()),
        }),
      );
    }).pipe(Effect.ensuring(Effect.sync(args.release)));
  }

  function requireOnlineEffect(): Effect.Effect<XmppClient, NotOnline> {
    return Effect.suspend(() => {
      if (xmpp === undefined || currentStatus !== 'online') return Effect.fail(new NotOnline());
      return Effect.succeed(xmpp);
    });
  }

  const joinRoomEffect = Effect.fnUntraced(function* (
    roomJid: string,
    nick: string,
  ): Effect.fn.Return<void, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    joinedRooms.set(roomJid, nick);
    const key = `${roomJid}/${nick}`;

    const deferred = Deferred.makeUnsafe<void, XmppCoreError>();
    const entry: PendingJoin = { deferred };
    pendingJoins.set(key, entry);
    return yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(buildJoinPresence(roomJid, nick)),
        catch: (error) => new JoinSendFailed({ roomJid, cause: errorMessage(error) }),
      }),
      timeoutMs: JOIN_TIMEOUT_MS,
      onTimeout: () => new JoinTimeout({ roomJid }),
      release: () => {
        if (pendingJoins.get(key) === entry) pendingJoins.delete(key);
      },
    });
  });

  const leaveRoomEffect = Effect.fnUntraced(function* (roomJid: string): Effect.fn.Return<void> {
    const nick = joinedRooms.get(roomJid);
    joinedRooms.delete(roomJid);
    clearRoster(roomJid);
    if (nick === undefined || xmpp === undefined || currentStatus !== 'online') return;
    yield* sendQuietly(xmpp, buildLeavePresence(roomJid, nick));
  });

  // The send operations fail with `NotOnline`, or with the error the
  // library's `send` rejected with.
  const sendMessageEffect = Effect.fnUntraced(function* (
    to: string,
    kind: ChatKind,
    text: string,
    opts: SendMessageOptions = {},
  ): Effect.fn.Return<{ id: string }, NotOnline | Error> {
    const current = yield* requireOnlineEffect();
    const id = generateId();
    yield* attempt(() =>
      current.send(
        buildMessage({
          id,
          to,
          kind,
          text,
          payload: opts.payload,
          forward: opts.forward,
          replyTo: opts.replyTo,
          mentions: opts.mentions,
        }),
      ),
    );
    return { id };
  });

  const sendReactionsEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
    emojis: string[],
  ): Effect.fn.Return<void, NotOnline | Error> {
    const current = yield* requireOnlineEffect();
    yield* attempt(() =>
      current.send(buildReactions({ id: generateId(), to: chatJid, kind, targetId, emojis })),
    );
  });

  const sendCorrectionEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    originalId: string,
    text: string,
    opts: SendCorrectionOptions = {},
  ): Effect.fn.Return<{ id: string }, NotOnline | Error> {
    const current = yield* requireOnlineEffect();
    const id = generateId();
    yield* attempt(() =>
      current.send(
        buildCorrection({
          id,
          to: chatJid,
          kind,
          originalId,
          text,
          mentions: opts.mentions,
        }),
      ),
    );
    return { id };
  });

  const sendRetractionEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    targetId: string,
  ): Effect.fn.Return<void, NotOnline | Error> {
    const current = yield* requireOnlineEffect();
    yield* attempt(() =>
      current.send(buildRetraction({ id: generateId(), to: chatJid, kind, targetId })),
    );
  });

  // Typing and read markers are fire-and-forget: offline they do nothing, and
  // a failed send is reported as an `error` event.
  function sendQuietlyIfOnline(build: () => XmppElement): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (xmpp === undefined || currentStatus !== 'online') return Effect.void;
      return sendQuietly(xmpp, build());
    });
  }

  function sendTypingEffect(
    to: string,
    kind: ChatKind,
    state: 'composing' | 'paused',
  ): Effect.Effect<void> {
    return sendQuietlyIfOnline(() => buildTyping({ to, kind, state }));
  }

  function markDisplayedEffect(
    chatJid: string,
    kind: ChatKind,
    messageId: string,
  ): Effect.Effect<void> {
    return sendQuietlyIfOnline(() => buildDisplayed({ chatJid, kind, messageId }));
  }

  const loadHistoryEffect = Effect.fnUntraced(function* (
    chatJid: string,
    kind: ChatKind,
    opts: LoadHistoryOptions = {},
  ): Effect.fn.Return<HistoryPage, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    if (meJid === undefined) {
      return yield* new NoIdentity();
    }

    const queryId = generateId();
    const iqId = generateId();
    const max = opts.max ?? DEFAULT_HISTORY_MAX;
    const query = buildMamQuery({
      chatJid,
      kind,
      me: meJid,
      queryId,
      iqId,
      max,
      before: opts.before,
    });

    const deferred = Deferred.makeUnsafe<HistoryPage, XmppCoreError>();
    const entry: PendingQuery = { iqId, messages: [], deferred };
    pendingQueries.set(queryId, entry);
    return yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(query),
        catch: (error) => new HistorySendFailed({ chatJid, cause: errorMessage(error) }),
      }),
      timeoutMs: HISTORY_TIMEOUT_MS,
      onTimeout: () => new HistoryTimeout({ chatJid }),
      release: () => {
        if (pendingQueries.get(queryId) === entry) pendingQueries.delete(queryId);
      },
    });
  });

  const requestUploadSlotEffect = Effect.fnUntraced(function* (
    uploadRequest: UploadRequest,
  ): Effect.fn.Return<UploadSlot, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    const id = generateId();
    const service = `upload.${options.domain}`;
    const stanza = buildUploadSlotRequest({
      id,
      service,
      filename: uploadRequest.filename,
      size: uploadRequest.size,
      contentType: uploadRequest.contentType,
    });

    const deferred = Deferred.makeUnsafe<XmppElement, XmppCoreError>();
    const entry: PendingIq = { deferred };
    pendingIqs.set(id, entry);
    const reply = yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(stanza),
        catch: (error) => new UploadSlotFailed({ cause: errorMessage(error) }),
      }),
      timeoutMs: UPLOAD_TIMEOUT_MS,
      onTimeout: () => new UploadSlotTimeout(),
      release: () => {
        if (pendingIqs.get(id) === entry) pendingIqs.delete(id);
      },
    });
    const slot = parseUploadSlot(reply);
    if (slot === undefined) {
      return yield* new UploadSlotInvalid();
    }
    return slot;
  });

  // XEP-0357: enables or disables push for this session's push pair. The
  // request goes over the user's own session (ejabberd requires it) and
  // resolves when the server answers `result`, or rejects on `error`/timeout.
  const setPushEnabledEffect = Effect.fnUntraced(function* (pushOptions: {
    pushJid: string;
    node: string;
    enable: boolean;
  }): Effect.fn.Return<void, XmppCoreError> {
    const current = yield* requireOnlineEffect();
    const id = generateId();
    const stanza =
      pushOptions.enable === true
        ? buildPushEnable({ id, pushJid: pushOptions.pushJid, node: pushOptions.node })
        : buildPushDisable({ id, pushJid: pushOptions.pushJid, node: pushOptions.node });

    const deferred = Deferred.makeUnsafe<XmppElement, XmppCoreError>();
    const entry: PendingIq = { deferred };
    pendingIqs.set(id, entry);
    yield* request({
      deferred,
      send: Effect.tryPromise({
        try: () => current.send(stanza),
        catch: (error) => new PushToggleFailed({ cause: errorMessage(error) }),
      }),
      timeoutMs: PUSH_TIMEOUT_MS,
      onTimeout: () => new PushToggleTimeout(),
      release: () => {
        if (pendingIqs.get(id) === entry) pendingIqs.delete(id);
      },
    });
  });

  return {
    status: () => currentStatus,
    me: () => meJid,
    occupants: occupantsFor,
    connect: connectEffect,
    disconnect: disconnectEffect,
    joinRoom: joinRoomEffect,
    leaveRoom: leaveRoomEffect,
    sendMessage: sendMessageEffect,
    sendReactions: sendReactionsEffect,
    sendCorrection: sendCorrectionEffect,
    sendRetraction: sendRetractionEffect,
    loadHistory: loadHistoryEffect,
    requestUploadSlot: requestUploadSlotEffect,
    setPushEnabled: setPushEnabledEffect,
    sendTyping: sendTypingEffect,
    markDisplayed: markDisplayedEffect,
    events: events.streams,
    on: (event: EventName, listener: StoredListener) => events.on(event, listener),
  };
}
