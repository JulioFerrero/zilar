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
// How long a fresh bind waits for `<enabled/>` before going `online` anyway: a message
// written before `<enable/>` is never tracked, so the store's flush must land after it;
// a server without stream management falls back to this wait.
const SM_ENABLE_TIMEOUT_MS = 5_000;
// How long the client may stay connecting before it is torn down and replaced. A normal
// connect takes a second or two, so the wait grows (5, 8, 12, then 20 s; back to 5 once
// online), at most ~20 token requests per ten minutes. `reconnectWatchdogMs` fixes one wait,
// 0 disables; xmpp.js only retries on a socket disconnect, so a failed attempt waits forever.
const WATCHDOG_SCHEDULE_MS = [5_000, 8_000, 12_000, 20_000];
const JOIN_TIMEOUT_MS = 15_000;
const HISTORY_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 15_000;
const PUSH_TIMEOUT_MS = 15_000;
// Idle time before the client pings the server (XEP-0199), and the wait for the reply
// before the connection counts as dead; 0 disables the keepalive.
const DEFAULT_KEEPALIVE_MS = 30_000;
const DEFAULT_KEEPALIVE_TIMEOUT_MS = 15_000;
// Reconnect waits: 1, 2, 4, 8, 15, then 30 s, reset after a successful connect. Even at
// the 30 s floor that is about 20 token requests per 10 minutes, under the route's 120.
const RECONNECT_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
// The wait before the single retry of a token fetch that looked like bad credentials
// (401/403): a deploy race or stale cache can answer 401 once and then succeed.
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

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(errorMessage(error));
}

// One call into the library's Promise API as an Effect; a throw fails it like a rejection.
export function attempt(call: () => Promise<unknown>): Effect.Effect<void, Error> {
  return Effect.tryPromise({ try: call, catch: toError }).pipe(Effect.asVoid);
}

export function isSaslError(error: unknown): boolean {
  return error instanceof Error && error.name === 'SASLError';
}

// Only an error proving the credentials are bad is fatal: `getToken` rejecting with a
// numeric `status` of 401 or 403. A failed fetch, a timeout, a 5xx or a 429 carries no
// fatal status and stays transient, so the client keeps reconnecting.
export function isFatalTokenError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && (status === 401 || status === 403);
}

export function reconnectDelayFor(attempt: number): number {
  return RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] ?? 30_000;
}

// A `conflict` stream error: another session logged in with the same full JID and the
// server replaced this one; @xmpp/client reports it as a StreamError `condition`.
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

// The mutable core state and the functions the modules share. The factories are built
// first and the cross-module functions wired after, so a module reads them at call time.
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

declare module '../events' {
  interface EventPayloadMap {
    /**
     * The token fetch failed for good: both attempts answered 401/403, so the core
     * stopped. A store can revive the connection with its own retry ladder.
     */
    authFailed: void;
  }
}

declare module '../types' {
  interface XmppCoreOptions {
    /** The wait before the one retry of a token fetch that looked like bad credentials. */
    tokenRetryDelayMs?: number;
  }
  interface XmppCore {
    /** Both token-fetch attempts failed (401/403): the core stopped. */
    on(event: 'authFailed', cb: () => void): () => void;
  }
}
