import {
  client as createLibraryClient,
  type XmppClient,
  type XmppCredentialsProvider,
  type XmppElement,
} from '@xmpp/client';
import { Deferred, Effect } from 'effect';
import type { XmppCoreError } from '../errors';
import type { EventHub, EventName, EventPayload } from '../events';
import type { ParseContext, RosterPush } from '../stanza';
import type { Cancel } from '../timers';
import type {
  ChatMessage,
  ConnectionStatus,
  HistoryPage,
  Occupant,
  XmppCoreOptions,
} from '../types';

const CONNECT_TIMEOUT_MS = 15_000;
// How long a fresh bind may wait for the server's <enabled/> (stream
// management) before the core reports `online` anyway. A message written
// before <enable/> is never tracked by the library and never covered by the
// server's <a h/>, so the store's online flush must land after it; a server
// that does not offer stream management (or a lost <enabled/>) falls back to
// this wait so the app still comes online (T-1220).
const SM_ENABLE_TIMEOUT_MS = 5_000;
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
// The wait before the single retry of a token fetch that looked like bad
// credentials (a 401 or 403). A session refresh that races a deploy, or a
// stale session cache, can answer 401 once and then succeed, so one such
// answer must not stop the client for good. `XmppCoreOptions.tokenRetryDelayMs`
// overrides it (tests pass 0).
const TOKEN_RETRY_DELAY_MS = 2_000;

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
export type PendingJoin = {
  deferred: Deferred.Deferred<void, XmppCoreError>;
};

export type PendingQuery = {
  iqId: string;
  messages: ChatMessage[];
  deferred: Deferred.Deferred<HistoryPage, XmppCoreError>;
};

export type PendingIq = {
  deferred: Deferred.Deferred<XmppElement, XmppCoreError>;
};

let idSequence = 0;

export function defaultGenerateId(): string {
  idSequence += 1;
  return `g${Date.now().toString(36)}-${idSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function defaultResource(): string {
  return `zilar-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultClientFactory(options: ClientOptions): XmppClient {
  return createLibraryClient({
    service: options.service,
    domain: options.domain,
    credentials: options.credentials,
    resource: options.resource,
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A rejection of the library keeps its Error; anything else becomes one with
// the same text.
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

// One call into the library's Promise API as an Effect. A throw before the
// Promise exists fails the Effect like a rejection does.
export function attempt(call: () => Promise<unknown>): Effect.Effect<void, Error> {
  return Effect.tryPromise({ try: call, catch: toError }).pipe(Effect.asVoid);
}

export function isSaslError(error: unknown): boolean {
  return error instanceof Error && error.name === 'SASLError';
}

// Only an error that proves the credentials are bad is a fatal token
// failure: `getToken` rejecting with an error whose numeric `status` is 401
// or 403 (what the web and mobile token calls carry for an HTTP error
// response). A failed fetch (no response), a timeout, a 5xx or a 429 carry
// no fatal status and stay transient: the client keeps reconnecting.
export function isFatalTokenError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && (status === 401 || status === 403);
}

export function reconnectDelayFor(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
}

// A `conflict` stream error: another session logged in with the same full
// JID and the server replaced this one. @xmpp/client reports it through the
// `error` event as a StreamError whose `condition` is the stanza condition
// name (`conflict - <text>` in the message).
export function isConflictError(error: unknown): boolean {
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

export function redact(text: string, secret: string): string {
  return secret === '' ? text : text.split(secret).join('[redacted]');
}

// The mutable core state and the functions the modules share. `createCoreEffect`
// builds one of these and hands it to `presence`, `stanza-router`, `lifecycle`
// and `operations`; the cross-module functions are wired after the factories
// are built, so a module reads them at call time, never at construction.
export type CoreRuntime = {
  options: XmppCoreOptions;
  now: () => Date;
  generateId: () => string;
  createClient: ClientFactory;
  mucDomain: string;

  currentStatus: ConnectionStatus;
  meJid: string | undefined;
  desiredOnline: boolean;
  hasBeenOnline: boolean;
  authFailed: boolean;
  transientTokenError: unknown;
  reconnectAttempt: number;
  coldAttemptSeen: boolean;
  keepalivePingId: string | undefined;
  keepaliveIdleTimer: Cancel | undefined;
  keepaliveReplyTimer: Cancel | undefined;
  watchdogTimer: Cancel | undefined;
  watchdogRestarts: number;
  latestToken: string | undefined;
  xmpp: XmppClient | undefined;
  pendingConnect: Deferred.Deferred<void, Error> | undefined;
  connectTimer: Cancel | undefined;

  events: EventHub;
  joinedRooms: Map<string, string>;
  rosters: Map<string, Map<string, Occupant>>;
  pendingJoins: Map<string, PendingJoin>;
  pendingQueries: Map<string, PendingQuery>;
  pendingIqs: Map<string, PendingIq>;

  emitEvent: <K extends EventName>(event: K, payload: EventPayload[K]) => void;
  ensureClient: () => XmppClient;
  sendQuietly: (current: XmppClient, stanza: XmppElement) => Effect.Effect<void>;
  handleStanza: (stanza: XmppElement) => void;
  handlePresence: (stanza: XmppElement) => void;
  handleRosterPush: (push: RosterPush) => void;
  handleKeepaliveReply: (id: string) => boolean;
  clearRoster: (roomJid: string) => void;
  clearAllRosters: () => void;
  parseContext: () => ParseContext;
};

export {
  CONNECT_TIMEOUT_MS,
  SM_ENABLE_TIMEOUT_MS,
  WATCHDOG_SCHEDULE_MS,
  JOIN_TIMEOUT_MS,
  HISTORY_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  DEFAULT_KEEPALIVE_MS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  RECONNECT_BACKOFF_MS,
  TOKEN_RETRY_DELAY_MS,
};

// The token step's one retry and the event a store listens for when it does not
// help live here as module augmentations, the same way `types-ack.ts` adds the
// stream-management events and the first-watchdog option, so `types.ts` keeps
// its single re-export line.
declare module '../events' {
  interface EventPayloadMap {
    /**
     * The token fetch failed for good: both attempts answered 401/403, so the
     * core stopped. A store can revive the connection with its own retry
     * ladder instead of staying offline until the app restarts.
     */
    authFailed: void;
  }
}

declare module '../types' {
  interface XmppCoreOptions {
    /**
     * The wait before the one retry of a token fetch that looked like bad
     * credentials. Defaults to `TOKEN_RETRY_DELAY_MS` (2 000); tests pass 0.
     */
    tokenRetryDelayMs?: number;
  }
  interface XmppCore {
    /** Both token-fetch attempts failed (401/403): the core stopped. */
    on(event: 'authFailed', cb: () => void): () => void;
  }
}
