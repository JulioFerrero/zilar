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
  WATCHDOG_SCHEDULE_MS,
  JOIN_TIMEOUT_MS,
  HISTORY_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  DEFAULT_KEEPALIVE_MS,
  DEFAULT_KEEPALIVE_TIMEOUT_MS,
  RECONNECT_BACKOFF_MS,
};
